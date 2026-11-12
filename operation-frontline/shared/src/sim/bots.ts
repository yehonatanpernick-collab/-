// Bot AI. Bots are ordinary players: every tick the brain produces a Cmd that goes
// through the exact same movement / weapon code as a human's input, so they cannot
// cheat (no aim-through-walls, same recoil, same fire rates, same ammunition).
import { CLASSES, defaultLoadout } from '../classes';
import { TEAM_A, TEAM_B } from '../config';
import { DEG, type Rng, angleDiff, clamp, dirFromAngles, pitchTo, yawTo } from '../math';
import { eyeHeight } from '../movement';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_GRENADE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_TAC, BTN_USE, type Cmd, type Difficulty } from '../types';
import { activeWeapon } from '../weaponLogic';
import { ATTACHMENTS, type Loadout, WEAPON_BY_ID, sanitizeAttachments } from '../weapons';
import { F_SIGHT, makeRayHit } from '../world/World';
import type { GameSim, SimPlayer } from './GameSim';

export interface BotSkill {
  name: string;
  /** Seconds before opening fire on a newly seen enemy. */
  reaction: number;
  /** Aim error in degrees at ~30 m. */
  aimErr: number;
  /** Max turn rate, degrees per second. */
  turn: number;
  /** View distance in metres. */
  view: number;
  /** Damage multiplier against human players (keeps fights survivable; bots are numerous). */
  dmg: number;
  /** Fraction of recoil the bot compensates. */
  recoilComp: number;
  /** Chance per decision to use tactical options (cover, grenades, strafing). */
  tactics: number;
}

export const BOT_SKILLS: BotSkill[] = [
  { name: 'Recruit', reaction: 0.7, aimErr: 3.2, dmg: 0.4, turn: 200, view: 55, recoilComp: 0.25, tactics: 0.25 },
  { name: 'Regular', reaction: 0.45, aimErr: 1.9, dmg: 0.55, turn: 300, view: 75, recoilComp: 0.5, tactics: 0.5 },
  { name: 'Veteran', reaction: 0.3, aimErr: 1.1, dmg: 0.72, turn: 420, view: 95, recoilComp: 0.7, tactics: 0.75 },
  { name: 'Elite', reaction: 0.18, aimErr: 0.6, dmg: 0.92, turn: 560, view: 120, recoilComp: 0.88, tactics: 0.95 },
];

const NAMES = [
  'Raven', 'Kestrel', 'Mako', 'Dagger', 'Bishop', 'Ghost', 'Viking', 'Nomad', 'Jester', 'Rook', 'Falcon', 'Hammer', 'Atlas', 'Cobra',
  'Onyx', 'Sable', 'Tundra', 'Wraith', 'Havoc', 'Breaker', 'Cinder', 'Mirage', 'Talon', 'Vector', 'Ember', 'Granite', 'Lynx', 'Orion',
  'Piston', 'Quill', 'Rhino', 'Saber', 'Torque', 'Umbra', 'Vandal', 'Warden',
];
export const botName = (serial: number): string => `${NAMES[serial % NAMES.length]}${serial >= NAMES.length ? `-${Math.floor(serial / NAMES.length) + 1}` : ''}`;

const CLASS_CYCLE = [0, 0, 1, 2, 0, 3, 2, 1];
export function botLoadout(serial: number, rng: Rng): Loadout {
  const classId = CLASS_CYCLE[serial % CLASS_CYCLE.length];
  const l = defaultLoadout(classId);
  const c = CLASSES[classId];
  l.primary = c.primaries[rng.chance(0.7) ? 0 : 1 % c.primaries.length];
  const def = WEAPON_BY_ID[l.primary];
  const pick = (slot: 'optic' | 'muzzle' | 'grip' | 'mag' | 'barrel'): string => rng.pick(def.allowed[slot].filter((a) => ATTACHMENTS[a].mods.suppressed !== true));
  l.primaryAtt = sanitizeAttachments(def, { optic: def.cls === 'sniper' ? 'scope8' : pick('optic'), muzzle: pick('muzzle'), grip: pick('grip'), mag: pick('mag'), barrel: pick('barrel') });
  return l;
}

type GoalKind = 'objective' | 'overwatch' | 'cover' | 'point';
const hit = makeRayHit();
const v3 = { x: 0, y: 0, z: 0 };

export class BotBrain {
  readonly skill: BotSkill;
  private readonly cmd: Cmd = { seq: 0, buttons: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, slot: 0, viewTick: 0 };
  private readonly rng: Rng;

  // navigation
  private path: number[] = [];
  private pathIdx = 0;
  private repathT = 0;
  private stuckT = 0;
  private stuckCount = 0;
  private lastX = 0; private lastZ = 0;
  private jumpT = 0;
  private mvX = 0; private mvZ = 0;
  private glanceT = 2; private glanceYaw = 0; private glanceHold = 0;

  // goal
  private goalKind: GoalKind = 'objective';
  goalObj = -1;
  private goalX = 0; private goalY = 0; private goalZ = 0;
  private goalT = 0;
  private holdT = 0;
  private arrived = false;
  private overwatchIdx = -1;

  // target
  private target: SimPlayer | null = null;
  private visible = false;
  private seenT = 0;
  private lostT = 0;
  private lkX = 0; private lkY = 0; private lkZ = 0;
  private senseT = 0;
  private alertYaw: number | null = null;

  // aim
  private aimYaw = 0; private aimPitch = 0;
  private errYaw = 0; private errPitch = 0;
  private errGoalYaw = 0; private errGoalPitch = 0;
  private errT = 0;
  private scanT = 0; private scanYaw = 0;

  // tactics
  private strafeDir = 1; private strafeT = 0;
  private burstLeft = 0; private burstPause = 0; private tapT = 0;
  private crouchT = 0;
  private coverT = 0;
  private gadgetT = 2;
  private grenadeT = 4;
  private action: { slot: number; t: number; fired: boolean; yaw: number | null; pitch: number; hold: number } | null = null;
  private grenadeAim: { yaw: number; pitch: number; t: number } | null = null;

  constructor(private readonly sim: GameSim, private readonly me: SimPlayer, difficulty: Difficulty) {
    this.skill = BOT_SKILLS[clamp(difficulty, 0, 3)];
    this.rng = sim.rng;
    this.senseT = this.rng.next() * 0.25;
  }

  // ------------------------------------------------------------------ events from the simulation
  onSpawn(): void {
    const s = this.me.s;
    this.aimYaw = s.yaw; this.aimPitch = 0;
    this.path.length = 0; this.pathIdx = 0;
    this.target = null; this.visible = false; this.seenT = 0; this.lostT = 0;
    this.goalT = 0; this.arrived = false; this.holdT = 0; this.coverT = 0;
    this.action = null; this.grenadeAim = null; this.alertYaw = null;
    this.stuckT = 0; this.stuckCount = 0; this.lastX = s.x; this.lastZ = s.z;
    this.burstLeft = 0; this.burstPause = 0.2;
    this.gadgetT = 2 + this.rng.next() * 3;
  }

  onHurt(attacker: SimPlayer | null): void {
    if (!attacker || attacker === this.me || attacker.team === this.me.team) return;
    if (!this.target || !this.visible) {
      this.target = attacker;
      this.lkX = attacker.s.x; this.lkY = attacker.s.y; this.lkZ = attacker.s.z;
      this.lostT = 0;
      this.alertYaw = yawTo(attacker.s.x - this.me.s.x, attacker.s.z - this.me.s.z);
      this.senseT = Math.min(this.senseT, 0.1);
    }
    if (this.me.health < 45 && this.coverT <= 0 && this.rng.chance(this.skill.tactics)) this.seekCover(attacker);
  }

  onKill(victim: SimPlayer): void {
    if (this.target === victim) { this.target = null; this.visible = false; }
  }

  chooseSpawn(): number {
    const sim = this.sim, team = this.me.team;
    const owned: number[] = [];
    for (let i = 0; i < sim.objectives.length; i++) if (sim.objectives[i].owner === team && !sim.objectives[i].contested) owned.push(i);
    if (owned.length === 0 || this.rng.chance(0.3)) return -1;
    return this.rng.pick(owned);
  }

  // ------------------------------------------------------------------ perception
  private canSee(o: SimPlayer): boolean {
    const sim = this.sim, s = this.me.s;
    const ex = s.x, ey = s.y + eyeHeight(s), ez = s.z;
    const tx = o.s.x, tz = o.s.z, ty = o.s.y + (o.s.crouching ? 0.7 : 1.15);
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const d = Math.hypot(dx, dy, dz);
    const view = this.skill.view * (this.me.cls.id === 'recon' ? 1.5 : 1);
    if (d > view) return false;
    if (d > 6) {
      const f = dirFromAngles(this.aimYaw, this.aimPitch, v3);
      if ((dx * f.x + dy * f.y + dz * f.z) / d < 0.2) return false;
    }
    if (sim.ents.smokeBlocks(ex, ey, ez, tx, ty, tz)) return false;
    if (!sim.world.lineBlocked(ex, ey, ez, tx, ty, tz, F_SIGHT, hit)) return true;
    return !sim.world.lineBlocked(ex, ey, ez, tx, o.s.y + (o.s.crouching ? 1.0 : 1.6), tz, F_SIGHT, hit);
  }

  private sense(): void {
    const sim = this.sim, me = this.me;
    let best: SimPlayer | null = null, bestScore = Infinity;
    for (const o of sim.players) {
      if (!o.alive || o.team === me.team) continue;
      const d = Math.hypot(o.s.x - me.s.x, o.s.y - me.s.y, o.s.z - me.s.z);
      if (this.canSee(o)) {
        let score = d;
        if (o === this.target) score *= 0.65;
        if (o.vehicle >= 0) score *= 1.3;
        if (score < bestScore) { bestScore = score; best = o; }
      } else if (!this.target && o.firedT < 0.4 && d < activeWeapon(o.s, o.ctx).loudness * 0.6) {
        // heard gunfire: turn towards it
        this.alertYaw = yawTo(o.s.x - me.s.x, o.s.z - me.s.z);
      }
    }
    if (best) {
      if (best !== this.target || !this.visible) this.seenT = best === this.target ? this.seenT * 0.5 : 0;
      this.target = best; this.visible = true; this.lostT = 0;
      this.lkX = best.s.x; this.lkY = best.s.y; this.lkZ = best.s.z;
    } else {
      this.visible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  // ------------------------------------------------------------------ goals
  private chooseGoal(): void {
    const sim = this.sim, me = this.me, rng = this.rng;
    const other = me.team === TEAM_A ? TEAM_B : TEAM_A;
    const role = me.cls.id;
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < sim.objectives.length; i++) {
      const st = sim.objectives[i], def = sim.map.objectives[i];
      const d = Math.hypot(def.x - me.s.x, def.z - me.s.z);
      let friends = 0;
      for (const p of sim.players) if (p !== me && p.team === me.team && p.brain && p.brain.goalObj === i) friends++;
      const enemyHere = (st.presence & (other === TEAM_A ? 1 : 2)) !== 0;
      let score: number;
      if (st.owner !== me.team) score = 100 - d * 0.42 - friends * 13 + (st.owner === 0 ? 10 : 0);
      else if (enemyHere || st.contested) score = 112 - d * 0.5 - friends * 8;
      else score = 30 - d * 0.2 - friends * 24 + (role === 'recon' || role === 'support' ? 16 : 0);
      if (i === this.goalObj) score += 10;
      score += rng.range(-12, 12);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    this.goalObj = best;
    const def = sim.map.objectives[best];
    this.goalT = rng.range(5, 9);
    this.arrived = false;
    this.overwatchIdx = -1;
    if (role === 'recon' && rng.chance(0.75)) {
      // pick an overwatch position covering the objective
      let ow = -1, owScore = Infinity;
      const list = sim.map.overwatch;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const dObj = Math.hypot(o.x - def.x, o.z - def.z);
        if (dObj > 75 || dObj < 12) continue;
        if (sim.players.some((p) => p !== me && p.brain && p.brain.overwatchIdx === i)) continue;
        const sc = Math.hypot(o.x - me.s.x, o.z - me.s.z) * 0.6 + dObj * 0.4 + rng.range(0, 25);
        if (sc < owScore) { owScore = sc; ow = i; }
      }
      if (ow >= 0) {
        const o = list[ow];
        this.overwatchIdx = ow;
        this.goalT = rng.range(28, 45);
        this.setGoal('overwatch', o.x, o.y, o.z);
        return;
      }
    }
    const n = sim.nav.randomNear(def.x, def.y, def.z, def.radius * 0.75, rng, 4);
    if (n >= 0) this.setGoal('objective', sim.nav.nodeX[n], sim.nav.nodeY[n], sim.nav.nodeZ[n]);
    else this.setGoal('objective', def.x, def.y, def.z);
  }

  private setGoal(kind: GoalKind, x: number, y: number, z: number): boolean {
    this.goalKind = kind; this.goalX = x; this.goalY = y; this.goalZ = z;
    this.arrived = false;
    return this.pathTo(x, y, z);
  }

  private pathTo(x: number, y: number, z: number): boolean {
    const nav = this.sim.nav, s = this.me.s;
    const from = nav.nearest(s.x, s.y, s.z, 3), to = nav.nearest(x, y, z, 4);
    this.repathT = 1.2 + this.rng.next();
    this.pathIdx = 0;
    if (from < 0 || to < 0 || !nav.findPath(from, to, this.path)) { this.path.length = 0; return false; }
    if (this.path.length > 1) this.pathIdx = 1;
    return true;
  }

  private seekCover(from: SimPlayer): void {
    const sim = this.sim, nav = sim.nav, s = this.me.s;
    const ex = from.s.x, ey = from.s.y + 1.5, ez = from.s.z;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < 14; i++) {
      const n = nav.randomNear(s.x, s.y, s.z, 9, this.rng, 1.5);
      if (n < 0) continue;
      const nx = nav.nodeX[n], ny = nav.nodeY[n], nz = nav.nodeZ[n];
      if (!sim.world.lineBlocked(nx, ny + 1.0, nz, ex, ey, ez, F_SIGHT, hit)) continue;
      const d = Math.hypot(nx - s.x, nz - s.z);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best >= 0 && this.setGoal('cover', nav.nodeX[best], nav.nodeY[best], nav.nodeZ[best])) {
      this.coverT = 5;
      this.holdT = this.rng.range(1.8, 3.5);
      this.goalT = Math.max(this.goalT, 6);
    }
  }

  // ------------------------------------------------------------------ main think
  think(dt: number): Cmd {
    const sim = this.sim, me = this.me, s = me.s, rng = this.rng, cmd = this.cmd;
    cmd.seq++;
    cmd.viewTick = sim.tick;
    let buttons = 0;
    let moveX = 0, moveZ = 0;       // desired world-space move direction
    let wantYaw = this.aimYaw, wantPitch = 0;
    let slot = 0;
    const w = activeWeapon(s, me.ctx);

    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = 0.16 + rng.next() * 0.1; this.sense(); }
    if (this.target && !this.target.alive) { this.target = null; this.visible = false; }
    if (this.visible) this.seenT += dt; else if (this.target) { this.lostT += dt; if (this.lostT > 6) this.target = null; }
    this.goalT -= dt; this.repathT -= dt; this.coverT -= dt; this.gadgetT -= dt; this.grenadeT -= dt;
    if (this.strafeT > 0) this.strafeT -= dt;
    if (this.crouchT > 0) this.crouchT -= dt;
    if (this.jumpT > 0) this.jumpT -= dt;

    if (me.vehicle >= 0) { // bots never drive; hop out if they somehow sit in one
      cmd.buttons = BTN_USE; cmd.mx = 0; cmd.mz = 0; cmd.yaw = this.aimYaw; cmd.pitch = 0; cmd.slot = 0;
      return cmd;
    }

    if (this.goalT <= 0 || (this.path.length === 0 && !this.arrived && this.repathT <= 0)) {
      if (this.goalKind !== 'cover' || this.goalT <= 0) this.chooseGoal();
    }

    // --------------------------------------------------------------- travel along the path
    const nav = sim.nav;
    let travelling = false;
    if (this.path.length > 0 && this.pathIdx < this.path.length) {
      let n = this.path[this.pathIdx];
      // skip ahead when the following node is directly reachable
      if (this.pathIdx + 1 < this.path.length) {
        const n2 = this.path[this.pathIdx + 1];
        if (Math.abs(nav.nodeY[n2] - s.y) < 0.6 && nav.traversable(s.x, s.y, s.z, nav.nodeX[n2], nav.nodeY[n2], nav.nodeZ[n2])) { this.pathIdx++; n = n2; }
      }
      const dx = nav.nodeX[n] - s.x, dz = nav.nodeZ[n] - s.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45 && Math.abs(nav.nodeY[n] - s.y) < 1.3) {
        this.pathIdx++;
      }
      if (d > 0.05) { moveX = dx / d; moveZ = dz / d; travelling = true; }
      // look a few nodes ahead
      const la = this.path[Math.min(this.path.length - 1, this.pathIdx + 3)];
      const lx = nav.nodeX[la] - s.x, lz = nav.nodeZ[la] - s.z;
      if (Math.hypot(lx, lz) > 0.8) { wantYaw = yawTo(lx, lz); wantPitch = clamp(pitchTo(lx, nav.nodeY[la] - s.y, lz) * 0.5, -0.4, 0.4); }
    } else if (!this.arrived) {
      this.arrived = Math.hypot(this.goalX - s.x, this.goalZ - s.z) < 2.5;
      if (this.arrived) this.holdT = this.goalKind === 'overwatch' ? 999 : this.goalKind === 'cover' ? this.holdT : rng.range(0.3, 1.1);
      else if (this.repathT <= 0) this.pathTo(this.goalX, this.goalY, this.goalZ);
    }

    // arrived: hold, scan, then patrol inside the objective
    if (this.arrived) {
      this.holdT -= dt;
      this.scanT -= dt;
      if (this.scanT <= 0) {
        this.scanT = rng.range(1.2, 2.8);
        const def = sim.map.objectives[Math.max(0, this.goalObj)];
        const base = this.goalKind === 'overwatch' ? yawTo(def.x - s.x, def.z - s.z) : this.threatYaw();
        this.scanYaw = base + rng.range(-0.9, 0.9) * (this.goalKind === 'overwatch' ? 0.5 : 1);
      }
      wantYaw = this.scanYaw;
      if (this.goalKind === 'overwatch' || this.goalKind === 'cover') buttons |= BTN_CROUCH;
      if (this.holdT <= 0 && this.goalKind !== 'overwatch') {
        if (this.goalKind === 'cover') this.goalT = 0;
        else {
          const def = sim.map.objectives[Math.max(0, this.goalObj)];
          const n = nav.randomNear(def.x, def.y, def.z, def.radius * 0.8, rng, 4);
          if (n >= 0) this.setGoal('objective', nav.nodeX[n], nav.nodeY[n], nav.nodeZ[n]);
        }
      }
    }

    // --------------------------------------------------------------- alerts
    if (this.alertYaw !== null && !this.visible) {
      wantYaw = this.alertYaw;
      if (Math.abs(angleDiff(this.aimYaw, this.alertYaw)) < 0.15) this.alertYaw = null;
    }

    // --------------------------------------------------------------- combat
    const t = this.target;
    let firing = false;
    if (t && this.visible) {
      const tx = t.s.x, tz = t.s.z;
      const aimHead = this.me.cls.id === 'recon' || this.skill.aimErr < 1.2;
      const ty = t.s.y + (t.s.crouching ? (aimHead ? 1.0 : 0.65) : (aimHead ? 1.56 : 1.15));
      const ex = s.x, ey = s.y + eyeHeight(s), ez = s.z;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      const d = Math.hypot(dx, dy, dz);
      // aim error wander
      this.errT -= dt;
      if (this.errT <= 0) {
        this.errT = rng.range(0.18, 0.4);
        const settle = clamp(1.8 - this.seenT * 1.2, 0.6, 1.8);
        const moving = Math.hypot(t.s.vx, t.s.vz) > 2 ? 1.35 : 1;
        let mag = this.skill.aimErr * DEG * (0.3 + d / 100) * Math.min(1.5, settle) * moving * (s.ads > 0.5 ? 0.75 : 1.0);
        // a scoped, settled marksman holds a much steadier aim
        if (w.cls === 'sniper' && s.ads > 0.9) mag *= this.seenT > 0.9 ? 0.22 : 0.5;
        this.errGoalYaw = rng.range(-mag, mag); this.errGoalPitch = rng.range(-mag, mag) * 0.7;
      }
      this.errYaw += (this.errGoalYaw - this.errYaw) * Math.min(1, dt * 7);
      this.errPitch += (this.errGoalPitch - this.errPitch) * Math.min(1, dt * 7);
      const trueYaw = yawTo(dx, dz), truePitch = pitchTo(dx, dy, dz);
      wantYaw = trueYaw + this.errYaw - s.recoilY * this.skill.recoilComp;
      wantPitch = truePitch + this.errPitch - s.recoilP * this.skill.recoilComp;
      if (d > 8 || w.cls === 'sniper') buttons |= BTN_ADS;

      // fire control
      const offYaw = Math.abs(angleDiff(this.aimYaw + s.recoilY, trueYaw));
      const offPitch = Math.abs(this.aimPitch + s.recoilP - truePitch);
      const tol = w.cls === 'sniper'
        ? Math.max(0.35 * DEG, Math.atan2(0.2, d)) + this.skill.aimErr * DEG * 0.1
        : Math.max(1.3 * DEG, Math.atan2(0.42, d)) * 1.6 + this.skill.aimErr * DEG * 0.5;
      const ready = this.seenT >= this.skill.reaction * (0.7 + d / 90) && s.switchT <= 0 && s.reloadT <= 0;
      const scopedIn = w.cls !== 'sniper' || s.ads > 0.92 || d < 9;
      const inRange = w.cls === 'sniper' || d <= w.rangeEnd * 1.1; // do not waste ammunition far outside effective range
      if (ready && scopedIn && inRange && offYaw < tol && offPitch < tol * 1.2) {
        if (w.auto) {
          if (this.burstPause > 0) this.burstPause -= dt;
          else {
            if (this.burstLeft <= 0) {
              const close = d < 14;
              const base = w.cls === 'lmg' ? rng.int(8, 18) : w.cls === 'smg' ? rng.int(6, 12) : rng.int(4, 8);
              this.burstLeft = (close ? base * 2 : d > 45 ? Math.max(2, base >> 1) : base) * w.fireInterval;
            }
            firing = true;
            this.burstLeft -= dt;
            if (this.burstLeft <= 0) this.burstPause = rng.range(0.1, 0.4) * (0.5 + d / 35) * (1.6 - this.skill.tactics);
          }
        } else {
          this.tapT -= dt;
          if (this.tapT <= 0 && s.fireCd <= 0) {
            firing = true;
            this.tapT = w.fireInterval + rng.range(0.06, 0.28) * (1.5 - this.skill.tactics * 0.6) + (w.cls === 'sniper' ? 0.25 : 0);
          }
        }
      }
      if (firing) buttons |= BTN_FIRE;

      // movement in combat
      const [rMin, rMax] = me.cls.botRange;
      const maxR = w.cls === 'sniper' ? rMax : Math.min(rMax, w.rangeEnd * 0.9);
      const flat = Math.hypot(dx, dz) || 1;
      const toX = dx / flat, toZ = dz / flat;
      if (this.goalKind === 'cover' && !this.arrived && this.coverT > 0) {
        // keep running to cover (path following already set move)
      } else if (this.goalKind === 'overwatch' && this.arrived) {
        moveX = 0; moveZ = 0; travelling = false; buttons |= BTN_CROUCH;
      } else if (d > maxR && w.cls !== 'sniper') {
        if (this.repathT <= 0 || this.path.length === 0) this.pathTo(tx, t.s.y, tz);
      } else {
        travelling = false;
        if (this.strafeT <= 0) {
          this.strafeT = rng.range(0.5, 1.4);
          this.strafeDir = rng.chance(0.5) ? 1 : -1;
          if (rng.chance(1 - this.skill.tactics * 0.8)) this.strafeDir = 0;
          if (d > 16 && rng.chance(w.cls === 'lmg' ? 0.6 : 0.25)) this.crouchT = rng.range(1, 2.5);
        }
        // push forward while firing unless the weapon wants distance; retreat when too close
        const adv = d > rMin + 6 && w.cls !== 'sniper' && w.cls !== 'lmg' && this.crouchT <= 0 ? 0.55 : 0;
        const back = d < rMin ? -1 : 0;
        moveX = -toZ * this.strafeDir + toX * back * 0.9 + toX * adv;
        moveZ = toX * this.strafeDir + toZ * back * 0.9 + toZ * adv;
        if (this.crouchT > 0) { buttons |= BTN_CROUCH; if (w.cls === 'lmg' || w.cls === 'sniper') { moveX = 0; moveZ = 0; } }
        // do not strafe off ledges / into walls: validate the step on the nav grid
        if ((moveX !== 0 || moveZ !== 0) && !nav.traversable(s.x, s.y, s.z, s.x + moveX * 0.9, s.y, s.z + moveZ * 0.9)) {
          this.strafeDir = -this.strafeDir; moveX = 0; moveZ = 0;
        }
      }
      // sidearm when the primary is dry up close
      if (s.ammo0 === 0 && (s.reserve0 === 0 || d < 14) && (s.ammo1 > 0 || s.reserve1 > 0)) slot = 1;
      // rockets against vehicles
      if (t.vehicle >= 0 && me.cls.id === 'engineer' && s.gadget0 > 0 && s.gadgetCd0 <= 0 && d > 10 && !this.action) {
        this.action = { slot: 2, t: 0, fired: false, yaw: null, pitch: 0, hold: 0 };
      }
    } else if (t) {
      // lost sight: push to the last known position or throw a grenade
      const d = Math.hypot(this.lkX - s.x, this.lkZ - s.z);
      if (this.grenadeT <= 0 && this.lostT > 0.5 && this.lostT < 3 && d > 8 && d < 30 && s.grenades > 0 && !this.grenadeAim && rng.chance(this.skill.tactics * 0.5)) {
        const aim = this.ballistic(this.lkX - s.x, this.lkY - (s.y + 1.5), this.lkZ - s.z, 17, 15);
        if (aim !== null) this.grenadeAim = { yaw: yawTo(this.lkX - s.x, this.lkZ - s.z), pitch: aim - 7 * DEG, t: 0.45 };
        this.grenadeT = rng.range(6, 14);
      }
      if (this.goalKind !== 'cover' && this.goalKind !== 'overwatch' && this.lostT < 4 && (me.cls.id === 'assault' || me.cls.id === 'engineer') && this.repathT <= 0) {
        this.pathTo(this.lkX, this.lkY, this.lkZ);
      }
      if (!travelling) wantYaw = yawTo(this.lkX - s.x, this.lkZ - s.z);
    }

    // --------------------------------------------------------------- grenade throw in progress
    if (this.grenadeAim) {
      wantYaw = this.grenadeAim.yaw; wantPitch = this.grenadeAim.pitch;
      this.grenadeAim.t -= dt;
      if (this.grenadeAim.t <= 0) {
        if (Math.abs(angleDiff(this.aimYaw, wantYaw)) < 0.12) buttons |= BTN_GRENADE;
        this.grenadeAim = null;
      }
    }

    // --------------------------------------------------------------- gadgets
    if (this.gadgetT <= 0 && !this.action) { this.gadgetT = rng.range(1.5, 3); this.considerGadget(); }
    if (this.action) {
      const a = this.action;
      slot = a.slot;
      a.t += dt;
      buttons &= ~BTN_FIRE;
      if (a.yaw !== null) { wantYaw = a.yaw; wantPitch = a.pitch; }
      if (!a.fired && s.slot === a.slot && s.switchT <= 0 && a.t > 0.25) {
        if (a.yaw === null || Math.abs(angleDiff(this.aimYaw, wantYaw)) < 0.1) { buttons |= BTN_FIRE; a.fired = true; a.t = 0; }
      } else if (a.fired) {
        if (a.t < a.hold) buttons |= BTN_FIRE;
        else if (a.t > a.hold + 0.2) this.action = null;
      }
      if (this.action && !a.fired && a.t > 3) this.action = null;
    }

    // --------------------------------------------------------------- reload when safe
    if (!this.visible && s.slot === 0 && s.reloadT <= 0 && s.ammo0 < me.ctx.primary.magSize * 0.45 && s.reserve0 > 0) buttons |= BTN_RELOAD;
    if (s.slot === 1 && slot === 1 && s.ammo1 === 0 && s.reserve1 === 0) slot = 0;

    // --------------------------------------------------------------- stuck handling
    this.stuckT += dt;
    if (this.stuckT >= 0.5) {
      const moved = Math.hypot(s.x - this.lastX, s.z - this.lastZ);
      this.lastX = s.x; this.lastZ = s.z; this.stuckT = 0;
      if (travelling && moved < 0.2) {
        this.stuckCount++;
        this.jumpT = 0.12;
        if (this.stuckCount === 3) this.pathTo(this.goalX, this.goalY, this.goalZ);
        else if (this.stuckCount >= 6) { this.stuckCount = 0; this.goalT = 0; this.path.length = 0; }
      } else this.stuckCount = 0;
    }
    if (this.jumpT > 0) buttons |= BTN_JUMP;

    // --------------------------------------------------------------- natural movement: steer smoothly, keep apart from teammates
    if (moveX !== 0 || moveZ !== 0) {
      for (const o of sim.players) {
        if (o === me || !o.alive || o.team !== me.team || Math.abs(o.s.y - s.y) > 1.5) continue;
        const dx = s.x - o.s.x, dz = s.z - o.s.z, d2 = dx * dx + dz * dz;
        if (d2 < 2.8 && d2 > 1e-4) { const d = Math.sqrt(d2), push = (1.7 - d) * 0.9; moveX += (dx / d) * push; moveZ += (dz / d) * push; }
      }
      const ml = Math.hypot(moveX, moveZ);
      if (ml > 1) { moveX /= ml; moveZ /= ml; }
    }
    const steer = Math.min(1, dt * (this.visible ? 9 : 6));
    this.mvX += (moveX - this.mvX) * steer; this.mvZ += (moveZ - this.mvZ) * steer;
    moveX = Math.abs(this.mvX) < 0.03 ? 0 : this.mvX; moveZ = Math.abs(this.mvZ) < 0.03 ? 0 : this.mvZ;
    // glance around now and then while travelling without a target
    if (!this.visible && !this.target && travelling) {
      this.glanceT -= dt;
      if (this.glanceT <= 0 && this.glanceHold <= 0) { this.glanceHold = rng.range(0.5, 1.1); this.glanceYaw = rng.range(-0.8, 0.8); this.glanceT = rng.range(2.5, 5); }
      if (this.glanceHold > 0) { this.glanceHold -= dt; wantYaw += this.glanceYaw; wantPitch *= 0.5; }
    }

    // --------------------------------------------------------------- aim smoothing
    const maxTurn = this.skill.turn * DEG * dt * (this.visible ? 1 : 0.7);
    // eased: fast when far from the target, gentle when close (reads as a hand settling onto the target)
    const ease = Math.min(1, dt * (this.visible ? 14 : 8));
    this.aimYaw += clamp(angleDiff(this.aimYaw, wantYaw) * ease, -maxTurn, maxTurn);
    this.aimPitch += clamp((wantPitch - this.aimPitch) * ease, -maxTurn, maxTurn);
    this.aimPitch = clamp(this.aimPitch, -1.4, 1.4);

    // --------------------------------------------------------------- convert to command axes
    const sy = Math.sin(this.aimYaw), cy = Math.cos(this.aimYaw);
    const fwd = moveX * -sy + moveZ * -cy;
    const right = moveX * cy + moveZ * -sy;
    cmd.mz = clamp(fwd, -1, 1);
    cmd.mx = clamp(right, -1, 1);
    if (travelling && !this.visible && !(buttons & BTN_CROUCH) && fwd > 0.8 && this.path.length - this.pathIdx > 5 && s.reloadT <= 0) {
      buttons |= BTN_SPRINT;
      if (!this.target && this.path.length - this.pathIdx > 25) buttons |= BTN_TAC;
    }
    cmd.buttons = buttons;
    cmd.yaw = this.aimYaw;
    cmd.pitch = this.aimPitch;
    cmd.slot = slot;
    return cmd;
  }

  /** Direction the nearest enemy-held (or contested) objective lies in. */
  private threatYaw(): number {
    const sim = this.sim, s = this.me.s;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < sim.objectives.length; i++) {
      if (sim.objectives[i].owner === this.me.team && !sim.objectives[i].contested) continue;
      const def = sim.map.objectives[i];
      const d = Math.hypot(def.x - s.x, def.z - s.z);
      if (d > 3 && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) {
      const eb = sim.map.bases.find((b) => b.team !== this.me.team);
      return eb ? yawTo(eb.x - s.x, eb.z - s.z) : this.aimYaw;
    }
    const def = sim.map.objectives[best];
    return yawTo(def.x - s.x, def.z - s.z);
  }

  /** Low-arc launch pitch to hit a point (dx, dy, dz away) with speed v and gravity g, or null. */
  private ballistic(dx: number, dy: number, dz: number, v: number, g: number): number | null {
    const d = Math.hypot(dx, dz);
    const disc = v * v * v * v - g * (g * d * d + 2 * dy * v * v);
    if (disc < 0 || d < 0.5) return null;
    return Math.atan2(v * v - Math.sqrt(disc), g * d);
  }

  private considerGadget(): void {
    const sim = this.sim, me = this.me, s = me.s, rng = this.rng;
    const role = me.cls.id;
    const use = (slot: number, yaw: number | null = null, pitch = 0, hold = 0): void => { this.action = { slot, t: 0, fired: false, yaw, pitch, hold }; };
    const ready = (i: 0 | 1): boolean => (i === 0 ? s.gadget0 !== 0 && s.gadgetCd0 <= 0 : s.gadget1 !== 0 && s.gadgetCd1 <= 0);
    if (role === 'assault') {
      if (me.health < 50 && me.stimT <= 0 && !this.visible && ready(0)) { use(2); return; }
      const def = sim.map.objectives[Math.max(0, this.goalObj)];
      const st = sim.objectives[Math.max(0, this.goalObj)];
      const d = Math.hypot(def.x - s.x, def.z - s.z);
      if (ready(1) && st.owner !== me.team && d > 12 && d < 30 && !this.visible && rng.chance(0.12 * this.skill.tactics)) {
        const pitch = this.ballistic(def.x - s.x, def.y - (s.y + 1.5), def.z - s.z, 15, 15);
        if (pitch !== null) use(3, yawTo(def.x - s.x, def.z - s.z), pitch - 7 * DEG);
      }
    } else if (role === 'support') {
      let hurt = me.health < 60, low = s.reserve0 < me.ctx.primary.magSize, mates = 0;
      for (const p of sim.players) {
        if (p === me || !p.alive || p.team !== me.team || Math.hypot(p.s.x - s.x, p.s.z - s.z) > 7) continue;
        mates++;
        if (p.health < 60) hurt = true;
        if (p.s.reserve0 < p.ctx.primary.magSize * 2) low = true;
      }
      if (ready(1) && hurt && !this.visible) { use(3); return; }
      if (ready(0) && (low || (mates > 0 && rng.chance(0.2))) && !this.visible) use(2);
    } else if (role === 'recon') {
      if (ready(0) && this.arrived && !this.visible && rng.chance(0.5)) {
        const def = sim.map.objectives[Math.max(0, this.goalObj)];
        const pitch = this.ballistic(def.x - s.x, def.y + 1 - (s.y + 1.5), def.z - s.z, 15, 15);
        if (pitch !== null) use(2, yawTo(def.x - s.x, def.z - s.z), pitch - 7 * DEG);
      }
    } else if (role === 'engineer') {
      // repair a damaged friendly vehicle close by
      for (const v of sim.ents.vehicles) {
        if (!v.alive || v.team !== me.team || v.health > 420) continue;
        const d = Math.hypot(v.x - s.x, v.z - s.z);
        if (d < 4 && !this.visible) { use(3, yawTo(v.x - s.x, v.z - s.z), -0.2, 2.5); break; }
      }
    }
  }
}
