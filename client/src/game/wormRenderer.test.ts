import { describe, expect, it } from "vitest";
import { LOW_HP, PRUNE_AFTER, SCARE_RADIUS, WALK_VX, WormAnimator, type AnimWorld, type AnimWorm } from "./wormRenderer";

function worm(over: Partial<AnimWorm> = {}): AnimWorm {
  return {
    id: 1,
    team: 0,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    hp: 100,
    alive: true,
    aim: 0,
    ...over,
  };
}

function world(worms: AnimWorm[], over: Partial<AnimWorld> = {}): AnimWorld {
  return {
    worms,
    threats: [],
    activeWormId: -1,
    activeTeam: -1,
    phase: "active",
    charge: 0,
    ...over,
  };
}

/** Przewija animator o `seconds` w krokach po `dt` (domyślnie 60 fps). */
function run(a: WormAnimator, seconds: number, w: AnimWorld, dt = 1 / 60): void {
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) a.update(dt, w);
}

describe("WormAnimator – stany", () => {
  it("stoi bezczynnie i oddycha", () => {
    const a = new WormAnimator();
    run(a, 0.5, world([worm()]));
    const p = a.pose(1)!;
    expect(p.state).toBe("idle");
    expect(p.hold).toBeNull();
    expect(p.sy).toBeGreaterThan(0.9);
    expect(p.sy).toBeLessThan(1.1);
  });

  it("chodzi gdy |vx| przekracza próg i jest na ziemi", () => {
    const a = new WormAnimator();
    run(a, 0.4, world([worm({ vx: WALK_VX + 30 })]));
    expect(a.state(1)).toBe("walk");
    // pochylenie w stronę ruchu
    expect(a.pose(1)!.lean).toBeGreaterThan(0);
    const b = new WormAnimator();
    run(b, 0.4, world([worm({ vx: WALK_VX - 2 })]));
    expect(b.state(1)).toBe("idle");
  });

  it("wykrywa chód po zmianie pozycji, gdy vx pozostaje zerowe (walkStep)", () => {
    const a = new WormAnimator();
    // silnik przesuwa robaka bezpośrednio – vx = 0, ale x rośnie o 80 px/s
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, world([worm({ x: 100 + (i * 80) / 60, vx: 0 })]));
    }
    expect(a.state(1)).toBe("walk");
    // po zatrzymaniu wraca do idle
    run(a, 0.5, world([worm({ x: 140 })]));
    expect(a.state(1)).toBe("idle");
  });

  it("rozciąga się przy wznoszeniu i kuli przy spadaniu", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm({ onGround: false, vy: -300 })]));
    const up = a.pose(1)!;
    expect(up.state).toBe("jump");
    expect(up.sy).toBeGreaterThan(1);
    expect(up.armsUp).toBeGreaterThan(0.5);

    a.update(1 / 60, world([worm({ onGround: false, vy: 400 })]));
    const down = a.pose(1)!;
    expect(down.state).toBe("fall");
    expect(down.sy).toBeLessThan(1);
    expect(down.eyeL).toBeGreaterThan(1);
  });

  it("po lądowaniu robi przysiad skalowany prędkością i wraca do idle", () => {
    const a = new WormAnimator();
    const air = world([worm({ onGround: false, vy: 500 })]);
    run(a, 0.4, air);
    a.update(1 / 60, world([worm({ onGround: true, vy: 0 })]));
    const land = a.pose(1)!;
    expect(land.state).toBe("land");
    expect(land.sy).toBeLessThan(0.85);
    expect(land.squat).toBeGreaterThan(0.5);
    run(a, 0.5, world([worm()]));
    expect(a.state(1)).toBe("idle");
  });

  it("miękkie zejście (krótki lot) nie wywołuje przysiadu", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm({ onGround: false, vy: 40 })]));
    a.update(1 / 60, world([worm({ onGround: true })]));
    expect(a.state(1)).not.toBe("land");
  });

  it("celuje: trzyma broń pod kątem aim i mruży jedno oko", () => {
    const a = new WormAnimator();
    run(a, 0.2, world([worm({ aim: -0.4 })], { activeWormId: 1, activeTeam: 0 }));
    const p = a.pose(1)!;
    expect(p.state).toBe("aim");
    expect(p.hold).toBeCloseTo(-0.4, 5);
    expect(p.eyeR).toBeLessThan(p.eyeL);
    // odchylenie do tyłu przy celowaniu w górę
    expect(p.lean).toBeLessThan(0);
  });

  it("ładuje strzał: drży, nadyma policzki i zaciska zęby", () => {
    const a = new WormAnimator();
    run(a, 0.3, world([worm()], { activeWormId: 1, activeTeam: 0, charge: 0.8 }));
    const p = a.pose(1)!;
    expect(p.state).toBe("charge");
    expect(p.cheeks).toBeGreaterThan(0.5);
    expect(p.mouth).toBe("grit");
    expect(Math.abs(p.ox)).toBeGreaterThan(0);
  });

  it("odrzut po strzale trwa ~0.25 s i odpycha robaka do tyłu", () => {
    const a = new WormAnimator();
    const w = world([worm()]);
    a.update(1 / 60, w);
    a.onShot(1);
    a.update(1 / 60, w);
    const p = a.pose(1)!;
    expect(p.state).toBe("recoil");
    expect(p.ox).toBeLessThan(0); // facing = 1 -> kopnięcie w lewo
    run(a, 0.3, w);
    expect(a.state(1)).not.toBe("recoil");
  });

  it("reaguje na spadek HP nawet bez zdarzenia (błysk + wzdrygnięcie)", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm()]));
    a.update(1 / 60, world([worm({ hp: 70 })]));
    const p = a.pose(1)!;
    expect(p.state).toBe("hurt");
    expect(p.flash).toBeGreaterThan(0.5);
    expect(p.xEyes).toBe(1);
    run(a, 0.6, world([worm({ hp: 70 })]));
    expect(a.state(1)).toBe("idle");
    expect(a.pose(1)!.flash).toBe(0);
  });

  it("mruga w ciągu 5 s i zamyka wtedy oczy", () => {
    const a = new WormAnimator();
    const w = world([worm()]);
    let closed = false;
    for (let i = 0; i < 60 * 5; i++) {
      a.update(1 / 60, w);
      if (a.pose(1)!.eyeL < 0.25) closed = true;
    }
    expect(closed).toBe(true);
  });

  it("boi się pobliskiego pocisku i przestaje gdy ten odleci", () => {
    const a = new WormAnimator();
    const near = world([worm()], { threats: [{ x: 100 + SCARE_RADIUS / 2, y: 100 }] });
    run(a, 0.5, near);
    const p = a.pose(1)!;
    expect(p.state).toBe("scared");
    expect(p.eyeL).toBeGreaterThan(1);
    expect(p.brow).toBeGreaterThan(0.5);
    run(a, 1.5, world([worm()], { threats: [{ x: 100 + SCARE_RADIUS * 3, y: 100 }] }));
    expect(a.state(1)).toBe("idle");
  });

  it("przy niskim HP jest zmęczony i się poci", () => {
    const a = new WormAnimator();
    run(a, 0.3, world([worm({ hp: LOW_HP - 5 })]));
    const p = a.pose(1)!;
    expect(p.state).toBe("tired");
    expect(p.lid).toBeGreaterThan(0.3);
    expect(p.mouth).toBe("frown");
  });

  it("cieszy się gdy jego drużyna trafi przeciwnika, do końca tury", () => {
    const a = new WormAnimator();
    const mine = worm({ id: 1, team: 0 });
    const foe = worm({ id: 2, team: 1, x: 400 });
    const w = world([mine, foe], { activeTeam: 0, activeWormId: 1 });
    a.update(1 / 60, w);
    a.onDamage(2, 30);
    a.update(1 / 60, w);
    expect(a.state(1)).toBe("celebrate");
    expect(a.pose(1)!.happyEyes).toBe(1);
    expect(a.pose(1)!.mouth).toBe("bigSmile");
    // ofiara nie świętuje
    expect(a.state(2)).toBe("hurt");
    // po turze radość znika
    a.onTurnStart(1);
    a.update(1 / 60, { ...w, activeTeam: 1 });
    expect(a.state(1)).not.toBe("celebrate");
  });

  it("nie świętuje ostrzału własnej drużyny", () => {
    const a = new WormAnimator();
    const w = world([worm({ id: 1, team: 0 }), worm({ id: 2, team: 0, x: 300 })], {
      activeTeam: 0,
      activeWormId: 1,
    });
    a.update(1 / 60, w);
    a.onDamage(2, 10);
    a.update(1 / 60, w);
    expect(a.state(1)).not.toBe("celebrate");
  });

  it("śmierć: zgniecenie i zanik", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm()]));
    a.update(1 / 60, world([worm({ alive: false, hp: 0 })]));
    const p = a.pose(1)!;
    expect(p.state).toBe("dead");
    expect(p.sy).toBeLessThan(1);
    expect(p.alpha).toBeGreaterThan(0);
    run(a, 0.4, world([worm({ alive: false, hp: 0 })]));
    expect(a.pose(1)!.alpha).toBe(0);
  });

  it("zachowuje stany jetpack i bat", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm({ anim: "jetpack", onGround: false, vy: -50 })]));
    expect(a.state(1)).toBe("jetpack");
    a.update(1 / 60, world([worm({ anim: "bat" })]));
    expect(a.state(1)).toBe("bat");
  });

  it("usuwa wpisy robaków niewidzianych dłużej niż próg", () => {
    const a = new WormAnimator();
    a.update(1 / 60, world([worm({ id: 1 }), worm({ id: 2, x: 300 })]));
    expect(a.size).toBe(2);
    run(a, PRUNE_AFTER + 1, world([worm({ id: 1 })]));
    expect(a.size).toBe(1);
    expect(a.pose(2)).toBeNull();
  });

  it("timery są niezależne od liczby klatek", () => {
    const fast = new WormAnimator();
    const slow = new WormAnimator();
    const w = world([worm()]);
    fast.update(0.01, w);
    slow.update(0.01, w);
    fast.onShot(1);
    slow.onShot(1);
    // dokładnie 0.2 s w obu przypadkach, ale innym krokiem
    run(fast, 0.2, w, 0.01);
    run(slow, 0.2, w, 0.05);
    expect(fast.pose(1)!.ox).toBeCloseTo(slow.pose(1)!.ox, 5);
    expect(fast.state(1)).toBe(slow.state(1));
  });

  it("ignoruje absurdalnie duże dt (przełączenie zakładki)", () => {
    const a = new WormAnimator();
    const w = world([worm()]);
    a.update(1 / 60, w);
    a.onShot(1);
    a.update(5, w);
    // 5 s zostaje przycięte do 0.1 s, więc odrzut jeszcze trwa
    expect(a.state(1)).toBe("recoil");
  });
});
