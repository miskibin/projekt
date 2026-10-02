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
  WORM_MUZZLE_OFFSET,
  WORM_MUZZLE_LIFT,
  WORM_SEPARATION,
  WORM_WALK_SPEED,
} from "../constants";
import type {
  CrateSnapshot,
  BarrelSnapshot,
  TreeSnapshot,
  SpringSnapshot,
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
import { WEAPONS, matchArsenal, startingAmmo, type WeaponDef } from "./weapons";
import { makeProjectile, detonateProjectile, stepProjectiles } from "./projectiles";
import { placeMine, spawnCrate, spawnInitialMines, stepCrates, stepMines, MINE_RADIUS } from "./crates";
import { WORM_NAMES } from "./names";
import type { Crate, DeathReason, EngineCtx, FallingTree, Mine, Projectile, SpringTrap, TeamState, Worm } from "./types";

const STARTING_TIME = 0.75;
const SETTLE_TIMEOUT = 7;
const STRANDED_WORM_TIMEOUT = 3;
const WATER_RISE_TIME = 1.2;

const WORM_RESTITUTION = 0.3;
const WORM_BOUNCE_FRICTION = 0.55;
const WORM_REST_SPEED = 55;
const WORM_STEP_DOWN = 8;
const JUMP_GRACE_TIME = 0.12;
const WORM_AIR_CONTROL = 240;

const JET_FUEL = 8;
const JET_UP = 1600;
const JET_SIDE = 700;
const JET_MAX = 230;

const BAT_RANGE = 25 + WORM_RADIUS;
const HITSCAN_RANGE = 800;
/** Klient podtrzymuje wejście co 0.5 s; po zaniku transmisji nie trzymaj ruchu ani ładowania w nieskończoność. */
const INPUT_TIMEOUT = 0.9;
const DEFENSE_STEP_SPEED = 245;
const DEFENSE_STEP_LIFT = -105;
const DEFENSE_JUMP_SPEED = -360;

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

/** Jedna wariacja znanych zasad na cały mecz; brak dodatkowych akcji gracza. */
type MatchFeature = "regular" | "barrels" | "supplies";

export class GameImpl implements Game, EngineCtx {
  readonly config: GameConfig;
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly worms: Worm[] = [];
  readonly projectiles: Projectile[] = [];
  readonly crates: Crate[] = [];
  readonly mines: Mine[] = [];
  readonly barrels: BarrelSnapshot[] = [];
  readonly trees: FallingTree[] = [];
  readonly springs: SpringTrap[] = [];
  readonly teams: TeamState[] = [];
  private readonly spawnSites: Array<{ x: number; y: number }>;
  private readonly matchFeature: MatchFeature;

  wind = 0;
  waterLevel = WATER_LEVEL_START;

  private events: GameEvent[] = [];
  private readonly lastGroundedAt = new Map<number, number>();
  private bufferedJump: { wormId: number; back: boolean; until: number } | null = null;
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
  private inputAge = 0;
  private charging = false;
  private chargePower = 0;
  private shotsLeft = 1;
  private firedThisTurn = 0;
  private attackStarted = false;
  private readonly defendedTeams = new Set<number>();
  private girderAngle = 0;
  private target: { x: number; y: number } | undefined;
  private burst: Burst | null = null;

  private explosionQueue: { x: number; y: number; r: number; dmg: number; power: number; style?: ExplosionStyle }[] = [];
  private processingExplosions = false;

  private winnerTeam: number | null = null;
  private finished = false;

  constructor(config: GameConfig, setups: TeamSetup[]) {
    this.config = { ...config };
    this.terrain = generateTerrain(config.seed, WORLD_WIDTH, WORLD_HEIGHT, config.terrainDensity, config.terrainStyle);
    this.rng = new Rng((Math.imul(config.seed >>> 0, 747796405) + 2891336453) >>> 0);
    this.spawnSites = this.findSpawnSites(setups.length * config.wormsPerTeam > 8);
    const draft = config.mode === "arsenal" ? matchArsenal(this.rng) : null;
    this.matchFeature = draft ? this.rng.pick<MatchFeature>(["regular", "barrels", "supplies"]) : "regular";

    for (const s of setups) {
      const ammo = draft ? { ...draft.ammo } : startingAmmo();
      for (const id of Object.keys(WEAPONS) as WeaponId[]) {
        const extra = s.loadout?.ammo?.[id];
        if (ammo[id] >= 0 && typeof extra === "number" && Number.isFinite(extra))
          ammo[id] += clamp(Math.floor(extra), 0, 6);
      }
      this.teams.push({
        team: s.team,
        playerId: s.playerId,
        name: s.name,
        ammo,
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
        const worm = this.spawnWorm(ts.team, pool[nameIdx % pool.length]);
        const bonus = setups.find((s) => s.team === ts.team)?.loadout?.hpBonus;
        if (typeof bonus === "number" && Number.isFinite(bonus)) {
          worm.hp += clamp(Math.floor(bonus), 0, 64);
          worm.maxHp = worm.hp;
        }
        nameIdx++;
      }
    }

    spawnInitialMines(this);
    this.spawnBarrels(this.matchFeature === "barrels" ? 5 : 3);
    this.spawnTrees(this.config.theme === "desert" ? 3 : 4);
    if (draft) {
      spawnCrate(this, "weapon", true);
      spawnCrate(this, "utility", true);
      if (this.matchFeature === "supplies") spawnCrate(this, "weapon", true);
    }
    this.beginNextTurn();
    if (draft) {
      const setting = this.matchFeature === "barrels" ? "Więcej wybuchowych beczek!" :
        this.matchFeature === "supplies" ? "Więcej skrzynek z bronią!" : "Losowany arsenał!";
      this.emit({ t: "message", text: setting });
    }
  }

  private spawnBarrels(count: number): void {
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = this.rng.int(100, WORLD_WIDTH - 100);
        const surface = this.terrain.surfaceY(x);
        const y = surface - 11;
        if (surface < WORLD_HEIGHT * 0.45 || surface >= this.waterLevel - 15) continue;
        if (this.terrain.isSolid(x, y) || !this.terrain.isSolid(x, surface + 4)) continue;
        if (this.worms.some((w) => Math.hypot(w.x - x, w.y - y) < 100)) continue;
        if (this.mines.some((m) => Math.hypot(m.x - x, m.y - y) < 45)) continue;
        if (this.barrels.some((b) => Math.abs(b.x - x) < 155)) continue;
        this.barrels.push({ id: this.nextId(), x, y });
        break;
      }
    }
  }

  private spawnTrees(count: number): void {
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const x = this.rng.int(95, WORLD_WIDTH - 95);
        const y = this.terrain.surfaceY(x);
        const height = this.rng.int(65, 92);
        if (y < height + 55 || y > this.waterLevel - 35 ||
          !this.terrain.isSolid(x, y + 5) || this.terrain.isSolid(x, y - height)) continue;
        if (this.worms.some((w) => Math.abs(w.x - x) < 63 && Math.abs(w.y - y) < 82) ||
          this.barrels.some((b) => Math.abs(b.x - x) < 42) ||
          this.trees.some((tree) => Math.abs(tree.x - x) < 195)) continue;
        this.trees.push({ id: this.nextId(), x, y, height, angle: 0, direction: 1,
          falling: false, fade: 1, hitWorms: new Set() });
        break;
      }
    }
  }

  private fellTree(tree: FallingTree, direction: -1 | 1): void {
    if (tree.falling) return;
    tree.falling = true;
    tree.direction = direction;
    this.emit({ t: "treeFall", x: tree.x, y: tree.y, direction });
    this.emit({ t: "sound", name: "wood", x: tree.x, y: tree.y });
  }

  private stepTreesAndSprings(dt: number): void {
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const tree = this.trees[i];
      if (!tree.falling) continue;
      const prev = tree.angle;
      tree.angle = Math.min(Math.PI / 2, tree.angle + dt * 2.7);
      const x0 = tree.x;
      const y0 = tree.y;
      const x1 = x0 + tree.direction * Math.sin(tree.angle) * tree.height;
      const y1 = y0 - Math.cos(tree.angle) * tree.height;
      for (const worm of this.worms) {
        if (!worm.alive || tree.hitWorms.has(worm.id)) continue;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const along = clamp(((worm.x - x0) * dx + (worm.y - y0) * dy) / (tree.height * tree.height), 0, 1);
        const dist = Math.hypot(worm.x - (x0 + along * dx), worm.y - (y0 + along * dy));
        // Górna korona ma szerszy obszar uderzenia niż pień.
        if (dist > WORM_RADIUS + (along > 0.72 ? 21 : 8) || tree.angle <= 0.12) continue;
        tree.hitWorms.add(worm.id);
        worm.vx = tree.direction * 175;
        worm.vy = -230;
        worm.onGround = false;
        this.damageWorm(worm, 34, "explosion");
      }
      if (tree.angle === Math.PI / 2) {
        if (prev < Math.PI / 2) this.emit({ t: "sound", name: "wood", x: x1, y: y1 });
        tree.fade -= dt * 0.7;
        if (tree.fade <= 0) this.trees.splice(i, 1);
      }
    }
    for (let i = this.springs.length - 1; i >= 0; i--) {
      const spring = this.springs[i];
      if (spring.revealed) {
        spring.life -= dt;
        if (spring.life <= 0) this.springs.splice(i, 1);
        continue;
      }
      const victim = this.worms.find((w) => w.alive && w.team !== spring.ownerTeam &&
        Math.abs(w.x - spring.x) < 23 && Math.abs(w.y - (spring.y - WORM_RADIUS)) < 18);
      if (!victim) continue;
      spring.revealed = true;
      spring.life = 0.7;
      victim.vx = victim.x < spring.x ? -345 : 345;
      victim.vy = -570;
      victim.onGround = false;
      this.lastGroundedAt.delete(victim.id);
      this.emit({ t: "springTriggered", x: spring.x, y: spring.y, wormId: victim.id });
      this.emit({ t: "sound", name: "spring", x: spring.x, y: spring.y });
    }
  }

  // ---------------------------------------------------------------- EngineCtx

  nextId(): number {
    return this.idCounter++;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  // ---------------------------------------------------------------- setup

  private findSpawnSites(crowded: boolean): Array<{ x: number; y: number }> {
    const sites: Array<{ x: number; y: number }> = [];
    for (let x = crowded ? 72 : 420; x < WORLD_WIDTH - (crowded ? 72 : 420); x += 12) {
      // surfaceY zatrzymuje się na pierwszej wyspie. Szukamy również gruntu
      // pod nią, o ile robak ma nad głową wolne miejsce.
      let surface = -1;
      for (let y = Math.round(WORLD_HEIGHT * 0.3); y < this.waterLevel - WORM_RADIUS - 6; y++) {
        if (!this.terrain.isSolid(x, y) || this.terrain.isSolid(x, y - 1)) continue;
        let support = 0;
        for (const depth of [90, 150, 210]) {
          if (this.terrain.isSolid(x, Math.min(WORLD_HEIGHT - 50, y + depth))) support++;
        }
        if (support < 2) continue;
        surface = y;
        break;
      }
      if (surface < 0) continue;
      const y = surface - WORM_RADIUS - 1;
      if (y < WORLD_HEIGHT * 0.44) continue;
      if (circleHits(this.terrain, x, y, WORM_RADIUS)) continue;
      if (!groundBelow(this.terrain, x, y, WORM_RADIUS, 3)) continue;
      sites.push({ x, y });
    }
    return sites.sort((a, b) => a.y - b.y);
  }

  private spawnWorm(team: number, name: string): Worm {
    let px = -1;
    let py = -1;
    // Pierwsze dwa robaki trafiają na wysokie i niskie stanowisko. Następne
    // rozkładamy po pozostałych wysokościach, nie grupując całych drużyn.
    const altitudeOrder = [0.08, 0.91, 0.54, 0.3, 0.75, 0.43, 0.97, 0.16];
    const rank = altitudeOrder[this.worms.length % altitudeOrder.length]!;
    const targetY = this.spawnSites[Math.round(rank * (this.spawnSites.length - 1))]?.y;
    const dists = [110, 90, 70, 55, 46, WORM_SEPARATION];
    for (const minDist of dists) {
      const available = this.spawnSites.filter((site) => this.worms.every(
        (other) => Math.hypot(other.x - site.x, other.y - site.y) >= minDist,
      ));
      if (!available.length) continue;
      const best = Math.min(...available.map((site) => Math.abs(site.y - (targetY ?? site.y))));
      const close = available.filter((site) => Math.abs(site.y - (targetY ?? site.y)) <= best + 8);
      const choice = this.rng.pick(close);
      px = choice.x;
      py = choice.y;
      if (px >= 0) break;
    }
    if (px < 0) {
      // Awaryjnie wybierz najluźniejsze sprawdzone stanowisko, zamiast
      // losowego punktu wewnątrz terenu lub na stojącym już robaku.
      const best = this.spawnSites.reduce<{ site: { x: number; y: number } | null; distance: number }>(
        (acc, site) => {
          const distance = Math.min(Infinity, ...this.worms.map((other) => Math.hypot(other.x - site.x, other.y - site.y)));
          return distance > acc.distance ? { site, distance } : acc;
        }, { site: null, distance: -1 },
      ).site;
      px = best?.x ?? this.rng.int(30, WORLD_WIDTH - 30);
      py = best?.y ?? Math.max(12, Math.min(this.waterLevel - WORM_RADIUS - 2, this.terrain.surfaceY(px) - WORM_RADIUS - 1));
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

    this.inputAge += dt;
    if (this.inputAge > INPUT_TIMEOUT && (this.input.left || this.input.right || this.input.charge)) {
      this.input = { ...this.input, left: false, right: false, charge: false };
    }

    this.applyControl(dt);
    this.updateBurst(dt);
    for (const w of this.worms) this.updateWorm(w, dt);
    stepProjectiles(this, dt);
    this.stepTreesAndSprings(dt);
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
    if (inp.facing === -1 || inp.facing === 1) w.facing = inp.facing;
    else if (inp.left && !inp.right) w.facing = -1;
    else if (inp.right && !inp.left) w.facing = 1;

    const dir = inp.left && !inp.right ? -1 : inp.right && !inp.left ? 1 : 0;
    if (!w.jetpackActive && dir !== 0) {
      if (w.onGround) {
        const res = walkStep(
          this.terrain,
          w,
          WORM_RADIUS,
          dir * WORM_WALK_SPEED * dt,
          WORM_MAX_STEP_UP,
          WORM_STEP_DOWN,
        );
        if (res === "fell") w.onGround = false;
      } else {
        // Gentle air steering helps clear crater lips and narrow terrain gaps.
        w.vx = clamp(w.vx + dir * WORM_AIR_CONTROL * dt, -120, 120);
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

    // Destruction or a placed girder can change the terrain under a resting
    // worm. Recover once when embedded instead of bouncing in place forever.
    if (circleHits(this.terrain, w.x, w.y, WORM_RADIUS)) {
      const pos = { x: w.x, y: w.y };
      if (pushOut(this.terrain, pos, WORM_RADIUS, 28)) {
        w.x = pos.x;
        w.y = pos.y;
        w.onGround = w.vy >= 0 && groundBelow(this.terrain, w.x, w.y, WORM_RADIUS, 3);
        if (w.onGround) { w.vx = 0; w.vy = 0; }
      }
    }

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
        this.lastGroundedAt.set(w.id, this.time);
        w.vx = 0;
        w.vy = 0;
      }
    }

    if (!w.onGround) this.ballistic(w, dt);

    if (w.onGround && this.bufferedJump?.wormId === w.id && this.bufferedJump.until >= this.time) {
      this.jump(w, this.bufferedJump.back);
    } else if (this.bufferedJump && this.bufferedJump.until < this.time) {
      this.bufferedJump = null;
    }

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
        // Na skraju urwiska dolny bok hitboxu zahacza o pionową ścianę.
        // Odbijanie i pushOut od poprzedniej (wolnej) pozycji zwracały
        // robaka wciąż do tego samego punktu, więc wisiał w powietrzu.
        // Jeśli pod stopami brak podparcia, odsuń go od ściany i pozwól opaść.
        if (Math.abs(n.x) > 0.35 && !groundBelow(this.terrain, w.x, w.y, WORM_RADIUS, 3)) {
          const outward = Math.sign(n.x);
          for (let d = 1; d <= WORM_RADIUS * 2 + 2; d++) {
            const freeX = clamp(nx + outward * d, WORM_RADIUS, WORLD_WIDTH - 1 - WORM_RADIUS);
            if (!circleHits(this.terrain, freeX, ny, WORM_RADIUS)) {
              w.x = freeX;
              w.y = ny;
              w.vx = outward * Math.max(0, w.vx * outward);
              w.vy = Math.max(0, w.vy);
              return;
            }
          }
        }
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
        if (n.y < -0.35 && groundBelow(this.terrain, w.x, w.y, WORM_RADIUS, 3) &&
            !circleHits(this.terrain, w.x, w.y, WORM_RADIUS) &&
            Math.hypot(w.vx, w.vy) < WORM_REST_SPEED) {
          w.vx = 0;
          w.vy = 0;
          w.onGround = true;
          this.lastGroundedAt.set(w.id, this.time);
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
    this.emit({ t: "sound", name: style ? `explosion:${style}` : "explosion", x: xi, y: yi });

    // Paliwowe beczki otwierają dodatkowy krater. Kolejka w explode() obsługuje
    // reakcję łańcuchową bez rekurencji i wysyła identyczne zdarzenia wszystkim.
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const barrel = this.barrels[i];
      if (Math.hypot(barrel.x - xi, barrel.y - yi) > ri + 15) continue;
      this.barrels.splice(i, 1);
      this.explode(barrel.x, barrel.y, 47, 42, 390, "barrel");
    }

    for (const tree of this.trees) {
      if (tree.falling) continue;
      const trunkX = tree.x;
      const trunkY = tree.y - tree.height * 0.45;
      if (Math.hypot(trunkX - xi, trunkY - yi) < ri + tree.height * 0.4) {
        this.fellTree(tree, xi < tree.x ? 1 : -1);
      }
    }

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

    // Rozpad granatu może dopisać nowe pociski; nie detonujemy ich tym samym wybuchem.
    for (const p of [...this.projectiles]) {
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
    this.attackStarted = false;
    this.defendedTeams.clear();
    this.target = undefined;
    this.girderAngle = 0;
    this.burst = null;
    this.input = { ...NEUTRAL_INPUT };
    this.inputAge = 0;
    if (ts.ammo[ts.selectedWeapon] === 0) ts.selectedWeapon = "bazooka";
    this.shotsLeft = WEAPONS[ts.selectedWeapon].shots;

    this.wind = this.rng.range(-MAX_WIND, MAX_WIND);
    this.phase = "starting";
    this.phaseTimer = STARTING_TIME;
    this.settleGuard = 0;

    this.emit({ t: "turnStart", team, wormId: worm.id, wind: this.wind });

    const crateChance = this.config.mode === "arsenal"
      ? this.matchFeature === "supplies" ? 0.8 : 0.6 : CRATE_DROP_CHANCE;
    if (this.rng.chance(crateChance)) spawnCrate(this, undefined, this.config.mode === "arsenal");
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
    if (this.trees.some((tree) => tree.falling && tree.angle < Math.PI / 2)) return false;
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
          // Po ostatnim wybuchu pojedynczy robak może wisieć na nierównej
          // krawędzi. Długi limit jest potrzebny tylko żywym pociskom i salwom.
          const activeHazard = this.projectiles.length > 0 || !!this.burst ||
            this.mines.some((mine) => mine.fuse !== undefined && !mine.dead);
          if (this.settleGuard > (activeHazard ? SETTLE_TIMEOUT : STRANDED_WORM_TIMEOUT)) {
            this.phaseTimer = 0;
          }
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
      ...(state.facing === -1 || state.facing === 1 ? { facing: state.facing } : {}),
    };
    this.inputAge = 0;
    const w = this.activeWorm();
    if (w && w.alive) {
      w.aim = aim;
      if (this.input.facing !== undefined) w.facing = this.input.facing;
    }
  }

  applyAction(team: number, action: InputAction): void {
    if (action.kind === "surrender") {
      this.removeTeam(team);
      return;
    }
    if (this.phase === "gameOver") return;
    if (action.kind === "defend") {
      this.defend(team, action);
      return;
    }
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

  /** Jedna odpowiedź każdej drużyny na aktualny atak, zawsze rozstrzygana przez silnik. */
  private defend(team: number, action: Extract<InputAction, { kind: "defend" }>): void {
    if (!this.attackStarted || !this.teamAlive(team) || team === this.activeTeam ||
        this.defendedTeams.has(team) || !["active", "retreat", "settling"].includes(this.phase)) return;
    if (action.style !== "step" && action.style !== "jump") return;
    if (action.style === "step" && action.direction !== -1 && action.direction !== 1) return;
    if (!Number.isSafeInteger(action.wormId)) return;
    const worm = this.worms.find((w) => w.id === action.wormId && w.team === team && w.alive);
    if (!worm) return;
    this.defendedTeams.add(team);
    if (action.style === "step") {
      worm.vx = action.direction! * DEFENSE_STEP_SPEED;
      worm.vy = Math.min(worm.vy, DEFENSE_STEP_LIFT);
      worm.facing = action.direction!;
    } else {
      worm.vx *= 0.25;
      worm.vy = Math.min(worm.vy, DEFENSE_JUMP_SPEED);
    }
    worm.onGround = false;
    this.lastGroundedAt.delete(worm.id);
    this.emit({ t: "defense", wormId: worm.id, style: action.style, x: Math.round(worm.x), y: Math.round(worm.y) });
  }

  private jump(w: Worm, back: boolean): void {
    if (w.jetpackActive) {
      w.jetThrust = 0.2;
      return;
    }
    // Na krawędzi bitmapa bywa 2–4 px pod stopami, a kolizja boczna trzyma
    // onGround=false. Pozwól odbić się od takiego podparcia zamiast uwięzić robaka.
    const ledgeSupport = w.vy >= 0 && w.vy < 150 &&
      !circleHits(this.terrain, w.x, w.y, WORM_RADIUS) &&
      groundBelow(this.terrain, w.x, w.y, WORM_RADIUS, 4);
    if (!w.onGround && !ledgeSupport &&
        (this.time - (this.lastGroundedAt.get(w.id) ?? -Infinity) > JUMP_GRACE_TIME || w.vy > 150)) {
      this.bufferedJump = { wormId: w.id, back, until: this.time + JUMP_GRACE_TIME };
      return;
    }
    this.bufferedJump = null;
    this.lastGroundedAt.delete(w.id);
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
    const mx = w.x + dirX * WORM_MUZZLE_OFFSET;
    const my = w.y - WORM_MUZZLE_LIFT + dirY * WORM_MUZZLE_OFFSET;
    const speed = p01 * MAX_SHOT_POWER;

    if (id !== "jetpack" && w.jetpackActive) this.deactivateJetpack(w);

    switch (id) {
      case "sticky":
      case "mortar":
      case "repulsor": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: id, x: mx, y: my, vx: dirX * speed * 0.85, vy: dirY * speed * 0.85,
          radius: def.radius, damage: def.damage, power: def.power,
          fuse: id === "sticky" ? ts.weaponTimer : 4,
          explodeOnContact: id !== "sticky", collidesWorms: id !== "sticky",
          windAffected: id === "mortar", gravityScale: id === "repulsor" ? 0.6 : 1,
          ownerWorm: w.id, ownerTeam: w.team,
        });
        break;
      }
      case "railgun": {
        this.emitShot(id, w);
        const victims = new Set<number>();
        let px = mx, py = my;
        for (let distance = 0; distance < 1200; distance += 2) {
          px += dirX * 2;
          py += dirY * 2;
          if (px < 0 || px >= WORLD_WIDTH || py > this.waterLevel || this.terrain.isSolid(px, py)) break;
          for (const other of this.worms) {
            if (!other.alive || other.id === w.id || victims.has(other.id) ||
                Math.hypot(other.x - px, other.y - py) > WORM_RADIUS + 2) continue;
            victims.add(other.id);
            this.damageWorm(other, def.damage, "explosion");
            other.vx += dirX * def.power;
            other.vy += dirY * def.power - 35;
            other.onGround = false;
          }
        }
        this.emit({ t: "bulletTrace", weapon: "railgun", x0: r2(mx), y0: r2(my), x: r2(px), y: r2(py), hit: victims.size > 0 });
        break;
      }
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
      case "drill": {
        this.emitShot(id, w);
        makeProjectile(this, {
          kind: "drill", x: mx, y: my,
          vx: dirX * Math.max(260, speed * 0.8),
          vy: dirY * Math.max(260, speed * 0.8),
          fuse: 1.6, radius: def.radius, damage: def.damage, power: def.power,
          gravityScale: 0, windAffected: false, hitRadius: 4,
          ownerWorm: w.id, ownerTeam: w.team,
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
          shards: id === "cluster" ? 10 : id === "banana" ? 8 : 0,
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
          fuse: ts.weaponTimer,
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
          fuse: ts.weaponTimer,
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
        // Pułapka trafia przed robaka, poza swoim promieniem wykrywania.
        placeMine(this, clamp(w.x + w.facing * 43, MINE_RADIUS, WORLD_WIDTH - MINE_RADIUS),
          w.y + WORM_RADIUS - MINE_RADIUS, ts.weaponTimer);
        break;
      }
      case "spring": {
        const tx = Math.round(clamp(w.x + w.facing * 50, 30, WORLD_WIDTH - 30));
        const ty = this.terrain.surfaceY(tx);
        if (ty > this.waterLevel - 12 || Math.abs(ty - w.y) > 44 ||
            this.springs.some((trap) => Math.abs(trap.x - tx) < 48 && Math.abs(trap.y - ty) < 28)) {
          this.emit({ t: "message", text: "Tu nie da się postawić katapulty." });
          return;
        }
        this.emitShot(id, w);
        this.springs.push({ id: this.nextId(), x: tx, y: ty, ownerTeam: w.team, revealed: false, life: 0 });
        break;
      }
      case "shotgun": {
        this.emitShot(id, w);
        const hits = new Map<Worm, number>();
        // Pięć niezależnych śrucin: blisko boli mocniej, na dystansie rozrzut.
        for (let i = -2; i <= 2; i++) {
          const angle = w.aim + i * 0.035 + this.rng.range(-0.009, 0.009);
          const victim = this.traceBullet(w, Math.cos(angle) * w.facing, Math.sin(angle), "shotgun", i === 0);
          if (victim) hits.set(victim, (hits.get(victim) ?? 0) + 6);
        }
        for (const [victim, damage] of hits) {
          victim.vx += dirX * def.power * damage / 30;
          victim.vy += dirY * def.power * damage / 30 - 35;
          victim.onGround = false;
          this.damageWorm(victim, damage, "explosion");
        }
        break;
      }
      case "uzi": {
        this.attackStarted = true;
        this.burst = { wormId: w.id, remaining: 10, timer: 0, interval: 0.08 };
        break;
      }
      case "bat": {
        this.swingBat(w, dirX, dirY);
        break;
      }
      case "axe": {
        this.emitShot(id, w);
        const tree = this.trees.filter((t) => !t.falling && (t.x - w.x) * w.facing > 0 &&
          Math.abs(t.x - w.x) < 68 && Math.abs(t.y - w.y) < 58)
          .sort((a, b) => Math.abs(a.x - w.x) - Math.abs(b.x - w.x))[0];
        if (tree) this.fellTree(tree, w.facing);
        else {
          const victim = this.worms.filter((other) => other.alive && other.id !== w.id &&
            (other.x - w.x) * w.facing > 0 && Math.hypot(other.x - w.x, other.y - w.y) < 64)
            .sort((a, b) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y))[0];
          if (victim) {
            victim.vx = w.facing * 310;
            victim.vy = -200;
            victim.onGround = false;
            this.damageWorm(victim, def.damage, "explosion");
          }
        }
        w.anim = "bat";
        w.animTimer = 0.35;
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
            y: -60 - i * 72,
            vx: 0,
            vy: 280,
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
        const halfW = 40;
        const ca = Math.cos(this.girderAngle);
        const sa = Math.sin(this.girderAngle);
        if (this.worms.some((other) => {
          if (!other.alive) return false;
          const dx = other.x - gx;
          const dy = other.y - gy;
          return Math.abs(dx * ca + dy * sa) < halfW + WORM_RADIUS &&
            Math.abs(-dx * sa + dy * ca) < 5 + WORM_RADIUS;
        })) {
          this.emit({ t: "message", text: "Belka nie może przygnieść robaka!" });
          return;
        }
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
    if (!WEAPONS[id].utility) this.attackStarted = true;
    this.emit({ t: "shot", weapon: id, x: Math.round(w.x), y: Math.round(w.y) });
    const name = id === "shotgun" ? "shotgun" : id === "holy" ? "hallelujah" :
      id === "bazooka" || id === "homing" ? "rocket" :
      id === "grenade" || id === "cluster" || id === "banana" ? "throw" :
      id === "drill" ? "drill" : id === "airstrike" ? "airstrike" :
      id === "dynamite" || id === "mine" || id === "spring" ? "place" :
      id === "axe" ? "axe" : "shot";
    this.emit({ t: "sound", name, x: w.x, y: w.y });
  }

  private traceBullet(w: Worm, dirX: number, dirY: number, style: "shotgun" | "uzi", carveTerrain: boolean): Worm | null {
    const x0 = w.x + dirX * WORM_MUZZLE_OFFSET;
    const y0 = w.y - WORM_MUZZLE_LIFT + dirY * WORM_MUZZLE_OFFSET;
    let px = x0;
    let py = y0;
    let target: Worm | null = null;
    let terrainHit = false;
    for (let d = 0; d < HITSCAN_RANGE; d++) {
      px += dirX;
      py += dirY;
      if (px < 0 || px >= WORLD_WIDTH) break;
      if (py > this.waterLevel) {
        this.emit({ t: "sound", name: "splash", x: px, y: this.waterLevel });
        break;
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
    this.emit({ t: "bulletTrace", weapon: style, x0: r2(x0), y0: r2(y0), x: r2(px), y: r2(py), hit: !!target || terrainHit });
    if (terrainHit && carveTerrain) {
      const def = WEAPONS[style];
      this.explode(px, py, def.radius, def.damage, def.power, style);
    }
    return target;
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
      this.emit({ t: "batHit", x: r2(o.x), y: r2(o.y), dx: r2(dirX), dy: r2(dirY) });
    }
  }

  private doTeleport(w: Worm, x: number, y: number): boolean {
    const tx = clamp(x, WORM_RADIUS, WORLD_WIDTH - 1 - WORM_RADIUS);
    const ty = clamp(y, WORM_RADIUS, WORLD_HEIGHT + 100);
    if (ty + WORM_RADIUS >= this.waterLevel || circleHits(this.terrain, tx, ty, WORM_RADIUS)) {
      this.emit({ t: "message", text: "Tam się nie da teleportować!" });
      return false;
    }
    const fromX = w.x;
    const fromY = w.y;
    w.x = tx;
    w.y = ty;
    w.vx = 0;
    w.vy = 0;
    w.onGround = groundBelow(this.terrain, tx, ty, WORM_RADIUS, 2);
    this.emit({ t: "teleport", fromX: r2(fromX), fromY: r2(fromY), toX: r2(tx), toY: r2(ty) });
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
        this.emit({ t: "sound", name: "uzi", x: w.x, y: w.y });
        const target = this.traceBullet(w, dirX, dirY, "uzi", true);
        if (target) {
          target.vx += dirX * WEAPONS.uzi.power * 0.6;
          target.vy += dirY * WEAPONS.uzi.power * 0.6 - 40;
          target.onGround = false;
          this.damageWorm(target, WEAPONS.uzi.damage, "explosion");
        }
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
        maxHp: w.maxHp,
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
      if (p.homingTarget) s.homingTarget = { x: r2(p.homingTarget.x), y: r2(p.homingTarget.y) };
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
      defenseReady: this.attackStarted ? this.teams.filter((t) => t.team !== this.activeTeam &&
        this.teamAlive(t.team) && !this.defendedTeams.has(t.team)).map((t) => t.team) : [],
      defenseWindow: this.attackStarted && (this.phase === "active" || this.phase === "retreat" || this.phase === "settling"),
    };

    return {
      tick: this.tick,
      time: r2(this.time),
      worms,
      projectiles,
      crates,
      barrels: this.barrels.map((b) => ({ ...b })),
      trees: this.trees.map((tree): TreeSnapshot => ({ id: tree.id, x: r2(tree.x), y: r2(tree.y),
        height: tree.height, angle: r3(tree.angle * tree.direction), opacity: r2(Math.max(0, tree.fade)) })),
      springs: this.springs.map((spring): SpringSnapshot => ({ id: spring.id, x: r2(spring.x), y: r2(spring.y),
        ownerTeam: spring.ownerTeam, revealed: spring.revealed })),
      mines,
      teams,
      turn,
    };
  }
}
