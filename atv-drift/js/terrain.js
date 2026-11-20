// Terrain height field, world layout and collision queries.
// Pure JS (no three.js) so the physics can be tested headless.

export const WORLD = 3000;
export const CELL = 4;
export const GN = Math.round(WORLD / CELL);   // cells per side
export const HALF = WORLD / 2;
export const WATER_LEVEL = -0.75;
// water surface height at (x,z): only the oasis lake has water
export function waterAt(x, z) {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.02) return WATER_LEVEL;
  return -1e9;
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
// new big stunt zones
export const MEGA = { x0: -205, x1: 420, z0: 470, z1: 680 };         // south: giant jumps, sky tower, containers
export const NSTUNT = { x0: -200, x1: 260, z0: -680, z1: -440 };     // north: canyon gap, bus jumps, star, drop
export const CANYON = { cz: -585, hw: 17, depth: 16, x0: -10, x1: 240 };
// west: the special stunt park (banks, trampolines, turntables, rooftops, car jumps)
export const SPECIAL = { x0: -650, x1: -415, z0: -170, z1: 230 };

// ---- far areas (outer ring of the big world)
// Volcano: a Kilimanjaro-sized cone, 5,895 m (real metres, altitude = world height), climbed by a ~29 km logarithmic-spiral trail.
// It sits far east of the main world; the world itself is unbounded (analytic terrain outside the grid).
export const BOUND = 60000;
const LANE_KICK = 500;
export const VOLCANO = { x: 9400, z: 0, R: 8000, rr: 600, H: 5895, depth: 200, hw: 10, Rs: 7800, Re: 720, phiMax: 9.6, p: 1.15 };
VOLCANO.b = Math.log(VOLCANO.Rs / VOLCANO.Re) / VOLCANO.phiMax;
VOLCANO.phi0 = Math.PI;                                     // the road starts on the west side, facing the old world
VOLCANO.theta = VOLCANO.phi0 + VOLCANO.phiMax;              // angle of the summit plaza = the giant descent lane
// the tropical volcano: a green, jungle-covered cone far to the west, with its own spiral trail
export const TROPIC = { x: -6200, z: 0, R: 3400, rr: 240, H: 2100, depth: 70, hw: 9, Rs: 3300, Re: 300, phiMax: 7.0, p: 1.25 };
TROPIC.b = Math.log(TROPIC.Rs / TROPIC.Re) / TROPIC.phiMax;
TROPIC.phi0 = 0;                                            // the road starts on the east side, facing the old world
export const ALT0 = 0, ALT_PER_M = 1;
export const altitudeOf = (y) => Math.round(ALT0 + y * ALT_PER_M);
export const SALT = { x0: 1e9, x1: 1e9 + 1, z0: 1e9, z1: 1e9 + 1 };            // removed: only the original map and the volcano remain       // white salt flats: speed + jumps
export const FOREST = { x: 1e9, z: 1e9, r: 380 };                  // pine hills with a rally loop
export const COAST = { x: -1e9 };
// far wild areas, each on its own highway
export const ICE = { x: 1e9, z: 1e9, r: 1250 };                       // frozen lake: ice is slippery
export const MESA = { x: 1e9, z: 1e9, r: 1700 };                      // badlands of giant mesas
export const MOON = { x: 1e9, z: 1e9, r: 1900 };                     // low-gravity craters
export const CITY = { x: 1e9, z: 1e9, h: 520 };                       // neon city with rooftop jumps
const MESAS = [[0, 0, 230, 120], [520, -330, 180, 96], [-460, 280, 200, 140], [760, 380, 150, 82], [-860, -360, 170, 110], [220, 760, 210, 100], [-120, -880, 190, 72]];
const CRATERS = (() => { const R = rng(99), out = []; for (let i = 0; i < 46; i++) { const a = R() * 6.283, d = Math.sqrt(R()) * 1500; out.push({ x: MOON.x + Math.cos(a) * d, z: MOON.z + Math.sin(a) * d, r: 40 + R() * R() * 230, d: 6 + R() * 40 }); } return out; })();
const MOON_FLATS = [[-1250, -300, -170, -30], [-1000, -450, 130, 640], [20, 380, 380, 720]];      // runways / pads, relative to the crater field centre
export const gravityAt = (x, z) => {
  const d = Math.hypot(x - MOON.x, z - MOON.z);
  return d > MOON.r ? 13 : 13 - 9.6 * (1 - smoothstep(MOON.r * 0.8, MOON.r, d));
};
export const LAVA = [];                                                    // lava rivers {pts:[[x,z]], hw:[half widths]}
export function lavaAt(x, z) {
  const V = VOLCANO;
  if (Math.hypot(x - V.x, z - V.z) > V.rr + 6500) return false;
  const q = volcanoRoad(x, z);
  if (q.d < V.hw + 8 && q.phi > -0.3 && q.phi < V.phiMax + 0.3) return false;      // the trail passes over the lava through a culvert
  for (const f of LAVA) {
    for (let i = 0; i < f.pts.length - 1; i++) {
      const a = f.pts[i], b = f.pts[i + 1];
      if (distToSeg(x, z, a[0], a[1], b[0], b[1]) < f.hw[i] * 0.8) return true;
    }
  }
  return false;
}
export const LOOKOUT = { x: 0, z: 0, y: 0, yaw: 0, r: 26, phi: 6.2 };           // the viewing deck on the volcano road
export const PADS = [];                                                   // landing pads {x,z,r,y}
export const HIGHWAYS = [
  [[760, 0], [VOLCANO.x - VOLCANO.Rs, 0]],                     // east: from the original map to the volcano
  [[-760, 0], [TROPIC.x + TROPIC.Rs, 0]],                     // west: to the tropical volcano
];
export function highwayDist(x, z) {
  let d = 1e9;
  for (const h of HIGHWAYS) for (let i = 0; i < h.length - 1; i++) d = Math.min(d, distToSeg(x, z, h[i][0], h[i][1], h[i + 1][0], h[i + 1][1]));
  return d;
}                                   // shoreline (sea to the west)
export const shoreX = (z) => COAST.x + Math.sin(z * 0.006) * 45 + Math.sin(z * 0.017 + 2) * 18;

export function coneH(r, V = VOLCANO) {
  if (r >= V.R) return 0;
  if (r >= V.rr) return V.H * Math.pow(1 - (r - V.rr) / (V.R - V.rr), V.p);
  return V.H - V.depth * smoothstep(V.rr, V.rr * 0.3, r);
}
// where the spiral road passes: {d: distance from centre line, y: road height, phi: angle along the road}
const _vr = { d: 1e9, y: 0, phi: -1, rp: 0 };
export function volcanoRoad(x, z, V = VOLCANO) {
  const dx = x - V.x, dz = z - V.z, r = Math.hypot(dx, dz);
  _vr.d = 1e9;
  if (r > V.Rs + 60 || r < V.Re - 60) return _vr;
  const th = Math.atan2(dz, dx);
  const psi = Math.log(V.Rs / r) / V.b - (th - V.phi0);
  const n = Math.round(psi / (2 * Math.PI)), rho = psi - 2 * Math.PI * n;
  const phi = (th - V.phi0) + 2 * Math.PI * n;
  const rp = r * Math.exp(V.b * rho);
  _vr.d = Math.abs(rp - r); _vr.phi = phi; _vr.rp = rp; _vr.y = coneH(rp, V);
  return _vr;
}
export const volcanoPoint = (phi, V = VOLCANO) => {                 // centre-line point at path angle phi
  const r = V.Rs * Math.exp(-V.b * phi), a = V.phi0 + phi;
  return { x: V.x + Math.cos(a) * r, z: V.z + Math.sin(a) * r, y: coneH(r, V), r };
};
export const volcanoYaw = (phi, V = VOLCANO) => {                    // driving direction along the road at phi
  const a = V.phi0 + phi;
  return Math.atan2(-V.b * Math.cos(a) - Math.sin(a), -V.b * Math.sin(a) + Math.cos(a));
};
// the giant descent lane runs straight down the fall line from the summit plaza to the plain
const _ln = { perp: 1e9, along: 0, r: 0 };
export function volcanoLane(x, z) {
  const V = VOLCANO, dx = x - V.x, dz = z - V.z, r = Math.hypot(dx, dz);
  let d = Math.atan2(dz, dx) - V.theta; d = Math.atan2(Math.sin(d), Math.cos(d));
  _ln.r = r; _ln.along = r * Math.cos(d); _ln.perp = _ln.along > 0 ? r * Math.abs(Math.sin(d)) : 1e9;
  return _ln;
}
export const phiAtAlt = (alt, V = VOLCANO) => { let lo = 0, hi = V.phiMax; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; (volcanoPoint(m, V).y < alt ? (lo = m) : (hi = m)); } return lo; };

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
  // far areas
  [[398, 20], [560, 10], [800, -10], [1000, 0]],                              // salt flats
  [[400, -300], [560, -450], [780, -700], [900, -820]],                       // pine forest
  [[-610, -380], [-820, -330], [-1000, -300], [-1090, -255]],            // coast
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
  h = lerp(h, 0, 1 - smoothstep(0, 40, rectDist(x, z, MEGA)));
  h = lerp(h, 0, 1 - smoothstep(0, 40, rectDist(x, z, NSTUNT)));
  h = lerp(h, 0, 1 - smoothstep(0, 40, rectDist(x, z, SPECIAL)));
  // canyon: a deep trench across the north zone, tapering out at both ends so a car that falls in can drive out
  {
    const dz = Math.abs(z - CANYON.cz);
    if (dz < CANYON.hw + 8 && x > CANYON.x0 - 40 && x < CANYON.x1 + 40) {
      const along = Math.min(smoothstep(CANYON.x0 - 30, CANYON.x0 + 10, x), 1 - smoothstep(CANYON.x1 - 10, CANYON.x1 + 30, x));
      const t = smoothstep(CANYON.hw + 6, CANYON.hw - 2, dz);
      h = Math.min(h, h - CANYON.depth * t * along);
    }
  }
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
  // ---- far areas ----
  {
    const f = 1 - smoothstep(0, 60, rectDist(x, z, SALT));
    if (f > 0) h = lerp(h, 0.15 + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 0.12, f);       // salt flats: dead flat
  }
  {
    const d = Math.hypot(x - FOREST.x, z - FOREST.z), f = 1 - smoothstep(FOREST.r * 0.7, FOREST.r * 1.12, d);
    if (f > 0) h += f * ((fbm(x * 0.008 + 2, z * 0.008 - 5, 4) - 0.5) * 46 + (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 5);
  }
  {
    const dd = x - shoreX(z);
    if (dd < 340) {
      const k = 1 - smoothstep(130, 340, dd);
      let hb = lerp(h, 0.7 + Math.max(dd, 0) * 0.012, k);
      if (dd < 0) hb = Math.max(-13, 0.7 + dd * 0.075 + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 1.2 * Math.min(1, -dd / 30));
      h = hb;
    }
  }
  // ---- wild areas
  {
    const d = Math.hypot(x - ICE.x, z - ICE.z);
    if (d < 3000) {
      h = lerp(h, 0.25 + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 0.3, 1 - smoothstep(ICE.r, ICE.r + 260, d));
      const rim = smoothstep(ICE.r + 150, ICE.r + 450, d) * (1 - smoothstep(ICE.r + 900, ICE.r + 1500, d));
      h += rim * (40 + 55 * fbm(x * 0.004, z * 0.004, 3));
    }
  }
  {
    const dx = x - MESA.x, dz = z - MESA.z, d0 = Math.hypot(dx, dz);
    if (d0 < MESA.r + 500) {
      h = lerp(h, 0.6, 1 - smoothstep(MESA.r * 0.6, MESA.r + 300, d0));
      for (let k = 0; k < MESAS.length; k++) {
        const m = MESAS[k], d = Math.hypot(dx - m[0], dz - m[1]) + (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 26;
        const f = 1 - smoothstep(m[2] - 10, m[2] + 10, d);
        if (f > 0) h = Math.max(h, 0.6 + m[3] * Math.pow(f, 0.8) + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 2 * f);
      }
    }
  }
  {
    const dm = Math.hypot(x - MOON.x, z - MOON.z);
    if (dm < MOON.r + 400) {
      let hm = 2 + (fbm(x * 0.004, z * 0.004, 4) - 0.5) * 14;
      for (let k = 0; k < CRATERS.length; k++) {
        const c = CRATERS[k], dd = Math.hypot(x - c.x, z - c.z);
        if (dd > c.r * 1.6) continue;
        const t = dd / c.r;
        hm -= c.d * (1 - smoothstep(0, 1, t));
        hm += c.d * 0.38 * Math.exp(-Math.pow((t - 1.08) * 5, 2));
      }
      for (let k = 0; k < MOON_FLATS.length; k++) {
        const f = MOON_FLATS[k], ddx = Math.max(MOON.x + f[0] - x, 0, x - (MOON.x + f[1])), ddz = Math.max(MOON.z + f[2] - z, 0, z - (MOON.z + f[3]));
        hm = lerp(hm, 2, 1 - smoothstep(0, 70, Math.hypot(ddx, ddz)));
      }
      h = lerp(h, hm, 1 - smoothstep(MOON.r, MOON.r + 350, dm));
    }
  }
  {
    const dx = Math.max(Math.abs(x - CITY.x) - CITY.h, 0), dz = Math.max(Math.abs(z - CITY.z) - CITY.h, 0);
    if (dx < 200 && dz < 200) h = lerp(h, 0.3, 1 - smoothstep(0, 140, Math.hypot(dx, dz)));
  }
  for (const pd of PADS) {                                                          // landing pads of the big trampolines
    const d = Math.hypot(x - pd.x, z - pd.z);
    if (d < pd.r + 40) h = lerp(h, pd.y, 1 - smoothstep(pd.r * 0.8, pd.r + 38, d));
  }
  // ---- highways: flat roads between the areas (the east one ramps up to the volcano foot)
  {
    const hd = highwayDist(x, z);
    if (hd < 62) {
      const V0 = VOLCANO, ex = V0.x - V0.Rs;
      const wx = TROPIC.x + TROPIC.Rs;
      const yh = x > ex - 800 ? 0.4 + (coneH(V0.Rs) - 0.4) * smoothstep(ex - 800, ex, x)
        : x < wx + 800 ? 0.4 + (coneH(TROPIC.Rs, TROPIC) - 0.4) * smoothstep(wx + 800, wx, x) : 0.4;
      h = lerp(h, yh, 1 - smoothstep(12, 62, hd));
    }
  }
  {
    const V = VOLCANO, dx = x - V.x, dz = z - V.z, r = Math.hypot(dx, dz);
    if (r < V.R * 1.04 + 3300) {
      const ln = volcanoLane(x, z);
      if (r < V.R * 1.04) {
        const w = 1 - smoothstep(V.R * 0.9, V.R * 1.04, r);
        const hc = coneH(r);
        const t = Math.min(1, Math.max(0, hc / V.H));
        const th = Math.atan2(dz, dx);
        const q = volcanoRoad(x, z);
        const dEdge = Math.min(q.d < 1e8 ? q.d : 1e9, ln.perp);
        const atten = smoothstep(V.hw + 20, 900, dEdge);               // relief fades out next to the road and the lane
        const s4 = 4 * t * (1 - t);
        const flat = smoothstep(V.rr * 0.3, V.rr * 0.8, r);            // crater floor stays level
        const noise = ((fbm(x * 0.0006 + 9, z * 0.0006 + 3, 4) - 0.5) * 2 * 440 + (fbm(x * 0.0036, z * 0.0036, 4) - 0.5) * 2 * 105) * s4
          + Math.sin(th * 61 + fbm(x * 0.001, z * 0.001, 3) * 11) * 52 * s4 * s4
          + (fbm(x * 0.011 + 4, z * 0.011 - 2, 4) - 0.5) * 2 * 46 * s4                       // ribs and buttresses
          + Math.sin(th * 173 + fbm(x * 0.0035, z * 0.0035, 3) * 14) * 9 * s4                 // fine gullies
          + (fbm(x * 0.05 + 7, z * 0.05, 3) - 0.5) * 2 * 6 * s4;                              // boulder-scale roughness
        h = h * (1 - 0.92 * w) + hc + noise * atten * flat;
      }
      // the descent lane: smooth, straight, from the plaza all the way out over the plain (a runway at the foot)
      if (ln.perp < 40 && ln.r > V.Re * 0.9 && ln.r < V.R + 3300) {
        const f = (1 - smoothstep(11, 36, ln.perp)) * smoothstep(V.Re * 0.9, V.Re, ln.r) * (1 - smoothstep(V.R + 2900, V.R + 3300, ln.r));
        h = lerp(h, coneH(ln.r) + 0.35 * smoothstep(V.R * 0.97, V.R, ln.r), f);
      }
      if (r < V.R * 1.04) {
        const q = volcanoRoad(x, z);
        if (q.d < 1e8) {                                               // road bench
          const vf = smoothstep(-0.25, -0.01, q.phi) * (1 - smoothstep(V.phiMax - 0.1, V.phiMax + 0.12, q.phi));
          const fb = (1 - smoothstep(V.hw + 1, V.hw + 34, q.d)) * vf;
          if (fb > 0) h = lerp(h, q.y, fb);
        }
        const e = volcanoPoint(V.phiMax - 0.02), de = Math.hypot(x - e.x, z - e.z);      // summit plaza
        if (de < 60) h = lerp(h, e.y, 1 - smoothstep(28, 56, de));
        const st = volcanoPoint(0), ds = Math.hypot(x - st.x, z - st.z);                 // foot plaza
        if (ds < 90) h = lerp(h, st.y, 1 - smoothstep(30, 85, ds));
      }
    }
  }
  {
    const T = TROPIC, dx = x - T.x, dz = z - T.z, r = Math.hypot(dx, dz);
    if (r < T.R * 1.04) {
      const w = 1 - smoothstep(T.R * 0.9, T.R * 1.04, r);
      const hc = coneH(r, T);
      const t = Math.min(1, Math.max(0, hc / T.H)), th = Math.atan2(dz, dx);
      const q = volcanoRoad(x, z, T);
      const atten = smoothstep(T.hw + 14, 500, q.d < 1e8 ? q.d : 1e9);
      const s4 = 4 * t * (1 - t), flat = smoothstep(T.rr * 0.3, T.rr * 0.8, r);
      const noise = ((fbm(x * 0.0012 + 19, z * 0.0012 + 13, 4) - 0.5) * 2 * 150 + (fbm(x * 0.006, z * 0.006, 4) - 0.5) * 2 * 42) * s4
        + Math.sin(th * 41 + fbm(x * 0.002, z * 0.002, 3) * 9) * 30 * s4 * s4              // jungle ridges and ravines
        + (fbm(x * 0.02 + 4, z * 0.02 - 2, 4) - 0.5) * 2 * 14 * s4
        + (fbm(x * 0.06 + 7, z * 0.06, 3) - 0.5) * 2 * 3.5 * s4;
      h = h * (1 - w) + hc * w + noise * atten * flat * w;
      if (q.d < 1e8) {
        const vf = smoothstep(-0.25, 0.1, q.phi) * (1 - smoothstep(T.phiMax - 0.1, T.phiMax + 0.12, q.phi));
        const fb = (1 - smoothstep(T.hw + 1, T.hw + 26, q.d)) * vf;
        if (fb > 0) h = lerp(h, q.y, fb);
      }
      const e = volcanoPoint(T.phiMax - 0.02, T), de = Math.hypot(x - e.x, z - e.z);
      if (de < 50) h = lerp(h, e.y, 1 - smoothstep(22, 46, de));
      const st = volcanoPoint(0, T), ds = Math.hypot(x - st.x, z - st.z);
      if (ds < 80) h = lerp(h, st.y, 1 - smoothstep(26, 75, ds));
    }
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
    const m = smoothstep(1395, 1475, r) * (1 - smoothstep(1900, 2700, r));
    const mb = smoothstep(BOUND - 2200, BOUND, Math.max(Math.abs(x), Math.abs(z)));
    if (mb > 0) h += mb * mb * 1400;
    const noRing = smoothstep(VOLCANO.R * 1.0, VOLCANO.R * 1.08, Math.hypot(x - VOLCANO.x, z - VOLCANO.z)) * smoothstep(TROPIC.R * 1.0, TROPIC.R * 1.08, Math.hypot(x - TROPIC.x, z - TROPIC.z));
    if (m > 0 && noRing > 0) {
      const ridge = 1 - Math.abs(fbm(x * 0.012, z * 0.012, 4) * 2 - 1);
      const gap = smoothstep(260, 520, Math.abs(z));                 // passes lead east and west to the volcanoes
      h += noRing * m * m * gap * (22 + 55 * ridge + 18 * fbm(x * 0.04, z * 0.04, 3));
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
const _lat = new Map();
function latticeH(i, j) {
  const k = i * 262144 + j;
  let h = _lat.get(k);
  if (h === undefined) { h = rawHeight(-HALF + i * CELL, -HALF + j * CELL); if (_lat.size > 60000) _lat.clear(); _lat.set(k, h); }
  return h;
}
export function terrainHeight(x, z, nOut) {
  if (x < -HALF + 1 || x > HALF - 1 || z < -HALF + 1 || z > HALF - 1) {          // outside the grid: the same 4 m triangles the far tiles draw, so wheels sit exactly on the visible ground
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    const h00 = latticeH(i, j), h10 = latticeH(i + 1, j), h01 = latticeH(i, j + 1), h11 = latticeH(i + 1, j + 1);
    let h, dhdx, dhdz;
    if (u + v <= 1) { dhdx = h10 - h00; dhdz = h01 - h00; h = h00 + dhdx * u + dhdz * v; }
    else { dhdx = h11 - h01; dhdz = h11 - h10; h = h11 - dhdx * (1 - u) - dhdz * (1 - v); }
    if (nOut) { const nx = -dhdx / CELL, nz = -dhdz / CELL, l = Math.hypot(nx, 1, nz); nOut.x = nx / l; nOut.y = 1 / l; nOut.z = nz / l; }
    return h;
  }
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

function makePrism(cx, cy, cz, yaw, ua, ya, ub, yb, W, base, surface, bank = 0) {
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
  add(-s, 1, -bank, ya - s * ua);      // top (index 0); bank = cross slope, the +w (left) side is higher
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
    minY: cy + base, maxY: cy + Math.max(ya, yb) + Math.abs(bank) * W / 2,
  });
}

// profile: array of [u, y] from front to back (y relative to cy)
function addRamp(cx, cz, yaw, W, profile, opts = {}) {
  const cy = opts.cy ?? 0;
  const base = opts.base ?? -1.5;
  for (let k = 0; k < profile.length - 1; k++) {
    const [ua, ya] = profile[k], [ub, yb] = profile[k + 1];
    makePrism(cx, cy, cz, yaw, ua, ya, ub, yb, W, base, opts.surface || 'ramp', opts.bank || 0);
  }
  if (!opts.noRender) rampDefs.push({ cx, cy, cz, yaw, W, profile, base, bank: opts.bank || 0, style: opts.style || 'ramp' });
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

// ------------------------------------------------------------------ moving floors and bounce pads
export const trampolines = [];     // {x,z,r,power}: launches the buggy straight up; with `aim` {vx,vy,vz} it launches along that velocity
export const turntables = [];      // {x,z,r,w,angle}: a rotating floor, w in rad/s (+ = counter-clockwise from above)
const _fv = { x: 0, z: 0 };
// velocity of the floor under (x,z), so tyres grip the moving surface rather than the world
export function floorVelocity(x, z) {
  for (let i = 0; i < turntables.length; i++) {
    const t = turntables[i], dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz < t.r * t.r) { _fv.x = t.w * dz; _fv.z = -t.w * dx; return _fv; }
  }
  return null;
}

// ------------------------------------------------------------------ stunt building blocks
export const stuntProps = [];                 // pins and crates, consumed by world.js
export const stuntLines = [];                 // every jump line {name,x,z,yaw,kind} for testing
const corridors = [];                         // lanes that scenery must keep clear
const slopeAlong = (x, z, yaw, L) => {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return (terrainHeight(x + fx * L / 2, z + fz * L / 2) - terrainHeight(x - fx * L / 2, z - fz * L / 2)) / L;
};
// kicker that follows the slope of the ground under it
function kickerG(cx, cz, yaw, W, L, H, p, segs = 7, opts = {}) {
  const sl = opts.cy != null ? 0 : slopeAlong(cx, cz, yaw, L);
  const cy = opts.cy ?? terrainHeight(cx, cz);
  const prof = [];
  // the tail is sunk below the ground so the ramp grows out of it with no lip, even over bumpy terrain
  const sink = opts.cy != null ? 0 : 0.7;
  for (let k = 0; k <= segs; k++) { const t = k / segs, u = -L / 2 + L * t; prof.push([u, sl * u + H * Math.pow(t, p) - sink * Math.max(0, 1 - t * 3.5)]); }
  addRamp(cx, cz, yaw, W, prof, { ...opts, cy, base: opts.base ?? -(2.5 + Math.abs(sl) * L) });
}
function wedgeG(cx, cz, yaw, W, L, H, opts = {}) {
  const sl = opts.cy != null ? 0 : slopeAlong(cx, cz, yaw, L);
  const cy = opts.cy ?? terrainHeight(cx, cz);
  const sink = opts.cy != null ? 0 : 0.7;
  addRamp(cx, cz, yaw, W, [[-L / 2, sl * -L / 2 + 0.03 - sink], [L / 2, sl * L / 2 + H]], { ...opts, cy, base: opts.base ?? -(2.5 + Math.abs(sl) * L) });
}
function boxG(cx, cz, yaw, W, L, H, opts = {}) {
  const cy = opts.cy ?? terrainHeight(cx, cz);
  addRamp(cx, cz, yaw, W, [[-L / 2, H], [L / 2, H]], { style: 'box', ...opts, cy, base: opts.base ?? -3.5 });
}
// a kicker with a landing ramp after a gap. returns where the landing ends.
function jumpPair(x, z, yaw, o = {}) {
  const { W = 10, Lk = 16, Hk = 4, p = 1.7, gap = 30, Lw = 24, Hw = Hk * 0.75, Ww = W + 2, style, cy, bank = 0 } = o;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  kickerG(x, z, yaw, W, Lk, Hk, p, 7, { cy, style, bank });
  const lx = x + fx * Lk / 2, lz = z + fz * Lk / 2, d = gap + Lw / 2;
  wedgeG(lx + fx * d, lz + fz * d, yaw + PI, Ww, Lw, Hw, { cy });
  return { lipX: lx, lipZ: lz, endX: lx + fx * (gap + Lw), endZ: lz + fz * (gap + Lw) };
}
function pinsAt(x, z, rows = 4) {
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c <= r; c++) stuntProps.push({ type: 'pin', x: x + r * 1.7, z: z + (c - r / 2) * 1.5 });
}
function crateWall(x, z, yaw, n = 6, levels = 3) {
  const sx = Math.cos(yaw), sz = -Math.sin(yaw);
  for (let i = 0; i < n; i++) for (let l = 0; l < levels; l++) stuntProps.push({ type: 'crate', x: x + sx * (i - n / 2) * 1.35, z: z + sz * (i - n / 2) * 1.35, lift: l * 1.2 });
}
let _cc = 0;
const containerStyle = () => 'container' + ((_cc++) % 4);
// a row of shipping containers along +u of a lane
function containers(x, z, yaw, n, opts = {}) {
  const { W = 7, L = 14, H = 2.6, gap = 0.15, stack = [] } = opts;      // a wheel falls into a wide gap, so roofs are continuous
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let i = 0; i < n; i++) {
    const d = i * (L + gap);
    const cx = x + fx * d, cz = z + fz * d;
    boxG(cx, cz, yaw, W, L, H, { style: containerStyle(), cy: 0, base: -1.5 });
    if (stack.includes(i)) boxG(cx, cz, yaw, W, L, H, { style: containerStyle(), cy: H, base: -1.5 });
  }
  const d = (n - 1) * (L + gap) + L / 2;                          // far end of the row
  return { x: x + fx * d, z: z + fz * d, yaw };
}
// landing ramp whose high end touches the end of a row, at roof height
function landingAfter(end, Lw, Ww, H = 2.5) {
  const fx = Math.sin(end.yaw), fz = Math.cos(end.yaw);
  wedgeG(end.x + fx * Lw / 2, end.z + fz * Lw / 2, end.yaw + PI, Ww, Lw, H, { cy: 0 });
}

function spiralTower(cx, cz, R, turns, N, W, rise) {
  const dth = turns * 2 * PI / N, th0 = -PI / 2 - turns * 2 * PI;
  const chord = 2 * R * Math.sin(dth / 2), Reff = R * Math.cos(dth / 2);
  for (let i = 0; i < N; i++) {
    const th = th0 + (i + 0.5) * dth;
    const x = cx + Reff * Math.cos(th), z = cz + Reff * Math.sin(th);
    const yaw = Math.atan2(-Math.sin(th), Math.cos(th));
    const L = chord + 1.4, y0 = i * rise, y1 = (i + 1) * rise;
    // a thin slab, not a solid column: the second lap passes over the first, so there must be room beneath
    addRamp(x, z, yaw, W, [[-L / 2, y0], [L / 2, y1]], { cy: 0, style: 'box', base: y0 - 1.6 });
    for (const o of [-(W / 2 + 0.35), W / 2 + 0.35]) {          // crash barriers on both sides
      addRamp(x + Math.cos(yaw) * o, z - Math.sin(yaw) * o, yaw, 0.7, [[-L / 2 - 0.3, y0 + 1.5], [L / 2 + 0.3, y1 + 1.5]], { cy: 0, style: 'rail', base: y0 - 0.3 });
    }
  }
  const top = N * rise, ex = cx, ez = cz - R;                    // the helix ends heading east at (cx, cz-R)
  const yaw = PI / 2;
  boxG(ex + 10, ez, yaw, W, 20, top, { cy: 0, base: top - 1.4 });
  for (const o of [-(W / 2 + 0.35), W / 2 + 0.35]) addRamp(ex + 10, ez - o, yaw, 0.7, [[-10, top + 1.5], [10, top + 1.5]], { cy: 0, style: 'rail', base: top - 0.3 });
  boxG(ex + 32, ez, yaw, 5, 5, top - 1.5, { cy: 0 });            // supports under the launch kicker (clear of the first lap)
  boxG(ex + 44, ez, yaw, 5, 5, top - 1.5, { cy: 0 });
  boxG(cx, cz, 0, 20, 20, top - 2.5, { cy: 0 });                  // central core
  kickerG(ex + 34, ez, yaw, W, 28, 8, 1.7, 8, { cy: top, base: -1.4 });
  // long descending landing ramp
  wedgeG(ex + 48 + 22 + 35, ez, -yaw, W + 14, 70, 10, { cy: 0 });
  stuntProps.push({ type: 'pin', x: ex + 150, z: ez });
  pinsAt(ex + 135, ez, 5);
}

// ------------------------------------------------------------------ new stunt kinds
// banked curve (berm): the surface tilts across its width, so the car can carry speed round the outside.
// sweep>0 turns right, sweep<0 turns left. th0 is the start angle on the circle around (cx,cz).
function berm(cx, cz, R, W, th0, sweep, N, bankMag, style = 'bank') {
  const dir = Math.sign(sweep), dth = sweep / N, ad = Math.abs(dth);
  const Reff = R * Math.cos(ad / 2), L = 2 * R * Math.sin(ad / 2) + 1.2;
  const bAt = (k) => bankMag * Math.min(1, k / 3, (N - k) / 3);            // bank eases in and out
  for (let i = 0; i < N; i++) {
    const th = th0 + (i + 0.5) * dth;
    const hx = dir * -Math.sin(th), hz = dir * Math.cos(th);
    const yaw = Math.atan2(hx, hz);
    const b0 = bAt(i), b1 = bAt(i + 1), bm = (b0 + b1) / 2;
    const bank = dir * bm;                                                    // outer side is higher
    addRamp(cx + Reff * Math.cos(th), cz + Reff * Math.sin(th), yaw, W,
      [[-L / 2, b0 * W / 2], [L / 2, b1 * W / 2]], { cy: 0, style, bank, base: -2 });
  }
}
// straight banked strip heading `yaw`: a wall to ride along
function bankStrip(x, z, yaw, Ltot, W, bankMag, N) {
  const L = Ltot / N, fx = Math.sin(yaw), fz = Math.cos(yaw);
  const bAt = (k) => bankMag * Math.min(1, k / 3.5, (N - k) / 3.5);          // long, gentle entry and exit
  for (let i = 0; i < N; i++) {
    const d = (i + 0.5) * L - Ltot / 2, b0 = bAt(i), b1 = bAt(i + 1);
    addRamp(x + fx * d, z + fz * d, yaw, W, [[-L / 2, b0 * W / 2], [L / 2, b1 * W / 2]], { cy: 0, style: 'bank', bank: (b0 + b1) / 2, base: -2 });
  }
}
function carRow(x, z, yaw, n) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let i = 0; i < n; i++) {
    const cx = x + fx * i * 2.2, cz = z + fz * i * 2.2, k = (i * 7 + 3) % 4;
    boxG(cx, cz, yaw, 4.4, 1.9, 1.05, { style: 'cbody' + k, cy: 0, base: -1.5 });
    boxG(cx, cz, yaw, 2.6, 1.6, 0.75, { style: 'cglass', cy: 1.05, base: -0.3 });
  }
}
function busRow(x, z, yaw, n) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let i = 0; i < n; i++) boxG(x + fx * i * 3.6, z + fz * i * 3.6, yaw, 11, 2.8, 3.1, { style: 'bus', cy: 0, base: -1.5 });
}
const building = (x, z, yaw, L, H, k) => boxG(x, z, yaw, 14, L, H, { style: 'bldg' + (k % 3), cy: 0, base: -3.5 });

function buildSpecial(line) {
  const S = 0, N = PI;
  // ---- Evel Knievel: jump over a row of parked cars
  line('car row', -630, -70, S, 'named', [-630, -170]);
  kickerG(-630, -70, S, 12, 20, 4.8, 1.7, 7, { cy: 0 });
  carRow(-630, -36, S, 14);                                    // last car ends near z=-6
  wedgeG(-630, 11, N, 12, 34, 2.0, { cy: 0 });                  // high end z=-6, roof height
  pinsAt(-634, 50, 3);
  // ---- school buses
  line('bus row', -595, -72, S, 'named', [-595, -170]);
  kickerG(-595, -72, S, 14, 22, 5.6, 1.7, 7, { cy: 0 });
  busRow(-595, -38, S, 6);                                     // last bus ends near z=-18
  wedgeG(-595, -3, N, 14, 34, 3.2, { cy: 0 });                  // high end z=-20
  // ---- barrel-roll ramps: the surface is tilted so the buggy leaves the lip already rolling
  line('roll ramp L', -560, -62, S, 'named', [-560, -160]);
  jumpPair(-560, -62, S, { W: 10, Lk: 22, Hk: 4.5, gap: 44, Lw: 30, Hw: 3.4, bank: 0.45 });
  line('roll ramp R', -522, -62, S, 'named', [-522, -160]);
  jumpPair(-522, -62, S, { W: 10, Lk: 22, Hk: 4.5, gap: 44, Lw: 30, Hw: 3.4, bank: -0.45 });
  // ---- skyline: climb 14 m and hop down across four rooftops
  line('skyline', -485, -130, S, 'named', [-485, -230]);
  wedgeG(-485, -130, S, 14, 70, 14, { cy: 0 });
  [[-81, 14, 0], [-35, 10.5, 1], [11, 7, 2], [57, 3.5, 0]].forEach(([z, h, k]) => building(-485, z, S, 28, h, k));
  wedgeG(-485, 100, N, 14, 30, 3.2, { cy: 0 });
  // ---- wall ride: a 40-degree bank to carve along
  line('wall ride', -430, -60, S, 'manual', [-437, -160]);
  bankStrip(-430, -35, S, 140, 11, 0.7, 12);
  // ---- banked S-curve
  line('berm S', -600, 100, S, 'manual', [-600, 20]);
  berm(-576, 100, 24, 12, PI, -PI, 12, 0.6);      // left U-turn (south -> north)
  berm(-528, 100, 24, 12, PI, PI, 12, 0.6);       // right U-turn (north -> south)
  // ---- trampolines: three strengths, and a huge one
  [[-625, 168, 5, 14], [-595, 168, 5.5, 20], [-565, 168, 6, 26], [-535, 168, 7, 32], [-440, 195, 9, 40]].forEach(([x, z, r, power]) => trampolines.push({ x, z, r, power }));
  // ---- rotating floors
  turntables.push({ x: -600, z: 208, r: 18, w: 0.9, angle: 0 }, { x: -548, z: 208, r: 16, w: -1.05, angle: 0 });
}

// ---------------------------------------------------------------- lava rivers from the crater
function buildLava() {
  LAVA.length = 0;
  const V = VOLCANO;
  for (const off of [0.9, 1.7, 2.5, 3.3, 4.1, 5.2]) {
    const th0 = V.theta + off, pts = [], hw = [], step = 14;
    let x = V.x + Math.cos(th0) * V.rr, z = V.z + Math.sin(th0) * V.rr, dx = Math.cos(th0), dz = Math.sin(th0);
    for (let i = 0; i < 240; i++) {
      pts.push([x, z]); hw.push((i < 14 ? 12 + i * 2 : 40 - (i / 240) * 22) * 0.5);
      const e = 10, gx = (rawHeight(x + e, z) - rawHeight(x - e, z)) / (2 * e), gz = (rawHeight(x, z + e) - rawHeight(x, z - e)) / (2 * e);
      let nx = -gx, nz = -gz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      dx = dx * 0.78 + nx * 0.22; dz = dz * 0.78 + nz * 0.22;
      const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      x += dx * step; z += dz * step;
    }
    LAVA.push({ pts, hw });
  }
}
// launch velocity to fly from A to B in T seconds under gravity g
const aimVel = (ax, ay, az, bx, by, bz, T, g = 13) => ({ vx: (bx - ax) / T, vz: (bz - az) / T, vy: (by - ay + 0.5 * g * T * T) / T });
function buildBigTrampolines() {
  const V = VOLCANO;
  // 1) ground -> mountain: a giant trampoline at the end of the highway shoots you onto the first stretch of the road
  const p0 = volcanoPoint(0.03);
  const g1 = { x: V.x - V.Rs - 90, z: 20, y: 0.4 };
  PADS.push({ x: p0.x, z: p0.z, r: 38, y: p0.y });
  PADS.push({ x: g1.x, z: g1.z, r: 20, y: 0.4 });
  const a1 = aimVel(g1.x, 4, g1.z, p0.x, p0.y + 3, p0.z, 7);
  trampolines.push({ x: g1.x, z: g1.z, r: 15, power: 40, aim: a1, big: true, label: 'מהאדמה אל ההר' });
  // 2) mountain -> ground: from the road a little higher up, back to a landing pad on the plain
  const p1 = volcanoPoint(0.05), land = { x: V.x - V.Rs - 330, z: p1.z + 220, y: 0.4 };
  PADS.push({ x: land.x, z: land.z, r: 55, y: 0.4 });
  const a2 = aimVel(p1.x, p1.y + 4, p1.z, land.x, 4, land.z, 8.5);
  trampolines.push({ x: p1.x, z: p1.z, r: 15, power: 40, aim: a2, big: true, label: 'מההר אל האדמה' });
  // ---- ramps and trampolines along the whole trail, so there is something to jump at every stage of the climb
  for (const alt of [450, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050]) {
    const f = phiAtAlt(alt), q = volcanoPoint(f), yaw = volcanoYaw(f), ix = (alt / 450) | 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    jumpPair(q.x, q.z, yaw, { W: 13, Lk: 24 + (ix % 3) * 3, Hk: 3.6 + (ix % 3) * 0.7, gap: 16 + (ix % 3) * 4, Lw: 36, Hw: 1.0 });        // uphill: short hops with a flush landing ramp
    stuntLines.push({ name: 'trail ramp ' + alt, x: q.x, z: q.z, yaw, kind: 'manual', start: [q.x - fx * 160, q.z - fz * 160] });
    const f2 = f + 0.035, q2 = volcanoPoint(f2);                                    // a trampoline a little further up the road
    const y2 = volcanoYaw(f2), lx2 = Math.cos(y2), lz2 = -Math.sin(y2);               // on the left shoulder so it never throws you by surprise
    trampolines.push({ x: q2.x + lx2 * 6.5, z: q2.z + lz2 * 6.5, r: 5, power: 30 + (ix % 3) * 6 });
  }
  // ---- the lookout: a round deck on the outer side of the road at 4,500 m, facing the whole valley below
  {
    const f = LOOKOUT.phi, q = volcanoPoint(f), yaw = volcanoYaw(f);                 // on the west face: the whole original map lies below
    const fx = Math.sin(yaw), fz = Math.cos(yaw), ox = fz, oz = -fx;                // right of travel; test which side is downhill
    const outward = (Math.hypot(q.x + ox * 30 - V.x, q.z + oz * 30 - V.z) > q.r) ? 1 : -1;
    const cx = q.x + ox * outward * (V.hw + 30), cz = q.z + oz * outward * (V.hw + 30);
    LOOKOUT.x = cx; LOOKOUT.z = cz; LOOKOUT.y = q.y; LOOKOUT.yaw = Math.atan2(ox * outward, oz * outward);
    LOOKOUT.roadX = q.x; LOOKOUT.roadZ = q.z; LOOKOUT.roadYaw = yaw;
    PADS.push({ x: cx, z: cz, r: LOOKOUT.r + 4, y: q.y, noPaint: true });
  }
}
// ---------------------------------------------------------------- wild areas (north mesas, south ice, north-east moon, south-east city)
function buildWild(line) {
  const E = PI / 2, Wd = -PI / 2, S = 0, N = PI;
  // ---- ICE LAKE: long jump lanes across the frozen lake, icebergs to weave through, one gigantic ramp
  {
    const cx = ICE.x, cz = ICE.z;
    line('ice rhythm', cx - 700, cz - 300, E, 'named', [cx - 900, cz - 300]);
    jumpPair(cx - 700, cz - 300, E, { W: 14, Lk: 26, Hk: 6, gap: 60, Lw: 40, Hw: 5 });
    jumpPair(cx - 450, cz - 300, E, { W: 16, Lk: 34, Hk: 11, gap: 90, Lw: 52, Hw: 9 });
    line('ice mega', cx - 800, cz + 100, E, 'named', [cx - 1000, cz + 100]);
    jumpPair(cx - 800, cz + 100, E, { W: 18, Lk: 80, Hk: 26, p: 1.7, gap: 190, Lw: 140, Hw: 20, Ww: 34 });
    for (let k = 0; k < 40; k++) { const a = k * 2.399, d = 150 + (k * 37) % 650, bx = cx + Math.cos(a) * d + 150, bz = cz + 300 + Math.sin(a) * d * 0.6; if ((Math.abs(bz - (cz - 300)) < 70 || Math.abs(bz - (cz + 100)) < 90) && bx < cx + 120) continue; boxG(bx, bz, a, 14 + (k % 5) * 5, 20 + (k % 4) * 8, 6 + (k % 6) * 3, { style: 'box', cy: 0.25 }); }
    kickerG(cx + 500, cz + 450, Wd, 40, 24, 18, 2.7, 10, { style: 'qp', cy: 0.25 }); kickerG(cx + 600, cz + 450, E, 40, 24, 18, 2.7, 10, { style: 'qp', cy: 0.25 });
  }
  // ---- MESAS: climb a long ramp to the top, then fly off the cliff to the badlands floor
  {
    const mx = MESA.x, mz = MESA.z;
    [[0, 120, 0], [2, 140, 1], [4, 110, 2]].forEach(([ix, H, k]) => {
      const m = MESAS[ix], cx = mx + m[0], cz = mz + m[1], r = m[2], top = 0.6 + H;
      const L = H * 4.2;
      const yaw = k % 2 ? E : Wd;                                     // ramp up on one side
      const dirx = Math.sin(yaw), dirz = Math.cos(yaw);
      // access wedge: starts 12 m before the cliff
      wedgeG(cx - dirx * (r + L / 2 - 4), cz - dirz * (r + L / 2 - 4), yaw, 20, L, H + 1, { cy: 0.6 });
      // fly off the cliff edge; a curved landing slope hugging the cliff catches you
      const ex = cx + dirx * (r - 10), ez = cz + dirz * (r - 10);
      line('mesa jump ' + k, ex, ez, yaw, 'manual', [cx - dirx * (r - 70), cz - dirz * (r - 70)]);
      const prof = [];
      const U = 300;
      for (let u = 15; u <= U; u += 10) prof.push([u, Math.max(0.1, top * Math.pow(1 - u / U, 2) - 1)]);
      addRamp(ex, ez, yaw, 44, prof, { cy: 0, base: -1.5, style: 'ramp' });
    });
  }
  // ---- MOON: ramps built for low gravity (flights are four times longer)
  {
    const cx = MOON.x, cz = MOON.z;
    line('moon giga', cx - 900, cz - 100, E, 'manual', [cx - 1100, cz - 100]);
    kickerG(cx - 900, cz - 100, E, 20, 80, 22, 1.6, 12, { cy: 2 });
    wedgeG(cx - 900 + 40 + 250, cz - 100, Wd, 40, 300, 7, { cy: 2 });
    for (let k = 0; k < 6; k++) { kickerG(cx - 700, cz + 200 + k * 60, E, 14, 20 + k * 6, 4 + k * 2.5, 1.7, 8, { cy: 2 }); }
    kickerG(cx + 200, cz + 500, N, 44, 26, 20, 2.7, 10, { style: 'qp', cy: 2 }); kickerG(cx + 200, cz + 600, S, 44, 26, 20, 2.7, 10, { style: 'qp', cy: 2 });
  }
  // ---- NEON CITY: a grid of towers, rooftop-to-rooftop jumps and street ramps
  {
    const cx = CITY.x, cz = CITY.z, R = rng(2024);
    const towers = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      if (Math.abs(i) <= 0 && Math.abs(j) <= 0) continue;
      if (R() < 0.22) continue;
      const x = cx + i * 110, z = cz + j * 110, H = 18 + Math.floor(R() * 60), k = (i + j + 9) % 3;
      boxG(x, z, 0, 54 + R() * 14, 54 + R() * 14, H, { style: 'bldg' + k, cy: 0.3, base: -3.5 });
      towers.push({ x, z, H });
    }
    // street jumps (the streets run between the towers, 42 m wide) + an elevated deck jump
    const sx = cx + 55;
    line('city street 1', sx, cz - 280, S, 'manual', [sx, cz - 500]);
    jumpPair(sx, cz - 280, S, { W: 14, Lk: 30, Hk: 9, gap: 70, Lw: 44, Hw: 7, cy: 0.3 });
    const z0 = cz + 400;
    line('city deck', sx, z0 + 100, N, 'manual', [sx, z0 + 190]);
    wedgeG(sx, z0, N, 20, 130, 26, { cy: 0.3 });
    boxG(sx, z0 - 110, N, 20, 90, 26, { cy: 0.3, base: -3.5 });
    kickerG(sx, z0 - 167, N, 16, 24, 5, 1.6, 8, { cy: 26.3 });
    wedgeG(sx, z0 - 179 - 60 - 25, S, 24, 50, 20, { cy: 0.3 });
  }
}

// ---------------------------------------------------------------- far areas: salt flats, volcano, coast
function buildFar() {
  const line = (name, x, z, yaw, kind = 'named', start = null) => stuntLines.push({ name, x, z, yaw, kind, start });
  const E = PI / 2, Wd = -PI / 2, S = 0, Nn = PI;
  buildLava();
  buildBigTrampolines();
  // ---- volcano: jump from the summit plaza into the crater + the giant descent lane with its launch ramp at the foot
  {
    const V = VOLCANO, e = volcanoPoint(V.phiMax - 0.02);
    const yaw = Math.atan2(V.x - e.x, V.z - e.z);                // toward the crater centre
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    kickerG(e.x + fx * 6, e.z + fz * 6, yaw, 12, 26, 6, 1.6, 7, { cy: e.y });
    stuntLines.push({ name: 'crater jump', x: e.x + fx * 6, z: e.z + fz * 6, yaw, kind: 'manual', start: [e.x - fx * 30, e.z - fz * 30] });
    // foot of the lane
    const lx = Math.cos(V.theta), lz = Math.sin(V.theta), lyaw = Math.atan2(lx, lz);
    const d0 = V.R + LANE_KICK;
    kickerG(V.x + lx * d0, V.z + lz * d0, lyaw, 24, 70, 14, 1.5, 10, { cy: 0.35 });          // launch ramp: a long flat runway follows
    stuntLines.push({ name: 'mega descent', x: V.x + lx * d0, z: V.z + lz * d0, yaw: lyaw, kind: 'manual', start: [V.x + lx * (V.Re + 40), V.z + lz * (V.Re + 40)] });
  }
}
function buildStunts() {
  stuntProps.length = 0; stuntLines.length = 0; corridors.length = 0; _cc = 0;
  const line = (name, x, z, yaw, kind = 'named', start = null) => stuntLines.push({ name, x, z, yaw, kind, start });
  const E = PI / 2, Wd = -PI / 2, Nn = PI, S = 0;

  // ================= SOUTH: MEGA RAMPS =================
  // lane z=500: four rhythm jumps that grow
  line('rhythm lane', -165, 500, E, 'named', [-200, 500]); line('GIGA', 80, 550, E, 'named', [-200, 550]);
  line('tables lane', -170, 600, E, 'named', [-200, 600]); line('bus XL', -150, 655, E, 'named', [-300, 655]);
  jumpPair(-165, 500, E, { W: 10, Lk: 14, Hk: 3.2, gap: 26, Lw: 20, Hw: 2.6 });
  jumpPair(-85, 500, E, { W: 12, Lk: 18, Hk: 5, gap: 36, Lw: 26, Hw: 4 });
  jumpPair(5, 500, E, { W: 12, Lk: 24, Hk: 7.5, gap: 50, Lw: 34, Hw: 6 });
  jumpPair(135, 500, E, { W: 14, Lk: 28, Hk: 10, gap: 65, Lw: 40, Hw: 8 });
  // lane z=550: THE GIGA JUMP. 250 m run-up, 18 m lip, 110 m gap
  jumpPair(80, 550, E, { W: 14, Lk: 60, Hk: 18, p: 1.7, gap: 110, Lw: 100, Hw: 14, Ww: 28 });
  pinsAt(345, 550, 5);
  // lane z=600: two big table tops
  wedgeG(-170, 600, E, 16, 46, 9); boxG(-125, 600, E, 16, 36, 9); wedgeG(-82, 600, Wd, 16, 46, 9);
  wedgeG(-20, 600, E, 18, 56, 13); boxG(33, 600, E, 18, 44, 13); wedgeG(88, 600, Wd, 18, 66, 13);
  // lane z=655: container bus jump XL
  kickerG(-150, 655, E, 14, 30, 9, 1.7, 8);
  landingAfter(containers(-120, 655, E, 5, { W: 9, stack: [1, 2] }), 40, 14);
  crateWall(25, 655, E + PI / 2, 8, 3);
  // whoops: 20 big rollers
  for (let k = 0; k < 19; k++) addRamp(5 + k * 10, 633, E, 22, [[-5, 0.02], [0, 2.7], [5, 0.02]], { style: 'roller' });
  // sky tower: spiral up 24 m, then a launch
  spiralTower(255, 640, 36, 1.25, 28, 12, 0.86);
  // quarter-pipe arena
  kickerG(350, 525, Wd, 40, 20, 16, 2.7, 10, { style: 'qp' });
  kickerG(420, 525, E, 40, 20, 16, 2.7, 10, { style: 'qp' });
  crateWall(385, 525, 0, 10, 3);

  // ================= NORTH: CANYON, BUS JUMPS, STAR, DROP =================
  const cz = CANYON.cz, lipS = cz + 23.5, hiN = cz - 23.5;
  [[5, 3.5, 18], [55, 5, 22], [105, 6.5, 24], [155, 8.5, 28], [205, 10.5, 32]].forEach(([x, H, L]) => {
    line('canyon ' + x, x, lipS + L / 2, Nn, 'named', [x, -400]);
    kickerG(x, lipS + L / 2, Nn, 10, L, H, 1.7, 8, { cy: 0 });
    const Lw = 22 + 4.4 * H;                                   // long, gentle landing: matches the flight distance
    wedgeG(x, hiN - Lw / 2, S, 14, Lw, H * 0.75, { cy: 0 });
    pinsAt(x - 2, hiN - Lw - 6, 3);
  });
  line('bus 1', -170, -475, Nn, 'named', [-170, -380]); line('bus 2', -135, -470, Nn, 'named', [-135, -380]);
  line('mountain drop', 300, 466, E, 'named', [110, 466]); line('lake jump', -151, 40, Wd, 'named', [60, 40]);
  // bus jumps (north-bound, run-up starts at the ring road)
  kickerG(-170, -475, Nn, 10, 20, 5.5, 1.7, 7, { cy: 0 });
  landingAfter(containers(-170, -515, Nn, 3, { W: 7 }), 40, 12);       // ramp starts right where the containers end
  kickerG(-135, -470, Nn, 12, 28, 8, 1.7, 8, { cy: 0 });
  landingAfter(containers(-135, -505, Nn, 4, { W: 8, stack: [1, 2] }), 40, 14);
  crateWall(-170, -615, 0, 7, 3); crateWall(-135, -632, 0, 8, 3);
  // star plaza: 8 ramps feeding a raised plaza
  {
    const sx = -62, sz = -625, Hs = 4.5;
    boxG(sx, sz, 0, 28, 28, Hs, { cy: 0, base: -3 });
    for (let k = 0; k < 8; k++) {
      const a = k * PI / 4, diag = k % 2 === 1, lip = diag ? 19.8 : 14, L = 20, d = lip + L / 2;
      kickerG(sx + Math.cos(a) * d, sz + Math.sin(a) * d, Math.atan2(-Math.cos(a), -Math.sin(a)), 11, L, Hs, 1.5, 7, { cy: 0 });
    }
  }
  // mountain drop: climb 14 m, then roll down four steps
  // continuous: ramp up (270..330) -> deck (330..354) -> four steps down (354..394)
  wedgeG(300, 466, E, 16, 60, 14, { cy: 0 }); boxG(342, 466, E, 16, 24, 14, { cy: 0, base: -3.5 });
  [10, 7, 4, 1.6].forEach((h, i) => boxG(359 + i * 10, 466, E, 16, 10, h, { cy: 0 }));
  crateWall(420, 466, E + PI / 2, 8, 2);

  // ================= CLIFF DIVE: 22 m pier out over the oasis =================
  {
    const px = -225, top = 22;
    line('cliff dive', px, -135, S, 'named', [px, -270]);
    wedgeG(px, -135, S, 12, 110, top, { cy: 0 });                 // z -190..-80, rises to 22 m
    boxG(px, -38, S, 12, 84, top, { cy: 0, base: top - 4 });      // deck, thin, from z -80 to 4
    for (const z of [-70, -45, -20]) boxG(px, z, S, 4, 4, top - 4.2, { cy: 0, base: -4 });   // pillars
    kickerG(px, -2, S, 12, 22, 3, 1.5, 6, { cy: top, base: -1.5 });
    addRamp(px - 6.4, -38, S, 0.7, [[-42, top + 1.4], [42, top + 1.4]], { cy: 0, style: 'rail', base: top - 0.2 });
    addRamp(px + 6.4, -38, S, 0.7, [[-42, top + 1.4], [42, top + 1.4]], { cy: 0, style: 'rail', base: top - 0.2 });
  }
  // ================= PLANK BRIDGE across the canyon: 4 m wide, 16 m above the floor =================
  line('plank bridge', 130, CANYON.cz, Nn, 'named', [130, CANYON.cz + 110]);
  boxG(130, CANYON.cz, S, 4.2, 82, 0.06, { cy: 0, base: -0.55, style: 'plank' });
  // ================= LAKE JUMP =================
  kickerG(-151, 40, Wd, 16, 24, 11, 1.7, 8);           // east shore, lip at x=-163
  wedgeG(-297, 40, E, 24, 30, 8);                       // west shore landing
  pinsAt(-345, 40, 3);

  buildSpecial(line);

  // ================= SCATTERED RAMPS ACROSS THE WORLD =================
  const R = rng(2024);
  const zonesOk = (x, z) => {
    if (mountainR(x, z) > 680) return false;
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 45) return false;
    for (const r of [PARK, STUNT, DRIFTLOT, MEGA, NSTUNT, SPECIAL]) if (rectDist(x, z, r) < 45) return false;
    if (Math.abs(x + 225) < 40 && z > -280 && z < 20) return false;
    if (Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r + 45) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 70) return false;
    if (Math.hypot(x - CIRCUIT_C.x, z - CIRCUIT_C.z) < CIRCUIT_C.r + 40) return false;
    if (roadDistance(x, z) < 24) return false;
    const q = trackNearest(x, z); if (q.track && q.d < q.track.hw + 26) return false;
    return true;
  };
  const placed = [];
  let made = 0;
  const why = { zone: 0, near: 0, flat: 0 };
  for (let tries = 0; tries < 80000 && made < 60; tries++) {
    const a = R() * PI * 2, rr = 160 + R() * 560;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr, yaw = R() * PI * 2;
    if (!zonesOk(x, z)) { why.zone++; continue; }
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 62)) { why.near++; continue; }
    const kind = R();
    const big = kind > 0.82, tab = kind > 0.62 && !big, dbl = kind > 0.45 && kind <= 0.62;
    const Hk = big ? 8 + R() * 5 : 2.6 + R() * 3.4, Lk = big ? 30 + R() * 10 : 14 + R() * 8;
    const gap = big ? 50 + R() * 25 : 18 + R() * 22, Lw = big ? 40 + Hk * 4 : 20 + Hk * 5;
    const total = Lk + gap + Lw + (dbl ? 40 : 0) + (tab ? 60 : 0);
    // the whole line (plus run-up and run-out) must be on reasonably flat ground
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let ok = true, h0 = terrainHeight(x, z);
    for (let d = -30; d <= total + 25; d += 8) {
      const hx = x + fx * d, hz = z + fz * d;
      if (!zonesOk(hx, hz) || Math.abs(terrainHeight(hx, hz) - h0 - slopeAlong(x, z, yaw, total) * d) > 3.2) { ok = false; break; }
    }
    if (!ok) { why.flat++; continue; }
    corridors.push({ x, z, yaw, from: -75, to: total + 45 });
    placed.push([x, z]); made++; line('scatter ' + made + (big ? ' BIG' : tab ? ' table' : dbl ? ' double' : ''), x, z, yaw, 'scatter');
    if (tab) {
      kickerG(x, z, yaw, 11, Lk, Hk, 1.6, 7);
      const d1 = Lk / 2 + 3 + 13, d2 = Lk / 2 + 3 + 26 + 15, Ht = Hk * 0.85;
      boxG(x + fx * d1, z + fz * d1, yaw, 11, 26, Ht, {});
      wedgeG(x + fx * d2, z + fz * d2, yaw + PI, 12, 30, Ht);
    } else if (dbl) {
      const r1 = jumpPair(x, z, yaw, { W: 11, Lk, Hk, gap: gap * 0.7, Lw: 16, Hw: Hk * 0.7 });
      const nx = r1.endX + fx * 12, nz = r1.endZ + fz * 12;
      jumpPair(nx, nz, yaw, { W: 11, Lk: Lk + 4, Hk: Hk * 1.3, gap, Lw, Hw: Hk * 0.9 });
    } else {
      jumpPair(x, z, yaw, { W: big ? 16 : 11, Lk, Hk, p: big ? 1.8 : 1.6, gap, Lw, Hw: Hk * (big ? 0.78 : 0.75), Ww: big ? 26 : 13 });
    }
    if (R() < 0.5) pinsAt(x + fx * (total + 6), z + fz * (total + 6), 4);
  }
  stuntProps.made = made; stuntProps.why = why;
}

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
  buildStunts();
  buildFar();
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
    for (const c of corridors) {                      // keep every jump line free of boulders
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), dx = x - c.x, dz = z - c.z;
      const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
      if (along > c.from && along < c.to && Math.abs(lat) < 11 + pad) return false;
    }
    if (rectDist(x, z, DRIFTLOT) < 25 + pad || rectDist(x, z, STUNT) < 25 + pad) return false;
    if (rectDist(x, z, MEGA) < 30 + pad || rectDist(x, z, NSTUNT) < 30 + pad || rectDist(x, z, SPECIAL) < 30 + pad) return false;
    if (Math.abs(x + 225) < 22 && z > -260 && z < 0) return false;        // cliff-dive run-up
    if (x > -175 && x < -40 && Math.abs(z - 40) < 16) return false;      // lake-jump run-up
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
  // ---- far areas: pines, volcano boulders, beach palms
  scenery.pines.length = 0; scenery.bigRocks.length = 0;
  {
    const R2 = rng(4242);
    const free = (x, z, pad) => roadDistance(x, z) > 9 + pad && trackNearest(x, z).d > 14 + pad &&
      !colliders.some(c => x > c.minX - 10 && x < c.maxX + 10 && z > c.minZ - 10 && z < c.maxZ + 10);
  }
  // palms around the lake
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * PI * 2 + R() * 0.15;
    const rr = LAKE.r * (0.78 + R() * 0.35);
    const x = LAKE.x + Math.cos(a) * rr, z = LAKE.z + Math.sin(a) * rr;
    if (roadDistance(x, z) < 9) continue;
    if (colliders.some(c => x > c.minX - 9 && x < c.maxX + 9 && z > c.minZ - 9 && z < c.maxZ + 9)) continue;
    const y = terrainHeight(x, z);
    const s = 0.85 + R() * 0.5;
    scenery.palms.push({ x, z, y, s, rot: R() * PI * 2, lean: (R() - 0.5) * 0.4 });
    addCylinder({ x, z, r: 0.4, y0: y - 1, h: 9 * s });
  }
  // the tropical volcano: a palm jungle on its lower and middle slopes
  {
    const T = TROPIC, RT = rng(777), nn = { x: 0, y: 1, z: 0 };
    let placed = 0;
    for (let k = 0; k < 12000 && placed < 1400; k++) {
      const a = RT() * PI * 2, r = T.rr * 3 + Math.sqrt(RT()) * (T.R - T.rr * 3);
      const x = T.x + Math.cos(a) * r, z = T.z + Math.sin(a) * r;
      const y = terrainHeight(x, z, nn);
      if (nn.y < 0.66 || y > T.H * 0.74 || y < 1) continue;
      if (volcanoRoad(x, z, T).d < T.hw + 8 || highwayDist(x, z) < 20) continue;
      const q = volcanoPoint(0, T); if (Math.hypot(x - q.x, z - q.z) < 90) continue;
      scenery.palms.push({ x, z, y, s: 0.9 + RT() * 1.1, rot: RT() * PI * 2, lean: (RT() - 0.5) * 0.5 });
      placed++;
    }
  }
}
export const scenery = { rocks: [], cacti: [], palms: [], pines: [], bigRocks: [] };

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
  if (x > MEGA.x0 - 6 && x < MEGA.x1 + 6 && z > MEGA.z0 - 6 && z < MEGA.z1 + 6) return 'dirt';
  if (x > NSTUNT.x0 - 6 && x < NSTUNT.x1 + 6 && z > NSTUNT.z0 - 6 && z < NSTUNT.z1 + 6) return 'dirt';
  if (x > SPECIAL.x0 - 6 && x < SPECIAL.x1 + 6 && z > SPECIAL.z0 - 6 && z < SPECIAL.z1 + 6) return 'dirt';
  if (Math.hypot(x - BOWL.x, z - BOWL.z) < BOWL.r) return 'concrete';
  if (rectDist(x, z, SALT) < 4) return 'salt';
  if (x > 1300) {
    const V = VOLCANO, r = Math.hypot(x - V.x, z - V.z);
    if (r < V.R * 1.04 + 3300) {
      const ln = volcanoLane(x, z);
      if (ln.perp < 11 && ln.r > V.Re * 0.95 && ln.r < V.R + 3000) return 'chute';
      if (r < V.R) {
        const q = volcanoRoad(x, z);
        if (q.d < V.hw + 2 && q.phi > -0.2 && q.phi < V.phiMax + 0.2) return 'trail';
        return terrainHeight(x, z) > 3600 ? 'snow' : 'dirt';
      }
    }
  }
  if (x < -3000) {
    const T = TROPIC, r = Math.hypot(x - T.x, z - T.z);
    if (r < T.R) {
      const q = volcanoRoad(x, z, T);
      if (q.d < T.hw + 2 && q.phi > -0.2 && q.phi < T.phiMax + 0.2) return 'trail';
      return 'dirt';
    }
  }
  if (highwayDist(x, z) < 10) return 'asphalt';
  if (Math.hypot(x - ICE.x, z - ICE.z) < ICE.r) return 'ice';
  if (Math.abs(x - CITY.x) < CITY.h + 40 && Math.abs(z - CITY.z) < CITY.h + 40) return 'asphalt';
  if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r * 0.9) return 'dirt';
  if (x < shoreX(z) + 180) return 'sand';
  return 'sand';
}
// lateral grip per surface (drive / braking are not limited by surface)
export const GRIP = { asphalt: 1.0, concrete: 1.0, ramp: 1.0, chute: 1.0, trail: 1.2, dirt: 0.96, sand: 0.9, salt: 0.78, snow: 0.85, ice: 0.45 };
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
    { id: 'lookout', name: '👁 תצפית על כל העמק', sub: 'מכאן רואים את כל המשחק · לחצו N למפת העולם', x: LOOKOUT.roadX, z: LOOKOUT.roadZ, yaw: LOOKOUT.roadYaw, inside: (x, z) => Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < LOOKOUT.r + 30 },
    { id: 'slide', name: 'מגלשת הענק · 5,895 מ׳', sub: 'ירידה של 11 ק"מ מהפסגה אל המישור', ...(() => { const V = VOLCANO, lx = Math.cos(V.theta), lz = Math.sin(V.theta), r = V.Re + 70; return { x: V.x + lx * r, z: V.z + lz * r, yaw: Math.atan2(lx, lz) }; })(), inside: (x, z) => { const l = volcanoLane(x, z); return l.perp < 25 && l.r > VOLCANO.Re && l.r < VOLCANO.Re + 400; } },
    { id: 'summit', name: 'פסגת הר הגעש · 5,895 מ׳', sub: 'מעל העננים · מגלשת הענק · קפיצה למכתש', ...(() => { const e = volcanoPoint(VOLCANO.phiMax - 0.12); return { x: e.x, z: e.z, yaw: volcanoYaw(VOLCANO.phiMax - 0.12) }; })(), inside: (x, z) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.Re + 160 && terrainHeight(x, z) > VOLCANO.H * 0.9 },
    { id: 'volcano45', name: 'הר הגעש · 4,500 מ׳', sub: 'שלג · מעל העננים', ...(() => { const f = phiAtAlt(4500), e = volcanoPoint(f); return { x: e.x, z: e.z, yaw: volcanoYaw(f) }; })(), inside: (x, z) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.R && terrainHeight(x, z) > 3500 },
    { id: 'volcano30', name: 'הר הגעש · 3,000 מ׳', sub: 'סלעי געש · קרח', ...(() => { const f = phiAtAlt(3000), e = volcanoPoint(f); return { x: e.x, z: e.z, yaw: volcanoYaw(f) }; })(), inside: (x, z) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.R && terrainHeight(x, z) > 2000 },
    { id: 'volcano15', name: 'הר הגעש · 1,500 מ׳', sub: 'שביל מתפתל · יער', ...(() => { const f = phiAtAlt(1500), e = volcanoPoint(f); return { x: e.x, z: e.z, yaw: volcanoYaw(f) }; })(), inside: (x, z) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.R && terrainHeight(x, z) > 500 },
    { id: 'volcano', name: 'למרגלות הר הגעש · טרמפולינות ענק', sub: 'תחילת הדרך ל-5,895 מטר · מקפצות לתוך ההר', ...(() => { const e = volcanoPoint(0.05); return { x: e.x, z: e.z, yaw: volcanoYaw(0.05) }; })(), inside: (x, z) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.R * 1.04 },
    { id: 'tropicTop', name: 'פסגת הר הגעש הטרופי · 2,100 מ׳', sub: 'מעל הג׳ונגל · הענן נמוך מתחתיך', ...(() => { const f = TROPIC.phiMax - 0.12, e = volcanoPoint(f, TROPIC); return { x: e.x, z: e.z, yaw: volcanoYaw(f, TROPIC) }; })(), inside: (x, z) => Math.hypot(x - TROPIC.x, z - TROPIC.z) < TROPIC.Re + 140 && terrainHeight(x, z) > TROPIC.H * 0.9 },
    { id: 'tropic1', name: 'הר הגעש הטרופי · 1,000 מ׳', sub: 'יער גשם · שביל מתפתל', ...(() => { const f = phiAtAlt(1000, TROPIC), e = volcanoPoint(f, TROPIC); return { x: e.x, z: e.z, yaw: volcanoYaw(f, TROPIC) }; })(), inside: (x, z) => Math.hypot(x - TROPIC.x, z - TROPIC.z) < TROPIC.R && terrainHeight(x, z) > 600 },
    { id: 'tropic', name: 'הר הגעש הטרופי', sub: 'ג׳ונגל · דקלים · שביל לפסגה', ...(() => { const e = volcanoPoint(0.05, TROPIC); return { x: e.x, z: e.z, yaw: volcanoYaw(0.05, TROPIC) }; })(), inside: (x, z) => Math.hypot(x - TROPIC.x, z - TROPIC.z) < TROPIC.R * 1.04 },
    { id: 'mega', name: 'מגה רמפות', sub: 'קפיצת ענק · מגדל ספירלה · מכולות', x: -195, z: 545, yaw: PI / 2, inside: inRect(MEGA, 6) },
    { id: 'canyon', name: 'קניון הפעלולים', sub: 'קפיצות מעל תהום · מכולות · כוכב · מדרגות', x: 105, z: -350, yaw: PI, inside: inRect(NSTUNT, 6) },
    { id: 'special', name: 'פארק הפעלולים המיוחדים', sub: 'מקפצות · קרוסלה · גגות העיר · מסלולים מוטים · קפיצה מעל מכוניות', x: -625, z: -150, yaw: 0, inside: inRect(SPECIAL, 6) },
    { id: 'clifdive', name: 'צלילת הצוק', sub: 'קפיצה מגובה 22 מטר אל האגם', x: -225, z: -250, yaw: 0, inside: (x, z) => Math.abs(x + 225) < 30 && z > -200 && z < 30 },
    { id: 'lakejump', name: 'קפיצת האגם', sub: '120 מטר מעל המים', x: -70, z: 40, yaw: -PI / 2, inside: (x, z) => x > -172 && x < -40 && Math.abs(z - 40) < 22 },
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
