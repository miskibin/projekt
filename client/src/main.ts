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
  private msgCbs: ((m: ServerMessage) => void)[] = [];
  private statusCbs: ((s: ConnStatus) => void)[] = [];

  constructor(private readonly load: () => Promise<Transport>) {}

  async connect(): Promise<void> {
    if (!this.inner) {
      const t = await this.load();
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
    this.inner?.close();
  }
}

/**
 * Wybór transportu. Domyślnie WebSocket (self-host, serwer Node przez proxy Vite `/ws`).
 * Gdy ustawione są `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` i `VITE_TRANSPORT !== "ws"`,
 * ładowany jest `SupabaseTransport` (client/src/net/supabaseTransport.ts).
 */
export function createTransport(): Transport {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (env.VITE_TRANSPORT !== "ws" && url && key) {
    return new LazyTransport(async () => {
      const mod = await import("./net/supabaseTransport");
      return new mod.SupabaseTransport(url, key) as unknown as Transport;
    });
  }
  return new WebSocketTransport(wsUrl());
}

type Screen = "menu" | "lobby" | "game";

const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";
const DEMO_LOBBY = params.get("demoLobby") === "1";
const ROOM_PARAM = (params.get("room") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

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
    game.stop();
    showScreen("menu");
  },
  toast,
});

const game = new GameClient(sound, {
  send: (m) => net.send(m),
  leaveRoom: () => {
    net.send({ t: "leaveRoom" });
    roomCode = "";
    inGame = false;
    game.stop();
    showScreen("menu");
  },
  backToLobby: () => {
    inGame = false;
    game.stop();
    showScreen(roomCode ? "lobby" : "menu");
  },
  rtt: () => net.rtt,
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
  const name = nick();
  if (name) net.send({ t: "hello", name });
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
  switch (msg.t) {
    case "welcome":
      playerId = msg.playerId;
      break;

    case "error":
      toast(msg.message, "err");
      break;

    case "roomState": {
      roomCode = msg.room.code;
      lobby.setRoom(msg.room, playerId);
      if (msg.room.phase === "lobby") {
        inGame = false;
        game.stop();
        showScreen("lobby");
      } else if (!inGame && screen !== "game") {
        showScreen("lobby");
      }
      const url = `${location.pathname}?room=${msg.room.code}`;
      if (location.search !== `?room=${msg.room.code}`) history.replaceState(null, "", url);
      break;
    }

    case "leftRoom":
      roomCode = "";
      inGame = false;
      game.stop();
      history.replaceState(null, "", location.pathname);
      showScreen("menu");
      break;

    case "chat":
      lobby.addChat(msg.from, msg.text);
      if (screen === "game") toast(`${msg.from}: ${msg.text}`);
      break;

    case "gameStart": {
      inGame = true;
      showScreen("game");
      game.start(msg.config, msg.players, msg.yourTeam);
      break;
    }

    case "snapshot":
      game.onSnapshot(msg.snapshot);
      break;

    case "events":
      game.onEvents(msg.events);
      break;

    case "terrainSync":
      game.onTerrainSync(msg.terrain);
      break;

    case "gameOver":
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
  net.send({ t: "hello", name: nick() });
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
  net.send({ t: "hello", name: nick() });
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

if (DEMO) {
  showScreen("game");
  game.start(DEMO_CONFIG, [], 0, true);
  // uchwyt dla podglądu deweloperskiego / testów wizualnych
  (window as unknown as Record<string, unknown>).__game = game;
} else if (DEMO_LOBBY) {
  const d = demoRoom();
  playerId = d.playerId;
  roomCode = d.room.code;
  lobby.setRoom(d.room, d.playerId);
  lobby.addChat("Kasia", "siema, gramy?");
  lobby.addChat("", "Bartek dołączył do pokoju", true);
  lobby.addChat("Michał", "sekunda, ustawiam mapę");
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
