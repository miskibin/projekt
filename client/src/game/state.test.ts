import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@shared/protocol";
import { INTERP_DELAY_MS, SnapshotBuffer } from "./state";

function snapshot(timeMs: number, x = timeMs / 10): GameSnapshot {
  return {
    tick: Math.round(timeMs / (1000 / 60)),
    time: timeMs / 1000,
    worms: [{
      id: 1,
      team: 0,
      name: "Test",
      x,
      y: 300,
      vx: 0,
      vy: 0,
      hp: 100,
      alive: true,
      facing: 1,
      aim: 0,
      onGround: true,
    }],
    projectiles: [],
    crates: [],
    mines: [],
    teams: [],
    turn: {
      phase: "active",
      activeTeam: 0,
      activeWormId: 1,
      timeLeft: 30 - timeMs / 1000,
      round: 1,
      wind: 0,
      suddenDeath: false,
      waterLevel: 650,
      selectedWeapon: "bazooka",
      weaponTimer: 3,
      chargePower: 0,
      shotsLeft: 1,
    },
  };
}

describe("SnapshotBuffer", () => {
  it("interpolates on simulation time when two network snapshots arrive in one burst", () => {
    const buffer = new SnapshotBuffer(INTERP_DELAY_MS);
    buffer.push(snapshot(0), 1000);
    buffer.push(snapshot(50), 1100);
    buffer.push(snapshot(100), 1100);

    // Baseline offset is 1000 ms, so render time is 55 ms in the host simulation.
    const state = buffer.sample(1000 + INTERP_DELAY_MS + 55);
    expect(state?.worms[0].x).toBeCloseTo(5.5, 5);
  });

  it("ignores late and duplicate snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(0), 1000);
    buffer.push(snapshot(50), 1050);
    buffer.push({ ...snapshot(50, 999), tick: snapshot(50).tick }, 1200);
    buffer.push({ ...snapshot(0, 999), tick: 0 }, 1200);

    expect(buffer.latest?.worms[0].x).toBe(5);
  });

  it("extrapolates through one late packet and then stops at a safe limit", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(0), 1000);
    buffer.push(snapshot(50), 1050);

    const shortlyLate = buffer.sample(1000 + INTERP_DELAY_MS + 80);
    const veryLate = buffer.sample(1000 + INTERP_DELAY_MS + 500);
    expect(shortlyLate?.worms[0].x).toBeCloseTo(8, 5);
    expect(veryLate?.worms[0].x).toBeCloseTo(13, 5);
  });

  it("keeps local mode delay configurable without changing the online default", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.interpolationDelayMs).toBe(INTERP_DELAY_MS);
    buffer.setInterpolationDelay(1000 / 30);
    expect(buffer.interpolationDelayMs).toBeCloseTo(1000 / 30);
  });
});
