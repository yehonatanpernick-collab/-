// Client game runtime: input → commands → prediction, server reconciliation,
// remote entity interpolation, camera, and translation of simulation events into
// visuals / audio / HUD feedback. Works identically for local and network sessions.
import { CLASSES } from '@shared/classes';
import { PLAYER, SIM, TEAM_A, type TeamId } from '@shared/config';
import { DEG, clamp, lerp, lerpAngle } from '@shared/math';
import { type DynBox, type MoveParams, eyeHeight, stepMove } from '@shared/movement';
import { GameSim } from '@shared/sim/GameSim';
import { VEHICLE } from '@shared/sim/entities';
import {
  BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_GRENADE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_TAC, BTN_USE, type Cmd, HIT_GLASS, HIT_NONE, HIT_PLAYER,
  type MatchPhase, type MatchResult, type ObjectiveSnap, type OwnerSnap, PF_ALIVE, PF_INVEHICLE, type PlayerSnap, type PlayerState,
  type RosterEntry, type SimEvent, type Snapshot, type VehicleSnap, copyPlayerState, makePlayerState,
} from '@shared/types';
import { type WeaponCtx, type WeaponOut, activeWeapon, makeWeaponOut, shotDirection, stepWeapon } from '@shared/weaponLogic';
import { type Loadout, WEAPONS, resolveWeapon } from '@shared/weapons';
import type { MapData } from '@shared/world/MapBuilder';
import { F_BULLET, F_GLASS, makeRayHit } from '@shared/world/World';
import { MATERIALS } from '@shared/world/materials';
import * as pc from 'playcanvas';
import type { AudioEngine } from '../audio/audio';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';
import type { Input } from '../core/input';
import type { Store } from '../core/settings';
import type { Session } from '../net/session';
import { Avatars } from '../render/avatars';
import { Effects } from '../render/effects';
import { EntityViews } from '../render/entities';
import { ViewModel } from '../render/viewmodel';
import { WorldView } from '../render/world';

export interface InterpPlayer { id: number; x: number; y: number; z: number; yaw: number; pitch: number; flags: number; health: number; slot: number }

/** Everything the UI layer needs to know; filled every frame by the game. */
export interface GameView {
  phase: MatchPhase;
  timeLeft: number;
  tickets: [number, number];
  objectives: ObjectiveSnap[];
  roster: RosterEntry[];
  myId: number;
  myTeam: TeamId;
  alive: boolean;
  health: number;
  respawnT: number;
  state: PlayerState;
  ctx: WeaponCtx;
  loadout: Loadout;
  players: InterpPlayer[];
  vehicles: VehicleSnap[];
  spotted: number[];
  inVehicle: boolean;
  seat: number;
  yaw: number;
  ping: number;
  fps: number;
  spread: number;
  scoped: boolean;
  usePrompt: string;
  deathBy: string;
  result: MatchResult | null;
  status: string;
}

/** Callbacks into the UI (HUD, kill feed, …). */
export interface GameUi {
  hitmarker(head: boolean, kill: boolean): void;
  damage(angle: number, amount: number): void;
  killFeed(killer: string, killerTeam: number, victim: string, victimTeam: number, weapon: string, head: boolean, mine: boolean): void;
  score(amount: number, reason: string): void;
  notice(text: string, tone: 'good' | 'bad' | 'neutral'): void;
  phase(phase: MatchPhase, winner: TeamId): void;
  spawned(): void;
  died(): void;
  status(status: string, detail?: string): void;
}

const hit = makeRayHit();
const v3a = new pc.Vec3(), v3b = new pc.Vec3(), v3c = new pc.Vec3();
const dirTmp = { x: 0, y: 0, z: 0 };
const look = { x: 0, y: 0 };
const axes = { x: 0, z: 0 };

export class Game {
  readonly world: WorldView;
  readonly viewmodel: ViewModel;
  readonly avatars: Avatars;
  readonly effects: Effects;
  readonly entities: EntityViews;
  readonly view: GameView;
  session: Session | null = null;
  ui: GameUi | null = null;
  active = false;

  // prediction
  private readonly pred = makePlayerState();
  private readonly ctx: WeaponCtx;
  private readonly move: MoveParams = { speedMul: 1, adsMoveFactor: 1, boost: 1 };
  private readonly out: WeaponOut = makeWeaponOut();
  private readonly replayOut: WeaponOut = makeWeaponOut();
  private pending: Cmd[] = [];
  private seq = 0;
  private cmdAcc = 0;
  private viewYaw = 0;
  private viewPitch = 0;
  private wantSlot = 0;
  private crouchToggle = false;
  private adsToggle = false;
  private tacLatch = false;
  private lastSprintTap = -9;
  private stimT = 0;
  private errX = 0; private errY = 0; private errZ = 0;
  private eyeH: number = PLAYER.EYE;
  private vehicleBoxes: DynBox[] = [];

  // snapshots
  private snaps: Snapshot[] = [];
  private clock = 0;
  private tickOffset = 0;
  private haveOffset = false;
  private me: OwnerSnap | null = null;
  private wasAlive = false;
  private loadout: Loadout;

  // camera feel
  private shake = 0;
  private landDip = 0;
  private landVel = 0;
  private bob = 0;
  private fovNow = 80;
  private deathCamT = 0;
  private deathYaw = 0;
  private stepAcc = 0;
  private lookDX = 0; private lookDY = 0;
  private autoFireT = 0;

  constructor(private readonly engine: Engine, private readonly assets: Assets, private readonly store: Store, private readonly input: Input,
    private readonly audio: AudioEngine, readonly map: MapData) {
    this.world = new WorldView(engine, assets, map);
    this.viewmodel = new ViewModel(engine, assets);
    this.avatars = new Avatars(engine, assets);
    this.effects = new Effects(engine, assets, map);
    this.entities = new EntityViews(engine, assets, this.effects);
    this.loadout = store.loadout;
    this.ctx = this.makeCtx(this.loadout);
    this.viewmodel.setLoadout(this.ctx);
    this.viewmodel.setVisible(false);
    this.view = {
      phase: 'warmup', timeLeft: 0, tickets: [0, 0], objectives: [], roster: [], myId: -1, myTeam: TEAM_A, alive: false, health: 0, respawnT: 0,
      state: this.pred, ctx: this.ctx, loadout: this.loadout, players: [], vehicles: [], spotted: [], inVehicle: false, seat: -1, yaw: 0, ping: 0, fps: 60,
      spread: 0, scoped: false, usePrompt: '', deathBy: '', result: null, status: '',
    };
  }

  private makeCtx(l: Loadout): WeaponCtx {
    const cls = CLASSES[l.classId];
    return { primary: resolveWeapon(l.primary, l.primaryAtt), secondary: resolveWeapon(l.secondary, l.secondaryAtt), gadgets: cls.gadgets, locked: false };
  }

  // ------------------------------------------------------------------ session lifecycle
  start(session: Session): void {
    this.session = session;
    this.active = true;
    this.snaps = [];
    this.pending = [];
    this.me = null;
    this.haveOffset = false;
    this.wasAlive = false;
    this.view.myId = session.myId;
    this.view.result = null;
    this.view.roster = [];
    this.world.resetDyn();
    for (const id of session.destroyed) this.world.setDynAlive(id, false);
    session.handlers = {
      onSnapshot: (s) => this.onSnapshot(s),
      onEvents: (e) => { for (const ev of e) this.onEvent(ev); },
      onRoster: (r) => this.onRoster(r),
      onResult: (r) => { this.view.result = r; },
      onStatus: (st, detail) => { this.view.status = st === 'connected' ? '' : st; this.ui?.status(st, detail); },
    };
    this.audio.startAmbient();
  }

  stop(): void {
    this.active = false;
    this.session?.leave();
    this.session = null;
    this.viewmodel.setVisible(false);
    this.avatars.clear();
    this.entities.clear();
    this.effects.clear();
    this.audio.stopAmbient();
    this.input.enabled = false;
    this.input.exitLock();
  }

  /** Ask the server to deploy at a spawn point (-1 = base) with the currently selected loadout. */
  deploy(point: number): void {
    this.loadout = this.store.loadout;
    this.session?.spawn(point, this.loadout);
  }

  switchTeam(): void {
    this.session?.requestTeam(this.view.myTeam === TEAM_A ? 2 : 1);
  }

  private onRoster(r: RosterEntry[]): void {
    this.view.roster = r;
    const me = r.find((p) => p.id === this.view.myId);
    if (me) this.view.myTeam = me.team;
    this.avatars.sync(r, this.view.myId, this.view.myTeam);
  }

  // ------------------------------------------------------------------ snapshots
  private onSnapshot(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    const off = s.tick - this.clock * SIM.TICK_RATE;
    if (!this.haveOffset || Math.abs(off - this.tickOffset) > 12) { this.tickOffset = off; this.haveOffset = true; }
    else this.tickOffset += (off - this.tickOffset) * 0.08;
    const v = this.view;
    v.phase = s.phase; v.timeLeft = s.timeLeft; v.tickets = s.tickets; v.objectives = s.objectives;
    if (!s.me) return;
    const me = (this.me = s.me);
    v.health = me.health; v.respawnT = me.respawnT; v.spotted = me.spotted; v.inVehicle = me.vehicle >= 0; v.seat = me.seat;
    if (me.alive && !this.wasAlive) this.onSpawned(me);
    else if (!me.alive && this.wasAlive) this.onDied();
    this.wasAlive = me.alive;
    v.alive = me.alive;
    if (!me.alive) return;

    // --- reconciliation: rewind to the authoritative state and replay unacknowledged commands
    while (this.pending.length > 0 && this.pending[0].seq <= me.ack) this.pending.shift();
    const bx = this.pred.x, by = this.pred.y, bz = this.pred.z;
    copyPlayerState(this.pred, me.state);
    if (me.vehicle < 0) {
      for (const c of this.pending) this.simulate(c, this.replayOut);
      const ex = bx - this.pred.x, ey = by - this.pred.y, ez = bz - this.pred.z;
      const d = Math.hypot(ex, ey, ez);
      if (d > 0.002 && d < 2.5) { this.errX += ex; this.errY += ey; this.errZ += ez; }
    } else this.pending.length = 0;
  }

  private onSpawned(me: OwnerSnap): void {
    this.loadout = this.store.loadout;
    const ctx = this.makeCtx(this.loadout);
    Object.assign(this.ctx, ctx);
    this.view.loadout = this.loadout;
    this.viewmodel.setLoadout(this.ctx);
    this.viewmodel.setVisible(true);
    copyPlayerState(this.pred, me.state);
    this.pending.length = 0;
    this.viewYaw = me.state.yaw; this.viewPitch = 0;
    this.wantSlot = 0; this.crouchToggle = false; this.adsToggle = false; this.stimT = 0;
    this.errX = this.errY = this.errZ = 0;
    this.eyeH = PLAYER.EYE;
    this.deathCamT = 0;
    this.input.enabled = true;
    this.input.clearPressed();
    this.input.requestLock();
    this.ui?.spawned();
    this.audio.play('spawn', { volume: 0.5 });
  }

  private onDied(): void {
    this.viewmodel.setVisible(false);
    this.deathCamT = 0;
    this.deathYaw = this.viewYaw;
    this.pending.length = 0;
    this.ui?.died();
  }

  private simulate(cmd: Cmd, out: WeaponOut): void {
    const s = this.pred;
    const w = activeWeapon(s, this.ctx);
    this.move.speedMul = CLASSES[this.loadout.classId].speedMul * (s.slot < 2 ? w.moveFactor : 1);
    this.move.adsMoveFactor = w.adsMoveFactor;
    this.move.boost = this.stimT > 0 ? 1.08 : 1;
    stepMove(s, cmd, SIM.CMD_DT, this.map.world, this.move, this.vehicleBoxes);
    this.ctx.locked = this.view.phase !== 'live';
    stepWeapon(s, cmd, SIM.CMD_DT, this.ctx, out);
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt: number): void {
    if (!this.active || !this.session) return;
    const v = this.view;
    this.clock += dt;
    this.session.update(dt);
    v.ping = this.session.ping;
    v.fps = this.engine.fps;
    if (this.stimT > 0) this.stimT -= dt;

    const alive = v.alive && this.me !== null;
    this.handleInput(dt, alive);

    // fixed-rate command generation + prediction
    if (alive) {
      this.cmdAcc = Math.min(this.cmdAcc + dt, SIM.CMD_DT * 6);
      while (this.cmdAcc >= SIM.CMD_DT) {
        this.cmdAcc -= SIM.CMD_DT;
        this.stepCommand();
      }
    } else this.cmdAcc = 0;

    this.interpolate(dt);
    this.updateCamera(dt, alive);
    const cam = this.engine.camera.getPosition();

    const scoped = alive && !v.inVehicle && this.pred.slot < 2 && this.pred.ads > 0.93 && activeWeapon(this.pred, this.ctx).scope;
    v.scoped = scoped;
    if (alive && !v.inVehicle) {
      this.viewmodel.lowered = v.phase === 'live' ? 0 : 1;
      this.viewmodel.update(dt, this.pred, this.ctx, this.lookDX, this.lookDY, scoped);
    }
    this.viewmodel.setVisible(alive && !v.inVehicle);

    this.world.update(dt, cam.x, cam.z);
    for (let i = 0; i < v.objectives.length; i++) this.world.setObjectiveOwner(i, v.objectives[i].owner, v.objectives[i].contested, this.clock);
    this.effects.update(dt, cam);
    const fwd = this.engine.camera.forward;
    this.audio.setListener(cam.x, cam.y, cam.z, fwd.x, fwd.y, fwd.z, this.world.isInterior(cam.x, cam.y, cam.z));
    this.audio.update(dt);

    v.state = this.pred; v.yaw = this.viewYaw;
    v.spread = this.pred.slot < 2 ? Math.max(0.2, (activeWeapon(this.pred, this.ctx).hipSpread * (1 - this.pred.ads)) + this.pred.bloom + Math.hypot(this.pred.vx, this.pred.vz) * 0.25 + (this.pred.grounded ? 0 : 2.5)) : 1;
    v.usePrompt = alive ? this.findUsePrompt() : '';
  }

  private handleInput(dt: number, alive: boolean): void {
    const input = this.input, s = this.store.settings;
    input.consumeLook(look);
    if (!alive) { this.lookDX = this.lookDY = 0; return; }
    const w = activeWeapon(this.pred, this.ctx);
    const zoom = this.pred.slot < 2 ? lerp(1, w.zoom, this.pred.ads) : 1;
    const baseSens = (input.touchActive ? 0.0052 * s.touchSensitivity : 0.0022 * s.sensitivity);
    const sens = baseSens * lerp(1, s.adsSensitivity, this.pred.ads) / Math.pow(zoom, 0.82);
    this.lookDX = look.x; this.lookDY = look.y;
    this.viewYaw -= look.x * sens;
    this.viewPitch -= look.y * sens * (s.invertY ? -1 : 1);
    this.viewPitch = clamp(this.viewPitch, -1.5, 1.5);

    if (input.wasPressed('primary')) this.wantSlot = 0;
    if (input.wasPressed('secondary')) this.wantSlot = 1;
    if (input.wasPressed('gadget1')) this.wantSlot = 2;
    if (input.wasPressed('gadget2') && this.ctx.gadgets[1]) this.wantSlot = 3;
    if (input.wheel !== 0) {
      const max = this.ctx.gadgets[1] ? 4 : 3;
      this.wantSlot = (this.wantSlot + (input.wheel > 0 ? 1 : max - 1)) % max;
      input.wheel = 0;
    }
    if (s.toggleCrouch && input.wasPressed('crouch')) this.crouchToggle = !this.crouchToggle;
    if (s.toggleAds && input.wasPressed('ads')) this.adsToggle = !this.adsToggle;
    if (input.wasPressed('sprint')) {
      if (this.clock - this.lastSprintTap < 0.32) this.tacLatch = true;
      this.lastSprintTap = this.clock;
      this.crouchToggle = false;
    }
    if (!input.isHeld('sprint')) this.tacLatch = false;
    void dt;
  }

  private stepCommand(): void {
    const input = this.input, s = this.store.settings;
    input.moveAxes(axes);
    let buttons = 0;
    let fire = input.isHeld('fire');
    if (s.autoFire && input.touchActive && this.autoFireT > 0) fire = true;
    if (fire) buttons |= BTN_FIRE;
    if (s.toggleAds ? this.adsToggle : input.isHeld('ads')) buttons |= BTN_ADS;
    if (input.isHeld('jump')) { buttons |= BTN_JUMP; this.crouchToggle = false; }
    if (s.toggleCrouch ? this.crouchToggle : input.isHeld('crouch')) buttons |= BTN_CROUCH;
    if (input.isHeld('sprint')) { buttons |= BTN_SPRINT; if (s.toggleAds) this.adsToggle = false; }
    if (input.isHeld('tacSprint') || this.tacLatch) buttons |= BTN_SPRINT | BTN_TAC;
    if (input.isHeld('reload')) buttons |= BTN_RELOAD;
    if (input.isHeld('use')) buttons |= BTN_USE;
    if (input.isHeld('grenade')) buttons |= BTN_GRENADE;
    const rt = this.renderTick();
    const cmd: Cmd = { seq: ++this.seq, buttons, mx: axes.x, mz: axes.z, yaw: this.viewYaw, pitch: this.viewPitch, slot: this.wantSlot, viewTick: rt };
    const inVehicle = this.view.inVehicle;
    if (!inVehicle) {
      const wasGround = this.pred.grounded;
      const stats = activeWeapon(this.pred, this.ctx);
      this.simulate(cmd, this.out);
      const out = this.out, p = this.pred;
      if (out.fired) this.onLocalFire(out, stats.index);
      if (out.dry) this.audio.play('dry', { volume: 0.5 });
      if (out.reloadStart) this.audio.reload(stats.index, null);
      if (out.switched) this.audio.play('switch', { volume: 0.45 });
      if (out.gadget && out.gadget !== 'repair') { this.viewmodel.onGadget(); if (out.gadget === 'stim') this.stimT = 3; }
      if (out.grenade) { this.viewmodel.onGadget(); this.audio.play('throw', { volume: 0.6 }); }
      if (p.landSpeed > 2) {
        this.landVel -= Math.min(2.6, p.landSpeed * 0.22);
        this.viewmodel.onLand(p.landSpeed);
        this.audio.footstep(this.surfaceUnder(), null, 1.4);
      } else if (wasGround && !p.grounded && p.vy > 1) this.audio.play('jump', { volume: 0.35 });
      // footsteps
      if (p.grounded && p.slideT <= 0) {
        const sp = Math.hypot(p.vx, p.vz);
        this.stepAcc += sp * SIM.CMD_DT;
        const stride = p.sprinting ? 2.5 : p.crouching ? 1.5 : 2.0;
        if (this.stepAcc >= stride) { this.stepAcc = 0; this.audio.footstep(this.surfaceUnder(), null, p.sprinting ? 1 : p.crouching ? 0.35 : 0.65); }
      }
      this.pending.push(cmd);
      if (this.pending.length > 120) this.pending.shift();
    }
    this.session?.sendCmd(cmd);
  }

  private surfaceUnder(): string {
    const p = this.pred;
    if (this.map.world.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 1.2, F_BULLET, hit)) return MATERIALS[hit.mat]?.surface ?? 'concrete';
    return 'concrete';
  }

  private onLocalFire(out: WeaponOut, weaponIndex: number): void {
    const stats = WEAPONS[weaponIndex] ? activeWeapon(this.pred, this.ctx) : this.ctx.primary;
    const p = this.pred;
    this.viewmodel.onFire(stats, p.ads);
    this.audio.gunshot(weaponIndex, null, stats.suppressed);
    this.shake = Math.min(1, this.shake + 0.035 + stats.recoil.v * 0.02);
    // predicted tracer + impact against the static world
    const d = shotDirection(out.aimYaw, out.aimPitch, out.spread, this.view.myId, out.shotSeq, dirTmp);
    let ox = p.x, oy = p.y + eyeHeight(p), oz = p.z, remaining = stats.maxRange, ex = 0, ey = 0, ez = 0, hitWorld = false;
    for (let i = 0; i < 3; i++) {
      const got = this.map.world.raycast(ox, oy, oz, d.x, d.y, d.z, remaining, F_BULLET | F_GLASS, hit);
      const t = got ? hit.t : remaining;
      ex = ox + d.x * t; ey = oy + d.y * t; ez = oz + d.z * t;
      if (got && (hit.flags & F_GLASS)) { ox = ex + d.x * 0.08; oy = ey + d.y * 0.08; oz = ez + d.z * 0.08; remaining -= t + 0.08; continue; }
      hitWorld = got;
      break;
    }
    const muzzle = this.viewmodel.muzzleWorld(v3a);
    this.effects.tracer(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez, true);
    if (hitWorld && !this.rayHitsAvatar(p.x, p.y + eyeHeight(p), p.z, d.x, d.y, d.z, Math.hypot(ex - p.x, ey - oy, ez - p.z))) {
      this.effects.impact(ex, ey, ez, hit.nx, hit.ny, hit.nz, MATERIALS[hit.mat]?.surface ?? 'concrete', true);
      this.audio.impact(MATERIALS[hit.mat]?.surface ?? 'concrete', ex, ey, ez);
    }
    if (!stats.suppressed) this.effects.flashLight(muzzle.x, muzzle.y, muzzle.z);
    if (stats.cls !== 'sniper') { const ej = this.viewmodel.ejectWorld(v3b); this.effects.shell(ej.x, ej.y, ej.z, this.engine.camera.right, p.y); }
  }

  /** Does a ray pass through an (interpolated) enemy before `maxT`? Used to skip predicted wall impacts. */
  private rayHitsAvatar(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
    for (const p of this.view.players) {
      if (p.id === this.view.myId || !(p.flags & PF_ALIVE)) continue;
      const cx = p.x - ox, cy = p.y + 0.9 - oy, cz = p.z - oz;
      const t = cx * dx + cy * dy + cz * dz;
      if (t < 0 || t > maxT) continue;
      const px = cx - dx * t, py = cy - dy * t, pz = cz - dz * t;
      if (Math.hypot(px, pz) < 0.4 && Math.abs(py) < 0.95) return true;
    }
    return false;
  }

  private renderTick(): number {
    const per = SIM.TICK_RATE / (this.session?.snapshotRate ?? SIM.SNAPSHOT_RATE);
    return this.clock * SIM.TICK_RATE + this.tickOffset - (per * 2 + 0.5);
  }

  // ------------------------------------------------------------------ remote interpolation
  private interpolate(dt: number): void {
    const snaps = this.snaps;
    const v = this.view;
    if (snaps.length === 0) return;
    const rt = this.renderTick();
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tick <= rt) { a = snaps[i]; b = snaps[Math.min(snaps.length - 1, i + 1)]; break; }
    }
    if (rt >= b.tick) a = b;
    const span = b.tick - a.tick;
    const f = span > 0 ? clamp((rt - a.tick) / span, 0, 1) : 0;
    const list = v.players;
    list.length = 0;
    const bMap = new Map<number, PlayerSnap>();
    for (const p of b.players) bMap.set(p.id, p);
    for (const pa of a.players) {
      const pb = bMap.get(pa.id) ?? pa;
      const tele = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 6 || (pa.flags & PF_ALIVE) !== (pb.flags & PF_ALIVE);
      const k = tele ? 1 : f;
      list.push({ id: pa.id, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), z: lerp(pa.z, pb.z, k), yaw: lerpAngle(pa.yaw, pb.yaw, k), pitch: lerp(pa.pitch, pb.pitch, k), flags: k > 0.5 ? pb.flags : pa.flags, health: pb.health, slot: pb.slot });
    }
    // vehicles
    const vb = new Map<number, VehicleSnap>();
    for (const x of b.vehicles) vb.set(x.id, x);
    v.vehicles = a.vehicles.map((va) => {
      const w = vb.get(va.id) ?? va;
      const tele = Math.hypot(w.x - va.x, w.z - va.z) > 8;
      const k = tele ? 1 : f;
      return { ...w, x: lerp(va.x, w.x, k), y: lerp(va.y, w.y, k), z: lerp(va.z, w.z, k), yaw: lerpAngle(va.yaw, w.yaw, k), pitch: lerp(va.pitch, w.pitch, k), speed: lerp(va.speed, w.speed, k), steer: lerp(va.steer, w.steer, k) };
    });
    // vehicles that are parked block movement in prediction exactly like on the server
    this.vehicleBoxes = [];
    for (const veh of b.vehicles) {
      if (!veh.alive || Math.abs(veh.speed) > 1.5) continue;
      const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw);
      for (const o of [-1.35, 0, 1.35]) {
        const cx = veh.x + fx * o, cz = veh.z + fz * o;
        this.vehicleBoxes.push({ minX: cx - 1.0, minY: veh.y + 0.1, minZ: cz - 1.0, maxX: cx + 1.0, maxY: veh.y + VEHICLE.HEIGHT - 0.15, maxZ: cz + 1.0 });
      }
    }
    const firstPerson = v.alive && !v.inVehicle;
    this.avatars.update(dt, list, v.myId, firstPerson, v.myTeam, v.spotted, this.engine.camera.getPosition());
    this.entities.update(dt, v.vehicles, b.projectiles, b.deployables, a.projectiles, f, v.myTeam, this.audio);
  }

  // ------------------------------------------------------------------ camera
  private updateCamera(dt: number, alive: boolean): void {
    const cam = this.engine.camera, s = this.store.settings, p = this.pred;
    const k = Math.exp(-dt * 14);
    this.errX *= k; this.errY *= k; this.errZ *= k;
    this.shake = Math.max(0, this.shake - dt * 1.9);
    for (let left = Math.min(dt, 0.25); left > 1e-5; left -= 1 / 240) { // stable at low frame rates
      const hstep = Math.min(left, 1 / 240);
      this.landVel += (-this.landDip * 140 - this.landVel * 16) * hstep;
      this.landDip += this.landVel * hstep;
    }
    const camC = cam.camera as pc.CameraComponent;
    let targetFov = s.fov;

    if (alive && this.view.inVehicle) {
      const veh = this.view.vehicles.find((x) => x.driver === this.view.myId || x.passenger === this.view.myId);
      if (veh) {
        const yaw = this.viewYaw, pitch = clamp(this.viewPitch, -0.5, 0.6);
        const dist = 7.5, cx = veh.x + Math.sin(yaw) * Math.cos(pitch) * dist, cz = veh.z + Math.cos(yaw) * Math.cos(pitch) * dist;
        let cy = veh.y + 2.6 - Math.sin(pitch) * dist;
        // keep the chase camera out of walls
        const ox = veh.x, oy = veh.y + 2.2, oz = veh.z;
        let dx = cx - ox, dy = cy - oy, dz = cz - oz;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
        let t = len;
        if (this.map.world.raycast(ox, oy, oz, dx, dy, dz, len, F_BULLET, hit)) t = Math.max(1.2, hit.t - 0.3);
        cam.setPosition(ox + dx * t, oy + dy * t, oz + dz * t);
        cy = oy + dy * t;
        cam.setEulerAngles(pitch / DEG, yaw / DEG, 0);
        targetFov = s.fov + 4;
      }
    } else if (alive) {
      const targetEye = eyeHeight(p);
      this.eyeH += clamp(targetEye - this.eyeH, -dt * 5.5, dt * 5.5);
      const speed = Math.hypot(p.vx, p.vz);
      if (p.grounded && speed > 0.5) this.bob += dt * (5 + speed * 1.2);
      const bobK = p.grounded ? clamp(speed / 6, 0, 1.2) * (1 - p.ads * 0.8) : 0;
      const bobY = Math.sin(this.bob * 2) * 0.012 * bobK, bobRoll = Math.sin(this.bob) * 0.22 * bobK;
      const sh = this.shake * this.shake;
      const t = this.clock * 37;
      const shX = Math.sin(t * 1.3) * sh * 0.8, shY = Math.cos(t * 1.7) * sh * 0.8, shR = Math.sin(t * 2.1) * sh * 1.6;
      cam.setPosition(p.x + this.errX, p.y + this.errY + this.eyeH + bobY + this.landDip * 0.05, p.z + this.errZ);
      const slideRoll = p.slideT > 0 ? -3.5 : 0;
      cam.setEulerAngles((this.viewPitch + p.recoilP) / DEG + shX, (this.viewYaw + p.recoilY) / DEG + shY, bobRoll + shR + slideRoll);
      const w = activeWeapon(p, this.ctx);
      const zoom = p.slot < 2 ? w.zoom : 1;
      const adsFov = (2 * Math.atan(Math.tan((s.fov * DEG) / 2) / zoom)) / DEG;
      targetFov = lerp(s.fov + (p.sprinting ? 4 : 0) + (p.slideT > 0 ? 6 : 0), adsFov, p.ads * p.ads * (3 - 2 * p.ads));
    } else {
      // death / spectator camera: slow orbit around the place of death, or an overview during warmup
      this.deathCamT += dt;
      const me = this.view.players.find((x) => x.id === this.view.myId);
      if (me && this.me && !this.me.alive && this.view.phase === 'live' && this.deathCamT < 60 && this.wasAliveOnce) {
        const yaw = this.deathYaw + this.deathCamT * 0.12;
        const dist = Math.min(4.5, 1.5 + this.deathCamT * 2.5);
        let cx = me.x + Math.sin(yaw) * dist, cz = me.z + Math.cos(yaw) * dist;
        const cy = me.y + 2.4;
        if (this.map.world.lineBlocked(me.x, me.y + 1.6, me.z, cx, cy, cz, F_BULLET, hit)) { cx = me.x + (cx - me.x) * 0.3; cz = me.z + (cz - me.z) * 0.3; }
        cam.setPosition(cx, cy, cz);
        cam.lookAt(me.x, me.y + 0.8, me.z);
      } else {
        const a = this.clock * 0.05;
        cam.setPosition(Math.sin(a) * 46, 34, Math.cos(a) * 46);
        cam.lookAt(0, 2, 0);
      }
    }
    if (alive) this.wasAliveOnce = true;
    this.fovNow += (targetFov - this.fovNow) * Math.min(1, dt * 16);
    camC.fov = this.fovNow;
    void v3c;
  }
  private wasAliveOnce = false;

  private findUsePrompt(): string {
    const v = this.view, p = this.pred;
    if (v.inVehicle) return 'EXIT VEHICLE';
    for (const veh of v.vehicles) {
      if (!veh.alive) continue;
      if (Math.hypot(veh.x - p.x, veh.z - p.z) < VEHICLE.ENTER_RANGE && Math.abs(veh.y - p.y) < 2) {
        if (veh.driver >= 0 && veh.passenger >= 0) return '';
        return veh.driver < 0 ? 'DRIVE LTV' : 'RIDE LTV';
      }
    }
    return '';
  }

  // ------------------------------------------------------------------ events
  private name(id: number): { name: string; team: number } {
    const r = this.view.roster.find((x) => x.id === id);
    return r ? { name: r.name, team: r.team } : { name: 'Unknown', team: 0 };
  }

  private onEvent(e: SimEvent): void {
    const v = this.view, my = v.myId, fx = this.effects, audio = this.audio;
    switch (e.t) {
      case 'shot': {
        if (e.id === my && v.alive && !v.inVehicle) break; // already predicted locally
        const m = this.avatars.muzzleWorld(e.id, v3a) ?? v3a.set(e.ox, e.oy - 0.15, e.oz);
        fx.tracer(m.x, m.y, m.z, e.ex, e.ey, e.ez, false);
        this.avatars.fired(e.id);
        if (!e.sup) fx.flashLight(m.x, m.y, m.z);
        audio.gunshot(e.w, m, e.sup);
        if (e.hit !== HIT_NONE && e.hit !== HIT_PLAYER && e.hit !== HIT_GLASS) {
          const surf = MATERIALS[e.mat]?.surface ?? 'concrete';
          fx.impact(e.ex, e.ey, e.ez, e.nx, e.ny, e.nz, surf, true);
          audio.impact(surf, e.ex, e.ey, e.ez);
        }
        // bullet crack when a round passes close to the listener
        const cam = this.engine.camera.getPosition();
        const sx = e.ex - e.ox, sy = e.ey - e.oy, sz = e.ez - e.oz;
        const len2 = sx * sx + sy * sy + sz * sz;
        if (len2 > 16 && e.id !== my) {
          const t = clamp(((cam.x - e.ox) * sx + (cam.y - e.oy) * sy + (cam.z - e.oz) * sz) / len2, 0, 1);
          const dist = Math.hypot(e.ox + sx * t - cam.x, e.oy + sy * t - cam.y, e.oz + sz * t - cam.z);
          if (dist < 2.2 && t > 0.05 && t < 0.98) { audio.play('whiz', { pos: v3b.set(e.ox + sx * t, e.oy + sy * t, e.oz + sz * t), volume: 0.7, pitch: 0.9 + Math.random() * 0.3 }); this.shake = Math.min(1, this.shake + 0.08); }
        }
        break;
      }
      case 'hit':
        fx.blood(e.x, e.y, e.z);
        if (e.by === my) { this.ui?.hitmarker(e.head, e.kill); audio.play(e.kill ? 'killconfirm' : e.head ? 'hithead' : 'hit', { volume: 0.55 }); }
        break;
      case 'hurt':
        if (e.victim === my) {
          this.shake = Math.min(1, this.shake + 0.25 + e.dmg * 0.006);
          const ang = Math.atan2(-e.fx, -e.fz) - this.viewYaw;
          this.ui?.damage(ang, e.dmg);
          audio.play('hurt', { volume: 0.6 });
        }
        break;
      case 'kill': {
        const k = this.name(e.killer), vic = this.name(e.victim);
        this.ui?.killFeed(e.killer >= 0 ? k.name : '', k.team, vic.name, vic.team, GameSim.weaponName(e.w), e.head, e.killer === my || e.victim === my);
        this.avatars.died(e.victim);
        if (e.victim === my) v.deathBy = e.killer >= 0 && e.killer !== my ? `${k.name} — ${GameSim.weaponName(e.w)}` : GameSim.weaponName(e.w);
        const vp = v.players.find((x) => x.id === e.victim);
        if (vp) audio.play('death', { pos: v3a.set(vp.x, vp.y + 1, vp.z), volume: 0.6 });
        break;
      }
      case 'spawn':
        this.avatars.spawned(e.id);
        break;
      case 'explode':
        fx.explosion(e.kind, e.x, e.y, e.z, e.r);
        audio.explosion(e.kind, e.x, e.y, e.z);
        if (e.kind !== 'smoke') {
          const cam = this.engine.camera.getPosition();
          const d = Math.hypot(cam.x - e.x, cam.y - e.y, cam.z - e.z);
          this.shake = Math.min(1.2, this.shake + clamp(1.3 - d / 22, 0, 1));
        }
        break;
      case 'destroy':
        this.world.setDynAlive(e.ref, false);
        fx.destroyed(e.kind, e.x, e.y, e.z);
        audio.play(e.kind === 'glass' ? 'glass' : 'crate', { pos: v3a.set(e.x, e.y, e.z), volume: 0.8 });
        break;
      case 'obj': {
        const def = this.map.objectives[e.idx];
        const mine = e.owner === v.myTeam;
        if (e.kind === 'captured') { this.ui?.notice(mine ? `WE CAPTURED ${def.id} — ${def.name}` : `ENEMY CAPTURED ${def.id} — ${def.name}`, mine ? 'good' : 'bad'); audio.play(mine ? 'objgood' : 'objbad', { volume: 0.6 }); }
        else { const lost = e.prev === v.myTeam; this.ui?.notice(lost ? `WE LOST ${def.id} — ${def.name}` : `${def.id} — ${def.name} NEUTRALIZED`, lost ? 'bad' : 'neutral'); audio.play(lost ? 'objbad' : 'objneutral', { volume: 0.5 }); }
        break;
      }
      case 'gadget': {
        const pl = v.players.find((x) => x.id === e.id);
        const pos = pl ? v3a.set(pl.x, pl.y + 1.3, pl.z) : null;
        if (e.kind === 'rocket') audio.play('rocket', { pos: e.id === my ? undefined : pos ?? undefined, volume: 0.9 });
        else if (e.kind === 'stim') audio.play('stim', { pos: e.id === my ? undefined : pos ?? undefined, volume: 0.5 });
        else if (e.id !== my) audio.play('throw', { pos: pos ?? undefined, volume: 0.5 });
        else if (e.kind === 'ammoCrate' || e.kind === 'medCrate') audio.play('deploy', { volume: 0.6 });
        break;
      }
      case 'reload': {
        if (e.id === my) break;
        const pl = v.players.find((x) => x.id === e.id);
        const r = v.roster.find((x) => x.id === e.id);
        if (pl && r) audio.reload(pl.slot === 1 ? r.secondary : r.primary, v3a.set(pl.x, pl.y + 1.2, pl.z));
        break;
      }
      case 'score':
        if (e.id === my) this.ui?.score(e.amount, e.reason);
        break;
      case 'phase':
        if (e.phase === 'warmup') { this.world.resetDyn(); this.effects.clear(); v.result = null; this.wasAliveOnce = false; }
        this.ui?.phase(e.phase, e.winner);
        audio.play(e.phase === 'live' ? 'matchstart' : e.phase === 'ended' ? (e.winner === v.myTeam ? 'victory' : 'defeat') : 'ui_open', { volume: 0.6 });
        break;
      case 'notice':
        if (e.team === 0 || e.team === v.myTeam) this.ui?.notice(e.text, 'neutral');
        break;
      case 'vehicle': {
        const veh = v.vehicles.find((x) => x.id === e.id);
        if (e.kind === 'destroyed') { if (veh) this.ui?.notice(veh.team === v.myTeam ? 'FRIENDLY VEHICLE DESTROYED' : 'ENEMY VEHICLE DESTROYED', veh.team === v.myTeam ? 'bad' : 'good'); }
        else if (veh && (e.kind === 'enter' || e.kind === 'exit')) audio.play('door', { pos: v3a.set(veh.x, veh.y + 1, veh.z), volume: 0.6 });
        break;
      }
      case 'pickup':
        if (e.id === my) audio.play('pickup', { volume: 0.5 });
        break;
      default:
        break;
    }
  }
}
