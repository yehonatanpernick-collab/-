// World generation. Runs inside a Web Worker; returns plain typed arrays.
import {
  ss, clamp, lerp, mulberry32, fbm, nF, nG, nH, nT, nAs, nR,
  SIZE, HALF, N, CELL, BASE, TR, TCELL, valleyZ, baseE, LAKES, LK, lakeR, CHANNELS, TRAILS, spline, meander, ROAD, VISITOR, CAMP, FALLS, KEYHOLE,
} from './shared.js';

export const NC = 513, CC = SIZE / (NC - 1); // coarse grid for erosion, AO and sun visibility
const NN = N * N;
export function allocGrids() {
  return {
    H: new Float32Array(NN), NRM: new Float32Array(NN * 3),
    CHD: new Float32Array(NN).fill(1e9), CHL: new Float32Array(NN), CHID: new Int8Array(NN).fill(-1),
    LKD: new Float32Array(NN).fill(1e9), LKID: new Int8Array(NN).fill(-1),
    BIO: new Uint8Array(NN * 4), TRL: new Uint8Array(TR * TR), TRID: new Int8Array(TR * TR).fill(-1),
    EXTRA: new Uint8Array(NC * NC * 4), HC: new Float32Array(NC * NC),
  };
}
let G;
const heightAt = (x, z) => {
  const H = G.H;
  let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  gx = gx < 0 ? 0 : gx > N - 1.0001 ? N - 1.0001 : gx; gz = gz < 0 ? 0 : gz > N - 1.0001 ? N - 1.0001 : gz;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * N + i;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return (fx + fz <= 1) ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
};
const cellOf = (x, z) => clamp(Math.round((z + HALF) / CELL), 0, N - 1) * N + clamp(Math.round((x + HALF) / CELL), 0, N - 1);
const trailAt = (x, z) => clamp(Math.floor((z + HALF) / TCELL), 0, TR - 1) * TR + clamp(Math.floor((x + HALF) / TCELL), 0, TR - 1);
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// nearest-polyline rasterizer over the height grid
const TMPD = new Float32Array(NN), TMPW = new Float32Array(NN), TMPC = new Float32Array(NN), TAG = new Int32Array(NN);
let tagId = 0;
function rasterPolyline(pts, vals, cuts, infl, cb) {
  tagId++; const touched = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1], R = infl(s);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + HALF) / CELL));
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d > R) continue;
      const k = j * N + i;
      if (TAG[k] !== tagId) { TAG[k] = tagId; TMPD[k] = 1e9; touched.push(k); }
      if (d < TMPD[k]) { TMPD[k] = d; TMPW[k] = vals[s] + (vals[s + 1] - vals[s]) * t; TMPC[k] = cuts ? cuts[s] + (cuts[s + 1] - cuts[s]) * t : 0; }
    }
  }
  for (const k of touched) cb(k, TMPD[k], TMPW[k], TMPC[k]);
}

// ---------------------------------------------------------------- hydraulic erosion (droplets, coarse grid)
function erode(drops, progress) {
  const { H, EXTRA } = G, n = NC, S = 500;
  const hc = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hc[j * n + i] = H[(j * 2) * N + i * 2] / S;
  const orig = hc.slice(), flow = new Float32Array(n * n), depo = new Float32Array(n * n);
  const R = 2, bi = [], bw = []; let wsum = 0;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const d = Math.hypot(x, y); if (d <= R) { bi.push([x, y]); const w = 1 - d / R; bw.push(w); wsum += w; } }
  for (let i = 0; i < bw.length; i++) bw[i] /= wsum;
  const rnd = mulberry32(1234);
  const inertia = 0.06, capF = 5, minCap = 0.008, eSp = 0.3, dSp = 0.25, evap = 0.018, grav = 4, life = 48;
  const hg = (px, py) => {
    const x = px | 0, y = py | 0, u = px - x, v = py - y, k = y * n + x;
    const a = hc[k], b = hc[k + 1], c = hc[k + n], d = hc[k + n + 1];
    return [a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u];
  };
  for (let it = 0; it < drops; it++) {
    let px = rnd() * (n - 2), py = rnd() * (n - 2), dx = 0, dy = 0, sp = 1, water = 1, sed = 0;
    for (let l = 0; l < life; l++) {
      const nx = px | 0, ny = py | 0, ox = px - nx, oy = py - ny;
      const [h, gx, gy] = hg(px, py);
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy); if (len < 1e-9) break; dx /= len; dy /= len;
      px += dx; py += dy;
      if (px < 1 || py < 1 || px >= n - 2 || py >= n - 2) break;
      const dh = hg(px, py)[0] - h;
      const cap = Math.max(-dh * sp * water * capF, minCap);
      const k0 = ny * n + nx;
      flow[k0] += water;
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * dSp; sed -= amt;
        hc[k0] += amt * (1 - ox) * (1 - oy); hc[k0 + 1] += amt * ox * (1 - oy); hc[k0 + n] += amt * (1 - ox) * oy; hc[k0 + n + 1] += amt * ox * oy;
        depo[k0] += amt;
      } else {
        const amt = Math.min((cap - sed) * eSp, -dh);
        for (let b = 0; b < bi.length; b++) {
          const xx = nx + bi[b][0], yy = ny + bi[b][1]; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const kk = yy * n + xx, e = amt * bw[b]; hc[kk] -= e; sed += e;
        }
      }
      sp = Math.sqrt(Math.max(0, sp * sp - dh * grav)); water *= 1 - evap;
    }
    if ((it & 32767) === 32767) progress(it / drops);
  }
  // upsample the coarse delta onto the full grid
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cx = Math.min(i / 2, n - 1.001), cy = Math.min(j / 2, n - 1.001), x = cx | 0, y = cy | 0, u = cx - x, v = cy - y, k = y * n + x;
    const d = (hc[k] - orig[k]) * (1 - u) * (1 - v) + (hc[k + 1] - orig[k + 1]) * u * (1 - v) + (hc[k + n] - orig[k + n]) * (1 - u) * v + (hc[k + n + 1] - orig[k + n + 1]) * u * v;
    H[j * N + i] += clamp(d * S, -70, 45);
  }
  for (let k = 0; k < n * n; k++) { EXTRA[k * 4 + 1] = clamp(Math.log2(1 + flow[k]) * 28, 0, 255); EXTRA[k * 4 + 2] = clamp(depo[k] * S * 12, 0, 255); }
}
function thermal(iters, talus) {
  const H = G.H, lim = talus * CELL;
  for (let it = 0; it < iters; it++) for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i, h = H[k];
    let best = -1, bd = lim;
    for (const o of [1, -1, N, -N]) { const d = h - H[k + o]; if (d > bd) { bd = d; best = k + o; } }
    if (best >= 0) { const m = (bd - lim) * 0.25; H[k] -= m; H[best] += m; }
  }
}

// ---------------------------------------------------------------- main generation
export function generate(opts, progress) {
  G = allocGrids();
  const { H, NRM, CHD, CHL, CHID, LKD, LKID, BIO } = G;
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) H[j * N + i] = baseE(-HALF + i * CELL, z) - BASE;
    if ((j & 63) === 63) progress('מרים את ההרים…', 3 + 22 * j / N);
  }
  progress('שחיקה הידראולית — מים חוצבים ערוצים…', 26);
  erode(opts.mobile ? 140000 : 280000, f => progress('שחיקה הידראולית — מים חוצבים ערוצים…', 26 + f * 18));
  thermal(2, 1.15);
  progress('חוצב עמקים קרחוניים…', 45);
  for (const c of CHANNELS) c.path = meander(spline(c.pts, 12), c.mea, c.id.length * 3.7);
  const river = CHANNELS[0];
  for (const c of CHANNELS) if (c.toRiver) {
    const last = c.path[c.path.length - 1]; let best = 1e9, bp = null;
    for (const p of river.path) { const d = Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) * 0.3; if (d < best) { best = d; bp = p; } }
    c.path = meander(spline([...c.pts.slice(0, -1), [bp[0], bp[1]]], 12), c.mea, c.id.length * 3.7);
  }
  for (const c of CHANNELS) if (c.trough) {
    const prof = new Float32Array(c.path.length); let run = 1e9;
    c.path.forEach((p, i) => { run = Math.min(run, heightAt(p[0], p[1])); prof[i] = run; });
    const tw = c.trough;
    rasterPolyline(c.path, prof, null, () => tw * 3, (k, d, W) => {
      const target = d < tw ? W + 4 + (d / tw) ** 2 * tw * 0.5 : W + 4 + tw * 0.5 + (d - tw) * 0.9;
      H[k] = lerp(smin(H[k], target, 30), H[k], ss(tw * 2, tw * 3, d));
    });
  }
  // glacial cirques: amphitheatres carved behind high lakes
  for (const L of LAKES) {
    const hc = heightAt(L.x, L.z); if (hc + BASE < 2800) continue;
    let ux = 0, uz = 0, bh = -1e9;
    for (let a = 0; a < 16; a++) { const an = a / 16 * Math.PI * 2, h = heightAt(L.x + Math.cos(an) * L.r * 3, L.z + Math.sin(an) * L.r * 3); if (h > bh) { bh = h; ux = Math.cos(an); uz = Math.sin(an); } }
    if (bh - hc < 40) continue;
    const Rb = L.r * 2.8, cx = L.x + ux * L.r * 0.9, cz = L.z + uz * L.r * 0.9, floor = hc - 6;
    const i0 = Math.max(0, Math.floor((cx - Rb * 1.3 + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((cx + Rb * 1.3 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - Rb * 1.3 + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((cz + Rb * 1.3 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - cx, z - cz), k = j * N + i;
      const q = d / Rb, target = floor + Math.pow(q, 2.6) * Rb * 1.05 + nR(x * 0.01, z * 0.01) * 8;
      H[k] = lerp(smin(H[k], target, 24), H[k], ss(0.95, 1.3, q));
    }
    L.cirque = [cx, cz, Rb];
  }
  progress('ממלא אגמים…', 50);
  for (const L of LAKES) {
    const hc = heightAt(L.x, L.z); let ring = 1e9;
    for (let a = 0; a < 24; a++) { const an = a / 24 * Math.PI * 2, rr = lakeR(L, an); ring = Math.min(ring, heightAt(L.x + Math.cos(an) * rr, L.z + Math.sin(an) * rr)); }
    L.level = Math.min(0.5 * (hc + ring), hc + 2); L.hc = hc;
  }
  for (const [a, b] of [['emerald', 'dream'], ['dream', 'nymph'], ['sky', 'loch']]) LAKES[LK[b]].level = Math.min(LAKES[LK[b]].level, LAKES[LK[a]].level - 7);
  LAKES.forEach((L, id) => {
    const shore = 40 + L.r * 0.7 + Math.abs(L.hc - L.level) * 1.5, R = L.r * Math.max(L.sx, L.sy) * 1.25 + shore;
    const i0 = Math.max(0, Math.floor((L.x - R + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((L.x + R + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((L.z - R + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((L.z + R + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
      const re = lakeR(L, Math.atan2(dz, dx)), k = j * N + i, h = H[k];
      if (d < re) { const q = d / re; H[k] = L.level - L.dep * (1 - q * q) * (0.85 + 0.3 * nR(x * 0.02, z * 0.02)) - 0.4; }
      else if (d < re + shore) { const t = ss(re, re + shore, d); H[k] = (L.level - 0.4 + (d - re) * 0.15) * (1 - t) + h * t; }
      if (d - re < LKD[k]) { LKD[k] = d - re; LKID[k] = id; }
    }
  });
  progress('מזרים נחלים ונהרות…', 54);
  CHANNELS.forEach((c, cid) => {
    const n = c.path.length, W = new Float32Array(n), cut = new Float32Array(n);
    let run = 1e9;
    for (let i = 0; i < n; i++) {
      const [x, z] = c.path[i], h = heightAt(x, z), k = cellOf(x, z);
      if (LKD[k] < 0) run = Math.min(run, LAKES[LKID[k]].level); else run = Math.min(run - 0.048, h - 0.45);
      W[i] = run; cut[i] = Math.max(0, h - run);
    }
    if (c.id === FALLS.channel) { // Alberta Falls: a sudden step in the creek profile
      let fi = 0, fd = 1e9; c.path.forEach((p, i) => { const d = Math.hypot(p[0] - FALLS.x, p[1] - FALLS.z); if (d < fd) { fd = d; fi = i; } });
      const top = W[fi]; for (let i = fi + 1; i < n; i++) { W[i] = Math.min(W[i], top - FALLS.drop); cut[i] = Math.max(0, heightAt(...c.path[i]) - W[i]); }
      FALLS.at = [...c.path[fi], top]; FALLS.foot = [...c.path[Math.min(n - 1, fi + 2)], top - FALLS.drop];
    }
    c.W = W;
    const w = c.w;
    rasterPolyline(c.path, W, cut, s => w + 4 + w * 0.6 + Math.max(cut[s], cut[s + 1] || 0) * 1.7 + 2, (k, d, Wl, ct) => {
      const bank = 4 + w * 0.6 + ct * 1.6, h = H[k];
      if (d > w + bank) return;
      const target = d < w ? Wl - c.dep * (1 - (d / w) ** 2) - 0.15 : Wl + 0.2 + (d - w) * 0.3;
      let nh = target * (1 - ss(w, w + bank, d)) + h * ss(w, w + bank, d);
      if (LKD[k] < 2 || CHD[k] < 1.5) nh = Math.min(nh, h);
      H[k] = nh;
      if (d - w < CHD[k]) { CHD[k] = d - w; CHL[k] = Wl; CHID[k] = cid; }
    });
  });
  progress('סולל את טרייל רידג׳ רואד…', 57);
  carveRoad(); carvePads();
  progress('מחשב שיפועים…', 58);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    const nx = H[j * N + Math.max(0, i - 1)] - H[j * N + Math.min(N - 1, i + 1)], nz = H[Math.max(0, j - 1) * N + i] - H[Math.min(N - 1, j + 1) * N + i], ny = 2 * CELL;
    const l = Math.hypot(nx, ny, nz); NRM[k * 3] = nx / l; NRM[k * 3 + 1] = ny / l; NRM[k * 3 + 2] = nz / l;
  }
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) G.HC[j * NC + i] = H[(j * 2) * N + i * 2];
  progress('מסמן שבילים…', 61);
  buildTrailPaths(); stampRoad();
  progress('מצייר צמחייה ופרחים…', 63);
  const EX = G.EXTRA;
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -HALF + i * CELL, e = H[k] + BASE, s = 1 - NRM[k * 3 + 1], nzn = NRM[k * 3 + 2];
      const ck = (j >> 1) * NC + (i >> 1), flow = EX[ck * 4 + 1] / 255, dep = EX[ck * 4 + 2] / 255;
      const wd = Math.min(CHD[k], LKD[k]);
      const tl = 3450 + 110 * nT(x * 0.0015, z * 0.0015);
      let f = ss(-0.32, 0.12, fbm(nF, x * 0.0022, z * 0.0022, 3));
      const dv = Math.abs(z - valleyZ(x));
      f *= 1 - 0.9 * (1 - ss(300, 600, dv)) * (1 - ss(-1500, -2000, x));
      f *= ss(-0.6, -0.15, nG(x * 0.006, z * 0.006));
      f *= 1 - ss(tl - 120, tl, e);
      f *= 1 - ss(0.40, 0.58, s);
      f *= 1 - 0.45 * ss(0.08, 0.35, nzn) * (1 - ss(2650, 2900, e));
      f *= ss(3, 22, wd);
      f = Math.min(1, f * (1 + 0.5 * ss(0.45, 0.8, flow)));
      const wet = Math.max(1 - ss(0, 45, wd), ss(0.55, 0.9, flow) * 0.6);
      let g = (1 - ss(0.36, 0.52, s)) * (1 - ss(3720, 3820, e)) * (wd > 0.8 ? 1 : 0) * (1 - 0.6 * ss(0.3, 0.8, dep));
      g *= 1 - 0.7 * ss(0.3, 0.8, f);
      let fl = ss(0.0, 0.5, fbm(nH, x * 0.009, z * 0.009, 2)) * g * (1 - f) * (0.65 + 0.6 * wet) * (e > tl ? 1.1 : 0.9);
      if (dv < 500 && x > -1300 && x < 300) fl = Math.min(1, fl * 1.5 + 0.08 * g);
      BIO[k * 4] = f * 255; BIO[k * 4 + 1] = Math.min(1, fl) * 255; BIO[k * 4 + 2] = wet * 255; BIO[k * 4 + 3] = g * 255;
    }
    if ((j & 127) === 127) progress('מצייר צמחייה ופרחים…', 63 + 6 * j / N);
  }
  progress('אופה תאורה סביבתית…', 70);
  bakeAO();
  progress('שותל יערות…', 74);
  const scatterData = scatter(opts, f => progress('שותל יערות…', 74 + f * 10));
  progress('מכין חומרי קרקע…', 86);
  const tex = genLayers(opts.mobile ? 256 : 512);
  return {
    grids: G, scatter: scatterData, tex,
    lakes: LAKES.map(L => ({ level: L.level, cirque: L.cirque || null })),
    channels: CHANNELS.map(c => ({ path: c.path, W: Array.from(c.W) })),
    trails: TRAILS.map(T => ({ path: T.path, cum: T.cum })),
    road: { path: ROAD.path, prof: Array.from(ROAD.prof) }, visitor: { x: VISITOR.x, z: VISITOR.z, yaw: VISITOR.yaw || 0 }, falls: { at: FALLS.at, foot: FALLS.foot },
  };
}

// Trail Ridge Road: a smoothed grade carved into the slopes, with cut banks and fills
function carveRoad() {
  const { H } = G;
  const path = spline(ROAD.pts, 6).filter(([x, z]) => Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10);
  let prof = path.map(([x, z]) => heightAt(x, z));
  const nat = prof.slice();
  for (let it = 0; it < 3; it++) prof = prof.map((_, i) => { let s = 0, n = 0; for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < prof.length) { s += prof[j]; n++; } } return clamp(s / n, nat[i] - 6, nat[i] + 4); });
  const cut = path.map(([x, z], i) => Math.abs(heightAt(x, z) - prof[i]));
  const w = ROAD.w + 1.5;
  rasterPolyline(path, prof, cut, s => w + 6 + Math.max(cut[s], cut[s + 1] || 0) * 1.5, (k, d, Y, ct) => {
    const bank = 4 + ct * 1.4; if (d > w + bank) return;
    H[k] = lerp(Y - 0.15, H[k], ss(w, w + bank, d));
  });
  ROAD.path = path; ROAD.prof = new Float32Array(path.map(([x, z]) => heightAt(x, z)));
}
function flatten(cx, cz, r, blend, k = 1) {
  const { H } = G, y = heightAt(cx, cz);
  const i0 = Math.max(0, Math.floor((cx - r - blend + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((cx + r + blend + HALF) / CELL));
  const j0 = Math.max(0, Math.floor((cz - r - blend + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((cz + r + blend + HALF) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(-HALF + i * CELL - cx, -HALF + j * CELL - cz), t = ss(r, r + blend, d), kk = j * N + i;
    H[kk] = lerp(lerp(H[kk], y, k), H[kk], t);
  }
}
function carvePads() {
  // the visitor centre sits on the flattest ground beside the high stretch of the road
  let best = 1e9;
  ROAD.path.forEach((p, i) => {
    if (i % 4 || p[1] > -1950 || p[0] < -1000 || p[0] > 600) return;
    const a = ROAD.path[Math.max(0, i - 1)], b = ROAD.path[Math.min(ROAD.path.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (const sd of [-1, 1]) {
      const x = p[0] - (b[1] - a[1]) / l * sd * 55, z = p[1] + (b[0] - a[0]) / l * sd * 55;
      let mn = 1e9, mx = -1e9; for (let k = 0; k < 12; k++) { const an = k / 12 * Math.PI * 2, h = heightAt(x + Math.cos(an) * 32, z + Math.sin(an) * 32); mn = Math.min(mn, h); mx = Math.max(mx, h); }
      const e = heightAt(x, z) + BASE, sc = mx - mn + Math.max(0, e - 3620) * 0.6 + Math.max(0, 3480 - e) * 0.6; if (sc < best) { best = sc; VISITOR.x = x; VISITOR.z = z; VISITOR.yaw = Math.atan2(p[0] - x, p[1] - z); }
    }
  });
  flatten(VISITOR.x, VISITOR.z, 32, 22);
  flatten(CAMP.x, CAMP.z, CAMP.r, 30, 0.75);
  // the Keyhole: a notch through the Longs Peak ridge
  const { H } = G, ky = heightAt(KEYHOLE.x, KEYHOLE.z) - 16;
  for (let j = 0; j < N; j++) { const z = -HALF + j * CELL; if (Math.abs(z - KEYHOLE.z) > 40) continue;
    for (let i = 0; i < N; i++) { const x = -HALF + i * CELL, d = Math.hypot(x - KEYHOLE.x, z - KEYHOLE.z); if (d < 40) H[j * N + i] = Math.min(H[j * N + i], ky + d * d * 0.03); } }
}
function stampRoad() {
  const { TRL } = G, mark = (x, z, rad, v) => {
    const ci = (x + HALF) / TCELL - 0.5, cj = (z + HALF) / TCELL - 0.5, R = Math.ceil(rad / TCELL) + 1;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = Math.round(ci) + di, jj = Math.round(cj) + dj; if (ii < 0 || jj < 0 || ii >= TR || jj >= TR) continue;
      const d = Math.hypot(ii - ci, jj - cj) * TCELL; if (d < rad) { const k = jj * TR + ii; TRL[k] = Math.max(TRL[k], v); }
    }
  };
  for (const [x, z] of ROAD.path) mark(x, z, ROAD.w + 2.5, 255);
  mark(VISITOR.x, VISITOR.z, 30, 210);
  for (let a = 0; a < 40; a++) { const an = a / 40 * Math.PI * 2; mark(CAMP.x + Math.cos(an) * CAMP.r * 0.5, CAMP.z + Math.sin(an) * CAMP.r * 0.5, CAMP.r * 0.55, 70); }
}
function buildTrailPaths() {
  const { TRL, TRID } = G;
  TRAILS.forEach((T, tid) => {
    let p = spline(T.pts, 3);
    p = p.map(([x, z]) => {
      for (const L of LAKES) {
        const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz), re = lakeR(L, Math.atan2(dz, dx)) + 6;
        if (d < re) { x = L.x + dx / (d || 1) * re; z = L.z + dz / (d || 1) * re; }
      }
      return [x, z];
    });
    for (let it = 0; it < 3; it++) p = p.map((q, i) => i === 0 || i === p.length - 1 ? q : [(p[i - 1][0] + q[0] * 2 + p[i + 1][0]) / 4, (p[i - 1][1] + q[1] * 2 + p[i + 1][1]) / 4]);
    const out = [p[0]];
    for (let i = 1; i < p.length; i++) {
      const a = out[out.length - 1], b = p[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(d / 2);
      for (let s = 1; s <= n; s++) out.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
    }
    T.path = out;
    T.cum = [0]; for (let i = 1; i < out.length; i++) T.cum.push(T.cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    for (const [x, z] of out) {
      const ci = (x + HALF) / TCELL - 0.5, cj = (z + HALF) / TCELL - 0.5;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = Math.round(ci) + di, jj = Math.round(cj) + dj; if (ii < 0 || jj < 0 || ii >= TR || jj >= TR) continue;
        const v = clamp(1 - (Math.hypot(ii - ci, jj - cj) * TCELL - 0.7) / 2.2, 0, 1) * 255, k = jj * TR + ii;
        if (v > TRL[k]) { TRL[k] = v; TRID[k] = tid; }
      }
    }
  });
}

// horizon-based ambient occlusion on the coarse grid
function bakeAO() {
  const { HC, EXTRA } = G, n = NC, steps = [12, 25, 45, 75, 120, 190, 300, 450];
  const dirs = []; for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h0 = HC[j * n + i]; let occ = 0;
    for (const [dx, dz] of dirs) {
      let mt = 0;
      for (const s of steps) {
        const x = Math.round(i + dx * s / CC), z = Math.round(j + dz * s / CC); if (x < 0 || z < 0 || x >= n || z >= n) break;
        const t = (HC[z * n + x] - h0) / s; if (t > mt) mt = t;
      }
      occ += mt / Math.sqrt(1 + mt * mt);
    }
    EXTRA[(j * n + i) * 4] = clamp(255 * (1 - occ / 8 * 1.1), 40, 255);
    EXTRA[(j * n + i) * 4 + 3] = 255;
  }
}

// direct-sunlight visibility from the surrounding mountains, soft-edged
export function bakeSun(HC, sx, sy, sz) {
  const n = NC, out = new Uint8Array(n * n);
  if (sy <= -0.02) return out;
  const hl = Math.hypot(sx, sz) || 1, dx = sx / hl, dz = sz / hl, tanE = sy / hl;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h0 = HC[j * n + i] + 2; let vis = 1, s = CC;
    for (let st = 0; st < 26 && vis > 0; st++) {
      const x = i + dx * s / CC, z = j + dz * s / CC; if (x < 0 || z < 0 || x > n - 1 || z > n - 1) break;
      const th = HC[(z | 0) * n + (x | 0)], ry = h0 + s * tanE;
      vis = Math.min(vis, clamp((ry - th) / (s * 0.035 + 3) + 0.5, 0, 1));
      s *= 1.28;
    }
    out[j * n + i] = vis * ss(-0.02, 0.06, sy) * 255;
  }
  return out;
}

// ---------------------------------------------------------------- scatter: trees, shrubs, snags, rocks, logs
export const SPECIES = ['spruce', 'fir', 'lodgepole', 'ponderosa', 'aspen', 'krummholz', 'willow', 'snag', 'shrub'];
export const STRIDE = 11; // x y z rx ry sx sy sz r g b
function scatter(opts, progress) {
  const { H, NRM, BIO, CHD, LKD, TRL, EXTRA } = G;
  const rnd = mulberry32(42), data = Object.fromEntries(SPECIES.map(s => [s, []]));
  const sp = opts.mobile ? 8.5 : 6.4, n = Math.floor(SIZE / sp);
  const put = (arr, x, z, h, w, tint, lean = 0.06) => { arr.push(x, heightAt(x, z) - 0.25, z, (rnd() - 0.5) * lean, rnd() * 6.283, h * w, h, h * w, tint[0], tint[1], tint[2]); };
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = -HALF + (gx + rnd()) * sp, z = -HALF + (gz + rnd()) * sp, k = cellOf(x, z);
      const f = BIO[k * 4] / 255, wd = Math.min(CHD[k], LKD[k]), e = H[k] + BASE, r = rnd();
      if (TRL[trailAt(x, z)] > 50 || wd < 2.5) continue;
      const t = 0.86 + rnd() * 0.28, tint = [t * (0.94 + rnd() * 0.12), t, t * (0.94 + rnd() * 0.12)];
      const tl = 3450 + 110 * nT(x * 0.0015, z * 0.0015), s = 1 - NRM[k * 3 + 1];
      if (r < f * 0.92) {
        const shrink = 1 - 0.6 * ss(tl - 320, tl, e);
        let spc;
        if (e < 2950 && nAs(x * 0.004, z * 0.004) > 0.3) spc = 'aspen';
        else if (e < 2750) spc = (NRM[k * 3 + 2] > 0.05 || rnd() < 0.35) ? 'ponderosa' : 'lodgepole';
        else if (e < 3150) { const q = rnd(); spc = q < 0.55 ? 'lodgepole' : q < 0.85 ? 'spruce' : 'fir'; }
        else spc = rnd() < 0.55 ? 'spruce' : 'fir';
        if (spc !== 'aspen' && e > 2800 && rnd() < 0.035) spc = 'snag';
        const hr = { spruce: [14, 27], fir: [10, 21], lodgepole: [14, 25], ponderosa: [16, 29], aspen: [8, 16], snag: [9, 20] }[spc];
        const young = rnd() < 0.18 ? 0.35 + rnd() * 0.4 : 1;
        put(data[spc], x, z, lerp(hr[0], hr[1], rnd()) * shrink * young, 0.85 + rnd() * 0.35, tint);
      } else if (e > tl - 90 && e < tl + 50 && s < 0.45 && rnd() < 0.16) {
        put(data.krummholz, x, z, 0.8 + rnd() * 1.1, 1.6 + rnd() * 1.2, tint, 0.15);
      } else if (wd > 2.5 && wd < 16 && e < 3100 && s < 0.2 && rnd() < 0.32) {
        put(data.willow, x, z, 1.5 + rnd() * 2.2, 1.0 + rnd() * 0.5, tint, 0.2);
      } else if (f < 0.35 && f > 0.03 && e < 3300 && s < 0.35 && rnd() < 0.09) {
        put(data.shrub, x, z, 0.6 + rnd() * 0.8, 1.1 + rnd() * 0.6, tint, 0.2);
      } else if (f < 0.1 && BIO[k * 4 + 3] > 120 && e < 3300 && rnd() < 0.004) {
        put(data[e < 2800 ? 'ponderosa' : 'spruce'], x, z, 12 + rnd() * 12, 1.0 + rnd() * 0.3, tint);
      }
    }
    if ((gz & 127) === 127) progress(gz / n * 0.8);
  }
  const rocks = [], logs = [], rs = 12, rn = Math.floor(SIZE / rs);
  for (let gz = 0; gz < rn; gz++) for (let gx = 0; gx < rn; gx++) {
    const x = -HALF + (gx + rnd()) * rs, z = -HALF + (gz + rnd()) * rs, k = cellOf(x, z);
    const e = H[k] + BASE, s = 1 - NRM[k * 3 + 1], wd = Math.min(CHD[k], LKD[k]), f = BIO[k * 4] / 255, tl = 3450 + 110 * nT(x * 0.0015, z * 0.0015);
    const dep = EXTRA[(((gz * rs) / (2 * CELL) | 0) * NC + ((gx * rs) / (2 * CELL) | 0)) * 4 + 2] / 255;
    if (s > 0.65 || TRL[trailAt(x, z)] > 40) continue;
    let p = 0.012, size = 1.5 + rnd() * 2.5;
    if (e > tl) { p += 0.24; size = 0.4 + rnd() * rnd() * 2.4; }
    if (s > 0.3 && e > 2900) { p += 0.38; size = 0.4 + rnd() * 1.4; }
    if (dep > 0.3 && e > 2900) { p += 0.25; size = 0.3 + rnd() * 1.0; }
    if (wd > -2 && wd < 10) { p += 0.16; size = 0.4 + rnd() * 1.2; }
    if (f > 0.5) p += 0.02;
    if (rnd() < p) {
      const g = 0.85 + rnd() * 0.3, warm = rnd() * 0.08;
      rocks.push(x, heightAt(x, z) - size * 0.3, z, (rnd() - 0.5) * 0.5, rnd() * 6.283, size * (0.8 + rnd() * 0.5), size, size * (0.8 + rnd() * 0.5), g + warm, g, g - warm * 0.5);
    }
    if (f > 0.5 && rnd() < 0.045) {
      const len = 5 + rnd() * 9, rad = 0.16 + rnd() * 0.18, g = 0.8 + rnd() * 0.3;
      logs.push(x, heightAt(x, z) + rad * 0.6, z, (rnd() - 0.5) * 0.1, rnd() * 6.283, len, rad * 2, rad * 2, g, g, g);
    }
  }
  progress(1);
  const out = {}; for (const s of SPECIES) out[s] = new Float32Array(data[s]);
  out.rocks = new Float32Array(rocks); out.logs = new Float32Array(logs);
  return out;
}

// ---------------------------------------------------------------- procedural ground materials (tileable)
export const LAYERS = ['grass', 'forest', 'rock', 'gravel', 'snow', 'dirt', 'tundra'];
function pHash(ix, iy, seed) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function pNoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  return lerp(lerp(pHash(x0, y0, seed), pHash(x1, y0, seed), u), lerp(pHash(x0, y1, seed), pHash(x1, y1, seed), u), v);
}
function pfbm(u, v, P, oct, seed, aniso = 1) { let s = 0, a = 0.5, n = 0, p = P; for (let o = 0; o < oct; o++) { s += a * pNoise(u * p, v * p * aniso, p, p * aniso, seed + o); n += a; a *= 0.5; p *= 2; } return s / n; }
function pVor(u, v, P, seed) {
  const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P;
    const fx = cx + pHash(wx, wy, seed), fy = cy + pHash(wx, wy, seed + 7), d = Math.hypot(fx - x, fy - y);
    if (d < d1) { d2 = d1; d1 = d; id = pHash(wx, wy, seed + 3); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function genLayers(S) {
  const L = LAYERS.length, alb = new Uint8Array(S * S * 4 * L), nrm = new Uint8Array(S * S * 4 * L), hgt = new Float32Array(S * S);
  const R = mulberry32(9);
  for (let l = 0; l < L; l++) {
    const name = LAYERS[l], base = l * S * S * 4;
    const cols = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, p = y * S + x;
      let c, h;
      if (name === 'grass') {
        const n1 = pfbm(u, v, 6, 4, 11), st = pfbm(u, v, 24, 3, 12, 5), dry = ss(0.62, 0.78, pfbm(u, v, 3, 3, 13));
        c = mixc([46, 66, 24], [104, 124, 50], n1 * 0.55 + st * 0.45); c = mixc(c, [150, 138, 78], dry * 0.7);
        if (pHash(x, y, 14) > 0.985) c = mixc(c, [170, 170, 90], 0.6);
        h = 0.35 * n1 + 0.65 * st;
      } else if (name === 'forest') {
        const n1 = pfbm(u, v, 5, 4, 21), moss = ss(0.6, 0.72, pfbm(u, v, 4, 3, 22));
        c = mixc([50, 46, 32], [92, 82, 56], n1); c = mixc(c, [58, 80, 36], moss * 0.85); h = n1 * 0.5 + moss * 0.3;
      } else if (name === 'rock') {
        const [d1, d2] = pVor(u, v, 4, 31), crack = ss(0.0, 0.025, d2 - d1), n1 = pfbm(u, v, 8, 5, 32), g = pHash(x, y, 33);
        c = mixc([118, 110, 104], [176, 166, 158], n1);
        if (g < 0.07) c = mixc(c, [40, 38, 38], 0.8); else if (g < 0.2) c = mixc(c, [222, 216, 210], 0.6); else if (g < 0.3) c = mixc(c, [196, 150, 138], 0.5);
        const lich = ss(0.66, 0.74, pfbm(u, v, 10, 3, 34)), lc = pHash(Math.floor(u * 10), Math.floor(v * 10), 35) > 0.5 ? [176, 156, 62] : [190, 118, 54];
        c = mixc(c, lc, lich * 0.75); c = mixc([72, 66, 62], c, 0.62 + 0.38 * crack);
        h = 0.3 * crack + 0.7 * n1;
      } else if (name === 'gravel') {
        const [d1, , id] = pVor(u, v, 22, 41), sz = 0.62, dome = Math.sqrt(Math.max(0, 1 - (d1 / sz) ** 2));
        const t = 92 + id * 70; c = mixc([t, t * 0.95, t * 0.88], [70, 64, 56], 1 - ss(0.0, 0.5, dome)); c = mixc(c, [150, 120, 90], pHash(Math.floor(id * 1000), 1, 42) > 0.8 ? 0.4 : 0);
        h = dome;
      } else if (name === 'snow') {
        const n1 = pfbm(u, v, 3, 5, 51), rip = pfbm(u, v, 12, 3, 52, 3);
        c = mixc([200, 212, 232], [246, 248, 252], ss(0.25, 0.75, n1 * 0.7 + rip * 0.3)); h = n1 * 0.7 + rip * 0.3;
      } else if (name === 'dirt') {
        const n1 = pfbm(u, v, 6, 4, 61), [d1, , id] = pVor(u, v, 40, 62), peb = d1 < 0.28 ? 1 - d1 / 0.28 : 0;
        c = mixc([120, 98, 70], [168, 142, 104], n1); if (peb > 0) c = mixc(c, [150 + id * 60, 140 + id * 50, 120 + id * 40], Math.min(1, peb * 2));
        h = n1 * 0.5 + peb * 0.6;
      } else {
        const n1 = pfbm(u, v, 5, 4, 71), moss = ss(0.56, 0.66, pfbm(u, v, 14, 3, 72)), lich = ss(0.72, 0.78, pfbm(u, v, 20, 2, 73));
        c = mixc([104, 98, 58], [146, 132, 88], n1); c = mixc(c, [74, 96, 40], moss * 0.8); c = mixc(c, [200, 196, 170], lich * 0.6);
        h = n1 * 0.4 + moss * 0.5;
      }
      cols[p * 3] = c[0]; cols[p * 3 + 1] = c[1]; cols[p * 3 + 2] = c[2]; hgt[p] = h;
    }
    if (name === 'forest') { // pine needles
      for (let i = 0; i < S * S / 26; i++) {
        let x = R() * S, y = R() * S; const a = R() * 6.283, len = S * (0.012 + R() * 0.02), tone = R();
        for (let t = 0; t < len; t++) { const xi = ((Math.round(x) % S) + S) % S, yi = ((Math.round(y) % S) + S) % S, p = yi * S + xi; cols[p * 3] = lerp(70, 150, tone); cols[p * 3 + 1] = lerp(48, 104, tone); cols[p * 3 + 2] = lerp(30, 62, tone); hgt[p] += 0.25; x += Math.cos(a); y += Math.sin(a); }
      }
    }
    let mean = 0; for (let p = 0; p < S * S; p++) mean += hgt[p]; mean /= S * S;
    const k = { grass: 3, forest: 2.5, rock: 4.5, gravel: 4, snow: 1.2, dirt: 2.5, tundra: 3 }[name] * S / 256;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = y * S + x, o = base + p * 4;
      alb[o] = cols[p * 3]; alb[o + 1] = cols[p * 3 + 1]; alb[o + 2] = cols[p * 3 + 2]; alb[o + 3] = clamp((hgt[p] - mean) * 255 + 128, 0, 255);
      const hx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S], hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      let nx = -hx * k, ny = -hy * k; const nl = Math.hypot(nx, ny, 1);
      nrm[o] = (nx / nl * 0.5 + 0.5) * 255; nrm[o + 1] = (ny / nl * 0.5 + 0.5) * 255; nrm[o + 2] = (1 / nl * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
    }
  }
  return { size: S, layers: L, alb, nrm };
}
