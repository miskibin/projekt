import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import type { Camera } from "./camera";
import type { ThemePalette } from "./terrainRenderer";

export interface BackgroundInput {
  camera: Camera;
  palette: ThemePalette;
  /** czas w sekundach od startu (animacje) */
  time: number;
  /** rozmiar widoku w pikselach CSS */
  width: number;
  height: number;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  depth: number;
  speed: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
}

/** Tło sceny: niebo, poświata, gwiazdy/żar, chmury z parallaxem. Rysowane w przestrzeni ekranu. */
export class Background {
  private clouds: Cloud[] = [];
  private stars: Star[] = [];

  constructor(seed = 1) {
    this.regen(seed);
  }

  regen(seed: number): void {
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.clouds = Array.from({ length: 11 }, () => ({
      x: rnd() * WORLD_WIDTH * 1.4,
      y: 30 + rnd() * (WORLD_HEIGHT * 0.36),
      s: 0.45 + rnd() * 0.8,
      depth: 0.12 + rnd() * 0.35,
      speed: 2 + rnd() * 7,
    }));
    this.stars = Array.from({ length: 130 }, () => ({
      x: rnd() * WORLD_WIDTH * 1.2,
      y: rnd() * WORLD_HEIGHT * 0.7,
      r: 0.6 + rnd() * 1.5,
      tw: rnd() * 6.28,
    }));
  }

  draw(ctx: CanvasRenderingContext2D, inp: BackgroundInput): void {
    const { palette: pal, width: W, height: H } = inp;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(0.58, pal.skyMid);
    g.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cam = inp.camera;
    const view = cam.viewRect();

    // poświata
    const glow = ctx.createRadialGradient(W * 0.72, H * 0.14, 10, W * 0.72, H * 0.14, H * 0.75);
    glow.addColorStop(0, pal.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    if (pal.stars) {
      ctx.save();
      for (const st of this.stars) {
        const px = ((st.x - view.x * 0.25) % (WORLD_WIDTH * 1.2) + WORLD_WIDTH * 1.2) % (WORLD_WIDTH * 1.2);
        const sx = (px / (WORLD_WIDTH * 1.2)) * W * 1.1 - W * 0.05;
        const sy = st.y * 0.25 - view.y * 0.08;
        if (sy < -5 || sy > H) continue;
        ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(inp.time * 1.7 + st.tw));
        ctx.fillStyle = "#dceaff";
        ctx.beginPath();
        ctx.arc(sx, sy, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // chmury / żar – parallax względem kamery
    ctx.save();
    for (const c of this.clouds) {
      const wx = c.x + inp.time * c.speed;
      const px = ((wx - view.x * c.depth) % (WORLD_WIDTH * 1.4) + WORLD_WIDTH * 1.4) % (WORLD_WIDTH * 1.4);
      const sx = (px / (WORLD_WIDTH * 1.4)) * (W * 1.3) - W * 0.15;
      const sy = c.y * 0.55 - view.y * c.depth * 0.35 + H * 0.05;
      if (sy > H + 60) continue;
      if (pal.embers) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = pal.cloud;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 110 * c.s, 22 * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.55 - c.depth * 0.35;
        ctx.fillStyle = pal.cloud;
        drawCloud(ctx, sx, sy, 30 * c.s);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (pal.embers) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const st of this.stars) {
        const t = (inp.time * 26 + st.x) % (H + 200);
        const sy = H + 100 - t;
        const sx = ((st.x - view.x * 0.3) % W + W) % W + Math.sin(inp.time + st.tw) * 12;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#ff7a2a";
        ctx.beginPath();
        ctx.arc(sx, sy, st.r * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x - r * 0.7, y, r * 0.55, 0, Math.PI * 2);
  ctx.arc(x, y - r * 0.28, r * 0.75, 0, Math.PI * 2);
  ctx.arc(x + r * 0.75, y, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x + r * 0.2, y + r * 0.24, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
}
