import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, type Physics } from '../engine/physics';
import { loadBinary, dirOf } from '../engine/assets';

const BASE = import.meta.env.BASE_URL;
export interface TileInfo { k: string; x: number; z: number; n: number; h: number; tris: number }
export interface WorldInfo { origin: [number, number]; m: [number, number]; tile: number; bounds: [number, number, number, number]; tiles: TileInfo[]; sidewalkY: number }
export interface Footprint { p: number[]; h: number }

/** detail meshes hidden beyond LOD distance */
const DETAIL = new Set(['CORNICE', 'PAINT', 'SHOP', 'CURB', 'SIDEWALK', 'SEAWALL']);

class Tile {
  group?: THREE.Group;
  detail: THREE.Mesh[] = [];
  state: 'idle' | 'loading' | 'ready' = 'idle';
  foot?: Footprint[];
  bodies: RAPIER.RigidBody[] = [];
  colliding = false;
  constructor(public info: TileInfo) {}
  static size = 500;
  get cx() { return this.info.x + Tile.size / 2; }
  get cz() { return this.info.z + Tile.size / 2; }
  /** distance from a point to this tile's square (0 inside) */
  dist(x: number, z: number) { const dx = Math.max(this.info.x - x, 0, x - this.info.x - Tile.size), dz = Math.max(this.info.z - z, 0, z - this.info.z - Tile.size); return Math.hypot(dx, dz); }
}

export class World {
  info!: WorldInfo;
  tiles: Tile[] = [];
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private inflight = 0;
  root = new THREE.Group();
  loadRadius = 2300;
  lodRadius = 700;
  physRadius = 120;
  onFootprints?: (f: Footprint[]) => void;
  progress = 0;

  constructor(private scene: THREE.Scene, private mats: Record<string, THREE.Material>, private physics: Physics) { scene.add(this.root); }

  async init() {
    this.info = await (await fetch(`${BASE}data/world.json`)).json();
    Tile.size = this.info.tile; this.tiles = this.info.tiles.map((t) => new Tile(t));
    // water plane under everything (land tiles cover it); river edges show the sea wall
    const water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), this.mats.WATER);
    water.position.y = -1.1; water.receiveShadow = true; this.scene.add(water);
  }

  /** load everything within `radius` before play starts (shows progress) */
  async preload(at: THREE.Vector3, radius: number, onProgress: (f: number) => void) {
    const need = this.tiles.filter((t) => t.dist(at.x, at.z) < radius);
    let done = 0;
    await Promise.all(need.map(async (t) => { await this.load(t); done++; onProgress(done / need.length); }));
  }

  private async load(t: Tile) {
    if (t.state !== 'idle') return;
    t.state = 'loading'; this.inflight++;
    try {
      const url = `${BASE}data/tiles/${t.info.k}.glb`;
      const gltf = await this.loader.parseAsync(await loadBinary(url), dirOf(url));
      const foot = { b: ((gltf.scene as any).userData?.b || []) as Footprint[] };
      const g = gltf.scene as unknown as THREE.Group;
      g.traverse((o: any) => {
        if (!o.isMesh) return;
        const key = (o.material?.userData?.key || o.material?.name || o.name || '').replace(/[._].*$/, '');
        const mat = this.mats[key];
        if (mat) o.material = mat;
        const isGround = key === 'ROAD' || key === 'SIDEWALK' || key === 'GRASS' || key === 'PAINT' || key === 'CURB';
        o.castShadow = !isGround && key !== 'ROOF';
        o.receiveShadow = true;
        o.matrixAutoUpdate = false; o.updateMatrix();
        if (DETAIL.has(key)) t.detail.push(o);
        o.userData.key = key;
      });
      g.updateMatrixWorld(true);
      t.group = g; t.foot = foot.b;
      this.root.add(g);
      this.onFootprints?.(foot.b);
      t.state = 'ready';
    } catch (e) {
      console.warn('tile failed', t.info.k, e); t.state = 'idle';
    } finally { this.inflight--; }
  }

  private unload(t: Tile) {
    if (!t.group) return;
    this.root.remove(t.group);
    t.group.traverse((o: any) => { if (o.isMesh) o.geometry.dispose(); });
    t.group = undefined; t.detail = []; t.state = 'idle';
    this.setColliders(t, false);
  }

  /** building convex hulls + curb/sidewalk trimeshes for tiles near the car */
  private setColliders(t: Tile, on: boolean) {
    if (on === t.colliding) return;
    const w = this.physics.world;
    if (!on) { for (const b of t.bodies) w.removeRigidBody(b); t.bodies = []; t.colliding = false; return; }
    if (!t.foot || !t.group) return;
    const body = w.createRigidBody(R.RigidBodyDesc.fixed());
    for (const f of t.foot) {
      const n = f.p.length / 2; const pts = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) { const x = f.p[i * 2], z = f.p[i * 2 + 1]; pts.set([x, 0, z, x, f.h, z], i * 6); }
      const desc = R.ColliderDesc.convexHull(pts);
      if (desc) w.createCollider(desc.setFriction(0.6).setRestitution(0.05), body);
    }
    // sidewalks + curbs as triangle meshes so wheels ride up the 15 cm curb
    t.group.traverse((o: any) => {
      if (!o.isMesh || (o.userData.key !== 'SIDEWALK' && o.userData.key !== 'CURB')) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index; if (!idx) return;
      const v = new Float32Array(pos.count * 3), p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); v.set([p.x, p.y, p.z], i * 3); }
      w.createCollider(R.ColliderDesc.trimesh(v, new Uint32Array(idx.array)).setFriction(1.0), body);
    });
    t.bodies.push(body); t.colliding = true;
  }

  update(cam: THREE.Vector3, player: THREE.Vector3) {
    const wantLoad: Tile[] = [];
    for (const t of this.tiles) {
      const d = t.dist(cam.x, cam.z);
      if (t.state === 'idle' && d < this.loadRadius) wantLoad.push(t);
      else if (t.state === 'ready' && d > this.loadRadius + 400) this.unload(t);
      if (t.state === 'ready') {
        const near = d < this.lodRadius + Math.min(800, t.info.h * 2);
        for (const m of t.detail) m.visible = near;
        const dp = t.dist(player.x, player.z);
        this.setColliders(t, dp < this.physRadius);
      }
    }
    wantLoad.sort((a, b) => a.dist(cam.x, cam.z) - b.dist(cam.x, cam.z));
    for (const t of wantLoad) { if (this.inflight >= 6) break; this.load(t); }
    const ready = this.tiles.filter((t) => t.state === 'ready').length;
    this.progress = ready / this.tiles.length;
  }

  /** street level height at x,z (0 road, 0.15 on sidewalks) via physics ray */
  groundAt(x: number, z: number, fromY = 2000) {
    const toi = this.physics.castRay(x, fromY, z, 0, -1, 0, fromY + 5);
    return toi == null ? 0 : fromY - toi;
  }
}
