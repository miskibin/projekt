import { joinRoom, selfId, type MessageAction, type Room } from "trystero";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { createRoomHost, type Peer, type RoomHost } from "@shared/host";
import type { ConnStatus, Transport } from "../net";

type WireC2S = { msgs: ClientMessage[] };
type WireS2C = { msgs: ServerMessage[] };
type WirePresence = { role: "probe" | "host" };

const APP_ID = "pl.miskibin.worms-online-v1";
const FLUSH_MS = 16;
const HOST_WAIT_MS = 12_000;

export class TrysteroTransport implements Transport {
  private room: Room | null = null;
  private host: RoomHost | null = null;
  private hostPeerId: string | null = null;
  private hostPeers = new Map<string, Peer>();
  private c2s: MessageAction<string> | null = null;
  private s2c: MessageAction<string> | null = null;
  private presence: MessageAction<string> | null = null;
  private lastHello: ClientMessage | null = null;
  private hostOut = new Map<string, ServerMessage[]>();
  private hostFlushTimer: number | null = null;
  private hostTimer: number | null = null;
  private hostWorker: Worker | null = null;
  private joinTimer: number | null = null;
  private msgCbs: ((msg: ServerMessage) => void)[] = [];
  private statusCbs: ((status: ConnStatus) => void)[] = [];

  async connect(): Promise<void> {
    this.statusCb("open");
    this.msgCb({ t: "welcome", playerId: selfId });
  }

  send(msg: ClientMessage): void {
    if (msg.t === "hello") this.lastHello = msg;
    if (msg.t === "createRoom") {
      this.createRoom(msg);
      return;
    }
    if (msg.t === "joinRoom") {
      this.joinExistingRoom(msg.code.toUpperCase().trim());
      return;
    }
    if (msg.t === "leaveRoom") {
      this.deliverToHost(msg);
      this.teardownRoom();
      return;
    }
    this.deliverToHost(msg);
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCbs.push(cb);
  }

  onStatus(cb: (status: ConnStatus) => void): void {
    this.statusCbs.push(cb);
  }

  close(): void {
    this.teardownRoom();
    this.statusCb("closed");
  }

  private createRoom(msg: Extract<ClientMessage, { t: "createRoom" }>): void {
    this.teardownRoom();
    this.statusCb("connecting");
    const host = createRoomHost();
    this.host = host;
    host.handleConnect(this.localPeer());
    if (this.lastHello) host.handleMessage(this.localPeer(), this.lastHello);
    host.handleMessage(this.localPeer(), msg);
    const code = host.roomCodes()[0];
    if (!code) {
      this.msgCb({ t: "error", message: "Nie udało się utworzyć pokoju" });
      this.teardownRoom();
      return;
    }

    this.openP2PRoom(code);
    this.c2s!.onMessage = (data, { peerId }) => {
      const { msgs } = JSON.parse(data) as WireC2S;
      const peer = this.ensureRemotePeer(peerId);
      for (const incoming of msgs) host.handleMessage(peer, incoming);
    };
    this.presence!.onMessage = (data, { peerId }) => {
      const { role } = JSON.parse(data) as WirePresence;
      if (role === "probe") void this.presence?.send(JSON.stringify({ role: "host" } satisfies WirePresence), { target: peerId });
    };
    this.room!.onPeerJoin = (peerId) => {
      this.ensureRemotePeer(peerId);
      void this.presence?.send(JSON.stringify({ role: "host" } satisfies WirePresence), { target: peerId });
    };
    this.room!.onPeerLeave = (peerId) => {
      const peer = this.hostPeers.get(peerId);
      if (peer) host.handleDisconnect(peer);
      this.hostPeers.delete(peerId);
    };
    this.startHostClock(() => host.tick(performance.now()));
    this.statusCb("open");
  }

  private joinExistingRoom(code: string): void {
    if (!/^[A-Z]{4}$/.test(code)) {
      this.msgCb({ t: "error", message: "Kod pokoju to 4 litery" });
      return;
    }
    this.teardownRoom();
    this.statusCb("connecting");
    this.openP2PRoom(code);

    const connectToHost = (peerId: string) => {
      if (this.hostPeerId) return;
      this.hostPeerId = peerId;
      if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
      this.joinTimer = null;
      this.statusCb("open");
      const msgs: ClientMessage[] = [];
      if (this.lastHello) msgs.push(this.lastHello);
      msgs.push({ t: "joinRoom", code });
      void this.c2s?.send(JSON.stringify({ msgs } satisfies WireC2S), { target: peerId });
    };

    this.presence!.onMessage = (data, { peerId }) => {
      const { role } = JSON.parse(data) as WirePresence;
      if (role === "host") connectToHost(peerId);
    };
    this.s2c!.onMessage = (data, { peerId }) => {
      const { msgs } = JSON.parse(data) as WireS2C;
      if (this.hostPeerId && peerId !== this.hostPeerId) return;
      if (!this.hostPeerId) connectToHost(peerId);
      for (const incoming of msgs) this.msgCb(incoming);
    };
    this.room!.onPeerJoin = (peerId) => {
      void this.presence?.send(JSON.stringify({ role: "probe" } satisfies WirePresence), { target: peerId });
    };
    this.room!.onPeerLeave = (peerId) => {
      if (peerId !== this.hostPeerId) return;
      this.msgCb({ t: "error", message: "Host opuścił pokój" });
      this.msgCb({ t: "leftRoom" });
      this.teardownRoom();
    };
    this.joinTimer = window.setTimeout(() => {
      this.joinTimer = null;
      if (this.hostPeerId) return;
      this.msgCb({ t: "error", message: `Pokój ${code} nie istnieje albo host jest offline` });
      this.teardownRoom();
      this.statusCb("open");
    }, HOST_WAIT_MS);
  }

  private openP2PRoom(code: string): void {
    const room = joinRoom({ appId: APP_ID }, code, {
      onJoinError: ({ error }) => {
        this.msgCb({ t: "error", message: `Błąd połączenia P2P: ${error}` });
        this.statusCb("closed");
      },
    });
    this.room = room;
    this.c2s = room.makeAction<string>("c2s");
    this.s2c = room.makeAction<string>("s2c");
    this.presence = room.makeAction<string>("presence");
  }

  private deliverToHost(msg: ClientMessage): void {
    if (this.host) {
      this.host.handleMessage(this.localPeer(), msg);
    } else if (this.hostPeerId) {
      void this.c2s?.send(JSON.stringify({ msgs: [msg] } satisfies WireC2S), { target: this.hostPeerId });
    } else if (msg.t !== "hello" && msg.t !== "ping") {
      this.msgCb({ t: "error", message: "Nie jesteś w pokoju" });
    }
  }

  private ensureRemotePeer(id: string): Peer {
    const existing = this.hostPeers.get(id);
    if (existing) return existing;
    const peer: Peer = {
      id,
      send: (msg) => {
        const queue = this.hostOut.get(id) ?? [];
        queue.push(msg);
        this.hostOut.set(id, queue);
        if (this.hostFlushTimer === null) {
          this.hostFlushTimer = window.setTimeout(() => this.flushHost(), FLUSH_MS);
        }
      },
    };
    this.hostPeers.set(id, peer);
    this.host?.handleConnect(peer);
    return peer;
  }

  private flushHost(): void {
    this.hostFlushTimer = null;
    const entries = [...this.hostOut.entries()];
    this.hostOut.clear();
    for (const [peerId, msgs] of entries) {
      void this.s2c?.send(JSON.stringify({ msgs } satisfies WireS2C), { target: peerId });
    }
  }

  private startHostClock(onTick: () => void): void {
    try {
      const url = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 16);"], { type: "text/javascript" }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = onTick;
      this.hostWorker = worker;
    } catch {
      this.hostTimer = window.setInterval(onTick, 16);
    }
  }

  private localPeer(): Peer {
    return { id: selfId, send: (msg) => this.msgCb(msg) };
  }

  private teardownRoom(): void {
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    if (this.hostFlushTimer !== null) window.clearTimeout(this.hostFlushTimer);
    if (this.hostTimer !== null) window.clearInterval(this.hostTimer);
    this.hostWorker?.terminate();
    void this.room?.leave();
    this.host?.destroy();
    this.room = null;
    this.host = null;
    this.hostPeerId = null;
    this.hostPeers.clear();
    this.hostOut.clear();
    this.c2s = null;
    this.s2c = null;
    this.presence = null;
    this.joinTimer = null;
    this.hostFlushTimer = null;
    this.hostTimer = null;
    this.hostWorker = null;
  }

  private msgCb(msg: ServerMessage): void {
    for (const cb of this.msgCbs) cb(msg);
  }

  private statusCb(status: ConnStatus): void {
    for (const cb of this.statusCbs) cb(status);
  }
}
