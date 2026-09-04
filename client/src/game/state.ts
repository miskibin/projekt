import { SNAPSHOT_RATE } from "@shared/constants";
import type {
  CrateSnapshot,
  GameSnapshot,
  MineSnapshot,
  ProjectileSnapshot,
  TeamSnapshot,
  TurnInfo,
  WormSnapshot,
} from "@shared/protocol";

/** Online render stays behind the host long enough to absorb normal Realtime jitter. */
export const INTERP_DELAY_MS = Math.max(120, 2 * (1000 / SNAPSHOT_RATE));
/** Local demo produces a snapshot every simulation step and does not need a network buffer. */
export const LOCAL_INTERP_DELAY_MS = 1000 / 30;

const HISTORY_SIZE = 12;
const OFFSET_SAMPLES = 32;
const MAX_EXTRAPOLATION_MS = 80;

export interface RenderState {
  tick: number;
  time: number;
  worms: WormSnapshot[];
  projectiles: ProjectileSnapshot[];
  crates: CrateSnapshot[];
  mines: MineSnapshot[];
  teams: TeamSnapshot[];
  turn: TurnInfo;
}

interface Entry {
  recv: number;
  snap: GameSnapshot;
}

/**
 * Snapshot history rendered on the host's simulation timeline.
 *
 * Supabase can deliver two 20 Hz snapshots in one broadcast. Receive timestamps are
 * deliberately not used as interpolation endpoints: doing so made a remote worm stop
 * for a frame and then jump. The lowest recent clock offset estimates the normal network
 * path, while the render delay absorbs temporary packet jitter.
 */
export class SnapshotBuffer {
  private entries: Entry[] = [];
  private offsets: number[] = [];
  private clockOffset = 0;
  private delayMs: number;

  constructor(delayMs = INTERP_DELAY_MS) {
    this.delayMs = delayMs;
  }

  setInterpolationDelay(delayMs: number): void {
    this.delayMs = Math.max(0, delayMs);
  }

  get interpolationDelayMs(): number {
    return this.delayMs;
  }

  push(snap: GameSnapshot, now = performance.now()): void {
    const latest = this.entries.at(-1);
    if (latest && snap.tick <= latest.snap.tick) return;

    this.entries.push({ recv: now, snap });
    if (this.entries.length > HISTORY_SIZE) this.entries.shift();

    this.offsets.push(now - snap.time * 1000);
    if (this.offsets.length > OFFSET_SAMPLES) this.offsets.shift();
    // The minimum filters queueing jitter without letting a late packet move the
    // render clock backwards. A rolling window adapts after a long tab pause.
    this.clockOffset = Math.min(...this.offsets);
  }

  clear(): void {
    this.entries = [];
    this.offsets = [];
    this.clockOffset = 0;
  }

  get latest(): GameSnapshot | null {
    return this.entries.at(-1)?.snap ?? null;
  }

  get hasData(): boolean {
    return this.entries.length > 0;
  }

  /** Interpolated state for `now` (performance.now), based on simulation time. */
  sample(now = performance.now()): RenderState | null {
    const first = this.entries[0];
    if (!first) return null;
    if (this.entries.length === 1) return toRender(first.snap, first.snap, 1);

    const targetMs = now - this.clockOffset - this.delayMs;
    if (targetMs <= first.snap.time * 1000) return toRender(first.snap, first.snap, 1);

    for (let i = 1; i < this.entries.length; i++) {
      const b = this.entries[i];
      const bTime = b.snap.time * 1000;
      if (targetMs > bTime) continue;
      const a = this.entries[i - 1];
      const aTime = a.snap.time * 1000;
      const span = bTime - aTime;
      const t = span > 0.0001 ? (targetMs - aTime) / span : 1;
      return toRender(a.snap, b.snap, clamp(t, 0, 1));
    }

    // A short extrapolation masks a single late packet. It uses the two latest
    // snapshots, so walking (whose physics velocity can be zero) also stays smooth.
    const b = this.entries.at(-1)!;
    const a = this.entries.at(-2)!;
    const aTime = a.snap.time * 1000;
    const bTime = b.snap.time * 1000;
    const span = bTime - aTime;
    if (span <= 0.0001) return toRender(b.snap, b.snap, 1);
    const extra = clamp(targetMs - bTime, 0, MAX_EXTRAPOLATION_MS);
    return toRender(a.snap, b.snap, 1 + extra / span);
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function indexById<T extends { id: number }>(arr: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const it of arr) m.set(it.id, it);
  return m;
}

function toRender(a: GameSnapshot, b: GameSnapshot, t: number): RenderState {
  const aw = indexById(a.worms);
  const ap = indexById(a.projectiles);
  const ac = indexById(a.crates);
  const am = indexById(a.mines);

  const worms: WormSnapshot[] = b.worms.map((w) => {
    const o = aw.get(w.id);
    if (!o) return w;
    return {
      ...w,
      x: lerp(o.x, w.x, t),
      y: lerp(o.y, w.y, t),
      aim: lerpAngle(o.aim, w.aim, t),
      hp: w.hp,
    };
  });

  const projectiles: ProjectileSnapshot[] = b.projectiles.map((p) => {
    const o = ap.get(p.id);
    if (!o) return p;
    return {
      ...p,
      x: lerp(o.x, p.x, t),
      y: lerp(o.y, p.y, t),
      vx: lerp(o.vx, p.vx, t),
      vy: lerp(o.vy, p.vy, t),
      angle: p.angle !== undefined && o.angle !== undefined ? lerpAngle(o.angle, p.angle, t) : p.angle,
      fuse: p.fuse !== undefined && o.fuse !== undefined ? lerp(o.fuse, p.fuse, t) : p.fuse,
    };
  });

  const crates: CrateSnapshot[] = b.crates.map((c) => {
    const o = ac.get(c.id);
    if (!o) return c;
    return { ...c, x: lerp(o.x, c.x, t), y: lerp(o.y, c.y, t) };
  });

  const mines: MineSnapshot[] = b.mines.map((m) => {
    const o = am.get(m.id);
    if (!o) return m;
    return { ...m, x: lerp(o.x, m.x, t), y: lerp(o.y, m.y, t) };
  });

  const teams: TeamSnapshot[] = b.teams;
  const turn: TurnInfo = {
    ...b.turn,
    waterLevel: lerp(a.turn.waterLevel, b.turn.waterLevel, t),
    timeLeft: Math.max(0, lerp(a.turn.timeLeft, b.turn.timeLeft, t)),
    chargePower: clamp(lerp(a.turn.chargePower, b.turn.chargePower, t), 0, 1),
  };

  return {
    tick: b.tick,
    time: lerp(a.time, b.time, t),
    worms,
    projectiles,
    crates,
    mines,
    teams,
    turn,
  };
}
