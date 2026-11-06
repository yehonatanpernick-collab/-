import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, float, fract, mix, smoothstep, step, uv, vec3, sin, time, max, min, hash, floor, fwidth } from 'three/tsl';
import type { WorldData } from '../data/WorldData';
import type { RoadGraph } from '../ai/RoadGraph';
import { Physics } from '../core/Physics';
import { buildingMaterial } from './Materials';
import { U } from '../core/Uniforms';
import { lonLatToWorld } from '../data/GeographicConfig';

/**
 * Manual enhancement system: hand-built models of San Francisco's signature structures,
 * positioned from real coordinates / real road geometry (never from their own geometry).
 */
type V2 = [number, number];

function loft(levels: { ring: V2[]; y: number }[], style: number, color: number, seed: number, floorH: number, cap = true): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], bi: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color(color);
  const n = levels[0].ring.length;
  const y0 = levels[0].y;
  for (let l = 0; l < levels.length - 1; l++) {
    const A = levels[l], B = levels[l + 1];
    let u = 0;
    for (let k = 0; k < n; k++) {
      const a0 = A.ring[k], a1 = A.ring[(k + 1) % n], b0 = B.ring[k], b1 = B.ring[(k + 1) % n];
      const L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
      const e1 = new THREE.Vector3(a1[0] - a0[0], 0, a1[1] - a0[1]);
      const e2 = new THREE.Vector3(b0[0] - a0[0], B.y - A.y, b0[1] - a0[1]);
      const nn = new THREE.Vector3().crossVectors(e2, e1).normalize();
      const base = pos.length / 3;
      const vs: [V2, number, number][] = [[a0, A.y, u], [a1, A.y, u + L], [b1, B.y, u + L], [b0, B.y, u]];
      for (const [p, y, uu] of vs) {
        pos.push(p[0], y, p[1]); nrm.push(nn.x, nn.y, nn.z); uvs.push(uu, y - y0);
        bi.push(style, seed, floorH, 0); col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
      u += L;
    }
  }
  if (cap) {
    const top = levels[levels.length - 1];
    const tris = THREE.ShapeUtils.triangulateShape(top.ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    const base = pos.length / 3;
    for (const p of top.ring) { pos.push(p[0], top.y, p[1]); nrm.push(0, 1, 0); uvs.push(p[0], p[1]); bi.push(style, seed, floorH, 1); col.push(0.5, 0.5, 0.5); }
    for (const t of tris) {
      const [a, b, cc] = t;
      const P = top.ring;
      const cy = (P[b][1] - P[a][1]) * (P[cc][0] - P[a][0]) - (P[b][0] - P[a][0]) * (P[cc][1] - P[a][1]);
      if (cy >= 0) idx.push(base + a, base + b, base + cc); else idx.push(base + a, base + cc, base + b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('binfo', new THREE.Float32BufferAttribute(bi, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function roundedSquare(cx: number, cz: number, half: number, r: number, seg = 5, rot = 0): V2[] {
  const out: V2[] = [];
  const corners: V2[] = [[half - r, half - r], [-(half - r), half - r], [-(half - r), -(half - r)], [half - r, -(half - r)]];
  corners.forEach(([x, z], k) => {
    for (let s = 0; s <= seg; s++) {
      const a = (k * Math.PI) / 2 + (s / seg) * (Math.PI / 2);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      out.push([cx + px * Math.cos(rot) - pz * Math.sin(rot), cz + px * Math.sin(rot) + pz * Math.cos(rot)]);
    }
  });
  return out.reverse();
}

function circle(cx: number, cz: number, r: number, n: number, flute = 0): V2[] {
  const out: V2[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (1 + (flute && k % 2 ? -flute : 0));
    out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return out;
}

function boxAt(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.rotateY(rotY);
  g.translate(x, y + sy / 2, z);
  return g;
}

function tube(points: THREE.Vector3[], r: number, seg = 200): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, 8, false);
}

export class LandmarkSystem {
  group = new THREE.Group();
  private colliders: unknown[] = [];
  private blinkers: THREE.Mesh[] = [];
  ggb: { towers: THREE.Vector3[]; axis: THREE.Vector3 } | null = null;

  constructor(private world: WorldData, private graph: RoadGraph, private physics: Physics) {}

  private pos(id: string): { x: number; z: number } {
    const l = this.world.meta.landmarks.find((m) => m.id === id)!;
    return lonLatToWorld(l.lon, l.lat);
  }

  build(): void {
    this.goldenGate();
    this.bayBridge();
    this.salesforce();
    this.transamerica();
    this.coit();
    this.ferryTower();
    this.cityHall();
    this.sutro();
    this.palace();
    this.alcatraz();
    this.lombard();
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private fixed(desc: any, x: number, y: number, z: number, rotY = 0): void {
    const R = Physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    this.colliders.push(this.physics.world.createCollider(desc, body));
  }

  private aviationLight(x: number, y: number, z: number, size = 1.2): void {
    const m = new THREE.MeshBasicNodeMaterial();
    const blink = step(0.5, fract(time.mul(0.75)));
    m.colorNode = vec3(1, 0.05, 0.02).mul(blink.mul(U.night.mul(14).add(2)).add(0.3));
    const s = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), m);
    s.position.set(x, y, z);
    s.castShadow = false;
    this.group.add(s);
    this.blinkers.push(s);
  }

  // ------------------------------------------------------------------ Golden Gate Bridge
  private goldenGate(): void {
    const pts: V2[] = [];
    const els: { p: V2; y: number }[] = [];
    for (const e of this.graph.edges) {
      if (e.name !== 'Golden Gate Bridge' || !e.el) continue;
      for (let k = 0; k < e.pts.length / 2; k++) { const p: V2 = [e.pts[2 * k], e.pts[2 * k + 1]]; pts.push(p); els.push({ p, y: e.el[k] }); }
    }
    if (pts.length < 2) return;
    const north = pts.reduce((a, b) => (b[1] < a[1] ? b : a)), south = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const axis = new THREE.Vector3(south[0] - north[0], 0, south[1] - north[1]);
    const len = axis.length(); axis.normalize();
    const side = new THREE.Vector3(axis.z, 0, -axis.x);
    const at = (t: number) => new THREE.Vector3(north[0] + axis.x * t, 0, north[1] + axis.z * t);
    // deck elevation from the real road profile (nearest sample)
    const deckY = (t: number) => {
      const p = at(t); let best = Infinity, y = 67;
      for (const e of els) { const d = (e.p[0] - p.x) ** 2 + (e.p[1] - p.z) ** 2; if (d < best) { best = d; y = e.y; } }
      return y;
    };
    const tN = 880, tS = tN + 1280, aN = tN - 343, aS = tS + 343;
    const orange = new THREE.MeshStandardNodeMaterial({ color: 0xb8402e, roughness: 0.55, metalness: 0.35 });
    const towerTop = 227, half = 13.7;
    const towerGeos: THREE.BufferGeometry[] = [];
    const towers: THREE.Vector3[] = [];
    const rotY = Math.atan2(axis.x, axis.z);
    for (const tt of [tN, tS]) {
      const c = at(tt);
      towers.push(c.clone());
      const base = Math.min(this.world.heightAt(c.x, c.z), -1) - 10;
      // pier / fender
      towerGeos.push(boxAt(c.x, base, c.z, 60, 10 - base + 4, 32, rotY));
      for (const s of [-1, 1]) {
        const lx = c.x + side.x * half * s, lz = c.z + side.z * half * s;
        // three setback stages per leg (art-deco profile)
        const stages: [number, number, number][] = [[4, 110, 10.5], [110, 180, 9], [180, towerTop, 7.6]];
        for (const [y0, y1, w] of stages) towerGeos.push(boxAt(lx, y0, lz, w, y1 - y0, w * 1.45, rotY));
        // fluted vertical ribs
        for (const off of [-1, 1]) towerGeos.push(boxAt(lx + axis.x * off * 5.6, 4, lz + axis.z * off * 5.6, 1.6, towerTop - 30, 2.2, rotY));
        this.fixed(Physics.R.ColliderDesc.cuboid(5.5, (towerTop - 4) / 2, 7.5), lx, 4 + (towerTop - 4) / 2, lz, rotY);
      }
      // portal struts above deck (4) and below-deck bracing
      const dy = deckY(tt);
      for (const y of [dy + 22, dy + 60, dy + 100, towerTop - 8]) towerGeos.push(boxAt(c.x, y, c.z, 2 * half, 6, 4.2, rotY + Math.PI / 2));
      towerGeos.push(boxAt(c.x, dy - 12, c.z, 2 * half, 5, 4.2, rotY + Math.PI / 2));
      this.aviationLight(c.x + side.x * half, towerTop + 2, c.z + side.z * half, 1.5);
      this.aviationLight(c.x - side.x * half, towerTop + 2, c.z - side.z * half, 1.5);
    }
    // anchorage blocks
    for (const ta of [aN, aS]) {
      const c = at(ta);
      const gy = Math.max(this.world.heightAt(c.x, c.z), -2);
      const top = deckY(ta) - 2;
      towerGeos.push(boxAt(c.x, gy - 5, c.z, 60, top - gy + 5, 40, rotY));
    }
    const towerMesh = new THREE.Mesh(mergeGeometries(towerGeos.map((g) => g.toNonIndexed())), orange);
    this.group.add(towerMesh);
    // main cables: parabolic main span, side spans to anchorages
    const cableGeos: THREE.BufferGeometry[] = [];
    const suspPos: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const off = side.clone().multiplyScalar(half * s);
      const cable: THREE.Vector3[] = [];
      const topY = towerTop - 4;
      const pushPt = (t: number, y: number) => cable.push(at(t).add(off).setY(y));
      for (let t = aN; t <= aS; t += 20) {
        let y: number;
        if (t < tN) { const u = (t - aN) / (tN - aN); y = THREE.MathUtils.lerp(deckY(aN) + 2, topY, u) - 18 * Math.sin(Math.PI * u); }
        else if (t > tS) { const u = (t - tS) / (aS - tS); y = THREE.MathUtils.lerp(topY, deckY(aS) + 2, u) - 18 * Math.sin(Math.PI * u); }
        else { const u = (t - tN) / (tS - tN); const low = deckY((tN + tS) / 2) + 4; y = low + (topY - low) * (2 * u - 1) ** 2; }
        pushPt(t, y);
        if (t > aN + 15 && t < aS - 15 && Math.abs(t - tN) > 8 && Math.abs(t - tS) > 8) suspPos.push(at(t).add(off).setY(y));
      }
      cableGeos.push(tube(cable, 0.6, 300));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(cableGeos), orange));
    // suspender ropes (instanced)
    const ropeG = new THREE.CylinderGeometry(0.09, 0.09, 1, 4); ropeG.translate(0, 0.5, 0);
    const ropes = new THREE.InstancedMesh(ropeG, orange, suspPos.length);
    const m = new THREE.Matrix4();
    suspPos.forEach((p, i) => {
      const t = new THREE.Vector3(p.x - north[0], 0, p.z - north[1]).dot(axis);
      const dy = deckY(t) + 1.2;
      m.compose(new THREE.Vector3(p.x, dy, p.z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.5, p.y - dy), 1));
      ropes.setMatrixAt(i, m);
    });
    ropes.castShadow = true;
    this.group.add(ropes);
    // stiffening truss under the deck (procedural lattice with alpha cut-out)
    const trussMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8402e, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
    const tu = uv().x.mul(len / 7.6), tv = uv().y;
    const diag = min(abs(fract(tu.add(tv)).sub(0.5)), abs(fract(tu.sub(tv)).sub(0.5)));
    const chord = max(step(tv, 0.08), step(0.92, tv));
    // fade the lattice to solid where it would alias (distance)
    const aaT = smoothstep(0.08, 0.3, fwidth(tu));
    trussMat.opacityNode = max(max(step(diag, 0.06), chord), aaT);
    const trussGeos: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const posA: number[] = [], uvA: number[] = [], idx: number[] = [];
      const N = 80;
      for (let k = 0; k <= N; k++) {
        const t = aN - 200 + ((aS - aN + 400) * k) / N;
        if (t < 0 || t > len) continue;
        const p = at(t).add(side.clone().multiplyScalar(half * s));
        const y = deckY(t);
        posA.push(p.x, y - 0.4, p.z, p.x, y - 7.6, p.z);
        uvA.push(k / N, 1, k / N, 0);
      }
      for (let k = 0; k < posA.length / 6 - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
      g.setIndex(idx); g.computeVertexNormals();
      trussGeos.push(g);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(trussGeos), trussMat));
    // deck slab (always visible, below the streamed road surface)
    const deckPos: number[] = [], deckIdx: number[] = [];
    for (let t = Math.max(0, aN - 250), k = 0; t <= Math.min(len, aS + 250); t += 20, k++) {
      const c = at(t), y = deckY(t);
      for (const s of [-1, 1]) { const p = c.clone().addScaledVector(side, (half + 0.6) * s); deckPos.push(p.x, y - 0.25, p.z); }
      if (k > 0) { const a = 2 * k; deckIdx.push(a - 2, a, a - 1, a - 1, a, a + 1, a - 2, a - 1, a, a - 1, a + 1, a); }
    }
    const deckG = new THREE.BufferGeometry();
    deckG.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3)); deckG.setIndex(deckIdx); deckG.computeVertexNormals();
    this.group.add(new THREE.Mesh(deckG, new THREE.MeshStandardNodeMaterial({ color: 0x55504a, roughness: 0.9, side: THREE.DoubleSide })));
    // sodium deck lamps
    const lampMat = new THREE.MeshBasicNodeMaterial();
    lampMat.colorNode = vec3(1, 0.62, 0.25).mul(U.night.mul(10).add(0.6));
    const lampG = new THREE.SphereGeometry(0.35, 6, 4);
    const lamps: THREE.BufferGeometry[] = [];
    for (let t = aN; t <= aS; t += 50) for (const s of [-1, 1]) {
      const p = at(t).add(side.clone().multiplyScalar((half - 0.5) * s));
      lamps.push(lampG.clone().translate(p.x, deckY(t) + 7, p.z));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(lamps), lampMat));
    this.ggb = { towers, axis };
  }

  // ------------------------------------------------------------------ Bay Bridge (west span)
  private bayBridge(): void {
    let best = -1, bestLen = 0;
    this.graph.edges.forEach((e, i) => {
      if (!e.el || e.cls > 1) return;
      const sx = e.pts[0], ex = e.pts[e.pts.length - 2];
      if (Math.max(sx, ex) > 3000 && Math.min(sx, ex) < 1700 && e.len > 1500 && e.len > bestLen) { best = i; bestLen = e.len; }
    });
    if (best < 0) return;
    const e = this.graph.edges[best];
    const sfIsA = e.pts[0] < e.pts[e.pts.length - 2];
    const L = e.len;
    const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
    // follow the real (curved) road polyline: position, deck height and frame at distance t from the SF end
    const P = (t: number) => {
      this.graph.sample(e, sfIsA ? t : L - t, o);
      const tx = sfIsA ? o.tx : -o.tx, tz = sfIsA ? o.tz : -o.tz;
      return { p: new THREE.Vector3(o.x, 0, o.z), y: o.y, side: new THREE.Vector3(tz, 0, -tx), rot: Math.atan2(tx, tz) };
    };
    let s0 = 0, s1 = L;
    for (let t = 0; t < L; t += 10) { const q = P(t).p; if (this.world.heightAt(q.x, q.z) < 0) { s0 = t; break; } }
    for (let t = L; t > 0; t -= 10) { const q = P(t).p; if (this.world.heightAt(q.x, q.z) < 0) { s1 = t; break; } }
    const unit = (s1 - s0) / (354 * 4 + 704 * 2 + 60);
    const marks = [0, 354, 1058, 1412, 1472, 1826, 2530, 2884].map((m) => s0 + m * unit);
    const anchors = [marks[0], marks[3] + 30 * unit, marks[7]];
    const towersT = [marks[1], marks[2], marks[5], marks[6]];
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0x9aa3aa, roughness: 0.5, metalness: 0.45 });
    const geos: THREE.BufferGeometry[] = [];
    const top = 160, half = 12;
    for (const tt of towersT) {
      const f = P(tt);
      for (const s of [-1, 1]) {
        const l = f.p.clone().addScaledVector(f.side, half * s);
        geos.push(boxAt(l.x, -20, l.z, 5, top + 20, 8, f.rot));
        this.fixed(Physics.R.ColliderDesc.cuboid(2.5, (top + 20) / 2, 4), l.x, -20 + (top + 20) / 2, l.z, f.rot);
      }
      for (const y of [f.y + 25, f.y + 62, top - 6]) {
        for (const sg of [1, -1]) {
          const g1 = new THREE.BoxGeometry(2 * half * 1.15, 1.4, 1.8); g1.rotateZ(0.42 * sg); g1.rotateY(f.rot + Math.PI / 2); g1.translate(f.p.x, y, f.p.z);
          geos.push(g1);
        }
      }
      geos.push(boxAt(f.p.x, -20, f.p.z, 38, 22, 20, f.rot));
      this.aviationLight(f.p.x, top + 2, f.p.z);
    }
    for (const ta of anchors) { const f = P(ta); geos.push(boxAt(f.p.x, -15, f.p.z, 45, f.y + 13, 58, f.rot)); }
    this.group.add(new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), steel));
    const cableG: THREE.BufferGeometry[] = [];
    const ledPts: { top: THREE.Vector3; deck: number }[] = [];
    for (const s of [-1, 1]) {
      for (const [a, t1, t2, b] of [[anchors[0], towersT[0], towersT[1], anchors[1]], [anchors[1], towersT[2], towersT[3], anchors[2]]]) {
        const pts: THREE.Vector3[] = [];
        for (let t = a; t <= b; t += 15) {
          const f = P(t);
          let y: number;
          if (t < t1) y = THREE.MathUtils.lerp(P(a).y + 3, top - 3, (t - a) / (t1 - a));
          else if (t > t2) y = THREE.MathUtils.lerp(top - 3, P(b).y + 3, (t - t2) / (b - t2));
          else { const u = (t - t1) / (t2 - t1); const low = P((t1 + t2) / 2).y + 5; y = low + (top - 3 - low) * (2 * u - 1) ** 2; }
          const q = f.p.clone().addScaledVector(f.side, half * s).setY(y);
          pts.push(q);
          if (Math.abs(t - t1) > 6 && Math.abs(t - t2) > 6) ledPts.push({ top: q, deck: f.y + 1 });
        }
        cableG.push(tube(pts, 0.45, 160));
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(cableG), steel));
    // "The Bay Lights": LED strands on the vertical suspender cables (animated at night)
    const ledMat = new THREE.MeshBasicNodeMaterial();
    ledMat.colorNode = vec3(0.4, 0.42, 0.45).add(vec3(1.0, 0.97, 0.9).mul(U.night).mul(
      smoothstep(0.6, 1.0, sin(time.mul(1.7).add(uv().y.mul(8.0))).mul(0.5).add(0.5)).mul(4.0)));
    const ropeG = new THREE.CylinderGeometry(0.12, 0.12, 1, 4); ropeG.translate(0, 0.5, 0);
    const leds = new THREE.InstancedMesh(ropeG, ledMat, ledPts.length);
    const m = new THREE.Matrix4();
    ledPts.forEach((lp, i) => {
      m.compose(new THREE.Vector3(lp.top.x, lp.deck, lp.top.z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.5, lp.top.y - lp.deck), 1));
      leds.setMatrixAt(i, m);
    });
    this.group.add(leds);
  }

  // ------------------------------------------------------------------ towers
  private salesforce(): void {
    const { x, z } = this.pos('salesforce');
    const g0 = this.world.heightAt(x, z);
    const levels: { ring: V2[]; y: number }[] = [];
    const rot = 0.06;
    for (let y = 0; y <= 270; y += 15) {
      const half = THREE.MathUtils.lerp(27, 21, (y / 270) ** 1.3);
      levels.push({ ring: roundedSquare(x, z, half, 9, 5, rot), y: g0 + y });
    }
    const tower = new THREE.Mesh(loft(levels, 0, 0xc9d4dc, 0.77, 4.2, false), buildingMaterial());
    this.group.add(tower);
    // crown: open lattice cap 270–326 m with the LED art screen
    const crown: { ring: V2[]; y: number }[] = [];
    for (let y = 270; y <= 326; y += 7) {
      const u = (y - 270) / 56;
      crown.push({ ring: roundedSquare(x, z, THREE.MathUtils.lerp(21, 9, u * u), THREE.MathUtils.lerp(9, 6, u), 5, rot), y: g0 + y });
    }
    const crownMat = new THREE.MeshStandardNodeMaterial({ color: 0xdfe6ea, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide, alphaTest: 0.5 });
    const cu = uv().x, cv = uv().y;
    crownMat.opacityNode = max(step(fract(cu.div(2.2)), 0.22), step(fract(cv.div(3.5)), 0.12));
    crownMat.emissiveNode = vec3(0.6, 0.75, 1.0).mul(U.night.mul(2.5)).mul(sin(cv.mul(0.2).add(cu.mul(0.05)).sub(time.mul(0.8))).mul(0.5).add(0.5));
    this.group.add(new THREE.Mesh(loft(crown, 0, 0xffffff, 0.5, 4, false), crownMat));
    const capG = new THREE.CylinderGeometry(5, 9, 2, 16); capG.translate(x, g0 + 326, z);
    this.group.add(new THREE.Mesh(capG, crownMat));
    this.aviationLight(x, g0 + 329, z);
    this.fixed(Physics.R.ColliderDesc.cuboid(24, 163, 24), x, g0 + 163, z, rot);
  }

  private transamerica(): void {
    const { x, z } = this.pos('transamerica');
    const g0 = this.world.heightAt(x, z);
    const levels: { ring: V2[]; y: number }[] = [];
    const rot = 0.0;
    const sq = (h: number): V2[] => [[x + h, z + h], [x - h, z + h], [x - h, z - h], [x + h, z - h]];
    // flared base (lower 15 m) then the tapering pyramid to 212 m
    levels.push({ ring: sq(28), y: g0 - 1 });
    for (let y = 15; y <= 212; y += 12) levels.push({ ring: sq(26.5 * (1 - (y - 5) / 250)), y: g0 + y });
    this.group.add(new THREE.Mesh(loft(levels, 2, 0xe9e7e1, 0.31, 3.9, true), buildingMaterial()));
    // east & west "wings" (elevator / stair towers) from the 29th floor up
    const wings: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const w: { ring: V2[]; y: number }[] = [];
      for (let y = 100; y <= 225; y += 25) {
        const h = 26.5 * (1 - (y - 5) / 250);
        const cx = x + s * (h + 3.5);
        w.push({ ring: [[cx + 4, z + 6], [cx - 4, z + 6], [cx - 4, z - 6], [cx + 4, z - 6]], y: g0 + y });
      }
      wings.push(loft(w, 2, 0xe5e2da, 0.62, 3.9, true));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(wings), buildingMaterial()));
    // aluminium spire
    const spire = new THREE.ConeGeometry(6.5, 50, 4); spire.rotateY(Math.PI / 4); spire.translate(x, g0 + 212 + 25, z);
    this.group.add(new THREE.Mesh(spire, new THREE.MeshStandardNodeMaterial({ color: 0xd8dde0, metalness: 0.85, roughness: 0.25 })));
    this.aviationLight(x, g0 + 262, z, 1.0);
    for (let k = 0; k < 6; k++) this.fixed(Physics.R.ColliderDesc.cuboid(26 - k * 4.4, 17, 26 - k * 4.4), x, g0 + 17 + k * 34, z, rot);
  }

  private coit(): void {
    const { x, z } = this.pos('coit');
    const g0 = this.world.heightAt(x, z);
    const ring = (r: number) => circle(x, z, r, 32, 0.08);
    const lv = [{ ring: ring(6.2), y: g0 - 1 }, { ring: ring(5.6), y: g0 + 50 }, { ring: ring(5.9), y: g0 + 52 }, { ring: ring(5.4), y: g0 + 60 }, { ring: ring(4.8), y: g0 + 64 }];
    this.group.add(new THREE.Mesh(loft(lv, 2, 0xe8dfcc, 0.9, 7.5, true), buildingMaterial()));
    const base = new THREE.CylinderGeometry(15, 16, 6, 24); base.translate(x, g0 + 2, z);
    this.group.add(new THREE.Mesh(base, new THREE.MeshStandardNodeMaterial({ color: 0xd7cdb8, roughness: 0.9 })));
    this.fixed(Physics.R.ColliderDesc.cylinder(32, 6), x, g0 + 32, z);
  }

  private ferryTower(): void {
    const { x, z } = this.pos('ferry');
    const base = 0;
    const stone = 0xdcd0b6;
    const geos: THREE.BufferGeometry[] = [];
    const m = buildingMaterial();
    const sq = (h: number, cx = x, cz = z): V2[] => [[cx + h, cz + h], [cx - h, cz + h], [cx - h, cz - h], [cx + h, cz - h]];
    geos.push(loft([{ ring: sq(7), y: base + 2 }, { ring: sq(7), y: base + 52 }], 2, stone, 0.2, 4.5, true));
    geos.push(loft([{ ring: sq(5), y: base + 52 }, { ring: sq(5), y: base + 62 }], 2, stone, 0.3, 3.3, true));
    geos.push(loft([{ ring: sq(3.6), y: base + 62 }, { ring: sq(3.6), y: base + 69 }], 2, stone, 0.4, 3.5, true));
    this.group.add(new THREE.Mesh(mergeGeometries(geos), m));
    const cap = new THREE.ConeGeometry(3, 7, 8); cap.translate(x, base + 72.5, z);
    this.group.add(new THREE.Mesh(cap, new THREE.MeshStandardNodeMaterial({ color: 0x5f6f62, roughness: 0.5, metalness: 0.5 })));
    // clock faces (emissive at night)
    const cm = new THREE.MeshStandardNodeMaterial({ color: 0xf5f0e0, roughness: 0.4 });
    const r = uv().sub(0.5).length();
    cm.emissiveNode = vec3(1, 0.93, 0.75).mul(U.night.mul(3)).mul(smoothstep(0.5, 0.45, r));
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), cm);
      const a = (k * Math.PI) / 2;
      f.position.set(x + Math.sin(a) * 5.05, base + 57, z + Math.cos(a) * 5.05);
      f.rotation.y = a;
      this.group.add(f);
    }
    this.fixed(Physics.R.ColliderDesc.cuboid(7, 36, 7), x, base + 36, z);
  }

  private cityHall(): void {
    const { x, z } = this.pos('cityhall');
    const g0 = this.world.heightAt(x, z);
    const stone = new THREE.MeshStandardNodeMaterial({ color: 0xd8d2c4, roughness: 0.8 });
    const drum = new THREE.CylinderGeometry(17, 18, 22, 32); drum.translate(x, g0 + 40, z);
    const colonnade: THREE.BufferGeometry[] = [drum];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const c = new THREE.CylinderGeometry(0.8, 0.8, 18, 8); c.translate(x + Math.cos(a) * 19, g0 + 40, z + Math.sin(a) * 19);
      colonnade.push(c);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(colonnade.map((g) => g.toNonIndexed())), stone));
    const dome = new THREE.SphereGeometry(17.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 1.25, 1); dome.translate(x, g0 + 51, z);
    const domeMat = new THREE.MeshStandardNodeMaterial({ color: 0x7d8178, roughness: 0.45, metalness: 0.55 });
    // gilded ribs
    const ang = uv().x.mul(16);
    domeMat.colorNode = mix(vec3(0.45, 0.47, 0.44), vec3(0.85, 0.66, 0.25), smoothstep(0.92, 0.97, abs(fract(ang).sub(0.5)).mul(2)));
    this.group.add(new THREE.Mesh(dome, domeMat));
    const lantern = new THREE.CylinderGeometry(3.2, 3.6, 9, 12); lantern.translate(x, g0 + 77, z);
    const top = new THREE.ConeGeometry(2.5, 7, 12); top.translate(x, g0 + 85, z);
    const gold = new THREE.MeshStandardNodeMaterial({ color: 0xd9a646, roughness: 0.25, metalness: 1 });
    this.group.add(new THREE.Mesh(mergeGeometries([lantern, top]), gold));
    this.fixed(Physics.R.ColliderDesc.ball(19), x, g0 + 55, z);
  }

  private sutro(): void {
    const { x, z } = this.pos('sutro');
    const g0 = this.world.heightAt(x, z);
    const H = 298;
    const geos: THREE.BufferGeometry[] = [];
    const legs: THREE.Vector3[][] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      const b = new THREE.Vector3(x + Math.cos(a) * 24, g0, z + Math.sin(a) * 24);
      const mid = new THREE.Vector3(x + Math.cos(a) * 10, g0 + 160, z + Math.sin(a) * 10);
      const top = new THREE.Vector3(x + Math.cos(a) * 14, g0 + 230, z + Math.sin(a) * 14);
      const tip = new THREE.Vector3(x + Math.cos(a) * 17, g0 + H, z + Math.sin(a) * 17);
      legs.push([b, mid, top, tip]);
      for (let s = 0; s < 3; s++) {
        const p0 = [b, mid, top][s], p1 = [mid, top, tip][s];
        const len = p0.distanceTo(p1);
        const cyl = new THREE.CylinderGeometry(s === 2 ? 0.8 : 1.6, s === 0 ? 2.4 : 1.6, len, 6);
        // red/white aviation bands via vertex colours
        const cols: number[] = [];
        const pa = cyl.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const yy = (pa.getY(i) + len / 2) / len;
          const band = Math.floor(((s === 0 ? 0 : s === 1 ? 160 : 230) + yy * len) / 30) % 2;
          cols.push(band ? 0.85 : 0.75, band ? 0.85 : 0.12, band ? 0.85 : 0.1);
        }
        cyl.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
        cyl.applyQuaternion(q);
        const c = p0.clone().add(p1).multiplyScalar(0.5);
        cyl.translate(c.x, c.y, c.z);
        geos.push(cyl.toNonIndexed());
      }
      this.fixed(Physics.R.ColliderDesc.cylinder(80, 3), b.x * 0.5 + mid.x * 0.5, g0 + 80, b.z * 0.5 + mid.z * 0.5);
    }
    // platforms
    for (const y of [160, 230]) {
      const p = new THREE.CylinderGeometry(19, 19, 4, 3); p.rotateY(0.3); p.translate(x, g0 + y, z);
      const cols = new Array(p.attributes.position.count * 3).fill(0.8);
      p.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geos.push(p.toNonIndexed());
    }
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    this.group.add(new THREE.Mesh(mergeGeometries(geos), mat));
    for (const l of legs) this.aviationLight(l[3].x, l[3].y + 1.5, l[3].z, 1.4);
    this.aviationLight(x, g0 + 162, z);
  }

  private palace(): void {
    const { x, z } = this.pos('palace');
    const g0 = this.world.heightAt(x, z);
    const salmon = new THREE.MeshStandardNodeMaterial({ color: 0xd49a7a, roughness: 0.85 });
    const geos: THREE.BufferGeometry[] = [];
    const drum = new THREE.CylinderGeometry(16, 17, 24, 8); drum.translate(x, g0 + 12, z); geos.push(drum.toNonIndexed());
    const dome = new THREE.SphereGeometry(16.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 1.2, 1); dome.translate(x, g0 + 24, z); geos.push(dome.toNonIndexed());
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const c = new THREE.CylinderGeometry(1.4, 1.6, 26, 10); c.translate(x + Math.cos(a) * 18.5, g0 + 13, z + Math.sin(a) * 18.5); geos.push(c.toNonIndexed());
    }
    this.group.add(new THREE.Mesh(mergeGeometries(geos), salmon));
    this.fixed(Physics.R.ColliderDesc.cylinder(20, 18), x, g0 + 20, z);
  }

  private alcatraz(): void {
    const { x, z } = this.pos('alcatraz');
    const lx = x - 35, lz = z + 10;
    const g0 = this.world.heightAt(lx, lz);
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xece8de, roughness: 0.7 });
    const t = new THREE.CylinderGeometry(2.2, 3, 24, 8); t.translate(lx, g0 + 12, lz);
    const lamp = new THREE.CylinderGeometry(2.3, 2.3, 3, 8); lamp.translate(lx, g0 + 25.5, lz);
    this.group.add(new THREE.Mesh(t, white));
    const lm = new THREE.MeshBasicNodeMaterial();
    lm.colorNode = vec3(1, 0.95, 0.7).mul(U.night.mul(8).add(0.8)).mul(sin(time.mul(1.2)).mul(0.5).add(0.5).mul(0.7).add(0.3));
    this.group.add(new THREE.Mesh(lamp, lm));
    this.fixed(Physics.R.ColliderDesc.cylinder(14, 3), lx, g0 + 14, lz);
    // water tower
    const wx = x + 120, wz = z - 60, wg = this.world.heightAt(wx, wz);
    const tank = new THREE.CylinderGeometry(6, 6, 8, 16); tank.translate(wx, wg + 22, wz);
    const legsG: THREE.BufferGeometry[] = [tank];
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; const l = new THREE.CylinderGeometry(0.4, 0.4, 18, 6); l.translate(wx + Math.cos(a) * 5, wg + 9, wz + Math.sin(a) * 5); legsG.push(l); }
    this.group.add(new THREE.Mesh(mergeGeometries(legsG.map((g) => g.toNonIndexed())), new THREE.MeshStandardNodeMaterial({ color: 0x9d9a90, roughness: 0.8, metalness: 0.3 })));
  }

  /** Lombard Street's crooked block: flowering hydrangea hedges between the switchbacks (from the real road geometry) */
  private lombard(): void {
    const { x, z } = this.pos('lombard');
    const pts: THREE.Vector3[] = [];
    for (const id of this.graph.edgesNear(x, z, 140)) {
      const e = this.graph.edges[id];
      if (!/Lombard/.test(e.name)) continue;
      const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
      for (let s = 1; s < e.len; s += 1.6) {
        this.graph.sample(e, s, o);
        if ((o.x - x) ** 2 + (o.z - z) ** 2 > 110 ** 2) continue;
        for (const sd of [-1, 1]) {
          const px = o.x - o.tz * sd * 4.4, pz = o.z + o.tx * sd * 4.4;
          pts.push(new THREE.Vector3(px, this.world.heightAt(px, pz) + 0.4, pz));
        }
      }
    }
    if (!pts.length) return;
    const g = new THREE.IcosahedronGeometry(0.9, 1);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    const im = new THREE.InstancedMesh(g, mat, pts.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const pal = [0xc2185b, 0xe91e63, 0x2e7d32, 0x388e3c, 0xad1457, 0x43a047, 0xd81b60];
    pts.forEach((p, i) => {
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 0.7 + (i % 3) * 0.1, 1));
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setHex(pal[i % pal.length]));
    });
    this.group.add(im);
    void hash; void floor; void float;
  }
}
