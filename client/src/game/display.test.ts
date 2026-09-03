import { afterEach, describe, expect, it, vi } from "vitest";
import { enterFullscreen } from "./display";

afterEach(() => vi.unstubAllGlobals());

describe("fullscreen", () => {
  it("requests hidden browser navigation and landscape on a touch screen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", { documentElement: { requestFullscreen } });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
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
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("screen", { orientation: { lock: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
    expect(await enterFullscreen()).toBe(true);
  });
});
