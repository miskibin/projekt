import type { GameConfig } from "@shared/protocol";
import { Terrain } from "@shared/engine/terrain";
import { Rng } from "@shared/engine/rng";

export type ThemeId = GameConfig["theme"];
export type RGB = [number, number, number];

export interface ThemePalette {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** kolor "słońca"/poświaty w tle */
  glow: string;
  /** chmury (grass/desert/snow) albo żar (hell) */
  cloud: string;
  stars: boolean;
  embers: boolean;
  /** wierzchnia warstwa (trawa / piasek / śnieg / skorupa lawy) */
  topA: RGB;
  topB: RGB;
  topDepth: number;
  soil: RGB;
  soilDark: RGB;
  /** jaśniejsza obwódka na krawędziach bocznych i dolnych */
  rim: RGB;
  /** kolor odłamków ziemi w cząsteczkach */
  debris: string;
  water: string;
  waterDeep: string;
  waterFoam: string;
  fog: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  grass: {
    skyTop: "#0a1830",
    skyMid: "#1d3f66",
    skyBottom: "#4b7ea8",
    glow: "rgba(255, 226, 168, 0.30)",
    cloud: "rgba(226, 240, 255, 0.42)",
    stars: false,
    embers: false,
    topA: [122, 206, 86],
    topB: [58, 128, 46],
    topDepth: 7,
    soil: [138, 96, 56],
    soilDark: [86, 57, 33],
    rim: [176, 132, 82],
    debris: "#8a5f38",
    water: "rgba(46, 122, 190, 0.55)",
    waterDeep: "rgba(14, 52, 96, 0.80)",
    waterFoam: "rgba(190, 232, 255, 0.9)",
    fog: "rgba(120, 170, 210, 0.05)",
  },
  desert: {
    skyTop: "#241436",
    skyMid: "#8d4a3a",
    skyBottom: "#e8b77e",
    glow: "rgba(255, 190, 120, 0.40)",
    cloud: "rgba(255, 214, 170, 0.32)",
    stars: false,
    embers: false,
    topA: [242, 216, 150],
    topB: [200, 166, 104],
    topDepth: 9,
    soil: [186, 146, 88],
    soilDark: [130, 96, 54],
    rim: [246, 224, 170],
    debris: "#c9a36a",
    water: "rgba(60, 140, 170, 0.5)",
    waterDeep: "rgba(20, 60, 90, 0.78)",
    waterFoam: "rgba(220, 246, 255, 0.85)",
    fog: "rgba(230, 180, 120, 0.06)",
  },
  snow: {
    skyTop: "#070f1f",
    skyMid: "#1b3350",
    skyBottom: "#5b7fa5",
    glow: "rgba(200, 226, 255, 0.30)",
    cloud: "rgba(226, 238, 255, 0.35)",
    stars: true,
    embers: false,
    topA: [244, 250, 255],
    topB: [186, 208, 232],
    topDepth: 8,
    soil: [126, 148, 176],
    soilDark: [72, 92, 120],
    rim: [214, 232, 252],
    debris: "#cfe0f2",
    water: "rgba(70, 150, 200, 0.5)",
    waterDeep: "rgba(16, 54, 92, 0.8)",
    waterFoam: "rgba(235, 250, 255, 0.9)",
    fog: "rgba(180, 210, 240, 0.07)",
  },
  hell: {
    skyTop: "#0a0306",
    skyMid: "#37060c",
    skyBottom: "#7e1a10",
    glow: "rgba(255, 110, 40, 0.35)",
    cloud: "rgba(120, 30, 20, 0.5)",
    stars: false,
    embers: true,
    topA: [255, 138, 46],
    topB: [122, 34, 18],
    topDepth: 5,
    soil: [56, 40, 44],
    soilDark: [26, 18, 22],
    rim: [176, 62, 30],
    debris: "#5a3a34",
    water: "rgba(214, 74, 22, 0.62)",
    waterDeep: "rgba(120, 22, 6, 0.85)",
    waterFoam: "rgba(255, 200, 110, 0.9)",
    fog: "rgba(255, 90, 40, 0.05)",
  },
};

interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Buduje bitmapę terenu na offscreen canvasie o rozmiarach świata.
 * Pełna przebudowa tylko przy zmianie terenu (nowa gra / terrainSync),
 * a po eksplozjach – wyłącznie prostokąt wokół dziury.
 */
export class TerrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private noise: Uint8Array;
  private terrain: Terrain;
  private pal: ThemePalette;
  private lastVersion = -1;
  private dirty: DirtyRect[] = [];

  constructor(terrain: Terrain, theme: ThemeId, seed: number) {
    this.terrain = terrain;
    this.pal = THEMES[theme] ?? THEMES.grass;
    this.canvas = document.createElement("canvas");
    this.canvas.width = terrain.width;
    this.canvas.height = terrain.height;
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Brak kontekstu 2D dla tekstury terenu");
    this.ctx = ctx;
    this.img = this.ctx.createImageData(terrain.width, terrain.height);
    this.noise = makeNoise(terrain.width, terrain.height, seed);
    this.rebuildAll();
  }

  setTheme(theme: ThemeId): void {
    this.pal = THEMES[theme] ?? THEMES.grass;
    this.rebuildAll();
  }

  get palette(): ThemePalette {
    return this.pal;
  }

  /** Podmienia teren (np. po terrainSync) i przebudowuje całość. */
  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    if (terrain.width !== this.canvas.width || terrain.height !== this.canvas.height) {
      this.canvas.width = terrain.width;
      this.canvas.height = terrain.height;
      this.img = this.ctx.createImageData(terrain.width, terrain.height);
      this.noise = makeNoise(terrain.width, terrain.height, 1);
    }
    this.rebuildAll();
  }

  /** Zgłoś obszar zmieniony przez eksplozję / belkę – przerysujemy tylko go. */
  markDirty(x: number, y: number, w: number, h: number): void {
    const pad = 3;
    this.dirty.push({
      x0: Math.max(0, Math.floor(x - pad)),
      y0: Math.max(0, Math.floor(y - pad)),
      x1: Math.min(this.terrain.width - 1, Math.ceil(x + w + pad)),
      y1: Math.min(this.terrain.height - 1, Math.ceil(y + h + pad)),
    });
    this.lastVersion = this.terrain.version;
  }

  /** Wywoływane raz na klatkę – dociąga zaległe zmiany. */
  update(): void {
    if (this.terrain.version !== this.lastVersion) {
      // zmiana, o której nie wiemy skąd pochodzi -> pełna przebudowa
      this.dirty.length = 0;
      this.rebuildAll();
      return;
    }
    if (this.dirty.length === 0) return;
    for (const r of this.dirty) this.paintRect(r.x0, r.y0, r.x1, r.y1);
    this.dirty.length = 0;
  }

  rebuildAll(): void {
    this.paintRect(0, 0, this.terrain.width - 1, this.terrain.height - 1);
    this.lastVersion = this.terrain.version;
  }

  private paintRect(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    if (x1 < x0 || y1 < y0) return;
    const d = t.data;
    const p = this.img.data;
    const pal = this.pal;
    const td = pal.topDepth;
    const noise = this.noise;

    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      // pionowy gradient przyciemniający głębiej położoną ziemię
      const depthShade = 1 - 0.28 * (y / h);
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const o = i * 4;
        if (d[i] === 0) {
          p[o + 3] = 0;
          continue;
        }
        // ile pikseli w górę do powietrza (maks. td+1)
        let up = td + 1;
        for (let k = 1; k <= td; k++) {
          const yy = y - k;
          if (yy < 0) break;
          if (d[yy * w + x] === 0) {
            up = k;
            break;
          }
        }
        const n = noise[i];
        let r: number;
        let g: number;
        let b: number;
        if (up <= td) {
          const tt = td > 1 ? (up - 1) / (td - 1) : 0;
          r = pal.topA[0] + (pal.topB[0] - pal.topA[0]) * tt;
          g = pal.topA[1] + (pal.topB[1] - pal.topA[1]) * tt;
          b = pal.topA[2] + (pal.topB[2] - pal.topA[2]) * tt;
          const jitter = (n - 128) * 0.16;
          r += jitter;
          g += jitter;
          b += jitter;
        } else {
          const m = n / 255;
          r = (pal.soilDark[0] + (pal.soil[0] - pal.soilDark[0]) * m) * depthShade;
          g = (pal.soilDark[1] + (pal.soil[1] - pal.soilDark[1]) * m) * depthShade;
          b = (pal.soilDark[2] + (pal.soil[2] - pal.soilDark[2]) * m) * depthShade;
          // krawędź boczna / dolna -> jaśniejszy rant
          const left = x > 0 ? d[i - 1] : 1;
          const right = x < w - 1 ? d[i + 1] : 1;
          const down = y < h - 1 ? d[i + w] : 0;
          if (left === 0 || right === 0 || down === 0) {
            r = r * 0.45 + pal.rim[0] * 0.55;
            g = g * 0.45 + pal.rim[1] * 0.55;
            b = b * 0.45 + pal.rim[2] * 0.55;
          }
        }
        p[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        p[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        p[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        p[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
}

function makeNoise(w: number, h: number, seed: number): Uint8Array {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const n = new Uint8Array(w * h);
  // dwie skale szumu: drobne ziarno + większe plamy
  const bw = Math.ceil(w / 16) + 1;
  const bh = Math.ceil(h / 16) + 1;
  const blob = new Float32Array(bw * bh);
  for (let i = 0; i < blob.length; i++) blob[i] = rng.next();
  for (let y = 0; y < h; y++) {
    const by = y / 16;
    const y0 = by | 0;
    const fy = by - y0;
    const y1 = Math.min(bh - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const bx = x / 16;
      const x0 = bx | 0;
      const fx = bx - x0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const a = blob[y0 * bw + x0] * (1 - fx) + blob[y0 * bw + x1] * fx;
      const b = blob[y1 * bw + x0] * (1 - fx) + blob[y1 * bw + x1] * fx;
      const big = a * (1 - fy) + b * fy;
      const fine = rng.next();
      n[y * w + x] = Math.max(0, Math.min(255, (big * 0.65 + fine * 0.35) * 255)) | 0;
    }
  }
  return n;
}

/** Mały podgląd mapy do lobby – próbkowanie terenu do rozmiaru kanwy. */
export function renderTerrainPreview(
  terrain: Terrain,
  ctx: CanvasRenderingContext2D,
  theme: ThemeId,
): void {
  const pal = THEMES[theme] ?? THEMES.grass;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(0.55, pal.skyMid);
  sky.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const img = ctx.createImageData(w, h);
  const p = img.data;
  const sx = terrain.width / w;
  const sy = terrain.height / h;
  for (let y = 0; y < h; y++) {
    const ty = Math.min(terrain.height - 1, (y * sy) | 0);
    for (let x = 0; x < w; x++) {
      const tx = Math.min(terrain.width - 1, (x * sx) | 0);
      const o = (y * w + x) * 4;
      if (!terrain.isSolid(tx, ty)) {
        p[o + 3] = 0;
        continue;
      }
      const top = !terrain.isSolid(tx, ty - Math.ceil(sy) * 2);
      const c = top ? pal.topA : pal.soil;
      p[o] = c[0];
      p[o + 1] = c[1];
      p[o + 2] = c[2];
      p[o + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);

  // linia wody
  ctx.fillStyle = pal.water;
  const wl = (h * (terrain.height - 40)) / terrain.height;
  ctx.fillRect(0, wl, w, h - wl);
}
