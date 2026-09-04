// Stałe rozgrywki współdzielone przez serwer i klienta.
export const WORLD_WIDTH = 1920;
export const WORLD_HEIGHT = 1080;
export const TICK_RATE = 60; // symulacja (Hz)
export const SNAPSHOT_RATE = 20; // broadcast do klientów (Hz)
export const FIXED_DT = 1 / TICK_RATE;

export const GRAVITY = 900; // px/s^2
export const WATER_LEVEL_START = WORLD_HEIGHT - 40; // y powierzchni wody (rośnie w sudden death)
export const WATER_RISE_PER_ROUND = 40;

export const WORM_RADIUS = 8;
export const WORM_MAX_HP = 100;
export const WORM_WALK_SPEED = 80; // px/s
export const WORM_JUMP_VX = 90;
export const WORM_JUMP_VY = -260;
export const WORM_BACKFLIP_VY = -360;
export const WORM_MAX_STEP_UP = 7; // ile pikseli robak może "wejść" pod górę na krok
export const FALL_DAMAGE_MIN_SPEED = 420; // px/s
export const FALL_DAMAGE_FACTOR = 0.08; // hp za każdy px/s ponad próg

export const TURN_TIME = 45; // s
export const RETREAT_TIME = 1.25; // krótki czas na odejście po strzale
export const ROUND_END_DELAY = 0.7; // pauza po uspokojeniu fizyki
export const SUDDEN_DEATH_AFTER_ROUNDS = 10; // po tylu pełnych rundach zaczyna rosnąć woda
export const CRATE_DROP_CHANCE = 0.35; // na początku tury

export const WORMS_PER_TEAM_DEFAULT = 3;
export const MAX_PLAYERS = 4;
export const MAX_WIND = 120; // px/s^2 poziomej siły dla pocisków wrażliwych na wiatr
export const MAX_SHOT_POWER = 700; // px/s
export const CHARGE_TIME = 2; // s do pełnej mocy — przytrzymaj, aby precyzyjnie dobrać siłę

export const TEAM_COLORS = ["#ff4d4d", "#4da6ff", "#66e066", "#ffd24d"] as const;
export const TEAM_NAMES = ["Czerwoni", "Niebiescy", "Zieloni", "Żółci"] as const;
