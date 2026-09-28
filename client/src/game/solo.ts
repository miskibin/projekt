import type { GameConfig } from "@shared/protocol";

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

/** Kolejne starcia jednej wyprawy; wybór trasy i postępy trwają tylko do wyjścia z gry. */
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
  };
}
