/** Lekki post-processing Canvas2D: bloom, grading, winieta i impuls po eksplozji. */
export class PostProcess {
  private buffer: HTMLCanvasElement | null = null;
  private impact = 0;
  private vignette: { key: string; value: CanvasGradient } | null = null;

  clear(): void {
    this.impact = 0;
  }

  triggerImpact(strength: number): void {
    this.impact = Math.max(this.impact, Math.max(0, Math.min(1, strength)));
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dt: number): void {
    if (width <= 0 || height <= 0) return;
    this.impact *= Math.exp(-dt * 5.2);

    const scale = Math.min(0.5, 560 / Math.max(width, height));
    const bw = Math.max(1, Math.round(width * scale));
    const bh = Math.max(1, Math.round(height * scale));
    if (!this.buffer) this.buffer = document.createElement("canvas");
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
    const glow = this.buffer.getContext("2d");
    if (glow) {
      glow.clearRect(0, 0, bw, bh);
      glow.drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, bw, bh);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.045 + this.impact * 0.085;
      ctx.filter = `blur(${8 + this.impact * 7}px) saturate(${1.18 + this.impact * 0.45})`;
      ctx.drawImage(this.buffer, 0, 0, bw, bh, 0, 0, width, height);

      if (this.impact > 0.025) {
        const shift = 1.5 + this.impact * 5;
        ctx.globalAlpha = this.impact * 0.065;
        ctx.filter = "hue-rotate(150deg) saturate(2.8)";
        ctx.drawImage(this.buffer, 0, 0, bw, bh, -shift, 0, width, height);
        ctx.filter = "hue-rotate(-75deg) saturate(2.8)";
        ctx.drawImage(this.buffer, 0, 0, bw, bh, shift, 0, width, height);
      }
      ctx.restore();
    }

    // Stały, delikatny grading spaja niebo, teren i efekty.
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "rgba(38,72,122,0.055)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const key = `${width}x${height}`;
    if (!this.vignette || this.vignette.key !== key) {
      const value = ctx.createRadialGradient(width / 2, height * 0.48, Math.min(width, height) * 0.2,
        width / 2, height * 0.48, Math.max(width, height) * 0.72);
      value.addColorStop(0, "rgba(3,8,16,0)");
      value.addColorStop(0.7, "rgba(3,8,16,0.035)");
      value.addColorStop(1, "rgba(3,8,16,0.20)");
      this.vignette = { key, value };
    }
    ctx.fillStyle = this.vignette.value;
    ctx.fillRect(0, 0, width, height);

    if (this.impact > 0.03) {
      ctx.fillStyle = `rgba(255,238,205,${(this.impact * 0.075).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
}
