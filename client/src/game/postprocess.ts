/** A short impact pulse; all smoke and debris are cached sprites in world space. */
export class PostProcess {
  private impact = 0;
  clear(): void { this.impact = 0; }
  triggerImpact(strength: number): void {
    this.impact = Math.max(this.impact, Math.max(0, Math.min(1, strength)));
  }
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dt: number, _lowPower = false): void {
    this.impact *= Math.exp(-dt * 9);
    if (this.impact < .04) return;
    ctx.save();
    ctx.fillStyle = `rgba(255,231,190,${(this.impact * .045).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}
