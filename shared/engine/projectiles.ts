// Fizyka i detonacja pocisków.
import { GRAVITY, WORM_RADIUS, WORLD_WIDTH } from "../constants";
import { circleHits, clamp, pushOut, reflect, terrainNormal, wrapAngle } from "./physics";
import { BANANALET, CLUSTERLET } from "./weapons";
import type { EngineCtx, Projectile, ProjectileKind } from "./types";
import type { ExplosionStyle } from "../protocol";

const HOMING_TURN_RATE = 3.2; // rad/s
const HOMING_ACCEL = 260;
const HOMING_MAX_SPEED = 560;

export function makeProjectile(ctx: EngineCtx, init: Partial<Projectile> & { kind: ProjectileKind }): Projectile {
  const p: Projectile = {
    id: ctx.nextId(),
    kind: init.kind,
    x: init.x ?? 0,
    y: init.y ?? 0,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    fuse: init.fuse,
    angle: Math.atan2(init.vy ?? 0, init.vx ?? 0),
    age: 0,
    dead: false,
    radius: init.radius ?? 28,
    damage: init.damage ?? 45,
    power: init.power ?? 300,
    hitRadius: init.hitRadius ?? 2,
    gravityScale: init.gravityScale ?? 1,
    windAffected: init.windAffected ?? false,
    explodeOnContact: init.explodeOnContact ?? true,
    collidesWorms: init.collidesWorms ?? true,
    bounces: init.bounces ?? false,
    restitution: init.restitution ?? 0.45,
    ownerWorm: init.ownerWorm ?? -1,
    ownerTeam: init.ownerTeam ?? -1,
    shards: init.shards ?? 0,
    shardKind: init.shardKind,
    homingTarget: init.homingTarget,
    homingDelay: init.homingDelay ?? 0.5,
    restTimer: 0,
    restFuse: init.restFuse ?? 0,
    sangHallelujah: false,
  };
  ctx.projectiles.push(p);
  return p;
}

/** Wybuch pocisku + ewentualne odłamki. */
export function detonateProjectile(ctx: EngineCtx, p: Projectile): void {
  if (p.dead) return;
  p.dead = true;
  ctx.explode(p.x, p.y, p.radius, p.damage, p.power, projectileExplosionStyle(p.kind));
  if (p.shards > 0 && p.shardKind) {
    const spec = p.shardKind === "bananalet" ? BANANALET : CLUSTERLET;
    for (let i = 0; i < p.shards; i++) {
      const ang = ctx.rng.range(-Math.PI * 0.85, -Math.PI * 0.15);
      const speed =
        p.shardKind === "bananalet" ? ctx.rng.range(280, 430) : ctx.rng.range(150, 260);
      makeProjectile(ctx, {
        kind: p.shardKind,
        x: p.x + Math.cos(ang) * 4,
        y: p.y + Math.sin(ang) * 4,
        vx: Math.cos(ang) * speed + p.vx * 0.15,
        vy: Math.sin(ang) * speed,
        radius: spec.radius,
        damage: spec.damage,
        power: spec.power,
        explodeOnContact: true,
        bounces: false,
        ownerWorm: p.ownerWorm,
        ownerTeam: p.ownerTeam,
      });
    }
  }
}

function projectileExplosionStyle(kind: ProjectileKind): ExplosionStyle | undefined {
  if (kind === "clusterlet") return "cluster";
  if (kind === "bananalet") return "banana";
  if (kind === "airstrikeBomb") return "airstrike";
  if (
    kind === "bazooka" || kind === "homing" || kind === "grenade" || kind === "cluster" ||
    kind === "banana" || kind === "holy" || kind === "dynamite"
  ) return kind;
  return undefined;
}

function hitWorm(ctx: EngineCtx, p: Projectile, x: number, y: number): boolean {
  if (!p.collidesWorms) return false;
  for (const w of ctx.worms) {
    if (!w.alive) continue;
    if (w.id === p.ownerWorm && p.age < 0.16) continue;
    const dx = w.x - x;
    const dy = w.y - y;
    if (dx * dx + dy * dy <= (WORM_RADIUS + p.hitRadius) * (WORM_RADIUS + p.hitRadius)) return true;
  }
  return false;
}

export function stepProjectiles(ctx: EngineCtx, dt: number): void {
  for (const p of ctx.projectiles) {
    if (p.dead) continue;
    p.age += dt;

    if (p.fuse !== undefined) {
      p.fuse -= dt;
      if (p.fuse <= 0) {
        p.fuse = 0;
        detonateProjectile(ctx, p);
        continue;
      }
    }

    const speed = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.min(16, Math.ceil((speed * dt) / 2)));
    const sdt = dt / steps;
    let homing = false;

    for (let s = 0; s < steps; s++) {
      if (p.dead) break;

      if (p.homingTarget && p.age >= p.homingDelay) {
        homing = true;
        const desired = Math.atan2(p.homingTarget.y - p.y, p.homingTarget.x - p.x);
        let cur = Math.atan2(p.vy, p.vx);
        const diff = wrapAngle(desired - cur);
        cur += clamp(diff, -HOMING_TURN_RATE * sdt, HOMING_TURN_RATE * sdt);
        const sp = Math.min(HOMING_MAX_SPEED, Math.hypot(p.vx, p.vy) + HOMING_ACCEL * sdt);
        p.vx = Math.cos(cur) * sp;
        p.vy = Math.sin(cur) * sp;
      }

      p.vy += GRAVITY * p.gravityScale * (homing ? 0.12 : 1) * sdt;
      if (p.windAffected) p.vx += ctx.wind * sdt;

      const nx = p.x + p.vx * sdt;
      const ny = p.y + p.vy * sdt;

      if (ny > ctx.waterLevel) {
        p.dead = true;
        ctx.emit({ t: "sound", name: "splash", x: nx, y: ctx.waterLevel });
        break;
      }
      if (nx < -200 || nx > WORLD_WIDTH + 200 || ny < -3000) {
        p.dead = true;
        break;
      }

      const terrainHit = circleHits(ctx.terrain, nx, ny, p.hitRadius);
      const wormHit = !terrainHit && hitWorm(ctx, p, nx, ny);

      if (terrainHit || wormHit) {
        if (p.explodeOnContact) {
          p.x = nx;
          p.y = ny;
          detonateProjectile(ctx, p);
          break;
        }
        if (p.bounces && terrainHit) {
          const n = terrainNormal(ctx.terrain, nx, ny, Math.max(p.hitRadius, 2));
          const r = reflect(p.vx, p.vy, n.x, n.y, p.restitution, 0.72);
          p.vx = r.vx;
          p.vy = r.vy;
          const pos = { x: p.x, y: p.y };
          pushOut(ctx.terrain, pos, p.hitRadius, 8);
          p.x = pos.x;
          p.y = pos.y;
          if (Math.hypot(p.vx, p.vy) > 90) ctx.emit({ t: "sound", name: "hit", x: p.x, y: p.y });
          break;
        }
        // nie wybucha i nie odbija się (np. pocisk przelatujący przez robaka)
        p.x = nx;
        p.y = ny;
      } else {
        p.x = nx;
        p.y = ny;
      }
    }

    if (p.dead) continue;
    p.angle = Math.atan2(p.vy, p.vx);

    // Holy Hand Grenade: po zatrzymaniu odlicza restFuse sekund.
    if (p.restFuse > 0) {
      if (Math.hypot(p.vx, p.vy) < 30) {
        if (!p.sangHallelujah) {
          p.sangHallelujah = true;
          ctx.emit({ t: "sound", name: "hallelujah", x: p.x, y: p.y });
        }
        p.restTimer += dt;
        if (p.restTimer >= p.restFuse) {
          detonateProjectile(ctx, p);
          continue;
        }
      } else {
        p.restTimer = 0;
      }
    }
  }

  for (let i = ctx.projectiles.length - 1; i >= 0; i--) {
    if (ctx.projectiles[i].dead) ctx.projectiles.splice(i, 1);
  }
}
