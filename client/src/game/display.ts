type SafariNavigator = Navigator & { standalone?: boolean };
type WebkitFullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };

export function isStandaloneDisplay(): boolean {
  const standalone = typeof navigator !== "undefined" && (navigator as SafariNavigator).standalone === true;
  const displayMode = typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches;
  return standalone || displayMode;
}

export function fullscreenHelp(): string | null {
  if (isStandaloneDisplay()) return null;
  if (typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return "Na iPhonie: Udostępnij → Do ekranu początkowego, a potem uruchom grę z ikony.";
  }
  return null;
}

export async function enterFullscreen(): Promise<boolean> {
  if (isStandaloneDisplay()) return true;
  if (document.fullscreenElement) return true;
  const root = document.documentElement as WebkitFullscreenElement;
  const standard = root.requestFullscreen?.bind(root);
  const webkit = root.webkitRequestFullscreen?.bind(root);
  if (!standard && !webkit) return false;
  try {
    if (standard) await standard({ navigationUI: "hide" });
    else await webkit!();
  } catch {
    return false;
  }
  const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
  if (matchMedia("(any-pointer: coarse)").matches) {
    try { await orientation?.lock?.("landscape"); } catch { /* Rotation can remain under browser control. */ }
  }
  return true;
}
