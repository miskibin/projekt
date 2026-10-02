import type { GameConfig, WeaponId } from "@shared/protocol";
import { Rng } from "@shared/engine/rng";
import { TERRAIN_STYLES } from "@shared/engine/terrain";

export type SoloRoute = "supplies" | "armory";

/** Obie trasy stosują te same zasady dla gracza i przeciwnika. */
export const SOLO_ROUTES: Record<SoloRoute, { label: string; description: string }> = {
  supplies: { label: "Dostawy", description: "Losowy arsenał dla obu drużyn, częstsze skrzynki z bronią." },
  armory: { label: "Zbrojownia", description: "Pełny arsenał obu drużyn od pierwszej tury, mniej skrzynek." },
};

const ENCOUNTERS = [
  { name: "Zwiadowca", description: "Skraca dystans i szuka łatwego trafienia." },
  { name: "Piroman", description: "Podrzuca granaty i wykorzystuje obszarowe wybuchy." },
  { name: "Snajper", description: "Utrzymuje dystans i wybiera odizolowany cel." },
  { name: "Saper", description: "Atakuje grupy i zabezpiecza podejście minami." },
  { name: "Burza", description: "Celuje nalotem lub ostrzałem w kilka robaków." },
  { name: "Weteran", description: "Poluje na rannych i wykorzystuje okazje." },
  { name: "Boss", description: "Łączy precyzję, naloty i ataki obszarowe." },
] as const;

export function soloStageInfo(stage: number): { name: string; description: string; cycle: number } {
  const number = Math.max(1, Math.floor(stage) || 1);
  const encounter = ENCOUNTERS[(number - 1) % ENCOUNTERS.length]!;
  return { ...encounter, cycle: Math.floor((number - 1) / ENCOUNTERS.length) + 1 };
}

/** A checkpoint starts at the current arena; mid-shot physics are never serialized. */
export interface SoloRun {
  stage: number; seed: number; base: GameConfig; route: SoloRoute;
  perks: Partial<Record<SoloPerk, number>>;
  awaitingReward: boolean;
}
export const SOLO_PERKS = {
  vitality: { label: "Wytrzymałość", detail: "+8 HP każdego robaka na kolejnych arenach", weapon: null },
  sticky: { label: "Saper", detail: "+1 ładunek przylepny na każdej arenie", weapon: "sticky" },
  mortar: { label: "Artyleria", detail: "+1 moździerz na każdej arenie", weapon: "mortar" },
  railgun: { label: "Precyzja", detail: "+1 railgun na każdej arenie", weapon: "railgun" },
  repulsor: { label: "Kontrola", detail: "+1 impuls na każdej arenie", weapon: "repulsor" },
  mobility: { label: "Mobilność", detail: "+1 plecak odrzutowy na każdej arenie", weapon: "jetpack" },
  builder: { label: "Inżynier", detail: "+1 belka na każdej arenie", weapon: "girder" },
} as const;
export type SoloPerk = keyof typeof SOLO_PERKS;
export function soloRewards(run: Pick<SoloRun, "seed" | "stage" | "perks">): SoloPerk[] {
  const rng = new Rng((run.seed ^ Math.imul(run.stage, 104729)) >>> 0);
  const pool = (Object.keys(SOLO_PERKS) as SoloPerk[]).filter((id) => (run.perks[id] ?? 0) < 3);
  const offers: SoloPerk[] = [];
  while (pool.length && offers.length < 3) offers.push(pool.splice(rng.int(0,pool.length-1),1)[0]!);
  return offers;
}
export function soloLoadout(perks: SoloRun["perks"]): { hpBonus: number; ammo: Partial<Record<WeaponId, number>> } {
  const ammo: Partial<Record<WeaponId, number>> = {};
  for (const id of Object.keys(SOLO_PERKS) as SoloPerk[]) {
    const weapon = SOLO_PERKS[id].weapon;
    if (weapon) ammo[weapon] = Math.min(3, Math.max(0, perks[id] ?? 0));
  }
  return { hpBonus: Math.min(3, Math.max(0, perks.vitality ?? 0)) * 8, ammo };
}

interface SoloStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const RUN_KEY = "wormsy.expedition.v1";
const BEST_KEY = "wormsy.expedition.best.v1";
function storageOrNull(storage?: SoloStorage): SoloStorage | null {
  try { return storage ?? (typeof localStorage === "undefined" ? null : localStorage); } catch { return null; }
}
export function readSoloRun(base: GameConfig, storage?: SoloStorage): SoloRun | null {
  try {
    const raw = storageOrNull(storage)?.getItem(RUN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Number.isSafeInteger(data.stage) || data.stage < 1 || data.stage > 9999 ||
        !Number.isSafeInteger(data.seed) || data.seed < 0 || data.seed >= 0x7fffffff ||
        !["supplies", "armory"].includes(data.route) || typeof data.awaitingReward !== "boolean") return null;
    const perks: SoloRun["perks"] = {};
    for (const id of Object.keys(SOLO_PERKS) as SoloPerk[]) {
      const value = data.perks?.[id];
      if (Number.isSafeInteger(value) && value >= 0 && value <= 3) perks[id] = value;
    }
    return { stage: data.stage, seed: data.seed, route: data.route, awaitingReward: data.awaitingReward, perks, base };
  } catch { return null; }
}
export function saveSoloRun(run: SoloRun | null, storage?: SoloStorage): boolean {
  try {
    const target = storageOrNull(storage);
    if (!target) return false;
    if (run) target.setItem(RUN_KEY, JSON.stringify({ stage: run.stage, seed: run.seed, route: run.route,
      perks: run.perks, awaitingReward: run.awaitingReward }));
    else target.removeItem(RUN_KEY);
    return true;
  } catch { return false; }
}
export function soloBest(stage = 0, storage?: SoloStorage): number {
  try {
    const target = storageOrNull(storage);
    const parsed = Number(target?.getItem(BEST_KEY));
    const previous = Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9999 ? parsed : 0;
    const next = Math.max(previous, Math.min(9999, Math.max(0, Math.floor(stage) || 0)));
    if (next > previous) target?.setItem(BEST_KEY, String(next));
    return next;
  } catch { return Math.max(0, stage); }
}

/** Each encounter changes the arena, arsenal, time pressure and opponent. */
export function soloArena(base: GameConfig, runSeed: number, stage: number, route: SoloRoute = "supplies"): GameConfig {
  const number = Math.max(1, Math.floor(stage) || 1);
  const themes: GameConfig["theme"][] = ["grass", "desert", "snow", "hell"];
  // Wybór trasy nie rusza seeda mapy; można porównać ryzyko dwóch arsenałów na tej samej arenie.
  const value = (Math.imul((runSeed + number * 104729) >>> 0, 1664525) + 1013904223) >>> 0;
  return {
    ...base,
    seed: value % 0x7fffffff,
    mode: route === "armory" ? "classic" : "arsenal",
    // Drużyny rosną tylko przy nowych rozdziałach, inaczej późne pojedynki trwają za długo.
    wormsPerTeam: Math.min(4, 2 + Math.floor((number - 1) / 4)),
    turnTime: Math.max(38, 46 - Math.floor((number - 1) / 3) * 2),
    suddenDeathAfterRounds: Math.max(6, 9 - Math.floor((number - 1) / 4)),
    terrainDensity: 0.88 + (value % 5) * 0.07,
    theme: themes[(number - 1 + (runSeed % 4)) % 4]!,
    terrainStyle: TERRAIN_STYLES[(number - 1 + Math.floor(runSeed / 4)) % 4]!,
  };
}
