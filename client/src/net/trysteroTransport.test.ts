import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import type { ServerMessage } from "@shared/protocol";
import { TrysteroTransport } from "./trysteroTransport";

type TestTransport = {
  client: MqttClient;
  role: "guest" | "host";
  roomCode: string;
  hostPeerId: string;
  peerId: string;
  hostOut: Map<string, ServerMessage[]>;
  send: TrysteroTransport["send"];
  onMessage: TrysteroTransport["onMessage"];
  onBrokerMessage(topic: string, payload: string): void;
  flushHost(): void;
  restoreRoomSubscriptions(): void;
};

function connected(role: "guest" | "host") {
  const transport = new TrysteroTransport() as unknown as TestTransport;
  const publish = vi.fn();
  const subscribe = vi.fn();
  transport.client = { connected: true, publish, subscribe } as unknown as MqttClient;
  transport.role = role;
  transport.roomCode = "TEST";
  return { transport, publish, subscribe };
}

describe("MQTT: dostarczanie gry", () => {
  it("po odświeżeniu tej samej karty zachowuje identyfikator gościa", () => {
    const entries = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    });
    try {
      const first = new TrysteroTransport() as unknown as TestTransport;
      const afterReload = new TrysteroTransport() as unknown as TestTransport;
      expect(afterReload.peerId).toBe(first.peerId);
      expect(first.peerId).toMatch(/^[a-f0-9]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ruch gościa wysyła z QoS 1 i subskrybuje wiadomości z QoS 1", () => {
    const { transport, publish, subscribe } = connected("guest");
    transport.hostPeerId = "host";
    transport.send({ t: "input", seq: 3, state: { left: false, right: true, aim: 0, charge: false } });
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("/c2s/"),
      expect.stringContaining('"seq":3'), expect.objectContaining({ qos: 1 }));
    // Po wznowieniu subskrypcja musi przyjmować pakiety z QoS 1, inaczej publikacja nie wystarczy.
    transport.restoreRoomSubscriptions();
    expect(subscribe).toHaveBeenCalledWith(expect.any(Array), { qos: 1 }, expect.any(Function));
  });

  it("zdarzenia zmieniające teren są niezawodne, snapshoty mogą być zastąpione nowszymi", () => {
    const { transport, publish } = connected("host");
    transport.hostOut = new Map([["guest", [{ t: "events", events: [] }]]]);
    transport.flushHost();
    expect(publish).toHaveBeenLastCalledWith(expect.stringContaining("/s2c/guest"),
      expect.any(String), expect.objectContaining({ qos: 1 }));
    transport.hostOut = new Map([["guest", [{ t: "snapshot", snapshot: {} as never }]]]);
    transport.flushHost();
    expect(publish).toHaveBeenLastCalledWith(expect.stringContaining("/s2c/guest"),
      expect.any(String), expect.objectContaining({ qos: 0 }));
  });

  it("nie powtarza zdarzeń, gdy broker dostarczy tę samą paczkę dwa razy", () => {
    const { transport } = connected("guest");
    const received = vi.fn();
    transport.onMessage(received);
    const batch = JSON.stringify({ id: 9, msgs: [{ t: "events", events: [] }] });
    const topic = `pl/miskibin/worms-online/v2/TEST/s2c/${transport.peerId}`;
    transport.onBrokerMessage(topic, batch);
    transport.onBrokerMessage(topic, batch);
    expect(received).toHaveBeenCalledTimes(1);
  });
});
