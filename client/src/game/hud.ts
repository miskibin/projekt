import { MAX_WIND, TEAM_COLORS, TEAM_NAMES, WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import type { WeaponId } from "@shared/protocol";
import type { Camera } from "./camera";
import type { RenderState } from "./state";
import { roundRect, teamColor } from "./renderer";
import { drawWeaponIcon, TIMED, WEAPON_NAMES } from "./weapons";

interface Banner {
  text: string;
  life: number;
  max: number;
}

interface KillFeedItem {
  text: string;
  color: string;
  life: number;
}

export interface HudInput {
  state: RenderState;
  camera: Camera;
  terrainTex: HTMLCanvasElement;
  myTeam: number;
  rtt: number;
  time: number;
  weapon: WeaponId;
  demo: boolean;
}

const FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Interfejs gracza rysowany na canvasie nad sceną. */
export class Hud {
  private banners: Banner[] = [];
  private feed: KillFeedItem[] = [];
  private wbW = 210;
  private mmW = 210;

  banner(text: string, seconds = 2.6): void {
    this.banners.push({ text, life: 0, max: seconds });
    if (this.banners.length > 3) this.banners.shift();
  }

  kill(text: string, color = "#e7ecf5"): void {
    this.feed.unshift({ text, color, life: 0 });
    if (this.feed.length > 6) this.feed.pop();
  }

  clear(): void {
    this.banners.length = 0;
    this.feed.length = 0;
  }

  update(dt: number): void {
    for (let i = this.banners.length - 1; i >= 0; i--) {
      this.banners[i].life += dt;
      if (this.banners[i].life >= this.banners[i].max) this.banners.splice(i, 1);
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].life += dt;
      if (this.feed[i].life > 7) this.feed.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, inp: HudInput): void {
    const W = inp.camera.viewW;
    const H = inp.camera.viewH;
    const st = inp.state;
    const turn = st.turn;

    // układ zależny od szerokości okna – na wąskich ekranach panele się kurczą
    this.wbW = W < 1050 ? 158 : 210;
    this.mmW = W < 1050 ? 150 : 210;

    ctx.save();
    ctx.textBaseline = "middle";

    this.drawTopBar(ctx, inp, W);
    this.drawTeams(ctx, inp, W, H);
    this.drawWeaponBox(ctx, inp, H);
    this.drawMinimap(ctx, inp, W, H);
    this.drawTurnInfo(ctx, inp, W, H);
    this.drawFeed(ctx, inp, W);
    this.drawBanners(ctx, inp, W, H);

    // RTT
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillStyle = inp.demo ? "#ffd24d" : inp.rtt > 160 ? "#ff9a93" : "#7f8ea8";
    ctx.fillText(inp.demo ? "TRYB DEMO" : `${inp.rtt} ms`, W - 14, H - 12);

    void turn;
    ctx.restore();
  }

  // ---- górny pasek: runda, timer, wiatr ----
  private drawTopBar(ctx: CanvasRenderingContext2D, inp: HudInput, W: number): void {
    const t = inp.state.turn;
    const cx = W / 2;

    panel(ctx, cx - 132, 10, 264, 58, 14);

    // timer
    const secs = Math.max(0, Math.ceil(t.timeLeft));
    const urgent = secs <= 10 && t.phase === "active";
    ctx.textAlign = "center";
    ctx.font = `800 34px ${FONT}`;
    if (urgent) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(inp.time * 6));
      ctx.fillStyle = `rgba(255,77,77,${pulse})`;
      ctx.shadowColor = "rgba(255,60,60,0.8)";
      ctx.shadowBlur = 16;
    } else {
      ctx.fillStyle = "#eef3fb";
    }
    ctx.fillText(String(secs).padStart(2, "0"), cx, 33);
    ctx.shadowBlur = 0;

    // runda + sudden death
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = "#93a0b8";
    ctx.fillText(`RUNDA ${t.round}`, cx - 92, 26);
    if (t.suddenDeath) {
      const a = 0.6 + 0.4 * Math.sin(inp.time * 4);
      ctx.fillStyle = `rgba(255,90,60,${a})`;
      roundRect(ctx, cx - 126, 36, 68, 18, 9);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `800 10px ${FONT}`;
      ctx.fillText("SUDDEN DEATH", cx - 92, 45);
    }

    // wiatr
    const wx = cx + 58;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = "#93a0b8";
    ctx.fillText("WIATR", wx, 24);
    const bw = 100;
    const bx = wx - bw / 2;
    const by = 38;
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    roundRect(ctx, bx, by, bw, 12, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(wx - 0.75, by, 1.5, 12);
    const f = Math.max(-1, Math.min(1, t.wind / MAX_WIND));
    const len = (bw / 2) * Math.abs(f);
    if (len > 1) {
      const g = ctx.createLinearGradient(wx, 0, wx + Math.sign(f) * (bw / 2), 0);
      g.addColorStop(0, "rgba(120,200,255,0.55)");
      g.addColorStop(1, "#56b6ff");
      ctx.fillStyle = g;
      roundRect(ctx, f > 0 ? wx : wx - len, by + 2, len, 8, 4);
      ctx.fill();
      // strzałki
      ctx.strokeStyle = "#bfe4ff";
      ctx.lineWidth = 1.6;
      const n = Math.max(1, Math.round(Math.abs(f) * 4));
      for (let i = 0; i < n; i++) {
        const px = wx + Math.sign(f) * (10 + i * 11);
        ctx.beginPath();
        ctx.moveTo(px - Math.sign(f) * 3, by + 2.5);
        ctx.lineTo(px, by + 6);
        ctx.lineTo(px - Math.sign(f) * 3, by + 9.5);
        ctx.stroke();
      }
    }
  }

  // ---- pasek drużyn na dole ----
  private drawTeams(ctx: CanvasRenderingContext2D, inp: HudInput, W: number, H: number): void {
    const teams = inp.state.teams;
    if (teams.length === 0) return;
    const gap = 8;
    // pas między panelem broni a minimapą
    const bandL = 14 + this.wbW + 10;
    const bandR = W - this.mmW - 24 - 10;
    const band = Math.max(240, bandR - bandL);
    const cw = Math.max(94, Math.min(168, (band - gap * (teams.length - 1)) / teams.length));
    const total = teams.length * cw + (teams.length - 1) * gap;
    let x = bandL + (band - total) / 2;
    if (total > band) x = Math.max(8, (W - total) / 2);
    const y = H - 62;
    const active = inp.state.turn.activeTeam;

    for (const t of teams) {
      const col = teamColor(t.team);
      const isActive = t.team === active;
      panel(ctx, x, y, cw, 50, 12, isActive ? 0.82 : 0.55);
      if (isActive) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        roundRect(ctx, x + 0.5, y + 0.5, cw - 1, 49, 12);
        ctx.stroke();
      }
      // kolor drużyny
      ctx.fillStyle = col;
      roundRect(ctx, x + 9, y + 11, 6, 28, 3);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.font = `700 12.5px ${FONT}`;
      ctx.fillStyle = t.team === inp.myTeam ? "#ffffff" : "#dbe3f0";
      const label = t.name || TEAM_NAMES[t.team % TEAM_NAMES.length];
      ctx.fillText(clip(ctx, label, cw - 60), x + 22, y + 16);
      if (t.team === inp.myTeam) {
        ctx.font = `800 9px ${FONT}`;
        ctx.fillStyle = "#7ee787";
        ctx.textAlign = "right";
        ctx.fillText("TY", x + cw - 12, y + 16);
        ctx.textAlign = "left";
      }

      // pasek sumy HP
      const maxHp = 100 * Math.max(1, inp.state.worms.filter((w) => w.team === t.team).length || t.alive || 1);
      const frac = Math.max(0, Math.min(1, t.totalHp / maxHp));
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      roundRect(ctx, x + 22, y + 25, cw - 34, 9, 4.5);
      ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, x + 22, y + 25, (cw - 34) * frac, 9, 4.5);
      ctx.fill();

      ctx.font = `600 10.5px ${FONT}`;
      ctx.fillStyle = "#9fb0c8";
      ctx.fillText(`${Math.max(0, Math.round(t.totalHp))} HP`, x + 22, y + 42);
      // kropki = żywe robaki
      const dots = Math.min(8, Math.max(0, t.alive));
      for (let i = 0; i < dots; i++) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x + cw - 14 - i * 9, y + 41, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      x += cw + gap;
    }
  }

  // ---- wybrana broń ----
  private drawWeaponBox(ctx: CanvasRenderingContext2D, inp: HudInput, H: number): void {
    const x = 14;
    const y = H - 92;
    panel(ctx, x, y, this.wbW, 78, 14);
    ctx.save();
    ctx.translate(x + 36, y + 38);
    drawWeaponIcon(ctx, inp.weapon, 44);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = "#eef3fb";
    ctx.fillText(clip(ctx, WEAPON_NAMES[inp.weapon] ?? inp.weapon, this.wbW - 76), x + 66, y + 24);

    const my = inp.state.teams.find((t) => t.team === inp.myTeam);
    const ammo = my?.ammo?.[inp.weapon];
    ctx.font = `600 11.5px ${FONT}`;
    ctx.fillStyle = "#93a0b8";
    const ammoTxt = ammo === undefined ? "—" : ammo < 0 ? "∞" : String(ammo);
    const maxW = this.wbW - 76;
    ctx.fillText(clip(ctx, `Amunicja: ${ammoTxt}`, maxW), x + 66, y + 44);
    if (TIMED.has(inp.weapon)) {
      ctx.fillStyle = "#ffd24d";
      ctx.fillText(clip(ctx, `Zapalnik: ${inp.state.turn.weaponTimer || 3} s (1–5)`, maxW), x + 66, y + 62);
    } else if (inp.state.turn.shotsLeft > 1) {
      ctx.fillStyle = "#ffd24d";
      ctx.fillText(clip(ctx, `Strzały: ${inp.state.turn.shotsLeft}`, maxW), x + 66, y + 62);
    } else {
      ctx.fillStyle = "#67748c";
      ctx.fillText(clip(ctx, "Tab – zmiana broni", maxW), x + 66, y + 62);
    }
  }

  // ---- minimapa ----
  private drawMinimap(ctx: CanvasRenderingContext2D, inp: HudInput, W: number, H: number): void {
    const mw = this.mmW;
    const mh = Math.round((mw * WORLD_HEIGHT) / WORLD_WIDTH);
    const x = W - mw - 14;
    const y = H - mh - 30;
    panel(ctx, x - 5, y - 5, mw + 10, mh + 10, 10);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, mw, mh, 6);
    ctx.clip();
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(x, y, mw, mh);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(inp.terrainTex, x, y, mw, mh);
    ctx.globalAlpha = 1;

    // woda
    const wy = y + (inp.state.turn.waterLevel / WORLD_HEIGHT) * mh;
    ctx.fillStyle = "rgba(60,140,220,0.4)";
    ctx.fillRect(x, wy, mw, mh - (wy - y));

    const sx = mw / WORLD_WIDTH;
    const sy = mh / WORLD_HEIGHT;
    for (const c of inp.state.crates) {
      ctx.fillStyle = "#ffd24d";
      ctx.fillRect(x + c.x * sx - 1.5, y + c.y * sy - 1.5, 3, 3);
    }
    for (const w of inp.state.worms) {
      if (!w.alive) continue;
      const isActive = w.id === inp.state.turn.activeWormId;
      ctx.fillStyle = teamColor(w.team);
      ctx.beginPath();
      ctx.arc(x + w.x * sx, y + w.y * sy, isActive ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // ramka widoku
    const vr = inp.camera.viewRect();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + vr.x * sx, y + vr.y * sy, vr.w * sx, vr.h * sy);
    ctx.restore();
  }

  // ---- info o turze / fazie ----
  private drawTurnInfo(ctx: CanvasRenderingContext2D, inp: HudInput, W: number, H: number): void {
    const t = inp.state.turn;
    const mine = t.activeTeam === inp.myTeam;
    ctx.textAlign = "center";

    if (t.phase === "settling" || t.phase === "starting") {
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = "rgba(190,205,225,0.75)";
      ctx.fillText("Następna tura…", W / 2, 86);
      return;
    }
    if (t.phase === "suddenDeathRise") {
      ctx.font = `800 15px ${FONT}`;
      ctx.fillStyle = "#ff8a6a";
      ctx.fillText("Poziom wody rośnie!", W / 2, 86);
      return;
    }
    if (t.phase === "gameOver") return;

    if (!mine) {
      const team = inp.state.teams.find((x) => x.team === t.activeTeam);
      const name = team?.name || TEAM_NAMES[t.activeTeam % TEAM_NAMES.length];
      const col = teamColor(t.activeTeam);
      const label = `Tura przeciwnika: ${name}`;
      ctx.font = `700 14px ${FONT}`;
      const w = ctx.measureText(label).width + 34;
      panel(ctx, W / 2 - w / 2, 74, w, 28, 14, 0.7);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(W / 2 - w / 2 + 16, 88, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#dbe3f0";
      ctx.fillText(label, W / 2 + 8, 89);
    } else {
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = "rgba(126,231,135,0.9)";
      ctx.fillText("TWOJA TURA", W / 2, 86);
    }
    void H;
  }

  // ---- killfeed ----
  private drawFeed(ctx: CanvasRenderingContext2D, inp: HudInput, W: number): void {
    ctx.textAlign = "right";
    ctx.font = `600 12px ${FONT}`;
    let y = 84;
    for (const f of this.feed) {
      const a = f.life > 6 ? 1 - (f.life - 6) : 1;
      ctx.globalAlpha = Math.max(0, a);
      const w = ctx.measureText(f.text).width + 20;
      panel(ctx, W - 14 - w, y - 11, w, 22, 8, 0.55);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, W - 24, y);
      y += 26;
    }
    ctx.globalAlpha = 1;
  }

  // ---- bannery na środku ----
  private drawBanners(ctx: CanvasRenderingContext2D, inp: HudInput, W: number, H: number): void {
    let y = H * 0.28;
    ctx.textAlign = "center";
    for (const b of this.banners) {
      const k = b.life / b.max;
      const alpha = k < 0.12 ? k / 0.12 : k > 0.78 ? (1 - k) / 0.22 : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = `800 ${W < 900 ? 20 : 26}px ${FONT}`;
      const w = Math.min(W - 32, ctx.measureText(b.text).width + 52);
      panel(ctx, W / 2 - w / 2, y - 26, w, 52, 16, 0.78);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 8;
      ctx.fillText(b.text, W / 2, y + 1);
      ctx.shadowBlur = 0;
      y += 62;
    }
    ctx.globalAlpha = 1;
  }
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  alpha = 0.62,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(10,14,22,${alpha})`;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.restore();
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}


export { TEAM_COLORS };
