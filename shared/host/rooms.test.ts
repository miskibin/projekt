import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../constants";
import {
  CODE_ALPHABET,
  RoomManager,
  ROOM_CODE_LENGTH,
  defaultConfig,
  sanitizeName,
  toRoomState,
  validateConfigPatch,
} from "./rooms";
import type { Peer, Room } from "./rooms";

const peer: Peer = { id: "peer", send: () => {} };

function makeRoom(mgr: RoomManager, hostName = "Host"): Room {
  return mgr.createRoom({ id: "host-id", name: hostName, peer });
}

describe("kody pokoi", () => {
  it("mają 4 znaki z alfabetu bez mylących liter", () => {
    const mgr = new RoomManager();
    for (let i = 0; i < 200; i++) {
      const code = mgr.generateCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("są unikalne między pokojami", () => {
    const mgr = new RoomManager();
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const room = mgr.createRoom({ id: `p${i}`, name: `Gracz${i}`, peer });
      expect(codes.has(room.code)).toBe(false);
      codes.add(room.code);
    }
    expect(mgr.size).toBe(300);
  });

  it("pokój znajdziemy po kodzie niezależnie od wielkości liter", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    expect(mgr.get(room.code.toLowerCase())?.code).toBe(room.code);
    expect(mgr.get(` ${room.code} `)?.code).toBe(room.code);
    expect(mgr.get("ZZZZ")).toBeUndefined();
  });
});

describe("gracze w pokoju", () => {
  it("host to pierwszy gracz, jest gotowy", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.isHost).toBe(true);
    expect(room.players[0]!.ready).toBe(true);
    expect(room.players[0]!.team).toBe(0);
  });

  it("drużyny przydzielane rosnąco po wolnych indeksach", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    const b = mgr.addPlayer(room, { id: "b", name: "B", peer })!;
    const c = mgr.addPlayer(room, { id: "c", name: "C", peer })!;
    expect([b.team, c.team]).toEqual([1, 2]);

    // zwolnienie środkowego indeksu -> kolejny gracz go zajmuje
    mgr.removePlayer(room, "b");
    const d = mgr.addPlayer(room, { id: "d", name: "D", peer })!;
    expect(d.team).toBe(1);
  });

  it("nie wpuszcza ponad MAX_PLAYERS", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    for (let i = 1; i < MAX_PLAYERS; i++) {
      expect(mgr.addPlayer(room, { id: `p${i}`, name: `P${i}`, peer })).not.toBeNull();
    }
    expect(room.players).toHaveLength(MAX_PLAYERS);
    expect(mgr.addPlayer(room, { id: "over", name: "Over", peer })).toBeNull();
    expect(mgr.freeTeam(room)).toBeNull();
  });

  it("host przechodzi na następnego gracza gdy wyjdzie", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    mgr.addPlayer(room, { id: "b", name: "B", peer });
    mgr.addPlayer(room, { id: "c", name: "C", peer });

    expect(mgr.removePlayer(room, "host-id")).toBe(true);
    expect(mgr.host(room)?.id).toBe("b");
    expect(mgr.host(room)?.ready).toBe(true);
    expect(room.players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it("pusty pokój jest usuwany", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    expect(mgr.removePlayer(room, "host-id")).toBe(false);
    expect(mgr.size).toBe(0);
    expect(mgr.get(room.code)).toBeUndefined();
  });
});

describe("canStart", () => {
  it("wymaga min. 2 graczy", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    expect(mgr.canStart(room).ok).toBe(false);
  });

  it("wymaga gotowości wszystkich nie-hostów", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    const b = mgr.addPlayer(room, { id: "b", name: "B", peer })!;
    expect(mgr.canStart(room).ok).toBe(false);
    b.ready = true;
    expect(mgr.canStart(room).ok).toBe(true);
  });

  it("nie pozwala startować gdy gra już trwa", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    mgr.addPlayer(room, { id: "b", name: "B", peer })!.ready = true;
    room.phase = "playing";
    expect(mgr.canStart(room).ok).toBe(false);
  });
});

describe("sanitizeName", () => {
  it("przycina, ogranicza do 16 znaków i ma domyślny nick", () => {
    expect(sanitizeName("  Michał  ")).toBe("Michał");
    expect(sanitizeName("")).toBe("Gracz");
    expect(sanitizeName("   ")).toBe("Gracz");
    expect(sanitizeName(undefined)).toBe("Gracz");
    expect(sanitizeName(123)).toBe("Gracz");
    expect(sanitizeName("A".repeat(50))).toHaveLength(16);
  });
});

describe("walidacja configu", () => {
  it("domyślny config trzyma się zakresów", () => {
    const cfg = defaultConfig();
    expect(cfg.wormsPerTeam).toBe(3);
    expect(cfg.turnTime).toBe(45);
    expect(cfg.suddenDeathAfterRounds).toBe(10);
    expect(cfg.terrainDensity).toBe(1);
    expect(["grass", "desert", "snow", "hell"]).toContain(cfg.theme);
    expect(Number.isFinite(cfg.seed)).toBe(true);
  });

  it("przyjmuje wartości w zakresie", () => {
    const res = validateConfigPatch({
      wormsPerTeam: 6,
      turnTime: 15,
      suddenDeathAfterRounds: 30,
      terrainDensity: 0.3,
      theme: "hell",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.patch).toEqual({
        wormsPerTeam: 6,
        turnTime: 15,
        suddenDeathAfterRounds: 30,
        terrainDensity: 0.3,
        theme: "hell",
      });
    }
  });

  it.each([
    ["wormsPerTeam", 0],
    ["wormsPerTeam", 7],
    ["turnTime", 14],
    ["turnTime", 121],
    ["suddenDeathAfterRounds", 2],
    ["suddenDeathAfterRounds", 31],
    ["terrainDensity", 0.29],
    ["terrainDensity", 1.51],
  ])("odrzuca %s = %s", (key, value) => {
    const res = validateConfigPatch({ [key]: value });
    expect(res.ok).toBe(false);
  });

  it("odrzuca zły motyw i nie-liczby", () => {
    expect(validateConfigPatch({ theme: "rainbow" }).ok).toBe(false);
    expect(validateConfigPatch({ turnTime: "45" }).ok).toBe(false);
    expect(validateConfigPatch({ terrainDensity: Number.NaN }).ok).toBe(false);
    expect(validateConfigPatch(null).ok).toBe(false);
    expect(validateConfigPatch([1, 2]).ok).toBe(false);
  });

  it("ignoruje nieznane pola i pusty patch", () => {
    const res = validateConfigPatch({ hax: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.patch).toEqual({});
  });

  it("normalizuje seed do liczby całkowitej", () => {
    const res = validateConfigPatch({ seed: -12.7 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(Number.isInteger(res.patch.seed)).toBe(true);
  });
});

describe("toRoomState", () => {
  it("nie wynosi transportu ani timerów na zewnątrz", () => {
    const mgr = new RoomManager();
    const room = makeRoom(mgr);
    const state = toRoomState(room);
    expect(Object.keys(state.players[0]!).sort()).toEqual(
      ["connected", "id", "isHost", "name", "ready", "team"].sort(),
    );
    expect(state.phase).toBe("lobby");
    expect(JSON.stringify(state)).not.toContain("peer");
  });
});
