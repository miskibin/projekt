import { describe, expect, it } from "vitest";
import { coverPlacement } from "./background";

describe("coverPlacement", () => {
  it("covers a wide mobile viewport throughout the parallax range", () => {
    for (const pan of [-1, 0, 1]) {
      const frame = coverPlacement(2880, 1621, 830, 360, pan, pan);
      expect(frame.x).toBeLessThanOrEqual(0);
      expect(frame.y).toBeLessThanOrEqual(0);
      expect(frame.x + frame.width).toBeGreaterThanOrEqual(830);
      expect(frame.y + frame.height).toBeGreaterThanOrEqual(360);
    }
  });

  it("covers a portrait viewport without stretching the artwork", () => {
    const frame = coverPlacement(2880, 1621, 390, 844, 0.7, -0.4);
    expect(frame.width).toBeGreaterThanOrEqual(390);
    expect(frame.height).toBeGreaterThanOrEqual(844);
    expect(frame.width / frame.height).toBeCloseTo(2880 / 1621, 6);
  });
});
