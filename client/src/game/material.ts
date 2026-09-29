/** Shared, decoded paint tile. A failed asset leaves the procedural terrain available. */
export interface SoilPaint { pixels: Uint8ClampedArray; size: number }
let loading: Promise<SoilPaint | null> | null = null;
export function loadSoilPaint(): Promise<SoilPaint | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 768;
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(image, 0, 0, size, size);
        resolve({ pixels: ctx.getImageData(0, 0, size, size).data, size });
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = new URL("assets/soil-painted.webp", document.baseURI).href;
  });
  return loading;
}
