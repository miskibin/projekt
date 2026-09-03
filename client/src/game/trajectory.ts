// Przewidywanie toru lotu pocisku po stronie klienta (czysta matematyka, bez DOM).
// Używa dokładnie tej samej całkowania co `shared/engine/projectiles.ts`,
// dzięki czemu podgląd trajektorii pokrywa się z realnym strzałem.
import { GRAVITY, WORLD_WIDTH } from "@shared/constants";

export type TrajectoryStop = "terrain" | "water" | "outside" | "timeout";

export interface TrajectoryOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** przyspieszenie wiatru w px/s^2 (0 dla broni nieczułych na wiatr) */
  wind?: number;
  gravity?: number;
  /** y powierzchni wody – pocisk poniżej niej ginie */
  waterLevel?: number;
  worldWidth?: number;
  isSolid?: (x: number, y: number) => boolean;
  /** maksymalny symulowany czas lotu (s) */
  maxTime?: number;
  /** maksymalna liczba zwróconych punktów (limit długości łuku) */
  maxPoints?: number;
  /** maksymalne przesunięcie na sub-krok (px) – dokładność detekcji kolizji */
  stepPx?: number;
}

export interface Trajectory {
  /** spłaszczone pary [x0, y0, x1, y1, ...] */
  points: number[];
  stop: TrajectoryStop;
  endX: number;
  endY: number;
  /** czas lotu do końca łuku (s) */
  time: number;
}

const SAMPLE_DT = 1 / 60;

/** Symulacja balistyczna z grawitacją, wiatrem i kolizją z terenem/wodą. */
export function simulateTrajectory(o: TrajectoryOptions): Trajectory {
  const g = o.gravity ?? GRAVITY;
  const wind = o.wind ?? 0;
  const water = o.waterLevel ?? Number.POSITIVE_INFINITY;
  const worldW = o.worldWidth ?? WORLD_WIDTH;
  const maxTime = o.maxTime ?? 6;
  const maxPoints = Math.max(2, o.maxPoints ?? 260);
  const stepPx = o.stepPx ?? 3;
  const solid = o.isSolid;

  let x = o.x;
  let y = o.y;
  let vx = o.vx;
  let vy = o.vy;
  let t = 0;
  let stop: TrajectoryStop = "timeout";
  const points: number[] = [x, y];

  outer: while (t < maxTime && points.length < maxPoints * 2) {
    const speed = Math.hypot(vx, vy);
    const sub = Math.max(1, Math.min(24, Math.ceil((speed * SAMPLE_DT) / stepPx)));
    const sdt = SAMPLE_DT / sub;
    for (let s = 0; s < sub; s++) {
      vy += g * sdt;
      vx += wind * sdt;
      const nx = x + vx * sdt;
      const ny = y + vy * sdt;
      if (ny > water) {
        x = nx;
        y = water;
        stop = "water";
        break outer;
      }
      if (nx < -200 || nx > worldW + 200 || ny < -3000) {
        x = nx;
        y = ny;
        stop = "outside";
        break outer;
      }
      if (solid !== undefined && solid(nx, ny)) {
        x = nx;
        y = ny;
        stop = "terrain";
        break outer;
      }
      x = nx;
      y = ny;
      t += sdt;
    }
    points.push(x, y);
  }
  points.push(x, y);
  return { points, stop, endX: x, endY: y, time: t };
}

export interface RayOptions {
  x: number;
  y: number;
  /** kierunek (nie musi być znormalizowany) */
  dx: number;
  dy: number;
  maxLen?: number;
  waterLevel?: number;
  worldWidth?: number;
  isSolid?: (x: number, y: number) => boolean;
  step?: number;
}

export interface RayHit {
  endX: number;
  endY: number;
  stop: TrajectoryStop;
  length: number;
}

/** Prosty promień dla broni hitscan (strzelba, uzi) – marsz do pierwszej kolizji. */
export function raycast(o: RayOptions): RayHit {
  const len = Math.hypot(o.dx, o.dy) || 1;
  const dx = o.dx / len;
  const dy = o.dy / len;
  const maxLen = o.maxLen ?? 800;
  const step = o.step ?? 2;
  const water = o.waterLevel ?? Number.POSITIVE_INFINITY;
  const worldW = o.worldWidth ?? WORLD_WIDTH;
  const solid = o.isSolid;

  let x = o.x;
  let y = o.y;
  let d = 0;
  while (d < maxLen) {
    const nx = x + dx * step;
    const ny = y + dy * step;
    d += step;
    if (ny > water) return { endX: nx, endY: water, stop: "water", length: d };
    if (nx < 0 || nx > worldW) return { endX: nx, endY: ny, stop: "outside", length: d };
    if (solid !== undefined && ny >= 0 && solid(nx, ny)) {
      return { endX: nx, endY: ny, stop: "terrain", length: d };
    }
    x = nx;
    y = ny;
  }
  return { endX: x, endY: y, stop: "timeout", length: d };
}
