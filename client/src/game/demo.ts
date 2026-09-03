import { FIXED_DT, MAX_SHOT_POWER, TEAM_NAMES, WORM_RADIUS } from "@shared/constants";
import { createGame, type Game } from "@shared/engine";
import type { Terrain } from "@shared/engine/terrain";
import type { GameConfig, InputAction, InputState, PlayerInfo, RoomState } from "@shared/protocol";
import { simulateTrajectory } from "./trajectory";

export type LocalMode = "twoPlayers" | "computer";

interface ShotPlan { aim: number; power: number; missDistance: number }

/** Lokalny mecz dwóch drużyn: jedna klawiatura steruje drużyną z aktywną turą. */
export class DemoDriver {
  private readonly game: Game;
  private readonly terrain: Terrain;
  private botTurn = "";
  private botTime = 0;
  private botShot = false;
  private botPlan: ShotPlan | null = null;

  constructor(config: GameConfig, readonly mode: LocalMode = "twoPlayers") {
    this.game = createGame(config, [
      { team: 0, playerId: "demo-0", name: mode === "computer" ? "Ty" : "Gracz 1" },
      { team: 1, playerId: "demo-1", name: mode === "computer" ? "Komputer" : "Gracz 2" },
    ]);
    this.terrain = (this.game as Game & { readonly terrain: Terrain }).terrain;
  }

  get snapshot() { return this.game.snapshot(); }
  get isOver() { return this.game.isOver(); }
  get winner() { return this.game.winner(); }
  get computerTurn() { return this.mode === "computer" && this.snapshot.turn.activeTeam === 1; }
  get controlledTeam() { return this.mode === "computer" ? 0 : this.snapshot.turn.activeTeam; }

  terrainSync() { return this.game.terrainSync(); }

  applyInput(state: InputState): void {
    if (this.computerTurn) return;
    this.game.applyInput(this.snapshot.turn.activeTeam, state);
  }

  applyAction(action: InputAction): void {
    if (this.computerTurn) return;
    this.game.applyAction(this.snapshot.turn.activeTeam, action);
  }

  update() {
    this.game.step(FIXED_DT);
    if (this.mode === "computer") this.updateComputer(FIXED_DT);
    return { snapshot: this.snapshot, events: this.game.drainEvents() };
  }

  private updateComputer(dt: number): void {
    const state = this.snapshot;
    const turn = state.turn;
    if (turn.activeTeam !== 1 || turn.phase !== "active") {
      this.botTurn = "";
      this.botTime = 0;
      this.botPlan = null;
      return;
    }
    const worm = state.worms.find((item) => item.id === turn.activeWormId && item.alive);
    const enemies = state.worms.filter((item) => item.team === 0 && item.alive);
    if (!worm || enemies.length === 0) return;
    const key = `${turn.round}:${worm.id}`;
    if (this.botTurn !== key) {
      this.botTurn = key;
      this.botTime = 0;
      this.botShot = false;
      this.botPlan = null;
    }
    this.botTime += dt;
    const target = enemies.reduce((best, item) =>
      Math.abs(item.x - worm.x) < Math.abs(best.x - worm.x) ? item : best,
    );
    const faceRight = target.x >= worm.x;
    if (this.botTime < 0.45) {
      this.game.applyInput(1, { left: !faceRight, right: faceRight, aim: worm.aim, charge: false });
      return;
    }
    if (!this.botPlan) {
      this.botPlan = chooseComputerShot(
        worm.x, worm.y, target.x, target.y, faceRight ? 1 : -1, turn.wind, turn.round, worm.id,
        (px, py) => py >= 0 && this.terrain.isSolid(px, py),
      );
    }
    this.game.applyInput(1, { left: false, right: false, aim: this.botPlan.aim, charge: false });
    if (this.botTime >= 1.15 && !this.botShot) {
      this.botShot = true;
      const ammo = state.teams.find((team) => team.team === 1)?.ammo;
      if (this.botPlan.missDistance > 80 && ammo?.airstrike !== 0) {
        this.game.applyAction(1, { kind: "selectWeapon", weapon: "airstrike" });
        this.game.applyAction(1, { kind: "target", x: target.x, y: target.y });
      } else if (this.botPlan.missDistance > 80 && ammo?.homing !== 0) {
        this.game.applyAction(1, { kind: "selectWeapon", weapon: "homing" });
        this.game.applyAction(1, { kind: "target", x: target.x, y: target.y });
        this.game.applyAction(1, { kind: "fire", power: Math.max(0.6, this.botPlan.power) });
      } else {
        this.game.applyAction(1, { kind: "selectWeapon", weapon: "bazooka" });
        this.game.applyAction(1, { kind: "fire", power: this.botPlan.power });
      }
    }
  }
}

/** Deterministyczny, lekko niedokładny strzał AI. Teren może go zatrzymać, więc bot nie jest aimbotem. */
export function chooseComputerShot(
  x: number, y: number, targetX: number, targetY: number, facing: 1 | -1,
  wind: number, round: number, wormId: number, isSolid?: (x: number, y: number) => boolean,
): ShotPlan {
  let best: ShotPlan = { aim: -0.75, power: 0.65, missDistance: Number.POSITIVE_INFINITY };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let ai = 0; ai <= 36; ai++) {
    const aim = -1.45 + ai * 0.05;
    for (let pi = 0; pi <= 15; pi++) {
      const power = 0.25 + pi * 0.05;
      const dirX = Math.cos(aim) * facing;
      const dirY = Math.sin(aim);
      const speed = power * MAX_SHOT_POWER;
      const trajectory = simulateTrajectory({
        x: x + dirX * (WORM_RADIUS + 3), y: y + dirY * (WORM_RADIUS + 3),
        vx: dirX * speed, vy: dirY * speed, wind, isSolid, maxTime: 4.5, maxPoints: 280,
      });
      for (let i = 6; i < trajectory.points.length; i += 2) {
        const distance = Math.hypot(trajectory.points[i] - targetX, trajectory.points[i + 1] - targetY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { aim, power, missDistance: distance };
        }
      }
    }
  }
  const noise = pseudoRandom(round * 97 + wormId * 17) - 0.5;
  return {
    aim: clamp(best.aim + noise * 0.09, -Math.PI / 2, Math.PI / 2),
    power: clamp(best.power - noise * 0.08, 0.2, 1),
    missDistance: best.missDistance,
  };
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Fałszywy stan pokoju do podglądu lobby (`?demoLobby=1`). */
export function demoRoom(): { room: RoomState; playerId: string } {
  const players: PlayerInfo[] = [
    { id: "p1", name: "Michał", team: 0, ready: true, isHost: true, connected: true },
    { id: "p2", name: "Kasia", team: 1, ready: false, isHost: false, connected: true },
    { id: "p3", name: "Bartek", team: 2, ready: true, isHost: false, connected: true },
    { id: "p4", name: "Ola", team: 3, ready: false, isHost: false, connected: false },
  ];
  return {
    playerId: "p1",
    room: {
      code: "ZXQP",
      players,
      config: {
        wormsPerTeam: 4,
        turnTime: 45,
        suddenDeathAfterRounds: 10,
        seed: 987654,
        terrainDensity: 1,
        theme: "grass",
      },
      phase: "lobby",
    },
  };
}

export { TEAM_NAMES };
