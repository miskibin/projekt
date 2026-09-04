import {
  TEAM_COLORS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  WORM_MAX_HP,
  WORM_RADIUS,
} from "@shared/constants";
import type { CrateSnapshot, MineSnapshot, ProjectileSnapshot, WeaponId, WormSnapshot } from "@shared/protocol";
import type { Camera } from "./camera";
import type { Particles } from "./particles";
import type { RenderState } from "./state";
import type { ThemeId, ThemePalette } from "./terrainRenderer";
import { THEMES } from "./terrainRenderer";
import { Background } from "./background";
import { PostProcess } from "./postprocess";
import { TARGETED } from "./weapons";
import {
  darken,
  drawWormCharacter,
  lighten,
  roundRect,
  WormAnimator,
  WormSkins,
  WORM_RY,
  type AnimThreat,
} from "./wormRenderer";

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

const teamColor = (t: number): string => TEAM_COLORS[((t % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length];

const DEFAULT_PREVIEW_POWER = 0.6;

/** Rysowanie świata gry: tło, teren, woda, encje, celownik. */
export class Renderer {
  private background: Background;
  private readonly postProcess = new PostProcess();
  /** stan animacji postaci (per robak) */
  private readonly animator = new WormAnimator();
  /** cache barw/gradientów per kolor drużyny */
  private readonly skins = new WormSkins();
  /** `RenderInput` ma `time`, nie `dt` – liczymy różnicę sami */
  private lastTime = -1;
  /** bufor zagrożeń (pociski + tykające miny) – bez alokacji co klatkę */
  private readonly threats: AnimThreat[] = [];
  private theme: ThemeId = "grass";
  /** ostatnio użyta moc – do długości celownika zanim gracz zacznie ładować */
  private lastPower = DEFAULT_PREVIEW_POWER;

  constructor(seed = 1) {
    this.background = new Background(seed);
  }

  regen(seed: number): void {
    this.background.regen(seed);
    this.animator.reset();
    this.lastTime = -1;
    this.postProcess.clear();
  }

  // --- zdarzenia gry -> reakcje postaci (wołane z client.ts) ---
  onDamage(wormId: number, amount: number): void {
    this.animator.onDamage(wormId, amount);
  }

  onShot(wormId: number): void {
    this.animator.onShot(wormId);
  }

  onKill(wormId: number): void {
    this.animator.onKill(wormId);
  }

  onPickup(wormId: number): void {
    this.animator.onPickup(wormId);
  }

  onTurnStart(team: number): void {
    this.animator.onTurnStart(team);
  }

  onExplosion(radius: number, power: number): void {
    this.postProcess.triggerImpact(Math.min(1, radius / 75 + power / 900));
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
    const dt = this.lastTime < 0 ? 1 / 60 : Math.max(0, Math.min(0.05, inp.time - this.lastTime));
    this.lastTime = inp.time;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    this.background.draw(ctx, { camera, palette: pal, time: inp.time, width: W, height: H });

    ctx.save();
    camera.apply(ctx);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(inp.terrainTex, 0, 0);

    this.updateAnimator(inp, dt);
    this.drawGraves(ctx, inp);
    this.drawMines(ctx, inp.state.mines, inp.time);
    this.drawCrates(ctx, inp.state.crates, inp.time);
    this.drawWorms(ctx, inp);
    this.drawProjectiles(ctx, inp);
    inp.particles.draw(ctx, camera.zoom);
    this.drawAim(ctx, inp);
    this.drawWater(ctx, inp, pal);

    ctx.restore();
    this.postProcess.draw(ctx, W, H, dt);
    ctx.restore();
  }

  // ---------------- woda ----------------
  private drawWater(ctx: CanvasRenderingContext2D, inp: RenderInput, pal: ThemePalette): void {
    const level = inp.waterLevel;
    if (level >= WORLD_HEIGHT + 40) return;
    const t = inp.time;
    const view = inp.camera.viewRect();
    // Woda ciągnie się poza krawędź terenu, gdy kamera prowadzi robaka przy skraju mapy.
    const x0 = view.x - 60;
    const x1 = view.x + view.w + 60;
    if (x1 <= x0) return;
    const bottom = Math.max(WORLD_HEIGHT + 200, view.y + view.h + 120);
    const step = 16;

    // 1) tafla – gradient głębi
    const g = ctx.createLinearGradient(0, level - 8, 0, Math.min(bottom, level + 320));
    g.addColorStop(0, pal.water);
    g.addColorStop(1, pal.waterDeep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, waveA(x0, t, level));
    for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, waveA(x, t, level));
    ctx.lineTo(x1, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();

    // 2) druga, przesunięta warstwa fal (translucentna) – daje wrażenie ruchu
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = pal.water;
    ctx.beginPath();
    ctx.moveTo(x0, waveB(x0, t, level));
    for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, waveB(x, t, level));
    ctx.lineTo(x1, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 3) refleksy: krótkie jasne kreski tuż pod powierzchnią
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    const first = Math.ceil(x0 / 90) * 90;
    for (let x = first; x <= x1; x += 90) {
      const ph = Math.sin(x * 0.011 + t * 0.9);
      const y = waveA(x, t, level) + 7 + ph * 3;
      const len = 16 + ph * 10;
      ctx.moveTo(x - len / 2, y);
      ctx.lineTo(x + len / 2, y);
    }
    ctx.stroke();
    ctx.restore();

    // 4) piana na grzbiecie
    ctx.strokeStyle = pal.waterFoam;
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x0, waveA(x0, t, level));
    for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, waveA(x, t, level));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------- robaki ----------------

  /** Krok maszyny stanów animacji: raz na klatkę, przed rysowaniem robaków. */
  private updateAnimator(inp: RenderInput, dt: number): void {
    // zagrożenia w pobliżu (reakcja "strach"): lecące pociski i tykające miny
    this.threats.length = 0;
    for (const p of inp.state.projectiles) this.threats.push(p);
    for (const m of inp.state.mines) {
      if (m.fuse !== undefined && m.fuse > 0) this.threats.push(m);
    }

    const turn = inp.state.turn;
    this.animator.update(dt, {
      worms: inp.state.worms,
      threats: this.threats,
      activeWormId: turn.activeWormId,
      activeTeam: turn.activeTeam,
      phase: turn.phase,
      charge: inp.myTurn ? inp.localCharge : turn.chargePower,
    });
  }

  private drawWorms(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const active = inp.state.turn.activeWormId;
    for (const w of inp.state.worms) {
      // martwe rysujemy jeszcze przez chwilę – krótkie zgniecenie przed grobem
      if (!w.alive) {
        const pose = this.animator.pose(w.id);
        if (!pose || pose.state !== "dead" || pose.alpha <= 0.02) continue;
      }
      this.drawWorm(ctx, w, inp, w.id === active);
    }
  }

  private drawWorm(ctx: CanvasRenderingContext2D, w: WormSnapshot, inp: RenderInput, isActive: boolean): void {
    const pose = this.animator.pose(w.id);
    if (!pose) return;
    const col = teamColor(w.team);
    const skin = this.skins.get(ctx, col);
    const ry = WORM_RY;
    const jet = w.anim === "jetpack";

    // cień na podłożu (nie skaluje się razem z ciałem)
    ctx.globalAlpha = 0.26 * pose.alpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(w.x, w.y + ry + 1, 8.4, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (jet) inp.particles.jetFlame(w.x + (Math.random() - 0.5) * 6, w.y + ry);

    // broń w rękach tylko dla aktywnego robaka; lokalny wybór ma pierwszeństwo
    const weapon: WeaponId | null = isActive ? (inp.myTurn ? inp.weapon : inp.state.turn.selectedWeapon) : null;
    // lokalne celowanie jest bardziej responsywne niż `aim` ze snapshotu
    if (isActive && inp.myTurn && pose.hold !== null) {
      pose.hold = inp.aimPitch;
      pose.pupilX = Math.cos(inp.aimPitch) * w.facing;
      pose.pupilY = Math.sin(inp.aimPitch);
    }

    ctx.save();
    ctx.translate(w.x, w.y);
    drawWormCharacter(ctx, pose, {
      skin,
      facing: w.facing,
      weapon,
      hp: w.hp,
      time: inp.time,
      jetpack: jet,
      bat: w.anim === "bat",
    });
    ctx.restore();

    if (!w.alive) return;

    // ------- etykieta: nazwa + pastylka HP (stały rozmiar na ekranie) -------
    const t = inp.time;
    const s = 1 / inp.camera.zoom;
    ctx.save();
    ctx.translate(w.x, w.y - ry - 14);
    ctx.scale(s, s);
    const barW = 56;
    const hp = Math.max(0, Math.min(1, w.hp / WORM_MAX_HP));
    ctx.textAlign = "center";
    ctx.lineJoin = "round";

    ctx.font = "800 14px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(6,10,16,0.85)";
    ctx.strokeText(w.name, 0, -15);
    ctx.fillStyle = col;
    ctx.fillText(w.name, 0, -15);

    // tło pastylki
    ctx.fillStyle = "rgba(8,12,18,0.55)";
    roundRect(ctx, -barW / 2, -12, barW, 12, 6);
    ctx.fill();
    if (hp > 0) {
      ctx.fillStyle = hp > 0.35 ? col : hp > 0.18 ? "#ffb020" : "#ff4d4d";
      const fw = Math.max(6, barW * hp);
      roundRect(ctx, -barW / 2, -12, fw, 12, 6);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, -barW / 2, -12, barW, 12, 6);
    ctx.stroke();

    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "rgba(6,10,16,0.55)";
    const hpTxt = String(Math.max(0, Math.round(w.hp)));
    ctx.strokeText(hpTxt, 0, -5.8);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(hpTxt, 0, -5.8);
    ctx.restore();

    // ------- strzałka nad aktywnym robakiem -------
    if (isActive) {
      const bounce = Math.abs(Math.sin(t * 3.2)) * 4;
      // pozycja w skali ekranu, żeby strzałka trzymała się etykiety przy każdym zoomie
      ctx.save();
      ctx.translate(w.x, w.y - ry - 12 - (30 + bounce) * s);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, 11);
      ctx.lineTo(-8.5, -1.5);
      ctx.lineTo(-3.4, -1.5);
      ctx.lineTo(-3.4, -11);
      ctx.lineTo(3.4, -11);
      ctx.lineTo(3.4, -1.5);
      ctx.lineTo(8.5, -1.5);
      ctx.closePath();
      const ag = ctx.createLinearGradient(0, -11, 0, 11);
      ag.addColorStop(0, lighten(col, 0.5));
      ag.addColorStop(1, col);
      ctx.fillStyle = ag;
      ctx.fill();
      ctx.strokeStyle = "rgba(6,10,16,0.7)";
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.stroke();
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

    if (inp.localCharge > 0.005) this.lastPower = inp.localCharge;
    const power = inp.localCharge > 0.005 ? inp.localCharge : this.lastPower;

    const mx = worm.x + dirX * (WORM_RADIUS + 3);
    const my = worm.y + dirY * (WORM_RADIUS + 3);

    // Celownik pokazuje tylko kierunek i przybliżoną siłę. Nie symuluje pełnego toru
    // ani nie zdradza punktu uderzenia; wiatr, grawitację i teren trzeba ocenić samemu.
    const guideLength = (55 + power * 45) * s;
    const endX = mx + dirX * guideLength;
    const endY = my + dirY * guideLength;
    if (!TARGETED.has(inp.weapon)) this.dottedLine(ctx, mx, my, endX, endY, s);

    if (!TARGETED.has(inp.weapon)) this.crosshair(ctx, endX, endY, s, inp.time);

    // wskaźnik naładowania: pierścień wokół robaka
    if (inp.localCharge > 0.001) this.chargeGauge(ctx, worm.x, worm.y, inp.localCharge, s);
  }

  private dottedLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, s: number): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([5 * s, 8 * s]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = "rgba(10,16,26,0.35)";
    ctx.lineWidth = 5 * s;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 3 * s;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Czerwony celownik: okrąg + 4 kreski (stały rozmiar na ekranie). */
  private crosshair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number): void {
    const pulse = 1 + Math.sin(time * 5) * 0.06;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * pulse, s * pulse);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.moveTo(-17, 0); ctx.lineTo(-7, 0);
    ctx.moveTo(7, 0); ctx.lineTo(17, 0);
    ctx.moveTo(0, -17); ctx.lineTo(0, -7);
    ctx.moveTo(0, 7); ctx.lineTo(0, 17);
    ctx.strokeStyle = "rgba(10,16,26,0.4)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3b30";
    ctx.fill();
    ctx.restore();
  }

  /** Pierścieniowy wskaźnik siły strzału wokół robaka. */
  private chargeGauge(ctx: CanvasRenderingContext2D, x: number, y: number, power: number, s: number): void {
    const p = Math.max(0, Math.min(1, power));
    // promień w świecie: nigdy nie wchodzi na robaka, ale grubość linii stała na ekranie
    const r = Math.max(WORM_RADIUS + 9, 19 * s);
    const start = -Math.PI / 2 - Math.PI * 0.82;
    const sweep = Math.PI * 1.64;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(8,14,22,0.5)";
    ctx.lineWidth = 5.5 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r, start, start + sweep);
    ctx.stroke();
    ctx.strokeStyle = p < 0.55 ? "#8fea57" : p < 0.8 ? "#ffd24d" : "#ff5d46";
    ctx.lineWidth = 3.4 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r, start, start + sweep * p);
    ctx.stroke();

    ctx.translate(0, r + 10 * s);
    ctx.scale(s, s);
    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(7,17,28,0.85)";
    const txt = `${Math.round(p * 100)}%`;
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, 0, 0);
    ctx.restore();
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
        const homing = p.kind === "homing";
        inp.particles.smokeTrail(
          p.x - Math.cos(ang) * 8,
          p.y - Math.sin(ang) * 8,
          homing ? 1.3 : 0.9,
          homing ? "rgba(83,220,255,0.9)" : "rgba(150,150,145,0.9)",
        );
        ctx.rotate(ang);
        if (homing) ctx.scale(1.2, 1.08);
        // płomień silnika (bez gradientu – dwa okręgi addytywnie)
        const flick = 0.75 + Math.sin(inp.time * 40 + p.id) * 0.25;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = p.kind === "homing" ? "rgba(40,218,255,0.42)" : "rgba(255,140,30,0.35)";
        ctx.beginPath();
        ctx.ellipse(-13 - flick * 3, 0, 8 + flick * 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.kind === "homing" ? "rgba(215,250,255,0.78)" : "rgba(255,230,150,0.65)";
        ctx.beginPath();
        ctx.ellipse(-10.5, 0, 4 + flick * 1.6, 2.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // stateczniki
        ctx.fillStyle = p.kind === "homing" ? "#ecf6ff" : "#8b8e68";
        ctx.beginPath();
        ctx.moveTo(-6, -3);
        ctx.lineTo(-12, -6.5);
        ctx.lineTo(-10, 0);
        ctx.lineTo(-12, 6.5);
        ctx.lineTo(-6, 3);
        ctx.closePath();
        ctx.fill();
        // korpus
        const bodyG = ctx.createLinearGradient(0, -4, 0, 4);
        const base = p.kind === "homing" ? "#d82f49" : "#687343";
        bodyG.addColorStop(0, lighten(base, 0.4));
        bodyG.addColorStop(0.5, base);
        bodyG.addColorStop(1, darken(base, 0.4));
        ctx.fillStyle = bodyG;
        roundRect(ctx, -9, -3.6, 18, 7.2, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(12,16,24,0.55)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        // pasek
        ctx.fillStyle = p.kind === "homing" ? "rgba(235,250,255,0.92)" : "rgba(241,225,158,0.42)";
        ctx.fillRect(p.kind === "homing" ? -3 : -2, -3.4, p.kind === "homing" ? 4 : 2.4, 6.8);
        // głowica
        ctx.fillStyle = p.kind === "homing" ? "#6ceaff" : "#a74a2f";
        ctx.beginPath();
        ctx.moveTo(8.4, -3.6);
        ctx.quadraticCurveTo(15.5, 0, 8.4, 3.6);
        ctx.closePath();
        ctx.fill();
        if (p.kind === "homing") {
          const pulse = 5.5 + Math.sin(inp.time * 9 + p.id) * 1.3;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(105,235,255,0.85)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(11, 0, pulse, -0.75, 0.75);
          ctx.stroke();
          ctx.fillStyle = "#e9fdff";
          ctx.beginPath();
          ctx.arc(11.2, 0, 1.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.ellipse(10, -1.4, 2.2, 0.7, -0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "grenade":
      case "cluster": {
        ctx.rotate(ang * 0.4 + inp.time * 4);
        if (p.kind === "cluster") {
          const g = ctx.createLinearGradient(-7, -7, 7, 7);
          g.addColorStop(0, "#73f2dc");
          g.addColorStop(0.48, "#177e91");
          g.addColorStop(1, "#153f69");
          ctx.fillStyle = g;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3 - Math.PI / 6;
            const px = Math.cos(a) * 7.2;
            const py = Math.sin(a) * 7.2;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#b9fff0";
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.fillStyle = "#ffe75e";
          ctx.fillRect(-6.2, -1.3, 12.4, 2.6);
          ctx.fillStyle = Math.sin(inp.time * 12 + p.id) > 0 ? "#fff" : "#32ffc8";
          ctx.beginPath();
          ctx.arc(0, 3.8, 1.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(-2, -2.5, 0.5, 0, 0, 7.5);
          g.addColorStop(0, "#8fc36a");
          g.addColorStop(1, "#31582a");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#1e3a24";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-5, -1.5); ctx.lineTo(5, -1.5);
          ctx.moveTo(-5, 2); ctx.lineTo(5, 2);
          ctx.moveTo(-1.7, -5.5); ctx.lineTo(-1.7, 5.5);
          ctx.moveTo(2, -5.5); ctx.lineTo(2, 5.5);
          ctx.stroke();
        }
        ctx.fillStyle = "#9aa0a8";
        roundRect(ctx, -1.7, -9, 3.4, 4, 1);
        ctx.fill();
        ctx.strokeStyle = "#c9ced6";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(2.6, -7.2, 2.1, -1.2, 2.2);
        ctx.stroke();
        break;
      }
      case "clusterlet":
      case "bananalet": {
        if (p.kind === "bananalet") {
          inp.particles.sparks(p.x, p.y, 1, "#fff04d");
          ctx.rotate(ang + inp.time * 6 + p.id);
          ctx.strokeStyle = "#b98112";
          ctx.lineWidth = 4.2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(0, 0, 5.4, 0.5, Math.PI - 0.5);
          ctx.stroke();
          ctx.strokeStyle = "#ffeb4f";
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(0, -0.5, 5.4, 0.58, Math.PI - 0.58);
          ctx.stroke();
        } else {
          inp.particles.sparks(p.x, p.y, 1, "#69ffe0");
          ctx.fillStyle = "#2bbd9d";
          ctx.beginPath();
          ctx.arc(0, 0, 4.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#d9fff7";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.beginPath();
          ctx.arc(-1, -1.2, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "banana": {
        ctx.rotate(ang + inp.time * 3);
        ctx.strokeStyle = "#e0b52a";
        ctx.lineWidth = 5.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0.5, Math.PI - 0.5);
        ctx.stroke();
        ctx.strokeStyle = "#ffe45c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -0.6, 7, 0.6, Math.PI - 0.6);
        ctx.stroke();
        break;
      }
      case "holy": {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,220,120,0.18)";
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,244,190,0.32)";
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const bg = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8);
        bg.addColorStop(0, "#fff8d6");
        bg.addColorStop(1, "#e0a91f");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8a6a12";
        ctx.fillRect(-0.9, -4.5, 1.8, 8);
        ctx.fillRect(-3, -1.6, 6, 1.8);
        ctx.strokeStyle = "rgba(255,248,200,0.95)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(0, -10, 8, 2.6, Math.sin(inp.time * 2) * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "dynamite": {
        const dg = ctx.createLinearGradient(-5, 0, 5, 0);
        dg.addColorStop(0, "#a92a20");
        dg.addColorStop(0.5, "#e04a3a");
        dg.addColorStop(1, "#a92a20");
        ctx.fillStyle = dg;
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.fill();
        ctx.fillStyle = "#f2e2c2";
        ctx.fillRect(-5, -2.5, 10, 3.4);
        ctx.strokeStyle = "rgba(20,10,8,0.5)";
        ctx.lineWidth = 0.8;
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.stroke();
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
        roundRect(ctx, -5, -4, 10, 8, 3);
        ctx.fill();
        break;
      }
      case "airstrikeBomb": {
        inp.particles.smokeTrail(p.x, p.y - 6, 0.7, "rgba(90,76,78,0.82)");
        ctx.rotate(ang + Math.PI / 2);
        const bgr = ctx.createLinearGradient(-4, 0, 4, 0);
        bgr.addColorStop(0, "#2d333d");
        bgr.addColorStop(0.5, "#59616f");
        bgr.addColorStop(1, "#2d333d");
        ctx.fillStyle = bgr;
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
        const len = Math.min(18, Math.hypot(p.vx, p.vy) * 0.02 + 7);
        ctx.rotate(ang);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(255,210,120,0.35)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,245,210,0.95)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-len * 0.7, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        ctx.restore();
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
      ctx.lineJoin = "round";
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
      if (!c.landed) this.drawParachute(ctx, time, c.id);

      // cień pod skrzynką
      if (c.landed) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(0, 10.5, 11, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (c.kind === "weapon") this.drawBarrel(ctx);
      else this.drawBoxCrate(ctx, c.kind === "health");

      // delikatna poświata (2 okręgi zamiast gradientu)
      const pulse = 0.06 + 0.04 * Math.sin(time * 3 + c.id);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,246,214,${pulse.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  /** Żółta beczka z symbolem ostrzegawczym (skrzynka z bronią). */
  private drawBarrel(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(-9, 0, 9, 0);
    g.addColorStop(0, "#b9790a");
    g.addColorStop(0.35, "#f2c032");
    g.addColorStop(0.62, "#ffdd6a");
    g.addColorStop(1, "#a86c07");
    ctx.fillStyle = g;
    roundRect(ctx, -9, -11, 18, 22, 3);
    ctx.fill();
    // obręcze
    ctx.fillStyle = "rgba(90,58,6,0.55)";
    ctx.fillRect(-9, -6.5, 18, 2.2);
    ctx.fillRect(-9, 4.4, 18, 2.2);
    // pokrywa
    ctx.fillStyle = "#ffe58a";
    ctx.beginPath();
    ctx.ellipse(0, -11, 9, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(70,45,4,0.7)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, -11, 9, 2.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    roundRect(ctx, -9, -11, 18, 22, 3);
    ctx.stroke();
    // symbol: ciemny romb z trójłopatkowym znakiem
    ctx.save();
    ctx.translate(0, 0.2);
    ctx.fillStyle = "rgba(30,22,6,0.85)";
    ctx.beginPath();
    ctx.moveTo(0, -5.4);
    ctx.lineTo(5.4, 0);
    ctx.lineTo(0, 5.4);
    ctx.lineTo(-5.4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd964";
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 3.3, a - 0.42, a + 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(30,22,6,0.85)";
    ctx.beginPath();
    ctx.arc(0, 0, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Skrzynka: czerwona z krzyżem (apteczka) lub niebieska z narzędziem. */
  private drawBoxCrate(ctx: CanvasRenderingContext2D, health: boolean): void {
    const base = health ? "#d1352c" : "#3767c8";
    const g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, lighten(base, 0.32));
    g.addColorStop(0.55, base);
    g.addColorStop(1, darken(base, 0.34));
    ctx.fillStyle = g;
    roundRect(ctx, -10, -10, 20, 20, 3.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    roundRect(ctx, -10, -10, 20, 6, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(6,10,16,0.55)";
    ctx.lineWidth = 1.3;
    roundRect(ctx, -10, -10, 20, 20, 3.5);
    ctx.stroke();

    if (health) {
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, -2, -6.5, 4, 13, 1.2);
      ctx.fill();
      roundRect(ctx, -6.5, -2, 13, 4, 1.2);
      ctx.fill();
    } else {
      // klucz płaski
      ctx.strokeStyle = "#eef3ff";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-4.2, 4.6);
      ctx.lineTo(2.6, -2.2);
      ctx.stroke();
      ctx.fillStyle = "#eef3ff";
      ctx.beginPath();
      ctx.arc(4, -3.6, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(5.1, -4.8, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawParachute(ctx: CanvasRenderingContext2D, time: number, id: number): void {
    const sway = Math.sin(time * 2 + id) * 0.13;
    ctx.save();
    ctx.rotate(sway);
    // czasza w pasy
    ctx.fillStyle = "#eee7da";
    ctx.beginPath();
    ctx.moveTo(-21, -22);
    ctx.quadraticCurveTo(0, -48, 21, -22);
    ctx.quadraticCurveTo(10.5, -17, 0, -22);
    ctx.quadraticCurveTo(-10.5, -17, -21, -22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#cf5d4a";
    ctx.beginPath();
    ctx.moveTo(-7.5, -30.5);
    ctx.quadraticCurveTo(0, -48, 7.5, -30.5);
    ctx.quadraticCurveTo(3.6, -25.5, 0, -22);
    ctx.quadraticCurveTo(-3.6, -25.5, -7.5, -30.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(90,72,60,0.45)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-21, -22);
    ctx.quadraticCurveTo(0, -48, 21, -22);
    ctx.stroke();
    // linki
    ctx.strokeStyle = "rgba(238,231,218,0.95)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-21, -22); ctx.lineTo(-6, -9);
    ctx.moveTo(21, -22); ctx.lineTo(6, -9);
    ctx.moveTo(-7.5, -26); ctx.lineTo(-2, -9);
    ctx.moveTo(7.5, -26); ctx.lineTo(2, -9);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- miny ----------------
  private drawMines(ctx: CanvasRenderingContext2D, mines: MineSnapshot[], time: number): void {
    for (const m of mines) {
      ctx.save();
      ctx.translate(m.x, m.y);

      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(0, 6, 7, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // nóżki
      ctx.strokeStyle = "#454b56";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-3.5, 3.5); ctx.lineTo(-5.5, 6.4);
      ctx.moveTo(3.5, 3.5); ctx.lineTo(5.5, 6.4);
      ctx.stroke();

      // korpus
      const g = ctx.createLinearGradient(0, -6, 0, 5);
      g.addColorStop(0, "#a9b1bd");
      g.addColorStop(0.5, "#787f8b");
      g.addColorStop(1, "#4d545f");
      ctx.fillStyle = g;
      roundRect(ctx, -6.5, -5.5, 13, 10.5, 3.4);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,24,30,0.6)";
      ctx.lineWidth = 1;
      roundRect(ctx, -6.5, -5.5, 13, 10.5, 3.4);
      ctx.stroke();
      ctx.fillStyle = "rgba(24,28,34,0.45)";
      ctx.fillRect(-6.5, -0.6, 13, 1.6);

      const fast = m.fuse !== undefined && m.fuse > 0;
      const blink = fast ? Math.sin(time * 26) > -0.2 : m.armed ? Math.sin(time * 5) > 0.2 : false;
      // dioda
      ctx.fillStyle = blink ? "#ff3b30" : "#5a1e1c";
      ctx.beginPath();
      ctx.arc(0, -3.2, 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (blink) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,60,50,0.28)";
        ctx.beginPath();
        ctx.arc(0, -3.2, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,150,140,0.35)";
        ctx.beginPath();
        ctx.arc(0, -3.2, 3.4, 0, Math.PI * 2);
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
      // cień
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(0, 11, 10, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const sg = ctx.createLinearGradient(-7, 0, 7, 0);
      sg.addColorStop(0, "#98a1ae");
      sg.addColorStop(0.45, "#7b8492");
      sg.addColorStop(1, "#5c6470");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-7, 10);
      ctx.lineTo(-7, -4);
      ctx.arc(0, -4, 7, Math.PI, 0);
      ctx.lineTo(7, 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(30,36,44,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#4f5763";
      roundRect(ctx, -9.5, 8, 19, 4.5, 1.5);
      ctx.fill();

      // wyryty krzyż
      ctx.strokeStyle = "#4a515c";
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -8.5); ctx.lineTo(0, 3.5);
      ctx.moveTo(-4, -4.5); ctx.lineTo(4, -4.5);
      ctx.stroke();
      // barwa drużyny
      ctx.fillStyle = teamColor(g.team);
      ctx.globalAlpha = 0.85;
      roundRect(ctx, -5, 4.6, 10, 2.4, 1.2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
}

// ---------------- pomocnicze ----------------

function waveA(x: number, t: number, level: number): number {
  return level + Math.sin(x * 0.02 + t * 1.9) * 4 + Math.sin(x * 0.05 - t * 2.7) * 2.2;
}

function waveB(x: number, t: number, level: number): number {
  return level + 3 + Math.sin(x * 0.017 - t * 1.35) * 5 + Math.sin(x * 0.041 + t * 2.1) * 2;
}

export { darken, hexToRgb, lighten, roundRect } from "./wormRenderer";

export { teamColor };
