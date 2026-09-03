import { GRAVITY } from "@shared/constants";

type Kind = "smoke" | "spark" | "debris" | "water" | "feather";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: Kind;
  grav: number;
  drag: number;
  rot: number;
  vr: number;
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
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

const MAX_PARTICLES = 1400;

/** Prosty system cząsteczek: dym, iskry, odłamki, bryzgi, napisy i błyski. */
export class Particles {
  private ps: Particle[] = [];
  private texts: FloatText[] = [];
  private flashes: Flash[] = [];

  get count(): number {
    return this.ps.length;
  }

  clear(): void {
    this.ps.length = 0;
    this.texts.length = 0;
    this.flashes.length = 0;
  }

  private add(p: Particle): void {
    if (this.ps.length >= MAX_PARTICLES) this.ps.shift();
    this.ps.push(p);
  }

  explosion(x: number, y: number, r: number, debrisColor: string): void {
    const n = Math.min(90, 16 + Math.round(r * 1.6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random()) * r * 5.5;
      this.add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - r * 0.8,
        life: 0,
        max: 0.5 + Math.random() * 0.9,
        size: 1.5 + Math.random() * 3,
        color: debrisColor,
        kind: "debris",
        grav: 1,
        drag: 0.4,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 14,
      });
    }
    const ns = Math.min(70, 14 + Math.round(r));
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random()) * r * 8;
      this.add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.15 + Math.random() * 0.35,
        size: 1 + Math.random() * 2.2,
        color: Math.random() < 0.5 ? "#ffd76a" : "#ff8a2a",
        kind: "spark",
        grav: 0.2,
        drag: 2.4,
        rot: 0,
        vr: 0,
      });
    }
    const nsm = Math.min(50, 10 + Math.round(r * 0.8));
    for (let i = 0; i < nsm; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * r * 1.8;
      this.add({
        x: x + Math.cos(a) * r * 0.4,
        y: y + Math.sin(a) * r * 0.4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 24,
        life: 0,
        max: 0.9 + Math.random() * 1.3,
        size: r * (0.22 + Math.random() * 0.35),
        color: "rgba(60,55,52,1)",
        kind: "smoke",
        grav: -0.06,
        drag: 1.1,
        rot: 0,
        vr: (Math.random() - 0.5) * 2,
      });
    }
    this.flash(x, y, r * 2.1, "#ffdca0");
  }

  flash(x: number, y: number, r: number, color = "#ffd9a0"): void {
    this.flashes.push({ x, y, r, life: 0, max: 0.28, color });
  }

  smokeTrail(x: number, y: number, scale = 1): void {
    this.add({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14 - 6,
      life: 0,
      max: 0.45 + Math.random() * 0.5,
      size: (2.2 + Math.random() * 2.4) * scale,
      color: "rgba(150,150,155,1)",
      kind: "smoke",
      grav: -0.05,
      drag: 1.4,
      rot: 0,
      vr: 0,
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
        color: Math.random() < 0.5 ? "#ffd05a" : "#ff7a28",
        kind: "spark",
        grav: 0,
        drag: 2,
        rot: 0,
        vr: 0,
      });
    }
  }

  sparks(x: number, y: number, n = 8, color = "#ffe07a"): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 200;
      this.add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.14 + Math.random() * 0.24,
        size: 1 + Math.random() * 1.6,
        color,
        kind: "spark",
        grav: 0.4,
        drag: 2,
        rot: 0,
        vr: 0,
      });
    }
  }

  splash(x: number, y: number, color = "rgba(150,215,255,1)"): void {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 80 + Math.random() * 260;
      this.add({
        x: x + (Math.random() - 0.5) * 12,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 1.4 + Math.random() * 2,
        color,
        kind: "water",
        grav: 1,
        drag: 0.2,
        rot: 0,
        vr: 0,
      });
    }
  }

  /** Spadające pióra/pióropusz przy zdjęciu spadochronu itp. */
  puff(x: number, y: number, color: string, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x, y,
        vx: Math.cos(a) * 40,
        vy: Math.sin(a) * 40 - 20,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 2,
        color,
        kind: "feather",
        grav: 0.15,
        drag: 1.6,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  floatText(x: number, y: number, text: string, color: string, size = 18): void {
    this.texts.push({ x, y, vy: -34, life: 0, max: 1.5, text, color, size });
  }

  update(dt: number): void {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.ps.splice(i, 1);
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy += GRAVITY * p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === "smoke") p.size += dt * 14;
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
  }

  /** Rysuje w koordynatach świata (transformacja kamery już nałożona). */
  draw(ctx: CanvasRenderingContext2D, zoom: number): void {
    // błyski
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.flashes) {
      const t = f.life / f.max;
      const r = f.r * (0.4 + t * 0.9);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, withAlpha(f.color, (1 - t) * 0.95));
      g.addColorStop(0.45, withAlpha(f.color, (1 - t) * 0.35));
      g.addColorStop(1, withAlpha(f.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const p of this.ps) {
      const t = p.life / p.max;
      if (p.kind === "smoke") {
        const a = (1 - t) * 0.45;
        ctx.fillStyle = withAlpha(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "spark") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = withAlpha(p.color, 1 - t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === "debris" || p.kind === "feather") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, (1 - t) * 2.4);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
        ctx.restore();
      } else {
        ctx.fillStyle = withAlpha(p.color, 1 - t);
        ctx.fillRect(p.x, p.y, p.size, p.size * 1.6);
      }
    }
    ctx.globalAlpha = 1;

    // napisy (skalowane tak, by miały stały rozmiar na ekranie)
    const s = 1 / zoom;
    for (const t of this.texts) {
      const k = t.life / t.max;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = `800 ${t.size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

function withAlpha(color: string, a: number): string {
  const al = Math.max(0, Math.min(1, a));
  if (color.startsWith("rgba")) return color.replace(/,\s*[\d.]+\)$/, `,${al.toFixed(3)})`);
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${al.toFixed(3)})`);
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al.toFixed(3)})`;
  }
  return color;
}
