import type { TouchControl } from "./input";

export function clampJoystick(dx: number, radius: number): number {
  return Math.max(-radius, Math.min(radius, dx));
}

export function joystickControls(dx: number, radius: number, deadZone = 0.22): TouchControl[] {
  if (radius <= 0) return [];
  const threshold = radius * deadZone;
  if (dx < -threshold) return ["left"];
  if (dx > threshold) return ["right"];
  return [];
}
