export async function enterFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  if (!document.documentElement.requestFullscreen) return false;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return false;
  }
  const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
  if (matchMedia("(any-pointer: coarse)").matches) {
    try { await orientation?.lock?.("landscape"); } catch { /* Rotation can remain under browser control. */ }
  }
  return true;
}
