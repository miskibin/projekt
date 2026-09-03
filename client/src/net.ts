import type { ClientMessage, ServerMessage } from "@shared/protocol";

export type ConnStatus = "connecting" | "open" | "closed" | "reconnecting";

/**
 * Warstwa transportowa – jedyny punkt styku klienta z siecią.
 * Implementacje: `WebSocketTransport` (self-host, serwer Node) oraz – docelowo –
 * `SupabaseTransport` (client/src/net/supabaseTransport.ts, dodawany osobno).
 * Reszta klienta nie wie, jakim kanałem lecą wiadomości; zna wyłącznie typy z shared/protocol.
 */
export interface Transport {
  connect(): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  onStatus(cb: (s: ConnStatus) => void): void;
  close(): void;
}

/** Buduje adres WebSocket z bieżącej lokalizacji (dev: proxy Vite na /ws). */
export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

/** Transport WebSocket z automatycznym reconnectem (backoff wykładniczy). */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private msgCbs: ((m: ServerMessage) => void)[] = [];
  private statusCbs: ((s: ConnStatus) => void)[] = [];
  private status: ConnStatus = "closed";
  private attempt = 0;
  private timer: number | null = null;
  private closedByUser = false;
  private everOpen = false;
  private firstOpen: (() => void) | null = null;

  constructor(private readonly url: string = wsUrl()) {}

  connect(): Promise<void> {
    this.closedByUser = false;
    const p = new Promise<void>((resolve) => {
      this.firstOpen = resolve;
    });
    this.open();
    return p;
  }

  private setStatus(s: ConnStatus): void {
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  private open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus(this.everOpen ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.everOpen = true;
      this.attempt = 0;
      this.setStatus("open");
      this.firstOpen?.();
      this.firstOpen = null;
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      for (const cb of this.msgCbs) cb(msg);
    };

    ws.onerror = () => {
      /* onclose i tak przyjdzie */
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) {
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.timer !== null) return;
    const delay = Math.min(15000, 500 * 2 ** this.attempt) + Math.random() * 250;
    this.attempt++;
    this.setStatus("reconnecting");
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: (m: ServerMessage) => void): void {
    this.msgCbs.push(cb);
  }

  onStatus(cb: (s: ConnStatus) => void): void {
    this.statusCbs.push(cb);
    cb(this.status);
  }

  close(): void {
    this.closedByUser = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }
}

/**
 * Nadbudowa nad dowolnym `Transport`: kolejka wiadomości wysłanych zanim kanał się otworzy,
 * pomiar RTT (ping/pong) i sygnał `onReady` po każdym (ponownym) otwarciu kanału –
 * to w nim klient wysyła `hello` + `joinRoom`. Nie zakładamy, że `welcome`/`roomState`
 * przyjdą synchronicznie po połączeniu.
 */
export class NetClient {
  private queue: ClientMessage[] = [];
  private handlers: ((m: ServerMessage) => void)[] = [];
  private statusHandlers: ((s: ConnStatus) => void)[] = [];
  private pingTimer: number | null = null;
  private wasOpen = false;

  status: ConnStatus = "closed";
  rtt = 0;
  /** wywoływane po (ponownym) otwarciu kanału; argument = czy to reconnect */
  onReady: ((reconnected: boolean) => void) | null = null;

  constructor(private readonly transport: Transport) {
    transport.onMessage((msg) => {
      if (msg && msg.t === "pong") {
        this.rtt = Math.max(0, Math.round(performance.now() - msg.ts));
        return;
      }
      for (const h of this.handlers) h(msg);
    });
    transport.onStatus((s) => {
      this.status = s;
      if (s === "open") {
        const reconnected = this.wasOpen;
        this.wasOpen = true;
        this.onReady?.(reconnected);
        const q = this.queue;
        this.queue = [];
        for (const m of q) this.transport.send(m);
        this.startPing();
      } else {
        this.stopPing();
      }
      for (const h of this.statusHandlers) h(s);
    });
  }

  connect(): Promise<void> {
    return this.transport.connect();
  }

  send(msg: ClientMessage): void {
    if (this.status === "open") {
      this.transport.send(msg);
    } else if (msg.t !== "ping" && msg.t !== "input") {
      // wejście gracza szybko się dezaktualizuje – nie ma sensu go kolejkować
      if (this.queue.length < 64) this.queue.push(msg);
    }
  }

  on(h: (m: ServerMessage) => void): void {
    this.handlers.push(h);
  }

  onStatus(h: (s: ConnStatus) => void): void {
    this.statusHandlers.push(h);
    h(this.status);
  }

  private startPing(): void {
    this.stopPing();
    const tick = () => this.transport.send({ t: "ping", ts: performance.now() });
    tick();
    this.pingTimer = window.setInterval(tick, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  close(): void {
    this.stopPing();
    this.transport.close();
  }
}
