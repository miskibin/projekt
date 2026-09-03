// KONTRAKT wiadomości WebSocket. Wszystko jako JSON. `t` = typ wiadomości.
// Serwer i klient importują tylko ten plik, żeby wiedzieć jak ze sobą rozmawiać.

export type WeaponId =
  | "bazooka"
  | "grenade"
  | "cluster"
  | "shotgun"
  | "uzi"
  | "holy"
  | "dynamite"
  | "mine"
  | "airstrike"
  | "homing"
  | "banana"
  | "bat"
  | "teleport"
  | "girder"
  | "jetpack"
  | "skip";

export interface GameConfig {
  wormsPerTeam: number;
  turnTime: number;
  suddenDeathAfterRounds: number;
  seed: number;
  /** 1 = normalny teren, 0..1 = mniej/więcej ziemi */
  terrainDensity: number;
  theme: "grass" | "desert" | "snow" | "hell";
}

export interface PlayerInfo {
  id: string; // stabilne id nadawane przez serwer
  name: string;
  team: number; // indeks 0..3 -> TEAM_COLORS
  ready: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface RoomState {
  code: string;
  players: PlayerInfo[];
  config: GameConfig;
  phase: "lobby" | "playing" | "finished";
}

// ---------- klient -> serwer ----------
export interface InputState {
  left: boolean;
  right: boolean;
  /** Nachylenie względem kierunku robaka: -PI/2..PI/2, ujemny = w górę. */
  aim: number;
  /** trzymanie przycisku ładowania mocy */
  charge: boolean;
}

export type InputAction =
  | { kind: "jump" }
  | { kind: "backflip" }
  | { kind: "fire"; power: number } // power 0..1 (dla broni bez ładowania ignorowane)
  | { kind: "selectWeapon"; weapon: WeaponId }
  | { kind: "setTimer"; seconds: 1 | 2 | 3 | 4 | 5 } // granaty itp.
  | { kind: "target"; x: number; y: number } // airstrike / teleport / girder / homing
  | { kind: "girderRotate" }
  | { kind: "skipTurn" }
  | { kind: "surrender" };

export type ClientMessage =
  | { t: "hello"; name: string }
  | { t: "createRoom"; config?: Partial<GameConfig> }
  | { t: "joinRoom"; code: string }
  | { t: "leaveRoom" }
  | { t: "setReady"; ready: boolean }
  | { t: "setConfig"; config: Partial<GameConfig> } // tylko host
  | { t: "startGame" } // tylko host
  | { t: "input"; state: InputState }
  | { t: "action"; action: InputAction }
  | { t: "ping"; ts: number }
  | { t: "requestTerrainSync" };

// ---------- serwer -> klient ----------
export interface WormSnapshot {
  id: number;
  team: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  facing: 1 | -1;
  aim: number;
  onGround: boolean;
  /** np. "jetpack" gdy używa plecaka, "bat" gdy macha kijem */
  anim?: string;
}

export interface ProjectileSnapshot {
  id: number;
  kind: WeaponId | "clusterlet" | "bananalet" | "airstrikeBomb" | "bullet";
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** pozostały czas do wybuchu (s), jeśli dotyczy */
  fuse?: number;
  angle?: number;
}

export interface CrateSnapshot {
  id: number;
  kind: "health" | "weapon" | "utility";
  x: number;
  y: number;
  vy: number;
  landed: boolean;
}

export interface MineSnapshot {
  id: number;
  x: number;
  y: number;
  armed: boolean;
  fuse?: number;
}

export interface TeamSnapshot {
  team: number;
  playerId: string;
  name: string;
  totalHp: number;
  alive: number;
  /** stan amunicji: -1 = nieskończona */
  ammo: Partial<Record<WeaponId, number>>;
}

export type TurnPhase =
  | "starting" // krótka pauza, opadanie skrzynek
  | "active" // gracz steruje
  | "retreat" // po strzale
  | "settling" // czekamy aż fizyka się uspokoi
  | "suddenDeathRise"
  | "gameOver";

export interface TurnInfo {
  phase: TurnPhase;
  activeTeam: number;
  activeWormId: number;
  timeLeft: number; // s
  round: number;
  wind: number; // -MAX_WIND..MAX_WIND
  suddenDeath: boolean;
  waterLevel: number;
  selectedWeapon: WeaponId;
  weaponTimer: number;
  chargePower: number; // 0..1 gdy ładuje
  /** true jeśli aktywny robak już oddał strzał w tej turze (dla broni wielostrzałowych: pozostałe) */
  shotsLeft: number;
  girderAngle?: number;
}

export interface GameSnapshot {
  tick: number;
  time: number;
  worms: WormSnapshot[];
  projectiles: ProjectileSnapshot[];
  crates: CrateSnapshot[];
  mines: MineSnapshot[];
  teams: TeamSnapshot[];
  turn: TurnInfo;
}

export type GameEvent =
  | { t: "explosion"; x: number; y: number; r: number; power: number } // niszczy teren okręgiem o promieniu r (int)
  | { t: "carveRect"; x: number; y: number; w: number; h: number; angle: number; add: boolean } // girder (add=true) lub wycięcie
  | { t: "damage"; wormId: number; amount: number; x: number; y: number }
  | { t: "wormDied"; wormId: number; reason: "explosion" | "drown" | "fall" | "surrender" }
  | { t: "shot"; weapon: WeaponId; x: number; y: number }
  | { t: "crateSpawn"; crate: CrateSnapshot }
  | { t: "cratePickup"; wormId: number; kind: CrateSnapshot["kind"]; weapon?: WeaponId; amount?: number }
  | { t: "turnStart"; team: number; wormId: number; wind: number }
  | { t: "suddenDeath" }
  | { t: "message"; text: string } // komunikaty na ekranie ("Sudden death!", "Robak X utonął")
  | { t: "sound"; name: string; x?: number; y?: number };

export interface TerrainSync {
  width: number;
  height: number;
  /** RLE: naprzemienne długości ciągów [pusto, ziemia, pusto, ziemia, ...] po wierszach */
  rle: number[];
}

export type ServerMessage =
  | { t: "welcome"; playerId: string }
  | { t: "error"; message: string }
  | { t: "roomState"; room: RoomState }
  | { t: "leftRoom" }
  | { t: "pong"; ts: number }
  | { t: "gameStart"; config: GameConfig; players: PlayerInfo[]; yourTeam: number }
  | { t: "snapshot"; snapshot: GameSnapshot }
  | { t: "events"; events: GameEvent[] }
  | { t: "terrainSync"; terrain: TerrainSync }
  | { t: "gameOver"; winnerTeam: number | null; winnerName: string | null; stats: Record<string, unknown> };
