import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { barkMaterial, foliageMaterial, lampMaterial } from './Materials';
import { U } from '../core/Uniforms';
import { float, vec3, uv, smoothstep, length, instanceColor, attribute } from 'three/tsl';

/**
 * Procedural vegetation & street-furniture models + instanced renderers.
 * Positions come from real data (OSM street trees, street lamps, signals, benches, bus stops, hydrants)
 * or from procedural sampling inside real park/forest polygons (done in the preprocessing pipeline).
 */
function colorize(g: THREE.BufferGeometry, c: THREE.Color, jitter = 0.08, seed = 1): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rnd() - 0.5) * 2 * jitter;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r * j; col[(i + k) * 3 + 1] = c.g * j; col[(i + k) * 3 + 2] = c.b * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function blob(r: number, detail: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 + seed * 2) + 0.12 * Math.sin(vy * 5.3 + seed);
    p.setXYZ(i, vx * sx * n + x, vy * sy * n + y, vz * sz * n + z);
  }
  g.computeVertexNormals();
  return g;
}

function trunk(h: number, r0: number, r1: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 7, 3, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + lean * (p.getY(i) / h) ** 2);
  g.computeVertexNormals();
  return g;
}

interface TreeModel { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry }

function makeTree(kind: number, far: boolean): TreeModel {
  const green = new THREE.Color(0.2, 0.33, 0.12);
  const d = far ? 0 : 1;
  switch (kind) {
    case 1: { // Monterey cypress: wind-sculpted, flat layered crown
      const bark = colorize(trunk(7, 0.45, 0.25, 1.2), new THREE.Color(0.28, 0.2, 0.15));
      const parts = far ? [blob(4.5, 0, 1.6, 0.55, 1.2, 1.2, 7.5, 0, 1)] :
        [blob(3.4, d, 1.5, 0.5, 1.1, 0.5, 6.8, 0, 1), blob(2.8, d, 1.4, 0.5, 1.1, 2.4, 8.2, 0.6, 2), blob(2.5, d, 1.3, 0.45, 1.2, -1.4, 7.7, -0.8, 3), blob(2.2, d, 1.2, 0.4, 1, 1.4, 9.3, -0.4, 4)];
      return { bark, leaves: colorize(mergeGeometries(parts.map((g) => g.toNonIndexed())), new THREE.Color(0.11, 0.2, 0.09), 0.12, 3) };
    }
    case 2: { // eucalyptus: tall, pale bark, sparse high crown
      const bark = colorize(trunk(17, 0.4, 0.15, 0.8), new THREE.Color(0.62, 0.58, 0.5));
      const parts = far ? [blob(3.6, 0, 1, 1.6, 1, 0.4, 15, 0, 1)] :
        [blob(2.4, d, 1, 1.5, 1, 0.6, 13.5, 0, 1), blob(2.1, d, 1.1, 1.4, 1, -1.2, 16, 0.6, 2), blob(1.9, d, 1, 1.3, 1.1, 1.3, 17.5, -0.6, 3)];
      return { bark, leaves: colorize(mergeGeometries(parts.map((g) => g.toNonIndexed())), new THREE.Color(0.25, 0.32, 0.2), 0.1, 5) };
    }
    case 3: { // Canary Island date palm
      const bark = colorize(trunk(9, 0.55, 0.45), new THREE.Color(0.42, 0.33, 0.22));
      const fronds: THREE.BufferGeometry[] = [];
      const n = far ? 8 : 16;
      for (let k = 0; k < n; k++) {
        const g = new THREE.PlaneGeometry(0.9, 5.2, 1, far ? 1 : 4);
        g.translate(0, 2.6, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -0.06 * y * y); }
        g.rotateX(-0.9 - (k % 3) * 0.25);
        g.rotateY((k / n) * Math.PI * 2 + (k % 2) * 0.2);
        g.translate(0, 9, 0);
        fronds.push(g.toNonIndexed());
      }
      fronds.push(blob(0.9, 0, 1, 0.8, 1, 0, 9, 0, 9).toNonIndexed());
      const leaves = colorize(mergeGeometries(fronds), new THREE.Color(0.24, 0.36, 0.13), 0.1, 7);
      leaves.computeVertexNormals();
      return { bark, leaves };
    }
    case 4: { // pine
      const bark = colorize(trunk(10, 0.35, 0.12), new THREE.Color(0.3, 0.21, 0.14));
      const parts: THREE.BufferGeometry[] = [];
      const layers = far ? 2 : 4;
      for (let k = 0; k < layers; k++) {
        const c = new THREE.ConeGeometry(3.2 - k * 0.6, 4 - k * 0.4, far ? 6 : 9);
        c.translate(0, 5 + k * 2.4, 0);
        parts.push(c.toNonIndexed());
      }
      return { bark, leaves: colorize(mergeGeometries(parts), new THREE.Color(0.1, 0.2, 0.11), 0.1, 11) };
    }
    default: { // broadleaf street tree (London plane / ficus)
      const bark = colorize(trunk(4.2, 0.24, 0.16), new THREE.Color(0.4, 0.34, 0.27));
      const parts = far ? [blob(3.2, 0, 1.05, 0.95, 1.05, 0, 6.2, 0, 1)] :
        [blob(2.3, d, 1, 0.9, 1, 0, 6.2, 0, 1), blob(1.8, d, 1, 0.9, 1, 1.4, 5.6, 0.4, 2), blob(1.7, d, 1, 0.9, 1, -1.3, 5.8, -0.5, 3), blob(1.6, d, 1, 0.9, 1, 0.2, 7.4, -1.1, 4), blob(1.5, d, 1, 0.9, 1, -0.4, 5.3, 1.3, 5)];
      return { bark, leaves: colorize(mergeGeometries(parts.map((g) => g.toNonIndexed())), green, 0.12, 13) };
    }
  }
}

/** A growable InstancedMesh fed from a flat list of transforms. */
class Pool {
  mesh: THREE.InstancedMesh;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public cap: number, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // allocate per-instance colour up-front so the material compiles with instance colouring
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class TreeSystem {
  group = new THREE.Group();
  private near: { bark: Pool; leaves: Pool }[] = [];
  private far: { bark: Pool; leaves: Pool }[] = [];
  constructor(capNear = 12000, capFar = 40000) {
    const bm = barkMaterial(), fm = foliageMaterial();
    const fm2 = foliageMaterial(); fm2.side = THREE.DoubleSide;
    for (let k = 0; k < 5; k++) {
      const a = makeTree(k, false), b = makeTree(k, true);
      const leafMat = k === 3 ? fm2 : fm;
      const n = { bark: new Pool(a.bark, bm, capNear), leaves: new Pool(a.leaves, leafMat, capNear) };
      const f = { bark: new Pool(b.bark, bm, capFar, false), leaves: new Pool(b.leaves, leafMat, capFar, false) };
      this.near.push(n); this.far.push(f);
      for (const p of [n.bark, n.leaves, f.bark, f.leaves]) this.group.add(p.mesh);
    }
  }

  /** Rebuild instance buffers from tile tree arrays [x,y,z,kind,scale]. */
  update(lists: Float32Array[], cx: number, cz: number, nearR: number, farR: number): void {
    const cN = [0, 0, 0, 0, 0], cF = [0, 0, 0, 0, 0];
    const n2 = nearR * nearR, f2 = farR * farR;
    for (const arr of lists) {
      for (let i = 0; i < arr.length; i += 5) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2], kind = arr[i + 3] | 0, sc = arr[i + 4];
        const d2 = (x - cx) ** 2 + (z - cz) ** 2;
        if (d2 > f2) continue;
        const isNear = d2 < n2;
        const set = isNear ? this.near[kind] : this.far[kind];
        const cnt = isNear ? cN : cF;
        if (cnt[kind] >= set.bark.cap) continue;
        const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; const r = h - Math.floor(h);
        tmpQ.setFromAxisAngle(UP, r * Math.PI * 2);
        tmpS.setScalar(sc * (0.85 + r * 0.3));
        tmpP.set(x, y - 0.2, z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        set.bark.mesh.setMatrixAt(cnt[kind], tmpM);
        set.leaves.mesh.setMatrixAt(cnt[kind], tmpM);
        tmpC.setRGB(0.85 + r * 0.3, 0.9 + ((r * 7) % 1) * 0.2, 0.8 + ((r * 13) % 1) * 0.25);
        set.leaves.mesh.setColorAt(cnt[kind], tmpC);
        cnt[kind]++;
      }
    }
    for (let k = 0; k < 5; k++) {
      for (const [set, c] of [[this.near[k], cN[k]], [this.far[k], cF[k]]] as const) {
        for (const p of [set.bark, set.leaves]) {
          p.mesh.count = c;
          p.mesh.instanceMatrix.needsUpdate = true;
          if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ street furniture
function lampPole(): { pole: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const pole = new THREE.CylinderGeometry(0.07, 0.12, 8.5, 6); pole.translate(0, 4.25, 0);
  const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.0, 5); arm.rotateX(Math.PI / 2); arm.translate(0, 8.3, 1.0);
  const g = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()]);
  const head = new THREE.BoxGeometry(0.35, 0.16, 0.8); head.translate(0, 8.2, 1.9);
  return { pole: colorize(g, new THREE.Color(0.18, 0.2, 0.21), 0.02), head };
}

function signalModel(): { pole: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const pole = new THREE.CylinderGeometry(0.1, 0.14, 6, 7); pole.translate(0, 3, 0);
  const mast = new THREE.CylinderGeometry(0.07, 0.09, 6, 6); mast.rotateX(Math.PI / 2); mast.translate(0, 5.8, 3);
  const box = new THREE.BoxGeometry(0.42, 1.2, 0.35); box.translate(0, 5.1, 5.2);
  const box2 = new THREE.BoxGeometry(0.42, 1.2, 0.35); box2.translate(0, 2.9, 0.25);
  const g = mergeGeometries([pole, mast, box, box2].map((x) => x.toNonIndexed()));
  const l1 = new THREE.CircleGeometry(0.13, 10); l1.translate(0, 5.1, 5.38);
  const l2 = new THREE.CircleGeometry(0.13, 10); l2.translate(0, 2.9, 0.43);
  const heads = mergeGeometries([l1, l2]);
  return { pole: colorize(g, new THREE.Color(0.12, 0.13, 0.12), 0.02), heads };
}

function bench(): THREE.BufferGeometry {
  const s = new THREE.BoxGeometry(1.8, 0.08, 0.45); s.translate(0, 0.45, 0);
  const b = new THREE.BoxGeometry(1.8, 0.45, 0.06); b.translate(0, 0.75, -0.2);
  const l1 = new THREE.BoxGeometry(0.06, 0.45, 0.4); l1.translate(-0.8, 0.22, 0);
  const l2 = l1.clone(); l2.translate(1.6, 0, 0);
  return colorize(mergeGeometries([s, b, l1, l2].map((x) => x.toNonIndexed())), new THREE.Color(0.32, 0.22, 0.14), 0.05);
}

function busShelter(): THREE.BufferGeometry {
  const roof = new THREE.BoxGeometry(4, 0.12, 1.6); roof.translate(0, 2.5, 0);
  const back = new THREE.BoxGeometry(4, 2.2, 0.05); back.translate(0, 1.3, -0.75);
  const p1 = new THREE.BoxGeometry(0.08, 2.5, 0.08); p1.translate(-1.95, 1.25, 0.7);
  const p2 = p1.clone(); p2.translate(3.9, 0, 0);
  const side = new THREE.BoxGeometry(0.05, 2.2, 1.4); side.translate(1.95, 1.3, 0);
  return colorize(mergeGeometries([roof, back, p1, p2, side].map((x) => x.toNonIndexed())), new THREE.Color(0.55, 0.6, 0.62), 0.05);
}

function hydrant(): THREE.BufferGeometry {
  const b = new THREE.CylinderGeometry(0.16, 0.18, 0.7, 8); b.translate(0, 0.35, 0);
  const t = new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); t.translate(0, 0.7, 0);
  const n = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6); n.rotateZ(Math.PI / 2); n.translate(0, 0.45, 0);
  return colorize(mergeGeometries([b, t, n].map((x) => x.toNonIndexed())), new THREE.Color(0.85, 0.82, 0.7), 0.05);
}

function basket(): THREE.BufferGeometry {
  const b = new THREE.CylinderGeometry(0.3, 0.27, 0.95, 10, 1, false); b.translate(0, 0.48, 0);
  return colorize(b, new THREE.Color(0.15, 0.3, 0.2), 0.03);
}

export class FurnitureSystem {
  group = new THREE.Group();
  private pools: Pool[] = [];
  private lampHeads: Pool;
  private lightPools: Pool;
  private sigHeads: Pool;
  signalRefs: { x: number; z: number; rot: number }[] = [];
  private sigColorFn: ((i: number, x: number, z: number, rot: number, out: THREE.Color) => void) | null = null;

  constructor(cap = 6000) {
    const solid = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
    const lamp = lampPole();
    const sig = signalModel();
    const geos = [lamp.pole, bench(), busShelter(), hydrant(), sig.pole, basket()];
    for (const g of geos) { const p = new Pool(g, solid, cap); this.pools.push(p); this.group.add(p.mesh); }
    this.lampHeads = new Pool(lamp.head, lampMaterial(), cap, false); this.group.add(this.lampHeads.mesh);
    // fake light pools under lamps at night (additive ground discs)
    const disc = new THREE.CircleGeometry(7, 24); disc.rotateX(-Math.PI / 2);
    const lm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const r = length(uv().sub(0.5)).mul(2);
    lm.colorNode = vec3(1.0, 0.75, 0.45).mul(smoothstep(1.0, 0.0, r).pow(2.2)).mul(U.lampIntensity.mul(0.35));
    lm.polygonOffset = true; lm.polygonOffsetFactor = -4; lm.polygonOffsetUnits = -8;
    this.lightPools = new Pool(disc, lm, cap, false); this.lightPools.mesh.renderOrder = 2; this.group.add(this.lightPools.mesh);
    const sm = new THREE.MeshBasicNodeMaterial();
    sm.colorNode = vec3(float(4.0)); // multiplied by the per-instance signal colour
    void attribute;
    this.sigHeads = new Pool(sig.heads, sm, cap, false); this.group.add(this.sigHeads.mesh);
  }

  setSignalColorFn(f: (i: number, x: number, z: number, rot: number, out: THREE.Color) => void): void { this.sigColorFn = f; }

  update(lists: Float32Array[], cx: number, cz: number, r: number, groundAt: (x: number, z: number) => number): void {
    const counts = [0, 0, 0, 0, 0, 0];
    let lh = 0;
    this.signalRefs = [];
    const r2 = r * r;
    for (const arr of lists) {
      for (let i = 0; i < arr.length; i += 5) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2], t = arr[i + 3] | 0, rot = arr[i + 4];
        if ((x - cx) ** 2 + (z - cz) ** 2 > r2) continue;
        const p = this.pools[t];
        if (!p || counts[t] >= p.cap) continue;
        tmpQ.setFromAxisAngle(UP, rot);
        tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.setScalar(1));
        p.mesh.setMatrixAt(counts[t]++, tmpM);
        if (t === 0 && lh < this.lampHeads.cap) {
          this.lampHeads.mesh.setMatrixAt(lh, tmpM);
          // pool centred under the lamp head (1.9 m out along the arm)
          const hx = x + Math.sin(rot) * 1.9, hz = z + Math.cos(rot) * 1.9;
          tmpM.compose(tmpP.set(hx, groundAt(hx, hz) + 0.12, hz), tmpQ, tmpS.setScalar(1));
          this.lightPools.mesh.setMatrixAt(lh, tmpM);
          lh++;
        }
        if (t === 4) {
          this.sigHeads.mesh.setMatrixAt(this.signalRefs.length, tmpM);
          this.sigHeads.mesh.setColorAt(this.signalRefs.length, tmpC.setRGB(1, 0.1, 0.05));
          this.signalRefs.push({ x, z, rot });
        }
      }
    }
    this.pools.forEach((p, k) => { p.mesh.count = counts[k]; p.mesh.instanceMatrix.needsUpdate = true; });
    this.lampHeads.mesh.count = lh; this.lampHeads.mesh.instanceMatrix.needsUpdate = true;
    this.lightPools.mesh.count = lh; this.lightPools.mesh.instanceMatrix.needsUpdate = true;
    this.sigHeads.mesh.count = this.signalRefs.length; this.sigHeads.mesh.instanceMatrix.needsUpdate = true;
    if (this.sigHeads.mesh.instanceColor) this.sigHeads.mesh.instanceColor.needsUpdate = true;
  }

  /** refresh signal head colours from the traffic signal controller */
  updateSignals(): void {
    if (!this.sigColorFn || !this.signalRefs.length) return;
    this.signalRefs.forEach((s, i) => { this.sigColorFn!(i, s.x, s.z, s.rot, tmpC); this.sigHeads.mesh.setColorAt(i, tmpC); });
    if (this.sigHeads.mesh.instanceColor) this.sigHeads.mesh.instanceColor.needsUpdate = true;
  }
}
