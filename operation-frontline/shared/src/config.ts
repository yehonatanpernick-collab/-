// Global simulation / gameplay constants shared by client and server.
// Anything that affects authoritative simulation MUST live here (or in the
// weapon / class tables) so prediction on the client matches the server.

export const SIM = {
  /** Authoritative simulation rate (Hz). */
  TICK_RATE: 30,
  TICK_DT: 1 / 30,
  /** Player command (movement step) rate (Hz). Two commands per sim tick. */
  CMD_RATE: 60,
  CMD_DT: 1 / 60,
  /** Network snapshot rate (Hz). */
  SNAPSHOT_RATE: 20,
  /** Max humans per match. */
  MAX_PLAYERS: 16,
  TEAM_SIZE: 8,
  /** Seconds of position history kept for lag compensated hit validation. */
  LAG_COMP_WINDOW: 0.4,
  /** Hard cap of queued, not yet simulated commands per player. */
  MAX_CMD_QUEUE: 24,
  /** Commands a player may execute per tick on average (2) + burst allowance. */
  CMD_BURST: 8,
} as const;

export const PLAYER = {
  RADIUS: 0.34,
  HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.15,
  EYE: 1.62,
  CROUCH_EYE: 0.98,
  SLIDE_EYE: 0.8,
  WALK_SPEED: 4.5,
  SPRINT_SPEED: 6.5,
  TAC_SPRINT_SPEED: 7.7,
  CROUCH_SPEED: 2.4,
  BACKPEDAL_FACTOR: 0.82,
  STRAFE_FACTOR: 0.92,
  GROUND_ACCEL: 11,
  GROUND_FRICTION: 8.5,
  STOP_SPEED: 2.2,
  AIR_ACCEL: 2.2,
  AIR_WISH_SPEED: 1.6,
  GRAVITY: 23,
  JUMP_VELOCITY: 6.9,
  TERMINAL_VELOCITY: 38,
  STEP_HEIGHT: 0.46,
  SLIDE_MIN_SPEED: 5.4,
  SLIDE_BOOST_SPEED: 8.8,
  SLIDE_FRICTION: 5.2,
  SLIDE_TIME: 0.85,
  SLIDE_COOLDOWN: 0.9,
  TAC_SPRINT_MAX: 3.2,
  TAC_SPRINT_RECHARGE: 0.45,
  MAX_HEALTH: 100,
  REGEN_DELAY: 6,
  REGEN_RATE: 14,
  SPAWN_PROTECTION: 2.5,
  RESPAWN_DELAY: 5,
  FALL_DAMAGE_MIN_SPEED: 15,
  FALL_DAMAGE_PER_SPEED: 7,
  USE_RANGE: 3.2,
} as const;

export const MATCH = {
  TICKETS: 300,
  DURATION: 15 * 60,
  WARMUP: 8,
  END_SCREEN: 14,
  CAPTURE_RADIUS: 8.5,
  CAPTURE_HEIGHT: 9,
  /** Seconds for one player to move the flag from neutral to owned. */
  CAPTURE_TIME: 9,
  /** Additional attackers speed capture up to this factor. */
  CAPTURE_MAX_SPEEDUP: 2.2,
  /** Seconds between ticket bleed when a team holds the majority of flags. */
  BLEED_INTERVAL: 3.5,
  BLEED_INTERVAL_ALL: 1.6,
} as const;

export const SCORE = {
  KILL: 100,
  HEADSHOT_BONUS: 25,
  ASSIST: 50,
  CAPTURE: 200,
  NEUTRALIZE: 100,
  DEFEND: 30,
  RESUPPLY: 15,
  HEAL: 15,
  SPOT: 10,
  VEHICLE_DESTROY: 150,
  REPAIR: 10,
} as const;

export const TEAM_NONE = 0;
export const TEAM_A = 1;
export const TEAM_B = 2;
export type TeamId = 0 | 1 | 2;

export const TEAM_NAMES: Record<number, string> = { 0: 'NEUTRAL', 1: 'VANGUARD', 2: 'IRONCLAD' };
export const TEAM_SHORT: Record<number, string> = { 0: '—', 1: 'VGD', 2: 'ICL' };

export const GAME_VERSION = '1.0.0';
export const PROTOCOL_VERSION = 3;
