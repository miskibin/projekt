import type { TreeSnapshot } from "@shared/protocol";
import type { ThemeId } from "./terrainRenderer";

/** Painted tree plates, cached per theme and silhouette. Falling trees rotate the same sprite. */
export class Scenery {
  private trees = new Map<string, HTMLCanvasElement>();

  drawTrees(ctx: CanvasRenderingContext2D, trees: readonly TreeSnapshot[], theme: ThemeId): void {
    for (const tree of trees) {
      const variant = tree.id % 3;
      const key = `${theme}:${variant}`;
      let plate = this.trees.get(key);
      if (!plate) { plate = treePlate(theme, variant); this.trees.set(key, plate); }
      const scale = tree.height / 112;
      ctx.save();
      ctx.globalAlpha = tree.opacity;
      ctx.translate(tree.x, tree.y);
      ctx.rotate(tree.angle);
      ctx.drawImage(plate, -78 * scale, -136 * scale, 156 * scale, 144 * scale);
      ctx.restore();
    }
  }
}

function treePlate(theme: ThemeId, variant: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 312; canvas.height = 288;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2); ctx.translate(78, 136);
  const bend = [-1, 1, .6][variant]!;
  const line = "#3b342a", wood = theme === "hell" ? "#4b3a3a" : "#806040";
  const foliage = theme === "snow" ? ["#365d61", "#497574", "#8daba0"] :
    theme === "hell" ? ["#563c38", "#80533c", "#a57345"] :
    theme === "desert" ? ["#777348", "#90925b", "#b5b775"] : ["#58682e", "#788b36", "#9caf49"];
  ctx.fillStyle = "rgba(31,28,19,.2)";
  ctx.beginPath(); ctx.ellipse(0, 0, 21, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = wood; ctx.strokeStyle = line; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(-18, 0); ctx.bezierCurveTo(-2, -8, -4, -34, -5 * bend, -51);
  ctx.lineTo(-22 * bend, -77); ctx.lineTo(-20 * bend, -84); ctx.lineTo(-1 * bend, -64);
  ctx.lineTo(1 * bend, -99); ctx.lineTo(10 * bend, -103); ctx.lineTo(8 * bend, -68);
  ctx.lineTo(24 * bend, -84); ctx.lineTo(29 * bend, -79); ctx.lineTo(10 * bend, -55);
  ctx.bezierCurveTo(7, -30, 7, -10, 16, 0); ctx.quadraticCurveTo(5, -4, 0, -1); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#ae8250"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-5, -5); ctx.bezierCurveTo(3, -22, -3, -38, 2 * bend, -56); ctx.stroke();
  ctx.strokeStyle = "#4b3a2d"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(5, -9); ctx.quadraticCurveTo(-3, -16, 3, -25); ctx.moveTo(1, -33); ctx.lineTo(-1, -44); ctx.stroke();
  const groups = [[-29, -90, 23], [26, -90, 23], [-10, -111, 26], [14, -110, 21], [0, -88, 25]];
  for (let i = 0; i < groups.length; i++) {
    const [x, y, r] = groups[i]!;
    foliagePath(ctx, x + bend * 3, y + (variant - 1) * (i % 2) * 4, r);
    ctx.fillStyle = foliage[i % 2]!; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 1.7; ctx.stroke();
    foliagePath(ctx, x - 3 + bend * 3, y - 6, r * .72);
    ctx.fillStyle = foliage[2]!; ctx.fill();
    if (theme === "snow") {
      ctx.fillStyle = "#d6e1dc";
      ctx.beginPath(); ctx.ellipse(x - 2, y - r * .65, r * .63, r * .17, -.1, 0, Math.PI * 2); ctx.fill();
    }
  }
  return canvas;
}

function foliagePath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    const b = (i + .5) / n * Math.PI * 2;
    const xx = x + Math.cos(a) * radius * .86, yy = y + Math.sin(a) * radius * .77;
    if (!i) ctx.moveTo(xx, yy);
    else ctx.quadraticCurveTo(x + Math.cos(b - Math.PI * 2 / n) * radius * 1.13,
      y + Math.sin(b - Math.PI * 2 / n) * radius, xx, yy);
  }
  ctx.closePath();
}
