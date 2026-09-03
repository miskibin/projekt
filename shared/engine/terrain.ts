import { Rng } from "./rng";

/**
 * Bitmapa terenu: 1 = ziemia, 0 = powietrze. Wszystkie operacje niszczące działają na liczbach
 * całkowitych, więc serwer i klient po tych samych zdarzeniach mają identyczny teren.
 */
export class Terrain {
  readonly data: Uint8Array;
  /** rośnie przy każdej modyfikacji – klient używa do przebudowy tekstury */
  version = 0;

  constructor(readonly width: number, readonly height: number, data?: Uint8Array) {
    this.data = data ?? new Uint8Array(width * height);
  }

  isSolid(x: number, y: number): boolean {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || xi >= this.width) return true; // ściany boczne są "twarde"
    if (yi < 0) return false;
    if (yi >= this.height) return false;
    return this.data[yi * this.width + xi] === 1;
  }

  set(x: number, y: number, v: 0 | 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = v;
  }

  carveCircle(cx: number, cy: number, r: number): void {
    this.paintCircle(cx | 0, cy | 0, r | 0, 0);
  }

  fillCircle(cx: number, cy: number, r: number): void {
    this.paintCircle(cx | 0, cy | 0, r | 0, 1);
  }

  private paintCircle(cx: number, cy: number, r: number, v: 0 | 1): void {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.height - 1, cy + r); y++) {
      const dy = y - cy;
      const half = Math.floor(Math.sqrt(r2 - dy * dy));
      const x0 = Math.max(0, cx - half);
      const x1 = Math.min(this.width - 1, cx + half);
      if (x0 > x1) continue;
      this.data.fill(v, y * this.width + x0, y * this.width + x1 + 1);
    }
    this.version++;
  }

  /** Obrócony prostokąt (girder). Środek (cx,cy), wymiary w×h, kąt w radianach. */
  paintRotatedRect(cx: number, cy: number, w: number, h: number, angle: number, v: 0 | 1): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = w / 2;
    const hh = h / 2;
    const ext = Math.ceil(Math.hypot(hw, hh));
    for (let y = Math.max(0, (cy | 0) - ext); y <= Math.min(this.height - 1, (cy | 0) + ext); y++) {
      for (let x = Math.max(0, (cx | 0) - ext); x <= Math.min(this.width - 1, (cx | 0) + ext); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) this.data[y * this.width + x] = v;
      }
    }
    this.version++;
  }

  /** Najwyższy stały piksel w kolumnie x (lub height, jeśli brak). */
  surfaceY(x: number): number {
    const xi = Math.max(0, Math.min(this.width - 1, x | 0));
    for (let y = 0; y < this.height; y++) if (this.data[y * this.width + xi]) return y;
    return this.height;
  }

  toRLE(): number[] {
    const out: number[] = [];
    let cur = 0;
    let run = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] === cur) run++;
      else {
        out.push(run);
        cur = this.data[i];
        run = 1;
      }
    }
    out.push(run);
    return out;
  }

  static fromRLE(width: number, height: number, rle: number[]): Terrain {
    const t = new Terrain(width, height);
    let i = 0;
    let cur = 0;
    for (const run of rle) {
      if (cur) t.data.fill(1, i, i + run);
      i += run;
      cur ^= 1;
    }
    return t;
  }
}

/** Proceduralny teren: wzgórza z szumu + jaskinie/wyspy. Deterministyczny dla seeda. */
export function generateTerrain(seed: number, width: number, height: number, density = 1): Terrain {
  const rng = new Rng(seed);
  const t = new Terrain(width, height);

  // 1) profil powierzchni: suma sinusów o losowych fazach
  const waves = Array.from({ length: 6 }, (_, i) => ({
    amp: rng.range(30, 110) / (i + 1) ** 0.5,
    freq: rng.range(0.002, 0.012) * (i + 1),
    phase: rng.range(0, Math.PI * 2),
  }));
  const base = height * (0.72 - 0.18 * density);
  const surface = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let y = base;
    for (const w of waves) y += Math.sin(x * w.freq + w.phase) * w.amp;
    surface[x] = Math.max(80, Math.min(height - 60, y)) | 0;
  }
  for (let x = 0; x < width; x++) t.data.fill(1, surface[x] * width + x, surface[x] * width + x + 1);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (y >= surface[x]) t.data[y * width + x] = 1;

  // 2) unoszące się wyspy / platformy
  const islands = rng.int(2, 5);
  for (let i = 0; i < islands; i++) {
    const cx = rng.int(120, width - 120);
    const cy = rng.int(120, Math.max(160, base - 150));
    const rw = rng.int(50, 140);
    const rh = rng.int(18, 45);
    for (let y = cy - rh; y <= cy + rh; y++)
      for (let x = cx - rw; x <= cx + rw; x++) {
        const dx = (x - cx) / rw;
        const dy = (y - cy) / rh;
        if (dx * dx + dy * dy <= 1) t.set(x, y, 1);
      }
  }

  // 3) jaskinie
  const caves = rng.int(6, 12) * (density > 0.5 ? 1 : 2);
  for (let i = 0; i < caves; i++) {
    let x = rng.int(60, width - 60);
    let y = rng.int(base | 0, height - 80);
    const steps = rng.int(8, 20);
    let ang = rng.range(0, Math.PI * 2);
    for (let s = 0; s < steps; s++) {
      t.carveCircle(x, y, rng.int(10, 26));
      ang += rng.range(-0.8, 0.8);
      x += Math.cos(ang) * 18;
      y += Math.sin(ang) * 18;
    }
  }

  // 4) dolna krawędź nie jest wypełniana do samego dna – zostaw miejsce na wodę
  for (let y = height - 30; y < height; y++) t.data.fill(0, y * width, (y + 1) * width);
  t.version = 0;
  return t;
}
