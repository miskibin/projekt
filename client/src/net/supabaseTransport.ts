// Transport przez Supabase Realtime (broadcast + presence). Bez własnego serwera:
// gracz, który tworzy pokój, uruchamia logikę pokoju (shared/host) u siebie w przeglądarce,
// pozostali gracze rozmawiają z nim przez kanał `worms:<KOD>`.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { createRoomHost, type Peer, type RoomHost } from "@shared/host";

export type TransportStatus = "connecting" | "open" | "closed" | "reconnecting";

export interface Transport {
  connect(): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  onStatus(cb: (s: TransportStatus) => void): void;
  close(): void;
}

interface C2S {
  from: string;
  msgs: ClientMessage[];
}
interface S2C {
  to: string | "*";
  msgs: ServerMessage[];
}

const FLUSH_MS = 50; // batchowanie wiadomości → max 20 pakietów/s na peer
const HOST_WAIT_MS = 4000;

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export class SupabaseTransport implements Transport {
  private sb: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private host: RoomHost | null = null;
  private hostTimer: number | null = null;
  private hostWorker: Worker | null = null;
  private hostPeers = new Map<string, Peer>();
  private outQueue: ClientMessage[] = [];
  private flushTimer: number | null = null;
  private hostOut = new Map<string, ServerMessage[]>();
  private hostFlushTimer: number | null = null;
  private msgCbs: ((msg: ServerMessage) => void)[] = [];
  private statusCbs: ((s: TransportStatus) => void)[] = [];
  private lastHello: ClientMessage | null = null;
  private roomCode: string | null = null;
  readonly peerId = randomId();

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 60 } },
      auth: { persistSession: false },
    });
  }

  async connect(): Promise<void> {
    this.statusCb("open");
    this.msgCb({ t: "welcome", playerId: this.peerId });
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCbs.push(cb);
  }
  onStatus(cb: (s: TransportStatus) => void): void {
    this.statusCbs.push(cb);
  }

  private msgCb(msg: ServerMessage): void {
    for (const cb of this.msgCbs) cb(msg);
  }

  private statusCb(s: TransportStatus): void {
    for (const cb of this.statusCbs) cb(s);
  }

  send(msg: ClientMessage): void {
    if (msg.t === "hello") this.lastHello = msg;
    if (msg.t === "createRoom") {
      void this.createRoom(msg);
      return;
    }
    if (msg.t === "joinRoom") {
      const code = msg.code.toUpperCase().trim();
      // NetClient odtwarza członkostwo po sygnale open. Nie zamykaj wtedy kanału:
      // jego ponowne otwarcie wywołałoby kolejne joinRoom i pętlę reconnectów.
      if (this.channel && this.roomCode === code) {
        if (!this.host) this.deliverToHost({ t: "joinRoom", code });
        return;
      }
      void this.joinRoom(code);
      return;
    }
    if (msg.t === "leaveRoom") {
      this.deliverToHost(msg);
      this.teardownRoom();
      return;
    }
    this.deliverToHost(msg);
  }

  close(): void {
    this.teardownRoom();
    this.statusCb("closed");
  }

  // ---------- rola: gość ----------
  private deliverToHost(msg: ClientMessage): void {
    if (this.host) {
      // jesteśmy hostem – pętla lokalna
      this.host.handleMessage(this.localPeer(), msg);
      return;
    }
    if (!this.channel) {
      if (msg.t !== "hello" && msg.t !== "ping") this.msgCb({ t: "error", message: "Nie jesteś w pokoju" });
      return;
    }
    this.outQueue.push(msg);
    if (this.flushTimer === null) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null;
        const payload: C2S = { from: this.peerId, msgs: this.outQueue };
        this.outQueue = [];
        void this.channel?.send({ type: "broadcast", event: "c2s", payload });
      }, FLUSH_MS);
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (!/^[A-Z]{4}$/.test(code)) {
      this.msgCb({ t: "error", message: "Kod pokoju to 4 litery" });
      return;
    }
    this.teardownRoom();
    this.statusCb("connecting");
    const ch = this.openChannel(code, "guest");
    ch.on("broadcast", { event: "s2c" }, ({ payload }) => {
      const p = payload as S2C;
      if (p.to !== "*" && p.to !== this.peerId) return;
      for (const m of p.msgs) this.msgCb(m);
    });
    ch.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if ((leftPresences as { role?: string }[]).some((x) => x.role === "host")) {
        this.msgCb({ t: "error", message: "Host opuścił pokój" });
        this.msgCb({ t: "leftRoom" });
        this.teardownRoom();
      }
    });
    const ok = await this.subscribe(ch);
    if (!ok) return;
    const hostPresent = await this.waitForHost(ch);
    if (!hostPresent) {
      this.msgCb({ t: "error", message: `Pokój ${code} nie istnieje` });
      this.teardownRoom();
      return;
    }
    this.roomCode = code;
    this.statusCb("open");
    if (this.lastHello) this.outQueue.push(this.lastHello);
    this.deliverToHost({ t: "joinRoom", code });
  }

  private waitForHost(ch: RealtimeChannel): Promise<boolean> {
    return new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const state = ch.presenceState<{ role: string }>();
        const has = Object.values(state).some((arr) => arr.some((p) => p.role === "host"));
        if (has) return resolve(true);
        if (performance.now() - started > HOST_WAIT_MS) return resolve(false);
        window.setTimeout(check, 150);
      };
      check();
    });
  }

  // ---------- rola: host ----------
  private async createRoom(msg: Extract<ClientMessage, { t: "createRoom" }>): Promise<void> {
    this.teardownRoom();
    this.statusCb("connecting");
    const host = createRoomHost();
    this.host = host;
    // Lokalny gracz łączy się z hostem bez sieci.
    host.handleConnect(this.localPeer());
    if (this.lastHello) host.handleMessage(this.localPeer(), this.lastHello);
    host.handleMessage(this.localPeer(), msg);
    const code = host.roomCodes()[0];
    if (!code) {
      this.msgCb({ t: "error", message: "Nie udało się utworzyć pokoju" });
      this.teardownRoom();
      return;
    }
    this.roomCode = code;
    const ch = this.openChannel(code, "host");
    ch.on("broadcast", { event: "c2s" }, ({ payload }) => {
      const p = payload as C2S;
      let peer = this.hostPeers.get(p.from);
      if (!peer) {
        peer = this.remotePeer(p.from);
        this.hostPeers.set(p.from, peer);
        host.handleConnect(peer);
      }
      for (const m of p.msgs) host.handleMessage(peer, m);
    });
    ch.on("presence", { event: "leave" }, ({ leftPresences }) => {
      for (const lp of leftPresences as { peerId?: string }[]) {
        const peer = lp.peerId ? this.hostPeers.get(lp.peerId) : undefined;
        if (peer) {
          this.hostPeers.delete(peer.id);
          host.handleDisconnect(peer);
        }
      }
    });
    const ok = await this.subscribe(ch);
    if (!ok) {
      this.teardownRoom();
      return;
    }
    this.startHostClock(() => host.tick(performance.now()));
    this.statusCb("open");
  }

  /**
   * Zegar pętli hosta. Timery na głównym wątku są w tle karty dławione do 1 Hz,
   * więc tykanie idzie z Web Workera (nie podlega temu dławieniu); fallback: setInterval.
   */
  private startHostClock(onTick: () => void): void {
    try {
      const src = "setInterval(() => postMessage(0), 16);";
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = onTick;
      this.hostWorker = w;
    } catch {
      this.hostTimer = window.setInterval(onTick, 16);
    }
  }

  private localPeer(): Peer {
    return { id: this.peerId, send: (m) => this.msgCb(m) };
  }

  private remotePeer(id: string): Peer {
    return {
      id,
      send: (m) => {
        const q = this.hostOut.get(id) ?? [];
        q.push(m);
        this.hostOut.set(id, q);
        if (this.hostFlushTimer === null) {
          this.hostFlushTimer = window.setTimeout(() => this.flushHost(), FLUSH_MS);
        }
      },
    };
  }

  private flushHost(): void {
    this.hostFlushTimer = null;
    if (!this.channel) return;
    // Jeśli wszyscy dostają identyczny pakiet (typowe: snapshot/events), wyślij raz do "*".
    const entries = [...this.hostOut.entries()];
    this.hostOut.clear();
    if (entries.length === 0) return;
    const first = JSON.stringify(entries[0][1]);
    const allSame = entries.length === this.hostPeers.size && entries.every(([, q]) => JSON.stringify(q) === first);
    if (allSame) {
      void this.channel.send({ type: "broadcast", event: "s2c", payload: { to: "*", msgs: entries[0][1] } satisfies S2C });
      return;
    }
    for (const [to, msgs] of entries) {
      void this.channel.send({ type: "broadcast", event: "s2c", payload: { to, msgs } satisfies S2C });
    }
  }

  // ---------- wspólne ----------
  private openChannel(code: string, role: "host" | "guest"): RealtimeChannel {
    const ch = this.sb.channel(`worms:${code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.peerId } },
    });
    this.channel = ch;
    ch.on("system", {}, (ev) => {
      if (ev?.status === "error") this.statusCb("reconnecting");
    });
    // presence sync tylko do trzymania stanu; rola i peerId trackowane po subscribe
    void role;
    return ch;
  }

  private subscribe(ch: RealtimeChannel): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      ch.subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ peerId: this.peerId, role: this.host ? "host" : "guest" });
          if (!done) {
            done = true;
            resolve(true);
          } else {
            // Kanał wrócił po zerwaniu – realtime-js sam się przepiął, więc znów jesteśmy „open”.
            this.statusCb("open");
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (!done) {
            done = true;
            this.msgCb({ t: "error", message: `Błąd połączenia z Supabase: ${err?.message ?? status}` });
            resolve(false);
          } else {
            this.statusCb("reconnecting");
          }
        } else if (status === "CLOSED" && done) {
          this.statusCb("closed");
        }
      });
    });
  }

  private teardownRoom(): void {
    if (this.hostWorker) {
      this.hostWorker.terminate();
      this.hostWorker = null;
    }
    if (this.hostTimer !== null) {
      window.clearInterval(this.hostTimer);
      this.hostTimer = null;
    }
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.hostFlushTimer !== null) {
      window.clearTimeout(this.hostFlushTimer);
      this.hostFlushTimer = null;
    }
    this.host?.destroy();
    this.host = null;
    this.hostPeers.clear();
    this.hostOut.clear();
    this.outQueue = [];
    if (this.channel) {
      void this.sb.removeChannel(this.channel);
      this.channel = null;
    }
    this.roomCode = null;
  }

  get currentRoom(): string | null {
    return this.roomCode;
  }
}
