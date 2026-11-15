// Terrain height field, world layout and collision queries.
// Pure JS (no three.js) so the physics can be tested headless.

export const WORLD = 1600;
export const CELL = 3.2;
export const GN = Math.round(WORLD / CELL);   // cells per side
export const HALF = WORLD / 2;
export const WATER_LEVEL = -0.75;
// water surface height at (x,z): only the oasis lake has water
export function waterAt(x, z) {
  return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.02 ? WATER_LEVEL : -1e9;
}

export const ARENA = { x: 0, z: 10, r: 58 };
export const PARK = { x0: -100, x1: 100, z0: -295, z1: -95 };
export const BOWL = { x: 30, z: 245, r: 46 };
export const LAKE = { x: -225, z: 40, r: 60 };

// new areas (outer ring)
export const HILLS = { x: -420, z: 430, r: 330 };
export const DRIFTLOT = { x0: 300, x1: 520, z0: -530, z1: -350 };
export const STUNT = { x0: 430, x1: 675, z0: -175, z1: 235 };
export const HALFPIPE = { x: 645, z0: -140, z1: 200, w: 20, depth: 8 };
export const CIRCUIT_C = { x: -455, z: -440, r: 190 };

export const SPAWN = { x: 0, z: 90, yaw: Math.PI };

// ---------------------------------------------------------------- noise
function hash2(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// deterministic PRNG for layout
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- route
// Time-trial checkpoints (cp:true) plus road shaping points.
export const ROUTE = [
  { x: 0, z: 66, cp: true },          // start / finish
  { x: 0, z: -68, cp: true },
  { x: 0, z: -151, cp: true, y: 6.2, r: 5.5 },   // over the gap jump
  { x: 0, z: -222, cp: true },
  { x: 55, z: -206 },
  { x: 55, z: -158, cp: true, y: 8, r: 4.8 },     // on the table top
  { x: 70, z: -112 },
  { x: 190, z: -78, cp: true },
  { x: 268, z: 58, cp: true },
  { x: 120, z: 180, cp: true },
  { x: 30, z: 245, cp: true },          // bowl floor
  { x: -95, z: 185, cp: true },
  { x: -225, z: 40, cp: true },          // through the lake
  { x: -150, z: -40, cp: true },
  { x: -95, z: 75 },
  { x: -40, z: 112 },
  { x: 0, z: 118 },
];

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const qx = ax + dx * t, qz = az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}
// connecting dirt roads to the outer areas (open polylines)
export const ROADS = [
  [[-150, -40], [-235, -150], [-300, -300]],
  [[-95, 185], [-190, 275], [-290, 350]],
  [[100, -150], [205, -255], [300, -360]],
  [[268, 58], [360, 42], [440, 30]],
  [[520, -350], [555, -175]],
  [[120, 180], [300, 260], [450, 225]],
];
export function roadDistance(x, z) {
  let d = 1e9;
  for (let i = 0; i < ROUTE.length; i++) {
    const a = ROUTE[i], b = ROUTE[(i + 1) % ROUTE.length];
    d = Math.min(d, distToSeg(x, z, a.x, a.z, b.x, b.z));
  }
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) {
    d = Math.min(d, distToSeg(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  }
  return d;
}

// ---------------------------------------------------------------- race tracks
// Closed Catmull-Rom loops sampled every ~2 m. Terrain under a track is flattened
// across its width to a smoothed centre-line height, so tracks flow over hills.
export const TRACKS = [
  {
    id: 'circuit', name: 'מסלול המרוצים', surface: 'asphalt', hw: 7.5,
    ctrl: [[-300, -300], [-440, -285], [-560, -310], [-610, -380], [-585, -455], [-515, -465], [-485, -515],
      [-500, -565], [-430, -600], [-350, -565], [-320, -485], [-385, -440], [-315, -385]],
  },
  {
    id: 'rally', name: 'מסלול הראלי', surface: 'dirt', hw: 6,
    ctrl: [[-290, 350], [-380, 300], [-490, 318], [-570, 392], [-575, 480], [-510, 550], [-420, 570],
      [-340, 530], [-372, 462], [-292, 450], [-250, 402]],
    jumps: [0.17, 0.43, 0.62, 0.86],
  },
  {
    // paved ring road that links every area of the world
    id: 'ring', name: 'כביש הטבעת', surface: 'asphalt', hw: 5.5, road: true,
    ctrl: [[0, -345], [180, -300], [300, -322], [400, -300], [405, -180], [398, 0], [405, 150], [390, 280],
      [250, 360], [100, 400], [-80, 410], [-200, 322], [-300, 200], [-340, 40], [-330, -120], [-262, -232], [-130, -332]],
  },
];
const TR_CELL = 20;
const trHash = new Map();
function sampleLoop(ctrl, spacing) {
  const n = ctrl.length, dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const out = [dense[0]];
  let prev = dense[0], need = spacing;
  for (let i = 1; i <= dense.length; i++) {
    const cur = dense[i % dense.length];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (seg >= need) {
      const t = need / seg;
      const p = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(p); prev = p;
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      need = spacing;
    }
    need -= seg; prev = cur;
  }
  const last = out[out.length - 1];
  if (Math.hypot(last[0] - out[0][0], last[1] - out[0][1]) < spacing * 0.5) out.pop();
  return out;
}
function buildTracks() {
  trHash.clear();
  TRACKS.forEach((tr, ti) => {
    let P = sampleLoop(tr.ctrl, 2);
    // start line in the middle of the first straight (between the first two control points)
    {
      const mx = (tr.ctrl[0][0] + tr.ctrl[1][0]) / 2, mz = (tr.ctrl[0][1] + tr.ctrl[1][1]) / 2;
      let bi = 0, bd = 1e9;
      P.forEach((p, i) => { const d = Math.hypot(p[0] - mx, p[1] - mz); if (d < bd) { bd = d; bi = i; } });
      P = P.slice(bi).concat(P.slice(0, bi));
    }
    const n = P.length;
    tr.pts = P.map(([x, z]) => ({ x, z, y: 0, tx: 0, tz: 1 }));
    for (let i = 0; i < n; i++) {
      const a = tr.pts[(i - 1 + n) % n], b = tr.pts[(i + 1) % n];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      tr.pts[i].tx = (b.x - a.x) / l; tr.pts[i].tz = (b.z - a.z) / l;
      tr.pts[i].y = rawHeight(tr.pts[i].x, tr.pts[i].z, true);
    }
    // smooth heights along the loop
    for (let pass = 0; pass < (tr.road ? 30 : 8); pass++) {
      const ys = tr.pts.map(p => p.y);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -7; k <= 7; k++) s += ys[(i + k + n) % n];
        tr.pts[i].y = s / 15;
      }
    }
    tr.n = n;
    tr.length = n * 2;
    tr.gates = [0, Math.floor(n / 3), Math.floor(2 * n / 3)];
    // curvature for kerbs
    for (let i = 0; i < n; i++) {
      const a = tr.pts[(i - 3 + n) % n], b = tr.pts[(i + 3) % n];
      const c = a.tx * b.tz - a.tz * b.tx;
      tr.pts[i].curv = c;
    }
    for (let i = 0; i < n; i++) {
      const p = tr.pts[i];
      const r = tr.hw + 16;
      const i0 = Math.floor((p.x - r) / TR_CELL), i1 = Math.floor((p.x + r) / TR_CELL);
      const j0 = Math.floor((p.z - r) / TR_CELL), j1 = Math.floor((p.z + r) / TR_CELL);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
        const k = a * 10007 + b;
        let l = trHash.get(k); if (!l) trHash.set(k, l = []);
        l.push(ti, i);
      }
    }
  });
}
// nearest point on any track centre line (within ~hw+16 m)
const _tq = { d: 1e9, y: 0, track: null, i: 0 };
export function trackNearest(x, z) {
  _tq.d = 1e9; _tq.track = null;
  const l = trHash.get(Math.floor(x / TR_CELL) * 10007 + Math.floor(z / TR_CELL));
  if (!l) return _tq;
  for (let k = 0; k < l.length; k += 2) {
    const tr = TRACKS[l[k]], i = l[k + 1];
    const a = tr.pts[i], b = tr.pts[(i + 1) % tr.n];
    const dx = b.x - a.x, dz = b.z - a.z;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < _tq.d) { _tq.d = d; _tq.y = a.y + (b.y - a.y) * t; _tq.track = tr; _tq.i = i; }
  }
  return _tq;
}

// ---------------------------------------------------------------- height
function rectDist(x, z, R) {
  const dx = Math.max(R.x0 - x, 0, x - R.x1), dz = Math.max(R.z0 - z, 0, z - R.z1);
  return Math.hypot(dx, dz);
}
export function rawHeight(x, z, noTracks = false) {
  let h = (fbm(x * 0.006 + 3.1, z * 0.006 - 1.7, 4) - 0.5) * 16;
  h += (fbm(x * 0.022 + 5, z * 0.022, 3) - 0.5) * 0.9;
  const rc = Math.hypot(x, z);
  // big open rolling hills in the outer ring
  {
    const o = smoothstep(300, 420, rc);
    if (o > 0) {
      const hh = fbm(x * 0.0042 - 7, z * 0.0042 + 2, 3);
      h += o * (Math.pow(hh, 1.6) * 34 - 9);
    }
  }
  // the hills area: taller, smooth hills with long slopes
  {
    const d = Math.hypot(x - HILLS.x, z - HILLS.z);
    const f = 1 - smoothstep(HILLS.r * 0.6, HILLS.r, d);
    if (f > 0) {
      const hh = 0.6 * Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.cos(z * 0.018 + 1.3) + 0.4 * (fbm(x * 0.01, z * 0.01, 3) - 0.5) * 2;
      h += f * hh * 15;
    }
  }
  // race circuit: gentle elevation only
  {
    const d = Math.hypot(x - CIRCUIT_C.x, z - CIRCUIT_C.z);
    h = lerp(h, h * 0.3, 1 - smoothstep(CIRCUIT_C.r, CIRCUIT_C.r + 60, d));
  }

  // east dunes: asymmetric crests
  const de = smoothstep(105, 175, x) * (1 - smoothstep(330, 420, x)) * (1 - smoothstep(330, 420, Math.abs(z)));
  if (de > 0) {
    const warp = fbm(x * 0.012, z * 0.012, 3) * 7;
    const s = Math.sin((x * 0.75 + z * 0.35) * 0.055 + warp);
    h += de * (Math.pow(0.5 + 0.5 * s, 2.4) * 13 - 3);
  }
  // south-west rolling hills
  const sw = 1 - smoothstep(60, 170, Math.hypot(x + 120, z - 210));
  h += sw * (fbm(x * 0.03, z * 0.03, 2) - 0.4) * 6;

  // flatten arena
  {
    const d = Math.hypot(x - ARENA.x, z - ARENA.z);
    h = lerp(h, 0, 1 - smoothstep(ARENA.r + 6, ARENA.r + 40, d));
  }
  // flatten ramp park
  {
    const dx = Math.max(PARK.x0 - x, 0, x - PARK.x1);
    const dz = Math.max(PARK.z0 - z, 0, z - PARK.z1);
    h = lerp(h, 0, 1 - smoothstep(0, 34, Math.hypot(dx, dz)));
  }
  // drift lot + stunt park: flat
  h = lerp(h, 0, 1 - smoothstep(0, 40, rectDist(x, z, DRIFTLOT)));
  h = lerp(h, 0, 1 - smoothstep(0, 40, rectDist(x, z, STUNT)));
  // halfpipe channel in the stunt park
  {
    const dx = Math.abs(x - HALFPIPE.x);
    if (dx < HALFPIPE.w) {
      const along = Math.min(smoothstep(HALFPIPE.z0 - 25, HALFPIPE.z0, z), 1 - smoothstep(HALFPIPE.z1, HALFPIPE.z1 + 25, z));
      const t = Math.max(0, (dx - 5) / (HALFPIPE.w - 5));
      h = Math.min(h, -HALFPIPE.depth * (1 - (1 - Math.cos(Math.PI * t)) / 2) * along);
    }
  }
  // bowl
  {
    const d = Math.hypot(x - BOWL.x, z - BOWL.z);
    if (d < BOWL.r) {
      const t = Math.max(0, Math.min(1, (d - 16) / (BOWL.r - 16)));
      h = -10 + 11 * (1 - Math.cos(Math.PI * t)) / 2;
    } else {
      h = lerp(1, h, smoothstep(BOWL.r, BOWL.r + 26, d));
    }
  }
  // lake basin
  {
    const d = Math.hypot(x - LAKE.x, z - LAKE.z);
    const f = 1 - smoothstep(LAKE.r * 0.45, LAKE.r, d);
    h = lerp(h, -1.75, f);
  }
  // tracks: flatten across the width to the smoothed centre line
  if (!noTracks) {
    const q = trackNearest(x, z);
    if (q.track) {
      const f = 1 - smoothstep(q.track.hw + 1, q.track.hw + 14, q.d);
      if (f > 0) h = lerp(h, q.y, f);
    }
  }
  // boundary mountains
  {
    const r = mountainR(x, z);
    const m = smoothstep(715, 790, r);
    if (m > 0) {
      const ridge = 1 - Math.abs(fbm(x * 0.012, z * 0.012, 4) * 2 - 1);
      h += m * m * (22 + 55 * ridge + 18 * fbm(x * 0.04, z * 0.04, 3));
    }
  }
  return h;
}

export function mountainR(x, z) { return Math.max(Math.hypot(x, z) * 0.93, Math.max(Math.abs(x), Math.abs(z))); }

// ---------------------------------------------------------------- grid
export const grid = new Float32Array((GN + 1) * (GN + 1));
export function buildGrid() {
  for (let j = 0; j <= GN; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i <= GN; i++) {
      grid[j * (GN + 1) + i] = rawHeight(-HALF + i * CELL, z);
    }
  }
}

// Triangle interpolation that exactly matches the rendered mesh:
// each cell is split along the diagonal (i+1,j)-(i,j+1).
const _n = { x: 0, y: 1, z: 0 };
export function terrainHeight(x, z, nOut) {
  let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
  if (fx < 0) fx = 0; if (fz < 0) fz = 0;
  if (fx > GN - 1e-4) fx = GN - 1e-4; if (fz > GN - 1e-4) fz = GN - 1e-4;
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const W = GN + 1;
  const h00 = grid[j * W + i], h10 = grid[j * W + i + 1];
  const h01 = grid[(j + 1) * W + i], h11 = grid[(j + 1) * W + i + 1];
  let h, dhdx, dhdz;
  if (u + v <= 1) {
    dhdx = (h10 - h00); dhdz = (h01 - h00);
    h = h00 + dhdx * u + dhdz * v;
  } else {
    dhdx = (h11 - h01); dhdz = (h11 - h10);
    h = h11 - dhdx * (1 - u) - dhdz * (1 - v);
  }
  if (nOut) {
    const nx = -dhdx / CELL, nz = -dhdz / CELL;
    const l = Math.hypot(nx, 1, nz);
    nOut.x = nx / l; nOut.y = 1 / l; nOut.z = nz / l;
  }
  return h;
}

// ---------------------------------------------------------------- colliders
// Convex prisms built from a 2D profile segment, extruded across a width.
// Local frame: u along ramp direction f=(sin yaw,0,cos yaw), w across s=(cos yaw,0,-sin yaw).
export const colliders = [];
export const rampDefs = [];   // render descriptions

function makePrism(cx, cy, cz, yaw, ua, ya, ub, yb, W, base, surface) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const sx = Math.cos(yaw), sz = -Math.sin(yaw);
  const planes = [];
  const add = (nu, ny, nw, dLocal) => {
    // world normal
    const nx = fx * nu + sx * nw, nz = fz * nu + sz * nw;
    const l = Math.hypot(nx, ny, nz);
    const d = (dLocal + nx * cx + ny * cy + nz * cz) / l;
    planes.push({ x: nx / l, y: ny / l, z: nz / l, d });
  };
  const s = (yb - ya) / (ub - ua);
  add(-s, 1, 0, ya - s * ua);          // top (index 0)
  add(0, -1, 0, -base);                 // bottom
  add(-1, 0, 0, -ua);                   // front
  add(1, 0, 0, ub);                     // back
  add(0, 0, 1, W / 2);                  // side
  add(0, 0, -1, W / 2);                 // side
  // aabb
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const u of [ua, ub]) for (const w of [-W / 2, W / 2]) {
    const px = cx + fx * u + sx * w, pz = cz + fz * u + sz * w;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  colliders.push({
    planes, surface,
    minX, maxX, minZ, maxZ,
    minY: cy + base, maxY: cy + Math.max(ya, yb),
  });
}

// profile: array of [u, y] from front to back (y relative to cy)
function addRamp(cx, cz, yaw, W, profile, opts = {}) {
  const cy = opts.cy ?? 0;
  const base = -1.5;
  for (let k = 0; k < profile.length - 1; k++) {
    const [ua, ya] = profile[k], [ub, yb] = profile[k + 1];
    makePrism(cx, cy, cz, yaw, ua, ya, ub, yb, W, base, opts.surface || 'ramp');
  }
  if (!opts.noRender) rampDefs.push({ cx, cy, cz, yaw, W, profile, base, style: opts.style || 'ramp' });
}

function wedge(cx, cz, yaw, W, L, H, opts) {
  addRamp(cx, cz, yaw, W, [[-L / 2, 0.02], [L / 2, H]], opts);
}
function box(cx, cz, yaw, W, L, H, opts) {
  addRamp(cx, cz, yaw, W, [[-L / 2, H], [L / 2, H]], { style: 'box', ...opts });
}
function kicker(cx, cz, yaw, W, L, H, p, segs = 7, opts) {
  const prof = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    prof.push([-L / 2 + L * t, Math.max(0.02, H * Math.pow(t, p))]);
  }
  addRamp(cx, cz, yaw, W, prof, opts);
}

// cylinders: rocks, cacti, palms, poles  {x,z,r,y0,h}
export const cylinders = [];
const CYL_CELL = 16;
const cylHash = new Map();
export function addCylinder(c) {
  cylinders.push(c);
  const i0 = Math.floor((c.x - c.r) / CYL_CELL), i1 = Math.floor((c.x + c.r) / CYL_CELL);
  const j0 = Math.floor((c.z - c.r) / CYL_CELL), j1 = Math.floor((c.z + c.r) / CYL_CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = i * 10007 + j;
    if (!cylHash.has(k)) cylHash.set(k, []);
    cylHash.get(k).push(c);
  }
}
export function cylindersNear(x, z) {
  return cylHash.get(Math.floor(x / CYL_CELL) * 10007 + Math.floor(z / CYL_CELL));
}

const COL_CELL = 24;
const colHash = new Map();
const EMPTY = [];
function indexColliders() {
  colHash.clear();
  for (const c of colliders) {
    for (let i = Math.floor(c.minX / COL_CELL); i <= Math.floor(c.maxX / COL_CELL); i++)
      for (let j = Math.floor(c.minZ / COL_CELL); j <= Math.floor(c.maxZ / COL_CELL); j++) {
        const k = i * 10007 + j;
        let l = colHash.get(k); if (!l) colHash.set(k, l = []);
        l.push(c);
      }
  }
}
function collidersNear(x, z) {
  return colHash.get(Math.floor(x / COL_CELL) * 10007 + Math.floor(z / COL_CELL)) || EMPTY;
}

export const boostPads = [];
export const tireStacks = [];
export const grandstands = [];
export const PI = Math.PI;

export function buildLayout() {
  colliders.length = 0; rampDefs.length = 0; boostPads.length = 0;
  const N = PI; // heading north (-Z)

  // --- Ramp park --------------------------------------------------
  // small kickers row
  for (const x of [-62, -30, 30, 62]) kicker(x, -118, N, 6, 7, 1.5, 1.6, 5);
  // medium gap jump (center lane)
  kicker(0, -134, N, 9, 13, 3.3, 1.5, 6);
  wedge(0, -172, 0, 12, 24, 3.3);
  boostPads.push({ x: 0, z: -103, yaw: N });
  // mega ramp (left lane)
  kicker(-58, -146, N, 10, 22, 6.8, 1.7, 8);
  box(-58, -197, N, 15, 30, 7.0, { style: 'box' });
  wedge(-58, -230, 0, 15, 36, 7.0);
  boostPads.push({ x: -58, z: -108, yaw: N });
  // table top (right lane)
  wedge(56, -140, N, 11, 12, 4);
  box(56, -158, N, 11, 24, 4);
  wedge(56, -176, 0, 11, 12, 4);
  // whoops / rollers on the far right
  for (let k = 0; k < 9; k++) {
    const z = -112 - k * 11;
    addRamp(88, z, N, 8, [[-3, 0.02], [0, 1.0], [3, 0.02]], { style: 'roller' });
  }
  // rollers on far left
  for (let k = 0; k < 7; k++) {
    const z = -120 - k * 14;
    addRamp(-90, z, N, 8, [[-4, 0.02], [0, 1.4], [4, 0.02]], { style: 'roller' });
  }
  // quarter pipes at the end of the park
  kicker(0, -279, N, 34, 9, 5.5, 2.2, 9, { style: 'qp' });
  kicker(-62, -279, N, 26, 9, 5.5, 2.2, 9, { style: 'qp' });
  kicker(62, -279, N, 26, 9, 5.5, 2.2, 9, { style: 'qp' });

  // --- Arena: a couple of small jumps on the edge -------------------
  kicker(-48, 40, -PI / 2, 7, 8, 1.6, 1.6, 5);
  kicker(48, -20, PI / 2, 7, 8, 1.6, 1.6, 5);

  // --- Dunes: launch ramps on the way -------------------------------
  {
    const x = 132, z = -95, yaw = Math.atan2(190 - 70, -78 + 112);
    const cy = terrainHeight(x, z);
    kicker(x, z, yaw, 8, 12, 3.2, 1.6, 6, { cy });
    boostPads.push({ x: x - Math.sin(yaw) * 26, z: z - Math.cos(yaw) * 26, yaw });
  }
  // bowl rim launcher (jump into the bowl)
  {
    const x = 92, z = 205, yaw = Math.atan2(30 - 120, 245 - 180);
    const cy = terrainHeight(x, z);
    kicker(x, z, yaw, 8, 10, 2.6, 1.6, 6, { cy });
  }
  // west hill kicker before the lake
  {
    const x = -160, z = 110, yaw = Math.atan2(-225 + 95, 40 - 185);
    const cy = terrainHeight(x, z);
    kicker(x, z, yaw, 8, 10, 2.4, 1.6, 6, { cy });
  }
  boostPads.push({ x: -40, z: 52, yaw: Math.atan2(150, 60) - PI });
  boostPads.push({ x: 228, z: -10, yaw: Math.atan2(268 - 190, 58 + 78) });

  // --- Stunt park ----------------------------------------------------
  // giant ski jump with a long landing
  kicker(510, 178, N, 12, 30, 9, 1.8, 10);
  wedge(510, 86, 0, 18, 56, 9);
  boostPads.push({ x: 510, z: 222, yaw: N });
  // jump line: kickers that grow
  [[188, 1.6, 8], [140, 2.3, 9], [92, 3.0, 10], [44, 3.8, 11], [-4, 4.6, 12]].forEach(([z, H, L]) => kicker(458, z, N, 8, L, H, 1.6, 6));
  // spine
  wedge(480, -55, N, 12, 10, 3.6);
  wedge(480, -65, 0, 12, 10, 3.6);
  // fun box (pyramid): table with ramps on four sides
  box(565, -60, 0, 18, 18, 3.6);
  wedge(565, -44, N, 18, 14, 3.6);
  wedge(565, -76, 0, 18, 14, 3.6);
  wedge(581, -60, -PI / 2, 18, 14, 3.6);
  wedge(549, -60, PI / 2, 18, 14, 3.6);
  // step-up
  kicker(525, -110, N, 12, 12, 2.6, 1.6, 6);
  box(525, -138, N, 14, 22, 3.2);
  wedge(525, -158, 0, 14, 18, 3.2);
  // quarter pipes facing the park on the north edge
  kicker(560, 205, 0, 30, 9, 5.5, 2.2, 9, { style: 'qp' });
  boostPads.push({ x: 458, z: 225, yaw: N });

  // --- Drift lot: a few low kickers on the edge ---------------------
  kicker(505, -440, PI / 2, 8, 8, 1.6, 1.6, 5);

  // --- Rally track jumps ----------------------------------------------
  for (const tr of TRACKS) {
    if (!tr.jumps) continue;
    for (const f of tr.jumps) {
      // pick the straightest stretch near the requested spot (take-off + landing zone)
      let i = Math.floor(f * tr.n), bestScore = 1e9;
      for (let c = i - 45; c <= i + 45; c++) {
        let m = 0;
        for (let k = -6; k <= 40; k++) m = Math.max(m, Math.abs(tr.pts[(c + k + tr.n) % tr.n].curv));
        if (m < bestScore) { bestScore = m; i = (c + tr.n) % tr.n; }
      }
      const p = tr.pts[i];
      const yaw = Math.atan2(p.tx, p.tz);
      // follow the track's slope so the lip sits flush with the ground
      const a = tr.pts[(i - 3 + tr.n) % tr.n], c = tr.pts[(i + 3) % tr.n];
      const sl = (c.y - a.y) / 12, L = 9, H = 1.9;
      const prof = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6, u = -L / 2 + L * t; prof.push([u, sl * u + Math.max(0.03, H * Math.pow(t, 1.6))]); }
      addRamp(p.x, p.z, yaw, tr.hw * 2 + 3, prof, { cy: p.y - 0.03, style: 'roller' });
    }
  }
  // --- Circuit: tyre stacks on the outside of tight corners ----------
  tireStacks.length = 0;
  for (const tr of TRACKS) {
    if (tr.surface !== 'asphalt' || tr.road) continue;
    for (let i = 0; i < tr.n; i += 3) {
      const p = tr.pts[i];
      if (Math.abs(p.curv) < 0.05) continue;
      const side = Math.sign(p.curv);          // curving left => outside is right
      const ox = p.tz * side, oz = -p.tx * side;
      const x = p.x + ox * (tr.hw + 11), z = p.z + oz * (tr.hw + 11);
      const q = trackNearest(x, z);
      if (q.d < tr.hw + 8) continue;
      const y = terrainHeight(x, z);
      tireStacks.push({ x, z, y });
      addCylinder({ x, z, r: 0.75, y0: y - 1, h: 2.2 });
    }
  }
  // --- Circuit grandstands along the main straight -------------------
  grandstands.length = 0;
  {
    const tr = TRACKS[0];
    for (const i of [22, 48]) {
      const p = tr.pts[i];
      // side away from the circuit centre
      let ox = p.tz, oz = -p.tx;
      if ((p.x + ox - CIRCUIT_C.x) ** 2 + (p.z + oz - CIRCUIT_C.z) ** 2 < (p.x - CIRCUIT_C.x) ** 2 + (p.z - CIRCUIT_C.z) ** 2) { ox = -ox; oz = -oz; }
      const d = tr.hw + 20;
      const x = p.x + ox * d, z = p.z + oz * d;
      const yaw = Math.atan2(-ox, -oz);         // seats face the track
      const y = terrainHeight(x, z);
      grandstands.push({ x, z, y, yaw, L: 34, D: 9, H: 6 });
      box(x, z, yaw, 34, 9, 6, { cy: y, noRender: true });
    }
  }
  boostPads.length = 0;     // open world: no glowing boost pads
  indexColliders();

  // --- scenery cylinders (rocks, cacti, palms) ----------------------
  scenery.rocks.length = 0; scenery.cacti.length = 0; scenery.palms.length = 0;
  const R = rng(1337);
  const clear = (x, z, pad) => {
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 25 + pad) return false;
    if (x > PARK.x0 - 22 - pad && x < PARK.x1 + 22 + pad && z > PARK.z0 - 22 - pad && z < PARK.z1 + 22 + pad) return false;
    if (Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r + 12 + pad) return false;
    if (roadDistance(x, z) < 14 + pad) return false;
    if (mountainR(x, z) > 700) return false;
    if (rectDist(x, z, DRIFTLOT) < 25 + pad || rectDist(x, z, STUNT) < 25 + pad) return false;
    if (trackNearest(x, z).d < TRACKS[0].hw + 14 + pad) return false;
    for (const c of colliders) if (x > c.minX - 12 && x < c.maxX + 12 && z > c.minZ - 12 && z < c.maxZ + 12) return false;
    return true;
  };
  let tries = 0;
  while (scenery.rocks.length < 260 && tries++ < 12000) {
    const x = (R() - 0.5) * 1480, z = (R() - 0.5) * 1480;
    if (!clear(x, z, 2)) continue;
    const s = 0.6 + Math.pow(R(), 2.2) * 3.4;
    const y = terrainHeight(x, z);
    scenery.rocks.push({ x, z, y, s, rot: R() * PI * 2, tilt: R() });
    if (s > 2.0) addCylinder({ x, z, r: s * 0.9, y0: y - 1, h: s * 1.3 + 1 });   // only big boulders are solid
  }
  tries = 0;
  while (scenery.cacti.length < 330 && tries++ < 14000) {
    const x = (R() - 0.5) * 1480, z = (R() - 0.5) * 1480;
    if (!clear(x, z, 0)) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 10) continue;
    const y = terrainHeight(x, z);
    if (y > 22) continue;
    const s = 0.8 + R() * 0.9;
    scenery.cacti.push({ x, z, y, s, rot: R() * PI * 2, arms: R() });
    // cacti are soft: the buggy bursts through them (see main.js)
  }
  // palms around the lake
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * PI * 2 + R() * 0.15;
    const rr = LAKE.r * (0.78 + R() * 0.35);
    const x = LAKE.x + Math.cos(a) * rr, z = LAKE.z + Math.sin(a) * rr;
    if (roadDistance(x, z) < 9) continue;
    const y = terrainHeight(x, z);
    const s = 0.85 + R() * 0.5;
    scenery.palms.push({ x, z, y, s, rot: R() * PI * 2, lean: (R() - 0.5) * 0.4 });
    addCylinder({ x, z, r: 0.4, y0: y - 1, h: 9 * s });
  }
}
export const scenery = { rocks: [], cacti: [], palms: [] };

// ---------------------------------------------------------------- queries
function prismTop(c, x, z) {
  const P = c.planes;
  for (let k = 2; k < 6; k++) { // vertical planes
    const p = P[k];
    if (p.x * x + p.z * z > p.d + 1e-6) return null;
  }
  const t = P[0];
  return (t.d - t.x * x - t.z * z) / t.y;
}

// Ground directly under (x,z), ignoring surfaces higher than maxY.
// Returns height; fills out.n (normal) and out.surface.
export function groundQuery(x, z, maxY, out) {
  let h = terrainHeight(x, z, out.n);
  out.surface = 'terrain';
  const CL = collidersNear(x, z);
  for (let i = 0; i < CL.length; i++) {
    const c = CL[i];
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    const t = prismTop(c, x, z);
    if (t !== null && t > h && t <= maxY) {
      h = t;
      out.n.x = c.planes[0].x; out.n.y = c.planes[0].y; out.n.z = c.planes[0].z;
      out.surface = c.surface;
    }
  }
  out.h = h;
  return h;
}

// Penetration of a point into solid geometry. Returns depth (>0 if inside)
// and fills out.n with the push-out direction.
const _tn = { x: 0, y: 1, z: 0 };
export function pointPenetration(x, y, z, out) {
  let best = 0;
  // terrain
  const th = terrainHeight(x, z, _tn);
  if (th > y) {
    best = (th - y) * _tn.y;
    out.n.x = _tn.x; out.n.y = _tn.y; out.n.z = _tn.z;
    out.kind = 'ground';
  }
  // prisms
  const CL = collidersNear(x, z);
  for (let i = 0; i < CL.length; i++) {
    const c = CL[i];
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ || y > c.maxY || y < c.minY) continue;
    let minPen = 1e9, mp = null;
    let inside = true;
    for (let k = 0; k < 6; k++) {
      const p = c.planes[k];
      const pen = p.d - (p.x * x + p.y * y + p.z * z);
      if (pen < 0) { inside = false; break; }
      if (k === 1) continue; // never push down through the bottom
      if (pen < minPen) { minPen = pen; mp = p; }
    }
    if (inside && mp && minPen > best) {
      best = minPen;
      out.n.x = mp.x; out.n.y = mp.y; out.n.z = mp.z;
      out.kind = mp === c.planes[0] ? 'ground' : 'wall';
    }
  }
  // cylinders
  const list = cylindersNear(x, z);
  if (list) for (const c of list) {
    if (y < c.y0 || y > c.y0 + c.h) continue;
    const dx = x - c.x, dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < c.r) {
      const pen = c.r - d;
      if (pen > best) {
        best = pen;
        const l = d > 1e-5 ? d : 1;
        out.n.x = d > 1e-5 ? dx / l : 1; out.n.y = 0; out.n.z = d > 1e-5 ? dz / l : 0;
        out.kind = 'wall';
      }
    }
  }
  return best;
}

export function surfaceAt(x, z) {
  const q = trackNearest(x, z);
  if (q.track && q.d < q.track.hw + 0.3) return q.track.surface;
  if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r) return 'asphalt';
  if (x > DRIFTLOT.x0 && x < DRIFTLOT.x1 && z > DRIFTLOT.z0 && z < DRIFTLOT.z1) return 'asphalt';
  if (x > PARK.x0 - 4 && x < PARK.x1 + 4 && z > PARK.z0 - 4 && z < PARK.z1 + 4) return 'dirt';
  if (x > STUNT.x0 - 4 && x < STUNT.x1 + 4 && z > STUNT.z0 - 4 && z < STUNT.z1 + 4) return 'dirt';
  if (Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r) return 'concrete';
  return 'sand';
}
// lateral grip per surface (drive / braking are not limited by surface)
export const GRIP = { asphalt: 1.0, concrete: 1.0, ramp: 1.0, dirt: 0.94, sand: 0.9 };
// areas where drifting scores double
export function driftZone(x, z) {
  return Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 4 ||
    (x > DRIFTLOT.x0 && x < DRIFTLOT.x1 && z > DRIFTLOT.z0 && z < DRIFTLOT.z1);
}

// named areas: shown when entered, and reachable from the pause menu
export const ZONES = [];
function buildZones() {
  const tStart = (tr) => { const p = tr.pts[tr.n - 12]; return { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) }; };
  const inRect = (R, m = 0) => (x, z) => x > R.x0 - m && x < R.x1 + m && z > R.z0 - m && z < R.z1 + m;
  ZONES.length = 0;
  ZONES.push(
    { id: 'arena', name: 'זירת הדריפט', sub: 'דריפט x2', ...SPAWN, inside: (x, z) => Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 6 },
    { id: 'park', name: 'פארק הרמפות', sub: 'קפיצות ופעלולים', x: 0, z: -78, yaw: PI, inside: inRect(PARK, 6) },
    { id: 'stunt', name: 'פארק הפעלולים', sub: 'קפיצת סקי, חצי-צינור, ספיין', x: 510, z: 228, yaw: PI, inside: inRect(STUNT, 6) },
    { id: 'circuit', name: 'מסלול המרוצים', sub: 'אספלט · מדידת הקפה', ...tStart(TRACKS[0]), inside: (x, z) => { const q = trackNearest(x, z); return q.track === TRACKS[0] && q.d < 30; } },
    { id: 'rally', name: 'מסלול הראלי', sub: 'עפר וגבעות · מדידת הקפה', ...tStart(TRACKS[1]), inside: (x, z) => { const q = trackNearest(x, z); return q.track === TRACKS[1] && q.d < 25; } },
    { id: 'drift', name: 'מגרש הדריפטים', sub: 'דריפט x2', x: 410, z: -330, yaw: PI, inside: inRect(DRIFTLOT, 4) },
    { id: 'hills', name: 'הגבעות', sub: 'שטח פתוח', x: -250, z: 520, yaw: -PI / 2, inside: (x, z) => Math.hypot(x - HILLS.x, z - HILLS.z) < HILLS.r * 0.8 },
    { id: 'dunes', name: 'הדיונות', sub: 'חול רך', x: 180, z: -40, yaw: 0.6, inside: (x, z) => x > 150 && x < 360 && Math.abs(z) < 300 },
    { id: 'bowl', name: 'הקערה', sub: 'קיר בטון', x: 30, z: 180, yaw: 0, inside: (x, z) => Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r + 4 },
    { id: 'lake', name: 'נווה המדבר', sub: 'מים ודקלים', x: -150, z: 40, yaw: -PI / 2, inside: (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 8 },
  );
}

export function initWorld() {
  buildTracks();
  buildGrid();
  buildLayout();
  buildZones();
}
