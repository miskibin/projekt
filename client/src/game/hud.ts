import { MAX_WIND, TEAM_COLORS, WORLD_HEIGHT, WORLD_WIDTH, WORM_MAX_HP } from "@shared/constants";
import type { WeaponId } from "@shared/protocol";
import type { Camera } from "./camera";
import type { RenderState } from "./state";
import { blankPose, drawWormCharacter, WormSkins } from "./wormRenderer";
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
  topInset: number;
}

const FONT = "ui-sans-serif, system-ui, sans-serif";

/* Wspólny język wizualny HUD-u: ciemne, półprzezroczyste granatowe karty. */
const PANEL_FILL = "rgba(29,47,68,.92)";
const PANEL_LINE = "rgba(206,224,237,.24)";
const TEXT = "#f4f8ff";
const MUTED = "#9db3cc";
const ALERT = "#ff6b5e";
const WIND = "#8fd3ff";

/** Poniżej tej szerokości HUD przechodzi w kompaktowy układ (telefon w poziomie). */
const NARROW = 500;

export class Hud {
  private readonly skins = new WormSkins();
  private readonly portraitPose = blankPose();
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
    this.drawTeams(ctx, inp, W);
    const clockBottom = this.drawClock(ctx, inp, W);
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

  /** Team cards show a living worm; its HP matches the label on the battlefield. */
  private drawTeams(ctx: CanvasRenderingContext2D, inp: HudInput, width: number): void {
    const compact = width < 600;
    const cardWidth = compact ? Math.max(84, Math.min(122, (width - 126) / 2)) : Math.min(230, (width - 260) / 2);
    const h = compact ? 39 : 56;
    const gap = compact ? 6 : 12;
    const rightGap = compact ? gap : 68; // room for settings
    const teams = inp.state.teams;
    teams.forEach((team, index) => {
      const right = index % 2 === 1;
      const x = right ? width - cardWidth - rightGap : gap;
      const y = inp.topInset + Math.floor(index / 2) * (h + 5);
      panel(ctx, x, y, cardWidth, h, compact ? 9 : 12);
      const worms = inp.state.worms.filter((worm) => worm.team === team.team && worm.alive);
      const shown = worms.find((worm) => worm.id === inp.state.turn.activeWormId) ?? worms[0];
      const color = teamColor(team.team);
      const portrait = compact ? 26 : 40;
      ctx.fillStyle = color;
      roundRect(ctx, x + 4, y + 4, portrait, h - 8, compact ? 6 : 8); ctx.fill();
      ctx.save();
      roundRect(ctx, x + 4, y + 4, portrait, h - 8, 6); ctx.clip();
      ctx.translate(x + 4 + portrait / 2, y + h * .59);
      ctx.scale(compact ? .7 : 1.08, compact ? .7 : 1.08);
      drawWormCharacter(ctx, this.portraitPose, { skin: this.skins.get(ctx, color), facing: 1,
        weapon: null, hp: shown?.hp ?? 0, time: 0, jetpack: false, bat: false });
      ctx.restore();
      const tx = x + portrait + (compact ? 10 : 14);
      const available = cardWidth - portrait - (compact ? 18 : 24);
      ctx.font = `750 ${compact ? 11 : 15}px ${FONT}`;
      ctx.textAlign = "left"; ctx.fillStyle = TEXT;
      ctx.fillText(fitText(ctx, shown?.name ?? team.name, available), tx, y + (compact ? 13 : 18));
      const hp = shown?.hp ?? 0;
      const barY = y + h - (compact ? 13 : 20), barW = Math.max(10, available - (compact ? 23 : 34));
      ctx.fillStyle = "#18293c"; roundRect(ctx, tx, barY, barW, compact ? 7 : 10, 5); ctx.fill();
      if (hp > 0) {
        ctx.fillStyle = color; roundRect(ctx, tx, barY, Math.max(3, barW * Math.min(1, hp / WORM_MAX_HP)), compact ? 7 : 10, 5); ctx.fill();
      }
      ctx.textAlign = "right"; ctx.font = `800 ${compact ? 10 : 12}px ${FONT}`; ctx.fillStyle = TEXT;
      ctx.fillText(String(hp), x + cardWidth - 8, barY + (compact ? 3.5 : 5));
    });
  }

  private drawClock(ctx: CanvasRenderingContext2D, inp: HudInput, width: number): number {
    const turn = inp.state.turn;
    const compact = width < 600;
    const pw = compact ? 108 : 158;
    const ph = compact ? 44 : 64;
    const py = inp.topInset;
    const px = Math.round(width / 2 - pw / 2);
    panel(ctx, px, py, pw, ph, compact ? 12 : 20);
    const seconds = Math.max(0, Math.ceil(turn.timeLeft));
    const hot = seconds <= 10 && turn.phase === "active";
    ctx.textAlign = "center";
    ctx.font = `750 ${compact ? 9 : 11}px ${FONT}`;
    ctx.fillStyle = MUTED;
    const caption = turn.phase === "gameOver" ? "KONIEC GRY" : turn.phase === "settling" || turn.phase === "starting" ? "TRWA AKCJA" : `TURA ${turn.round}`;
    ctx.fillText(caption, width / 2, py + (compact ? 10 : 15));
    ctx.font = `850 ${compact ? 22 : 29}px ${FONT}`;
    ctx.fillStyle = hot ? ALERT : TEXT;
    ctx.fillText(String(seconds).padStart(2, "0"), width / 2 + 8, py + (compact ? 28 : 39));
    // A small clock, rather than an extra text label.
    const cx = width / 2 - (compact ? 22 : 28), cy = py + (compact ? 28 : 39), rr = compact ? 6 : 9;
    ctx.strokeStyle = TEXT; ctx.lineWidth = compact ? 1.6 : 2;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.moveTo(cx, cy - rr * .6); ctx.lineTo(cx, cy); ctx.lineTo(cx + rr * .48, cy + rr * .2); ctx.stroke();
    const wind = Math.max(-1, Math.min(1, turn.wind / MAX_WIND));
    ctx.fillStyle = "rgba(255,255,255,.2)"; roundRect(ctx, px + 16, py + ph - 6, pw - 32, 2, 1); ctx.fill();
    ctx.fillStyle = WIND;
    const span = (pw - 32) / 2;
    if (Math.abs(wind) > .03) { roundRect(ctx, wind < 0 ? width / 2 + span * wind : width / 2,
      py + ph - 6, Math.abs(wind) * span, 2, 1); ctx.fill(); }
    return py + ph + (inp.state.teams.length > 2 ? (compact ? 41 : 55) : 0);
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

/** Keep kill-feed text at its intended font size instead of squeezing long names. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let end = text.length;
  while (end > 0 && ctx.measureText(text.slice(0, end) + ellipsis).width > maxWidth) end--;
  return end > 0 ? text.slice(0, end) + ellipsis : ellipsis;
}

export { TEAM_COLORS };
