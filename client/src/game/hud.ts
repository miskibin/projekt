import { MAX_WIND, TEAM_COLORS, WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import type { WeaponId } from "@shared/protocol";
import type { Camera } from "./camera";
import type { RenderState } from "./state";
import { roundRect, teamColor } from "./renderer";

export interface HudInput {
  state: RenderState;
  camera: Camera;
  terrainTex: HTMLCanvasElement;
  myTeam: number;
  rtt: number;
  time: number;
  weapon: WeaponId;
  demo: boolean;
  showMap: boolean;
  touch: boolean;
  stale: boolean;
}

const FONT = "ui-sans-serif, system-ui, sans-serif";

/* Wspólny język wizualny HUD-u: ciemne, półprzezroczyste granatowe karty. */
const PANEL_FILL = "rgba(20,35,55,.72)";
const PANEL_LINE = "rgba(190,215,255,.16)";
const TEXT = "#f4f8ff";
const MUTED = "#9db3cc";
const ALERT = "#ff6b5e";
const WIND = "#8fd3ff";

/** Poniżej tej szerokości HUD przechodzi w kompaktowy układ (telefon w poziomie). */
const NARROW = 500;

export class Hud {
  private notice: { text: string; life: number; max: number } | null = null;
  private feed: { text: string; color: string; life: number }[] = [];

  banner(text: string, seconds = 2): void {
    this.notice = { text, life: 0, max: Math.min(seconds, 1.35) };
  }

  kill(text: string, color = "#e7ecf5"): void {
    this.feed = [{ text, color, life: 0 }, ...this.feed].slice(0, 2);
  }

  clear(): void { this.notice = null; this.feed = []; }

  update(dt: number): void {
    if (this.notice) {
      this.notice.life += dt;
      if (this.notice.life >= this.notice.max) this.notice = null;
    }
    this.feed = this.feed.map((item) => ({ ...item, life: item.life + dt })).filter((item) => item.life < 4);
  }

  draw(ctx: CanvasRenderingContext2D, inp: HudInput): void {
    const W = inp.camera.viewW;
    const H = inp.camera.viewH;
    const narrow = W < NARROW;
    ctx.save();
    ctx.textBaseline = "middle";
    const clockBottom = this.drawClock(ctx, inp, W, narrow);
    if (inp.showMap) this.drawMap(ctx, inp, W, H);
    const feedBottom = this.feed.length
      ? clockBottom + 12 + (this.feed.length - 1) * (narrow ? 25 : 27) + 22
      : clockBottom;
    const bannerY = Math.max(clockBottom + (narrow ? 28 : 32), feedBottom + (narrow ? 10 : 12));
    if (inp.stale) this.drawBanner(ctx, "Czekam na synchronizację gry…", W, bannerY, narrow);

    // Krótkie komunikaty zamiast stałych podpisów i dużych kart na środku ekranu.
    if (this.notice) {
      ctx.globalAlpha = Math.min(1, this.notice.life * 6, (this.notice.max - this.notice.life) * 3);
      this.drawBanner(ctx, this.notice.text, W, bannerY + (inp.stale ? (narrow ? 34 : 40) : 0), narrow);
      ctx.globalAlpha = 1;
    }

    // Kill feed – pod przyciskami w prawym górnym rogu, z kropką w kolorze drużyny.
    ctx.font = "650 " + (narrow ? 11 : 12) + "px " + FONT;
    ctx.textAlign = "right";
    const feedTop = clockBottom + 12;
    const rowWidth = Math.min(Math.max(132, W * 0.38), 242);
    const textWidth = rowWidth - 40;
    this.feed.forEach((item, index) => {
      const rowHeight = narrow ? 22 : 24;
      const y = feedTop + index * (rowHeight + 3);
      ctx.globalAlpha = Math.min(1, 4 - item.life);
      panel(ctx, W - rowWidth - 10, y - rowHeight / 2, rowWidth, rowHeight, rowHeight / 2);
      ctx.fillStyle = TEXT;
      ctx.fillText(fitText(ctx, item.text, textWidth), W - 36, y);
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(W - 22, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Stała informacja o tym, kto steruje oraz czy gra rozlicza strzał. */
  private drawClock(ctx: CanvasRenderingContext2D, inp: HudInput, width: number, narrow: boolean): number {
    const turn = inp.state.turn;
    const pw = narrow ? Math.min(248, width - 88) : 292;
    const ph = narrow ? 68 : 76;
    const py = narrow ? 52 : 8;
    const px = Math.round(width / 2 - pw / 2);
    panel(ctx, px, py, pw, ph, narrow ? 10 : 13);

    const cy = py + (narrow ? 20 : 23);
    const seconds = Math.max(0, Math.ceil(turn.timeLeft));
    const hot = seconds <= 10 && turn.phase === "active";

    // Three clear zones keep round, timer, and wind readable at phone scale.
    const leftEdge = px + (narrow ? 51 : 65);
    const rightEdge = px + (narrow ? 115 : 143);
    ctx.strokeStyle = "rgba(190,215,255,.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftEdge, py + 8);
    ctx.lineTo(leftEdge, py + (narrow ? 36 : 42));
    ctx.moveTo(rightEdge, py + 8);
    ctx.lineTo(rightEdge, py + (narrow ? 36 : 42));
    ctx.stroke();

    const roundW = narrow ? 36 : 44;
    const roundH = narrow ? 24 : 28;
    const roundX = px + (narrow ? 7 : 9);
    roundRect(ctx, roundX, cy - roundH / 2, roundW, roundH, roundH / 2);
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.fill();
    ctx.fillStyle = teamColor(turn.activeTeam);
    ctx.beginPath();
    ctx.arc(roundX + (narrow ? 7 : 8), cy, narrow ? 2.5 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = "750 " + (narrow ? 9 : 10) + "px " + FONT;
    ctx.fillStyle = turn.suddenDeath ? ALERT : MUTED;
    ctx.fillText("R " + turn.round, roundX + roundW / 2 + (narrow ? 2 : 3), cy);

    ctx.textAlign = "center";
    ctx.font = "800 " + (narrow ? 22 : 27) + "px " + FONT;
    ctx.fillStyle = hot ? ALERT : TEXT;
    ctx.fillText(String(seconds).padStart(2, "0"), px + (narrow ? 83 : 104), cy + 1);

    const cx = px + (narrow ? pw - 49 : pw - 57);
    const half = narrow ? 23 : 30;
    ctx.font = "750 " + (narrow ? 7 : 8) + "px " + FONT;
    ctx.fillStyle = MUTED;
    ctx.textAlign = "center";
    ctx.fillText("WIATR", cx, cy - (narrow ? 12 : 14));
    ctx.fillStyle = "rgba(255,255,255,.16)";
    roundRect(ctx, cx - half, cy + 4, half * 2, 4, 2);
    ctx.fill();
    const wind = Math.max(-1, Math.min(1, turn.wind / MAX_WIND));
    const len = Math.abs(wind) * half;
    if (len > 1) {
      ctx.fillStyle = WIND;
      roundRect(ctx, wind < 0 ? cx - len : cx, cy + 4, len, 4, 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fillRect(cx - 0.5, cy + 1, 1, 10);
    arrow(ctx, cx - half - 5, cy + 6, -1, wind < -0.02 ? WIND : "rgba(255,255,255,.22)");
    arrow(ctx, cx + half + 5, cy + 6, 1, wind > 0.02 ? WIND : "rgba(255,255,255,.22)");

    ctx.strokeStyle = "rgba(190,215,255,.18)";
    ctx.beginPath();
    const separatorY = py + (narrow ? 41 : 47);
    ctx.moveTo(px + 10, separatorY);
    ctx.lineTo(px + pw - 10, separatorY);
    ctx.stroke();
    const acting = turn.phase === "active" || turn.phase === "retreat";
    const mine = turn.activeTeam === inp.myTeam;
    const name = inp.state.teams.find((team) => team.team === turn.activeTeam)?.name
      ?? `Drużyna ${turn.activeTeam + 1}`;
    const action = turn.phase === "active"
      ? (mine ? "TWOJA TURA" : `GRA ${name.toLocaleUpperCase("pl")}`)
      : turn.phase === "retreat"
        ? (mine ? "TWÓJ STRZAŁ" : `STRZAŁ: ${name.toLocaleUpperCase("pl")}`)
        : turn.phase === "gameOver" ? "KONIEC GRY" : "TRWA AKCJA / ZMIANA TURY";
    const labelY = py + (narrow ? 55 : 62);
    ctx.fillStyle = acting ? teamColor(turn.activeTeam) : WIND;
    ctx.beginPath();
    ctx.arc(px + 18, labelY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 ${narrow ? 11 : 12}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillStyle = TEXT;
    ctx.fillText(action, px + 29, labelY + 1, pw - 43);
    return py + ph;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, text: string, width: number, cy: number, narrow: boolean): void {
    const size = narrow ? 13 : 15;
    ctx.font = "700 " + size + "px " + FONT;
    ctx.textAlign = "center";
    const max = width - 64;
    const textW = Math.min(ctx.measureText(text).width, max);
    const w = Math.min(width - 32, textW + 36);
    const h = narrow ? 28 : 34;
    panel(ctx, Math.round(width / 2 - w / 2), Math.round(cy - h / 2), w, h, h / 2);
    ctx.fillStyle = TEXT;
    ctx.fillText(text, width / 2, cy + 1, max);
  }

  private drawMap(ctx: CanvasRenderingContext2D, inp: HudInput, width: number, height: number): void {
    const w = Math.min(500, width - 40, (height - 110) * WORLD_WIDTH / WORLD_HEIGHT);
    const h = w * WORLD_HEIGHT / WORLD_WIDTH;
    const x = Math.round((width - w) / 2);
    const y = Math.round((height - h) / 2);
    ctx.fillStyle = "rgba(4,9,16,.45)";
    ctx.fillRect(0, 0, width, height);
    panel(ctx, x - 10, y - 10, w + 20, h + 20, 16);
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.drawImage(inp.terrainTex, x, y, w, h);
    const waterY = y + inp.state.turn.waterLevel / WORLD_HEIGHT * h;
    ctx.fillStyle = "rgba(60,150,210,.5)";
    ctx.fillRect(x, waterY, w, y + h - waterY);
    ctx.restore();
    for (const worm of inp.state.worms) {
      if (!worm.alive) continue;
      ctx.fillStyle = teamColor(worm.team);
      ctx.beginPath();
      ctx.arc(x + worm.x / WORLD_WIDTH * w, y + worm.y / WORLD_HEIGHT * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const view = inp.camera.viewRect();
    ctx.strokeStyle = "rgba(255,255,255,.65)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + view.x / WORLD_WIDTH * w, y + view.y / WORLD_HEIGHT * h,
      view.w / WORLD_WIDTH * w, view.h / WORLD_HEIGHT * h);
  }
}

/** Ciemna, półprzezroczysta karta HUD-u z delikatną jasną obwódką. */
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 12): void {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = PANEL_FILL;
  ctx.fill();
  ctx.strokeStyle = PANEL_LINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Trójkąt kierunku wiatru. */
function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + dir * 4, cy);
  ctx.lineTo(cx - dir * 3, cy - 4.5);
  ctx.lineTo(cx - dir * 3, cy + 4.5);
  ctx.closePath();
  ctx.fill();
}

/** Keep kill-feed text at its intended font size instead of squeezing long names. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let end = text.length;
  while (end > 0 && ctx.measureText(text.slice(0, end) + ellipsis).width > maxWidth) end--;
  return end > 0 ? text.slice(0, end) + ellipsis : ellipsis;
}

export { TEAM_COLORS };
