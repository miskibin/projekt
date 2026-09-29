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

  /** Czy pełny stan z serwera jest taki sam jak lokalny teren? Odczyt bez alokacji bitmapy. */
  matchesRLE(width: number, height: number, rle: readonly number[]): boolean {
    if (this.width !== width || this.height !== height) return false;
    let offset = 0;
    let solid = 0;
    for (const run of rle) {
      if (!Number.isSafeInteger(run) || run < 0 || offset + run > this.data.length) return false;
      for (let i = offset; i < offset + run; i++) if (this.data[i] !== solid) return false;
      offset += run;
      solid ^= 1;
    }
    return offset === this.data.length;
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

  // Dwa szerokie grzbiety i dolina dają wyraźną różnicę wysokości bez pionowych
  // ścian, na których robaki blokowałyby się podczas chodzenia.
  const landform = rng.int(0, 2); // doliny, łagodne pasma lub szeroki płaskowyż
  const ridge = [
    { cx: width * rng.range(0.23, 0.31), half: rng.range(95, 150), edge: rng.range(95, 135), rise: rng.range(115, 165) },
    { cx: width * rng.range(0.69, 0.77), half: rng.range(95, 155), edge: rng.range(100, 145), rise: rng.range(115, 165) },
  ];
  if (landform === 1) ridge.push({
    cx: width * rng.range(0.43, 0.6), half: rng.range(50, 95),
    edge: rng.range(70, 105), rise: rng.range(70, 120),
  });
  const valley = { cx: width * rng.range(0.47, 0.56), spread: rng.range(170, 245), depth: rng.range(65, 105) };
  const plateau = {
    cx: width * rng.range(0.34, 0.68), half: rng.range(105, 190),
    edge: rng.range(35, 65), rise: rng.range(105, 150),
  };
  // Drobniejsza, niska fala rozbija regularność dużych formacji.
  const waves = Array.from({ length: 4 }, (_, i) => ({
    amp: rng.range(11, 26) / (i + 1) ** 0.7,
    freq: rng.range(0.003, 0.006) * (i + 1),
    phase: rng.range(0, Math.PI * 2),
  }));
  // Niższa linia lądu zostawia więcej czystego kadru nad robakami i ogranicza ściany zajmujące cały ekran.
  const base = height * (0.76 - 0.16 * density);
  const rawSurface = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let y = base;
    for (const hill of ridge) {
      const left = Math.tanh((x - hill.cx + hill.half) / hill.edge);
      const right = Math.tanh((x - hill.cx - hill.half) / hill.edge);
      y -= hill.rise * (left - right) * 0.5;
    }
    const v = (x - valley.cx) / valley.spread;
    y += (landform === 2 ? valley.depth * 0.55 : valley.depth) * Math.exp(-v * v * 0.5);
    if (landform === 2) {
      const left = Math.tanh((x - plateau.cx + plateau.half) / plateau.edge);
      const right = Math.tanh((x - plateau.cx - plateau.half) / plateau.edge);
      y -= plateau.rise * (left - right) * 0.5;
    }
    for (const w of waves) y += Math.sin(x * w.freq + w.phase) * w.amp;
    rawSurface[x] = y;
  }
  const surface = new Int32Array(width);
  // A short low-pass removes needle peaks and deep narrow traps. Wider hills
  // keep variety while the walking step and jump can negotiate the slopes.
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let dx = -12; dx <= 12; dx += 3) {
      sum += rawSurface[Math.max(0, Math.min(width - 1, x + dx))];
      count++;
    }
    surface[x] = Math.max(height * 0.2, Math.min(height - 90, Math.round(sum / count)));
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (y >= surface[x]) t.data[y * width + x] = 1;

  // 2) unoszące się wyspy / platformy
  const islands = rng.int(2, 5);
  for (let i = 0; i < islands; i++) {
    const cx = rng.int(120, width - 120);
    const cy = rng.int(Math.round(height * 0.16), Math.max(Math.round(height * 0.2), base - 120));
    const rw = rng.int(50, 140);
    const rh = rng.int(18, 45);
    // A grass shelf and a tapered crag, rather than an oval floating puck.
    const phase = rng.range(0, Math.PI * 2);
    for (let x = cx - rw; x <= cx + rw; x++) {
      const nx = (x - cx) / rw;
      const edge = Math.abs(nx);
      const top = cy - rh * .45 + Math.sin(nx * 3 + phase) * rh * .12 + edge ** 4 * rh * .45;
      const bottom = cy + rh * (.9 - edge * .8) + Math.sin(nx * 12 + phase) * rh * .1;
      for (let y = Math.ceil(top); y <= Math.floor(bottom); y++) t.set(x, y, 1);
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

  // Dwie przerwy przecinają grzbiet. Wymuszają skok lub użycie narzędzia,
  // ale nie przecinają unoszących się wysp ani nie tworzą zamkniętych pułapek.
  // Są robione po jaskiniach, żeby przypadkowy tunel nie zmostkował szczeliny.
  if (width >= 900) {
    for (const fraction of [rng.range(0.29, 0.39), rng.range(0.62, 0.72)]) {
      const cx = Math.round(width * fraction);
      const half = Math.round(rng.range(37, 53) * Math.min(1, width / 1920));
      const topAtCenter = surface[Math.max(0, Math.min(width - 1, cx))]!;
      const phase = rng.range(0, Math.PI * 2);
      for (let y = Math.max(0, topAtCenter - 80); y < height - 30; y++) {
        const depth = Math.max(0, y - topAtCenter);
        const middle = cx + Math.sin(depth * .012) * 19;
        const opening = half * (1 + Math.min(.65, depth / 600)) + Math.sin(depth * .037 + phase) * 5;
        for (let x = Math.floor(middle - opening); x <= Math.ceil(middle + opening); x++) {
          if (x >= 0 && x < width && y >= surface[x] - 5) t.data[y * width + x] = 0;
        }
      }
    }
  }
  t.version = 0;
  return t;
}
