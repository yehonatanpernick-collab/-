import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32 } from './noise.js';

export const ISLAND_R = 250;
export const MAP_SIZE = 600;
export const SECTOR = [0, Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
export const polar = (r, a) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

export const REALMS = [
  { name: 'אחו השמש', tag: 'ממלכת האור', color: '#ffd66b' },
  { name: 'היער המכושף', tag: 'ממלכת האגדות', color: '#ff7ad9' },
  { name: 'מקדש הטיטאנים', tag: 'ממלכת המיתוסים', color: '#ffc04a' },
  { name: 'פסגות הבדולח', tag: 'ממלכת ההרפתקאות', color: '#5ff0ff' },
  { name: 'ממלכת הצללים', tag: 'ממלכת האופל', color: '#b05cff' },
];

const PAL_DEF = [
  { top: '#3f8ff5', bot: '#ffe6bf', fog: '#cfe2fb', den: 0.0040, sun: '#fff0d2', sunI: 3.3, hs: '#c3e2ff', hg: '#6a8f4a', hI: 1.15, part: '#ffe27a', cloud: '#ffffff', stars: 0, disc: '#fff6dd' },
  { top: '#33287e', bot: '#ff9fd0', fog: '#c49ee3', den: 0.0062, sun: '#ffc4ee', sunI: 2.3, hs: '#d8a8ff', hg: '#34566a', hI: 1.25, part: '#9ffcff', cloud: '#ffcdee', stars: 0.6, disc: '#ffe0f6' },
  { top: '#2b68d0', bot: '#ffc674', fog: '#efcf96', den: 0.0046, sun: '#ffd596', sunI: 3.5, hs: '#ffe2b0', hg: '#8a6f45', hI: 1.0, part: '#fff0b0', cloud: '#fff0d8', stars: 0, disc: '#fff1c8' },
  { top: '#1b78dd', bot: '#d4f4ff', fog: '#c1e4f6', den: 0.0038, sun: '#ffffff', sunI: 3.7, hs: '#d6f0ff', hg: '#5d6b7a', hI: 1.1, part: '#ffffff', cloud: '#ffffff', stars: 0, disc: '#ffffff' },
  { top: '#08040f', bot: '#6a1830', fog: '#3a1228', den: 0.0072, sun: '#ff7a6a', sunI: 2.3, hs: '#9060c0', hg: '#4a2030', hI: 1.35, part: '#ff6a2a', cloud: '#3a1828', stars: 1, disc: '#ff3a2a' },
];
const HEALED_DEF = { top: '#4650b8', bot: '#ffb08a', fog: '#d8a6c6', den: 0.0050, sun: '#ffd2a8', sunI: 2.9, hs: '#ffd0e8', hg: '#5a4a6a', hI: 1.15, part: '#ffd2ff', cloud: '#ffe0f0', stars: 0.35, disc: '#ffe6c8' };
const toPal = d => ({ top: new THREE.Color(d.top), bot: new THREE.Color(d.bot), fog: new THREE.Color(d.fog), den: d.den, sun: new THREE.Color(d.sun), sunI: d.sunI, hs: new THREE.Color(d.hs), hg: new THREE.Color(d.hg), hI: d.hI, part: new THREE.Color(d.part), cloud: new THREE.Color(d.cloud), stars: d.stars, disc: new THREE.Color(d.disc) });

const noise = makeNoise(7), noise2 = makeNoise(13), noise3 = makeNoise(29);
function fbm(x, z, oct) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
function ridged(x, z, oct) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise2(x * f, z * f))); n += a; a *= 0.5; f *= 2.1; } return s / n; }
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export function smooth(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;

export function biomeWeights(x, z, out = [0, 0, 0, 0, 0]) {
  const r = Math.hypot(x, z);
  const lw = smooth(88, 52, r + noise3(x * 0.02, z * 0.02) * 12);
  const a = Math.atan2(z, x) + noise3(x * 0.006 + 5, z * 0.006) * 0.35;
  let sum = 0;
  for (let i = 1; i < 5; i++) { const w = Math.exp(7 * Math.cos(a - SECTOR[i])); out[i] = w; sum += w; }
  for (let i = 1; i < 5; i++) out[i] = out[i] / sum * (1 - lw);
  out[0] = lw;
  return out;
}

export const SPOTS = [
  { id: 'altar', x: 0, z: 0, r: 24, h: 3 },
  { id: 's1', ...polar(150, SECTOR[1]), r: 18 },
  { id: 's2', ...polar(150, SECTOR[2]), r: 24 },
  { id: 's3', ...polar(152, SECTOR[3]), r: 18, h: 15 },
  { id: 's4', ...polar(150, SECTOR[4]), r: 44, h: 3 },
  { id: 'cottage', ...polar(112, SECTOR[1] + 0.32), r: 10 },
  { id: 'tower', ...polar(165, SECTOR[1] - 0.3), r: 8 },
  { id: 'titan', ...polar(118, SECTOR[2] - 0.3), r: 11 },
  { id: 'arch', ...polar(118, SECTOR[3] + 0.3), r: 9 },
  { id: 'castle', ...polar(192, SECTOR[4]), r: 26, h: 4 },
];
const W = [0, 0, 0, 0, 0];
function rawHeight(x, z) {
  biomeWeights(x, z, W);
  const b = fbm(x * 0.007, z * 0.007, 4);
  const d = fbm(x * 0.025 + 3, z * 0.025, 3);
  let h = 0;
  if (W[0] > 0.001) h += W[0] * (2.4 + b * 2.2 + d * 0.6);
  if (W[1] > 0.001) h += W[1] * (3 + b * 4 + Math.max(0, fbm(x * 0.018, z * 0.018, 3)) * 9 + d);
  if (W[2] > 0.001) {
    const t = 3 + (b * 0.5 + 0.5) * 13, k = t / 3, f = k - Math.floor(k);
    h += W[2] * ((Math.floor(k) + smooth(0.35, 0.65, f)) * 3 + d * 0.4);
  }
  if (W[3] > 0.001) h += W[3] * (3 + Math.pow(ridged(x * 0.012, z * 0.012, 4), 2.3) * 44 + d * 1.5);
  if (W[4] > 0.001) h += W[4] * (1.5 + b * 3 + Math.pow(ridged(x * 0.03, z * 0.03, 3), 3) * 9 - Math.max(0, -fbm(x * 0.02, z * 0.02, 2)) * 6);
  const r = Math.hypot(x, z);
  const e = smooth(ISLAND_R - 38, ISLAND_R + 12, r + noise3(x * 0.01, z * 0.01) * 14);
  return h * (1 - e) - 12 * e;
}
for (const s of SPOTS) if (s.h === undefined) s.h = Math.max(2.6, rawHeight(s.x, s.z));
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const s of SPOTS) {
    const dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz;
    if (d2 < s.r * s.r) h = lerp(h, s.h, smooth(s.r, s.r * 0.6, Math.sqrt(d2)));
  }
  return h;
}

// ---------- geometry helpers ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function P(geo, color, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
  const s = o.s || 1;
  _m.compose(_p.set(o.x || 0, o.y || 0, o.z || 0), _q, _s.set((o.sx || 1) * s, (o.sy || 1) * s, (o.sz || 1) * s));
  g.applyMatrix4(_m);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g;
}
export const M = (...parts) => mergeGeometries(parts.flat());
export const cyl = (a, b, h, s = 7) => new THREE.CylinderGeometry(a, b, h, s);
export const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
export const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
export const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
export const sph = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
export const oct = r => new THREE.OctahedronGeometry(r, 0);
export const dod = r => new THREE.DodecahedronGeometry(r, 0);

export const stdMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
const glowCache = {};
export function glowMat(color, intensity = 2, opts = {}) {
  const k = color + intensity + JSON.stringify(opts);
  if (!glowCache[k]) glowCache[k] = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.4, ...opts });
  return glowCache[k];
}

// ---------- prop catalogue ----------
function propDefs() {
  const D = {};
  D.oak = { r: 0.6, parts: [{ geo: M(P(cyl(0.22, 0.4, 3, 6), '#7a4f2e', { y: 1.5 }), P(ico(1.7, 1), '#5fae3e', { y: 3.9 }), P(ico(1.3, 1), '#6dbb48', { x: 1.1, y: 3.3, z: 0.3 }), P(ico(1.2, 1), '#529a36', { x: -1, y: 3.4, z: -0.4 }), P(ico(1.1, 1), '#82c957', { y: 5, z: 0.2 })) }] };
  D.birch = { r: 0.4, parts: [{ geo: M(P(cyl(0.15, 0.22, 4.6, 6), '#ece6da', { y: 2.3 }), P(ico(1.2, 1), '#b3d64e', { y: 4.8, sy: 1.5 }), P(ico(0.9, 1), '#c5df5a', { x: 0.6, y: 4.0, sy: 1.3 })) }] };
  D.bush = { r: 0, parts: [{ geo: M(P(ico(0.8, 1), '#4f9a3a', { y: 0.4 }), P(ico(0.6, 1), '#62ad44', { x: 0.6, y: 0.3 }), P(ico(0.55, 1), '#58a23e', { x: -0.5, y: 0.3, z: 0.3 })) }] };
  const fl = [];
  const fc = ['#ff5a6e', '#ffd84a', '#ffffff', '#b07aff', '#ff9ad5', '#6ad0ff'];
  for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.3 + (i % 3) * 0.35; fl.push(P(cyl(0.02, 0.02, 0.4, 3), '#3f8a30', { x: Math.cos(a) * r, y: 0.2, z: Math.sin(a) * r }), P(ico(0.11, 0), fc[i % fc.length], { x: Math.cos(a) * r, y: 0.42, z: Math.sin(a) * r })); }
  D.flowers = { r: 0, shadow: false, parts: [{ geo: M(fl) }] };
  D.rock = { r: 0.9, parts: [{ geo: M(P(dod(1), '#9a978c', { y: 0.3, sy: 0.7 }), P(dod(0.5), '#8a877c', { x: 0.9, y: 0.1 })) }] };
  // fairy
  const mushStem = P(cyl(0.35, 0.55, 3.2, 8), '#f3e9d2', { y: 1.6 });
  const spots = []; for (let i = 0; i < 6; i++) { const a = i * 1.05; spots.push(P(sph(0.18, 6, 4), '#ffffff', { x: Math.cos(a) * 1.3, y: 3.6, z: Math.sin(a) * 1.3 })); }
  const cap = new THREE.SphereGeometry(1.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  D.mushPink = { r: 0.6, parts: [{ geo: M(mushStem, spots) }, { geo: P(cap, '#ffffff', { y: 3.1, sy: 0.6 }), mat: glowMat('#ff4fa8', 0.9) }] };
  D.mushCyan = { r: 0.6, parts: [{ geo: M(mushStem, spots) }, { geo: P(cap, '#ffffff', { y: 3.1, sy: 0.6 }), mat: glowMat('#3fd8ff', 0.9) }] };
  const sm = []; for (let i = 0; i < 4; i++) { const a = i * 1.6, r = 0.2 + i * 0.15; sm.push(P(cyl(0.05, 0.07, 0.4, 5), '#f3e9d2', { x: Math.cos(a) * r, y: 0.2, z: Math.sin(a) * r })); }
  const smc = []; for (let i = 0; i < 4; i++) { const a = i * 1.6, r = 0.2 + i * 0.15; smc.push(P(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#fff', { x: Math.cos(a) * r, y: 0.38, z: Math.sin(a) * r })); }
  D.smallMush = { r: 0, shadow: false, parts: [{ geo: M(sm) }, { geo: M(smc), mat: glowMat('#a06bff', 1.6) }] };
  D.pinkTree = { r: 0.5, parts: [{ geo: M(P(cyl(0.2, 0.35, 3.4, 6), '#6b3f4a', { y: 1.7, rz: 0.08 }), P(ico(1.6, 1), '#ff8fc8', { y: 4.1 }), P(ico(1.2, 1), '#f27abb', { x: 1, y: 3.6 }), P(ico(1.1, 1), '#ffa6d6', { x: -0.9, y: 3.8, z: 0.5 })) }] };
  D.twistTree = { r: 0.5, parts: [{ geo: M(P(cyl(0.18, 0.4, 2.2, 6), '#4b2e5e', { y: 1.1, rz: 0.25 }), P(cyl(0.12, 0.2, 2.2, 6), '#4b2e5e', { x: 0.45, y: 2.9, rz: -0.35 }), P(ico(1.4, 1), '#2fc6b4', { x: 0.2, y: 4.4, sy: 0.8 }), P(ico(0.9, 1), '#3fe0c8', { x: 1.1, y: 3.9 })) }] };
  // mythic
  D.column = { r: 0.75, parts: [{ geo: M(P(box(1.6, 0.5, 1.6), '#e8e1cf', { y: 0.25 }), P(cyl(0.55, 0.62, 7, 10), '#f2ecdc', { y: 3.9 }), P(box(1.7, 0.5, 1.7), '#e8e1cf', { y: 7.6 })) }] };
  D.brokenColumn = { r: 0.75, parts: [{ geo: M(P(box(1.6, 0.5, 1.6), '#e2dbc8', { y: 0.25 }), P(cyl(0.55, 0.62, 2.8, 10), '#ece5d3', { y: 1.8 }), P(cyl(0.55, 0.55, 2.2, 10), '#e5decb', { x: 1.6, y: 0.5, rz: 1.45, ry: 0.4 })) }] };
  D.cypress = { r: 0.4, parts: [{ geo: M(P(cyl(0.15, 0.2, 1.2, 5), '#5b3f2a', { y: 0.6 }), P(ico(1, 1), '#2f6b3a', { y: 3.2, sy: 2.6 })) }] };
  D.olive = { r: 0.5, parts: [{ geo: M(P(cyl(0.18, 0.35, 2.2, 6), '#6e5a44', { y: 1.1, rz: -0.2 }), P(ico(1.5, 1), '#8f9e5f', { x: -0.3, y: 2.9, sy: 0.6 }), P(ico(1.1, 1), '#9aab69', { x: 0.8, y: 2.6, sy: 0.6 })) }] };
  D.marble = { r: 1.0, parts: [{ geo: M(P(box(2, 1.2, 1.4), '#ddd5c0', { y: 0.5, ry: 0.3, rz: 0.1 }), P(box(1, 0.8, 1), '#d2cab4', { x: 1.4, y: 0.3, ry: 1 })) }] };
  // adventure
  D.pine = { r: 0.5, parts: [{ geo: M(P(cyl(0.18, 0.28, 1.6, 6), '#5b3a22', { y: 0.8 }), P(cone(1.8, 2.6, 7), '#2d6e45', { y: 2.4 }), P(cone(1.4, 2.2, 7), '#357a4d', { y: 3.6 }), P(cone(0.95, 1.9, 7), '#3d8655', { y: 4.8 })) }] };
  D.pineSnow = { r: 0.5, parts: [{ geo: M(P(cyl(0.18, 0.28, 1.6, 6), '#5b3a22', { y: 0.8 }), P(cone(1.8, 2.6, 7), '#2d6e45', { y: 2.4 }), P(cone(1.4, 2.2, 7), '#e8f2ff', { y: 3.6 }), P(cone(0.95, 1.9, 7), '#ffffff', { y: 4.8 })) }] };
  const cr = []; for (let i = 0; i < 5; i++) { const a = i * 1.3; cr.push(P(oct(0.5), '#fff', { x: Math.cos(a) * 0.5 * (i > 0), z: Math.sin(a) * 0.5 * (i > 0), y: i ? 0.9 : 1.6, sy: i ? 2.4 : 3.6, rz: i ? Math.cos(a) * 0.4 : 0, rx: i ? Math.sin(a) * 0.4 : 0 })); }
  D.crystal = { r: 0.8, parts: [{ geo: M(P(dod(0.9), '#6f7a8c', { y: 0.2, sy: 0.5 })) }, { geo: M(cr), mat: glowMat('#56eaff', 1.4, { transparent: true, opacity: 0.92 }) }] };
  D.rockBig = { r: 1.8, parts: [{ geo: M(P(dod(2), '#7d8796', { y: 0.8, sy: 0.8 }), P(dod(1.2), '#8a94a3', { x: 1.6, y: 0.4, z: 0.6 })) }] };
  // dark
  D.deadTree = { r: 0.5, parts: [{ geo: M(P(cyl(0.15, 0.4, 4, 5), '#2b2228', { y: 2 }), P(cyl(0.05, 0.12, 2, 4), '#2b2228', { x: 0.6, y: 3.3, rz: -0.9 }), P(cyl(0.05, 0.12, 1.8, 4), '#2b2228', { x: -0.5, y: 2.8, rz: 1.0 }), P(cyl(0.04, 0.1, 1.5, 4), '#2b2228', { z: 0.5, y: 3.9, rx: 0.8 })) }] };
  D.spikes = { r: 0.8, parts: [{ geo: M(P(cone(0.5, 3, 5), '#1c1620', { y: 1.5 }), P(cone(0.35, 2, 5), '#241c28', { x: 0.7, y: 0.9, rz: -0.3 }), P(cone(0.3, 1.6, 5), '#1c1620', { x: -0.6, y: 0.7, z: 0.3, rz: 0.4 })) }] };
  const dc = []; for (let i = 0; i < 4; i++) { const a = i * 1.7; dc.push(P(oct(0.45), '#fff', { x: Math.cos(a) * 0.5 * (i > 0), z: Math.sin(a) * 0.5 * (i > 0), y: i ? 0.8 : 1.4, sy: i ? 2 : 3, rz: i ? Math.cos(a) * 0.5 : 0, rx: i ? Math.sin(a) * 0.5 : 0 })); }
  D.darkCrystal = { r: 0.7, parts: [{ geo: M(P(dod(0.8), '#2a2230', { y: 0.2, sy: 0.5 })) }, { geo: M(dc), mat: glowMat('#ff2244', 1.8) }] };
  D.tomb = { r: 0.5, parts: [{ geo: M(P(box(0.9, 1.2, 0.25), '#57525e', { y: 0.6, rz: 0.08 }), P(cyl(0.45, 0.45, 0.25, 10), '#57525e', { y: 1.2, rx: Math.PI / 2, rz: 0.08 }), P(box(1.1, 0.15, 1.6), '#3a3540', { y: 0.05, z: 0.6 })) }] };
  D.rockDark = { r: 1.0, parts: [{ geo: M(P(dod(1.1), '#3a3340', { y: 0.4, sy: 0.75 }), P(dod(0.6), '#2e2834', { x: 1, y: 0.2 })) }] };
  return D;
}
const TABLE = [
  [['oak', 4, 0.9, 1.4], ['birch', 2, 0.9, 1.3], ['bush', 3, 0.8, 1.4], ['flowers', 6, 0.8, 1.3], ['rock', 1.2, 0.6, 1.3]],
  [['mushPink', 2.2, 0.8, 1.6], ['mushCyan', 2.2, 0.8, 1.6], ['pinkTree', 3, 0.9, 1.4], ['twistTree', 1.5, 0.9, 1.3], ['smallMush', 5, 0.9, 1.6], ['bush', 2, 0.8, 1.2]],
  [['column', 1.4, 0.9, 1.1], ['brokenColumn', 2, 0.9, 1.1], ['cypress', 3.5, 0.8, 1.4], ['olive', 2.5, 0.9, 1.3], ['marble', 1.2, 0.8, 1.2], ['rock', 1.2, 0.7, 1.2]],
  [['pine', 7, 0.8, 1.5], ['crystal', 2.2, 0.7, 1.6], ['rockBig', 2, 0.6, 1.4], ['bush', 1, 0.8, 1.2]],
  [['deadTree', 4, 0.8, 1.5], ['spikes', 2, 0.7, 1.5], ['darkCrystal', 1.4, 0.8, 1.6], ['tomb', 2.2, 0.9, 1.2], ['rockDark', 2.2, 0.7, 1.3]],
];

// ---------- World ----------
export class World {
  constructor(scene, renderer, Q) {
    this.scene = scene; this.Q = Q;
    this.pal = PAL_DEF.map(toPal); this.healedPal = toPal(HEALED_DEF); this.darkPal = this.pal[4];
    this.cur = [1, 0, 0, 0, 0];
    this.blend = toPal(PAL_DEF[0]);
    this.healed = 0; // 0..1 heal progress
    this.colliders = []; this.grid = new Map();
    this.platforms = [];
    this.emitters = [];
    this.animated = [];
    this.time = 0;
    this.rng = mulberry32(42);
    this.buildLights();
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildLandmarks();
    this.buildPaths();
    this.scatterProps();
    this.buildGrass();
    this.buildClouds();
    this.buildMinimap();
  }

  // ---- queries ----
  groundAt(x, z) {
    let h = terrainHeight(x, z);
    for (const p of this.platforms) {
      if (p.r) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < p.r * p.r && p.h > h) h = p.h; }
      else { const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z); if (dx < p.hw && dz < p.hd && p.h > h) h = p.h; }
    }
    return h;
  }
  addCollider(x, z, r) {
    const c = { x, z, r }; this.colliders.push(c);
    const cs = 8, x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs), z0 = Math.floor((z - r) / cs), z1 = Math.floor((z + r) / cs);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 10000 + j; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(c); }
    return c;
  }
  resolve(pos, r) {
    const k = Math.floor(pos.x / 8) * 10000 + Math.floor(pos.z / 8);
    const list = this.grid.get(k); if (!list) return;
    for (const c of list) {
      if (c.off) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
      if (d < m && d > 1e-4) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; }
    }
  }
  dominant() { let b = 0; for (let i = 1; i < 5; i++) if (this.cur[i] > this.cur[b]) b = i; return b; }

  // ---- lights ----
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xc3e2ff, 0x6a8f4a, 1.1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d2, 3.3);
    this.sunDir = new THREE.Vector3(0.55, 0.62, 0.42).normalize();
    if (this.Q.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(this.Q.shadows, this.Q.shadows);
      const c = this.sun.shadow.camera; c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 1; c.far = 220;
      this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.scene.fog = new THREE.FogExp2(0xcfe2fb, 0.004);
  }

  buildSky() {
    const u = this.skyU = {
      uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uSun: { value: new THREE.Color() },
      uStars: { value: 0 }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uTop,uBot,uSunDir,uSun; uniform float uStars,uTime; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(uBot, uTop, pow(smoothstep(-0.08, 0.7, h), 0.75));
          c = mix(c, uBot*0.55, smoothstep(0.0,-0.3,h));
          float s = max(dot(d, normalize(uSunDir)), 0.);
          c += uSun * (smoothstep(0.99975,0.99988,s)*5. + pow(s, 12.)*0.35 + pow(s,3.)*0.12);
          vec3 sp = floor(d*260.); float st = step(0.9965, hash(sp)) * smoothstep(0.0,0.3,h);
          st *= 0.6+0.4*sin(uTime*3.+hash(sp+1.)*40.);
          c += vec3(st*uStars*1.6);
          // aurora ribbons for magical skies
          float au = smoothstep(0.15,0.5,h)*smoothstep(0.85,0.5,h)*uStars;
          float band = sin(d.x*6.+uTime*0.15+sin(d.z*4.+uTime*0.2)*2.)*0.5+0.5;
          c += vec3(0.2,0.9,0.7)*pow(band,6.)*au*0.25;
          gl_FragColor = vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  buildTerrain() {
    const seg = this.Q.terrainSeg;
    const g = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, n = pos.count;
    for (let i = 0; i < n; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    const nor = g.attributes.normal, col = new Float32Array(n * 3);
    const BC = [['#6fbd45', '#9ad65c'], ['#3d9a70', '#8a62c8'], ['#b6ab5c', '#d9c98a'], ['#58984c', '#74905c'], ['#4a3a52', '#2e2238']].map(a => a.map(c => new THREE.Color(c)));
    const ROCK = ['#8f8a7a', '#6a5a7a', '#d6ccb0', '#7a8494', '#2e2830'].map(c => new THREE.Color(c));
    const sand = new THREE.Color('#e6d59c'), blackSand = new THREE.Color('#2a2026'), snow = new THREE.Color('#f4f8ff'), wet = new THREE.Color('#7a6a4a');
    const w = [0, 0, 0, 0, 0], c = new THREE.Color(), t = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      biomeWeights(x, z, w);
      const v = noise3(x * 0.05, z * 0.05) * 0.5 + 0.5, v2 = noise(x * 0.15 + 9, z * 0.15) * 0.5 + 0.5;
      c.setRGB(0, 0, 0);
      for (let b = 0; b < 5; b++) { if (w[b] < 0.001) continue; t.copy(BC[b][0]).lerp(BC[b][1], clamp01(v * 1.2 - 0.1)); c.r += t.r * w[b]; c.g += t.g * w[b]; c.b += t.b * w[b]; }
      const slope = 1 - nor.getY(i);
      t.setRGB(0, 0, 0); for (let b = 0; b < 5; b++) { t.r += ROCK[b].r * w[b]; t.g += ROCK[b].g * w[b]; t.b += ROCK[b].b * w[b]; }
      c.lerp(t, smooth(0.18, 0.38, slope));
      if (w[3] > 0.4) c.lerp(snow, smooth(22, 28, y + v2 * 4) * smooth(0.45, 0.25, slope));
      const sd = w[4] > 0.5 ? blackSand : sand;
      c.lerp(sd, smooth(1.6, 0.9, y));
      if (y < 0.2) c.lerp(wet, smooth(0.2, -2, y) * 0.6);
      const k = 0.92 + v2 * 0.16; col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.terrain = new THREE.Mesh(g, mat); this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    // depth texture for water (0 shore -> 1 deep)
    const S = 256, data = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S * MAP_SIZE - MAP_SIZE / 2, z = (j + 0.5) / S * MAP_SIZE - MAP_SIZE / 2;
      const h = terrainHeight(x, z), k = (j * S + i) * 4;
      data[k] = Math.round(clamp01(-h / 8) * 255); data[k + 3] = 255;
      this._hcache ??= new Float32Array(S * S); this._hcache[j * S + i] = h;
    }
    this.depthTex = new THREE.DataTexture(data, S, S); this.depthTex.magFilter = this.depthTex.minFilter = THREE.LinearFilter; this.depthTex.needsUpdate = true;
  }

  buildWater() {
    const u = this.waterU = {
      uTime: { value: 0 }, uDepth: { value: this.depthTex }, uSunDir: { value: this.sunDir }, uSun: { value: new THREE.Color() },
      uSky: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogDen: { value: 0.004 }, uCurse: { value: 1 }, uSize: { value: MAP_SIZE },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true,
      vertexShader: `uniform float uTime; varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.);
        w.y += sin(w.x*0.12+uTime*1.2)*0.12 + cos(w.z*0.1+uTime)*0.12; vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime,uFogDen,uCurse,uSize; uniform sampler2D uDepth; uniform vec3 uSunDir,uSun,uSky,uFog; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz/uSize + 0.5; float depth = texture2D(uDepth, uv).r;
          if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) depth = 1.;
          vec2 p = vW.xz; float t = uTime;
          float dx = cos(p.x*0.21+t*1.3)*0.12 + cos((p.x+p.y)*0.43+t*1.9)*0.08 + cos(p.x*1.3-t*2.6)*0.03;
          float dz = cos(p.y*0.19+t*1.1)*0.12 + cos((p.y-p.x)*0.37+t*1.6)*0.08 + cos(p.y*1.5+t*2.2)*0.03;
          vec3 n = normalize(vec3(-dx,1.,-dz));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.-max(dot(n,v),0.), 4.);
          vec3 shallow = vec3(0.12,0.62,0.62), deep = vec3(0.01,0.09,0.22);
          vec3 col = mix(shallow, deep, smoothstep(0.,0.55,depth));
          col = mix(col, uSky, fres*0.75);
          vec3 r = reflect(-v, n); float spec = pow(max(dot(r, normalize(uSunDir)),0.), 180.);
          col += uSun*spec*2.5;
          float foam = smoothstep(0.07,0.0, depth - 0.02*sin(t*2.+p.x*0.5+p.y*0.4));
          col = mix(col, vec3(0.95), foam*0.75);
          // lava in the shadow realm
          float rr = length(p); float a = atan(p.y,p.x);
          float m = smoothstep(0.55,0.85, cos(a + 0.785398)) * smoothstep(55.,85.,rr) * uCurse;
          float ln = sin(p.x*0.3+t*0.6)*sin(p.y*0.27-t*0.5) + sin((p.x+p.y)*0.11+t*0.3);
          vec3 lava = mix(vec3(0.35,0.02,0.0), vec3(2.2,0.55,0.08), smoothstep(-0.6,1.4,ln));
          lava = mix(lava, vec3(2.5,1.0,0.2), foam);
          col = mix(col, lava, m);
          float alpha = mix(mix(0.7,0.97,smoothstep(0.,0.4,depth)) + foam*0.3, 1., m);
          float dist = length(cameraPosition - vW); float f = 1. - exp(-uFogDen*uFogDen*dist*dist);
          col = mix(col, uFog, f);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const g = new THREE.PlaneGeometry(2400, 2400, 120, 120); g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, mat); this.water.position.y = -0.15; this.water.renderOrder = 1;
    this.scene.add(this.water);
  }

  addMesh(geo, mat = stdMat, { shadow = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = receive; this.scene.add(m); return m;
  }
  ringColliders(cx, cz, R, count, r) { for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2; this.addCollider(cx + Math.cos(a) * R, cz + Math.sin(a) * R, r); } }

  buildLandmarks() {
    const S = id => SPOTS.find(s => s.id === id);
    // ---- Altar of Aether (light) ----
    const A = S('altar'), ah = A.h;
    this.altar = new THREE.Vector3(0, ah, 0);
    this.addMesh(M(P(cyl(11, 12, 0.8, 32), '#e9e2cf', { y: ah + 0.0 }), P(cyl(8, 8.5, 0.6, 32), '#f5f0e2', { y: ah + 0.6 }), P(cyl(3, 3.4, 1.2, 12), '#d9cfb3', { y: ah + 1.2 })));
    this.platforms.push({ x: 0, z: 0, r: 12, h: ah + 0.4 }, { x: 0, z: 0, r: 8.5, h: ah + 0.9 }, { x: 0, z: 0, r: 3.3, h: ah + 1.8 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.PI / 8, x = Math.cos(a) * 10, z = Math.sin(a) * 10;
      this.addMesh(M(P(cyl(0.5, 0.6, 6, 10), '#f2ecdc', { x, z, y: ah + 3.4 }), P(box(1.4, 0.4, 1.4), '#e3dcc8', { x, z, y: ah + 6.5 })));
      const orb = this.addMesh(sph(0.4, 12, 8), glowMat('#ffe7a0', 3), { shadow: false }); orb.position.set(x, ah + 7.2, z);
      this.addCollider(x, z, 0.7);
    }
    this.addMesh(M(P(new THREE.TorusGeometry(10, 0.25, 6, 48), '#e8b84a', { y: ah + 6.9, rx: Math.PI / 2 })), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.35, emissive: '#3a2a08' }));
    // heart of aether (assembles over the game)
    this.heart = new THREE.Group(); this.heart.position.set(0, ah + 4.5, 0); this.scene.add(this.heart);
    this.heartCore = new THREE.Mesh(ico(0.7, 1), glowMat('#fff4c0', 2.5)); this.heart.add(this.heartCore);
    this.heartPieces = [];
    const hc = ['#ff7ad9', '#ffc04a', '#5ff0ff', '#b05cff'];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(oct(0.55), glowMat(hc[i], 2.6)); p.scale.set(0.8, 1.6, 0.8); p.visible = false; this.heart.add(p); this.heartPieces.push(p);
    }
    this.heartRing = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.05, 6, 48), glowMat('#ffe7a0', 3)); this.heart.add(this.heartRing);
    this.emitters.push({ x: 0, y: ah + 4.5, z: 0, color: '#ffe7a0', rate: 8, spread: 1.5, up: 1.5, life: 1.6, size: 0.5 });

    // ---- Fairy realm ----
    const C = S('cottage');
    const cot = new THREE.Group(); cot.position.set(C.x, C.h, C.z); cot.rotation.y = -SECTOR[1] - Math.PI / 2; this.scene.add(cot);
    const cotGeo = M(P(cyl(3, 3.2, 3.6, 12), '#f4e6c8', { y: 1.8 }), P(cone(4, 3.8, 12), '#d4487a', { y: 5.4 }), P(cone(1.2, 1.4, 8), '#c23a6a', { y: 7.6 }),
      P(box(1.2, 2, 0.3), '#6b3f2a', { y: 1, z: 3.05 }), P(box(0.6, 2.2, 0.6), '#8a6a5a', { x: 1.8, y: 6.2, z: -0.8 }), P(cyl(3.4, 3.4, 0.3, 12), '#b9a58a', { y: 0.1 }));
    const cm = new THREE.Mesh(cotGeo, stdMat); cm.castShadow = cm.receiveShadow = true; cot.add(cm);
    for (const [wx, wz, ry] of [[-2.2, 2.1, -0.8], [2.2, 2.1, 0.8], [0, -3.05, 0]]) { const wm = new THREE.Mesh(box(0.8, 0.8, 0.1), glowMat('#ffcf6a', 2.4)); wm.position.set(wx, 2.2, wz); wm.rotation.y = ry; cot.add(wm); }
    this.addCollider(C.x, C.z, 3.4);
    this.emitters.push({ x: C.x + Math.cos(SECTOR[1]) * 0, y: C.h + 8, z: C.z, color: '#ffd6f0', rate: 2, spread: 0.3, up: 1.2, life: 3, size: 0.9 });
    const T = S('tower');
    this.addMesh(M(P(cyl(2.4, 2.8, 14, 12), '#e9dcc4', { x: T.x, z: T.z, y: T.h + 7 }), P(cyl(3, 3, 1, 12), '#d8c8ac', { x: T.x, z: T.z, y: T.h + 14.4 }), P(cone(3.2, 6, 12), '#7a4fd0', { x: T.x, z: T.z, y: T.h + 17.9 }),
      P(cyl(0.05, 0.05, 2, 4), '#e8b84a', { x: T.x, z: T.z, y: T.h + 21.5 })));
    for (let i = 0; i < 3; i++) { const wm = this.addMesh(box(0.7, 1.2, 0.2), glowMat('#ffcf6a', 2.2), { shadow: false }); const a = i * 2.1; wm.position.set(T.x + Math.cos(a) * 2.5, T.h + 5 + i * 3.5, T.z + Math.sin(a) * 2.5); wm.rotation.y = -a + Math.PI / 2; }
    const flag = this.addMesh(box(1.6, 0.8, 0.05), glowMat('#ff7ad9', 0.6, { side: THREE.DoubleSide }), { shadow: false }); flag.position.set(T.x + 0.85, T.h + 22, T.z); this.animated.push(t => flag.rotation.y = Math.sin(t * 2) * 0.3);
    this.addCollider(T.x, T.z, 2.9);

    // ---- Mythic realm: temple + titan ----
    const T2 = S('s2'), th = T2.h, ta = -SECTOR[2];
    const temple = new THREE.Group(); temple.position.set(T2.x, th, T2.z); temple.rotation.y = ta + Math.PI / 2; this.scene.add(temple);
    const tParts = [P(box(20, 0.6, 14), '#ddd4bd', { y: 0.3 }), P(box(18.4, 0.6, 12.4), '#e8e0cb', { y: 0.9 }), P(box(17, 0.6, 11), '#f0e9d6', { y: 1.5 })];
    const cols = [];
    for (let i = 0; i < 6; i++) for (const zz of [-4.8, 4.8]) cols.push([-7 + i * 2.8, zz]);
    for (const xx of [-7, 7]) for (const zz of [-1.6, 1.6]) cols.push([xx, zz]);
    for (const [cx, cz] of cols) { if (cx > 3 && cz > 0 && Math.abs(cx - 7) < 0.1) continue; tParts.push(P(cyl(0.5, 0.58, 7, 12), '#f5efe0', { x: cx, z: cz, y: 5.3 }), P(box(1.3, 0.35, 1.3), '#e8e0cb', { x: cx, z: cz, y: 8.9 })); }
    tParts.push(P(box(17, 0.8, 11), '#ece4cf', { y: 9.4 }), P(cyl(6.58, 6.58, 17, 3), '#e6dec8', { y: 10.8, rz: Math.PI / 2, rx: -Math.PI / 2, sz: 0.304 }));
    const tm = new THREE.Mesh(M(tParts), stdMat); tm.castShadow = tm.receiveShadow = true; temple.add(tm);
    this.platforms.push({ x: T2.x, z: T2.z, r: 7.2, h: th + 1.8 });
    this.platforms.push({ x: T2.x, z: T2.z, r: 9.5, h: th + 1.2 });
    const tq = new THREE.Vector3();
    for (const [cx, cz] of cols) { tq.set(cx, 0, cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), temple.rotation.y); this.addCollider(T2.x + tq.x, T2.z + tq.z, 0.7); }
    // braziers
    for (const s of [-1, 1]) {
      tq.set(10.5, 0, s * 3).applyAxisAngle(new THREE.Vector3(0, 1, 0), temple.rotation.y);
      const bx = T2.x + tq.x, bz = T2.z + tq.z, by = terrainHeight(bx, bz);
      this.addMesh(M(P(cyl(0.25, 0.4, 2, 8), '#c9a24a', { x: bx, z: bz, y: by + 1 }), P(cyl(0.8, 0.4, 0.6, 10), '#e8b84a', { x: bx, z: bz, y: by + 2.2 })), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.35 }));
      const fire = this.addMesh(ico(0.5, 1), glowMat('#ff9a2a', 4), { shadow: false }); fire.position.set(bx, by + 2.8, bz);
      this.animated.push(t => { const s2 = 1 + Math.sin(t * 13 + bx) * 0.15; fire.scale.set(s2, 1.4 + Math.sin(t * 9) * 0.3, s2); });
      this.emitters.push({ x: bx, y: by + 3, z: bz, color: '#ff8a2a', rate: 14, spread: 0.3, up: 2.5, life: 0.9, size: 0.6 });
      this.addCollider(bx, bz, 0.7);
    }
    // titan statue
    const TT = S('titan'), tth = TT.h;
    const titan = new THREE.Group(); titan.position.set(TT.x, tth, TT.z); titan.rotation.y = -SECTOR[2] + Math.PI / 2 + 0.6; this.scene.add(titan);
    const mar = '#e9e3d3', mar2 = '#d8d0bc', moss = '#7d9a5a';
    const tg = M(P(box(6, 2, 6), mar2, { y: 1 }), P(box(5, 0.6, 5), moss, { y: 2.2 }),
      P(cyl(0.9, 0.7, 7, 8), mar, { x: -1.1, y: 5.5 }), P(cyl(0.9, 0.7, 7, 8), mar, { x: 1.1, y: 5.5, rx: -0.15 }),
      P(box(3.6, 2.5, 2), mar, { y: 9.8 }), P(cyl(1.6, 1.2, 4.5, 8), mar, { y: 12.5 }), P(box(5.2, 1.2, 2), mar2, { y: 14.6 }),
      P(sph(1.25, 10, 8), mar, { y: 16.4 }), P(cone(1.3, 1.8, 8), '#c9a24a', { y: 17.8 }), P(box(0.3, 1.6, 2.6), '#b0283a', { y: 18.4 }),
      P(cyl(0.45, 0.4, 5, 8), mar, { x: -3, y: 14, rz: -0.25 }), P(cyl(0.45, 0.4, 5, 8), mar, { x: 3.3, y: 16.3, rz: 2.7 }),
      P(cyl(0.12, 0.12, 16, 6), '#c9a24a', { x: 4.2, y: 15, z: 0.3 }), P(cone(0.45, 1.8, 6), '#e8c86a', { x: 4.2, y: 23.8, z: 0.3 }),
      P(box(4, 3, 0.4), '#c9a24a', { x: -3.6, y: 11.2, z: 0.6, rz: -0.2 }), P(cyl(1.7, 1.7, 0.3, 14), '#d8b25a', { x: -3.9, y: 11.4, z: 0.9, rx: Math.PI / 2, rz: -0.2 }));
    const tim = new THREE.Mesh(tg, stdMat); tim.castShadow = tim.receiveShadow = true; titan.add(tim);
    const eyes = new THREE.Mesh(M(P(sph(0.16, 6, 4), '#fff', { x: -0.45, y: 16.6, z: 1.1 }), P(sph(0.16, 6, 4), '#fff', { x: 0.45, y: 16.6, z: 1.1 })), glowMat('#ffd27a', 4)); titan.add(eyes);
    this.platforms.push({ x: TT.x, z: TT.z, r: 3.6, h: tth + 2.5 });
    this.addCollider(TT.x, TT.z, 2.2);

    // ---- Adventure realm: plateau, arch, floating islands ----
    const AR = S('arch'), arh = AR.h, aa = SECTOR[3] + 0.3;
    const arch = new THREE.Group(); arch.position.set(AR.x, arh, AR.z); arch.rotation.y = -aa; this.scene.add(arch);
    const ag = [P(dod(1.6), '#7d8796', { x: -4, y: 1.5, sy: 1.2 }), P(dod(1.6), '#7d8796', { x: 4, y: 1.5, sy: 1.2 })];
    for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI; ag.push(P(dod(1.2), i % 2 ? '#8a94a3' : '#737d8c', { x: -Math.cos(a) * 4, y: 2 + Math.sin(a) * 6, s: 1 - Math.sin(a) * 0.2 })); }
    const am = new THREE.Mesh(M(ag), stdMat); am.castShadow = true; arch.add(am);
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(oct(0.4), glowMat('#56eaff', 2)); const a = i / 5 * Math.PI; c.position.set(-Math.cos(a) * 4, 2 + Math.sin(a) * 6 + 1, 0.8); c.scale.y = 2; arch.add(c); }
    const atq = new THREE.Vector3(); for (const sx of [-4, 4]) { atq.set(sx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -aa); this.addCollider(AR.x + atq.x, AR.z + atq.z, 1.7); }
    this.floaters = [];
    for (let i = 0; i < 5; i++) {
      const p = polar(110 + i * 22, SECTOR[3] - 0.5 + i * 0.25), y = 38 + i * 7 + this.rng() * 8, s = 3 + this.rng() * 4;
      const g = M(P(cone(s, s * 2.2, 8), '#6f6656', { y: -s * 1.1, rx: Math.PI }), P(cyl(s, s * 0.95, 0.8, 8), '#5ea04a', { y: 0.2 }),
        P(cone(0.9, 2, 6), '#2d6e45', { x: s * 0.3, y: 1.8 }), P(cone(0.7, 1.6, 6), '#357a4d', { x: -s * 0.4, y: 1.4, z: s * 0.2 }));
      const fm = this.addMesh(g, stdMat, { shadow: false }); fm.position.set(p.x, y, p.z);
      const cr = new THREE.Mesh(oct(0.6), glowMat('#56eaff', 2)); cr.position.y = -s * 2.4; cr.scale.y = 2; fm.add(cr);
      const by = y, ph = this.rng() * 6;
      this.animated.push(t => { fm.position.y = by + Math.sin(t * 0.4 + ph) * 1.5; fm.rotation.y = t * 0.03 + ph; });
    }
    // plateau shrine rim crystals
    const S3 = S('s3');
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, x = S3.x + Math.cos(a) * 9, z = S3.z + Math.sin(a) * 9, y = terrainHeight(x, z); const c = this.addMesh(oct(0.8), glowMat('#56eaff', 1.6), { shadow: false }); c.position.set(x, y + 1.6, z); c.scale.set(1, 2.6, 1); c.rotation.z = 0.15; this.addCollider(x, z, 0.8); }

    // ---- Dark realm: castle ----
    const CS = S('castle'), ch = CS.h, ca = SECTOR[4];
    const castle = new THREE.Group(); castle.position.set(CS.x, ch, CS.z); castle.rotation.y = -ca + Math.PI / 2; this.scene.add(castle);
    const st = '#2c2533', st2 = '#221c28', roof = '#14101a';
    const cg = [P(box(26, 10, 3), st, { y: 5, z: -6 }), P(box(3, 9, 14), st2, { x: -12, y: 4.5, z: 0 }), P(box(3, 7, 10), st2, { x: 12, y: 3.5, z: -1, rz: 0.06 }),
      P(box(10, 16, 8), st, { y: 8, z: -9 }), P(cone(6.5, 9, 4), roof, { y: 20.5, z: -9, ry: Math.PI / 4 })];
    for (const [tx, tz, tH] of [[-13, -7, 20], [13, -7, 17], [-13, 6, 14], [6, -12, 26]]) cg.push(P(cyl(2.4, 2.8, tH, 8), st, { x: tx, z: tz, y: tH / 2 }), P(cone(3.2, 7, 8), roof, { x: tx, z: tz, y: tH + 3.5 }));
    for (let i = 0; i < 9; i++) cg.push(P(box(1.2, 1.4, 1.2), st, { x: -12 + i * 3, y: 10.7, z: -6 }));
    const cmesh = new THREE.Mesh(M(cg), stdMat); cmesh.castShadow = cmesh.receiveShadow = true; castle.add(cmesh);
    const win = [];
    for (const [wx, wy, wz] of [[-13, 12, -4.5], [13, 10, -4.5], [6, 18, -9.4], [6, 22, -9.4], [-3, 10, -4.9], [3, 10, -4.9], [0, 13, -4.9], [-13, 9, 8.5]]) win.push(P(box(0.9, 1.6, 0.3), '#fff', { x: wx, y: wy, z: wz }));
    castle.add(new THREE.Mesh(M(win), glowMat('#ff3a2a', 3.5)));
    const cq = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = -12; i <= 12; i += 3) { cq.set(i, 0, -6).applyAxisAngle(up, castle.rotation.y); this.addCollider(CS.x + cq.x, CS.z + cq.z, 2); }
    for (const [tx, tz, r] of [[-13, -7, 3], [13, -7, 3], [-13, 6, 3], [6, -12, 3], [0, -9, 5], [-12, 0, 2], [-12, 4, 2], [12, -1, 2], [12, 3, 2]]) { cq.set(tx, 0, tz).applyAxisAngle(up, castle.rotation.y); this.addCollider(CS.x + cq.x, CS.z + cq.z, r); }
    // arena ring of obelisks
    const S4 = S('s4');
    this.arena = new THREE.Vector3(S4.x, S4.h, S4.z);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2, x = S4.x + Math.cos(a) * 26, z = S4.z + Math.sin(a) * 26;
      this.addMesh(M(P(box(1.4, 6, 1.4), '#2a2230', { x, z, y: S4.h + 3, ry: a }), P(cone(1, 1.5, 4), '#1a141e', { x, z, y: S4.h + 6.75, ry: a + Math.PI / 4 })));
      const rune = this.addMesh(box(0.5, 1.4, 0.1), glowMat('#b05cff', 3), { shadow: false }); rune.position.set(x - Math.cos(a) * 0.72, S4.h + 3.6, z - Math.sin(a) * 0.72); rune.rotation.y = -a + Math.PI / 2;
      this.addCollider(x, z, 1);
    }
    this.addMesh(M(P(cyl(18, 18, 0.3, 40), '#2a2026', { x: S4.x, z: S4.z, y: S4.h + 0.05 }), P(new THREE.TorusGeometry(16, 0.25, 4, 60), '#000', { x: S4.x, z: S4.z, y: S4.h + 0.25, rx: Math.PI / 2 })), stdMat, { shadow: false });
    const sigil = this.addMesh(new THREE.TorusGeometry(16, 0.18, 4, 60), glowMat('#b05cff', 2.2), { shadow: false }); sigil.position.set(S4.x, S4.h + 0.3, S4.z); sigil.rotation.x = Math.PI / 2;
    // barrier dome
    this.barrierU = { uTime: { value: 0 }, uOpen: { value: 0 } };
    const bm = new THREE.ShaderMaterial({
      uniforms: this.barrierU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime,uOpen; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.-abs(dot(vN,vV)), 3.5);
          float hex = abs(sin(vP.x*0.8+uTime)*sin(vP.y*0.8-uTime*0.7)*sin(vP.z*0.8+uTime*0.5));
          float a = (f*0.9 + smoothstep(0.85,1.,hex)*0.35) * (1.-uOpen);
          float diss = step(uOpen*1.2, fract(sin(dot(floor(vP*1.5),vec3(12.9,78.2,37.7)))*43758.5));
          gl_FragColor = vec4(vec3(0.6,0.25,1.2)*a*diss*0.45, 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.barrier = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), bm); this.barrier.position.copy(this.arena); this.barrier.renderOrder = 5;
    this.scene.add(this.barrier);
    this.barrierOpen = false;
    // lava glow embers in dark realm
    this.emitters.push({ x: CS.x, y: ch + 24, z: CS.z, color: '#ff3a2a', rate: 4, spread: 10, up: 1, life: 3, size: 0.8 });

    // ---- shrines & shards ----
    this.shards = [];
    const sc = ['#ff7ad9', '#ffc04a', '#5ff0ff', '#b05cff'];
    for (let i = 1; i <= 4; i++) {
      const sp = i === 2 ? { x: T2.x, z: T2.z, h: th + 1.8 } : i === 4 ? { x: S4.x, z: S4.z, h: S4.h } : S('s' + i);
      const y = sp.h;
      if (i !== 2 && i !== 4) {
        this.addMesh(M(P(cyl(3, 3.4, 0.6, 14), '#d9d2c0', { x: sp.x, z: sp.z, y: y + 0.3 }), P(cyl(1, 1.2, 1.6, 10), '#e8e2d2', { x: sp.x, z: sp.z, y: y + 1.4 })));
        this.platforms.push({ x: sp.x, z: sp.z, r: 3.3, h: y + 0.6 });
        this.addCollider(sp.x, sp.z, 1.2);
        const rr = this.addMesh(new THREE.TorusGeometry(2.6, 0.08, 4, 40), glowMat(sc[i - 1], 3), { shadow: false }); rr.position.set(sp.x, y + 0.65, sp.z); rr.rotation.x = Math.PI / 2;
      }
      const g = new THREE.Group(); g.position.set(sp.x, y + 3.4, sp.z); this.scene.add(g);
      const gem = new THREE.Mesh(oct(0.7), glowMat(sc[i - 1], 3)); gem.scale.set(0.8, 1.5, 0.8); g.add(gem);
      const gem2 = new THREE.Mesh(oct(0.95), new THREE.MeshBasicMaterial({ color: sc[i - 1], wireframe: true, transparent: true, opacity: 0.5 })); gem2.scale.set(0.8, 1.5, 0.8); g.add(gem2);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 16), new THREE.MeshBasicMaterial({ color: sc[i - 1], transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.add(shield);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 160, 12, 1, true), new THREE.MeshBasicMaterial({ color: sc[i - 1], transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
      beam.position.y = 78; g.add(beam);
      if (i === 4) g.visible = false;
      this.shards.push({ realm: i, group: g, gem, gem2, shield, beam, color: sc[i - 1], collected: false, guarded: true, pos: new THREE.Vector3(sp.x, y + 1, sp.z) });
    }
  }

  buildPaths() {
    const stones = [], lan = [], lanGlow = [];
    const rnd = this.rng;
    for (let i = 1; i <= 4; i++) {
      const a0 = SECTOR[i];
      for (let r = 14; r < 138; r += 2.2) {
        const wob = Math.sin(r * 0.05 + i) * 0.12;
        const a = a0 + wob, x = Math.cos(a) * r + (rnd() - 0.5) * 1.2, z = Math.sin(a) * r + (rnd() - 0.5) * 1.2;
        const h = terrainHeight(x, z); if (h < 0.5) continue;
        const col = ['#cfc6b0', '#c9a6d8', '#e5d9b8', '#a9b2bf', '#4a404f'][r < 60 ? 0 : i];
        stones.push(P(cyl(0.7 + rnd() * 0.4, 0.8 + rnd() * 0.4, 0.25, 6), col, { x, z, y: h + 0.05, ry: rnd() * 3 }));
        if (Math.round(r / 2.2) % 11 === 5) {
          const nx = -Math.sin(a) * 2.6, nz = Math.cos(a) * 2.6, lx = x + nx, lz = z + nz, lh = terrainHeight(lx, lz);
          lan.push(P(cyl(0.08, 0.12, 2.6, 6), '#3a3038', { x: lx, z: lz, y: lh + 1.3 }), P(box(0.5, 0.1, 0.5), '#3a3038', { x: lx, z: lz, y: lh + 2.65 }), P(cone(0.4, 0.4, 4), '#3a3038', { x: lx, z: lz, y: lh + 3.25, ry: Math.PI / 4 }));
          lanGlow.push(P(box(0.3, 0.4, 0.3), '#fff', { x: lx, z: lz, y: lh + 2.9 }));
          this.addCollider(lx, lz, 0.25);
          if (rnd() < 0.5) this.emitters.push({ x: lx, y: lh + 2.9, z: lz, color: i === 4 && r > 60 ? '#b05cff' : '#ffd27a', rate: 1.2, spread: 0.6, up: 0.4, life: 2, size: 0.35 });
        }
      }
    }
    this.addMesh(M(stones), stdMat, { shadow: false });
    this.addMesh(M(lan), stdMat);
    this.addMesh(M(lanGlow), glowMat('#ffcf6a', 3), { shadow: false });
  }

  scatterProps() {
    const D = propDefs(), lists = {}; for (const k in D) lists[k] = [];
    const rnd = this.rng, w = [0, 0, 0, 0, 0];
    const occ = new Set();
    const N = Math.floor(11000 * this.Q.props);
    for (let n = 0; n < N; n++) {
      const r = Math.sqrt(rnd()) * (ISLAND_R - 10), a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z); if (h < 1.0) continue;
      let near = false;
      for (const s of SPOTS) { const dx = x - s.x, dz = z - s.z; if (dx * dx + dz * dz < (s.r * 0.75) ** 2) { near = true; break; } }
      if (near) continue;
      // path clearance
      const pa = Math.atan2(z, x); let onPath = false;
      for (let i = 1; i <= 4; i++) { let d = Math.abs(((pa - SECTOR[i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d * r < 3.5 && r < 140) onPath = true; }
      if (onPath) continue;
      const cell = Math.floor(x / 2.6) * 100000 + Math.floor(z / 2.6); if (occ.has(cell)) continue;
      biomeWeights(x, z, w);
      let pick = rnd(), b = 0; for (; b < 4; b++) { pick -= w[b]; if (pick <= 0) break; }
      const dens = [0.55, 0.75, 0.5, 0.6, 0.55][b]; if (rnd() > dens) continue;
      const tab = TABLE[b]; let tot = 0; for (const e of tab) tot += e[1];
      let q = rnd() * tot, e = tab[0]; for (const t of tab) { q -= t[1]; if (q <= 0) { e = t; break; } }
      let key = e[0];
      if (key === 'pine' && h > 18) key = 'pineSnow';
      const s = e[2] + rnd() * (e[3] - e[2]);
      lists[key].push({ x, y: h - 0.1, z, s, ry: rnd() * Math.PI * 2, tint: 0.85 + rnd() * 0.3 });
      occ.add(cell);
      if (D[key].r) this.addCollider(x, z, D[key].r * s);
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (const k in lists) {
      const L = lists[k]; if (!L.length) continue;
      for (const part of D[k].parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat || stdMat, L.length);
        L.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, col.setScalar(it.tint)); });
        im.castShadow = D[k].shadow !== false; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
      }
    }
  }

  buildGrass() {
    const N = this.Q.grass; if (!N) return;
    const blades = [];
    const rnd = mulberry32(5);
    for (let b = 0; b < 5; b++) {
      const w = 0.07, h = 0.5 + rnd() * 0.5, g = new THREE.BufferGeometry();
      const v = [-w, 0, 0, w, 0, 0, -w * 0.7, h / 3, 0, w * 0.7, h / 3, 0, -w * 0.4, h * 2 / 3, 0, w * 0.4, h * 2 / 3, 0, 0, h, 0];
      const lean = (rnd() - 0.5) * 0.3;
      for (let i = 0; i < 7; i++) v[i * 3 + 2] += lean * (v[i * 3 + 1] / h) ** 2;
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      const c = []; for (let i = 0; i < 7; i++) { const t = v[i * 3 + 1] / h; c.push(0.35 + t * 0.75, 0.45 + t * 0.65, 0.3 + t * 0.4); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(21).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
      g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
      const ry = rnd() * Math.PI, ox = (rnd() - 0.5) * 0.5, oz = (rnd() - 0.5) * 0.5;
      g.rotateY(ry); g.translate(ox, 0, oz); blades.push(g);
    }
    const geo = mergeGeometries(blades);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.grassU = { value: 0 };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.grassU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 gw = instanceMatrix * vec4(0.,0.,0.,1.);
        float hh = position.y;
        float wv = sin(uTime*1.8 + gw.x*0.25 + gw.z*0.18)*0.22 + sin(uTime*3.3 + gw.x*0.8)*0.06;
        transformed.x += wv*hh*hh; transformed.z += wv*0.6*hh*hh;`);
    };
    const im = new THREE.InstancedMesh(geo, mat, N);
    const dummy = new THREE.Object3D(), w = [0, 0, 0, 0, 0], col = new THREE.Color();
    const GC = [new THREE.Color('#7fd04e'), new THREE.Color('#58c0a0'), new THREE.Color('#d8c870'), new THREE.Color('#6fae58'), new THREE.Color('#5a4a5a')];
    let n = 0, tries = 0;
    while (n < N && tries < N * 6) {
      tries++;
      const r = Math.sqrt(rnd()) * (ISLAND_R - 20), a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      biomeWeights(x, z, w);
      const keep = w[0] * 1 + w[1] * 0.9 + w[2] * 0.45 + w[3] * 0.6 + w[4] * 0.08;
      if (rnd() > keep) continue;
      const h = terrainHeight(x, z); if (h < 1.1 || (w[3] > 0.5 && h > 20)) continue;
      if (Math.hypot(x, z) < 12.5) continue;
      dummy.position.set(x, h - 0.05, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.setScalar(0.8 + rnd() * 0.9); dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix);
      col.setRGB(0, 0, 0); for (let b = 0; b < 5; b++) { col.r += GC[b].r * w[b]; col.g += GC[b].g * w[b]; col.b += GC[b].b * w[b]; }
      im.setColorAt(n, col.multiplyScalar(0.85 + rnd() * 0.3));
      n++;
    }
    im.count = n; im.receiveShadow = true; im.computeBoundingSphere();
    this.scene.add(im); this.grass = im;
  }

  buildClouds() {
    const parts = [], rnd = this.rng;
    for (let c = 0; c < 26; c++) {
      const a = rnd() * Math.PI * 2, r = 60 + rnd() * 330, x = Math.cos(a) * r, z = Math.sin(a) * r, y = 75 + rnd() * 45, s = 5 + rnd() * 6;
      for (let k = 0; k < 6; k++) parts.push(P(ico(s * (0.6 + rnd() * 0.6), 1), '#ffffff', { x: x + (rnd() - 0.5) * s * 3, y: y + (rnd() - 0.3) * s * 0.6, z: z + (rnd() - 0.5) * s * 1.6, sy: 0.6 }));
    }
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92, emissive: new THREE.Color('#555') , flatShading: true });
    this.clouds = new THREE.Mesh(M(parts), this.cloudMat); this.scene.add(this.clouds);
  }

  buildMinimap() {
    const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), w = [0, 0, 0, 0, 0];
    const MC = [[124, 196, 87], [178, 110, 210], [222, 196, 120], [110, 180, 220], [90, 40, 70]];
    const R = ISLAND_R + 10;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i / S * 2 - 1) * R, z = (j / S * 2 - 1) * R, h = terrainHeight(x, z), k = (j * S + i) * 4;
      if (h < 0.3) { img.data[k] = 30; img.data[k + 1] = 70; img.data[k + 2] = 110; img.data[k + 3] = 200; continue; }
      biomeWeights(x, z, w); let r = 0, g = 0, b = 0; for (let q = 0; q < 5; q++) { r += MC[q][0] * w[q]; g += MC[q][1] * w[q]; b += MC[q][2] * w[q]; }
      const sh = 0.75 + Math.min(h, 30) / 60;
      img.data[k] = r * sh; img.data[k + 1] = g * sh; img.data[k + 2] = b * sh; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.minimap = c; this.minimapR = R;
  }

  // ---- per-frame ----
  update(dt, t, camera, player) {
    this.time = t;
    const w = biomeWeights(player.x, player.z, [0, 0, 0, 0, 0]);
    const k = Math.min(1, dt * 1.2);
    for (let i = 0; i < 5; i++) this.cur[i] += (w[i] - this.cur[i]) * k;
    // dark palette heals after victory
    const dp = this.pal[4], hp = this.healedPal, hk = this.healed;
    const B = this.blend;
    for (const key of ['top', 'bot', 'fog', 'sun', 'hs', 'hg', 'part', 'cloud', 'disc']) {
      B[key].setRGB(0, 0, 0);
      for (let i = 0; i < 5; i++) {
        const c = this.cur[i]; if (c < 0.0005) continue;
        let src = this.pal[i][key];
        if (i === 4 && hk > 0) { _tmpC.copy(dp[key]).lerp(hp[key], hk); src = _tmpC; }
        B[key].r += src.r * c; B[key].g += src.g * c; B[key].b += src.b * c;
      }
    }
    for (const key of ['den', 'sunI', 'hI', 'stars']) {
      let v = 0; for (let i = 0; i < 5; i++) { let s = this.pal[i][key]; if (i === 4) s = s + (hp[key] - s) * hk; v += s * this.cur[i]; } B[key] = v;
    }
    this.scene.fog.color.copy(B.fog); this.scene.fog.density = B.den;
    this.skyU.uTop.value.copy(B.top); this.skyU.uBot.value.copy(B.bot); this.skyU.uSun.value.copy(B.disc); this.skyU.uStars.value = B.stars; this.skyU.uTime.value = t;
    this.sky.position.copy(camera.position);
    this.sun.color.copy(B.sun); this.sun.intensity = B.sunI;
    this.hemi.color.copy(B.hs); this.hemi.groundColor.copy(B.hg); this.hemi.intensity = B.hI;
    // shadow follows player (texel snapped)
    const snap = 96 / (this.Q.shadows || 1024);
    const px = Math.round(player.x / snap) * snap, pz = Math.round(player.z / snap) * snap;
    this.sun.target.position.set(px, player.y, pz);
    this.sun.position.set(px + this.sunDir.x * 100, player.y + this.sunDir.y * 100, pz + this.sunDir.z * 100);
    const wu = this.waterU; wu.uTime.value = t; wu.uSun.value.copy(B.disc); wu.uSky.value.copy(B.top).lerp(B.bot, 0.5); wu.uFog.value.copy(B.fog); wu.uFogDen.value = B.den; wu.uCurse.value = 1 - hk;
    this.water.position.x = Math.round(camera.position.x / 20) * 20; this.water.position.z = Math.round(camera.position.z / 20) * 20;
    if (this.grassU) this.grassU.value = t;
    this.cloudMat.color.copy(B.cloud); this.cloudMat.emissive.copy(B.cloud).multiplyScalar(0.45);
    this.clouds.rotation.y = t * 0.004;
    this.barrierU.uTime.value = t;
    if (this.barrierOpen && this.barrierU.uOpen.value < 1) { this.barrierU.uOpen.value = Math.min(1, this.barrierU.uOpen.value + dt * 0.4); if (this.barrierU.uOpen.value >= 1) this.barrier.visible = false; }
    for (const s of this.shards) {
      if (s.collected) continue;
      s.gem.rotation.y = t * 1.5; s.gem2.rotation.y = -t * 0.8; s.gem2.rotation.x = Math.sin(t) * 0.3;
      s.group.position.y = s.pos.y + 2.4 + Math.sin(t * 2 + s.realm) * 0.3;
      s.shield.visible = s.guarded; s.shield.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
      s.beam.material.opacity = 0.16 + Math.sin(t * 2 + s.realm) * 0.05;
    }
    this.heart.rotation.y = t * 0.6; this.heartRing.rotation.x = Math.PI / 2 + Math.sin(t) * 0.4; this.heartRing.rotation.y = t;
    this.heartPieces.forEach((p, i) => { const a = t * 1.2 + i * Math.PI / 2; p.position.set(Math.cos(a) * 1.2, Math.sin(t * 2 + i) * 0.2, Math.sin(a) * 1.2); p.rotation.y = t * 2; });
    for (const f of this.animated) f(t);
  }
}
const _tmpC = new THREE.Color();
