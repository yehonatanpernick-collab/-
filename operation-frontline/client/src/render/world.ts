// Turns the shared MapData into renderable PlayCanvas geometry: chunked static
// meshes per material, stairs / ramps, instanced glass panes, GLB props, local
// lights and objective markers. Also mirrors destructible state.
import { TEAM_A, TEAM_B, type TeamId } from '@shared/config';
import type { MapData, Zone } from '@shared/world/MapBuilder';
import { F_GLASS, F_NOCOLLIDE, F_NORENDER } from '@shared/world/World';
import { MAT, MATERIALS, PROPS, TINTS } from '@shared/world/materials';
import * as pc from 'playcanvas';
import { type Assets, TREE_MODELS } from '../core/assets';
import type { Engine } from '../core/engine';
import { FACE_ALL, FACE_NX, FACE_NY, FACE_NZ, FACE_PX, FACE_PY, FACE_PZ, MeshBuilder } from './meshBuilder';

const CHUNK = 52;
export const TEAM_COLORS: Record<number, [number, number, number]> = { 0: [0.85, 0.85, 0.85], [TEAM_A]: [0.3, 0.62, 1.0], [TEAM_B]: [1.0, 0.42, 0.26] };

/** GLB materials may request screen-space refraction (transmission); replace it with plain blending. */
export function sanitizeMaterial(m: pc.StandardMaterial): void {
  if (!m || !(m.refraction > 0 || m.useDynamicRefraction)) return;
  m.refraction = 0;
  m.useDynamicRefraction = false;
  m.blendType = pc.BLEND_NORMAL;
  m.opacity = Math.min(m.opacity, 0.45);
  m.depthWrite = false;
  m.update();
}

interface PropView { entity: pc.Entity; x: number; z: number; dyn: number; big: boolean }

export class WorldView {
  readonly root = new pc.Entity('world');
  private glassInstance: pc.MeshInstance | null = null;
  private glassBuffer: pc.VertexBuffer | null = null;
  private glassData = new Float32Array(0);
  private glassIndex = new Map<number, number>();
  private props: PropView[] = [];
  private dynProps = new Map<number, PropView>();
  private rings: { mat: pc.StandardMaterial; beam: pc.StandardMaterial }[] = [];
  private cullT = 0;
  triangles = 0;

  constructor(private readonly engine: Engine, private readonly assets: Assets, readonly map: MapData) {
    engine.app.root.addChild(this.root);
    this.buildStatic();
    this.buildTrees();
    this.buildGlass();
    this.buildProps();
    this.buildLights();
    this.buildObjectiveMarkers();
  }

  isInterior(x: number, y: number, z: number): boolean {
    for (const zn of this.map.interiors) {
      if (x > zn.minX && x < zn.maxX && z > zn.minZ && z < zn.maxZ && y > zn.minY - 0.1 && y < zn.maxY) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ static geometry
  private buildStatic(): void {
    const { world, interiors } = this.map;
    const device = this.engine.device;
    const builders = new Map<string, MeshBuilder>();
    const get = (mat: number, x: number, z: number): MeshBuilder => {
      const key = `${mat}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
      let b = builders.get(key);
      if (!b) { b = new MeshBuilder(); b.uvScale = MATERIALS[mat].uv; builders.set(key, b); }
      return b;
    };
    const inZone = (zn: Zone, x: number, y: number, z: number): boolean => x > zn.minX && x < zn.maxX && y > zn.minY - 0.05 && y < zn.maxY + 0.05 && z > zn.minZ && z < zn.maxZ;
    const shade = (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): number => {
      const px = cx + nx * 0.3, py = cy + ny * 0.3, pz = cz + nz * 0.3;
      for (const zn of interiors) if (inZone(zn, px, py, pz)) return ny < -0.5 ? 0.42 : 0.56;
      return ny < -0.5 ? 0.6 : 1;
    };

    for (const b of world.boxes) {
      if (b.flags & (F_NORENDER | F_GLASS)) continue;
      const t = TINTS[b.tint] ?? TINTS[0];
      const mb = get(b.mat, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      let faces = FACE_ALL;
      // never visible: undersides resting on the base ground and the bottom of deep foundations
      if (b.minY <= -3.9) faces &= ~FACE_NY;
      if (!(b.flags & F_NOCOLLIDE) && b.minY === -0.6 && b.maxY <= 0.16 && !this.overTunnel(b.minX, b.minZ, b.maxX, b.maxZ)) faces &= ~FACE_NY;
      const wallLike = b.mat !== MAT.ASPHALT && b.mat !== MAT.SIDEWALK && b.mat !== MAT.DIRT && b.mat !== MAT.LINE && !(b.flags & F_NOCOLLIDE && b.maxY - b.minY < 0.3);
      mb.box(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, t[0] * 255, t[1] * 255, t[2] * 255, faces, shade, wallLike);
    }

    // ramps and stairs
    for (const r of world.ramps) {
      const mb = get(r.mat, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
      const rise = r.y1 - r.y0;
      const lo = r.axis === 0 ? (r.dir > 0 ? r.minX : r.maxX) : (r.dir > 0 ? r.minZ : r.maxZ);
      const hi = r.axis === 0 ? (r.dir > 0 ? r.maxX : r.minX) : (r.dir > 0 ? r.maxZ : r.minZ);
      if (r.stairs) {
        const n = Math.max(2, Math.round(rise / 0.19));
        for (let i = 0; i < n; i++) {
          const a = lo + ((hi - lo) * i) / n, c = lo + ((hi - lo) * (i + 1)) / n;
          const top = r.y0 + (rise * (i + 1)) / n;
          const riser = r.axis === 0 ? (r.dir > 0 ? FACE_NX : FACE_PX) : (r.dir > 0 ? FACE_NZ : FACE_PZ);
          const sides = r.axis === 0 ? FACE_PZ | FACE_NZ : FACE_PX | FACE_NX;
          const k = 205 + (i % 2) * 14;
          if (r.axis === 0) mb.box(Math.min(a, c), r.y0, r.minZ, Math.max(a, c), top, r.maxZ, k, k, k, FACE_PY | riser | sides, shade);
          else mb.box(r.minX, r.y0, Math.min(a, c), r.maxX, top, Math.max(a, c), k, k, k, FACE_PY | riser | sides, shade);
        }
      } else {
        const k = 225;
        if (r.axis === 0) {
          const [xl, xh] = [lo, hi];
          if (r.dir > 0) mb.quad(xl, r.y0, r.minZ, xl, r.y0, r.maxZ, xh, r.y1, r.maxZ, xh, r.y1, r.minZ, k, k, k);
          else mb.quad(xl, r.y0, r.maxZ, xl, r.y0, r.minZ, xh, r.y1, r.minZ, xh, r.y1, r.maxZ, k, k, k);
          for (const z of [r.minZ, r.maxZ]) {
            const front = z === r.maxZ;
            if ((r.dir > 0) === front) mb.tri(xl, r.y0, z, xh, r.y0, z, xh, r.y1, z, k, k, k); else mb.tri(xl, r.y0, z, xh, r.y1, z, xh, r.y0, z, k, k, k);
          }
          mb.box(Math.min(xh, xh + r.dir * 0.001), r.y0, r.minZ, Math.max(xh, xh + r.dir * 0.001), r.y1, r.maxZ, k, k, k, r.dir > 0 ? FACE_PX : FACE_NX, shade);
        } else {
          const [zl, zh] = [lo, hi];
          if (r.dir > 0) mb.quad(r.minX, r.y0, zl, r.minX, r.y1, zh, r.maxX, r.y1, zh, r.maxX, r.y0, zl, k, k, k);
          else mb.quad(r.maxX, r.y0, zl, r.maxX, r.y1, zh, r.minX, r.y1, zh, r.minX, r.y0, zl, k, k, k);
          for (const x of [r.minX, r.maxX]) {
            const right = x === r.maxX;
            if ((r.dir > 0) === right) mb.tri(x, r.y0, zl, x, r.y1, zh, x, r.y0, zh, k, k, k); else mb.tri(x, r.y0, zl, x, r.y0, zh, x, r.y1, zh, k, k, k);
          }
          mb.box(r.minX, r.y0, Math.min(zh, zh + r.dir * 0.001), r.maxX, r.y1, Math.max(zh, zh + r.dir * 0.001), k, k, k, r.dir > 0 ? FACE_PZ : FACE_NZ, shade);
        }
      }
    }

    // window frames around every glass opening
    for (const d of this.map.dyn) {
      if (d.kind !== 'glass') continue;
      const b = world.boxes[d.boxes[0]];
      const mb = get(MAT.TRIM, d.x, d.z);
      const c = 70, w = 0.06, dep = 0.09;
      const thinX = b.maxX - b.minX < b.maxZ - b.minZ;
      if (thinX) {
        const x0 = d.x - dep, x1 = d.x + dep;
        mb.box(x0, b.minY, b.minZ, x1, b.minY + w, b.maxZ, c, c, c); mb.box(x0, b.maxY - w, b.minZ, x1, b.maxY, b.maxZ, c, c, c);
        mb.box(x0, b.minY, b.minZ, x1, b.maxY, b.minZ + w, c, c, c); mb.box(x0, b.minY, b.maxZ - w, x1, b.maxY, b.maxZ, c, c, c);
        mb.box(x0, b.minY, d.z - w / 2, x1, b.maxY, d.z + w / 2, c, c, c);
      } else {
        const z0 = d.z - dep, z1 = d.z + dep;
        mb.box(b.minX, b.minY, z0, b.maxX, b.minY + w, z1, c, c, c); mb.box(b.minX, b.maxY - w, z0, b.maxX, b.maxY, z1, c, c, c);
        mb.box(b.minX, b.minY, z0, b.minX + w, b.maxY, z1, c, c, c); mb.box(b.maxX - w, b.minY, z0, b.maxX, b.maxY, z1, c, c, c);
        mb.box(d.x - w / 2, b.minY, z0, d.x + w / 2, b.maxY, z1, c, c, c);
      }
    }

    for (const [key, mb] of builders) {
      if (mb.empty) continue;
      const mat = Number(key.split('|')[0]);
      const def = MATERIALS[mat];
      const mesh = mb.toMesh(device, !!def.tex);
      const mi = new pc.MeshInstance(mesh, this.assets.materials[mat]);
      const e = new pc.Entity(`chunk-${key}`);
      const flat = mat === MAT.LINE || mat === MAT.LAMP;
      e.addComponent('render', { meshInstances: [mi], castShadows: !flat && def.opacity === undefined, receiveShadows: true });
      this.root.addChild(e);
      this.triangles += mb.idx.length / 3;
    }
  }

  private overTunnel(x0: number, z0: number, x1: number, z1: number): boolean {
    for (const zn of this.map.interiors) {
      if (zn.maxY < 0 && x0 < zn.maxX + 1 && x1 > zn.minX - 1 && z0 < zn.maxZ + 6 && z1 > zn.minZ - 6) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ street trees
  private buildTrees(): void {
    const trees = this.map.trees;
    if (!trees.length) return;
    if (TREE_MODELS.every((t) => this.assets.containers.has(t))) {
      // realistic trees: kind picks the species (models are 7-8 m tall), scaled per tree
      const height = [0.85, 0.8, 0.9];
      for (const t of trees) {
        const kind = Math.min(TREE_MODELS.length - 1, t.kind);
        const model = this.assets.instantiate(TREE_MODELS[kind]);
        const k = height[kind] * t.scale;
        model.setLocalScale(k, k, k);
        model.setPosition(t.x, t.y - 0.03, t.z);
        model.setEulerAngles(0, ((t.x * 37 + t.z * 11) % 360 + 360) % 360, 0);
        for (const r of model.findComponents('render') as pc.RenderComponent[]) {
          r.castShadows = true; r.receiveShadows = true;
          for (const mi of r.meshInstances) {
            const m = mi.material as pc.StandardMaterial;
            sanitizeMaterial(m);
            if (m.blendType !== pc.BLEND_NONE || m.opacityMap) { m.blendType = pc.BLEND_NONE; m.alphaTest = Math.max(m.alphaTest, 0.4); m.cull = pc.CULLFACE_NONE; m.depthWrite = true; m.update(); }
          }
        }
        this.root.addChild(model);
      }
      return;
    }
    const trunks = new MeshBuilder(), leaves = new MeshBuilder();
    trees.forEach((t, i) => {
      const s = t.scale;
      trunks.cylinder(t.x, t.y, t.z, t.x + 0.12 * s, t.y + 2.9 * s, t.z, 0.17 * s, 0.09 * s, 7, false, 92, 70, 52);
      trunks.cylinder(t.x + 0.05, t.y + 1.8 * s, t.z, t.x + 0.9 * s, t.y + 3.5 * s, t.z + 0.3 * s, 0.06 * s, 0.03 * s, 5, false, 92, 70, 52);
      trunks.cylinder(t.x + 0.05, t.y + 2.0 * s, t.z, t.x - 0.8 * s, t.y + 3.6 * s, t.z - 0.4 * s, 0.06 * s, 0.03 * s, 5, false, 92, 70, 52);
      const gr = t.kind === 0 ? [78, 86, 22] : t.kind === 1 ? [96, 92, 24] : [62, 80, 30];
      const blobs: [number, number, number, number][] = [[0.1, 3.6, 0, 1.7], [-1.0, 3.2, 0.5, 1.25], [1.0, 3.3, -0.4, 1.3], [0.2, 4.4, 0.3, 1.15], [-0.3, 3.0, -1.0, 1.1], [0.6, 3.1, 1.0, 1.05]];
      blobs.forEach((bl, k) => leaves.sphere(t.x + bl[0] * s, t.y + bl[1] * s, t.z + bl[2] * s, bl[3] * s, 10, gr[0], gr[1], gr[2], i * 7 + k));
    });
    const device = this.engine.device;
    const mk = (name: string, mb: MeshBuilder, gloss: number): void => {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(1, 1, 1); m.diffuseVertexColor = true; m.useMetalness = true; m.metalness = 0; m.gloss = gloss;
      m.cull = pc.CULLFACE_NONE; m.update();
      const e = new pc.Entity(name);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mb.toMesh(device, false), m)], castShadows: true, receiveShadows: true });
      this.root.addChild(e);
      this.triangles += mb.idx.length / 3;
    };
    mk('tree-trunks', trunks, 0.15);
    mk('tree-leaves', leaves, 0.12);
  }

  // ------------------------------------------------------------------ glass (hardware instanced)
  private buildGlass(): void {
    const panes = this.map.dyn.filter((d) => d.kind === 'glass');
    if (panes.length === 0) return;
    const device = this.engine.device;
    const mb = new MeshBuilder();
    mb.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    const mesh = mb.toMesh(device, false);
    this.glassData = new Float32Array(panes.length * 16);
    const m = new pc.Mat4();
    panes.forEach((d, i) => {
      const b = this.map.world.boxes[d.boxes[0]];
      m.setTRS(new pc.Vec3(d.x, d.y, d.z), pc.Quat.IDENTITY, new pc.Vec3(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ));
      this.glassData.set(m.data, i * 16);
      this.glassIndex.set(d.id, i);
    });
    const vb = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), panes.length, { usage: pc.BUFFER_DYNAMIC, data: this.glassData });
    const mi = new pc.MeshInstance(mesh, this.assets.materials[MAT.GLASS]);
    mi.setInstancing(vb);
    mi.cull = false;
    this.glassInstance = mi;
    this.glassBuffer = vb;
    const e = new pc.Entity('glass');
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
    this.root.addChild(e);
  }

  // ------------------------------------------------------------------ props
  private buildProps(): void {
    const big = new Set(['covered_car', 'concrete_road_barrier', 'concrete_road_barrier_02', 'old_military_compressor', 'wooden_crate_02', 'Barrel_01', 'barrel_03', 'old_military_crate', 'wooden_military_crate', 'metal_office_desk', 'portable_generator', 'street_lamp_01',
      'tank_m1a2', 'tank_t80', 'wreck_cars', 'wreck_sedan', 'van_izh', 'pickup_c10']);
    for (const p of this.map.props) {
      const def = PROPS[p.model];
      let model: pc.Entity;
      try { model = this.assets.instantiate(p.model); } catch { continue; }
      const holder = new pc.Entity(`prop-${p.model}`);
      holder.setPosition(p.x, p.y, p.z);
      holder.setEulerAngles(0, p.yaw * pc.math.RAD_TO_DEG, 0);
      const cx = (def.min[0] + def.max[0]) / 2, cz = (def.min[2] + def.max[2]) / 2;
      model.setLocalScale(p.scale, p.scale, p.scale);
      model.setLocalPosition(-cx * p.scale, -def.min[1] * p.scale, -cz * p.scale);
      holder.addChild(model);
      const isBig = big.has(p.model);
      for (const r of model.findComponents('render') as pc.RenderComponent[]) {
        r.castShadows = isBig; r.receiveShadows = true;
        for (const mi of r.meshInstances) sanitizeMaterial(mi.material as pc.StandardMaterial);
      }
      this.root.addChild(holder);
      const view: PropView = { entity: holder, x: p.x, z: p.z, dyn: p.dyn, big: isBig };
      this.props.push(view);
      if (p.dyn >= 0) this.dynProps.set(p.dyn, view);
    }
  }

  private buildLights(): void {
    const max = this.engine.preset.localLights;
    const lights = this.map.lights.slice(0, max);
    for (const l of lights) {
      const e = new pc.Entity('lamp');
      e.addComponent('light', {
        type: 'omni', color: new pc.Color(l.color[0], l.color[1], l.color[2]), intensity: l.intensity * 1.6, range: l.range,
        castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
      });
      e.setPosition(l.x, l.y, l.z);
      this.root.addChild(e);
    }
  }

  private buildObjectiveMarkers(): void {
    const device = this.engine.device;
    for (const o of this.map.objectives) {
      const ring = new MeshBuilder();
      const segs = 64, w = 0.22;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const r0 = o.radius - w, r1 = o.radius;
        ring.quad(Math.cos(a0) * r0, 0, Math.sin(a0) * r0, Math.cos(a0) * r1, 0, Math.sin(a0) * r1, Math.cos(a1) * r1, 0, Math.sin(a1) * r1, Math.cos(a1) * r0, 0, Math.sin(a1) * r0);
      }
      const mat = new pc.StandardMaterial();
      mat.diffuse = new pc.Color(0, 0, 0); mat.emissive = new pc.Color(1, 1, 1); mat.emissiveIntensity = 2.2;
      mat.useLighting = false; mat.cull = pc.CULLFACE_NONE; mat.depthWrite = false; mat.blendType = pc.BLEND_ADDITIVE; mat.opacity = 0.9;
      mat.depthBias = -2; mat.slopeDepthBias = -2;
      mat.update();
      const e = new pc.Entity(`objective-${o.id}`);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(ring.toMesh(device, false), mat)], castShadows: false, receiveShadows: false });
      e.setPosition(o.x, o.y + 0.05, o.z);
      this.root.addChild(e);

      // tall translucent beam so the objective reads from across the map
      const beamB = new MeshBuilder();
      beamB.cylinder(0, 0, 0, 0, 45, 0, 0.3, 0.3, 10, false);
      const beam = new pc.StandardMaterial();
      beam.diffuse = new pc.Color(0, 0, 0); beam.emissive = new pc.Color(1, 1, 1); beam.emissiveIntensity = 0.6;
      beam.useLighting = false; beam.cull = pc.CULLFACE_NONE; beam.depthWrite = false; beam.blendType = pc.BLEND_ADDITIVE; beam.opacity = 0.05;
      beam.update();
      const be = new pc.Entity(`beam-${o.id}`);
      be.addComponent('render', { meshInstances: [new pc.MeshInstance(beamB.toMesh(device, false), beam)], castShadows: false, receiveShadows: false });
      be.setPosition(o.x, o.y + 9, o.z);
      this.root.addChild(be);
      this.rings.push({ mat, beam });
    }
  }

  setObjectiveOwner(index: number, owner: TeamId, contested: boolean, pulse: number): void {
    const r = this.rings[index];
    if (!r) return;
    const c = TEAM_COLORS[owner];
    const k = contested ? 0.55 + 0.45 * Math.sin(pulse * 9) : 1;
    r.mat.emissive.set(c[0] * k, c[1] * k, c[2] * k);
    r.mat.update();
    r.beam.emissive.set(c[0], c[1], c[2]);
    r.beam.update();
  }

  // ------------------------------------------------------------------ destructibles
  /** Mirror a destroyed / restored dynamic entity (also toggles the client collision world). */
  setDynAlive(id: number, alive: boolean): void {
    const d = this.map.dyn[id];
    if (!d) return;
    for (const b of d.boxes) this.map.world.setEnabled(b, alive);
    if (d.kind === 'glass') {
      const i = this.glassIndex.get(id);
      if (i === undefined || !this.glassBuffer) return;
      const b = this.map.world.boxes[d.boxes[0]];
      const m = new pc.Mat4();
      m.setTRS(new pc.Vec3(d.x, alive ? d.y : -500, d.z), pc.Quat.IDENTITY, alive ? new pc.Vec3(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) : new pc.Vec3(0.001, 0.001, 0.001));
      this.glassData.set(m.data, i * 16);
      this.glassBuffer.setData(this.glassData);
    } else {
      const v = this.dynProps.get(id);
      if (v) v.entity.enabled = alive;
    }
  }

  resetDyn(): void {
    for (const d of this.map.dyn) this.setDynAlive(d.id, true);
  }

  /** Distance based prop culling (cheap LOD) – call every frame, work is throttled. */
  update(dt: number, camX: number, camZ: number): void {
    this.cullT -= dt;
    if (this.cullT > 0) return;
    this.cullT = 0.3;
    const far = this.engine.preset.propDistance, near = far * 0.5;
    for (const p of this.props) {
      if (p.dyn >= 0 && !this.dynProps.get(p.dyn)?.entity.enabled && !p.entity.enabled) continue;
      const d = Math.hypot(p.x - camX, p.z - camZ);
      const visible = d < (p.big ? far : near);
      if (p.dyn >= 0) { if (!visible) p.entity.enabled = false; else if (this.dynAliveFlag(p.dyn)) p.entity.enabled = true; }
      else p.entity.enabled = visible;
    }
  }

  private dynAliveFlag(id: number): boolean {
    const d = this.map.dyn[id];
    return this.map.world.boxes[d.boxes[0]].enabled;
  }

  destroy(): void { this.root.destroy(); }
}
