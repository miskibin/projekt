import { CHARGE_TIME } from "@shared/constants";
import type { InputAction, InputState, WeaponId, WormSnapshot } from "@shared/protocol";
import type { Camera } from "./camera";
import { NO_CHARGE, TARGETED } from "./weapons";

export interface InputCallbacks {
  sendInput(state: InputState): void;
  sendAction(action: InputAction): void;
  toggleWeaponPanel(): void;
  closeWeaponPanel(): void;
  toggleEscMenu(): void;
  gesture(): void;
}

export interface InputContext {
  myTurn: boolean;
  worm: WormSnapshot | null;
  weapon: WeaponId;
  /** blokada wejścia gdy otwarty jest panel/menu */
  blocked: boolean;
}

const SEND_INTERVAL = 1 / 20;
const RESEND_INTERVAL = 0.1;

/**
 * Klawiatura + mysz. Zamienia lokalny „pitch" (−π/2..π/2) i facing robaka na bezwzględny
 * kąt `aim` z protokołu (0 = w prawo, ujemny = w górę).
 */
export class InputController {
  private keys = new Set<string>();
  private pitch = -0.35;
  private state: InputState = { left: false, right: false, aim: 0, charge: false };
  private lastSent: InputState | null = null;
  private acc = 0;
  private sinceSend = 0;
  private chargeStart = 0;
  private charging = false;
  private ctxInfo: InputContext = { myTurn: false, worm: null, weapon: "bazooka", blocked: false };

  /** pozycja myszy w koordynatach ekranu i świata */
  mouseSX = 0;
  mouseSY = 0;
  mouseWX = 0;
  mouseWY = 0;
  mouseOnCanvas = false;

  private dragging = false;
  private dragMoved = 0;
  private dragX = 0;
  private dragY = 0;

  private listeners: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly cb: InputCallbacks,
  ) {
    this.bind();
  }

  get chargePower(): number {
    if (!this.charging) return 0;
    return Math.min(1, (performance.now() - this.chargeStart) / 1000 / CHARGE_TIME);
  }

  get isCharging(): boolean {
    return this.charging;
  }

  get aimPitch(): number {
    return this.pitch;
  }

  setContext(c: InputContext): void {
    this.ctxInfo = c;
    if (!c.myTurn && this.charging) {
      this.charging = false;
      this.state.charge = false;
    }
  }

  private on<K extends keyof WindowEventMap>(
    target: Window | HTMLElement,
    type: K,
    fn: (ev: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    const h = fn as EventListener;
    target.addEventListener(type, h, opts);
    this.listeners.push(() => target.removeEventListener(type, h, opts));
  }

  private bind(): void {
    this.on(window, "keydown", (e) => this.onKeyDown(e));
    this.on(window, "keyup", (e) => this.onKeyUp(e));
    this.on(window, "blur", () => {
      this.keys.clear();
      this.charging = false;
      this.state.left = this.state.right = this.state.charge = false;
    });
    this.on(this.canvas, "mousemove", (e) => this.onMouseMove(e));
    this.on(this.canvas, "mousedown", (e) => this.onMouseDown(e));
    this.on(window, "mouseup", (e) => this.onMouseUp(e));
    this.on(this.canvas, "mouseenter", () => (this.mouseOnCanvas = true));
    this.on(this.canvas, "mouseleave", () => {
      this.mouseOnCanvas = false;
      this.dragging = false;
    });
    this.on(this.canvas, "wheel", (e) => {
      e.preventDefault();
      this.camera.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, this.mouseWX, this.mouseWY);
    }, { passive: false });
    this.on(this.canvas, "contextmenu", (e) => {
      e.preventDefault();
      this.cb.toggleWeaponPanel();
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    this.cb.gesture();

    if (e.code === "Escape") {
      e.preventDefault();
      this.cb.toggleEscMenu();
      return;
    }
    if (e.code === "Tab") {
      e.preventDefault();
      if (!e.repeat) this.cb.toggleWeaponPanel();
      return;
    }
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "F1"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) {
      this.keys.add(e.code);
      return;
    }
    this.keys.add(e.code);
    if (this.ctxInfo.blocked || !this.ctxInfo.myTurn) return;

    switch (e.code) {
      case "Enter":
        this.cb.sendAction({ kind: "jump" });
        break;
      case "Backspace":
        this.cb.sendAction({ kind: "backflip" });
        break;
      case "F1":
        this.cb.sendAction({ kind: "skipTurn" });
        break;
      case "KeyR":
        if (this.ctxInfo.weapon === "girder") this.cb.sendAction({ kind: "girderRotate" });
        break;
      case "Space": {
        const w = this.ctxInfo.weapon;
        if (NO_CHARGE.has(w)) {
          this.cb.sendAction({ kind: "fire", power: 1 });
        } else {
          this.charging = true;
          this.chargeStart = performance.now();
          this.state.charge = true;
          this.flushInput();
        }
        break;
      }
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5": {
        const s = Number(e.code.slice(5)) as 1 | 2 | 3 | 4 | 5;
        this.cb.sendAction({ kind: "setTimer", seconds: s });
        break;
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.code === "Space" && this.charging) {
      const power = this.chargePower;
      this.charging = false;
      this.state.charge = false;
      if (this.ctxInfo.myTurn && !this.ctxInfo.blocked) {
        this.cb.sendAction({ kind: "fire", power: Math.max(0.05, power) });
      }
      this.flushInput();
    }
  }

  private updateMouseWorld(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouseSX = e.clientX - r.left;
    this.mouseSY = e.clientY - r.top;
    const w = this.camera.screenToWorld(this.mouseSX, this.mouseSY);
    this.mouseWX = w.x;
    this.mouseWY = w.y;
  }

  private onMouseMove(e: MouseEvent): void {
    const prevSX = this.mouseSX;
    const prevSY = this.mouseSY;
    this.updateMouseWorld(e);
    this.mouseOnCanvas = true;

    if (this.dragging) {
      const dx = this.mouseSX - prevSX;
      const dy = this.mouseSY - prevSY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.dragMoved > 4) this.camera.panBy(-dx / this.camera.zoom, -dy / this.camera.zoom);
      return;
    }
    // celowanie myszą (nie zmienia facing – tylko pitch)
    const worm = this.ctxInfo.worm;
    if (worm && this.ctxInfo.myTurn && !this.ctxInfo.blocked) {
      const a = Math.atan2(this.mouseWY - worm.y, this.mouseWX - worm.x);
      let p = worm.facing === 1 ? a : Math.PI - a;
      p = normalize(p);
      this.pitch = clamp(p, -Math.PI / 2, Math.PI / 2);
    }
  }

  private onMouseDown(e: MouseEvent): void {
    this.cb.gesture();
    this.updateMouseWorld(e);
    if (e.button === 0) {
      this.dragging = true;
      this.dragMoved = 0;
      this.dragX = this.mouseSX;
      this.dragY = this.mouseSY;
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    const wasDragging = this.dragging;
    this.dragging = false;
    if (!wasDragging) return;
    if (this.dragMoved > 6) return; // to było przeciąganie kamery
    if (this.ctxInfo.blocked || !this.ctxInfo.myTurn) return;
    if (TARGETED.has(this.ctxInfo.weapon)) {
      this.cb.sendAction({ kind: "target", x: Math.round(this.mouseWX), y: Math.round(this.mouseWY) });
    }
  }

  /** Przelicza stan klawiszy i wysyła `input` maks. 20×/s (lub co 100 ms). */
  update(dt: number): void {
    const blocked = this.ctxInfo.blocked || !this.ctxInfo.myTurn;
    const shift = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

    // przesuwanie kamery strzałkami z shiftem
    if (shift) {
      const sp = 700 * dt / this.camera.zoom;
      let dx = 0;
      let dy = 0;
      if (this.keys.has("ArrowLeft")) dx -= sp;
      if (this.keys.has("ArrowRight")) dx += sp;
      if (this.keys.has("ArrowUp")) dy -= sp;
      if (this.keys.has("ArrowDown")) dy += sp;
      if (dx || dy) this.camera.panBy(dx, dy);
    }

    const left = !blocked && !shift && (this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const right = !blocked && !shift && (this.keys.has("KeyD") || this.keys.has("ArrowRight"));
    if (!blocked && !shift) {
      const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
      const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
      const rate = 1.6 * dt;
      if (up) this.pitch = clamp(this.pitch - rate, -Math.PI / 2, Math.PI / 2);
      if (down) this.pitch = clamp(this.pitch + rate, -Math.PI / 2, Math.PI / 2);
    }

    const facing = this.ctxInfo.worm?.facing ?? 1;
    const aim = normalize(facing === 1 ? this.pitch : Math.PI - this.pitch);

    this.state.left = left;
    this.state.right = right;
    this.state.aim = aim;
    this.state.charge = this.charging;

    this.acc += dt;
    this.sinceSend += dt;
    if (this.acc >= SEND_INTERVAL) {
      this.acc = 0;
      const changed =
        !this.lastSent ||
        this.lastSent.left !== this.state.left ||
        this.lastSent.right !== this.state.right ||
        this.lastSent.charge !== this.state.charge ||
        Math.abs(this.lastSent.aim - this.state.aim) > 0.01;
      if (changed || this.sinceSend >= RESEND_INTERVAL) this.flushInput();
    }
  }

  private flushInput(): void {
    this.lastSent = { ...this.state };
    this.sinceSend = 0;
    this.cb.sendInput(this.lastSent);
  }

  destroy(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.keys.clear();
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function normalize(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}
