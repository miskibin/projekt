import { WORM_MAX_STEP_UP, WORM_RADIUS, WORM_WALK_SPEED } from "@shared/constants";
import { walkStep } from "@shared/engine/physics";
import type { Terrain } from "@shared/engine/terrain";
import type { GameSnapshot, InputState } from "@shared/protocol";
import type { RenderState } from "./state";

/** Tylko pozycja własnej postaci. Obrażenia, pociski i tury zawsze pochodzą od hosta. */
export class LocalPrediction {
  private latest: GameSnapshot | null = null;
  private receivedAt = 0;
  private id = -1;
  private x = 0;
  private y = 0;

  onSnapshot(snapshot: GameSnapshot, now = performance.now()): void {
    if (this.latest && snapshot.tick <= this.latest.tick) return;
    this.latest = snapshot;
    this.receivedAt = now;
  }

  reset(): void {
    this.latest = null;
    this.receivedAt = 0;
    this.id = -1;
  }

  get ageMs(): number {
    return this.latest ? Math.max(0, performance.now() - this.receivedAt) : Infinity;
  }

  apply(state: RenderState, terrain: Terrain, input: InputState, team: number,
    dt: number, now = performance.now()): RenderState {
    if (state.turn.activeTeam !== team || (state.turn.phase !== "active" && state.turn.phase !== "retreat")) {
      this.id = -1;
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

    const age = Math.max(0, (now - this.receivedAt) / 1000);
    const direction = Number(input.right) - Number(input.left);
    // Najwyżej 700 ms predykcji: dalszy ruch bez serwera wyglądałby jak prawdziwa gra.
    if (direction && age < 0.7 && authoritative.onGround && authoritative.anim !== "jetpack") {
      const pos = { x: this.x, y: this.y };
      walkStep(terrain, pos, WORM_RADIUS, direction * WORM_WALK_SPEED * Math.min(dt, 0.05), WORM_MAX_STEP_UP, 8);
      this.x = pos.x;
      this.y = pos.y;
    }

    if (age < 0.35) {
      // Host koryguje model; uwzględniamy krótki czas transportu bieżącego wejścia.
      const expectedX = authoritative.x + (authoritative.onGround ? direction * WORM_WALK_SPEED * Math.min(age + 0.07, 0.2) : 0);
      const dx = expectedX - this.x;
      const dy = authoritative.y - this.y;
      if (Math.abs(dx) > 96 || Math.abs(dy) > 40) {
        this.x = authoritative.x;
        this.y = authoritative.y;
      } else {
        const blend = 1 - Math.exp(-Math.min(dt, 0.05) * (direction ? 5 : 12));
        this.x += dx * blend;
        this.y += dy * blend;
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
