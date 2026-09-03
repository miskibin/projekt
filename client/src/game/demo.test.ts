import { describe, expect, it } from "vitest";
import type { GameConfig } from "@shared/protocol";
import { DemoDriver, chooseComputerShot } from "./demo";
import { MAX_SHOT_POWER, WORM_RADIUS } from "@shared/constants";
import { simulateTrajectory } from "./trajectory";

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

describe("single player against the computer", () => {
  it("keeps the human on team 0 and lets the computer take team 1 turns", () => {
    const game = new DemoDriver(config, "computer");
    expect(game.snapshot.teams.map((team) => team.name)).toEqual(["Ty", "Komputer"]);
    expect(game.controlledTeam).toBe(0);
    waitForTurn(game, 0);
    game.applyAction({ kind: "skipTurn" });
    waitForTurn(game, 1);
    expect(game.computerTurn).toBe(true);
    expect(game.controlledTeam).toBe(0);

    // Ręczne akcje w turze AI nie są przekazywane do silnika.
    game.applyAction({ kind: "fire", power: 1 });
    expect(game.snapshot.projectiles).toHaveLength(0);

    let computerFired = false;
    for (let i = 0; i < 240; i++) {
      const { events } = game.update();
      if (events.some((event) => event.t === "shot")) computerFired = true;
      if (computerFired) break;
    }
    expect(computerFired).toBe(true);
    for (let i = 0; i < 600 && game.snapshot.teams[0].totalHp === 200; i++) game.update();
    expect(game.snapshot.teams[0].totalHp).toBeLessThan(200);
  });

  it("chooses a useful but deliberately imperfect ballistic shot", () => {
    const shot = chooseComputerShot(200, 600, 780, 560, 1, 0, 2, 7);
    expect(shot.aim).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(shot.aim).toBeLessThanOrEqual(Math.PI / 2);
    expect(shot.power).toBeGreaterThanOrEqual(0.2);
    expect(shot.power).toBeLessThanOrEqual(1);
    expect(chooseComputerShot(200, 600, 780, 560, 1, 0, 2, 7)).toEqual(shot);
    const directionX = Math.cos(shot.aim);
    const directionY = Math.sin(shot.aim);
    const path = simulateTrajectory({
      x: 200 + directionX * (WORM_RADIUS + 3),
      y: 600 + directionY * (WORM_RADIUS + 3),
      vx: directionX * shot.power * MAX_SHOT_POWER,
      vy: directionY * shot.power * MAX_SHOT_POWER,
      maxTime: 4.5,
      maxPoints: 280,
    });
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < path.points.length; i += 2) {
      closest = Math.min(closest, Math.hypot(path.points[i] - 780, path.points[i + 1] - 560));
    }
    expect(closest).toBeLessThan(70);
  });
});
