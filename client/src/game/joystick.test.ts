import { describe, expect, it } from "vitest";
import { clampJoystick, joystickControls } from "./joystick";

describe("virtual joystick", () => {
  it("keeps the center inside a dead zone", () => {
    expect(joystickControls(8, 50)).toEqual([]);
  });

  it("only controls horizontal movement", () => {
    expect(joystickControls(30, 50)).toEqual(["right"]);
    expect(joystickControls(-30, 50)).toEqual(["left"]);
  });

  it("clamps the knob to the horizontal track", () => {
    expect(clampJoystick(80, 50)).toBe(50);
    expect(clampJoystick(-80, 50)).toBe(-50);
  });
});
