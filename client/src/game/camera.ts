import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { viewportZoom } from "./viewport";

/** Ile świata nad `y = 0` wolno pokazać (nieba starcza, teren zaczyna się niżej). */
const SKY_MARGIN = 120;
/** Maksymalne zbliżenie: min(MAX_ZOOM_FACTOR × fitZoom, MAX_ZOOM_ABS). */
const MAX_ZOOM_FACTOR = 3;
const MAX_ZOOM_ABS = 2.5;
/** Zbliżenie na aktywnego robaka: kadr o stałej szerokości świata (px), niezależnie od ekranu –
 *  kamera realnie podąża za robakiem, a jednocześnie widać sporo otoczenia. */
const FOCUS_VIEW_WIDTH = 1300;
/** Gdzie na ekranie trzymamy aktywnego robaka (0 = góra, 1 = dół). */
const FOCUS_SCREEN_Y = 0.56;
/** Domyślny margines świata dookoła kadrowanych punktów. */
const DEFAULT_FRAME_MARGIN = 150;
/** Stałe czasowe wygładzania (sekundy) – niezależne od fps. */
const POS_TAU = 0.14;
const ZOOM_IN_TAU = 0.5;
/** Oddalanie jest szybsze niż zbliżanie, żeby lecący pocisk nie uciekł z ekranu. */
const ZOOM_OUT_TAU = 0.3;
/** Jak długo „zerkamy” w stronę eksplozji. */
const GLANCE_TIME = 0.6;
/** Ile wstrząs może wyjść poza dozwolony obszar kamery (świat, px). */
const SHAKE_SLACK = 14;

export interface Point {
  x: number;
  y: number;
}

export interface FrameOptions {
  /** margines świata dookoła ramki (domyślnie 150) */
  margin?: number;
  /** górna granica zoomu przy kadrowaniu (domyślnie `focusZoom`) */
  maxZoom?: number;
}

interface Range {
  lo: number;
  hi: number;
}

/**
 * Kamera 2D ze śledzeniem celu, wstrząsami, zoomem i ręcznym przesuwaniem.
 *
 * Zoom bazowy (`fitZoom`) dopasowuje całą szerokość mapy do ekranu – to zarazem
 * minimalne zbliżenie, więc poza krawędziami świata nigdy nie widać pustki.
 * W trybie automatycznym (`manual === false`) kamera sama kadruje akcję:
 * `focus()` na aktywnym robaku, `frame()` na strzelcu + pociskach,
 * `overview()` między turami.
 */
export class Camera {
  /** środek widoku w koordynatach świata */
  x = WORLD_WIDTH / 2;
  y = WORLD_HEIGHT / 2;
  zoom = viewportZoom(1280, 720);
  private targetX = WORLD_WIDTH / 2;
  private targetY = WORLD_HEIGHT / 2;
  private targetZoom = viewportZoom(1280, 720);
  private shakeAmp = 0;
  private shakeT = 0;
  private ox = 0;
  private oy = 0;
  private glanceX = 0;
  private glanceY = 0;
  private glanceW = 0;
  private glanceLife = 0;
  /** punkt świata przyszpilony pod kursorem przy zoomie kółkiem/szczypaniem */
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;
  /** gdy gracz sam przesunął kamerę – wyłączamy auto-śledzenie do zmiany tury */
  manual = false;

  viewW = 1280;
  viewH = 720;

  /** Zbliżenie „cała mapa na ekranie” – zarazem minimalne dopuszczalne. */
  get fitZoom(): number {
    return viewportZoom(this.viewW, this.viewH);
  }

  get minZoom(): number {
    return this.fitZoom;
  }

  get maxZoom(): number {
    return Math.max(this.fitZoom, Math.min(MAX_ZOOM_FACTOR * this.fitZoom, MAX_ZOOM_ABS));
  }

  /** Zbliżenie na aktywnego robaka (widać celownik i szczegóły). */
  get focusZoom(): number {
    return clamp(this.viewW / FOCUS_VIEW_WIDTH, this.minZoom, this.maxZoom);
  }

  setViewport(w: number, h: number): void {
    // zachowujemy względny poziom zbliżenia (zoom / fitZoom), żeby obrót telefonu nie „skakał”
    const prevFit = this.fitZoom;
    const rel = this.zoom / prevFit;
    const relTarget = this.targetZoom / prevFit;
    this.viewW = w;
    this.viewH = h;
    this.anchor = null;
    this.zoom = clamp(rel * this.fitZoom, this.minZoom, this.maxZoom);
    this.targetZoom = clamp(relTarget * this.fitZoom, this.minZoom, this.maxZoom);
    this.clamp();
  }

  follow(x: number, y: number, snap = false): void {
    if (this.manual) return;
    this.anchor = null;
    this.targetX = x;
    this.targetY = y;
    if (snap) {
      this.x = x;
      this.y = y;
      this.clamp();
    }
  }

  /** Widok całej mapy (między turami). Opcjonalny punkt zainteresowania – ważny na pionowych ekranach. */
  overview(anchorX?: number, anchorY?: number, snap = false): void {
    if (this.manual) return;
    const z = this.fitZoom;
    const halfH = this.viewH / 2 / z;
    const defaultY = halfH * 2 >= WORLD_HEIGHT ? WORLD_HEIGHT / 2 : WORLD_HEIGHT - halfH;
    this.setAuto(anchorX ?? WORLD_WIDTH / 2, anchorY ?? defaultY, z, snap);
  }

  /** Zbliżenie na aktywnego robaka – trzymamy go w dolnej części ekranu. */
  focus(x: number, y: number, zoom = this.focusZoom, snap = false): void {
    if (this.manual) return;
    const z = clamp(zoom, this.minZoom, this.maxZoom);
    const offsetY = (FOCUS_SCREEN_Y - 0.5) * (this.viewH / z);
    this.setAuto(x, y - offsetY, z, snap);
  }

  /** Kadr obejmujący wszystkie punkty (strzelec + pociski) z marginesem. */
  frame(points: readonly Point[], opts: FrameOptions = {}): void {
    if (this.manual || points.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const margin = opts.margin ?? DEFAULT_FRAME_MARGIN;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const cap = clamp(opts.maxZoom ?? this.focusZoom, this.minZoom, this.maxZoom);
    const z = clamp(Math.min(this.viewW / w, this.viewH / h), this.minZoom, cap);
    this.setAuto((minX + maxX) / 2, (minY + maxY) / 2, z);
  }

  /** Docelowe zbliżenie bez zmiany trybu (auto/ręczny). */
  setTargetZoom(z: number): void {
    this.targetZoom = clamp(z, this.minZoom, this.maxZoom);
    this.anchor = null;
  }

  /** Krótkie spojrzenie w stronę punktu (eksplozja) – nie kasuje docelowego kadru. */
  glance(x: number, y: number, weight = 0.35): void {
    if (this.manual) return;
    this.glanceX = x;
    this.glanceY = y;
    this.glanceW = clamp(weight, 0, 1);
    this.glanceLife = GLANCE_TIME;
  }

  panBy(dx: number, dy: number): void {
    this.manual = true;
    this.anchor = null;
    this.targetX += dx;
    this.targetY += dy;
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  resetManual(): void {
    this.manual = false;
    this.anchor = null;
    this.glanceLife = 0;
  }

  /**
   * Zoom kółkiem / szczypaniem. Zawsze wchodzi w tryb ręczny i – jeśli podano punkt –
   * przyszpila go pod kursorem (także wtedy, gdy kamera dopiero co chodziła automatycznie).
   */
  zoomBy(f: number, focusWorldX?: number, focusWorldY?: number): void {
    const screen =
      focusWorldX !== undefined && focusWorldY !== undefined ? this.worldToScreen(focusWorldX, focusWorldY) : null;
    this.manual = true;
    this.targetZoom = clamp(this.targetZoom * f, this.minZoom, this.maxZoom);
    if (screen && focusWorldX !== undefined && focusWorldY !== undefined) {
      this.anchor = { wx: focusWorldX, wy: focusWorldY, sx: screen.x, sy: screen.y };
      this.targetX = focusWorldX - (screen.x - this.viewW / 2) / this.targetZoom;
      this.targetY = focusWorldY - (screen.y - this.viewH / 2) / this.targetZoom;
      this.clampTarget();
    } else {
      this.anchor = null;
    }
  }

  shake(amount: number): void {
    this.shakeAmp = Math.min(38, Math.max(this.shakeAmp, amount));
    this.shakeT = 0;
  }

  update(dt: number): void {
    // zoom: oddalanie szybsze niż zbliżanie, oba na tyle wolne, żeby nie mdliło
    const tau = this.targetZoom < this.zoom ? ZOOM_OUT_TAU : ZOOM_IN_TAU;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt / tau));
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);

    let tx = this.targetX;
    let ty = this.targetY;
    if (this.glanceLife > 0) {
      this.glanceLife = Math.max(0, this.glanceLife - dt);
      const w = this.glanceW * (this.glanceLife / GLANCE_TIME);
      tx += (this.glanceX - tx) * w;
      ty += (this.glanceY - ty) * w;
    }
    const k = 1 - Math.exp(-dt / POS_TAU);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;

    // punkt pod kursorem zostaje pod kursorem przez cały czas animacji zoomu
    if (this.anchor) {
      this.x = this.anchor.wx - (this.anchor.sx - this.viewW / 2) / this.zoom;
      this.y = this.anchor.wy - (this.anchor.sy - this.viewH / 2) / this.zoom;
    }
    this.clamp();

    if (this.shakeAmp > 0.2) {
      this.shakeT += dt;
      const decay = Math.exp(-this.shakeT * 6);
      // amplituda w pikselach ekranu, nie świata – wstrząs czuć tak samo przy każdym zbliżeniu
      const a = (this.shakeAmp * decay) / Math.max(0.4, this.zoom);
      this.ox = Math.sin(this.shakeT * 61) * a;
      this.oy = Math.cos(this.shakeT * 47) * a * 0.7;
      this.clampShake();
      if (decay < 0.02) this.shakeAmp = 0;
    } else {
      this.ox = 0;
      this.oy = 0;
      this.shakeAmp = 0;
    }
  }

  private setAuto(x: number, y: number, zoom: number, snap = false): void {
    this.anchor = null;
    this.targetZoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.targetX = x;
    this.targetY = y;
    this.clampTarget();
    if (snap) {
      this.zoom = this.targetZoom;
      this.x = this.targetX;
      this.y = this.targetY;
      this.clamp();
    }
  }

  /** Dozwolony zakres środka widoku przy danym zbliżeniu. */
  private centerRange(zoom: number): { x: Range; y: Range } {
    const halfW = this.viewW / 2 / zoom;
    const halfH = this.viewH / 2 / zoom;
    const x =
      halfW * 2 >= WORLD_WIDTH
        ? { lo: WORLD_WIDTH / 2, hi: WORLD_WIDTH / 2 }
        : { lo: halfW, hi: WORLD_WIDTH - halfW };
    const y =
      halfH * 2 >= WORLD_HEIGHT
        ? { lo: WORLD_HEIGHT / 2, hi: WORLD_HEIGHT / 2 }
        : { lo: halfH - SKY_MARGIN, hi: WORLD_HEIGHT - halfH };
    return { x, y };
  }

  private clampTarget(): void {
    const r = this.centerRange(this.targetZoom);
    this.targetX = clamp(this.targetX, r.x.lo, r.x.hi);
    this.targetY = clamp(this.targetY, r.y.lo, r.y.hi);
  }

  private clamp(): void {
    const r = this.centerRange(this.zoom);
    this.x = clamp(this.x, r.x.lo, r.x.hi);
    this.y = clamp(this.y, r.y.lo, r.y.hi);
    this.clampTarget();
  }

  private clampShake(): void {
    const r = this.centerRange(this.zoom);
    this.ox = clamp(this.x + this.ox, r.x.lo - SHAKE_SLACK, r.x.hi + SHAKE_SLACK) - this.x;
    this.oy = clamp(this.y + this.oy, r.y.lo - SHAKE_SLACK, r.y.hi + SHAKE_SLACK) - this.y;
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
