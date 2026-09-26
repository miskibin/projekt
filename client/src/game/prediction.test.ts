import { describe, expect, it } from "vitest";
import type { GameSnapshot, InputState } from "@shared/protocol";
import { Terrain } from "@shared/engine/terrain";
import type { RenderState } from "./state";
import { LocalPrediction } from "./prediction";

const input: InputState = { left: false, right: true, aim: -0.4, charge: false };

function setup() {
  const terrain = new Terrain(300, 160);
  for (let y = 100; y < 160; y++) for (let x = 0; x < 300; x++) terrain.set(x, y, 1);
  const worms: GameSnapshot["worms"] = [
    { id: 1, team: 0, name: "Ja", x: 80, y: 91, vx: 0, vy: 0, hp: 100, alive: true, facing: -1, aim: 0, onGround: true },
    { id: 2, team: 1, name: "Rywal", x: 210, y: 91, vx: 0, vy: 0, hp: 100, alive: true, facing: -1, aim: 0, onGround: true },
  ];
  const turn: GameSnapshot["turn"] = {
    phase: "active", activeTeam: 0, activeWormId: 1, timeLeft: 30, round: 1, wind: 0,
    suddenDeath: false, waterLevel: 145, selectedWeapon: "bazooka", weaponTimer: 3, chargePower: 0, shotsLeft: 1,
  };
  const snapshot: GameSnapshot = { tick: 1, time: 0, worms, turn, teams: [], projectiles: [], crates: [], mines: [] };
  const state: RenderState = { ...snapshot };
  return { terrain, snapshot, state };
}

describe("lokalna predykcja", () => {
  it("pozwala od razu chodzić i celować, bez ruszania rywala lub wyniku", () => {
    const { terrain, snapshot, state } = setup();
    const predictor = new LocalPrediction();
    predictor.onSnapshot(snapshot, 1000);
    let predicted = state;
    for (let i = 1; i <= 12; i++) predicted = predictor.apply(state, terrain, input, 0, 1 / 60, 1000 + i * 16);
    expect(predicted.worms[0].x).toBeGreaterThan(85);
    expect(predicted.worms[0].facing).toBe(1);
    expect(predicted.worms[0].aim).toBe(input.aim);
    expect(predicted.worms[0].hp).toBe(100);
    expect(predicted.worms[1]).toBe(state.worms[1]);
    expect(predicted.turn).toBe(state.turn);
    expect(state.worms[0].x).toBe(80);
  });

  it("zatrzymuje przewidywanie po zaniku danych i gładko uzgadnia nowy snapshot", () => {
    const { terrain, snapshot, state } = setup();
    const predictor = new LocalPrediction();
    predictor.onSnapshot(snapshot, 1000);
    let predicted = state;
    for (let i = 1; i <= 42; i++) predicted = predictor.apply(state, terrain, input, 0, 1 / 60, 1000 + i * 16);
    const x = predicted.worms[0].x;
    predicted = predictor.apply(state, terrain, input, 0, 1 / 60, 1900);
    expect(predicted.worms[0].x).toBeCloseTo(x, 3);
    predictor.onSnapshot({ ...snapshot, tick: 2, worms: [{ ...snapshot.worms[0], x: 82 }, snapshot.worms[1]] }, 1900);
    predicted = predictor.apply(state, terrain, input, 0, 1 / 60, 1916);
    expect(predicted.worms[0].x).toBeLessThan(x + 2);
    expect(predicted.worms[0].x).toBeGreaterThan(82);
  });

  it("nie przenika przez ścianę podczas przewidywania", () => {
    const { terrain, snapshot, state } = setup();
    for (let y = 65; y < 100; y++) terrain.set(115, y, 1);
    const predictor = new LocalPrediction();
    predictor.onSnapshot(snapshot, 1000);
    let predicted = state;
    for (let i = 1; i <= 40; i++) predicted = predictor.apply(state, terrain, input, 0, 1 / 60, 1000 + i * 16);
    expect(predicted.worms[0].x).toBeLessThan(110);
  });
});
