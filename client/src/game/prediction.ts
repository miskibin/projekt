import { WORM_MAX_STEP_UP, WORM_RADIUS, WORM_WALK_SPEED } from "@shared/constants";
import { walkStep } from "@shared/engine/physics";
import type { Terrain } from "@shared/engine/terrain";
import type { GameSnapshot, InputState } from "@shared/protocol";
import type { RenderState } from "./state";

/** Krótkie zerwanie może trwać dłużej niż pojedynczy heartbeat 180 ms. */
const MAX_LEAD = 0.35;
const STALE_MS = 900;

/** Pozycja własnego robaka oparta o snapshot hosta i potwierdzone wejścia. */
export class LocalPrediction {
  private latest: GameSnapshot | null = null;
  private receivedAt = 0;
  private id = -1;
  private x = 0;
  private y = 0;
  private sentSeq = 0;
  private sentDirection = 0;
  private directionChangedAt = 0;
  private behindSince = 0;

  onInputSent(seq: number, input: InputState, now = performance.now()): void {
    const direction = Number(input.right) - Number(input.left);
    if (direction !== this.sentDirection) this.directionChangedAt = now;
    this.sentDirection = direction;
    this.sentSeq = seq;
  }

  onSnapshot(snapshot: GameSnapshot, now = performance.now()): void {
    if (this.latest && snapshot.tick <= this.latest.tick) return;
    this.latest = snapshot;
    this.receivedAt = now;
  }

  reset(): void {
    this.latest = null;
    this.receivedAt = 0;
    this.id = -1;
    this.sentSeq = 0;
    this.sentDirection = 0;
    this.directionChangedAt = 0;
    this.behindSince = 0;
  }

  get ageMs(): number {
    return this.latest ? Math.max(0, performance.now() - this.receivedAt) : Infinity;
  }

  apply(state: RenderState, terrain: Terrain, input: InputState, team: number,
    dt: number, now = performance.now(), rttMs = 0): RenderState {
    if (state.turn.activeTeam !== team || (state.turn.phase !== "active" && state.turn.phase !== "retreat")) {
      this.id = -1;
      this.behindSince = 0;
      return state;
    }
    const active = state.worms.find((w) => w.id === state.turn.activeWormId && w.alive);
    const authoritative = this.latest?.worms.find((w) => w.id === active?.id);
    if (!active || !authoritative) return state;
    if (this.id !== active.id) {
      this.id = active.id;
      this.x = authoritative.x;
      this.y = authoritative.y;
    }

    const ageMs = Math.max(0, now - this.receivedAt);
    const direction = Number(input.right) - Number(input.left);
    // Po zaniku snapshotów zamrażamy pozycję. Nie pokazujemy ruchu, którego host nie widział.
    if (ageMs < STALE_MS) {
      const ack = this.latest?.inputAcks?.[team] ?? -1;
      const confirmed = this.sentSeq > 0 && ack >= this.sentSeq;
      // Heartbeat przy chodzeniu co 180 ms nie oznacza nowej zmiany kierunku.
      // Nie hamujemy postaci do 80 ms przewidywania przy każdym nowym numerze seq.
      const lead = direction === this.sentDirection && this.sentSeq > 0
        ? Math.min(MAX_LEAD, ageMs / 1000 + Math.min(0.11, Math.max(0.025, rttMs / 2000)))
        : 0;
      const target = { x: authoritative.x, y: authoritative.y };
      if (direction && authoritative.onGround && authoritative.anim !== "jetpack") {
        // Ta sama fizyka kroku co u hosta, na bazie najnowszego stanu autorytatywnego.
        const steps = Math.ceil(lead * 60);
        for (let i = 0; i < steps; i++) {
          const span = Math.min(1 / 60, lead - i / 60);
          if (walkStep(terrain, target, WORM_RADIUS, direction * WORM_WALK_SPEED * span,
            WORM_MAX_STEP_UP, 8) !== "moved") break;
        }
      } else if (!confirmed && !direction && this.sentSeq > 0) {
        // STOP czeka na potwierdzenie hosta – stare migawki nie mogą cofać postaci.
        target.x = this.x;
        target.y = this.y;
      }
      // Wahania czasu dostarczenia snapshotów nie mogą szarpać idącej postaci wstecz.
      // Dużą rozbieżność nadal korygujemy: wtedy host naprawdę ma inny stan.
      const hostBehind = direction && (target.x - this.x) * direction < 0;
      if (hostBehind && confirmed && !this.behindSince) this.behindSince = now;
      if (!hostBehind) this.behindSince = 0;
      if (hostBehind && Math.abs(target.x - this.x) < 28 &&
        (!confirmed || now - this.behindSince < 500)) {
        target.x = this.x;
        target.y = this.y;
      }
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      if (Math.abs(dx) > 56 || Math.abs(dy) > 42) {
        // Teleport, odrzut lub zmiana podłoża wymagają faktycznej korekty.
        this.x = target.x;
        this.y = target.y;
      } else {
        const maxStep = 140 * Math.min(dt, 0.05);
        this.x += Math.max(-maxStep, Math.min(maxStep, dx));
        this.y += Math.max(-maxStep, Math.min(maxStep, dy));
      }
    }
    const facing = direction ? (direction as 1 | -1) : authoritative.facing;
    return {
      ...state,
      worms: state.worms.map((worm) => worm.id === active.id
        ? { ...worm, x: this.x, y: this.y, facing, aim: input.aim }
        : worm),
    };
  }
}
