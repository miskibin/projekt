// Kolizje z bitmapą terenu przez prosty sampling po okręgu. Zero DOM/Node, tylko arytmetyka.
import type { Terrain } from "./terrain";

const SAMPLES = 12;
const COS: number[] = [];
const SIN: number[] = [];
for (let i = 0; i < SAMPLES; i++) {
  const a = (i / SAMPLES) * Math.PI * 2;
  COS.push(Math.cos(a));
  SIN.push(Math.sin(a));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalizuje kąt do (-PI, PI]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/** Czy okrąg (x,y,r) dotyka terenu? Sampling: środek + punkty na obwodzie i w połowie promienia. */
export function circleHits(t: Terrain, x: number, y: number, r: number): boolean {
  if (t.isSolid(x, y)) return true;
  if (r <= 0) return false;
  for (let i = 0; i < SAMPLES; i++) {
    if (t.isSolid(x + COS[i] * r, y + SIN[i] * r)) return true;
  }
  if (r > 4) {
    const rr = r * 0.55;
    for (let i = 0; i < SAMPLES; i++) {
      if (t.isSolid(x + COS[i] * rr, y + SIN[i] * rr)) return true;
    }
  }
  return false;
}

/** Przybliżona normalna terenu (wektor "na zewnątrz" ziemi). Domyślnie (0,-1). */
export function terrainNormal(t: Terrain, x: number, y: number, r: number): { x: number; y: number } {
  let nx = 0;
  let ny = 0;
  let count = 0;
  const rings = r > 4 ? [r, r * 0.55] : [Math.max(r, 1)];
  for (const rr of rings) {
    for (let i = 0; i < SAMPLES; i++) {
      if (t.isSolid(x + COS[i] * rr, y + SIN[i] * rr)) {
        nx -= COS[i];
        ny -= SIN[i];
        count++;
      }
    }
  }
  const len = Math.hypot(nx, ny);
  if (count === 0 || len < 1e-6) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}

/** Wypycha punkt z terenu wzdłuż normalnej. Zwraca true jeśli udało się wyjść. */
export function pushOut(t: Terrain, pos: { x: number; y: number }, r: number, maxSteps = 24): boolean {
  for (let i = 0; i < maxSteps; i++) {
    if (!circleHits(t, pos.x, pos.y, r)) return true;
    const n = terrainNormal(t, pos.x, pos.y, r);
    pos.x = clamp(pos.x + n.x, r, t.width - 1 - r);
    pos.y += n.y;
    if (pos.y < -2000) return false;
  }
  return !circleHits(t, pos.x, pos.y, r);
}

/** Czy pod okręgiem (w odległości do `depth` px) jest ziemia? */
export function groundBelow(t: Terrain, x: number, y: number, r: number, depth = 2): boolean {
  for (let d = 1; d <= depth; d++) if (circleHits(t, x, y + d, r)) return true;
  return false;
}

export type WalkResult = "moved" | "fell" | "blocked";

/**
 * Krok chodzenia: próbuje przesunąć się o dx, wchodząc na stopnie do `maxUp` w górę
 * i schodząc do `maxDown` w dół. Zwraca "blocked" jeśli przed robakiem jest ściana.
 */
export function walkStep(
  t: Terrain,
  pos: { x: number; y: number },
  r: number,
  dx: number,
  maxUp: number,
  maxDown: number,
): WalkResult {
  const nx = clamp(pos.x + dx, r, t.width - 1 - r);
  for (let dy = -maxUp; dy <= maxDown; dy++) {
    const ny = pos.y + dy;
    if (!circleHits(t, nx, ny, r) && groundBelow(t, nx, ny, r, 2)) {
      pos.x = nx;
      pos.y = ny;
      return "moved";
    }
  }
  if (!circleHits(t, nx, pos.y, r)) {
    pos.x = nx;
    return "fell";
  }
  return "blocked";
}

/** Odbicie wektora prędkości od normalnej, z restytucją i tarciem stycznym. */
export function reflect(
  vx: number,
  vy: number,
  nx: number,
  ny: number,
  restitution: number,
  friction: number,
): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny;
  // składowa normalna i styczna
  const rnx = nx * dot;
  const rny = ny * dot;
  const tx = vx - rnx;
  const ty = vy - rny;
  return { vx: tx * friction - rnx * restitution, vy: ty * friction - rny * restitution };
}
