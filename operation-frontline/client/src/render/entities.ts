// Views for simulation entities other than soldiers: the LTV ground vehicle,
// projectiles (grenades, rockets, sensors) and deployables (crates, sensors, smoke).
import { TEAM_A, type TeamId } from '@shared/config';
import { DEPLOYABLE_KINDS, PROJECTILE_KINDS, type DeployableSnap, type ProjectileSnap, type VehicleSnap } from '@shared/types';
import * as pc from 'playcanvas';
import type { AudioEngine } from '../audio/audio';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';
import type { Effects } from './effects';
import { MeshBuilder } from './meshBuilder';

function mat(color: [number, number, number], metal = 0.3, gloss = 0.4, emissive = 0): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(color[0], color[1], color[2]);
  m.useMetalness = true; m.metalness = metal; m.gloss = gloss;
  if (emissive > 0) { m.emissive = new pc.Color(color[0], color[1], color[2]); m.emissiveIntensity = emissive; }
  m.update();
  return m;
}

function ent(device: pc.GraphicsDevice, name: string, mb: MeshBuilder, material: pc.Material, shadows = true): pc.Entity {
  const e = new pc.Entity(name);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mb.toMesh(device, false), material)], castShadows: shadows, receiveShadows: true });
  return e;
}

const fwd = (pts: [number, number][]): [number, number][] => pts.map(([f, y]) => [-f, y]);

class VehicleView {
  readonly root = new pc.Entity('vehicle');
  private readonly wheels: pc.Entity[] = [];
  private readonly bodyMats: pc.StandardMaterial[];
  private readonly burnt: pc.StandardMaterial;
  private readonly body: pc.Entity;
  private spin = 0;
  private wasAlive = true;
  smokeT = 0;

  constructor(engine: Engine, team: TeamId) {
    const device = engine.device;
    const paint: [number, number, number] = team === TEAM_A ? [0.2, 0.25, 0.17] : [0.46, 0.38, 0.26];
    const hull = new MeshBuilder(), dark = new MeshBuilder(), glass = new MeshBuilder(), lights = new MeshBuilder();
    // main hull silhouette (side profile extruded across the width)
    hull.extrude(fwd([[-2.3, 0.55], [-2.3, 1.22], [-1.55, 1.3], [-1.38, 1.86], [0.45, 1.86], [0.98, 1.27], [2.05, 1.16], [2.3, 0.98], [2.3, 0.55]]), -0.98, 0.98, 0.07);
    // fenders / wheel arches
    for (const f of [1.45, -1.45]) for (const sx of [-1, 1]) hull.extrude(fwd([[f - 0.62, 0.62], [f - 0.5, 0.98], [f + 0.5, 0.98], [f + 0.62, 0.62]]), sx * 0.92, sx * 1.06, 0.03);
    // chassis, bumpers, roof rack, spare wheel carrier
    dark.box(-0.9, 0.32, -2.2, 0.9, 0.56, 2.2);
    dark.box(-1.04, 0.5, -2.42, 1.04, 0.74, -2.3);
    dark.box(-1.04, 0.5, 2.3, 1.04, 0.72, 2.4);
    dark.box(-0.8, 1.86, -0.3, 0.8, 1.9, 1.3);
    for (const sx of [-0.78, 0.78]) dark.box(sx - 0.03, 1.9, -0.25, sx + 0.03, 2.0, 1.25);
    dark.cylinder(0, 1.2, 2.42, 0, 1.2, 2.6, 0.42, 0.42, 14);
    dark.box(-0.85, 1.0, -2.36, 0.85, 1.1, -2.32); // grille slats
    dark.box(-0.85, 0.82, -2.36, 0.85, 0.92, -2.32);
    // glazing
    const g = 0.004;
    glass.quad(-0.86, 1.3, -0.96, 0.86, 1.3, -0.96, 0.86, 1.8, -0.47, -0.86, 1.8, -0.47); // windshield (slightly proud of the hull)
    for (const sx of [-1, 1]) {
      const x = sx * (0.98 + g);
      if (sx > 0) { glass.quad(x, 1.34, -0.7, x, 1.34, 0.35, x, 1.76, 0.35, x, 1.76, -0.38); glass.quad(x, 1.34, 0.45, x, 1.34, 1.25, x, 1.76, 1.25, x, 1.76, 0.45); }
      else { glass.quad(x, 1.34, 0.35, x, 1.34, -0.7, x, 1.76, -0.38, x, 1.76, 0.35); glass.quad(x, 1.34, 1.25, x, 1.34, 0.45, x, 1.76, 0.45, x, 1.76, 1.25); }
    }
    for (const sx of [-0.7, 0.7]) { lights.box(sx - 0.16, 0.98, -2.34, sx + 0.16, 1.1, -2.3); }
    const bm = mat(paint, 0.25, 0.42), dm = mat([0.06, 0.06, 0.065], 0.5, 0.35), gm = mat([0.05, 0.07, 0.09], 0.4, 0.92);
    this.bodyMats = [bm];
    this.burnt = mat([0.03, 0.03, 0.03], 0.3, 0.15);
    this.body = ent(device, 'hull', hull, bm);
    this.root.addChild(this.body);
    this.root.addChild(ent(device, 'chassis', dark, dm));
    this.root.addChild(ent(device, 'glass', glass, gm, false));
    this.root.addChild(ent(device, 'lights', lights, mat([1, 0.95, 0.8], 0, 0.5, 3), false));
    // wheels
    const wb = new MeshBuilder();
    wb.cylinder(-0.17, 0, 0, 0.17, 0, 0, 0.45, 0.45, 18);
    wb.cylinder(-0.19, 0, 0, 0.19, 0, 0, 0.24, 0.24, 10);
    const wmesh = wb.toMesh(device, false);
    const wm = mat([0.045, 0.045, 0.05], 0.1, 0.25);
    for (const [x, z] of [[-0.93, -1.45], [0.93, -1.45], [-0.93, 1.45], [0.93, 1.45]]) {
      const pivot = new pc.Entity('wheel-pivot');
      pivot.setLocalPosition(x, 0.45, z);
      const w = new pc.Entity('wheel');
      w.addComponent('render', { meshInstances: [new pc.MeshInstance(wmesh, wm)], castShadows: true, receiveShadows: true });
      pivot.addChild(w);
      this.root.addChild(pivot);
      this.wheels.push(pivot);
    }
    engine.app.root.addChild(this.root);
  }

  update(dt: number, v: VehicleSnap, fx: Effects): void {
    this.root.enabled = true;
    this.root.setPosition(v.x, v.y, v.z);
    this.root.setEulerAngles(v.pitch * pc.math.RAD_TO_DEG, v.yaw * pc.math.RAD_TO_DEG, 0);
    if (v.alive !== this.wasAlive) {
      this.wasAlive = v.alive;
      const mi = (this.body.render as pc.RenderComponent).meshInstances[0];
      mi.material = v.alive ? this.bodyMats[0] : this.burnt;
    }
    this.spin += (v.speed / 0.45) * dt;
    for (let i = 0; i < 4; i++) {
      const pivot = this.wheels[i];
      pivot.setLocalEulerAngles(0, i < 2 ? -v.steer * pc.math.RAD_TO_DEG : 0, 0);
      (pivot.children[0] as pc.Entity).setLocalEulerAngles(-this.spin * pc.math.RAD_TO_DEG, 0, 0);
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.07;
      const fxX = v.x - Math.sin(v.yaw) * 1.6, fxZ = v.z - Math.cos(v.yaw) * 1.6;
      if (!v.alive) fx.vehicleSmoke(v.x, v.y + 1.3, v.z, true);
      else if (v.health < 240) fx.vehicleSmoke(fxX, v.y + 1.2, fxZ, true);
      if (v.alive && Math.abs(v.speed) > 5) fx.vehicleSmoke(v.x + Math.sin(v.yaw) * 2, v.y + 0.2, v.z + Math.cos(v.yaw) * 2, false);
    }
  }
}

interface Simple { e: pc.Entity; kind: number; seen: number; age: number; x: number; y: number; z: number }

export class EntityViews {
  private vehicles = new Map<number, VehicleView>();
  private projectiles = new Map<number, Simple>();
  private deployables = new Map<number, Simple>();
  private frame = 0;
  private meshes: Record<string, { mesh: pc.Mesh; mat: pc.Material }> | null = null;

  constructor(private readonly engine: Engine, private readonly assets: Assets, private readonly fx: Effects) {}

  clear(): void {
    for (const v of this.vehicles.values()) v.root.destroy();
    for (const p of this.projectiles.values()) p.e.destroy();
    for (const d of this.deployables.values()) d.e.destroy();
    this.vehicles.clear(); this.projectiles.clear(); this.deployables.clear();
  }

  private lib(): Record<string, { mesh: pc.Mesh; mat: pc.Material }> {
    if (this.meshes) return this.meshes;
    const device = this.engine.device;
    const rocket = new MeshBuilder();
    rocket.cylinder(0, 0, 0.25, 0, 0, -0.2, 0.035, 0.045, 10);
    rocket.cylinder(0, 0, -0.2, 0, 0, -0.34, 0.045, 0.006, 10);
    const can = new MeshBuilder();
    can.cylinder(0, -0.07, 0, 0, 0.07, 0, 0.032, 0.032, 10);
    can.cylinder(0, 0.07, 0, 0, 0.1, 0, 0.016, 0.014, 8);
    const sensor = new MeshBuilder();
    sensor.cylinder(0, 0, 0, 0, 0.06, 0, 0.06, 0.05, 12);
    sensor.cylinder(0, 0.06, 0, 0, 0.16, 0, 0.005, 0.004, 6);
    const blink = new MeshBuilder();
    blink.cylinder(0, 0.16, 0, 0, 0.19, 0, 0.012, 0.012, 8);
    const ring = new MeshBuilder();
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2, a1 = ((i + 1) / 40) * Math.PI * 2;
      ring.quad(Math.cos(a0) * 0.9, 0, Math.sin(a0) * 0.9, Math.cos(a0) * 1, 0, Math.sin(a0) * 1, Math.cos(a1) * 1, 0, Math.sin(a1) * 1, Math.cos(a1) * 0.9, 0, Math.sin(a1) * 0.9);
    }
    const ringMat = (c: [number, number, number]): pc.StandardMaterial => {
      const m = mat(c, 0, 0, 2.5);
      m.useLighting = false; m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; m.cull = pc.CULLFACE_NONE; m.opacity = 0.7; m.update();
      return m;
    };
    this.meshes = {
      rocket: { mesh: rocket.toMesh(device, false), mat: mat([0.2, 0.24, 0.17], 0.4, 0.4) },
      can: { mesh: can.toMesh(device, false), mat: mat([0.42, 0.46, 0.46], 0.5, 0.45) },
      sensor: { mesh: sensor.toMesh(device, false), mat: mat([0.1, 0.11, 0.1], 0.5, 0.4) },
      blink: { mesh: blink.toMesh(device, false), mat: mat([0.3, 1, 0.5], 0, 0.3, 6) },
      ringFriend: { mesh: ring.toMesh(device, false), mat: ringMat([0.3, 0.62, 1]) },
      ringEnemy: { mesh: ring.toMesh(device, false), mat: ringMat([1, 0.42, 0.26]) },
    };
    return this.meshes;
  }

  private simple(name: string): pc.Entity {
    const l = this.lib()[name];
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(l.mesh, l.mat)], castShadows: false, receiveShadows: false });
    return e;
  }

  private makeProjectile(kind: string): pc.Entity {
    let e: pc.Entity;
    if (kind === 'frag') {
      try { e = new pc.Entity('frag'); const m = this.assets.instantiate('stick_grenade'); m.setLocalScale(0.9, 0.9, 0.9); e.addChild(m); } catch { e = this.simple('can'); }
    } else if (kind === 'rocket') e = this.simple('rocket');
    else if (kind === 'sensor') e = this.simple('sensor');
    else e = this.simple('can');
    this.engine.app.root.addChild(e);
    return e;
  }

  private makeDeployable(kind: string, friendly: boolean): pc.Entity {
    const e = new pc.Entity(`dep-${kind}`);
    if (kind === 'ammoCrate' || kind === 'medCrate') {
      try {
        const m = this.assets.instantiate(kind === 'ammoCrate' ? 'ammo_box' : 'medical_box');
        const s = kind === 'ammoCrate' ? 2.4 : 1.7;
        m.setLocalScale(s, s, s);
        e.addChild(m);
      } catch { /* model missing: ring only */ }
      const ring = this.simple(friendly ? 'ringFriend' : 'ringEnemy');
      ring.setLocalPosition(0, 0.03, 0);
      ring.setLocalScale(friendly ? 5 : 0.6, 1, friendly ? 5 : 0.6);
      e.addChild(ring);
    } else if (kind === 'sensor') {
      e.addChild(this.simple('sensor'));
      e.addChild(this.simple('blink'));
    }
    this.engine.app.root.addChild(e);
    return e;
  }

  update(dt: number, vehicles: VehicleSnap[], projectiles: ProjectileSnap[], deployables: DeployableSnap[], prevProjectiles: ProjectileSnap[], f: number,
    myTeam: TeamId, audio: AudioEngine): void {
    this.frame++;
    // ---- vehicles
    for (const v of vehicles) {
      let view = this.vehicles.get(v.id);
      if (!view) { view = new VehicleView(this.engine, v.id === 0 ? 1 : 2); this.vehicles.set(v.id, view); }
      view.update(dt, v, this.fx);
      audio.engine(v.id, v.x, v.y + 1, v.z, v.speed, v.alive && v.driver >= 0);
    }
    // ---- projectiles
    const prev = new Map<number, ProjectileSnap>();
    for (const p of prevProjectiles) prev.set(p.id, p);
    for (const p of projectiles) {
      let s = this.projectiles.get(p.id);
      const kind = PROJECTILE_KINDS[p.kind];
      if (!s) { s = { e: this.makeProjectile(kind), kind: p.kind, seen: 0, age: 0, x: p.x, y: p.y, z: p.z }; this.projectiles.set(p.id, s); }
      s.seen = this.frame; s.age += dt;
      const a = prev.get(p.id) ?? p;
      const x = a.x + (p.x - a.x) * f, y = a.y + (p.y - a.y) * f, z = a.z + (p.z - a.z) * f;
      const dx = x - s.x, dy = y - s.y, dz = z - s.z;
      s.e.setPosition(x, y, z);
      if (kind === 'rocket') {
        if (Math.hypot(dx, dy, dz) > 0.01) s.e.lookAt(x + dx, y + dy, z + dz);
        this.fx.vehicleSmoke(x, y, z, false);
        this.fx.flashLight(x, y, z);
      } else if (Math.hypot(dx, dz) > 0.005) s.e.rotateLocal(dt * 540, dt * 200, 0);
      s.x = x; s.y = y; s.z = z;
    }
    for (const [id, s] of this.projectiles) if (s.seen !== this.frame) { s.e.destroy(); this.projectiles.delete(id); }
    // ---- deployables
    for (const d of deployables) {
      const kind = DEPLOYABLE_KINDS[d.kind];
      let s = this.deployables.get(d.id);
      if (!s) { s = { e: this.makeDeployable(kind, d.team === myTeam), kind: d.kind, seen: 0, age: 0, x: d.x, y: d.y, z: d.z }; this.deployables.set(d.id, s); }
      s.seen = this.frame; s.age += dt;
      s.e.setPosition(d.x, d.y, d.z);
      if (kind === 'smoke') this.fx.smokeCloud(d.x, d.y, d.z, dt, s.age);
      else if (kind === 'sensor') { const b = s.e.children[1] as pc.Entity | undefined; if (b) b.enabled = Math.sin(s.age * 9) > 0; }
    }
    for (const [id, s] of this.deployables) if (s.seen !== this.frame) { s.e.destroy(); this.deployables.delete(id); }
  }
}
