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
  /** wierzchnia warstwa (trawa / piasek / śnieg / skorupa lawy) */
  topA: RGB;
  topB: RGB;
  /** grubość czapy w pikselach (mierzona jako odległość od powietrza) */
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

  // --- wygląd terenu (kostka brukowa + czapa) ---
  /** rozjaśnienie tuż przy samej górze czapy */
  topHi: RGB;
  /** ciemniejsza linia na dolnej krawędzi czapy */
  topEdge: RGB;
  /** ciemny kontur dookoła całego terenu */
  outline: RGB;
  /** jaśniejszy i ciemniejszy odcień „kamyka” (Worley) */
  stoneA: RGB;
  stoneB: RGB;
  /** ciemna „zaprawa” między kamykami – zarazem kolor cienia w kraterach */
  mortar: RGB;
  /** rozmiar oczka siatki kamyków w pikselach */
  pebble: number;
  /** gęstość kępek trawy sterczących ponad powierzchnię (0 = brak) */
  tufts: number;

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
    topA: [158, 214, 87],
    topB: [59, 123, 58],
    topDepth: 17,
    soil: [150, 104, 62],
    soilDark: [96, 64, 38],
    rim: [186, 140, 88],
    debris: "#8a5f38",
    water: "rgba(46, 122, 190, 0.55)",
    waterDeep: "rgba(14, 52, 96, 0.80)",
    waterFoam: "rgba(190, 232, 255, 0.9)",
    fog: "rgba(120, 170, 210, 0.05)",
    topHi: [190, 235, 116],
    topEdge: [42, 96, 30],
    outline: [44, 27, 16],
    stoneA: [174, 128, 88],
    stoneB: [115, 80, 60],
    mortar: [58, 37, 22],
    pebble: 43,
    tufts: 0.46,
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
    topA: [246, 222, 160],
    topB: [206, 170, 110],
    topDepth: 13,
    soil: [190, 150, 92],
    soilDark: [134, 100, 58],
    rim: [246, 224, 170],
    debris: "#c9a36a",
    water: "rgba(60, 140, 170, 0.5)",
    waterDeep: "rgba(20, 60, 90, 0.78)",
    waterFoam: "rgba(220, 246, 255, 0.85)",
    fog: "rgba(230, 180, 120, 0.06)",
    topHi: [255, 243, 206],
    topEdge: [168, 130, 76],
    outline: [88, 58, 32],
    stoneA: [190, 148, 92],
    stoneB: [138, 102, 60],
    mortar: [104, 74, 44],
    pebble: 52,
    tufts: 0.06,
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
    topA: [248, 252, 255],
    topB: [196, 216, 238],
    topDepth: 15,
    soil: [126, 148, 176],
    soilDark: [72, 92, 120],
    rim: [214, 232, 252],
    debris: "#cfe0f2",
    water: "rgba(70, 150, 200, 0.5)",
    waterDeep: "rgba(16, 54, 92, 0.8)",
    waterFoam: "rgba(235, 250, 255, 0.9)",
    fog: "rgba(180, 210, 240, 0.07)",
    topHi: [255, 255, 255],
    topEdge: [148, 175, 208],
    outline: [34, 46, 66],
    stoneA: [134, 154, 180],
    stoneB: [86, 106, 134],
    mortar: [46, 60, 82],
    pebble: 46,
    tufts: 0.08,
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
    topA: [255, 150, 52],
    topB: [126, 38, 18],
    topDepth: 10,
    soil: [58, 42, 46],
    soilDark: [28, 20, 24],
    rim: [176, 62, 30],
    debris: "#5a3a34",
    water: "rgba(214, 74, 22, 0.62)",
    waterDeep: "rgba(120, 22, 6, 0.85)",
    waterFoam: "rgba(255, 200, 110, 0.9)",
    fog: "rgba(255, 90, 40, 0.05)",
    topHi: [255, 226, 148],
    topEdge: [78, 18, 10],
    outline: [12, 7, 9],
    stoneA: [68, 52, 58],
    stoneB: [38, 28, 34],
    mortar: [16, 10, 14],
    pebble: 38,
    tufts: 0.22,
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

const AIR = 0;
const GRASS = 1;
const SOIL = 2;
/** Wartość „daleko” w wektorowej transformacie odległości (mieści się w Int8). */
const FAR = 60;
/** Ile pikseli poza przemalowywany prostokąt liczymy pola pomocnicze. */
const MARGIN = 30;
/** Maksymalna wysokość kępki trawy nad powierzchnią. */
const TUFT_MAX = 6;
/** Zasięg miękkiego cienia wewnątrz krateru. */
const SHADOW_REACH = 11;

/**
 * Buduje bitmapę terenu na offscreen canvasie o rozmiarach świata.
 * Pełna przebudowa tylko przy zmianie terenu (nowa gra / terrainSync),
 * a po eksplozjach – wyłącznie prostokąt wokół dziury.
 *
 * Wygląd: ziemia z proceduralnego szumu komórkowego (Worley) daje „bruk” z kamyków
 * z zaprawą i światłem od góry-lewej, na wierzchu gruba czapa (trawa/piasek/śnieg/lawa)
 * oplatająca też strome boki, dookoła ciemny kontur + antyaliasing 1-bitowej bitmapy.
 */
export class TerrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  /** gładki szum niskiej częstotliwości – faluje dolną krawędź czapy */
  private smooth: Uint8Array;
  /** oświetlenie/zaprawa kamyków (128 = neutralnie) */
  private stone: Uint8Array;
  /** odcień pojedynczego kamyka (stały w obrębie komórki Worleya) */
  private tint: Uint8Array;
  /** AIR / GRASS / SOIL, liczone w padded-rect przed malowaniem */
  private kind: Uint8Array;
  /** wektor do najbliższego powietrza (transformata odległości) */
  private vdx: Int8Array;
  private vdy: Int8Array;
  /** 1 = powietrze połączone z otwartym niebem (nie wnętrze jaskini) */
  private open: Uint8Array;
  /** stos span-fillu (reużywany, żeby nie alokować co klatkę) */
  private stack: number[] = [];
  /** wysokość kępki trawy dla każdej kolumny świata */
  private tuft: Uint8Array;
  private terrain: Terrain;
  private pal: ThemePalette;
  private seed: number;
  private lastVersion = -1;
  private dirty: DirtyRect[] = [];

  constructor(terrain: Terrain, theme: ThemeId, seed: number) {
    this.terrain = terrain;
    this.seed = seed >>> 0;
    this.pal = THEMES[theme] ?? THEMES.grass;
    this.canvas = document.createElement("canvas");
    this.canvas.width = terrain.width;
    this.canvas.height = terrain.height;
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Brak kontekstu 2D dla tekstury terenu");
    this.ctx = ctx;
    this.img = this.ctx.createImageData(terrain.width, terrain.height);
    const n = terrain.width * terrain.height;
    this.smooth = makeSmooth(terrain.width, terrain.height, this.seed);
    const st = makeStone(terrain.width, terrain.height, this.seed, this.pal.pebble);
    this.stone = st.stone;
    this.tint = st.tint;
    this.kind = new Uint8Array(n);
    this.vdx = new Int8Array(n);
    this.vdy = new Int8Array(n);
    this.open = new Uint8Array(n);
    this.tuft = makeTufts(terrain.width, this.seed, this.pal.tufts);
    this.rebuildAll();
  }

  setTheme(theme: ThemeId): void {
    const next = THEMES[theme] ?? THEMES.grass;
    if (next.pebble !== this.pal.pebble) {
      const st = makeStone(this.terrain.width, this.terrain.height, this.seed, next.pebble);
      this.stone = st.stone;
      this.tint = st.tint;
    }
    this.pal = next;
    this.tuft = makeTufts(this.terrain.width, this.seed, next.tufts);
    this.rebuildAll();
  }

  get palette(): ThemePalette {
    return this.pal;
  }

  /** Podmienia teren (np. po terrainSync) i przebudowuje całość. */
  setTerrain(terrain: Terrain): void {
    const resized = terrain.width !== this.canvas.width || terrain.height !== this.canvas.height;
    this.terrain = terrain;
    if (resized) {
      this.canvas.width = terrain.width;
      this.canvas.height = terrain.height;
      this.img = this.ctx.createImageData(terrain.width, terrain.height);
      const n = terrain.width * terrain.height;
      this.smooth = makeSmooth(terrain.width, terrain.height, this.seed);
      const st = makeStone(terrain.width, terrain.height, this.seed, this.pal.pebble);
      this.stone = st.stone;
      this.tint = st.tint;
      this.kind = new Uint8Array(n);
      this.vdx = new Int8Array(n);
      this.vdy = new Int8Array(n);
      this.open = new Uint8Array(n);
      this.tuft = makeTufts(terrain.width, this.seed, this.pal.tufts);
    }
    this.rebuildAll();
  }

  /** Zgłoś obszar zmieniony przez eksplozję / belkę – przerysujemy tylko go. */
  markDirty(x: number, y: number, w: number, h: number): void {
    // czapa (do 1.2x grubości) + kępki + cień w kraterze sięgają dalej niż sama dziura
    const pad = Math.ceil(this.pal.topDepth * 1.2) + TUFT_MAX + SHADOW_REACH + 2;
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
    if (x1 < x0 || y1 < y0) return;
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    const rx0 = Math.max(0, x0 - MARGIN);
    const ry0 = Math.max(0, y0 - MARGIN);
    const rx1 = Math.min(w - 1, x1 + MARGIN);
    const ry1 = Math.min(h - 1, y1 + MARGIN);
    this.computeOpen(rx0, ry0, rx1, ry1);
    this.computeField(rx0, ry0, rx1, ry1);
    this.paintPixels(x0, y0, x1, y1);
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

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
    const open = this.open;
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
    const kind = this.kind;

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

    // klasyfikacja
    const cap = this.pal.topDepth;
    const capMax = (cap * 1.2 + 2) * (cap * 1.2 + 2);
    const sm = this.smooth;
    const open = this.open;
    for (let y = ry0; y <= ry1; y++) {
      const row = y * w;
      for (let x = rx0; x <= rx1; x++) {
        const i = row + x;
        if (d[i] === 0) {
          kind[i] = AIR;
          continue;
        }
        const dx = vx[i];
        const dy = vy[i];
        const dd = dx * dx + dy * dy;
        if (dd >= capMax) {
          kind[i] = SOIL;
          continue;
        }
        const dist = Math.sqrt(dd);
        const grass = dist <= capDepthAt(cap, dy / dist, sm[i]) && open[i + dy * w + dx] === 1;
        kind[i] = grass ? GRASS : SOIL;
      }
    }
  }

  private paintPixels(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const w = t.width;
    const h = t.height;
    const p = this.img.data;
    const pal = this.pal;
    const kind = this.kind;
    const vx = this.vdx;
    const vy = this.vdy;
    const stone = this.stone;
    const tint = this.tint;
    const sm = this.smooth;
    const tuft = this.tuft;
    const cap = pal.topDepth;

    const taR = pal.topA[0];
    const taG = pal.topA[1];
    const taB = pal.topA[2];
    const tbR = pal.topB[0];
    const tbG = pal.topB[1];
    const tbB = pal.topB[2];
    const thR = pal.topHi[0];
    const thG = pal.topHi[1];
    const thB = pal.topHi[2];
    const teR = pal.topEdge[0];
    const teG = pal.topEdge[1];
    const teB = pal.topEdge[2];
    const olR = pal.outline[0];
    const olG = pal.outline[1];
    const olB = pal.outline[2];
    const saR = pal.stoneA[0];
    const saG = pal.stoneA[1];
    const saB = pal.stoneA[2];
    const sbR = pal.stoneB[0];
    const sbG = pal.stoneB[1];
    const sbB = pal.stoneB[2];
    const moR = pal.mortar[0];
    const moG = pal.mortar[1];
    const moB = pal.mortar[2];
    const riR = pal.rim[0];
    const riG = pal.rim[1];
    const riB = pal.rim[2];

    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      const depthShade = 1 - 0.24 * (y / h);
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const o = i * 4;
        const k = kind[i];

        if (k === AIR) {
          // 1) kępki trawy sterczące ponad powierzchnię
          const th = tuft[x];
          let drawn = false;
          if (th > 0) {
            for (let s = 1; s <= th; s++) {
              const yy = y + s;
              if (yy >= h) break;
              const kk = kind[i + s * w];
              if (kk === AIR) continue;
              // kępki tylko na w miarę poziomej powierzchni – na stromych zboczach robiły „futro”
              if (kk === GRASS && flatSurface(kind, w, h, x, yy)) {
                const up = th > 1 ? (s - 1) / (th - 1) : 0;
                const bl = 0.25 + 0.55 * up;
                p[o] = taR + (thR - taR) * bl;
                p[o + 1] = taG + (thG - taG) * bl;
                p[o + 2] = taB + (thB - taB) * bl;
                p[o + 3] = s >= th ? 150 : 235;
                drawn = true;
              }
              break;
            }
          }
          if (drawn) continue;

          // 2) antyaliasing krawędzi: pokrycie z liczby stałych sąsiadów
          let solid = 0;
          let green = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const yy = y + oy;
            if (yy < 0 || yy >= h) continue;
            const rr = yy * w;
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const xx = x + ox;
              if (xx < 0 || xx >= w) continue;
              const kk = kind[rr + xx];
              if (kk === AIR) continue;
              solid++;
              if (kk === GRASS) green++;
            }
          }
          if (solid === 0) {
            p[o + 3] = 0;
            continue;
          }
          const a = solid * 0.15;
          if (green * 2 >= solid) {
            p[o] = teR;
            p[o + 1] = teG;
            p[o + 2] = teB;
          } else {
            p[o] = olR;
            p[o + 1] = olG;
            p[o + 2] = olB;
          }
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

        if (k === GRASS) {
          const capE = capDepthAt(cap, uy, sm[i]);
          const tt = capE > 1.2 ? clamp01((dist - 0.6) / (capE - 0.6)) : 0;
          const e = tt * tt * (3 - 2 * tt);
          r = taR + (tbR - taR) * e;
          g = taG + (tbG - taG) * e;
          b = taB + (tbB - taB) * e;
          // ciemna linia na dolnej krawędzi czapy
          const be = clamp01((tt - 0.68) / 0.32);
          const bw = be * be * 0.92;
          if (bw > 0) {
            r += (teR - r) * bw;
            g += (teG - g) * bw;
            b += (teB - b) * bw;
          }
          // rozjaśnienie przy samej górze
          if (dist < 2.8) {
            const hw = (1 - dist / 2.8) * 0.72;
            r += (thR - r) * hw;
            g += (thG - g) * hw;
            b += (thB - b) * hw;
          }
          // czapa opadająca po stromym boku dostaje kontur zamiast rozjaśnienia
          if (dist < 1.7 && uy > -0.3) {
            const ow = (1 - dist / 1.7) * 0.6;
            r += (olR - r) * ow;
            g += (olG - g) * ow;
            b += (olB - b) * ow;
          }
          const gr = (fine(x, y) - 128) * 0.1;
          r += gr;
          g += gr;
          b += gr;
        } else {
          const tn = tint[i] / 255;
          r = sbR + (saR - sbR) * tn;
          g = sbG + (saG - sbG) * tn;
          b = sbB + (saB - sbB) * tn;
          const mul = (0.5 + (stone[i] / 255) * 1.0) * depthShade * (0.86 + (sm[i] / 255) * 0.28);
          r *= mul;
          g *= mul;
          b *= mul;
          // Broad sediment bands and restrained grain keep the cross-section organic.
          const strata = Math.sin(y * 0.075 + sm[i] * 0.025) * 4;
          const gr = (fine(x, y) - 128) * 0.025 + strata;
          r += gr;
          g += gr;
          b += gr;
          if (dist < SHADOW_REACH) {
            // miękki cień wewnątrz krateru (mocniejszy tam, gdzie powietrze jest poniżej)
            const down = clamp01((uy + 0.35) / 0.8);
            const sc = 1 - dist / SHADOW_REACH;
            const sh = sc * sc * (0.16 + 0.46 * down);
            r += (moR - r) * sh;
            g += (moG - g) * sh;
            b += (moB - b) * sh;
            if (dist < 2.3) {
              const ow = dist < 1.45 ? 0.92 : 0.5;
              r += (olR - r) * ow;
              g += (olG - g) * ow;
              b += (olB - b) * ow;
            } else if (uy < -0.55 && dist < 4.5) {
              // jaśniejszy rant na odsłoniętej ziemi zwróconej do góry (dno krateru)
              const rw = (1 - dist / 4.5) * 0.22;
              r += (riR - r) * rw;
              g += (riG - g) * rw;
              b += (riB - b) * rw;
            }
          }
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
  return cap * s * (0.8 + 0.4 * (sm / 255));
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

/** Gładki szum (komórki ~18 px, interpolacja smoothstep). */
function makeSmooth(w: number, h: number, seed: number): Uint8Array {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const cs = 18;
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

/**
 * Szum komórkowy (Worley) z jitterowanej siatki – „bruk” z zaokrąglonych kamyków.
 * `stone` = oświetlenie (128 neutralnie, jasno w górnym-lewym rancie kamyka,
 * ciemno w prawym-dolnym i w zaprawie), `tint` = stały odcień danego kamyka.
 */
function makeStone(w: number, h: number, seed: number, cell: number): { stone: Uint8Array; tint: Uint8Array } {
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const fx = new Float32Array(gw * gh);
  const fy = new Float32Array(gw * gh);
  const ft = new Uint8Array(gw * gh);
  const fr = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const j = gy * gw + gx;
      fx[j] = (gx - 1 + 0.18 + rng.next() * 0.64) * cell;
      fy[j] = (gy - 1 + 0.18 + rng.next() * 0.64) * cell;
      ft[j] = (rng.next() * 255) | 0;
      fr[j] = cell * (0.4 + rng.next() * 0.28);
    }
  }
  const stone = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  const lx = -0.7071;
  const ly = -0.7071;
  const mortarW = Math.max(1.2, cell * 0.055);
  for (let y = 0; y < h; y++) {
    const gy = ((y / cell) | 0) + 1;
    const row = y * w;
    const g0 = gy > 0 ? gy - 1 : 0;
    const g1 = gy + 1 < gh ? gy + 1 : gh - 1;
    for (let x = 0; x < w; x++) {
      const gx = ((x / cell) | 0) + 1;
      const h0 = gx > 0 ? gx - 1 : 0;
      const h1 = gx + 1 < gw ? gx + 1 : gw - 1;
      let b1 = 1e9;
      let b2 = 1e9;
      let bj = 0;
      for (let gyy = g0; gyy <= g1; gyy++) {
        const base = gyy * gw;
        for (let gxx = h0; gxx <= h1; gxx++) {
          const j = base + gxx;
          const ddx = fx[j] - x;
          const ddy = fy[j] - y;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < b1) {
            b2 = b1;
            b1 = dd;
            bj = j;
          } else if (dd < b2) {
            b2 = dd;
          }
        }
      }
      const d1 = Math.sqrt(b1);
      const d2 = Math.sqrt(b2);
      const edge = d2 - d1;
      const seam = edge < mortarW ? 1 - edge / mortarW : 0;
      const R = fr[bj];
      // zaokrąglenie kamyka: poza promieniem R robi się „zaprawa”
      let round = (d1 - (R - 2.4)) / 2.4;
      if (round < 0) round = 0;
      else if (round > 1) round = 1;
      const dark = Math.max(seam * seam, round * round * 0.18);
      let rr = d1 / R;
      if (rr > 1) rr = 1;
      const inv = d1 > 0.001 ? 1 / d1 : 0;
      const lam = (x - fx[bj]) * inv * lx + (y - fy[bj]) * inv * ly;
      const v = 128 + lam * rr * 34 - rr * rr * 8 - dark * 65;
      stone[row + x] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
      tint[row + x] = ft[bj];
    }
  }
  return { stone, tint };
}

/** Czy powierzchnia w (x, yy) – pierwszy stały piksel pod powietrzem – jest lokalnie prawie pozioma. */
function flatSurface(kind: Uint8Array, w: number, h: number, x: number, yy: number): boolean {
  for (const dx of [-2, 2]) {
    const xx = x + dx;
    if (xx < 0 || xx >= w) return false;
    if (yy + 1 >= h || yy - 2 < 0) return false;
    if (kind[(yy + 1) * w + xx] === AIR) return false; // sąsiad niżej musi być stały
    if (kind[(yy - 2) * w + xx] !== AIR) return false; // a 2 px wyżej – powietrze
  }
  return true;
}

/** Wysokość kępki trawy dla każdej kolumny (deterministycznie z seeda). */
function makeTufts(w: number, seed: number, amount: number): Uint8Array {
  const out = new Uint8Array(w);
  if (amount <= 0) return out;
  const rng = new Rng((seed ^ 0x2545f491) >>> 0);
  let x = 0;
  while (x < w) {
    if (rng.next() < amount) {
      const bw = 1 + (rng.next() < 0.35 ? 1 : 0);
      const hgt = 2 + ((rng.next() * (TUFT_MAX - 1)) | 0);
      for (let k = 0; k < bw && x + k < w; k++) out[x + k] = hgt;
      x += bw + 2 + ((rng.next() * 5) | 0);
    } else {
      x += 1 + ((rng.next() * 3) | 0);
    }
  }
  return out;
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
        r = pal.stoneB[0] * 0.42 + pal.stoneA[0] * 0.58 + n;
        g = pal.stoneB[1] * 0.42 + pal.stoneA[1] * 0.58 + n;
        b = pal.stoneB[2] * 0.42 + pal.stoneA[2] * 0.58 + n;
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
