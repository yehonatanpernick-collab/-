// Offline world bake for the RZR mountain wilderness.
//   cd rzr/tools && node bake_world.mjs
// Produces rzr/assets/world/{height,far,masks,water}.bin.gz + world.json + overview.jpg
//
// The geography is designed, not random: named valleys, massifs, lakes, rivers and
// routes are explicit features below. Noise only supplies geological detail, and a
// droplet hydraulic-erosion pass gives slopes real drainage (gullies, fans, scree).
import fs from 'node:fs';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { makeSimplex, mulberry32, fbm, ridged, smoothstep, smin, smax, clamp, lerp, catmull } from './lib/noise.mjs';
import { WORLD, HeightField } from '../js/world/heightfield.js';

const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const OUT = new URL('../assets/world/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const N = WORLD.n, CELL = WORLD.cell, HALF = WORLD.half;
const NF = WORLD.farN, FCELL = WORLD.farSize / (NF - 1), FHALF = WORLD.farSize / 2;
const S1 = makeSimplex(1337), S2 = makeSimplex(4242), S3 = makeSimplex(777), S4 = makeSimplex(9001), S5 = makeSimplex(31337);
const rnd = mulberry32(20261113);

// ---------------------------------------------------------------- geography
// Valleys: centreline points [x, z, floorHeight, halfWidth, wallSteepness]
const VALLEYS = {
  green: { name: 'Grünental Valley', pts: [[-600, -3050, 1990, 250, 0.075], [-420, -1800, 1752, 300, 0.07], [-700, -620, 1655, 330, 0.065], [-300, 600, 1585, 340, 0.065], [200, 1800, 1522, 300, 0.07], [900, 2900, 1470, 200, 0.08]] },
  gorge: { name: 'Stone Gorge', pts: [[900, 2900, 1470, 110, 0.16], [1600, 3600, 1420, 30, 0.3], [2400, 4500, 1360, 26, 0.3], [3300, 5800, 1280, 30, 0.25], [4200, 8000, 1150, 60, 0.2]] },
  lakeway: { name: 'Lake Road Valley', pts: [[-690, -650, 1655, 170, 0.08], [300, -850, 1762, 150, 0.085], [1100, -900, 1880, 150, 0.08], [1750, -800, 1936, 220, 0.07], [2300, -700, 1936, 620, 0.06]] },
  hidden: { name: 'Hidden Valley', pts: [[2350, -1150, 1960, 110, 0.1], [2420, -1650, 2050, 80, 0.13], [2500, -1950, 2120, 60, 0.16], [2560, -2150, 2445, 70, 0.14], [2680, -2550, 2520, 200, 0.09], [2790, -2860, 2540, 240, 0.08]] },
  forest: { name: 'Dark Forest Valley', pts: [[-3300, -2300, 1885, 120, 0.11], [-2700, -1000, 1742, 150, 0.1], [-2200, 250, 1652, 170, 0.095], [-1300, 950, 1602, 150, 0.1], [-420, 900, 1578, 130, 0.1]] },
  meadow: { name: 'Drift Meadow', pts: [[300, 2000, 1516, 200, 0.08], [-600, 2450, 1507, 450, 0.06], [-1800, 2750, 1502, 600, 0.055], [-2800, 2900, 1512, 350, 0.07]] },
  rockgarden: { name: 'Rock Garden Plateau', pts: [[2350, -200, 1945, 150, 0.09], [2650, 600, 2062, 140, 0.09], [2850, 1400, 2122, 380, 0.08]] },
  icepass: { name: 'Ice Pass', pts: [[-600, -3050, 1990, 230, 0.08], [-250, -2980, 2080, 170, 0.09], [250, -3080, 2220, 160, 0.09], [650, -3300, 2350, 170, 0.09], [720, -3620, 2460, 180, 0.09], [400, -3840, 2525, 200, 0.08], [120, -3790, 2535, 190, 0.08], [-100, -4000, 2600, 160, 0.09], [-300, -6000, 3100, 250, 0.08]] },
  traverse: { name: 'High Traverse', pts: [[720, -3620, 2460, 110, 0.1], [1300, -3520, 2550, 100, 0.11], [1900, -3170, 2590, 110, 0.1], [2400, -2880, 2555, 130, 0.1], [2790, -2860, 2540, 200, 0.09]] },
  northfar: { name: 'Northern Glacier', pts: [[-600, -3050, 1990, 100, 0.2], [-1400, -4600, 2700, 300, 0.1], [-2200, -7000, 3300, 400, 0.08]] },
};
// Massifs: [x, z, height, radius, terrace(Dolomite cliffs) 0..1, name]
const PEAKS = [
  [1000, -2200, 3750, 1150, 0.0, 'Weisshorn'], [3350, -500, 3450, 760, 1.0, 'Torri di Sole'], [-1700, -1700, 3500, 1000, 0.2, 'Kazbek Spur'],
  [-3000, 1500, 2860, 1100, 0.0, 'Tian Ridge'], [1400, 500, 2660, 650, 0.3, 'Lakeview Dome'], [-600, 3750, 2700, 800, 0.0, 'South Sentinel'],
  [3200, 2900, 3060, 900, 0.9, 'Red Towers'], [-3300, -3400, 3850, 1000, 0.1, 'Grand Glacier Peak'], [1900, 1900, 2560, 520, 0.4, 'Gorge Crown'],
  [-1300, 1800, 2440, 520, 0.0, 'Meadow Knoll'], [3600, -3300, 3650, 900, 0.5, 'Eastern Fang'], [700, -3500, 3600, 700, 0.2, 'Pass Guardian'], [-500, -3950, 3700, 700, 0.0, 'Ice Crown'], [2250, -2950, 3300, 600, 0.6, 'Tarn Needle'], [-3500, -700, 2950, 700, 0.0, 'Forest Wall'],
];
// Lakes: level is auto-fitted to the terrain after erosion
const LAKES = [
  { id: 'turquoise', name: 'Turquoise Lake', x: 2350, z: -660, r: 430, depth: 28, color: [0.05, 0.55, 0.55] },
  { id: 'tarn', name: 'Hidden Tarn', x: 2800, z: -2860, r: 170, depth: 14, color: [0.06, 0.42, 0.5] },
  { id: 'forestlake', name: 'Forest Lake', x: -2620, z: -580, r: 115, depth: 7, color: [0.06, 0.24, 0.2] },
  { id: 'frozen', name: 'Frozen Lake', x: 120, z: -3790, r: 95, depth: 6, frozen: true, color: [0.5, 0.6, 0.7] },
  { id: 'meadowpond', name: 'Meadow Tarn', x: -2650, z: 2980, r: 80, depth: 4, color: [0.08, 0.3, 0.3] },
];
// Rivers: source -> mouth. [x, z, halfWidth]. Surface heights follow the terrain, made monotone.
const RIVERS = [
  { id: 'gruenbach', name: 'Grünbach', pts: [[200, -3800, 1.2], [420, -3830, 1.4], [720, -3600, 1.7], [640, -3290, 2], [250, -3080, 2.3], [-250, -2990, 2.8], [-560, -3000, 3.5], [-380, -2400, 4.5], [-470, -1750, 5], [-600, -1200, 5.5], [-680, -620, 6.5], [-520, 0, 7], [-330, 600, 7.5], [-60, 1200, 8], [220, 1800, 8.5], [560, 2350, 8.5], [900, 2900, 8], [1250, 3250, 6], [1600, 3600, 5.5], [2000, 4050, 5.5], [2400, 4500, 5.5], [3300, 5800, 6]] },
  { id: 'lakeoutflow', name: 'Turquoise Outflow', pts: [[1930, -760, 3], [1500, -860, 3], [1100, -910, 3.5], [700, -880, 3.5], [300, -850, 4], [-200, -760, 4], [-660, -640, 4]] },
  { id: 'hiddenfalls', name: 'Hidden Falls', pts: [[2700, -2700, 1.2], [2640, -2450, 1.6], [2570, -2170, 1.6], [2500, -1950, 2], [2420, -1650, 2.2], [2360, -1280, 2.5], [2350, -1080, 2.5]] },
  { id: 'forestcreek', name: 'Dark Creek', pts: [[-3300, -2300, 1.2], [-3000, -1650, 1.8], [-2700, -1000, 2.2], [-2620, -700, 2.2], [-2420, -300, 2.4], [-2200, 250, 2.6], [-1750, 650, 2.8], [-1300, 950, 3], [-850, 940, 3], [-420, 900, 3.2], [-250, 880, 3.2]] },
  { id: 'silberfall', name: 'Silberfall', pts: [[-1500, -230, 0.8], [-1250, -260, 1.0], [-1050, -270, 1.3], [-930, -280, 1.5], [-800, -300, 1.8], [-640, -280, 2]] },
  { id: 'rockcreek', name: 'Rock Garden Creek', pts: [[2900, 1500, 1], [2700, 800, 1.5], [2500, 200, 1.8], [2380, -180, 2]] },
];
// Settlements & structures (heights resolved after carving)
const VILLAGE = { name: 'Alpendorf', x: -150, z: 330 };
const DRIFT = { x: -1750, z: 2730, R: 112, width: 15 };
const SPAWN = { x: -95, z: 255, heading: Math.PI }; // facing north (-z)

// Route network: [from, to, class].  Routing is A* with grade limits per class.
const NODES = {
  village: [-120, 260], greenNorth: [-520, -1700], valleyHead: [-560, -2850], icePass: [420, -3800],
  lakeJct: [-640, -560], lakeWest: [1550, -820], lakeSouth: [2300, -160], lakeEast: [2800, -900], lakeNorth: [2300, -1180],
  rockGarden: [2850, 1350], ridge: [1650, 1150], ridgeDown: [450, 1350],
  greenSouth: [300, 1900], driftJct: [-900, 2450], drift: [-1750, 2570], gorge: [1600, 3540], gorgeEnd: [2000, 4040],
  forestMouth: [-500, 900], forestMid: [-2200, 280], forestLake: [-2500, -560], forestHead: [-3150, -2050],
  meadowWest: [-2700, 2800], tarn: [2700, -2620], highTraverse: [1600, -3360],
  silberfall: [-760, -330], forestSaddle: [-2350, 1500],
};
const ROUTES = [
  ['village', 'lakeJct', 'valley'], ['lakeJct', 'greenNorth', 'valley'], ['greenNorth', 'valleyHead', 'valley'], ['valleyHead', 'icePass', 'mountain'],
  ['lakeJct', 'lakeWest', 'valley'], ['lakeWest', 'lakeSouth', 'trail'], ['lakeSouth', 'lakeEast', 'trail'], ['lakeEast', 'lakeNorth', 'trail'], ['lakeNorth', 'lakeWest', 'trail'],
  ['village', 'forestMouth', 'valley'], ['forestMouth', 'greenSouth', 'valley'], ['greenSouth', 'driftJct', 'valley'], ['driftJct', 'drift', 'valley'], ['drift', 'meadowWest', 'trail'],
  ['greenSouth', 'gorge', 'extreme'], ['gorge', 'gorgeEnd', 'extreme'],
  ['forestMouth', 'forestMid', 'forest'], ['forestMid', 'forestLake', 'forest'], ['forestLake', 'forestHead', 'forest'], ['forestMid', 'forestSaddle', 'extreme'], ['forestSaddle', 'meadowWest', 'extreme'],
  ['lakeSouth', 'rockGarden', 'extreme'], ['rockGarden', 'ridge', 'extreme'], ['ridge', 'greenSouth', 'extreme'],
  ['icePass', 'highTraverse', 'extreme'], ['highTraverse', 'tarn', 'extreme'],
  ['lakeJct', 'silberfall', 'trail'],
];
const CLASSES = {
  valley: { w: 3.4, gmax: 0.13, surface: 'gravel', side: 3.0 },
  trail: { w: 2.6, gmax: 0.2, surface: 'dirt', side: 2.0 },
  mountain: { w: 2.6, gmax: 0.2, surface: 'gravel', side: 1.6 },
  forest: { w: 2.3, gmax: 0.2, surface: 'mud', side: 2.0 },
  extreme: { w: 2.0, gmax: 0.34, surface: 'rock', side: 0.8 },
};

// ---------------------------------------------------------------- macro height function
// Valleys are spline-smoothed (no polyline corners) and queried through a domain
// warp, with noisy width / wall steepness, so walls meander like real troughs.
function prepPoly(v) {
  v.pts = catmull(v.pts, 30);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of v.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  v.bb = [x0, x1, z0, z1];
}
Object.values(VALLEYS).forEach(prepPoly);

// nearest point on polyline, with linear interpolation of per-point attributes
function polyQuery(px, pz, pts) {
  let best = 1e30, bi = 0, bu = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    let u = ((px - a[0]) * dx + (pz - a[1]) * dz) / L2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = a[0] + u * dx - px, qz = a[1] + u * dz - pz;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) { best = d2; bi = i; bu = u; }
  }
  return [Math.sqrt(best), bi, bu];
}

// High ground that carries the high valleys: [x, z, radius, height]
const PLATEAUS = [[150, -3750, 1500, 3080], [2750, -2650, 850, 2780], [2800, 1300, 800, 2330], [-1550, -260, 420, 2120]];

function regionalBase(x, z) {
  // uplands + named massifs (smooth-max) + plateaus + the far ring of giant ranges
  let R = 2120 + 280 * fbm(S2, x / 5200, z / 5200, 3);
  for (const [px, pz, ph, pr] of PEAKS) {
    const d = Math.hypot(x - px, z - pz) / pr;
    if (d < 1.6) {
      const b = Math.pow(Math.max(0, 1 - d / 1.6), 1.5);
      R = smax(R, 1950 + (ph - 1950) * b, 160);
    }
  }
  for (const [px, pz, pr, ph] of PLATEAUS) {
    const d = Math.hypot(x - px, z - pz);
    if (d < pr * 1.4) R = smax(R, lerp(R, ph, smoothstep(pr * 1.4, pr * 0.5, d)), 120);
  }
  const cheb = Math.max(Math.abs(x), Math.abs(z)) * 0.75 + Math.hypot(x, z) * 0.25;
  const ring = smoothstep(3900, 7600, cheb);
  if (ring > 0) {
    const giant = 0.55 + 0.45 * ridged(S4, x / 9000, z / 9000, 3);
    R += ring * (1300 + 2000 * giant);
  }
  return R;
}

function terrace(h, step) {
  const k = h / step, f = k - Math.floor(k);
  return (Math.floor(k) + smoothstep(0.62, 0.98, f)) * step;
}

// valley carve height (before floor micro-noise); evaluated on a 20 m grid
function carveRaw(x, z, both) {
  const wx = x + 170 * fbm(S4, x / 1500 + 3.1, z / 1500, 3), wz = z + 170 * fbm(S4, x / 1500, z / 1500 - 5.7, 3);
  let carve = 1e9, floorH = 1e9;
  for (const v of Object.values(VALLEYS)) {
    const [bx0, bx1, bz0, bz1] = v.bb;
    if (wx < bx0 - 2600 || wx > bx1 + 2600 || wz < bz0 - 2600 || wz > bz1 + 2600) continue;
    const [d, i, u] = polyQuery(wx, wz, v.pts);
    const a = v.pts[i], b = v.pts[i + 1];
    const f = lerp(a[2], b[2], u);
    const w = lerp(a[3], b[3], u) * (1 + 0.28 * fbm(S2, x / 900, z / 900, 2));
    const c = lerp(a[4], b[4], u) * (1 + 0.35 * fbm(S3, x / 700 - 9, z / 700, 2));
    const e = Math.max(0, d - w);
    // shoulder: a softer bench part-way up the wall (glacial trimline), then steep rock
    const wall = Math.pow(e, 1.5) * c * 1.75 * (0.75 + 0.25 * smoothstep(0, 220, e));
    if (f + wall < carve) { carve = f + wall; floorH = f; }
  }
  return both ? [carve, floorH] : carve;
}
const CG = 1025, CGC = 20, CGH = (CG - 1) * CGC / 2; // carve grid covers +-10.24 km
const carveGrid = new Float32Array(CG * CG), floorGrid = new Float32Array(CG * CG);
for (let j = 0; j < CG; j++) for (let i = 0; i < CG; i++) { const r = carveRaw(-CGH + i * CGC, -CGH + j * CGC, true); carveGrid[j * CG + i] = r[0]; floorGrid[j * CG + i] = r[1]; }
log('carve grid');
function gridAt(G2, x, z) {
  const gx = (x + CGH) / CGC, gz = (z + CGH) / CGC;
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  const a = G2[j * CG + i], b = G2[j * CG + i + 1], c = G2[(j + 1) * CG + i], d = G2[(j + 1) * CG + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
function floorAt(x, z) {
  const gx = (x + CGH) / CGC, gz = (z + CGH) / CGC;
  if (gx < 0 || gz < 0 || gx >= CG - 1 || gz >= CG - 1) return carveRaw(x, z, true)[1];
  return gridAt(floorGrid, x, z);
}
function carveAt(x, z) {
  const gx = (x + CGH) / CGC, gz = (z + CGH) / CGC;
  if (gx < 0 || gz < 0 || gx >= CG - 1 || gz >= CG - 1) return carveRaw(x, z);
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  const a = carveGrid[j * CG + i], b = carveGrid[j * CG + i + 1], c = carveGrid[(j + 1) * CG + i], d = carveGrid[(j + 1) * CG + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

function macroHeight(x, z) {
  const R = regionalBase(x, z);
  // domain-warped ridged detail; amplitude grows with elevation (rugged summits, softer uplands)
  const wx = x + 900 * fbm(S3, x / 3100, z / 3100, 3), wz = z + 900 * fbm(S3, x / 3100 + 7.7, z / 3100 - 3.3, 3);
  const rid = ridged(S1, wx / 2700, wz / 2700, 8);
  const amp = 340 + 0.5 * Math.max(0, R - 2050);
  let M = R + amp * (rid - 0.42) + 60 * fbm(S5, x / 420, z / 420, 4);
  // Dolomite-style vertical walls & ledges around terraced massifs
  for (const [px, pz, ph, pr, ter] of PEAKS) {
    if (!ter) continue;
    const d = Math.hypot(x - px, z - pz) / pr;
    if (d < 1.2) {
      const m = ter * smoothstep(1.2, 0.55, d) * smoothstep(2200, 2500, M);
      if (m > 0) M = lerp(M, terrace(M + 40 * S5(x / 160, z / 160), 95), m * 0.85);
    }
  }
  let carve = carveAt(x, z);
  // valley floor micro-relief (moraines, hummocks)
  const floorN = 5 * fbm(S2, x / 260, z / 260, 3) + 2.5 * S5(x / 60, z / 60);
  // walls: rock buttresses, spurs and couloirs grow with height above the floor
  const fl = floorAt(x, z);
  const above = Math.max(0, carve - fl);
  const wallK = smoothstep(8, 140, above) * Math.min(1, above / 260 + 0.25);
  const spur = 150 * fbm(S1, x / 520 + 11, z / 520 - 4, 4) + 75 * (ridged(S3, x / 260, z / 260, 4) - 0.45);
  carve += floorN * (1 - wallK) + spur * wallK;
  return smin(M, carve, 110);
}

// ---------------------------------------------------------------- compose grids
const H = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  const z = -HALF + j * CELL;
  for (let i = 0; i < N; i++) H[j * N + i] = macroHeight(-HALF + i * CELL, z);
  if (j % 256 === 0) log('compose core row', j);
}
log('core composed');
for (const L of [[2800, -2860, 'tarn'], [120, -3790, 'frozen'], [2350, -660, 'turquoise'], [-150, 330, 'village']]) log('design check', L[2], hAt0(L[0], L[1]).toFixed(0));
const idx = (x, z) => [Math.round((x + HALF) / CELL), Math.round((z + HALF) / CELL)];
const inGrid = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
const field = () => new HeightField({ height: null, masks: null, water: null });

// bilinear on the float grid (for routing / profiles during the bake)
function hAt(x, z) {
  const gx = clamp((x + HALF) / CELL, 0, N - 1.001), gz = clamp((z + HALF) / CELL, 0, N - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

function hAt0(x, z) { const [i, j] = [Math.round((x + HALF) / CELL), Math.round((z + HALF) / CELL)]; return H[j * N + i]; }
// ---------------------------------------------------------------- hydraulic erosion
const flow = new Float32Array(N * N), depo = new Float32Array(N * N);
{
  const hs = new Float32Array(N * N);
  const HU = 25; // erosion height unit (m): keeps per-step slopes in the range the droplet model is tuned for
  for (let k = 0; k < N * N; k++) hs[k] = H[k] / HU;
  const edgeFade = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = Math.min(i, j, N - 1 - i, N - 1 - j) * CELL;
    edgeFade[j * N + i] = smoothstep(0, 320, e);
  }
  const R = 3, brushI = [], brushW = [];
  let wsum = 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dz); if (d <= R) { brushI.push([dx, dz]); const w = 1 - d / R; brushW.push(w); wsum += w; }
  }
  for (let k = 0; k < brushW.length; k++) brushW[k] /= wsum;
  const inertia = 0.22, capF = 3.0, minCap = 0.002, depS = 0.25, eroS = 0.3, evap = 0.02, grav = 4, life = 60, maxStep = 0.06;
  const DROPS = 1500000;
  const grad = (x, y) => {
    const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * N + i;
    const a = hs[k], b = hs[k + 1], c = hs[k + N], d = hs[k + N + 1];
    return [(b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u, a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v];
  };
  for (let n = 0; n < DROPS; n++) {
    let x = 1 + rnd() * (N - 3), y = 1 + rnd() * (N - 3), dx = 0, dy = 0, sp = 1, wat = 1, sed = 0;
    for (let s = 0; s < life; s++) {
      const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * N + i;
      const [gx, gy, h0] = grad(x, y);
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia);
      const L = Math.hypot(dx, dy); if (L < 1e-9) break;
      dx /= L; dy /= L;
      x += dx; y += dy;
      if (x < 1 || y < 1 || x >= N - 2 || y >= N - 2) break;
      flow[k] += wat;
      const h1 = grad(x, y)[2];
      const dh = h1 - h0;
      const cap = Math.max(-dh * sp * wat * capF, minCap);
      const fade = edgeFade[k];
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depS;
        sed -= amt;
        const a = amt * fade;
        hs[k] += a * (1 - u) * (1 - v); hs[k + 1] += a * u * (1 - v); hs[k + N] += a * (1 - u) * v; hs[k + N + 1] += a * u * v;
        depo[k] += a * HU;
      } else {
        const amt = Math.min((cap - sed) * eroS, -dh, maxStep) * fade;
        for (let b = 0; b < brushI.length; b++) {
          const ii = i + brushI[b][0], jj = j + brushI[b][1];
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const kk = jj * N + ii, w = amt * brushW[b];
          const take = Math.min(w, Math.max(0, hs[kk] - 0)); hs[kk] -= take; sed += take;
        }
      }
      sp = Math.min(6, Math.sqrt(Math.max(0, sp * sp - dh * grav)));
      wat *= 1 - evap;
    }
    if (n % 300000 === 0) log('erosion droplets', n);
  }
  let sumd = 0, maxd = 0;
  for (let k = 0; k < N * N; k++) { const nh = hs[k] * HU, d = Math.abs(nh - H[k]); sumd += d; maxd = Math.max(maxd, d); H[k] = nh; }
  log('erosion mean |dh|', (sumd / (N * N)).toFixed(2), 'm, max', maxd.toFixed(1), 'm');
  // light smoothing of single-cell spikes left by droplets
  const tmp = H.slice();
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    const avg = (tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) * 0.25;
    H[k] = lerp(tmp[k], avg, 0.35);
  }
  log('erosion done');
}

// ---------------------------------------------------------------- water: lakes
const WL = new Float32Array(N * N); // water surface, 0 = dry
const waterKind = new Uint8Array(N * N); // 1 lake, 2 river, 3 frozen
function lakeRadius(L, ang) {
  return L.r * (1 + 0.16 * Math.sin(ang * 3 + L.x * 0.01) + 0.09 * Math.sin(ang * 5 + 1.3) + 0.05 * Math.sin(ang * 9 + L.z));
}
for (const L of LAKES) {
  // fit level: low percentile of terrain inside the shape, so the shore is natural
  const vals = [];
  for (let a = 0; a < 64; a++) for (let r = 0; r <= 1; r += 0.125) {
    const ang = a / 64 * Math.PI * 2, rr = lakeRadius(L, ang) * r;
    vals.push(hAt(L.x + Math.cos(ang) * rr, L.z + Math.sin(ang) * rr));
  }
  vals.sort((a, b) => a - b);
  L.level = Math.round((vals[Math.floor(vals.length * 0.35)] + 1.2) * 10) / 10;
  const [ci, cj] = idx(L.x, L.z);
  const rc = Math.ceil(L.r * 1.6 / CELL) + 20;
  for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
    if (!inGrid(i, j)) continue;
    const x = -HALF + i * CELL, z = -HALF + j * CELL, dx = x - L.x, dz = z - L.z;
    const ang = Math.atan2(dz, dx), rr = lakeRadius(L, ang), d = Math.hypot(dx, dz);
    const k = j * N + i;
    if (d < rr) {
      const inside = (rr - d);
      const bed = L.level - 0.4 - L.depth * smoothstep(0, rr * 0.55, inside) - 1.2 * S5(x / 40, z / 40);
      H[k] = Math.min(H[k], bed);
      WL[k] = L.level; waterKind[k] = L.frozen ? 3 : 1;
    } else if (d < rr + 70) {
      // containment rim: shore always above water; gentle beach
      const t = (d - rr);
      H[k] = Math.max(H[k], L.level + 0.25 + t * 0.06);
    }
  }
  log('lake', L.id, 'level', L.level);
}

// ---------------------------------------------------------------- water: rivers
const riverOut = [];
for (const R of RIVERS) {
  const pts = catmull(R.pts.map(p => [p[0], p[1], p[2]]), 4);
  // monotone surface following the valley floor
  const s = pts.map(p => hAt(p[0], p[1]));
  for (let i = 1; i < s.length; i++) s[i] = Math.min(s[i], s[i - 1]);
  // smooth (keeps monotone)
  for (let it = 0; it < 3; it++) for (let i = 1; i < s.length - 1; i++) s[i] = Math.min(s[i - 1], (s[i - 1] + s[i] * 2 + s[i + 1]) / 4);
  // rivers entering lakes take the lake level
  for (let i = 0; i < pts.length; i++) {
    const [ii, jj] = idx(pts[i][0], pts[i][1]);
    if (inGrid(ii, jj) && waterKind[jj * N + ii] === 1) s[i] = Math.min(s[i], WL[jj * N + ii]);
  }
  for (let i = 1; i < s.length; i++) s[i] = Math.min(s[i], s[i - 1]);
  const samples = pts.map((p, i) => ({ x: p[0], z: p[1], w: p[2], y: s[i] }));
  // carve channel + banks, write water level
  const best = new Float32Array(N * N).fill(1e9), bestY = new Float32Array(N * N), bestW = new Float32Array(N * N);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const rad = Math.max(a.w, b.w) + 14;
    const [i0, j0] = idx(Math.min(a.x, b.x) - rad, Math.min(a.z, b.z) - rad), [i1, j1] = idx(Math.max(a.x, b.x) + rad, Math.max(a.z, b.z) + rad);
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      if (!inGrid(ii, j)) continue;
      const x = -HALF + ii * CELL, z = -HALF + j * CELL;
      let u = ((x - a.x) * dx + (z - a.z) * dz) / L2; u = clamp(u, 0, 1);
      const d = Math.hypot(a.x + u * dx - x, a.z + u * dz - z), k = j * N + ii;
      if (d < best[k]) { best[k] = d; bestY[k] = lerp(a.y, b.y, u); bestW[k] = lerp(a.w, b.w, u); }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const d = best[k]; if (d > 1e8) continue;
    const w = bestW[k], y = bestY[k], depth = 0.45 + w * 0.12;
    if (d < w) {
      H[k] = Math.min(H[k], y - depth * (1 - (d / w) ** 2) - 0.08);
      if (waterKind[k] !== 1 && waterKind[k] !== 3) { WL[k] = y; waterKind[k] = 2; }
    } else if (d < w + 12) {
      const t = d - w;
      H[k] = Math.min(H[k], y + 0.15 + t * (0.25 + 0.05 * t));
    }
    // half a cell of extra wet margin so narrow streams register on the 4 m grid
    if (d < w + CELL * 0.6 && waterKind[k] === 0) { WL[k] = y; waterKind[k] = 2; }
  }
  // waterfalls: steep runs of the surface profile
  const falls = [];
  for (let i = 1; i < samples.length; i++) {
    const g = (samples[i - 1].y - samples[i].y) / 4;
    if (g > 0.55) {
      const last = falls[falls.length - 1];
      if (last && i - last.i1 <= 2) { last.i1 = i; } else falls.push({ i0: i - 1, i1: i });
    }
  }
  const fallsOut = falls.map(f => ({ top: [samples[f.i0].x, samples[f.i0].y, samples[f.i0].z], bottom: [samples[f.i1].x, samples[f.i1].y, samples[f.i1].z], drop: samples[f.i0].y - samples[f.i1].y, w: samples[f.i0].w }))
    .filter(f => f.drop > 6);
  riverOut.push({ id: R.id, name: R.name, samples, falls: fallsOut });
  log('river', R.id, 'len', samples.length * 4, 'm, falls', fallsOut.map(f => f.drop.toFixed(0) + 'm').join(','));
}

// ---------------------------------------------------------------- flat pads: village sites, drift track
const pads = [];
function flattenPad(x, z, rx, rz, rot, blend, yOverride) {
  let y = yOverride;
  if (y === undefined) {
    const v = [];
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) v.push(hAt(x + a * rx, z + b * rz));
    v.sort((p, q) => p - q); y = v[Math.floor(v.length / 2)];
  }
  const c = Math.cos(rot), s = Math.sin(rot), R = Math.max(rx, rz) + blend;
  const [i0, j0] = idx(x - R, z - R), [i1, j1] = idx(x + R, z + R);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!inGrid(i, j)) continue;
    const wx = -HALF + i * CELL - x, wz = -HALF + j * CELL - z;
    const lx = Math.abs(wx * c + wz * s) - rx, lz = Math.abs(-wx * s + wz * c) - rz;
    const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
    const k = j * N + i;
    if (waterKind[k]) continue;
    H[k] = lerp(y, H[k], smoothstep(0, blend, d));
  }
  return y;
}

// drift track: a large compacted dirt pad in the meadow
const driftPts = [];
{
  const n = 160;
  for (let k = 0; k < n; k++) {
    const t = k / n * Math.PI * 2;
    const r = DRIFT.R * (1 + 0.2 * Math.sin(2 * t + 0.4) + 0.1 * Math.cos(3 * t) + 0.05 * Math.sin(5 * t + 1));
    driftPts.push([DRIFT.x + Math.cos(t) * r * 1.25, DRIFT.z + Math.sin(t) * r * 0.9]);
  }
  DRIFT.y = flattenPad(DRIFT.x, DRIFT.z, DRIFT.R * 1.25 * 1.4 + 20, DRIFT.R * 0.9 * 1.4 + 20, 0, 60);
  log('drift pad y', DRIFT.y.toFixed(1));
}

// village layout: cabins along the valley floor east of the river
const buildings = [];
{
  const types = ['cabin', 'cabin', 'hut', 'cabin', 'barn', 'cabin', 'hut', 'chapel'];
  const spots = [[-200, 220, 0.3], [-90, 160, 0.1], [-40, 330, -0.2], [-160, 430, 0.5], [40, 230, 1.4], [70, 420, 0.9], [-260, 560, 0.2], [110, 560, 0.0]];
  spots.forEach(([x, z, r], k) => {
    const type = types[k];
    const dims = { cabin: [9, 7], hut: [6, 5], barn: [14, 10], chapel: [8, 13] }[type];
    const y = flattenPad(x, z, dims[0] / 2 + 3, dims[1] / 2 + 3, r, 10);
    buildings.push({ type, x, z, y, rot: r, w: dims[0], d: dims[1] });
  });
  // garage / off-road rest area at the spawn
  const gy = flattenPad(-60, 290, 18, 13, 0.15, 14);
  buildings.push({ type: 'garage', x: -40, z: 300, y: gy, rot: 0.15, w: 12, d: 9 });
  // remote structures
  const remote = [
    ['hut', 2050, -1020, 0.7, 'Lake Hut'], ['shelter', 2640, -2980, 2.2, 'Tarn Shelter'], ['ruin', 330, -3640, 0.4, 'Pass Ruin'],
    ['cabin', -2460, -520, 1.9, 'Forest Cabin'], ['ruin', 2780, 1250, 1.0, 'Old Mine Hut'], ['hut', -1530, 2560, 0.2, 'Track Hut'],
    ['shelter', 1640, 1180, 0.9, 'Ridge Shelter'], ['hut', -2900, -2000, 0.5, 'Woodcutter Hut'],
  ];
  for (const [type, x, z, rot, name] of remote) {
    const dims = { cabin: [9, 7], hut: [6, 5], shelter: [5, 4], ruin: [8, 6] }[type];
    const y = flattenPad(x, z, dims[0] / 2 + 3, dims[1] / 2 + 3, rot, 9);
    buildings.push({ type, x, z, y, rot, w: dims[0], d: dims[1], name });
  }
}

// ---------------------------------------------------------------- roads (A* with grade limits)
const RN = 1025, RC = 8; // routing grid 8 m
const RH = new Float32Array(RN * RN), RW = new Uint8Array(RN * RN), RS = new Float32Array(RN * RN);
for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) {
  const k = j * N * 2 + i * 2;
  RH[j * RN + i] = H[Math.min(N * N - 1, (j * 2) * N + i * 2)];
  RW[j * RN + i] = waterKind[Math.min(N * N - 1, (j * 2) * N + i * 2)];
}
for (let j = 1; j < RN - 1; j++) for (let i = 1; i < RN - 1; i++) {
  const k = j * RN + i;
  RS[k] = Math.hypot(RH[k + 1] - RH[k - 1], RH[k + RN] - RH[k - RN]) / (2 * RC);
}
// widen water mask by one routing cell so streams are not slipped through diagonally
{
  const w2 = RW.slice();
  for (let j = 1; j < RN - 1; j++) for (let i = 1; i < RN - 1; i++) {
    const k = j * RN + i; if (RW[k]) continue;
    const m = RW[k - 1] || RW[k + 1] || RW[k - RN] || RW[k + RN];
    if (m === 2) w2[k] = 4; // river margin
  }
  RW.set(w2);
}
const roadUse = new Uint8Array(RN * RN);
const NB = [];
for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
  if (!dx && !dz) continue;
  if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
  if ((Math.abs(dx) === 2 && dz === 0) || (Math.abs(dz) === 2 && dx === 0)) continue;
  NB.push([dx, dz, Math.hypot(dx, dz) * RC]);
}
class Heap {
  constructor(n) { this.k = new Int32Array(n); this.v = new Float64Array(n); this.n = 0; }
  push(k, v) { let i = this.n++; this.k[i] = k; this.v[i] = v; while (i > 0) { const p = (i - 1) >> 1; if (this.v[p] <= this.v[i]) break; this.sw(i, p); i = p; } }
  pop() { const k = this.k[0]; this.n--; if (this.n > 0) { this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.n && this.v[l] < this.v[m]) m = l; if (r < this.n && this.v[r] < this.v[m]) m = r; if (m === i) break; this.sw(i, m); i = m; } } return k; }
  sw(a, b) { const tk = this.k[a]; this.k[a] = this.k[b]; this.k[b] = tk; const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv; }
}
const gScore = new Float64Array(RN * RN), came = new Int32Array(RN * RN), closed = new Uint8Array(RN * RN);
function route(a, b, cls) {
  const C = CLASSES[cls];
  gScore.fill(Infinity); came.fill(-1); closed.fill(0);
  const toI = (x, z) => [clamp(Math.round((x + HALF) / RC), 1, RN - 2), clamp(Math.round((z + HALF) / RC), 1, RN - 2)];
  const snap = ([x, z]) => {
    let [bi, bj] = toI(x, z), best = Infinity;
    const [ci, cj] = [bi, bj];
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = ci + di, j = cj + dj; if (i < 9 || j < 9 || i >= RN - 9 || j >= RN - 9) continue;
      const k = j * RN + i; if (RW[k]) continue;
      const sc = RS[k] * 400 + Math.hypot(di, dj) * RC;
      if (sc < best) { best = sc; bi = i; bj = j; }
    }
    return [bi, bj];
  };
  const [si, sj] = snap(a), [ti, tj] = snap(b);
  const s = sj * RN + si, t = tj * RN + ti;
  const heap = new Heap(RN * RN * 4);
  gScore[s] = 0; heap.push(s, 0);
  let it = 0;
  while (heap.n) {
    const k = heap.pop();
    if (closed[k]) continue; closed[k] = 1;
    if (k === t) break;
    if (++it > 6e6) break;
    const i = k % RN, j = (k / RN) | 0;
    for (const [dx, dz, L] of NB) {
      const ii = i + dx, jj = j + dz;
      if (ii < 8 || jj < 8 || ii >= RN - 8 || jj >= RN - 8) continue;
      const kk = jj * RN + ii;
      if (closed[kk]) continue;
      const wk = RW[kk];
      if (wk === 1 || wk === 3) continue; // lakes
      const dh = Math.abs(RH[kk] - RH[k]), g = dh / L;
      let gc = g / C.gmax;
      if (gc > 1.25) continue;
      let c = L * (1 + 5 * gc ** 4 + C.side * RS[kk] ** 2);
      if (wk === 2) c += 380; else if (wk === 4) c += 60;
      if (roadUse[kk]) c *= 0.5;
      const ng = gScore[k] + c;
      if (ng < gScore[kk]) { gScore[kk] = ng; came[kk] = k; heap.push(kk, ng + Math.hypot(ii - ti, jj - tj) * RC * 0.95); }
    }
  }
  if (came[t] < 0) return null;
  const path = [];
  for (let k = t; k !== -1; k = came[k]) path.push(k);
  path.reverse();
  for (const k of path) roadUse[k] = 1;
  return path.map(k => [-HALF + (k % RN) * RC, -HALF + ((k / RN) | 0) * RC]);
}

function smoothPath(pts, iters) {
  let p = pts;
  for (let n = 0; n < iters; n++) {
    const q = [p[0]];
    for (let i = 1; i < p.length - 1; i++) q.push([(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4]);
    q.push(p[p.length - 1]); p = q;
  }
  return p;
}
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - carry;
    while (d <= L) { const t = d / L; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); d += step; }
    carry = L - (d - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const roads = [];
for (const [from, to, cls] of ROUTES) {
  const A = NODES[from], B = NODES[to], straight = Math.hypot(A[0] - B[0], A[1] - B[1]);
  let p = null;
  for (const relax of [1, 1.35, 1.8, 2.5]) {
    const saved = CLASSES[cls].gmax; CLASSES[cls].gmax = saved * relax;
    const snap = roadUse.slice();
    p = route(A, B, cls);
    CLASSES[cls].gmax = saved;
    if (p && p.length * RC < straight * 3.2 + 600) { if (relax > 1) log('  relaxed grade x' + relax, from, to); break; }
    roadUse.set(snap); p = null;
  }
  if (!p) { log('ROUTE FAILED', from, to); continue; }
  let pts = smoothPath(p, 6);
  pts = resample(pts, 2);
  pts = smoothPath(pts, 10);
  pts = resample(pts, 2);
  roads.push({ from, to, cls, pts });
  log('route', from, '->', to, cls, (pts.length * 2 / 1000).toFixed(2), 'km');
}
// road height profiles: smoothed terrain, grade-limited; crossings -> bridges or fords
const bridges = [];
const PRIORITY = { valley: 0, mountain: 1, trail: 2, forest: 3, extreme: 4 };
const doneSamples = new Map(); // 8 m hash of finished road samples -> [x, z, y, halfWidth]
const dsKey = (x, z) => (Math.floor(x / 8) + 2048) * 4096 + (Math.floor(z / 8) + 2048);
for (const r of [...roads].sort((a, b) => PRIORITY[a.cls] - PRIORITY[b.cls])) {
  const C = CLASSES[r.cls];
  let y = r.pts.map(p => hAt(p[0], p[1]));
  const wl = r.pts.map(p => { const [i, j] = idx(p[0], p[1]); return inGrid(i, j) && waterKind[j * N + i] === 2 ? WL[j * N + i] : 0; });
  const sig = r.cls === 'extreme' ? 3 : 7;
  for (let pass = 0; pass < sig; pass++) { const q = y.slice(); for (let i = 1; i < y.length - 1; i++) q[i] = (y[i - 1] + 2 * y[i] + y[i + 1]) / 4; y = q; }
  // crossings (deck / ford heights are locked, then grade limits shape the approaches)
  const locked = new Uint8Array(y.length);
  // intersections / junctions: match the height of roads already profiled
  for (let i = 0; i < y.length; i++) {
    const [px, pz] = r.pts[i];
    let best = null, bd = 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = doneSamples.get(dsKey(px + dx * 8, pz + dz * 8)); if (!a) continue;
      for (const q of a) { const d = Math.hypot(q[0] - px, q[1] - pz); if (d < bd) { bd = d; best = q; } }
    }
    if (best && bd < best[3] + C.w + 1.5) { y[i] = best[2]; locked[i] = 1; }
  }
  const runs = [];
  for (let i = 0; i < wl.length; i++) if (wl[i]) { const last = runs[runs.length - 1]; if (last && i - last[1] <= 3) last[1] = i; else runs.push([i, i]); }
  r.fords = [];
  for (const [a, b] of runs) {
    let s = Infinity; for (let i = a; i <= b; i++) if (wl[i]) s = Math.min(s, wl[i]);
    const span = (b - a + 1) * 2;
    // a road already profiled crosses here (shared junction): reuse its bridge / ford heights
    let shared = false;
    for (let i = a; i <= b; i++) if (locked[i]) shared = true;
    if (shared) { for (let i = Math.max(0, a - 8); i <= Math.min(y.length - 1, b + 8); i++) if (locked[i]) r.pts[i].bridge = 1; continue; }
    if ((r.cls === 'valley' || r.cls === 'mountain') && span >= 4) {
      const i0 = Math.max(0, a - 8), i1 = Math.min(y.length - 1, b + 8);
      const deck = Math.max(s + (span > 12 ? 1.9 : 1.4), Math.min(y[i0], y[i1]) + 0.2);
      for (let i = i0; i <= i1; i++) { y[i] = deck; locked[i] = 1; }
      const A = r.pts[i0], B = r.pts[i1];
      bridges.push({ a: [A[0], deck, A[1]], b: [B[0], deck, B[1]], i0, i1, w: C.w * 2 + 1.2, kind: span > 18 ? 'stone' : 'wood', road: roads.indexOf(r) });
      for (let i = i0; i <= i1; i++) r.pts[i].bridge = 1;
    } else {
      // ford: road dips to 25-35 cm under the surface
      for (let i = Math.max(0, a - 12); i <= Math.min(y.length - 1, b + 12); i++) {
        const t = i < a ? smoothstep(a - 12, a, i) : i > b ? smoothstep(b + 12, b, i) : 1;
        y[i] = lerp(y[i], Math.min(y[i], s - 0.3), t);
        if (i >= a && i <= b) locked[i] = 1;
      }
      r.fords.push([r.pts[(a + b) >> 1][0], s, r.pts[(a + b) >> 1][1]]);
    }
  }
  // approaches: limit grade change per sample too (no crests that launch the car)
  // hard grade limit (2 m spacing): smoothing the plan view tightens hairpins, so the
  // profile is clamped and the difference is taken up by cut-and-fill when carving
  const gl = Math.min(0.42, C.gmax * 1.25) * 2;
  for (let it = 0; it < 4; it++) {
    for (let i = 1; i < y.length; i++) if (!locked[i]) y[i] = Math.min(y[i - 1] + gl, Math.max(y[i - 1] - gl, y[i]));
    for (let i = y.length - 2; i >= 0; i--) if (!locked[i]) y[i] = Math.min(y[i + 1] + gl, Math.max(y[i + 1] - gl, y[i]));
  }
  for (let pass = 0; pass < 3; pass++) { const q = y.slice(); for (let i = 1; i < y.length - 1; i++) if (!locked[i]) q[i] = (y[i - 1] + 2 * y[i] + y[i + 1]) / 4; y = q; }
  r.y = y;
  r.pts.forEach((p, i) => { const k = dsKey(p[0], p[1]); let a = doneSamples.get(k); if (!a) doneSamples.set(k, a = []); a.push([p[0], p[1], y[i], C.w]); });
}
// carve all roads: per-cell nearest road with cut/fill embankments
{
  const best = new Float32Array(N * N).fill(1e9), bY = new Float32Array(N * N), bW = new Float32Array(N * N), bBr = new Uint8Array(N * N);
  for (const r of roads) {
    const w = CLASSES[r.cls].w;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], rad = w + 30;
      const [i0, j0] = idx(Math.min(a[0], b[0]) - rad, Math.min(a[1], b[1]) - rad), [i1, j1] = idx(Math.max(a[0], b[0]) + rad, Math.max(a[1], b[1]) + rad);
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        if (!inGrid(ii, j)) continue;
        const x = -HALF + ii * CELL, z = -HALF + j * CELL;
        let u = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
        const d = Math.hypot(a[0] + u * dx - x, a[1] + u * dz - z), k = j * N + ii;
        if (d < best[k]) { best[k] = d; bY[k] = lerp(r.y[i], r.y[i + 1], u); bW[k] = w; bBr[k] = a.bridge || b.bridge ? 1 : 0; }
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const d = best[k]; if (d > 1e8) continue;
    if (bBr[k] && waterKind[k] === 2) continue; // keep only the water channel open under bridges (banks become abutments)
    const w = bW[k] + 1.2, y = bY[k] - 0.06;
    const diff = Math.abs(H[k] - y), S = clamp(diff * 1.3, 3, 26);
    if (d <= w) H[k] = y;
    else if (d < w + S) H[k] = lerp(y, H[k], smoothstep(0, 1, (d - w) / S));
  }
  globalThis.__roadDist = best;
}
log('roads carved', roads.length, 'bridges', bridges.length, 'fords', roads.reduce((a, r) => a + r.fords.length, 0));

// ---------------------------------------------------------------- masks
const masks = new Uint8Array(N * N * 8);
{
  const roadDist = globalThis.__roadDist;
  // flow accumulation -> wetness (log, blurred)
  const wet = new Float32Array(N * N), sedm = new Float32Array(N * N);
  let fmax = 0; for (let k = 0; k < N * N; k++) fmax = Math.max(fmax, flow[k]);
  for (let k = 0; k < N * N; k++) { wet[k] = Math.log1p(flow[k]) / Math.log1p(fmax * 0.25); sedm[k] = depo[k] / CELL; }
  const blur = (a, r) => { const t = new Float32Array(N * N); for (let pass = 0; pass < r; pass++) { for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; t[k] = (a[k] * 4 + a[k - 1] + a[k + 1] + a[k - N] + a[k + N]) / 8; } a.set(t); } };
  blur(wet, 3); blur(sedm, 2);
  // water proximity (distance transform, two-pass chamfer)
  const wd = new Float32Array(N * N).fill(1e9);
  for (let k = 0; k < N * N; k++) if (waterKind[k]) wd[k] = 0;
  for (let j = 1; j < N; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; wd[k] = Math.min(wd[k], wd[k - 1] + 4, wd[k - N] + 4, wd[k - N - 1] + 5.66, wd[k - N + 1] + 5.66); }
  for (let j = N - 2; j >= 0; j--) for (let i = N - 2; i > 0; i--) { const k = j * N + i; wd[k] = Math.min(wd[k], wd[k + 1] + 4, wd[k + N] + 4, wd[k + N + 1] + 5.66, wd[k + N - 1] + 5.66); }
  const nearBuilding = (x, z) => { for (const b of buildings) if (Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) + 6) return true; return false; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[k];
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const gx = (H[j * N + i1] - H[j * N + i0]) / ((i1 - i0) * CELL), gz = (H[j1 * N + i] - H[j0 * N + i]) / ((j1 - j0) * CELL);
    const slope = Math.hypot(gx, gz);
    const nz = -gz / Math.hypot(gx, gz, 1); // + => facing south (+z), - => facing north
    const rd = roadDist[k];
    const road = rd < 1e8 ? 1 - smoothstep(2.0, 14, rd) : 0;
    const water = 1 - smoothstep(0, 40, wd[k]);
    // snow: altitude, aspect, slope, wind noise; lingering patches in wet hollows
    const snowline = 2660 + 190 * nz + 120 * fbm(S3, x / 700, z / 700, 3) - 90 * wet[k];
    let snow = smoothstep(snowline - 120, snowline + 160, h) * (1 - smoothstep(0.95, 1.6, slope));
    snow = Math.max(snow, smoothstep(2350, 2550, h) * smoothstep(0.55, 0.9, wet[k]) * (nz < 0 ? 1 : 0.4) * (1 - smoothstep(0.6, 1.0, slope)));
    // forest: montane band, moderate slopes, patchy; denser in the Dark Forest valley
    const treeline = 2140 + 110 * fbm(S2, x / 900, z / 900, 3) + 60 * nz;
    const fv = VALLEYS.forest;
    const [dfor] = polyQuery(x, z, fv.pts);
    const forestBoost = 1 - smoothstep(250, 900, dfor);
    let forest = smoothstep(treeline + 40, treeline - 120, h) * smoothstep(1350, 1480, h);
    forest *= 1 - smoothstep(0.75, 1.15, slope);
    const patch = fbm(S4, x / 520, z / 520, 4) + 0.35 * forestBoost + 0.18 * smoothstep(0.08, 0.35, slope) - 0.18 * (1 - smoothstep(0.05, 0.12, slope));
    forest *= smoothstep(-0.12, 0.18, patch);
    forest *= 1 - road * 0.95;
    forest *= 1 - smoothstep(30, 0, wd[k]) * 0.9;
    if (Math.hypot(x - DRIFT.x, z - DRIFT.z) < DRIFT.R * 2.1) forest = 0;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 420) forest *= 0.15;
    if (nearBuilding(x, z)) forest = 0;
    forest = clamp(forest, 0, 1);
    // exposed rock: steep, high, ridged
    const rock = clamp(smoothstep(0.62, 1.1, slope) + smoothstep(2650, 3200, h) * 0.5 * (1 - snow), 0, 1);
    // alpine flowers in meadows
    const flowers = clamp((fbm(S5, x / 140, z / 140, 3) + 0.15) * 2.5, 0, 1) * (1 - forest) * (1 - smoothstep(0.35, 0.6, slope)) * smoothstep(2600, 2300, h) * (1 - road);
    const o = k * 8;
    masks[o] = clamp(wet[k], 0, 1) * 255;
    masks[o + 1] = clamp(sedm[k] * 6, 0, 1) * 255;
    masks[o + 2] = forest * 255;
    masks[o + 3] = clamp(snow, 0, 1) * 255;
    masks[o + 4] = road * 255;
    masks[o + 5] = water * 255;
    masks[o + 6] = flowers * 255;
    masks[o + 7] = rock * 255;
  }
  log('masks');
}

// ---------------------------------------------------------------- far map
const F = new Float32Array(NF * NF);
for (let j = 0; j < NF; j++) {
  const z = -FHALF + j * FCELL;
  for (let i = 0; i < NF; i++) {
    const x = -FHALF + i * FCELL;
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) F[j * NF + i] = hAt(x, z);
    else F[j * NF + i] = macroHeight(x, z);
  }
}
log('far map');

// ---------------------------------------------------------------- write outputs
const u16 = (arr) => { const o = new Uint16Array(arr.length); for (let k = 0; k < arr.length; k++) o[k] = clamp(Math.round(arr[k] / WORLD.hUnit), 0, 65535); return o; };
// delta-encode rows -> much better deflate ratio
function packU16(a, n) {
  const d = new Uint16Array(a.length);
  for (let j = 0; j < n; j++) { let prev = 0; for (let i = 0; i < n; i++) { const k = j * n + i; d[k] = (a[k] - prev) & 0xffff; prev = a[k]; } }
  return zlib.gzipSync(Buffer.from(d.buffer), { level: 9 });
}
const Hq = u16(H), Fq = u16(F), Wq = new Uint16Array(N * N);
for (let k = 0; k < N * N; k++) if (waterKind[k]) Wq[k] = Math.round(WL[k] / WORLD.hUnit);
fs.writeFileSync(OUT + 'height.bin.gz', packU16(Hq, N));
fs.writeFileSync(OUT + 'far.bin.gz', packU16(Fq, NF));
fs.writeFileSync(OUT + 'water.bin.gz', packU16(Wq, N));
// masks at 8 m (box-filtered), quantised to 6 bits: ~4x smaller, plenty for splatting
const MN = WORLD.maskN, masksLo = new Uint8Array(MN * MN * 8);
for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) for (let c = 0; c < 8; c++) {
  let s = 0, n = 0;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const ii = clamp(i * 2 + a, 0, N - 1), jj = clamp(j * 2 + b, 0, N - 1), w = (a ? 1 : 2) * (b ? 1 : 2);
    s += masks[(jj * N + ii) * 8 + c] * w; n += w;
  }
  masksLo[(j * MN + i) * 8 + c] = Math.round(s / n / 4) * 4;
}
fs.writeFileSync(OUT + 'masks.bin.gz', zlib.gzipSync(Buffer.from(masksLo.buffer), { level: 9 }));

// final heights for placed objects use the runtime sampler (bicubic + detail) for exactness
const hf = new HeightField({ height: Hq, masks: masksLo, water: Wq });
for (const b of buildings) b.y = +hf.baseHeight(b.x, b.z).toFixed(2);
const r1 = (v) => Math.round(v * 10) / 10;
const world = {
  version: 1,
  world: WORLD,
  spawn: { ...SPAWN, y: hf.height(SPAWN.x, SPAWN.z) },
  village: VILLAGE,
  regions: [
    ...Object.entries(VALLEYS).map(([id, v]) => ({ id, name: v.name, pts: v.pts.map(p => [p[0], p[1], p[3]]) })),
  ],
  peaks: PEAKS.map(([x, z, h, r, t, name]) => ({ name, x, z, h: r1(hAt(x, z)) })),
  lakes: LAKES.map(L => ({ ...L, shape: Array.from({ length: 96 }, (_, a) => { const ang = a / 96 * Math.PI * 2, rr = lakeRadius(L, ang); return [r1(L.x + Math.cos(ang) * rr), r1(L.z + Math.sin(ang) * rr)]; }) })),
  rivers: riverOut.map(r => ({ id: r.id, name: r.name, falls: r.falls.map(f => ({ ...f, top: f.top.map(r1), bottom: f.bottom.map(r1), drop: r1(f.drop) })), pts: r.samples.map(s => [r1(s.x), r1(s.y), r1(s.z), r1(s.w)]) })),
  roads: roads.map(r => ({ from: r.from, to: r.to, cls: r.cls, w: CLASSES[r.cls].w, surface: CLASSES[r.cls].surface, fords: r.fords.map(f => f.map(r1)), pts: r.pts.map((p, i) => [r1(p[0]), Math.round(r.y[i] * 100) / 100, r1(p[1]), p.bridge ? 1 : 0]) })),
  bridges: bridges.map(b => ({ ...b, a: b.a.map(v => Math.round(v * 100) / 100), b: b.b.map(v => Math.round(v * 100) / 100),
    // physical deck runs 4 samples past each end along the approach profile, covering any skipped channel cells
    pts: roads[b.road].pts.slice(Math.max(0, b.i0 - 4), b.i1 + 5).map((p, k) => [r1(p[0]), Math.round(roads[b.road].y[Math.max(0, b.i0 - 4) + k] * 100) / 100, r1(p[1])]) })),
  buildings,
  drift: { x: DRIFT.x, z: DRIFT.z, y: r1(DRIFT.y), width: DRIFT.width, pts: driftPts.map(p => [r1(p[0]), r1(p[1])]) },
  nodes: NODES,
};
fs.writeFileSync(OUT + 'world.json', JSON.stringify(world));
log('world.json', (fs.statSync(OUT + 'world.json').size / 1024).toFixed(0), 'KB');

// ---------------------------------------------------------------- overview map (minimap)
{
  const S = 1024, img = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = Math.round(x / (S - 1) * (N - 1)), j = Math.round(y / (S - 1) * (N - 1)), k = j * N + i;
    const h = H[k], hx = H[Math.min(k + 1, N * N - 1)] - H[Math.max(0, k - 1)], hz = H[Math.min(k + N, N * N - 1)] - H[Math.max(0, k - N)];
    const shade = clamp(0.75 + (-hx * 0.6 - hz * 0.8) / (2 * CELL) * 0.5, 0.35, 1.25);
    const m = k * 8;
    let c = [0.36, 0.5, 0.25];
    c = c.map((v, q) => lerp(v, [0.5, 0.48, 0.38][q], smoothstep(2200, 2600, h)));
    c = c.map((v, q) => lerp(v, [0.14, 0.27, 0.13][q], masks[m + 2] / 255));
    c = c.map((v, q) => lerp(v, [0.5, 0.49, 0.47][q], masks[m + 7] / 255));
    c = c.map((v, q) => lerp(v, [0.93, 0.95, 0.98][q], masks[m + 3] / 255));
    c = c.map(v => v * shade);
    if (waterKind[k]) c = waterKind[k] === 3 ? [0.75, 0.85, 0.92] : [0.12, 0.5, 0.62];
    if (masks[m + 4] > 200) c = [0.78, 0.66, 0.48];
    const o = (y * S + x) * 3;
    img[o] = clamp(c[0] * 255, 0, 255); img[o + 1] = clamp(c[1] * 255, 0, 255); img[o + 2] = clamp(c[2] * 255, 0, 255);
  }
  await sharp(img, { raw: { width: S, height: S, channels: 3 } }).jpeg({ quality: 86 }).toFile(OUT + 'overview.jpg');
}
for (const f of fs.readdirSync(OUT)) log(f, (fs.statSync(OUT + f).size / 1048576).toFixed(2), 'MB');
let hmin = 1e9, hmax = -1e9; for (let k = 0; k < N * N; k++) { hmin = Math.min(hmin, H[k]); hmax = Math.max(hmax, H[k]); }
let fmin = 1e9, fmax2 = -1e9; for (let k = 0; k < NF * NF; k++) { fmin = Math.min(fmin, F[k]); fmax2 = Math.max(fmax2, F[k]); }
log('core height range', hmin.toFixed(0), hmax.toFixed(0), 'far range', fmin.toFixed(0), fmax2.toFixed(0));
