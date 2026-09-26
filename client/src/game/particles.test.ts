import { describe, expect, it } from "vitest";
import { Particles } from "./particles";

describe("efekty wybuchów", () => {
  it("różne bronie mają efekt i całość znika po zakończeniu animacji", () => {
    const particles = new Particles();
    for (const style of ["bazooka", "cluster", "banana", "holy", "dynamite", "airstrike"] as const) {
      particles.explosion(500, 500, 32, "#806040", style);
    }
    expect(particles.count).toBeGreaterThan(100);
    for (let i = 0; i < 200; i++) particles.update(1 / 60);
    expect(particles.count).toBe(0);
  });

  it("salwa wielu wybuchów ma ograniczoną liczbę obiektów", () => {
    const particles = new Particles();
    for (let i = 0; i < 60; i++) particles.explosion(400 + i, 500, 24, "#806040", "airstrike");
    expect(particles.count).toBeLessThanOrEqual(1400 + 24 + 16 + 24 + 24);
    particles.clear();
    expect(particles.count).toBe(0);
  });
});
