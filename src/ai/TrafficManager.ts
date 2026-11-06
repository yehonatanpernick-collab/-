import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { vec3, float } from 'three/tsl';
import type { RoadGraph, Edge } from './RoadGraph';
import { Physics } from '../core/Physics';
import { U } from '../core/Uniforms';
import { CAR_CLASSES, buildBody, wheelGeometry, lampGeometry, type CarClass } from './TrafficModels';

/**
 * Signal controller for every signalised junction (real OSM/Overture traffic_signals locations).
 * Approaches are split into two groups by bearing; groups alternate green / yellow / all-red.
 */
export class SignalSystem {
  private phaseOffset = new Map<number, number>();
  readonly cycle = 46; // s
  constructor(private graph: RoadGraph) {}
  private offset(n: number): number {
    let o = this.phaseOffset.get(n);
    if (o === undefined) { o = (Math.sin(n * 12.9898) * 43758.5453 % 1 + 1) % 1 * this.cycle; this.phaseOffset.set(n, o); }
    return o;
  }
  /** approach group (0/1) for an edge arriving at node n */
  group(n: number, e: Edge): number {
    const ax = e.a === n ? e.pts[2] - e.pts[0] : e.pts[e.pts.length - 4] - e.pts[e.pts.length - 2];
    const az = e.a === n ? e.pts[3] - e.pts[1] : e.pts[e.pts.length - 3] - e.pts[e.pts.length - 1];
    const ang = Math.atan2(az, ax);
    return Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? 0 : 1;
  }
  /** 0 = green, 1 = yellow, 2 = red */
  state(n: number, grp: number, t: number): number {
    const c = (t + this.offset(n)) % this.cycle;
    const half = this.cycle / 2;
    const local = grp === 0 ? c : (c + half) % this.cycle;
    if (local < half - 4) return 0;
    if (local < half - 1) return 1;
    return 2;
  }
}

interface Agent {
  id: number; cls: number; color: THREE.Color;
  edge: number; dir: 1 | -1; s: number;         // s measured along travel direction
  lane: number; laneOff: number; laneTarget: number;
  v: number; v0: number; a: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  stopTimer: number; stopped: boolean; crashed: number; honk: number;
  wheelRot: number; brake: boolean; active: boolean; far: boolean;
  body: RAPIER.RigidBody | null;
  next: { edge: number; dir: 1 | -1 } | null;
}

const tmp = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };

export class TrafficManager {
  group = new THREE.Group();
  agents: Agent[] = [];
  private bodies: THREE.InstancedMesh[] = [];
  private wheels!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh[] = [];
  private headsPer: THREE.InstancedMesh[] = [];
  private nextId = 1;
  private edgeAgents = new Map<number, Agent[]>();
  private kinPool: RAPIER.RigidBody[] = [];
  signals: SignalSystem;
  maxAgents = 60;
  density = 1;
  time = 0;
  onHonk?: (x: number, y: number, z: number) => void;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s3 = new THREE.Vector3(1, 1, 1); private p3 = new THREE.Vector3();
  private cap = 160;

  constructor(private graph: RoadGraph, private physics: Physics) {
    this.signals = new SignalSystem(graph);
    const bodyMat = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.15 });
    for (const c of CAR_CLASSES) {
      const im = new THREE.InstancedMesh(buildBody(c), bodyMat, this.cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      this.bodies.push(im); this.group.add(im);
      const hm = new THREE.MeshBasicNodeMaterial();
      hm.colorNode = vec3(1, 0.95, 0.85).mul(U.night.mul(6).add(0.6));
      const h = new THREE.InstancedMesh(lampGeometry(c, true), hm, this.cap); h.count = 0; h.frustumCulled = false;
      this.headsPer.push(h); this.group.add(h);
      const tm = new THREE.MeshBasicNodeMaterial();
      tm.colorNode = vec3(float(4.0)); // × instance colour (brake intensity)
      const t = new THREE.InstancedMesh(lampGeometry(c, false), tm, this.cap); t.count = 0; t.frustumCulled = false;
      t.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(0.3), 3);
      this.tails.push(t); this.group.add(t);
    }
    const wm = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 });
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), wm, this.cap * 6);
    this.wheels.count = 0; this.wheels.castShadow = true; this.wheels.frustumCulled = false;
    this.group.add(this.wheels);
    // kinematic collider pool so the player physically collides with nearby traffic
    const R = Physics.R;
    for (let i = 0; i < 14; i++) {
      const b = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500 - i * 10, 0));
      physics.world.createCollider(R.ColliderDesc.cuboid(0.95, 0.75, 2.4).setTranslation(0, 0.85, 0), b);
      this.kinPool.push(b);
    }
  }

  private pickClass(): number {
    const tot = CAR_CLASSES.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < CAR_CLASSES.length; i++) { r -= CAR_CLASSES[i].weight; if (r <= 0) return i; }
    return 0;
  }

  private edgeLen(a: Agent): number { return this.graph.edges[a.edge].len; }

  private laneOffset(e: Edge, lane: number): number {
    const lanes = Math.max(1, e.lanes);
    if (e.oneway !== 0) { const lw = e.w / lanes; return -e.w / 2 + lw * (lane + 0.5); }
    const lw = (e.w / 2) / lanes; return lw * (lane + 0.5);
  }

  private spawn(px: number, pz: number, rMin: number, rMax: number): void {
    const ang = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
    const cx = px + Math.cos(ang) * r, cz = pz + Math.sin(ang) * r;
    const near = this.graph.nearest(cx, cz, 80, (e) => e.cls <= 5 && !e.tunnel && e.len > 15 && e.w >= 5.5);
    if (!near) return;
    const e = this.graph.edges[near.edge];
    let dir: 1 | -1 = e.oneway === 1 ? 1 : e.oneway === -1 ? -1 : Math.random() < 0.5 ? 1 : -1;
    const s = dir === 1 ? near.s : e.len - near.s;
    const lanes = Math.max(1, e.lanes);
    const lane = Math.floor(Math.random() * lanes);
    // spacing check
    for (const o of this.edgeAgents.get(e.id) ?? []) if (o.dir === dir && Math.abs(o.s - s) < 14) return;
    let cls = this.pickClass();
    if ((CAR_CLASSES[cls].name === 'bus' || CAR_CLASSES[cls].name === 'truck') && e.cls >= 5) cls = 0;
    const c: CarClass = CAR_CLASSES[cls];
    const v0 = Math.min(e.speed * 1.08, 31) * c.maxSpeed * (0.85 + Math.random() * 0.25);
    const a: Agent = {
      id: this.nextId++, cls, color: new THREE.Color(c.colors[Math.floor(Math.random() * c.colors.length)]),
      edge: e.id, dir, s, lane, laneOff: this.laneOffset(e, lane), laneTarget: lane, v: v0 * 0.7, v0, a: 0,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stopTimer: 0, stopped: false, crashed: 0, honk: 0, wheelRot: 0, brake: false, active: true, far: false,
      body: null, next: null,
    };
    this.addToEdge(a);
    this.place(a);
    this.agents.push(a);
  }

  private addToEdge(a: Agent): void { let l = this.edgeAgents.get(a.edge); if (!l) this.edgeAgents.set(a.edge, (l = [])); l.push(a); }
  private removeFromEdge(a: Agent): void { const l = this.edgeAgents.get(a.edge); if (l) { const i = l.indexOf(a); if (i >= 0) l.splice(i, 1); } }

  /** choose the next link at the end node (no U-turns unless dead-end; prefers going straight) */
  private chooseNext(a: Agent): { edge: number; dir: 1 | -1 } | null {
    const e = this.graph.edges[a.edge];
    const node = a.dir === 1 ? e.b : e.a;
    const links = this.graph.outLinks[node].filter((l) => l.edge !== a.edge && this.graph.edges[l.edge].cls <= 6 && !this.graph.edges[l.edge].tunnel);
    if (!links.length) return null;
    // incoming heading
    const n = e.pts.length;
    const hx = a.dir === 1 ? e.pts[n - 2] - e.pts[n - 4] : e.pts[0] - e.pts[2];
    const hz = a.dir === 1 ? e.pts[n - 1] - e.pts[n - 3] : e.pts[1] - e.pts[3];
    const hl = Math.hypot(hx, hz) || 1;
    const weights = links.map((l) => {
      const f = this.graph.edges[l.edge];
      const ox = l.dir === 1 ? f.pts[2] - f.pts[0] : f.pts[f.pts.length - 4] - f.pts[f.pts.length - 2];
      const oz = l.dir === 1 ? f.pts[3] - f.pts[1] : f.pts[f.pts.length - 3] - f.pts[f.pts.length - 1];
      const dot = (hx * ox + hz * oz) / (hl * (Math.hypot(ox, oz) || 1));
      let w = dot > 0.7 ? 3 : dot > -0.3 ? 1 : 0.05;
      if (f.cls <= e.cls) w *= 1.5;
      if (f.cls === 6) w *= 0.3;
      return w;
    });
    const tot = weights.reduce((s, x) => s + x, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < links.length; i++) { r -= weights[i]; if (r <= 0) return { edge: links[i].edge, dir: links[i].dir }; }
    return { edge: links[0].edge, dir: links[0].dir };
  }

  private place(a: Agent): void {
    const e = this.graph.edges[a.edge];
    const sAlong = a.dir === 1 ? a.s : e.len - a.s;
    this.graph.sample(e, sAlong, tmp);
    let tx = tmp.tx * a.dir, tz = tmp.tz * a.dir;
    // right-hand lateral offset relative to travel direction
    const rx = -tz, rz = tx;
    a.x = tmp.x + rx * a.laneOff; a.z = tmp.z + rz * a.laneOff;
    // pitch from the real terrain / bridge slope
    const c = CAR_CLASSES[a.cls];
    const sF = Math.min(e.len, Math.max(0, sAlong + a.dir * c.wheelbase / 2)), sB = Math.min(e.len, Math.max(0, sAlong - a.dir * c.wheelbase / 2));
    this.graph.sample(e, sF, tmp); const yF = tmp.y;
    this.graph.sample(e, sB, tmp); const yB = tmp.y;
    a.y = (yF + yB) / 2 + 0.05;
    a.pitch = -Math.atan2(yF - yB, c.wheelbase);
    const yaw = Math.atan2(tx, tz);
    let dy = yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yaw += a.far ? dy : dy * 0.35;
    void tx; tx = 0; tz = 0;
  }

  /** distance to the stop line ahead if the agent must stop (red light / stop sign), else Infinity */
  private stopDistance(a: Agent): number {
    const e = this.graph.edges[a.edge];
    const node = a.dir === 1 ? e.b : e.a;
    if (this.graph.degree[node] < 3) return Infinity;
    const stopAt = e.len - (this.graph.junctionRadius[node] + 4.2);
    const d = stopAt - a.s;
    if (d < -2) return Infinity;
    if (this.graph.signal[node]) {
      const st = this.signals.state(node, this.signals.group(node, e), this.time);
      if (st === 2 || (st === 1 && d > a.v * 1.2)) return Math.max(0, d);
      return Infinity;
    }
    // all-way / minor stop: stop briefly then proceed
    if (e.cls >= 4) {
      if (a.stopTimer > 1.2) return Infinity;
      if (d < 1.5 && a.v < 0.5) a.stopTimer += 1 / 30;
      return Math.max(0, d);
    }
    return Infinity;
  }

  update(dt: number, player: { x: number; y: number; z: number; vx: number; vz: number; speed: number }, flying: boolean): void {
    this.time += dt;
    const rMax = flying ? 520 : 380, rMin = flying ? 120 : 70, despawn = rMax + 140;
    const hour = U.night.value;
    const target = Math.round(this.maxAgents * this.density * (1 - hour * 0.45));
    // spawn / despawn
    let spawnBudget = 4;
    while (this.agents.filter((a) => a.active).length < target && spawnBudget-- > 0) this.spawn(player.x, player.z, rMin, rMax);
    for (const a of this.agents) {
      const d = Math.hypot(a.x - player.x, a.z - player.z);
      if (d > despawn) { a.active = false; this.removeFromEdge(a); }
      a.far = d > 260;
    }
    this.agents = this.agents.filter((a) => a.active);

    // simulation
    for (const a of this.agents) {
      const e = this.graph.edges[a.edge];
      const len = e.len;
      if (a.crashed > 0) { a.crashed -= dt; a.v = Math.max(0, a.v - 8 * dt); a.brake = true; this.advance(a, dt); continue; }
      // leader search on same edge / direction / lane
      let gap = 200, vLead = a.v0;
      for (const o of this.edgeAgents.get(a.edge) ?? []) {
        if (o === a || o.dir !== a.dir) continue;
        if (Math.abs(o.laneOff - a.laneOff) > 1.8) continue;
        const ds = o.s - a.s;
        if (ds > 0 && ds < gap) { gap = ds - CAR_CLASSES[o.cls].length / 2 - CAR_CLASSES[a.cls].length / 2; vLead = o.v; }
      }
      // look into the next edge
      if (!a.next) a.next = this.chooseNext(a);
      if (a.next && len - a.s < 40) {
        for (const o of this.edgeAgents.get(a.next.edge) ?? []) {
          if (o.dir !== a.next.dir) continue;
          const ds = len - a.s + o.s;
          if (ds < gap) { gap = ds - 5; vLead = o.v; }
        }
      }
      // player as obstacle (within the lane corridor ahead)
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const px = player.x - a.x, pz = player.z - a.z;
      const along = px * fx + pz * fz, lat = Math.abs(-px * fz + pz * fx);
      if (along > 0 && along < 60 && lat < 2.4 && Math.abs(player.y - a.y) < 4) {
        const g = along - 4;
        if (g < gap) { gap = g; vLead = Math.max(0, player.vx * fx + player.vz * fz); }
        if (g < 8 && player.speed < 1) { a.honk += dt; if (a.honk > 2.5) { a.honk = -6; this.onHonk?.(a.x, a.y, a.z); } }
      }
      // red lights & stop signs
      const sd = this.stopDistance(a);
      if (sd < gap) { gap = sd; vLead = 0; }
      // curvature-aware speed on the next turn
      let v0 = a.v0;
      if (a.next && len - a.s < 25) {
        const f = this.graph.edges[a.next.edge];
        const ax = Math.sin(a.yaw), az = Math.cos(a.yaw);
        const ox = a.next.dir === 1 ? f.pts[2] - f.pts[0] : f.pts[f.pts.length - 4] - f.pts[f.pts.length - 2];
        const oz = a.next.dir === 1 ? f.pts[3] - f.pts[1] : f.pts[f.pts.length - 3] - f.pts[f.pts.length - 1];
        const dot = (ax * ox + az * oz) / (Math.hypot(ox, oz) || 1);
        if (dot < 0.7) v0 = Math.min(v0, 6.5);
      }
      // Intelligent Driver Model
      const s0 = 2.2, T = 1.3, amax = CAR_CLASSES[a.cls].name === 'bus' ? 1.1 : 1.9, b = 2.6;
      const dv = a.v - vLead;
      const sStar = s0 + Math.max(0, a.v * T + (a.v * dv) / (2 * Math.sqrt(amax * b)));
      const g = Math.max(0.1, gap);
      a.a = amax * (1 - Math.pow(a.v / Math.max(v0, 0.1), 4) - (sStar / g) ** 2);
      a.a = Math.max(-9, Math.min(amax, a.a));
      a.brake = a.a < -0.6 || (a.v < 0.3 && gap < 6);
      a.v = Math.max(0, a.v + a.a * dt);
      if (a.v < 0.05 && sd === Infinity && gap > 10) a.stopTimer = 0;
      // lane change if blocked on a multi-lane road
      const lanes = Math.max(1, e.lanes);
      if (lanes > 1 && gap < 25 && vLead < a.v0 * 0.6 && Math.random() < dt * 0.5) {
        const nl = a.lane + (Math.random() < 0.5 ? 1 : -1);
        if (nl >= 0 && nl < lanes) {
          const off = this.laneOffset(e, nl);
          const free = !(this.edgeAgents.get(a.edge) ?? []).some((o) => o !== a && o.dir === a.dir && Math.abs(o.laneOff - off) < 1.5 && Math.abs(o.s - a.s) < 12);
          if (free) { a.lane = nl; a.laneTarget = nl; }
        }
      }
      const tgt = this.laneOffset(e, a.lane);
      a.laneOff += (tgt - a.laneOff) * Math.min(1, dt * 0.9);
      this.advance(a, dt);
    }
    this.syncColliders(player);
    this.render();
  }

  private advance(a: Agent, dt: number): void {
    a.s += a.v * dt;
    a.wheelRot += (a.v * dt) / CAR_CLASSES[a.cls].wheelR;
    let guard = 0;
    while (a.s > this.edgeLen(a) && guard++ < 4) {
      const over = a.s - this.edgeLen(a);
      const nx = a.next ?? this.chooseNext(a);
      if (!nx) { a.active = false; this.removeFromEdge(a); return; }
      this.removeFromEdge(a);
      a.edge = nx.edge; a.dir = nx.dir; a.s = over; a.next = null; a.stopTimer = 0;
      const e = this.graph.edges[a.edge];
      a.lane = Math.min(a.lane, Math.max(1, e.lanes) - 1);
      this.addToEdge(a);
    }
    this.place(a);
  }

  /** assign kinematic bodies to the closest agents */
  private syncColliders(p: { x: number; z: number }): void {
    const near = this.agents.filter((a) => Math.hypot(a.x - p.x, a.z - p.z) < 70).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, this.kinPool.length);
    const set = new Set(near);
    for (const a of this.agents) if (a.body && !set.has(a)) a.body = null;
    const used = new Set(near.map((a) => a.body).filter(Boolean));
    const free = this.kinPool.filter((b) => !used.has(b));
    for (const a of near) {
      if (!a.body) a.body = free.pop() ?? null;
      if (!a.body) continue;
      this.q.setFromEuler(this.e.set(a.pitch, a.yaw, 0, 'YXZ'));
      a.body.setNextKinematicTranslation({ x: a.x, y: a.y, z: a.z });
      a.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    }
    for (const b of free) b.setNextKinematicTranslation({ x: 0, y: -500, z: 0 });
  }

  /** player hit a car hard: it stops with hazards */
  impactNear(x: number, z: number): void {
    for (const a of this.agents) if (Math.hypot(a.x - x, a.z - z) < 7) { a.crashed = 6; a.v *= 0.3; }
  }

  private render(): void {
    const counts = new Array(CAR_CLASSES.length).fill(0);
    let wc = 0;
    const col = new THREE.Color();
    for (const a of this.agents) {
      const c = CAR_CLASSES[a.cls];
      const i = counts[a.cls]++;
      if (i >= this.cap) continue;
      this.q.setFromEuler(this.e.set(a.pitch, a.yaw, 0, 'YXZ'));
      this.m.compose(this.p3.set(a.x, a.y, a.z), this.q, this.s3.set(1, 1, 1));
      this.bodies[a.cls].setMatrixAt(i, this.m);
      this.bodies[a.cls].setColorAt(i, a.color);
      this.headsPer[a.cls].setMatrixAt(i, this.m);
      this.tails[a.cls].setMatrixAt(i, this.m);
      const hazard = a.crashed > 0 && Math.floor(this.time * 2) % 2 === 0;
      this.tails[a.cls].setColorAt(i, col.setRGB(a.brake || hazard ? 1 : 0.18 + U.night.value * 0.25, 0.01, 0.01));
      if (!a.far && wc < this.cap * 6 - 6) {
        const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.wheelRot, 0, 0));
        const nAx = c.name === 'bus' || c.name === 'truck' ? 2 : 2;
        for (let ax = 0; ax < nAx; ax++) for (const sd of [-1, 1]) {
          const lz = ax === 0 ? c.wheelbase / 2 : -c.wheelbase / 2;
          const lp = new THREE.Vector3(sd * c.track / 2, c.wheelR, lz).applyQuaternion(this.q).add(this.p3);
          this.m.compose(lp, this.q.clone().multiply(wq), this.s3.set(c.wheelR, c.wheelR, c.wheelR));
          this.wheels.setMatrixAt(wc++, this.m);
        }
      }
    }
    CAR_CLASSES.forEach((_, k) => {
      for (const im of [this.bodies[k], this.headsPer[k], this.tails[k]]) {
        im.count = Math.min(counts[k], this.cap);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    });
    this.wheels.count = wc;
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  /** colour for a signal head near (x,z) facing rot (used by the street-furniture renderer) */
  signalColorAt(x: number, z: number, rot: number, out: THREE.Color): void {
    // find the nearest signalised node and the approach the head faces
    let best = -1, bd = 900;
    for (const id of this.graph.edgesNear(x, z, 30)) {
      const e = this.graph.edges[id];
      for (const n of [e.a, e.b]) {
        if (!this.graph.signal[n]) continue;
        const d = (this.graph.nodeX(n) - x) ** 2 + (this.graph.nodeZ(n) - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    if (best < 0) { out.setRGB(0.05, 0.05, 0.05); return; }
    // heads face the approaching traffic: their facing direction ≈ rot (+π)
    const grp = Math.abs(Math.sin(rot)) > Math.abs(Math.cos(rot)) ? 0 : 1;
    const st = this.signals.state(best, grp, this.time);
    if (st === 0) out.setRGB(0.05, 1, 0.35); else if (st === 1) out.setRGB(1, 0.65, 0.02); else out.setRGB(1, 0.04, 0.02);
  }
}
