import { afterEach, describe, expect, it, vi } from "vitest";
import { enterFullscreen, fullscreenHelp, isStandaloneDisplay } from "./display";

afterEach(() => vi.unstubAllGlobals());

describe("fullscreen", () => {
  it("requests hidden browser navigation and landscape on a touch screen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", { documentElement: { requestFullscreen } });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: coarse)" }));
    vi.stubGlobal("screen", { orientation: { lock } });
    expect(await enterFullscreen()).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(lock).toHaveBeenCalledWith("landscape");
  });

  it("keeps the game usable when fullscreen is missing or denied", async () => {
    vi.stubGlobal("document", { documentElement: {} });
    expect(await enterFullscreen()).toBe(false);
    vi.stubGlobal("document", { documentElement: { requestFullscreen: vi.fn().mockRejectedValue(new Error("Denied")) } });
    expect(await enterFullscreen()).toBe(false);
  });

  it("keeps fullscreen when orientation lock is unavailable", async () => {
    vi.stubGlobal("document", { documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: coarse)" }));
    vi.stubGlobal("screen", { orientation: { lock: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
    expect(await enterFullscreen()).toBe(true);
  });

  it("uses the prefixed fullscreen API when available", async () => {
    const webkitRequestFullscreen = vi.fn();
    vi.stubGlobal("document", { documentElement: { webkitRequestFullscreen } });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("screen", { orientation: {} });
    expect(await enterFullscreen()).toBe(true);
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
  });

  it("recognises iOS standalone mode and explains Safari fullscreen", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone) Safari", standalone: false });
    expect(isStandaloneDisplay()).toBe(false);
    expect(fullscreenHelp()).toContain("Do ekranu początkowego");

    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone) Safari", standalone: true });
    expect(isStandaloneDisplay()).toBe(true);
    expect(fullscreenHelp()).toBeNull();
  });
});
