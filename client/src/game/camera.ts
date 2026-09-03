import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { viewportZoom } from "./viewport";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

/** Kamera 2D ze śledzeniem celu, wstrząsami, zoomem i ręcznym przesuwaniem. */
export class Camera {
  /** środek widoku w koordynatach świata */
  x = WORLD_WIDTH / 2;
  y = WORLD_HEIGHT / 2;
  zoom = 1;
  private targetX = WORLD_WIDTH / 2;
  private targetY = WORLD_HEIGHT / 2;
  private targetZoom = 1;
  private shakeAmp = 0;
  private shakeT = 0;
  private ox = 0;
  private oy = 0;
  /** gdy gracz sam przesunął kamerę – wyłączamy auto-śledzenie do zmiany tury */
  manual = false;

  viewW = 1280;
  viewH = 720;

  setViewport(w: number, h: number): void {
    const scale = viewportZoom(w, h) / viewportZoom(this.viewW, this.viewH);
    this.viewW = w;
    this.viewH = h;
    this.zoom = clamp(this.zoom * scale, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = clamp(this.targetZoom * scale, MIN_ZOOM, MAX_ZOOM);
    this.clamp();
  }

  follow(x: number, y: number, snap = false): void {
    if (this.manual) return;
    this.targetX = x;
    this.targetY = y;
    if (snap) {
      this.x = x;
      this.y = y;
    }
  }

  /** Natychmiastowe spojrzenie na punkt (eksplozja) – działa też w trybie ręcznym. */
  glance(x: number, y: number, weight = 0.35): void {
    if (this.manual) return;
    this.targetX += (x - this.targetX) * weight;
    this.targetY += (y - this.targetY) * weight;
  }

  panBy(dx: number, dy: number): void {
    this.manual = true;
    this.targetX += dx;
    this.targetY += dy;
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  resetManual(): void {
    this.manual = false;
  }

  zoomBy(f: number, focusWorldX?: number, focusWorldY?: number): void {
    const before = this.targetZoom;
    this.targetZoom = clamp(this.targetZoom * f, MIN_ZOOM, MAX_ZOOM);
    if (focusWorldX !== undefined && focusWorldY !== undefined && this.manual) {
      const k = 1 - before / this.targetZoom;
      this.targetX += (focusWorldX - this.targetX) * k;
      this.targetY += (focusWorldY - this.targetY) * k;
    }
  }

  shake(amount: number): void {
    this.shakeAmp = Math.min(38, Math.max(this.shakeAmp, amount));
    this.shakeT = 0;
  }

  update(dt: number): void {
    const k = 1 - Math.pow(0.0025, dt); // wygładzanie niezależne od fps
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.pow(0.01, dt));

    if (this.shakeAmp > 0.2) {
      this.shakeT += dt;
      const decay = Math.exp(-this.shakeT * 6);
      const a = this.shakeAmp * decay;
      this.ox = Math.sin(this.shakeT * 61) * a;
      this.oy = Math.cos(this.shakeT * 47) * a * 0.7;
      if (decay < 0.02) this.shakeAmp = 0;
    } else {
      this.ox = 0;
      this.oy = 0;
      this.shakeAmp = 0;
    }
    this.clamp();
  }

  private clamp(): void {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    if (halfW * 2 >= WORLD_WIDTH) this.x = this.targetX = WORLD_WIDTH / 2;
    else {
      this.x = clamp(this.x, halfW, WORLD_WIDTH - halfW);
      this.targetX = clamp(this.targetX, halfW, WORLD_WIDTH - halfW);
    }
    if (halfH * 2 >= WORLD_HEIGHT) this.y = this.targetY = WORLD_HEIGHT / 2;
    else {
      this.y = clamp(this.y, halfH, WORLD_HEIGHT - halfH);
      this.targetY = clamp(this.targetY, halfH, WORLD_HEIGHT - halfH);
    }
  }

  /** Ustawia transformację kontekstu tak, że rysujemy w koordynatach świata. */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-(this.x + this.ox), -(this.y + this.oy));
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - (this.x + this.ox)) * this.zoom + this.viewW / 2,
      y: (y - (this.y + this.oy)) * this.zoom + this.viewH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x + this.ox,
      y: (sy - this.viewH / 2) / this.zoom + this.y + this.oy,
    };
  }

  /** Prostokąt świata widoczny na ekranie (do kullingu / parallaxu). */
  viewRect(): { x: number; y: number; w: number; h: number } {
    const w = this.viewW / this.zoom;
    const h = this.viewH / this.zoom;
    return { x: this.x + this.ox - w / 2, y: this.y + this.oy - h / 2, w, h };
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
