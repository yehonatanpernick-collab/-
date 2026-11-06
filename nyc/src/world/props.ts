import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vec3, mix, positionWorld, mx_noise_float, float, instanceIndex, hash, uniform, vertexColor } from 'three/tsl';
import type { Engine } from '../engine/renderer';

const BASE = import.meta.env.BASE_URL;

/** Points bucketed in a coarse grid; each frame-slice we refill an InstancedMesh with the ones near the camera. */
class Layer {
  cells = new Map<string, number[]>();
  meshes: THREE.InstancedMesh[];
  constructor(public pts: number[][], meshes: THREE.InstancedMesh[], public radius: number, public setter: (i: number, m: THREE.Matrix4) => void, public cell = 120) {
    this.meshes = meshes;
    pts.forEach((p, i) => { const k = `${Math.floor(p[0] / cell)}_${Math.floor(p[1] / cell)}`; let a = this.cells.get(k); if (!a) this.cells.set(k, (a = [])); a.push(i); });
    for (const m of meshes) { m.count = 0; m.frustumCulled = false; }
  }
  private mat = new THREE.Matrix4();
  refresh(cx: number, cz: number) {
    let n = 0; const cap = this.meshes[0].instanceMatrix.count; const c = this.cell, r = Math.ceil(this.radius / c);
    const gx = Math.floor(cx / c), gz = Math.floor(cz / c);
    for (let i = gx - r; i <= gx + r && n < cap; i++) for (let j = gz - r; j <= gz + r && n < cap; j++) {
      for (const idx of this.cells.get(`${i}_${j}`) || []) {
        const p = this.pts[idx]; if (Math.hypot(p[0] - cx, p[1] - cz) > this.radius) continue;
        this.setter(idx, this.mat); for (const m of this.meshes) m.setMatrixAt(n, this.mat); n++; if (n >= cap) break;
      }
    }
    for (const m of this.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  }
}

function blob(r: number, x: number, y: number, z: number, det: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(r, det); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + 0.28 * Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 + seed * 2) + 0.18 * Math.sin(vy * 4.3 + seed * 3);
    p.setXYZ(i, vx * k + x, vy * k * 0.82 + y, vz * k + z);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  return g;
}
function crown(det: number) {
  const parts = [blob(1.0, 0, 0, 0, det, 1), blob(0.75, 0.55, 0.28, 0.2, det, 2), blob(0.7, -0.5, 0.32, -0.25, det, 3), blob(0.62, 0.1, 0.62, 0.05, det, 4), blob(0.6, -0.15, 0.05, 0.6, det, 5)];
  let g = mergeGeometries(parts); g = mergeVertices(g, 1e-3); g.computeVertexNormals();
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const t = 0.45 + 0.55 * Math.min(1, Math.max(0, (p.getY(i) + 0.9) / 1.8)); c.set([t, t, t], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export class Props {
  layers: Layer[] = [];
  signalHeads?: THREE.InstancedMesh;
  signals: number[][] = [];
  private lastX = 1e9; private lastZ = 1e9;
  constructor(private scene: THREE.Scene, private engine: Engine) {}

  async init() {
    const d = await (await fetch(`${BASE}data/props.json`)).json();
    const night = this.engine.night;
    // --- trees: near (detailed crown) + far (low poly)
    const leaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    const hue = hash(instanceIndex.add(7));
    const P = positionWorld;
    const dapple = mx_noise_float(P.mul(1.6)).mul(0.5).add(0.5);
    leaf.colorNode = mix(vec3(0.13, 0.22, 0.06), vec3(0.3, 0.37, 0.11), hue).mul(mix(float(0.72), float(1.12), dapple)).mul(vertexColor(0).rgb);
    const bark = new THREE.MeshStandardNodeMaterial({ color: 0x4b3d31, roughness: 0.95 });
    const trunkG = new THREE.CylinderGeometry(0.09, 0.16, 1, 7).translate(0, 0.5, 0);
    const cap = 2600;
    const tNear = new THREE.InstancedMesh(crown(1), leaf, cap), tTrunk = new THREE.InstancedMesh(trunkG, bark, cap);
    tNear.castShadow = true; tNear.receiveShadow = true; tTrunk.castShadow = true;
    const tFar = new THREE.InstancedMesh(crown(0), leaf, 6000);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), yAx = new THREE.Vector3(0, 1, 0);
    const treeM = (i: number, m: THREE.Matrix4, trunk = false) => {
      const [x, z, dbh] = d.trees[i]; const h = 4.5 + dbh * 0.32, cr = 1.6 + dbh * 0.11;
      q.setFromAxisAngle(yAx, (i * 2.399) % 6.283);
      if (trunk) { pos.set(x, 0.15, z); s.set(1 + dbh * 0.03, h * 0.62, 1 + dbh * 0.03); }
      else { pos.set(x, 0.15 + h * 0.62 + cr * 0.55, z); s.set(cr, cr * 0.95, cr); }
      m.compose(pos, q, s);
    };
    this.layers.push(new Layer(d.trees, [tNear], 320, (i, m) => treeM(i, m)));
    this.layers.push(new Layer(d.trees, [tTrunk], 320, (i, m) => treeM(i, m, true)));
    this.layers.push(new Layer(d.trees, [tFar], 1400, (i, m) => { const p = d.trees[i]; if (Math.hypot(p[0] - this.lastX, p[1] - this.lastZ) < 300) m.makeScale(0, 0, 0); else treeM(i, m); }));
    this.scene.add(tNear, tTrunk, tFar);

    // --- NYC street lamps: octagonal pole, curved mast arm, cobra-head luminaire (glows at dusk)
    {
      const arm = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.0, 0), new THREE.Vector3(0, 9.3, 0.6), new THREE.Vector3(0, 9.25, 2.6)), 16, 0.07, 8);
      const lampG = mergeGeometries([
        new THREE.CylinderGeometry(0.11, 0.2, 8.4, 8).translate(0, 4.2, 0),
        new THREE.CylinderGeometry(0.26, 0.3, 0.9, 8).translate(0, 0.45, 0),
        arm.deleteAttribute('uv') && arm,
        new THREE.SphereGeometry(0.34, 14, 8).scale(1, 0.38, 1.9).translate(0, 9.2, 3.0),
      ].map((g) => { if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g : g; }));
      const lampMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a4046, roughness: 0.45, metalness: 0.75 });
      const lamps = new THREE.InstancedMesh(lampG, lampMat, 1400); lamps.castShadow = true;
      const glowMat = new THREE.MeshBasicNodeMaterial(); glowMat.colorNode = vec3(1.0, 0.8, 0.55).mul(night.mul(6).add(0.15));
      const glow = new THREE.InstancedMesh(new THREE.CircleGeometry(0.3, 16).rotateX(Math.PI / 2).scale(1, 1, 1.8).translate(0, 9.06, 3.0), glowMat, 1400);
      const lampM = (i: number, m: THREE.Matrix4) => { const [x, z, yaw] = d.lamps[i]; q.setFromAxisAngle(yAx, yaw); m.compose(pos.set(x, 0.15, z), q, s.set(1, 1, 1)); };
      this.layers.push(new Layer(d.lamps, [lamps, glow], 650, lampM));
      this.scene.add(lamps, glow);
      void GLTFLoader;
    }

    // --- rooftops: NYC wooden water towers + AC / cooling units
    {
      const wood = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
      const plank = positionWorld.y.mul(0).add(mx_noise_float(positionWorld.mul(vec3(0.4, 6.0, 0.4))).mul(0.5).add(0.5));
      wood.colorNode = mix(vec3(0.28, 0.2, 0.14), vec3(0.42, 0.32, 0.22), plank);
      const tankG = mergeGeometries([
        new THREE.CylinderGeometry(1.7, 1.75, 4.2, 18).translate(0, 4.7, 0), new THREE.ConeGeometry(1.95, 1.4, 18).translate(0, 7.5, 0),
        ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => new THREE.BoxGeometry(0.16, 2.6, 0.16).translate(a * 1.15, 1.3, b * 1.15)),
        new THREE.BoxGeometry(2.8, 0.18, 2.8).translate(0, 2.6, 0),
      ].map((g) => { g.deleteAttribute('uv'); return g; }));
      const tanks = new THREE.InstancedMesh(tankG, wood, Math.max(1, d.tanks.length)); tanks.castShadow = true; tanks.receiveShadow = true;
      d.tanks.forEach(([x, y, z, sc]: number[], i: number) => { q.setFromAxisAngle(yAx, i * 1.3); tanks.setMatrixAt(i, new THREE.Matrix4().compose(pos.set(x, y, z), q, s.set(sc, sc, sc))); });
      const ac = new THREE.InstancedMesh(mergeGeometries([new THREE.BoxGeometry(2.6, 1.5, 1.8).translate(0, 0.75, 0), new THREE.CylinderGeometry(0.6, 0.6, 0.12, 14).translate(0, 1.56, 0)].map((g) => { g.deleteAttribute('uv'); return g; })),
        new THREE.MeshStandardNodeMaterial({ color: 0xb8bcbf, roughness: 0.5, metalness: 0.6 }), Math.max(1, d.acs.length));
      ac.castShadow = true;
      d.acs.forEach(([x, y, z, r]: number[], i: number) => { q.setFromAxisAngle(yAx, r); ac.setMatrixAt(i, new THREE.Matrix4().compose(pos.set(x, y, z), q, s.set(1, 1, 1))); });
      this.scene.add(tanks, ac);
    }

    // --- traffic signals: NYC mast-arm pole + 3-light head; bulbs recoloured by the traffic system
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0x2c2f33, roughness: 0.55, metalness: 0.6 });
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.1, 0.13, 6.2, 10).translate(0, 3.1, 0),
      new THREE.CylinderGeometry(0.06, 0.07, 6.0, 8).rotateX(Math.PI / 2).translate(0, 5.9, 3.0),
      new THREE.BoxGeometry(0.42, 1.18, 0.36).translate(0, 5.3, 5.6),
      new THREE.BoxGeometry(0.34, 0.9, 0.3).translate(0, 2.6, 0.2),
    ]);
    const signals = new THREE.InstancedMesh(pole, metal, 900); signals.castShadow = true;
    this.signals = d.signals;
    const bulbMat = new THREE.MeshBasicNodeMaterial();
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 6), bulbMat, 2700);
    heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2700 * 3), 3);
    this.signalHeads = heads;
    this.layers.push(new Layer(d.signals, [signals], 650, (i, m) => { const [x, z, yaw] = d.signals[i]; q.setFromAxisAngle(yAx, yaw); m.compose(pos.set(x, 0.15, z), q, s.set(1, 1, 1)); }));
    this.scene.add(signals, heads);
    void uniform;
  }

  /** place signal bulbs; `state(nodeId, yaw)` returns 0 red, 1 amber, 2 green */
  updateSignals(cx: number, cz: number, state: (node: number, yaw: number) => number) {
    const h = this.signalHeads; if (!h) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let n = 0; const cap = h.instanceMatrix.count;
    for (const [x, z, yaw, node] of this.signals) {
      if (Math.abs(x - cx) > 500 || Math.abs(z - cz) > 500 || n + 3 > cap) continue;
      const st = state(node, yaw); q.setFromAxisAngle(y, yaw);
      for (let k = 0; k < 3; k++) {
        p.set(0, 5.68 - k * 0.38, 5.6 - 0.2).applyQuaternion(q).add(new THREE.Vector3(x, 0.15, z));
        m.compose(p, q, s); h.setMatrixAt(n, m);
        const on = (k === 0 && st === 0) || (k === 1 && st === 1) || (k === 2 && st === 2);
        c.setRGB(k === 2 ? 0.1 : 4, k === 0 ? 0.1 : k === 1 ? 2.2 : 3.2, k === 2 ? 1.6 : 0.08).multiplyScalar(on ? 1 : 0.035); h.setColorAt(n, c); n++;
      }
    }
    h.count = n; h.instanceMatrix.needsUpdate = true; if (h.instanceColor) h.instanceColor.needsUpdate = true;
  }

  update(cx: number, cz: number) {
    if (Math.hypot(cx - this.lastX, cz - this.lastZ) < 30) return;
    this.lastX = cx; this.lastZ = cz;
    for (const l of this.layers) l.refresh(cx, cz);
  }
}
