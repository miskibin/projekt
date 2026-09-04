import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import type { Camera } from "./camera";
import type { BgStyle, ThemePalette } from "./terrainRenderer";

export interface BackgroundInput {
  camera: Camera;
  palette: ThemePalette;
  /** czas w sekundach od startu (animacje) */
  time: number;
  /** rozmiar widoku w pikselach CSS */
  width: number;
  height: number;
}

export interface CoverPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Skaluje obraz jak CSS `cover`, zostawiając bezpieczny zapas na parallax.
 * panX / panY są znormalizowane do zakresu -1..1 i nigdy nie odsłaniają krawędzi obrazu.
 */
export function coverPlacement(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  panX: number,
  panY: number,
  overscan = 1.08,
): CoverPlacement {
  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight) * Math.max(1, overscan);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const overflowX = Math.max(0, width - viewportWidth);
  const overflowY = Math.max(0, height - viewportHeight);
  const px = Math.max(-1, Math.min(1, panX));
  const py = Math.max(-1, Math.min(1, panY));
  return {
    x: (viewportWidth - width) / 2 - px * overflowX * 0.5,
    y: (viewportHeight - height) / 2 - py * overflowY * 0.5,
    width,
    height,
  };
}

interface Bump {
  dx: number;
  rr: number;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  depth: number;
  speed: number;
  bumps: Bump[];
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
}

type ShapeKind = "ridge" | "hills" | "pines" | "dunes" | "spikes";

interface LayerSpec {
  kind: ShapeKind;
  /** 0 = nieruchome tło, 1 = rusza się razem ze światem */
  depth: number;
  w: number;
  h: number;
  /** skala canvasu warstwy na ekranie przy zoomie 1 */
  scale: number;
  /** przesunięcie dolnej krawędzi względem horyzontu (px canvasu) */
  yOff: number;
  color: "far" | "mid" | "near";
  /** jasne czapy na szczytach (śnieg / rozgrzana skała) */
  caps: boolean;
  alpha: number;
  /** ridge/spikes: liczba szczytów oraz zakresy dolin i wierzchołków (ułamki wysokości) */
  seg?: number;
  valLo?: number;
  valHi?: number;
  peakLo?: number;
  peakHi?: number;
  /** hills/dunes: linia bazowa, amplituda, ostrość grzbietu */
  base?: number;
  amp?: number;
  sharp?: number;
  /** pines: odstęp między drzewami w px canvasu */
  spacing?: number;
}

interface Layer {
  canvas: HTMLCanvasElement;
  spec: LayerSpec;
  ground: string;
}

const LAYERS: Record<BgStyle, LayerSpec[]> = {
  mountains: [
    {
      kind: "ridge", depth: 0.1, w: 1700, h: 210, scale: 1, yOff: -46, color: "far", caps: true, alpha: 0.9,
      seg: 5, valLo: 0.74, valHi: 0.96, peakLo: 0.1, peakHi: 0.46,
    },
    {
      kind: "hills", depth: 0.22, w: 1500, h: 160, scale: 1, yOff: -18, color: "mid", caps: false, alpha: 0.95,
      base: 0.98, amp: 0.62,
    },
    { kind: "pines", depth: 0.42, w: 1220, h: 122, scale: 1, yOff: 8, color: "near", caps: false, alpha: 1, spacing: 44 },
  ],
  peaks: [
    {
      kind: "ridge", depth: 0.1, w: 1600, h: 280, scale: 1, yOff: -46, color: "far", caps: true, alpha: 0.95,
      seg: 6, valLo: 0.76, valHi: 0.98, peakLo: 0.06, peakHi: 0.4,
    },
    {
      kind: "ridge", depth: 0.22, w: 1400, h: 190, scale: 1, yOff: -16, color: "mid", caps: true, alpha: 0.97,
      seg: 7, valLo: 0.8, valHi: 1, peakLo: 0.16, peakHi: 0.52,
    },
    { kind: "pines", depth: 0.42, w: 1200, h: 118, scale: 1, yOff: 8, color: "near", caps: false, alpha: 1, spacing: 50 },
  ],
  dunes: [
    {
      kind: "ridge", depth: 0.1, w: 1800, h: 170, scale: 1, yOff: -40, color: "far", caps: true, alpha: 0.8,
      seg: 4, valLo: 0.82, valHi: 1, peakLo: 0.3, peakHi: 0.62,
    },
    {
      kind: "dunes", depth: 0.22, w: 1500, h: 170, scale: 1, yOff: -14, color: "mid", caps: false, alpha: 0.92,
      base: 0.98, amp: 0.66, sharp: 1.5,
    },
    {
      kind: "dunes", depth: 0.42, w: 1250, h: 140, scale: 1, yOff: 10, color: "near", caps: false, alpha: 1,
      base: 0.98, amp: 0.6, sharp: 1.7,
    },
  ],
  spires: [
    {
      kind: "spikes", depth: 0.1, w: 1500, h: 250, scale: 1, yOff: -44, color: "far", caps: true, alpha: 0.9,
      seg: 11, valLo: 0.78, valHi: 1, peakLo: 0.06, peakHi: 0.46,
    },
    {
      kind: "spikes", depth: 0.22, w: 1300, h: 200, scale: 1, yOff: -14, color: "mid", caps: false, alpha: 0.95,
      seg: 13, valLo: 0.84, valHi: 1, peakLo: 0.12, peakHi: 0.5,
    },
    {
      kind: "spikes", depth: 0.42, w: 1150, h: 140, scale: 1, yOff: 10, color: "near", caps: false, alpha: 1,
      seg: 15, valLo: 0.88, valHi: 1, peakLo: 0.16, peakHi: 0.58,
    },
  ],
};

/**
 * Tło sceny: niebo, słońce, chmury, gwiazdy/żar oraz 3 warstwy parallaxu
 * (dalekie góry -> wzgórza -> sylwetki przy horyzoncie). Rysowane w przestrzeni ekranu.
 *
 * Sylwetki są rysowane raz do offscreen-canvasów (kafelkowanych poziomo), więc
 * na klatkę przypada tylko kilka `drawImage`.
 */
export class Background {
  private clouds: Cloud[] = [];
  private stars: Star[] = [];
  private seed = 1;
  private layers: Layer[] = [];
  private builtFor: ThemePalette | null = null;
  private glow: { key: string; grad: CanvasGradient } | null = null;
  private landscape: HTMLImageElement | null = null;
  private foreground: HTMLImageElement | null = null;
  private landscapeReady = false;
  private foregroundReady = false;

  constructor(seed = 1) {
    this.regen(seed);
    this.loadLandscape();
  }

  regen(seed: number): void {
    this.seed = seed >>> 0 || 1;
    const rnd = mulberry(this.seed ^ 0x1b873593);
    this.clouds = Array.from({ length: 12 }, () => {
      const n = 5 + ((rnd() * 3) | 0);
      const bumps: Bump[] = [];
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0.5;
        bumps.push({
          dx: (t - 0.5) * 3.4,
          rr: (0.34 + 0.5 * Math.sin(Math.PI * t)) * (0.84 + 0.32 * rnd()),
        });
      }
      return {
        x: rnd() * WORLD_WIDTH * 1.6,
        y: 40 + rnd() * (WORLD_HEIGHT * 0.34),
        s: 26 + rnd() * 34,
        depth: 0.05 + rnd() * 0.09,
        speed: 1.5 + rnd() * 5,
        bumps,
      };
    });
    this.stars = Array.from({ length: 130 }, () => ({
      x: rnd() * WORLD_WIDTH * 1.2,
      y: rnd() * WORLD_HEIGHT * 0.7,
      r: 0.6 + rnd() * 1.5,
      tw: rnd() * 6.28,
    }));
    this.layers = [];
    this.builtFor = null;
  }

  draw(ctx: CanvasRenderingContext2D, inp: BackgroundInput): void {
    const { palette: pal, width: W, height: H } = inp;
    if (W <= 0 || H <= 0) return;
    if (this.drawLandscape(ctx, inp)) return;
    if (this.builtFor !== pal) this.build(pal);

    // --- niebo ---
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(0.56, pal.skyMid);
    sky.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // miękkie pasma atmosfery przełamują płaski gradient nieba
    const atmosphere = ctx.createLinearGradient(0, H * 0.18, 0, H * 0.82);
    atmosphere.addColorStop(0, "rgba(255,255,255,0)");
    atmosphere.addColorStop(0.48, "rgba(255,255,255,0.055)");
    atmosphere.addColorStop(0.72, "rgba(255,218,174,0.045)");
    atmosphere.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, W, H);

    const cam = inp.camera;
    const z = cam.zoom;
    const view = cam.viewRect();
    const camX = view.x + view.w / 2;
    const camY = view.y + view.h / 2;
    const refX = WORLD_WIDTH / 2;
    const refY = WORLD_HEIGHT / 2;
    const horizonWorld = WORLD_HEIGHT * pal.horizon;
    const zs = Math.pow(z, 0.55);

    // --- poświata / słońce ---
    const sunX = W * 0.74;
    const sunY = H * 0.13;
    const key = `${W}x${H}|${pal.glow}`;
    if (!this.glow || this.glow.key !== key) {
      const g = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, Math.max(W, H) * 0.7);
      g.addColorStop(0, pal.glow);
      g.addColorStop(1, "rgba(0,0,0,0)");
      this.glow = { key, grad: g };
    }
    ctx.fillStyle = this.glow.grad;
    ctx.fillRect(0, 0, W, H);
    if (!pal.embers) {
      const rr = H * 0.24;
      const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, rr);
      disc.addColorStop(0, pal.sun);
      disc.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(sunX, sunY, rr, 0, Math.PI * 2);
      ctx.fill();

      // wyraźna tarcza i bardzo subtelne promienie
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = pal.stars ? 0.32 : 0.48;
      ctx.fillStyle = pal.sun;
      ctx.beginPath();
      ctx.arc(sunX, sunY, Math.max(9, H * 0.026), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sunX, sunY, Math.max(13, H * 0.038), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha *= 0.13;
      ctx.translate(sunX, sunY);
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(H * 0.065, -H * 0.006);
        ctx.lineTo(H * 0.24, 0);
        ctx.lineTo(H * 0.065, H * 0.006);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // --- gwiazdy ---
    if (pal.stars) {
      ctx.fillStyle = "#dceaff";
      const span = WORLD_WIDTH * 1.2;
      for (const st of this.stars) {
        const px = (((st.x - camX * 0.08) % span) + span) % span;
        const sx = (px / span) * W * 1.1 - W * 0.05;
        const sy = st.y * 0.42 - (camY - refY) * 0.06 * z;
        if (sy < -5 || sy > H) continue;
        ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(inp.time * 1.7 + st.tw));
        ctx.beginPath();
        ctx.arc(sx, sy, st.r, 0, Math.PI * 2);
        ctx.fill();
        if (st.r > 1.45) {
          const ray = st.r * (2.2 + Math.sin(inp.time * 1.7 + st.tw));
          ctx.strokeStyle = "rgba(220,238,255,0.55)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(sx - ray, sy); ctx.lineTo(sx + ray, sy);
          ctx.moveTo(sx, sy - ray); ctx.lineTo(sx, sy + ray);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- chmury / smugi żaru ---
    this.drawClouds(ctx, inp, camX, camY, refY, z, W, H);

    // --- warstwy parallaxu ---
    for (const L of this.layers) {
      const s = L.spec;
      const scale = s.scale * zs;
      const dw = L.canvas.width * scale;
      const dh = L.canvas.height * scale;
      const baseY = H / 2 + z * (horizonWorld - refY + s.depth * (refY - camY)) + s.yOff * scale;
      const top = baseY - dh;
      if (top < H) {
        const ax = W / 2 + z * s.depth * (refX - camX);
        let sx = (ax - dw / 2) % dw;
        if (sx > 0) sx -= dw;
        ctx.globalAlpha = s.alpha;
        const tw = Math.ceil(dw) + 1;
        const th = Math.ceil(dh) + 1;
        const ty = Math.round(top);
        for (let x = sx; x < W; x += dw) ctx.drawImage(L.canvas, Math.round(x), ty, tw, th);
        ctx.globalAlpha = 1;
      }
      if (baseY < H) {
        ctx.fillStyle = L.ground;
        ctx.globalAlpha = s.alpha;
        ctx.fillRect(0, Math.round(baseY) - 1, W, H - Math.round(baseY) + 2);
        ctx.globalAlpha = 1;
      }
    }

    // --- delikatna mgiełka nad horyzontem ---
    const hy = H / 2 + z * (horizonWorld - camY);
    if (hy > -H && hy < H * 2) {
      const fog = ctx.createLinearGradient(0, hy - H * 0.32, 0, hy + H * 0.06);
      fog.addColorStop(0, "rgba(0,0,0,0)");
      fog.addColorStop(1, pal.fog);
      ctx.fillStyle = fog;
      ctx.fillRect(0, Math.max(0, hy - H * 0.32), W, H * 0.38);
    }

    if (pal.embers) this.drawEmbers(ctx, inp, camX, W, H);
  }

  private loadLandscape(): void {
    if (typeof Image === "undefined") return;

    const landscape = new Image();
    landscape.decoding = "async";
    landscape.onload = () => { this.landscapeReady = true; };
    landscape.src = "/assets/alpine-valley.webp";
    this.landscape = landscape;

    const foreground = new Image();
    foreground.decoding = "async";
    foreground.onload = () => { this.foregroundReady = true; };
    foreground.src = "/assets/alpine-valley-foreground.webp";
    this.foreground = foreground;
  }

  /**
   * Fotograficzna baza porusza się wolno, a wycięty pierwszy plan lasu szybciej.
   * Obie warstwy mają zapas kadru, więc również przy skrajnej pozycji kamery
   * nigdy nie pojawiają się puste pasy.
   */
  private drawLandscape(ctx: CanvasRenderingContext2D, inp: BackgroundInput): boolean {
    const image = this.landscape;
    if (!this.landscapeReady || !image?.naturalWidth || !image.naturalHeight) return false;

    const { width: W, height: H, camera, palette: pal } = inp;
    const view = camera.viewRect();
    const camX = view.x + view.w / 2;
    const camY = view.y + view.h / 2;
    const nx = Math.max(-1, Math.min(1, (camX - WORLD_WIDTH / 2) / (WORLD_WIDTH / 2)));
    const ny = Math.max(-1, Math.min(1, (camY - WORLD_HEIGHT / 2) / (WORLD_HEIGHT / 2)));

    const back = coverPlacement(image.naturalWidth, image.naturalHeight, W, H, nx * 0.28, ny * 0.18);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, back.x, back.y, back.width, back.height);

    const front = this.foreground;
    if (this.foregroundReady && front?.naturalWidth && front.naturalHeight) {
      const near = coverPlacement(front.naturalWidth, front.naturalHeight, W, H, nx * 0.72, ny * 0.42);
      ctx.drawImage(front, near.x, near.y, near.width, near.height);
    }

    // Motywy nadal różnią się temperaturą i nastrojem, ale zachowują dostarczony pejzaż.
    const tint = landscapeTint(pal.bgStyle);
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
    }

    // Przyciemnia dół obrazu, aby teren, woda i robaki nie ginęły w szczegółach lasu.
    const depth = ctx.createLinearGradient(0, H * 0.48, 0, H);
    depth.addColorStop(0, "rgba(4,12,24,0)");
    depth.addColorStop(0.72, "rgba(4,12,24,0.08)");
    depth.addColorStop(1, "rgba(2,8,17,0.27)");
    ctx.fillStyle = depth;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (pal.embers) this.drawEmbers(ctx, inp, camX, W, H);
    return true;
  }

  private drawClouds(
    ctx: CanvasRenderingContext2D,
    inp: BackgroundInput,
    camX: number,
    camY: number,
    refY: number,
    z: number,
    W: number,
    H: number,
  ): void {
    const pal = inp.palette;
    const span = WORLD_WIDTH * 1.6;
    ctx.fillStyle = pal.cloud;
    for (const c of this.clouds) {
      const wx = c.x + inp.time * c.speed;
      const px = (((wx - camX * c.depth * 4) % span) + span) % span;
      const sx = (px / span) * (W * 1.4) - W * 0.2;
      const sy = c.y * 0.9 - (camY - refY) * c.depth * z + H * 0.02;
      const s = c.s * Math.pow(z, 0.55);
      if (sy - s * 2 > H || sy + s * 2 < 0) continue;
      if (pal.embers) {
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.ellipse(sx, sy, s * 4.2, s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      let minX = Infinity;
      let maxX = -Infinity;
      let minR = Infinity;
      for (const b of c.bumps) {
        const bx = sx + b.dx * s;
        const br = b.rr * s;
        ctx.moveTo(bx + br, sy - br);
        ctx.arc(bx, sy - br, br, 0, Math.PI * 2);
        if (bx - br < minX) minX = bx - br;
        if (bx + br > maxX) maxX = bx + br;
        if (br < minR) minR = br;
      }
      // płaski spód: prostokąt spinający dolne części okręgów
      ctx.rect(minX, sy - minR * 1.02, maxX - minX, minR * 1.02);
      ctx.shadowColor = "rgba(6,18,34,0.24)";
      ctx.shadowBlur = Math.max(4, s * 0.22);
      ctx.shadowOffsetY = Math.max(2, s * 0.09);
      ctx.fill();
      ctx.shadowColor = "rgba(0,0,0,0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawEmbers(ctx: CanvasRenderingContext2D, inp: BackgroundInput, camX: number, W: number, H: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ff7a2a";
    for (const st of this.stars) {
      const t = (inp.time * 26 + st.x) % (H + 200);
      const sy = H + 100 - t;
      const sx = (((st.x - camX * 0.3) % W) + W) % W + Math.sin(inp.time + st.tw) * 12;
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      ctx.arc(sx, sy, st.r * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Buduje sylwetki warstw raz na (motyw, seed). */
  private build(pal: ThemePalette): void {
    const specs = LAYERS[pal.bgStyle] ?? LAYERS.mountains;
    this.layers = specs.map((spec, idx) => {
      const color = spec.color === "far" ? pal.bgFar : spec.color === "mid" ? pal.bgMid : pal.bgNear;
      const canvas = document.createElement("canvas");
      canvas.width = spec.w;
      canvas.height = spec.h;
      const g = canvas.getContext("2d");
      if (g) {
        const rnd = mulberry((this.seed ^ (0x9e3779b9 + idx * 0x85ebca6b)) >>> 0);
        drawShape(g, spec, rnd, color, spec.caps ? pal.bgPeak : null);
      }
      return { canvas, spec, ground: color };
    });
    this.builtFor = pal;
  }
}

function landscapeTint(style: BgStyle): string | null {
  switch (style) {
    case "peaks": return "rgba(30,58,92,0.12)";
    case "dunes": return "rgba(126,69,18,0.16)";
    case "spires": return "rgba(58,4,12,0.38)";
    default: return null;
  }
}

// ---------------------------------------------------------------- kształty

function drawShape(
  g: CanvasRenderingContext2D,
  spec: LayerSpec,
  rnd: () => number,
  color: string,
  cap: string | null,
): void {
  const W = spec.w;
  const H = spec.h;
  g.fillStyle = color;
  switch (spec.kind) {
    case "ridge":
    case "spikes":
      ridge(
        g, rnd, W, H, color, cap,
        spec.seg ?? 6,
        spec.valLo ?? 0.78,
        spec.valHi ?? 1,
        spec.peakLo ?? 0.1,
        spec.peakHi ?? 0.45,
      );
      break;
    case "hills":
    case "dunes":
      wave(g, rnd, W, H, H * (spec.base ?? 0.98), H * (spec.amp ?? 0.6), spec.sharp ?? 1);
      break;
    case "pines":
      pines(g, rnd, W, H, color, spec.spacing ?? 44);
      break;
  }
}

/** Ostry, kafelkowalny grzbiet górski (pierwszy i ostatni punkt mają tę samą wysokość). */
function ridge(
  g: CanvasRenderingContext2D,
  rnd: () => number,
  W: number,
  H: number,
  color: string,
  cap: string | null,
  segments: number,
  valLo: number,
  valHi: number,
  peakLo: number,
  peakHi: number,
): void {
  const n = segments * 2;
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    xs[k] = (k * W) / n + (k === 0 || k === n ? 0 : (rnd() - 0.5) * (W / n) * 0.7);
    ys[k] = k % 2 === 0 ? H * (valLo + rnd() * (valHi - valLo)) : H * (peakLo + rnd() * (peakHi - peakLo));
  }
  ys[n] = ys[0];

  // stoki nie są idealnie proste – dokładamy punkty pośrednie z lekkim ugięciem
  const px: number[] = [];
  const py: number[] = [];
  const sag = H * 0.05;
  for (let k = 0; k < n; k++) {
    px.push(xs[k]);
    py.push(ys[k]);
    for (const t of [0.36, 0.68]) {
      px.push(xs[k] + (xs[k + 1] - xs[k]) * t);
      py.push(ys[k] + (ys[k + 1] - ys[k]) * t + (0.25 + rnd() * 0.75) * sag * Math.sin(Math.PI * t));
    }
  }
  px.push(xs[n]);
  py.push(ys[n]);

  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  for (let k = 0; k < px.length; k++) g.lineTo(px[k], py[k]);
  g.lineTo(W, H);
  g.closePath();
  g.fill();

  if (!cap) return;
  g.fillStyle = cap;
  for (let k = 1; k < n; k += 2) {
    const t = 0.3 + rnd() * 0.14;
    const lx = xs[k] + (xs[k - 1] - xs[k]) * t;
    const ly = ys[k] + (ys[k - 1] - ys[k]) * t;
    const rx = xs[k] + (xs[k + 1] - xs[k]) * t;
    const ry = ys[k] + (ys[k + 1] - ys[k]) * t;
    const mx = (lx + rx) / 2;
    const my = (ly + ry) / 2 - (ly + ry - 2 * ys[k]) * 0.28;
    g.beginPath();
    g.moveTo(xs[k], ys[k]);
    g.lineTo(rx, ry);
    g.lineTo(mx, my);
    g.lineTo(lx, ly);
    g.closePath();
    g.fill();
  }
}

/** Łagodne, kafelkowalne wzgórza/wydmy z sumy harmonicznych. */
function wave(
  g: CanvasRenderingContext2D,
  rnd: () => number,
  W: number,
  H: number,
  base: number,
  amp: number,
  sharp: number,
): void {
  const a = [0.54, 0.28, 0.18];
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[k] * Math.sin((2 * Math.PI * (k + 1) * x) / W + ph[k]);
    let t = 0.5 + 0.5 * s;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    g.lineTo(x, base - amp * Math.pow(t, sharp));
  }
  g.lineTo(W, H);
  g.closePath();
  g.fill();
}

/** Linia gruntu + sylwetki świerków (kafelkowalne przez rysowanie kopii na brzegach). */
function pines(
  g: CanvasRenderingContext2D,
  rnd: () => number,
  W: number,
  H: number,
  color: string,
  spacing: number,
): void {
  const base = H * 0.76;
  const amp = H * 0.09;
  const a = [0.6, 0.26, 0.14];
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const groundAt = (x: number): number => {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[k] * Math.sin((2 * Math.PI * (k + 1) * x) / W + ph[k]);
    return base - amp * (0.5 + 0.5 * s);
  };

  g.fillStyle = color;
  const count = Math.max(4, Math.round(W / spacing));
  for (let i = 0; i < count; i++) {
    const x = rnd() * W;
    const th = H * (0.28 + rnd() * 0.4);
    const tw = th * (0.34 + rnd() * 0.14);
    const gy = groundAt(x) + H * 0.03;
    for (const off of [-W, 0, W]) {
      if (x + off < -tw || x + off > W + tw) continue;
      pine(g, x + off, gy, tw, th);
    }
  }

  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) g.lineTo(x, groundAt(x));
  g.lineTo(W, H);
  g.closePath();
  g.fill();
}

function pine(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillRect(x - w * 0.07, y - h * 0.25, w * 0.14, h * 0.25);
  for (let i = 0; i < 3; i++) {
    const top = y - h * (1 - i * 0.26);
    const bot = y - h * (0.55 - i * 0.27);
    const hw = (w / 2) * (0.5 + i * 0.25);
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + hw, bot);
    g.lineTo(x - hw, bot);
    g.closePath();
    g.fill();
  }
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
