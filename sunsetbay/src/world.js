import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, smooth, rnd, rndi, pick, sr, sri, spick, setSeed, mulberry32 } from './core.js';
import { scene, renderer, Q, MAX_ANISO } from './render.js';
import { FACADE_STYLES, makeFacadeMaterial, facadeUniforms } from './facade.js';

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb = true, rep = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = MAX_ANISO; t.needsUpdate = true; return t;
}
function speckle(g, w, h, n, cols, a0, a1, s0, s1) {
  for (let i = 0; i < n; i++) { g.globalAlpha = rnd(a0, a1); g.fillStyle = pick(cols); const s = rnd(s0, s1); g.fillRect(Math.random() * w, Math.random() * h, s, s); }
  g.globalAlpha = 1;
}
// tileable sine-sum height field, written to a canvas (grey)
function tileNoiseCanvas(w, h, waves, seed = 1) {
  const r = mulberry32(seed); const ws = [];
  for (let i = 0; i < waves; i++) ws.push({ fx: Math.floor(r() * 9) - 4 || 1, fy: Math.floor(r() * 9) - 4 || 2, ph: r() * 6.28, a: 1 / (1 + i * 0.25) });
  for (let i = 0; i < waves; i++) { const f = 2 + Math.floor(r() * 10); ws.push({ fx: f * (r() < .5 ? 1 : -1), fy: Math.floor(r() * 14) - 7, ph: r() * 6.28, a: 0.35 / (1 + i * 0.3) }); }
  const c = mkCanvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data;
  let mn = 1e9, mx = -1e9; const vals = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (const q of ws) v += q.a * Math.sin(2 * Math.PI * (q.fx * x / w + q.fy * y / h) + q.ph);
    vals[y * w + x] = v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  for (let i = 0; i < w * h; i++) { const v = (vals[i] - mn) / (mx - mn) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0); return c;
}
function normalFromHeight(hc, strength) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = mkCanvas(w, h), og = out.getContext('2d'), id = og.createImageData(w, h), d = id.data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(id, 0, 0); return toTex(out, false);
}


export const TEX = {};
const FACADES = {};
function buildCanvasTextures() {
  const S = 512;
  // soft radial sprites
  const radial = (sz, stops) => { const c = mkCanvas(sz, sz), g = c.getContext('2d'), gr = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2); stops.forEach(s => gr.addColorStop(s[0], s[1])); g.fillStyle = gr; g.fillRect(0, 0, sz, sz); return toTex(c, true, false); };
  TEX.pool = radial(128, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
  TEX.soft = radial(64, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
  {
    const c = mkCanvas(64, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
    TEX.beam = toTex(c, true, false);
  }
  {
    // headlight throw on the road: elongated soft cone
    const c = mkCanvas(64, 128), g = c.getContext('2d');
    for (let y = 0; y < 128; y++) { const t = y / 128, wdt = 10 + t * 50, a = Math.pow(1 - t, 1.4) * smooth(0, 0.12, t); const gr = g.createLinearGradient(32 - wdt / 2, 0, 32 + wdt / 2, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, y, 64, 1); }
    TEX.headThrow = toTex(c, true, false);
  }
  // palm leaf (alpha)
  {
    const c = mkCanvas(64, 256), g = c.getContext('2d');
    g.strokeStyle = '#3f5f22'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 256); g.stroke();
    for (let y = 6; y < 250; y += 5) { const l = 30 * Math.sin(Math.PI * y / 256) + 2; g.strokeStyle = pick(['#4e7a2a', '#5f8c33', '#3e6a22', '#6c9a3a']); g.lineWidth = 2.2; g.beginPath(); g.moveTo(32, y); g.lineTo(32 - l, y + 9); g.moveTo(32, y); g.lineTo(32 + l, y + 9); g.stroke(); }
    TEX.palm = toTex(c, true, false);
  }

  {
  {
    const W = S, H = Math.round(S * 5 / 16);
    const c = mkCanvas(W, H), e = mkCanvas(W, H), o = mkCanvas(W, H);
    const g = c.getContext('2d'), ge = e.getContext('2d'), go = o.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    const names = ['קפה', 'פיצה', 'מכולת', 'ספרים', 'פרחים', 'מספרה', 'בורגר', 'סושי', 'בגדים', 'פלאפל', 'גלידה', 'מאפייה', 'BAR', 'DELI', 'NAILS', 'TATTOO'];
    const signCols = ['#c0392b', '#1f6f8b', '#2d8a4e', '#8e44ad', '#d35400', '#1c1c1c', '#b8860b', '#e84393'];
    for (let s = 0; s < 2; s++) {
      const x0 = s * W / 2, sw = W / 2, signH = H * 0.2;
      g.fillStyle = '#d7d0c4'; g.fillRect(x0, 0, sw, H); go.fillStyle = 'rgb(255,230,0)'; go.fillRect(x0, 0, sw, H);
      const sc = pick(signCols); g.fillStyle = sc; g.fillRect(x0 + 6, 4, sw - 12, signH);
      const nm = pick(names); g.font = `bold ${Math.round(signH * 0.7)}px Heebo, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.fillText(nm, x0 + sw / 2, 4 + signH / 2 + 1);
      ge.font = g.font; ge.textAlign = 'center'; ge.textBaseline = 'middle'; ge.fillStyle = sc; ge.globalAlpha = 0.55; ge.fillRect(x0 + 6, 4, sw - 12, signH); ge.globalAlpha = 1; ge.fillStyle = '#fff'; ge.fillText(nm, x0 + sw / 2, 4 + signH / 2 + 1);
      // awning
      g.fillStyle = sc; g.globalAlpha = 0.85; g.fillRect(x0 + 4, signH + 6, sw - 8, H * 0.06); g.globalAlpha = 1;
      // windows + door
      const wy = signH + 6 + H * 0.07, wh = H - wy - 6;
      const doorW = sw * 0.16, doorX = x0 + (s ? sw * 0.14 : sw * 0.7);
      const inner = pick(['#3a2a1e', '#2c3640', '#3b2f3a', '#2f3a2c']);
      g.fillStyle = '#2b2b2b'; g.fillRect(x0 + 8, wy - 2, sw - 16, wh + 4);
      g.fillStyle = inner; g.fillRect(x0 + 10, wy, sw - 20, wh);
      const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, 'rgba(160,190,210,.45)'); gr.addColorStop(1, 'rgba(20,30,40,.2)'); g.fillStyle = gr; g.fillRect(x0 + 10, wy, sw - 20, wh);
      go.fillStyle = 'rgb(255,25,230)'; go.fillRect(x0 + 10, wy, sw - 20, wh);
      g.fillStyle = '#1a1a1a'; g.fillRect(doorX, wy, doorW, wh); g.fillStyle = '#777'; g.fillRect(doorX + doorW * 0.8, wy + wh * 0.5, 3, 8);
      for (let m = x0 + 10 + (sw - 20) / 3; m < x0 + sw - 12; m += (sw - 20) / 3) { g.fillStyle = '#2b2b2b'; g.fillRect(m, wy, 3, wh); }
      ge.fillStyle = pick(['#ffcf8a', '#ffe6b8', '#fff1d6', '#d6ecff']); ge.globalAlpha = 0.75; ge.fillRect(x0 + 10, wy, sw - 20, wh); ge.globalAlpha = 1;
      ge.fillStyle = '#000'; ge.fillRect(doorX, wy, doorW, wh);
    }
    FACADES.shop = { map: toTex(c), emis: toTex(e), orm: toTex(o, false), texW: 16, texH: 5 };
  }
}
  buildAds();
}
function buildAds() {
  const c = mkCanvas(1024, 512), g = c.getContext('2d');
  const ads = [
    (x, y) => { const gr = g.createLinearGradient(x, y, x + 512, y + 256); gr.addColorStop(0, '#ff7a3d'); gr.addColorStop(1, '#b0245f'); g.fillStyle = gr; g.fillRect(x, y, 512, 256); g.fillStyle = '#fff'; g.font = '900 92px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('BAY FM', x + 256, y + 120); g.font = 'bold 44px Heebo, Arial'; g.fillText('101.3 · הלילה שלך', x + 256, y + 190); },
    (x, y) => { g.fillStyle = '#10302e'; g.fillRect(x, y, 512, 256); g.fillStyle = '#3fd8c6'; g.beginPath(); g.arc(x + 110, y + 128, 70, 0, 7); g.fill(); g.fillStyle = '#10302e'; g.beginPath(); g.arc(x + 130, y + 110, 60, 0, 7); g.fill(); g.fillStyle = '#f6f1e7'; g.font = 'bold 64px Heebo, Arial'; g.textAlign = 'right'; g.fillText('קפה מזח', x + 480, y + 115); g.font = '36px Heebo, Arial'; g.fillStyle = '#3fd8c6'; g.fillText('פתוח 24/7 על החוף', x + 480, y + 175); },
    (x, y) => { g.fillStyle = '#1a1020'; g.fillRect(x, y, 512, 256); g.strokeStyle = '#ff3d7f'; g.lineWidth = 10; g.strokeRect(x + 20, y + 20, 472, 216); g.fillStyle = '#ffde59'; g.font = '900 86px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('NEON', x + 256, y + 120); g.fillStyle = '#ff3d7f'; g.fillText('BURGER', x + 256, y + 205); },
    (x, y) => { const gr = g.createLinearGradient(x, y, x, y + 256); gr.addColorStop(0, '#5ab8ff'); gr.addColorStop(1, '#1d4f91'); g.fillStyle = gr; g.fillRect(x, y, 512, 256); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y + 200); for (let k = 0; k <= 512; k += 16) g.lineTo(x + k, y + 190 + Math.sin(k * 0.05) * 14); g.lineTo(x + 512, y + 256); g.lineTo(x, y + 256); g.fill(); g.font = 'bold 66px Heebo, Arial'; g.textAlign = 'center'; g.fillText('גלישה בשקיעה', x + 256, y + 110); g.font = '34px Heebo, Arial'; g.fillText('בית ספר חוף הצפוני', x + 256, y + 160); },
  ];
  ads.forEach((f, i) => f((i % 2) * 512, Math.floor(i / 2) * 256));
  TEX.ads = toTex(c, true, false);
}
export function textSprite(text, color = '#ffb24a', size = 128) {
  const c = mkCanvas(size, size), g = c.getContext('2d');
  g.fillStyle = 'rgba(8,10,18,.75)'; g.beginPath(); g.arc(size / 2, size / 2, size * 0.44, 0, 7); g.fill();
  g.lineWidth = size * 0.06; g.strokeStyle = color; g.stroke();
  g.fillStyle = color; g.font = `900 ${size * 0.5}px "Big Shoulders Display", "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, size / 2, size / 2 + size * 0.03);
  const t = toTex(c, true, false);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.renderOrder = 10; return sp;
}

/* ====== LAYOUT ====== */
const CELL = 90, RW = 16, HRW = 8, NB = 7, NI = 8, SWK = 5, CURB = 0.15;
const nodeC = i => (i - 3.5) * CELL;
const blockLo = b => nodeC(b) + HRW, blockHi = b => nodeC(b + 1) - HRW, blockMid = b => (b - 3) * CELL;
const EDGE = nodeC(7) + HRW;           // 323: outer edge of the ring road
const PROM = EDGE + 5;                  // promenade outer edge
const SHORE_LIMIT = 356;                // walk/drive boundary on the sand
const LAYOUT = ['LLMMMLR', 'LHMTMCL', 'WMTTTML', 'LMTBTMD', 'LMKTTML', 'SLMMMLG', 'LRLLLKL'];
const blockType = (bi, bj) => (bi < 0 || bj < 0 || bi >= NB || bj >= NB) ? null : LAYOUT[bj][bi];
const PIER = { x0: PROM, x1: 482, z0: -6, z1: 6, px0: 420, pz0: -24, pz1: 24, deck: 1.4 };
const RAMPS = [
  { x: 341, z: -110, h: Math.PI, len: 15, w: 6, top: 3.6 },
  { x: -110, z: 341, h: Math.PI / 2, len: 15, w: 6, top: 3.6 },
  { x: -341, z: 120, h: 0, len: 15, w: 6, top: 3.8 },
  { x: 160, z: -341, h: -Math.PI / 2, len: 15, w: 6, top: 3.8 },
];
const buildings = [];
const BG = { cs: 24, off: 520, n: 44, cells: new Map(), stamp: 0 };
function bAdd(b) {
  b.stamp = 0;
  const c0x = Math.floor((b.x0 + BG.off) / BG.cs), c1x = Math.floor((b.x1 + BG.off) / BG.cs);
  const c0z = Math.floor((b.z0 + BG.off) / BG.cs), c1z = Math.floor((b.z1 + BG.off) / BG.cs);
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) { const k = cz * 1000 + cx; let a = BG.cells.get(k); if (!a) { a = []; BG.cells.set(k, a); } a.push(b); }
  buildings.push(b);
}
const _bq = [];
function bQuery(x0, z0, x1, z1) {
  _bq.length = 0; BG.stamp++;
  const c0x = Math.floor((x0 + BG.off) / BG.cs), c1x = Math.floor((x1 + BG.off) / BG.cs);
  const c0z = Math.floor((z0 + BG.off) / BG.cs), c1z = Math.floor((z1 + BG.off) / BG.cs);
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    const a = BG.cells.get(cz * 1000 + cx); if (!a) continue;
    for (const b of a) if (b.stamp !== BG.stamp) { b.stamp = BG.stamp; _bq.push(b); }
  }
  return _bq;
}
function bAt(x, z, m = 0) {
  const a = BG.cells.get(Math.floor((z + BG.off) / BG.cs) * 1000 + Math.floor((x + BG.off) / BG.cs)); if (!a) return null;
  for (const b of a) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) return b;
  return null;
}
// line of sight in the ground plane (buildings taller than eye height block)
function losClear(ax, az, bx, bz, step = 2.5) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / step);
  for (let i = 1; i < n; i++) { const t = i / n, b = bAt(ax + (bx - ax) * t, az + (bz - az) * t); if (b && b.h > 1.7) return false; }
  return true;
}
// props (lamps, trees, hydrants...) as circles
const props = [];
const PG = { cs: 16, off: 520, cells: new Map() };
function pAdd(p) { const k = Math.floor((p.z + PG.off) / PG.cs) * 1000 + Math.floor((p.x + PG.off) / PG.cs); let a = PG.cells.get(k); if (!a) { a = []; PG.cells.set(k, a); } a.push(p); props.push(p); }
function pNear(x, z, cb) {
  const cx = Math.floor((x + PG.off) / PG.cs), cz = Math.floor((z + PG.off) / PG.cs);
  for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) { const a = PG.cells.get(j * 1000 + i); if (a) for (const p of a) if (p.alive) cb(p); }
}
function roundedDist(x, z, half, r) { const ax = Math.max(Math.abs(x) - (half - r), 0), az = Math.max(Math.abs(z) - (half - r), 0); return Math.hypot(ax, az) + (half - r); }
function onPier(x, z, m = 0) { return (x > PIER.x0 - 2 && x < PIER.x1 + m && z > PIER.z0 - m && z < PIER.z1 + m) || (x > PIER.px0 - m && x < PIER.x1 + m && z > PIER.pz0 - m && z < PIER.pz1 + m); }
function inBounds(x, z) { return roundedDist(x, z, SHORE_LIMIT, 46) < SHORE_LIMIT || onPier(x, z, -0.6); }
function rampAt(x, z) {
  for (const r of RAMPS) {
    const fx = Math.sin(r.h), fz = Math.cos(r.h), dx = x - r.x, dz = z - r.z;
    const al = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
    if (al >= 0 && al <= r.len && Math.abs(lat) <= r.w / 2) return r.top * al / r.len;
  }
  return -1;
}
function groundHeight(x, z) {
  const rh = rampAt(x, z); if (rh >= 0) return rh + 0.0;
  if (onPier(x, z)) { if (x < PIER.x0 + 14) return lerp(CURB, PIER.deck, clamp((x - PIER.x0) / 14, 0, 1)); return PIER.deck; }
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > EDGE || az > EDGE) {
    if (ax <= PROM && az <= PROM) return CURB;
    const d = roundedDist(x, z, 330, 40); return d < 333 ? -0.09 : -0.09 - smooth(333, 400, d) * 2.6;
  }
  const lx = x - nodeC(0), lz = z - nodeC(0);
  const ox = ((lx % CELL) + CELL) % CELL, oz = ((lz % CELL) + CELL) % CELL;
  if (ox > HRW && ox < CELL - HRW && oz > HRW && oz < CELL - HRW) return CURB;
  return 0;
}
function onRoad(x, z) { return groundHeight(x, z) === 0 && Math.abs(x) <= EDGE && Math.abs(z) <= EDGE; }

/* =====================================================================
   GEOMETRY BUCKETS
   ===================================================================== */
const WHITE = new THREE.Color(1, 1, 1);
class Bucket {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.f = []; this.i = []; this.v = 0; this.hasF = false; }
  quad(a, b, c, d, nx, ny, nz, uv, col = WHITE, fac = null) {
    const v = this.v; this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) { this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); if (fac) this.f.push(fac[0], fac[1], fac[2]); else this.f.push(0, 0, 0); }
    if (fac) this.hasF = true;
    this.u.push(...uv); this.i.push(v, v + 1, v + 2, v, v + 2, v + 3); this.v += 4;
  }
  wall(ax, az, bx, bz, y0, y1, u0, u1, v0, v1, col, cx, cz, fac) {
    let nx = -(bz - az), nz = bx - ax; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) { let t = ax; ax = bx; bx = t; t = az; az = bz; bz = t; nx = -nx; nz = -nz; }
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], nx, 0, nz, [u0, v0, u1, v0, u1, v1, u0, v1], col, fac);
  }
  top(x0, z0, x1, z1, y, us, col, uo = 0, vo = 0) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], 0, 1, 0, [x0 / us + uo, -z0 / us + vo, x0 / us + uo, -z1 / us + vo, x1 / us + uo, -z1 / us + vo, x1 / us + uo, -z0 / us + vo], col);
  }
  box(x0, y0, z0, x1, y1, z1, col = WHITE, us = 4, topToo = true) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = (y1 - y0) / us, hb = y0 / us;
    this.wall(x0, z0, x1, z0, y0, y1, x0 / us, x1 / us, hb, hb + h, col, cx, cz);
    this.wall(x1, z0, x1, z1, y0, y1, z0 / us, z1 / us, hb, hb + h, col, cx, cz);
    this.wall(x1, z1, x0, z1, y0, y1, x1 / us, x0 / us, hb, hb + h, col, cx, cz);
    this.wall(x0, z1, x0, z0, y0, y1, z1 / us, z0 / us, hb, hb + h, col, cx, cz);
    if (topToo) this.top(x0, z0, x1, z1, y1, us, col);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.hasF) g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.f, 3));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}
const B = {};
['metal', 'shop', 'roof', 'conc', 'side', 'grass', 'asph', 'lineW', 'lineY', 'wood', 'ads', 'trim', 'neonR', 'neonB', 'pond', 'paint', 'sand'].forEach(k => B[k] = new Bucket());
for (const k in FACADE_STYLES) B['f_' + k] = new Bucket();

const INST = {};
function instDef(name, geo, mat, opts = {}) { INST[name] = { geo, mat, list: [], cols: [], shadow: opts.shadow !== false, receive: opts.receive !== false, chunk: !!opts.chunk }; }
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function M4(x, y, z, ry = 0, s = 1, sy = s, sz = s, rx = 0, rz = 0) { _e.set(rx, ry, rz); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v3.set(x, y, z), _q, _s3.set(s, sy, sz)); }
function inst(name, m, col) { const d = INST[name]; d.list.push(m); if (col) d.cols.push(col); return d.list.length - 1; }

const MAT = {};
const POI = {};
const parkedSpots = [];   // {x,z,h,type,color}
const benchSpots = [];

/* ---------- building helper ---------- */
function addBuilding(x0, z0, x1, z1, h, style, o = {}) {
  const F = FACADE_STYLES[style]; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const y0 = o.y0 || 0, shopH = o.shops ? 4.6 : 0, tint = o.tint || WHITE, seed = sri(0, 97);
  const uo = sri(0, 7) * (F ? F.colW : 4), us = Math.floor(sr(0, 4)) * 0.25;
  const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  let along = uo;
  for (const s of sides) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    if (shopH) B.shop.wall(s[0], s[1], s[2], s[3], y0, y0 + shopH, us, us + len / 16, 0, 1, WHITE, cx, cz);
    if (F) B['f_' + style].wall(s[0], s[1], s[2], s[3], y0 + shopH, y0 + h, along, along + len, y0 + shopH, y0 + h, tint, cx, cz, [0, seed, y0 + shopH + (shopH ? 0.35 : 0) + (o.bandOff || 0)]);
    else B.metal.wall(s[0], s[1], s[2], s[3], y0, y0 + h, along / 3, (along + len) / 3, y0 / 3, (y0 + h) / 3, tint, cx, cz);
    along += len;
  }
  const top = y0 + h;
  // cornice over the shop band + slab line under the roof for depth
  if (shopH && F && !F.curtainWall) { const c = new THREE.Color(0.86, 0.84, 0.8); const e = 0.22; B.conc.box(x0 - e, y0 + shopH - 0.05, z0 - e, x1 + e, y0 + shopH + 0.3, z1 + e, c, 2); }
  B.roof.top(x0, z0, x1, z1, top, 6, WHITE, sr(0, 1), sr(0, 1));
  if (o.parapet !== false) {
    const t = 0.35, ph = F && F.curtainWall ? 1.4 : 0.9, pc = F && F.curtainWall ? new THREE.Color(0.35, 0.38, 0.42) : new THREE.Color(0.82, 0.8, 0.76).multiply(tint);
    B.conc.box(x0 - 0.12, top, z0 - 0.12, x1 + 0.12, top + ph, z0 + t, pc, 3); B.conc.box(x0 - 0.12, top, z1 - t, x1 + 0.12, top + ph, z1 + 0.12, pc, 3);
    B.conc.box(x0 - 0.12, top, z0 + t, x0 + t, top + ph, z1 - t, pc, 3); B.conc.box(x1 - t, top, z0 + t, x1 + 0.12, top + ph, z1 - t, pc, 3);
  }
  if (o.roofStuff !== false && (x1 - x0) > 8 && (z1 - z0) > 8) {
    const n = sri(1, 4);
    for (let i = 0; i < n; i++) { const w = sr(1.6, 4), d = sr(1.6, 3.5), px = sr(x0 + 2, x1 - 2 - w), pz = sr(z0 + 2, z1 - 2 - d); B.metal.box(px, top, pz, px + w, top + sr(1, 2.4), pz + d, new THREE.Color(0.7, 0.72, 0.74), 2); }
    if (sr() < 0.3) { const px = sr(x0 + 3, x1 - 6), pz = sr(z0 + 3, z1 - 6); B.wood.box(px, top + 2.5, pz, px + 3, top + 6, pz + 3, new THREE.Color(0.55, 0.45, 0.38), 2); B.trim.box(px + 0.2, top, pz + 0.2, px + 0.5, top + 2.5, pz + 0.5); B.trim.box(px + 2.5, top, pz + 2.5, px + 2.8, top + 2.5, pz + 2.8); }
  }
  if (o.billboard) addBillboard(x0, z0, x1, z1, top, o.billboard);
  if (o.antenna) { B.trim.box(cx - 0.3, top, cz - 0.3, cx + 0.3, top + o.antenna, cz + 0.3); inst('beacon', M4(cx, top + o.antenna + 0.3, cz)); }
  const b = { x0, x1, z0, z1, h: o.colH || top, style };
  if (o.collide !== false) bAdd(b);
  return b;
}
function addBillboard(x0, z0, x1, z1, top, side) {
  // board along the longer edge, facing outward
  const ad = sri(0, 3), u0 = (ad % 2) * 0.5, v0 = ad < 2 ? 0.5 : 0, W = 13, H = 5.2, y = top + 2.4;
  let ax, az, bx, bz, cx, cz;
  if (side === 'z0') { const mx = (x0 + x1) / 2; ax = mx - W / 2; bx = mx + W / 2; az = bz = z0 + 1.2; cx = mx; cz = z0 + 50; }
  else if (side === 'z1') { const mx = (x0 + x1) / 2; ax = mx + W / 2; bx = mx - W / 2; az = bz = z1 - 1.2; cx = mx; cz = z1 - 50; }
  else if (side === 'x0') { const mz = (z0 + z1) / 2; az = mz + W / 2; bz = mz - W / 2; ax = bx = x0 + 1.2; cz = mz; cx = x0 + 50; }
  else { const mz = (z0 + z1) / 2; az = mz - W / 2; bz = mz + W / 2; ax = bx = x1 - 1.2; cz = mz; cx = x1 - 50; }
  B.ads.wall(ax, az, bx, bz, y, y + H, u0, u0 + 0.5, v0, v0 + 0.5, WHITE, cx, cz);
  B.trim.wall(ax, az, bx, bz, y - 0.2, y + H + 0.2, 0, 1, 0, 1, WHITE, 2 * ((ax + bx) / 2) - cx, 2 * ((az + bz) / 2) - cz);
  const px = (ax + bx) / 2, pz = (az + bz) / 2;
  const dx = (bx - ax) / W, dz = (bz - az) / W;
  for (const s of [-4, 4]) { const qx = px + dx * s, qz = pz + dz * s; B.trim.box(qx - 0.15, top, qz - 0.15, qx + 0.15, y, qz + 0.15); }
}

/* ---------- blocks ---------- */
const STY_LOW = ['plaster', 'plaster', 'plaster2', 'plaster', 'plaster2', 'brick'];
const STY_MID = ['plaster', 'plaster2', 'plaster', 'conc', 'plaster', 'brick'];
const STY_TOW = ['glass', 'dark', 'glass', 'conc', 'glass'];
const TINTS_LOW = ['#f3dcc0', '#eec9a8', '#f5e6cf', '#e9b99a', '#f2d6d0', '#dfe9e4', '#fff4e2', '#f6d8a8', '#e8cfb9', '#e4c4a4', '#f7efe2'];
const tint = () => new THREE.Color(spick(TINTS_LOW));
const ftint = (a = 0.85, b = 1.05) => { const v = sr(a, b); return new THREE.Color(v, v * sr(0.97, 1.02), v * sr(0.95, 1.03)); };

function rowSplit(len, mn, mx) { const out = []; let acc = 0; while (acc < len - 0.1) { let w = sr(mn, mx); if (len - acc - w < mn) w = len - acc; out.push([acc, acc + w]); acc += w; } return out; }
function perimeter(lx0, lz0, lx1, lz1, hMin, hMax, styles, depthMin, depthMax, opts = {}) {
  const d = sr(depthMin, depthMax);
  const mk = (x0, z0, x1, z1) => {
    const st = spick(styles), fh = FACADE_STYLES[st].floorH, shops = opts.shops !== false;
    const h = (shops ? 4.6 : 0) + Math.max(1, Math.round(sr(hMin, hMax) / fh)) * fh;
    addBuilding(x0, z0, x1, z1, h, st, { shops, tint: st.startsWith('plaster') ? tint() : ftint(), billboard: (opts.ads && sr() < 0.18) ? (z0 === lz0 ? 'z0' : z1 === lz1 ? 'z1' : null) : null });
  };
  if (!opts.skipN) for (const [a, b] of rowSplit(lx1 - lx0, 10, 22)) mk(lx0 + a, lz0, lx0 + b, lz0 + d);
  if (!opts.skipS) for (const [a, b] of rowSplit(lx1 - lx0, 10, 22)) mk(lx0 + a, lz1 - d, lx0 + b, lz1);
  const iz0 = lz0 + (opts.skipN ? 0 : d) + 0.01, iz1 = lz1 - (opts.skipS ? 0 : d) - 0.01;
  if (!opts.skipW) for (const [a, b] of rowSplit(iz1 - iz0, 10, 20)) mk(lx0, iz0 + a, lx0 + d, iz0 + b);
  if (!opts.skipE) for (const [a, b] of rowSplit(iz1 - iz0, 10, 20)) mk(lx1 - d, iz0 + a, lx1, iz0 + b);
  return d;
}

function genBlock(bi, bj) {
  const t = blockType(bi, bj);
  const x0 = blockLo(bi), x1 = blockHi(bi), z0 = blockLo(bj), z1 = blockHi(bj), cx = blockMid(bi), cz = blockMid(bj);
  // raised slab + curbs
  B.side.top(x0, z0, x1, z1, CURB, 6);
  const cc = new THREE.Color(0.86, 0.84, 0.8);
  B.conc.wall(x0, z0, x1, z0, 0, CURB, 0, 18, 0, 0.04, cc, cx, cz); B.conc.wall(x1, z0, x1, z1, 0, CURB, 0, 18, 0, 0.04, cc, cx, cz);
  B.conc.wall(x1, z1, x0, z1, 0, CURB, 0, 18, 0, 0.04, cc, cx, cz); B.conc.wall(x0, z1, x0, z0, 0, CURB, 0, 18, 0, 0.04, cc, cx, cz);
  const lx0 = x0 + SWK, lx1 = x1 - SWK, lz0 = z0 + SWK, lz1 = z1 - SWK;
  const Y = CURB;
  switch (t) {
    case 'L': perimeter(lx0, lz0, lx1, lz1, 4.6, 10, STY_LOW, 12, 17, { ads: true }); courtyardTrees(lx0 + 18, lz0 + 18, lx1 - 18, lz1 - 18); break;
    case 'M': {
      const gap = 5, hw = (lx1 - lx0 - gap) / 2;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const bx0 = lx0 + a * (hw + gap), bz0 = lz0 + b * (hw + gap), ins = sr(0, 3);
        const st = spick(STY_MID), fh = FACADE_STYLES[st].floorH, h = 4.6 + Math.round(sr(4, 16) / fh) * fh;
        addBuilding(bx0 + (a ? ins : 0), bz0 + (b ? ins : 0), bx0 + hw - (a ? 0 : ins), bz0 + hw - (b ? 0 : ins), h, st, { shops: true, tint: st.startsWith('plaster') ? tint() : ftint(), billboard: sr() < 0.3 ? (b ? 'z1' : 'z0') : null });
      }
      break;
    }
    case 'T': {
      const podH = 4.6 + 3.8 * sri(2, 3);
      if (sr() < 0.55) {
        const st = spick(STY_TOW), h = sr(90, 175), w = sr(30, 38), tx0 = cx - w / 2, tz0 = cz - w / 2;
        addBuilding(lx0 + 4, lz0 + 4, lx1 - 4, lz1 - 4, podH, 'conc', { shops: true, tint: ftint(0.9, 1.05), roofStuff: false, colH: h + podH });
        addBuilding(tx0, tz0, tx0 + w, tz0 + w, h, st, { y0: podH, collide: false, roofStuff: false });
        const w2 = w * sr(0.6, 0.8), crown = sr(8, 22);
        addBuilding(cx - w2 / 2, cz - w2 / 2, cx + w2 / 2, cz + w2 / 2, crown, st, { y0: podH + h, collide: false, antenna: sr() < 0.7 ? sr(8, 25) : 0, parapet: false });
      } else {
        const off = 15, w = sr(22, 26);
        for (const [sx, sz] of [[-1, -1], [1, 1]]) {
          const st = spick(STY_TOW), h = sr(60, 130), px = cx + sx * off, pz = cz + sz * off;
          addBuilding(px - w / 2, pz - w / 2, px + w / 2, pz + w / 2, h, st, { shops: true, antenna: sr() < 0.5 ? sr(6, 16) : 0 });
        }
        for (const [sx, sz] of [[1, -1], [-1, 1]]) plazaTrees(cx + sx * 16, cz + sz * 16, 10);
      }
      break;
    }
    case 'H': {
      addBuilding(lx0 + 6, lz0 + 4, lx1 - 6, lz0 + 34, 4.6 + 3.8 * 6, 'conc', { shops: false, tint: new THREE.Color(1.08, 1.08, 1.1) });
      addBuilding(cx - 10, lz0 + 34, cx + 10, lz0 + 42, 6, 'plaster', { tint: new THREE.Color(1, 1, 1) });
      // red cross signs
      for (const sx of [-1, 1]) { const px = cx + sx * 18; B.neonR.box(px - 3, 18, lz0 + 3.6, px + 3, 19.4, lz0 + 3.9); B.neonR.box(px - 0.7, 15.6, lz0 + 3.6, px + 0.7, 21.8, lz0 + 3.9); }
      for (const sx of [-1, 1]) { const px = cx + sx * 18; B.neonR.box(px - 3, 18, lz0 + 33.9, px + 3, 19.4, lz0 + 34.2); B.neonR.box(px - 0.7, 15.6, lz0 + 33.9, px + 0.7, 21.8, lz0 + 34.2); }
      POI.hospital = { x: cx, z: z1 - 2.5, h: 0 };
      parkedSpots.push({ x: cx + 22, z: lz1 - 8, h: Math.PI / 2, type: 'van', color: 0xf2f2f2 });
      plazaTrees(lx0 + 8, lz1 - 10, 6); plazaTrees(lx1 - 8, lz1 - 10, 6);
      break;
    }
    case 'C': {
      addBuilding(lx0 + 4, lz0 + 4, lx1 - 4, lz0 + 30, 4.6 + 3.8 * 3, 'conc', { shops: false, tint: new THREE.Color(0.78, 0.84, 0.95) });
      B.neonB.box(lx0 + 8, 6.6, lz0 + 29.95, lx1 - 8, 7.6, lz0 + 30.3);
      POI.police = { x: cx, z: z1 - 2.5, h: 0 };
      parkingStripes(lx0 + 4, lz0 + 36, lx1 - 4, lz1 - 2, 'x');
      for (let k = 0; k < 3; k++) parkedSpots.push({ x: lx0 + 12 + k * 7, z: lz0 + 46, h: 0, type: 'police' });
      break;
    }
    case 'W': {
      addBuilding(lx0 + 2, lz0 + 2, lx0 + 34, lz0 + 28, 11, 'metal', { tint: new THREE.Color(0.82, 0.86, 0.9), parapet: false });
      addBuilding(lx0 + 2, lz1 - 24, lx0 + 30, lz1 - 2, 9, 'metal', { tint: new THREE.Color(0.95, 0.82, 0.7), parapet: false });
      addBuilding(lx1 - 18, lz0 + 2, lx1 - 2, lz0 + 18, 7, 'brick', { shops: false });
      B.asph.top(lx0 + 34, lz0 + 2, lx1, lz1, Y + 0.01, 10);
      for (let k = 0; k < 6; k++) containerStack(lx1 - 10 - (k % 2) * 7, lz0 + 24 + Math.floor(k / 2) * 9, k % 2 ? 0 : Math.PI / 2);
      POI.hideout = { x: lx0 + 40, z: cz + 4, h: 0 };
      break;
    }
    case 'B': {
      const bz0 = lz0 + 8, bz1 = lz0 + 40;
      addBuilding(lx0 + 6, bz0, lx1 - 6, bz1, 21, 'conc', { shops: false, tint: new THREE.Color(1.1, 1.0, 0.86), roofStuff: false, colH: 160 });
      for (let k = 0; k < 8; k++) { const px = lx0 + 10 + k * ((lx1 - lx0 - 20) / 7); inst('column', M4(px, Y, bz0 - 3)); }
      B.conc.box(lx0 + 6, 16, bz0 - 4.6, lx1 - 6, 18.4, bz0, new THREE.Color(1.05, 0.98, 0.85), 3);
      B.conc.box(lx0 + 4, Y, bz0 - 6, lx1 - 4, Y + 0.6, bz0, new THREE.Color(0.95, 0.9, 0.8), 3);
      addBuilding(cx - 15, bz0 + 4, cx + 15, bz1 - 2, 135, 'glass', { y0: 21, collide: false, antenna: 22, roofStuff: false });
      POI.bank = { x: cx, z: z0 + 2.5, h: Math.PI };
      plazaTrees(lx0 + 6, lz1 - 8, 6); plazaTrees(lx1 - 6, lz1 - 8, 6); plazaTrees(cx, lz1 - 8, 6);
      break;
    }
    case 'K': {
      B.grass.top(lx0 - 1, lz0 - 1, lx1 + 1, lz1 + 1, Y + 0.02, 8);
      // paths
      B.side.top(cx - 2.5, lz0 - 1, cx + 2.5, lz1 + 1, Y + 0.03, 6); B.side.top(lx0 - 1, cz - 2.5, lx1 + 1, cz + 2.5, Y + 0.03, 6);
      if (bi === 2) { // central park: pond + fountain
        const px = cx + 16, pz = cz + 16;
        B.conc.box(px - 9, Y, pz - 7, px + 9, Y + 0.5, pz - 6.4, new THREE.Color(0.8, 0.78, 0.74), 2); B.conc.box(px - 9, Y, pz + 6.4, px + 9, Y + 0.5, pz + 7, new THREE.Color(0.8, 0.78, 0.74), 2);
        B.conc.box(px - 9, Y, pz - 6.4, px - 8.4, Y + 0.5, pz + 6.4, new THREE.Color(0.8, 0.78, 0.74), 2); B.conc.box(px + 8.4, Y, pz - 6.4, px + 9, Y + 0.5, pz + 6.4, new THREE.Color(0.8, 0.78, 0.74), 2);
        B.pond.top(px - 8.4, pz - 6.4, px + 8.4, pz + 6.4, Y + 0.3, 8);
        bAdd({ x0: px - 9, x1: px + 9, z0: pz - 7, z1: pz + 7, h: 0.5, low: true });
        POI.fountain = { x: cx, z: cz };
        B.conc.box(cx - 3, Y, cz - 3, cx + 3, Y + 0.7, cz + 3, new THREE.Color(0.85, 0.82, 0.78), 2);
        B.conc.box(cx - 0.5, Y, cz - 0.5, cx + 0.5, Y + 2.2, cz + 0.5, new THREE.Color(0.85, 0.82, 0.78), 2);
        B.pond.top(cx - 2.6, cz - 2.6, cx + 2.6, cz + 2.6, Y + 0.6, 6);
        bAdd({ x0: cx - 3, x1: cx + 3, z0: cz - 3, z1: cz + 3, h: 0.7, low: true });
      }
      for (let k = 0; k < 34; k++) { const px = sr(lx0 + 2, lx1 - 2), pz = sr(lz0 + 2, lz1 - 2); if (Math.abs(px - cx) < 5 || Math.abs(pz - cz) < 5) continue; if (bi === 2 && Math.abs(px - cx - 16) < 12 && Math.abs(pz - cz - 16) < 10) continue; tree(px, pz, Y); }
      for (let k = 0; k < 6; k++) benchSpots.push([cx + 4, cz - 25 + k * 9, -Math.PI / 2]);
      break;
    }
    case 'S': {
      perimeter(lx0, lz0, lx1, lz1, 6, 13, STY_LOW, 13, 16, { skipE: true });
      addBuilding(lx1 - 14, cz - 12, lx1 - 2, cz - 2, 4.2, 'plaster', { tint: new THREE.Color(0.9, 0.86, 0.8), roofStuff: false });
      POI.safehouse = { x: lx1 + 2.5, z: cz + 6, h: -Math.PI / 2 };
      parkedSpots.push({ x: lx1 - 7, z: cz + 6, h: Math.PI / 2, type: 'sedan', color: 0x1d3c78 });
      break;
    }
    case 'G': {
      B.asph.top(lx0 + 8, lz0 + 10, lx1 - 8, lz1 - 16, Y + 0.02, 10);
      courtLines(lx0 + 12, lz0 + 14, lx1 - 12, lz1 - 20, Y + 0.03);
      addBuilding(lx0, lz1 - 14, lx0 + 22, lz1, 7, 'brick', { shops: true });
      addBuilding(lx1 - 24, lz1 - 12, lx1, lz1, 9, 'plaster', { shops: true, tint: new THREE.Color(0.85, 0.6, 0.55) });
      B.conc.box(lx0 + 6, Y, lz0 + 8, lx1 - 6, Y + 1.1, lz0 + 8.5, new THREE.Color(0.6, 0.6, 0.62), 2);
      POI.gang = { x: cx, z: cz - 6 };
      break;
    }
    case 'R': {
      B.asph.top(lx0, lz0, lx1, lz1, Y + 0.01, 10);
      parkingStripes(lx0 + 2, lz0 + 3, lx1 - 2, lz0 + 15, 'x'); parkingStripes(lx0 + 2, lz1 - 15, lx1 - 2, lz1 - 3, 'x');
      for (let k = 0; k < 9; k++) if (sr() < 0.7) parkedSpots.push({ x: lx0 + 6 + k * 6.4, z: lz0 + 9, h: sr() < .5 ? 0 : Math.PI });
      for (let k = 0; k < 9; k++) if (sr() < 0.6) parkedSpots.push({ x: lx0 + 6 + k * 6.4, z: lz1 - 9, h: sr() < .5 ? 0 : Math.PI });
      addBuilding(cx - 6, cz - 4, cx + 6, cz + 4, 3.4, 'plaster', { tint: new THREE.Color(1, 0.85, 0.5), roofStuff: false });
      break;
    }
    case 'D': {
      addBuilding(lx0 + 2, lz0 + 2, lx0 + 36, lz0 + 26, 12, 'metal', { tint: new THREE.Color(0.75, 0.82, 0.86), parapet: false });
      B.asph.top(lx0, lz0 + 26, lx1, lz1, Y + 0.01, 10);
      for (let k = 0; k < 8; k++) containerStack(lx0 + 8 + (k % 4) * 8, lz1 - 8 - Math.floor(k / 4) * 13, Math.PI / 2);
      addBuilding(lx1 - 20, lz0 + 2, lx1 - 2, lz0 + 16, 6, 'metal', { tint: new THREE.Color(0.95, 0.75, 0.55), parapet: false });
      POI.docks = { x: lx1 - 11, z: lz0 + 22, h: 0 };
      break;
    }
  }
}
function courtyardTrees(x0, z0, x1, z1) { if (x1 - x0 < 6) return; for (let k = 0; k < 3; k++) if (sr() < 0.6) tree(sr(x0, x1), sr(z0, z1), CURB, 0.8); }
function plazaTrees(x, z, r) { for (let k = 0; k < 3; k++) if (sr() < .8) { const a = sr(0, 6.28), d = sr(0, r); if (Math.random() < 0.5) palm(x + Math.cos(a) * d, z + Math.sin(a) * d, CURB, 0.8); else tree(x + Math.cos(a) * d, z + Math.sin(a) * d, CURB, 0.9); } }
function parkingStripes(x0, z0, x1, z1) { for (let x = x0 + 2; x < x1 - 1; x += 6.4) B.lineW.top(x - 0.07, z0, x + 0.07, z1, CURB + 0.03, 4); }
function courtLines(x0, z0, x1, z1, y) {
  const w = 0.1; B.lineW.top(x0, z0, x1, z0 + w, y, 4); B.lineW.top(x0, z1 - w, x1, z1, y, 4); B.lineW.top(x0, z0, x0 + w, z1, y, 4); B.lineW.top(x1 - w, z0, x1, z1, y, 4);
  const cz = (z0 + z1) / 2; B.lineW.top(x0, cz - w / 2, x1, cz + w / 2, y, 4);
  for (const zz of [z0 + 0.4, z1 - 0.4]) { B.trim.box((x0 + x1) / 2 - 0.08, y, zz - 0.08, (x0 + x1) / 2 + 0.08, y + 3, zz + 0.08); B.lineW.box((x0 + x1) / 2 - 0.9, y + 2.9, zz - 0.05, (x0 + x1) / 2 + 0.9, y + 3.9, zz + 0.05); }
}
function containerStack(x, z, ry) {
  const cols = ['#a33a2c', '#2b5d8a', '#3f7a46', '#c27a2a', '#6b6f73', '#7c2f5a'];
  const L = 6.1, W = 2.45, H = 2.6, levels = sri(1, 3);
  const hx = ry ? W / 2 : L / 2, hz = ry ? L / 2 : W / 2;
  for (let l = 0; l < levels; l++) { const c = new THREE.Color(spick(cols)); B.metal.box(x - hx, CURB + l * H, z - hz, x + hx, CURB + (l + 1) * H, z + hz, c, 2.5); }
  bAdd({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, h: CURB + levels * H });
}
function tree(x, z, y = CURB, s = 1) {
  const sc = s * sr(0.8, 1.2), ry = sr(0, 6.28), g = sr(0.82, 1.1);
  const m = M4(x, y, z, ry, sc);
  inst('treeTrunk', m); inst('treeBranch', m); inst('treeLeaf', m, new THREE.Color(g, g * sr(0.95, 1.08), g * sr(0.85, 1)));
  pAdd({ x, z, r: 0.3 * sc, kind: 'tree', alive: true, solid: true });
}
// tall, thin Washingtonia palms that line the boulevards
function laPalm(x, z, y = CURB) {
  const H = sr(17, 25), ry = sr(0, 6.28), s = sr(0.9, 1.1);
  inst('laTrunk', M4(x, y, z, ry, s, H, s)); inst('laCrown', M4(x, y + H, z, ry, s * sr(0.85, 1.05)), new THREE.Color().setHSL(sr(0.2, 0.26), 0.42, sr(0.3, 0.38))); inst('laSkirt', M4(x, y + H, z, ry, s));
  pAdd({ x, z, r: 0.25, kind: 'tree', alive: true, solid: true });
}
function palm(x, z, y = 0, s = 1) {
  const sc = s * sr(0.85, 1.2), ry = sr(0, 6.28);
  inst('palmTrunk', M4(x, y, z, ry, sc)); inst('palmLeaves', M4(x, y, z, ry, sc), new THREE.Color().setHSL(sr(0.2, 0.28), 0.45, sr(0.32, 0.42)));
  pAdd({ x, z, r: 0.3 * sc, kind: 'tree', alive: true, solid: true });
}

/* ---------- streets ---------- */
const LIGHT_CYCLE = 24;
function lightState(axis, t) { // axis 0 = traffic moving along X, 1 = along Z
  const c = ((t % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE, p = axis === 0 ? c : (c + LIGHT_CYCLE / 2) % LIGHT_CYCLE;
  return p < 9 ? 'g' : p < 11.5 ? 'y' : 'r';
}
function genStreets() {
  const yl = 0.012, w = 0.13;
  for (let line = 0; line < NI; line++) for (let seg = 0; seg < NB; seg++) for (const axis of [0, 1]) {
    // axis 0: road along X at z=nodeC(line), segment between x nodes seg..seg+1
    const c = nodeC(line), a = nodeC(seg) + HRW, b = nodeC(seg + 1) - HRW;
    const Q4 = (u0, u1, v0, v1, bucket) => { if (axis === 0) bucket.top(u0, c + v0, u1, c + v1, yl, 4); else bucket.top(c + v0, u0, c + v1, u1, yl, 4); };
    Q4(a + 5.5, b - 5.5, -0.28, -0.28 + w, B.lineY); Q4(a + 5.5, b - 5.5, 0.28 - w, 0.28, B.lineY);
    Q4(a + 5.5, b - 5.5, -7.6, -7.6 + w, B.lineW); Q4(a + 5.5, b - 5.5, 7.6 - w, 7.6, B.lineW);
    for (let u = a + 6; u < b - 8; u += 9) { Q4(u, u + 3, -4 - w / 2, -4 + w / 2, B.lineW); Q4(u, u + 3, 4 - w / 2, 4 + w / 2, B.lineW); }
    for (let k = 0; k < 13; k++) { const v = -7.3 + k * 1.2; Q4(a + 0.4, a + 3.8, v, v + 0.6, B.lineW); Q4(b - 3.8, b - 0.4, v, v + 0.6, B.lineW); }
    // stop lines: travelling +axis uses right side (+z for axis0, -x for axis1)
    if (axis === 0) { Q4(b - 5.1, b - 4.6, 0.4, 7.5, B.lineW); Q4(a + 4.6, a + 5.1, -7.5, -0.4, B.lineW); }
    else { Q4(b - 5.1, b - 4.6, -7.5, -0.4, B.lineW); Q4(a + 4.6, a + 5.1, 0.4, 7.5, B.lineW); }
    // furniture on both sidewalks of this segment
    for (const side of [-1, 1]) {
      for (let u = a + 14; u < b - 10; u += 26) {
        const off = side * (HRW + 0.6);
        const [lx, lz] = axis === 0 ? [u, c + off] : [c + off, u];
        const ry = axis === 0 ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        const li = inst('lampPost', M4(lx, CURB, lz, ry)); inst('lampHead', M4(lx, CURB, lz, ry));
        const px = axis === 0 ? lx : c + side * (HRW - 2.2), pz = axis === 0 ? c + side * (HRW - 2.2) : lz;
        inst('pool', M4(px, 0.025, pz, 0, 1));
        pAdd({ x: lx, z: lz, r: 0.22, kind: 'lamp', alive: true, inst: ['lampPost', 'lampHead'], idx: li, ry, knock: true });
      }
      const tB = blockType(axis === 0 ? seg : (side > 0 ? line : line - 1), axis === 0 ? (side > 0 ? line : line - 1) : seg);
      if (tB && tB !== 'T' && tB !== 'B') for (let u = a + 20; u < b - 6; u += 13) {
        const off = side * (HRW + 1.6); const [tx, tz] = axis === 0 ? [u, c + off] : [c + off, u];
        laPalm(tx, tz, CURB);
      }
      if (sr() < 0.35) { const u = sr(a + 8, b - 8), off = side * (HRW + 0.7); const [hx, hz] = axis === 0 ? [u, c + off] : [c + off, u]; inst('hydrant', M4(hx, CURB, hz)); pAdd({ x: hx, z: hz, r: 0.2, kind: 'hydrant', alive: true, knock: true, inst: ['hydrant'], idx: INST.hydrant.list.length - 1 }); }
      if (sr() < 0.3 && tB && tB !== 'K') { const u = sr(a + 10, b - 10), off = side * (HRW + 4.2); const [bx, bz] = axis === 0 ? [u, c + off] : [c + off, u]; benchSpots.push([bx, bz, axis === 0 ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2)]); }
    }
  }
  // traffic lights
  for (let i = 0; i < NI; i++) for (let j = 0; j < NI; j++) {
    const nx = nodeC(i), nz = nodeC(j);
    for (let d = 0; d < 4; d++) {
      const fx = [1, 0, -1, 0][d], fz = [0, 1, 0, -1][d];
      const pi = i - fx, pj = j - fz; if (pi < 0 || pj < 0 || pi >= NI || pj >= NI) continue; // no approach from outside
      const h = Math.atan2(fx, fz), rx = -Math.cos(h), rz = Math.sin(h);
      const px = nx - fx * (HRW + 1.6) + rx * (HRW + 1.0), pz = nz - fz * (HRW + 1.6) + rz * (HRW + 1.0);
      const ry = h + Math.PI / 2, axis = d % 2 === 0 ? 0 : 1;
      inst('tlPost', M4(px, CURB, pz, ry));
      for (const c of ['r', 'y', 'g']) inst('tl_' + c + axis, M4(px, CURB, pz, ry));
      pAdd({ x: px, z: pz, r: 0.25, kind: 'tl', alive: true, solid: true });
    }
  }
  // promenade around the island
  const pc = new THREE.Color(0.86, 0.84, 0.8);
  for (const [x0, z0, x1, z1] of [[-PROM, -PROM, PROM, -EDGE], [-PROM, EDGE, PROM, PROM], [-PROM, -EDGE, -EDGE, EDGE], [EDGE, -EDGE, PROM, EDGE]]) B.side.top(x0, z0, x1, z1, CURB, 6);
  B.conc.wall(-EDGE, -EDGE, EDGE, -EDGE, 0, CURB, 0, 100, 0, .04, pc, 0, -PROM); B.conc.wall(-EDGE, EDGE, EDGE, EDGE, 0, CURB, 0, 100, 0, .04, pc, 0, PROM);
  B.conc.wall(-EDGE, -EDGE, -EDGE, EDGE, 0, CURB, 0, 100, 0, .04, pc, -PROM, 0); B.conc.wall(EDGE, -EDGE, EDGE, EDGE, 0, CURB, 0, 100, 0, .04, pc, PROM, 0);
  B.conc.wall(-PROM, -PROM, PROM, -PROM, -0.4, CURB, 0, 100, 0, .04, pc, 0, 0); B.conc.wall(-PROM, PROM, PROM, PROM, -0.4, CURB, 0, 100, 0, .04, pc, 0, 0);
  B.conc.wall(-PROM, -PROM, -PROM, PROM, -0.4, CURB, 0, 100, 0, .04, pc, 0, 0); B.conc.wall(PROM, -PROM, PROM, PROM, -0.4, CURB, 0, 100, 0, .04, pc, 0, 0);
  for (let u = -PROM + 10; u < PROM - 5; u += 20) {
    for (const [x, z] of [[u, -PROM + 2.4], [u, PROM - 2.4], [-PROM + 2.4, u], [PROM - 2.4, u]]) {
      if (onPier(x + 3, z, 2)) continue;
      palm(x, z, CURB, 1);
    }
  }
  // beach props: lifeguard towers, umbrellas
  for (const [x, z, ry] of [[345, -230, -Math.PI / 2], [345, 210, -Math.PI / 2], [-345, -60, Math.PI / 2], [60, 345, Math.PI], [-200, -345, 0]]) {
    B.wood.box(x - 1.4, 2.2, z - 1.4, x + 1.4, 2.4, z + 1.4, WHITE, 2); B.paint.box(x - 1.2, 2.4, z - 1.2, x + 1.2, 4.4, z + 1.2, new THREE.Color(1, 0.55, 0.45), 4);
    B.roof.box(x - 1.6, 4.4, z - 1.6, x + 1.6, 4.6, z + 1.6);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.wood.box(x + sx * 1.2 - 0.1, 0, z + sz * 1.2 - 0.1, x + sx * 1.2 + 0.1, 2.2, z + sz * 1.2 + 0.1);
    bAdd({ x0: x - 1.5, x1: x + 1.5, z0: z - 1.5, z1: z + 1.5, h: 4.6 });
  }
  for (let k = 0; k < 40; k++) {
    const side = k % 4, u = sr(-300, 300), d = sr(334, 350);
    const [x, z] = side === 0 ? [d, u] : side === 1 ? [-d, u] : side === 2 ? [u, d] : [u, -d];
    if (onPier(x, z, 8) || rampAt(x, z) >= 0 || Math.abs(rampNear(x, z)) < 1) continue;
    inst('umbrella', M4(x, 0, z, sr(0, 6.28)), new THREE.Color().setHSL(sr(0, 1), 0.6, 0.55));
  }
}
function rampNear(x, z) { let m = 99; for (const r of RAMPS) m = Math.min(m, Math.hypot(x - r.x, z - r.z) - 25); return m < 0 ? 0 : m; }

/* ---------- pier & ferris wheel ---------- */
let wheel = null;
function genPier() {
  const D = PIER.deck;
  const deck = (x0, z0, x1, z1) => { B.wood.top(x0, z0, x1, z1, D, 4); B.wood.wall(x0, z0, x1, z0, D - 0.4, D, 0, (x1 - x0) / 4, 0, 0.1, WHITE, (x0 + x1) / 2, z1); B.wood.wall(x0, z1, x1, z1, D - 0.4, D, 0, (x1 - x0) / 4, 0, 0.1, WHITE, (x0 + x1) / 2, z0); B.wood.wall(x1, z0, x1, z1, D - 0.4, D, 0, (z1 - z0) / 4, 0, .1, WHITE, x0, (z0 + z1) / 2); };
  // approach ramp
  const q = new Bucket(); B.wood.quad([PIER.x0, CURB, PIER.z0], [PIER.x0, CURB, PIER.z1], [PIER.x0 + 14, D, PIER.z1], [PIER.x0 + 14, D, PIER.z0], 0.1, 0.99, 0, [0, 0, 3, 0, 3, 3.5, 0, 3.5]);
  deck(PIER.x0 + 14, PIER.z0, PIER.px0, PIER.z1); deck(PIER.px0, PIER.pz0, PIER.x1, PIER.pz1);
  for (let x = PIER.x0 + 16; x < PIER.x1; x += 8) for (const z of (x > PIER.px0 ? [-22, -11, 0, 11, 22] : [-5.5, 5.5])) B.trim.box(x - 0.25, -3, z - 0.25, x + 0.25, D - 0.4, z + 0.25);
  // railings
  const rail = (x0, z0, x1, z1) => { B.wood.box(Math.min(x0, x1) - 0.06, D + 1.0, Math.min(z0, z1) - 0.06, Math.max(x0, x1) + 0.06, D + 1.1, Math.max(z0, z1) + 0.06); const L = Math.hypot(x1 - x0, z1 - z0); for (let t = 0; t <= L; t += 2.5) { const x = x0 + (x1 - x0) * t / L, z = z0 + (z1 - z0) * t / L; B.wood.box(x - 0.05, D, z - 0.05, x + 0.05, D + 1.05, z + 0.05); } };
  rail(PIER.x0 + 14, PIER.z0, PIER.px0, PIER.z0); rail(PIER.x0 + 14, PIER.z1, PIER.px0, PIER.z1);
  rail(PIER.px0, PIER.pz0, PIER.x1, PIER.pz0); rail(PIER.px0, PIER.pz1, PIER.x1, PIER.pz1); rail(PIER.x1, PIER.pz0, PIER.x1, PIER.pz1);
  rail(PIER.px0, PIER.pz0, PIER.px0, PIER.z0); rail(PIER.px0, PIER.z1, PIER.px0, PIER.pz1);
  for (let x = PIER.x0 + 24; x < PIER.x1; x += 22) for (const z of [PIER.z0 + 0.4, PIER.z1 - 0.4]) { const ry = z < 0 ? 0 : Math.PI; inst('lampPost', M4(x, D, z, ry, 0.75)); inst('lampHead', M4(x, D, z, ry, 0.75)); }
  // kiosk
  B.paint.box(PIER.px0 + 4, D, PIER.pz1 - 9, PIER.px0 + 12, D + 3.2, PIER.pz1 - 2, new THREE.Color(0.25, 0.75, 0.72), 3); B.roof.box(PIER.px0 + 3.5, D + 3.2, PIER.pz1 - 9.5, PIER.px0 + 12.5, D + 3.5, PIER.pz1 - 1.5);
  bAdd({ x0: PIER.px0 + 4, x1: PIER.px0 + 12, z0: PIER.pz1 - 9, z1: PIER.pz1 - 2, h: D + 3.5 });
  POI.pierEnd = { x: PIER.x1 - 8, z: 0 };
  // ferris wheel
  const W = new THREE.Group(); const cx = 456, cy = D + 20, R = 17;
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, metalness: 0.6, roughness: 0.35 });
  const legs = new Bucket();
  for (const sz of [-3.2, 3.2]) for (const sx of [-1, 1]) {
    const bx = cx + sx * 9, bz = sz; const top = [cx, cy, sz * 0.6];
    const g = new THREE.CylinderGeometry(0.35, 0.45, Math.hypot(top[0] - bx, top[1] - D, top[2] - bz), 8);
    const m = new THREE.Mesh(g, steel); m.position.set((bx + top[0]) / 2, (D + top[1]) / 2, (bz + top[2]) / 2); m.lookAt(top[0], top[1], top[2]); m.rotateX(Math.PI / 2); m.castShadow = true; scene.add(m);
  }
  bAdd({ x0: cx - 10, x1: cx + 10, z0: -4, z1: 4, h: cy });
  const rot = new THREE.Group(); rot.position.set(cx, cy, 0); W.add(rot);
  for (const z of [-1.2, 1.2]) { const tor = new THREE.Mesh(new THREE.TorusGeometry(R, 0.28, 8, 64), steel); tor.rotation.y = Math.PI / 2; tor.position.x = 0; tor.position.z = z; rot.add(tor); }
  // fix: wheel plane is Y-Z, axis along X
  rot.children.forEach(c => { c.rotation.set(0, Math.PI / 2, 0); c.position.set(c.position.z, 0, 0); });
  const spokes = [];
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; for (const x of [-1.2, 1.2]) { const g = new THREE.BoxGeometry(0.12, R, 0.12); g.translate(0, R / 2, 0); g.rotateX(a); g.translate(x, 0, 0); spokes.push(g); } }
  rot.add(new THREE.Mesh(mergeGeometries(spokes), steel));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.4, 16), steel); hub.rotation.z = Math.PI / 2; rot.add(hub);
  const cabGeo = new RoundedBoxGeometry(2.2, 2.0, 1.8, 2, 0.3);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
  const cabs = new THREE.InstancedMesh(cabGeo, cabMat, 16); cabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cabCols = ['#ff5a5f', '#ffb24a', '#3fd8c6', '#62b6ff', '#f6f1e7', '#c86bff'];
  for (let k = 0; k < 16; k++) cabs.setColorAt(k, new THREE.Color(cabCols[k % cabCols.length]));
  W.add(cabs);
  // rim bulbs
  const nb = 96, bp = new Float32Array(nb * 3), bc = new Float32Array(nb * 3);
  for (let k = 0; k < nb; k++) { const a = k / nb * Math.PI * 2; bp[k * 3] = (k % 2 ? 1.25 : -1.25); bp[k * 3 + 1] = Math.cos(a) * R; bp[k * 3 + 2] = Math.sin(a) * R; const c = new THREE.Color().setHSL((k / nb * 3) % 1, 0.9, 0.6); bc.set([c.r, c.g, c.b], k * 3); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const bulbs = new THREE.Points(bg, new THREE.PointsMaterial({ size: 1.6, map: TEX.soft, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  rot.add(bulbs);
  scene.add(W);
  wheel = { rot, cabs, bulbs, cx, cy, R, angle: 0 };
}
function updateWheel(dt, night) {
  if (!wheel) return; wheel.angle += dt * 0.05; wheel.rot.rotation.x = wheel.angle;
  for (let k = 0; k < 16; k++) { const a = wheel.angle + k / 16 * Math.PI * 2; _m4.makeTranslation(wheel.cx, wheel.cy + Math.cos(a) * wheel.R - 1.3, Math.sin(a) * wheel.R); wheel.cabs.setMatrixAt(k, _m4); }
  wheel.cabs.instanceMatrix.needsUpdate = true;
  wheel.bulbs.material.opacity = 0.15 + night * 0.85; wheel.bulbs.material.size = 1.2 + night * 1.2;
}

/* ---------- ramps ---------- */
// distant coastal mountains across the bay, like the hills around Los Angeles
function genHills() {
  const NA = 240, NR = 26, R0 = 560, R1 = 980, pos = [], col = [], idx = [];
  const fb = (a, r) => { let h = 0, f = 1, amp = 1; for (let o = 0; o < 5; o++) { h += amp * Math.sin(a * 3 * f + o * 1.7 + Math.sin(r * 0.004 * f + o) * 1.3) * Math.cos(r * 0.006 * f - o * 0.9); f *= 2.1; amp *= 0.5; } return h; };
  for (let j = 0; j <= NR; j++) for (let i = 0; i <= NA; i++) {
    const a = i / NA * Math.PI * 2, r = R0 + (R1 - R0) * j / NR, x = Math.cos(a) * r, z = Math.sin(a) * r;
    // high to the north and west, low over the open sea to the east (where the pier is)
    const side = 0.55 + 0.45 * Math.cos(a - Math.PI * 1.15), prof = Math.sin(Math.PI * Math.pow(j / NR, 0.7));
    let h = (60 + 95 * side) * prof * (0.65 + 0.35 * fb(a, r)) + 18 * prof * fb(a * 3.3, r * 1.7);
    if (j === 0) h = -6;
    pos.push(x, h, z);
    const dry = clamp(h / 150, 0, 1), t = sr(0.92, 1.05);
    col.push((0.36 + 0.26 * dry) * t, (0.33 + 0.16 * dry) * t, (0.22 + 0.08 * dry) * t);
  }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = false; m.castShadow = false; m.matrixAutoUpdate = false; scene.add(m);
}
function genRamps() {
  const mat = new THREE.MeshStandardMaterial({ map: T_.metal.c, normalMap: T_.metal.n, color: 0xe2a63a, roughness: 0.55, metalness: 0.5 });
  for (const r of RAMPS) {
    const w = r.w / 2, L = r.len, H = r.top;
    const P = [[-w, 0, 0], [w, 0, 0], [w, H, L], [-w, H, L], [-w, 0, L], [w, 0, L]];
    const tri = [0, 2, 1, 0, 3, 2, 1, 2, 5, 0, 4, 3, 4, 5, 2, 4, 2, 3];
    const pos = []; tri.forEach(i => pos.push(...P[i]));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv = []; tri.forEach(i => uv.push(P[i][0] / 2, P[i][2] / 3 + P[i][1] / 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.position.set(r.x, -0.02, r.z); m.rotation.y = r.h; m.castShadow = m.receiveShadow = true; scene.add(m);
  }
}


/* ---------- materials & final meshes ---------- */
let T_ = null;
const pbr = (set, o = {}) => new THREE.MeshStandardMaterial({ map: set.c, normalMap: set.n, roughnessMap: set.r, roughness: 1, metalness: 0, ...o });
function modelParts(gltf, scale) {
  const out = []; gltf.scene.updateMatrixWorld(true);
  const toFloat = a => { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k); return new THREE.BufferAttribute(f, a.itemSize); };
  gltf.scene.traverse(o => { if (o.isMesh) { const g = new THREE.BufferGeometry(); for (const k in o.geometry.attributes) g.setAttribute(k, toFloat(o.geometry.attributes[k])); if (o.geometry.index) g.setIndex(o.geometry.index.clone()); g.applyMatrix4(o.matrixWorld); if (scale) g.scale(scale, scale, scale); g.computeBoundingSphere(); out.push({ name: o.name, mat: o.material, geo: g }); } });
  return out;
}
export function buildWorld(T, M) {
  T_ = T; setSeed(2024);
  buildCanvasTextures();
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.42, metalness: 0.75 });
  {
    // street lamp: base, tapered pole, curved arm, cobra head
    const base = new THREE.CylinderGeometry(0.2, 0.24, 0.6, 12); base.translate(0, 0.3, 0);
    const pole = new THREE.CylinderGeometry(0.07, 0.12, 7.4, 12); pole.translate(0, 4.3, 0);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 7.9, 0), new THREE.Vector3(0, 8.6, 0.4), new THREE.Vector3(0, 8.45, 2.0));
    const arm = new THREE.TubeGeometry(curve, 12, 0.055, 8, false);
    const head = new RoundedBoxGeometry(0.42, 0.18, 0.95, 2, 0.06); head.translate(0, 8.38, 2.2);
    const ni = g => g.index ? g.toNonIndexed() : g;
    instDef('lampPost', mergeGeometries([base, pole, arm, head].map(ni)), metalDark);
    const lens = new THREE.BoxGeometry(0.3, 0.03, 0.7); lens.translate(0, 8.28, 2.22);
    MAT.lampHead = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a8, emissiveIntensity: 0 });
    instDef('lampHead', lens, MAT.lampHead, { shadow: false });
  }
  {
    const pole = new THREE.CylinderGeometry(0.11, 0.14, 5.8, 10); pole.translate(0, 2.9, 0);
    const arm = new THREE.CylinderGeometry(0.08, 0.1, 4.8, 8); arm.rotateX(Math.PI / 2); arm.translate(0, 5.7, 2.4);
    const housing = new RoundedBoxGeometry(0.36, 1.12, 0.44, 2, 0.05); housing.translate(0, 5.1, 4.5);
    const back = new THREE.BoxGeometry(0.04, 1.4, 0.7); back.translate(-0.2, 5.1, 4.5);
    const visor = new THREE.BoxGeometry(0.22, 0.04, 0.34); const vs = [0, 1, 2].map(k => visor.clone().translate(0.24, 5.56 - k * 0.36, 4.5));
    const ni = g => g.index ? g.toNonIndexed() : g;
    instDef('tlPost', mergeGeometries([pole, arm, housing, back, ...vs].map(ni)), new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.55, metalness: 0.5 }));
    MAT.tl = {};
    [['r', 0xff2a1a, 5.42], ['y', 0xffa800, 5.06], ['g', 0x1aff6a, 4.7]].forEach(([c, col, y]) => {
      for (const ax of [0, 1]) { const g = new THREE.CircleGeometry(0.13, 12); g.rotateY(Math.PI / 2); g.translate(0.185, y, 4.5); const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0.05 }); MAT.tl[c + ax] = m; instDef('tl_' + c + ax, g, m, { shadow: false }); }
    });
  }
  {
    // real tree model (jacaranda), scaled to ~8 m
    const parts = modelParts(M.tree, 0.42);
    const find = re => parts.find(p => re.test(p.name) || re.test(p.mat.name || ''));
    const tr = find(/trunk/i), br = find(/branch/i), lf = find(/lea/i);
    const leafMat = lf.mat.clone(); leafMat.alphaTest = 0.3; leafMat.side = THREE.DoubleSide; leafMat.transparent = false;
    instDef('treeTrunk', tr.geo, tr.mat, { chunk: true }); instDef('treeBranch', br.geo, br.mat, { chunk: true }); instDef('treeLeaf', lf.geo, leafMat, { chunk: true });
  }
  {
    const t = new THREE.CylinderGeometry(0.14, 0.24, 9, 7, 8); const p = t.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 4.5; p.setXYZ(i, p.getX(i) + 0.016 * y * y, y, p.getZ(i)); }
    t.computeVertexNormals();
    instDef('palmTrunk', t, pbr(T.wood, { color: 0xb8a088, roughness: 0.95 }), { chunk: true });
    const leaves = [];
    for (let k = 0; k < 10; k++) {
      const g = new THREE.PlaneGeometry(1.15, 4.6, 1, 6); g.rotateX(-Math.PI / 2); g.translate(0, 0, 2.3);
      const lp = g.attributes.position; for (let i = 0; i < lp.count; i++) { const z = lp.getZ(i); lp.setY(i, 0.55 * z - 0.14 * z * z); }
      g.rotateY(k / 10 * Math.PI * 2 + (k % 2) * 0.2); g.translate(0.016 * 81, 9, 0); leaves.push(g);
    }
    const lg = mergeGeometries(leaves); lg.computeVertexNormals();
    instDef('palmLeaves', lg, new THREE.MeshStandardMaterial({ map: TEX.palm, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), { chunk: true });
  }
  {
    // LA palm: unit-height trunk (scaled per instance) + crown with a dead-frond skirt
    const t = new THREE.CylinderGeometry(0.17, 0.26, 1, 7, 1); t.translate(0, 0.5, 0);
    instDef('laTrunk', t, pbr(T.wood, { color: 0x9c8a76, roughness: 0.95 }), { chunk: true });
    const parts = [];
    for (let k = 0; k < 16; k++) {
      const g = new THREE.PlaneGeometry(0.95, 3.4, 1, 5); g.rotateX(-Math.PI / 2); g.translate(0, 0, 1.7);
      const lp = g.attributes.position; for (let i = 0; i < lp.count; i++) { const z = lp.getZ(i); lp.setY(i, 0.45 * z - 0.2 * z * z); }
      g.rotateY(k / 16 * Math.PI * 2 + (k % 2) * 0.15); parts.push(g);
    }
    const skirt = new THREE.CylinderGeometry(0.75, 0.35, 1.6, 9, 1, true); skirt.translate(0, -0.7, 0);
    const sc = new Float32Array(skirt.attributes.position.count * 3).fill(0); skirt.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const lg = mergeGeometries(parts.map(g => { const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; })); lg.computeVertexNormals();
    instDef('laCrown', lg, new THREE.MeshStandardMaterial({ map: TEX.palm, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), { chunk: true });
    instDef('laSkirt', skirt, new THREE.MeshStandardMaterial({ color: 0x6e5a42, roughness: 1, side: THREE.DoubleSide }), { chunk: true });
  }
  {
    const ni = g => g.index ? g.toNonIndexed() : g;
    const hb = new THREE.CylinderGeometry(0.15, 0.17, 0.62, 16); hb.translate(0, 0.37, 0);
    const hf = new THREE.CylinderGeometry(0.21, 0.21, 0.07, 16); hf.translate(0, 0.07, 0);
    const hc = new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); hc.translate(0, 0.68, 0);
    const hn = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8); hn.translate(0, 0.86, 0);
    const n1 = new THREE.CylinderGeometry(0.065, 0.065, 0.44, 12); n1.rotateZ(Math.PI / 2); n1.translate(0, 0.48, 0);
    const n2 = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12); n2.rotateX(Math.PI / 2); n2.translate(0, 0.45, 0.16);
    const hgeo = mergeGeometries([hb, hf, hc, hn, n1, n2].map(ni));
    instDef('hydrant', hgeo, new THREE.MeshStandardMaterial({ color: 0xb8201a, roughness: 0.45, metalness: 0.35 }));
    const col = new THREE.CylinderGeometry(0.55, 0.62, 16, 16); col.translate(0, 8, 0);
    instDef('column', col, pbr(T.conc, { color: 0xf2ece0 }));
    const seat = new THREE.BoxGeometry(1.8, 0.06, 0.45); seat.translate(0, 0.45, 0); const back = new THREE.BoxGeometry(1.8, 0.4, 0.05); back.translate(0, 0.75, -0.22);
    const l1 = new THREE.BoxGeometry(0.06, 0.45, 0.45); l1.translate(-0.8, 0.22, 0); const l2 = l1.clone().translate(1.6, 0, 0);
    instDef('bench', mergeGeometries([seat, back, l1, l2]), pbr(T.wood, { color: 0xc8a37f }));
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6); pole.translate(0, 1.2, 0); const um = new THREE.ConeGeometry(1.4, 0.5, 12, 1, true); um.translate(0, 2.35, 0);
    instDef('umbrella', mergeGeometries([pole, um]), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
    instDef('beacon', new THREE.SphereGeometry(0.4, 8, 6), MAT.beacon = new THREE.MeshBasicMaterial({ color: 0xff2020 }), { shadow: false });
    MAT.pool = new THREE.MeshBasicMaterial({ map: TEX.pool, color: 0xffc898, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false });
    const pg = new THREE.PlaneGeometry(12, 12); pg.rotateX(-Math.PI / 2);
    instDef('pool', pg, MAT.pool, { shadow: false, receive: false });
  }
  for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) genBlock(bi, bj);
  genStreets(); genPier(); genRamps(); genHills();
  for (const [x, z, ry] of benchSpots) inst('bench', M4(x, CURB, z, ry));
  // ---- materials
  MAT.fac = {}; for (const k in FACADE_STYLES) MAT.fac[k] = makeFacadeMaterial(k, T);
  const groups = [
    ['shop', MAT.shop = new THREE.MeshStandardMaterial({ map: FACADES.shop.map, emissiveMap: FACADES.shop.emis, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: FACADES.shop.orm, metalnessMap: FACADES.shop.orm, roughness: 1, metalness: 1 })],
    ['roof', pbr(T.dirt, { color: 0x8d8a86, vertexColors: true })],
    ['conc', pbr(T.conc, { vertexColors: true })],
    ['side', pbr(T.walk, { vertexColors: true, color: 0xd8d3ca })],
    ['grass', pbr(T.grass, { vertexColors: true })],
    ['asph', pbr(T.road, { vertexColors: true })],
    ['lineW', new THREE.MeshStandardMaterial({ color: 0xe4e2dc, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })],
    ['lineY', new THREE.MeshStandardMaterial({ color: 0xe6b43a, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })],
    ['wood', pbr(T.wood, { vertexColors: true })],
    ['metal', pbr(T.metal, { vertexColors: true, metalness: 0.35, roughness: 0.8 })],
    ['paint', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })],
    ['ads', MAT.ads = new THREE.MeshStandardMaterial({ map: TEX.ads, emissiveMap: TEX.ads, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5, side: THREE.DoubleSide })],
    ['trim', new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6, vertexColors: true })],
    ['neonR', MAT.neonR = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff1a1a, emissiveIntensity: 0.6 })],
    ['neonB', MAT.neonB = new THREE.MeshStandardMaterial({ color: 0x3070ff, emissive: 0x2a5bff, emissiveIntensity: 0.6 })],
    ['pond', MAT.pond = new THREE.MeshStandardMaterial({ color: 0x1f5866, roughness: 0.04, metalness: 0.1, normalMap: M.waterN, normalScale: new THREE.Vector2(0.3, 0.3) })],
  ];
  for (const k in FACADE_STYLES) groups.push(['f_' + k, MAT.fac[k]]);
  for (const [k, m] of groups) {
    if (!B[k] || !B[k].v) continue;
    const mesh = new THREE.Mesh(B[k].geo(), m); mesh.castShadow = !['lineW', 'lineY', 'side', 'grass', 'asph', 'pond'].includes(k); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; scene.add(mesh);
  }
  for (const k in INST) {
    const d = INST[k]; if (!d.list.length) continue;
    const groupsI = new Map();
    d.list.forEach((m, i) => { const key = d.chunk ? Math.floor((m.elements[12] + 520) / 160) + ',' + Math.floor((m.elements[14] + 520) / 160) : '0'; if (!groupsI.has(key)) groupsI.set(key, []); groupsI.get(key).push(i); });
    for (const idx of groupsI.values()) {
      const im = new THREE.InstancedMesh(d.geo, d.mat, idx.length);
      idx.forEach((src, i) => { im.setMatrixAt(i, d.list[src]); if (d.cols.length) im.setColorAt(i, d.cols[src]); });
      im.castShadow = d.shadow; im.receiveShadow = d.receive; im.computeBoundingSphere(); scene.add(im); if (!d.chunk) d.mesh = im;
    }
  }
  // ground: roads, sand, sea
  const road = new THREE.PlaneGeometry(EDGE * 2, EDGE * 2); road.rotateX(-Math.PI / 2);
  const ruv = road.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * EDGE * 2 / 7, ruv.getY(i) * EDGE * 2 / 7);
  const roadM = new THREE.Mesh(road, pbr(T.road, { normalScale: new THREE.Vector2(1.2, 1.2) })); roadM.receiveShadow = true; scene.add(roadM);
  const sand = new THREE.PlaneGeometry(1100, 1100, 120, 120); sand.rotateX(-Math.PI / 2);
  const sp = sand.attributes.position, suv = sand.attributes.uv, scol = new Float32Array(sp.count * 3);
  const deepC = new THREE.Color(0.05, 0.13, 0.18), shallowC = new THREE.Color(0.42, 0.78, 0.74), c = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i), d = roundedDist(x, z, 330, 40);
    const y = d < 333 ? -0.06 : -0.06 - smooth(333, 400, d) * 2.6 - smooth(400, 520, d) * 6;
    sp.setY(i, y); suv.setXY(i, x / 6, z / 6);
    if (y > -0.4) c.setRGB(1, 1, 1); else if (y > -2.8) c.copy(shallowC).lerp(new THREE.Color(1, 1, 1), smooth(-1.4, -0.4, y)); else c.copy(shallowC).lerp(deepC, smooth(-2.8, -6, y));
    scol.set([c.r, c.g, c.b], i * 3);
  }
  sand.setAttribute('color', new THREE.BufferAttribute(scol, 3)); sand.computeVertexNormals();
  const sandM = new THREE.Mesh(sand, pbr(T.sand, { vertexColors: true })); sandM.position.y = -0.03; sandM.receiveShadow = true; scene.add(sandM);
  M.waterN.wrapS = M.waterN.wrapT = THREE.RepeatWrapping; M.waterN.repeat.set(90, 90);
  MAT.water = new THREE.MeshPhysicalMaterial({ color: 0x0f5566, roughness: 0.03, metalness: 0.0, normalMap: M.waterN, normalScale: new THREE.Vector2(0.55, 0.55), transparent: true, opacity: 0.86, envMapIntensity: 1.1, ior: 1.33, reflectivity: 0.6 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), MAT.water); water.rotation.x = -Math.PI / 2; water.position.y = -0.55; scene.add(water);
  MAT.pond.normalMap.wrapS = MAT.pond.normalMap.wrapT = THREE.RepeatWrapping;
}
export function lampsOn(night) { return smooth(0.2, 0.6, night); }
export function updateWorld(dt, night, t) {
  facadeUniforms.uNight.value = night;
  const on = lampsOn(night);
  MAT.lampHead.emissiveIntensity = 0.05 + 9 * on; MAT.pool.opacity = 0.32 * on;
  MAT.shop.emissiveIntensity = 0.08 + 0.7 * night;
  MAT.ads.emissiveIntensity = 0.1 + 1.3 * night; MAT.neonR.emissiveIntensity = 0.6 + 3 * night; MAT.neonB.emissiveIntensity = 0.6 + 3 * night;
  MAT.beacon.color.setScalar(Math.sin(t * 3) > 0.6 ? 1 : 0.15).multiply(new THREE.Color(0xff3030));
  for (const ax of [0, 1]) { const s = lightState(ax, t); MAT.tl['r' + ax].emissiveIntensity = s === 'r' ? 5 : 0.06; MAT.tl['y' + ax].emissiveIntensity = s === 'y' ? 5 : 0.06; MAT.tl['g' + ax].emissiveIntensity = s === 'g' ? 5 : 0.06; }
  updateWheel(dt, night);
  if (MAT.water) { MAT.water.normalMap.offset.x += dt * 0.004; MAT.water.normalMap.offset.y += dt * 0.0025; }
}
export { CELL, RW, HRW, NB, NI, SWK, CURB, nodeC, blockLo, blockHi, blockMid, EDGE, PROM, SHORE_LIMIT, LAYOUT, blockType, PIER, RAMPS, buildings, bAdd, bQuery, bAt, losClear, props, pAdd, pNear, roundedDist, onPier, inBounds, rampAt, groundHeight, onRoad, POI, parkedSpots, lightState, LIGHT_CYCLE, INST, MAT, M4 };
