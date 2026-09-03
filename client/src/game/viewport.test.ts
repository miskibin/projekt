import { WORLD_WIDTH } from "@shared/constants";
import { describe, expect, it } from "vitest";
import { Camera } from "./camera";
import { canvasResolution, viewportZoom } from "./viewport";

describe("responsive game canvas", () => {
  it("uses phone DPR 3 for a crisp canvas without enlarging the interface", () => {
    expect(canvasResolution(830, 360, 3)).toEqual({ width: 2490, height: 1080 });
    expect(canvasResolution(1280, 720, 1)).toEqual({ width: 1280, height: 720 });
    const large = canvasResolution(3840, 2160, 3);
    expect(large.width * large.height).toBeLessThan(8_400_000);
    expect(large.width / large.height).toBeCloseTo(16 / 9, 2);
  });

  it("fits the whole map width on landscape screens", () => {
    const camera = new Camera();
    camera.setViewport(830, 360);
    expect(camera.zoom).toBeCloseTo(viewportZoom(830, 360));
    expect(camera.viewRect().w).toBeCloseTo(WORLD_WIDTH, 3);
    camera.setViewport(1280, 720);
    expect(camera.zoom).toBeCloseTo(1280 / WORLD_WIDTH);
    expect(camera.viewRect().w).toBeCloseTo(WORLD_WIDTH, 3);
    const screen = camera.worldToScreen(900, 600);
    const world = camera.screenToWorld(screen.x, screen.y);
    expect(world.x).toBeCloseTo(900);
    expect(world.y).toBeCloseTo(600);
  });

  it("keeps the relative zoom level when the phone is rotated", () => {
    const camera = new Camera();
    camera.setViewport(390, 844);
    camera.zoomBy(2); // gracz przybliżył 2× ponad widok przeglądowy
    camera.update(2);
    const relative = camera.zoom / camera.fitZoom;
    camera.setViewport(844, 390);
    expect(camera.zoom / camera.fitZoom).toBeCloseTo(relative, 3);
    camera.setViewport(390, 844);
    expect(camera.zoom / camera.fitZoom).toBeCloseTo(relative, 3);
  });
});
