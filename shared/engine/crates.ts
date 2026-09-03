// Skrzynki (spadochron) i miny.
import { GRAVITY, WORLD_WIDTH, WORM_MAX_HP } from "../constants";
import { circleHits, pushOut } from "./physics";
import { CRATE_UTILITIES, CRATE_WEAPONS, WEAPONS } from "./weapons";
import type { Crate, EngineCtx, Mine } from "./types";
import type { CrateSnapshot, WeaponId } from "../protocol";

export const CRATE_RADIUS = 8;
export const CRATE_FALL_SPEED = 60;
export const CRATE_PICKUP_DIST = 18;

export const MINE_RADIUS = 4;
export const MINE_TRIGGER_DIST = 30;
export const MINE_ARM_TIME = 2;
export const MINE_FUSE = 1.5;

export function crateSnapshot(c: Crate): CrateSnapshot {
  return { id: c.id, kind: c.kind, x: c.x, y: c.y, vy: c.vy, landed: c.landed };
}

export function spawnCrate(ctx: EngineCtx, forcedKind?: Crate["kind"]): Crate {
  const roll = ctx.rng.next();
  const kind: Crate["kind"] = forcedKind ?? (roll < 0.4 ? "health" : roll < 0.8 ? "weapon" : "utility");
  const x = ctx.rng.int(40, WORLD_WIDTH - 40);
  const crate: Crate = {
    id: ctx.nextId(),
    kind,
    x,
    y: -20,
    vy: CRATE_FALL_SPEED,
    landed: false,
    amount: 25,
  };
  if (kind === "weapon") crate.weapon = ctx.rng.pick(CRATE_WEAPONS);
  else if (kind === "utility") crate.weapon = ctx.rng.pick(CRATE_UTILITIES);
  ctx.crates.push(crate);
  ctx.emit({ t: "crateSpawn", crate: crateSnapshot(crate) });
  return crate;
}

export function spawnInitialMines(ctx: EngineCtx): void {
  const count = ctx.rng.int(4, 8);
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 60 && !placed; attempt++) {
      const x = ctx.rng.int(30, WORLD_WIDTH - 30);
      const surface = ctx.terrain.surfaceY(x);
      const y = surface - MINE_RADIUS - 1;
      if (surface >= ctx.waterLevel - 4) continue;
      if (circleHits(ctx.terrain, x, y, MINE_RADIUS)) continue;
      // nie stawiaj min tuż obok startowych pozycji robaków
      let tooClose = false;
      for (const w of ctx.worms) {
        if (Math.hypot(w.x - x, w.y - y) < 90) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      ctx.mines.push({
        id: ctx.nextId(),
        x,
        y,
        vx: 0,
        vy: 0,
        armed: true,
        armTimer: 0,
        onGround: true,
        dead: false,
      });
      placed = true;
    }
  }
}

export function placeMine(ctx: EngineCtx, x: number, y: number): Mine {
  const m: Mine = {
    id: ctx.nextId(),
    x,
    y,
    vx: 0,
    vy: 0,
    armed: false,
    armTimer: MINE_ARM_TIME,
    onGround: false,
    dead: false,
  };
  ctx.mines.push(m);
  return m;
}

function fallStep(ctx: EngineCtx, obj: { x: number; y: number; vy: number }, r: number, dt: number): boolean {
  const steps = Math.max(1, Math.min(8, Math.ceil((Math.abs(obj.vy) * dt) / 2)));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    const ny = obj.y + obj.vy * sdt;
    if (circleHits(ctx.terrain, obj.x, ny, r)) {
      const pos = { x: obj.x, y: obj.y };
      pushOut(ctx.terrain, pos, r, 8);
      obj.x = pos.x;
      obj.y = pos.y;
      obj.vy = 0;
      return true;
    }
    obj.y = ny;
  }
  return false;
}

export function stepCrates(ctx: EngineCtx, dt: number): void {
  for (const c of ctx.crates) {
    if (!c.landed) {
      c.vy = CRATE_FALL_SPEED;
      if (fallStep(ctx, c, CRATE_RADIUS, dt)) c.landed = true;
      if (c.y > ctx.waterLevel) {
        ctx.emit({ t: "sound", name: "splash", x: c.x, y: ctx.waterLevel });
        c.amount = -1; // oznaczenie do usunięcia
      }
    }
    if (c.amount === -1) continue;
    for (const w of ctx.worms) {
      if (!w.alive) continue;
      const dx = w.x - c.x;
      const dy = w.y - c.y;
      if (dx * dx + dy * dy > CRATE_PICKUP_DIST * CRATE_PICKUP_DIST) continue;
      applyCrate(ctx, c, w.id, w.team);
      c.amount = -1;
      break;
    }
  }
  for (let i = ctx.crates.length - 1; i >= 0; i--) {
    if (ctx.crates[i].amount === -1) ctx.crates.splice(i, 1);
  }
}

function applyCrate(ctx: EngineCtx, c: Crate, wormId: number, team: number): void {
  const worm = ctx.worms.find((w) => w.id === wormId);
  if (c.kind === "health") {
    if (worm) worm.hp = Math.min(WORM_MAX_HP, worm.hp + 25);
    ctx.emit({ t: "cratePickup", wormId, kind: "health", amount: 25 });
    ctx.emit({ t: "message", text: `${worm ? worm.name : "Robak"} podniósł apteczkę (+25 hp)` });
  } else {
    const weapon = (c.weapon ?? "grenade") as WeaponId;
    const ts = ctx.teams.find((t) => t.team === team);
    if (ts && ts.ammo[weapon] >= 0) ts.ammo[weapon] += 1;
    ctx.emit({ t: "cratePickup", wormId, kind: c.kind, weapon, amount: 1 });
    ctx.emit({ t: "message", text: `${worm ? worm.name : "Robak"} zdobył: ${weapon}` });
  }
  ctx.emit({ t: "sound", name: "pickup", x: c.x, y: c.y });
}

export function stepMines(ctx: EngineCtx, dt: number): void {
  for (const m of ctx.mines) {
    if (m.dead) continue;
    if (!m.onGround) {
      m.vy += GRAVITY * dt;
      if (fallStep(ctx, m, MINE_RADIUS, dt)) m.onGround = true;
    }
    if (m.y > ctx.waterLevel) {
      m.dead = true;
      ctx.emit({ t: "sound", name: "splash", x: m.x, y: ctx.waterLevel });
      continue;
    }
    if (!m.armed) {
      m.armTimer -= dt;
      if (m.armTimer <= 0) {
        m.armed = true;
        m.armTimer = 0;
      }
      continue;
    }
    if (m.fuse === undefined) {
      for (const w of ctx.worms) {
        if (!w.alive) continue;
        const dx = w.x - m.x;
        const dy = w.y - m.y;
        if (dx * dx + dy * dy <= MINE_TRIGGER_DIST * MINE_TRIGGER_DIST) {
          m.fuse = MINE_FUSE;
          ctx.emit({ t: "sound", name: "tick", x: m.x, y: m.y });
          break;
        }
      }
    } else {
      m.fuse -= dt;
      if (m.fuse <= 0) {
        m.dead = true;
        ctx.explode(m.x, m.y, WEAPONS.mine.radius, WEAPONS.mine.damage, WEAPONS.mine.power);
      }
    }
  }
  for (let i = ctx.mines.length - 1; i >= 0; i--) {
    if (ctx.mines[i].dead) ctx.mines.splice(i, 1);
  }
}
