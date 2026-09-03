// Pętla symulacji jednego pokoju: fixed timestep + broadcast events/snapshotów.
// CZYSTY kod – brak własnych timerów; właściciel woła `tick(nowMs)` co ~16 ms
// (setInterval w Node, requestAnimationFrame/setInterval w przeglądarce).
import { FIXED_DT, SNAPSHOT_RATE, TICK_RATE } from "../constants";
import { createGame } from "../engine";
import type { Game, TeamSetup } from "../engine";
import type { GameConfig, InputAction, InputState, ServerMessage, TerrainSync, WeaponId } from "../protocol";

export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_MS = 1000 / SNAPSHOT_RATE;
/** Maksymalna liczba kroków symulacji na jeden tick – zabezpieczenie przed spiralą śmierci. */
export const MAX_STEPS_PER_TICK = 5;

/** Runtime'owa lista broni (protocol.ts eksportuje tylko typ WeaponId). */
export const WEAPON_IDS = [
  "bazooka",
  "grenade",
  "cluster",
  "shotgun",
  "uzi",
  "holy",
  "dynamite",
  "mine",
  "airstrike",
  "homing",
  "banana",
  "bat",
  "teleport",
  "girder",
  "jetpack",
  "skip",
] as const satisfies readonly WeaponId[];

const WEAPON_SET = new Set<string>(WEAPON_IDS);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Waliduje ciągły stan wejścia. Zwraca znormalizowany obiekt albo null. */
export function validateInputState(raw: unknown): InputState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.left !== "boolean" || typeof v.right !== "boolean" || typeof v.charge !== "boolean") return null;
  if (!isFiniteNumber(v.aim)) return null;
  return { left: v.left, right: v.right, aim: v.aim, charge: v.charge };
}

/** Waliduje akcję jednorazową. Zwraca znormalizowaną akcję albo null. */
export function validateAction(raw: unknown): InputAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  switch (v.kind) {
    case "jump":
    case "backflip":
    case "girderRotate":
    case "skipTurn":
    case "surrender":
      return { kind: v.kind };
    case "fire": {
      if (!isFiniteNumber(v.power)) return null;
      return { kind: "fire", power: Math.min(1, Math.max(0, v.power)) };
    }
    case "selectWeapon": {
      if (typeof v.weapon !== "string" || !WEAPON_SET.has(v.weapon)) return null;
      return { kind: "selectWeapon", weapon: v.weapon as WeaponId };
    }
    case "setTimer": {
      if (!isFiniteNumber(v.seconds)) return null;
      const s = Math.round(v.seconds);
      if (s < 1 || s > 5) return null;
      return { kind: "setTimer", seconds: s as 1 | 2 | 3 | 4 | 5 };
    }
    case "target": {
      if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
      return { kind: "target", x: v.x, y: v.y };
    }
    default:
      return null;
  }
}

export interface GameLoopDeps {
  /** Rozsyła wiadomość do wszystkich w pokoju. */
  broadcast(msg: ServerMessage): void;
  /** Wywoływane po zakończeniu gry (po wysłaniu `gameOver`). */
  onGameOver?(): void;
}

export class GameLoop {
  readonly game: Game;
  private running = false;
  private acc = 0;
  private snapAcc = 0;
  /** NaN dopóki nie znamy pierwszego nowMs. */
  private last = Number.NaN;
  private startedAt = 0;
  private ticks = 0;
  private now = 0;

  constructor(
    config: GameConfig,
    teams: TeamSetup[],
    private readonly deps: GameLoopDeps,
  ) {
    this.game = createGame(config, teams);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** `nowMs` opcjonalne – jeśli brak, zsynchronizuje się przy pierwszym ticku. */
  start(nowMs?: number): void {
    if (this.running) return;
    this.running = true;
    this.acc = 0;
    this.snapAcc = 0;
    this.ticks = 0;
    this.last = isFiniteNumber(nowMs) ? nowMs : Number.NaN;
    this.startedAt = isFiniteNumber(nowMs) ? nowMs : 0;
    this.now = this.startedAt;
  }

  stop(): void {
    this.running = false;
  }

  /** Jeden krok pętli. `nowMs` = monotoniczny czas w ms (Date.now/performance.now). */
  tick(nowMs: number): void {
    if (!this.running) return;
    if (!isFiniteNumber(this.last)) {
      // Pierwszy tick tylko synchronizuje zegar.
      this.last = nowMs;
      this.startedAt = nowMs;
      this.now = nowMs;
      return;
    }
    const elapsed = Math.max(0, nowMs - this.last);
    this.last = nowMs;
    this.now = nowMs;
    this.ticks++;
    this.acc += elapsed;
    this.snapAcc += elapsed;

    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_STEPS_PER_TICK) {
      this.acc -= TICK_MS;
      steps++;
      this.game.step(FIXED_DT);
      // Zdarzenia MUSZĄ dotrzeć przed kolejnym snapshotem (klient rzeźbi teren).
      const events = this.game.drainEvents();
      if (events.length > 0) this.deps.broadcast({ t: "events", events });
      if (this.game.isOver()) {
        this.finish();
        return;
      }
    }
    // Nie odrabiamy zaległości w nieskończoność – porzucamy nadmiar.
    if (this.acc > TICK_MS * MAX_STEPS_PER_TICK) this.acc = 0;

    if (this.snapAcc >= SNAPSHOT_MS) {
      this.snapAcc = 0;
      this.sendSnapshot();
    }
  }

  sendSnapshot(): void {
    this.deps.broadcast({ t: "snapshot", snapshot: this.game.snapshot() });
  }

  applyInput(team: number, raw: unknown): boolean {
    const state = validateInputState(raw);
    if (!state) return false;
    this.game.applyInput(team, state);
    return true;
  }

  applyAction(team: number, raw: unknown): boolean {
    const action = validateAction(raw);
    if (!action) return false;
    this.game.applyAction(team, action);
    return true;
  }

  removeTeam(team: number): void {
    this.game.removeTeam(team);
    if (this.running && this.game.isOver()) this.finish();
  }

  terrainSync(): TerrainSync {
    return this.game.terrainSync();
  }

  snapshotMessage(): ServerMessage {
    return { t: "snapshot", snapshot: this.game.snapshot() };
  }

  /** Kończy grę: ostatni snapshot + `gameOver`, zatrzymuje pętlę. */
  finish(): void {
    if (!this.running) return;
    this.stop();
    let round = 0;
    try {
      const snap = this.game.snapshot();
      round = snap.turn?.round ?? 0;
      this.deps.broadcast({ t: "snapshot", snapshot: snap });
    } catch {
      /* silnik może już nie dać snapshotu – trudno */
    }
    const winner = this.game.winner();
    this.deps.broadcast({
      t: "gameOver",
      winnerTeam: winner?.team ?? null,
      winnerName: winner?.name ?? null,
      stats: {
        round,
        durationSec: Math.round((this.now - this.startedAt) / 100) / 10,
        ticks: this.ticks,
      },
    });
    this.deps.onGameOver?.();
  }
}
