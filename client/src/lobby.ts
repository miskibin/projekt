import { MAX_PLAYERS, TEAM_COLORS, TEAM_NAMES, WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { generateTerrain } from "@shared/engine/terrain";
import type { ClientMessage, GameConfig, RoomState } from "@shared/protocol";
import { renderTerrainPreview, type ThemeId } from "./game/terrainRenderer";

export interface LobbyCallbacks {
  send(msg: ClientMessage): void;
  leave(): void;
  toast(text: string, kind?: "info" | "err" | "ok"): void;
}

const THEME_LABELS: Record<ThemeId, string> = {
  grass: "Łąka",
  desert: "Pustynia",
  snow: "Śnieg",
  hell: "Piekło",
};

/** Ekran lobby: gracze, ustawienia, podgląd mapy i czat. */
export class Lobby {
  private room: RoomState | null = null;
  private myId = "";
  private previewTimer: number | null = null;
  private lastPreviewKey = "";

  private el = {
    code: byId("room-code"),
    copy: byId<HTMLButtonElement>("btn-copy"),
    leave: byId<HTMLButtonElement>("btn-leave"),
    conn: byId("lobby-conn"),
    list: byId("player-list"),
    ready: byId<HTMLButtonElement>("btn-ready"),
    start: byId<HTMLButtonElement>("btn-start"),
    worms: byId<HTMLInputElement>("set-worms"),
    turnTime: byId<HTMLInputElement>("set-turntime"),
    sd: byId<HTMLInputElement>("set-sd"),
    density: byId<HTMLInputElement>("set-density"),
    theme: byId<HTMLSelectElement>("set-theme"),
    vWorms: byId("val-worms"),
    vTurn: byId("val-turntime"),
    vSd: byId("val-sd"),
    vDensity: byId("val-density"),
    preview: byId<HTMLCanvasElement>("map-preview"),
    reroll: byId<HTMLButtonElement>("btn-reroll"),
    note: byId("settings-note"),
    chatLog: byId("chat-log"),
    chatForm: byId<HTMLFormElement>("chat-form"),
    chatInput: byId<HTMLInputElement>("chat-input"),
  };

  constructor(private readonly cb: LobbyCallbacks) {
    this.el.leave.addEventListener("click", () => this.cb.leave());

    this.el.copy.addEventListener("click", () => {
      const code = this.room?.code;
      if (!code) return;
      const url = `${location.origin}${location.pathname}?room=${code}`;
      void navigator.clipboard
        .writeText(url)
        .then(() => this.cb.toast("Link skopiowany do schowka", "ok"))
        .catch(() => this.cb.toast(url, "info"));
    });

    this.el.ready.addEventListener("click", () => {
      const me = this.me();
      this.cb.send({ t: "setReady", ready: !(me?.ready ?? false) });
    });

    this.el.start.addEventListener("click", () => this.cb.send({ t: "startGame" }));

    this.el.reroll.addEventListener("click", () => {
      if (!this.isHost()) return;
      const seed = (Math.random() * 0x7fffffff) | 0;
      this.cb.send({ t: "setConfig", config: { seed } });
      if (this.room) {
        this.room.config.seed = seed;
        this.schedulePreview();
      }
    });

    const push = (patch: Partial<GameConfig>) => {
      if (!this.isHost()) return;
      this.cb.send({ t: "setConfig", config: patch });
      if (this.room) Object.assign(this.room.config, patch);
      this.syncSettingLabels();
      this.schedulePreview();
    };

    this.el.worms.addEventListener("input", () => push({ wormsPerTeam: Number(this.el.worms.value) }));
    this.el.turnTime.addEventListener("input", () => push({ turnTime: Number(this.el.turnTime.value) }));
    this.el.sd.addEventListener("input", () => push({ suddenDeathAfterRounds: Number(this.el.sd.value) }));
    this.el.density.addEventListener("input", () => push({ terrainDensity: Number(this.el.density.value) }));
    this.el.theme.addEventListener("change", () => push({ theme: this.el.theme.value as ThemeId }));

    this.el.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.el.chatInput.value.trim();
      if (!text) return;
      this.cb.send({ t: "chat", text });
      this.el.chatInput.value = "";
    });
  }

  private me() {
    return this.room?.players.find((p) => p.id === this.myId) ?? null;
  }

  private isHost(): boolean {
    return this.me()?.isHost ?? false;
  }

  setConnection(text: string, bad: boolean): void {
    this.el.conn.textContent = text;
    this.el.conn.classList.toggle("bad", bad);
  }

  setRoom(room: RoomState, myId: string): void {
    const codeChanged = this.room?.code !== room.code;
    this.room = room;
    this.myId = myId;
    this.el.code.textContent = room.code;
    if (codeChanged) this.el.chatLog.innerHTML = "";

    // gracze
    this.el.list.innerHTML = "";
    for (const p of room.players) {
      const li = document.createElement("li");
      li.style.borderLeftColor = TEAM_COLORS[p.team % TEAM_COLORS.length];
      if (!p.connected) li.classList.add("offline");

      const name = document.createElement("span");
      name.className = "pl-name";
      name.textContent = p.name + (p.id === myId ? " (ty)" : "");
      const team = document.createElement("span");
      team.className = "pl-team";
      team.textContent = TEAM_NAMES[p.team % TEAM_NAMES.length];
      team.style.color = TEAM_COLORS[p.team % TEAM_COLORS.length];
      li.append(name, team);

      if (p.isHost) li.append(badge("host", "badge-host"));
      if (!p.connected) li.append(badge("offline", "badge-wait"));
      else li.append(p.ready ? badge("gotowy", "badge-ready") : badge("czeka", "badge-wait"));
      this.el.list.appendChild(li);
    }
    for (let i = room.players.length; i < MAX_PLAYERS; i++) {
      const li = document.createElement("li");
      li.style.opacity = "0.35";
      li.style.borderLeftColor = "#39415a";
      const s = document.createElement("span");
      s.className = "pl-name";
      s.textContent = "wolne miejsce…";
      s.style.fontWeight = "400";
      s.style.color = "#6d7a92";
      li.appendChild(s);
      this.el.list.appendChild(li);
    }

    // przyciski
    const me = this.me();
    this.el.ready.textContent = me?.ready ? "Nie jestem gotowy" : "Gotowy";
    this.el.ready.classList.toggle("btn-primary", !me?.ready);
    const host = this.isHost();
    this.el.start.hidden = !host;
    const connected = room.players.filter((p) => p.connected);
    const allReady = connected.length >= 2 && connected.every((p) => p.ready || p.isHost);
    this.el.start.disabled = !allReady;
    this.el.start.title = allReady ? "" : "Potrzeba min. 2 połączonych i gotowych graczy";

    // ustawienia
    const c = room.config;
    this.el.worms.value = String(c.wormsPerTeam);
    this.el.turnTime.value = String(c.turnTime);
    this.el.sd.value = String(c.suddenDeathAfterRounds);
    this.el.density.value = String(c.terrainDensity);
    this.el.theme.value = c.theme;
    for (const inp of [this.el.worms, this.el.turnTime, this.el.sd, this.el.density, this.el.theme]) {
      inp.disabled = !host;
    }
    this.el.reroll.disabled = !host;
    this.el.note.textContent = host
      ? "Jesteś hostem – twoje ustawienia obowiązują wszystkich."
      : `Ustawienia zmienia host. Motyw: ${THEME_LABELS[c.theme]}.`;
    this.syncSettingLabels();
    this.schedulePreview();
  }

  private syncSettingLabels(): void {
    this.el.vWorms.textContent = this.el.worms.value;
    this.el.vTurn.textContent = this.el.turnTime.value;
    this.el.vSd.textContent = this.el.sd.value;
    this.el.vDensity.textContent = Number(this.el.density.value).toFixed(2);
  }

  addChat(from: string, text: string, system = false): void {
    const div = document.createElement("div");
    div.className = system ? "cm sys" : "cm";
    if (system) div.textContent = text;
    else {
      const b = document.createElement("b");
      b.textContent = `${from}: `;
      const p = this.room?.players.find((x) => x.name === from);
      if (p) b.style.color = TEAM_COLORS[p.team % TEAM_COLORS.length];
      div.append(b, document.createTextNode(text));
    }
    this.el.chatLog.appendChild(div);
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    while (this.el.chatLog.childElementCount > 120) this.el.chatLog.firstElementChild?.remove();
  }

  /** Podgląd mapy z aktualnego seeda – generowany z opóźnieniem, żeby nie blokować UI. */
  private schedulePreview(): void {
    const c = this.room?.config;
    if (!c) return;
    const key = `${c.seed}|${c.terrainDensity}|${c.theme}`;
    if (key === this.lastPreviewKey) return;
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      this.lastPreviewKey = key;
      const ctx = this.el.preview.getContext("2d");
      if (!ctx) return;
      const terrain = generateTerrain(c.seed, WORLD_WIDTH, WORLD_HEIGHT, c.terrainDensity);
      renderTerrainPreview(terrain, ctx, c.theme);
    }, 180);
  }
}

function badge(text: string, cls: string): HTMLElement {
  const s = document.createElement("span");
  s.className = `badge ${cls}`;
  s.textContent = text;
  return s;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Brak elementu #${id}`);
  return el as T;
}
