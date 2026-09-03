/** World scale is independent of the canvas backing resolution. */
export function viewportZoom(width: number, height: number): number {
  return Math.max(0.55, Math.min(1.35, width / 1280, height / 720));
}

export function canvasResolution(width: number, height: number, deviceRatio: number) {
  // Native phone/Retina resolution, with a bounded allocation on large 4K displays.
  const ratio = Math.min(Math.max(1, deviceRatio), Math.sqrt(8_388_608 / Math.max(1, width * height)));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}
