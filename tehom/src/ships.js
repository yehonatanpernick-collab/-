import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './glsl.js';
import { FACTIONS, SHIPS } from './data.js';

// --- seeded rng so every hull of a class has the same greebles
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function P(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d, p, r) => P(new THREE.BoxGeometry(w, h, d), p, r);
// cylinder along Z
const cylZ = (rt, rb, len, seg, p, r = [0, 0, 0], s) => {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg); g.rotateX(Math.PI / 2);
  return P(g, p, r, s);
};

function greebles(out, rand, n, { x = [-1, 1], y = [0, 0], z = [-1, 1], s = 0.2, side = 0 }) {
  for (let i = 0; i < n; i++) {
    const w = s * (0.4 + rand()), h = s * (0.3 + rand() * 0.8), d = s * (0.5 + rand() * 1.4);
    let px = x[0] + rand() * (x[1] - x[0]);
    if (side) px = (rand() < 0.5 ? -1 : 1) * side;
    out.push(box(w, h, d, [px, y[0] + rand() * (y[1] - y[0]), z[0] + rand() * (z[1] - z[0])]));
  }
}

function corvette() {
  const hull = [], acc = [], glow = [];
  hull.push(P(new THREE.OctahedronGeometry(1, 0), [0, 0, 0.1], [0, 0, 0], [0.5, 0.22, 1.25]));
  hull.push(box(1.7, 0.06, 0.55, [0, -0.02, -0.45], [0, 0, 0]));
  hull.push(box(0.5, 0.05, 0.7, [0.75, -0.02, -0.65], [0, 0.45, 0]));
  hull.push(box(0.5, 0.05, 0.7, [-0.75, -0.02, -0.65], [0, -0.45, 0]));
  hull.push(box(0.05, 0.38, 0.45, [0, 0.2, -0.7], [0.3, 0, 0]));
  hull.push(cylZ(0.17, 0.2, 0.5, 6, [0, 0, -0.95]));
  acc.push(box(0.1, 0.26, 0.9, [0, 0.03, 0.25]));
  acc.push(box(0.12, 0.08, 0.3, [0.85, 0.0, -0.7], [0, 0.45, 0]));
  acc.push(box(0.12, 0.08, 0.3, [-0.85, 0.0, -0.7], [0, -0.45, 0]));
  glow.push(cylZ(0.14, 0.14, 0.06, 8, [0, 0, -1.22]));
  return { parts: [hull, acc, glow], engines: [[0, 0, -1.25]], scale: 1 };
}

function frigate() {
  const rand = rng(7);
  const hull = [], acc = [], glow = [];
  hull.push(box(0.8, 0.55, 4.6, [0, 0, 0]));
  hull.push(cylZ(0.05, 0.62, 1.8, 4, [0, 0, 3.15], [0, 0, Math.PI / 4], [1, 0.7, 1]));
  hull.push(box(1.7, 0.75, 1.7, [0, 0, -0.5]));
  hull.push(box(2.9, 0.12, 1.0, [0, -0.1, -1.2]));
  for (const sx of [-1, 1]) {
    hull.push(cylZ(0.32, 0.36, 2.6, 6, [sx * 1.45, -0.1, -1.4]));
    hull.push(cylZ(0.38, 0.3, 0.35, 6, [sx * 1.45, -0.1, -2.85]));
    acc.push(cylZ(0.34, 0.34, 0.14, 6, [sx * 1.45, -0.1, -0.5]));
    glow.push(cylZ(0.27, 0.27, 0.06, 10, [sx * 1.45, -0.1, -3.05]));
  }
  hull.push(box(0.5, 0.5, 0.9, [0, 0.5, 0.3]));
  hull.push(box(0.8, 0.12, 0.5, [0, 0.8, 0.15]));
  hull.push(cylZ(0.12, 0.12, 1.5, 6, [0, 0.38, 1.9]));             // the lance emitter
  greebles(hull, rand, 22, { x: [-0.35, 0.35], y: [0.28, 0.34], z: [-2.2, 2.2], s: 0.22 });
  greebles(hull, rand, 10, { side: 0.42, y: [-0.15, 0.15], z: [-2, 2], s: 0.18 });
  acc.push(box(0.84, 0.58, 0.12, [0, 0, 1.25]));
  acc.push(box(0.84, 0.58, 0.12, [0, 0, 1.75]));
  acc.push(box(0.06, 0.1, 3.2, [0.42, 0.18, 0.2]));
  acc.push(box(0.06, 0.1, 3.2, [-0.42, 0.18, 0.2]));
  glow.push(box(0.5, 0.3, 0.06, [0, 0, -2.33]));
  glow.push(box(0.6, 0.06, 0.08, [0, 0.82, 0.42]));               // bridge windows
  return { parts: [hull, acc, glow], engines: [[1.45, -0.1, -3.1], [-1.45, -0.1, -3.1], [0, 0, -2.4]], scale: 1 };
}

function dreadnought() {
  const rand = rng(31);
  const hull = [], acc = [], glow = [];
  hull.push(box(3.2, 1.6, 9.0, [0, 0, 0]));
  hull.push(cylZ(0.7, 2.25, 4.2, 4, [0, 0, 6.6], [0, 0, Math.PI / 4], [1, 0.62, 1]));
  hull.push(box(2.3, 0.85, 6.4, [0, 1.15, -0.6]));
  hull.push(box(0.9, 1.3, 7.8, [0, -1.3, 0.4]));
  for (const sx of [-1, 1]) {
    hull.push(box(0.9, 1.0, 4.6, [sx * 2.0, -0.2, -1.6]));
    hull.push(box(0.5, 0.5, 2.2, [sx * 2.55, -0.2, -2.0]));
    acc.push(box(0.06, 0.24, 8.0, [sx * 1.63, 0.35, 0.2]));
    acc.push(box(0.06, 0.18, 4.2, [sx * 2.46, -0.2, -1.6]));
  }
  // turrets
  for (const z of [3.2, 1.2, -1.4]) {
    const y = z > 2 ? 0.95 : 1.75;
    hull.push(P(new THREE.CylinderGeometry(0.55, 0.7, 0.42, 8), [0, y, z]));
    hull.push(box(0.75, 0.38, 0.8, [0, y + 0.3, z]));
    hull.push(cylZ(0.08, 0.08, 1.7, 6, [0.17, y + 0.32, z + 1.1]));
    hull.push(cylZ(0.08, 0.08, 1.7, 6, [-0.17, y + 0.32, z + 1.1]));
  }
  hull.push(box(1.0, 1.9, 1.3, [0, 2.3, -3.1]));
  hull.push(box(1.6, 0.2, 0.7, [0, 3.2, -3.0]));
  hull.push(box(0.12, 1.6, 0.12, [0.3, 4.0, -3.3]));
  glow.push(box(0.9, 0.08, 0.06, [0, 2.9, -2.43]));
  greebles(hull, rand, 46, { x: [-1.3, 1.3], y: [1.55, 1.7], z: [-3.5, 4], s: 0.35 });
  greebles(hull, rand, 24, { side: 1.62, y: [-0.6, 0.6], z: [-4, 4], s: 0.3 });
  greebles(hull, rand, 12, { x: [-0.4, 0.4], y: [-2.0, -1.9], z: [-3, 3.5], s: 0.3 });
  acc.push(box(3.26, 0.2, 0.3, [0, 0.5, 4.4]));
  acc.push(box(3.26, 0.2, 0.3, [0, 0.5, -4.4]));
  for (const [x, y] of [[0.9, 0.35], [-0.9, 0.35], [0.9, -0.45], [-0.9, -0.45]]) {
    hull.push(cylZ(0.5, 0.62, 0.9, 8, [x, y, -4.9]));
    glow.push(cylZ(0.44, 0.44, 0.06, 12, [x, y, -5.36]));
  }
  return { parts: [hull, acc, glow], engines: [[0.9, 0.35, -5.4], [-0.9, 0.35, -5.4], [0.9, -0.45, -5.4], [-0.9, -0.45, -5.4]], scale: 1, guns: [[0, 1.3, 4.3], [0, 2.1, 2.3], [0, 2.1, -0.3]] };
}

const BUILDERS = { corvette, frigate, dreadnought };
const _cache = {};

export function shipAssets(cls, faction) {
  const key = cls + faction;
  if (_cache[key]) return _cache[key];
  if (!_cache[cls]) {
    const def = BUILDERS[cls]();
    const geos = def.parts.map((list) => mergeGeometries(list, false));
    const geo = mergeGeometries(geos, true);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    _cache[cls] = { geo, def };
  }
  const F = FACTIONS[faction];
  const hull = new THREE.MeshStandardMaterial({ color: new THREE.Color(F.hull), metalness: 0.78, roughness: 0.38, flatShading: true, envMapIntensity: 1.6 });
  const accent = new THREE.MeshStandardMaterial({ color: F.color, emissive: F.color, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.5, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: F.color.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(7) });
  _cache[key] = { geo: _cache[cls].geo, def: _cache[cls].def, mats: [hull, accent, glow] };
  return _cache[key];
}

let NEXT_ID = 1;
const _t = new THREE.Vector3();

export class Ship {
  constructor(cls, faction, pos, scene) {
    this.id = NEXT_ID++;
    this.cls = cls; this.def = SHIPS[cls]; this.faction = faction;
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    const a = shipAssets(cls, faction);
    this.assets = a;
    this.mesh = new THREE.Mesh(a.geo, a.mats);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    this.host = null;            // body we orbit
    this.order = null;           // { type: 'body', body } | { type: 'point', point }
    this.target = null;
    this.cd = Math.random() * this.def.rof;
    this.gunIdx = 0;
    this.selected = false;
    this.dead = false;
    this.trailT = Math.random();
    this.thinkT = Math.random() * 0.3;
    this.hit = 0;
    // a personal slot in orbit / formation
    this.slot = {
      a: Math.random() * Math.PI * 2,
      w: (0.08 + Math.random() * 0.06) * (Math.random() < 0.5 ? 1 : -1) * (cls === 'dreadnought' ? 0.4 : 1),
      r: Math.random(), y: (Math.random() - 0.5) * 2,
      off: new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random())),
      tilt: (Math.random() - 0.5) * 0.7,
    };
  }
  orbitPoint(body, t, out) {
    const s = this.slot;
    const R = body.orbitSlot + s.r * (body.r * 0.8 + 10) + (this.cls === 'dreadnought' ? 6 : 0);
    const a = s.a + t * s.w;
    out.set(Math.cos(a) * R, s.y * 2.5 + Math.sin(a) * R * s.tilt, Math.sin(a) * R).add(body.pos);
    return out;
  }
  forward(out) { return out.set(0, 0, 1).applyQuaternion(this.mesh.quaternion); }
  remove(scene) { scene.remove(this.mesh); this.dead = true; }
}

// ---------------------------------------------------------------- tactical icons
export class IconLayer {
  constructor(scene, pr, cap = 2000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.info = new Float32Array(cap * 2);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aInfo', this.aInfo);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: pr }, uFar: { value: 420 } },
      vertexShader: G.ICON_VERT, fragmentShader: G.ICON_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
  }
  update(ships) {
    const n = Math.min(ships.length, this.cap);
    for (let i = 0; i < n; i++) {
      const s = ships[i];
      this.pos[i * 3] = s.pos.x; this.pos[i * 3 + 1] = s.pos.y; this.pos[i * 3 + 2] = s.pos.z;
      const c = FACTIONS[s.faction].color;
      const h = 0.55 + 0.45 * (s.hp / s.maxHp) + s.hit * 2;
      this.col[i * 3] = c.r * h; this.col[i * 3 + 1] = c.g * h; this.col[i * 3 + 2] = c.b * h;
      this.info[i * 2] = s.def.idx; this.info[i * 2 + 1] = s.selected ? 1 : 0;
    }
    this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aInfo.needsUpdate = true;
  }
}
export { _t };
