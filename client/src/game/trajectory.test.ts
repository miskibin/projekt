import { describe, expect, it } from "vitest";
import { GRAVITY } from "@shared/constants";
import { raycast, simulateTrajectory } from "./trajectory";

describe("simulateTrajectory", () => {
  it("bez grawitacji i wiatru leci po prostej", () => {
    const tr = simulateTrajectory({ x: 100, y: 100, vx: 200, vy: 0, gravity: 0, maxTime: 1 });
    expect(tr.stop).toBe("timeout");
    expect(tr.endX).toBeGreaterThan(280);
    expect(Math.abs(tr.endY - 100)).toBeLessThan(0.001);
    expect(tr.points.length).toBeGreaterThan(4);
  });

  it("odwzorowuje parabolę z grawitacją silnika", () => {
    const v0 = 300;
    const tr = simulateTrajectory({ x: 0, y: 0, vx: v0, vy: -v0, maxTime: 0.5, maxPoints: 1000 });
    // po czasie t: x = v0*t, y = -v0*t + g*t^2/2 (z dokładnością do kroku całkowania)
    const t = tr.time;
    expect(tr.endX).toBeCloseTo(v0 * t, 0);
    const expectedY = -v0 * t + (GRAVITY * t * t) / 2;
    expect(Math.abs(tr.endY - expectedY)).toBeLessThan(4);
  });

  it("wiatr przesuwa tor w swoją stronę", () => {
    const base = simulateTrajectory({ x: 0, y: 0, vx: 200, vy: -300, maxTime: 1 });
    const windy = simulateTrajectory({ x: 0, y: 0, vx: 200, vy: -300, wind: 120, maxTime: 1 });
    expect(windy.endX).toBeGreaterThan(base.endX + 20);
  });

  it("zatrzymuje się na terenie", () => {
    const tr = simulateTrajectory({
      x: 0,
      y: 0,
      vx: 300,
      vy: 0,
      isSolid: (x) => x >= 150,
      maxTime: 5,
    });
    expect(tr.stop).toBe("terrain");
    expect(tr.endX).toBeGreaterThanOrEqual(150);
    expect(tr.endX).toBeLessThan(156);
  });

  it("kończy na poziomie wody", () => {
    const tr = simulateTrajectory({ x: 0, y: 0, vx: 50, vy: 100, waterLevel: 200, maxTime: 5 });
    expect(tr.stop).toBe("water");
    expect(tr.endY).toBe(200);
  });

  it("kończy po wyjściu poza świat", () => {
    const tr = simulateTrajectory({ x: 0, y: 0, vx: 900, vy: 0, gravity: 0, worldWidth: 500, maxTime: 5 });
    expect(tr.stop).toBe("outside");
    expect(tr.endX).toBeGreaterThan(500);
  });

  it("respektuje limit punktów", () => {
    const tr = simulateTrajectory({ x: 0, y: 0, vx: 1, vy: 0, gravity: 0, maxTime: 60, maxPoints: 20 });
    expect(tr.points.length).toBeLessThanOrEqual(20 * 2 + 2);
  });
});

describe("raycast", () => {
  it("trafia w teren", () => {
    const r = raycast({ x: 0, y: 0, dx: 1, dy: 0, isSolid: (x) => x >= 100 });
    expect(r.stop).toBe("terrain");
    expect(r.endX).toBeGreaterThanOrEqual(100);
    expect(r.endX).toBeLessThan(104);
  });

  it("normalizuje kierunek i respektuje maxLen", () => {
    const r = raycast({ x: 0, y: 0, dx: 3, dy: 4, maxLen: 100 });
    expect(r.stop).toBe("timeout");
    expect(Math.hypot(r.endX, r.endY)).toBeCloseTo(100, 0);
  });

  it("kończy na wodzie", () => {
    const r = raycast({ x: 0, y: 0, dx: 0, dy: 1, waterLevel: 50 });
    expect(r.stop).toBe("water");
    expect(r.endY).toBe(50);
  });
});
