// World entities owned by the simulation: vehicles, projectiles, deployables,
// destructible map props and explosions.
import { GADGETS, type GadgetKind } from '../classes';
import { PLAYER, SCORE, SIM, TEAM_NONE, type TeamId } from '../config';
import { DEG, approach, clamp, dirFromAngles, type Vec3 } from '../math';
import type { DynBox } from '../movement';
import {
  DEPLOYABLE_KINDS, type DeployableKind, type DeployableSnap, PROJECTILE_KINDS, type PlayerState, type ProjectileKind,
  type ProjectileSnap, type VehicleSnap,
} from '../types';
import type { WeaponOut } from '../weaponLogic';
import type { SpawnPoint } from '../world/MapBuilder';
import { F_BULLET, F_GLASS, F_SIGHT, F_SOLID, type RayHit, makeRayHit } from '../world/World';
import type { GameSim, SimPlayer } from './GameSim';

export const VEHICLE = {
  MAX_HEALTH: 600,
  HALF_LEN: 2.35,
  HALF_WIDTH: 1.05,
  HEIGHT: 1.9,
  MAX_SPEED: 16,
  REVERSE_SPEED: 6,
  ACCEL: 8,
  BRAKE: 16,
  DRAG: 2.2,
  WHEELBASE: 2.9,
  MAX_STEER: 0.6,
  RESPAWN: 40,
  ENTER_RANGE: 3.6,
  SEAT_Y: 0.85,
} as const;

export interface Vehicle {
  id: number;
  team: TeamId;
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  speed: number; steer: number;
  health: number;
  alive: boolean;
  driver: number;
  passenger: number;
  respawnT: number;
  spawn: SpawnPoint;
  throttle: number; steerIn: number; brake: boolean;
  idleT: number;
}

export interface Projectile {
  id: number; kind: ProjectileKind; owner: number; team: TeamId;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  fuse: number; rest: boolean;
}

export interface Deployable {
  id: number; kind: DeployableKind; owner: number; team: TeamId;
  x: number; y: number; z: number; life: number; age: number; pulseT: number; pulses: number; acc: number;
  seen: Set<number>;
}

const EXPLOSIONS = {
  frag: { r: 7.5, dmg: 130, veh: 140, w: -1 },
  rocket: { r: 5.5, dmg: 120, veh: 160, w: -2 },
  barrel: { r: 6.5, dmg: 115, veh: 180, w: -3 },
  vehicle: { r: 7, dmg: 150, veh: 0, w: -5 },
} as const;
export type ExplosionKind = keyof typeof EXPLOSIONS;

const SMOKE_RADIUS = 5.2;
const tmp: Vec3 = { x: 0, y: 0, z: 0 };

export class Entities {
  vehicles: Vehicle[] = [];
  projectiles: Projectile[] = [];
  deployables: Deployable[] = [];
  dynAlive: boolean[] = [];
  dynHp: number[] = [];
  private pending: { t: number; kind: ExplosionKind; x: number; y: number; z: number; owner: number }[] = [];
  private nextId = 1;
  private readonly hit: RayHit = makeRayHit();

  constructor(private readonly sim: GameSim) { this.reset(); }

  reset(): void {
    const sim = this.sim;
    this.projectiles = [];
    this.deployables = [];
    this.pending = [];
    this.vehicles = [];
    if (sim.opts.vehicles) {
      for (const b of sim.map.bases) {
        if (!b.vehicle) continue;
        const sp = b.vehicle;
        this.vehicles.push({
          id: this.vehicles.length, team: b.team, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, roll: 0, speed: 0, steer: 0,
          health: VEHICLE.MAX_HEALTH, alive: true, driver: -1, passenger: -1, respawnT: 0, spawn: sp, throttle: 0, steerIn: 0, brake: false, idleT: 0,
        });
      }
    }
    this.dynAlive = sim.map.dyn.map(() => true);
    this.dynHp = sim.map.dyn.map((d) => d.hp);
    for (const d of sim.map.dyn) for (const b of d.boxes) sim.world.setEnabled(b, true);
  }

  destroyedDyn(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.dynAlive.length; i++) if (!this.dynAlive[i]) out.push(i);
    return out;
  }

  step(dt: number): void {
    for (const v of this.vehicles) this.stepVehicle(v, dt);
    this.stepProjectiles(dt);
    this.stepDeployables(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.pending.splice(i, 1);
        this.explode(e.kind, e.x, e.y, e.z, this.sim.player(e.owner) ?? null);
      }
    }
    if (this.sim.tick % 6 === 0) this.reconSpotting();
  }

  // ------------------------------------------------------------------ destructibles
  breakDyn(ref: number, attacker: SimPlayer | null): void {
    if (ref < 0 || !this.dynAlive[ref]) return;
    const d = this.sim.map.dyn[ref];
    this.dynAlive[ref] = false;
    for (const b of d.boxes) this.sim.world.setEnabled(b, false);
    this.sim.emit({ t: 'destroy', kind: d.kind, ref, x: d.x, y: d.y, z: d.z });
    if (d.kind === 'barrel') this.pending.push({ t: 0.06, kind: 'barrel', x: d.x, y: d.y, z: d.z, owner: attacker ? attacker.id : -1 });
  }

  damageDyn(ref: number, dmg: number, attacker: SimPlayer | null): void {
    if (ref < 0 || !this.dynAlive[ref]) return;
    const d = this.sim.map.dyn[ref];
    if (d.kind === 'glass') { this.breakDyn(ref, attacker); return; }
    this.dynHp[ref] -= dmg;
    if (this.dynHp[ref] <= 0) this.breakDyn(ref, attacker);
  }

  explode(kind: ExplosionKind, x: number, y: number, z: number, owner: SimPlayer | null, directVehicle: Vehicle | null = null): void {
    const sim = this.sim, e = EXPLOSIONS[kind], hit = this.hit;
    sim.emit({ t: 'explode', kind, x, y, z, r: e.r });
    for (const p of sim.players) {
      if (!p.alive) continue;
      const cy = p.s.y + 0.9;
      const d = Math.hypot(p.s.x - x, cy - y, p.s.z - z);
      if (d > e.r) continue;
      if (d > 0.6 && sim.world.lineBlocked(x, y + 0.15, z, p.s.x, cy, p.s.z, F_BULLET, hit)
        && sim.world.lineBlocked(x, y + 0.15, z, p.s.x, p.s.y + 1.5, p.s.z, F_BULLET, hit)) continue;
      let dmg = e.dmg * Math.max(0.12, 1 - d / e.r);
      if (p.cls.id === 'engineer') dmg *= 0.75;
      if (p === owner) dmg *= 0.6;
      else if (owner && owner.team === p.team) continue;
      const len = Math.hypot(x - p.s.x, z - p.s.z) || 1;
      // sim.damage ignores friendly fire, so self damage is applied without an attacker
      sim.damage(p, dmg, p === owner ? null : owner, e.w, false, (x - p.s.x) / len, (z - p.s.z) / len);
    }
    for (const v of this.vehicles) {
      if (!v.alive || e.veh <= 0) continue;
      const d = Math.hypot(v.x - x, v.y + 0.9 - y, v.z - z);
      if (v === directVehicle) this.damageVehicle(v, e.veh + 190, owner);
      else if (d < e.r + 1.5) this.damageVehicle(v, e.veh * Math.max(0.15, 1 - d / (e.r + 1.5)), owner);
    }
    const dyn = sim.map.dyn;
    for (let i = 0; i < dyn.length; i++) {
      if (!this.dynAlive[i]) continue;
      const dd = dyn[i];
      const d = Math.hypot(dd.x - x, dd.y - y, dd.z - z);
      if (d > e.r) continue;
      if (dd.kind === 'glass') this.breakDyn(i, owner);
      else this.damageDyn(i, e.dmg * (1 - d / e.r) + 10, owner);
    }
  }

  // ------------------------------------------------------------------ gadgets
  useGadget(p: SimPlayer, kind: GadgetKind, out: WeaponOut): void {
    const sim = this.sim;
    if (kind === 'repair') { this.repair(p); return; }
    sim.emit({ t: 'gadget', id: p.id, kind });
    if (kind === 'stim') { p.stimT = 3; p.s.tacT = PLAYER.TAC_SPRINT_MAX; return; }
    if (kind === 'smoke' || kind === 'rocket' || kind === 'sensor') { this.throwProjectile(p, kind, out.aimYaw, out.aimPitch, false); return; }
    if (kind === 'ammoCrate' || kind === 'medCrate') {
      const d = dirFromAngles(p.s.yaw, 0, tmp);
      let gx = p.s.x + d.x * 1.3, gz = p.s.z + d.z * 1.3;
      let gy = sim.world.surfaceAt(gx, gz, p.s.y + 0.7);
      if (gy === -Infinity || Math.abs(gy - p.s.y) > 1.6 || sim.world.overlaps(gx - 0.3, gy + 0.05, gz - 0.3, gx + 0.3, gy + 0.5, gz + 0.3, F_SOLID)) {
        gx = p.s.x; gz = p.s.z; gy = p.s.y;
      }
      this.deployables = this.deployables.filter((o) => !(o.owner === p.id && o.kind === kind));
      this.addDeployable(kind, p, gx, gy, gz, 45);
    }
  }

  private addDeployable(kind: DeployableKind, owner: SimPlayer, x: number, y: number, z: number, life: number): void {
    this.deployables.push({ id: this.nextId++ & 0xffff, kind, owner: owner.id, team: owner.team, x, y, z, life, age: 0, pulseT: 0.5, pulses: 0, acc: 0, seen: new Set() });
  }

  throwProjectile(p: SimPlayer, kind: ProjectileKind, yaw: number, pitch: number, announce = true): void {
    const sim = this.sim;
    if (announce) sim.emit({ t: 'gadget', id: p.id, kind });
    p.protectT = 0;
    const eye = sim.eyePos(p, { x: 0, y: 0, z: 0 });
    const rocket = kind === 'rocket';
    const d = dirFromAngles(yaw, clamp(pitch + (rocket ? 0 : 7 * DEG), -1.5, 1.5), tmp);
    const speed = rocket ? 62 : kind === 'frag' ? 17 : 15;
    const inherit = rocket ? 0 : 0.5;
    // start slightly ahead of the eye but never inside a wall
    let start = 0.6;
    if (sim.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, 0.7, F_BULLET, this.hit)) start = Math.max(0, this.hit.t - 0.15);
    this.projectiles.push({
      id: this.nextId++ & 0xffff, kind, owner: p.id, team: p.team,
      x: eye.x + d.x * start, y: eye.y + d.y * start - 0.08, z: eye.z + d.z * start,
      vx: d.x * speed + p.s.vx * inherit, vy: d.y * speed + p.s.vy * inherit * 0.5, vz: d.z * speed + p.s.vz * inherit,
      fuse: rocket ? 4 : kind === 'frag' ? 2.8 : kind === 'smoke' ? 1.5 : 10, rest: false,
    });
  }

  private stepProjectiles(dt: number): void {
    const sim = this.sim, hit = this.hit;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const owner = sim.player(pr.owner) ?? null;
      pr.fuse -= dt;
      let done = false;
      if (!pr.rest) {
        pr.vy -= (pr.kind === 'rocket' ? 1.2 : 15) * dt;
        const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
        let remaining = speed * dt;
        for (let iter = 0; iter < 3 && remaining > 1e-4 && !done; iter++) {
          const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
          const dx = pr.vx / sp, dy = pr.vy / sp, dz = pr.vz / sp;
          let limit = remaining;
          const worldHit = sim.world.raycast(pr.x, pr.y, pr.z, dx, dy, dz, remaining, F_BULLET | F_GLASS, hit);
          if (worldHit) limit = hit.t;
          let directVeh: Vehicle | null = null, directPlayer = false;
          if (pr.kind === 'rocket') {
            for (const v of this.vehicles) {
              if (!v.alive || (owner && v.id === owner.vehicle)) continue;
              const tv = this.rayVehicle(v, pr.x, pr.y, pr.z, dx, dy, dz, limit);
              if (tv >= 0 && tv < limit) { limit = tv; directVeh = v; }
            }
            for (const o of sim.players) {
              if (!o.alive || o.team === pr.team) continue;
              const ddx = o.s.x - pr.x, ddy = o.s.y + 0.9 - pr.y, ddz = o.s.z - pr.z;
              const along = ddx * dx + ddy * dy + ddz * dz;
              if (along < 0 || along > limit) continue;
              const perp = Math.hypot(ddx - dx * along, ddy - dy * along, ddz - dz * along);
              if (perp < 0.55) { limit = along; directPlayer = true; directVeh = null; }
            }
          }
          pr.x += dx * limit; pr.y += dy * limit; pr.z += dz * limit;
          remaining -= limit;
          if (directVeh || directPlayer) { this.explode('rocket', pr.x - dx * 0.1, pr.y - dy * 0.1, pr.z - dz * 0.1, owner, directVeh); done = true; break; }
          if (!worldHit || limit < hit.t) break;
          const box = hit.index >= 0 ? sim.world.boxes[hit.index] : null;
          if (box && (box.flags & F_GLASS)) { this.breakDyn(box.ref, owner); pr.x += dx * 0.05; pr.y += dy * 0.05; pr.z += dz * 0.05; continue; }
          // back off the surface a little
          pr.x += hit.nx * 0.04; pr.y += hit.ny * 0.04; pr.z += hit.nz * 0.04;
          if (pr.kind === 'rocket') { this.explode('rocket', pr.x, pr.y, pr.z, owner); done = true; break; }
          if (pr.kind === 'sensor') {
            if (owner) this.addDeployable('sensor', owner, pr.x, pr.y, pr.z, 25);
            done = true; break;
          }
          const dot = pr.vx * hit.nx + pr.vy * hit.ny + pr.vz * hit.nz;
          pr.vx = (pr.vx - 2 * dot * hit.nx) * 0.45; pr.vy = (pr.vy - 2 * dot * hit.ny) * 0.4; pr.vz = (pr.vz - 2 * dot * hit.nz) * 0.45;
          if (hit.ny > 0.6) {
            pr.vx *= 0.72; pr.vz *= 0.72;
            if (Math.hypot(pr.vx, pr.vy, pr.vz) < 1.6) { pr.rest = true; pr.vx = pr.vy = pr.vz = 0; break; }
          }
          remaining *= 0.45;
        }
        if (pr.y < sim.world.killY) done = true;
      }
      if (!done && pr.fuse <= 0) {
        if (pr.kind === 'frag') this.explode('frag', pr.x, pr.y + 0.1, pr.z, owner);
        else if (pr.kind === 'smoke' && owner) { this.addDeployable('smoke', owner, pr.x, pr.y, pr.z, 14); sim.emit({ t: 'explode', kind: 'smoke', x: pr.x, y: pr.y, z: pr.z, r: SMOKE_RADIUS }); }
        else if (pr.kind === 'rocket') this.explode('rocket', pr.x, pr.y, pr.z, owner);
        else if (pr.kind === 'sensor' && owner) this.addDeployable('sensor', owner, pr.x, pr.y, pr.z, 25);
        done = true;
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  private stepDeployables(dt: number): void {
    const sim = this.sim;
    for (let i = this.deployables.length - 1; i >= 0; i--) {
      const d = this.deployables[i];
      d.life -= dt; d.age += dt;
      if (d.life <= 0) { this.deployables.splice(i, 1); continue; }
      const owner = sim.player(d.owner);
      if (d.kind === 'ammoCrate') {
        d.pulseT -= dt;
        if (d.pulseT > 0) continue;
        d.pulseT = 1.5; d.pulses++;
        for (const p of sim.players) {
          if (!p.alive || p.team !== d.team || Math.hypot(p.s.x - d.x, p.s.y - d.y, p.s.z - d.z) > 5) continue;
          const s = p.s;
          let gave = false;
          const m0 = sim.maxReserve(p, p.ctx.primary), m1 = sim.maxReserve(p, p.ctx.secondary);
          if (s.reserve0 < m0) { s.reserve0 = Math.min(m0, s.reserve0 + p.ctx.primary.magSize); gave = true; }
          if (s.reserve1 < m1) { s.reserve1 = Math.min(m1, s.reserve1 + p.ctx.secondary.magSize); gave = true; }
          if (d.pulses % 2 === 0 && s.grenades < p.cls.grenades) { s.grenades++; gave = true; }
          if (d.pulses % 3 === 0) {
            const g0 = GADGETS[p.cls.gadgets[0]], g1 = p.cls.gadgets[1] ? GADGETS[p.cls.gadgets[1]] : null;
            if (g0.ammo > 0 && s.gadget0 < g0.ammo && g0.id !== 'ammoCrate') { s.gadget0++; gave = true; }
            if (g1 && g1.ammo > 0 && s.gadget1 < g1.ammo && g1.id !== 'medCrate') { s.gadget1++; gave = true; }
          }
          if (gave) {
            sim.emit({ t: 'pickup', id: p.id, kind: 'ammo' });
            if (owner && owner !== p) sim.addScore(owner, SCORE.RESUPPLY, 'RESUPPLY');
          }
        }
      } else if (d.kind === 'medCrate') {
        for (const p of sim.players) {
          if (!p.alive || p.team !== d.team || p.health >= PLAYER.MAX_HEALTH) continue;
          if (Math.hypot(p.s.x - d.x, p.s.y - d.y, p.s.z - d.z) > 5) continue;
          const heal = Math.min(22 * dt, PLAYER.MAX_HEALTH - p.health);
          p.health += heal;
          if (owner && owner !== p) {
            d.acc += heal;
            if (d.acc >= 40) { d.acc -= 40; sim.addScore(owner, SCORE.HEAL, 'TEAMMATE HEALED'); }
          }
        }
      } else if (d.kind === 'sensor') {
        for (const p of sim.players) {
          if (!p.alive || p.team === d.team) continue;
          if (Math.hypot(p.s.x - d.x, p.s.y - d.y, p.s.z - d.z) > 22) continue;
          p.spottedT = Math.max(p.spottedT, 0.6);
          if (!d.seen.has(p.id)) {
            d.seen.add(p.id);
            if (owner) sim.addScore(owner, SCORE.SPOT, 'ENEMY SPOTTED');
          }
        }
      }
    }
  }

  /** True when a smoke cloud lies between two points. */
  smokeBlocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const d of this.deployables) {
      if (d.kind !== 'smoke' || d.age < 0.7) continue;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz;
      let t = len2 > 0 ? ((d.x - ax) * dx + (d.y + 1.2 - ay) * dy + (d.z - az) * dz) / len2 : 0;
      t = clamp(t, 0, 1);
      if (Math.hypot(ax + dx * t - d.x, ay + dy * t - d.y - 1.2, az + dz * t - d.z) < SMOKE_RADIUS) return true;
    }
    return false;
  }

  private reconSpotting(): void {
    const sim = this.sim;
    for (const p of sim.players) {
      if (!p.alive || p.cls.id !== 'recon' || p.s.slot !== 0 || p.s.ads < 0.9 || !p.ctx.primary.scope) continue;
      const eye = sim.eyePos(p, { x: 0, y: 0, z: 0 });
      const d = dirFromAngles(p.s.yaw, p.s.pitch, tmp);
      for (const o of sim.players) {
        if (!o.alive || o.team === p.team) continue;
        const ox = o.s.x - eye.x, oy = o.s.y + 1.1 - eye.y, oz = o.s.z - eye.z;
        const dist = Math.hypot(ox, oy, oz);
        if (dist > 160 || dist < 1) continue;
        if ((ox * d.x + oy * d.y + oz * d.z) / dist < 0.9990) continue; // ~2.5 degrees
        if (sim.world.lineBlocked(eye.x, eye.y, eye.z, o.s.x, o.s.y + 1.1, o.s.z, F_SIGHT, this.hit)) continue;
        if (o.spottedT <= 0) sim.addScore(p, SCORE.SPOT, 'ENEMY SPOTTED');
        o.spottedT = 6;
      }
    }
  }

  // ------------------------------------------------------------------ vehicles
  private repair(p: SimPlayer): void {
    const sim = this.sim;
    const f = dirFromAngles(p.s.yaw, 0, tmp);
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const dx = v.x - p.s.x, dz = v.z - p.s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 4.2 || (dist > 1.5 && (dx * f.x + dz * f.z) / dist < 0.2)) continue;
      const occ = sim.player(v.driver) ?? sim.player(v.passenger);
      const side = occ ? occ.team : v.team;
      if (side === p.team) {
        if (v.health >= VEHICLE.MAX_HEALTH) return;
        const heal = Math.min(75 * SIM.CMD_DT, VEHICLE.MAX_HEALTH - v.health);
        v.health += heal;
        v.idleT += heal;
        if (v.idleT >= 60) { v.idleT -= 60; sim.addScore(p, SCORE.REPAIR, 'REPAIR'); }
      } else this.damageVehicle(v, 60 * SIM.CMD_DT, p);
      return;
    }
  }

  vehicleColliders(): DynBox[] {
    const out: DynBox[] = [];
    for (const v of this.vehicles) {
      if (!v.alive || Math.abs(v.speed) > 1.5) continue;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      for (const o of [-1.35, 0, 1.35]) {
        const cx = v.x + fx * o, cz = v.z + fz * o;
        out.push({ minX: cx - 1.0, minY: v.y + 0.1, minZ: cz - 1.0, maxX: cx + 1.0, maxY: v.y + VEHICLE.HEIGHT - 0.15, maxZ: cz + 1.0 });
      }
    }
    return out;
  }

  seatPosition(v: Vehicle, seat: number, s: PlayerState): void {
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const side = seat === 0 ? -0.48 : 0.48;
    s.x = v.x + rx * side + fx * 0.15;
    s.z = v.z + rz * side + fz * 0.15;
    s.y = v.y + VEHICLE.SEAT_Y;
  }

  /** Ray vs the vehicle's oriented bounding box. Returns distance or -1. */
  rayVehicle(v: Vehicle, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const px = ox - v.x, pz = oz - v.z;
    const lx = px * rx + pz * rz, lz = px * fx + pz * fz, ly = oy - v.y;
    const ldx = dx * rx + dz * rz, ldz = dx * fx + dz * fz;
    let t0 = 0, t1 = maxT;
    const slab = (o: number, d: number, mn: number, mx: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
      let a = (mn - o) / d, e = (mx - o) / d;
      if (a > e) { const s = a; a = e; e = s; }
      if (a > t0) t0 = a;
      if (e < t1) t1 = e;
      return t0 <= t1;
    };
    if (!slab(lx, ldx, -VEHICLE.HALF_WIDTH, VEHICLE.HALF_WIDTH)) return -1;
    if (!slab(ly, dy, 0.25, VEHICLE.HEIGHT)) return -1;
    if (!slab(lz, ldz, -VEHICLE.HALF_LEN, VEHICLE.HALF_LEN)) return -1;
    return t0;
  }

  damageVehicle(v: Vehicle, dmg: number, attacker: SimPlayer | null): void {
    const sim = this.sim;
    if (!v.alive || sim.phase !== 'live') return;
    const occ = sim.player(v.driver) ?? sim.player(v.passenger);
    if (attacker && occ && occ.team === attacker.team) return;
    v.health -= dmg;
    if (v.health > 0) return;
    v.health = 0;
    v.alive = false;
    v.respawnT = VEHICLE.RESPAWN;
    v.speed = 0;
    sim.emit({ t: 'vehicle', id: v.id, kind: 'destroyed', player: attacker ? attacker.id : -1 });
    const occupants = [sim.player(v.driver), sim.player(v.passenger)];
    v.driver = -1; v.passenger = -1;
    let enemyKilled = false;
    for (const o of occupants) {
      if (!o) continue;
      o.vehicle = -1; o.seat = -1;
      if (attacker && attacker.team !== o.team) enemyKilled = true;
      sim.kill(o, attacker && attacker.team !== o.team ? attacker : null, -5, false);
    }
    if (attacker && (enemyKilled || v.team !== attacker.team)) sim.addScore(attacker, SCORE.VEHICLE_DESTROY, 'VEHICLE DESTROYED');
    this.explode('vehicle', v.x, v.y + 0.8, v.z, attacker);
  }

  leaveVehicle(p: SimPlayer, place: boolean): void {
    const v = this.vehicles[p.vehicle];
    p.vehicle = -1; p.seat = -1;
    if (!v) return;
    if (v.driver === p.id) { v.driver = -1; v.throttle = 0; v.steerIn = 0; }
    if (v.passenger === p.id) v.passenger = -1;
    if (!place) return;
    const sim = this.sim, R = PLAYER.RADIUS;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const side = VEHICLE.HALF_WIDTH + 0.75;
    const cands: [number, number][] = [[-side, 0.2], [side, 0.2], [-side, -1.2], [side, -1.2], [0, -VEHICLE.HALF_LEN - 0.9], [0, VEHICLE.HALF_LEN + 0.9]];
    for (const [cr, cf] of cands) {
      const x = v.x + rx * cr + fx * cf, z = v.z + rz * cr + fz * cf;
      const y = sim.world.surfaceAt(x, z, v.y + 0.8);
      if (y === -Infinity || Math.abs(y - v.y) > 1.2) continue;
      if (sim.world.overlaps(x - R, y + 0.05, z - R, x + R, y + PLAYER.HEIGHT, z + R, F_SOLID)) continue;
      p.s.x = x; p.s.y = y + 0.02; p.s.z = z;
      p.s.vx = p.s.vy = p.s.vz = 0;
      return;
    }
    p.s.x = v.x; p.s.z = v.z; p.s.y = v.y + VEHICLE.HEIGHT + 0.05;
  }

  tryUse(p: SimPlayer): void {
    const sim = this.sim;
    if (p.vehicle >= 0) {
      const id = p.vehicle;
      this.leaveVehicle(p, true);
      sim.emit({ t: 'vehicle', id, kind: 'exit', player: p.id });
      return;
    }
    for (const v of this.vehicles) {
      if (!v.alive || Math.hypot(v.x - p.s.x, v.z - p.s.z) > VEHICLE.ENTER_RANGE || Math.abs(v.y - p.s.y) > 2) continue;
      const occ = sim.player(v.driver) ?? sim.player(v.passenger);
      if (occ && occ.team !== p.team) continue;
      if (v.driver < 0) { v.driver = p.id; p.seat = 0; }
      else if (v.passenger < 0) { v.passenger = p.id; p.seat = 1; }
      else continue;
      p.vehicle = v.id;
      p.s.reloadT = 0;
      this.seatPosition(v, p.seat, p.s);
      sim.emit({ t: 'vehicle', id: v.id, kind: 'enter', player: p.id });
      return;
    }
  }

  private vehicleBlocked(x: number, y: number, z: number, yaw: number): boolean {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const o of [-1.4, 0, 1.4]) {
      const cx = x + fx * o, cz = z + fz * o;
      if (this.sim.world.overlaps(cx - 0.95, y + 0.55, cz - 0.95, cx + 0.95, y + 1.7, cz + 0.95, F_SOLID)) return true;
    }
    return false;
  }

  private stepVehicle(v: Vehicle, dt: number): void {
    const sim = this.sim, world = sim.world;
    if (!v.alive) {
      v.respawnT -= dt;
      if (v.respawnT <= 0) {
        const sp = v.spawn;
        v.x = sp.x; v.y = sp.y; v.z = sp.z; v.yaw = sp.yaw; v.pitch = 0; v.roll = 0; v.speed = 0; v.steer = 0;
        v.health = VEHICLE.MAX_HEALTH; v.alive = true; v.idleT = 0;
        sim.emit({ t: 'vehicle', id: v.id, kind: 'respawn', player: -1 });
      }
      return;
    }
    const driver = sim.player(v.driver);
    if (!driver || !driver.alive || driver.vehicle !== v.id) { v.driver = -1; v.throttle = 0; v.steerIn = 0; v.brake = true; }
    const pass = sim.player(v.passenger);
    if (!pass || !pass.alive || pass.vehicle !== v.id) v.passenger = -1;

    const th = v.throttle;
    if (th > 0.05) v.speed += (v.speed < 0 ? VEHICLE.BRAKE : VEHICLE.ACCEL) * th * dt;
    else if (th < -0.05) v.speed += (v.speed > 0 ? VEHICLE.BRAKE : VEHICLE.ACCEL * 0.7) * th * dt;
    else v.speed = approach(v.speed, 0, VEHICLE.DRAG * dt);
    if (v.brake) v.speed = approach(v.speed, 0, VEHICLE.BRAKE * dt);
    v.speed = clamp(v.speed, -VEHICLE.REVERSE_SPEED, VEHICLE.MAX_SPEED);
    const maxSteer = VEHICLE.MAX_STEER * (1 - 0.55 * Math.min(1, Math.abs(v.speed) / VEHICLE.MAX_SPEED));
    v.steer = approach(v.steer, v.steerIn * maxSteer, 2.2 * dt);

    if (Math.abs(v.speed) > 0.01) {
      const nyaw = v.yaw - (v.speed / VEHICLE.WHEELBASE) * Math.tan(v.steer) * dt;
      const fx = -Math.sin(nyaw), fz = -Math.cos(nyaw);
      const nx = v.x + fx * v.speed * dt, nz = v.z + fz * v.speed * dt;
      const inside = nx > world.minX + 2.5 && nx < world.maxX - 2.5 && nz > world.minZ + 2.5 && nz < world.maxZ - 2.5;
      if (inside && !this.vehicleBlocked(nx, v.y, nz, nyaw)) { v.x = nx; v.z = nz; v.yaw = nyaw; }
      else {
        if (Math.abs(v.speed) > 8) v.health = Math.max(1, v.health - Math.abs(v.speed) * 2.5);
        v.speed = -v.speed * 0.25;
      }
      // run over enemies
      if (Math.abs(v.speed) > 4 && driver) {
        const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), ffx = -Math.sin(v.yaw), ffz = -Math.cos(v.yaw);
        for (const p of sim.players) {
          if (!p.alive || p.vehicle >= 0 || p.team === driver.team) continue;
          const px = p.s.x - v.x, pz = p.s.z - v.z;
          if (Math.abs(px * rx + pz * rz) > VEHICLE.HALF_WIDTH + 0.3 || Math.abs(px * ffx + pz * ffz) > VEHICLE.HALF_LEN + 0.3) continue;
          if (p.s.y > v.y + VEHICLE.HEIGHT || p.s.y + PLAYER.HEIGHT < v.y) continue;
          sim.damage(p, 30 + Math.abs(v.speed) * 9, driver, -4, false, -ffx, -ffz);
        }
      }
    }
    // follow the ground
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const yF = world.surfaceAt(v.x + fx * 1.45, v.z + fz * 1.45, v.y + 0.9);
    const yR = world.surfaceAt(v.x - fx * 1.45, v.z - fz * 1.45, v.y + 0.9);
    if (yF > -Infinity && yR > -Infinity) {
      v.y = approach(v.y, (yF + yR) / 2, 6 * dt);
      v.pitch = approach(v.pitch, Math.atan2(yF - yR, VEHICLE.WHEELBASE), 2 * dt);
    }
    // occupants ride along
    if (driver && driver.vehicle === v.id) this.seatPosition(v, 0, driver.s);
    if (pass && pass.vehicle === v.id) this.seatPosition(v, 1, pass.s);
  }

  // ------------------------------------------------------------------ snapshots
  projectileSnaps(): ProjectileSnap[] {
    return this.projectiles.map((p) => ({ id: p.id, kind: PROJECTILE_KINDS.indexOf(p.kind), x: p.x, y: p.y, z: p.z }));
  }

  deployableSnaps(): DeployableSnap[] {
    return this.deployables.map((d) => ({ id: d.id, kind: DEPLOYABLE_KINDS.indexOf(d.kind), team: d.team, x: d.x, y: d.y, z: d.z, life: d.life }));
  }

  vehicleSnaps(): VehicleSnap[] {
    return this.vehicles.map((v) => ({
      id: v.id, x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll, speed: v.speed, steer: v.steer,
      health: Math.max(0, Math.round(v.health)), driver: v.driver, passenger: v.passenger, team: v.alive ? v.team : TEAM_NONE, alive: v.alive,
    }));
  }
}
