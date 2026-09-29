import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terrain } from "@shared/engine/terrain";
import { TerrainRenderer } from "./terrainRenderer";

// The terrain painter writes pixels directly; no browser path API is needed.
class PixelCanvas {
  width = 0;
  height = 0;
  pixels: Uint8ClampedArray = new Uint8ClampedArray();
  getContext() {
    return {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: ImageData) => { this.pixels = image.data; },
    };
  }
}

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "http://localhost/", createElement: () => new PixelCanvas() });
  vi.stubGlobal("Image", class {
    onerror: (() => void) | null = null;
    set src(_value: string) { this.onerror?.(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

function ground(): Terrain {
  const terrain = new Terrain(960, 540);
  for (let y = 220; y < 540; y++) terrain.data.fill(1, y * 960, (y + 1) * 960);
  return terrain;
}
function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return (canvas as unknown as PixelCanvas).pixels;
}
function visiblePixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const result = pixels(canvas).slice();
  for (let i = 0; i < result.length; i += 4) if (!result[i + 3]) result.fill(0, i, i + 3);
  return result;
}

describe("painted terrain updates", () => {
  it("produces the same visible front and rear pixels as a full rebuild after overlapping craters", () => {
    const terrain = ground();
    const partial = new TerrainRenderer(terrain, "grass", 42);
    for (const [x, y, radius] of [[330, 224, 55], [374, 246, 44], [602, 292, 62], [80, 520, 35]]) {
      terrain.carveCircle(x, y, radius);
      partial.markDirty(x - radius, y - radius, radius * 2, radius * 2);
    }
    partial.update();
    const full = new TerrainRenderer(new Terrain(960, 540, terrain.data.slice()), "grass", 42);
    expect(Buffer.compare(Buffer.from(visiblePixels(partial.canvas)), Buffer.from(visiblePixels(full.canvas)))).toBe(0);
    expect(Buffer.compare(Buffer.from(visiblePixels(partial.backCanvas)), Buffer.from(visiblePixels(full.backCanvas)))).toBe(0);
  });

  it("keeps remote deep soil unchanged when a surface crater is painted", () => {
    const terrain = ground();
    const renderer = new TerrainRenderer(terrain, "grass", 7);
    const before = pixels(renderer.canvas).slice();
    terrain.carveCircle(320, 222, 45);
    renderer.markDirty(275, 177, 90, 90);
    renderer.update();
    const after = pixels(renderer.canvas);
    // A later full repaint must not invent diagonal shadows in solid soil.
    renderer.rebuildAll();
    const full = pixels(renderer.canvas);
    for (let y = 350; y < 500; y++) {
      const start = (y * 960 + 500) * 4, end = (y * 960 + 900) * 4;
      expect(Buffer.compare(Buffer.from(after.slice(start, end)), Buffer.from(before.slice(start, end)))).toBe(0);
      expect(Buffer.compare(Buffer.from(full.slice(start, end)), Buffer.from(before.slice(start, end)))).toBe(0);
    }
  });
});
