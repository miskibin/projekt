import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../constants";
import type { GameEvent } from "../protocol";
import { createGame } from "./index";
import { GameImpl } from "./game";
import { detonateProjectile, makeProjectile, stepProjectiles } from "./projectiles";

function flatWorld(): GameImpl {
  const game = createGame({
    seed: 219, wormsPerTeam: 1, turnTime: 45, suddenDeathAfterRounds: 10,
    terrainDensity: 1, theme: "grass",
  }, [
    { team: 0, playerId: "a", name: "A" },
    { team: 1, playerId: "b", name: "B" },
  ]) as GameImpl;
  game.terrain.data.fill(0);
  for (let y = 450; y < game.terrain.height; y++) {
    game.terrain.data.fill(1, y * game.terrain.width, (y + 1) * game.terrain.width);
  }
  game.worms.forEach((w, i) => { w.x = i * 1200 + 50; w.y = 200; });
  game.barrels.length = 0;
  game.mines.length = 0;
  game.projectiles.length = 0;
  game.drainEvents();
  return game;
}

describe("właściwe skutki broni", () => {
  it("rakieta naprowadzana wybucha przy wskazanym punkcie w powietrzu", () => {
    const g = flatWorld();
    makeProjectile(g, {
      kind: "homing", x: 200, y: 320, vx: 300, vy: 0, gravityScale: 0,
      radius: 40, damage: 50, power: 330, homingTarget: { x: 400, y: 320 },
      homingDelay: 0, explodeOnContact: true,
    });
    const events: GameEvent[] = [];
    for (let i = 0; i < 100; i++) {
      stepProjectiles(g, FIXED_DT);
      events.push(...g.drainEvents());
    }
    const blast = events.find((e): e is Extract<GameEvent, { t: "explosion" }> =>
      e.t === "explosion" && e.style === "homing");
    expect(blast).toBeDefined();
    expect(Math.hypot(blast!.x - 400, blast!.y - 320)).toBeLessThanOrEqual(16);
  });

  it("wiertło kończy po przewierceniu określonej długości i wybucha pod ziemią", () => {
    const g = flatWorld();
    makeProjectile(g, {
      kind: "drill", x: 200, y: 490, vx: 300, vy: 0, gravityScale: 0,
      fuse: 3, radius: 34, damage: 42, power: 260, hitRadius: 4,
    });
    const events: GameEvent[] = [];
    for (let i = 0; i < 110 && !events.some((e) => e.t === "explosion" && e.style === "drill"); i++) {
      stepProjectiles(g, FIXED_DT);
      events.push(...g.drainEvents());
    }
    const blast = events.find((e): e is Extract<GameEvent, { t: "explosion" }> =>
      e.t === "explosion" && e.style === "drill");
    expect(blast).toBeDefined();
    expect(blast!.x).toBeGreaterThan(335);
    expect(blast!.x).toBeLessThan(370);
    expect(g.terrain.isSolid(255, 490)).toBe(false);
    expect(events.filter((e) => e.t === "burrow").length).toBeGreaterThan(9);
  });

  it("odłamkowy i banan tworzą serię oddzielnych kraterów także tuż nad ziemią", () => {
    for (const kind of ["cluster", "banana"] as const) {
      const g = flatWorld();
      const p = makeProjectile(g, {
        kind, x: 650, y: 440, vx: 0, vy: 0,
        radius: kind === "banana" ? 27 : 20, damage: 15, power: 155,
        shards: kind === "banana" ? 8 : 10,
        shardKind: kind === "banana" ? "bananalet" : "clusterlet",
      });
      detonateProjectile(g, p);
      g.drainEvents();
      const events: GameEvent[] = [];
      for (let i = 0; i < 125; i++) {
        stepProjectiles(g, FIXED_DT);
        events.push(...g.drainEvents());
      }
      const blasts = events.filter((e): e is Extract<GameEvent, { t: "explosion" }> =>
        e.t === "explosion" && e.style === (kind === "cluster" ? "clusterlet" : "banana"));
      expect(blasts.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...blasts.map((b) => b.x)) - Math.min(...blasts.map((b) => b.x))).toBeGreaterThan(110);
    }
  });
});
