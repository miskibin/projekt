import type { ThemeId } from "./terrainRenderer";

/**
 * Modele sceny pieczone raz do małych płócien i wstawiane przez `drawImage`.
 * Gruby, jednolity kontur, płaskie wypełnienia i kilka kresek cieniowania kosztują
 * tylko raz — na telefonie zostaje jeden blit na obiekt.
 */

export interface BakedSprite {
  canvas: HTMLCanvasElement;
  /** Punkt zaczepienia (pień / środek) w pikselach sprite'a. */
  ax: number;
  ay: number;
  /** Odległość od zaczepienia do czubka, w pikselach sprite'a. Drzewo skaluje się tym. */
  span: number;
}

const INK = "#2e2219";

interface TreePaint {
  leaf: string;
  leafHi: string;
  leafLo: string;
  wood: string;
  woodHi: string;
  woodLo: string;
  /** Biała czapa na górnych płatach (śnieg). */
  cap: string | null;
  sparse: boolean;
  ember: boolean;
}

const TREE_PAINT: Record<ThemeId, TreePaint> = {
  grass: {
    leaf: "#809b37",
    leafHi: "#b0c745",
    leafLo: "#5c702a",
    wood: "#6a4830",
    woodHi: "#8a6442",
    woodLo: "#46301f",
    cap: null,
    sparse: false,
    ember: false,
  },
  desert: {
    leaf: "#98a552",
    leafHi: "#c6cf7a",
    leafLo: "#6a7838",
    wood: "#9a7048",
    woodHi: "#bd9264",
    woodLo: "#6a4a2c",
    cap: null,
    sparse: true,
    ember: false,
  },
  snow: {
    leaf: "#4a8080",
    leafHi: "#7fb4ae",
    leafLo: "#325c62",
    wood: "#6a5040",
    woodHi: "#8a6c58",
    woodLo: "#46352a",
    cap: "#eef6fa",
    sparse: false,
    ember: false,
  },
  hell: {
    leaf: "#b8502c",
    leafHi: "#ea8a44",
    leafLo: "#7a2c1c",
    wood: "#403238",
    woodHi: "#5e4a52",
    woodLo: "#291d22",
    cap: null,
    sparse: false,
    ember: true,
  },
};

interface Blob {
  x: number;
  y: number;
  r: number;
}

interface Branch {
  /** Punkt na pniu (0 = korzeń, 1 = czubek). */
  at: number;
  dx: number;
  dy: number;
  /** Promień kępy liści na końcu gałęzi. */
  puff: number;
}

interface TreeShape {
  trunk: number;
  lean: number;
  bend: number;
  crown: number;
  branches: Branch[];
}

const SHAPES: readonly TreeShape[] = [
  {
    trunk: 150,
    lean: 6,
    bend: 18,
    crown: 58,
    branches: [
      { at: 0.55, dx: -62, dy: -42, puff: 34 },
      { at: 0.68, dx: 64, dy: -34, puff: 32 },
    ],
  },
  {
    trunk: 176,
    lean: -14,
    bend: -20,
    crown: 50,
    branches: [
      { at: 0.5, dx: 58, dy: -40, puff: 32 },
      { at: 0.72, dx: -54, dy: -26, puff: 28 },
    ],
  },
  {
    trunk: 126,
    lean: 18,
    bend: 14,
    crown: 62,
    branches: [
      { at: 0.5, dx: -66, dy: -30, puff: 36 },
      { at: 0.6, dx: 72, dy: -38, puff: 34 },
      { at: 0.82, dx: 20, dy: -34, puff: 24 },
    ],
  },
];

const treeCache = new Map<string, BakedSprite>();
const crateCache = new Map<string, BakedSprite>();
let fuelBarrel: BakedSprite | null = null;
let mineBody: (BakedSprite & { lampX: number; lampY: number }) | null = null;

/** Rekwizyty rysujemy w jednostkach świata, a pieczemy w większej rozdzielczości. */
const Q = 4;
export const CRATE_SCALE = 1 / Q;
export const FUEL_BARREL_SCALE = 1 / Q;
export const MINE_SCALE = 1 / Q;

export function treeSprite(theme: ThemeId, id: number): BakedSprite {
  const variant = Math.abs(id) % SHAPES.length;
  const key = `${theme}:${variant}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const baked = bakeTree(theme, variant);
  treeCache.set(key, baked);
  return baked;
}

export function crateSprite(kind: "health" | "weapon" | "utility"): BakedSprite {
  const cached = crateCache.get(kind);
  if (cached) return cached;
  const baked = bakeCrate(kind);
  crateCache.set(kind, baked);
  return baked;
}

export function fuelBarrelSprite(): BakedSprite {
  if (!fuelBarrel) fuelBarrel = bakeFuelBarrel();
  return fuelBarrel;
}

export function mineSprite(): BakedSprite & { lampX: number; lampY: number } {
  if (!mineBody) mineBody = bakeMine();
  return mineBody;
}

export function blit(ctx: CanvasRenderingContext2D, sprite: BakedSprite, scale: number): void {
  ctx.drawImage(
    sprite.canvas,
    -sprite.ax * scale,
    -sprite.ay * scale,
    sprite.canvas.width * scale,
    sprite.canvas.height * scale,
  );
}

function sheet(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Brak kontekstu 2D dla sprite'a");
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { canvas, ctx };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = { x: number; y: number };

function curve(a: Pt, c: Pt, b: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return out;
}

/** Zwężający się pas wzdłuż łamanej; `grow` rozszerza go o obrys. */
function taper(ctx: CanvasRenderingContext2D, pts: Pt[], w0: number, w1: number, grow: number, color: string): void {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(pts.length - 1, i + 1)]!;
    const o = pts[Math.max(0, i - 1)]!;
    const dx = q.x - o.x;
    const dy = q.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const w = w0 + (w1 - w0) * (i / (pts.length - 1)) + grow;
    left.push({ x: p.x - (dy / len) * w, y: p.y + (dx / len) * w });
    right.push({ x: p.x + (dy / len) * w, y: p.y - (dx / len) * w });
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left[0]!.x, left[0]!.y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]!.x, right[i]!.y);
  ctx.closePath();
  ctx.fill();
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  ctx.beginPath();
  ctx.arc(first.x, first.y, w0 + grow, 0, Math.PI * 2);
  ctx.arc(last.x, last.y, w1 + grow, 0, Math.PI * 2);
  ctx.fill();
}

function bakeTree(theme: ThemeId, variant: number): BakedSprite {
  const paint = TREE_PAINT[theme] ?? TREE_PAINT.grass;
  const shape = SHAPES[variant] ?? SHAPES[0]!;
  const { canvas, ctx } = sheet(440, 470);
  const cx = 220;
  const ground = 448;
  const ow = 7;
  const rand = rng(1009 + variant * 77 + (theme.length + theme.charCodeAt(0)) * 13);

  const base: Pt = { x: cx, y: ground };
  const top: Pt = { x: cx + shape.lean, y: ground - shape.trunk };
  const ctrl: Pt = { x: cx + shape.bend, y: ground - shape.trunk * 0.5 };
  const trunkPts = curve(base, ctrl, top, 18);
  const at = (t: number): Pt => trunkPts[Math.round(t * (trunkPts.length - 1))]!;

  const limbs: Array<{ pts: Pt[]; w0: number; w1: number }> = [];
  limbs.push({ pts: trunkPts, w0: 20, w1: 10 });
  const rootL = curve({ x: cx - 6, y: ground - 14 }, { x: cx - 18, y: ground - 4 }, { x: cx - 32, y: ground + 4 }, 6);
  const rootR = curve({ x: cx + 6, y: ground - 14 }, { x: cx + 20, y: ground - 4 }, { x: cx + 34, y: ground + 4 }, 6);
  limbs.push({ pts: rootL, w0: 8, w1: 3 });
  limbs.push({ pts: rootR, w0: 8, w1: 3 });

  const puffs: Blob[] = [];
  for (const b of shape.branches) {
    const from = at(b.at);
    const to: Pt = { x: from.x + b.dx, y: from.y + b.dy };
    const mid: Pt = { x: from.x + b.dx * 0.35, y: from.y + b.dy * 0.9 + 8 };
    limbs.push({ pts: curve(from, mid, to, 10), w0: 9.5, w1: 4.2 });
    puffs.push({ x: to.x, y: to.y - b.puff * 0.35, r: b.puff });
  }
  const crownY = top.y - shape.crown * 0.55;
  puffs.push({ x: top.x, y: crownY, r: shape.crown });

  for (const l of limbs) taper(ctx, l.pts, l.w0, l.w1, ow, INK);
  for (const l of limbs) taper(ctx, l.pts, l.w0, l.w1, 0, paint.wood);
  for (const l of limbs) {
    const pts = l.pts;
    ctx.strokeStyle = paint.woodHi;
    ctx.lineWidth = Math.max(2, l.w0 * 0.22);
    ctx.beginPath();
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const w = l.w0 + (l.w1 - l.w0) * (i / (pts.length - 1));
      const x = p.x - w * 0.42;
      if (i === 1) ctx.moveTo(x, p.y);
      else ctx.lineTo(x, p.y);
    }
    ctx.stroke();
  }

  // Kora: krótkie poprzeczne kreski na pniu.
  ctx.strokeStyle = paint.woodLo;
  ctx.lineWidth = 3.4;
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.13 + rand() * 0.04;
    const p = at(t);
    const w = 20 + (10 - 20) * t;
    const side = i % 2 === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(p.x + side * w * 0.15, p.y);
    ctx.lineTo(p.x + side * w * 0.7, p.y - 5 - rand() * 4);
    ctx.stroke();
  }
  ctx.fillStyle = paint.woodLo;
  ctx.beginPath();
  ctx.ellipse(at(0.34).x + 1, at(0.34).y, 4.4, 6.4, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Korona: kępy chmurek.
  const blobs: Blob[] = [];
  for (const p of puffs) {
    blobs.push({ x: p.x, y: p.y, r: p.r });
    const n = paint.sparse ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.95 + (i / (n - 1)) * Math.PI * 1.9 + (rand() - 0.5) * 0.3;
      const dist = p.r * (0.62 + rand() * 0.16);
      const r = p.r * (0.5 + rand() * 0.18);
      blobs.push({ x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist * 0.82 + p.r * 0.1, r });
    }
  }
  blobs.sort((a, b) => a.y - b.y);

  let minY = ground;
  for (const b of blobs) {
    minY = Math.min(minY, b.y - b.r);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + ow, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of blobs) {
    ctx.fillStyle = paint.leafLo;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = paint.leaf;
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.1, b.y - b.r * 0.15, b.r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = paint.leafHi;
    ctx.lineWidth = Math.max(3, b.r * 0.13);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.74, Math.PI * 1.08, Math.PI * 1.5);
    ctx.stroke();
  }

  if (paint.cap) {
    ctx.fillStyle = paint.cap;
    for (const b of blobs) {
      if (b.y > crownY + 8) continue;
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.06, b.y - b.r * 0.12, b.r * 0.9, Math.PI * 1.02, Math.PI * 1.98);
      ctx.quadraticCurveTo(b.x + b.r * 0.2, b.y - b.r * 0.5, b.x - b.r * 0.86, b.y - b.r * 0.2);
      ctx.fill();
    }
  }
  if (paint.ember) {
    ctx.fillStyle = "#ffd27a";
    for (const b of blobs) {
      if (rand() > 0.55) continue;
      ctx.beginPath();
      ctx.arc(b.x + b.r * 0.12, b.y - b.r * 0.2, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { canvas, ax: cx, ay: ground, span: Math.max(40, ground - minY + ow) };
}

function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bakeCrate(kind: "health" | "weapon" | "utility"): BakedSprite {
  const W = 40;
  const H = 40;
  const { canvas, ctx } = sheet(W * Q, H * Q);
  const ax = (W / 2) * Q;
  const ay = (H / 2) * Q;
  ctx.scale(Q, Q);
  ctx.translate(W / 2, H / 2);

  const hw = 11.8;
  const hh = 10.6;
  const ow = 2.2;
  const frame = "#8f6238";
  const wood = "#d4a565";
  const woodHi = "#e6c187";

  ctx.fillStyle = INK;
  roundedBox(ctx, -hw - ow, -hh - ow, (hw + ow) * 2, (hh + ow) * 2, 3.4);
  ctx.fill();
  ctx.fillStyle = frame;
  roundedBox(ctx, -hw, -hh, hw * 2, hh * 2, 1.6);
  ctx.fill();

  const pad = 2.6;
  ctx.fillStyle = wood;
  ctx.fillRect(-hw + pad, -hh + pad, (hw - pad) * 2, (hh - pad) * 2);
  ctx.fillStyle = woodHi;
  ctx.fillRect(-hw + pad, -hh + pad, (hw - pad) * 2, 1.5);

  ctx.save();
  ctx.beginPath();
  ctx.rect(-hw + pad, -hh + pad, (hw - pad) * 2, (hh - pad) * 2);
  ctx.clip();
  const brace = (x0: number, y0: number, x1: number, y1: number): void => {
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#5c3d22";
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  brace(-hw, -hh, hw, hh);
  brace(hw, -hh, -hw, hh);
  ctx.restore();
  ctx.lineCap = "round";

  ctx.strokeStyle = "#5c3d22";
  ctx.lineWidth = 0.9;
  ctx.strokeRect(-hw + pad, -hh + pad, (hw - pad) * 2, (hh - pad) * 2);

  ctx.fillStyle = "#4a301c";
  for (const [nx, ny] of [[-hw + 1.5, -hh + 1.5], [hw - 1.5, -hh + 1.5], [-hw + 1.5, hh - 1.5], [hw - 1.5, hh - 1.5]] as const) {
    ctx.beginPath();
    ctx.arc(nx, ny, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.scale(0.8, 0.8);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  if (kind === "health") {
    ctx.fillStyle = "#f3f0e8";
    ctx.beginPath();
    ctx.arc(0, 0, 6.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d8403a";
    ctx.fillRect(-1.6, -4.4, 3.2, 8.8);
    ctx.fillRect(-4.4, -1.6, 8.8, 3.2);
  } else if (kind === "weapon") {
    ctx.fillStyle = "#3a3630";
    ctx.beginPath();
    ctx.arc(0, 0, 6.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e6b93e";
    ctx.beginPath();
    ctx.arc(-0.6, 1.2, 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e6b93e";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1.4, -1.6);
    ctx.lineTo(3.4, -3.8);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#6fa6dc";
    ctx.beginPath();
    ctx.arc(0, 0, 6.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#f4f8fc";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-3, 1.4);
    ctx.lineTo(0, -3.2);
    ctx.lineTo(3, 1.4);
    ctx.stroke();
  }
  ctx.restore();

  return { canvas, ax, ay, span: hh + ow };
}

function bakeFuelBarrel(): BakedSprite {
  const W = 40;
  const H = 50;
  const { canvas, ctx } = sheet(W * Q, H * Q);
  const ax = (W / 2) * Q;
  // Środek beczki leży 11 px nad podłożem; spód obrysu ma stać na nim.
  const groundY = 42;
  const ay = (groundY - 11) * Q;
  ctx.scale(Q, Q);
  ctx.translate(W / 2, 0);

  const rx = 12.6;
  const ry = 4.2;
  const top = 10;
  const bottom = groundY - 1.6 - ry;
  const ow = 2.2;
  const red = "#b8442b";
  const redHi = "#d8663e";
  const redLo = "#8a2f22";
  const band = "#2c1e1c";

  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, top, rx + ow, ry + ow, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-rx - ow, top, (rx + ow) * 2, bottom - top);
  ctx.beginPath();
  ctx.ellipse(0, bottom, rx + ow, ry + ow, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(-rx, top);
    ctx.lineTo(-rx, bottom);
    ctx.ellipse(0, bottom, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(rx, top);
    ctx.closePath();
  };
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = red;
  ctx.fillRect(-rx, top, rx * 2, bottom - top + ry);
  ctx.fillStyle = redLo;
  ctx.fillRect(rx * 0.42, top, rx, bottom - top + ry);
  ctx.fillStyle = redHi;
  ctx.fillRect(-rx + 2.4, top, 3.2, bottom - top + ry);

  const ring = (y: number, h: number): void => {
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.moveTo(-rx, y);
    ctx.ellipse(0, y, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(rx, y + h);
    ctx.ellipse(0, y + h, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#5a4340";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, y + ry * 0.05, rx, ry, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
  };
  ring(top + 5.4, 3.4);
  ring(bottom - 8.6, 3.4);
  ctx.restore();

  ctx.fillStyle = redLo;
  ctx.beginPath();
  ctx.ellipse(0, top, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = redHi;
  ctx.beginPath();
  ctx.ellipse(0, top - 0.5, rx - 1.4, ry - 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = redLo;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(0, top - 0.5, rx - 4.6, ry - 2.4, 0, 0, Math.PI * 2);
  ctx.stroke();

  const ly = (top + bottom) / 2 + 1.4;
  ctx.fillStyle = INK;
  roundedBox(ctx, -6.4, ly - 6.6, 12.8, 13.2, 1.6);
  ctx.fill();
  ctx.fillStyle = "#e8c53c";
  roundedBox(ctx, -5.2, ly - 5.4, 10.4, 10.8, 1);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, ly - 4.4);
  ctx.bezierCurveTo(3.4, ly - 1.2, 3.8, ly + 1.2, 2.6, ly + 3.2);
  ctx.bezierCurveTo(1.6, ly + 4.6, -1.6, ly + 4.6, -2.6, ly + 3.2);
  ctx.bezierCurveTo(-3.8, ly + 1.2, -2.6, -0.4 + ly, -0.8, ly - 1.6);
  ctx.bezierCurveTo(-0.6, ly - 0.2, -0.2, ly - 0.4, 0, ly - 4.4);
  ctx.fill();
  ctx.fillStyle = "#e8c53c";
  ctx.beginPath();
  ctx.ellipse(0.2, ly + 2.6, 1, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  return { canvas, ax, ay, span: groundY - (top - ry - ow) };
}

function bakeMine(): BakedSprite & { lampX: number; lampY: number } {
  const W = 46;
  const H = 34;
  const { canvas, ctx } = sheet(W * Q, H * Q);
  const ax = (W / 2) * Q;
  const groundY = 26;
  const ay = (groundY - 7) * Q;
  ctx.scale(Q, Q);
  ctx.translate(W / 2, 0);
  const ow = 2.2;

  const baseY = groundY - 5.4;
  const baseRx = 13.6;
  const baseRy = 4.2;
  const domeRx = 9.6;
  const domeH = 8.6;

  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, baseY, baseRx + ow, baseRy + ow, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, baseY - 2, domeRx + ow, domeH + ow, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = "#59636f";
  ctx.beginPath();
  ctx.ellipse(0, baseY, baseRx, baseRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7d8895";
  ctx.beginPath();
  ctx.ellipse(0, baseY - 0.8, baseRx, baseRy - 0.8, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(-baseRx, baseY - 0.8, baseRx * 2, 0.1);

  ctx.fillStyle = "#4a535e";
  for (const rx of [-9.4, -4.6, 4.6, 9.4]) {
    ctx.beginPath();
    ctx.arc(rx, baseY + 0.9 + Math.abs(rx) * 0.04, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#9aa5b0";
  ctx.beginPath();
  ctx.ellipse(0, baseY - 2, domeRx, domeH, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#7a8592";
  ctx.beginPath();
  ctx.ellipse(0, baseY - 2, domeRx, domeH, 0, Math.PI * 1.55, Math.PI * 2);
  ctx.lineTo(0, baseY - 2);
  ctx.fill();
  ctx.strokeStyle = "#c6ced6";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, baseY - 2, domeRx - 2.6, domeH - 2.6, 0, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();

  const lampX = 0;
  const lampY = baseY - domeH - 0.4;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(lampX, lampY + 1.6, 5.2 + 1.4, 3.4 + 1.4, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#a9322a";
  ctx.beginPath();
  ctx.ellipse(lampX, lampY + 1.6, 5.2, 3.4, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#d8564a";
  ctx.beginPath();
  ctx.ellipse(lampX - 1.2, lampY - 0.2, 2.4, 1.2, -0.2, 0, Math.PI * 2);
  ctx.fill();

  return { canvas, ax, ay, span: groundY, lampX: ax + lampX * Q, lampY: lampY * Q };
}
