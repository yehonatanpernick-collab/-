// ============================================================================
//  RAKIA — flight simulator. Core: imports, math utils, noise, world height
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const KT = 1.943844, FT = 3.28084, FPM = 196.8504;
const G0 = 9.81;
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Seeded PRNG
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- Simplex 2D
const Noise = (() => {
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  const r = mulberry32(90210); const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  const g = [1,1,-1,1,1,-1,-1,-1,1,0,-1,0,1,0,-1,0,0,1,0,-1,0,1,0,-1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function s2(xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const gi = permMod12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const gi = permMod12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const gi = permMod12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2 = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  }
  function fbm(x, y, oct) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += a * s2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function ridged(x, y, oct) { let a = 0.5, f = 1, s = 0, w = 1; for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(s2(x * f + i * 17.3, y * f - i * 9.1)); v *= v; v *= w; w = clamp(v * 1.6, 0, 1); s += v * a; a *= 0.52; f *= 2.1; } return s; }
  return { s2, fbm, ridged };
})();

// ---------------------------------------------------------------- World layout
// Axes: +X east, -Z north, +Y up. Units meters. Ocean to the west, mountains north & east.
const WORLD = {
  carrier: { x: -15500, z: 4200, heading: 0, deck: 19.5, len: 326, wid: 40 },
  city: { x: 6200, z: 1800, r: 3600 },
};
const AIRPORTS = [
  { id: 'TZK', name: 'צוק הים הבינלאומי', x: 0, z: 0, hdg: 0, len: 3400, wid: 60, main: true },
  { id: 'HRM', name: 'שדה הרים', x: 9200, z: -15200, hdg: 32, len: 1150, wid: 26 },
  { id: 'ALM', name: 'אי אלמוג', x: -11800, z: -9400, hdg: 300, len: 1700, wid: 34 },
];

function rawHeight(x, z) {
  const n1 = Noise.fbm(x * 0.00011 + 3.1, z * 0.00011 - 7.7, 4);
  const coast = x + n1 * 3800 + Noise.s2(x * 0.00045, z * 0.00045) * 700;
  const land = smoothstep(-7500, -4200, coast);
  const hills = Noise.fbm(x * 0.00055 + 11, z * 0.00055 + 5, 5) * 0.5 + 0.5;
  let h = 18 + hills * hills * 240 + Noise.s2(x * 0.004, z * 0.004) * 4;
  // northern and eastern ranges
  const mN = smoothstep(-5500, -16000, z + n1 * 4500);
  const mE = smoothstep(11000, 22000, x + n1 * 4000);
  const mMask = Math.max(mN, mE * 0.85);
  if (mMask > 0.001) {
    const rd = Noise.ridged(x * 0.0002, z * 0.0002, 6);
    const broad = Noise.fbm(x * 0.00008 + 9, z * 0.00008 - 2, 3) * 0.5 + 0.5;
    h += (Math.pow(rd, 1.7) * 2600 * (0.55 + broad * 0.6) + rd * 380 + broad * 500) * mMask;
  }
  // gentle river valley carving through the plain
  const rv = Math.abs(Noise.fbm(x * 0.00018 - 40, z * 0.00018 + 21, 3));
  h -= smoothstep(0.08, 0.0, rv) * 60 * (1 - mMask) * land;
  // sea floor and islands
  const isl = Noise.fbm(x * 0.00032 + 70, z * 0.00032 - 31, 4);
  const islandH = (smoothstep(0.28, 0.55, isl)) * (120 + Noise.ridged(x * 0.0008, z * 0.0008, 4) * 380) - 70;
  const sea = -60 - smoothstep(-7000, -20000, coast) * 140 + Noise.s2(x * 0.001, z * 0.001) * 10;
  const seaSide = Math.max(sea, islandH);
  h = lerp(seaSide, h, land);
  return h;
}

// Flattened pads (runways, aprons, city)
for (const ap of AIRPORTS) {
  ap.dirX = Math.sin(ap.hdg * DEG); ap.dirZ = -Math.cos(ap.hdg * DEG);
  let e = rawHeight(ap.x, ap.z);
  ap.elev = Math.max(e, 12);
  ap.padHalfW = ap.wid / 2 + (ap.main ? 420 : 160);
  ap.padHalfL = ap.len / 2 + (ap.main ? 500 : 260);
}
AIRPORTS[0].elev = 34; // main field at sea-side plateau
const PADS = AIRPORTS.map(a => ({ x: a.x, z: a.z, dx: a.dirX, dz: a.dirZ, hw: a.padHalfW, hl: a.padHalfL, elev: a.elev, blend: a.main ? 900 : 650, off: a.main ? 250 : 0 }));

function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const rx = x - p.x, rz = z - p.z;
    const along = rx * p.dx + rz * p.dz;
    const across = rx * -p.dz + rz * p.dx - p.off; // apron offset to the east side
    const ex = Math.max(Math.abs(across) - p.hw, 0);
    const ez = Math.max(Math.abs(along) - p.hl, 0);
    const d = Math.hypot(ex, ez);
    if (d < p.blend) { const t = smoothstep(p.blend, 0, d); h = lerp(h, p.elev, t); }
  }
  return h;
}

// Carrier deck collision rectangle in world
function carrierLocal(x, z) { const c = WORLD.carrier; return { lx: x - c.x, lz: z - c.z }; }
function onCarrierDeck(x, z) { const { lx, lz } = carrierLocal(x, z); const c = WORLD.carrier; return Math.abs(lz) < c.len / 2 && Math.abs(lx + 2) < c.wid / 2; }

// Height of whatever solid surface is under (x,z): terrain, carrier deck, or sea (returns {h, water})
function groundAt(x, z) {
  if (onCarrierDeck(x, z)) return { h: WORLD.carrier.deck, water: false, deck: true };
  const t = terrainHeight(x, z);
  if (t < 0) return { h: 0, water: true, deck: false };
  return { h: t, water: false, deck: false };
}
