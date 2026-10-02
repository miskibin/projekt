import type { GameConfig } from "@shared/protocol";
import { Terrain } from "@shared/engine/terrain";
import { Rng } from "@shared/engine/rng";

export type ThemeId = GameConfig["theme"];
export type RGB = [number, number, number];

/** Kształt sylwetek warstw parallaxu w tle (patrz `background.ts`). */
export type BgStyle = "mountains" | "peaks" | "dunes" | "spires";

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

  // --- czapa (trawa / piasek / śnieg / skorupa lawy) ---
  /** jasna obwódka tuż pod konturem */
  topHi: RGB;
  /** główny kolor czapy */
  topA: RGB;
  /** ciemniejszy dolny pas czapy */
  topB: RGB;
  /** ciemna linia na spodzie czapy (ząbkowana) */
  topEdge: RGB;
  /** średnia grubość czapy w pikselach świata, razem z konturem */
  topDepth: number;

  // --- ziemia ---
  soil: RGB;
  /** ciemne grudy */
  soilDark: RGB;
  /** jaśniejsze grudy */
  soilLight: RGB;
  /** prawie czarna, „kruszona” skorupa na bokach i podcięciach */
  crust: RGB;
  /** jasny rant na krawędziach zwróconych ku górze (dno krateru) */
  rim: RGB;
  /** gruby kontur dookoła całego terenu */
  outline: RGB;
  /** głazy: baza, jasna i ciemna ściana */
  rock: RGB;
  rockHi: RGB;
  rockLo: RGB;
  /** kolor odłamków ziemi w cząsteczkach */
  debris: string;

  water: string;
  waterDeep: string;
  waterFoam: string;
  fog: string;

  /** gęstość kępek trawy (0 = brak) */
  tufts: number;
  /** gęstość krzaczków (0 = brak) */
  bushes: number;

  // --- tło (parallax) ---
  bgStyle: BgStyle;
  /** najdalsza warstwa (najjaśniejsza – perspektywa powietrzna) */
  bgFar: string;
  /** czubki gór / grzbiety najdalszej warstwy */
  bgPeak: string;
  bgMid: string;
  bgNear: string;
  /** wysokość linii horyzontu jako ułamek wysokości świata */
  horizon: number;
  /** tarcza słońca / księżyca */
  sun: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  grass: {
    skyTop: "#17457f",
    skyMid: "#3877b3",
    skyBottom: "#7fb3da",
    glow: "rgba(255, 244, 214, 0.26)",
    cloud: "rgba(210, 230, 248, 0.5)",
    stars: false,
    embers: false,
    topHi: [160, 184, 76],
    topA: [118, 142, 60],
    topB: [96, 118, 52],
    topEdge: [68, 76, 42],
    topDepth: 14,
    soil: [88, 58, 40],
    soilDark: [70, 45, 32],
    soilLight: [108, 72, 50],
    crust: [30, 20, 22],
    rim: [190, 150, 108],
    outline: [38, 28, 30],
    rock: [62, 62, 68],
    rockHi: [96, 96, 104],
    rockLo: [42, 42, 48],
    debris: "#6b4630",
    water: "rgba(64, 114, 186, 0.9)",
    waterDeep: "rgba(40, 78, 142, 0.96)",
    waterFoam: "rgba(150, 198, 240, 1)",
    fog: "rgba(120, 170, 210, 0.05)",
    tufts: 0.22,
    bushes: 0.035,
    bgStyle: "mountains",
    bgFar: "#8fb0cd",
    bgPeak: "#d6e6f4",
    bgMid: "#5f8fbb",
    bgNear: "#2f6f76",
    horizon: 0.68,
    sun: "rgba(255, 249, 224, 0.55)",
  },
  desert: {
    skyTop: "#2a1740",
    skyMid: "#96513c",
    skyBottom: "#eebd83",
    glow: "rgba(255, 190, 120, 0.40)",
    cloud: "rgba(255, 214, 170, 0.34)",
    stars: false,
    embers: false,
    topHi: [252, 236, 178],
    topA: [232, 202, 138],
    topB: [206, 170, 110],
    topEdge: [150, 112, 68],
    topDepth: 13,
    soil: [158, 106, 64],
    soilDark: [134, 88, 52],
    soilLight: [178, 124, 78],
    crust: [54, 32, 24],
    rim: [240, 208, 152],
    outline: [62, 40, 28],
    rock: [124, 94, 74],
    rockHi: [158, 124, 98],
    rockLo: [92, 68, 52],
    debris: "#b98a58",
    water: "rgba(70, 146, 172, 0.88)",
    waterDeep: "rgba(36, 86, 116, 0.95)",
    waterFoam: "rgba(220, 246, 255, 0.88)",
    fog: "rgba(230, 180, 120, 0.06)",
    tufts: 0.12,
    bushes: 0,
    bgStyle: "dunes",
    bgFar: "#d1a179",
    bgPeak: "#f0cda3",
    bgMid: "#ac764f",
    bgNear: "#6d4530",
    horizon: 0.7,
    sun: "rgba(255, 214, 148, 0.6)",
  },
  snow: {
    skyTop: "#050b18",
    skyMid: "#16294a",
    skyBottom: "#4a6c94",
    glow: "rgba(200, 226, 255, 0.28)",
    cloud: "rgba(226, 238, 255, 0.32)",
    stars: true,
    embers: false,
    topHi: [255, 255, 255],
    topA: [232, 242, 252],
    topB: [202, 220, 240],
    topEdge: [140, 166, 204],
    topDepth: 15,
    soil: [92, 104, 128],
    soilDark: [74, 84, 108],
    soilLight: [112, 126, 152],
    crust: [24, 30, 44],
    rim: [208, 228, 250],
    outline: [26, 34, 52],
    rock: [66, 74, 94],
    rockHi: [100, 112, 136],
    rockLo: [44, 50, 68],
    debris: "#cfe0f2",
    water: "rgba(88, 152, 200, 0.9)",
    waterDeep: "rgba(44, 88, 136, 0.96)",
    waterFoam: "rgba(235, 250, 255, 0.92)",
    fog: "rgba(180, 210, 240, 0.07)",
    tufts: 0.1,
    bushes: 0,
    bgStyle: "peaks",
    bgFar: "#42597c",
    bgPeak: "#cadcf2",
    bgMid: "#2d4262",
    bgNear: "#182741",
    horizon: 0.68,
    sun: "rgba(214, 232, 255, 0.42)",
  },
  hell: {
    skyTop: "#0a0306",
    skyMid: "#3c060c",
    skyBottom: "#8a1d10",
    glow: "rgba(255, 110, 40, 0.35)",
    cloud: "rgba(120, 30, 20, 0.5)",
    stars: false,
    embers: true,
    topHi: [255, 222, 130],
    topA: [255, 150, 60],
    topB: [214, 92, 36],
    topEdge: [120, 38, 18],
    topDepth: 11,
    soil: [64, 44, 48],
    soilDark: [48, 33, 38],
    soilLight: [82, 58, 62],
    crust: [12, 8, 10],
    rim: [214, 112, 62],
    outline: [14, 8, 10],
    rock: [46, 36, 42],
    rockHi: [78, 62, 70],
    rockLo: [30, 22, 28],
    debris: "#5a3a34",
    water: "rgba(214, 86, 28, 0.9)",
    waterDeep: "rgba(140, 38, 14, 0.96)",
    waterFoam: "rgba(255, 200, 110, 0.9)",
    fog: "rgba(255, 90, 40, 0.05)",
    tufts: 0.16,
    bushes: 0,
    bgStyle: "spires",
    bgFar: "#6d2619",
    bgPeak: "#8f3220",
    bgMid: "#48160f",
    bgNear: "#250d0b",
    horizon: 0.7,
    sun: "rgba(255, 120, 50, 0.5)",
  },
};

interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Wartość „daleko” w wektorowej transformacie odległości (mieści się w Int8). */
const FAR = 60;
/** Ile pikseli poza przemalowywany prostokąt liczymy pola pomocnicze (≥ zasięg skorupy). */
const MARGIN = 14;
/** Zasięg „kruszonej” skorupy od krawędzi (boki / podcięcia). */
const CRUST_SIDE = 6;
const CRUST_UNDER = 10;
/** Jak daleko od dziury trzeba przemalować teren (kontur + skorupa + wysokość krzaków). */
const REPAINT_PAD = 28;
/** Kontur terenu: pełny do OUT_FULL, potem płynnie do OUT_END pikseli od powietrza. */
const OUT_FULL = 2.4;
const OUT_END = 3.2;

/** Ozdoba stojąca na trawie: kępa albo krzaczek. Rysowana ponad terenem, o ile grunt pod nią istnieje. */
interface Decor {
  x: number;
  y: number;
  bush: boolean;
  variant: number;
  flip: 1 | -1;
  scale: number;
  rot: number;
  /** połowa szerokości do sprawdzenia podłoża */
  half: number;
}

interface DecorSprite {
  canvas: HTMLCanvasElement;
  ax: number;
  ay: number;
}

const TUFT_VARIANTS = 4;
const BUSH_VARIANTS = 3;

/**
 * Buduje bitmapę terenu na offscreen canvasie o rozmiarach świata.
 * Pełna przebudowa tylko przy zmianie terenu (nowa gra / terrainSync),
 * a po eksplozjach – wyłącznie prostokąt wokół dziury.
 *
 * Styl (wg makiety): jednolita, ciepła ziemia z ciemnymi grudami i kanciastymi
 * głazami, gruba ciemna obwódka, czapa trawy o ząbkowanym spodzie oraz
 * kępki i krzaczki na wierzchu. Warstwa trawy, grudy, głazy i ozdoby są
 * wypiekane RAZ z terenu sprzed zniszczeń, więc po wybuchu odsłaniają się
 * kolejne warstwy (przekrój trawy nad ziemią, ciemna skorupa w kraterze).
 */
export class TerrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  /** odcień czapy trawy 0..4 (0 = brak trawy), wypieczony z nienaruszonego terenu */
  private grass: Uint8Array;
  /** grudy i kamyki: 128 = neutralnie, <128 ciemniej, >128 jaśniej */
  private blot: Uint8Array;
  /** głazy: 0 brak, 1 kontur, 2 ciemna ściana, 3 środek, 4 jasna ściana */
  private rocks: Uint8Array;
  /** wektor do najbliższego powietrza (transformata odległości) */
  private vdx: Int8Array;
  private vdy: Int8Array;
  /** 1 = powietrze połączone z otwartym niebem; potrzebne tylko przy wypiekaniu trawy */
  private open: Uint8Array | null = null;
  /** stos span-fillu (reużywany, żeby nie alokować co klatkę) */
  private stack: number[] = [];
  private decor: Decor[] = [];
  private sprites: { tufts: DecorSprite[]; bushes: DecorSprite[] } | null = null;
  private terrain: Terrain;
  private pal: ThemePalette;
  private seed: number;
  private lastVersion = -1;
  private dirty: DirtyRect[] = [];
  private strataOffsets = new Float32Array(0);

  constructor(terrain: Terrain, theme: ThemeId, seed: number) {
    this.terrain = terrain;
    this.seed = seed >>> 0;
    this.bakeStrata(terrain.width);
    this.pal = THEMES[theme] ?? THEMES.grass;
    this.canvas = document.createElement("canvas");
    this.canvas.width = terrain.width;
    this.canvas.height = terrain.height;
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Brak kontekstu 2D dla tekstury terenu");
    this.ctx = ctx;
    this.img = this.ctx.createImageData(terrain.width, terrain.height);
    const n = terrain.width * terrain.height;
    this.grass = new Uint8Array(n);
    this.blot = new Uint8Array(n);
    this.rocks = new Uint8Array(n);
    this.vdx = new Int8Array(n);
    this.vdy = new Int8Array(n);
    this.bake();
    this.rebuildAll();
  }

  setTheme(theme: ThemeId): void {
    this.pal = THEMES[theme] ?? THEMES.grass;
    this.sprites = null;
    this.bake();
    this.rebuildAll();
  }

  get palette(): ThemePalette {
    return this.pal;
  }

  /**
   * Podmienia teren (np. po terrainSync) i przebudowuje całość. Warstwy
   * wypiekane z terenu początkowego zostają, żeby kratery nie porastały trawą.
   */
  setTerrain(terrain: Terrain): void {
    const resized = terrain.width !== this.canvas.width || terrain.height !== this.canvas.height;
    this.terrain = terrain;
    if (resized) {
      this.bakeStrata(terrain.width);
      this.canvas.width = terrain.width;
      this.canvas.height = terrain.height;
      this.img = this.ctx.createImageData(terrain.width, terrain.height);
      const n = terrain.width * terrain.height;
      this.grass = new Uint8Array(n);
      this.blot = new Uint8Array(n);
      this.rocks = new Uint8Array(n);
      this.vdx = new Int8Array(n);
      this.vdy = new Int8Array(n);
      this.bake();
    }
    this.rebuildAll();
  }

  private bakeStrata(width: number): void {
    this.strataOffsets = Float32Array.from({length:width},(_,x)=>
      Math.sin(x*0.011+(this.seed%31))*10 + Math.sin(x*0.004)*17);
  }

  /** Zgłoś obszar zmieniony przez eksplozję / belkę – przerysujemy tylko go. */
  markDirty(x: number, y: number, w: number, h: number): void {
    const pad = REPAINT_PAD;
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
    // Salwy, banany i wybuchy łańcuchowe potrafią zgłosić kilkanaście kraterów
    // naraz. Ich pola pomocnicze są kosztowne; nakładające się dziury malujemy
    // jednym przebiegiem, już po zastosowaniu wszystkich zmian bitmapy.
    const merged: DirtyRect[] = [];
    for (const rect of this.dirty) {
      let next = rect;
      for (let i = 0; i < merged.length;) {
        const prev = merged[i];
        if (next.x0 > prev.x1 + 1 || prev.x0 > next.x1 + 1 ||
            next.y0 > prev.y1 + 1 || prev.y0 > next.y1 + 1) {
          i++;
          continue;
        }
        next = {
          x0: Math.min(next.x0, prev.x0), y0: Math.min(next.y0, prev.y0),
          x1: Math.max(next.x1, prev.x1), y1: Math.max(next.y1, prev.y1),
        };
        merged.splice(i, 1);
        i = 0;
      }
      merged.push(next);
    }
    for (const r of merged) this.paintRect(r.x0, r.y0, r.x1, r.y1);
    this.dirty.length = 0;
  }

  rebuildAll(): void {
    this.paintRect(0, 0, this.terrain.width - 1, this.terrain.height - 1);
    this.lastVersion = this.terrain.version;
  }

  private paintRect(x0: number, y0: number, x1: number, y1: number): void {
    if (x1 < x0 || y1 < y0) return;
    const t = this.terrain;
    const rx0 = Math.max(0, x0 - MARGIN);
    const ry0 = Math.max(0, y0 - MARGIN);
    const rx1 = Math.min(t.width - 1, x1 + MARGIN);
    const ry1 = Math.min(t.height - 1, y1 + MARGIN);
    this.computeField(rx0, ry0, rx1, ry1);
    this.paintPixels(x0, y0, x1, y1);
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.paintDecor(x0, y0, x1, y1);
  }

  // -------------------------------------------------------------- wypiekanie

  /** Warstwy zależne tylko od seeda i terenu początkowego. */
  private bake(): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    this.open = new Uint8Array(w * h);
    this.computeOpen(0, 0, w - 1, h - 1);
    this.computeField(0, 0, w - 1, h - 1);
    this.bakeGrass();
    this.open = null;
    const soil = makeSoilDetail(w, h, this.seed);
    this.blot = soil.blot;
    this.rocks = soil.rocks;
    this.bakeDecor();
  }

  private bakeGrass(): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    const d = t.data;
    const vx = this.vdx;
    const vy = this.vdy;
    const open = this.open as Uint8Array;
    const grass = this.grass;
    grass.fill(0);
    const cap = this.pal.topDepth;
    const capMax = (cap * 1.2 + 5) * (cap * 1.2 + 5);
    const sm = makeSmooth(w, h, this.seed);
    const seedLo = this.seed & 1023;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (d[i] === 0) continue;
        const dx = vx[i];
        const dy = vy[i];
        const dd = dx * dx + dy * dy;
        if (dd >= capMax) continue;
        const dist = Math.sqrt(dd);
        if (open[i + dy * w + dx] !== 1) continue;
        const base = capDepthAt(cap, dy / dist, sm[i]);
        if (base <= 0) continue;
        // ząbkowany spód: trójkątna fala wzdłuż powierzchni, więc też na zboczach
        const along = (y * dx - x * dy) / dist;
        const capE = base + toothAt(along, seedLo) * Math.min(1, base / 8);
        if (capE < 2.6 || dist > capE) continue;
        const below = capE - dist;
        let band: number;
        if (below < 1.9) band = 4;
        else if (dist < 5.4) band = 1;
        else if (below < capE * 0.36) band = 3;
        else band = 2;
        grass[i] = band;
      }
    }
  }

  private bakeDecor(): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    const d = t.data;
    const grass = this.grass;
    const pal = this.pal;
    this.decor = [];
    if (pal.tufts <= 0 && pal.bushes <= 0) return;
    const surf = (x: number): number => {
      if (x < 0 || x >= w) return -1;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (d[i] !== 0) return grass[i] !== 0 ? y : -1;
      }
      return -1;
    };
    const rng = new Rng((this.seed ^ 0x51ed270b) >>> 0);
    let x = 16;
    while (x < w - 16) {
      const y = surf(x);
      if (y < 0) {
        x += 5;
        continue;
      }
      const yl = surf(x - 7);
      const yr = surf(x + 7);
      const roll = rng.next();
      const flat = yl >= 0 && yr >= 0 && Math.abs(yl - y) <= 2 && Math.abs(yr - y) <= 2 &&
        Math.abs(surf(x - 14) - y) <= 4 && Math.abs(surf(x + 14) - y) <= 4;
      if (flat && roll < pal.bushes) {
        this.decor.push({
          x, y: y + 1, bush: true, variant: (rng.next() * BUSH_VARIANTS) | 0,
          flip: rng.next() < 0.5 ? -1 : 1, scale: 0.9 + rng.next() * 0.35, rot: 0, half: 15,
        });
        x += 46 + ((rng.next() * 50) | 0);
        continue;
      }
      if (yl >= 0 && yr >= 0 && Math.abs(yr - yl) <= 8 && roll < pal.tufts + pal.bushes) {
        this.decor.push({
          x, y: y + 1, bush: false, variant: (rng.next() * TUFT_VARIANTS) | 0,
          flip: rng.next() < 0.5 ? -1 : 1, scale: 0.85 + rng.next() * 0.4,
          rot: Math.atan2(yr - yl, 14) * 0.9, half: 7,
        });
        x += 14 + ((rng.next() * 26) | 0);
        continue;
      }
      x += 5 + ((rng.next() * 7) | 0);
    }
  }

  private decorSprites(): { tufts: DecorSprite[]; bushes: DecorSprite[] } {
    if (!this.sprites) {
      const tufts: DecorSprite[] = [];
      const bushes: DecorSprite[] = [];
      for (let i = 0; i < TUFT_VARIANTS; i++) tufts.push(bakeTuft(this.pal, i));
      if (this.pal.bushes > 0) for (let i = 0; i < BUSH_VARIANTS; i++) bushes.push(bakeBush(this.pal, i));
      this.sprites = { tufts, bushes };
    }
    return this.sprites;
  }

  /** Kępki i krzaczki stoją w powietrzu nad terenem, więc dorysowujemy je po putImageData. */
  private paintDecor(x0: number, y0: number, x1: number, y1: number): void {
    if (this.decor.length === 0) return;
    const { tufts, bushes } = this.decorSprites();
    const t = this.terrain;
    const w = t.width;
    const d = t.data;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    ctx.clip();
    const list = this.decor;
    // lista jest posortowana po x; szukamy pierwszego elementu, który może zahaczyć o prostokąt
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].x < x0 - 40) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < list.length; k++) {
      const dc = list[k];
      if (dc.x > x1 + 40) break;
      const sy = dc.y + 3;
      if (sy >= t.height) continue;
      let alive = true;
      for (const off of [-dc.half, 0, dc.half]) {
        const sx = dc.x + off;
        if (sx < 0 || sx >= w || d[sy * w + sx] === 0) {
          alive = false;
          break;
        }
      }
      if (!alive) continue;
      const spr = dc.bush ? bushes[dc.variant] : tufts[dc.variant];
      if (!spr) continue;
      ctx.setTransform(1, 0, 0, 1, dc.x, dc.y);
      if (dc.rot !== 0) ctx.rotate(dc.rot);
      ctx.scale(dc.flip * dc.scale, dc.scale);
      ctx.drawImage(spr.canvas, -spr.ax, -spr.ay);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- pola

  /**
   * Zaznacza powietrze połączone z otwartym niebem (span-fill od krawędzi obszaru).
   * Dzięki temu zamknięte jaskinie nie dostają czapy trawy – w środku jest goła ziemia.
   * Dla prostokąta częściowego zarodkami są otwarte piksele tuż za jego krawędzią,
   * więc zwykłe wybuchy (połączone z niebem) aktualizują się poprawnie i tanio.
   */
  private computeOpen(rx0: number, ry0: number, rx1: number, ry1: number): void {
    const t = this.terrain;
    const w = t.width;
    const d = t.data;
    const open = this.open as Uint8Array;
    for (let y = ry0; y <= ry1; y++) {
      const row = y * w;
      for (let x = rx0; x <= rx1; x++) open[row + x] = 0;
    }

    const st = this.stack;
    st.length = 0;
    const seed = (x: number, y: number): void => {
      const i = y * w + x;
      if (d[i] !== 0 || open[i] !== 0) return;
      st.push(x, x, y - 1, 1, x, x, y + 1, -1);
    };
    // „niebo” to tylko górna krawędź świata – szczelina na wodę pod terenem nią nie jest
    for (let x = rx0; x <= rx1; x++) {
      if (ry0 === 0 || open[(ry0 - 1) * w + x] === 1) seed(x, ry0);
      if (ry1 < t.height - 1 && open[(ry1 + 1) * w + x] === 1) seed(x, ry1);
    }
    for (let y = ry0; y <= ry1; y++) {
      const row = y * w;
      if (rx0 > 0 && open[row + rx0 - 1] === 1) seed(rx0, y);
      if (rx1 < w - 1 && open[row + rx1 + 1] === 1) seed(rx1, y);
    }

    while (st.length > 0) {
      const dy = st.pop() as number;
      const y0 = st.pop() as number;
      const x2 = st.pop() as number;
      const x1 = st.pop() as number;
      const y = y0 + dy;
      if (y < ry0 || y > ry1) continue;
      const row = y * w;
      let x = x1;
      while (x <= x2) {
        if (d[row + x] !== 0 || open[row + x] !== 0) {
          x++;
          continue;
        }
        let l = x;
        while (l > rx0 && d[row + l - 1] === 0 && open[row + l - 1] === 0) l--;
        let r = x;
        while (r < rx1 && d[row + r + 1] === 0 && open[row + r + 1] === 0) r++;
        for (let k = l; k <= r; k++) open[row + k] = 1;
        st.push(l, r, y, dy);
        if (l < x1 - 1) st.push(l, x1 - 2, y, -dy);
        if (r > x2 + 1) st.push(x2 + 2, r, y, -dy);
        x = r + 1;
      }
    }
  }

  /**
   * Wektorowa transformata odległości do najbliższego powietrza (dwa przebiegi chamfer)
   * + klasyfikacja pikseli na powietrze / czapę / ziemię.
   * Poza kanwą traktujemy świat jako pełny, więc na bocznych krawędziach mapy nie ma trawy.
   */
  private computeField(rx0: number, ry0: number, rx1: number, ry1: number): void {
    const t = this.terrain;
    const w = t.width;
    const d = t.data;
    const vx = this.vdx;
    const vy = this.vdy;

    for (let y = ry0; y <= ry1; y++) {
      const row = y * w;
      for (let x = rx0; x <= rx1; x++) {
        const i = row + x;
        if (d[i] === 0) {
          vx[i] = 0;
          vy[i] = 0;
        } else {
          vx[i] = FAR;
          vy[i] = FAR;
        }
      }
    }

    // Danielsson 4SED: dwa przebiegi pionowe, w każdym dodatkowy przelot poziomy
    // w przeciwną stronę – bez niego odległości bywają zawyżone i wynik zależy od
    // odległych fragmentów mapy (czapa trawy „migałaby” po wybuchach gdzie indziej).
    for (let y = ry0; y <= ry1; y++) {
      const row = y * w;
      for (let x = rx0; x <= rx1; x++) {
        const i = row + x;
        let bx = vx[i];
        let by = vy[i];
        if (bx === 0 && by === 0) continue;
        let bd = bx * bx + by * by;
        if (y > ry0) {
          const j = i - w;
          {
            const cx = vx[j];
            const cy = vy[j] - 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
          if (x > rx0) {
            const k = j - 1;
            const cx = vx[k] - 1;
            const cy = vy[k] - 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
          if (x < rx1) {
            const k = j + 1;
            const cx = vx[k] + 1;
            const cy = vy[k] - 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
        }
        if (x > rx0) {
          const j = i - 1;
          const cx = vx[j] - 1;
          const cy = vy[j];
          const cd = cx * cx + cy * cy;
          if (cd < bd) {
            bd = cd;
            bx = cx;
            by = cy;
          }
        }
        vx[i] = bx;
        vy[i] = by;
      }
      for (let x = rx1 - 1; x >= rx0; x--) {
        const i = row + x;
        const bx = vx[i];
        const by = vy[i];
        if (bx === 0 && by === 0) continue;
        const j = i + 1;
        const cx = vx[j] + 1;
        const cy = vy[j];
        if (cx * cx + cy * cy < bx * bx + by * by) {
          vx[i] = cx;
          vy[i] = cy;
        }
      }
    }

    for (let y = ry1; y >= ry0; y--) {
      const row = y * w;
      for (let x = rx1; x >= rx0; x--) {
        const i = row + x;
        let bx = vx[i];
        let by = vy[i];
        if (bx === 0 && by === 0) continue;
        let bd = bx * bx + by * by;
        if (y < ry1) {
          const j = i + w;
          {
            const cx = vx[j];
            const cy = vy[j] + 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
          if (x < rx1) {
            const k = j + 1;
            const cx = vx[k] + 1;
            const cy = vy[k] + 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
          if (x > rx0) {
            const k = j - 1;
            const cx = vx[k] - 1;
            const cy = vy[k] + 1;
            const cd = cx * cx + cy * cy;
            if (cd < bd) {
              bd = cd;
              bx = cx;
              by = cy;
            }
          }
        }
        if (x < rx1) {
          const j = i + 1;
          const cx = vx[j] + 1;
          const cy = vy[j];
          const cd = cx * cx + cy * cy;
          if (cd < bd) {
            bd = cd;
            bx = cx;
            by = cy;
          }
        }
        vx[i] = bx;
        vy[i] = by;
      }
      for (let x = rx0 + 1; x <= rx1; x++) {
        const i = row + x;
        const bx = vx[i];
        const by = vy[i];
        if (bx === 0 && by === 0) continue;
        const j = i - 1;
        const cx = vx[j] - 1;
        const cy = vy[j];
        if (cx * cx + cy * cy < bx * bx + by * by) {
          vx[i] = cx;
          vy[i] = cy;
        }
      }
    }
  }

  private paintPixels(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    const d = t.data;
    const p = this.img.data;
    const pal = this.pal;
    const vx = this.vdx;
    const vy = this.vdy;
    const grass = this.grass;
    const blot = this.blot;
    const rocks = this.rocks;

    const band: RGB[] = [pal.topEdge, pal.topHi, pal.topA, pal.topB, pal.topEdge];
    const [olR, olG, olB] = pal.outline;
    const [soR, soG, soB] = pal.soil;
    const [sdR, sdG, sdB] = pal.soilDark;
    const [slR, slG, slB] = pal.soilLight;
    const [crR, crG, crB] = pal.crust;
    const [riR, riG, riB] = pal.rim;
    const rockTone: RGB[] = [pal.rock, pal.outline, pal.rockLo, pal.rock, pal.rockHi];

    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      const depthShade = 1 - 0.16 * (y / h);
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const o = i * 4;

        if (d[i] === 0) {
          // powietrze: tylko antyaliasowany zewnętrzny brzeg konturu
          let solid = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const yy = y + oy;
            if (yy < 0 || yy >= h) continue;
            const rr = yy * w;
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const xx = x + ox;
              if (xx < 0 || xx >= w) continue;
              if (d[rr + xx] !== 0) solid++;
            }
          }
          if (solid === 0) {
            p[o + 3] = 0;
            continue;
          }
          const a = solid * 0.16;
          p[o] = olR;
          p[o + 1] = olG;
          p[o + 2] = olB;
          p[o + 3] = a > 1 ? 255 : a * 255;
          continue;
        }

        const dx = vx[i];
        const dy = vy[i];
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const uy = dy / dist;
        let r: number;
        let g: number;
        let b: number;

        const gb = grass[i];
        if (gb !== 0) {
          const c = band[gb];
          const gr = (fine(x, y) - 128) * 0.035;
          r = c[0] + gr;
          g = c[1] + gr;
          b = c[2] + gr;
        } else {
          const rk = rocks[i];
          if (rk !== 0) {
            const c = rockTone[rk];
            r = c[0] * depthShade;
            g = c[1] * depthShade;
            b = c[2] * depthShade;
          } else {
            const o2 = blot[i] - 128;
            if (o2 < 0) {
              const k = Math.min(0.7, -o2 / 55);
              r = soR + (sdR - soR) * k;
              g = soG + (sdG - soG) * k;
              b = soB + (sdB - soB) * k;
            } else if (o2 > 0) {
              const k = Math.min(0.55, o2 / 55);
              r = soR + (slR - soR) * k;
              g = soG + (slG - soG) * k;
              b = soB + (slB - soB) * k;
            } else {
              r = soR;
              g = soG;
              b = soB;
            }
            r *= depthShade;
            g *= depthShade;
            b *= depthShade;
            // Sedimentary seams reveal the cross-section without adding per-frame work.
            const layer = (y + this.strataOffsets[x] + 100) % 62;
            const seam = layer < 2.5 ? 0.22 : layer < 6 ? 0.07 : layer > 36 ? -0.055 : 0;
            r += (seam > 0 ? slR-r : r-sdR)*seam;
            g += (seam > 0 ? slG-g : g-sdG)*seam;
            b += (seam > 0 ? slB-b : b-sdB)*seam;
          }

          if (uy > -0.5) {
            // boki i podcięcia: prawie czarna, kruszona skorupa
            const under = clamp01((uy - 0.1) / 0.6);
            const reach = CRUST_SIDE + (CRUST_UNDER - CRUST_SIDE) * under;
            if (dist < reach) {
              const near = 1 - (dist - OUT_FULL) / (reach - OUT_FULL);
              const crumb = fine(x >> 1, y >> 1) / 255 - 0.5;
              const c = (near < 0 ? 0 : near) * 1.3 - 0.16 + crumb * 0.85;
              const cw = clamp01((c - 0.3) / 0.14);
              if (cw > 0) {
                r += (crR - r) * cw;
                g += (crG - g) * cw;
                b += (crB - b) * cw;
              }
            }
          } else if (dist > OUT_FULL - 0.3 && dist < 4.6) {
            // jasny rant na krawędzi zwróconej ku górze
            const m = dist < 3.2 ? 1 : (4.6 - dist) / 1.4;
            const rw = m * clamp01(-uy * 1.6 - 0.6) * 0.92;
            r += (riR - r) * rw;
            g += (riG - g) * rw;
            b += (riB - b) * rw;
          }
        }

        if (dist < OUT_END) {
          const ow = dist <= OUT_FULL ? 1 : (OUT_END - dist) / (OUT_END - OUT_FULL);
          r += (olR - r) * ow;
          g += (olG - g) * ow;
          b += (olB - b) * ow;
        }

        p[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        p[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        p[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        p[o + 3] = 255;
      }
    }
  }
}

/**
 * Grubość czapy w danym punkcie. Pełna tam, gdzie powietrze jest nad pikselem,
 * cieńsza na stromych bokach, zerowa pod spodem. `sm` faluje dolną krawędź.
 */
function capDepthAt(cap: number, uy: number, sm: number): number {
  let f = (0.36 - uy) / 0.96;
  if (f <= 0) return 0;
  if (f > 1) f = 1;
  const s = f * f * (3 - 2 * f);
  return cap * s * (0.86 + 0.28 * (sm / 255));
}

/** Trójkątne „zęby” na spodzie czapy; `along` to współrzędna wzdłuż powierzchni. */
function toothAt(along: number, seed: number): number {
  const q = along / 10.5;
  const k = Math.floor(q);
  const f = q - k;
  const amp = 0.55 + (fine(k, seed) / 255) * 0.9;
  const tri = f < 0.5 ? f * 2 : (1 - f) * 2;
  return (tri - 0.42) * 6.4 * amp;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Tani, deterministyczny hash per-piksel (drobne ziarno bez dodatkowej pamięci). */
function fine(x: number, y: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) & 255;
}


/** Gładki szum o zadanej skali; interpolacja smoothstep. */
function makeSmooth(w: number, h: number, seed: number, cs = 18): Uint8Array {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const bw = Math.ceil(w / cs) + 2;
  const bh = Math.ceil(h / cs) + 2;
  const blob = new Float32Array(bw * bh);
  for (let i = 0; i < blob.length; i++) blob[i] = rng.next();
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const by = y / cs;
    const iy = by | 0;
    let fy = by - iy;
    fy = fy * fy * (3 - 2 * fy);
    const r0 = iy * bw;
    const r1 = (iy + 1) * bw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const bx = x / cs;
      const ix = bx | 0;
      let fx = bx - ix;
      fx = fx * fx * (3 - 2 * fx);
      const a = blob[r0 + ix] * (1 - fx) + blob[r0 + ix + 1] * fx;
      const c = blob[r1 + ix] * (1 - fx) + blob[r1 + ix + 1] * fx;
      out[row + x] = ((a * (1 - fy) + c * fy) * 255) | 0;
    }
  }
  return out;
}



function paintBlob(blot: Uint8Array, w: number, h: number, cx: number, cy: number, rx: number, ry: number, amp: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const ny = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const nd = Math.sqrt(nx * nx + ny * ny);
      if (nd >= 1) continue;
      const s = nd < 0.7 ? 1 : (1 - nd) / 0.3;
      const v = amp * s;
      const i = y * w + x;
      const cur = blot[i] - 128;
      if (Math.abs(v) > Math.abs(cur)) blot[i] = Math.max(1, Math.min(255, 128 + v));
    }
  }
}

/**
 * Grudy ziemi (miękkie plamy) z drobnymi kamykami oraz rzadkie, kanciaste głazy
 * o płaskich ścianach. Wszystko liczone raz na mapę, w współrzędnych świata.
 */
function makeSoilDetail(w: number, h: number, seed: number): { blot: Uint8Array; rocks: Uint8Array } {
  const blot = new Uint8Array(w * h).fill(128);
  const rocks = new Uint8Array(w * h);
  const rng = new Rng((seed ^ 0x6d2b79f5) >>> 0);

  const cell = 24;
  for (let gy = 0; gy < h; gy += cell) {
    for (let gx = 0; gx < w; gx += cell) {
      const roll = rng.next();
      if (roll < 0.22) continue;
      const cx = gx + rng.next() * cell;
      const cy = gy + rng.next() * cell;
      if (roll > 0.86) {
        const r = 1.3 + rng.next() * 1.4;
        paintBlob(blot, w, h, cx, cy, r, r * 0.85, -60);
        continue;
      }
      const r = 5 + Math.pow(rng.next(), 1.5) * 12;
      const tone = rng.next() < 0.72 ? -1 : 1;
      paintBlob(blot, w, h, cx, cy, r, r * (0.72 + rng.next() * 0.5), tone * (11 + rng.next() * 22));
    }
  }

  const spacing = 132;
  const lx = -0.55;
  const ly = -0.83;
  for (let gy = 0; gy < h; gy += spacing) {
    for (let gx = 0; gx < w; gx += spacing) {
      if (rng.next() > 0.7) continue;
      const count = rng.next() > 0.86 ? 2 : 1;
      for (let b = 0; b < count; b++) {
        const cx = gx + 14 + rng.next() * (spacing - 28);
        const cy = gy + 14 + rng.next() * (spacing - 28);
        const rx = 11 + rng.next() * 21;
        const ry = 9 + rng.next() * 14;
        const points = 6 + ((rng.next() * 3) | 0);
        const px: number[] = [];
        const py: number[] = [];
        for (let j = 0; j < points; j++) {
          const a = (j * Math.PI * 2) / points + 0.11;
          const jitter = 0.74 + rng.next() * 0.42;
          px.push(cx + Math.cos(a) * rx * jitter);
          py.push(cy + Math.sin(a) * ry * jitter);
        }
        const cutA = rng.next() * Math.PI * 2;
        const mx = Math.cos(cutA);
        const my = Math.sin(cutA);
        const cutAt = 0.3 + rng.next() * 0.25;
        const rr = (rx + ry) * 0.5;
        const yStart = Math.max(1, Math.floor(cy - ry * 1.2));
        const yEnd = Math.min(h - 2, Math.ceil(cy + ry * 1.2));
        const spans: [number, number][] = [];
        for (let y = yStart; y <= yEnd; y++) {
          const hits: number[] = [];
          for (let j = 0; j < points; j++) {
            const k = (j + 1) % points;
            if ((py[j] <= y && py[k] > y) || (py[k] <= y && py[j] > y)) {
              hits.push(px[j] + ((y - py[j]) * (px[k] - px[j])) / (py[k] - py[j]));
            }
          }
          hits.sort((a, c) => a - c);
          const lo = hits.length >= 2 ? Math.ceil(hits[0]) : 1;
          const hi = hits.length >= 2 ? Math.floor(hits[hits.length - 1]) : 0;
          spans.push([lo, hi]);
        }
        for (let s = 0; s < spans.length; s++) {
          const [lo, hi] = spans[s];
          const y = yStart + s;
          const above = s > 0 ? spans[s - 1] : [1, 0];
          const below = s + 1 < spans.length ? spans[s + 1] : [1, 0];
          for (let x = Math.max(0, lo); x <= Math.min(w - 1, hi); x++) {
            const edge = x - lo < 1 || hi - x < 1 ||
              x < above[0] + 1 || x > above[1] - 1 || x < below[0] + 1 || x > below[1] - 1;
            let code: number;
            if (edge) code = 1;
            else {
              const u = ((x - cx) * lx + (y - cy) * ly) / rr;
              code = u > 0.3 ? 4 : u < -0.26 ? 2 : 3;
              const v = ((x - cx) * mx + (y - cy) * my) / rr;
              if (v > cutAt && code > 2) code--;
            }
            rocks[y * w + x] = code;
          }
        }
      }
    }
  }
  return { blot, rocks };
}

function bakeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Brak kontekstu 2D dla ozdób terenu");
  return [c, ctx];
}

const rgb = (c: RGB): string => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/**
 * Kępka źdźbeł: kilka trójkątnych ostrzy z ciemną obwódką. Podstawa jest
 * otwarta (bez obrysu) i zachodzi na czapę, żeby kępa wyrastała z trawy.
 */
function bakeTuft(pal: ThemePalette, variant: number): DecorSprite {
  const shapes: number[][] = [
    [7, 11, 8],
    [9, 6],
    [6, 10, 13, 7],
    [10, 7, 9, 5],
  ];
  const blades = shapes[variant % shapes.length];
  const step = 5.6;
  const span = blades.length * step;
  const W = Math.ceil(span + 10);
  const H = 24;
  const baseY = 19;
  const [canvas, ctx] = bakeCanvas(W, H);
  const cx = W / 2;
  const x0 = cx - span / 2;
  const pts: [number, number][] = [[x0 - 0.6, baseY + 4], [x0 - 0.6, baseY - 0.5]];
  const lit: [number, number][][] = [];
  for (let k = 0; k < blades.length; k++) {
    const vx = x0 + k * step;
    const lean = ((k % 2 === 0 ? -1 : 1) * 0.35 + (variant === 3 ? 1.2 : 0));
    const px = vx + step / 2 + lean;
    const py = baseY - blades[k];
    pts.push([px, py]);
    pts.push([vx + step, baseY - 0.5 - (k === blades.length - 1 ? 0 : 1.6)]);
    lit.push([[px, py], [vx + 0.4, baseY - 0.5], [px - 0.2, baseY - 0.5]]);
  }
  pts.push([x0 + span + 0.6, baseY + 4]);

  ctx.lineJoin = "miter";
  ctx.miterLimit = 2.6;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
  ctx.fillStyle = rgb(pal.topA);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgb(pal.topHi);
  for (const tri of lit) {
    ctx.beginPath();
    ctx.moveTo(tri[0][0], tri[0][1]);
    ctx.lineTo(tri[1][0], tri[1][1]);
    ctx.lineTo(tri[2][0], tri[2][1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(pts[1][0], pts[1][1]);
  for (let k = 2; k < pts.length - 1; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.strokeStyle = rgb(pal.outline);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  return { canvas, ax: cx, ay: baseY };
}

/** Krzaczek z kilku zaokrąglonych „listków”, z grubą obwódką jak reszta świata. */
function bakeBush(pal: ThemePalette, variant: number): DecorSprite {
  const layouts: [number, number, number][][] = [
    [[-9, -5, 7], [0, -10, 9], [9, -5, 7], [-1, -3, 6]],
    [[-11, -4, 6], [-3, -9, 8], [6, -8, 8], [12, -3, 6], [1, -3, 6]],
    [[-7, -6, 8], [4, -10, 8], [10, -4, 6], [-1, -2, 5]],
  ];
  const lobes = layouts[variant % layouts.length];
  const W = 52;
  const H = 34;
  const baseY = 27;
  const cx = W / 2;
  const [canvas, ctx] = bakeCanvas(W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, baseY + 1.5);
  ctx.clip();
  ctx.fillStyle = rgb(pal.outline);
  for (const [lx, ly, lr] of lobes) {
    ctx.beginPath();
    ctx.arc(cx + lx, baseY + ly, lr + 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [lx, ly, lr] of lobes) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + lx, baseY + ly, lr, 0, Math.PI * 2);
    ctx.fillStyle = rgb(pal.topA);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = rgb(pal.topB);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx + lx - 1.6, baseY + ly - 1.8, lr + 0.6, Math.PI * 0.02, Math.PI * 0.6);
    ctx.stroke();
    ctx.strokeStyle = rgb(pal.topHi);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx + lx + 1.1, baseY + ly + 1.3, lr - 0.6, Math.PI * 1.02, Math.PI * 1.62);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  return { canvas, ax: cx, ay: baseY };
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

  // pas dalekich wzgórz, żeby podgląd nie był płaski
  ctx.fillStyle = pal.bgFar;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  const hy = h * pal.horizon;
  ctx.moveTo(0, h);
  ctx.lineTo(0, hy);
  for (let x = 0; x <= w; x += 6) {
    ctx.lineTo(x, hy - Math.sin(x * 0.07) * h * 0.05 - Math.sin(x * 0.021 + 1.7) * h * 0.06);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  const img = ctx.createImageData(w, h);
  const p = img.data;
  const sx = terrain.width / w;
  const sy = terrain.height / h;
  const capRows = Math.max(1, Math.round(pal.topDepth / sy));
  for (let y = 0; y < h; y++) {
    const ty = Math.min(terrain.height - 1, (y * sy) | 0);
    for (let x = 0; x < w; x++) {
      const tx = Math.min(terrain.width - 1, (x * sx) | 0);
      const o = (y * w + x) * 4;
      if (!terrain.isSolid(tx, ty)) {
        p[o + 3] = 0;
        continue;
      }
      const top = !terrain.isSolid(tx, (ty - Math.ceil(sy) * capRows) | 0);
      let r: number;
      let g: number;
      let b: number;
      if (top) {
        r = pal.topA[0];
        g = pal.topA[1];
        b = pal.topA[2];
      } else {
        // delikatne ziarno – w tej skali pełny kontrast kamyków byłby szumem
        const n = (fine(x >> 1, y >> 1) - 128) * 0.1;
        r = pal.soil[0] + n;
        g = pal.soil[1] + n;
        b = pal.soil[2] + n;
        // kontur na krawędziach próbkowanej bitmapy
        const edge =
          !terrain.isSolid(tx - (sx | 0) - 1, ty) ||
          !terrain.isSolid(tx + (sx | 0) + 1, ty) ||
          !terrain.isSolid(tx, ty + (sy | 0) + 1);
        if (edge) {
          r = r * 0.35 + pal.outline[0] * 0.65;
          g = g * 0.35 + pal.outline[1] * 0.65;
          b = b * 0.35 + pal.outline[2] * 0.65;
        }
      }
      p[o] = r;
      p[o + 1] = g;
      p[o + 2] = b;
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
