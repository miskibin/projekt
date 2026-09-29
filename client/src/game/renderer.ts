import {
  TEAM_COLORS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  WORM_MAX_HP,
  WORM_RADIUS,
  WORM_MUZZLE_OFFSET,
  WORM_MUZZLE_LIFT,
} from "@shared/constants";
import type { BarrelSnapshot, CrateSnapshot, MineSnapshot, ProjectileSnapshot, SpringSnapshot, TreeSnapshot, WeaponId, WormSnapshot } from "@shared/protocol";
import type { Camera } from "./camera";
import type { Particles } from "./particles";
import type { RenderState } from "./state";
import type { ThemeId, ThemePalette } from "./terrainRenderer";
import { THEMES } from "./terrainRenderer";
import { Background } from "./background";
import { PostProcess } from "./postprocess";
import {
  blit,
  CRATE_SCALE,
  crateSprite,
  FUEL_BARREL_SCALE,
  fuelBarrelSprite,
  MINE_SCALE,
  mineSprite,
  treeSprite,
} from "./sprites";
import { TARGETED } from "./weapons";
import {
  darken,
  drawWormCharacter,
  hatForWorm,
  INK,
  lighten,
  roundRect,
  WormAnimator,
  WORM_GROUND_OFFSET,
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
  selectedDefenseWormId?: number | null;
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
  private cosmeticSeed = 1;
  /** ostatnio użyta moc – do długości celownika zanim gracz zacznie ładować */
  private lastPower = DEFAULT_PREVIEW_POWER;
  /** Emisja smug zależna od czasu, a nie liczby klatek (120 Hz nie dubluje cząstek). */
  private readonly lastTrail = new Map<number, number>();
  private readonly lowPower = typeof matchMedia !== "undefined" && matchMedia("(any-pointer: coarse)").matches;

  constructor(seed = 1) {
    this.background = new Background(seed);
    this.cosmeticSeed = seed;
  }

  regen(seed: number): void {
    this.background.regen(seed);
    this.cosmeticSeed = seed;
    this.animator.reset();
    this.lastTime = -1;
    this.postProcess.clear();
    this.lastTrail.clear();
  }

  // --- zdarzenia gry -> reakcje postaci (wołane z client.ts) ---
  onDamage(wormId: number, amount: number): void {
    this.animator.onDamage(wormId, amount);
  }

  onWormsStartled(x: number, y: number, radius: number): void {
    this.animator.onExplosion(x, y, radius);
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
    ctx.imageSmoothingQuality = this.lowPower ? "medium" : "high";
    ctx.drawImage(inp.terrainTex, 0, 0);

    this.updateAnimator(inp, dt);
    this.drawGraves(ctx, inp);
    this.drawBarrels(ctx, inp.state.barrels ?? []);
    this.drawTrees(ctx, inp.state.trees ?? [], inp.theme);
    this.drawSprings(ctx, inp.state.springs ?? [], inp.myTeam);
    this.drawMines(ctx, inp.state.mines, inp.time);
    this.drawCrates(ctx, inp.state.crates, inp.time);
    this.drawWorms(ctx, inp);
    this.drawProjectiles(ctx, inp);
    inp.particles.draw(ctx, camera.zoom);
    this.drawAim(ctx, inp);
    this.drawWater(ctx, inp, pal);

    ctx.restore();
    this.postProcess.draw(ctx, W, H, dt, this.lowPower);
    ctx.restore();
  }

  // ---------------- woda ----------------
  private drawTrees(ctx: CanvasRenderingContext2D, trees: readonly TreeSnapshot[], theme: ThemeId): void {
    for (const tree of trees) {
      const sprite = treeSprite(theme, tree.id);
      ctx.save();
      ctx.globalAlpha = 0.24 * tree.opacity;
      ctx.fillStyle = "#102018";
      ctx.beginPath();
      ctx.ellipse(tree.x + 1, tree.y + 2, Math.min(26, tree.height * 0.24), 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = tree.opacity;
      ctx.translate(tree.x, tree.y);
      ctx.rotate(tree.angle);
      if ((tree.id & 1) === 0) ctx.scale(-1, 1);
      blit(ctx, sprite, tree.height / sprite.span);
      ctx.restore();
    }
  }

  private drawSprings(ctx: CanvasRenderingContext2D, springs: readonly SpringSnapshot[], team: number): void {
    for (const spring of springs) {
      // Serwer filtruje ukryte pułapki; ta kontrola chroni też lokalny podgląd.
      if (!spring.revealed && spring.ownerTeam !== team) continue;
      ctx.save();
      ctx.translate(spring.x, spring.y - 3);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.fillStyle = spring.revealed ? "#e8b44a" : teamColor(spring.ownerTeam);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      roundRect(ctx, -14, -5, 28, 7, 3);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-4, -5);
      ctx.lineTo(0, 0);
      ctx.lineTo(4, -5);
      ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.strokeStyle = "#e9f2f6";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBarrels(ctx: CanvasRenderingContext2D, barrels: readonly BarrelSnapshot[]): void {
    const sprite = fuelBarrelSprite();
    for (const barrel of barrels) {
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = "#1a0e0a";
      ctx.beginPath();
      ctx.ellipse(barrel.x + 1, barrel.y + 11, 15, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.translate(barrel.x, barrel.y);
      blit(ctx, sprite, FUEL_BARREL_SCALE);
      ctx.restore();
    }
  }

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

    // Woda jest jednolita jak w makiecie: płaska tafla z jasną linią na grzbiecie.
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

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = pal.waterFoam;
    ctx.beginPath();
    ctx.moveTo(x0, waveB(x0, t, level) + 6);
    for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, waveB(x, t, level) + 6);
    for (let x = x1; x >= x0; x -= step) ctx.lineTo(x, waveB(x, t, level) + 9.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineJoin = "round";
    ctx.strokeStyle = pal.waterFoam;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, waveA(x0, t, level));
    for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, waveA(x, t, level));
    ctx.stroke();
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
    const visualLift = ry - WORM_GROUND_OFFSET;
    const jet = w.anim === "jetpack";

    // cień na podłożu (nie skaluje się razem z ciałem)
    ctx.globalAlpha = 0.26 * pose.alpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(w.x, w.y + WORM_GROUND_OFFSET + 1, 15, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (jet) inp.particles.jetFlame(w.x + (Math.random() - 0.5) * 7, w.y + WORM_GROUND_OFFSET);

    // broń w rękach tylko dla aktywnego robaka; lokalny wybór ma pierwszeństwo
    const weapon: WeaponId | null = isActive ? (inp.myTurn ? inp.weapon : inp.state.turn.selectedWeapon) : null;
    // lokalne celowanie jest bardziej responsywne niż `aim` ze snapshotu
    if (isActive && inp.myTurn && pose.hold !== null) {
      pose.hold = inp.aimPitch;
      pose.pupilX = Math.cos(inp.aimPitch) * w.facing;
      pose.pupilY = Math.sin(inp.aimPitch);
    }

    ctx.save();
    ctx.translate(w.x, w.y - visualLift);
    drawWormCharacter(ctx, pose, {
      skin,
      facing: w.facing,
      weapon,
      hp: w.hp,
      time: inp.time,
      jetpack: jet,
      bat: w.anim === "bat",
      hat: hatForWorm(this.cosmeticSeed, w.id),
    });
    ctx.restore();

    if (!w.alive) return;

    if (w.id === inp.selectedDefenseWormId && !inp.myTurn) {
      ctx.save();
      ctx.strokeStyle = "rgba(153,235,255,.68)";
      ctx.lineWidth = 1.7;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(w.x, w.y - visualLift - 1, 17 + Math.sin(inp.time * 8) * 1.5, 21, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ------- etykieta: nazwa + pastylka HP (stały rozmiar na ekranie) -------
    const t = inp.time;
    const s = 1 / inp.camera.zoom;
    ctx.save();
    ctx.translate(w.x, w.y - ry - visualLift - 14);
    ctx.scale(s, s);
    const barW = 46;
    const barH = 9;
    const hp = Math.max(0, Math.min(1, w.hp / WORM_MAX_HP));
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.font = "800 13px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = INK;
    ctx.strokeText(w.name, 0, -15);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(w.name, 0, -15);

    ctx.fillStyle = INK;
    roundRect(ctx, -barW / 2 - 2, -barH - 2, barW + 4, barH + 4, (barH + 4) / 2);
    ctx.fill();
    ctx.fillStyle = "#3a3340";
    roundRect(ctx, -barW / 2, -barH, barW, barH, barH / 2);
    ctx.fill();
    if (hp > 0) {
      const fw = Math.max(barH, barW * hp);
      ctx.fillStyle = col;
      roundRect(ctx, -barW / 2, -barH, fw, barH, barH / 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      roundRect(ctx, -barW / 2 + 2, -barH + 1.4, Math.max(2, fw - 4), 2.4, 1.2);
      ctx.fill();
    }
    ctx.restore();

    // ------- strzałka nad aktywnym robakiem -------
    if (isActive) {
      const bounce = Math.abs(Math.sin(t * 3.2)) * 4;
      // pozycja w skali ekranu, żeby strzałka trzymała się etykiety przy każdym zoomie
      ctx.save();
      ctx.translate(w.x, w.y - ry - visualLift - 12 - (30 + bounce) * s);
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
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
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

    const mx = worm.x + dirX * WORM_MUZZLE_OFFSET;
    const my = worm.y - WORM_MUZZLE_LIFT + dirY * WORM_MUZZLE_OFFSET;

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
    ctx.setLineDash([0.01, 9.5 * s]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = "rgba(28,21,25,0.55)";
    ctx.lineWidth = 6.2 * s;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4 * s;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Celownik jak w makiecie: biały okrąg, 4 kreski i czerwona kropka (stały rozmiar na ekranie). */
  private crosshair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number): void {
    const pulse = 1 + Math.sin(time * 5) * 0.05;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * pulse, s * pulse);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.moveTo(-24, 0); ctx.lineTo(-9, 0);
    ctx.moveTo(9, 0); ctx.lineTo(24, 0);
    ctx.moveTo(0, -24); ctx.lineTo(0, -9);
    ctx.moveTo(0, 9); ctx.lineTo(0, 24);
    ctx.strokeStyle = "rgba(28,21,25,0.55)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#e0342e";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.stroke();
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
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r, start, start + sweep);
    ctx.stroke();
    ctx.strokeStyle = "#4a4250";
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r, start, start + sweep);
    ctx.stroke();
    ctx.strokeStyle = p < 0.55 ? "#9ad14e" : p < 0.8 ? "#f0c43e" : "#e2503c";
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.arc(0, 0, r, start, start + sweep * p);
    ctx.stroke();

    ctx.translate(0, r + 10 * s);
    ctx.scale(s, s);
    ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = INK;
    const txt = `${Math.round(p * 100)}%`;
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  // ---------------- pociski ----------------
  private drawProjectiles(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const visible = inp.camera.viewRect();
    const active = new Set<number>();
    for (const p of inp.state.projectiles) {
      active.add(p.id);
      // Salwy mogą mieć wiele obiektów poza kadrem; nie produkujemy tam cząstek.
      if (p.x < visible.x - 80 || p.x > visible.x + visible.w + 80 ||
          p.y < visible.y - 80 || p.y > visible.y + visible.h + 80) continue;
      this.drawProjectile(ctx, p, inp);
    }
    for (const id of this.lastTrail.keys()) if (!active.has(id)) this.lastTrail.delete(id);
  }

  private emitTrail(id: number, time: number, rate: number): boolean {
    const last = this.lastTrail.get(id);
    if (last !== undefined && time - last < 1 / rate) return false;
    this.lastTrail.set(id, time);
    return true;
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: ProjectileSnapshot, inp: RenderInput): void {
    const ang = p.angle ?? Math.atan2(p.vy, p.vx);
    const s = 1 / inp.camera.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);

    switch (p.kind) {
      case "drill": {
        ctx.rotate(ang);
        if (this.emitTrail(p.id, inp.time, 16)) inp.particles.sparks(p.x - Math.cos(ang) * 5, p.y - Math.sin(ang) * 5, 2, "#8aeaff");
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.fillStyle = "#4a8fa4";
        roundRect(ctx, -11, -4.4, 14, 8.8, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#a8dbe6";
        for (const dx of [-8, -3]) ctx.fillRect(dx, -3, 2, 6);
        ctx.fillStyle = "#e8f4f6";
        ctx.beginPath(); ctx.moveTo(3, -6.4); ctx.lineTo(12.5, 0); ctx.lineTo(3, 6.4); ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "bazooka":
      case "homing": {
        const homing = p.kind === "homing";
        if (this.emitTrail(p.id, inp.time, 32)) inp.particles.smokeTrail(
          p.x - Math.cos(ang) * 8,
          p.y - Math.sin(ang) * 8,
          homing ? 1.3 : 0.9,
          homing ? "rgba(83,220,255,0.9)" : "rgba(150,150,145,0.9)",
        );
        ctx.rotate(ang);
        if (homing) ctx.scale(1.2, 1.08);
        const flick = 0.75 + Math.sin(inp.time * 40 + p.id) * 0.25;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = homing ? "rgba(40,218,255,0.42)" : "rgba(255,140,30,0.35)";
        ctx.beginPath();
        ctx.ellipse(-13 - flick * 3, 0, 8 + flick * 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = homing ? "rgba(215,250,255,0.78)" : "rgba(255,230,150,0.65)";
        ctx.beginPath();
        ctx.ellipse(-10.5, 0, 4 + flick * 1.6, 2.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.7;
        ctx.fillStyle = homing ? "#e8eef4" : "#566030";
        ctx.beginPath();
        ctx.moveTo(-6, -3);
        ctx.lineTo(-12, -6.5);
        ctx.lineTo(-10, 0);
        ctx.lineTo(-12, 6.5);
        ctx.lineTo(-6, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        const base = homing ? "#d8404c" : "#707c40";
        ctx.fillStyle = base;
        roundRect(ctx, -9, -3.8, 18, 7.6, 3);
        ctx.fill();
        ctx.save();
        roundRect(ctx, -9, -3.8, 18, 7.6, 3);
        ctx.clip();
        ctx.fillStyle = homing ? "#a82a3a" : "#4e5a2a";
        ctx.fillRect(-9, 0.8, 18, 3.4);
        ctx.fillStyle = homing ? "#f2f6fa" : "#d8cf96";
        ctx.fillRect(homing ? -3 : -2, -4, homing ? 4 : 2.4, 8);
        ctx.restore();
        roundRect(ctx, -9, -3.8, 18, 7.6, 3);
        ctx.stroke();
        ctx.fillStyle = homing ? "#7fdcee" : "#c0532e";
        ctx.beginPath();
        ctx.moveTo(8.4, -3.8);
        ctx.quadraticCurveTo(16, 0, 8.4, 3.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (homing) {
          const pulse = 5.5 + Math.sin(inp.time * 9 + p.id) * 1.3;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(105,235,255,0.85)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(11, 0, pulse, -0.75, 0.75);
          ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "grenade":
      case "cluster": {
        ctx.rotate(ang * 0.4 + inp.time * 4);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.9;
        if (p.kind === "cluster") {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3 - Math.PI / 6;
            const px = Math.cos(a) * 7.4;
            const py = Math.sin(a) * 7.4;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = "#3a9aa6";
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#f0cc44";
          ctx.fillRect(-6.2, -1.5, 12.4, 3);
          ctx.fillStyle = Math.sin(inp.time * 12 + p.id) > 0 ? "#fff" : "#32ffc8";
          ctx.beginPath();
          ctx.arc(0, 4, 1.3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "#587a38";
          ctx.beginPath();
          ctx.arc(0, 0, 6.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = "#35502a";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-5, -1.5); ctx.lineTo(5, -1.5);
          ctx.moveTo(-5, 2); ctx.lineTo(5, 2);
          ctx.moveTo(-1.7, -5.5); ctx.lineTo(-1.7, 5.5);
          ctx.moveTo(2, -5.5); ctx.lineTo(2, 5.5);
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.28)";
          ctx.beginPath();
          ctx.arc(-2.2, -2.4, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.7;
        ctx.fillStyle = "#a4abb4";
        roundRect(ctx, -1.9, -9.6, 3.8, 4.6, 1);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(2.8, -7.4, 2.2, -1.2, 2.2);
        ctx.stroke();
        break;
      }
      case "clusterlet":
      case "bananalet": {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (p.kind === "bananalet") {
          if (this.emitTrail(p.id, inp.time, 24)) inp.particles.sparks(p.x, p.y, 1, "#fff04d");
          ctx.rotate(ang + inp.time * 6 + p.id);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 6.2;
          ctx.beginPath();
          ctx.arc(0, 0, 5.4, 0.5, Math.PI - 0.5);
          ctx.stroke();
          ctx.strokeStyle = "#f2d040";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, 5.4, 0.5, Math.PI - 0.5);
          ctx.stroke();
        } else {
          ctx.rotate(ang);
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(90,255,220,0.5)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-Math.min(29, 11 + Math.hypot(p.vx, p.vy) * 0.045), 0);
          ctx.lineTo(-2, 0);
          ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = "#3a9aa6";
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.beginPath();
          ctx.arc(-1.1, -1.3, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "banana": {
        ctx.rotate(ang + inp.time * 3);
        ctx.lineCap = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0.5, Math.PI - 0.5);
        ctx.stroke();
        ctx.strokeStyle = "#f2d040";
        ctx.lineWidth = 4.6;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0.5, Math.PI - 0.5);
        ctx.stroke();
        ctx.strokeStyle = "#fbeb86";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, -0.9, 7, 0.9, Math.PI - 1.1);
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
        ctx.fillStyle = "rgba(255,244,190,0.3)";
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.9;
        ctx.fillStyle = "#f0cf58";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fbecac";
        ctx.beginPath();
        ctx.arc(-2, -2.2, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillRect(-0.9, -4.2, 1.8, 8);
        ctx.fillRect(-3, -1.4, 6, 1.8);
        ctx.strokeStyle = "#fff6c8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -10, 8, 2.6, Math.sin(inp.time * 2) * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "dynamite": {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.9;
        ctx.fillStyle = "#c8443a";
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.fill();
        ctx.save();
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.clip();
        ctx.fillStyle = "#93302a";
        ctx.fillRect(1.6, -8, 4, 16);
        ctx.fillStyle = "#efdfbc";
        ctx.fillRect(-5, -2.5, 10, 3.6);
        ctx.restore();
        roundRect(ctx, -5, -8, 10, 16, 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.quadraticCurveTo(5, -13, 2, -15);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = "#d8b25a";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        if (this.emitTrail(p.id, inp.time, 20)) inp.particles.sparks(p.x + 2, p.y - 15, 1, "#ffd76a");
        break;
      }
      case "mine": {
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.fillStyle = "#7d8895";
        ctx.beginPath();
        ctx.ellipse(0, 1, 8, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#9aa5b0";
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.4, 4.6, 0, Math.PI, 0);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#c04034";
        ctx.beginPath();
        ctx.ellipse(0, -3.6, 2.2, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "airstrikeBomb": {
        if (this.emitTrail(p.id, inp.time, 30)) inp.particles.smokeTrail(p.x, p.y - 6, 0.7, "rgba(90,76,78,0.82)");
        ctx.rotate(ang + Math.PI / 2);
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.fillStyle = "#7d8fa8";
        ctx.beginPath();
        ctx.moveTo(-4, 6); ctx.lineTo(-6.4, 11); ctx.lineTo(0, 8);
        ctx.lineTo(6.4, 11); ctx.lineTo(4, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#59616f";
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.2, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#3c434f";
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.2, 9, 0, -0.4, Math.PI * 0.6);
        ctx.lineTo(0, 0);
        ctx.fill();
        ctx.fillStyle = "#d8503a";
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
      if (!c.landed) {
        ctx.save();
        ctx.scale(1.3, 1.3);
        this.drawParachute(ctx, time, c.id);
        ctx.restore();
      }

      if (c.landed) {
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = "#1a0e0a";
        ctx.beginPath();
        ctx.ellipse(1, 12.5, 15, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      blit(ctx, crateSprite(c.kind), CRATE_SCALE);

      ctx.restore();
    }
  }

  private drawParachute(ctx: CanvasRenderingContext2D, time: number, id: number): void {
    const sway = Math.sin(time * 2 + id) * 0.13;
    ctx.save();
    ctx.rotate(sway);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-21, -22); ctx.lineTo(-6, -10);
    ctx.moveTo(21, -22); ctx.lineTo(6, -10);
    ctx.moveTo(-7.5, -26); ctx.lineTo(-2, -10);
    ctx.moveTo(7.5, -26); ctx.lineTo(2, -10);
    ctx.stroke();

    const dome = (): void => {
      ctx.beginPath();
      ctx.moveTo(-21, -22);
      ctx.quadraticCurveTo(0, -50, 21, -22);
      ctx.quadraticCurveTo(10.5, -17, 0, -22);
      ctx.quadraticCurveTo(-10.5, -17, -21, -22);
      ctx.closePath();
    };
    dome();
    ctx.fillStyle = "#efe6d0";
    ctx.fill();
    ctx.save();
    dome();
    ctx.clip();
    ctx.fillStyle = "#c95a48";
    ctx.beginPath();
    ctx.moveTo(-7.5, -50);
    ctx.lineTo(7.5, -50);
    ctx.lineTo(3.6, -16);
    ctx.lineTo(-3.6, -16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(60,40,30,0.22)";
    ctx.fillRect(9, -50, 16, 40);
    ctx.restore();
    dome();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- miny ----------------
  private drawMines(ctx: CanvasRenderingContext2D, mines: MineSnapshot[], time: number): void {
    const sprite = mineSprite();
    const lampX = (sprite.lampX - sprite.ax) * MINE_SCALE;
    const lampY = (sprite.lampY - sprite.ay) * MINE_SCALE + 1.6;
    for (const m of mines) {
      ctx.save();
      ctx.translate(m.x, m.y);

      ctx.globalAlpha = 0.24;
      ctx.fillStyle = "#1a0e0a";
      ctx.beginPath();
      ctx.ellipse(1, 7, 15, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      blit(ctx, sprite, MINE_SCALE);

      const fast = m.fuse !== undefined && m.fuse > 0;
      const blink = fast ? Math.sin(time * 26) > -0.2 : m.armed ? Math.sin(time * 5) > 0.2 : false;
      if (blink) {
        ctx.fillStyle = "#ff4a3a";
        ctx.beginPath();
        ctx.ellipse(lampX, lampY, 5.2, 3.4, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#ff9a8a";
        ctx.beginPath();
        ctx.ellipse(lampX - 1.2, lampY - 2, 2.4, 1.2, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,70,55,0.24)";
        ctx.beginPath();
        ctx.arc(lampX, lampY - 1, 11, 0, Math.PI * 2);
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
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = "#1a0e0a";
      ctx.beginPath();
      ctx.ellipse(1, 11, 12, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const stone = (): void => {
        ctx.beginPath();
        ctx.moveTo(-7.5, 10);
        ctx.lineTo(-7.5, -3);
        ctx.arc(0, -3, 7.5, Math.PI, 0);
        ctx.lineTo(7.5, 10);
        ctx.closePath();
      };
      stone();
      ctx.fillStyle = "#a4acb6";
      ctx.fill();
      ctx.save();
      stone();
      ctx.clip();
      ctx.fillStyle = "#818a96";
      ctx.fillRect(2.5, -12, 8, 24);
      ctx.fillStyle = "#c4cbd3";
      ctx.fillRect(-7.5, -12, 2.4, 24);
      ctx.restore();
      stone();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#6b7480";
      roundRect(ctx, -10, 8, 20, 4.5, 1.6);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.strokeStyle = "#565e69";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 2);
      ctx.moveTo(-3.6, -4.2); ctx.lineTo(3.6, -4.2);
      ctx.stroke();
      ctx.fillStyle = teamColor(g.team);
      roundRect(ctx, -5, 4, 10, 2.6, 1.2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.9;
      ctx.stroke();
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
