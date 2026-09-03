import {
  MAX_WIND,
  TEAM_NAMES,
  WATER_LEVEL_START,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@shared/constants";
import type { Terrain } from "@shared/engine/terrain";
import type {
  GameEvent,
  GameSnapshot,
  PlayerInfo,
  RoomState,
  WeaponId,
  WormSnapshot,
} from "@shared/protocol";

const NAMES = ["Zbyszek", "Halina", "Bolek", "Lolek", "Krzysiek", "Zenek"];

/**
 * Tryb podglądu deweloperskiego (`?demo=1`): generuje lokalnie snapshoty i zdarzenia,
 * żeby dało się obejrzeć render bez serwera.
 */
export class DemoDriver {
  private t = 0;
  private tick = 0;
  private nextBoom = 1.2;
  private worms: WormSnapshot[] = [];
  private projX = 200;
  private projY = 400;
  private projVX = 260;
  private projVY = -320;
  private crateY = -40;
  private timeLeft = 45;

  constructor(private readonly terrain: Terrain) {
    const spots = [180, 420, 760, 1080, 1420, 1720];
    this.worms = spots.map((x, i) => ({
      id: i + 1,
      team: i % 3,
      name: NAMES[i],
      x,
      y: Math.max(60, terrain.surfaceY(x) - 11),
      vx: 0,
      vy: 0,
      hp: [100, 78, 100, 43, 26, 92][i],
      alive: true,
      facing: (i % 2 === 0 ? 1 : -1) as 1 | -1,
      aim: i % 2 === 0 ? -0.6 : Math.PI + 0.6,
      onGround: true,
      anim: i === 4 ? "jetpack" : undefined,
    }));
  }

  update(dt: number): { snapshot: GameSnapshot; events: GameEvent[] } {
    this.t += dt;
    this.tick++;
    this.timeLeft -= dt;
    if (this.timeLeft < 0) this.timeLeft = 45;
    const events: GameEvent[] = [];

    // pocisk po paraboli, restart po wyjściu poza mapę
    this.projVY += 900 * dt;
    this.projX += this.projVX * dt;
    this.projY += this.projVY * dt;
    if (this.projY > WORLD_HEIGHT - 40 || this.projX > WORLD_WIDTH - 20 || this.terrain.isSolid(this.projX, this.projY)) {
      events.push({ t: "explosion", x: Math.round(this.projX), y: Math.round(this.projY), r: 34, power: 40 });
      events.push({ t: "sound", name: "explosion", x: this.projX, y: this.projY });
      this.projX = 160;
      this.projY = 380;
      this.projVX = 230 + Math.random() * 90;
      this.projVY = -340 - Math.random() * 80;
    }

    // skrzynka opada
    if (this.crateY < this.terrain.surfaceY(980) - 12) this.crateY += 60 * dt;

    // losowe eksplozje
    this.nextBoom -= dt;
    if (this.nextBoom <= 0) {
      this.nextBoom = 1.4 + Math.random() * 1.8;
      const x = 120 + Math.random() * (WORLD_WIDTH - 240);
      const y = Math.max(80, this.terrain.surfaceY(x) + Math.random() * 60 - 20);
      const r = 26 + Math.random() * 26;
      events.push({ t: "explosion", x: Math.round(x), y: Math.round(y), r: Math.round(r), power: r });
      events.push({ t: "sound", name: "explosion", x, y });
      const victim = this.worms.find((w) => Math.abs(w.x - x) < 120 && w.alive);
      if (victim) {
        const dmg = Math.round(4 + Math.random() * 12);
        victim.hp = Math.max(1, victim.hp - dmg);
        events.push({ t: "damage", wormId: victim.id, amount: dmg, x: victim.x, y: victim.y });
      }
    }

    // delikatny ruch aktywnego robaka i celowania
    const act = this.worms[0];
    act.aim = -0.9 + Math.sin(this.t * 0.7) * 0.5;
    act.x = 180 + Math.sin(this.t * 0.5) * 40;
    act.y = Math.max(60, this.terrain.surfaceY(act.x) - 11);

    const ammo: Partial<Record<WeaponId, number>> = {
      bazooka: -1,
      grenade: -1,
      cluster: 3,
      banana: 1,
      shotgun: 2,
      uzi: 2,
      holy: 1,
      dynamite: 1,
      mine: 2,
      airstrike: 1,
      homing: 1,
      bat: 2,
      teleport: 1,
      girder: 2,
      jetpack: 1,
      skip: -1,
    };

    const teams = [0, 1, 2].map((team) => {
      const ws = this.worms.filter((w) => w.team === team);
      return {
        team,
        playerId: `demo-${team}`,
        name: ["Ty", "Bot Alfa", "Bot Beta"][team],
        totalHp: ws.reduce((s, w) => s + (w.alive ? w.hp : 0), 0),
        alive: ws.filter((w) => w.alive).length,
        ammo,
      };
    });

    const snapshot: GameSnapshot = {
      tick: this.tick,
      time: this.t,
      worms: this.worms.map((w) => ({ ...w })),
      projectiles: [
        {
          id: 2,
          kind: "grenade",
          x: 1180 + Math.sin(this.t * 1.4) * 60,
          y: 420 + Math.cos(this.t * 2.1) * 40,
          vx: 40,
          vy: -20,
          fuse: 1 + (Math.sin(this.t) + 1) * 1.4,
        },
        {
          id: 3,
          kind: "bazooka",
          x: this.projX,
          y: this.projY,
          vx: this.projVX,
          vy: this.projVY,
          angle: Math.atan2(this.projVY, this.projVX),
        },
      ],
      crates: [
        { id: 1, kind: "weapon", x: 980, y: this.crateY, vy: 60, landed: this.crateY >= this.terrain.surfaceY(980) - 12 },
        { id: 2, kind: "health", x: 1560, y: this.terrain.surfaceY(1560) - 10, vy: 0, landed: true },
      ],
      mines: [
        { id: 1, x: 640, y: this.terrain.surfaceY(640) - 5, armed: true },
        { id: 2, x: 1320, y: this.terrain.surfaceY(1320) - 5, armed: true, fuse: 1.2 },
      ],
      teams,
      turn: {
        phase: "active",
        activeTeam: 0,
        activeWormId: 1,
        timeLeft: this.timeLeft,
        round: 3,
        wind: Math.sin(this.t * 0.25) * MAX_WIND * 0.8,
        suddenDeath: false,
        waterLevel: WATER_LEVEL_START,
        selectedWeapon: "bazooka",
        weaponTimer: 3,
        chargePower: 0.5 + 0.5 * Math.sin(this.t * 1.5),
        shotsLeft: 1,
        girderAngle: 0,
      },
    };
    return { snapshot, events };
  }
}

/** Fałszywy stan pokoju do podglądu lobby (`?demoLobby=1`). */
export function demoRoom(): { room: RoomState; playerId: string } {
  const players: PlayerInfo[] = [
    { id: "p1", name: "Michał", team: 0, ready: true, isHost: true, connected: true },
    { id: "p2", name: "Kasia", team: 1, ready: false, isHost: false, connected: true },
    { id: "p3", name: "Bartek", team: 2, ready: true, isHost: false, connected: true },
    { id: "p4", name: "Ola", team: 3, ready: false, isHost: false, connected: false },
  ];
  return {
    playerId: "p1",
    room: {
      code: "ZXQP",
      players,
      config: {
        wormsPerTeam: 4,
        turnTime: 45,
        suddenDeathAfterRounds: 10,
        seed: 987654,
        terrainDensity: 1,
        theme: "grass",
      },
      phase: "lobby",
    },
  };
}

export { TEAM_NAMES };
