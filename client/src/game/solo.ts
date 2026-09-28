import type { GameConfig } from "@shared/protocol";

/** Kolejne starcia jednej wyprawy; po jej zakończeniu nic nie zostaje zapisane. */
export function soloArena(base: GameConfig, runSeed: number, stage: number): GameConfig {
  const themes: GameConfig["theme"][] = ["grass", "desert", "snow", "hell"];
  const value = (Math.imul((runSeed + stage * 104729) >>> 0, 1664525) + 1013904223) >>> 0;
  return {
    ...base,
    seed: value % 0x7fffffff,
    mode: "arsenal",
    wormsPerTeam: Math.min(5, 2 + Math.floor((stage - 1) / 2)),
    turnTime: Math.max(30, 46 - Math.floor((stage - 1) / 2) * 3),
    suddenDeathAfterRounds: Math.max(5, 9 - Math.floor(stage / 3)),
    terrainDensity: 0.75 + (value % 5) * 0.12,
    theme: themes[(stage - 1 + (runSeed % 4)) % 4]!,
  };
}
