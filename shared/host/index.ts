// PUBLICZNE API logiki pokoi/gry, niezależne od transportu i środowiska.
// Node (server/index.ts) mapuje WebSocket -> Peer, przeglądarka (Supabase Realtime)
// mapuje kanał Realtime -> Peer. Reszta jest identyczna.
//
//   import { createRoomHost, type Peer, type RoomHost } from "@shared/host";
//
//   const host = createRoomHost();
//   host.handleConnect(peer);
//   host.handleMessage(peer, msg);   // msg: ClientMessage
//   host.handleDisconnect(peer);
//   setInterval(() => host.tick(performance.now()), 16);
//   host.roomCodes();                // ["ABCD"]
//   host.destroy();

export {
  HOST_TICK_MS,
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  RECONNECT_GRACE_MS,
  RoomHost,
  byteLength,
  createRoomHost,
  handleRawMessage,
  parseClientMessage,
} from "./roomHost";
export type { HostSession, ParseResult, RoomHostOptions } from "./roomHost";

export {
  CODE_ALPHABET,
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  RoomManager,
  THEMES,
  broadcast,
  broadcastRoomState,
  connectedPlayers,
  defaultConfig,
  findPlayer,
  randomId,
  randomSeed,
  sanitizeName,
  toPlayerInfo,
  toRoomState,
  validateConfigPatch,
} from "./rooms";
export type { ConfigValidation, Peer, Room, RoomPlayer } from "./rooms";

export {
  GameLoop,
  MAX_STEPS_PER_TICK,
  SNAPSHOT_MS,
  TICK_MS,
  WEAPON_IDS,
  validateAction,
  validateInputState,
} from "./gameLoop";
export type { GameLoopDeps } from "./gameLoop";
