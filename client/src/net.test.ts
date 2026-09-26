import { describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { NetClient, type ConnStatus, type Transport } from "./net";

describe("ponowne połączenie", () => {
  it("nie odtwarza po odzyskaniu sieci starego strzału, celu ani sterowania", () => {
    vi.stubGlobal("window", { setInterval: () => 1 });
    const sent: ClientMessage[] = [];
    let status: ((s: ConnStatus) => void) | null = null;
    const transport: Transport = {
      connect: async () => {},
      send: (m) => { sent.push(m); },
      onMessage: (_cb: (m: ServerMessage) => void) => {},
      onStatus: (cb) => { status = cb; },
      close: () => {},
    };
    const client = new NetClient(transport);
    client.send({ t: "joinRoom", code: "ABCD" });
    client.send({ t: "input", state: { left: true, right: false, aim: 0, charge: false } });
    client.send({ t: "action", action: { kind: "fire", power: 1 } });
    client.send({ t: "action", action: { kind: "target", x: 250, y: 300 } });
    if (!status) throw new Error("Brak callbacka transportu");
    (status as (s: ConnStatus) => void)("open");
    expect(sent.some((m) => m.t === "joinRoom")).toBe(true);
    expect(sent.some((m) => m.t === "action" || m.t === "input")).toBe(false);
    client.close();
    vi.unstubAllGlobals();
  });
});
