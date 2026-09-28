// Autorytatywny "host" pokoi: cała logika ClientMessage -> ServerMessage.
// CZYSTY kod – bez `ws`, `express`, `node:*`, bez własnych timerów.
// Node uruchamia go dla wielu pokoi; przeglądarka (gracz-host) dla jednego.
import { MAX_PLAYERS } from "../constants";
import type { TeamSetup } from "../engine";
import { REACTION_COOLDOWN_MS, type ClientMessage, type GameConfig, type ServerMessage, type SpectatorReaction } from "../protocol";
import { GameLoop, TICK_MS } from "./gameLoop";
import {
  RoomManager,
  broadcast,
  broadcastRoomState,
  randomId,
  sanitizeName,
  toPlayerInfo,
  toRoomState,
  validateConfigPatch,
} from "./rooms";
import type { Peer, Room, RoomPlayer } from "./rooms";

export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Ile czasu rozłączony gracz ma na powrót do trwającej gry. */
export const RECONNECT_GRACE_MS = 60_000;
/** Zalecany odstęp wołania `RoomHost.tick` (ms). */
export const HOST_TICK_MS = TICK_MS;

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

export function byteLength(text: string): number {
  if (encoder) return encoder.encode(text).length;
  // Fallback: pesymistyczne oszacowanie UTF-8.
  return text.length * 3;
}

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; error: string };

/**
 * Bezpieczne parsowanie ramki od klienta (JSON + limit rozmiaru).
 * Transport (ws / Realtime) używa tego zanim odda wiadomość do `handleMessage`.
 */
export function parseClientMessage(text: string, maxBytes = MAX_MESSAGE_BYTES): ParseResult {
  if (typeof text !== "string") return { ok: false, error: "Nieobsługiwany format wiadomości." };
  if (byteLength(text) > maxBytes) return { ok: false, error: "Wiadomość za duża." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Nieprawidłowy JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Nieprawidłowy format wiadomości." };
  }
  if (typeof (parsed as { t?: unknown }).t !== "string") {
    return { ok: false, error: "Nieprawidłowy format wiadomości." };
  }
  return { ok: true, msg: parsed as ClientMessage };
}

/** Stan pojedynczego połączenia (jeden Peer). */
export interface HostSession {
  peer: Peer;
  playerId: string;
  name: string;
  reconnectToken?: string;
  room: Room | null;
  player: RoomPlayer | null;
}

export interface RoomHostOptions {
  rooms?: RoomManager;
  log?: (...args: unknown[]) => void;
  reconnectGraceMs?: number;
  /** Ograniczenie liczby pokoi (przeglądarka-host: 1). */
  maxRooms?: number;
}

export class RoomHost {
  readonly rooms: RoomManager;
  private readonly sessions = new Map<string, HostSession>();
  private readonly log: (...args: unknown[]) => void;
  private readonly graceMs: number;
  private readonly maxRooms: number;
  private readonly reactionAt = new WeakMap<Room, Map<string, number>>();
  private nowMs = 0;
  private destroyed = false;

  constructor(options: RoomHostOptions = {}) {
    this.rooms = options.rooms ?? new RoomManager();
    this.log = options.log ?? (() => {});
    this.graceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.maxRooms = options.maxRooms ?? Number.POSITIVE_INFINITY;
  }

  /** Bieżący czas znany hostowi (ostatni `tick`/`handle*`). */
  get now(): number {
    return this.nowMs;
  }

  /** Kody aktualnie istniejących pokoi (w przeglądarce zwykle jeden). */
  roomCodes(): string[] {
    return this.rooms.list().map((r) => r.code);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  session(peerId: string): HostSession | undefined {
    return this.sessions.get(peerId);
  }

  // ---------- cykl życia połączenia ----------

  handleConnect(peer: Peer, nowMs?: number): HostSession {
    if (nowMs !== undefined) this.nowMs = nowMs;
    const existing = this.sessions.get(peer.id);
    if (existing) return existing;
    const s: HostSession = { peer, playerId: randomId(), name: "Gracz", room: null, player: null };
    this.sessions.set(peer.id, s);
    peer.send({ t: "welcome", playerId: s.playerId });
    return s;
  }

  handleDisconnect(peer: Peer, nowMs?: number): void {
    if (nowMs !== undefined) this.nowMs = nowMs;
    const s = this.sessions.get(peer.id);
    if (!s) return;
    this.sessions.delete(peer.id);
    const { room, player } = s;
    s.room = null;
    s.player = null;
    if (!room || !player) return;
    if (player.peer && player.peer.id !== peer.id) return; // gracza przejęła już inna sesja

    player.peer = null;

    player.connected = false;
    player.disconnectedAt = this.nowMs;
    this.log(`[pokój] ${player.name} rozłączył się z ${room.code}`);
    broadcastRoomState(room);
  }

  /** Krok czasu: okna reconnectu + pętle gier wszystkich pokoi. */
  tick(nowMs: number): void {
    if (this.destroyed) return;
    this.nowMs = nowMs;
    for (const room of this.rooms.list()) {
      for (const player of [...room.players]) {
        if (player.connected || player.disconnectedAt === null) continue;
        if (nowMs - player.disconnectedAt >= this.graceMs) this.dropPlayer(room, player);
      }
      room.loop?.tick(nowMs);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const room of this.rooms.list()) this.rooms.deleteRoom(room);
    this.sessions.clear();
  }

  // ---------- wiadomości ----------

  handleMessage(peer: Peer, msg: ClientMessage, nowMs?: number): void {
    if (nowMs !== undefined) this.nowMs = nowMs;
    if (this.destroyed) return;
    const s = this.sessions.get(peer.id) ?? this.handleConnect(peer);
    // Transport może podawać świeży obiekt Peer o tym samym id – bierzemy najnowszy.
    if (s.peer !== peer) {
      s.peer = peer;
      if (s.player && s.player.peer) s.player.peer = peer;
    }
    if (typeof msg !== "object" || msg === null || typeof (msg as { t?: unknown }).t !== "string") {
      peer.send({ t: "error", message: "Nieprawidłowy format wiadomości." });
      return;
    }
    try {
      this.dispatch(s, msg);
    } catch (err) {
      this.log("[host] błąd obsługi wiadomości:", err);
      peer.send({ t: "error", message: "Błąd serwera przy obsłudze wiadomości." });
    }
  }

  private dispatch(s: HostSession, msg: ClientMessage): void {
    switch (msg.t) {
      case "hello":
        return this.onHello(s, msg.name, msg.reconnectToken);
      case "createRoom":
        return this.onCreateRoom(s, msg.config);
      case "joinRoom":
        return this.onJoinRoom(s, msg.code);
      case "leaveRoom":
        return this.onLeaveRoom(s);
      case "setReady":
        return this.onSetReady(s, msg.ready);
      case "setConfig":
        return this.onSetConfig(s, msg.config);
      case "startGame":
        return this.onStartGame(s);
      case "input":
        return this.onInput(s, msg.state, msg.seq, msg.turn);
      case "action":
        return this.onAction(s, msg.action, msg.seq, msg.turn);
      case "reaction":
        return this.onReaction(s, msg.kind);
      case "ping":
        s.peer.send({ t: "pong", ts: typeof msg.ts === "number" && Number.isFinite(msg.ts) ? msg.ts : this.nowMs });
        return;
      case "requestTerrainSync":
        return this.onRequestTerrainSync(s);
      default:
        s.peer.send({ t: "error", message: `Nieznany typ wiadomości: ${String((msg as { t?: unknown }).t)}` });
    }
  }

  private error(s: HostSession, message: string): void {
    s.peer.send({ t: "error", message });
  }

  // ---------- lobby ----------

  private onHello(s: HostSession, name: unknown, reconnectToken?: unknown): void {
    s.name = sanitizeName(name);
    if (typeof reconnectToken === "string" && /^[a-f0-9-]{36}$/i.test(reconnectToken)) {
      s.reconnectToken = reconnectToken;
    }
    if (s.player) {
      s.player.name = s.name;
      if (s.room) broadcastRoomState(s.room);
    }
  }

  private onCreateRoom(s: HostSession, config: unknown): void {
    if (s.room) this.onLeaveRoom(s);
    if (this.rooms.size >= this.maxRooms) {
      this.error(s, "Nie można utworzyć kolejnego pokoju.");
      return;
    }
    let patch: Partial<GameConfig> | undefined;
    if (config !== undefined && config !== null) {
      const validated = validateConfigPatch(config);
      if (!validated.ok) {
        this.error(s, validated.error);
        return;
      }
      patch = validated.patch;
    }
    const room = this.rooms.createRoom({ id: s.playerId, name: s.name, peer: s.peer }, patch, this.nowMs);
    s.room = room;
    s.player = room.players[0]!;
    s.player.reconnectToken = s.reconnectToken;
    this.log(`[pokój] utworzono ${room.code} przez ${s.name} (${s.playerId})`);
    s.peer.send({ t: "roomState", room: toRoomState(room) });
  }

  private onJoinRoom(s: HostSession, code: unknown): void {
    if (typeof code !== "string") {
      this.error(s, "Podaj kod pokoju.");
      return;
    }
    // Ponowiona paczka JOIN nie może wyrzucić gracza z jego własnego pokoju.
    if (s.room?.code === code.trim().toUpperCase() && s.player) {
      s.peer.send({ t: "roomState", room: toRoomState(s.room) });
      if (s.room.phase === "playing" && s.room.loop) {
        s.peer.send({ t: "gameStart", config: { ...s.room.config },
          players: s.room.players.map(toPlayerInfo), yourTeam: s.player.team });
        s.peer.send({ t: "terrainSync", terrain: s.room.loop.terrainSync() });
        s.peer.send(s.room.loop.snapshotMessage());
      }
      return;
    }
    if (s.room) this.onLeaveRoom(s);
    const room = this.rooms.get(code);
    if (!room) {
      this.error(s, `Nie ma pokoju o kodzie ${code.trim().toUpperCase()}.`);
      return;
    }
    const candidate = s.reconnectToken
      ? room.players.find((p) => p.reconnectToken === s.reconnectToken)
      : room.players.find((p) => !p.connected && !p.reconnectToken && p.name.toLowerCase() === s.name.toLowerCase());
    if (candidate && (s.reconnectToken || !candidate.connected)) {
      this.reconnect(s, room, candidate);
      return;
    }
    if (room.phase === "playing") {
      this.error(s, "Gra w tym pokoju już trwa.");
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      this.error(s, "Pokój jest pełny.");
      return;
    }
    const player = this.rooms.addPlayer(room, { id: s.playerId, name: s.name, peer: s.peer });
    if (!player) {
      this.error(s, "Pokój jest pełny.");
      return;
    }
    s.room = room;
    s.player = player;
    player.reconnectToken = s.reconnectToken;
    this.log(`[pokój] ${s.name} dołączył do ${room.code}`);
    broadcastRoomState(room);
  }

  /** Powrót gracza do trwającej gry: przejmuje stare id i dostaje pełny stan. */
  private reconnect(s: HostSession, room: Room, player: RoomPlayer): void {
    for (const previous of this.sessions.values()) {
      if (previous.player === player && previous !== s) {
        previous.room = null;
        previous.player = null;
        previous.reconnectToken = undefined;
      }
    }
    player.connected = true;
    player.disconnectedAt = null;
    player.peer = s.peer;
    player.name = s.name;
    s.playerId = player.id;
    s.room = room;
    s.player = player;
    this.log(`[pokój] ${s.name} wrócił do ${room.code} (drużyna ${player.team})`);

    s.peer.send({ t: "welcome", playerId: player.id });
    const loop = room.loop;
    if (room.phase === "playing" && loop) {
      s.peer.send({
        t: "gameStart",
        config: { ...room.config },
        players: room.players.map(toPlayerInfo),
        yourTeam: player.team,
      });
      try {
        s.peer.send({ t: "terrainSync", terrain: loop.terrainSync() });
        s.peer.send(loop.snapshotMessage());
      } catch (err) {
        this.log("[gra] nie udało się wysłać stanu przy reconnect:", err);
      }
    }
    broadcastRoomState(room);
  }

  private onLeaveRoom(s: HostSession): void {
    const { room, player } = s;
    s.room = null;
    s.player = null;
    if (!room || !player) {
      s.peer.send({ t: "leftRoom" });
      return;
    }
    player.peer = null;
    if (room.phase === "playing" && room.loop) {
      try {
        room.loop.removeTeam(player.team);
      } catch (err) {
        this.log("[gra] removeTeam:", err);
      }
    }
    const alive = this.rooms.removePlayer(room, player.id);
    s.peer.send({ t: "leftRoom" });
    if (!alive) return;
    broadcastRoomState(room);
  }

  private onSetReady(s: HostSession, ready: unknown): void {
    const { room, player } = s;
    if (!room || !player) {
      this.error(s, "Nie jesteś w pokoju.");
      return;
    }
    if (room.phase !== "lobby") return;
    player.ready = ready === true || player.isHost;
    broadcastRoomState(room);
  }

  private onSetConfig(s: HostSession, patch: unknown): void {
    const { room, player } = s;
    if (!room || !player) {
      this.error(s, "Nie jesteś w pokoju.");
      return;
    }
    if (!player.isHost) {
      this.error(s, "Tylko host może zmieniać ustawienia.");
      return;
    }
    if (room.phase !== "lobby") {
      this.error(s, "Ustawienia można zmieniać tylko w lobby.");
      return;
    }
    const validated = validateConfigPatch(patch);
    if (!validated.ok) {
      this.error(s, validated.error);
      return;
    }
    Object.assign(room.config, validated.patch);
    broadcastRoomState(room);
  }

  private onStartGame(s: HostSession): void {
    const { room, player } = s;
    if (!room || !player) {
      this.error(s, "Nie jesteś w pokoju.");
      return;
    }
    if (!player.isHost) {
      this.error(s, "Tylko host może rozpocząć grę.");
      return;
    }
    const can = this.rooms.canStart(room);
    if (!can.ok) {
      this.error(s, can.error);
      return;
    }
    this.startGame(room);
  }

  /** Tworzy silnik i uruchamia pętlę pokoju. */
  startGame(room: Room): boolean {
    const teams: TeamSetup[] = room.players
      .slice()
      .sort((a, b) => a.team - b.team)
      .map((p) => ({ team: p.team, playerId: p.id, name: p.name }));

    let loop: GameLoop;
    try {
      loop = new GameLoop({ ...room.config }, teams, {
        broadcast: (msg) => broadcast(room, msg),
        onGameOver: () => this.finishGame(room),
      });
    } catch (err) {
      this.log("[gra] createGame nie powiódł się:", err);
      broadcast(room, { t: "error", message: `Nie udało się uruchomić silnika gry: ${(err as Error).message}` });
      room.phase = "lobby";
      broadcastRoomState(room);
      return false;
    }

    room.loop = loop;
    room.phase = "playing";
    this.log(`[gra] start w pokoju ${room.code}, drużyny: ${teams.length}, seed ${room.config.seed}`);

    for (const p of room.players) {
      p.peer?.send({
        t: "gameStart",
        config: { ...room.config },
        players: room.players.map(toPlayerInfo),
        yourTeam: p.team,
      });
    }
    broadcastRoomState(room);
    loop.start(this.nowMs);
    return true;
  }

  /** Sprzątanie po zakończonej grze – pokój wraca do lobby. */
  private finishGame(room: Room): void {
    room.loop?.stop();
    room.loop = null;
    room.phase = "lobby";
    // Rozłączeni gracze nie wracają już do lobby.
    for (const p of [...room.players]) {
      if (!p.connected) this.rooms.removePlayer(room, p.id);
    }
    for (const p of room.players) {
      p.ready = p.isHost;
      p.disconnectedAt = null;
    }
    if (room.players.length === 0) {
      this.rooms.deleteRoom(room);
      return;
    }
    this.log(`[gra] koniec w pokoju ${room.code}`);
    broadcastRoomState(room);
  }

  // ---------- gra ----------

  private onInput(s: HostSession, state: unknown, seq?: number, turn?: { round: number; wormId: number }): void {
    const { room, player } = s;
    if (!room || !player || !room.loop || room.phase !== "playing") return;
    if (!room.loop.applyInput(player.team, state, seq, turn)) this.error(s, "Nieprawidłowy input.");
  }

  private onAction(s: HostSession, action: unknown, seq?: number, turn?: { round: number; wormId: number }): void {
    const { room, player } = s;
    if (!room || !player || !room.loop || room.phase !== "playing") return;
    if (!room.loop.applyAction(player.team, action, seq, turn)) this.error(s, "Nieprawidłowa akcja.");
    else if (seq !== undefined) s.peer.send({ t: "actionAck", seq });
  }

  private onReaction(s: HostSession, kind: unknown): void {
    const { room, player } = s;
    if (!room || !player || !player.connected || room.phase !== "playing" || !room.loop) return;
    if (kind !== "cheer" && kind !== "laugh" && kind !== "gasp") return;
    const snapshot = room.loop.game.snapshot();
    const turn = snapshot.turn;
    if (turn.phase === "gameOver" || turn.activeTeam < 0 || turn.activeTeam === player.team) return;
    const active = snapshot.worms.find((w) => w.id === turn.activeWormId);
    const worm = snapshot.worms.filter((w) => w.alive && w.team === player.team)
      .sort((a, b) => Math.abs(a.x - (active?.x ?? a.x)) - Math.abs(b.x - (active?.x ?? b.x)))[0];
    if (!worm) return;
    const lastByPlayer = this.reactionAt.get(room) ?? new Map<string, number>();
    const last = lastByPlayer.get(player.id) ?? Number.NEGATIVE_INFINITY;
    if (this.nowMs - last < REACTION_COOLDOWN_MS) return;
    lastByPlayer.set(player.id, this.nowMs);
    this.reactionAt.set(room, lastByPlayer);
    broadcast(room, { t: "reaction", team: player.team, wormId: worm.id, kind: kind as SpectatorReaction });
  }

  private onRequestTerrainSync(s: HostSession): void {
    const loop = s.room?.loop;
    if (!loop) {
      this.error(s, "Gra nie trwa.");
      return;
    }
    try {
      s.peer.send({ t: "terrainSync", terrain: loop.terrainSync() });
    } catch (err) {
      this.log("[gra] terrainSync:", err);
      this.error(s, "Nie udało się pobrać terenu.");
    }
  }

  // ---------- sprzątanie ----------

  /** Gracz nie wrócił w oknie łaski – usuwamy drużynę z gry i z pokoju. */
  private dropPlayer(room: Room, player: RoomPlayer): void {
    player.disconnectedAt = null;
    if (player.connected) return;
    if (room.loop) {
      try {
        room.loop.removeTeam(player.team);
      } catch (err) {
        this.log("[gra] removeTeam:", err);
      }
    }
    const alive = this.rooms.removePlayer(room, player.id);
    if (!alive) return;
    broadcastRoomState(room);
  }
}

export function createRoomHost(options: RoomHostOptions = {}): RoomHost {
  return new RoomHost(options);
}

/** Pomocnik dla transportów tekstowych: parsuje ramkę i przekazuje ją hostowi. */
export function handleRawMessage(host: RoomHost, peer: Peer, text: string, nowMs?: number): void {
  const parsed = parseClientMessage(text);
  if (!parsed.ok) {
    peer.send({ t: "error", message: parsed.error } satisfies ServerMessage);
    return;
  }
  host.handleMessage(peer, parsed.msg, nowMs);
}
