// Seeded RNG + 2D simplex noise
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = [1, -1, 1, -1, 1, -1, 0, 0], gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, g;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { g = perm[ii + perm[jj]] & 7; t0 *= t0; n += t0 * t0 * (gx[g] * x0 + gy[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n += t1 * t1 * (gx[g] * x1 + gy[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n += t2 * t2 * (gx[g] * x2 + gy[g] * y2); }
    return 70 * n;
  };
}
