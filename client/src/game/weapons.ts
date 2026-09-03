import type { WeaponId } from "@shared/protocol";

export const WEAPON_ORDER: WeaponId[] = [
  "bazooka", "grenade", "cluster", "banana",
  "shotgun", "uzi", "holy", "dynamite",
  "mine", "airstrike", "homing", "bat",
  "teleport", "girder", "jetpack", "skip",
];

export const WEAPON_NAMES: Record<WeaponId, string> = {
  bazooka: "Bazooka",
  grenade: "Granat",
  cluster: "Odłamkowy",
  shotgun: "Strzelba",
  uzi: "Uzi",
  holy: "Święty granat",
  dynamite: "Dynamit",
  mine: "Mina",
  airstrike: "Nalot",
  homing: "Rakieta nakierowana",
  banana: "Banan",
  bat: "Kij bejsbolowy",
  teleport: "Teleport",
  girder: "Belka",
  jetpack: "Plecak odrzutowy",
  skip: "Pomiń turę",
};

/** Bronie strzelające natychmiast (bez ładowania mocy). */
export const NO_CHARGE: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "shotgun", "uzi", "bat", "dynamite", "mine", "jetpack", "skip",
]);

/** Bronie wymagające wskazania celu na mapie. */
export const TARGETED: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "airstrike", "teleport", "girder", "homing",
]);

/** Bronie, dla których zapalnik (1–5 s) ma znaczenie. */
export const TIMED: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "grenade", "cluster", "banana", "dynamite", "mine", "holy",
]);

/** Ikona broni rysowana proceduralnie w kwadracie s×s (kontekst już wyśrodkowany w 0,0). */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, id: WeaponId, s: number): void {
  const u = s / 32; // jednostka względem projektu 32×32
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (id) {
    case "bazooka": {
      ctx.rotate(-0.5);
      ctx.fillStyle = "#4a5568";
      rrect(ctx, -13 * u, -4 * u, 22 * u, 8 * u, 3 * u);
      ctx.fillStyle = "#e05a3a";
      ctx.beginPath();
      ctx.moveTo(9 * u, -5 * u);
      ctx.lineTo(15 * u, 0);
      ctx.lineTo(9 * u, 5 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8fa0b8";
      rrect(ctx, -13 * u, -7 * u, 6 * u, 14 * u, 2 * u);
      break;
    }
    case "grenade":
    case "cluster": {
      ctx.fillStyle = "#3f7a3a";
      ctx.beginPath();
      ctx.arc(0, 2 * u, 9 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2b5528";
      ctx.lineWidth = 1.4 * u;
      ctx.beginPath();
      ctx.moveTo(-7 * u, -1 * u); ctx.lineTo(7 * u, -1 * u);
      ctx.moveTo(-7 * u, 5 * u); ctx.lineTo(7 * u, 5 * u);
      ctx.stroke();
      ctx.fillStyle = "#8a8f98";
      rrect(ctx, -3 * u, -10 * u, 6 * u, 5 * u, 1.5 * u);
      if (id === "cluster") {
        ctx.fillStyle = "#ffd24d";
        for (const a of [-1.2, 0, 1.2]) {
          ctx.beginPath();
          ctx.arc(Math.sin(a) * 12 * u, -12 * u + Math.cos(a) * 2 * u, 2 * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "banana": {
      ctx.strokeStyle = "#ffd83d";
      ctx.lineWidth = 6 * u;
      ctx.beginPath();
      ctx.arc(0, -4 * u, 10 * u, 0.5, Math.PI - 0.5);
      ctx.stroke();
      ctx.strokeStyle = "#7a5c14";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(0, -4 * u, 10 * u, 0.55, 0.85);
      ctx.stroke();
      break;
    }
    case "shotgun": {
      ctx.rotate(-0.35);
      ctx.fillStyle = "#6b4a2a";
      rrect(ctx, -14 * u, -1 * u, 12 * u, 7 * u, 2 * u);
      ctx.fillStyle = "#3f4652";
      rrect(ctx, -4 * u, -3 * u, 18 * u, 4 * u, 1.5 * u);
      ctx.fillStyle = "#8fa0b8";
      rrect(ctx, 8 * u, -3.5 * u, 6 * u, 5 * u, 1 * u);
      break;
    }
    case "uzi": {
      ctx.fillStyle = "#3f4652";
      rrect(ctx, -10 * u, -6 * u, 18 * u, 7 * u, 2 * u);
      rrect(ctx, -7 * u, 1 * u, 6 * u, 10 * u, 2 * u);
      ctx.fillStyle = "#8fa0b8";
      rrect(ctx, 6 * u, -5 * u, 9 * u, 4 * u, 1.5 * u);
      break;
    }
    case "holy": {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 12 * u);
      g.addColorStop(0, "#fff6c8");
      g.addColorStop(1, "#e8b32a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 2 * u, 9 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff3b0";
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      ctx.ellipse(0, -8 * u, 8 * u, 2.6 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fffbe6";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(0, -2 * u); ctx.lineTo(0, 7 * u);
      ctx.moveTo(-3.5 * u, 1 * u); ctx.lineTo(3.5 * u, 1 * u);
      ctx.stroke();
      break;
    }
    case "dynamite": {
      ctx.fillStyle = "#cc3b2e";
      rrect(ctx, -6 * u, -6 * u, 12 * u, 16 * u, 2 * u);
      ctx.fillStyle = "#f2e2c2";
      ctx.fillRect(-6 * u, -1 * u, 12 * u, 3 * u);
      ctx.strokeStyle = "#c9a24a";
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.moveTo(0, -6 * u);
      ctx.quadraticCurveTo(6 * u, -12 * u, 2 * u, -14 * u);
      ctx.stroke();
      ctx.fillStyle = "#ffd24d";
      ctx.beginPath();
      ctx.arc(2 * u, -14.5 * u, 2 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "mine": {
      ctx.fillStyle = "#6b7280";
      ctx.beginPath();
      ctx.arc(0, 2 * u, 8 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 2 * u;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8 * u, 2 * u + Math.sin(a) * 8 * u);
        ctx.lineTo(Math.cos(a) * 12 * u, 2 * u + Math.sin(a) * 12 * u);
        ctx.stroke();
      }
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(0, 0, 2.4 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "airstrike": {
      ctx.fillStyle = "#8fa0b8";
      ctx.beginPath();
      ctx.moveTo(-14 * u, -6 * u);
      ctx.lineTo(10 * u, -8 * u);
      ctx.lineTo(14 * u, -4 * u);
      ctx.lineTo(-10 * u, -1 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5b6678";
      ctx.beginPath();
      ctx.moveTo(-6 * u, -6 * u);
      ctx.lineTo(-2 * u, -12 * u);
      ctx.lineTo(2 * u, -6 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e05a3a";
      for (const dx of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.ellipse(dx * u, 7 * u, 2 * u, 4 * u, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "homing": {
      ctx.rotate(-0.6);
      ctx.fillStyle = "#c0392b";
      rrect(ctx, -11 * u, -3.5 * u, 18 * u, 7 * u, 3 * u);
      ctx.fillStyle = "#ecf0f1";
      ctx.beginPath();
      ctx.moveTo(7 * u, -4 * u);
      ctx.lineTo(14 * u, 0);
      ctx.lineTo(7 * u, 4 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ff9a3c";
      ctx.beginPath();
      ctx.moveTo(-11 * u, -3 * u);
      ctx.lineTo(-17 * u, 0);
      ctx.lineTo(-11 * u, 3 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "bat": {
      ctx.rotate(-0.7);
      ctx.fillStyle = "#b5793a";
      ctx.beginPath();
      ctx.moveTo(-12 * u, 2 * u);
      ctx.lineTo(-9 * u, -2 * u);
      ctx.lineTo(11 * u, -6 * u);
      ctx.quadraticCurveTo(15 * u, -2 * u, 11 * u, 3 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#7a4a1f";
      rrect(ctx, -14 * u, -1 * u, 5 * u, 4 * u, 1.5 * u);
      break;
    }
    case "teleport": {
      ctx.strokeStyle = "#9b6bff";
      ctx.lineWidth = 2.4 * u;
      ctx.beginPath();
      ctx.arc(0, 0, 10 * u, 0.4, Math.PI * 1.7);
      ctx.stroke();
      ctx.fillStyle = "#c9aaff";
      ctx.beginPath();
      ctx.moveTo(2 * u, -13 * u);
      ctx.lineTo(9 * u, -8 * u);
      ctx.lineTo(1 * u, -4 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e6dcff";
      ctx.beginPath();
      ctx.arc(0, 0, 3.4 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "girder": {
      ctx.save();
      ctx.rotate(-0.3);
      ctx.fillStyle = "#c4713a";
      rrect(ctx, -15 * u, -4 * u, 30 * u, 8 * u, 1.5 * u);
      ctx.fillStyle = "#8e4d24";
      for (let i = -12; i <= 10; i += 6) ctx.fillRect(i * u, -4 * u, 2 * u, 8 * u);
      ctx.restore();
      break;
    }
    case "jetpack": {
      ctx.fillStyle = "#5b6678";
      rrect(ctx, -8 * u, -10 * u, 6 * u, 14 * u, 2 * u);
      rrect(ctx, 2 * u, -10 * u, 6 * u, 14 * u, 2 * u);
      ctx.fillStyle = "#ff9a3c";
      for (const dx of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(dx * u - 3 * u, 4 * u);
        ctx.lineTo(dx * u, 14 * u);
        ctx.lineTo(dx * u + 3 * u, 4 * u);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "skip": {
      ctx.fillStyle = "#93a0b8";
      ctx.beginPath();
      ctx.moveTo(-11 * u, -8 * u);
      ctx.lineTo(1 * u, 0);
      ctx.lineTo(-11 * u, 8 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(4 * u, -8 * u, 4 * u, 16 * u);
      break;
    }
  }
  ctx.restore();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}
