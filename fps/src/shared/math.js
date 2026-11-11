// Shared math helpers: seeded RNG, simplex noise, small vector utils.
// Pure JS (no three.js) so it runs in both the browser and the Node server.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const angleTo = (from, to) => wrapAngle(to - from);
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist3 = (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz);

// --- Simplex noise 2D (Stefan Gustavson, public domain), seeded permutation ---
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeNoise2(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return function noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2); // [-1,1]
  };
}

export function fbm(noise, x, y, oct = 4, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

// Ray vs AABB (slab). Returns entry t or -1. Writes normal axis into out.
export function rayBox(ox, oy, oz, idx, idy, idz, minx, miny, minz, maxx, maxy, maxz, maxT, out) {
  let t1 = (minx - ox) * idx, t2 = (maxx - ox) * idx;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), axis = 0, sgn = t1 < t2 ? -1 : 1;
  t1 = (miny - oy) * idy; t2 = (maxy - oy) * idy;
  let a = Math.min(t1, t2), b = Math.max(t1, t2);
  if (a > tmin) { tmin = a; axis = 1; sgn = t1 < t2 ? -1 : 1; }
  if (b < tmax) tmax = b;
  t1 = (minz - oz) * idz; t2 = (maxz - oz) * idz;
  a = Math.min(t1, t2); b = Math.max(t1, t2);
  if (a > tmin) { tmin = a; axis = 2; sgn = t1 < t2 ? -1 : 1; }
  if (b < tmax) tmax = b;
  if (tmax < 0 || tmin > tmax || tmin > maxT) return -1;
  if (tmin < 0) tmin = 0; // started inside
  if (out) { out.axis = axis; out.sgn = sgn; }
  return tmin;
}

// Segment-sphere test, returns t along unit dir or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxT) return -1;
  return t;
}

// Ray vs vertical capsule segment (x,z fixed) from y0 to y1, radius r.
export function rayCapsuleY(ox, oy, oz, dx, dy, dz, cx, y0, y1, cz, r, maxT) {
  // closest approach between ray and vertical segment
  // treat as infinite cylinder then clamp, plus end spheres
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  let best = -1;
  if (a > 1e-8) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      let t = (-b - s) / (2 * a);
      if (t < 0) t = (-b + s) / (2 * a);
      if (t >= 0 && t <= maxT) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r, maxT);
  if (t0 >= 0 && (best < 0 || t0 < best)) best = t0;
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r, maxT);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  return best;
}

// Direction convention (matches three.js camera with rotation order 'YXZ'):
// yaw=0 looks toward -Z, positive yaw turns left (toward -X).
export function fwd(yaw, pitch, out = [0, 0, 0]) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
  return out;
}
export function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
export function pitchTo(dy, dh) { return Math.atan2(dy, dh); }
