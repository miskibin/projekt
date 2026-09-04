// Deterministyczny silnik gry: tury, fizyka robaków, bronie, skrzynki, woda.
// Zero DOM, zero Node API, zero Math.random – wyłącznie Rng.
import {
  CHARGE_TIME,
  CRATE_DROP_CHANCE,
  FALL_DAMAGE_FACTOR,
  FALL_DAMAGE_MIN_SPEED,
  GRAVITY,
  MAX_SHOT_POWER,
  MAX_WIND,
  RETREAT_TIME,
  ROUND_END_DELAY,
  TEAM_NAMES,
  WATER_LEVEL_START,
  WATER_RISE_PER_ROUND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  WORM_BACKFLIP_VY,
  WORM_JUMP_VX,
  WORM_JUMP_VY,
  WORM_MAX_HP,
  WORM_MAX_STEP_UP,
  WORM_RADIUS,
  WORM_WALK_SPEED,
} from "../constants";
import type {
  CrateSnapshot,
  GameConfig,
  GameEvent,
  GameSnapshot,
  ExplosionStyle,
  InputAction,
  InputState,
  MineSnapshot,
  ProjectileSnapshot,
  TeamSnapshot,
  TerrainSync,
  TurnInfo,
  TurnPhase,
  WeaponId,
  WormSnapshot,
} from "../protocol";
import type { Game, TeamSetup } from "./index";
import { Rng } from "./rng";
import { Terrain, generateTerrain } from "./terrain";
import { circleHits, clamp, groundBelow, pushOut, reflect, terrainNormal, walkStep } from "./physics";
import { WEAPONS, startingAmmo, type WeaponDef } from "./weapons";
import { makeProjectile, detonateProjectile, stepProjectiles } from "./projectiles";
import { placeMine, spawnCrate, spawnInitialMines, stepCrates, stepMines, MINE_RADIUS } from "./crates";
import { WORM_NAMES } from "./names";
import type { Crate, DeathReason, EngineCtx, Mine, Projectile, TeamState, Worm } from "./types";

const STARTING_TIME = 0.75;
const SETTLE_TIMEOUT = 7;
const WATER_RISE_TIME = 1.2;

const WORM_RESTITUTION = 0.3;
const WORM_BOUNCE_FRICTION = 0.55;
const WORM_REST_SPEED = 55;
const WORM_STEP_DOWN = 8;

const JET_FUEL = 8;
const JET_UP = 1600;
const JET_SIDE = 700;
const JET_MAX = 230;

const BAT_RANGE = 25 + WORM_RADIUS;
const HITSCAN_RANGE = 800;

const NEUTRAL_INPUT: InputState = { left: false, right: false, aim: 0, charge: false };

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function teamLabel(team: number): string {
  const names = TEAM_NAMES as readonly string[];
  return names[team] ?? `Drużyna ${team}`;
}

interface Burst {
  wormId: number;
  remaining: number;
  timer: number;
  interval: number;
}

export class GameImpl implements Game, EngineCtx {
  readonly config: GameConfig;
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly worms: Worm[] = [];
  readonly projectiles: Projectile[] = [];
  readonly crates: Crate[] = [];
  readonly mines: Mine[] = [];
  readonly teams: TeamState[] = [];

  wind = 0;
  waterLevel = WATER_LEVEL_START;

  private events: GameEvent[] = [];
  private idCounter = 1;
  private tick = 0;
  private time = 0;

  private phase: TurnPhase = "starting";
  private phaseTimer = STARTING_TIME;
  private settleGuard = 0;
  private roundsCompleted = 0;
  private suddenDeath = false;
  private waterTarget = WATER_LEVEL_START;
  private pendingTeam: number | null = null;

  private teamOrder: number[] = [];
  private turnCursor = -1;
  private wrapped = false;
  private wormPointer: Record<number, number> = {};

  private activeTeam = -1;
  private activeWormId = -1;
  private input: InputState = { ...NEUTRAL_INPUT };
  private charging = false;
  private chargePower = 0;
  private shotsLeft = 1;
  private firedThisTurn = 0;
  private girderAngle = 0;
  private target: { x: number; y: number } | undefined;
  private burst: Burst | null = null;

  private explosionQueue: { x: number; y: number; r: number; dmg: number; power: number; style?: ExplosionStyle }[] = [];
  private processingExplosions = false;

  private winnerTeam: number | null = null;
  private finished = false;

  constructor(config: GameConfig, setups: TeamSetup[]) {
    this.config = { ...config };
    this.terrain = generateTerrain(config.seed, WORLD_WIDTH, WORLD_HEIGHT, config.terrainDensity);
    this.rng = new Rng((Math.imul(config.seed >>> 0, 747796405) + 2891336453) >>> 0);

    for (const s of setups) {
      this.teams.push({
        team: s.team,
        playerId: s.playerId,
        name: s.name,
        ammo: startingAmmo(),
        removed: false,
        selectedWeapon: "bazooka",
        weaponTimer: 3,
      });
      this.wormPointer[s.team] = -1;
    }
    this.teamOrder = this.teams.map((t) => t.team).sort((a, b) => a - b);

    // Imiona: losowa permutacja listy (bez powtórzeń dopóki starczy imion).
    const pool = [...WORM_NAMES];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    let nameIdx = 0;
    const perTeam = Math.max(1, Math.floor(this.config.wormsPerTeam));
    for (let i = 0; i < perTeam; i++) {
      for (const ts of this.teams) {
        this.spawnWorm(ts.team, pool[nameIdx % pool.length]);
        nameIdx++;
      }
    }

    spawnInitialMines(this);
    this.beginNextTurn();
  }

  // ---------------------------------------------------------------- EngineCtx

  nextId(): number {
    return this.idCounter++;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  // ---------------------------------------------------------------- setup

  private spawnWorm(team: number, name: string): Worm {
    let px = -1;
    let py = -1;
    const dists = [160, 120, 90, 60, 35, 0];
    for (const minDist of dists) {
      for (let attempt = 0; attempt < 300; attempt++) {
        const x = this.rng.int(30, WORLD_WIDTH - 30);
        const surf = this.terrain.surfaceY(x);
        if (surf >= WORLD_HEIGHT) continue;
        if (surf >= this.waterLevel - WORM_RADIUS - 6) continue; // ląd pod wodą
        const y = surf - WORM_RADIUS - 1;
        if (y < 12) continue;
        if (circleHits(this.terrain, x, y, WORM_RADIUS)) continue;
        if (!groundBelow(this.terrain, x, y, WORM_RADIUS, 3)) continue;
        let ok = true;
        for (const o of this.worms) {
          if (Math.hypot(o.x - x, o.y - y) < minDist) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        px = x;
        py = y;
        break;
      }
      if (px >= 0) break;
    }
    if (px < 0) {
      // awaryjnie: gdziekolwiek na powierzchni
      px = this.rng.int(30, WORLD_WIDTH - 30);
      py = Math.max(12, Math.min(this.waterLevel - WORM_RADIUS - 2, this.terrain.surfaceY(px) - WORM_RADIUS - 1));
    }
    const worm: Worm = {
      id: this.nextId(),
      team,
      name,
      x: px,
      y: py,
      vx: 0,
      vy: 0,
      hp: WORM_MAX_HP,
      alive: true,
      facing: this.rng.chance(0.5) ? 1 : -1,
      aim: 0,
      onGround: groundBelow(this.terrain, px, py, WORM_RADIUS, 3),
      animTimer: 0,
      jetpackActive: false,
      jetpackFuel: 0,
      jetThrust: 0,
    };
    this.worms.push(worm);
    return worm;
  }

  // ---------------------------------------------------------------- pętla

  step(dt: number): void {
    this.tick++;
    this.time += dt;
    if (this.phase === "gameOver") return;

    this.applyControl(dt);
    this.updateBurst(dt);
    for (const w of this.worms) this.updateWorm(w, dt);
    stepProjectiles(this, dt);
    stepMines(this, dt);
    stepCrates(this, dt);
    this.updateTurnPhase(dt);
    this.checkGameOver();
  }

  private teamState(team: number): TeamState | undefined {
    return this.teams.find((t) => t.team === team);
  }

  private activeWorm(): Worm | undefined {
    return this.worms.find((w) => w.id === this.activeWormId);
  }

  private teamAlive(team: number): boolean {
    const ts = this.teamState(team);
    if (!ts || ts.removed) return false;
    return this.worms.some((w) => w.team === team && w.alive);
  }

  // ---------------------------------------------------------------- sterowanie

  private applyControl(dt: number): void {
    if (this.phase !== "active" && this.phase !== "retreat") return;
    const w = this.activeWorm();
    if (!w || !w.alive) return;
    const inp = this.input;
    if (inp.left && !inp.right) w.facing = -1;
    else if (inp.right && !inp.left) w.facing = 1;

    if (!w.jetpackActive && (inp.left || inp.right) && w.onGround) {
      const dir = inp.left && !inp.right ? -1 : inp.right ? 1 : 0;
      if (dir !== 0) {
        const res = walkStep(
          this.terrain,
          w,
          WORM_RADIUS,
          dir * WORM_WALK_SPEED * dt,
          WORM_MAX_STEP_UP,
          WORM_STEP_DOWN,
        );
        if (res === "fell") w.onGround = false;
      }
    }

    const ts = this.teamState(this.activeTeam);
    if (this.phase === "active" && ts && WEAPONS[ts.selectedWeapon].charge && inp.charge && this.shotsLeft > 0) {
      this.charging = true;
      this.chargePower = Math.min(1, this.chargePower + dt / CHARGE_TIME);
    } else {
      this.charging = false;
    }
  }

  private updateWorm(w: Worm, dt: number): void {
    if (!w.alive) return;

    if (w.animTimer > 0) {
      w.animTimer -= dt;
      if (w.animTimer <= 0 && w.anim === "bat") w.anim = undefined;
    }

    const isActive =
      w.id === this.activeWormId && (this.phase === "active" || this.phase === "retreat");

    if (w.jetpackActive) {
      w.jetpackFuel -= dt;
      if (w.jetpackFuel <= 0) {
        this.deactivateJetpack(w);
      } else {
        w.anim = "jetpack";
        if (w.jetThrust > 0) w.jetThrust -= dt;
        const inp = isActive ? this.input : NEUTRAL_INPUT;
        if (inp.charge || w.jetThrust > 0) {
          w.vy -= JET_UP * dt;
          w.onGround = false;
        }
        if (inp.left && !inp.right) {
          w.vx -= JET_SIDE * dt;
          w.onGround = false;
        } else if (inp.right && !inp.left) {
          w.vx += JET_SIDE * dt;
          w.onGround = false;
        }
        w.vx = clamp(w.vx, -JET_MAX, JET_MAX);
        w.vy = clamp(w.vy, -JET_MAX, 420);
      }
    }

    if (w.onGround) {
      if (!groundBelow(this.terrain, w.x, w.y, WORM_RADIUS, 2)) {
        w.onGround = false;
      } else {
        w.vx = 0;
        w.vy = 0;
      }
    }

    if (!w.onGround) this.ballistic(w, dt);

    if (w.y > this.waterLevel) {
      this.killWorm(w, "drown");
      return;
    }
    if (w.y > WORLD_HEIGHT + 200) this.killWorm(w, "drown");
  }

  private ballistic(w: Worm, dt: number): void {
    w.vy += GRAVITY * dt;
    const speed = Math.hypot(w.vx, w.vy);
    const steps = Math.max(1, Math.min(24, Math.ceil((speed * dt) / 2)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      const nx = clamp(w.x + w.vx * sdt, WORM_RADIUS, WORLD_WIDTH - 1 - WORM_RADIUS);
      const ny = w.y + w.vy * sdt;
      if (ny > this.waterLevel) {
        w.x = nx;
        w.y = ny;
        return;
      }
      if (circleHits(this.terrain, nx, ny, WORM_RADIUS)) {
        const impact = Math.hypot(w.vx, w.vy);
        const n = terrainNormal(this.terrain, nx, ny, WORM_RADIUS);
        const bounced = reflect(w.vx, w.vy, n.x, n.y, WORM_RESTITUTION, WORM_BOUNCE_FRICTION);
        w.vx = bounced.vx;
        w.vy = bounced.vy;
        const pos = { x: w.x, y: w.y };
        pushOut(this.terrain, pos, WORM_RADIUS, 16);
        w.x = pos.x;
        w.y = pos.y;
        if (impact > FALL_DAMAGE_MIN_SPEED) {
          const dmg = (impact - FALL_DAMAGE_MIN_SPEED) * FALL_DAMAGE_FACTOR;
          this.damageWorm(w, dmg, "fall");
          if (!w.alive) return;
        }
        if (Math.hypot(w.vx, w.vy) < WORM_REST_SPEED) {
          w.vx = 0;
          w.vy = 0;
          w.onGround = true;
        }
        return;
      }
      w.x = nx;
      w.y = ny;
    }
  }

  private deactivateJetpack(w: Worm): void {
    w.jetpackActive = false;
    w.jetpackFuel = 0;
    w.jetThrust = 0;
    if (w.anim === "jetpack") w.anim = undefined;
  }

  // ---------------------------------------------------------------- obrażenia

  damageWorm(w: Worm, amount: number, reason: DeathReason): void {
    if (!w.alive) return;
    const amt = Math.max(0, Math.round(amount));
    if (amt <= 0) return;
    w.hp -= amt;
    this.emit({ t: "damage", wormId: w.id, amount: amt, x: Math.round(w.x), y: Math.round(w.y) });
    this.emit({ t: "sound", name: "hit", x: w.x, y: w.y });
    if (w.hp <= 0) this.killWorm(w, reason);
  }

  private killWorm(w: Worm, reason: DeathReason): void {
    if (!w.alive) return;
    w.alive = false;
    w.hp = 0;
    w.vx = 0;
    w.vy = 0;
    this.deactivateJetpack(w);
    this.emit({ t: "wormDied", wormId: w.id, reason });
    if (reason === "drown") {
      this.emit({ t: "sound", name: "splash", x: w.x, y: this.waterLevel });
      this.emit({ t: "message", text: `${w.name} utonął!` });
    } else if (reason === "fall") {
      this.emit({ t: "message", text: `${w.name} nie przeżył upadku!` });
    } else if (reason === "surrender") {
      this.emit({ t: "message", text: `${w.name} opuścił pole walki.` });
    } else {
      this.emit({ t: "message", text: `${w.name} zginął!` });
    }
  }

  explode(x: number, y: number, r: number, dmg: number, power: number, style?: ExplosionStyle): void {
    this.explosionQueue.push({ x, y, r, dmg, power, style });
    if (this.processingExplosions) return;
    this.processingExplosions = true;
    let guard = 0;
    while (this.explosionQueue.length > 0 && guard++ < 400) {
      const e = this.explosionQueue.shift();
      if (!e) break;
      this.doExplode(e.x, e.y, e.r, e.dmg, e.power, e.style);
    }
    this.explosionQueue.length = 0;
    this.processingExplosions = false;
  }

  private doExplode(x: number, y: number, r: number, dmg: number, power: number, style?: ExplosionStyle): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    const ri = Math.max(1, Math.round(r));
    this.terrain.carveCircle(xi, yi, ri);
    this.emit({ t: "explosion", x: xi, y: yi, r: ri, power: Math.round(power), style });
    this.emit({ t: "sound", name: "explosion", x: xi, y: yi });

    const reach = ri * 1.5;
    for (const w of this.worms) {
      if (!w.alive) continue;
      const dx = w.x - xi;
      const dy = w.y - yi;
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      const falloff = 1 - d / reach;
      const kp = power * falloff;
      let ux = 0;
      let uy = -1;
      if (d > 0.001) {
        ux = dx / d;
        uy = dy / d;
      }
      w.vx += ux * kp;
      w.vy += uy * kp - kp * 0.3;
      w.onGround = false;
      const amount = dmg * falloff;
      if (amount >= 0.5) this.damageWorm(w, amount, "explosion");
    }

    for (const c of this.crates) {
      if (c.amount === -1) continue;
      const d = Math.hypot(c.x - xi, c.y - yi);
      if (d > reach) continue;
      const wasWeapon = c.kind === "weapon";
      c.amount = -1;
      if (wasWeapon) this.explode(c.x, c.y, 25, 30, 240, "dynamite");
    }

    for (const m of this.mines) {
      if (m.dead) continue;
      const d = Math.hypot(m.x - xi, m.y - yi);
      if (d > reach) continue;
      m.dead = true;
      this.explode(m.x, m.y, WEAPONS.mine.radius, WEAPONS.mine.damage, WEAPONS.mine.power, "mine");
    }

    for (const p of this.projectiles) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - xi, p.y - yi);
      if (d > reach) continue;
      detonateProjectile(this, p);
    }
  }

  // ---------------------------------------------------------------- tury

  private pickNextTeam(): number | null {
    const order = this.teamOrder;
    if (order.length === 0) return null;
    for (let i = 0; i < order.length; i++) {
      this.turnCursor++;
      if (this.turnCursor >= order.length) {
        this.turnCursor = 0;
        this.wrapped = true;
      }
      const t = order[this.turnCursor];
      if (this.teamAlive(t)) return t;
    }
    return null;
  }

  private beginNextTurn(): void {
    if (this.checkGameOver()) return;
    const next = this.pickNextTeam();
    if (next === null) {
      this.finish(null);
      return;
    }
    if (this.wrapped) {
      this.wrapped = false;
      this.roundsCompleted++;
      if (this.roundsCompleted >= this.config.suddenDeathAfterRounds) {
        if (!this.suddenDeath) {
          this.suddenDeath = true;
          this.emit({ t: "suddenDeath" });
          this.emit({ t: "message", text: "Nagła śmierć! Woda się podnosi" });
          for (const w of this.worms) {
            if (w.alive && w.hp > 20) {
              const lost = w.hp - 20;
              w.hp = 20;
              this.emit({ t: "damage", wormId: w.id, amount: lost, x: Math.round(w.x), y: Math.round(w.y) });
            }
          }
        }
        this.waterTarget = this.waterLevel - WATER_RISE_PER_ROUND;
        this.pendingTeam = next;
        this.phase = "suddenDeathRise";
        this.phaseTimer = WATER_RISE_TIME;
        return;
      }
    }
    this.startTurn(next);
  }

  private startTurn(team: number): void {
    this.activeTeam = team;
    const ts = this.teamState(team);
    if (!ts) {
      this.finish(null);
      return;
    }
    const teamWorms = this.worms.filter((w) => w.team === team);
    let ptr = this.wormPointer[team] ?? -1;
    let found = false;
    for (let i = 1; i <= teamWorms.length; i++) {
      const j = (ptr + i) % teamWorms.length;
      if (teamWorms[j].alive) {
        ptr = j;
        found = true;
        break;
      }
    }
    if (!found) {
      // drużyna nie ma żywych robaków – spróbuj kolejnej
      this.beginNextTurn();
      return;
    }
    this.wormPointer[team] = ptr;
    const worm = teamWorms[ptr];
    this.activeWormId = worm.id;

    for (const w of this.worms) {
      this.deactivateJetpack(w);
      if (w.anim === "bat") w.anim = undefined;
    }

    this.charging = false;
    this.chargePower = 0;
    this.firedThisTurn = 0;
    this.target = undefined;
    this.girderAngle = 0;
    this.burst = null;
    this.input = { ...NEUTRAL_INPUT };
    if (ts.ammo[ts.selectedWeapon] === 0) ts.selectedWeapon = "bazooka";
    this.shotsLeft = WEAPONS[ts.selectedWeapon].shots;

    this.wind = this.rng.range(-MAX_WIND, MAX_WIND);
    this.phase = "starting";
    this.phaseTimer = STARTING_TIME;
    this.settleGuard = 0;

    this.emit({ t: "turnStart", team, wormId: worm.id, wind: this.wind });

    if (this.rng.chance(CRATE_DROP_CHANCE)) spawnCrate(this);
  }

  /** Koniec tury bez strzału (czas minął / skip / śmierć robaka). */
  private endTurn(): void {
    if (this.phase === "settling" || this.phase === "gameOver") return;
    this.charging = false;
    this.chargePower = 0;
    const w = this.activeWorm();
    if (w) this.deactivateJetpack(w);
    this.phase = "settling";
    this.phaseTimer = ROUND_END_DELAY;
    this.settleGuard = 0;
  }

  private goRetreat(seconds: number): void {
    this.charging = false;
    this.chargePower = 0;
    this.phase = "retreat";
    this.phaseTimer = seconds;
    this.settleGuard = 0;
  }

  private isCalm(): boolean {
    if (this.projectiles.length > 0) return false;
    if (this.burst) return false;
    if (this.explosionQueue.length > 0) return false;
    for (const m of this.mines) if (!m.onGround || m.fuse !== undefined) return false;
    for (const w of this.worms) {
      if (!w.alive) continue;
      if (!w.onGround) return false;
    }
    return true;
  }

  private updateTurnPhase(dt: number): void {
    switch (this.phase) {
      case "starting": {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = "active";
          this.phaseTimer = this.config.turnTime;
        }
        break;
      }
      case "active": {
        const w = this.activeWorm();
        if (!w || !w.alive) {
          this.endTurn();
          break;
        }
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phaseTimer = 0;
          this.emit({ t: "message", text: "Koniec czasu!" });
          this.endTurn();
        }
        break;
      }
      case "retreat": {
        const w = this.activeWorm();
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0 || !w || !w.alive) {
          this.phaseTimer = 0;
          this.endTurn();
        }
        break;
      }
      case "settling": {
        if (!this.isCalm()) {
          this.settleGuard += dt;
          this.phaseTimer = ROUND_END_DELAY;
          if (this.settleGuard > SETTLE_TIMEOUT) this.phaseTimer = 0;
        } else {
          this.phaseTimer -= dt;
        }
        if (this.phaseTimer <= 0) this.beginNextTurn();
        break;
      }
      case "suddenDeathRise": {
        this.waterLevel = Math.max(this.waterTarget, this.waterLevel - (WATER_RISE_PER_ROUND / WATER_RISE_TIME) * dt);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.waterLevel = this.waterTarget;
          const t = this.pendingTeam;
          this.pendingTeam = null;
          if (t !== null && this.teamAlive(t)) this.startTurn(t);
          else this.beginNextTurn();
        }
        break;
      }
      default:
        break;
    }
  }

  private checkGameOver(): boolean {
    if (this.finished) return true;
    const alive = this.teamOrder.filter((t) => this.teamAlive(t));
    if (alive.length <= 1) {
      this.finish(alive.length === 1 ? alive[0] : null);
      return true;
    }
    return false;
  }

  private finish(team: number | null): void {
    if (this.finished) return;
    this.finished = true;
    this.winnerTeam = team;
    this.phase = "gameOver";
    this.phaseTimer = 0;
    if (team === null) {
      this.emit({ t: "message", text: "Remis – nikt nie przeżył!" });
    } else {
      const ts = this.teamState(team);
      this.emit({ t: "message", text: `Koniec gry! Wygrywa ${ts ? ts.name : teamLabel(team)} (${teamLabel(team)})` });
    }
  }

  // ---------------------------------------------------------------- wejście

  applyInput(team: number, state: InputState): void {
    if (this.phase !== "active" && this.phase !== "retreat") return;
    if (team !== this.activeTeam) return;
    const aim = clamp(Number.isFinite(state.aim) ? state.aim : 0, -Math.PI / 2, Math.PI / 2);
    this.input = {
      left: !!state.left,
      right: !!state.right,
      aim,
      charge: !!state.charge,
    };
    const w = this.activeWorm();
    if (w && w.alive) w.aim = aim;
  }

  applyAction(team: number, action: InputAction): void {
    if (action.kind === "surrender") {
      this.removeTeam(team);
      return;
    }
    if (this.phase === "gameOver") return;
    if (team !== this.activeTeam) return;
    const ts = this.teamState(team);
    if (!ts) return;
    const w = this.activeWorm();
    const canMove = this.phase === "active" || this.phase === "retreat";

    switch (action.kind) {
      case "jump":
      case "backflip": {
        if (!canMove || !w || !w.alive) return;
        this.jump(w, action.kind === "backflip");
        return;
      }
      case "selectWeapon": {
        if (this.phase !== "active") return;
        const wid = action.weapon;
        if (!WEAPONS[wid]) return;
        if (ts.ammo[wid] === 0) return;
        ts.selectedWeapon = wid;
        const shots = WEAPONS[wid].shots;
        this.shotsLeft = this.firedThisTurn > 0 ? Math.min(this.shotsLeft, shots) : shots;
        this.chargePower = 0;
        this.charging = false;
        return;
      }
      case "setTimer": {
        ts.weaponTimer = action.seconds;
        return;
      }
      case "girderRotate": {
        this.girderAngle = (this.girderAngle + Math.PI / 4) % (Math.PI * 2);
        return;
      }
      case "target": {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return;
        this.target = { x: action.x, y: action.y };
        if (this.phase !== "active") return;
        const sel = ts.selectedWeapon;
        if (sel === "airstrike" || sel === "teleport" || sel === "girder") this.fire(1);
        return;
      }
      case "skipTurn": {
        if (this.phase !== "active") return;
        this.emit({ t: "message", text: `${w ? w.name : "Robak"} pasuje.` });
        this.endTurn();
        return;
      }
      case "fire": {
        if (this.phase !== "active") return;
        const p = Number.isFinite(action.power) && action.power > 0 ? action.power : this.chargePower || 1;
        this.fire(p);
        return;
      }
      default:
        return;
    }
  }

  private jump(w: Worm, back: boolean): void {
    if (w.jetpackActive) {
      w.jetThrust = 0.2;
      return;
    }
    if (!w.onGround) return;
    w.onGround = false;
    if (back) {
      w.vx = -w.facing * WORM_JUMP_VX * 0.55;
      w.vy = WORM_BACKFLIP_VY;
    } else {
      w.vx = w.facing * WORM_JUMP_VX;
      w.vy = WORM_JUMP_VY;
    }
    this.emit({ t: "sound", name: "jump", x: w.x, y: w.y });
  }

  // ---------------------------------------------------------------- strzelanie

  private consumeAmmo(ts: TeamState, id: WeaponId): void {
    if (ts.ammo[id] > 0) ts.ammo[id] -= 1;
  }

  private afterFire(def: WeaponDef): void {
    this.charging = false;
    this.chargePower = 0;
    this.firedThisTurn++;
    if (def.utility) return;
    this.shotsLeft -= 1;
    if (this.shotsLeft > 0) return;
    this.goRetreat(def.retreat > 0 ? def.retreat : RETREAT_TIME);
  }

  private fire(power: number): void {
    if (this.phase !== "active") return;
    const w = this.activeWorm();
    if (!w || !w.alive) return;
    const ts = this.teamState(this.activeTeam);
    if (!ts) return;
    const id = ts.selectedWeapon;
    const def = WEAPONS[id];
    if (!def) return;
    if (ts.ammo[id] === 0) return;
    if (!def.utility && this.shotsLeft <= 0) return;

    const p01 = clamp(power, 0.05, 1);
    const dirX = Math.cos(w.aim) * w.facing;
    const dirY = Math.sin(w.aim);
    const mx = w.x + dirX * (WORM_RADIUS + 3);
    const my = w.y + dirY * (WORM_RADIUS + 3);
    const speed = p01 * MAX_SHOT_POWER;

    if (id !== "jetpack" && w.jetpackActive) this.deactivateJetpack(w);

    switch (id) {
      case "bazooka": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: "bazooka",
          x: mx,
          y: my,
          vx: dirX * speed,
          vy: dirY * speed,
          radius: def.radius,
          damage: def.damage,
          power: def.power,
          windAffected: true,
          explodeOnContact: true,
          ownerWorm: w.id,
          ownerTeam: w.team,
        });
        break;
      }
      case "homing": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: "homing",
          x: mx,
          y: my,
          vx: dirX * speed * 0.74,
          vy: dirY * speed * 0.74,
          radius: def.radius,
          damage: def.damage,
          power: def.power,
          windAffected: true,
          explodeOnContact: true,
          homingTarget: this.target ? { x: this.target.x, y: this.target.y } : undefined,
          gravityScale: 0.55,
          homingDelay: 0.34,
          ownerWorm: w.id,
          ownerTeam: w.team,
        });
        break;
      }
      case "grenade":
      case "cluster":
      case "banana": {
        this.emitShot(id, w);
        const speedScale = id === "grenade" ? 0.78 : id === "cluster" ? 0.94 : 1.08;
        const gravityScale = id === "grenade" ? 1.2 : id === "cluster" ? 0.98 : 0.78;
        makeProjectile(this, {
          kind: id,
          x: mx,
          y: my,
          vx: dirX * speed * speedScale,
          vy: dirY * speed * speedScale,
          fuse: ts.weaponTimer,
          radius: def.radius,
          damage: def.damage,
          power: def.power,
          windAffected: false,
          gravityScale,
          explodeOnContact: false,
          collidesWorms: false,
          bounces: true,
          restitution: id === "grenade" ? 0.32 : id === "cluster" ? 0.52 : 0.72,
          shards: id === "cluster" ? 6 : id === "banana" ? 8 : 0,
          shardKind: id === "cluster" ? "clusterlet" : id === "banana" ? "bananalet" : undefined,
          ownerWorm: w.id,
          ownerTeam: w.team,
        });
        break;
      }
      case "holy": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: "holy",
          x: mx,
          y: my,
          vx: dirX * speed * 0.68,
          vy: dirY * speed * 0.68,
          fuse: 3,
          restFuse: 1,
          radius: def.radius,
          damage: def.damage,
          power: def.power,
          windAffected: false,
          gravityScale: 1.28,
          explodeOnContact: false,
          collidesWorms: false,
          bounces: true,
          restitution: 0.24,
          ownerWorm: w.id,
          ownerTeam: w.team,
        });
        break;
      }
      case "dynamite": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: "dynamite",
          x: w.x,
          y: w.y,
          vx: 0,
          vy: 0,
          fuse: 5,
          radius: def.radius,
          damage: def.damage,
          power: def.power,
          explodeOnContact: false,
          collidesWorms: false,
          bounces: true,
          restitution: 0.05,
          ownerWorm: w.id,
          ownerTeam: w.team,
        });
        break;
      }
      case "mine": {
        this.emitShot(id, w);
        placeMine(this, w.x, w.y + WORM_RADIUS - MINE_RADIUS);
        break;
      }
      case "shotgun": {
        this.emitShot(id, w);
        this.hitscan(w, dirX, dirY, def, "shotgun");
        break;
      }
      case "uzi": {
        this.burst = { wormId: w.id, remaining: 10, timer: 0, interval: 0.08 };
        break;
      }
      case "bat": {
        this.swingBat(w, dirX, dirY);
        break;
      }
      case "airstrike": {
        if (!this.target) return;
        this.emitShot(id, w);
        const tx = this.target.x;
        for (let i = 0; i < 6; i++) {
          const off = (i - 2.5) * 38 + this.rng.range(-7, 7);
          makeProjectile(this, {
            kind: "airstrikeBomb",
            x: clamp(tx + off, 4, WORLD_WIDTH - 4),
            y: -60 - i * 14,
            vx: w.facing * 60,
            vy: 140,
            radius: def.radius,
            damage: def.damage,
            power: def.power,
            explodeOnContact: true,
            ownerWorm: w.id,
            ownerTeam: w.team,
          });
        }
        break;
      }
      case "teleport": {
        if (!this.target) return;
        if (!this.doTeleport(w, this.target.x, this.target.y)) return;
        this.emitShot(id, w);
        break;
      }
      case "girder": {
        if (!this.target) return;
        const gx = Math.round(clamp(this.target.x, 0, WORLD_WIDTH - 1));
        const gy = Math.round(clamp(this.target.y, 0, WORLD_HEIGHT - 1));
        this.terrain.paintRotatedRect(gx, gy, 80, 10, this.girderAngle, 1);
        this.emit({ t: "carveRect", x: gx, y: gy, w: 80, h: 10, angle: this.girderAngle, add: true });
        this.emit({ t: "sound", name: "pickup", x: gx, y: gy });
        break;
      }
      case "jetpack": {
        w.jetpackActive = true;
        w.jetpackFuel = JET_FUEL;
        w.jetThrust = 0;
        w.anim = "jetpack";
        this.emit({ t: "sound", name: "jetpack", x: w.x, y: w.y });
        break;
      }
      case "skip": {
        this.consumeAmmo(ts, id);
        this.emit({ t: "message", text: `${w.name} pasuje.` });
        this.endTurn();
        return;
      }
      default:
        return;
    }

    this.consumeAmmo(ts, id);
    this.afterFire(def);
  }

  private emitShot(id: WeaponId, w: Worm): void {
    this.emit({ t: "shot", weapon: id, x: Math.round(w.x), y: Math.round(w.y) });
    this.emit({ t: "sound", name: "shot", x: w.x, y: w.y });
  }

  private hitscan(w: Worm, dirX: number, dirY: number, def: WeaponDef, style: "shotgun" | "uzi"): void {
    let px = w.x + dirX * (WORM_RADIUS + 2);
    let py = w.y + dirY * (WORM_RADIUS + 2);
    let target: Worm | null = null;
    let terrainHit = false;
    for (let d = 0; d < HITSCAN_RANGE; d++) {
      px += dirX;
      py += dirY;
      if (px < 0 || px >= WORLD_WIDTH) break;
      if (py > this.waterLevel) {
        this.emit({ t: "sound", name: "splash", x: px, y: this.waterLevel });
        return;
      }
      if (py >= 0 && this.terrain.isSolid(px, py)) {
        terrainHit = true;
        break;
      }
      for (const o of this.worms) {
        if (!o.alive || o.id === w.id) continue;
        const dx = o.x - px;
        const dy = o.y - py;
        if (dx * dx + dy * dy <= WORM_RADIUS * WORM_RADIUS) {
          target = o;
          break;
        }
      }
      if (target) break;
    }
    if (target) {
      this.emit({
        t: "explosion",
        x: Math.round(px),
        y: Math.round(py),
        r: Math.max(1, Math.round(def.radius)),
        power: Math.round(def.power),
        style,
      });
      target.vx += dirX * def.power * 0.6;
      target.vy += dirY * def.power * 0.6 - 40;
      target.onGround = false;
      this.damageWorm(target, def.damage, "explosion");
    } else if (terrainHit && def.radius > 0) {
      this.explode(px, py, def.radius, def.damage, def.power, style);
    }
  }

  private swingBat(w: Worm, dirX: number, dirY: number): void {
    w.anim = "bat";
    w.animTimer = 0.4;
    this.emit({ t: "shot", weapon: "bat", x: Math.round(w.x), y: Math.round(w.y) });
    this.emit({ t: "sound", name: "bat", x: w.x, y: w.y });
    for (const o of this.worms) {
      if (!o.alive || o.id === w.id) continue;
      const dx = o.x - w.x;
      const dy = o.y - w.y;
      const d = Math.hypot(dx, dy);
      if (d > BAT_RANGE) continue;
      if (d > 0.001 && dx * dirX + dy * dirY < 0) continue;
      o.vx = dirX * 500;
      o.vy = dirY * 500 - 120;
      o.onGround = false;
      this.damageWorm(o, WEAPONS.bat.damage, "explosion");
    }
  }

  private doTeleport(w: Worm, x: number, y: number): boolean {
    const tx = clamp(x, WORM_RADIUS, WORLD_WIDTH - 1 - WORM_RADIUS);
    const ty = clamp(y, WORM_RADIUS, WORLD_HEIGHT + 100);
    if (circleHits(this.terrain, tx, ty, WORM_RADIUS)) {
      this.emit({ t: "message", text: "Tam się nie da teleportować!" });
      return false;
    }
    w.x = tx;
    w.y = ty;
    w.vx = 0;
    w.vy = 0;
    w.onGround = groundBelow(this.terrain, tx, ty, WORM_RADIUS, 2);
    this.emit({ t: "sound", name: "teleport", x: tx, y: ty });
    return true;
  }

  private updateBurst(dt: number): void {
    const b = this.burst;
    if (!b) return;
    const w = this.worms.find((x) => x.id === b.wormId);
    b.timer -= dt;
    let guard = 0;
    while (b.remaining > 0 && b.timer <= 0 && guard++ < 32) {
      b.remaining -= 1;
      b.timer += b.interval;
      if (w && w.alive) {
        const spread = this.rng.range(-0.05, 0.05);
        const a = w.aim + spread;
        const dirX = Math.cos(a) * w.facing;
        const dirY = Math.sin(a);
        this.emit({ t: "shot", weapon: "uzi", x: Math.round(w.x), y: Math.round(w.y) });
        this.emit({ t: "sound", name: "shot", x: w.x, y: w.y });
        this.hitscan(w, dirX, dirY, WEAPONS.uzi, "uzi");
      }
    }
    if (b.remaining <= 0) this.burst = null;
  }

  // ---------------------------------------------------------------- API

  removeTeam(team: number): void {
    const ts = this.teamState(team);
    if (!ts || ts.removed) return;
    ts.removed = true;
    this.emit({ t: "message", text: `${ts.name} (${teamLabel(team)}) poddaje się.` });
    for (const w of this.worms) {
      if (w.team === team && w.alive) this.killWorm(w, "surrender");
    }
    if (this.phase !== "gameOver" && this.activeTeam === team) this.endTurn();
    this.checkGameOver();
  }

  isOver(): boolean {
    return this.phase === "gameOver";
  }

  winner(): { team: number | null; name: string | null } {
    if (!this.finished) return { team: null, name: null };
    if (this.winnerTeam === null) return { team: null, name: null };
    const ts = this.teamState(this.winnerTeam);
    return { team: this.winnerTeam, name: ts ? ts.name : teamLabel(this.winnerTeam) };
  }

  terrainSync(): TerrainSync {
    return { width: this.terrain.width, height: this.terrain.height, rle: this.terrain.toRLE() };
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot(): GameSnapshot {
    const worms: WormSnapshot[] = new Array(this.worms.length);
    for (let i = 0; i < this.worms.length; i++) {
      const w = this.worms[i];
      const s: WormSnapshot = {
        id: w.id,
        team: w.team,
        name: w.name,
        x: r2(w.x),
        y: r2(w.y),
        vx: r2(w.vx),
        vy: r2(w.vy),
        hp: w.hp,
        alive: w.alive,
        facing: w.facing,
        aim: r3(w.aim),
        onGround: w.onGround,
      };
      if (w.anim) s.anim = w.anim;
      worms[i] = s;
    }

    const projectiles: ProjectileSnapshot[] = new Array(this.projectiles.length);
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const s: ProjectileSnapshot = {
        id: p.id,
        kind: p.kind,
        x: r2(p.x),
        y: r2(p.y),
        vx: r2(p.vx),
        vy: r2(p.vy),
        angle: r3(p.angle),
      };
      if (p.fuse !== undefined) s.fuse = r2(p.fuse);
      projectiles[i] = s;
    }

    const crates: CrateSnapshot[] = this.crates.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: r2(c.x),
      y: r2(c.y),
      vy: r2(c.vy),
      landed: c.landed,
    }));

    const mines: MineSnapshot[] = this.mines.map((m) => {
      const s: MineSnapshot = { id: m.id, x: r2(m.x), y: r2(m.y), armed: m.armed };
      if (m.fuse !== undefined) s.fuse = r2(m.fuse);
      return s;
    });

    const teams: TeamSnapshot[] = this.teams.map((t) => {
      let totalHp = 0;
      let alive = 0;
      for (const w of this.worms) {
        if (w.team !== t.team || !w.alive) continue;
        totalHp += w.hp;
        alive++;
      }
      return {
        team: t.team,
        playerId: t.playerId,
        name: t.name,
        totalHp,
        alive,
        ammo: { ...t.ammo },
      };
    });

    const ts = this.teamState(this.activeTeam);
    const turn: TurnInfo = {
      phase: this.phase,
      activeTeam: this.activeTeam,
      activeWormId: this.activeWormId,
      timeLeft: r2(Math.max(0, this.phaseTimer)),
      round: this.roundsCompleted + 1,
      wind: r2(this.wind),
      suddenDeath: this.suddenDeath,
      waterLevel: r2(this.waterLevel),
      selectedWeapon: ts ? ts.selectedWeapon : "bazooka",
      weaponTimer: ts ? ts.weaponTimer : 3,
      chargePower: r3(this.charging || this.chargePower > 0 ? this.chargePower : 0),
      shotsLeft: this.shotsLeft,
      girderAngle: r3(this.girderAngle),
    };

    return {
      tick: this.tick,
      time: r2(this.time),
      worms,
      projectiles,
      crates,
      mines,
      teams,
      turn,
    };
  }
}
