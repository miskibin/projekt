import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "../constants";
import type { Game, TeamSetup } from "../engine";
import type { GameConfig, GameEvent, GameSnapshot, ServerMessage } from "../protocol";

// Silnik jest implementowany równolegle przez innego agenta – testujemy przeciw mockowi.
const hooks = vi.hoisted(() => ({ factory: null as null | ((c: GameConfig, t: TeamSetup[]) => Game) }));

vi.mock("../engine", () => ({
  createGame: (config: GameConfig, teams: TeamSetup[]) => {
    if (!hooks.factory) throw new Error("brak mocka createGame");
    return hooks.factory(config, teams);
  },
}));

const { GameLoop, MAX_STEPS_PER_TICK, SNAPSHOT_MS, TICK_MS, validateAction, validateInputState } = await import(
  "./gameLoop"
);

interface MockGame extends Game {
  steps: number;
  eventsPerStep: GameEvent[];
  over: boolean;
  removed: number[];
  inputs: Array<[number, unknown]>;
  actions: Array<[number, unknown]>;
  pending: GameEvent[];
}

function makeSnapshot(round = 1): GameSnapshot {
  return {
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
      timeLeft: 45,
      round,
      wind: 0,
      suddenDeath: false,
      waterLevel: 1040,
      selectedWeapon: "bazooka",
      weaponTimer: 3,
      chargePower: 0,
      shotsLeft: 1,
    },
  };
}

function makeMockGame(config: GameConfig): MockGame {
  const game: MockGame = {
    config,
    terrain: {} as Game["terrain"],
    steps: 0,
    eventsPerStep: [],
    over: false,
    removed: [],
    inputs: [],
    actions: [],
    pending: [] as GameEvent[],
    step() {
      game.steps++;
      game.pending.push(...game.eventsPerStep);
    },
    applyInput(team, state) {
      game.inputs.push([team, state]);
    },
    applyAction(team, action) {
      game.actions.push([team, action]);
    },
    snapshot: () => makeSnapshot(2),
    drainEvents() {
      const e = game.pending;
      game.pending = [];
      return e;
    },
    isOver: () => game.over,
    winner: () => ({ team: 1, name: "Niebiescy" }),
    removeTeam(team) {
      game.removed.push(team);
    },
    terrainSync: () => ({ width: 10, height: 4, rle: [10, 0, 5, 5] }),
  };
  return game;
}

const config: GameConfig = {
  wormsPerTeam: 3,
  turnTime: 45,
  suddenDeathAfterRounds: 10,
  seed: 42,
  terrainDensity: 1,
  theme: "grass",
};
const teams: TeamSetup[] = [
  { team: 0, playerId: "a", name: "A" },
  { team: 1, playerId: "b", name: "B" },
];

function setup(configure?: (g: MockGame) => void) {
  let game!: MockGame;
  hooks.factory = (cfg) => {
    game = makeMockGame(cfg);
    configure?.(game);
    return game;
  };
  const sent: ServerMessage[] = [];
  const onGameOver = vi.fn();
  let now = 1000;
  // Pętla nie ma własnych timerów – czas podaje właściciel przez tick(nowMs).
  const loop = new GameLoop(config, teams, { broadcast: (msg) => sent.push(msg), onGameOver });
  return {
    loop,
    sent,
    onGameOver,
    get game() {
      return game;
    },
    advance(ms: number) {
      now += ms;
    },
    start() {
      loop.start(now);
    },
    tick() {
      loop.tick(now);
    },
  };
}

beforeEach(() => {
  hooks.factory = null;
});

describe("GameLoop – krok o stałym dt", () => {
  it("wykonuje kroki proporcjonalnie do upływu czasu i wysyła snapshot", () => {
    const h = setup();
    h.start();
    h.advance(SNAPSHOT_MS + 1);
    h.tick();

    expect(h.game.steps).toBe(3); // 51 ms / 16.66 ms
    const snapshots = h.sent.filter((m) => m.t === "snapshot");
    expect(snapshots).toHaveLength(1);
  });

  it("używa stałego dt = FIXED_DT", () => {
    const h = setup();
    const spy = vi.spyOn(h.loop.game, "step");
    h.start();
    h.advance(TICK_MS + 1);
    h.tick();
    expect(spy).toHaveBeenCalledWith(FIXED_DT);
  });

  it("nie robi więcej niż MAX_STEPS_PER_TICK kroków na tick", () => {
    const h = setup();
    h.start();
    h.advance(5000);
    h.tick();
    expect(h.game.steps).toBe(MAX_STEPS_PER_TICK);

    // brak spirali: zaległości są porzucane
    h.advance(TICK_MS + 1);
    h.tick();
    expect(h.game.steps).toBe(MAX_STEPS_PER_TICK + 1);
  });

  it("start() bez nowMs synchronizuje zegar na pierwszym ticku", () => {
    const h = setup();
    h.loop.start();
    h.loop.tick(500_000);
    expect(h.game.steps).toBe(0); // pierwszy tick tylko ustawia zegar
    h.loop.tick(500_000 + 100);
    expect(h.game.steps).toBe(5);
  });

  it("nie robi nic po stop()", () => {
    const h = setup();
    h.start();
    h.loop.stop();
    h.advance(1000);
    h.tick();
    expect(h.game.steps).toBe(0);
    expect(h.loop.isRunning).toBe(false);
  });
});

describe("GameLoop – kolejność wiadomości", () => {
  it("wysyła `events` przed `snapshot`", () => {
    const explosion: GameEvent = { t: "explosion", x: 10, y: 20, r: 30, power: 40 };
    const h = setup((g) => {
      g.eventsPerStep = [explosion];
    });
    h.start();
    h.advance(SNAPSHOT_MS + 1);
    h.tick();

    const firstEvents = h.sent.findIndex((m) => m.t === "events");
    const firstSnapshot = h.sent.findIndex((m) => m.t === "snapshot");
    expect(firstEvents).toBeGreaterThanOrEqual(0);
    expect(firstSnapshot).toBeGreaterThanOrEqual(0);
    expect(firstEvents).toBeLessThan(firstSnapshot);

    const eventMsgs = h.sent.filter((m) => m.t === "events");
    expect(eventMsgs).toHaveLength(3); // po jednym na krok symulacji
    expect(eventMsgs[0]).toEqual({ t: "events", events: [explosion] });
  });

  it("nie wysyła pustych `events`", () => {
    const h = setup();
    h.start();
    h.advance(SNAPSHOT_MS + 1);
    h.tick();
    expect(h.sent.some((m) => m.t === "events")).toBe(false);
  });
});

describe("GameLoop – koniec gry", () => {
  it("wysyła gameOver, zatrzymuje pętlę i woła onGameOver", () => {
    const h = setup((g) => {
      g.over = true;
    });
    h.start();
    h.advance(TICK_MS + 1);
    h.tick();

    const over = h.sent.find((m) => m.t === "gameOver");
    expect(over).toBeDefined();
    expect(over).toMatchObject({ winnerTeam: 1, winnerName: "Niebiescy" });
    expect((over as { stats: Record<string, unknown> }).stats.round).toBe(2);
    expect(h.loop.isRunning).toBe(false);
    expect(h.onGameOver).toHaveBeenCalledTimes(1);

    // dalsze ticki nic nie robią
    const stepsAfterEnd = h.game.steps;
    h.advance(1000);
    h.tick();
    expect(h.game.steps).toBe(stepsAfterEnd);
    expect(h.sent.filter((m) => m.t === "gameOver")).toHaveLength(1);
  });

  it("gameOver leci po ostatnim snapshocie i po eventach", () => {
    const h = setup((g) => {
      g.eventsPerStep = [{ t: "wormDied", wormId: 3, reason: "explosion" }];
      g.over = true;
    });
    h.start();
    h.advance(TICK_MS + 1);
    h.tick();
    const types = h.sent.map((m) => m.t);
    expect(types).toEqual(["events", "snapshot", "gameOver"]);
  });

  it("removeTeam kończy grę gdy silnik uzna ją za skończoną", () => {
    const h = setup();
    h.start();
    h.game.over = true;
    h.loop.removeTeam(0);
    expect(h.game.removed).toEqual([0]);
    expect(h.loop.isRunning).toBe(false);
    expect(h.sent.some((m) => m.t === "gameOver")).toBe(true);
  });
});

describe("GameLoop – wejście gracza", () => {
  it("przekazuje poprawny input i akcję do silnika", () => {
    const h = setup();
    expect(h.loop.applyInput(0, { left: true, right: false, aim: -0.5, charge: false })).toBe(true);
    expect(h.loop.applyAction(1, { kind: "fire", power: 0.5 })).toBe(true);
    expect(h.game.inputs).toEqual([[0, { left: true, right: false, aim: -0.5, charge: false }]]);
    expect(h.game.actions).toEqual([[1, { kind: "fire", power: 0.5 }]]);
  });

  it("odrzuca śmieci bez dotykania silnika", () => {
    const h = setup();
    expect(h.loop.applyInput(0, { left: 1, right: false, aim: 0, charge: false })).toBe(false);
    expect(h.loop.applyAction(0, { kind: "nuke" })).toBe(false);
    expect(h.game.inputs).toHaveLength(0);
    expect(h.game.actions).toHaveLength(0);
  });

  it("terrainSync bierze dane z silnika", () => {
    const h = setup();
    expect(h.loop.terrainSync()).toEqual({ width: 10, height: 4, rle: [10, 0, 5, 5] });
  });
});

describe("walidacja wejścia", () => {
  it("input wymaga booli i skończonego aim", () => {
    expect(validateInputState({ left: false, right: true, aim: 1.2, charge: true })).toEqual({
      left: false,
      right: true,
      aim: 1.2,
      charge: true,
    });
    expect(validateInputState({ left: false, right: true, aim: Number.NaN, charge: true })).toBeNull();
    expect(validateInputState({ left: false, right: true, aim: Infinity, charge: true })).toBeNull();
    expect(validateInputState({ left: false, right: true, charge: true })).toBeNull();
    expect(validateInputState(null)).toBeNull();
    expect(validateInputState("x")).toBeNull();
  });

  it("power jest przycinane do 0..1", () => {
    expect(validateAction({ kind: "fire", power: 5 })).toEqual({ kind: "fire", power: 1 });
    expect(validateAction({ kind: "fire", power: -3 })).toEqual({ kind: "fire", power: 0 });
    expect(validateAction({ kind: "fire", power: "1" })).toBeNull();
  });

  it("akceptuje akcje z kontraktu, odrzuca resztę", () => {
    expect(validateAction({ kind: "jump" })).toEqual({ kind: "jump" });
    expect(validateAction({ kind: "backflip" })).toEqual({ kind: "backflip" });
    expect(validateAction({ kind: "skipTurn" })).toEqual({ kind: "skipTurn" });
    expect(validateAction({ kind: "surrender" })).toEqual({ kind: "surrender" });
    expect(validateAction({ kind: "girderRotate" })).toEqual({ kind: "girderRotate" });
    expect(validateAction({ kind: "selectWeapon", weapon: "holy" })).toEqual({ kind: "selectWeapon", weapon: "holy" });
    expect(validateAction({ kind: "selectWeapon", weapon: "nuke" })).toBeNull();
    expect(validateAction({ kind: "setTimer", seconds: 3 })).toEqual({ kind: "setTimer", seconds: 3 });
    expect(validateAction({ kind: "setTimer", seconds: 9 })).toBeNull();
    expect(validateAction({ kind: "target", x: 100, y: 200 })).toEqual({ kind: "target", x: 100, y: 200 });
    expect(validateAction({ kind: "target", x: "100", y: 200 })).toBeNull();
    expect(validateAction({})).toBeNull();
    expect(validateAction(undefined)).toBeNull();
  });
});
