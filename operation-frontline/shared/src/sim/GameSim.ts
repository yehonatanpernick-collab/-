// Authoritative game simulation. Hosted by the Colyseus room on the server and by
// LocalSession in the browser for offline training — the exact same code runs in both.
import { CLASSES, type ClassDef, GADGETS, type GadgetKind, defaultLoadout, sanitizeLoadout } from '../classes';
import { MATCH, PLAYER, SCORE, SIM, TEAM_A, TEAM_B, TEAM_NONE, type TeamId } from '../config';
import { Rng, clamp, dirFromAngles, type Vec3 } from '../math';
import { type DynBox, type MoveParams, eyeHeight, stepMove } from '../movement';
import { NavGrid } from '../nav';
import {
  BTN_JUMP, type Cmd, HIT_GLASS, HIT_NONE, HIT_PLAYER, HIT_PROP, HIT_VEHICLE, HIT_WORLD, type MatchOptions, type MatchPhase,
  type MatchResult, type OwnerSnap, PF_ADS, PF_AIR, PF_ALIVE, PF_CROUCH, PF_FIRING, PF_INVEHICLE, PF_PROTECTED, PF_RELOAD, PF_SLIDE,
  PF_SPOTTED, PF_SPRINT, type PlayerSnap, type PlayerState, type RosterEntry, type SimEvent, type Snapshot, makePlayerState,
} from '../types';
import { type WeaponCtx, type WeaponOut, activeWeapon, makeWeaponOut, shotDirection, stepWeapon } from '../weaponLogic';
import { type Loadout, WEAPONS, type WeaponStats, damageAtRange, resolveWeapon } from '../weapons';
import type { MapData, SpawnPoint } from '../world/MapBuilder';
import { F_BULLET, F_GLASS, type RayHit, type World, makeRayHit } from '../world/World';
import { buildKestrel } from '../world/maps/kestrel';
import { BotBrain, botLoadout, botName } from './bots';
import { Entities, VEHICLE, type Vehicle } from './entities';

/** Pseudo weapon ids used in kill events for non-gun deaths. */
export const KILL_GRENADE = -1;
export const KILL_ROCKET = -2;
export const KILL_BARREL = -3;
export const KILL_ROADKILL = -4;
export const KILL_VEHICLE_EXPLOSION = -5;
export const KILL_FALL = -6;
export const KILL_REPAIR = -7;

const HIST = 16;

export interface SimPlayer {
  id: number;
  name: string;
  bot: boolean;
  team: TeamId;
  connected: boolean;
  level: number;
  loadout: Loadout;
  nextLoadout: Loadout | null;
  cls: ClassDef;
  ctx: WeaponCtx;
  move: MoveParams;
  s: PlayerState;
  alive: boolean;
  health: number;
  respawnT: number;
  protectT: number;
  hurtT: number;
  stimT: number;
  /** -2 = no deploy requested, -1 = base, >= 0 objective index. */
  spawnChoice: number;
  cmds: Cmd[];
  lastSeq: number;
  ack: number;
  budget: number;
  idleTicks: number;
  lastCmd: Cmd;
  histX: Float32Array; histY: Float32Array; histZ: Float32Array; histC: Uint8Array; histTick: Int32Array;
  kills: number; deaths: number; assists: number; score: number; captures: number; headshots: number;
  dmgFrom: Map<number, number>;
  vehicle: number;
  seat: number;
  spottedT: number;
  firedT: number;
  firingT: number;
  ping: number;
  brain: BotBrain | null;
}

export interface ObjectiveState {
  owner: TeamId;
  control: number;
  contested: boolean;
  presence: number;
  countA: number;
  countB: number;
}

export interface AddPlayerInfo { name: string; bot?: boolean; loadout?: unknown; level?: number; team?: TeamId }

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  teamSize: SIM.TEAM_SIZE, botDifficulty: 1, fillBots: true, tickets: MATCH.TICKETS, duration: MATCH.DURATION,
  warmup: MATCH.WARMUP, seed: 1, environment: 0, vehicles: true,
};

const tmpDir: Vec3 = { x: 0, y: 0, z: 0 };

export class GameSim {
  readonly map: MapData;
  readonly world: World;
  readonly opts: MatchOptions;
  readonly rng: Rng;
  readonly ents: Entities;
  private navGrid: NavGrid | null = null;

  tick = 0;
  time = 0;
  phase: MatchPhase = 'warmup';
  phaseT: number;
  winner: TeamId = TEAM_NONE;
  tickets: [number, number];
  matchTime = 0;
  bleedT = 0;

  readonly players: SimPlayer[] = [];
  private readonly byId = new Map<number, SimPlayer>();
  readonly objectives: ObjectiveState[];
  events: SimEvent[] = [];
  rosterDirty = true;
  private readonly out: WeaponOut = makeWeaponOut();
  private readonly hit: RayHit = makeRayHit();
  private readonly neutralCmd: Cmd = { seq: 0, buttons: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, slot: 0, viewTick: 0 };
  vehicleBoxes: DynBox[] = [];
  private botSerial = 0;

  constructor(opts: Partial<MatchOptions> = {}, map?: MapData) {
    this.opts = { ...DEFAULT_MATCH_OPTIONS, ...opts };
    this.map = map ?? buildKestrel();
    this.world = this.map.world;
    this.rng = new Rng(this.opts.seed * 7919 + 13);
    this.tickets = [this.opts.tickets, this.opts.tickets];
    this.phaseT = this.opts.warmup;
    this.objectives = this.map.objectives.map(() => ({ owner: TEAM_NONE, control: 0, contested: false, presence: 0, countA: 0, countB: 0 }));
    this.ents = new Entities(this);
  }

  get nav(): NavGrid {
    if (!this.navGrid) this.navGrid = new NavGrid(this.world);
    return this.navGrid;
  }

  emit(e: SimEvent): void { this.events.push(e); }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  player(id: number): SimPlayer | undefined { return this.byId.get(id); }

  // ------------------------------------------------------------------ players
  private teamCount(team: TeamId, humansOnly = false): number {
    let n = 0;
    for (const p of this.players) if (p.team === team && (!humansOnly || !p.bot)) n++;
    return n;
  }

  addPlayer(info: AddPlayerInfo): SimPlayer {
    let id = 0;
    while (this.byId.has(id)) id++;
    let team = info.team;
    if (team !== TEAM_A && team !== TEAM_B) {
      const ha = this.teamCount(TEAM_A, !info.bot), hb = this.teamCount(TEAM_B, !info.bot);
      team = ha < hb ? TEAM_A : hb < ha ? TEAM_B : this.teamCount(TEAM_A) <= this.teamCount(TEAM_B) ? TEAM_A : TEAM_B;
    }
    const level = clamp(Math.floor(info.level ?? 1), 1, 99);
    const loadout = sanitizeLoadout(info.loadout ?? defaultLoadout(0), info.bot ? 99 : level);
    const cls = CLASSES[loadout.classId];
    const primary = resolveWeapon(loadout.primary, loadout.primaryAtt);
    const secondary = resolveWeapon(loadout.secondary, loadout.secondaryAtt);
    const p: SimPlayer = {
      id, name: String(info.name || 'Soldier').slice(0, 18), bot: !!info.bot, team, connected: true, level,
      loadout, nextLoadout: null, cls,
      ctx: { primary, secondary, gadgets: cls.gadgets, locked: false },
      move: { speedMul: 1, adsMoveFactor: 1, boost: 1 },
      s: makePlayerState(),
      alive: false, health: 0, respawnT: 0, protectT: 0, hurtT: 99, stimT: 0, spawnChoice: -2,
      cmds: [], lastSeq: -1, ack: -1, budget: 2, idleTicks: 0, lastCmd: { ...this.neutralCmd },
      histX: new Float32Array(HIST), histY: new Float32Array(HIST), histZ: new Float32Array(HIST), histC: new Uint8Array(HIST),
      histTick: new Int32Array(HIST).fill(-1),
      kills: 0, deaths: 0, assists: 0, score: 0, captures: 0, headshots: 0,
      dmgFrom: new Map(), vehicle: -1, seat: -1, spottedT: 0, firedT: 99, firingT: 99, ping: 0, brain: null,
    };
    if (p.bot) p.brain = new BotBrain(this, p, this.opts.botDifficulty);
    this.players.push(p);
    this.byId.set(id, p);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id: number): void {
    const p = this.byId.get(id);
    if (!p) return;
    if (p.vehicle >= 0) this.ents.leaveVehicle(p, false);
    this.byId.delete(id);
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    this.rosterDirty = true;
  }

  /** Keeps both teams at the configured size by adding / removing bots. */
  private manageBots(): void {
    const o = this.opts;
    for (const team of [TEAM_A, TEAM_B] as const) {
      let target: number;
      if (o.friendlyBots !== undefined || o.enemyBots !== undefined) {
        const humans = this.teamCount(team, true);
        const humanTeam = this.players.find((p) => !p.bot)?.team ?? TEAM_A;
        target = humans + (team === humanTeam ? (o.friendlyBots ?? 0) : (o.enemyBots ?? 0));
      } else {
        target = o.fillBots ? o.teamSize : 0;
      }
      let total = this.teamCount(team);
      const humans = this.teamCount(team, true);
      while (total < target) {
        const serial = this.botSerial++;
        this.addPlayer({ name: botName(serial), bot: true, team, loadout: botLoadout(serial, this.rng) });
        total++;
      }
      if (total > Math.max(target, humans)) {
        // prefer removing a dead bot
        const bots = this.players.filter((p) => p.bot && p.team === team);
        const victim = bots.find((b) => !b.alive) ?? bots[bots.length - 1];
        if (victim) this.removePlayer(victim.id);
      }
    }
  }

  queueCmd(id: number, cmd: Cmd): void {
    const p = this.byId.get(id);
    if (!p || cmd.seq <= p.lastSeq) return;
    p.lastSeq = cmd.seq;
    if (p.cmds.length >= SIM.MAX_CMD_QUEUE) p.cmds.shift();
    p.cmds.push(cmd);
  }

  requestSpawn(id: number, point: number, loadout: unknown): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.spawnChoice = Number.isInteger(point) && point >= 0 && point < this.objectives.length ? point : -1;
    if (loadout !== undefined) this.setLoadout(id, loadout);
  }

  setLoadout(id: number, loadout: unknown): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.nextLoadout = sanitizeLoadout(loadout, p.bot ? 99 : p.level);
    if (!p.alive) this.applyLoadout(p);
  }

  requestTeam(id: number, team: TeamId): boolean {
    const p = this.byId.get(id);
    if (!p || (team !== TEAM_A && team !== TEAM_B) || p.team === team) return false;
    if (this.teamCount(team, true) > this.teamCount(p.team, true) - 1) return false;
    if (p.alive) this.kill(p, null, KILL_FALL, false);
    p.team = team;
    p.spawnChoice = -2;
    this.rosterDirty = true;
    return true;
  }

  private applyLoadout(p: SimPlayer): void {
    if (p.nextLoadout) { p.loadout = p.nextLoadout; p.nextLoadout = null; }
    const l = p.loadout;
    p.cls = CLASSES[l.classId];
    p.ctx.primary = resolveWeapon(l.primary, l.primaryAtt);
    p.ctx.secondary = resolveWeapon(l.secondary, l.secondaryAtt);
    p.ctx.gadgets = p.cls.gadgets;
    this.rosterDirty = true;
  }

  maxReserve(p: SimPlayer, w: WeaponStats): number {
    return Math.round(w.reserve * (p.cls.id === 'support' ? 1.5 : 1));
  }

  // ------------------------------------------------------------------ spawning
  private pickSpawn(p: SimPlayer): SpawnPoint {
    let list: SpawnPoint[];
    const c = p.spawnChoice;
    if (c >= 0 && this.objectives[c].owner === p.team) list = this.map.objectives[c].spawns;
    else list = this.map.bases.find((b) => b.team === p.team)?.spawns ?? this.map.bases[0].spawns;
    let best = list[0], bestScore = -Infinity;
    for (const sp of list) {
      let nearestEnemy = 200, blocked = false;
      for (const o of this.players) {
        if (!o.alive || o === p) continue;
        const d = Math.hypot(o.s.x - sp.x, o.s.z - sp.z);
        if (d < 1.2 && Math.abs(o.s.y - sp.y) < 2) blocked = true;
        if (o.team !== p.team && d < nearestEnemy) nearestEnemy = d;
      }
      const score = (blocked ? -1000 : 0) + Math.min(nearestEnemy, 40) + this.rng.next() * 6;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best;
  }

  spawn(p: SimPlayer): void {
    this.applyLoadout(p);
    const sp = this.pickSpawn(p);
    const s = p.s;
    Object.assign(s, makePlayerState());
    s.x = sp.x; s.y = sp.y + 0.02; s.z = sp.z; s.yaw = sp.yaw;
    s.tacT = PLAYER.TAC_SPRINT_MAX;
    s.ammo0 = p.ctx.primary.magSize; s.reserve0 = this.maxReserve(p, p.ctx.primary);
    s.ammo1 = p.ctx.secondary.magSize; s.reserve1 = this.maxReserve(p, p.ctx.secondary);
    s.gadget0 = GADGETS[p.cls.gadgets[0]].ammo;
    s.gadget1 = p.cls.gadgets[1] ? GADGETS[p.cls.gadgets[1]].ammo : 0;
    s.grenades = p.cls.grenades;
    s.switchT = 0.35;
    p.alive = true;
    p.health = PLAYER.MAX_HEALTH;
    p.protectT = PLAYER.SPAWN_PROTECTION;
    p.hurtT = 99; p.stimT = 0; p.firedT = 99; p.firingT = 99; p.spottedT = 0;
    p.dmgFrom.clear();
    p.vehicle = -1; p.seat = -1;
    p.cmds.length = 0;
    p.lastCmd = { ...this.neutralCmd, yaw: sp.yaw };
    p.histTick.fill(-1);
    if (!p.bot) p.spawnChoice = -2;
    p.brain?.onSpawn();
    this.emit({ t: 'spawn', id: p.id, x: s.x, y: s.y, z: s.z });
  }

  // ------------------------------------------------------------------ main step
  step(): void {
    const dt = SIM.TICK_DT;
    this.tick++;
    this.time += dt;
    this.updatePhase(dt);
    if (this.tick % 15 === 1) this.manageBots();
    this.vehicleBoxes = this.ents.vehicleColliders();

    const live = this.phase === 'live';
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) {
        p.cmds.length = 0;
        if (p.respawnT > 0) p.respawnT -= dt;
        if (live && p.respawnT <= 0) {
          if (p.bot) { p.spawnChoice = p.brain ? p.brain.chooseSpawn() : -1; this.spawn(p); }
          else if (p.spawnChoice !== -2 && p.connected) this.spawn(p);
        }
        continue;
      }
      if (this.phase === 'ended') { p.cmds.length = 0; continue; }
      if (p.bot && p.brain) {
        const cmd = p.brain.think(dt);
        this.runCmd(p, cmd);
        if (p.alive) { cmd.seq++; this.runCmd(p, cmd); }
      } else {
        p.budget = Math.min(p.budget + 2, SIM.CMD_BURST);
        let ran = 0;
        while (p.cmds.length > 0 && p.budget >= 1 && p.alive) {
          this.runCmd(p, p.cmds.shift() as Cmd);
          p.budget--;
          ran++;
        }
        if (ran === 0) {
          // No input: after a grace period keep physics running with a neutral command.
          if (++p.idleTicks > 8 && p.alive) {
            const n = this.neutralCmd;
            n.yaw = p.s.yaw; n.pitch = p.s.pitch; n.slot = p.s.slot; n.seq = p.ack;
            this.runCmd(p, n, true); this.runCmd(p, n, true);
          }
        } else p.idleTicks = 0;
      }
      if (p.alive) this.postPlayer(p, dt);
    }

    this.ents.step(dt);
    if (live) this.stepObjectives(dt);

    for (const p of this.players) {
      const h = this.tick % HIST;
      p.histX[h] = p.s.x; p.histY[h] = p.s.y; p.histZ[h] = p.s.z;
      p.histC[h] = p.alive ? (p.s.crouching || p.vehicle >= 0 ? 2 : 1) : 0;
      p.histTick[h] = this.tick;
    }
  }

  private updatePhase(dt: number): void {
    this.phaseT -= dt;
    if (this.phase === 'warmup') {
      if (this.phaseT <= 0) this.setPhase('live', this.opts.duration);
    } else if (this.phase === 'live') {
      this.matchTime += dt;
      if (this.tickets[0] <= 0 || this.tickets[1] <= 0 || this.phaseT <= 0) {
        this.winner = this.tickets[0] === this.tickets[1] ? TEAM_NONE : this.tickets[0] > this.tickets[1] ? TEAM_A : TEAM_B;
        this.setPhase('ended', MATCH.END_SCREEN);
      }
    } else if (this.phaseT <= 0) {
      this.restart();
    }
  }

  private setPhase(phase: MatchPhase, duration: number): void {
    this.phase = phase;
    this.phaseT = duration;
    this.emit({ t: 'phase', phase, winner: this.winner });
    this.rosterDirty = true;
  }

  /** Reset everything for a new round with the same players. */
  restart(): void {
    this.tickets = [this.opts.tickets, this.opts.tickets];
    this.winner = TEAM_NONE;
    this.matchTime = 0;
    this.bleedT = 0;
    for (const o of this.objectives) { o.owner = TEAM_NONE; o.control = 0; o.contested = false; o.presence = 0; }
    for (const p of this.players) {
      p.alive = false; p.respawnT = 0; p.spawnChoice = p.bot ? -1 : -2;
      p.kills = p.deaths = p.assists = p.score = p.captures = p.headshots = 0;
      p.vehicle = -1; p.seat = -1; p.cmds.length = 0;
    }
    this.ents.reset();
    this.setPhase('warmup', this.opts.warmup);
  }

  result(): MatchResult {
    return { winner: this.winner, tickets: [Math.max(0, this.tickets[0]), Math.max(0, this.tickets[1])], duration: this.matchTime, roster: this.roster() };
  }

  // ------------------------------------------------------------------ per-command simulation
  private runCmd(p: SimPlayer, cmd: Cmd, synthetic = false): void {
    const s = p.s;
    const out = this.out;
    p.lastCmd = cmd;
    const veh = p.vehicle >= 0 ? this.ents.vehicles[p.vehicle] : null;
    if (veh) {
      s.yaw = cmd.yaw; s.pitch = cmd.pitch;
      s.vx = s.vy = s.vz = 0; s.sprinting = false; s.grounded = true; s.crouching = false;
      if (p.seat === 0) {
        veh.throttle = clamp(cmd.mz, -1, 1);
        veh.steerIn = clamp(cmd.mx, -1, 1);
        veh.brake = (cmd.buttons & BTN_JUMP) !== 0;
      }
      this.ents.seatPosition(veh, p.seat, s);
    } else {
      const w = activeWeapon(s, p.ctx);
      p.move.speedMul = p.cls.speedMul * (s.slot < 2 ? w.moveFactor : 1);
      p.move.adsMoveFactor = w.adsMoveFactor;
      p.move.boost = p.stimT > 0 ? 1.08 : 1;
      stepMove(s, cmd, SIM.CMD_DT, this.world, p.move, this.vehicleBoxes);
      if (s.landSpeed > PLAYER.FALL_DAMAGE_MIN_SPEED) {
        this.damage(p, (s.landSpeed - PLAYER.FALL_DAMAGE_MIN_SPEED) * PLAYER.FALL_DAMAGE_PER_SPEED + 4, null, KILL_FALL, false, 0, 0);
        if (!p.alive) return;
      }
      if (s.y < this.world.killY) { this.kill(p, null, KILL_FALL, false); return; }
    }
    p.ctx.locked = this.phase !== 'live' || (veh !== null && p.seat === 0);
    stepWeapon(s, cmd, SIM.CMD_DT, p.ctx, out);
    if (!synthetic) p.ack = cmd.seq;
    if (out.fired) this.fireShot(p, cmd, out);
    if (out.reloadStart) this.emit({ t: 'reload', id: p.id });
    if (out.gadget) this.ents.useGadget(p, out.gadget, out);
    if (out.grenade) this.ents.throwProjectile(p, 'frag', out.aimYaw, out.aimPitch);
    if (out.use) this.ents.tryUse(p);
  }

  private postPlayer(p: SimPlayer, dt: number): void {
    p.hurtT += dt; p.firedT += dt; p.firingT += dt;
    if (p.protectT > 0) p.protectT -= dt;
    if (p.spottedT > 0) p.spottedT -= dt;
    if (p.stimT > 0) {
      p.stimT -= dt;
      p.health = Math.min(PLAYER.MAX_HEALTH, p.health + 25 * dt);
    } else if (p.health < PLAYER.MAX_HEALTH && p.hurtT > (p.cls.id === 'assault' ? PLAYER.REGEN_DELAY - 2 : PLAYER.REGEN_DELAY)) {
      p.health = Math.min(PLAYER.MAX_HEALTH, p.health + PLAYER.REGEN_RATE * dt);
    }
  }

  eyePos(p: SimPlayer, out: Vec3): Vec3 {
    out.x = p.s.x; out.z = p.s.z;
    out.y = p.s.y + (p.vehicle >= 0 ? 0.62 : eyeHeight(p.s));
    return out;
  }

  // ------------------------------------------------------------------ combat
  /** Position of `target` as the shooter saw it at (fractional) tick t. */
  private rewind(target: SimPlayer, t: number, out: { x: number; y: number; z: number; c: number }): void {
    const t0 = Math.floor(t), f = t - t0;
    const h0 = t0 % HIST, h1 = (t0 + 1) % HIST;
    if (t0 >= this.tick || target.histTick[h0] !== t0 || target.histC[h0] === 0) {
      out.x = target.s.x; out.y = target.s.y; out.z = target.s.z;
      out.c = target.s.crouching || target.vehicle >= 0 ? 2 : 1;
      return;
    }
    if (target.histTick[h1] === t0 + 1 && target.histC[h1] !== 0) {
      out.x = target.histX[h0] + (target.histX[h1] - target.histX[h0]) * f;
      out.y = target.histY[h0] + (target.histY[h1] - target.histY[h0]) * f;
      out.z = target.histZ[h0] + (target.histZ[h1] - target.histZ[h0]) * f;
    } else { out.x = target.histX[h0]; out.y = target.histY[h0]; out.z = target.histZ[h0]; }
    out.c = target.histC[h0];
  }

  private readonly rw = { x: 0, y: 0, z: 0, c: 1 };

  /**
   * Ray vs a soldier's hit volumes. Returns distance along the ray or -1; sets `this.hitHead` / `this.hitLeg`.
   * Body = AABB, head = sphere on top.
   */
  private hitHead = false;
  private hitLeg = false;
  private rayPlayer(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, px: number, py: number, pz: number, crouch: boolean): number {
    const bodyTop = py + (crouch ? 0.95 : 1.5), headY = py + (crouch ? 1.06 : 1.63), hr = 0.17, br = 0.3;
    let best = -1;
    this.hitHead = false; this.hitLeg = false;
    // head sphere
    const lx = ox - px, ly = oy - headY, lz = oz - pz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - hr * hr;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t <= maxT) { best = t; this.hitHead = true; }
    }
    // body box
    let t0 = 0, t1 = best >= 0 ? best : maxT;
    const slab = (o: number, d: number, mn: number, mx: number): boolean => {
      if (d === 0) return o >= mn && o <= mx;
      let a = (mn - o) / d, e = (mx - o) / d;
      if (a > e) { const s = a; a = e; e = s; }
      if (a > t0) t0 = a;
      if (e < t1) t1 = e;
      return t0 <= t1;
    };
    if (slab(ox, dx, px - br, px + br) && slab(oy, dy, py, bodyTop) && slab(oz, dz, pz - br, pz + br)) {
      best = t0; this.hitHead = false;
      this.hitLeg = oy + dy * t0 < py + (crouch ? 0.4 : 0.75);
    }
    return best;
  }

  private fireShot(p: SimPlayer, cmd: Cmd, out: WeaponOut): void {
    const w = activeWeapon(p.s, p.ctx);
    p.protectT = 0;
    p.firingT = 0;
    if (!w.suppressed) p.firedT = 0;
    const eye = this.eyePos(p, { x: 0, y: 0, z: 0 });
    const dir = shotDirection(out.aimYaw, out.aimPitch, out.spread, p.id, out.shotSeq, tmpDir);
    const maxBack = SIM.LAG_COMP_WINDOW * SIM.TICK_RATE;
    const t = p.bot ? this.tick : clamp(cmd.viewTick, this.tick - maxBack, this.tick);

    let ox = eye.x, oy = eye.y, oz = eye.z;
    let remaining = w.maxRange, travelled = 0;
    let kind = HIT_NONE, ex = ox + dir.x * remaining, ey = oy + dir.y * remaining, ez = oz + dir.z * remaining;
    let nx = 0, ny = 1, nz = 0, mat = 0;
    const hit = this.hit;
    for (let iter = 0; iter < 4; iter++) {
      const worldHit = this.world.raycast(ox, oy, oz, dir.x, dir.y, dir.z, remaining, F_BULLET | F_GLASS, hit);
      let limit = worldHit ? hit.t : remaining;
      // soldiers
      let victim: SimPlayer | null = null, head = false, leg = false;
      for (const o of this.players) {
        if (!o.alive || o === p || o.team === p.team) continue;
        this.rewind(o, t, this.rw);
        const tt = this.rayPlayer(ox, oy, oz, dir.x, dir.y, dir.z, limit, this.rw.x, this.rw.y, this.rw.z, this.rw.c === 2);
        if (tt >= 0 && tt < limit) { limit = tt; victim = o; head = this.hitHead; leg = this.hitLeg; }
      }
      // vehicles
      let veh: Vehicle | null = null;
      for (const v of this.ents.vehicles) {
        if (!v.alive || v.id === p.vehicle) continue;
        const tv = this.ents.rayVehicle(v, ox, oy, oz, dir.x, dir.y, dir.z, limit);
        if (tv >= 0 && tv < limit) { limit = tv; veh = v; victim = null; }
      }
      const dist = travelled + limit;
      ex = ox + dir.x * limit; ey = oy + dir.y * limit; ez = oz + dir.z * limit;
      if (victim) {
        const dmg = damageAtRange(w, dist) * (head ? w.headMult : leg ? w.legMult : 1);
        this.damage(victim, dmg, p, w.index, head, -dir.x, -dir.z);
        kind = HIT_PLAYER; nx = -dir.x; ny = 0; nz = -dir.z;
        break;
      }
      if (veh) {
        this.ents.damageVehicle(veh, damageAtRange(w, dist) * w.vehicleMult, p);
        kind = HIT_VEHICLE; nx = -dir.x; ny = 0.3; nz = -dir.z; mat = 9;
        break;
      }
      if (worldHit) {
        nx = hit.nx; ny = hit.ny; nz = hit.nz; mat = hit.mat;
        const box = hit.index >= 0 ? this.world.boxes[hit.index] : null;
        if (box && (box.flags & F_GLASS)) {
          this.ents.breakDyn(box.ref, p);
          kind = HIT_GLASS;
          travelled += hit.t + 0.08; remaining -= hit.t + 0.08;
          ox += dir.x * (hit.t + 0.08); oy += dir.y * (hit.t + 0.08); oz += dir.z * (hit.t + 0.08);
          if (remaining <= 0) break;
          ex = ox + dir.x * remaining; ey = oy + dir.y * remaining; ez = oz + dir.z * remaining;
          continue;
        }
        if (box && box.ref >= 0) { this.ents.damageDyn(box.ref, damageAtRange(w, dist), p); kind = HIT_PROP; }
        else kind = HIT_WORLD;
        break;
      }
      if (kind !== HIT_GLASS) kind = HIT_NONE;
      break;
    }
    this.emit({ t: 'shot', id: p.id, w: w.index, ox: eye.x, oy: eye.y, oz: eye.z, ex, ey, ez, hit: kind, nx, ny, nz, mat, sup: w.suppressed, seq: out.shotSeq });
  }

  /** Apply damage. `fx, fz` is the horizontal direction from the victim towards the source. */
  damage(victim: SimPlayer, amount: number, attacker: SimPlayer | null, weapon: number, head: boolean, fx: number, fz: number): number {
    if (!victim.alive || victim.protectT > 0 || this.phase !== 'live') return 0;
    if (attacker && attacker !== victim && attacker.team === victim.team) return 0;
    if (attacker && attacker.bot && !victim.bot && attacker.brain) amount *= attacker.brain.skill.dmg;
    const dmg = Math.max(1, Math.round(amount));
    victim.health -= dmg;
    victim.hurtT = 0;
    if (attacker && attacker !== victim) victim.dmgFrom.set(attacker.id, (victim.dmgFrom.get(attacker.id) ?? 0) + dmg);
    const dead = victim.health <= 0;
    this.emit({ t: 'hurt', victim: victim.id, by: attacker ? attacker.id : -1, dmg, fx, fz, health: Math.max(0, Math.round(victim.health)) });
    if (attacker && attacker !== victim) {
      this.emit({ t: 'hit', by: attacker.id, victim: victim.id, dmg, head, kill: dead, x: victim.s.x, y: victim.s.y + 1.2, z: victim.s.z });
    }
    victim.brain?.onHurt(attacker);
    if (dead) this.kill(victim, attacker, weapon, head);
    return dmg;
  }

  addScore(p: SimPlayer, amount: number, reason: string): void {
    p.score += amount;
    this.rosterDirty = true;
    this.emit({ t: 'score', id: p.id, amount, reason });
  }

  kill(victim: SimPlayer, attacker: SimPlayer | null, weapon: number, head: boolean): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.respawnT = PLAYER.RESPAWN_DELAY;
    if (victim.vehicle >= 0) this.ents.leaveVehicle(victim, false);
    if (this.phase === 'live') this.tickets[victim.team - 1] = Math.max(0, this.tickets[victim.team - 1] - 1);
    let assist = -1;
    const killer = attacker && attacker !== victim ? attacker : null;
    if (killer) {
      killer.kills++;
      if (head) killer.headshots++;
      this.addScore(killer, SCORE.KILL + (head ? SCORE.HEADSHOT_BONUS : 0), head ? 'HEADSHOT' : 'ENEMY DOWN');
      let bestDmg = 34;
      for (const [id, d] of victim.dmgFrom) {
        if (id !== killer.id && d > bestDmg && this.byId.has(id)) { bestDmg = d; assist = id; }
      }
      if (assist >= 0) {
        const a = this.byId.get(assist) as SimPlayer;
        a.assists++;
        this.addScore(a, SCORE.ASSIST, 'ASSIST');
      }
      // defending an owned objective
      for (let i = 0; i < this.objectives.length; i++) {
        const od = this.map.objectives[i];
        if (this.objectives[i].owner === killer.team && Math.hypot(victim.s.x - od.x, victim.s.z - od.z) < od.radius + 4) {
          this.addScore(killer, SCORE.DEFEND, 'OBJECTIVE DEFENDED');
          break;
        }
      }
      killer.brain?.onKill(victim);
    }
    this.emit({ t: 'kill', killer: killer ? killer.id : -1, victim: victim.id, w: weapon, head, assist, how: '' });
    this.rosterDirty = true;
  }

  // ------------------------------------------------------------------ conquest
  private stepObjectives(dt: number): void {
    let ownA = 0, ownB = 0;
    for (let i = 0; i < this.objectives.length; i++) {
      const st = this.objectives[i], def = this.map.objectives[i];
      let a = 0, b = 0, aBoost = 0, bBoost = 0;
      for (const p of this.players) {
        if (!p.alive) continue;
        const dy = p.s.y - def.y;
        if (dy < -2 || dy > MATCH.CAPTURE_HEIGHT) continue;
        if (Math.hypot(p.s.x - def.x, p.s.z - def.z) > def.radius) continue;
        const bonus = p.cls.id === 'assault' ? 0.15 : 0;
        if (p.team === TEAM_A) { a++; aBoost += bonus; } else { b++; bBoost += bonus; }
      }
      st.countA = a; st.countB = b;
      st.presence = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0);
      st.contested = a > 0 && b > 0;
      const rate = (n: number, boost: number): number => (Math.min(1 + (n - 1) * 0.45, MATCH.CAPTURE_MAX_SPEEDUP) + boost) / MATCH.CAPTURE_TIME;
      const prevOwner = st.owner;
      if (!st.contested) {
        if (a > 0) st.control = Math.min(1, st.control + rate(a, aBoost) * dt);
        else if (b > 0) st.control = Math.max(-1, st.control - rate(b, bBoost) * dt);
        else if (st.owner === TEAM_A) st.control = Math.min(1, st.control + dt / 20);
        else if (st.owner === TEAM_B) st.control = Math.max(-1, st.control - dt / 20);
        else if (st.control !== 0) st.control = Math.abs(st.control) < dt / 12 ? 0 : st.control - Math.sign(st.control) * (dt / 12);
      }
      if (st.owner === TEAM_B && st.control >= 0) st.owner = TEAM_NONE;
      else if (st.owner === TEAM_A && st.control <= 0) st.owner = TEAM_NONE;
      if (st.owner === TEAM_NONE) {
        if (st.control >= 1) st.owner = TEAM_A;
        else if (st.control <= -1) st.owner = TEAM_B;
      }
      if (st.owner !== prevOwner) {
        const captured = st.owner !== TEAM_NONE;
        const team = captured ? st.owner : prevOwner === TEAM_A ? TEAM_B : TEAM_A;
        for (const p of this.players) {
          if (!p.alive || p.team !== team) continue;
          if (Math.hypot(p.s.x - def.x, p.s.z - def.z) > def.radius + 1) continue;
          if (captured) p.captures++;
          this.addScore(p, captured ? SCORE.CAPTURE : SCORE.NEUTRALIZE, captured ? `OBJECTIVE ${def.id} CAPTURED` : `OBJECTIVE ${def.id} NEUTRALIZED`);
        }
        this.emit({ t: 'obj', idx: i, owner: st.owner, prev: prevOwner, kind: captured ? 'captured' : 'neutralized' });
      }
      if (st.owner === TEAM_A) ownA++; else if (st.owner === TEAM_B) ownB++;
    }
    // ticket bleed: the team holding fewer flags bleeds
    if (ownA !== ownB) {
      const all = Math.max(ownA, ownB) === this.objectives.length;
      this.bleedT += dt;
      const interval = all ? MATCH.BLEED_INTERVAL_ALL : MATCH.BLEED_INTERVAL;
      if (this.bleedT >= interval) {
        this.bleedT -= interval;
        const loser = ownA > ownB ? 1 : 0;
        this.tickets[loser] = Math.max(0, this.tickets[loser] - 1);
      }
    } else this.bleedT = 0;
  }

  // ------------------------------------------------------------------ snapshots
  snapshot(): Snapshot {
    const players: PlayerSnap[] = [];
    for (const p of this.players) {
      const s = p.s;
      let flags = 0;
      if (p.alive) flags |= PF_ALIVE;
      if (s.crouching) flags |= PF_CROUCH;
      if (s.sprinting) flags |= PF_SPRINT;
      if (s.slideT > 0) flags |= PF_SLIDE;
      if (s.ads > 0.5) flags |= PF_ADS;
      if (s.reloadT > 0) flags |= PF_RELOAD;
      if (!s.grounded) flags |= PF_AIR;
      if (p.spottedT > 0 || p.firedT < 2.5) flags |= PF_SPOTTED;
      if (p.protectT > 0) flags |= PF_PROTECTED;
      if (p.vehicle >= 0) flags |= PF_INVEHICLE;
      if (p.firingT < 0.2) flags |= PF_FIRING;
      players.push({ id: p.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, flags, health: Math.max(0, Math.round(p.health)), slot: s.slot });
    }
    return {
      tick: this.tick, phase: this.phase, timeLeft: Math.max(0, this.phaseT),
      tickets: [Math.max(0, this.tickets[0]), Math.max(0, this.tickets[1])],
      players,
      projectiles: this.ents.projectileSnaps(),
      deployables: this.ents.deployableSnaps(),
      vehicles: this.ents.vehicleSnaps(),
      objectives: this.objectives.map((o) => ({ owner: o.owner, control: o.control, contested: o.contested, presence: o.presence })),
    };
  }

  ownerSnap(id: number): OwnerSnap | undefined {
    const p = this.byId.get(id);
    if (!p) return undefined;
    const spotted: number[] = [];
    for (const o of this.players) if (o.alive && o.team !== p.team && (o.spottedT > 0 || o.firedT < 2.5)) spotted.push(o.id);
    return { ack: p.ack, state: { ...p.s }, health: Math.max(0, Math.round(p.health)), alive: p.alive, respawnT: Math.max(0, p.respawnT), vehicle: p.vehicle, seat: p.seat, spotted };
  }

  roster(): RosterEntry[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, classId: p.cls.index, bot: p.bot,
      kills: p.kills, deaths: p.deaths, assists: p.assists, score: p.score, captures: p.captures, headshots: p.headshots,
      ping: Math.round(p.ping), connected: p.connected,
      primary: p.ctx.primary.index, secondary: p.ctx.secondary.index,
      optic: p.ctx.primary.attachments.optic, muzzle: p.ctx.primary.attachments.muzzle,
    }));
  }

  /** Human readable name for kill feed entries. */
  static weaponName(w: number): string {
    if (w >= 0) return WEAPONS[w]?.name ?? 'Weapon';
    return ({ [KILL_GRENADE]: 'Frag Grenade', [KILL_ROCKET]: 'RPG-9', [KILL_BARREL]: 'Explosion', [KILL_ROADKILL]: 'Roadkill', [KILL_VEHICLE_EXPLOSION]: 'Vehicle Explosion', [KILL_FALL]: 'Misadventure', [KILL_REPAIR]: 'Repair Torch' } as Record<number, string>)[w] ?? 'Killed';
  }
}

export { VEHICLE };
export type { GadgetKind, Vehicle };
// Re-exported so hosts can reference it without importing sim internals.
export { dirFromAngles };
