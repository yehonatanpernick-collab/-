// Shared simulation types: player state, commands, snapshots and events.
import type { TeamId } from './config';
import type { Loadout } from './weapons';

// ------------------------------------------------------------------ input
export const BTN_FIRE = 1;
export const BTN_ADS = 2;
export const BTN_JUMP = 4;
export const BTN_CROUCH = 8;
export const BTN_SPRINT = 16;
export const BTN_TAC = 32;
export const BTN_RELOAD = 64;
export const BTN_USE = 128;
export const BTN_GRENADE = 256;

/** Active item slots. */
export const SLOT_PRIMARY = 0;
export const SLOT_SECONDARY = 1;
export const SLOT_GADGET_A = 2;
export const SLOT_GADGET_B = 3;

/** One player command = one fixed 1/60 s movement + weapon step. */
export interface Cmd {
  seq: number;
  buttons: number;
  /** Strafe axis (-1 left … +1 right). */
  mx: number;
  /** Forward axis (+1 forward … -1 back). */
  mz: number;
  yaw: number;
  pitch: number;
  /** Desired active slot. */
  slot: number;
  /** Server tick (fractional) the client was rendering remote entities at; used for lag compensation. */
  viewTick: number;
}

// ------------------------------------------------------------------ player state
/** Everything the owning client predicts. Plain numbers/booleans so it can be cloned cheaply. */
export interface PlayerState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  tac: boolean;
  slideT: number;
  slideCd: number;
  tacT: number;
  jumpLatch: boolean;
  crouchLatch: boolean;
  /** Downward speed of the most recent landing during this command (0 otherwise). */
  landSpeed: number;
  /** Seconds since the player last stood on ground. */
  airT: number;

  slot: number;
  switchT: number;
  fireCd: number;
  reloadT: number;
  ads: number;
  burst: number;
  burstT: number;
  bloom: number;
  recoilP: number;
  recoilY: number;
  triggerLatch: boolean;
  sprintOutT: number;
  ammo0: number; ammo1: number;
  reserve0: number; reserve1: number;
  gadget0: number; gadget1: number;
  gadgetCd0: number; gadgetCd1: number;
  grenades: number;
  grenadeCd: number;
  grenadeLatch: boolean;
  useLatch: boolean;
  shotSeq: number;
}

export function makePlayerState(): PlayerState {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    grounded: true, crouching: false, sprinting: false, tac: false,
    slideT: 0, slideCd: 0, tacT: 0, jumpLatch: false, crouchLatch: false, landSpeed: 0, airT: 0,
    slot: 0, switchT: 0, fireCd: 0, reloadT: 0, ads: 0, burst: 0, burstT: 0, bloom: 0, recoilP: 0, recoilY: 0,
    triggerLatch: false, sprintOutT: 0, ammo0: 0, ammo1: 0, reserve0: 0, reserve1: 0,
    gadget0: 0, gadget1: 0, gadgetCd0: 0, gadgetCd1: 0, grenades: 0, grenadeCd: 0, grenadeLatch: false, useLatch: false,
    shotSeq: 0,
  };
}

export function copyPlayerState(dst: PlayerState, src: PlayerState): PlayerState {
  return Object.assign(dst, src);
}

// ------------------------------------------------------------------ snapshot
export const PF_ALIVE = 1;
export const PF_CROUCH = 2;
export const PF_SPRINT = 4;
export const PF_SLIDE = 8;
export const PF_ADS = 16;
export const PF_RELOAD = 32;
export const PF_AIR = 64;
export const PF_SPOTTED = 128;
export const PF_PROTECTED = 256;
export const PF_INVEHICLE = 512;
export const PF_FIRING = 1024;

export interface PlayerSnap {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  flags: number;
  health: number;
  /** Active slot (0..3). */
  slot: number;
}

export type ProjectileKind = 'frag' | 'smoke' | 'rocket' | 'sensor';
export const PROJECTILE_KINDS: readonly ProjectileKind[] = ['frag', 'smoke', 'rocket', 'sensor'];

export interface ProjectileSnap { id: number; kind: number; x: number; y: number; z: number }

export type DeployableKind = 'ammoCrate' | 'medCrate' | 'sensor' | 'smoke';
export const DEPLOYABLE_KINDS: readonly DeployableKind[] = ['ammoCrate', 'medCrate', 'sensor', 'smoke'];

export interface DeployableSnap { id: number; kind: number; team: TeamId; x: number; y: number; z: number; life: number }

export interface VehicleSnap {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  speed: number; steer: number;
  health: number;
  /** Player ids, -1 when empty. */
  driver: number;
  passenger: number;
  team: TeamId;
  alive: boolean;
}

export interface ObjectiveSnap {
  owner: TeamId;
  /** -1 (fully team B) … +1 (fully team A). */
  control: number;
  contested: boolean;
  /** Bit 0: team A present, bit 1: team B present. */
  presence: number;
}

export type MatchPhase = 'warmup' | 'live' | 'ended';
export const MATCH_PHASES: readonly MatchPhase[] = ['warmup', 'live', 'ended'];

/** State only the owning player receives (reconciliation + private HUD data). */
export interface OwnerSnap {
  ack: number;
  state: PlayerState;
  health: number;
  alive: boolean;
  respawnT: number;
  vehicle: number;
  seat: number;
  /** Player ids of enemies currently revealed to this player's team. */
  spotted: number[];
}

export interface Snapshot {
  tick: number;
  phase: MatchPhase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  tickets: [number, number];
  players: PlayerSnap[];
  projectiles: ProjectileSnap[];
  deployables: DeployableSnap[];
  vehicles: VehicleSnap[];
  objectives: ObjectiveSnap[];
  me?: OwnerSnap;
}

// ------------------------------------------------------------------ roster
export interface RosterEntry {
  id: number;
  name: string;
  team: TeamId;
  classId: number;
  bot: boolean;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  captures: number;
  headshots: number;
  ping: number;
  connected: boolean;
  /** Indices into WEAPONS for the two carried weapons. */
  primary: number;
  secondary: number;
  /** Attachment summary used to dress third-person weapon models. */
  optic: string;
  muzzle: string;
}

// ------------------------------------------------------------------ events
export const HIT_NONE = 0;
export const HIT_WORLD = 1;
export const HIT_PLAYER = 2;
export const HIT_GLASS = 3;
export const HIT_VEHICLE = 4;
export const HIT_PROP = 5;

export type SimEvent =
  | { t: 'shot'; id: number; w: number; ox: number; oy: number; oz: number; ex: number; ey: number; ez: number; hit: number; nx: number; ny: number; nz: number; mat: number; sup: boolean; seq: number }
  | { t: 'hit'; by: number; victim: number; dmg: number; head: boolean; kill: boolean; x: number; y: number; z: number }
  | { t: 'hurt'; victim: number; by: number; dmg: number; fx: number; fz: number; health: number }
  | { t: 'kill'; killer: number; victim: number; w: number; head: boolean; assist: number; how: string }
  | { t: 'spawn'; id: number; x: number; y: number; z: number }
  | { t: 'explode'; kind: string; x: number; y: number; z: number; r: number }
  | { t: 'destroy'; kind: string; ref: number; x: number; y: number; z: number }
  | { t: 'door'; ref: number; open: boolean }
  | { t: 'obj'; idx: number; owner: TeamId; prev: TeamId; kind: 'captured' | 'neutralized' }
  | { t: 'gadget'; id: number; kind: string }
  | { t: 'reload'; id: number }
  | { t: 'score'; id: number; amount: number; reason: string }
  | { t: 'phase'; phase: MatchPhase; winner: TeamId }
  | { t: 'notice'; text: string; team: TeamId }
  | { t: 'vehicle'; id: number; kind: 'enter' | 'exit' | 'destroyed' | 'respawn'; player: number }
  | { t: 'pickup'; id: number; kind: string };

export interface MatchResult {
  winner: TeamId;
  tickets: [number, number];
  duration: number;
  roster: RosterEntry[];
}

// ------------------------------------------------------------------ session level requests
export interface JoinOptions {
  name: string;
  loadout: Loadout;
  level: number;
  /** Private room code (optional). */
  code?: string;
  protocol: number;
}

export interface SpawnRequest {
  /** -1 = base, otherwise objective index. */
  point: number;
  loadout: Loadout;
}

export type Difficulty = 0 | 1 | 2 | 3;
export const DIFFICULTY_NAMES = ['Recruit', 'Regular', 'Veteran', 'Elite'] as const;

export interface MatchOptions {
  /** Total soldiers per team (bots fill the remaining seats). */
  teamSize: number;
  botDifficulty: Difficulty;
  fillBots: boolean;
  tickets: number;
  duration: number;
  warmup: number;
  seed: number;
  /** 0 = overcast day, 1 = dusk. */
  environment: number;
  /** Training options. */
  friendlyBots?: number;
  enemyBots?: number;
  vehicles: boolean;
}
