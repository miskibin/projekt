import mqtt, { type MqttClient } from "mqtt";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { createRoomHost, type Peer, type RoomHost } from "@shared/host";
import type { ConnStatus, Transport } from "../net";

type WireC2S = { msgs: ClientMessage[] };
type WireS2C = { msgs: ServerMessage[] };
type HostPresence = { peerId: string; at: number };

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_ROOT = "pl/miskibin/worms-online/v2";
const FLUSH_MS = 16;
const HOST_WAIT_MS = 12_000;
const HOST_HEARTBEAT_MS = 2_000;
const HOST_STALE_MS = 8_000;

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Browser-hosted game with a public TLS MQTT broker used only as its relay. */
export class TrysteroTransport implements Transport {
  private readonly peerId = randomId();
  private client: MqttClient | null = null;
  private host: RoomHost | null = null;
  private hostPeerId: string | null = null;
  private hostPeers = new Map<string, Peer>();
  private hostOut = new Map<string, ServerMessage[]>();
  private lastHello: ClientMessage | null = null;
  private roomCode: string | null = null;
  private role: "host" | "guest" | null = null;
  private hostFlushTimer: number | null = null;
  private hostTimer: number | null = null;
  private hostWorker: Worker | null = null;
  private joinTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private lastHostHeartbeat = 0;
  private msgCbs: ((msg: ServerMessage) => void)[] = [];
  private statusCbs: ((status: ConnStatus) => void)[] = [];
  private closedByUser = false;
  private welcomed = false;

  connect(): Promise<void> {
    if (this.client?.connected) return Promise.resolve();
    this.closedByUser = false;
    this.statusCb("connecting");
    const client = mqtt.connect(BROKER_URL, {
      clientId: `worms_${this.peerId}`,
      clean: true,
      keepalive: 20,
      connectTimeout: 10_000,
      reconnectPeriod: 1_500,
      resubscribe: true,
    });
    this.client = client;
    client.on("message", (topic, payload) => this.onBrokerMessage(topic, payload.toString()));
    client.on("reconnect", () => this.statusCb("reconnecting"));
    client.on("close", () => {
      if (!this.closedByUser) this.statusCb("reconnecting");
    });
    client.on("error", () => {
      if (!this.closedByUser) this.statusCb("reconnecting");
    });

    return new Promise((resolve) => {
      client.on("connect", () => {
        this.statusCb("open");
        if (!this.welcomed) {
          this.welcomed = true;
          this.msgCb({ t: "welcome", playerId: this.peerId });
          resolve();
        }
        if (this.role === "host") this.publishHostPresence();
      });
    });
  }

  send(msg: ClientMessage): void {
    if (msg.t === "hello") this.lastHello = msg;
    if (msg.t === "createRoom") return this.createRoom(msg);
    if (msg.t === "joinRoom") return this.joinExistingRoom(msg.code.toUpperCase().trim());
    if (msg.t === "leaveRoom") {
      this.deliverToHost(msg);
      this.teardownRoom();
      return;
    }
    this.deliverToHost(msg);
  }

  onMessage(cb: (msg: ServerMessage) => void): void { this.msgCbs.push(cb); }
  onStatus(cb: (status: ConnStatus) => void): void { this.statusCbs.push(cb); }

  close(): void {
    this.closedByUser = true;
    this.teardownRoom();
    this.client?.end(true);
    this.client = null;
    this.statusCb("closed");
  }

  private createRoom(msg: Extract<ClientMessage, { t: "createRoom" }>): void {
    this.teardownRoom();
    const host = createRoomHost();
    this.host = host;
    this.role = "host";
    host.handleConnect(this.localPeer());
    if (this.lastHello) host.handleMessage(this.localPeer(), this.lastHello);
    host.handleMessage(this.localPeer(), msg);
    const code = host.roomCodes()[0];
    if (!code) {
      this.msgCb({ t: "error", message: "Nie udało się utworzyć pokoju" });
      return this.teardownRoom();
    }
    this.roomCode = code;
    this.client?.subscribe(`${this.baseTopic()}/c2s/+`);
    this.publishHostPresence();
    this.heartbeatTimer = window.setInterval(() => this.publishHostPresence(), HOST_HEARTBEAT_MS);
    this.startHostClock(() => host.tick(performance.now()));
  }

  private joinExistingRoom(code: string): void {
    if (!/^[A-Z]{4}$/.test(code)) {
      this.msgCb({ t: "error", message: "Kod pokoju to 4 litery" });
      return;
    }
    this.teardownRoom();
    this.roomCode = code;
    this.role = "guest";
    const base = this.baseTopic();
    this.client?.subscribe([`${base}/host`, `${base}/s2c/${this.peerId}`]);
    this.joinTimer = window.setTimeout(() => {
      this.joinTimer = null;
      if (this.hostPeerId) return;
      this.msgCb({ t: "error", message: `Pokój ${code} nie istnieje albo host jest offline` });
      this.teardownRoom();
    }, HOST_WAIT_MS);
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.hostPeerId || Date.now() - this.lastHostHeartbeat <= HOST_STALE_MS) return;
      this.msgCb({ t: "error", message: "Host opuścił pokój" });
      this.msgCb({ t: "leftRoom" });
      this.teardownRoom();
    }, HOST_HEARTBEAT_MS);
  }

  private onBrokerMessage(topic: string, payload: string): void {
    if (!this.roomCode) return;
    const base = this.baseTopic();
    if (this.role === "guest" && topic === `${base}/host`) {
      if (!payload) {
        if (this.hostPeerId) {
          this.msgCb({ t: "error", message: "Host opuścił pokój" });
          this.msgCb({ t: "leftRoom" });
          this.teardownRoom();
        }
        return;
      }
      try {
        const presence = JSON.parse(payload) as HostPresence;
        if (Date.now() - presence.at > HOST_STALE_MS) return;
        this.lastHostHeartbeat = Date.now();
        if (!this.hostPeerId) this.connectToHost(presence.peerId);
      } catch { /* ignore malformed public-broker traffic */ }
      return;
    }

    if (this.role === "guest" && topic === `${base}/s2c/${this.peerId}`) {
      try {
        const { msgs } = JSON.parse(payload) as WireS2C;
        for (const msg of msgs) this.msgCb(msg);
      } catch { /* ignore malformed public-broker traffic */ }
      return;
    }

    const c2sPrefix = `${base}/c2s/`;
    if (this.role === "host" && topic.startsWith(c2sPrefix)) {
      const peerId = topic.slice(c2sPrefix.length);
      if (!peerId || peerId === this.peerId) return;
      try {
        const { msgs } = JSON.parse(payload) as WireC2S;
        const peer = this.ensureRemotePeer(peerId);
        for (const msg of msgs) this.host?.handleMessage(peer, msg);
      } catch { /* ignore malformed public-broker traffic */ }
    }
  }

  private connectToHost(peerId: string): void {
    this.hostPeerId = peerId;
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    this.joinTimer = null;
    const msgs: ClientMessage[] = [];
    if (this.lastHello) msgs.push(this.lastHello);
    msgs.push({ t: "joinRoom", code: this.roomCode! });
    this.publish(`${this.baseTopic()}/c2s/${this.peerId}`, { msgs } satisfies WireC2S);
  }

  private deliverToHost(msg: ClientMessage): void {
    if (this.host) this.host.handleMessage(this.localPeer(), msg);
    else if (this.hostPeerId && this.roomCode) {
      this.publish(`${this.baseTopic()}/c2s/${this.peerId}`, { msgs: [msg] } satisfies WireC2S);
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
        if (this.hostFlushTimer === null) this.hostFlushTimer = window.setTimeout(() => this.flushHost(), FLUSH_MS);
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
    if (!this.roomCode) return;
    for (const [peerId, msgs] of entries) {
      this.publish(`${this.baseTopic()}/s2c/${peerId}`, { msgs } satisfies WireS2C);
    }
  }

  private publishHostPresence(): void {
    if (this.role !== "host" || !this.roomCode) return;
    this.publish(`${this.baseTopic()}/host`, { peerId: this.peerId, at: Date.now() } satisfies HostPresence, true);
  }

  private publish(topic: string, payload: object, retain = false): void {
    this.client?.publish(topic, JSON.stringify(payload), { qos: 0, retain });
  }

  private baseTopic(): string { return `${TOPIC_ROOT}/${this.roomCode}`; }

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

  private localPeer(): Peer { return { id: this.peerId, send: (msg) => this.msgCb(msg) }; }

  private teardownRoom(): void {
    const base = this.roomCode ? this.baseTopic() : null;
    if (this.role === "host" && base) this.client?.publish(`${base}/host`, "", { retain: true });
    if (base) this.client?.unsubscribe([`${base}/host`, `${base}/c2s/+`, `${base}/s2c/${this.peerId}`]);
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    if (this.hostFlushTimer !== null) window.clearTimeout(this.hostFlushTimer);
    if (this.hostTimer !== null) window.clearInterval(this.hostTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.hostWorker?.terminate();
    this.host?.destroy();
    this.host = null;
    this.hostPeerId = null;
    this.hostPeers.clear();
    this.hostOut.clear();
    this.roomCode = null;
    this.role = null;
    this.joinTimer = null;
    this.hostFlushTimer = null;
    this.hostTimer = null;
    this.heartbeatTimer = null;
    this.hostWorker = null;
    this.lastHostHeartbeat = 0;
  }

  private msgCb(msg: ServerMessage): void { for (const cb of this.msgCbs) cb(msg); }
  private statusCb(status: ConnStatus): void { for (const cb of this.statusCbs) cb(status); }
}
