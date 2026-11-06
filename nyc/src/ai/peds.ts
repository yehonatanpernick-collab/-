import * as THREE from 'three/webgpu';
import * as YUKA from 'yuka';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Roads, Edge } from '../world/roads';
import type { Traffic } from './traffic';

const SKIN = [0xf1c9a5, 0xe0ac82, 0xc68a5f, 0x8d5a3b, 0x5c3a26, 0xf6d7bf];
const TOP = [0x1f2a40, 0x8e2f2f, 0xe8e4da, 0x2f5d3f, 0xc9a240, 0x161618, 0x5c4a86, 0x3f6f96, 0xb5602a, 0x7d7d7d, 0xc44a68, 0x2a7f76, 0x101010, 0x3b3b3f];
const BOTTOM = [0x1d2331, 0x2a2a2d, 0x433a31, 0x34425a, 0x5c5c5c, 0x161616, 0x55432f];

interface Ped { col: THREE.Color[]; v: YUKA.Vehicle; follow: YUKA.FollowPathBehavior; flee: YUKA.FleeBehavior; e: number; side: number; fromA: boolean; waitT: number; crossNode: number; crossDir: [number, number]; phase: number; idx: number; active: boolean }

/** Sidewalk pedestrians: Yuka vehicles with path following + separation + fleeing the player's car. */
export class Peds {
  private em = new YUKA.EntityManager();
  private peds: Ped[] = [];
  private mesh: Record<string, THREE.InstancedMesh> = {};
  private target = new YUKA.Vector3();

  constructor(private scene: THREE.Scene, private roads: Roads, private traffic: Traffic, private count: number) {}

  init() {
    this.em.spatialIndex = new YUKA.CellSpacePartitioning(6000, 50, 6000, 120, 1, 120);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    const g = (geo: THREE.BufferGeometry, n: number) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.frustumCulled = false; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); this.scene.add(m); return m; };
    const n = this.count;
    this.mesh.torso = g(mergeGeometries([new THREE.CylinderGeometry(0.19, 0.16, 0.6, 10).translate(0, 1.16, 0), new THREE.SphereGeometry(0.19, 10, 6).scale(1, 0.5, 0.8).translate(0, 1.45, 0)]), n);
    this.mesh.head = g(new THREE.SphereGeometry(0.115, 12, 8).translate(0, 1.64, 0), n);
    this.mesh.leg = g(new THREE.CapsuleGeometry(0.07, 0.7, 4, 8).translate(0, -0.42, 0), n * 2);
    this.mesh.arm = g(new THREE.CapsuleGeometry(0.05, 0.5, 4, 8).translate(0, -0.3, 0), n * 2);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = new YUKA.Vehicle(); v.maxSpeed = 1.25 + Math.random() * 0.45; v.maxForce = 6; v.mass = 1; v.boundingRadius = 0.4; v.neighborhoodRadius = 2.2; v.updateNeighborhood = true;
      const follow = new YUKA.FollowPathBehavior(new YUKA.Path(), 0.8); follow.active = false; v.active = false;
      const sep = new YUKA.SeparationBehavior(); sep.weight = 1.6;
      const flee = new YUKA.FleeBehavior(this.target, 9); flee.weight = 6; flee.active = false;
      v.steering.add(follow); v.steering.add(sep); v.steering.add(flee);
      v.smoother = new YUKA.Smoother(8);
      this.em.add(v);
      const p: Ped = { col: [new THREE.Color(TOP[i % TOP.length]), new THREE.Color(SKIN[(i * 5) % SKIN.length]), new THREE.Color(BOTTOM[(i * 7) % BOTTOM.length])], v, follow, flee, e: 0, side: 1, fromA: true, waitT: 0, crossNode: -1, crossDir: [0, 0], phase: Math.random() * 6, idx: i, active: false };
      this.peds.push(p);
      void c;
    }
  }

  private curbD(e: Edge, node: number) { const other = Math.max(0, ...this.roads.nodeEdges[node].filter((x) => this.roads.edges[x] !== e).map((x) => this.roads.edges[x].w)); return other / 2 + 2.6; }
  /** sidewalk point on edge e, side, at arc distance s from a */
  private walkPt(e: Edge, side: number, s: number) { const [x, z, dx, dz] = this.roads.at(e, s); const o = (e.w / 2 + 2.3) * side; return new YUKA.Vector3(x - dz * o, 0.15, z + dx * o); }

  private setLeg(p: Ped, ei: number, side: number, fromA: boolean) {
    const e = this.roads.edges[ei]; p.e = ei; p.side = side; p.fromA = fromA;
    const d0 = this.curbD(e, e.a), d1 = this.curbD(e, e.b); if (e.len < d0 + d1 + 4) return false;
    const path = new YUKA.Path(); const steps = Math.max(2, Math.ceil((e.len - d0 - d1) / 12));
    for (let k = 0; k <= steps; k++) { const t = k / steps; const s = fromA ? d0 + (e.len - d0 - d1) * t : e.len - d1 - (e.len - d0 - d1) * t; path.add(this.walkPt(e, side, s)); }
    p.follow.path = path; p.follow.active = true; return true;
  }

  private spawn(p: Ped, px: number, pz: number) {
    const E = this.roads.edges;
    for (let t = 0; t < 25; t++) {
      const ei = Math.floor(Math.random() * E.length); const e = E[ei]; if (e.kind !== 1) continue;
      const [x, z] = this.roads.at(e, e.len / 2); const d = Math.hypot(x - px, z - pz); if (d < 40 || d > 240) continue;
      const side = Math.random() < 0.5 ? 1 : -1, fromA = Math.random() < 0.5;
      if (!this.setLeg(p, ei, side, fromA)) continue;
      const path = p.follow.path; const wp = (path as any)._waypoints as YUKA.Vector3[]; const start = wp[Math.floor(Math.random() * wp.length)];
      p.v.position.copy(start); p.v.velocity.set(0, 0, 0); p.active = true; p.v.active = true; p.waitT = 0; return;
    }
  }

  /** at the end of a block: turn the corner, or cross at the crosswalk when the walk signal is on */
  private next(p: Ped) {
    const e = this.roads.edges[p.e]; const node = p.fromA ? e.b : e.a; const here = p.v.position;
    const opts: { ei: number; side: number; fromA: boolean; cross: boolean; w: number }[] = [];
    for (const ni of this.roads.nodeEdges[node]) {
      if (ni === p.e) continue; const ne = this.roads.edges[ni]; if (ne.kind !== 1) continue;
      const fromA = ne.a === node; const d = this.curbD(ne, node);
      for (const side of [1, -1]) {
        const start = this.walkPt(ne, side, fromA ? d : ne.len - d); const dist = start.distanceTo(here);
        if (dist < 30) opts.push({ ei: ni, side, fromA, cross: dist > 9, w: dist > 9 ? 2 : 3 });
      }
    }
    if (!opts.length) { if (!this.setLeg(p, p.e, -p.side, !p.fromA)) { p.active = false; p.v.active = false; p.follow.active = false; } return; }
    let r = Math.random() * opts.reduce((s, o) => s + o.w, 0); let pick = opts[0]; for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    if (pick.cross) { const [, , dx, dz] = this.roads.at(e, p.fromA ? e.len : 0); p.crossNode = node; p.crossDir = [dx * (p.fromA ? 1 : -1), dz * (p.fromA ? 1 : -1)]; p.waitT = 0.01; }
    if (!this.setLeg(p, pick.ei, pick.side, pick.fromA)) { p.active = false; p.v.active = false; p.follow.active = false; }
  }

  update(dt: number, player: THREE.Vector3, playerSpeed: number) {
    for (const p of this.peds) {
      if (!p.active) { this.spawn(p, player.x, player.z); continue; }
      const v = p.v;
      if (Math.hypot(v.position.x - player.x, v.position.z - player.z) > 300) { p.active = false; v.active = false; p.follow.active = false; continue; }
      // wait at the curb for the walk signal (walk with parallel traffic)
      if (p.waitT > 0) {
        const st = this.traffic.state(p.crossNode, p.crossDir[0], p.crossDir[1]);
        if (st === 2 || p.waitT > 40) p.waitT = 0; else { p.waitT += dt; v.velocity.multiplyScalar(0.8); p.follow.active = false; continue; }
        p.follow.active = true;
      }
      if (p.follow.path.finished()) this.next(p);
      const dCar = Math.hypot(v.position.x - player.x, v.position.z - player.z);
      p.flee.active = player.y < 3 && playerSpeed > 2 && dCar < 9;
      if (p.flee.active) { this.target.set(player.x, 0.15, player.z); v.maxSpeed = 4.2; } else v.maxSpeed = Math.min(v.maxSpeed, 1.7);
      v.position.y = 0.15;
    }
    this.em.update(dt);
    // render with a procedural walk cycle
    const m = new THREE.Matrix4(), m2 = new THREE.Matrix4(), m3 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const p of this.peds) {
      if (!p.active) continue; const v = p.v; const sp = v.getSpeed();
      p.phase += sp * dt * 3.8;
      const yaw = sp > 0.1 ? Math.atan2(v.velocity.x, v.velocity.z) : (v as any)._lastYaw || 0; (v as any)._lastYaw = yaw;
      q.setFromAxisAngle(up, yaw); m.compose(pos.set(v.position.x, 0.15 + Math.abs(Math.sin(p.phase)) * 0.035 * Math.min(1, sp), v.position.z), q, one);
      this.mesh.torso.setMatrixAt(n, m); this.mesh.head.setMatrixAt(n, m);
      const sw = Math.sin(p.phase) * Math.min(0.6, sp * 0.4);
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        m2.makeRotationX(sw * s); m2.setPosition(s * 0.09, 0.86, 0); m3.multiplyMatrices(m, m2); this.mesh.leg.setMatrixAt(n * 2 + k, m3);
        m2.makeRotationX(-sw * s * 0.8); m2.setPosition(s * 0.25, 1.42, 0); m3.multiplyMatrices(m, m2); this.mesh.arm.setMatrixAt(n * 2 + k, m3);
      }
      // colours follow the ped into whichever instance slot it got this frame
      this.mesh.torso.setColorAt(n, p.col[0]); this.mesh.head.setColorAt(n, p.col[1]);
      for (let k = 0; k < 2; k++) { this.mesh.leg.setColorAt(n * 2 + k, p.col[2]); this.mesh.arm.setColorAt(n * 2 + k, p.col[0]); }
      n++;
    }
    for (const k in this.mesh) { const im = this.mesh[k]; im.count = k === 'leg' || k === 'arm' ? n * 2 : n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}
