// PUBLICZNE API SILNIKA. Serwer używa wyłącznie tego, klient używa Terrain/generateTerrain + typów.
import type { GameConfig, GameEvent, GameSnapshot, InputAction, InputState, TerrainSync } from "../protocol";
import { Terrain } from "./terrain";

export { Terrain, generateTerrain } from "./terrain";
export { Rng } from "./rng";

export interface TeamSetup {
  team: number; // 0..3
  playerId: string;
  name: string;
}

export interface Game {
  readonly config: GameConfig;
  readonly terrain: Terrain;
  /** Jeden krok symulacji o stałym dt (FIXED_DT). */
  step(dt: number): void;
  /** Ciągły stan wejścia gracza sterującego drużyną `team` (ignorowany, jeśli nie jego tura). */
  applyInput(team: number, state: InputState): void;
  /** Akcja jednorazowa (skok, strzał, wybór broni...). */
  applyAction(team: number, action: InputAction): void;
  snapshot(): GameSnapshot;
  /** Zwraca i czyści zdarzenia od ostatniego wywołania. */
  drainEvents(): GameEvent[];
  isOver(): boolean;
  winner(): { team: number | null; name: string | null };
  /** Gracz się rozłączył lub poddał – jego robaki giną, tura przechodzi dalej. */
  removeTeam(team: number): void;
  terrainSync(): TerrainSync;
}

export function createGame(config: GameConfig, teams: TeamSetup[]): Game {
  // Implementacja w ./game.ts (patrz ARCHITECTURE.md)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  throw new Error("createGame not implemented yet – see shared/engine/game.ts");
}
