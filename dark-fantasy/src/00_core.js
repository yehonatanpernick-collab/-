import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =====================================================================
// Core helpers
// =====================================================================
const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3, V2 = THREE.Vector2;
const UP = new V3(0, 1, 0), ONE = new V3(1, 1, 1);
const TAU = Math.PI * 2;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(1871);
const R = (a, b) => a + rand() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) { let f = 0, a = 0.5; for (let i = 0; i < oct; i++) { f += a * vnoise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 3.7; a *= 0.5; } return f; }

// =====================================================================
// Quality profile
// =====================================================================
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
const LOW = IS_TOUCH || Math.min(screen.width, screen.height) < 700;
const Q = {
  pr: LOW ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 1.75),
  shadow: LOW ? 1024 : 4096, grass: LOW ? 9000 : 30000, msaa: LOW ? 0 : 4, rays: LOW ? 12 : 30,
  bricks: LOW ? 0.6 : 1,
};
if (IS_TOUCH) document.body.classList.add('touch');

// =====================================================================
// Procedural textures
// =====================================================================
function tileNoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function tileFbm(x, y, period, oct = 4) { let f = 0, a = 0.5, p = period; for (let i = 0; i < oct; i++) { f += a * tileNoise(x, y, p); x *= 2; y *= 2; p *= 2; a *= 0.5; } return f; }
function worleyT(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y); let md = 9, md2 = 9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
    const d = Math.hypot(x - (cx + hash2(wx, wy * 1.7 + 3)), y - (cy + hash2(wx * 2.3 + 1, wy)));
    if (d < md) { md2 = md; md = d; } else if (d < md2) md2 = d;
  }
  return [md, md2];
}
function genArray(size, fn) { const a = new Float32Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) a[y * size + x] = fn(x, y); return a; }
function canvasTex(c, srgb) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; }
function texFromArray(size, arr, srgb, map = (v) => [v, v, v]) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = map(arr[i], i); img.data[i * 4] = clamp(v[0], 0, 1) * 255; img.data[i * 4 + 1] = clamp(v[1], 0, 1) * 255; img.data[i * 4 + 2] = clamp(v[2], 0, 1) * 255; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0); return canvasTex(c, srgb);
}
function normalFromArray(size, h, strength) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + (x - 1 + size) % size], r = h[y * size + (x + 1) % size];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1; const len = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4; img.data[i] = (nx / len * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return canvasTex(c, false);
}
const withRepeat = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

// --- ground: soil, pebbles, roots ---
const GS = LOW ? 256 : 512, gk = GS / 512;
const groundArr = genArray(GS, (x, y) => {
  x /= gk; y /= gk;
  const [w1, w2] = worleyT(x / 16, y / 16, 32);
  const pebble = ss(0.45, 0.1, w1) * (tileNoise(x / 32, y / 32, 16) > 0.42 ? 1 : 0.3);
  const crack = ss(0.06, 0.0, w2 - w1) * 0.25;
  return 0.42 * tileFbm(x / 64, y / 64, 8, 3) + 0.14 * tileNoise(x / 4, y / 4, 128) + 0.38 * pebble - crack;
});
const groundTex = texFromArray(GS, groundArr, true, (v) => { const k = 0.5 + v * 0.6 + (Math.random() - 0.5) * 0.05; return [k, k * 0.97, k * 0.93]; });
const groundN = normalFromArray(GS, groundArr, 8);

// --- masonry ---
const S = 256;
const stoneArr = genArray(S, (x, y) => 0.4 * tileFbm(x / 32, y / 32, 8, 4) + 0.18 * tileFbm(x / 8, y / 8, 32, 3) + 0.1 * tileNoise(x / 2, y / 2, S / 2)
  - 0.12 * ss(0.06, 0.0, Math.abs(tileFbm(x / 64, y / 64, 4, 3) - 0.5)));
const stoneTex = texFromArray(S, stoneArr, true, (v) => { const k = 0.42 + v * 0.6; return [k, k * 0.97, k * 0.93]; });
const stoneN = normalFromArray(S, stoneArr, 6);

// --- bark ---
const barkArr = genArray(S, (x, y) => 0.6 * tileNoise(x / 4, y / 32, S / 4) + 0.3 * tileNoise(x / 2, y / 12, S / 2) + 0.1 * tileNoise(x / 16, y / 16, S / 16));
const barkTex = texFromArray(S, barkArr, true, (v) => { const k = 0.25 + v * 0.7; return [k, k * 0.92, k * 0.85]; });
const barkN = normalFromArray(S, barkArr, 10);

// --- worn metal grime & scratches ---
const grimeArr = genArray(S, (x, y) => tileFbm(x / 32, y / 32, 8, 4));
const grimeTex = texFromArray(S, grimeArr, true, (v, i) => { const sc = ((i * 7919) % 97 < 2) ? 0.25 : 0; const k = 0.55 + v * 0.5 + sc; return [k, k, k]; });
const scratchTex = texFromArray(S, grimeArr, false, (v, i) => { const sc = ((i * 7919) % 89 < 3) ? -0.3 : 0; const k = 0.35 + v * 0.45 + sc; return [k, k, k]; });

// --- chainmail rings ---
const chainArr = genArray(128, (x, y) => {
  let h = 0; const p = 8;
  for (let ry = -1; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++) {
    const row = Math.floor(y / p) + ry, off = (((row % 2) + 2) % 2) * p / 2;
    const cx = (Math.floor((x - off) / p) + rx) * p + off + p / 2, cy = row * p + p / 2;
    const d = Math.hypot(x - cx, (y - cy) * 1.15); h = Math.max(h, 1 - Math.abs(d - 4.2) / 1.6);
  }
  return Math.max(0, h);
});
const chainN = normalFromArray(128, chainArr, 2.4);
const chainTex = texFromArray(128, chainArr, true, (v) => { const k = 0.2 + v * 0.8; return [k, k, k]; });

// --- cloth weave + dirt ---
const clothArr = genArray(S, (x, y) => 0.5 + 0.18 * Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) + 0.3 * (tileFbm(x / 32, y / 32, 8, 4) - 0.5));
const clothTex = texFromArray(S, clothArr, true, (v) => { const k = 0.45 + v * 0.6; return [k, k * 0.97, k * 0.92]; });
const clothN = normalFromArray(S, clothArr, 1.5);

// --- fur ---
const furArr = genArray(S, (x, y) => tileNoise(x / 1.5, y / 14, S / 1.5 | 0) * 0.7 + tileNoise(x / 6, y / 30, S / 6 | 0) * 0.3);
const furN = normalFromArray(S, furArr, 12);
const furTex = texFromArray(S, furArr, true, (v) => { const k = 0.3 + v * 0.8; return [k, k * 0.9, k * 0.8]; });

// --- bone ---
const boneTex = texFromArray(S, stoneArr, true, (v) => { const k = 0.62 + v * 0.45; return [k, k * 0.95, k * 0.84]; });

// --- tattered alpha (for cloaks / robes) ---
function tatterAlpha(w, h, edge = 0.78, holes = 26, seed = 1) {
  const r = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#000';
  // jagged bottom
  x.beginPath(); x.moveTo(0, h);
  for (let i = 0; i <= 40; i++) { const px = i / 40 * w; const py = h * edge + (r() * r()) * h * (1 - edge) * 0.9 + Math.sin(i * 1.7) * h * 0.02; x.lineTo(px, i % 2 ? py : py + h * 0.08 * r()); }
  x.lineTo(w, h); x.closePath(); x.fill();
  for (let i = 0; i < holes; i++) { const py = h * (0.45 + r() * 0.45), px = r() * w; x.beginPath(); x.ellipse(px, py, 2 + r() * w * 0.035, 3 + r() * h * 0.03, r() * 3, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
