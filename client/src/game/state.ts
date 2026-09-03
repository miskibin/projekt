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

/** Opóźnienie renderu: jeden odstęp snapshotów + zapas na jitter. */
export const INTERP_DELAY_MS = 1000 / SNAPSHOT_RATE + 30;

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
 * Bufor dwóch ostatnich snapshotów + interpolacja pozycji w czasie renderu.
 * Encje, których nie ma w starszym snapshocie, rysujemy bez interpolacji.
 */
export class SnapshotBuffer {
  private prev: Entry | null = null;
  private cur: Entry | null = null;

  push(snap: GameSnapshot, now = performance.now()): void {
    if (this.cur && snap.tick < this.cur.snap.tick) return; // spóźniony pakiet
    this.prev = this.cur;
    this.cur = { recv: now, snap };
  }

  clear(): void {
    this.prev = null;
    this.cur = null;
  }

  get latest(): GameSnapshot | null {
    return this.cur?.snap ?? null;
  }

  get hasData(): boolean {
    return this.cur !== null;
  }

  /** Zinterpolowany stan do wyrenderowania w chwili `now` (performance.now()). */
  sample(now = performance.now()): RenderState | null {
    if (!this.cur) return null;
    const b = this.cur;
    if (!this.prev) return toRender(b.snap, b.snap, 1);
    const a = this.prev;
    const renderTime = now - INTERP_DELAY_MS;
    const span = b.recv - a.recv;
    let t = span > 0.0001 ? (renderTime - a.recv) / span : 1;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return toRender(a.snap, b.snap, t);
  }
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
    timeLeft: lerp(a.turn.timeLeft, b.turn.timeLeft, t),
    chargePower: lerp(a.turn.chargePower, b.turn.chargePower, t),
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
