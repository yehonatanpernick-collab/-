import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PedsData, WorldData } from '../data/WorldData';
import type { RoadGraph } from './RoadGraph';
import type { SignalSystem } from './TrafficManager';

/**
 * Pedestrian AI on the real San Francisco footway network (OSM sidewalks, crossings, paths, steps).
 * Falls back to procedural kerbside sidewalks along the road graph where footways are not mapped.
 * Animated, pooled Mixamo-rigged characters with walk/run/idle blending; waits at signalised
 * crossings, separates from other pedestrians and dodges approaching vehicles.
 */
interface PEdge { a: number; b: number; kind: number; sub: number; pts: Float32Array; cum: Float32Array; len: number }
interface Ped {
  edge: number; dir: 1 | -1; s: number; side: number; speed: number; baseSpeed: number;
  x: number; y: number; z: number; yaw: number;
  state: 'walk' | 'wait' | 'idle' | 'flee'; t: number; fleeDir: THREE.Vector2;
  road: boolean; // walking on a procedural kerbside path (road edge id in `edge`)
  model: Model | null;
}
interface Model { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>; cur: string; busy: boolean }

export class PedestrianManager {
  group = new THREE.Group();
  private edges: PEdge[] = [];
  private nodeEdges = new Map<number, number[]>();
  private grid = new Map<number, number[]>();
  private peds: Ped[] = [];
  private pool: Model[] = [];
  maxPeds = 30;
  private templates: { scene: THREE.Object3D; scale: number; clips: THREE.AnimationClip[] }[] = [];
  private ready = false;
  timeFn: () => number = () => performance.now() / 1000;

  constructor(data: PedsData, private world: WorldData, private graph: RoadGraph, private signals: SignalSystem) {
    data.e.forEach((r) => {
      const pts = new Float32Array(r[4]);
      const n = pts.length / 2, cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
      const id = this.edges.length;
      this.edges.push({ a: r[0], b: r[1], kind: r[2], sub: r[3], pts, cum, len: cum[n - 1] });
      for (const nd of [r[0], r[1]]) { let l = this.nodeEdges.get(nd); if (!l) this.nodeEdges.set(nd, (l = [])); l.push(id); }
      const cx = Math.floor(pts[0] / 200), cz = Math.floor(pts[1] / 200);
      const key = cx * 100000 + cz;
      let l = this.grid.get(key); if (!l) this.grid.set(key, (l = [])); l.push(id);
    });
  }

  async load(urls: string[]): Promise<void> {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    for (const u of urls) {
      const g = await loader.loadAsync(u);
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      const h = box.max.y - box.min.y || 1;
      // native clips, normalised names (idle / walk / run), in place (no root translation)
      const clips = g.animations.map((c) => { const cl = c.clone(); cl.name = c.name.toLowerCase(); cl.tracks = cl.tracks.filter((t) => !(t.name.endsWith('.position') && !/Hips/i.test(t.name))); for (const t of cl.tracks) if (/Hips\.position/i.test(t.name)) { const v = t.values; for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; } } return cl; });
      this.templates.push({ scene: g.scene, scale: 1.72 / h, clips });
    }
    this.ready = true;
  }

  private makeModel(k: number): Model {
    const t = this.templates[k % this.templates.length];
    const root = SkeletonUtils.clone(t.scene);
    root.scale.setScalar(t.scale * (0.93 + Math.random() * 0.12));
    const tint = new THREE.Color().setHSL(Math.random(), 0.45, 0.3 + Math.random() * 0.3);
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true; m.frustumCulled = false;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        // clothing variety: tint the body material (mannequin joints stay neutral)
        if (!/Joints/i.test(mat.name)) mat.color = new THREE.Color(1, 1, 1).lerp(tint, k % 2 === 0 ? 0.85 : 0.4);
        m.material = mat;
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const c of t.clips) actions[c.name] = mixer.clipAction(c);
    actions.walk?.play();
    this.group.add(root);
    return { root, mixer, actions, cur: 'walk', busy: false };
  }

  private edgesNear(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    for (let gx = Math.floor((x - r) / 200); gx <= Math.floor((x + r) / 200); gx++)
      for (let gz = Math.floor((z - r) / 200); gz <= Math.floor((z + r) / 200); gz++) out.push(...(this.grid.get(gx * 100000 + gz) ?? []));
    return out;
  }

  private sampleEdge(p: Ped, out: { x: number; z: number; tx: number; tz: number }): void {
    if (p.road) {
      const e = this.graph.edges[p.edge];
      const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
      const s = p.dir === 1 ? p.s : e.len - p.s;
      this.graph.sample(e, s, o);
      const off = e.w / 2 + 1.4;
      out.x = o.x - o.tz * off * p.side; out.z = o.z + o.tx * off * p.side;
      out.tx = o.tx * p.dir; out.tz = o.tz * p.dir;
      return;
    }
    const e = this.edges[p.edge];
    const s = Math.max(0, Math.min(e.len, p.dir === 1 ? p.s : e.len - p.s));
    let lo = 0, hi = e.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
    const seg = Math.max(1e-6, e.cum[hi] - e.cum[lo]), t = (s - e.cum[lo]) / seg;
    const x0 = e.pts[2 * lo], z0 = e.pts[2 * lo + 1], x1 = e.pts[2 * hi], z1 = e.pts[2 * hi + 1];
    out.x = x0 + (x1 - x0) * t; out.z = z0 + (z1 - z0) * t;
    out.tx = ((x1 - x0) / seg) * p.dir; out.tz = ((z1 - z0) / seg) * p.dir;
  }

  private spawn(px: number, pz: number, r: number): void {
    const ang = Math.random() * Math.PI * 2, d = 22 + Math.pow(Math.random(), 1.6) * r; // denser near the player
    const x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
    const cands = this.edgesNear(x, z, 60).filter((i) => this.edges[i].len > 8 && this.edges[i].kind !== 4);
    let p: Ped;
    const base = 1.1 + Math.random() * 0.5;
    if (cands.length) {
      const id = cands[Math.floor(Math.random() * cands.length)];
      const e = this.edges[id];
      p = { edge: id, dir: Math.random() < 0.5 ? 1 : -1, s: Math.random() * e.len, side: 0, speed: base, baseSpeed: base, x: 0, y: 0, z: 0, yaw: 0, state: 'walk', t: 0, fleeDir: new THREE.Vector2(), road: false, model: null };
    } else {
      // fallback: procedural sidewalk along a real street
      const n = this.graph.nearest(x, z, 80, (e) => e.cls >= 2 && e.cls <= 6 && !e.el);
      if (!n) return;
      const e = this.graph.edges[n.edge];
      p = { edge: n.edge, dir: Math.random() < 0.5 ? 1 : -1, s: Math.random() * e.len, side: Math.random() < 0.5 ? 1 : -1, speed: base, baseSpeed: base, x: 0, y: 0, z: 0, yaw: 0, state: 'walk', t: 0, fleeDir: new THREE.Vector2(), road: true, model: null };
    }
    this.place(p);
    if (Math.hypot(p.x - px, p.z - pz) < 20) return;
    this.peds.push(p);
  }

  private place(p: Ped): void {
    const o = { x: 0, z: 0, tx: 0, tz: 0 };
    this.sampleEdge(p, o);
    p.x = o.x; p.z = o.z;
    p.y = this.world.heightAt(p.x, p.z) + 0.14;
    const yaw = Math.atan2(o.tx, o.tz);
    let dy = yaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * 0.15;
  }

  private nextEdge(p: Ped): boolean {
    if (p.road) {
      const e = this.graph.edges[p.edge];
      const node = p.dir === 1 ? e.b : e.a;
      const opts = this.graph.nodeEdges[node].filter((id) => id !== p.edge && !this.graph.edges[id].tunnel && !this.graph.edges[id].el);
      if (!opts.length) { p.dir = (-p.dir) as 1 | -1; p.s = 0; return true; }
      const id = opts[Math.floor(Math.random() * opts.length)];
      const f = this.graph.edges[id];
      p.edge = id; p.dir = f.a === node ? 1 : -1; p.s = 0;
      return true;
    }
    const e = this.edges[p.edge];
    const node = p.dir === 1 ? e.b : e.a;
    const opts = (this.nodeEdges.get(node) ?? []).filter((id) => id !== p.edge && this.edges[id].kind !== 4);
    if (!opts.length) { p.dir = (-p.dir) as 1 | -1; p.s = 0; return true; }
    const id = opts[Math.floor(Math.random() * opts.length)];
    const f = this.edges[id];
    // signalised crosswalk: wait for cars to have red
    if (f.sub === 2) {
      const n = this.graph.nearest(f.pts[0], f.pts[1], 25);
      if (n) {
        const re = this.graph.edges[n.edge];
        const node2 = this.graph.signal[re.a] ? re.a : this.graph.signal[re.b] ? re.b : -1;
        if (node2 >= 0) {
          const g = this.signals.group(node2, re);
          if (this.signals.state(node2, g, this.timeFn()) !== 2 && p.state !== 'wait') { p.state = 'wait'; p.t = 0; return false; }
        }
      }
    }
    p.edge = id; p.dir = f.a === node ? 1 : -1; p.s = 0;
    return true;
  }

  private setAnim(m: Model, name: string, speed: number): void {
    const a = m.actions[name];
    if (!a) return;
    a.timeScale = speed;
    if (m.cur === name) return;
    const prev = m.actions[m.cur];
    a.reset().play();
    if (prev) a.crossFadeFrom(prev, 0.35, false);
    m.cur = name;
  }

  update(dt: number, player: { x: number; z: number; vx: number; vz: number; speed: number }, flying: boolean): void {
    if (!this.ready) return;
    const R = flying ? 160 : 170;
    // spawn / despawn
    const target = flying ? Math.floor(this.maxPeds * 0.5) : this.maxPeds;
    let budget = 3;
    while (this.peds.length < target && budget-- > 0) this.spawn(player.x, player.z, R);
    this.peds = this.peds.filter((p) => {
      const keep = Math.hypot(p.x - player.x, p.z - player.z) < R + 60;
      if (!keep && p.model) { p.model.busy = false; p.model.root.visible = false; p.model = null; }
      return keep;
    });
    for (const p of this.peds) {
      p.t += dt;
      // vehicle avoidance: flee sideways from a fast-approaching player
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      const closing = -(dx * player.vx + dz * player.vz) / Math.max(d, 0.1);
      if (d < 14 && closing > 4 && p.state !== 'flee') {
        p.state = 'flee'; p.t = 0;
        const side = new THREE.Vector2(-player.vz, player.vx).normalize();
        if (side.x * dx + side.y * dz < 0) side.negate();
        p.fleeDir.copy(side);
      }
      if (p.state === 'flee') {
        p.x += p.fleeDir.x * 4.5 * dt; p.z += p.fleeDir.y * 4.5 * dt;
        p.y = this.world.heightAt(p.x, p.z) + 0.14;
        p.yaw = Math.atan2(p.fleeDir.x, p.fleeDir.y);
        if (p.t > 1.4) { p.state = 'idle'; p.t = 0; }
      } else if (p.state === 'wait' || p.state === 'idle') {
        if (p.t > (p.state === 'wait' ? 1.0 : 2.5)) {
          if (p.state === 'idle') { p.state = 'walk'; this.place(p); }
          else if (this.nextEdge(p)) p.state = 'walk'; else p.t = 0;
        }
      } else {
        p.s += p.speed * dt;
        const len = p.road ? this.graph.edges[p.edge].len : this.edges[p.edge].len;
        if (p.s >= len) { p.s = len; if (!this.nextEdge(p)) { /* waiting */ } }
        this.place(p);
        if (Math.random() < dt * 0.02) { p.state = 'idle'; p.t = 0; }
      }
    }
    // separation
    for (let i = 0; i < this.peds.length; i++) for (let j = i + 1; j < this.peds.length; j++) {
      const a = this.peds[i], b = this.peds[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.75) { const k = (0.75 - d) / d * 0.5; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
    }
    // model assignment for the nearest pedestrians
    const sorted = [...this.peds].sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    const vis = sorted.slice(0, this.maxPeds);
    const visSet = new Set(vis);
    for (const p of this.peds) if (p.model && !visSet.has(p)) { p.model.busy = false; p.model.root.visible = false; p.model = null; }
    for (const p of vis) {
      if (!p.model) {
        let m = this.pool.find((x) => !x.busy);
        if (!m && this.pool.length < this.maxPeds + 4) { m = this.makeModel(this.pool.length); this.pool.push(m); }
        if (!m) continue;
        m.busy = true; m.root.visible = true; p.model = m;
      }
      const m = p.model;
      m.root.position.set(p.x, p.y, p.z);
      m.root.rotation.set(0, p.yaw, 0);
      if (p.state === 'flee') this.setAnim(m, 'run', 1.0);
      else if (p.state === 'walk') this.setAnim(m, 'walk', p.speed / 1.35);
      else this.setAnim(m, 'idle', 1);
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      m.mixer.update(dist > 90 ? dt * 0.5 : dt);
    }
  }

  get count(): number { return this.peds.length; }
}
