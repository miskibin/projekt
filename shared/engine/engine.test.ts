import { describe, expect, it } from "vitest";
import { FIXED_DT, WATER_LEVEL_START, WORLD_HEIGHT, WORLD_WIDTH, WORM_RADIUS } from "../constants";
import type { GameConfig, GameEvent, InputState, WeaponId } from "../protocol";
import { createGame, type Game, type TeamSetup } from "./index";
import { GameImpl } from "./game";
import { circleHits } from "./physics";
import { placeMine } from "./crates";
import { Terrain } from "./terrain";

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    wormsPerTeam: 3,
    turnTime: 45,
    suddenDeathAfterRounds: 10,
    seed: 20240213,
    terrainDensity: 1,
    theme: "grass",
    ...over,
  };
}

function setups(n = 2): TeamSetup[] {
  return Array.from({ length: n }, (_, i) => ({ team: i, playerId: `p${i}`, name: `Gracz ${i}` }));
}

const NEUTRAL: InputState = { left: false, right: false, aim: 0, charge: false };

function stepN(g: Game, n: number, sink?: GameEvent[]): void {
  for (let i = 0; i < n; i++) {
    g.step(FIXED_DT);
    const evs = g.drainEvents();
    if (sink) sink.push(...evs);
  }
}

/** Doprowadza grę do fazy "active" (max `limit` kroków). */
function toActive(g: Game, sink?: GameEvent[], limit = 600): void {
  for (let i = 0; i < limit; i++) {
    if (g.snapshot().turn.phase === "active") return;
    g.step(FIXED_DT);
    const evs = g.drainEvents();
    if (sink) sink.push(...evs);
  }
  throw new Error("nie doczekano fazy active");
}

function clearMines(g: Game): void {
  (g as unknown as GameImpl).mines.length = 0;
}

function activeWorm(g: Game) {
  const s = g.snapshot();
  const w = s.worms.find((x) => x.id === s.turn.activeWormId);
  if (!w) throw new Error("brak aktywnego robaka");
  return w;
}

function countSolid(t: Terrain, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(t.height - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(t.width - 1, x1); x++) if (t.isSolid(x, y)) n++;
  return n;
}

// ---------------------------------------------------------------- determinizm

describe("determinizm", () => {
  it("dwie gry z tym samym seedem i inputami dają identyczne snapshoty po 600 krokach", () => {
    const drive = (g: Game, i: number) => {
      const s = g.snapshot();
      const team = s.turn.activeTeam;
      if (team < 0) return;
      const phase = s.turn.phase;
      if (phase === "active" || phase === "retreat") {
        g.applyInput(team, {
          left: i % 11 === 0,
          right: i % 7 === 0,
          aim: Math.sin(i / 30) * 1.2,
          charge: i % 13 < 4,
        });
      }
      if (phase === "active") {
        if (i % 97 === 0) g.applyAction(team, { kind: "selectWeapon", weapon: i % 194 === 0 ? "grenade" : "bazooka" });
        if (i % 53 === 0) g.applyAction(team, { kind: "fire", power: 0.7 });
        if (i % 31 === 0) g.applyAction(team, { kind: "jump" });
      }
    };

    const a = createGame(cfg(), setups(3));
    const b = createGame(cfg(), setups(3));
    const evA: GameEvent[] = [];
    const evB: GameEvent[] = [];
    for (let i = 0; i < 600; i++) {
      drive(a, i);
      drive(b, i);
      a.step(FIXED_DT);
      b.step(FIXED_DT);
      evA.push(...a.drainEvents());
      evB.push(...b.drainEvents());
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(JSON.stringify(evA)).toBe(JSON.stringify(evB));
    expect(a.terrainSync().rle).toEqual(b.terrainSync().rle);
  });

  it("różne seedy dają różny teren", () => {
    const a = createGame(cfg({ seed: 1 }), setups(2));
    const b = createGame(cfg({ seed: 2 }), setups(2));
    expect(a.terrainSync().rle).not.toEqual(b.terrainSync().rle);
  });
});

// ---------------------------------------------------------------- rozstawienie

describe("rozstawienie robaków", () => {
  it("robaki nie startują w terenie ani w wodzie i mają unikalne imiona", () => {
    for (const seed of [1, 77, 4242, 999999]) {
      const g = createGame(cfg({ seed, wormsPerTeam: 4 }), setups(4));
      const s = g.snapshot();
      expect(s.worms.length).toBe(16);
      for (const w of s.worms) {
        expect(w.hp).toBe(100);
        expect(w.alive).toBe(true);
        expect(w.x).toBeGreaterThan(0);
        expect(w.x).toBeLessThan(WORLD_WIDTH);
        expect(w.y).toBeLessThan(WATER_LEVEL_START);
        expect(w.y).toBeGreaterThan(0);
        expect(circleHits(g.terrain, w.x, w.y, WORM_RADIUS)).toBe(false);
        expect(w.name.length).toBeGreaterThan(2);
      }
      // przynajmniej część robaków jest od siebie odsunięta
      let minDist = Infinity;
      for (let i = 0; i < s.worms.length; i++)
        for (let j = i + 1; j < s.worms.length; j++)
          minDist = Math.min(minDist, Math.hypot(s.worms[i].x - s.worms[j].x, s.worms[i].y - s.worms[j].y));
      expect(minDist).toBeGreaterThan(15);
    }
  });

  it("robaki nie wpadają pod teren po 300 krokach spokoju", () => {
    const g = createGame(cfg({ seed: 5150 }), setups(2));
    stepN(g, 300);
    for (const w of g.snapshot().worms) {
      if (!w.alive) continue;
      expect(Number.isFinite(w.x)).toBe(true);
      expect(w.y).toBeLessThan(WORLD_HEIGHT);
    }
  });
});

// ---------------------------------------------------------------- bronie

describe("bronie", () => {
  it("bazooka w dół zadaje obrażenia i wycina teren", () => {
    const g = createGame(cfg({ seed: 31337 }), setups(2));
    const events: GameEvent[] = [];
    toActive(g, events);
    const w = activeWorm(g);
    const team = g.snapshot().turn.activeTeam;
    const before = countSolid(g.terrain, Math.round(w.x) - 40, Math.round(w.y), Math.round(w.x) + 40, Math.round(w.y) + 60);
    g.applyAction(team, { kind: "selectWeapon", weapon: "bazooka" });
    g.applyInput(team, { ...NEUTRAL, aim: Math.PI / 2 });
    g.applyAction(team, { kind: "fire", power: 1 });
    events.length = 0;
    stepN(g, 60, events);
    const after = countSolid(g.terrain, Math.round(w.x) - 40, Math.round(w.y), Math.round(w.x) + 40, Math.round(w.y) + 60);
    expect(events.some((e) => e.t === "explosion")).toBe(true);
    expect(after).toBeLessThan(before);
    const w2 = g.snapshot().worms.find((x) => x.id === w.id)!;
    expect(w2.hp).toBeLessThan(100);
  });

  it("granat wybucha dopiero po ustawionym timerze", () => {
    const g = createGame(cfg({ seed: 8888 }), setups(2));
    toActive(g);
    clearMines(g);
    const team = g.snapshot().turn.activeTeam;
    g.applyAction(team, { kind: "selectWeapon", weapon: "grenade" });
    g.applyAction(team, { kind: "setTimer", seconds: 3 });
    g.applyInput(team, { ...NEUTRAL, aim: -0.4 });
    g.drainEvents();
    g.applyAction(team, { kind: "fire", power: 0.35 });

    const early: GameEvent[] = [];
    stepN(g, Math.round(2.5 * 60), early);
    expect(early.some((e) => e.t === "explosion")).toBe(false);
    const late: GameEvent[] = [];
    stepN(g, Math.round(1.2 * 60), late);
    expect(late.some((e) => e.t === "explosion")).toBe(true);
  });

  it("broń rzucana ma odrębny ciężar, prędkość i sprężystość", () => {
    const launch = (weapon: Extract<WeaponId, "grenade" | "cluster" | "banana">) => {
      const g = createGame(cfg({ seed: 4433 }), setups(2));
      const gi = g as GameImpl;
      toActive(g);
      clearMines(g);
      const team = g.snapshot().turn.activeTeam;
      g.applyAction(team, { kind: "selectWeapon", weapon });
      g.applyInput(team, { ...NEUTRAL, aim: -0.7 });
      g.applyAction(team, { kind: "fire", power: 0.75 });
      return gi.projectiles.find((p) => p.kind === weapon)!;
    };

    const grenade = launch("grenade");
    const cluster = launch("cluster");
    const banana = launch("banana");
    expect(Math.hypot(grenade.vx, grenade.vy)).toBeLessThan(Math.hypot(cluster.vx, cluster.vy));
    expect(Math.hypot(cluster.vx, cluster.vy)).toBeLessThan(Math.hypot(banana.vx, banana.vy));
    expect(grenade.gravityScale).toBeGreaterThan(cluster.gravityScale);
    expect(cluster.gravityScale).toBeGreaterThan(banana.gravityScale);
    expect(grenade.restitution).toBeLessThan(cluster.restitution);
    expect(cluster.restitution).toBeLessThan(banana.restitution);
  });

  it("banan rozpada się na szeroki wachlarz ośmiu mini-bananów", () => {
    const g = createGame(cfg({ seed: 9191 }), setups(2));
    const gi = g as GameImpl;
    toActive(g);
    clearMines(g);
    const team = g.snapshot().turn.activeTeam;
    g.applyAction(team, { kind: "selectWeapon", weapon: "banana" });
    g.applyAction(team, { kind: "setTimer", seconds: 1 });
    g.applyInput(team, { ...NEUTRAL, aim: -1.15 });
    g.applyAction(team, { kind: "fire", power: 0.35 });

    let children = gi.projectiles.filter((p) => p.kind === "bananalet");
    for (let i = 0; i < 120 && children.length === 0; i++) {
      g.step(FIXED_DT);
      g.drainEvents();
      children = gi.projectiles.filter((p) => p.kind === "bananalet");
    }
    expect(children).toHaveLength(8);
    expect(Math.min(...children.map((p) => p.vx))).toBeLessThan(-250);
    expect(Math.max(...children.map((p) => p.vx))).toBeGreaterThan(250);
    expect(children.every((p) => p.fuse !== undefined && p.fuse > 0)).toBe(true);
  });

  it("shotgun pozwala na dwa strzały, dopiero drugi kończy turę", () => {
    const g = createGame(cfg({ seed: 606 }), setups(2));
    toActive(g);
    const team = g.snapshot().turn.activeTeam;
    g.applyAction(team, { kind: "selectWeapon", weapon: "shotgun" });
    expect(g.snapshot().turn.shotsLeft).toBe(2);
    g.applyInput(team, { ...NEUTRAL, aim: -0.2 });
    g.applyAction(team, { kind: "fire", power: 1 });
    g.step(FIXED_DT);
    expect(g.snapshot().turn.phase).toBe("active");
    expect(g.snapshot().turn.shotsLeft).toBe(1);
    g.applyAction(team, { kind: "fire", power: 1 });
    g.step(FIXED_DT);
    expect(g.snapshot().turn.phase).toBe("retreat");
  });

  it("girder dokłada teren i nie kończy tury", () => {
    const g = createGame(cfg({ seed: 4711 }), setups(2));
    const events: GameEvent[] = [];
    toActive(g, events);
    const team = g.snapshot().turn.activeTeam;
    g.applyAction(team, { kind: "selectWeapon", weapon: "girder" });
    g.applyAction(team, { kind: "girderRotate" });
    const gx = 400;
    const gy = 200;
    const before = countSolid(g.terrain, gx - 60, gy - 60, gx + 60, gy + 60);
    events.length = 0;
    g.applyAction(team, { kind: "target", x: gx, y: gy });
    stepN(g, 2, events);
    expect(countSolid(g.terrain, gx - 60, gy - 60, gx + 60, gy + 60)).toBeGreaterThan(before);
    expect(events.some((e) => e.t === "carveRect" && e.add)).toBe(true);
    expect(g.snapshot().turn.phase).toBe("active");
  });

  it("teleport przenosi robaka i kończy turę", () => {
    const g = createGame(cfg({ seed: 991 }), setups(2));
    toActive(g);
    const team = g.snapshot().turn.activeTeam;
    const w = activeWorm(g);
    g.applyAction(team, { kind: "selectWeapon", weapon: "teleport" });
    g.applyAction(team, { kind: "target", x: 100, y: 60 });
    g.step(FIXED_DT);
    const w2 = g.snapshot().worms.find((x) => x.id === w.id)!;
    expect(Math.abs(w2.x - 100)).toBeLessThan(5);
    expect(g.snapshot().turn.phase).toBe("retreat");
  });

  it("jetpack nie kończy tury i pozwala wzbić się w górę", () => {
    const g = createGame(cfg({ seed: 12321 }), setups(2));
    toActive(g);
    const team = g.snapshot().turn.activeTeam;
    const w0 = activeWorm(g);
    g.applyAction(team, { kind: "selectWeapon", weapon: "jetpack" });
    g.applyAction(team, { kind: "fire", power: 1 });
    g.step(FIXED_DT);
    expect(g.snapshot().turn.phase).toBe("active");
    for (let i = 0; i < 60; i++) {
      g.applyInput(team, { ...NEUTRAL, charge: true });
      g.step(FIXED_DT);
    }
    const w1 = g.snapshot().worms.find((x) => x.id === w0.id)!;
    expect(w1.y).toBeLessThan(w0.y - 20);
    expect(w1.anim).toBe("jetpack");
  });

  it("kij baseballowy odrzuca sąsiedniego robaka", () => {
    const g = createGame(cfg({ seed: 777 }), setups(2));
    const gi = g as unknown as GameImpl;
    toActive(g);
    const team = g.snapshot().turn.activeTeam;
    const attacker = gi.worms.find((w) => w.id === g.snapshot().turn.activeWormId)!;
    const victim = gi.worms.find((w) => w.team !== attacker.team && w.alive)!;
    attacker.facing = 1;
    victim.x = attacker.x + 14;
    victim.y = attacker.y;
    victim.onGround = true;
    g.applyAction(team, { kind: "selectWeapon", weapon: "bat" });
    g.applyInput(team, { ...NEUTRAL, aim: -0.3 });
    g.applyAction(team, { kind: "fire", power: 1 });
    expect(victim.hp).toBe(70);
    expect(Math.abs(victim.vx)).toBeGreaterThan(200);
  });

  it("amunicja startowa zgadza się z regulaminem", () => {
    const g = createGame(cfg(), setups(2));
    const ammo = g.snapshot().teams[0].ammo;
    expect(ammo.bazooka).toBe(-1);
    expect(ammo.grenade).toBe(-1);
    expect(ammo.shotgun).toBe(-1);
    expect(ammo.skip).toBe(-1);
    expect(ammo.uzi).toBe(3);
    expect(ammo.cluster).toBe(2);
    expect(ammo.holy).toBe(1);
    expect(ammo.dynamite).toBe(1);
    expect(ammo.mine).toBe(2);
    expect(ammo.airstrike).toBe(1);
    expect(ammo.homing).toBe(1);
    expect(ammo.banana).toBe(1);
    expect(ammo.bat).toBe(2);
    expect(ammo.teleport).toBe(2);
    expect(ammo.girder).toBe(3);
    expect(ammo.jetpack).toBe(1);
  });

  it("zużycie amunicji zmniejsza licznik", () => {
    const g = createGame(cfg({ seed: 5 }), setups(2));
    toActive(g);
    const team = g.snapshot().turn.activeTeam;
    g.applyAction(team, { kind: "selectWeapon", weapon: "cluster" });
    g.applyInput(team, { ...NEUTRAL, aim: -0.6 });
    g.applyAction(team, { kind: "fire", power: 0.6 });
    const t = g.snapshot().teams.find((x) => x.team === team)!;
    expect(t.ammo.cluster).toBe(1);
  });
});

// ---------------------------------------------------------------- tury

describe("tury", () => {
  it("po strzale jest retreat, potem settling, potem tura kolejnej drużyny", () => {
    const g = createGame(cfg({ seed: 2024 }), setups(2));
    toActive(g);
    const first = g.snapshot().turn.activeTeam;
    g.applyAction(first, { kind: "selectWeapon", weapon: "bazooka" });
    g.applyInput(first, { ...NEUTRAL, aim: -0.5 });
    g.applyAction(first, { kind: "fire", power: 0.6 });
    g.step(FIXED_DT);
    expect(g.snapshot().turn.phase).toBe("retreat");
    let sawSettling = false;
    for (let i = 0; i < 2000; i++) {
      g.step(FIXED_DT);
      g.drainEvents();
      const t = g.snapshot().turn;
      if (t.phase === "settling") sawSettling = true;
      if (t.phase === "active" && t.activeTeam !== first) break;
    }
    expect(sawSettling).toBe(true);
    expect(g.snapshot().turn.activeTeam).not.toBe(first);
  });

  it("skipTurn oddaje turę i zmienia wiatr", () => {
    const g = createGame(cfg({ seed: 4321 }), setups(2));
    toActive(g);
    const first = g.snapshot().turn.activeTeam;
    const wind = g.snapshot().turn.wind;
    g.applyAction(first, { kind: "skipTurn" });
    let guard = 0;
    while (g.snapshot().turn.activeTeam === first && guard++ < 2000) {
      g.step(FIXED_DT);
      g.drainEvents();
    }
    expect(g.snapshot().turn.activeTeam).not.toBe(first);
    toActive(g);
    expect(g.snapshot().turn.wind).not.toBe(wind);
  });

  it("nie zostawia długiej pustej pauzy między ruchami", () => {
    const g = createGame(cfg({ seed: 2424 }), setups(2));
    toActive(g);
    const first = g.snapshot().turn.activeTeam;
    g.applyAction(first, { kind: "selectWeapon", weapon: "shotgun" });
    g.applyAction(first, { kind: "fire", power: 1 });
    g.applyAction(first, { kind: "fire", power: 1 });
    let ticks = 0;
    while (ticks < 240 && !(g.snapshot().turn.phase === "active" && g.snapshot().turn.activeTeam !== first)) {
      g.step(FIXED_DT);
      g.drainEvents();
      ticks++;
    }
    expect(ticks * FIXED_DT).toBeLessThan(3.5);
  });

  it("koniec czasu kończy turę", () => {
    const g = createGame(cfg({ seed: 13, turnTime: 1 }), setups(2));
    toActive(g);
    const first = g.snapshot().turn.activeTeam;
    let guard = 0;
    while (g.snapshot().turn.activeTeam === first && guard++ < 3000) {
      g.step(FIXED_DT);
      g.drainEvents();
    }
    expect(guard).toBeLessThan(3000);
  });

  it("gra kończy się gdy zostaje jedna drużyna", () => {
    const g = createGame(cfg({ seed: 4242 }), setups(2));
    toActive(g);
    expect(g.isOver()).toBe(false);
    g.removeTeam(1);
    expect(g.isOver()).toBe(true);
    expect(g.winner().team).toBe(0);
    expect(g.winner().name).toBe("Gracz 0");
    for (const w of g.snapshot().worms) if (w.team === 1) expect(w.alive).toBe(false);
  });

  it("remis gdy nikt nie przeżyje", () => {
    const g = createGame(cfg({ seed: 191 }), setups(2));
    const gi = g as unknown as GameImpl;
    toActive(g);
    for (const w of gi.worms) gi.damageWorm(w, 999, "explosion");
    g.step(FIXED_DT);
    expect(g.isOver()).toBe(true);
    expect(g.winner().team).toBe(null);
  });

  it("turnStart niesie dane tury bez osobnego, podwójnego komunikatu", () => {
    const g = createGame(cfg({ seed: 61 }), setups(2));
    const evs = g.drainEvents();
    const start = evs.find((e) => e.t === "turnStart");
    expect(start && start.t === "turnStart" && start.wormId > 0).toBe(true);
    expect(evs.some((e) => e.t === "message" && e.text.startsWith("Tura:"))).toBe(false);
  });
});

// ---------------------------------------------------------------- skrzynki i miny

describe("skrzynki i miny", () => {
  it("skrzynka zdrowia leczy robaka", () => {
    const g = createGame(cfg({ seed: 30303 }), setups(2));
    const gi = g as unknown as GameImpl;
    toActive(g);
    clearMines(g);
    const worm = gi.worms[0];
    gi.damageWorm(worm, 60, "explosion");
    expect(worm.hp).toBe(40);
    gi.crates.length = 0;
    gi.crates.push({ id: gi.nextId(), kind: "health", x: worm.x, y: worm.y, vy: 0, landed: true, amount: 25 });
    const evs: GameEvent[] = [];
    stepN(g, 2, evs);
    expect(worm.hp).toBe(65);
    expect(evs.some((e) => e.t === "cratePickup" && e.kind === "health")).toBe(true);
    expect(gi.crates.length).toBe(0);
  });

  it("skrzynka z bronią dodaje amunicję", () => {
    const g = createGame(cfg({ seed: 30304 }), setups(2));
    const gi = g as unknown as GameImpl;
    toActive(g);
    clearMines(g);
    const worm = gi.worms[0];
    const before = gi.teams[worm.team].ammo.holy;
    gi.crates.length = 0;
    gi.crates.push({
      id: gi.nextId(),
      kind: "weapon",
      x: worm.x,
      y: worm.y,
      vy: 0,
      landed: true,
      amount: 1,
      weapon: "holy",
    });
    stepN(g, 2);
    expect(gi.teams[worm.team].ammo.holy).toBe(before + 1);
  });

  it("mina detonuje po zbliżeniu robaka", () => {
    const g = createGame(cfg({ seed: 51 }), setups(2));
    const gi = g as unknown as GameImpl;
    toActive(g);
    gi.mines.length = 0;
    const worm = gi.worms[0];
    const hp0 = worm.hp;
    const m = placeMine(gi, worm.x + 12, worm.y);
    m.onGround = true;
    const evs: GameEvent[] = [];
    // 2 s uzbrajania + 1.5 s zapalnika
    stepN(g, Math.round(2.0 * 60), evs);
    expect(evs.some((e) => e.t === "explosion")).toBe(false);
    stepN(g, Math.round(2.0 * 60), evs);
    expect(evs.some((e) => e.t === "explosion")).toBe(true);
    expect(gi.worms.find((w) => w.id === worm.id)!.hp).toBeLessThan(hp0);
  });

  it("mapa startuje z uzbrojonymi minami", () => {
    const g = createGame(cfg({ seed: 9090 }), setups(2));
    const mines = g.snapshot().mines;
    expect(mines.length).toBeGreaterThanOrEqual(4);
    expect(mines.length).toBeLessThanOrEqual(8);
    expect(mines.every((m) => m.armed)).toBe(true);
  });
});

// ---------------------------------------------------------------- sudden death

describe("nagła śmierć", () => {
  it("podnosi wodę, ścina HP do 20 i w końcu topi robaki", () => {
    const g = createGame(cfg({ seed: 606060, wormsPerTeam: 1, suddenDeathAfterRounds: 1 }), setups(2));
    const events: GameEvent[] = [];
    let sawSudden = false;
    let drowned = false;
    for (let i = 0; i < 40000; i++) {
      const t = g.snapshot().turn;
      if (t.phase === "active") g.applyAction(t.activeTeam, { kind: "skipTurn" });
      g.step(FIXED_DT);
      for (const e of g.drainEvents()) {
        events.push(e);
        if (e.t === "suddenDeath") sawSudden = true;
        if (e.t === "wormDied" && e.reason === "drown") drowned = true;
      }
      if (g.isOver()) break;
    }
    expect(sawSudden).toBe(true);
    expect(g.snapshot().turn.suddenDeath).toBe(true);
    expect(g.snapshot().turn.waterLevel).toBeLessThan(WATER_LEVEL_START);
    expect(drowned).toBe(true);
    expect(g.isOver()).toBe(true);
    expect(events.some((e) => e.t === "message" && e.text.includes("Nagła śmierć"))).toBe(true);
  });

  it("HP jest ścinane do 20 przy nagłej śmierci", () => {
    const g = createGame(cfg({ seed: 1717, wormsPerTeam: 2, suddenDeathAfterRounds: 1 }), setups(2));
    for (let i = 0; i < 4000; i++) {
      const t = g.snapshot().turn;
      if (t.phase === "active") g.applyAction(t.activeTeam, { kind: "skipTurn" });
      g.step(FIXED_DT);
      g.drainEvents();
      if (g.snapshot().turn.suddenDeath) break;
    }
    expect(g.snapshot().turn.suddenDeath).toBe(true);
    for (const w of g.snapshot().worms) if (w.alive) expect(w.hp).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------- teren / sync

describe("terrainSync", () => {
  it("RLE odtwarza dokładnie ten sam teren", () => {
    const g = createGame(cfg({ seed: 24680 }), setups(2));
    stepN(g, 120);
    const sync = g.terrainSync();
    const clone = Terrain.fromRLE(sync.width, sync.height, sync.rle);
    let diff = 0;
    for (let i = 0; i < g.terrain.data.length; i++) if (clone.data[i] !== g.terrain.data[i]) diff++;
    expect(diff).toBe(0);
  });
});
