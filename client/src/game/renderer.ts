import { TEAM_COLORS, WORLD_HEIGHT, WORLD_WIDTH, WORM_MAX_HP } from "@shared/constants";
import type { CrateSnapshot, MineSnapshot, ProjectileSnapshot, WeaponId, WormSnapshot } from "@shared/protocol";
import type { Camera } from "./camera";
import type { Particles } from "./particles";
import type { RenderState } from "./state";
import type { ThemeId, ThemePalette } from "./terrainRenderer";
import { THEMES } from "./terrainRenderer";
import { TARGETED } from "./weapons";

export interface Grave {
  x: number;
  y: number;
  team: number;
  name: string;
}

export interface RenderInput {
  state: RenderState;
  terrainTex: HTMLCanvasElement;
  theme: ThemeId;
  camera: Camera;
  particles: Particles;
  /** czas w sekundach od startu (do animacji) */
  time: number;
  myTeam: number;
  myTurn: boolean;
  graves: Grave[];
  weapon: WeaponId;
  aimPitch: number;
  localCharge: number;
  mouseWorld: { x: number; y: number } | null;
  waterLevel: number;
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

const teamColor = (t: number): string => TEAM_COLORS[((t % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length];

/** Rysowanie świata gry: tło, teren, woda, encje, celownik. */
export class Renderer {
  private clouds: Cloud[] = [];
  private stars: Star[] = [];
  private theme: ThemeId = "grass";

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

  setTheme(t: ThemeId): void {
    this.theme = t;
  }

  get palette(): ThemePalette {
    return THEMES[this.theme] ?? THEMES.grass;
  }

  draw(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const { camera } = inp;
    const pal = THEMES[inp.theme] ?? THEMES.grass;
    const W = camera.viewW;
    const H = camera.viewH;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    this.drawSky(ctx, inp, pal, W, H);

    ctx.save();
    camera.apply(ctx);

    // krawędzie świata
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(inp.terrainTex, 0, 0);
    ctx.imageSmoothingEnabled = true;

    this.drawGraves(ctx, inp);
    this.drawMines(ctx, inp.state.mines, inp.time);
    this.drawCrates(ctx, inp.state.crates, inp.time);
    this.drawWorms(ctx, inp);
    this.drawProjectiles(ctx, inp);
    inp.particles.draw(ctx, camera.zoom);
    this.drawAim(ctx, inp);
    this.drawWater(ctx, inp, pal);

    ctx.restore();
    ctx.restore();
  }

  // ---------------- tło ----------------
  private drawSky(
    ctx: CanvasRenderingContext2D,
    inp: RenderInput,
    pal: ThemePalette,
    W: number,
    H: number,
  ): void {
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

  // ---------------- woda ----------------
  private drawWater(ctx: CanvasRenderingContext2D, inp: RenderInput, pal: ThemePalette): void {
    const level = inp.waterLevel;
    if (level >= WORLD_HEIGHT + 40) return;
    const t = inp.time;
    const view = inp.camera.viewRect();
    const x0 = Math.max(-40, view.x - 40);
    const x1 = Math.min(WORLD_WIDTH + 40, view.x + view.w + 40);
    const bottom = Math.max(WORLD_HEIGHT + 200, view.y + view.h + 100);

    const g = ctx.createLinearGradient(0, level - 6, 0, bottom);
    g.addColorStop(0, pal.water);
    g.addColorStop(1, pal.waterDeep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, level);
    const step = 14;
    for (let x = x0; x <= x1; x += step) {
      const y = level + Math.sin(x * 0.02 + t * 1.9) * 4 + Math.sin(x * 0.05 - t * 2.7) * 2.2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();

    // piana na powierzchni
    ctx.strokeStyle = pal.waterFoam;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const y = level + Math.sin(x * 0.02 + t * 1.9) * 4 + Math.sin(x * 0.05 - t * 2.7) * 2.2;
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------- robaki ----------------
  private drawWorms(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const active = inp.state.turn.activeWormId;
    for (const w of inp.state.worms) {
      if (!w.alive) continue;
      this.drawWorm(ctx, w, inp, w.id === active);
    }
  }

  private drawWorm(ctx: CanvasRenderingContext2D, w: WormSnapshot, inp: RenderInput, isActive: boolean): void {
    const col = teamColor(w.team);
    const rx = 8.5;
    const ry = 10.5;
    ctx.save();
    ctx.translate(w.x, w.y);

    // cień na ziemi
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, ry + 1.5, rx * 0.9, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (w.anim === "jetpack") {
      inp.particles.jetFlame(w.x + (Math.random() - 0.5) * 6, w.y + ry);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const fg = ctx.createRadialGradient(0, ry + 6, 1, 0, ry + 6, 16);
      fg.addColorStop(0, "rgba(255,200,90,0.8)");
      fg.addColorStop(1, "rgba(255,120,20,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(0, ry + 6, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // plecak
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(-w.facing * 9, -6, 5, 12);
    }

    // ciałko
    const bg = ctx.createLinearGradient(0, -ry, 0, ry);
    bg.addColorStop(0, lighten(col, 0.45));
    bg.addColorStop(0.55, col);
    bg.addColorStop(1, darken(col, 0.4));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = darken(col, 0.55);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // bandaż przy niskim hp
    if (w.hp > 0 && w.hp < 35) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#f2ece0";
      ctx.translate(0, -1);
      ctx.rotate(-0.45);
      ctx.fillRect(-rx - 3, -2.5, (rx + 3) * 2, 5);
      ctx.restore();
      ctx.fillStyle = "#f2ece0";
      ctx.beginPath();
      ctx.arc(rx * 0.55, -3.4, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // oczy
    const ex = w.facing * 2.2;
    for (const off of [-2.4, 2.4]) {
      ctx.fillStyle = "#fbfdff";
      ctx.beginPath();
      ctx.ellipse(ex + off * 0.85, -4.4, 1.9, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#12161f";
      ctx.beginPath();
      ctx.arc(ex + off * 0.85 + w.facing * 0.7, -4.3, 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    // usta
    ctx.strokeStyle = darken(col, 0.65);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w.facing * 2, 0.6, 2.4, 0.25, Math.PI - 0.25);
    ctx.stroke();

    if (w.anim === "bat") {
      ctx.save();
      ctx.rotate(w.facing * (-0.9 + Math.sin(inp.time * 22) * 0.7));
      ctx.fillStyle = "#b5793a";
      ctx.fillRect(0, -2, w.facing * 20, 4);
      ctx.restore();
    }

    ctx.restore();

    // nazwa + pasek HP nad głową (stały rozmiar na ekranie)
    const s = 1 / inp.camera.zoom;
    ctx.save();
    ctx.translate(w.x, w.y - ry - 10);
    ctx.scale(s, s);
    const barW = 42;
    const hp = Math.max(0, Math.min(1, w.hp / WORM_MAX_HP));
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(w.name, 0, -11);
    ctx.fillStyle = col;
    ctx.fillText(w.name, 0, -11);

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    roundRect(ctx, -barW / 2 - 1, -9, barW + 2, 8, 4);
    ctx.fill();
    ctx.fillStyle = hp > 0.5 ? col : hp > 0.22 ? "#ffb020" : "#ff4d4d";
    roundRect(ctx, -barW / 2, -8, barW * hp, 6, 3);
    ctx.fill();
    ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.max(0, Math.round(w.hp))), 0, -4.6);
    ctx.restore();

    // strzałka nad aktywnym robakiem
    if (isActive) {
      const bob = Math.sin(inp.time * 4) * 3;
      ctx.save();
      ctx.translate(w.x, w.y - ry - 38 + bob);
      ctx.scale(s, s);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(-8, -2);
      ctx.lineTo(-3, -2);
      ctx.lineTo(-3, -12);
      ctx.lineTo(3, -12);
      ctx.lineTo(3, -2);
      ctx.lineTo(8, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------- celowanie ----------------
  private drawAim(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const st = inp.state;
    const worm = st.worms.find((w) => w.id === st.turn.activeWormId && w.alive);
    if (!worm) return;
    const s = 1 / inp.camera.zoom;

    // podgląd belki pod kursorem
    if (inp.myTurn && inp.weapon === "girder" && inp.mouseWorld) {
      const ang = st.turn.girderAngle ?? 0;
      ctx.save();
      ctx.translate(inp.mouseWorld.x, inp.mouseWorld.y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "#c4713a";
      ctx.fillRect(-40, -6, 80, 12);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffd24d";
      ctx.lineWidth = 1.5 * s;
      ctx.setLineDash([5 * s, 4 * s]);
      ctx.strokeRect(-40, -6, 80, 12);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // znacznik celu dla broni celowanych
    if (inp.myTurn && TARGETED.has(inp.weapon) && inp.weapon !== "girder" && inp.mouseWorld) {
      const m = inp.mouseWorld;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(s, s);
      ctx.strokeStyle = "#ff5f56";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14 + Math.sin(inp.time * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(-6, 0);
      ctx.moveTo(6, 0); ctx.lineTo(20, 0);
      ctx.moveTo(0, -20); ctx.lineTo(0, -6);
      ctx.moveTo(0, 6); ctx.lineTo(0, 20);
      ctx.stroke();
      ctx.restore();
    }

    if (!inp.myTurn) return;
    if (st.turn.phase !== "active" && st.turn.phase !== "retreat") return;

    const aim = inp.aimPitch;
    const dirX = Math.cos(aim) * worm.facing;
    const dirY = Math.sin(aim);
    const col = teamColor(worm.team);

    // kropkowana linia celownicza
    ctx.save();
    ctx.setLineDash([4 * s, 6 * s]);
    ctx.lineWidth = 1.6 * s;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.moveTo(worm.x + dirX * 16 * s, worm.y + dirY * 16 * s);
    ctx.lineTo(worm.x + dirX * 92 * s, worm.y + dirY * 92 * s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // krzyżyk na końcu
    const cx = worm.x + dirX * 106 * s;
    const cy = worm.y + dirY * 106 * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.moveTo(-12, 0); ctx.lineTo(-4, 0);
    ctx.moveTo(4, 0); ctx.lineTo(12, 0);
    ctx.moveTo(0, -12); ctx.lineTo(0, -4);
    ctx.moveTo(0, 4); ctx.lineTo(0, 12);
    ctx.stroke();
    ctx.restore();

    // Pasek siły rośnie w kierunku strzału, jak w klasycznej artylerii.
    const power = inp.localCharge;
    if (power > 0.001) {
      const segments = 18;
      for (let i = 0; i < segments; i++) {
        const fraction = (i + 1) / segments;
        const distance = (19 + i * 4) * s;
        const radius = (2 + fraction * 1.8) * s;
        ctx.beginPath();
        ctx.arc(worm.x + dirX * distance, worm.y + dirY * distance, radius, 0, Math.PI * 2);
        ctx.fillStyle = fraction <= power
          ? fraction < 0.55 ? "#8fea57" : fraction < 0.8 ? "#ffd24d" : "#ff5d46"
          : "rgba(5,12,20,.5)";
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.lineWidth = s;
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(worm.x, worm.y + 24 * s);
      ctx.scale(s, s);
      ctx.font = "800 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#07111c";
      ctx.lineWidth = 3;
      ctx.strokeText(Math.round(power * 100) + "%", 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillText(Math.round(power * 100) + "%", 0, 0);
      ctx.restore();
    }
  }

  // ---------------- pociski ----------------
  private drawProjectiles(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    for (const p of inp.state.projectiles) this.drawProjectile(ctx, p, inp);
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: ProjectileSnapshot, inp: RenderInput): void {
    const ang = p.angle ?? Math.atan2(p.vy, p.vx);
    const s = 1 / inp.camera.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);

    switch (p.kind) {
      case "bazooka":
      case "homing": {
        inp.particles.smokeTrail(p.x - Math.cos(ang) * 8, p.y - Math.sin(ang) * 8, p.kind === "homing" ? 1.2 : 1);
        ctx.rotate(ang);
        ctx.fillStyle = p.kind === "homing" ? "#c0392b" : "#5b6678";
        roundRect(ctx, -9, -3.5, 18, 7, 3);
        ctx.fill();
        ctx.fillStyle = "#e05a3a";
        ctx.beginPath();
        ctx.moveTo(9, -3.5);
        ctx.lineTo(15, 0);
        ctx.lineTo(9, 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#8fa0b8";
        ctx.beginPath();
        ctx.moveTo(-9, -3);
        ctx.lineTo(-14, -6);
        ctx.lineTo(-9, 0);
        ctx.lineTo(-14, 6);
        ctx.lineTo(-9, 3);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(-12, 0, 0, -12, 0, 12);
        g.addColorStop(0, "rgba(255,190,80,0.9)");
        g.addColorStop(1, "rgba(255,90,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(-12, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "grenade":
      case "cluster": {
        ctx.rotate(ang * 0.4 + inp.time * 4);
        ctx.fillStyle = p.kind === "cluster" ? "#2f5f4a" : "#3f7a3a";
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#24452a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5, -1.5); ctx.lineTo(5, -1.5);
        ctx.moveTo(-5, 2); ctx.lineTo(5, 2);
        ctx.stroke();
        ctx.fillStyle = "#8a8f98";
        ctx.fillRect(-1.6, -8.5, 3.2, 3.5);
        break;
      }
      case "clusterlet":
      case "bananalet": {
        ctx.fillStyle = p.kind === "bananalet" ? "#ffd83d" : "#4a7a5a";
        ctx.beginPath();
        ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "banana": {
        ctx.rotate(ang + inp.time * 3);
        ctx.strokeStyle = "#ffd83d";
        ctx.lineWidth = 4.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0.5, Math.PI - 0.5);
        ctx.stroke();
        break;
      }
      case "holy": {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 22);
        g.addColorStop(0, "rgba(255,240,180,0.95)");
        g.addColorStop(1, "rgba(255,190,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const bg = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8);
        bg.addColorStop(0, "#fff8d6");
        bg.addColorStop(1, "#e0a91f");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,248,200,0.95)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(0, -10, 8, 2.6, Math.sin(inp.time * 2) * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "dynamite": {
        ctx.fillStyle = "#cc3b2e";
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.fill();
        ctx.fillStyle = "#f2e2c2";
        ctx.fillRect(-5, -2, 10, 3);
        ctx.strokeStyle = "#c9a24a";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.quadraticCurveTo(5, -13, 2, -15);
        ctx.stroke();
        inp.particles.sparks(p.x + 2, p.y - 15, 1, "#ffd76a");
        break;
      }
      case "mine": {
        ctx.fillStyle = "#6b7280";
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "airstrikeBomb": {
        ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = "#3f4652";
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8fa0b8";
        ctx.beginPath();
        ctx.moveTo(-4, 6); ctx.lineTo(-6, 11); ctx.lineTo(0, 8);
        ctx.lineTo(6, 11); ctx.lineTo(4, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#e05a3a";
        ctx.beginPath();
        ctx.arc(0, -7, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "bullet":
      case "uzi":
      case "shotgun": {
        const len = Math.min(16, Math.hypot(p.vx, p.vy) * 0.02 + 6);
        ctx.rotate(ang);
        ctx.strokeStyle = "#ffe9a8";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = "#d9dde6";
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // licznik zapalnika nad granatami
    if (p.fuse !== undefined && p.fuse > 0 && p.kind !== "bullet") {
      ctx.save();
      ctx.translate(p.x, p.y - 14);
      ctx.scale(s, s);
      ctx.font = "800 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      const txt = String(Math.max(1, Math.ceil(p.fuse)));
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = p.fuse < 1 ? "#ff5f56" : "#ffd24d";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  }

  // ---------------- skrzynki ----------------
  private drawCrates(ctx: CanvasRenderingContext2D, crates: CrateSnapshot[], time: number): void {
    for (const c of crates) {
      ctx.save();
      ctx.translate(c.x, c.y);
      if (!c.landed) {
        // spadochron
        const sway = Math.sin(time * 2 + c.id) * 0.12;
        ctx.save();
        ctx.rotate(sway);
        ctx.fillStyle = "#e8e2d5";
        ctx.beginPath();
        ctx.moveTo(-20, -22);
        ctx.quadraticCurveTo(0, -46, 20, -22);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#cf5d4a";
        ctx.beginPath();
        ctx.moveTo(-7, -30.5);
        ctx.quadraticCurveTo(0, -46, 7, -30.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(230,226,215,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-20, -22); ctx.lineTo(-6, -9);
        ctx.moveTo(20, -22); ctx.lineTo(6, -9);
        ctx.moveTo(0, -30); ctx.lineTo(0, -9);
        ctx.stroke();
        ctx.restore();
      }
      const bodyCol = c.kind === "health" ? "#c8493f" : c.kind === "weapon" ? "#5a6a4a" : "#4a5a7a";
      ctx.fillStyle = darken(bodyCol, 0.25);
      roundRect(ctx, -10, -9, 20, 18, 3);
      ctx.fill();
      ctx.fillStyle = bodyCol;
      roundRect(ctx, -10, -9, 20, 13, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 1.2;
      roundRect(ctx, -10, -9, 20, 18, 3);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (c.kind === "health") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(-1.8, -6, 3.6, 11);
        ctx.fillRect(-6.5, -1.3, 13, 3.6);
      } else if (c.kind === "weapon") {
        ctx.fillStyle = "#e8e2d5";
        ctx.fillRect(-6, -3, 11, 3.4);
        ctx.fillRect(-6, 0.4, 3.4, 5);
        ctx.fillRect(3, -5, 3, 2.4);
      } else {
        ctx.fillStyle = "#ffd24d";
        star(ctx, 0, 0, 7, 3.2, 5);
      }
      // poświata
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      g.addColorStop(0, `rgba(255,255,255,${0.12 + 0.06 * Math.sin(time * 3 + c.id)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  // ---------------- miny ----------------
  private drawMines(ctx: CanvasRenderingContext2D, mines: MineSnapshot[], time: number): void {
    for (const m of mines) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.fillStyle = "#6b7280";
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
        ctx.stroke();
      }
      const fast = m.fuse !== undefined && m.fuse > 0;
      const blink = fast ? Math.sin(time * 26) > -0.2 : m.armed ? Math.sin(time * 5) > 0.2 : false;
      ctx.fillStyle = blink ? "#ff3b30" : "#5a1e1c";
      ctx.beginPath();
      ctx.arc(0, -1.5, 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (blink) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(0, -1.5, 0, 0, -1.5, 12);
        g.addColorStop(0, "rgba(255,60,50,0.7)");
        g.addColorStop(1, "rgba(255,60,50,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, -1.5, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ---------------- groby ----------------
  private drawGraves(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    for (const g of inp.graves) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#7b8492";
      ctx.beginPath();
      ctx.moveTo(-7, 10);
      ctx.lineTo(-7, -4);
      ctx.arc(0, -4, 7, Math.PI, 0);
      ctx.lineTo(7, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5d6673";
      ctx.fillRect(-9, 8, 18, 4);
      ctx.strokeStyle = "#464e59";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 4);
      ctx.moveTo(-4, -4); ctx.lineTo(4, -4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
}

// ---------------- pomocnicze ----------------
function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x - r * 0.7, y, r * 0.55, 0, Math.PI * 2);
  ctx.arc(x, y - r * 0.28, r * 0.75, 0, Math.PI * 2);
  ctx.arc(x + r * 0.75, y, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x + r * 0.2, y + r * 0.24, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${mix(r, 255, amt)},${mix(g, 255, amt)},${mix(b, 255, amt)})`;
}

export function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${mix(r, 0, amt)},${mix(g, 0, amt)},${mix(b, 0, amt)})`;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export { teamColor };
