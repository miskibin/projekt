import "./styles.css";
import type { ClientMessage, GameConfig, ServerMessage } from "@shared/protocol";
import { NetClient, WebSocketTransport, wsUrl, type ConnStatus, type Transport } from "./net";
import { GameClient } from "./game/client";
import { demoRoom } from "./game/demo";
import { Sound } from "./game/sound";
import { Lobby } from "./lobby";

/**
 * Leniwy transport: rejestruje callbacki od razu, a prawdziwą implementację ładuje dopiero
 * przy `connect()`. Dzięki temu ciężki transport (Supabase) trafia do osobnego chunku,
 * a reszta klienta widzi wyłącznie interfejs `Transport`.
 */
class LazyTransport implements Transport {
  private inner: Transport | null = null;
  private closed = false;
  private msgCbs: ((m: ServerMessage) => void)[] = [];
  private statusCbs: ((s: ConnStatus) => void)[] = [];

  constructor(private readonly load: () => Promise<Transport>) {}

  async connect(): Promise<void> {
    this.closed = false;
    if (!this.inner) {
      const t = await this.load();
      if (this.closed) return;
      this.inner = t;
      for (const cb of this.msgCbs) t.onMessage(cb);
      for (const cb of this.statusCbs) t.onStatus(cb);
    }
    await this.inner.connect();
  }

  send(m: ClientMessage): void {
    this.inner?.send(m);
  }

  onMessage(cb: (m: ServerMessage) => void): void {
    this.msgCbs.push(cb);
    this.inner?.onMessage(cb);
  }

  onStatus(cb: (s: ConnStatus) => void): void {
    this.statusCbs.push(cb);
    this.inner?.onStatus(cb);
  }

  close(): void {
    this.closed = true;
    this.inner?.close();
  }
}

/** Wybór per link: serwer na Render lub pierwotny MQTT z symulacją na telefonie hosta. */
const TRANSPORT_MODE = (() => {
  const configured = (import.meta.env as unknown as Record<string, string | undefined>).VITE_TRANSPORT;
  const requested = new URLSearchParams(location.search).get("transport");
  const serverAvailable = configured === "ws";
  return requested === "mqtt" || !serverAvailable ? "mqtt" : "ws";
})();

export function createTransport(): Transport {
  return TRANSPORT_MODE === "ws"
    ? new WebSocketTransport(wsUrl())
    : new LazyTransport(async () => new (await import("./net/trysteroTransport")).TrysteroTransport());
}

type Screen = "menu" | "lobby" | "game";

const params = new URLSearchParams(location.search);
let COMPUTER = params.get("computer") === "1";
let DEMO = params.get("demo") === "1" || COMPUTER;
const DEMO_LOBBY = params.get("demoLobby") === "1";
const DEBUG = params.get("debug") === "1";
const ROOM_PARAM = (params.get("room") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
function roomUrl(code: string): string {
  const search = new URLSearchParams({ room: code });
  if (TRANSPORT_MODE === "mqtt") search.set("transport", "mqtt");
  return `${location.pathname}?${search}`;
}
function menuUrl(): string {
  return `${location.pathname}${TRANSPORT_MODE === "mqtt" ? "?transport=mqtt" : ""}`;
}
// Jedna karta zachowuje tożsamość przez odświeżenie i zmianę WebSocket.
const reconnectToken = (() => {
  const makeToken = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Na lokalnym HTTP randomUUID może być niedostępne (brak secure context).
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  try {
    const saved = sessionStorage.getItem("worms.reconnectToken");
    if (saved && /^[a-f0-9-]{36}$/i.test(saved)) return saved;
    const token = makeToken();
    sessionStorage.setItem("worms.reconnectToken", token);
    return token;
  } catch {
    return makeToken();
  }
})();

const el = {
  menu: byId("screen-menu"),
  lobby: byId("screen-lobby"),
  game: byId("screen-game"),
  nick: byId<HTMLInputElement>("nick"),
  create: byId<HTMLButtonElement>("btn-create"),
  join: byId<HTMLButtonElement>("btn-join"),
  joinCode: byId<HTMLInputElement>("join-code"),
  connDot: byId("conn-dot"),
  connText: byId("conn-text"),
  toasts: byId("toasts"),
};

const serverChoice = byId<HTMLElement>("transport-ws-option");
if ((import.meta.env as unknown as Record<string, string | undefined>).VITE_TRANSPORT !== "ws") serverChoice.hidden = true;
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="transport"]')) {
  radio.checked = radio.value === TRANSPORT_MODE;
  radio.addEventListener("change", () => {
    if (!radio.checked || radio.value === TRANSPORT_MODE) return;
    location.assign(`${location.pathname}${radio.value === "mqtt" ? "?transport=mqtt" : ""}`);
  });
}

// ---------------- toasty ----------------
function toast(text: string, kind: "info" | "err" | "ok" = "info", ms = 4200): void {
  const t = document.createElement("div");
  t.className = `toast ${kind === "err" ? "err" : kind === "ok" ? "ok" : ""}`;
  t.textContent = text;
  el.toasts.appendChild(t);
  window.setTimeout(() => {
    t.classList.add("fade");
    window.setTimeout(() => t.remove(), 350);
  }, ms);
}

// ---------------- stan aplikacji ----------------
let screen: Screen = "menu";
let playerId = "";
let roomCode = "";
let inGame = false;
/** Otwarty ekran wyników – wtedy NIE wracamy automatycznie do lobby po `roomState`. */
let gameOverOpen = false;

const sound = new Sound();

function showScreen(s: Screen): void {
  screen = s;
  el.menu.classList.toggle("active", s === "menu");
  el.lobby.classList.toggle("active", s === "lobby");
  el.game.classList.toggle("active", s === "game");
}

function nick(): string {
  return el.nick.value.trim().slice(0, 16);
}

function saveNick(): void {
  localStorage.setItem("worms.nick", nick());
}

el.nick.value = localStorage.getItem("worms.nick") ?? "";
if (ROOM_PARAM) el.joinCode.value = ROOM_PARAM;

// ---------------- sieć ----------------
const net = new NetClient(createTransport());
const lobby = new Lobby({
  send: (m) => net.send(m),
  leave: () => {
    net.send({ t: "leaveRoom" });
    roomCode = "";
    inGame = false;
    gameOverOpen = false;
    game.stop();
    showScreen("menu");
  },
  toast,
});

const game = new GameClient(sound, {
  send: (m) => net.send(m),
  leaveRoom: () => {
    if (DEMO) {
      location.assign(location.pathname);
      return;
    }
    net.send({ t: "leaveRoom" });
    roomCode = "";
    inGame = false;
    gameOverOpen = false;
    game.stop();
    showScreen("menu");
  },
  backToLobby: () => {
    if (DEMO) {
      location.assign(location.pathname);
      return;
    }
    inGame = false;
    gameOverOpen = false;
    game.stop();
    showScreen(roomCode ? "lobby" : "menu");
  },
  rtt: () => net.rtt,
  connected: () => net.status === "open",
  toast,
});

let warnedOffline = false;
net.onStatus((s: ConnStatus) => {
  const label: Record<ConnStatus, string> = {
    connecting: "Łączenie z serwerem…",
    open: "Połączono",
    closed: "Rozłączono",
    reconnecting: "Utracono połączenie – ponawiam…",
  };
  el.connText.textContent = label[s];
  el.connDot.className = `dot ${s === "open" ? "ok" : s === "reconnecting" || s === "closed" ? "bad" : ""}`;
  el.create.disabled = s !== "open";
  el.join.disabled = s !== "open";
  lobby.setConnection(s === "open" ? "połączono" : label[s], s !== "open");
  if (s === "reconnecting" && !DEMO && !warnedOffline) {
    warnedOffline = true;
    toast("Utracono połączenie – próbuję połączyć ponownie…", "err");
  }
  if (s === "open") warnedOffline = false;
});

net.onReady = (reconnected) => {
  if (DEMO) return;
  const name = nick();
  if (name) net.send({ t: "hello", name, reconnectToken });
  if (reconnected) {
    toast("Połączono ponownie", "ok");
    if (roomCode) {
      net.send({ t: "joinRoom", code: roomCode });
      if (inGame) net.send({ t: "requestTerrainSync" });
    }
  } else if (ROOM_PARAM && name) {
    roomCode = ROOM_PARAM;
    net.send({ t: "joinRoom", code: ROOM_PARAM });
  }
};

net.on((msg: ServerMessage) => handle(msg));

function handle(msg: ServerMessage): void {
  if (DEMO) return;
  switch (msg.t) {
    case "welcome":
      playerId = msg.playerId;
      break;

    case "error":
      toast(msg.message, "err");
      if (msg.message.startsWith("Nie ma pokoju o kodzie ")) {
        roomCode = "";
        inGame = false;
        game.stop();
        history.replaceState(null, "", menuUrl());
        showScreen("menu");
      }
      break;

    case "roomState": {
      roomCode = msg.room.code;
      lobby.setRoom(msg.room, playerId);
      if (msg.room.phase === "lobby") {
        // Po zakończonej grze host od razu przestawia pokój na "lobby"; nie wyrzucamy
        // wtedy gracza z ekranu wyników – zrobi to przycisk „Wróć do lobby”.
        if (!gameOverOpen) {
          inGame = false;
          game.stop();
          showScreen("lobby");
        }
      } else if (!inGame && screen !== "game") {
        showScreen("lobby");
      }
      const url = roomUrl(msg.room.code);
      if (location.pathname + location.search !== url) history.replaceState(null, "", url);
      break;
    }

    case "leftRoom":
      roomCode = "";
      inGame = false;
      gameOverOpen = false;
      game.stop();
      history.replaceState(null, "", menuUrl());
      showScreen("menu");
      break;

    case "gameStart": {
      // Powtórzony handshake ma uzupełnić zgubiony stan, a nie resetować trwającą grę.
      if (inGame && !gameOverOpen) break;
      inGame = true;
      gameOverOpen = false;
      showScreen("game");
      game.start(msg.config, msg.players, msg.yourTeam);
      break;
    }

    case "snapshot":
      game.onSnapshot(msg.snapshot);
      break;

    case "events":
      game.onEvents(msg.events, msg.seq);
      break;

    case "reaction":
      game.onReaction(msg.team, msg.wormId, msg.kind);
      break;

    case "terrainSync":
      game.onTerrainSync(msg.terrain);
      break;

    case "gameOver":
      gameOverOpen = true;
      game.onGameOver(msg.winnerTeam, msg.winnerName, msg.stats);
      break;

    case "pong":
      break;
  }
}

// ---------------- menu ----------------
function requireNick(): boolean {
  if (nick().length >= 2) return true;
  toast("Podaj nick (min. 2 znaki)", "err");
  el.nick.focus();
  return false;
}

el.create.addEventListener("click", () => {
  sound.unlock();
  if (!requireNick()) return;
  saveNick();
  net.send({ t: "hello", name: nick(), reconnectToken });
  net.send({ t: "createRoom" });
});

el.join.addEventListener("click", () => {
  sound.unlock();
  if (!requireNick()) return;
  const code = el.joinCode.value.trim().toUpperCase();
  if (code.length < 3) {
    toast("Podaj kod pokoju", "err");
    el.joinCode.focus();
    return;
  }
  saveNick();
  net.send({ t: "hello", name: nick(), reconnectToken });
  roomCode = code;
  net.send({ t: "joinRoom", code });
});

el.joinCode.addEventListener("input", () => {
  el.joinCode.value = el.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

el.nick.addEventListener("keydown", (e) => {
  if (e.key === "Enter") (ROOM_PARAM ? el.join : el.create).click();
});
el.joinCode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el.join.click();
});

// ---------------- start ----------------
const DEMO_CONFIG: GameConfig = {
  wormsPerTeam: 2,
  turnTime: 45,
  suddenDeathAfterRounds: 10,
  seed: 20240917,
  terrainDensity: 1,
  theme: (params.get("theme") as GameConfig["theme"]) || "grass",
};

byId("btn-demo").addEventListener("click", (event) => {
  event.preventDefault();
  DEMO = true;
  COMPUTER = false;
  net.close();
  history.replaceState(null, "", `${location.pathname}?demo=1`);
  showScreen("game");
  game.start(DEMO_CONFIG, [], 0, "twoPlayers");
  void game.fullscreen();
});

byId("btn-computer").addEventListener("click", (event) => {
  event.preventDefault();
  DEMO = true;
  COMPUTER = true;
  net.close();
  history.replaceState(null, "", `${location.pathname}?computer=1`);
  showScreen("game");
  game.start(DEMO_CONFIG, [], 0, "computer");
  void game.fullscreen();
});

if (DEMO || DEBUG) {
  // uchwyt dla podglądu deweloperskiego / testów wizualnych (?demo=1 lub ?debug=1)
  (window as unknown as Record<string, unknown>).__game = game;
  (window as unknown as Record<string, unknown>).__worms = {
    game,
    net,
    get playerId() {
      return playerId;
    },
    get roomCode() {
      return roomCode;
    },
    get screen() {
      return screen;
    },
  };
}

if (DEMO) {
  showScreen("game");
  game.start(DEMO_CONFIG, [], 0, COMPUTER ? "computer" : "twoPlayers");
} else if (DEMO_LOBBY) {
  const d = demoRoom();
  playerId = d.playerId;
  roomCode = d.room.code;
  lobby.setRoom(d.room, d.playerId);
  showScreen("lobby");
} else {
  showScreen("menu");
  void net.connect();
  if (!el.nick.value) el.nick.focus();
  else if (ROOM_PARAM) el.joinCode.focus();
}

window.addEventListener("beforeunload", () => {
  if (!DEMO && !DEMO_LOBBY) net.close();
});

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Brak elementu #${id}`);
  return e as T;
}
