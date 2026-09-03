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

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("window", new EventTarget());
    callbacks = {
      sendInput: vi.fn(), sendAction: vi.fn(), toggleWeaponPanel: vi.fn(),
      closeWeaponPanel: vi.fn(), toggleEscMenu: vi.fn(), gesture: vi.fn(),
      toggleMap: vi.fn(), fullscreen: vi.fn(),
    };
    input = new InputController(new EventTarget() as HTMLCanvasElement, new Camera(), callbacks);
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
});
