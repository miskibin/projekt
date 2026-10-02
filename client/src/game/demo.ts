import { FIXED_DT, GRAVITY, MAX_SHOT_POWER, TEAM_NAMES, WORM_MUZZLE_OFFSET, WORM_MUZZLE_LIFT } from "@shared/constants";
import { createGame, type Game } from "@shared/engine";
import type { Terrain } from "@shared/engine/terrain";
import type { GameConfig, InputAction, InputState, PlayerInfo, RoomState, WeaponId, WormSnapshot } from "@shared/protocol";
import { simulateTrajectory } from "./trajectory";
import { soloStageInfo, soloLoadout, type SoloRun } from "./solo";

export type LocalMode = "twoPlayers" | "computer" | "gauntlet";

export const SOLO_OPPONENTS = ["Zwiadowca", "Piroman", "Snajper", "Saper", "Burza", "Weteran", "Boss"] as const;

/** Cele charakterystyczne dla poszczególnych przeciwników, bez tajnej wiedzy o ruchu gracza. */
export function selectComputerTarget(self: WormSnapshot, enemies: WormSnapshot[], allies: WormSnapshot[], stage: number): WormSnapshot {
  const role = (Math.max(1, stage) - 1) % SOLO_OPPONENTS.length;
  return enemies.reduce((best, candidate) => {
    const score = (target: WormSnapshot): number => {
      const distance = Math.hypot(target.x - self.x, target.y - self.y);
      if (role === 2) return Math.abs(target.x - self.x) * 0.12 + nearby(target, enemies, 110) * 45 + distance * 0.28;
      if (role === 3 || role === 4) return distance * 0.55 - nearby(target, enemies, 105) * 105;
      if (role >= 5) return distance * 0.65 + target.hp * 3 - nearby(target, allies, 95) * 120;
      return distance;
    };
    return score(candidate) < score(best) ? candidate : best;
  });
}

function nearby(worm: WormSnapshot, others: WormSnapshot[], radius: number): number {
  return others.filter((other) => other.id !== worm.id && Math.hypot(other.x - worm.x, other.y - worm.y) < radius).length;
}

/** Selekcja broni korzysta z amunicji dostępnej w konkretnej rozgrywce. */
export function chooseComputerWeapon(stage: number, round: number, distance: number, miss: number,
  ammo: Partial<Record<WeaponId, number>>, enemyCluster = 0, allyClose = false): WeaponId {
  const role = (Math.max(1, stage) - 1) % SOLO_OPPONENTS.length;
  const available = (id: WeaponId) => ammo[id] !== undefined && ammo[id] !== 0;
  if (role === 0) return distance < 62 && available("axe") ? "axe" :
    distance < 130 && available("shotgun") ? "shotgun" : "bazooka";
  if (role === 1) {
    if (distance > 110 && distance < 350 && available("banana") && round % 3 === 0) return "banana";
    if (distance > 100 && distance < 350 && available("sticky") && round % 3 === 2) return "sticky";
    return "grenade";
  }
  if (role === 2) {
    if (distance > 200 && miss < 40 && !allyClose && available("railgun")) return "railgun";
    if (miss > 65 && distance > 210 && available("homing")) return "homing";
    return distance < 170 && available("shotgun") ? "shotgun" : "bazooka";
  }
  if (role === 3) {
    if (distance < 140 && !allyClose && available("repulsor") && round > 2) return "repulsor";
    if (distance > 90 && distance < 160 && round < 3 && available("spring")) return "spring";
    if (distance < 90 && !allyClose && available("mine")) return "mine";
    if (enemyCluster && available("cluster") && distance > 100) return "cluster";
    return "grenade";
  }
  if (role === 4) {
    if (enemyCluster && !allyClose && available("airstrike") && round % 2 === 0) return "airstrike";
    if (distance < 210 && available("uzi")) return "uzi";
    if (distance > 250 && !allyClose && available("mortar")) return "mortar";
    return "bazooka";
  }
  if (role === 5) {
    if (distance > 200 && miss < 40 && !allyClose && available("railgun")) return "railgun";
    if (distance < 85 && !allyClose && available("bat")) return "bat";
    if (miss > 70 && available("homing")) return "homing";
    return distance < 200 ? "shotgun" : "bazooka";
  }
  if (enemyCluster && !allyClose && available("airstrike") && round % 3 === 0) return "airstrike";
  if (enemyCluster && available("cluster")) return "cluster";
  if (miss > 75 && available("homing")) return "homing";
  return distance < 190 ? "shotgun" : "bazooka";
}

interface ShotPlan { aim: number; power: number; missDistance: number }

/** Lokalny mecz dwóch drużyn: jedna klawiatura steruje drużyną z aktywną turą. */
export class DemoDriver {
  private readonly game: Game;
  private readonly terrain: Terrain;
  private botTurn = "";
  private botTime = 0;
  private botShot = false;
  private botPlan: ShotPlan | null = null;
  private botSearch: ComputerShotSearch | null = null;
  private botWeapon: WeaponId | null = null;
  private defenseDelay = 0;

  constructor(config: GameConfig, readonly mode: LocalMode = "twoPlayers", readonly stage = 0, perks: SoloRun["perks"] = {}) {
    this.game = createGame(config, [
      { team: 0, playerId: "demo-0", name: mode === "twoPlayers" ? "Gracz 1" : "Ty",
        loadout: mode === "gauntlet" ? soloLoadout(perks) : undefined },
      { team: 1, playerId: "demo-1", name: mode === "twoPlayers" ? "Gracz 2" :
        mode === "computer" ? "Komputer" : soloStageInfo(stage).name,
        loadout: mode === "gauntlet" ? { hpBonus: Math.min(48, Math.floor((stage-1)/7)*8 + (stage%7===0 ? 16 : 0)) } : undefined },
    ]);
    this.terrain = (this.game as Game & { readonly terrain: Terrain }).terrain;
  }

  get snapshot() { return this.game.snapshot(); }
  get isOver() { return this.game.isOver(); }
  get winner() { return this.game.winner(); }
  get computerTurn() { return this.mode !== "twoPlayers" && this.snapshot.turn.activeTeam === 1; }
  get controlledTeam() { return this.mode === "twoPlayers" ? this.snapshot.turn.activeTeam : 0; }

  terrainSync() { return this.game.terrainSync(); }

  applyInput(state: InputState): void {
    if (this.computerTurn) return;
    this.game.applyInput(this.snapshot.turn.activeTeam, state);
  }

  applyAction(action: InputAction): void {
    if (action.kind === "defend" && this.computerTurn) {
      this.game.applyAction(0, action);
      return;
    }
    if (this.computerTurn) return;
    this.game.applyAction(this.snapshot.turn.activeTeam, action);
  }

  update() {
    this.game.step(FIXED_DT);
    if (this.mode !== "twoPlayers") {
      this.updateComputer(FIXED_DT);
      this.updateComputerDefense(FIXED_DT);
    }
    return { snapshot: this.snapshot, events: this.game.drainEvents() };
  }

  private updateComputerDefense(dt: number): void {
    const state = this.snapshot;
    if (state.turn.activeTeam !== 0 || !state.turn.defenseReady?.includes(1)) {
      this.defenseDelay = 0;
      return;
    }
    this.defenseDelay += dt;
    const worms = state.worms.filter((w) => w.team === 1 && w.alive);
    if (!worms.length || !state.projectiles.length) return;
    const danger = worms.flatMap((w) => state.projectiles.map((p) => ({
      worm: w, distance: Math.hypot(w.x - p.x, w.y - p.y),
    }))).sort((a, b) => a.distance - b.distance)[0];
    if (!danger || danger.distance > Math.min(170, 105 + this.stage * 8) ||
      this.defenseDelay < Math.max(0.22, 0.56 - this.stage * 0.035)) return;
    const projectile = state.projectiles.reduce((best, item) =>
      Math.hypot(item.x - danger.worm.x, item.y - danger.worm.y) <
      Math.hypot(best.x - danger.worm.x, best.y - danger.worm.y) ? item : best);
    const direction = danger.worm.x >= projectile.x ? 1 : -1;
    this.game.applyAction(1, { kind: "defend", style: danger.distance < 85 && danger.worm.onGround ? "jump" : "step",
      direction, wormId: danger.worm.id });
  }

  private updateComputer(dt: number): void {
    const state = this.snapshot;
    const turn = state.turn;
    if (turn.activeTeam !== 1 || turn.phase !== "active") {
      this.botTurn = "";
      this.botTime = 0;
      this.botPlan = null;
      this.botSearch = null;
      this.botWeapon = null;
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
      this.botSearch = null;
      this.botWeapon = null;
    }
    this.botTime += dt;
    const allies = state.worms.filter((item) => item.team === 1 && item.alive);
    const target = this.mode === "gauntlet" ? selectComputerTarget(worm, enemies, allies, this.stage) :
      enemies.reduce((best, item) => Math.abs(item.x - worm.x) < Math.abs(best.x - worm.x) ? item : best);
    const faceRight = target.x >= worm.x;
    if (this.botTime < 0.45) {
      const role = (Math.max(1, this.stage) - 1) % SOLO_OPPONENTS.length;
      const distance = Math.abs(target.x - worm.x);
      const retreat = this.mode === "gauntlet" && role === 2 && distance < 190;
      const advance = distance > (role === 3 ? 160 : 250);
      const direction = retreat ? (faceRight ? -1 : 1) : advance ? (faceRight ? 1 : -1) : 0;
      const nextX = worm.x + direction * 24;
      const walkable = nextX > 32 && nextX < this.terrain.width - 32 &&
        Math.abs(this.terrain.surfaceY(nextX) - this.terrain.surfaceY(worm.x)) < 27;
      this.game.applyInput(1, { left: direction < 0 && walkable, right: direction > 0 && walkable,
        aim: worm.aim, charge: false });
      return;
    }
    // Turn toward the target for one simulation tick, even when movement is blocked.
    if (worm.facing !== (faceRight ? 1 : -1)) {
      this.game.applyInput(1, { left: !faceRight, right: faceRight, aim: worm.aim, charge: false });
      return;
    }
    if (!this.botPlan) {
      this.botSearch ??= new ComputerShotSearch(
        worm.x, worm.y, target.x, target.y, faceRight ? 1 : -1, turn.wind, turn.round, worm.id,
        (px, py) => py >= 0 && this.terrain.isSolid(px, py),
      );
      // Przeszukuj trajektorie po kawałku: pojedyncza długa kalkulacja na głównym
      // wątku potrafiła zatrzymać animację na telefonie podczas tury komputera.
      if (!this.botSearch.step(36)) return;
      this.botPlan = this.botSearch.result(this.mode === "gauntlet" ? Math.max(0.4, 1.9 - this.stage * 0.13) : 1);
      this.botSearch = null;
    }
    const ammo = state.teams.find((team) => team.team === 1)?.ammo;
    const close = Math.hypot(target.x - worm.x, target.y - worm.y);
    const cluster = nearby(target, enemies, 105);
    const allyClose = allies.some((ally) => ally.id !== worm.id && Math.hypot(target.x - ally.x, target.y - ally.y) < 115);
    if (!this.botWeapon) {
      this.botWeapon = this.mode === "gauntlet" ? chooseComputerWeapon(this.stage, turn.round, close,
        this.botPlan.missDistance, ammo ?? {}, cluster, allyClose) :
        this.botPlan.missDistance > 80 && ammo?.homing ? "homing" : "bazooka";
      if (["grenade","banana","cluster","sticky"].includes(this.botWeapon)) {
        this.botSearch = new ComputerShotSearch(worm.x,worm.y,target.x,target.y,faceRight?1:-1,
          turn.wind,turn.round,worm.id,(px,py)=>py>=0 && this.terrain.isSolid(px,py),this.botWeapon);
        this.botPlan = null;
        return;
      }
    }
    const weapon = this.botWeapon;
    const directAim = Math.atan2(target.y - (worm.y - WORM_MUZZLE_LIFT), Math.abs(target.x-worm.x));
    const aim = ["railgun","shotgun","uzi","bat","axe"].includes(weapon) ? directAim : this.botPlan.aim;
    this.game.applyInput(1, { left: false, right: false, aim, charge: false });
    if (this.botTime >= 1.15 && !this.botShot) {
      this.botShot = true;
      this.game.applyAction(1, { kind: "selectWeapon", weapon });
      if (weapon === "airstrike" || weapon === "homing")
        this.game.applyAction(1, { kind: "target", x: target.x, y: target.y });
      if (weapon === "banana" || weapon === "cluster" || weapon === "grenade" || weapon === "sticky")
        this.game.applyAction(1, { kind: "setTimer", seconds: close < 210 ? 2 : 3 });
      if (weapon !== "airstrike") {
        this.game.applyAction(1, { kind: "fire", power: weapon === "homing" ?
          Math.max(0.6, this.botPlan.power) : this.botPlan.power });
        if (weapon === "shotgun") this.game.applyAction(1, { kind: "fire", power: 1 });
      }
    }
  }
}

/** Deterministyczny, lekko niedokładny strzał AI. Teren może go zatrzymać, więc bot nie jest aimbotem. */
export function chooseComputerShot(
  x: number, y: number, targetX: number, targetY: number, facing: 1 | -1,
  wind: number, round: number, wormId: number, isSolid?: (x: number, y: number) => boolean,
): ShotPlan {
  const search = new ComputerShotSearch(x, y, targetX, targetY, facing, wind, round, wormId, isSolid);
  search.step(37 * 16);
  return search.result();
}

/** Identyczne decyzje AI niezależnie od liczby klatek poświęconych na szukanie strzału. */
export class ComputerShotSearch {
  private index = 0;
  private best: ShotPlan = { aim: -0.75, power: 0.65, missDistance: Number.POSITIVE_INFINITY };
  private bestDistance = Number.POSITIVE_INFINITY;

  constructor(
    private x: number, private y: number, private targetX: number, private targetY: number,
    private facing: 1 | -1, private wind: number, private round: number, private wormId: number,
    private isSolid?: (x: number, y: number) => boolean,
    private weapon: WeaponId = "bazooka",
  ) {}

  step(budget: number): boolean {
    const end = Math.min(37 * 16, this.index + Math.max(1, budget));
    for (; this.index < end; this.index++) {
      const ai = Math.floor(this.index / 16);
      const pi = this.index % 16;
      const aim = -1.45 + ai * 0.05;
      const power = 0.25 + pi * 0.05;
      const { x, y, targetX, targetY, facing, wind, isSolid } = this;
      const dirX = Math.cos(aim) * facing;
      const dirY = Math.sin(aim);
      const speedScale = this.weapon === "grenade" ? 0.78 : this.weapon === "cluster" ? 0.94 :
        this.weapon === "banana" ? 1.08 : this.weapon === "sticky" ? 0.85 : 1;
      const gravityScale = this.weapon === "grenade" ? 1.2 : this.weapon === "cluster" ? 0.98 :
        this.weapon === "banana" ? 0.78 : 1;
      const speed = power * MAX_SHOT_POWER * speedScale;
      const trajectory = simulateTrajectory({
        x: x + dirX * WORM_MUZZLE_OFFSET, y: y - WORM_MUZZLE_LIFT + dirY * WORM_MUZZLE_OFFSET,
        vx: dirX * speed, vy: dirY * speed,
        wind: this.weapon === "bazooka" ? wind : 0, gravity: GRAVITY * gravityScale,
        isSolid, maxTime: 4.5, maxPoints: 280,
      });
      for (let i = 6; i < trajectory.points.length; i += 2) {
        const distance = Math.hypot(trajectory.points[i] - targetX, trajectory.points[i + 1] - targetY);
        if (distance < this.bestDistance) {
          this.bestDistance = distance;
          this.best = { aim, power, missDistance: distance };
        }
      }
    }
    return this.index === 37 * 16;
  }

  result(noiseScale = 1): ShotPlan {
    const noise = pseudoRandom(this.round * 97 + this.wormId * 17) - 0.5;
    return {
      aim: clamp(this.best.aim + noise * 0.09 * noiseScale, -Math.PI / 2, Math.PI / 2),
      power: clamp(this.best.power - noise * 0.08 * noiseScale, 0.2, 1),
      missDistance: this.best.missDistance,
    };
  }
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
