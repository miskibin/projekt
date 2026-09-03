import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, GameConfig, GameSnapshot, ServerMessage } from "../protocol";
import type { Game, TeamSetup } from "../engine";

// Silnik powstaje równolegle – RoomHost/GameLoop testujemy przeciw mockowi.
const hooks = vi.hoisted(() => ({ created: [] as TeamSetup[][], removed: [] as number[] }));

vi.mock("../engine", () => ({
  createGame: (config: GameConfig, teams: TeamSetup[]): Game => {
    hooks.created.push(teams);
    const snapshot = (): GameSnapshot => ({
      tick: 0,
      time: 0,
      worms: [],
      projectiles: [],
      crates: [],
      mines: [],
      teams: [],
      turn: {
        phase: "active",
        activeTeam: 0,
        activeWormId: 0,
        timeLeft: config.turnTime,
        round: 1,
        wind: 0,
        suddenDeath: false,
        waterLevel: 1040,
        selectedWeapon: "bazooka",
        weaponTimer: 3,
        chargePower: 0,
        shotsLeft: 1,
      },
    });
    return {
      config,
      terrain: {} as Game["terrain"],
      step: () => {},
      applyInput: () => {},
      applyAction: () => {},
      snapshot,
      drainEvents: () => [],
      isOver: () => false,
      winner: () => ({ team: null, name: null }),
      removeTeam: (t: number) => {
        hooks.removed.push(t);
      },
      terrainSync: () => ({ width: 4, height: 2, rle: [4, 0, 2, 2] }),
    };
  },
}));

const { MAX_MESSAGE_BYTES, RECONNECT_GRACE_MS, RoomHost, createRoomHost, handleRawMessage, parseClientMessage } =
  await import("./roomHost");
import type { Peer } from "./rooms";

/** Klient testowy: Peer + zebrane wiadomości serwera. */
class TestClient {
  readonly received: ServerMessage[] = [];
  readonly peer: Peer;

  constructor(
    private readonly host: InstanceType<typeof RoomHost>,
    id: string,
    name?: string,
  ) {
    this.peer = { id, send: (msg) => this.received.push(msg) };
    host.handleConnect(this.peer);
    if (name !== undefined) this.send({ t: "hello", name });
  }

  send(msg: ClientMessage): void {
    this.host.handleMessage(this.peer, msg);
  }
  raw(text: string): void {
    handleRawMessage(this.host, this.peer, text);
  }
  disconnect(): void {
    this.host.handleDisconnect(this.peer);
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      if (this.received[i]!.t === t) return this.received[i] as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  types(): string[] {
    return this.received.map((m) => m.t);
  }
  get playerId(): string {
    return this.host.session(this.peer.id)!.playerId;
  }
}

let host: InstanceType<typeof RoomHost>;
let seq = 0;

function client(name?: string): TestClient {
  return new TestClient(host, `peer-${seq++}`, name);
}

function roomOf(code: string) {
  return host.rooms.get(code);
}

beforeEach(() => {
  hooks.created.length = 0;
  hooks.removed.length = 0;
  seq = 0;
  host = createRoomHost() as InstanceType<typeof RoomHost>;
});

describe("API dla transportu", () => {
  it("createRoomHost zwraca hosta z kompletnym API", () => {
    const h = createRoomHost();
    expect(typeof h.handleConnect).toBe("function");
    expect(typeof h.handleMessage).toBe("function");
    expect(typeof h.handleDisconnect).toBe("function");
    expect(typeof h.tick).toBe("function");
    expect(typeof h.destroy).toBe("function");
    expect(h.roomCodes()).toEqual([]);
  });

  it("createRoom działa synchronicznie – roomCodes()[0] od razu ma kod", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0];
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(a.last("roomState")!.room.code).toBe(code);
  });

  it("bez hello nick to domyślny Gracz", () => {
    const a = client();
    a.send({ t: "createRoom" });
    expect(a.last("roomState")!.room.players[0]!.name).toBe("Gracz");
  });

  it("destroy kasuje pokoje i sesje", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    host.destroy();
    expect(host.roomCodes()).toEqual([]);
    expect(host.sessionCount()).toBe(0);
  });

  it("obsługuje świeży obiekt Peer o tym samym id", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const clone: Peer = { id: a.peer.id, send: (m) => a.received.push(m) };
    host.handleMessage(clone, { t: "ping", ts: 123 });
    expect(a.last("pong")!.ts).toBe(123);
    host.handleDisconnect(clone);
    expect(roomOf(code)).toBeUndefined();
  });
});

describe("handshake i lobby", () => {
  it("wita klienta welcome z playerId i tworzy pokój", () => {
    const a = client("Michał");
    expect(a.received[0]).toEqual({ t: "welcome", playerId: a.playerId });

    a.send({ t: "createRoom" });
    const state = a.last("roomState")!;
    expect(state.room.phase).toBe("lobby");
    expect(state.room.players).toEqual([
      { id: a.playerId, name: "Michał", team: 0, ready: true, isHost: true, connected: true },
    ]);
    expect(host.roomCodes()).toHaveLength(1);
  });

  it("sanitizuje nick z hello", () => {
    const a = client("   ");
    a.send({ t: "createRoom" });
    expect(a.last("roomState")!.room.players[0]!.name).toBe("Gracz");
  });

  it("dołączanie rozgłasza roomState do wszystkich", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;

    const b = client("B");
    b.send({ t: "joinRoom", code: code.toLowerCase() });

    expect(b.last("roomState")!.room.players.map((p) => p.name)).toEqual(["A", "B"]);
    expect(a.last("roomState")!.room.players).toHaveLength(2);
    expect(b.last("roomState")!.room.players[1]!.team).toBe(1);
  });

  it("błąd gdy pokoju nie ma", () => {
    const a = client("A");
    a.send({ t: "joinRoom", code: "ZZZZ" });
    expect(a.last("error")!.message).toContain("ZZZZ");
  });

  it("błąd gdy pokój pełny", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    for (const n of ["B", "C", "D"]) client(n).send({ t: "joinRoom", code });
    const e = client("E");
    e.send({ t: "joinRoom", code });
    expect(e.last("error")!.message).toContain("pełny");
  });

  it("host przechodzi na następnego po wyjściu", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });

    a.send({ t: "leaveRoom" });
    expect(a.types()).toContain("leftRoom");
    const players = b.last("roomState")!.room.players;
    expect(players).toHaveLength(1);
    expect(players[0]!).toMatchObject({ name: "B", isHost: true, ready: true });
  });

  it("setReady i setConfig aktualizują pokój", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });

    b.send({ t: "setReady", ready: true });
    expect(a.last("roomState")!.room.players[1]!.ready).toBe(true);

    a.send({ t: "setConfig", config: { turnTime: 60, theme: "snow" } });
    expect(a.last("roomState")!.room.config).toMatchObject({ turnTime: 60, theme: "snow" });
  });

  it("setConfig tylko dla hosta i tylko w zakresie", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });

    b.send({ t: "setConfig", config: { turnTime: 60 } });
    expect(b.last("error")!.message).toContain("host");

    a.send({ t: "setConfig", config: { turnTime: 999 } });
    expect(a.last("error")!.message).toContain("15");
    expect(a.last("roomState")!.room.config.turnTime).toBe(45);
  });
});

describe("start gry", () => {
  function lobbyOfTwo() {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });
    return { a, b, code };
  }

  it("odmawia startu gdy sam / gdy niegotowi / gdy nie host", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    a.send({ t: "startGame" });
    expect(a.last("error")!.message).toContain("2 graczy");

    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });

    a.send({ t: "startGame" });
    expect(a.last("error")!.message).toContain("gotowi");

    b.send({ t: "startGame" });
    expect(b.last("error")!.message).toContain("host");
  });

  it("wysyła gameStart z własną drużyną do każdego", () => {
    const { a, b } = lobbyOfTwo();
    b.send({ t: "setReady", ready: true });
    a.send({ t: "startGame" });

    expect(a.last("gameStart")!.yourTeam).toBe(0);
    expect(b.last("gameStart")!.yourTeam).toBe(1);
    expect(a.last("gameStart")!.players).toHaveLength(2);
    expect(a.last("roomState")!.room.phase).toBe("playing");
    expect(hooks.created[0]).toEqual([
      { team: 0, playerId: a.playerId, name: "A" },
      { team: 1, playerId: b.playerId, name: "B" },
    ]);
  });

  it("tick napędza pętlę pokoju – lecą snapshoty", () => {
    const { a, b } = lobbyOfTwo();
    b.send({ t: "setReady", ready: true });
    a.send({ t: "startGame" });

    host.tick(0);
    host.tick(60);
    expect(a.last("snapshot")).toBeDefined();
    expect(b.last("snapshot")).toBeDefined();
  });

  it("requestTerrainSync odpowiada terenem tylko w grze", () => {
    const { a, b } = lobbyOfTwo();
    a.send({ t: "requestTerrainSync" });
    expect(a.last("error")!.message).toContain("Gra nie trwa");

    b.send({ t: "setReady", ready: true });
    a.send({ t: "startGame" });
    a.send({ t: "requestTerrainSync" });
    expect(a.last("terrainSync")!.terrain).toEqual({ width: 4, height: 2, rle: [4, 0, 2, 2] });
  });

  it("odrzuca nieprawidłowy input/akcję", () => {
    const { a, b } = lobbyOfTwo();
    b.send({ t: "setReady", ready: true });
    a.send({ t: "startGame" });

    a.send({ t: "input", state: { left: true, right: false, aim: 0, charge: false } });
    expect(a.last("error")).toBeUndefined();

    a.send({ t: "action", action: { kind: "wtf" } as never });
    expect(a.last("error")!.message).toContain("akcja");
  });
});

describe("rozłączenia i reconnect", () => {
  function startedGame() {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });
    b.send({ t: "setReady", ready: true });
    a.send({ t: "startGame" });
    return { a, b, code, room: roomOf(code)! };
  }

  it("w lobby rozłączenie usuwa gracza", () => {
    const a = client("A");
    a.send({ t: "createRoom" });
    const code = host.roomCodes()[0]!;
    const b = client("B");
    b.send({ t: "joinRoom", code });

    b.disconnect();
    expect(roomOf(code)!.players).toHaveLength(1);
    expect(a.last("roomState")!.room.players).toHaveLength(1);
  });

  it("w grze rozłączenie oznacza connected=false w stanie pokoju", () => {
    const { a, b, room } = startedGame();
    b.disconnect();

    expect(room.players[1]!.connected).toBe(false);
    expect(room.players).toHaveLength(2);
    expect(a.last("roomState")!.room.players[1]!.connected).toBe(false);
  });

  it("gracz wraca do swojej drużyny i dostaje gameStart + terrainSync + snapshot", () => {
    const { b, code, room } = startedGame();
    const oldId = b.playerId;
    b.disconnect();

    const back = client("B");
    back.send({ t: "joinRoom", code });

    expect(room.players[1]!.connected).toBe(true);
    expect(back.playerId).toBe(oldId);
    const idx = back.types();
    expect(idx).toContain("gameStart");
    expect(idx.indexOf("terrainSync")).toBeGreaterThan(idx.indexOf("gameStart"));
    expect(idx.indexOf("snapshot")).toBeGreaterThan(idx.indexOf("terrainSync"));
    expect(back.last("gameStart")!.yourTeam).toBe(1);
  });

  it("obcy gracz nie wejdzie do trwającej gry", () => {
    const { code } = startedGame();
    const c = client("C");
    c.send({ t: "joinRoom", code });
    expect(c.last("error")!.message).toContain("już trwa");
  });

  it("gracz, który nie wrócił w oknie łaski, jest usuwany z gry przez tick", () => {
    const { a, b, code, room } = startedGame();
    host.tick(1000);
    b.disconnect();
    expect(room.players).toHaveLength(2);

    host.tick(1000 + RECONNECT_GRACE_MS - 1);
    expect(roomOf(code)!.players).toHaveLength(2);

    host.tick(1000 + RECONNECT_GRACE_MS + 1);
    expect(roomOf(code)!.players).toHaveLength(1);
    expect(hooks.removed).toContain(1);
    expect(a.last("roomState")!.room.players).toHaveLength(1);
  });

  it("wyjście z trwającej gry usuwa drużynę z silnika", () => {
    const { b } = startedGame();
    b.send({ t: "leaveRoom" });
    expect(hooks.removed).toContain(1);
  });

  it("gdy wszyscy się rozłączą, pokój znika", () => {
    const { a, b, code } = startedGame();
    a.disconnect();
    b.disconnect();
    expect(roomOf(code)).toBeUndefined();
    expect(host.roomCodes()).toEqual([]);
  });
});

describe("ping i odporność na śmieci", () => {
  it("ping wraca jako pong z tym samym ts", () => {
    const a = client("A");
    a.send({ t: "ping", ts: 12345 });
    expect(a.last("pong")).toEqual({ t: "pong", ts: 12345 });
  });

  it("nieznany typ wiadomości daje error", () => {
    const a = client("A");
    a.send({ t: "nieistnieje" } as never);
    expect(a.last("error")!.message).toContain("Nieznany typ");
  });

  it("parseClientMessage odrzuca zły JSON, zły format i za duże ramki", () => {
    expect(parseClientMessage("{to nie json")).toEqual({ ok: false, error: "Nieprawidłowy JSON." });
    expect(parseClientMessage(JSON.stringify({ foo: 1 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify([1, 2])).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: "ping", ts: 1 }))).toEqual({
      ok: true,
      msg: { t: "ping", ts: 1 },
    });
    const huge = JSON.stringify({ t: "hello", name: "x".repeat(MAX_MESSAGE_BYTES) });
    expect(parseClientMessage(huge)).toEqual({ ok: false, error: "Wiadomość za duża." });
  });

  it("handleRawMessage zwraca error zamiast wywalać hosta", () => {
    const a = client("A");
    a.raw("{zepsute");
    expect(a.last("error")!.message).toContain("JSON");
    a.raw(JSON.stringify({ t: "ping", ts: 7 }));
    expect(a.last("pong")).toEqual({ t: "pong", ts: 7 });
  });
});
