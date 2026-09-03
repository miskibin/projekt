import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../constants";
import type { GameConfig, GameEvent, WeaponId } from "../protocol";
import { createGame, Rng, WEAPON_IDS, type Game } from "./index";

const CONFIG: GameConfig = {
  wormsPerTeam: 3,
  turnTime: 8,
  suddenDeathAfterRounds: 3,
  seed: 987654,
  terrainDensity: 1,
  theme: "grass",
};

function assertFinite(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Nieskończona/NaN wartość w ${path}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertFinite(v, `${path}.${k}`);
  }
}

/** Losowy, ale deterministyczny "gracz". */
function randomTurn(g: Game, rng: Rng): void {
  const s = g.snapshot();
  const t = s.turn;
  if (t.activeTeam < 0) return;
  if (t.phase !== "active" && t.phase !== "retreat") return;

  g.applyInput(t.activeTeam, {
    left: rng.chance(0.25),
    right: rng.chance(0.25),
    aim: rng.range(-Math.PI / 2, Math.PI / 2),
    charge: rng.chance(0.4),
  });

  if (t.phase !== "active") return;
  const roll = rng.next();
  if (roll < 0.05) {
    const weapon = rng.pick(WEAPON_IDS) as WeaponId;
    g.applyAction(t.activeTeam, { kind: "selectWeapon", weapon });
  } else if (roll < 0.08) {
    g.applyAction(t.activeTeam, {
      kind: "target",
      x: rng.range(0, 1920),
      y: rng.range(0, 1080),
    });
  } else if (roll < 0.1) {
    g.applyAction(t.activeTeam, { kind: "fire", power: rng.range(0.1, 1) });
  } else if (roll < 0.12) {
    g.applyAction(t.activeTeam, { kind: "jump" });
  } else if (roll < 0.13) {
    g.applyAction(t.activeTeam, { kind: "backflip" });
  } else if (roll < 0.135) {
    g.applyAction(t.activeTeam, { kind: "girderRotate" });
  } else if (roll < 0.14) {
    g.applyAction(t.activeTeam, { kind: "setTimer", seconds: (rng.int(1, 5) as 1 | 2 | 3 | 4 | 5) });
  } else if (roll < 0.142) {
    g.applyAction(t.activeTeam, { kind: "skipTurn" });
  }
}

describe("symulacja losowa", () => {
  it("3000 kroków losowego strzelania bez NaN i wyjątków", () => {
    const g = createGame(CONFIG, [
      { team: 0, playerId: "a", name: "Alfa" },
      { team: 1, playerId: "b", name: "Beta" },
      { team: 2, playerId: "c", name: "Gamma" },
      { team: 3, playerId: "d", name: "Delta" },
    ]);
    const rng = new Rng(0xc0ffee);
    let events = 0;
    for (let i = 0; i < 3000; i++) {
      randomTurn(g, rng);
      g.step(FIXED_DT);
      const evs: GameEvent[] = g.drainEvents();
      events += evs.length;
      assertFinite(evs, `events[${i}]`);
      if (i % 10 === 0) assertFinite(g.snapshot(), `snapshot[${i}]`);
      if (g.isOver()) break;
    }
    const snap = g.snapshot();
    assertFinite(snap, "snapshot");
    expect(events).toBeGreaterThan(0);
    for (const w of snap.worms) {
      expect(w.hp).toBeGreaterThanOrEqual(0);
      expect(w.hp).toBeLessThanOrEqual(100);
    }
  });

  it("wiele seedów przeżywa 800 kroków losowej gry", () => {
    for (const seed of [1, 2, 3, 12345, 777777]) {
      const g = createGame({ ...CONFIG, seed }, [
        { team: 0, playerId: "a", name: "Alfa" },
        { team: 1, playerId: "b", name: "Beta" },
      ]);
      const rng = new Rng(seed ^ 0x5eed);
      for (let i = 0; i < 800; i++) {
        randomTurn(g, rng);
        g.step(FIXED_DT);
        g.drainEvents();
        if (g.isOver()) break;
      }
      assertFinite(g.snapshot(), `seed ${seed}`);
    }
  });
});
