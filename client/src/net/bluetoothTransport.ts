import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { createRoomHost, handleRawMessage, type Peer, type RoomHost } from "@shared/host";
import type { ConnStatus, Transport } from "../net";

type Bridge = { postMessage(text: string): void };
type NativeEvent = { type: "listening" | "connected" | "disconnected" | "message" | "error"; data?: string };
type Packet = { type: "c2s" | "s2c"; msg: ClientMessage | ServerMessage };

declare global {
  interface Window {
    WormsBluetooth?: Bridge;
    __wormsBluetooth?: { onNative(text: string): void };
  }
}

/** Jedna para Androidów przez Bluetooth Classic/RFCOMM. Symulacja działa na telefonie hosta. */
export class BluetoothTransport implements Transport {
  private host: RoomHost | null = null;
  private readonly localPeer: Peer = { id: "local-player", send: (msg) => this.emit(msg) };
  private readonly guestPeer: Peer = { id: "bluetooth-guest", send: (msg) => this.nativeSend({ type: "s2c", msg }) };
  private role: "host" | "guest" | null = null;
  private hello: Extract<ClientMessage, { t: "hello" }> | null = null;
  private pendingRoom: string | null = null;
  private pendingCreate: Extract<ClientMessage, { t: "createRoom" }> | null = null;
  private connected = false;
  private status: ConnStatus = "closed";
  private callbacks: ((msg: ServerMessage) => void)[] = [];
  private statusCallbacks: ((status: ConnStatus) => void)[] = [];
  private clock: number | null = null;

  connect(): Promise<void> {
    if (!window.WormsBluetooth) {
      this.emit({ t: "error", message: "Bluetooth działa tylko w aplikacji Android." });
      this.setStatus("closed");
      return Promise.resolve();
    }
    window.__wormsBluetooth = { onNative: (text) => this.fromNative(text) };
    // Menu jest dostępne bez parowania; systemowe okno pojawia się dopiero po
    // naciśnięciu „Stwórz pokój” lub „Dołącz”.
    this.setStatus("open");
    this.emit({ t: "welcome", playerId: this.localPeer.id });
    return Promise.resolve();
  }

  send(msg: ClientMessage): void {
    if (msg.t === "hello") {
      this.hello = msg;
      if (this.role === "host" && this.host) this.host.handleMessage(this.localPeer, msg);
      else if (this.role === "guest" && this.connected) this.nativeSend({ type: "c2s", msg });
      return;
    }
    if (msg.t === "createRoom") {
      this.role = "host";
      this.pendingCreate = msg;
      this.pendingRoom = null;
      this.setStatus("connecting");
      window.WormsBluetooth?.postMessage(JSON.stringify({ op: "host" }));
      return;
    }
    if (msg.t === "joinRoom") {
      this.role = "guest";
      this.pendingRoom = msg.code.trim().toUpperCase();
      if (this.connected) this.joinConnected();
      else {
        this.setStatus("connecting");
        window.WormsBluetooth?.postMessage(JSON.stringify({ op: "join" }));
      }
      return;
    }
    if (msg.t === "leaveRoom") {
      if (this.role === "host") this.host?.handleMessage(this.localPeer, msg);
      else if (this.connected) this.nativeSend({ type: "c2s", msg });
      this.teardown();
      this.setStatus("open");
      return;
    }
    if (this.role === "host") this.host?.handleMessage(this.localPeer, msg, performance.now());
    else if (this.role === "guest" && this.connected) this.nativeSend({ type: "c2s", msg });
  }

  onMessage(cb: (msg: ServerMessage) => void): void { this.callbacks.push(cb); }
  onStatus(cb: (status: ConnStatus) => void): void { this.statusCallbacks.push(cb); cb(this.status); }

  close(): void {
    this.teardown();
    if (window.__wormsBluetooth) delete window.__wormsBluetooth;
    this.setStatus("closed");
  }

  private fromNative(text: string): void {
    let event: NativeEvent;
    try { event = JSON.parse(text) as NativeEvent; } catch { return; }
    if (event.type === "error") {
      this.emit({ t: "error", message: event.data || "Błąd połączenia Bluetooth" });
      this.setStatus("open");
      return;
    }
    if (event.type === "listening" && this.role === "host" && this.pendingCreate) {
      this.host?.destroy();
      this.host = createRoomHost({ maxRooms: 1 });
      this.host.handleConnect(this.localPeer);
      if (this.hello) this.host.handleMessage(this.localPeer, this.hello);
      this.host.handleMessage(this.localPeer, this.pendingCreate);
      this.pendingCreate = null;
      this.clock = window.setInterval(() => this.host?.tick(performance.now()), 1000 / 60);
      this.setStatus("open");
      return;
    }
    if (event.type === "connected") {
      this.connected = true;
      if (this.role === "host") this.host?.handleConnect(this.guestPeer, performance.now());
      else if (this.role === "guest") {
        this.setStatus("open");
      }
      return;
    }
    if (event.type === "disconnected") {
      this.connected = false;
      if (this.role === "host") this.host?.handleDisconnect(this.guestPeer, performance.now());
      else if (this.role === "guest") this.setStatus("reconnecting");
      return;
    }
    if (event.type === "message" && typeof event.data === "string" && event.data.length < 2_000_000) {
      let packet: Packet;
      try { packet = JSON.parse(event.data) as Packet; } catch { return; }
      if (this.role === "host" && packet.type === "c2s" && this.host)
        handleRawMessage(this.host, this.guestPeer, JSON.stringify(packet.msg), performance.now());
      else if (this.role === "guest" && packet.type === "s2c") this.emit(packet.msg as ServerMessage);
    }
  }

  private joinConnected(): void {
    if (!this.pendingRoom) return;
    if (this.hello) this.nativeSend({ type: "c2s", msg: this.hello });
    this.nativeSend({ type: "c2s", msg: { t: "joinRoom", code: this.pendingRoom } });
  }

  private nativeSend(packet: Packet): void {
    if (this.connected) window.WormsBluetooth?.postMessage(JSON.stringify({ op: "send", data: JSON.stringify(packet) }));
  }

  private teardown(): void {
    if (this.clock !== null) clearInterval(this.clock);
    this.clock = null;
    this.host?.destroy();
    this.host = null;
    this.connected = false;
    this.role = null;
    this.pendingCreate = null;
    this.pendingRoom = null;
    window.WormsBluetooth?.postMessage(JSON.stringify({ op: "stop" }));
  }

  private setStatus(status: ConnStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusCallbacks) cb(status);
  }

  private emit(msg: ServerMessage): void { for (const cb of this.callbacks) cb(msg); }
}
