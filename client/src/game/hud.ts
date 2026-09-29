import { MAX_WIND, TEAM_COLORS, WORLD_HEIGHT, WORLD_WIDTH, WORM_MAX_HP } from "@shared/constants";
import type { WeaponId } from "@shared/protocol";
import type { Camera } from "./camera";
import type { RenderState } from "./state";
import { roundRect, teamColor } from "./renderer";
import { INK } from "./wormRenderer";

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
  turnTime: number;
  suddenDeathRounds: number;
}

const FONT = "ui-sans-serif, system-ui, sans-serif";

/* Wspólny język wizualny HUD-u: ciemne, półprzezroczyste granatowe karty jak w makiecie. */
const PANEL_FILL = "rgba(44,60,90,.88)";
const PANEL_LINE = "rgba(150,182,230,.34)";
const TEXT = "#eef4ff";
const SOFT = "#b9d0ee";
const MUTED = "#8ea6c6";
const ALERT = "#ff6b5e";
const WIND = "#8fd3ff";
const TRACK = "#1c2740";

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
    const timerBottom = this.drawClock(ctx, inp, W, H, narrow);
    const stacks = this.drawTeams(ctx, inp, W, H, narrow);
    this.placeWeaponPill(stacks.leftBottom);
    const clockBottom = Math.max(timerBottom, stacks.rightBottom);
    if (inp.showMap) this.drawMap(ctx, inp, W, H);
    const feedBottom = this.feed.length
      ? clockBottom + 12 + (this.feed.length - 1) * (narrow ? 25 : 27) + 22
      : clockBottom;
    const bannerY0 = timerBottom;
    const bannerY = Math.max(bannerY0 + (narrow ? 28 : 32), feedBottom + (narrow ? 10 : 12));
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

  private weaponTop = -1;

  /** Pigułka broni (DOM) siada pod kartą drużyny z lewej strony, zamiast pod nią leżeć. */
  private placeWeaponPill(bottom: number): void {
    const top = Math.round(bottom + 8);
    if (top === this.weaponTop) return;
    this.weaponTop = top;
    document.getElementById("screen-game")?.style.setProperty("--weapon-top", `${top}px`);
  }

  /** Karty drużyn w rogach: portret robaka, nazwa, segmentowy pasek HP (segment = robak) i suma. */
  private drawTeams(ctx: CanvasRenderingContext2D, inp: HudInput, W: number, H: number, narrow: boolean): { leftBottom: number; rightBottom: number } {
    const ph = Math.round(Math.min(54, Math.max(34, H * 0.09)));
    const gearW = W < 560 || H < 460 ? 48 : 56;
    const timerW = timerWidth(W, narrow);
    const gap = 6;
    const leftRoom = W / 2 - timerW / 2 - 12 - 8;
    const rightRoom = leftRoom - gearW;
    const y0 = inp.topInset;
    let leftBottom = y0;
    let rightBottom = y0;
    const teams = inp.state.teams;
    for (let i = 0; i < teams.length && i < 4; i++) {
      const team = teams[i]!;
      const right = team.team % 2 === 1;
      const slot = Math.floor(team.team / 2);
      const pw = Math.round(Math.max(72, Math.min(284, right ? rightRoom : leftRoom)));
      const x = right ? W - gearW - 12 - 8 - pw : 12;
      const y = y0 + slot * (ph + gap);
      this.drawTeamCard(ctx, inp, team, x, y, pw, ph);
      if (right) rightBottom = Math.max(rightBottom, y + ph);
      else leftBottom = Math.max(leftBottom, y + ph);
    }
    return { leftBottom, rightBottom };
  }

  private drawTeamCard(ctx: CanvasRenderingContext2D, inp: HudInput, team: RenderState["teams"][number], x: number, y: number, w: number, h: number): void {
    const col = teamColor(team.team);
    const active = inp.state.turn.activeTeam === team.team
      && (inp.state.turn.phase === "active" || inp.state.turn.phase === "retreat");
    const r = Math.round(h * 0.24);
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = PANEL_FILL;
    ctx.fill();
    ctx.lineWidth = active ? 2 : 1.4;
    ctx.strokeStyle = active ? col : PANEL_LINE;
    ctx.stroke();

    const pad = Math.max(3, Math.round(h * 0.08));
    const icon = h - pad * 2;
    const showIcon = w >= 118;
    const showName = w >= 150;
    let cx = x + pad;
    if (showIcon) {
      drawPortrait(ctx, cx, y + pad, icon, col);
      cx += icon + Math.round(h * 0.16);
    } else {
      cx += 4;
    }

    const worms = inp.state.worms.filter((wm) => wm.team === team.team);
    const total = Math.max(0, Math.round(team.totalHp));
    const valueW = Math.max(26, h * 0.7);
    const barX = cx;
    const barW = Math.max(24, x + w - pad - 8 - valueW - barX);
    const barH = Math.max(9, Math.round(h * 0.26));
    const barY = y + h - pad - barH - Math.round(h * 0.1);

    if (showName) {
      ctx.font = `800 ${Math.round(Math.min(17, Math.max(11, h * 0.29)))}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = SOFT;
      ctx.fillText(fitText(ctx, team.name, x + w - pad - 8 - barX), barX, barY - Math.round(h * 0.2));
    }

    const n = Math.max(1, worms.length);
    const gapS = 3;
    const segW = (barW - gapS * (n - 1)) / n;
    ctx.lineJoin = "round";
    for (let i = 0; i < n; i++) {
      const wm = worms[i];
      const sx = barX + i * (segW + gapS);
      roundRect(ctx, sx - 1.5, barY - 1.5, segW + 3, barH + 3, (barH + 3) / 2.4);
      ctx.fillStyle = INK;
      ctx.fill();
      roundRect(ctx, sx, barY, segW, barH, barH / 2.6);
      ctx.fillStyle = TRACK;
      ctx.fill();
      const frac = wm && wm.alive ? Math.max(0, Math.min(1, wm.hp / WORM_MAX_HP)) : 0;
      if (frac > 0) {
        roundRect(ctx, sx, barY, Math.max(barH / 1.5, segW * frac), barH, barH / 2.6);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.28)";
        ctx.fillRect(sx + 1.5, barY + 1.2, Math.max(1, segW * frac - 3), Math.max(1.5, barH * 0.22));
      }
    }

    ctx.font = `850 ${Math.round(Math.min(20, Math.max(11, h * 0.36)))}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = team.alive > 0 ? TEXT : MUTED;
    ctx.fillText(String(total), x + w - pad - 6, barY + barH / 2 + (showName ? 0 : -h * 0.06));
  }

  /** Środkowa pigułka: "TURA n/max", zegar i sekundy; wiatr jako cienki pasek u dołu. */
  private drawClock(ctx: CanvasRenderingContext2D, inp: HudInput, width: number, height: number, narrow: boolean): number {
    const turn = inp.state.turn;
    const pw = timerWidth(width, narrow);
    const ph = Math.round(Math.min(74, Math.max(44, height * 0.125)));
    const py = inp.topInset + (width < 280 ? 44 : 0);
    const px = Math.round(width / 2 - pw / 2);
    const acting = turn.phase === "active" || turn.phase === "retreat";
    roundRect(ctx, px, py, pw, ph, Math.round(ph * 0.22));
    ctx.fillStyle = PANEL_FILL;
    ctx.fill();
    ctx.lineWidth = acting ? 2 : 1.4;
    ctx.strokeStyle = acting ? teamColor(turn.activeTeam) : PANEL_LINE;
    ctx.stroke();

    const seconds = Math.max(0, Math.ceil(turn.timeLeft));
    const hot = seconds <= 10 && turn.phase === "active";
    const label = turn.phase === "gameOver"
      ? "KONIEC GRY"
      : turn.suddenDeath
        ? "SUDDEN DEATH"
        : acting
          ? `TURA ${turn.round}/${Math.max(turn.round, inp.suddenDeathRounds)}`
          : "AKCJA";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = `800 ${Math.round(Math.min(15, Math.max(10, ph * 0.2)))}px ${FONT}`;
    ctx.fillStyle = turn.suddenDeath ? ALERT : SOFT;
    ctx.fillText(fitText(ctx, label, pw - 14), px + pw / 2, py + ph * 0.25);

    const rowY = py + ph * 0.62;
    const numSize = Math.round(Math.min(40, Math.max(20, ph * 0.5)));
    ctx.font = `850 ${numSize}px ${FONT}`;
    const numText = String(seconds).padStart(2, "0");
    const numW = ctx.measureText(numText).width;
    const iconR = numSize * 0.36;
    const total = iconR * 2 + 8 + numW;
    const startX = px + pw / 2 - total / 2;
    drawClockIcon(ctx, startX + iconR, rowY, iconR, hot ? ALERT : SOFT, inp.turnTime > 0 ? turn.timeLeft / inp.turnTime : 1);
    ctx.textAlign = "left";
    ctx.fillStyle = hot ? ALERT : TEXT;
    ctx.fillText(numText, startX + iconR * 2 + 8, rowY + 1);

    const wind = Math.max(-1, Math.min(1, turn.wind / MAX_WIND));
    const center = px + pw / 2;
    const half = pw / 2 - 16;
    const wy = py + ph - 6;
    ctx.fillStyle = "rgba(255,255,255,.16)";
    roundRect(ctx, center - half, wy, half * 2, 2.5, 1.2);
    ctx.fill();
    if (Math.abs(wind) > 0.03) {
      ctx.fillStyle = WIND;
      roundRect(ctx, wind < 0 ? center - half * -wind : center, wy,
        Math.max(1, Math.abs(wind) * half), 2.5, 1.2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.fillRect(center - .5, wy - 1.5, 1, 5.5);
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

function timerWidth(width: number, narrow: boolean): number {
  return Math.round(narrow ? Math.min(140, Math.max(96, width - 190)) : Math.min(180, Math.max(112, width * 0.108)));
}

/** Zegar z pierścieniem, który wyczerpuje się razem z czasem tury. */
function drawClockIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, left: number): void {
  const frac = Math.max(0, Math.min(1, left));
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.6, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.55);
  ctx.lineTo(0, 0);
  ctx.lineTo(r * 0.38, r * 0.22);
  ctx.stroke();
  ctx.restore();
}

/** Portret robaka w kolorze drużyny: kwadrat z dużymi oczami i rumieńcami. */
function drawPortrait(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const r = size * 0.24;
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, 0, 0, size, size, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, size, size, r);
  ctx.clip();
  ctx.fillStyle = "rgba(0,0,20,.22)";
  ctx.beginPath();
  ctx.ellipse(size * 0.6, size * 1.05, size * 0.7, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(1.4, size * 0.05);
  ctx.strokeStyle = INK;
  roundRect(ctx, 0, 0, size, size, r);
  ctx.stroke();

  const ex = size * 0.2;
  const ey = size * 0.44;
  const erx = size * 0.15;
  const ery = size * 0.2;
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(size / 2 + dx * ex, ey, erx, ery, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(size / 2 + dx * ex + erx * 0.28, ey + ery * 0.12, erx * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,150,170,.75)";
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(size / 2 + dx * size * 0.3, size * 0.7, size * 0.07, size * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, size * 0.045);
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.68, size * 0.11, 0.25, Math.PI - 0.25);
  ctx.stroke();
  ctx.restore();
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
