// Seeded 2D simplex noise + helpers used by the offline world bake.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

export function makeSimplex(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm8 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] & 7; }
  return function noise(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm8[ii + perm[jj]] * 2; t0 *= t0; n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm8[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm8[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2); }
    return 70 * n; // ~[-1,1]
  };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
export function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
export function smax(a, b, k) { return -smin(-a, -b, k); }

export function fbm(n, x, y, oct, lac = 2, gain = 0.5) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return s / norm;
}

// Ridged multifractal (Musgrave) — sharp crests, used for jagged ridgelines.
export function ridged(n, x, y, oct, lac = 2.03, gain = 0.52, offset = 1.0) {
  let s = 0, a = 1, f = 1, w = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let v = offset - Math.abs(n(x * f + o * 17.3, y * f - o * 9.1));
    v *= v;
    v *= w;
    w = clamp(v * 1.6, 0, 1);
    s += v * a; norm += a;
    a *= gain; f *= lac;
  }
  return s / norm;
}

// distance from p to polyline; returns {d, t (0..1 along total), seg index, u (along seg)}
export function polyDist(px, pz, pts, cum, total) {
  let best = 1e30, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let u = ((px - ax) * dx + (pz - az) * dz) / L2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + u * dx - px, qz = az + u * dz - pz;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) { best = d2; bt = (cum[i] + u * Math.sqrt(L2)) / total; }
  }
  return [Math.sqrt(best), bt];
}

// Catmull-Rom spline through control points, sampled every `step` metres
export function catmull(points, step, closed = false) {
  const P = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      const q = [];
      for (let c = 0; c < p1.length; c++) q.push(f(p0[c], p1[c], p2[c], p3[c]));
      out.push(q);
    }
  }
  if (!closed) out.push(points[points.length - 1].slice());
  return out;
}
