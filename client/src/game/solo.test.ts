import { describe, expect, it } from "vitest";
import type { GameConfig } from "@shared/protocol";
import { soloArena } from "./solo";
import { DemoDriver } from "./demo";

const base: GameConfig = { wormsPerTeam: 2, turnTime: 45, suddenDeathAfterRounds: 10,
  seed: 26, terrainDensity: 1, theme: "grass" };

describe("wyprawa solo", () => {
  it("losuje kolejne areny i podnosi wyzwanie bez zapisywania postępu", () => {
    const first = soloArena(base, 91, 1);
    const next = soloArena(base, 91, 2);
    const far = soloArena(base, 91, 10);
    expect(first).toEqual(soloArena(base, 91, 1));
    expect(first.seed).not.toBe(next.seed);
    expect(first.mode).toBe("arsenal");
    expect(far.wormsPerTeam).toBeGreaterThan(first.wormsPerTeam);
    expect(far.turnTime).toBeLessThan(first.turnTime);
    expect(new DemoDriver(first, "gauntlet", 1).snapshot.teams[1]?.name).toBe("Zwiadowca");
    expect(new DemoDriver(next, "gauntlet", 2).snapshot.teams[1]?.name).toBe("Piroman");
  });
});
