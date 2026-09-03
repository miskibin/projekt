import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetClient } from "../net";
import { SupabaseTransport } from "./supabaseTransport";

const realtime = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => realtime }));

function createChannel() {
  return {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn<(callback: (status: string) => Promise<void>) => void>(),
    track: vi.fn().mockResolvedValue("ok"),
    presenceState: () => ({ host: [{ role: "host" }] }),
    send: vi.fn().mockResolvedValue("ok"),
  };
}

describe("SupabaseTransport with NetClient", () => {
  let net: NetClient;
  let channel: ReturnType<typeof createChannel>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
    vi.clearAllMocks();
    channel = createChannel();
    realtime.channel.mockImplementation(() => createChannel()).mockReturnValueOnce(channel);
    const transport = new SupabaseTransport("https://example.supabase.co", "public-test-key");
    net = new NetClient(transport);
    // Tak jak main.ts: aplikacja odtwarza członkostwo w pokoju po sygnale open.
    net.onReady = (reconnected) => {
      net.send({ t: "hello", name: "Guest" });
      if (reconnected) net.send({ t: "joinRoom", code: "TEST" });
    };
    await net.connect();
    net.send({ t: "joinRoom", code: "TEST" });
    await channel.subscribe.mock.calls[0][0]("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    net.close();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the joined channel open and delivers readiness without a reconnect loop", async () => {
    expect(realtime.channel).toHaveBeenCalledTimes(1);
    expect(realtime.removeChannel).not.toHaveBeenCalled();
    expect(net.status).toBe("open");

    net.send({ t: "setReady", ready: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      event: "c2s",
      payload: expect.objectContaining({ msgs: expect.arrayContaining([{ t: "setReady", ready: true }]) }),
    }));
  });

  it("resends room membership after a real reconnect without replacing the channel", async () => {
    channel.send.mockClear();
    await channel.subscribe.mock.calls[0][0]("CHANNEL_ERROR");
    expect(net.status).toBe("reconnecting");
    await channel.subscribe.mock.calls[0][0]("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(100);

    expect(realtime.channel).toHaveBeenCalledTimes(1);
    expect(realtime.removeChannel).not.toHaveBeenCalled();
    expect(net.status).toBe("open");
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      event: "c2s",
      payload: expect.objectContaining({ msgs: expect.arrayContaining([{ t: "joinRoom", code: "TEST" }]) }),
    }));
  });

  it("replaces the channel when joining a different room", () => {
    net.send({ t: "joinRoom", code: "NEXT" });
    expect(realtime.channel).toHaveBeenCalledTimes(2);
    expect(realtime.channel).toHaveBeenLastCalledWith("worms:NEXT", expect.any(Object));
    expect(realtime.removeChannel).toHaveBeenCalledWith(channel);
  });
});
