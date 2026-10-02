import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHARGE_TIME } from "@shared/constants";
import type { WormSnapshot } from "@shared/protocol";
import { Camera } from "./camera";
import { InputController, type InputCallbacks } from "./input";

const worm: WormSnapshot = {
  id: 1, team: 0, name: "Test", x: 500, y: 400, vx: 0, vy: 0,
  hp: 100, alive: true, facing: -1, aim: -0.5, onGround: true,
};

describe("game controls", () => {
  let input: InputController;
  let callbacks: InputCallbacks;
  let now: number;
  let canvas: HTMLCanvasElement;
  let camera: Camera;

  function pointer(type: string, x: number, y: number, button = 0, pointerType = "mouse") {
    const screen = camera.worldToScreen(x, y);
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      clientX: screen.x, clientY: screen.y, pointerId: 1, pointerType, button, altKey: false,
    }));
  }

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("window", new EventTarget());
    callbacks = {
      sendInput: vi.fn(), sendAction: vi.fn(), sendDefense: vi.fn(), selectDefense: vi.fn(), selectDefenseAt: vi.fn(), toggleWeaponPanel: vi.fn(),
      closeWeaponPanel: vi.fn(), toggleEscMenu: vi.fn(), gesture: vi.fn(),
      toggleMap: vi.fn(), fullscreen: vi.fn(),
    };
    canvas = Object.assign(new EventTarget(), { focus: vi.fn(), setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
    camera = new Camera();
    camera.setViewport(1000, 650);
    input = new InputController(canvas, camera, callbacks);
    input.setContext({ myTurn: true, worm, weapon: "bazooka", blocked: false });
  });

  afterEach(() => {
    input.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("charges while held and fires once at the power selected on release", () => {
    input.pressControl("fire");
    now = CHARGE_TIME * 1000 * 0.6;
    input.update(1 / 60);
    expect(input.chargePower).toBeCloseTo(0.6);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    input.releaseControl("fire");
    input.releaseControl("fire");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "fire", power: 0.6 });
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: false, right: false, aim: -0.5, charge: false });
  });

  it("fires automatically at full power without firing again on release", () => {
    input.pressControl("fire");
    now = CHARGE_TIME * 1000 + 50;
    input.update(1 / 60);
    input.update(1 / 60);
    input.releaseControl("fire");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "fire", power: 1 });
    expect(input.isCharging).toBe(false);
  });

  it("uses the same hold/release behavior for the space bar, including key repeat", () => {
    const key = (type: string, repeat = false) => window.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), { code: "Space", repeat }),
    );
    key("keydown");
    now = CHARGE_TIME * 1000 * 0.5;
    key("keydown", true);
    input.update(1 / 60);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    key("keyup");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "fire", power: 0.5 });
  });

  it.each(["cancel", "menu", "turn", "blur"])("cancels charging on %s without a stray shot", (reason) => {
    input.pressControl("fire");
    input.pressControl("left");
    input.update(1 / 60);
    now = 900;
    if (reason === "cancel") input.cancelControls();
    if (reason === "menu") input.setContext({ myTurn: true, worm, weapon: "bazooka", blocked: true });
    if (reason === "turn") input.setContext({ myTurn: true, worm: { ...worm, id: 2 }, weapon: "bazooka", blocked: false });
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    input.releaseControl("fire");
    input.update(1 / 60);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: false, right: false, aim: -0.5, charge: false });
  });

  it("keeps left-facing aim as a pitch understood by the engine", () => {
    input.pressControl("left");
    input.update(1 / 60);
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: true, right: false, aim: -0.5, charge: false });
    input.releaseControl("left");
    input.update(1 / 60);
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: false, right: false, aim: -0.5, charge: false });
  });

  it("fires an instant weapon on press without starting a second shot on release", () => {
    input.setContext({ myTurn: true, worm, weapon: "shotgun", blocked: false });
    input.pressControl("fire");
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: false, right: false, aim: -0.5, charge: false });
    input.pressControl("fire");
    input.releaseControl("fire");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "fire", power: 1 });
    expect(input.isCharging).toBe(false);
  });

  it("uses the ordinary movement and jump controls for one defensive response without firing", () => {
    input.setContext({ myTurn: false, defenseReady: true, worm: null, weapon: "bazooka", blocked: false });
    input.pressControl("left");
    input.pressControl("jump");
    input.pressControl("fire");
    expect(callbacks.sendDefense).toHaveBeenNthCalledWith(1, "left");
    expect(callbacks.sendDefense).toHaveBeenNthCalledWith(2, "jump");
    expect(callbacks.sendDefense).toHaveBeenCalledTimes(2);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
  });

  it("switches the defending worm using the ordinary aim buttons", () => {
    input.setContext({ myTurn: false, defenseReady: false, worm: null, weapon: "bazooka", blocked: false });
    input.pressControl("aimUp");
    input.pressControl("aimDown");
    expect(callbacks.selectDefense).toHaveBeenNthCalledWith(1, -1);
    expect(callbacks.selectDefense).toHaveBeenNthCalledWith(2, 1);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
  });

  it("aims to either side of a stationary worm and charges with the left mouse button", () => {
    const pan = vi.spyOn(camera, "panBy");
    pointer("pointermove", 600, 320);
    input.update(0.06);
    expect(callbacks.sendInput).toHaveBeenLastCalledWith({ left: false, right: false,
      facing: 1, aim: Math.atan2(-80, 100), charge: false });
    pointer("pointerdown", 400, 320);
    now = CHARGE_TIME * 1000 * 0.6;
    pointer("pointermove", 380, 320);
    input.update(0.06);
    expect(input.currentState.facing).toBe(-1);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    pointer("pointerup", 380, 320);
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "fire", power: 0.6 });
    expect(pan).not.toHaveBeenCalled();
  });

  it("uses the middle mouse button exclusively for panning", () => {
    const pan = vi.spyOn(camera, "panBy");
    pointer("pointerdown", 600, 320, 1);
    pointer("pointermove", 650, 320, 1);
    pointer("pointerup", 650, 320, 1);
    expect(pan).toHaveBeenCalled();
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    expect(input.isCharging).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture"])("cancels a mouse charge on %s without a shot", type => {
    pointer("pointerdown", 600, 320);
    now = 800;
    pointer(type, 600, 320);
    pointer("pointerup", 600, 320);
    expect(callbacks.sendAction).not.toHaveBeenCalled();
    expect(input.isCharging).toBe(false);
  });

  it("sends one target action for an instant targeted weapon without firing it twice", () => {
    input.setContext({ myTurn: true, worm, weapon: "teleport", blocked: false });
    pointer("pointerdown", 600, 320);
    pointer("pointerup", 600, 320);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "target", x: 600, y: 320 });
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
  });

  it("keeps touch homing target selection separate from charging the rocket", () => {
    input.setContext({ myTurn: true, worm, weapon: "homing", blocked: false });
    pointer("pointerdown", 600, 320, 0, "touch");
    pointer("pointerup", 600, 320, 0, "touch");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "target", x: 600, y: 320 });
    input.pressControl("fire");
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    now = CHARGE_TIME * 1000 * 0.4;
    input.releaseControl("fire");
    expect(callbacks.sendAction).toHaveBeenLastCalledWith({ kind: "fire", power: 0.4 });
  });

  it("jumps with W once without changing the aim or repeating the jump", () => {
    window.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyW", repeat: false }));
    window.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyW", repeat: true }));
    input.update(0.1);
    expect(callbacks.sendAction).toHaveBeenCalledTimes(1);
    expect(callbacks.sendAction).toHaveBeenCalledWith({ kind: "jump" });
    expect(input.aimPitch).toBe(-0.5);
  });
});
