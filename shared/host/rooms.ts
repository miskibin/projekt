// Zarządzanie pokojami (lobby): kody, gracze, drużyny, config, host.
// CZYSTY kod – bez `ws`, `express`, `node:*` i bez globalnych timerów.
// Działa tak samo w Node (serwer autorytatywny) jak i w przeglądarce (gracz-host).
import { MAX_PLAYERS, SUDDEN_DEATH_AFTER_ROUNDS, TURN_TIME, WORMS_PER_TEAM_DEFAULT } from "../constants";
import type { GameConfig, PlayerInfo, RoomState, ServerMessage } from "../protocol";
import type { GameLoop } from "./gameLoop";

/** Litery bez mylących znaków: brak I, O (oraz cyfr 0/1). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
export const THEMES: ReadonlyArray<GameConfig["theme"]> = ["grass", "desert", "snow", "hell"];
export const MAX_NAME_LENGTH = 16;
export const DEFAULT_NAME = "Gracz";

/** Abstrakcja połączenia: WebSocket na serwerze, kanał Realtime w przeglądarce. */
export interface Peer {
  id: string;
  send(msg: ServerMessage): void;
}

export interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  /** null gdy gracz rozłączony (czeka na reconnect w trakcie gry) */
  peer: Peer | null;
  /** nowMs rozłączenia – okno powrotu liczy `RoomHost.tick`, nie setTimeout */
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  players: RoomPlayer[];
  config: GameConfig;
  phase: RoomState["phase"];
  loop: GameLoop | null;
  createdAt: number;
}

/** Losowe, stabilne id (bez zależności od node:crypto). */
export function randomId(length = 12): string {
  let out = "";
  while (out.length < length) out += Math.random().toString(36).slice(2);
  return out.slice(0, length);
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_NAME;
  const trimmed = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_NAME;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export function defaultConfig(): GameConfig {
  return {
    wormsPerTeam: WORMS_PER_TEAM_DEFAULT,
    turnTime: TURN_TIME,
    suddenDeathAfterRounds: SUDDEN_DEATH_AFTER_ROUNDS,
    seed: randomSeed(),
    terrainDensity: 1,
    theme: THEMES[Math.floor(Math.random() * THEMES.length)]!,
  };
}

export type ConfigValidation = { ok: true; patch: Partial<GameConfig> } | { ok: false; error: string };

interface NumRule {
  min: number;
  max: number;
  int: boolean;
  label: string;
}

const NUM_RULES: Record<"wormsPerTeam" | "turnTime" | "suddenDeathAfterRounds" | "terrainDensity", NumRule> = {
  wormsPerTeam: { min: 1, max: 6, int: true, label: "Robaki na drużynę" },
  turnTime: { min: 15, max: 120, int: true, label: "Czas tury" },
  suddenDeathAfterRounds: { min: 3, max: 30, int: true, label: "Sudden death po rundach" },
  terrainDensity: { min: 0.3, max: 1.5, int: false, label: "Gęstość terenu" },
};

/** Waliduje łatkę configu przychodzącą od hosta. Nieznane pola są ignorowane. */
export function validateConfigPatch(raw: unknown): ConfigValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Nieprawidłowe ustawienia." };
  }
  const input = raw as Record<string, unknown>;
  const patch: Partial<GameConfig> = {};

  for (const key of Object.keys(NUM_RULES) as (keyof typeof NUM_RULES)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${NUM_RULES[key].label}: oczekiwano liczby.` };
    }
    const rule = NUM_RULES[key];
    const normalized = rule.int ? Math.round(value) : value;
    if (normalized < rule.min || normalized > rule.max) {
      return { ok: false, error: `${rule.label}: dozwolony zakres ${rule.min}–${rule.max}.` };
    }
    patch[key] = normalized;
  }

  if (input.theme !== undefined) {
    if (typeof input.theme !== "string" || !THEMES.includes(input.theme as GameConfig["theme"])) {
      return { ok: false, error: `Motyw: dozwolone ${THEMES.join(", ")}.` };
    }
    patch.theme = input.theme as GameConfig["theme"];
  }

  if (input.seed !== undefined) {
    if (typeof input.seed !== "number" || !Number.isFinite(input.seed)) {
      return { ok: false, error: "Seed: oczekiwano liczby." };
    }
    patch.seed = Math.abs(Math.trunc(input.seed)) % 0x7fffffff;
  }

  return { ok: true, patch };
}

export function toPlayerInfo(p: RoomPlayer): PlayerInfo {
  return { id: p.id, name: p.name, team: p.team, ready: p.ready, isHost: p.isHost, connected: p.connected };
}

export function toRoomState(room: Room): RoomState {
  return {
    code: room.code,
    players: room.players.map(toPlayerInfo),
    config: { ...room.config },
    phase: room.phase,
  };
}

export function broadcast(room: Room, msg: ServerMessage, except?: RoomPlayer): void {
  for (const p of room.players) {
    if (p === except) continue;
    p.peer?.send(msg);
  }
}

export function broadcastRoomState(room: Room): void {
  broadcast(room, { t: "roomState", room: toRoomState(room) });
}

export function connectedPlayers(room: Room): RoomPlayer[] {
  return room.players.filter((p) => p.connected);
}

export function findPlayer(room: Room, playerId: string): RoomPlayer | undefined {
  return room.players.find((p) => p.id === playerId);
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  get(code: string): Room | undefined {
    if (typeof code !== "string") return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** Generuje unikalny, nieużywany kod pokoju. */
  generateCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Nie udało się wygenerować kodu pokoju");
  }

  /** Najniższy wolny indeks drużyny 0..MAX_PLAYERS-1, albo null gdy brak. */
  freeTeam(room: Room): number | null {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!room.players.some((p) => p.team === i)) return i;
    }
    return null;
  }

  createRoom(host: { id: string; name: string; peer: Peer | null }, patch?: Partial<GameConfig>, nowMs = 0): Room {
    const room: Room = {
      code: this.generateCode(),
      players: [],
      config: defaultConfig(),
      phase: "lobby",
      loop: null,
      createdAt: nowMs,
    };
    if (patch) {
      const validated = validateConfigPatch(patch);
      if (validated.ok) Object.assign(room.config, validated.patch);
    }
    this.rooms.set(room.code, room);
    room.players.push({
      id: host.id,
      name: sanitizeName(host.name),
      team: 0,
      ready: true,
      isHost: true,
      connected: true,
      peer: host.peer,
      disconnectedAt: null,
    });
    return room;
  }

  addPlayer(room: Room, info: { id: string; name: string; peer: Peer | null }): RoomPlayer | null {
    const team = this.freeTeam(room);
    if (team === null || room.players.length >= MAX_PLAYERS) return null;
    const player: RoomPlayer = {
      id: info.id,
      name: sanitizeName(info.name),
      team,
      ready: false,
      isHost: room.players.length === 0,
      connected: true,
      peer: info.peer,
      disconnectedAt: null,
    };
    room.players.push(player);
    return player;
  }

  /**
   * Usuwa gracza z pokoju. Host przechodzi na następnego gracza,
   * pusty pokój jest kasowany. Zwraca true jeśli pokój dalej istnieje.
   */
  removePlayer(room: Room, playerId: string): boolean {
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return this.rooms.has(room.code);
    const [removed] = room.players.splice(idx, 1);
    if (room.players.length === 0) {
      this.deleteRoom(room);
      return false;
    }
    if (removed?.isHost) {
      const next = room.players[0]!;
      next.isHost = true;
      next.ready = true;
    }
    return true;
  }

  deleteRoom(room: Room): void {
    room.loop?.stop();
    room.loop = null;
    this.rooms.delete(room.code);
  }

  host(room: Room): RoomPlayer | undefined {
    return room.players.find((p) => p.isHost);
  }

  /** Czy host może wystartować grę (min 2 graczy, wszyscy nie-hostowi gotowi). */
  canStart(room: Room): { ok: true } | { ok: false; error: string } {
    if (room.phase !== "lobby") return { ok: false, error: "Gra już trwa." };
    const players = connectedPlayers(room);
    if (players.length < 2) return { ok: false, error: "Potrzeba co najmniej 2 graczy." };
    if (players.some((p) => !p.isHost && !p.ready)) return { ok: false, error: "Nie wszyscy gracze są gotowi." };
    return { ok: true };
  }
}
