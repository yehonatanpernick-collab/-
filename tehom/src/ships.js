import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as G from './glsl.js';
import { FACTIONS, SHIPS } from './data.js';

// --- seeded rng so every hull of a class carries the same greebles
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const WHITE = [1, 1, 1];
function P(geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], color = WHITE) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = color[0]; c[i + 1] = color[1]; c[i + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}
const box = (w, h, d, p, r) => P(new THREE.BoxGeometry(w, h, d), p, r);
const cylZ = (rt, rb, len, seg, p, r = [0, 0, 0], s) => { const g = new THREE.CylinderGeometry(rt, rb, len, seg); g.rotateX(Math.PI / 2); return P(g, p, r, s); };

// Top-view outline (x = beam, y = length toward the bow) extruded upward, bevelled like cast armour.
function slab(outline, thick, y, { bevel = 0.06, scale = 1, sz = 1, dz = 0 } = {}) {
  const sh = new THREE.Shape();
  outline.forEach(([x, z], i) => (i ? sh.lineTo(x * scale, -(z * scale * sz + dz)) : sh.moveTo(x * scale, -(z * scale * sz + dz))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  // shape XY -> deck plane XZ, extrusion -> +Y
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return P(g);
}
const mirror = (half) => [...half, ...half.slice().reverse().filter(([x]) => x !== 0).map(([x, z]) => [-x, z])];

// engine plume: an open cone whose vertex colour fades from white-hot to nothing
function flame(radius, len, p) {
  const g = new THREE.ConeGeometry(radius, len, 14, 4, true);
  const pos = g.attributes.position;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) + len / 2) / len;       // 1 at base, 0 at tip
    const k = Math.pow(t, 2.2);
    c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.rotateX(-Math.PI / 2);   // tip toward -Z
  return P(g, [p[0], p[1], p[2] - len / 2]);
}

function greebles(out, rand, n, { x = [-1, 1], y = [0, 0], z = [-1, 1], s = 0.2, side = 0 }) {
  for (let i = 0; i < n; i++) {
    const w = s * (0.4 + rand()), h = s * (0.3 + rand() * 0.8), d = s * (0.5 + rand() * 1.4);
    let px = x[0] + rand() * (x[1] - x[0]);
    if (side) px = (rand() < 0.5 ? -1 : 1) * side;
    out.push(box(w, h, d, [px, y[0] + rand() * (y[1] - y[0]), z[0] + rand() * (z[1] - z[0])]));
  }
}

function corvette() {
  const hull = [], acc = [], glow = [], fl = [];
  const wing = mirror([[0, 1.5], [0.3, 0.55], [0.55, -0.1], [1.15, -0.65], [1.1, -0.9], [0.45, -0.75], [0.3, -1.1]]);
  hull.push(slab(wing, 0.1, -0.1, { bevel: 0.05 }));
  hull.push(slab(mirror([[0, 1.25], [0.24, 0.4], [0.3, -0.9]]), 0.18, 0.05, { bevel: 0.06 }));
  hull.push(slab(mirror([[0, 0.55], [0.13, 0.15], [0.16, -0.35]]), 0.08, 0.3, { bevel: 0.04 }));
  hull.push(box(0.05, 0.36, 0.5, [0.55, 0.14, -0.62], [0.25, 0, -0.35]));
  hull.push(box(0.05, 0.36, 0.5, [-0.55, 0.14, -0.62], [0.25, 0, 0.35]));
  hull.push(cylZ(0.15, 0.2, 0.55, 8, [0, 0.07, -1.0]));
  acc.push(box(0.5, 0.02, 0.12, [0.82, 0.02, -0.72], [0, 0.55, 0]));
  acc.push(box(0.5, 0.02, 0.12, [-0.82, 0.02, -0.72], [0, -0.55, 0]));
  acc.push(box(0.04, 0.03, 0.9, [0, 0.36, 0.05]));
  glow.push(cylZ(0.13, 0.13, 0.05, 10, [0, 0.07, -1.29]));
  glow.push(box(0.16, 0.03, 0.14, [0, 0.36, 0.38]));
  fl.push(flame(0.13, 1.5, [0, 0.07, -1.3]));
  return { parts: [hull, acc, glow, fl], engines: [[0, 0.07, -1.35]], uv: 0.55 };
}

function frigate() {
  const rand = rng(7);
  const hull = [], acc = [], glow = [], fl = [];
  const keel = mirror([[0, 3.6], [0.42, 2.6], [0.62, 0.6], [0.95, -0.2], [1.05, -1.7], [0.8, -3.0]]);
  hull.push(slab(keel, 0.42, -0.3, { bevel: 0.08 }));
  hull.push(slab(keel, 0.3, 0.2, { bevel: 0.06, scale: 0.72, dz: -0.3 }));
  hull.push(slab(mirror([[0, 1.1], [0.32, 0.6], [0.38, -0.5]]), 0.42, 0.55, { bevel: 0.05 }));
  hull.push(box(0.9, 0.08, 0.4, [0, 1.02, -0.1]));
  for (const sx of [-1, 1]) {
    hull.push(cylZ(0.3, 0.34, 2.4, 8, [sx * 1.35, -0.12, -1.55]));
    hull.push(cylZ(0.38, 0.3, 0.36, 8, [sx * 1.35, -0.12, -2.85]));
    hull.push(box(0.5, 0.1, 0.9, [sx * 1.05, -0.12, -1.3]));
    acc.push(cylZ(0.315, 0.315, 0.12, 8, [sx * 1.35, -0.12, -0.75]));
    glow.push(cylZ(0.27, 0.27, 0.05, 12, [sx * 1.35, -0.12, -3.05]));
    fl.push(flame(0.26, 2.6, [sx * 1.35, -0.12, -3.08]));
    acc.push(box(0.05, 0.08, 2.6, [sx * 0.47, 0.52, 0.6]));
  }
  hull.push(cylZ(0.1, 0.14, 2.0, 8, [0, 0.62, 2.3]));             // the lance
  acc.push(cylZ(0.16, 0.16, 0.1, 8, [0, 0.62, 3.25]));
  greebles(hull, rand, 26, { x: [-0.32, 0.32], y: [0.5, 0.55], z: [-2.4, 1.6], s: 0.2 });
  greebles(hull, rand, 14, { side: 0.66, y: [-0.25, 0.05], z: [-2.2, 1.4], s: 0.18 });
  glow.push(box(0.55, 0.05, 0.04, [0, 0.9, 0.42]));               // bridge windows
  glow.push(box(0.04, 0.04, 0.3, [0.2, 0.95, 0.2]));
  return { parts: [hull, acc, glow, fl], engines: [[1.35, -0.12, -3.1], [-1.35, -0.12, -3.1]], uv: 0.42 };
}

function dreadnought() {
  const rand = rng(31);
  const hull = [], acc = [], glow = [], fl = [];
  const plan = mirror([[0, 7.8], [1.1, 6.2], [2.1, 2.6], [2.5, -1.2], [2.6, -4.6], [2.1, -5.7]]);
  hull.push(slab(plan, 0.9, -0.9, { bevel: 0.14 }));
  hull.push(slab(plan, 0.7, 0.05, { bevel: 0.12, scale: 0.8, dz: -0.6 }));
  hull.push(slab(plan, 0.6, 0.8, { bevel: 0.1, scale: 0.56, dz: -1.6 }));
  hull.push(slab(plan, 0.7, -1.6, { bevel: 0.1, scale: 0.62, dz: -0.4 }));     // ventral keel
  hull.push(slab(mirror([[0, 1.0], [0.6, 0.5], [0.7, -1.2]]), 1.6, 1.4, { bevel: 0.08, dz: -3.2 })); // tower
  hull.push(box(1.9, 0.18, 0.7, [0, 3.1, -2.7]));
  hull.push(box(0.1, 1.2, 0.1, [0.4, 3.7, -3.0]));
  hull.push(box(0.1, 0.8, 0.1, [-0.3, 3.5, -3.1]));
  // turrets: one on the bow terrace, two stepped behind
  for (const [z, y] of [[3.6, 0.92], [1.6, 1.42], [-0.5, 1.42]]) {
    hull.push(P(new THREE.CylinderGeometry(0.55, 0.7, 0.36, 10), [0, y + 0.18, z]));
    hull.push(slab(mirror([[0, 0.55], [0.42, 0.3], [0.45, -0.45]]), 0.32, y + 0.34, { bevel: 0.04, dz: z }));
    hull.push(cylZ(0.07, 0.09, 1.8, 8, [0.16, y + 0.5, z + 1.25]));
    hull.push(cylZ(0.07, 0.09, 1.8, 8, [-0.16, y + 0.5, z + 1.25]));
  }
  for (const sx of [-1, 1]) {
    hull.push(box(0.6, 0.8, 4.2, [sx * 2.35, -0.55, -1.8]));
    acc.push(box(0.04, 0.12, 6.5, [sx * 2.08, -0.2, 0.2]));
    glow.push(box(0.03, 0.06, 3.8, [sx * 2.66, -0.45, -1.8]));       // hangar slots
    for (let i = 0; i < 5; i++) hull.push(box(0.12, 0.5, 0.18, [sx * 2.68, -0.55, -3.4 + i * 0.8]));
  }
  greebles(hull, rand, 60, { x: [-1.2, 1.2], y: [1.3, 1.42], z: [-4.5, 2.8], s: 0.32 });
  greebles(hull, rand, 30, { x: [-1.8, 1.8], y: [0.72, 0.8], z: [-4.6, 4.2], s: 0.26 });
  greebles(hull, rand, 16, { x: [-0.9, 0.9], y: [-1.75, -1.65], z: [-3.5, 4.0], s: 0.3 });
  acc.push(box(4.4, 0.08, 0.2, [0, -0.02, 3.4]));
  acc.push(box(4.9, 0.08, 0.2, [0, -0.02, -4.4]));
  glow.push(box(1.0, 0.07, 0.04, [0, 2.75, -2.42]));
  const eng = [[1.1, -0.35], [-1.1, -0.35], [0, -0.35], [0.6, 0.45], [-0.6, 0.45]];
  for (const [x, y] of eng) {
    hull.push(cylZ(0.48, 0.6, 0.9, 10, [x, y, -5.95]));
    glow.push(cylZ(0.42, 0.42, 0.05, 14, [x, y, -6.42]));
    fl.push(flame(0.4, 4.2, [x, y, -6.45]));
  }
  return {
    parts: [hull, acc, glow, fl], engines: eng.map(([x, y]) => [x, y, -6.5]),
    guns: [[0, 1.42, 4.9], [0, 1.92, 2.9], [0, 1.92, 0.8]], uv: 0.3,
  };
}

const BUILDERS = { corvette, frigate, dreadnought };
export const SHIELD_R = { corvette: 0, frigate: 4.2, dreadnought: 9.5 };

// box-projected UVs so the plate texture wraps every hull at a constant scale
function boxUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------- procedural hull plating
let TEX = null;
function hullTextures() {
  if (TEX || typeof document === 'undefined') return TEX;
  const S = 1024, rand = rng(1234);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  const [ca, a] = mk(), [cr, r] = mk(), [ce, e] = mk();
  a.fillStyle = '#9a9a9a'; a.fillRect(0, 0, S, S);
  r.fillStyle = '#8a8a8a'; r.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const plate = (x, y, w, h, d) => {
    if (d < 6 && (w > 46 || h > 46) && rand() < 0.9) {
      if ((w > h && rand() < 0.8) || h < 46) { const k = Math.round(w * (0.3 + rand() * 0.4)); plate(x, y, k, h, d + 1); plate(x + k, y, w - k, h, d + 1); }
      else { const k = Math.round(h * (0.3 + rand() * 0.4)); plate(x, y, w, k, d + 1); plate(x, y + k, w, h - k, d + 1); }
      return;
    }
    const tone = 128 + (rand() - 0.5) * 46;
    a.fillStyle = `rgb(${tone},${tone},${tone + 2})`; a.fillRect(x + 1, y + 1, w - 2, h - 2);
    const rough = 120 + rand() * 110;
    r.fillStyle = `rgb(${rough},${rough},${rough})`; r.fillRect(x + 1, y + 1, w - 2, h - 2);
    // bevel light/shadow edges
    a.fillStyle = 'rgba(255,255,255,0.10)'; a.fillRect(x + 1, y + 1, w - 2, 2);
    a.fillStyle = 'rgba(0,0,0,0.22)'; a.fillRect(x + 1, y + h - 3, w - 2, 2);
    if (rand() < 0.25) { // rivet line
      a.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = x + 6; i < x + w - 4; i += 7) a.fillRect(i, y + 5, 2, 2);
    }
    if (rand() < 0.12 && w > 40) { // warning chevrons
      a.fillStyle = 'rgba(40,36,30,0.55)';
      for (let i = 0; i < w - 8; i += 10) { a.beginPath(); a.moveTo(x + 4 + i, y + h - 4); a.lineTo(x + 9 + i, y + h - 12); a.lineTo(x + 13 + i, y + h - 12); a.lineTo(x + 8 + i, y + h - 4); a.fill(); }
    }
    if (rand() < 0.18 && w > 30 && h > 16) { // lit windows
      const rows = 1 + Math.floor(rand() * 2);
      for (let rr = 0; rr < rows; rr++) for (let i = x + 5; i < x + w - 6; i += 6) {
        if (rand() < 0.7) { const b = 150 + rand() * 105; e.fillStyle = `rgb(${b},${b * 0.92},${b * 0.8})`; e.fillRect(i, y + 6 + rr * 7, 3, 2); }
        a.fillStyle = 'rgba(10,10,12,0.8)'; a.fillRect(i, y + 6 + rr * 7, 3, 2);
      }
    }
  };
  plate(0, 0, S, S, 0);
  // seams
  a.globalCompositeOperation = 'multiply';
  // grime streaks
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, len = 20 + rand() * 120;
    const g = a.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, 'rgba(70,64,58,0.35)'); g.addColorStop(1, 'rgba(70,64,58,0)');
    a.fillStyle = g; a.fillRect(x, y, 2 + rand() * 6, len);
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, y = rand() * S, rad = 30 + rand() * 120;
    const g = a.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(60,55,50,0.3)'); g.addColorStop(1, 'rgba(60,55,50,0)');
    a.fillStyle = g; a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  a.globalCompositeOperation = 'source-over';
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  TEX = { map: tex(ca, true), rough: tex(cr, false), emis: tex(ce, true) };
  return TEX;
}

const _cache = {};
export function shipAssets(cls, faction) {
  const key = cls + faction;
  if (_cache[key]) return _cache[key];
  if (!_cache[cls]) {
    const def = BUILDERS[cls]();
    const geos = def.parts.map((list) => mergeGeometries(list, false));
    const geo = mergeGeometries(geos, true);
    geo.computeVertexNormals();
    boxUV(geo, def.uv);
    geo.computeBoundingSphere();
    _cache[cls] = { geo, def };
  }
  const F = FACTIONS[faction];
  const T = hullTextures();
  const hull = new THREE.MeshStandardMaterial({
    color: new THREE.Color(F.hull), metalness: 0.72, roughness: 0.85, flatShading: true, envMapIntensity: 1.5,
    map: T?.map || null, roughnessMap: T?.rough || null,
    emissiveMap: T?.emis || null, emissive: T ? new THREE.Color(faction === 'player' ? '#ffd9a0' : '#bfe6ff') : new THREE.Color(0), emissiveIntensity: 1.6,
  });
  const accent = new THREE.MeshStandardMaterial({ color: F.color, emissive: F.color, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.5, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: F.color.clone().lerp(new THREE.Color(1, 1, 1), 0.4).multiplyScalar(8) });
  const plume = new THREE.MeshBasicMaterial({
    color: F.color.clone().lerp(new THREE.Color(1, 1, 1), 0.25).multiplyScalar(2.6), vertexColors: true,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  _cache[key] = { geo: _cache[cls].geo, def: _cache[cls].def, mats: [hull, accent, glow, plume], plume };
  return _cache[key];
}
export function flickerPlumes(t) {
  for (const k in _cache) {
    const a = _cache[k];
    if (!a.plume) continue;
    if (!a.base) a.base = a.plume.color.clone();
    a.plume.color.copy(a.base).multiplyScalar(0.85 + 0.15 * Math.sin(t * 37 + k.length) + 0.08 * Math.sin(t * 91));
  }
}

// Studio portraits of the real hulls for the interface.
export function renderPortraits(faction, w = 360, h = 220) {
  const out = {};
  if (typeof document === 'undefined') return out;
  try {
    const canvas = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(w, h, false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xffe2bf, 3.2); key.position.set(5, 6, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 2.4); rim.position.set(-6, 2, -5); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 200);
    for (const cls of ['corvette', 'frigate', 'dreadnought']) {
      const a = shipAssets(cls, faction);
      const mats = a.mats.map((m, i) => (i === 3 ? new THREE.MeshBasicMaterial({ visible: false }) : m.clone()));
      const mesh = new THREE.Mesh(a.geo, mats);
      mesh.rotation.y = -2.25;
      scene.add(mesh);
      const rad = a.geo.boundingSphere.radius;
      cam.position.set(rad * 1.75, rad * 1.05, rad * 1.75);
      cam.lookAt(0, -rad * 0.05, 0);
      r.render(scene, cam);
      out[cls] = canvas.toDataURL('image/png');
      scene.remove(mesh);
    }
    pm.dispose(); r.dispose(); r.forceContextLoss();
  } catch (err) { /* portraits are decoration only */ }
  return out;
}

let NEXT_ID = 1;

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
    this.host = null;
    this.order = null;
    this.target = null;
    this.cd = Math.random() * this.def.rof;
    this.selected = false;
    this.dead = false;
    this.trailT = Math.random();
    this.thinkT = Math.random() * 0.3;
    this.hit = 0;
    this.shieldT = 0;
    this.bank = 0;
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
    const R = body.orbitSlot + s.r * (body.r * 0.8 + 10) + (this.cls === 'dreadnought' ? 8 : 0);
    const a = s.a + t * s.w;
    out.set(Math.cos(a) * R, s.y * 2.5 + Math.sin(a) * R * s.tilt, Math.sin(a) * R).add(body.pos);
    return out;
  }
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
  setPR(pr) { this.mat.uniforms.uPR.value = pr; }
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
