// CPU-side terrain sampling. The GPU terrain shader (terrain.js) implements the
// exact same functions in GLSL, so what you see is what the wheels drive on.
//  - base height: Catmull-Rom bicubic on the 4 m baked grid (u16, 0.1 m units)
//  - micro relief: two octaves of integer-hash value noise, amplitude driven by
//    the surface masks (smooth on roads, rough on rock / scree)

export const WORLD = {
  size: 8192,      // playable core, metres
  half: 4096,
  n: 2049,         // samples per side
  cell: 4,         // metres per sample
  maskN: 1025,     // surface masks are stored at 8 m
  maskCell: 8,
  farSize: 40960,
  farN: 1025,
  hUnit: 0.1,      // metres per u16 step
};

export function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// metres; amp from masks: road (0..1), rock (0..1)
export function detailNoise(x, z, road, rock) {
  const qx = x + 10000, qz = z + 10000;            // keep lattice coords positive (matches GLSL)
  const n1 = vnoise(qx * 0.4, qz * 0.4);             // 2.5 m bumps
  const n2 = vnoise(qx * 1.1 + 31.7, qz * 1.1 + 17.3); // 0.9 m bumps
  const amp = (0.22 + 0.45 * rock) * (1 - 0.82 * road);
  return amp * (n1 + 0.45 * n2 - 0.725);
}

function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export class HeightField {
  constructor({ height, masks, water, n = WORLD.n, cell = WORLD.cell, half = WORLD.half }) {
    this.h = height;   // Uint16Array n*n
    this.m = masks;    // Uint8Array maskN^2*8 : [wet, sediment, forest, snow, road, waterProx, flowers, rock]
    this.mn = WORLD.maskN; this.minv = 1 / WORLD.maskCell;
    this.w = water;    // Uint16Array n*n  : water surface (0.1 m) or 0
    this.n = n; this.cell = cell; this.half = half;
    this.inv = 1 / cell;
  }

  _H(i, j) {
    const n = this.n;
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.h[j * n + i] * WORLD.hUnit;
  }

  // bicubic base height
  baseHeight(x, z) {
    const gx = (x + this.half) * this.inv, gz = (z + this.half) * this.inv;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const tx = gx - ix, tz = gz - iz;
    const r = [];
    for (let k = -1; k <= 2; k++) {
      r.push(cr(this._H(ix - 1, iz + k), this._H(ix, iz + k), this._H(ix + 1, iz + k), this._H(ix + 2, iz + k), tx));
    }
    return cr(r[0], r[1], r[2], r[3], tz);
  }

  // bilinear mask channel 0..1
  mask(x, z, ch) {
    const n = this.mn;
    const gx = (x + this.half) * this.minv, gz = (z + this.half) * this.minv;
    let ix = Math.floor(gx), iz = Math.floor(gz);
    const tx = gx - ix, tz = gz - iz;
    const i0 = Math.min(n - 1, Math.max(0, ix)), i1 = Math.min(n - 1, Math.max(0, ix + 1));
    const j0 = Math.min(n - 1, Math.max(0, iz)), j1 = Math.min(n - 1, Math.max(0, iz + 1));
    const m = this.m;
    const a = m[(j0 * n + i0) * 8 + ch], b = m[(j0 * n + i1) * 8 + ch];
    const c = m[(j1 * n + i0) * 8 + ch], d = m[(j1 * n + i1) * 8 + ch];
    return ((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz) / 255;
  }

  height(x, z) {
    return this.baseHeight(x, z) + detailNoise(x, z, this.mask(x, z, 4), this.mask(x, z, 7));
  }

  normal(x, z, out, e = 0.35) {
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // water surface height (nearest sample, bilinear between wet samples) or -Infinity
  waterLevel(x, z) {
    const n = this.n;
    const gx = (x + this.half) * this.inv, gz = (z + this.half) * this.inv;
    const ix = Math.round(gx), iz = Math.round(gz);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return -Infinity;
    const v = this.w[iz * n + ix];
    return v ? v * WORLD.hUnit : -Infinity;
  }

  inCore(x, z, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }
}
