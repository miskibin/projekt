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
}

const FONT = "ui-sans-serif, system-ui, sans-serif";

export class Hud {
  private notice: { text: string; life: number; max: number } | null = null;
  private feed: { text: string; color: string; life: number }[] = [];

  banner(text: string, seconds = 2): void {
    this.notice = { text, life: 0, max: Math.min(seconds, 2) };
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
    ctx.save();
    ctx.textBaseline = "middle";
    this.drawClock(ctx, inp, W);
    this.drawTeams(ctx, inp, W, H);
    if (inp.showMap) this.drawMap(ctx, inp, W, H);

    // Short notices replace permanent captions and large centre-screen cards.
    if (this.notice) {
      ctx.globalAlpha = Math.min(1, this.notice.life * 6, (this.notice.max - this.notice.life) * 3);
      ctx.font = "600 12px " + FONT;
      ctx.textAlign = "center";
      ctx.fillStyle = "#f3f6fb";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 5;
      ctx.fillText(this.notice.text, W / 2, W < 500 ? 100 : 62, W - 80);
      ctx.shadowBlur = 0;
    }
    ctx.font = "500 11px " + FONT;
    ctx.textAlign = "right";
    this.feed.forEach((item, index) => {
      ctx.globalAlpha = Math.min(1, 4 - item.life);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, W - 12, 70 + index * 17, Math.min(W * 0.35, 240));
    });
    ctx.restore();
  }

  private drawClock(ctx: CanvasRenderingContext2D, inp: HudInput, width: number): void {
    const turn = inp.state.turn;
    const x = width / 2;
    ctx.save();
    if (width < 500) ctx.translate(0, 38);
    panel(ctx, x - 65, 8, 130, 34);
    ctx.textAlign = "center";
    ctx.font = "800 23px " + FONT;
    const seconds = Math.max(0, Math.ceil(turn.timeLeft));
    ctx.fillStyle = seconds <= 10 && turn.phase === "active" ? "#ff625b" : "#f6f8fc";
    ctx.fillText(String(seconds).padStart(2, "0"), x - 5, 26);
    ctx.font = "600 9px " + FONT;
    ctx.fillStyle = turn.suddenDeath ? "#ff625b" : "#9baabd";
    ctx.fillText("R" + turn.round, x - 46, 26);
    const wind = Math.max(-1, Math.min(1, turn.wind / MAX_WIND));
    const wx = x + 38;
    ctx.fillStyle = "#526074";
    ctx.fillRect(wx - 18, 24, 36, 3);
    ctx.fillStyle = "#a2d9fa";
    ctx.fillRect(wind < 0 ? wx + wind * 18 : wx, 24, Math.abs(wind) * 18, 3);
    ctx.fillStyle = "#e6f2ff";
    ctx.fillText(wind < 0 ? "‹" : "›", wx + Math.sign(wind) * 24, 25);
    ctx.restore();
  }

  private drawTeams(ctx: CanvasRenderingContext2D, inp: HudInput, width: number, height: number): void {
    const teams = inp.state.teams;
    const reserved = inp.touch && width > 600 ? 340 : 24;
    const available = Math.max(120, Math.min(520, width - reserved));
    const gap = 10;
    const cell = Math.min(120, (available - gap * (teams.length - 1)) / teams.length);
    const total = teams.length * cell + Math.max(0, teams.length - 1) * gap;
    const y = height - (inp.touch && width <= 600 ? 115 : 27);
    let x = (width - total) / 2;
    for (const team of teams) {
      const active = team.team === inp.state.turn.activeTeam;
      const maxHp = Math.max(1, inp.state.worms.filter((worm) => worm.team === team.team).length) * 100;
      ctx.globalAlpha = active ? 1 : 0.7;
      ctx.font = (active ? "700" : "500") + " 10px " + FONT;
      ctx.fillStyle = "#f5f7fb";
      ctx.textAlign = "left";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 4;
      ctx.fillText(team.name, x, y, Math.max(10, cell - 31));
      ctx.textAlign = "right";
      ctx.fillText(String(Math.max(0, Math.round(team.totalHp))), x + cell, y);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(10,16,25,.72)";
      ctx.fillRect(x, y + 9, cell, 4);
      ctx.fillStyle = teamColor(team.team);
      ctx.fillRect(x, y + 9, cell * Math.max(0, Math.min(1, team.totalHp / maxHp)), 4);
      x += cell + gap;
    }
    ctx.globalAlpha = 1;
  }

  private drawMap(ctx: CanvasRenderingContext2D, inp: HudInput, width: number, height: number): void {
    const w = Math.min(500, width - 32, (height - 100) * WORLD_WIDTH / WORLD_HEIGHT);
    const h = w * WORLD_HEIGHT / WORLD_WIDTH;
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    panel(ctx, x - 6, y - 6, w + 12, h + 12);
    ctx.drawImage(inp.terrainTex, x, y, w, h);
    const waterY = y + inp.state.turn.waterLevel / WORLD_HEIGHT * h;
    ctx.fillStyle = "rgba(60,150,210,.5)";
    ctx.fillRect(x, waterY, w, y + h - waterY);
    for (const worm of inp.state.worms) {
      if (!worm.alive) continue;
      ctx.fillStyle = teamColor(worm.team);
      ctx.beginPath();
      ctx.arc(x + worm.x / WORLD_WIDTH * w, y + worm.y / WORLD_HEIGHT * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const view = inp.camera.viewRect();
    ctx.strokeStyle = "rgba(255,255,255,.65)";
    ctx.strokeRect(x + view.x / WORLD_WIDTH * w, y + view.y / WORLD_HEIGHT * h,
      view.w / WORLD_WIDTH * w, view.h / WORLD_HEIGHT * h);
  }
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(8,15,25,.72)";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
}

export { TEAM_COLORS };
