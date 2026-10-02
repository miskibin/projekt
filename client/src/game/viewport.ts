import { WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";

/**
 * Jaka część wysokości świata ma wypełnić ekran na wąskich (pionowych) ekranach.
 * Na telefonie w pionie dopasowanie do szerokości mapy (1920) zrobiłoby z robaków
 * mrówki, więc tam skalujemy raczej do wysokości: widać ~1/1.33 świata w pionie
 * (reszta to niebo/woda dorysowywane poza granicami świata) i wycinek w poziomie.
 */
const PORTRAIT_FILL = 0.75;

/** Karty drużyn zajmują miejsce tylko wtedy, gdy pole gry ma rozmiar dużego ekranu. */
export function showTeamCards(width: number, height: number): boolean {
  return width >= 1100 && height >= 600;
}

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

export function canvasResolution(width: number, height: number, deviceRatio: number, touch = false) {
  // Repainting a 3x full-screen canvas 60 times/s heats up phones quickly.
  // Keep CSS/world coordinates unchanged while capping only the backing store.
  const pixels = touch ? 3_200_000 : 8_388_608;
  const ratio = Math.min(Math.max(1, deviceRatio), touch ? 2.25 : 3,
    Math.sqrt(pixels / Math.max(1, width * height)));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}
