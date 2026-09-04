import { RETREAT_TIME } from "../constants";
import type { WeaponId } from "../protocol";

// Tabela broni: startowa amunicja + parametry wybuchu i zachowania w turze.

export interface WeaponDef {
  id: WeaponId;
  /** startowa amunicja drużyny, -1 = nieskończona */
  ammo: number;
  /** czy moc strzału jest ładowana (CHARGE_TIME) */
  charge: boolean;
  /** narzędzie – użycie nie kończy tury */
  utility: boolean;
  /** czy potrzebny jest cel (akcja target) */
  target: "none" | "required" | "optional";
  /** ile strzałów w turze (shotgun = 2) */
  shots: number;
  /** promień wybuchu */
  radius: number;
  /** maksymalne obrażenia w epicentrum */
  damage: number;
  /** siła odrzutu (px/s) */
  power: number;
  /** ile sekund odwrotu po użyciu */
  retreat: number;
}

const D = (
  id: WeaponId,
  ammo: number,
  radius: number,
  damage: number,
  power: number,
  opts: Partial<WeaponDef> = {},
): WeaponDef => ({
  id,
  ammo,
  charge: false,
  utility: false,
  target: "none",
  shots: 1,
  radius,
  damage,
  power,
  retreat: RETREAT_TIME,
  ...opts,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  bazooka: D("bazooka", -1, 28, 45, 300, { charge: true }),
  grenade: D("grenade", -1, 30, 50, 320, { charge: true }),
  cluster: D("cluster", 2, 25, 35, 260, { charge: true }),
  banana: D("banana", 1, 30, 45, 300, { charge: true }),
  shotgun: D("shotgun", -1, 10, 25, 160, { shots: 2 }),
  uzi: D("uzi", 3, 5, 4, 70),
  holy: D("holy", 1, 70, 100, 600, { charge: true }),
  dynamite: D("dynamite", 1, 60, 75, 500, { retreat: 1.5 }),
  mine: D("mine", 2, 30, 45, 300, { retreat: 1.5 }),
  airstrike: D("airstrike", 1, 24, 30, 240, { target: "required" }),
  homing: D("homing", 1, 30, 45, 300, { charge: true, target: "optional" }),
  bat: D("bat", 2, 0, 30, 500),
  teleport: D("teleport", 2, 0, 0, 0, { target: "required", retreat: 0.7 }),
  girder: D("girder", 3, 0, 0, 0, { target: "required", utility: true }),
  jetpack: D("jetpack", 1, 0, 0, 0, { utility: true }),
  skip: D("skip", -1, 0, 0, 0),
};

export const WEAPON_IDS: readonly WeaponId[] = Object.keys(WEAPONS) as WeaponId[];

/** Bronie ze skończoną amunicją, które mogą wypaść ze skrzynki "weapon". */
export const CRATE_WEAPONS: readonly WeaponId[] = [
  "cluster",
  "banana",
  "holy",
  "dynamite",
  "mine",
  "airstrike",
  "homing",
  "uzi",
  "bat",
];

export const CRATE_UTILITIES: readonly WeaponId[] = ["teleport", "girder", "jetpack"];

/** Parametry odłamków (cluster / banana). */
export const CLUSTERLET = { radius: 16, damage: 20, power: 180 };
export const BANANALET = { radius: 24, damage: 35, power: 250 };
export const AIRSTRIKE_BOMB = { radius: 24, damage: 30, power: 240 };

export function startingAmmo(): Record<WeaponId, number> {
  const out = {} as Record<WeaponId, number>;
  for (const id of WEAPON_IDS) out[id] = WEAPONS[id].ammo;
  return out;
}
