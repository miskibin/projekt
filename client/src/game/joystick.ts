import type { TouchControl } from "./input";

export interface JoystickVector {
  x: number;
  y: number;
}

export function clampJoystick(dx: number, dy: number, radius: number): JoystickVector {
  const length = Math.hypot(dx, dy);
  if (length <= radius || length === 0) return { x: dx, y: dy };
  const scale = radius / length;
  return { x: dx * scale, y: dy * scale };
}

export function joystickControls(dx: number, dy: number, radius: number, deadZone = 0.22): TouchControl[] {
  if (radius <= 0) return [];
  const controls: TouchControl[] = [];
  const threshold = radius * deadZone;
  if (dx < -threshold) controls.push("left");
  else if (dx > threshold) controls.push("right");
  if (dy < -threshold) controls.push("aimUp");
  else if (dy > threshold) controls.push("aimDown");
  return controls;
}
