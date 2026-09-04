import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { describe, expect, it } from "vitest";
import { Camera } from "./camera";

/** Przewija symulację kamery ~`seconds` sekund w krokach po 1/60 s. */
function settle(camera: Camera, seconds = 8): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) camera.update(1 / 60);
}

function landscape(): Camera {
  const camera = new Camera();
  camera.setViewport(1280, 720);
  return camera;
}

describe("kamera", () => {
  it("domyślnie pokazuje całą szerokość mapy", () => {
    const camera = landscape();
    camera.overview(undefined, undefined, true);
    expect(camera.zoom).toBeCloseTo(1280 / WORLD_WIDTH, 5);
    const view = camera.viewRect();
    expect(view.w).toBeCloseTo(WORLD_WIDTH, 3);
    expect(view.x).toBeCloseTo(0, 3);
    // dół świata (woda) na dole ekranu, niebo powyżej
    expect(view.y + view.h).toBeCloseTo(WORLD_HEIGHT, 3);
  });

  it("nigdy nie oddala się poza krawędzie świata", () => {
    const camera = landscape();
    for (let i = 0; i < 20; i++) camera.zoomBy(0.5);
    settle(camera);
    expect(camera.zoom).toBeCloseTo(camera.fitZoom, 5);
    const view = camera.viewRect();
    expect(view.w).toBeLessThanOrEqual(WORLD_WIDTH + 0.001);
    expect(camera.zoom).toBeLessThanOrEqual(camera.maxZoom + 1e-9);
    for (let i = 0; i < 40; i++) camera.zoomBy(1.5);
    settle(camera);
    expect(camera.zoom).toBeCloseTo(camera.maxZoom, 3);
    expect(camera.maxZoom).toBeCloseTo(Math.min(3 * camera.fitZoom, 2.5), 5);
  });

  it("na telefonie w pionie skaluje do wysokości, żeby robaki były czytelne", () => {
    const camera = new Camera();
    camera.setViewport(390, 844);
    expect(camera.fitZoom).toBeGreaterThan(390 / WORLD_WIDTH);
    // widać wycinek mapy, a nie całe 1920 px świata
    expect(camera.viewRect().w).toBeLessThan(800);
  });

  it("auto-focus zbliża na aktywnego robaka i trzyma go poniżej środka ekranu", () => {
    const camera = landscape();
    camera.overview(undefined, undefined, true);
    const before = camera.zoom;
    camera.focus(900, 700);
    settle(camera);
    expect(camera.zoom).toBeGreaterThan(before * 1.15);
    expect(camera.zoom).toBeCloseTo(camera.focusZoom, 3);
    const s = camera.worldToScreen(900, 700);
    expect(s.x).toBeCloseTo(camera.viewW / 2, 1);
    expect(s.y).toBeGreaterThan(camera.viewH * 0.5);
    expect(s.y).toBeLessThan(camera.viewH * 0.65);
  });

  it("śledzi pocisk z wyprzedzeniem i szerszym kadrem niż robaka", () => {
    const camera = landscape();
    camera.focus(600, 650, camera.focusZoom, true);
    const wormZoom = camera.zoom;
    camera.trackProjectile(800, 500, 400, -120, true);
    expect(camera.zoom).toBeLessThan(wormZoom);
    expect(camera.x).toBeGreaterThan(800);
    expect(camera.y).toBeLessThan(500);
    const projectile = camera.worldToScreen(800, 500);
    expect(projectile.x).toBeLessThan(camera.viewW / 2);
    expect(projectile.y).toBeGreaterThan(camera.viewH / 2);
  });

  it("kadrowanie dwóch odległych punktów oddala tak, żeby oba były widoczne", () => {
    const camera = landscape();
    camera.focus(900, 800);
    settle(camera);
    const zoomed = camera.zoom;
    camera.frame([
      { x: 200, y: 900 },
      { x: 1700, y: 500 },
    ]);
    settle(camera);
    expect(camera.zoom).toBeLessThan(zoomed);
    for (const p of [
      { x: 200, y: 900 },
      { x: 1700, y: 500 },
    ]) {
      const s = camera.worldToScreen(p.x, p.y);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(camera.viewW);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(camera.viewH);
    }
  });

  it("blisko siebie leżące punkty nie zbliżają bardziej niż focus", () => {
    const camera = landscape();
    camera.frame([
      { x: 900, y: 800 },
      { x: 930, y: 790 },
    ]);
    settle(camera);
    expect(camera.zoom).toBeCloseTo(camera.focusZoom, 3);
  });

  it("przy krawędziach utrzymuje śledzony obiekt wewnątrz kadru", () => {
    const camera = landscape();
    camera.focus(0, 1050);
    settle(camera);
    let view = camera.viewRect();
    let point = camera.worldToScreen(0, 1050);
    expect(point.x).toBeGreaterThan(camera.viewW * 0.12);
    expect(point.x).toBeLessThan(camera.viewW * 0.3);
    expect(view.x).toBeGreaterThan(-view.w * 0.4);
    camera.focus(WORLD_WIDTH, 0);
    settle(camera);
    view = camera.viewRect();
    point = camera.worldToScreen(WORLD_WIDTH, 0);
    expect(point.x).toBeGreaterThan(camera.viewW * 0.7);
    expect(point.x).toBeLessThan(camera.viewW * 0.88);
    expect(view.x + view.w).toBeLessThan(WORLD_WIDTH + view.w * 0.4);
    expect(view.y).toBeGreaterThanOrEqual(-200 - 0.001);
  });

  it("zoom kółkiem trzyma punkt pod kursorem i włącza tryb ręczny", () => {
    const camera = landscape();
    camera.overview(undefined, undefined, true);
    const world = { x: 1200, y: 700 };
    const cursor = camera.worldToScreen(world.x, world.y);
    camera.zoomBy(1.5, world.x, world.y);
    expect(camera.manual).toBe(true);
    for (let i = 0; i < 10; i++) {
      camera.update(1 / 60);
      const s = camera.worldToScreen(world.x, world.y);
      expect(s.x).toBeCloseTo(cursor.x, 3);
      expect(s.y).toBeCloseTo(cursor.y, 3);
    }
    settle(camera);
    expect(camera.zoom).toBeCloseTo(1.5 * camera.fitZoom, 3);
    const s = camera.worldToScreen(world.x, world.y);
    expect(s.x).toBeCloseTo(cursor.x, 3);
    expect(s.y).toBeCloseTo(cursor.y, 3);
  });

  it("w trybie ręcznym auto-kadrowanie milczy aż do resetManual", () => {
    const camera = landscape();
    camera.panBy(-200, 0);
    expect(camera.manual).toBe(true);
    const x = camera.x;
    camera.focus(1800, 900);
    camera.frame([{ x: 100, y: 100 }]);
    camera.overview();
    settle(camera, 1);
    expect(camera.x).toBeCloseTo(x, 3);
    camera.resetManual();
    camera.focus(1500, 900);
    settle(camera);
    expect(camera.x).toBeGreaterThan(x);
  });

  it("zerknięcie na eksplozję jest chwilowe i wraca do kadru", () => {
    const camera = landscape();
    camera.focus(900, 800);
    settle(camera);
    const base = camera.x;
    camera.glance(1600, 800, 0.5);
    camera.focus(900, 800);
    camera.update(0.1);
    expect(camera.x).toBeGreaterThan(base);
    for (let i = 0; i < 240; i++) {
      camera.focus(900, 800);
      camera.update(1 / 60);
    }
    expect(camera.x).toBeCloseTo(base, 1);
  });

  it("wstrząs jest odczuwalny przy oddaleniu i pozostaje ograniczony", () => {
    const camera = landscape();
    camera.overview(undefined, undefined, true);
    camera.shake(20);
    let maxOut = 0;
    for (let i = 0; i < 60; i++) {
      camera.update(1 / 60);
      const view = camera.viewRect();
      maxOut = Math.max(maxOut, -view.x, view.x + view.w - WORLD_WIDTH);
    }
    expect(maxOut).toBeGreaterThan(0); // widać, że trzęsie
    expect(maxOut * camera.zoom).toBeLessThanOrEqual(24);
  });

  it("wymuszony focus odzyskuje śledzenie poruszającego się robaka", () => {
    const camera = landscape();
    camera.panBy(-200, 0);
    expect(camera.manual).toBe(true);
    camera.focus(1500, 760, undefined, false, true);
    settle(camera, 1);
    expect(camera.manual).toBe(false);
    expect(camera.x).toBeGreaterThan(1200);
  });

  it("wstrząs szybko wygasa i nie dominuje nad kamerą", () => {
    const camera = landscape();
    camera.focus(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, undefined, true);
    const base = camera.worldToScreen(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    camera.shake(30);
    camera.update(1 / 60);
    const shaken = camera.worldToScreen(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    expect(Math.hypot(shaken.x - base.x, shaken.y - base.y)).toBeLessThanOrEqual(24);
    for (let i = 0; i < 48; i++) camera.update(1 / 60);
    const settled = camera.worldToScreen(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    expect(Math.hypot(settled.x - base.x, settled.y - base.y)).toBeLessThan(0.2);
  });
});
