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
  grenade: D("grenade", -1, 34, 55, 350, { charge: true }),
  cluster: D("cluster", 2, 18, 20, 170, { charge: true }),
  banana: D("banana", 1, 22, 25, 200, { charge: true }),
  shotgun: D("shotgun", -1, 9, 22, 145, { shots: 2 }),
  uzi: D("uzi", 3, 5, 4, 70),
  holy: D("holy", 1, 70, 100, 600, { charge: true }),
  dynamite: D("dynamite", 1, 58, 85, 620, { retreat: 1.5 }),
  mine: D("mine", 2, 26, 55, 420, { retreat: 1.5 }),
  airstrike: D("airstrike", 1, 21, 32, 250, { target: "required" }),
  homing: D("homing", 1, 32, 50, 330, { charge: true, target: "optional" }),
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
export const CLUSTERLET = { radius: 14, damage: 17, power: 155 };
export const BANANALET = { radius: 23, damage: 32, power: 255 };
export const AIRSTRIKE_BOMB = { radius: 21, damage: 32, power: 250 };

export function startingAmmo(): Record<WeaponId, number> {
  const out = {} as Record<WeaponId, number>;
  for (const id of WEAPON_IDS) out[id] = WEAPONS[id].ammo;
  return out;
}
