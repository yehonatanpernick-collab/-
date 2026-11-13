// Terrain height field, world layout and collision queries.
// Pure JS (no three.js) so the physics can be tested headless.

export const WORLD = 840;
export const CELL = 2.5;
export const GN = Math.round(WORLD / CELL);   // cells per side
export const HALF = WORLD / 2;
export const WATER_LEVEL = -0.75;

export const ARENA = { x: 0, z: 10, r: 58 };
export const PARK = { x0: -100, x1: 100, z0: -295, z1: -95 };
export const BOWL = { x: 30, z: 245, r: 46 };
export const LAKE = { x: -225, z: 40, r: 60 };

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
export function roadDistance(x, z) {
  let d = 1e9;
  for (let i = 0; i < ROUTE.length; i++) {
    const a = ROUTE[i], b = ROUTE[(i + 1) % ROUTE.length];
    d = Math.min(d, distToSeg(x, z, a.x, a.z, b.x, b.z));
  }
  return d;
}

// ---------------------------------------------------------------- height
export function rawHeight(x, z) {
  let h = (fbm(x * 0.006 + 3.1, z * 0.006 - 1.7, 4) - 0.5) * 16;
  h += (fbm(x * 0.022 + 5, z * 0.022, 3) - 0.5) * 2.6;

  // east dunes: asymmetric crests
  const de = smoothstep(105, 175, x);
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
  // boundary mountains
  {
    const r = Math.max(Math.hypot(x, z) * 0.93, Math.max(Math.abs(x), Math.abs(z)));
    const m = smoothstep(318, 400, r);
    if (m > 0) {
      const ridge = 1 - Math.abs(fbm(x * 0.012, z * 0.012, 4) * 2 - 1);
      h += m * m * (22 + 55 * ridge + 18 * fbm(x * 0.04, z * 0.04, 3));
    }
  }
  return h;
}

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
  rampDefs.push({ cx, cy, cz, yaw, W, profile, base, style: opts.style || 'ramp' });
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

export const boostPads = [];
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

  // --- scenery cylinders (rocks, cacti, palms) ----------------------
  scenery.rocks.length = 0; scenery.cacti.length = 0; scenery.palms.length = 0;
  const R = rng(1337);
  const clear = (x, z, pad) => {
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 25 + pad) return false;
    if (x > PARK.x0 - 22 - pad && x < PARK.x1 + 22 + pad && z > PARK.z0 - 22 - pad && z < PARK.z1 + 22 + pad) return false;
    if (Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r + 12 + pad) return false;
    if (roadDistance(x, z) < 14 + pad) return false;
    if (Math.hypot(x, z) > 380) return false;
    for (const c of colliders) if (x > c.minX - 12 && x < c.maxX + 12 && z > c.minZ - 12 && z < c.maxZ + 12) return false;
    return true;
  };
  let tries = 0;
  while (scenery.rocks.length < 110 && tries++ < 5000) {
    const x = (R() - 0.5) * 760, z = (R() - 0.5) * 760;
    if (!clear(x, z, 2)) continue;
    const s = 0.6 + Math.pow(R(), 2.2) * 3.4;
    const y = terrainHeight(x, z);
    scenery.rocks.push({ x, z, y, s, rot: R() * PI * 2, tilt: R() });
    if (s > 0.9) addCylinder({ x, z, r: s * 0.95, y0: y - 1, h: s * 1.4 + 1 });
  }
  tries = 0;
  while (scenery.cacti.length < 140 && tries++ < 6000) {
    const x = (R() - 0.5) * 760, z = (R() - 0.5) * 760;
    if (!clear(x, z, 0)) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 10) continue;
    const y = terrainHeight(x, z);
    if (y > 12) continue;
    const s = 0.8 + R() * 0.9;
    scenery.cacti.push({ x, z, y, s, rot: R() * PI * 2, arms: R() });
    addCylinder({ x, z, r: 0.45 * s, y0: y - 1, h: 4.5 * s });
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
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
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
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
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
  if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r) return 'asphalt';
  if (x > PARK.x0 - 4 && x < PARK.x1 + 4 && z > PARK.z0 - 4 && z < PARK.z1 + 4) return 'dirt';
  return 'sand';
}

export function initWorld() {
  buildGrid();
  buildLayout();
}
