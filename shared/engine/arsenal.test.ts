import { describe, expect, it } from "vitest";
import { FIXED_DT, WORLD_HEIGHT, WORLD_WIDTH, WORM_RADIUS } from "../constants";
import type { GameConfig, GameEvent } from "../protocol";
import { GameImpl } from "./game";
import { makeProjectile, stepProjectiles } from "./projectiles";
import { stepCrates } from "./crates";
import { circleHits, groundBelow } from "./physics";
import { generateTerrain, TERRAIN_STYLES } from "./terrain";
import { validateConfigPatch } from "../host/rooms";

const config: GameConfig = { seed: 92, wormsPerTeam: 1, turnTime: 45,
  suddenDeathAfterRounds: 10, terrainDensity: 1, theme: "grass", mode: "classic" };
const teams = [{team:0,playerId:"a",name:"A"},{team:1,playerId:"b",name:"B"}];
function flatGame(): GameImpl {
  const game = new GameImpl(config, teams);
  game.terrain.data.fill(0);
  for (let y=450;y<WORLD_HEIGHT;y++) game.terrain.data.fill(1,y*WORLD_WIDTH,(y+1)*WORLD_WIDTH);
  game.mines.length=game.barrels.length=game.trees.length=game.crates.length=0;
  for (const [index,worm] of game.worms.entries()) Object.assign(worm,
    {x:200+index*400,y:450-WORM_RADIUS-1,vx:0,vy:0,onGround:true,facing:1});
  for(let i=0;i<120 && game.snapshot().turn.phase!=="active";i++) game.step(FIXED_DT);
  game.drainEvents();
  return game;
}

describe("new tactical weapons",()=>{
  it("sticky charge stays at its first wall contact and waits for its fuse",()=>{
    const game=flatGame();
    const charge=makeProjectile(game,{kind:"sticky",x:800,y:410,vx:70,vy:120,
      fuse:2,explodeOnContact:false,collidesWorms:false,radius:49,damage:62,power:390});
    for(let i=0;i<90 && !charge.stuck;i++) stepProjectiles(game,FIXED_DT);
    expect(charge.stuck).toBe(true);
    expect(game.drainEvents().some(e=>e.t==="explosion")).toBe(false);
    const {x,y}=charge;
    for(let i=0;i<35;i++) stepProjectiles(game,FIXED_DT);
    expect(charge.x).toBe(x); expect(charge.y).toBe(y); expect(charge.dead).toBe(false);
    for(let i=0;i<150 && !charge.dead;i++) stepProjectiles(game,FIXED_DT);
    expect(game.drainEvents().filter(e=>e.t==="explosion" && e.style==="sticky")).toHaveLength(1);
  });
  it("mortar splits at the apex into five independently damaging shells",()=>{
    const game=flatGame();
    const mortar=makeProjectile(game,{kind:"mortar",x:800,y:230,vx:100,vy:-250,
      fuse:4,radius:23,damage:23,power:215});
    for(let i=0;i<80 && !mortar.dead;i++) stepProjectiles(game,FIXED_DT);
    const shells=game.projectiles.filter(p=>p.kind==="mortarShell");
    expect(shells).toHaveLength(5);
    expect(new Set(shells.map(p=>p.vx)).size).toBe(5);
    const blasts:GameEvent[]=[];
    for(let i=0;i<180;i++) {stepProjectiles(game,FIXED_DT);blasts.push(...game.drainEvents());}
    expect(blasts.filter(e=>e.t==="explosion" && e.style==="mortar")).toHaveLength(5);
  });
  it("railgun pierces two worms but the soil blocks the third",()=>{
    const game=flatGame();
    const shooter=game.worms[0]!;
    const first=game.worms[1]!;
    Object.assign(first,{x:320,y:shooter.y-3});
    const second={...first,id:game.nextId(),x:420};
    const behind={...first,id:game.nextId(),x:650};
    game.worms.push(second,behind);
    game.terrain.paintRotatedRect(500,400,20,150,0,1);
    const before=game.terrain.data.slice();
    game.applyInput(0,{left:false,right:false,aim:0,charge:false});
    game.applyAction(0,{kind:"selectWeapon",weapon:"railgun"});
    game.applyAction(0,{kind:"fire",power:1});
    expect(first.hp).toBe(58);expect(second.hp).toBe(58);expect(behind.hp).toBe(100);
    expect(Buffer.from(before).equals(Buffer.from(game.terrain.data))).toBe(true);
    expect(game.snapshot().teams[0]!.ammo.railgun).toBe(1);
  });
  it("repulsor changes momentum without directly damaging worms or terrain",()=>{
    const game=flatGame();
    const victim=game.worms[1]!;
    const before=game.terrain.data.slice();
    makeProjectile(game,{kind:"repulsor",x:victim.x-30,y:victim.y,vx:0,vy:0,
      gravityScale:0,fuse:0.01,radius:88,damage:0,power:680});
    stepProjectiles(game,FIXED_DT);
    expect(victim.hp).toBe(100);expect(victim.vx).toBeGreaterThan(300);expect(victim.vy).toBeLessThan(-100);
    expect(Buffer.from(before).equals(Buffer.from(game.terrain.data))).toBe(true);
    expect(game.drainEvents().some(e=>e.t==="pulse")).toBe(true);
  });
  it.each(["sticky","mortar","repulsor"] as const)("%s can be fired through the normal turn controls",weapon=>{
    const game=flatGame();
    game.applyInput(0,{left:false,right:false,aim:-0.8,charge:false});
    game.applyAction(0,{kind:"selectWeapon",weapon});
    game.applyAction(0,{kind:"fire",power:0.7});
    expect(game.snapshot().projectiles.some(p=>p.kind===weapon)).toBe(true);
    expect(game.snapshot().teams[0]!.ammo[weapon]).toBe(1);
    expect(game.snapshot().turn.phase).toBe("retreat");
  });
});

describe("arena archetypes",()=>{
  it.each(TERRAIN_STYLES)("%s leaves continuous land above the water at every density", terrainStyle => {
    for (const seed of [1,7,92,20240917]) for (const density of [0.3,1,1.5]) {
      const terrain = generateTerrain(seed,WORLD_WIDTH,WORLD_HEIGHT,density,terrainStyle);
      const row = terrain.data.subarray((WORLD_HEIGHT-40)*WORLD_WIDTH,(WORLD_HEIGHT-39)*WORLD_WIDTH);
      expect(row.every(pixel=>pixel===1)).toBe(true);
    }
  });
  it("turns toward a stationary mouse aim before an immediate shot", () => {
    const game = flatGame();
    const shooter = game.worms[0]!, victim = game.worms[1]!;
    Object.assign(shooter,{x:700,facing:1});Object.assign(victim,{x:500,y:shooter.y-3});
    game.applyInput(0,{left:false,right:false,aim:0,charge:false,facing:-1});
    game.applyAction(0,{kind:"selectWeapon",weapon:"railgun"});
    game.applyAction(0,{kind:"fire",power:1});
    expect(shooter.x).toBe(700);expect(shooter.facing).toBe(-1);expect(victim.hp).toBe(58);
  });
  it.each(TERRAIN_STYLES)("%s generates safely and identically on both peers",terrainStyle=>{
    for(const seed of [1,7,26,92,20240917]) {
      const game=new GameImpl({...config,seed,terrainStyle,wormsPerTeam:4},teams);
      const replica=generateTerrain(seed,WORLD_WIDTH,WORLD_HEIGHT,1,terrainStyle);
      expect(Buffer.from(replica.data).equals(Buffer.from(game.terrain.data))).toBe(true);
      for(const worm of game.worms) {
        expect(worm.y).toBeLessThan(game.waterLevel-WORM_RADIUS);
        expect(circleHits(game.terrain,worm.x,worm.y,WORM_RADIUS)).toBe(false);
        expect(groundBelow(game.terrain,worm.x,worm.y,WORM_RADIUS,3)).toBe(true);
      }
    }
  });
  it("accepts known layouts and rejects malformed multiplayer settings",()=>{
    expect(validateConfigPatch({terrainStyle:"islands"})).toEqual({ok:true,patch:{terrainStyle:"islands"}});
    for(const terrainStyle of ["missing",{},null,7]) expect(validateConfigPatch({terrainStyle}).ok).toBe(false);
    expect(validateConfigPatch({loadout:{hpBonus:500}})).toEqual({ok:true,patch:{}});
  });
  it("healing respects the increased expedition maximum",()=>{
    const game=flatGame();
    const worm=game.worms[0]!;worm.maxHp=124;worm.hp=111;
    game.crates.push({id:game.nextId(),kind:"health",x:worm.x,y:worm.y,vy:0,landed:true,amount:25});
    stepCrates(game,FIXED_DT);
    expect(worm.hp).toBe(124);
  });
});
