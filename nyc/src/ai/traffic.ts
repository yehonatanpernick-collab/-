import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, type Physics } from '../engine/physics';
import type { Roads, Edge } from '../world/roads';
import { loadBinary, dirOf } from '../engine/assets';

const BASE = import.meta.env.BASE_URL;
/** model, real length (m), weight */
const FLEET: [string, number, number][] = [
  ['taxi', 4.9, 34], ['sedan', 4.8, 16], ['suv', 4.9, 13], ['suv-luxury', 5.1, 6], ['hatchback-sports', 4.3, 5], ['sedan-sports', 4.6, 4],
  ['van', 5.3, 8], ['delivery', 6.6, 7], ['truck', 7.4, 3], ['police', 5.0, 2], ['garbage-truck', 8.2, 1], ['ambulance', 6.2, 1],
];
// avenue direction (Manhattan grid is rotated ~29° east of true north); north = -z
const AVE = new THREE.Vector2(Math.sin(0.506), -Math.cos(0.506));
const CYCLE = 90;

interface Agent { e: number; dir: 1 | -1; s: number; lane: number; v: number; v0: number; model: number; len: number; stun: number; x: number; z: number; yaw: number; active: boolean }

export class Traffic {
  agents: Agent[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private parkedMeshes: THREE.InstancedMesh[] = [];
  private bodies: RAPIER.RigidBody[] = [];
  private signal = new Map<number, number>(); // node → phase offset seconds
  private t = 0;
  count: number;
  private cum: number[] = [];

  constructor(private scene: THREE.Scene, private roads: Roads, private physics: Physics, count: number) { this.count = count; }

  async init() {
    const loader = new GLTFLoader();
    const tot = FLEET.reduce((s, f) => s + f[2], 0); let c = 0;
    for (const [name, len] of FLEET) {
      const url = `${BASE}models/${name}.glb`;
      const g = await loader.parseAsync(await loadBinary(url), dirOf(url));
      g.scene.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = []; let mat: THREE.Material | null = null;
      g.scene.traverse((o: any) => { if (o.isMesh) { const gg = o.geometry.clone().applyMatrix4(o.matrixWorld); for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); geos.push(gg); mat = mat || o.material; } });
      const geo = mergeGeometries(geos); geo.computeBoundingBox();
      const bb = geo.boundingBox!; const L = Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x); const sc = len / L;
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); geo.scale(sc, sc, sc);
      if (bb.max.x - bb.min.x > bb.max.z - bb.min.z) geo.rotateY(Math.PI / 2);
      const m = mat as any as THREE.MeshStandardMaterial; m.roughness = 0.35; m.metalness = 0.35; (m as any).envMapIntensity = 1.2;
      const im = new THREE.InstancedMesh(geo, m, 260); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      this.meshes.push(im); this.scene.add(im);
      const pm = new THREE.InstancedMesh(geo, m, 140); pm.count = 0; pm.castShadow = false; pm.frustumCulled = false; this.parkedMeshes.push(pm); this.scene.add(pm);
      c += FLEET[this.meshes.length - 1][2] / tot; this.cum.push(c);
    }
    // signal phase offsets: progressive green wave along the avenues
    this.roads.nodeEdges.forEach((es, n) => {
      if (es.length < 3 || es.some((i) => this.roads.edges[i].kind !== 1)) return;
      const [x, z] = this.roads.nodes[n]; const along = x * AVE.x + z * AVE.y;
      this.signal.set(n, ((along / 11) % CYCLE + CYCLE) % CYCLE);
    });
    // kinematic colliders for the cars closest to the player
    for (let i = 0; i < 24; i++) {
      const b = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50 - i * 5, 0));
      this.physics.world.createCollider(R.ColliderDesc.cuboid(0.95, 0.75, 2.4).setTranslation(0, 0.75, 0).setFriction(0.4), b);
      this.bodies.push(b);
    }
  }

  private pickModel() { const r = Math.random(); return Math.max(0, this.cum.findIndex((c) => r <= c)); }
  private canLeave(e: Edge, node: number) { return e.a === node ? e.dir !== 'TF' : e.dir !== 'FT'; }

  private spawn(a: Agent, px: number, pz: number, minD: number, maxD: number) {
    const E = this.roads.edges;
    for (let tries = 0; tries < 30; tries++) {
      const ei = Math.floor(Math.random() * E.length); const e = E[ei]; if (e.kind === 9 || e.len < 20) continue;
      const [x, z] = this.roads.at(e, e.len / 2); const d = Math.hypot(x - px, z - pz); if (d < minD || d > maxD) continue;
      const dir: 1 | -1 = e.dir === 'FT' ? 1 : e.dir === 'TF' ? -1 : Math.random() < 0.5 ? 1 : -1;
      const lanes = e.dir === 'TW' ? Math.max(1, Math.floor(e.lanes / 2)) : e.lanes;
      const m = this.pickModel();
      Object.assign(a, { e: ei, dir, s: Math.random() * e.len, lane: Math.floor(Math.random() * lanes), v: 6, v0: (e.speed || 25) * 0.447 * (0.9 + Math.random() * 0.35), model: m, len: FLEET[m][1], stun: 0, active: true });
      return true;
    }
    a.active = false; return false;
  }

  /** 0 red, 1 amber, 2 green for a direction (dx,dz) entering node */
  state(node: number, dx: number, dz: number) {
    const off = this.signal.get(node); if (off === undefined) return 2;
    const ave = Math.abs(dx * AVE.x + dz * AVE.y) > 0.7;
    const t = (this.t + off) % CYCLE;
    if (ave) return t < 46 ? 2 : t < 50 ? 1 : 0;
    return t >= 52 && t < 84 ? 2 : t >= 84 && t < 88 ? 1 : 0;
  }
  signalForYaw(node: number, yaw: number) { return this.state(node, -Math.sin(yaw), -Math.cos(yaw)); }

  private laneOffset(e: Edge, lane: number) {
    if (e.dir === 'TW') return 1.7 + lane * 3.1;
    const half = Math.max(e.lanes * 3.0, e.w - e.park * 2.6) / 2;
    return -half + (lane + 0.5) * ((2 * half) / e.lanes);
  }

  placeParked(px: number, pz: number) {
    const E = this.roads.edges; const counts = this.parkedMeshes.map(() => 0); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), y = new THREE.Vector3(0, 1, 0);
    for (let ei = 0; ei < E.length; ei++) {
      const e = E[ei]; if (!e.park || e.len < 30) continue;
      const [mx, mz] = this.roads.at(e, e.len / 2); if (Math.hypot(mx - px, mz - pz) > 260) continue;
      const half = e.w / 2 - 1.25;
      for (const side of [-1, 1]) for (let sAt = 16; sAt < e.len - 16; sAt += 6.4) {
        const h = Math.sin(ei * 12.9898 + sAt * 78.233 + side * 3.1) * 43758.5453; const r = h - Math.floor(h);
        if (r < 0.32) continue;
        const mi = Math.min(FLEET.length - 1, Math.floor(r * 37) % 7); // mostly cars, not trucks
        const [x, z, dx, dz] = this.roads.at(e, sAt); const yaw = Math.atan2(dx * side, dz * side);
        p.set(x - dz * half * side, 0, z + dx * half * side); q.setFromAxisAngle(y, yaw); m4.compose(p, q, s);
        const im = this.parkedMeshes[mi]; if (counts[mi] < im.instanceMatrix.count) im.setMatrixAt(counts[mi]++, m4);
      }
    }
    this.parkedMeshes.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; });
  }

  update(dt: number, player: THREE.Vector3, playerVel: THREE.Vector3, playerLow: boolean) {
    this.t += dt;
    const E = this.roads.edges, A = this.agents;
    while (A.length < this.count) { const a = {} as Agent; this.spawn(a, player.x, player.z, 30, 650); A.push(a); }
    // bucket by edge for leader search
    const byEdge = new Map<number, Agent[]>();
    for (const a of A) if (a.active) { let l = byEdge.get(a.e); if (!l) byEdge.set(a.e, (l = [])); l.push(a); }
    for (const a of A) {
      if (!a.active) { this.spawn(a, player.x, player.z, 250, 650); continue; }
      const e = E[a.e];
      // leader gap (same edge/dir/lane), stop line, player
      let gap = 1e9, dv = 0;
      for (const b of byEdge.get(a.e) || []) if (b !== a && b.dir === a.dir && b.lane === a.lane && b.s > a.s) { const g = b.s - a.s - (a.len + b.len) / 2; if (g < gap) { gap = g; dv = a.v - b.v; } }
      const node = a.dir > 0 ? e.b : e.a; const toEnd = e.len - a.s;
      if (toEnd < 60) {
        const [, , dx, dz] = this.roads.at(e, a.dir > 0 ? e.len - 1 : 1);
        const st = this.state(node, dx * a.dir, dz * a.dir);
        const stop = toEnd - 9.5;
        if (st === 0 || (st === 1 && stop > 12)) { if (stop > -1 && stop < gap) { gap = stop; dv = a.v; } }
      }
      if (playerLow) {
        const ax = Math.sin(a.yaw), az = Math.cos(a.yaw); const rx = player.x - a.x, rz = player.z - a.z; const f = rx * ax + rz * az; const lat = Math.abs(rx * az - rz * ax);
        if (f > 0 && f < 40 && lat < 2.4) { const g = f - a.len / 2 - 2.4; if (g < gap) { gap = g; dv = a.v - (playerVel.x * ax + playerVel.z * az); } }
      }
      // Intelligent Driver Model
      const aMax = 2.2, bC = 3.5, s0 = 2.2, T = 1.3;
      const sStar = s0 + Math.max(0, a.v * T + (a.v * dv) / (2 * Math.sqrt(aMax * bC)));
      let acc = aMax * (1 - Math.pow(a.v / a.v0, 4) - Math.pow(sStar / Math.max(0.2, gap), 2));
      if (a.stun > 0) { a.stun -= dt; acc = -6; }
      a.v = Math.max(0, a.v + Math.max(-9, acc) * dt);
      a.s += a.v * dt;
      if (a.s >= e.len) { // choose next edge at the node, prefer going straight
        const [, , dx, dz] = this.roads.at(e, a.dir > 0 ? e.len : 0); const hx = dx * a.dir, hz = dz * a.dir;
        const opts: { ei: number; dir: 1 | -1; w: number }[] = [];
        for (const ni of this.roads.nodeEdges[node]) {
          if (ni === a.e) continue; const ne = E[ni]; if (!this.canLeave(ne, node) || ne.kind === 9) continue;
          const nd: 1 | -1 = ne.a === node ? 1 : -1; const [, , ex, ez] = this.roads.at(ne, nd > 0 ? 0.5 : ne.len - 0.5);
          const dot = ex * nd * hx + ez * nd * hz; if (dot < -0.5) continue;
          opts.push({ ei: ni, dir: nd, w: dot > 0.8 ? 6 : 1 });
        }
        if (!opts.length) { this.spawn(a, player.x, player.z, 250, 650); continue; }
        let r = Math.random() * opts.reduce((s, o) => s + o.w, 0); let pick = opts[0];
        for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
        const ne = E[pick.ei]; const lanes = ne.dir === 'TW' ? Math.max(1, Math.floor(ne.lanes / 2)) : ne.lanes;
        a.s -= e.len; a.e = pick.ei; a.dir = pick.dir; a.lane = Math.min(a.lane, lanes - 1); a.v0 = (ne.speed || 25) * 0.447 * (0.9 + Math.random() * 0.35);
      }
      const ce = E[a.e]; const [x, z, dx, dz] = this.roads.at(ce, a.dir > 0 ? a.s : ce.len - a.s);
      const hx = dx * a.dir, hz = dz * a.dir; const off = this.laneOffset(ce, a.lane);
      const nx = x - hz * off, nz = z + hx * off; // right of travel is (-hz, hx)
      const yaw = Math.atan2(hx, hz);
      let d = yaw - a.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      a.yaw += d * Math.min(1, dt * 6); a.x += (nx - a.x) * Math.min(1, dt * 8); a.z += (nz - a.z) * Math.min(1, dt * 8);
      if (Math.abs(d) > 2) { a.yaw = yaw; a.x = nx; a.z = nz; }
      if (Math.hypot(a.x - player.x, a.z - player.z) > 820) a.active = false;
    }
    // render
    const counts = this.meshes.map(() => 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), y = new THREE.Vector3(0, 1, 0);
    const near: Agent[] = [];
    for (const a of A) {
      if (!a.active) continue; const im = this.meshes[a.model]; if (counts[a.model] >= im.instanceMatrix.count) continue;
      q.setFromAxisAngle(y, a.yaw); m4.compose(p.set(a.x, 0, a.z), q, s); im.setMatrixAt(counts[a.model]++, m4);
      if (Math.abs(a.x - player.x) < 90 && Math.abs(a.z - player.z) < 90) near.push(a);
    }
    this.meshes.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; });
    near.sort((u, v) => Math.hypot(u.x - player.x, u.z - player.z) - Math.hypot(v.x - player.x, v.z - player.z));
    this.bodies.forEach((b, i) => {
      const a = near[i];
      if (a) { b.setNextKinematicTranslation({ x: a.x, y: 0, z: a.z }); const h = a.yaw / 2; b.setNextKinematicRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
        if (Math.hypot(a.x - player.x, a.z - player.z) < a.len / 2 + 2.6 && playerLow) a.stun = 2.5; }
      else b.setNextKinematicTranslation({ x: 0, y: -50 - i * 5, z: 0 });
    });
  }
}
