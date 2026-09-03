import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";

/**
 * Jaka część wysokości świata ma wypełnić ekran na wąskich (pionowych) ekranach.
 * Na telefonie w pionie dopasowanie do szerokości mapy (1920) zrobiłoby z robaków
 * mrówki, więc tam skalujemy raczej do wysokości: widać ~1/1.33 świata w pionie
 * (reszta to niebo/woda dorysowywane poza granicami świata) i wycinek w poziomie.
 */
const PORTRAIT_FILL = 0.75;

/**
 * Zoom „przeglądowy” (overview): najmniejsze dopuszczalne zbliżenie.
 * Na ekranach poziomych = cała szerokość mapy mieści się na ekranie
 * (`width / WORLD_WIDTH`), więc nigdy nie widać pustki obok krawędzi świata.
 * Na ekranach pionowych wygrywa człon wysokościowy, żeby gra pozostała czytelna.
 * Skala świata jest niezależna od rozdzielczości bufora canvasa (DPR).
 */
export function viewportZoom(width: number, height: number): number {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return Math.max(w / WORLD_WIDTH, (h / WORLD_HEIGHT) * PORTRAIT_FILL);
}

export function canvasResolution(width: number, height: number, deviceRatio: number) {
  // Native phone/Retina resolution, with a bounded allocation on large 4K displays.
  const ratio = Math.min(Math.max(1, deviceRatio), Math.sqrt(8_388_608 / Math.max(1, width * height)));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}
