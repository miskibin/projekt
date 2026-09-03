import { describe, expect, it } from "vitest";
import { clampJoystick, joystickControls } from "./joystick";

describe("virtual joystick", () => {
  it("keeps the center inside a dead zone", () => {
    expect(joystickControls(8, -9, 50)).toEqual([]);
  });

  it("allows movement and aiming at the same time", () => {
    expect(joystickControls(30, -28, 50)).toEqual(["right", "aimUp"]);
    expect(joystickControls(-30, 28, 50)).toEqual(["left", "aimDown"]);
  });

  it("clamps the knob to the circular base", () => {
    const result = clampJoystick(80, 60, 50);
    expect(result.x).toBeCloseTo(40);
    expect(result.y).toBeCloseTo(30);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(50);
  });
});
