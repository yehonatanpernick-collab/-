import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldData } from '../data/WorldData';
import type { Physics } from '../core/Physics';
import type { QualityPreset } from '../core/Quality';
import type { GeoBuf, TileResult } from './TileWorker';
import { buildingFarMaterial, buildingMaterial, concreteMaterial, roadMaterial, sidewalkMaterial, terrainMaterial } from './Materials';
import { FurnitureSystem, TreeSystem } from './Props';

interface TileState {
  i: number; j: number; key: string;
  lod: number;            // currently displayed LOD (-1 none)
  wantLod: number;
  pending: number;        // LOD requested from worker (-1 none)
  group: THREE.Group | null;
  colliders: RAPIER.Collider[];
  colliderLod: number;    // -1 none, otherwise LOD the colliders came from
  terrainBuf?: GeoBuf;
  colBuf?: { b?: GeoBuf; br?: GeoBuf; pr?: GeoBuf };
  trees?: Float32Array; furniture?: Float32Array;
  names: TileResult['names'];
  lastSeen: number;
  bytes: number;
}

/**
 * Geographic world streaming: 500 m tiles over the real San Francisco extent.
 * - predictive loading from position + velocity (different horizons for driving and flight)
 * - 4 LOD levels per tile with hysteresis
 * - background geometry generation in a worker pool, bounded main-thread upload per frame
 * - physics colliders only near the player, memory budgeting and unloading of distant tiles
 */
export class WorldStreamer {
  root = new THREE.Group();
  trees = new TreeSystem();
  furniture = new FurnitureSystem();
  tiles = new Map<string, TileState>();
  private workers: Worker[] = [];
  private busy: number[] = [];
  private jobs = new Map<number, { key: string; lod: number; w: number }>();
  private jobId = 1;
  private results: TileResult[] = [];
  private mats: Record<string, THREE.Material>;
  private propsDirty = true;
  private propsTimer = 0;
  private lastPropsCenter = new THREE.Vector2(1e9, 1e9);
  readyCount = 0;
  stats = { loaded: 0, pending: 0, colliders: 0, buildings: 0, memMB: 0 };
  focus = new THREE.Vector3();
  labels: TileResult['names'] = [];
  onTileApplied?: (t: TileState) => void;

  constructor(private world: WorldData, private physics: Physics, public quality: QualityPreset) {
    this.mats = {
      terrain: terrainMaterial(), road: roadMaterial(), side: sidewalkMaterial(), bridge: concreteMaterial(0x8f8b84, 0.85),
      building: buildingMaterial(), buildingFar: buildingFarMaterial(), pier: concreteMaterial(0x7a6c5c, 0.95),
    };
    (this.mats.side as THREE.Material).side = THREE.DoubleSide;
    (this.mats.bridge as THREE.Material).side = THREE.DoubleSide;
    this.root.add(this.trees.group, this.furniture.group);
  }

  async init(nWorkers: number): Promise<void> {
    const ready: Promise<void>[] = [];
    for (let k = 0; k < nWorkers; k++) {
      const w = new Worker(new URL('./TileWorker.ts', import.meta.url), { type: 'module' });
      this.workers.push(w); this.busy.push(0);
      ready.push(new Promise((res) => {
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'ready') { this.readyCount++; res(); return; }
          const job = this.jobs.get(m.id);
          this.jobs.delete(m.id);
          if (job) this.busy[job.w]--;
          if (m.type === 'tile') this.results.push(m.result);
          else if (m.type === 'error') { console.warn('tile error', m.error); const t = job && this.tiles.get(job.key); if (t) t.pending = -1; }
        };
      }));
      w.postMessage({ type: 'init', base: new URL('./data/', location.href).href });
    }
    await Promise.all(ready);
  }

  /** desired LOD for a tile at distance d */
  private lodFor(d: number, flying: boolean): number {
    const q = this.quality;
    const view = flying ? q.flightViewDistance : q.viewDistance;
    if (d < q.detailDistance) return 0;
    if (d < q.detailDistance * 1.9) return 1;
    if (d < view * 0.7) return 2;
    if (d < view) return 3;
    return -1;
  }

  /** Main per-frame update. pos = player position, vel = velocity (m/s). */
  update(pos: THREE.Vector3, vel: THREE.Vector3, flying: boolean, time: number): void {
    const T = this.world.tileSize, g = this.world.meta.grid;
    const horizon = flying ? 4.0 : 2.0;
    this.focus.set(pos.x + vel.x * horizon, pos.y, pos.z + vel.z * horizon);
    const view = (flying ? this.quality.flightViewDistance : this.quality.viewDistance) + T;
    const i0 = Math.max(Math.floor(g.x0 / T), Math.floor((pos.x - view) / T)), i1 = Math.min(Math.floor((g.x1 - 1) / T), Math.floor((pos.x + view) / T));
    const j0 = Math.max(Math.floor(g.z0 / T), Math.floor((pos.z - view) / T)), j1 = Math.min(Math.floor((g.z1 - 1) / T), Math.floor((pos.z + view) / T));
    const want: { t: TileState; pri: number }[] = [];
    // altitude extends the useful view distance
    const altBoost = flying ? Math.min(1.6, 1 + Math.max(0, pos.y - 150) / 600) : 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = (i + 0.5) * T, cz = (j + 0.5) * T;
      // distance from the tile rectangle (not centre) to the player, and to the predicted focus
      const dx = Math.max(Math.abs(pos.x - cx) - T / 2, 0), dz = Math.max(Math.abs(pos.z - cz) - T / 2, 0);
      const d = Math.hypot(dx, dz) / altBoost;
      const fdx = Math.max(Math.abs(this.focus.x - cx) - T / 2, 0), fdz = Math.max(Math.abs(this.focus.z - cz) - T / 2, 0);
      const fd = Math.hypot(fdx, fdz) / altBoost;
      const dd = Math.min(d, fd);
      let lod = this.lodFor(dd, flying);
      if (lod < 0) continue;
      const key = `${i}_${j}`;
      let t = this.tiles.get(key);
      if (!t) {
        t = { i, j, key, lod: -1, wantLod: lod, pending: -1, group: null, colliders: [], colliderLod: -1, names: [], lastSeen: time, bytes: 0 };
        this.tiles.set(key, t);
      }
      // hysteresis: only coarsen when clearly beyond the threshold
      if (t.lod >= 0 && lod > t.lod) {
        const lodH = this.lodFor(dd * 0.85, flying);
        if (lodH <= t.lod) lod = t.lod;
      }
      t.wantLod = lod; t.lastSeen = time;
      if (t.lod !== lod && t.pending !== lod) want.push({ t, pri: dd + (t.lod < 0 ? 0 : 400) - (lod === 0 ? 200 : 0) });
      // colliders near the player
      this.updateColliders(t, Math.hypot(dx, dz));
    }
    // dispatch build jobs (closest first)
    want.sort((a, b) => a.pri - b.pri);
    for (const { t } of want) {
      const w = this.freeWorker();
      if (w < 0) break;
      const id = this.jobId++;
      this.jobs.set(id, { key: t.key, lod: t.wantLod, w });
      this.busy[w]++;
      t.pending = t.wantLod;
      this.workers[w].postMessage({ type: 'build', id, i: t.i, j: t.j, lod: t.wantLod });
    }
    // apply finished results with a per-frame budget
    let budget = this.quality.maxTileBuildsPerFrame + (this.results.length > 12 ? 2 : 0);
    this.results.sort((a, b) => a.lod - b.lod);
    while (budget-- > 0 && this.results.length) this.apply(this.results.shift()!);
    // unload far tiles
    const unloadR = view * 1.2;
    for (const [key, t] of this.tiles) {
      const cx = (t.i + 0.5) * T, cz = (t.j + 0.5) * T;
      if (Math.hypot(pos.x - cx, pos.z - cz) > unloadR && time - t.lastSeen > 2) {
        this.disposeTile(t); this.tiles.delete(key); this.propsDirty = true;
      }
    }
    // instanced props refresh (throttled)
    this.propsTimer -= 1 / 60;
    if (this.propsDirty || (this.propsTimer <= 0 && this.lastPropsCenter.distanceTo(new THREE.Vector2(pos.x, pos.z)) > 40)) {
      if (this.propsTimer <= 0) {
        this.refreshProps(pos);
        this.propsTimer = 0.6;
      }
    }
    this.stats.loaded = [...this.tiles.values()].filter((t) => t.lod >= 0).length;
    this.stats.pending = this.jobs.size + this.results.length;
  }

  private freeWorker(): number {
    let best = -1, bl = 2;
    this.busy.forEach((b, k) => { if (b < bl) { bl = b; best = k; } });
    return best;
  }

  private geo(buf: GeoBuf, normals = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    for (const [name, [arr, size, norm]] of Object.entries(buf.attrs)) {
      if (!normals && name === 'normal') continue;
      g.setAttribute(name, new THREE.BufferAttribute(arr, size, !!norm));
    }
    g.setIndex(new THREE.BufferAttribute(buf.index, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  private apply(r: TileResult): void {
    const t = this.tiles.get(`${r.i}_${r.j}`);
    if (!t) return;
    if (t.pending === r.lod) t.pending = -1;
    if (r.lod !== t.wantLod && t.lod >= 0 && Math.abs(r.lod - t.wantLod) > 1) return; // stale
    const group = new THREE.Group();
    group.name = `tile_${t.key}_lod${r.lod}`;
    let bytes = 0;
    const add = (buf: GeoBuf | undefined, mat: THREE.Material, cast: boolean, recv = true, normals = true) => {
      if (!buf) return null;
      const m = new THREE.Mesh(this.geo(buf, normals), mat);
      m.castShadow = cast; m.receiveShadow = recv;
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
      bytes += buf.index.byteLength + Object.values(buf.attrs).reduce((s, a) => s + a[0].byteLength, 0);
      return m;
    };
    add(r.terrain, this.mats.terrain, false, true);
    add(r.roads, this.mats.road, false, true);
    add(r.sidewalks, this.mats.side, false, true);
    add(r.bridges, this.mats.bridge, r.lod <= 1, true);
    add(r.piers, this.mats.pier, false, true);
    add(r.buildings, r.lod <= 1 ? this.mats.building : this.mats.buildingFar, r.lod <= 1, r.lod <= 1);
    if (t.group) { this.root.remove(t.group); this.disposeGroup(t.group); }
    t.group = group; t.lod = r.lod; t.bytes = bytes;
    this.root.add(group);
    t.terrainBuf = r.terrain;
    if (r.lod === 0) t.colBuf = { b: r.colBuildings, br: r.colBridges, pr: r.colPiers };
    else if (!t.colBuf || r.colBridges) t.colBuf = { ...(t.colBuf ?? {}), br: r.colBridges ?? t.colBuf?.br };
    if (r.trees) t.trees = r.trees;
    if (r.furniture) t.furniture = r.furniture;
    else if (r.lod > 0) t.furniture = undefined;
    if (r.lod >= 2) t.trees = undefined;
    t.names = r.names;
    this.propsDirty = true;
    // colliders must be rebuilt if their source changed
    if (t.colliders.length && t.colliderLod !== r.lod && (r.lod === 0 || t.colliderLod === 0)) this.dropColliders(t);
    this.onTileApplied?.(t);
    this.stats.memMB = [...this.tiles.values()].reduce((s, x) => s + x.bytes, 0) / 1e6;
    this.labels = [...this.tiles.values()].flatMap((x) => x.names);
  }

  private updateColliders(t: TileState, d: number): void {
    const near = d < this.quality.colliderDistance;
    if (near && !t.colliders.length && t.terrainBuf && t.lod >= 0 && t.lod <= 1) {
      const p = this.physics;
      const tb = t.terrainBuf;
      const c = p.trimesh(tb.attrs.position[0] as Float32Array, tb.index, 1.0);
      if (c) t.colliders.push(c);
      if (t.colBuf) {
        for (const b of [t.colBuf.b, t.colBuf.br, t.colBuf.pr]) {
          if (!b) continue;
          const cc = p.trimesh(b.attrs.position[0] as Float32Array, b.index, 0.6);
          if (cc) t.colliders.push(cc);
        }
      }
      t.colliderLod = t.lod;
      this.stats.colliders += t.colliders.length;
    } else if (!near && t.colliders.length && d > this.quality.colliderDistance + 150) {
      this.dropColliders(t);
    }
  }

  private dropColliders(t: TileState): void {
    for (const c of t.colliders) this.physics.remove(c);
    this.stats.colliders -= t.colliders.length;
    t.colliders = []; t.colliderLod = -1;
  }

  /** true when the ground under (x,z) has a physics collider */
  hasCollider(x: number, z: number): boolean {
    const T = this.world.tileSize;
    const t = this.tiles.get(`${Math.floor(x / T)}_${Math.floor(z / T)}`);
    return !!t && t.colliders.length > 0;
  }

  private refreshProps(pos: THREE.Vector3): void {
    this.propsDirty = false;
    this.lastPropsCenter.set(pos.x, pos.z);
    const trees: Float32Array[] = [], furn: Float32Array[] = [];
    for (const t of this.tiles.values()) { if (t.trees) trees.push(t.trees); if (t.furniture) furn.push(t.furniture); }
    this.trees.update(trees, pos.x, pos.z, Math.min(380, this.quality.treeDistance), this.quality.treeDistance);
    this.furniture.update(furn, pos.x, pos.z, this.quality.detailDistance * 0.7, (x, z) => this.world.heightAt(x, z));
  }

  private disposeGroup(g: THREE.Group): void {
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }

  private disposeTile(t: TileState): void {
    if (t.group) { this.root.remove(t.group); this.disposeGroup(t.group); }
    this.dropColliders(t);
    t.group = null;
  }

  /** wait until the tiles around a point are built (initial spawn) */
  async preload(pos: THREE.Vector3, progress: (p: number) => void): Promise<void> {
    const zero = new THREE.Vector3();
    for (let k = 0; k < 600; k++) {
      this.update(pos, zero, false, performance.now() / 1000);
      while (this.results.length) this.apply(this.results.shift()!);
      const near = [...this.tiles.values()].filter((t) => t.wantLod <= 1);
      const done = near.filter((t) => t.lod === t.wantLod).length;
      progress(near.length ? done / near.length : 0);
      if (near.length && done === near.length) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    this.update(pos, zero, false, performance.now() / 1000);
    this.refreshProps(pos);
  }

  setQuality(q: QualityPreset): void { this.quality = q; this.propsDirty = true; }
}
