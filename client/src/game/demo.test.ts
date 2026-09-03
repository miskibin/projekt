import { describe, expect, it } from "vitest";
import type { GameConfig } from "@shared/protocol";
import { DemoDriver } from "./demo";

const config: GameConfig = {
  wormsPerTeam: 2, turnTime: 45, suddenDeathAfterRounds: 10,
  seed: 20240917, terrainDensity: 1, theme: "grass",
};

function waitForTurn(demo: DemoDriver, team: number): void {
  for (let i = 0; i < 1200; i++) {
    const { turn } = demo.snapshot;
    if (turn.activeTeam === team && turn.phase === "active") return;
    demo.update();
  }
  throw new Error(`Nie rozpoczęła się tura drużyny ${team}`);
}

describe("playable two-player demo", () => {
  it("runs two real teams and routes input and weapons to each active player", () => {
    const demo = new DemoDriver(config);
    expect(demo.snapshot.teams.map((team) => team.name)).toEqual(["Gracz 1", "Gracz 2"]);
    expect(demo.snapshot.worms).toHaveLength(4);

    for (const team of [0, 1]) {
      waitForTurn(demo, team);
      demo.applyInput({ left: false, right: false, aim: -0.8, charge: false });
      const active = demo.snapshot.worms.find((worm) => worm.id === demo.snapshot.turn.activeWormId)!;
      expect(active.team).toBe(team);
      expect(active.aim).toBe(-0.8);
      demo.applyAction({ kind: "selectWeapon", weapon: "grenade" });
      expect(demo.snapshot.turn.selectedWeapon).toBe("grenade");
      demo.applyAction({ kind: "fire", power: 0.4 });
      expect(demo.snapshot.projectiles.some((projectile) => projectile.kind === "grenade")).toBe(true);
    }
  });

  it("skips to the other player and completes a match with a winner", () => {
    const demo = new DemoDriver(config);
    waitForTurn(demo, 0);
    demo.applyAction({ kind: "skipTurn" });
    waitForTurn(demo, 1);
    demo.applyAction({ kind: "surrender" });
    for (let i = 0; i < 600 && !demo.isOver; i++) demo.update();
    expect(demo.isOver).toBe(true);
    expect(demo.winner).toEqual({ team: 0, name: "Gracz 1" });
  });

  it("starts a fresh match without carrying over damage, ammo or turns", () => {
    const previous = new DemoDriver(config);
    waitForTurn(previous, 0);
    previous.applyAction({ kind: "surrender" });
    const fresh = new DemoDriver(config);
    expect(fresh.isOver).toBe(false);
    expect(fresh.snapshot.teams.every((team) => team.totalHp === 200)).toBe(true);
    expect(fresh.snapshot.turn.round).toBe(1);
    expect(fresh.snapshot.turn.activeTeam).toBe(0);
  });
});
