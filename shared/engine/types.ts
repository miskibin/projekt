// Wewnętrzne typy encji silnika. Nie są częścią kontraktu sieciowego (patrz ../protocol.ts),
// ale są eksportowane, żeby moduły silnika mogły się nimi wymieniać.
import type { ExplosionStyle, GameEvent, WeaponId } from "../protocol";
import type { Terrain } from "./terrain";
import type { Rng } from "./rng";

export type DeathReason = "explosion" | "drown" | "fall" | "surrender";

export type ProjectileKind = WeaponId | "clusterlet" | "bananalet" | "airstrikeBomb" | "bullet";

export interface Worm {
  id: number;
  team: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  facing: 1 | -1;
  /** kąt względem kierunku patrzenia, [-PI/2, PI/2] */
  aim: number;
  onGround: boolean;
  anim?: string;
  /** licznik czasu animacji jednorazowej (bat) */
  animTimer: number;
  jetpackActive: boolean;
  jetpackFuel: number;
  /** krótki impuls ciągu w górę wywołany akcją "jump" przy aktywnym jetpacku */
  jetThrust: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** czas do wybuchu (s), undefined = brak zapalnika */
  fuse?: number;
  angle: number;
  age: number;
  dead: boolean;
  radius: number;
  damage: number;
  power: number;
  /** promień kolizji z terenem */
  hitRadius: number;
  gravityScale: number;
  windAffected: boolean;
  explodeOnContact: boolean;
  collidesWorms: boolean;
  bounces: boolean;
  restitution: number;
  ownerWorm: number;
  ownerTeam: number;
  /** cluster/banana: ile odłamków wyrzucić po wybuchu */
  shards: number;
  shardKind?: ProjectileKind;
  homingTarget?: { x: number; y: number };
  /** ile sekund od startu przed włączeniem naprowadzania */
  homingDelay: number;
  /** holy hand grenade: czas w bezruchu */
  restTimer: number;
  restFuse: number;
  sangHallelujah: boolean;
}

export interface Crate {
  id: number;
  kind: "health" | "weapon" | "utility";
  x: number;
  y: number;
  vy: number;
  landed: boolean;
  /** zawartość: broń (dla weapon/utility) albo ilość hp */
  weapon?: WeaponId;
  amount: number;
}

export interface Mine {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  armed: boolean;
  /** czas do uzbrojenia */
  armTimer: number;
  /** odliczanie po wykryciu robaka */
  fuse?: number;
  onGround: boolean;
  dead: boolean;
}

export interface TeamState {
  team: number;
  playerId: string;
  name: string;
  ammo: Record<WeaponId, number>;
  removed: boolean;
  selectedWeapon: WeaponId;
  weaponTimer: 1 | 2 | 3 | 4 | 5;
}

/** Kontekst udostępniany podmodułom silnika (pociski, skrzynki, miny). */
export interface EngineCtx {
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly worms: Worm[];
  readonly projectiles: Projectile[];
  readonly crates: Crate[];
  readonly mines: Mine[];
  readonly teams: TeamState[];
  wind: number;
  waterLevel: number;
  nextId(): number;
  emit(e: GameEvent): void;
  explode(x: number, y: number, r: number, dmg: number, power: number, style?: ExplosionStyle): void;
  damageWorm(w: Worm, amount: number, reason: DeathReason): void;
}
