import { FIXED_DT, TEAM_NAMES } from "@shared/constants";
import { createGame, type Game } from "@shared/engine";
import type { GameConfig, InputAction, InputState, PlayerInfo, RoomState } from "@shared/protocol";

/** Lokalny mecz dwóch drużyn: jedna klawiatura steruje drużyną z aktywną turą. */
export class DemoDriver {
  private readonly game: Game;

  constructor(config: GameConfig) {
    this.game = createGame(config, [
      { team: 0, playerId: "demo-0", name: "Gracz 1" },
      { team: 1, playerId: "demo-1", name: "Gracz 2" },
    ]);
  }

  get snapshot() { return this.game.snapshot(); }
  get isOver() { return this.game.isOver(); }
  get winner() { return this.game.winner(); }

  terrainSync() { return this.game.terrainSync(); }

  applyInput(state: InputState): void {
    this.game.applyInput(this.snapshot.turn.activeTeam, state);
  }

  applyAction(action: InputAction): void {
    this.game.applyAction(this.snapshot.turn.activeTeam, action);
  }

  update() {
    this.game.step(FIXED_DT);
    return { snapshot: this.snapshot, events: this.game.drainEvents() };
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
