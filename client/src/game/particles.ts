import { GRAVITY } from "@shared/constants";

type Kind = "smoke" | "spark" | "debris" | "water" | "feather" | "ember";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  /** przyrost rozmiaru na sekundę (dym rośnie) */
  grow: number;
  color: string;
  kind: Kind;
  grav: number;
  drag: number;
  rot: number;
  vr: number;
  /** bazowa nieprzezroczystość */
  fade: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
  heal: boolean;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

/** Kula ognia: jasny rdzeń → pomarańcz → ciemna czerwień, rośnie i gaśnie. */
interface Fireball {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
}

/** Pierścień uderzeniowy / fala na wodzie. */
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  /** spłaszczony (elipsa) – fale na wodzie */
  flat: boolean;
  additive: boolean;
}

const MAX_PARTICLES = 1400;
const MAX_TEXTS = 40;
const MAX_FLASHES = 24;
const MAX_FIREBALLS = 16;
const MAX_RINGS = 24;

/**
 * System cząsteczek: kule ognia, fale uderzeniowe, odłamki, dym, iskry,
 * bryzgi wody i napisy. Rysuje w koordynatach świata.
 */
export class Particles {
  private ps: Particle[] = [];
  private texts: FloatText[] = [];
  private flashes: Flash[] = [];
  private fireballs: Fireball[] = [];
  private rings: Ring[] = [];

  /** pre-renderowane sprity (żeby nie tworzyć gradientów co klatkę) */
  private soft = new Map<string, HTMLCanvasElement | null>();
  private fireSprite: HTMLCanvasElement | null | undefined;

  get count(): number {
    return this.ps.length + this.flashes.length + this.fireballs.length + this.rings.length;
  }

  clear(): void {
    this.ps.length = 0;
    this.texts.length = 0;
    this.flashes.length = 0;
    this.fireballs.length = 0;
    this.rings.length = 0;
  }

  private add(p: Particle): void {
    if (this.ps.length >= MAX_PARTICLES) this.ps.shift();
    this.ps.push(p);
  }

  // ---------------- publiczne efekty ----------------

  /** Wybuch: rozbłysk, kula ognia, fala, odłamki, dym i żarzące się iskry. */
  explosion(x: number, y: number, r: number, debrisColor: string): void {
    const k = Math.max(0.35, r / 30); // skala względem "typowej" bazooki

    // jasny rdzeń + kula ognia + fala uderzeniowa
    this.flash(x, y, r * 1.7, "#fff3cf", 0.16);
    this.pushFireball({ x, y, r: r * 1.5, life: 0, max: 0.3 + k * 0.16 });
    this.pushRing({
      x,
      y,
      r0: r * 0.5,
      r1: r * 2.0,
      life: 0,
      max: 0.22,
      color: "rgba(255,242,210,1)",
      width: 2.0 + k * 1.2,
      flat: false,
      additive: true,
    });

    // bryły ziemi
    const dark = shade(debrisColor, -0.28);
    const light = shade(debrisColor, 0.16);
    const nd = Math.min(64, Math.round(10 + r * 1.15));
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.35 + Math.random()) * r * 5.2;
      const c = i % 3 === 0 ? dark : i % 3 === 1 ? light : debrisColor;
      this.add({
        x: x + Math.cos(a) * r * 0.25,
        y: y + Math.sin(a) * r * 0.25,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - r * 1.1,
        life: 0,
        max: 0.6 + Math.random() * 1.0,
        size: (1.6 + Math.random() * 3.4) * Math.min(2, 0.7 + k * 0.5),
        grow: 0,
        color: c,
        kind: "debris",
        grav: 1,
        drag: 0.35,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 16,
        fade: 1,
      });
    }

    // iskry / żar
    const ne = Math.min(56, Math.round(10 + r * 0.95));
    for (let i = 0; i < ne; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random()) * r * 9;
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.18 + Math.random() * 0.5,
        size: 1 + Math.random() * 2.2,
        grow: -1.2,
        color: Math.random() < 0.45 ? "#fff0b8" : Math.random() < 0.6 ? "#ffc255" : "#ff8a2a",
        kind: "ember",
        grav: 0.35,
        drag: 1.9,
        rot: 0,
        vr: 0,
        fade: 1,
      });
    }

    // miękkie kłęby dymu
    const ns = Math.min(22, Math.round(5 + r * 0.42));
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * r * 1.6;
      this.add({
        x: x + Math.cos(a) * r * 0.45,
        y: y + Math.sin(a) * r * 0.45,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 26,
        life: 0,
        max: 1.0 + Math.random() * 1.4,
        size: r * (0.22 + Math.random() * 0.3),
        grow: r * 0.6,
        color: i % 3 === 0 ? "rgba(122,110,100,1)" : "rgba(70,63,58,1)",
        kind: "smoke",
        grav: -0.07,
        drag: 1.0,
        rot: 0,
        vr: 0,
        fade: 0.5,
      });
    }
  }

  flash(x: number, y: number, r: number, color = "#ffd9a0", max = 0.24): void {
    if (this.flashes.length >= MAX_FLASHES) this.flashes.shift();
    this.flashes.push({ x, y, r, life: 0, max, color });
  }

  smokeTrail(x: number, y: number, scale = 1): void {
    this.add({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14 - 8,
      life: 0,
      max: 0.5 + Math.random() * 0.55,
      size: (2.4 + Math.random() * 2.2) * scale,
      grow: 16 * scale,
      color: "rgba(168,168,172,1)",
      kind: "smoke",
      grav: -0.05,
      drag: 1.4,
      rot: 0,
      vr: 0,
      fade: 0.5,
    });
  }

  jetFlame(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
      this.add({
        x: x + (Math.random() - 0.5) * 4,
        y,
        vx: (Math.random() - 0.5) * 40,
        vy: 90 + Math.random() * 90,
        life: 0,
        max: 0.16 + Math.random() * 0.16,
        size: 2 + Math.random() * 2.4,
        grow: -2,
        color: Math.random() < 0.5 ? "#ffd05a" : "#ff7a28",
        kind: "ember",
        grav: 0,
        drag: 2,
        rot: 0,
        vr: 0,
        fade: 1,
      });
    }
  }

  /** Iskry uderzenia / wystrzału. Przy większym `n` dorzuca krótki rozbłysk lufy. */
  sparks(x: number, y: number, n = 8, color = "#ffe07a"): void {
    if (n >= 6) this.muzzleFlash(x, y, 0.7 + Math.min(1, n / 14));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 230;
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.12 + Math.random() * 0.26,
        size: 1 + Math.random() * 1.7,
        grow: -1.6,
        color,
        kind: "ember",
        grav: 0.45,
        drag: 2.1,
        rot: 0,
        vr: 0,
        fade: 1,
      });
    }
    // drobny dymek po uderzeniu
    if (n >= 6) {
      this.add({
        x,
        y,
        vx: (Math.random() - 0.5) * 20,
        vy: -20 - Math.random() * 20,
        life: 0,
        max: 0.42,
        size: 3.5,
        grow: 22,
        color: "rgba(150,146,140,1)",
        kind: "smoke",
        grav: -0.05,
        drag: 1.6,
        rot: 0,
        vr: 0,
        fade: 0.4,
      });
    }
  }

  /** Błysk lufy: krótki, jasny rozbłysk + mikro-fala. */
  muzzleFlash(x: number, y: number, scale = 1, color = "#ffe9b0"): void {
    this.flash(x, y, 18 * scale, color, 0.1);
    this.pushRing({
      x,
      y,
      r0: 2 * scale,
      r1: 16 * scale,
      life: 0,
      max: 0.16,
      color: "rgba(255,224,150,1)",
      width: 2,
      flat: false,
      additive: true,
    });
  }

  /** Bryzg wody: krople + rozchodząca się fala na powierzchni. */
  splash(x: number, y: number, color = "rgba(150,215,255,1)"): void {
    for (let i = 0; i < 30; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
      const sp = 70 + Math.random() * 280;
      this.add({
        x: x + (Math.random() - 0.5) * 12,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.5 + Math.random() * 0.55,
        size: 1.3 + Math.random() * 2.2,
        grow: 0,
        color,
        kind: "water",
        grav: 1,
        drag: 0.25,
        rot: 0,
        vr: 0,
        fade: 1,
      });
    }
    // piana u podstawy
    for (let i = 0; i < 6; i++) {
      this.add({
        x: x + (Math.random() - 0.5) * 16,
        y: y - Math.random() * 4,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 30,
        life: 0,
        max: 0.45 + Math.random() * 0.3,
        size: 3 + Math.random() * 3,
        grow: 14,
        color: "rgba(226,244,255,1)",
        kind: "smoke",
        grav: 0.1,
        drag: 1.5,
        rot: 0,
        vr: 0,
        fade: 0.55,
      });
    }
    this.pushRing({
      x,
      y,
      r0: 4,
      r1: 46,
      life: 0,
      max: 0.7,
      color: "rgba(214,240,255,1)",
      width: 2.4,
      flat: true,
      additive: false,
    });
    this.pushRing({
      x,
      y,
      r0: 2,
      r1: 26,
      life: 0,
      max: 0.45,
      color: "rgba(255,255,255,1)",
      width: 1.6,
      flat: true,
      additive: false,
    });
  }

  /** Obłoczek (śmierć robaka, zdjęcie spadochronu). */
  puff(x: number, y: number, color: string, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x,
        y,
        vx: Math.cos(a) * 40,
        vy: Math.sin(a) * 40 - 20,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 2,
        grow: 0,
        color,
        kind: "feather",
        grav: 0.15,
        drag: 1.6,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 8,
        fade: 1,
      });
    }
    for (let i = 0; i < Math.max(3, n >> 1); i++) {
      this.add({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 30,
        vy: -30 - Math.random() * 30,
        life: 0,
        max: 0.6 + Math.random() * 0.4,
        size: 4 + Math.random() * 3,
        grow: 22,
        color: "rgba(232,232,236,1)",
        kind: "smoke",
        grav: -0.05,
        drag: 1.3,
        rot: 0,
        vr: 0,
        fade: 0.5,
      });
    }
  }

  /** Napis (obrażenia / leczenie) z animacją "pop". */
  floatText(x: number, y: number, text: string, color: string, size = 18): void {
    if (this.texts.length >= MAX_TEXTS) this.texts.shift();
    const heal = text.startsWith("+");
    this.texts.push({ x, y, vy: heal ? -26 : -38, life: 0, max: 1.5, text, color, size, heal });
    if (heal) this.flash(x, y, 22, "#8ef0a8", 0.3);
  }

  // ---------------- aktualizacja ----------------

  update(dt: number): void {
    const ps = this.ps;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        // swap-remove (kolejność cząsteczek nieistotna)
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const d = p.drag > 0 ? Math.max(0, 1 - p.drag * dt) : 1;
      p.vx *= d;
      p.vy *= d;
      if (p.grav !== 0) p.vy += GRAVITY * p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr !== 0) p.rot += p.vr * dt;
      if (p.grow !== 0) p.size = Math.max(0.2, p.size + p.grow * dt);
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      t.y += t.vy * dt;
      t.vy *= 1 - 0.9 * dt;
      if (t.life >= t.max) this.texts.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += dt;
      if (f.life >= f.max) this.flashes.splice(i, 1);
    }
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life += dt;
      if (f.life >= f.max) this.fireballs.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.max) this.rings.splice(i, 1);
    }
  }

  // ---------------- rysowanie ----------------

  /** Rysuje w koordynatach świata (transformacja kamery już nałożona). */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    // 1) zwykłe pierścienie (fale na wodzie) – pod cząsteczkami
    for (const r of this.rings) {
      if (r.additive) continue;
      this.strokeRing(ctx, r);
    }

    // 2) dym (miękkie sprity)
    for (const p of this.ps) {
      if (p.kind !== "smoke") continue;
      const t = p.life / p.max;
      const a = (1 - t) * p.fade;
      if (a <= 0.01) continue;
      const sp = this.getSoft(p.color);
      ctx.globalAlpha = a;
      if (sp) ctx.drawImage(sp, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      else {
        ctx.fillStyle = withAlpha(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // 3) kule ognia (nad dymem – jasny rdzeń ma być widoczny)
    const fire = this.getFireSprite();
    for (const f of this.fireballs) {
      const t = f.life / f.max;
      const r = f.r * (0.42 + t * 0.85);
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.35);
      if (fire) ctx.drawImage(fire, f.x - r, f.y - r, r * 2, r * 2);
      else {
        ctx.fillStyle = "rgba(255,150,40,0.8)";
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // 4) rozbłyski + addytywne pierścienie (fala uderzeniowa)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.flashes) {
      const t = f.life / f.max;
      const r = f.r * (0.45 + t * 0.85);
      const sp = this.getSoft(f.color);
      ctx.globalAlpha = (1 - t) * 0.9;
      if (sp) ctx.drawImage(sp, f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      if (!r.additive) continue;
      this.strokeRing(ctx, r);
    }
    ctx.restore();

    // 5) odłamki / pióra / krople
    for (const p of this.ps) {
      const t = p.life / p.max;
      if (p.kind === "debris" || p.kind === "feather") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, (1 - t) * 2.6);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
        ctx.restore();
      } else if (p.kind === "water") {
        ctx.globalAlpha = Math.min(1, (1 - t) * 1.8);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 0.62, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // 6) iskry / żar – jeden addytywny przebieg
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.ps) {
      if (p.kind !== "ember" && p.kind !== "spark") continue;
      const t = p.life / p.max;
      ctx.fillStyle = withAlpha(p.color, 1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, p.size * (1 - t * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // 7) napisy – stały rozmiar na ekranie, z animacją "pop"
    if (this.texts.length > 0) {
      const s = 1 / zoom;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const t of this.texts) {
        const k = t.life / t.max;
        const pop = k < 0.18 ? popScale(k / 0.18) : 1;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(s * pop, s * pop);
        ctx.globalAlpha = k < 0.72 ? 1 : Math.max(0, 1 - (k - 0.72) / 0.28);
        ctx.font = `800 ${t.size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = "rgba(0,0,0,0.78)";
        ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- pomocnicze ----------------

  private pushFireball(f: Fireball): void {
    if (this.fireballs.length >= MAX_FIREBALLS) this.fireballs.shift();
    this.fireballs.push(f);
  }

  private pushRing(r: Ring): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push(r);
  }

  private strokeRing(ctx: CanvasRenderingContext2D, r: Ring): void {
    const t = r.life / r.max;
    const rad = r.r0 + (r.r1 - r.r0) * easeOut(t);
    ctx.globalAlpha = (1 - t) * (1 - t) * 0.6;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(0.4, r.width * (1 - t * 0.75));
    ctx.beginPath();
    if (r.flat) ctx.ellipse(r.x, r.y, rad, rad * 0.26, 0, 0, Math.PI * 2);
    else ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Miękki sprite (radialny gradient) danego koloru – tworzony raz. */
  private getSoft(color: string): HTMLCanvasElement | null {
    const hit = this.soft.get(color);
    if (hit !== undefined) return hit;
    let cv: HTMLCanvasElement | null = null;
    if (typeof document !== "undefined") {
      cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      const c = cv.getContext("2d");
      if (c) {
        const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, withAlpha(color, 1));
        g.addColorStop(0.45, withAlpha(color, 0.62));
        g.addColorStop(1, withAlpha(color, 0));
        c.fillStyle = g;
        c.fillRect(0, 0, 64, 64);
      } else cv = null;
    }
    if (this.soft.size > 24) this.soft.clear();
    this.soft.set(color, cv);
    return cv;
  }

  /** Sprite kuli ognia: żółty rdzeń → pomarańcz → ciemna czerwień. */
  private getFireSprite(): HTMLCanvasElement | null {
    if (this.fireSprite !== undefined) return this.fireSprite;
    let cv: HTMLCanvasElement | null = null;
    if (typeof document !== "undefined") {
      cv = document.createElement("canvas");
      cv.width = 128;
      cv.height = 128;
      const c = cv.getContext("2d");
      if (c) {
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,252,232,1)");
        g.addColorStop(0.22, "rgba(255,224,130,0.98)");
        g.addColorStop(0.46, "rgba(255,150,44,0.9)");
        g.addColorStop(0.72, "rgba(198,58,16,0.55)");
        g.addColorStop(1, "rgba(96,16,6,0)");
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
      } else cv = null;
    }
    this.fireSprite = cv;
    return cv;
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Lekkie "przestrzelenie" skali przy pojawieniu się napisu. */
function popScale(t: number): number {
  const x = t - 1;
  return 1 + 2.2 * x * x * x + 1.6 * x * x;
}

function withAlpha(color: string, a: number): string {
  const al = Math.max(0, Math.min(1, a));
  if (color.startsWith("rgba")) return color.replace(/,\s*[\d.]+\)$/, `,${al.toFixed(3)})`);
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${al.toFixed(3)})`);
  if (color.startsWith("#")) {
    const [r, g, b] = hexRgb(color);
    return `rgba(${r},${g},${b},${al.toFixed(3)})`;
  }
  return color;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rozjaśnia (amt > 0) lub przyciemnia (amt < 0) kolor hex/rgb. */
function shade(color: string, amt: number): string {
  if (!color.startsWith("#")) return color;
  const [r, g, b] = hexRgb(color);
  const to = amt > 0 ? 255 : 0;
  const t = Math.abs(amt);
  const m = (v: number): number => Math.round(v + (to - v) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
