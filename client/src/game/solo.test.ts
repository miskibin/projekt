import { describe, expect, it } from "vitest";
import type { GameConfig, WormSnapshot } from "@shared/protocol";
import { soloArena, soloStageInfo, readSoloRun, saveSoloRun, soloBest, soloRewards, type SoloRun } from "./solo";
import { chooseComputerWeapon, DemoDriver, selectComputerTarget } from "./demo";

const base: GameConfig = { wormsPerTeam: 2, turnTime: 45, suddenDeathAfterRounds: 10,
  seed: 26, terrainDensity: 1, theme: "grass" };

describe("wyprawa solo", () => {
  it("losuje kolejne areny i podnosi wyzwanie", () => {
    const first = soloArena(base, 91, 1);
    const next = soloArena(base, 91, 2);
    const far = soloArena(base, 91, 10);
    expect(first).toEqual(soloArena(base, 91, 1));
    expect(first.seed).not.toBe(next.seed);
    expect(first.mode).toBe("arsenal");
    expect(far.wormsPerTeam).toBeGreaterThan(first.wormsPerTeam);
    expect(far.turnTime).toBeLessThan(first.turnTime);
    expect(new DemoDriver(first, "gauntlet", 1).snapshot.teams[1]?.name).toBe("Zwiadowca");
    expect(new DemoDriver(next, "gauntlet", 2).snapshot.teams[1]?.name).toBe("Piroman");
    expect(soloStageInfo(7).name).toBe("Boss");
    expect(soloStageInfo(8).cycle).toBe(2);
    expect(far.wormsPerTeam).toBeLessThanOrEqual(4);
    expect(soloArena(base, 91, 50).turnTime).toBeGreaterThanOrEqual(38);
  });

  it("wybór trasy zmienia arsenał obu drużyn i nie zmienia losowania terenu", () => {
    const supplies = soloArena(base, 91, 2, "supplies");
    const armory = soloArena(base, 91, 2, "armory");
    expect(supplies.seed).toBe(armory.seed);
    expect(supplies.mode).toBe("arsenal");
    expect(armory.mode).toBe("classic");
    const draft = new DemoDriver(supplies, "gauntlet", 2).snapshot.teams;
    const full = new DemoDriver(armory, "gauntlet", 2).snapshot.teams;
    expect(draft[0]!.ammo).toEqual(draft[1]!.ammo);
    expect(full[0]!.ammo).toEqual(full[1]!.ammo);
    expect(full[0]!.ammo.holy).toBe(1);
    expect(Object.values(draft[0]!.ammo).filter((amount) => amount > 0).length).toBeLessThan(
      Object.values(full[0]!.ammo).filter((amount) => amount > 0).length,
    );
  });

  it("różni przeciwnicy wybierają inny cel oraz typ ataku, gdy pozwala na to amunicja", () => {
    const worm = (id: number, team: number, x: number, y: number, hp = 100): WormSnapshot => ({
      id, team, x, y, hp, name: `Robak ${id}`, vx: 0, vy: 0, alive: true, facing: 1,
      aim: -0.8, onGround: true,
    });
    const self = worm(1, 1, 50, 350);
    const enemies = [worm(2, 0, 180, 350), worm(3, 0, 350, 350, 15), worm(4, 0, 365, 350)];
    expect(selectComputerTarget(self, enemies, [self], 1).id).toBe(2);
    expect(selectComputerTarget(self, enemies, [self], 4).id).toBe(3);
    expect(selectComputerTarget(self, enemies, [self], 6).id).toBe(3);
    const ammo = { bazooka: -1, grenade: -1, shotgun: -1, banana: 1, cluster: 2,
      mine: 2, airstrike: 1, homing: 1, uzi: 3, bat: 2 };
    expect(chooseComputerWeapon(2, 3, 280, 20, ammo)).toBe("banana");
    expect(chooseComputerWeapon(3, 1, 450, 110, ammo)).toBe("homing");
    expect(chooseComputerWeapon(4, 1, 250, 20, ammo, 1)).toBe("cluster");
    expect(chooseComputerWeapon(5, 2, 400, 20, ammo, 1)).toBe("airstrike");
    expect(chooseComputerWeapon(5, 2, 400, 20, ammo, 1, true)).toBe("bazooka");
    expect(chooseComputerWeapon(4, 1, 250, 20, { ...ammo, cluster: 0 }, 1)).toBe("grenade");
  });

  it("Piroman faktycznie atakuje granatem w turze komputera", () => {
    const match = new DemoDriver(soloArena(base, 194, 2, "armory"), "gauntlet", 2);
    for (let frame = 0; frame < 240 && match.snapshot.turn.phase !== "active"; frame++) match.update();
    match.applyAction({ kind: "skipTurn" });
    const fired: string[] = [];
    for (let frame = 0; frame < 720 && !fired.length; frame++) {
      for (const event of match.update().events) if (event.t === "shot") fired.push(event.weapon);
    }
    expect(fired).toContain("grenade");
  });
});

describe("expedition checkpoints and loadouts",()=>{
  const run:SoloRun={stage:5,seed:91,base,route:"armory",perks:{vitality:2,railgun:1},awaitingReward:true};
  const memory=()=>{
    const data=new Map<string,string>();
    return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  };
  it("restores the same arena, upgrades and pending reward after a fresh session",()=>{
    const storage=memory();
    expect(saveSoloRun(run,storage)).toBe(true);
    const restored=readSoloRun(base,storage)!;
    expect(restored).toEqual(run);
    expect(soloArena(base,restored.seed,restored.stage,restored.route)).toEqual(soloArena(base,run.seed,run.stage,run.route));
    expect(soloRewards(restored)).toEqual(soloRewards(run));
    saveSoloRun(null,storage);expect(readSoloRun(base,storage)).toBeNull();
  });
  it("persists the best arena independently from an ended run",()=>{
    const storage=memory();
    expect(soloBest(7,storage)).toBe(7);expect(soloBest(3,storage)).toBe(7);
    saveSoloRun(run,storage);saveSoloRun(null,storage);expect(soloBest(0,storage)).toBe(7);
  });
  it("rejects corrupt saves and survives unavailable browser storage",()=>{
    const storage=memory();
    storage.setItem("wormsy.expedition.v1","broken");expect(readSoloRun(base,storage)).toBeNull();
    for(const stage of [-1,0,1e20,"5"]) {
      storage.setItem("wormsy.expedition.v1",JSON.stringify({...run,stage}));expect(readSoloRun(base,storage)).toBeNull();
    }
    const denied={getItem:()=>{throw new Error("denied");},setItem:()=>{throw new Error("quota");},removeItem:()=>{throw new Error("denied");}};
    expect(readSoloRun(base,denied)).toBeNull();expect(saveSoloRun(run,denied)).toBe(false);
  });
  it("grants upgrades only to the human team and caps each perk at three",()=>{
    const arena=soloArena(base,run.seed,run.stage,"armory");
    const game=new DemoDriver(arena,"gauntlet",run.stage,run.perks);
    expect(game.snapshot.worms.filter(w=>w.team===0).every(w=>w.hp===116 && w.maxHp===116)).toBe(true);
    expect(game.snapshot.worms.filter(w=>w.team===1).every(w=>w.hp===100)).toBe(true);
    expect(game.snapshot.teams[0]!.ammo.railgun).toBe(3);
    expect(game.snapshot.teams[1]!.ammo.railgun).toBe(2);
    expect(soloRewards({...run,perks:{vitality:3}})).not.toContain("vitality");
    expect(new Set(soloRewards(run)).size).toBe(3);
  });
});
