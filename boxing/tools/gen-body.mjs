// Offline generator: builds a muscular fighter body (SDF -> surface nets),
// skinned to the Ready Player Me / Mixamo-style skeleton, plus boxing gloves.
// Usage: node tools/gen-body.mjs <bones.json> <outDir>
import fs from 'fs';

const [,, bonesFile, outDir] = process.argv;
const BONES = JSON.parse(fs.readFileSync(bonesFile, 'utf8'));
const JOINTS = BONES.__joints; // ordered joint names (skin indices)

// ---------- vector helpers ----------
const V = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- SDF primitives ----------
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

// round cone between points a,b with radii r1,r2 (iq)
function roundCone(p, a, b, r1, r2) {
  const ba = sub(b, a); const l2 = dot(ba, ba); const rr = r1 - r2; const a2 = l2 - rr * rr; const il2 = 1 / l2;
  const pa = sub(p, a); const y = dot(pa, ba); const z = y - l2;
  const xv = sub(mul(pa, l2), mul(ba, y)); const x2 = dot(xv, xv);
  const y2 = y * y * l2; const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
// oriented ellipsoid: basis {x,y,z} unit vectors, radii r
function ellipsoid(p, c, B, r) {
  const d = sub(p, c);
  const lx = dot(d, B[0]), ly = dot(d, B[1]), lz = dot(d, B[2]);
  const k0 = Math.hypot(lx / r[0], ly / r[1], lz / r[2]);
  const k1 = Math.hypot(lx / (r[0] * r[0]), ly / (r[1] * r[1]), lz / (r[2] * r[2]));
  return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
}
const WB = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
// basis with Y along dir, Z as close as possible to 'front'
function basisY(dir, front) {
  const y = norm(dir);
  let z = sub(front, mul(y, dot(front, y))); z = norm(z);
  const x = cross(y, z);
  return [x, y, z];
}
function rotZ(B, ang) { // rotate basis around its own z
  const c = Math.cos(ang), s = Math.sin(ang);
  return [add(mul(B[0], c), mul(B[1], s)), add(mul(B[0], -s), mul(B[1], c)), B[2]];
}
function rotX(B, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [B[0], add(mul(B[1], c), mul(B[2], s)), add(mul(B[1], -s), mul(B[2], c))];
}

const b = (n) => BONES[n];

// ---------- body definition ----------
// part labels used for skin weighting & materials
const P_TORSO = 0, P_NECK = 1, P_ARM = 2, P_LEG = 3, P_PELVIS = 4;

function makeBody(cfg) {
  const M = cfg.muscle, T = cfg.torso, DEF = cfg.definition;
  const LA = b('LeftArm'), LFA = b('LeftForeArm'), LH = b('LeftHand');
  const LUL = b('LeftUpLeg'), LL = b('LeftLeg'), LF = b('LeftFoot'), LTB = b('LeftToeBase'), LTE = b('LeftToe_End');
  const FRONT = V(0, 0, 1);
  const uA = norm(sub(LFA, LA)), lA = len(sub(LFA, LA));
  const uF = norm(sub(LH, LFA)), lF = len(sub(LH, LFA));
  const BA = basisY(uA, FRONT), BF = basisY(uF, FRONT);
  const uT = norm(sub(LL, LUL)), lT = len(sub(LL, LUL));
  const uC = norm(sub(LF, LL)), lC = len(sub(LF, LL));
  const BT = basisY(uT, FRONT), BC = basisY(uC, FRONT);
  const sh = cfg.shoulders;

  const torsoPrims = [];
  // [fn(q)->d , k]
  const E = (c, B, r) => (q) => ellipsoid(q, c, B, r);
  // core
  const ribcage = E(V(0, 1.335, -0.008), WB, [0.148 * T, 0.2, 0.113 * T]);
  const upperChest = E(V(0, 1.435, -0.022), WB, [0.175 * sh, 0.08, 0.098 * T]);
  const abdomen = E(V(0, 1.17, -0.01), WB, [0.122 * T, 0.15, 0.092 * T + cfg.belly]);
  const pelvis = E(V(0, 1.0, -0.004), WB, [0.148 * T, 0.105, 0.108 * T]);
  const pecL = E(V(0.073, 1.392, 0.063 * T), rotZ(rotX(WB, -0.25), 0.22), [0.082 * M * sh, 0.06 * M, 0.048 * M]);
  const latL = E(V(0.11 * T, 1.32, -0.04), rotZ(WB, 0.32), [0.066 * M, 0.13, 0.072 * M]);
  const obliqueL = E(V(0.088 * T, 1.12, 0.0), rotZ(WB, 0.1), [0.04 * T, 0.085, 0.07 * T]);
  const trapL = E(V(0.068, 1.488, -0.05), rotZ(WB, -0.42), [0.092 * cfg.neckBulk, 0.05 * cfg.neckBulk, 0.058]);
  const gluteL = E(V(0.068, 0.945, -0.055), WB, [0.083, 0.098, 0.082]);
  const serratusRows = [1.32, 1.28, 1.24];
  const absRows = [1.272, 1.207, 1.142, 1.085];
  const neck = (q) => roundCone(q, V(0, 1.44, -0.03), V(0, 1.625, -0.008), 0.06 * cfg.neckBulk, 0.05);
  const collarL = (q) => roundCone(q, V(0.025, 1.462, 0.052), V(0.15 * sh, 1.502, 0.0), 0.013, 0.016);
  const spineGroove = (q) => roundCone(q, V(0, 1.06, -0.128), V(0, 1.44, -0.122), 0.008, 0.008);

  // arm (left side, evaluated on mirrored q)
  const delt = E(add(add(LA, V(0.008 * sh, -0.004, 0.0)), mul(uA, 0.03)), BA, [0.052 * M * sh, 0.075 * M, 0.06 * M]);
  const upperArm = (q) => roundCone(q, LA, LFA, 0.047 * M, 0.038);
  const biceps = E(add(add(LA, mul(uA, lA * 0.55)), mul(BA[2], 0.022 * M)), BA, [0.037 * M, 0.072 * M, 0.04 * M]);
  const triceps = E(add(add(LA, mul(uA, lA * 0.4)), mul(BA[2], -0.026)), BA, [0.041 * M, 0.095, 0.039 * M]);
  const forearm = (q) => roundCone(q, LFA, LH, 0.039 * M, 0.026);
  const forearmBulk = E(add(add(LFA, mul(uF, lF * 0.27)), mul(BF[0], 0.006)), BF, [0.044 * M, 0.08, 0.039 * M]);
  const handStub = E(add(LH, mul(uF, 0.03)), BF, [0.032, 0.05, 0.022]);

  // leg
  const thigh = (q) => roundCone(q, add(LUL, V(-0.01, 0.02, 0)), LL, 0.088 * cfg.legs, 0.051);
  const quads = E(add(add(LUL, mul(uT, lT * 0.45)), mul(BT[2], 0.036)), BT, [0.066 * cfg.legs, 0.18, 0.054 * cfg.legs]);
  const vmo = E(add(add(LL, mul(uT, -0.1)), add(mul(BT[2], 0.03), mul(BT[0], -0.032))), BT, [0.042, 0.06, 0.036]);
  const vl = E(add(add(LUL, mul(uT, lT * 0.5)), add(mul(BT[2], 0.012), mul(BT[0], 0.04))), BT, [0.05, 0.16, 0.05]);
  const hams = E(add(add(LUL, mul(uT, lT * 0.45)), mul(BT[2], -0.036)), BT, [0.06 * cfg.legs, 0.17, 0.05]);
  const knee = (q) => ellipsoid(q, add(LL, V(0, 0.0, 0.012)), BT, [0.048, 0.055, 0.046]);
  const calf = (q) => roundCone(q, LL, add(LF, V(0, 0.03, 0)), 0.048, 0.031);
  const gastro = E(add(add(LL, mul(uC, lC * 0.27)), add(mul(BC[2], -0.03), mul(BC[0], -0.006))), BC, [0.05 * cfg.legs, 0.105, 0.045]);
  const heel = add(LF, V(0.0, -0.085, -0.018));
  const foot = (q) => {
    let d = roundCone(q, heel, add(LTB, V(0, -0.01, 0)), 0.037, 0.04);
    d = smin(d, roundCone(q, add(LTB, V(0, -0.01, 0)), add(LTE, V(0, -0.004, -0.05)), 0.04, 0.032), 0.02);
    d = smin(d, roundCone(q, LF, heel, 0.036, 0.037), 0.02);
    return smax(d, -q[1] + 0.002, 0.006); // flat sole
  };

  // shorts (wide, Muay-Thai / boxing trunks)
  const shortsTop = 1.115, shortsHem = cfg.hem;
  const shorts = (q, dBody) => {
    let d = ellipsoid(q, V(0, 1.0, -0.006), WB, [0.158 * T, 0.13, 0.122 * T]);
    const tA = add(LUL, V(0.008, 0.0, 0.0));
    const tB = add(LUL, mul(uT, (LUL[1] - shortsHem + 0.05) / Math.abs(uT[1])));
    d = smin(d, roundCone(q, tA, add(tB, V(0.012, 0, 0.0)), 0.098, 0.1 * cfg.legs), 0.05);
    d = smin(d, dBody - 0.014, 0.02);
    d = smax(d, q[1] - shortsTop, 0.004);
    d = Math.max(d, shortsHem - q[1]);
    return d;
  };
  const bootTop = 0.33;

  function body(p) {
    const q = V(Math.abs(p[0]), p[1], p[2]);
    // torso
    let d = smin(ribcage(q), upperChest(q), 0.06);
    d = smin(d, abdomen(q), 0.08);
    d = smin(d, pelvis(q), 0.07);
    d = smin(d, latL(q), 0.05);
    d = smin(d, obliqueL(q), 0.045);
    d = smin(d, pecL(q), 0.022);
    d = smin(d, trapL(q), 0.05);
    d = smin(d, collarL(q), 0.03);
    d = smin(d, gluteL(q), 0.05);
    // abs
    let ab = 1e9;
    for (let i = 0; i < absRows.length; i++) {
      const y = absRows[i]; const w = i === 3 ? 0.03 : 0.033;
      ab = Math.min(ab, ellipsoid(q, V(0.037, y, 0.074 * T + cfg.belly * 0.7), WB, [w, 0.029, 0.03]));
    }
    d = smin(d, ab, 0.011 + (1 - DEF) * 0.03);
    // serratus fingers
    let se = 1e9;
    for (const y of serratusRows) se = Math.min(se, ellipsoid(q, V(0.122 * T, y, 0.05), rotZ(WB, 0.5), [0.01, 0.018, 0.018]));
    d = smin(d, se, 0.02 + (1 - DEF) * 0.02);
    d = smax(d, -spineGroove(q), 0.02);
    // centre line between pecs / abs
    d = smax(d, -roundCone(q, V(0, 1.1, 0.112 * T + cfg.belly * 0.7), V(0, 1.40, 0.122 * T), 0.006, 0.008), 0.01);
    let part = P_TORSO;
    // neck
    const dn = neck(q);
    if (dn < d) part = P_NECK;
    d = smin(d, dn, 0.04);
    // arm
    let da = smin(upperArm(q), delt(q), 0.03);
    da = smin(da, biceps(q), 0.02);
    da = smin(da, triceps(q), 0.025);
    let df = smin(forearm(q), forearmBulk(q), 0.03);
    df = smin(df, handStub(q), 0.02);
    da = smin(da, df, 0.035);
    if (da < d) part = P_ARM;
    d = smin(d, da, 0.035);
    // leg
    let dl = smin(thigh(q), quads(q), 0.04);
    dl = smin(dl, vl(q), 0.03);
    dl = smin(dl, vmo(q), 0.03);
    dl = smin(dl, hams(q), 0.04);
    dl = smin(dl, knee(q), 0.03);
    let dc = smin(calf(q), gastro(q), 0.03);
    dc = smin(dc, foot(q), 0.04);
    dl = smin(dl, dc, 0.03);
    // do not let the two legs merge
    if (dl < d - 0.0 && q[1] < 0.9) part = P_LEG;
    else if (dl < d && part === P_TORSO) part = q[1] < 0.95 ? P_LEG : P_PELVIS;
    // keep inner thighs from welding
    d = smin(d, dl, q[1] > 0.93 ? 0.05 : 0.01);
    // gap between legs
    if (q[1] < 0.9) d = smax(d, -(q[0] - 0.012), 0.012);

    let mat = 0; // 0 skin, 1 shorts, 2 trim, 3 boots, 4 boot trim
    // boots: thicker below bootTop
    if (q[1] < bootTop && dl <= d + 0.02) {
      const dB = dc - (q[1] < bootTop - 0.025 ? 0.006 : 0.010);
      d = Math.min(d, dB);
      mat = q[1] < bootTop - 0.025 ? 3 : 4;
      if (q[1] < 0.02) mat = 4; // sole
      part = P_LEG;
    }
    const ds = shorts(q, d);
    if (ds < d + 0.001) {
      d = Math.min(d, ds);
      mat = 1;
      if (q[1] > shortsTop - 0.055) mat = 2; // waistband
      else if (q[1] < 0.98) {
        // side stripe on outer thigh
        const ax = q[0] - (LUL[0] + 0.02);
        const ang = Math.atan2(q[2], ax);
        if (Math.abs(ang) < 0.32) mat = 2;
        if (q[1] < shortsHem + 0.022) mat = 2; // hem trim
      }
      part = P_PELVIS;
    }
    return { d, part, mat };
  }
  return { sdf: body, bounds: [[-0.6, -0.005, -0.24], [0.6, 1.64, 0.26]] };
}

// ---------- glove (in a canonical frame) ----------
// +Y : from wrist toward knuckles, +Z : back of hand, +X : thumb side
function makeGlove() {
  const fist = (q) => ellipsoid(q, V(0, 0.072, 0.004), WB, [0.056, 0.074, 0.06]);
  const pad = (q) => ellipsoid(q, V(0, 0.104, 0.012), rotX(WB, 0.25), [0.058, 0.06, 0.064]);
  const thumb = (q) => roundCone(q, V(0.042, 0.035, -0.02), V(0.042, 0.105, -0.036), 0.024, 0.021);
  const cuff = (q) => roundCone(q, V(0, 0.02, 0.0), V(0, -0.105, -0.004), 0.05, 0.044);
  function g(p) {
    let d = smin(fist(p), pad(p), 0.05);
    let dt = thumb(p);
    d = smin(d, dt, 0.016);
    // crease between thumb and fist
    d = smin(d, cuff(p), 0.04);
    let mat = 0; // 0 leather, 1 strap/trim, 2 palm
    if (p[1] < -0.035 && p[1] > -0.078) { d -= 0.003; mat = 1; }
    if (p[1] < -0.098) mat = 1;
    if (mat === 0 && p[2] < -0.035 && p[1] > -0.01 && p[1] < 0.12 && dt > d + 0.004) mat = 2;
    return { d, part: 0, mat };
  }
  return { sdf: g, bounds: [[-0.075, -0.125, -0.08], [0.085, 0.175, 0.085]] };
}

// ---------- surface nets ----------
function surfaceNets(sdfObj, h) {
  const { sdf, bounds } = sdfObj;
  const [lo, hi] = bounds;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  const t0 = Date.now();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    field[idx(i, j, k)] = sdf(V(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h)).d;
  }
  console.log('field', nx, ny, nz, (Date.now() - t0) + 'ms');
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const verts = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(c => field[idx(i + c[0], j + c[1], k + c[2])]);
    let mask = 0; for (let c = 0; c < 8; c++) if (v[c] < 0) mask |= 1 << c;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, bb] of edges) {
      if ((v[a] < 0) === (v[bb] < 0)) continue;
      const t = v[a] / (v[a] - v[bb]);
      sx += corners[a][0] + (corners[bb][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[bb][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[bb][2] - corners[a][2]) * t;
      n++;
    }
    cellVert[cidx(i, j, k)] = verts.length;
    verts.push(V(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h));
  }
  const tris = [];
  const quad = (a, b2, c, d, flip) => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    if (flip) { tris.push([a, c, b2]); tris.push([a, d, c]); } else { tris.push([a, b2, c]); tris.push([a, c, d]); }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = field[idx(i, j, k)];
    // x edge
    if (i < nx - 1) {
      const v1 = field[idx(i + 1, j, k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], v0 >= 0);
    }
    if (j < ny - 1) {
      const v1 = field[idx(i, j + 1, k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], v0 >= 0);
    }
    if (k < nz - 1) {
      const v1 = field[idx(i, j, k + 1)];
      if ((v0 < 0) !== (v1 < 0)) quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], v0 >= 0);
    }
  }
  return { verts, tris };
}

function grad(sdf, p, e = 0.0008) {
  return norm([
    sdf(add(p, V(e, 0, 0))).d - sdf(add(p, V(-e, 0, 0))).d,
    sdf(add(p, V(0, e, 0))).d - sdf(add(p, V(0, -e, 0))).d,
    sdf(add(p, V(0, 0, e))).d - sdf(add(p, V(0, 0, -e))).d,
  ]);
}

function finalize(sdfObj, mesh, opts) {
  const { sdf } = sdfObj;
  const { verts, tris } = mesh;
  const nV = verts.length;
  // adjacency
  const adj = Array.from({ length: nV }, () => new Set());
  for (const t of tris) for (let a = 0; a < 3; a++) { adj[t[a]].add(t[(a + 1) % 3]); adj[t[a]].add(t[(a + 2) % 3]); }
  // light laplacian relax + projection back to surface
  for (let it = 0; it < 2; it++) {
    const np = verts.map((p, i) => {
      let s = V(0, 0, 0); for (const n of adj[i]) s = add(s, verts[n]);
      const avg = mul(s, 1 / Math.max(1, adj[i].size));
      return lerp3(p, avg, 0.5);
    });
    for (let i = 0; i < nV; i++) {
      let p = np[i];
      for (let s = 0; s < 3; s++) { const r = sdf(p); const g = grad(sdf, p); p = sub(p, mul(g, r.d)); }
      verts[i] = p;
    }
  }
  const normals = verts.map(p => grad(sdf, p, 0.0015));
  const info = verts.map(p => sdf(add(p, V(0, 0, 0))));
  // per-vertex material: use the sample slightly inside
  const vmat = verts.map((p, i) => sdf(sub(p, mul(normals[i], 0.002))).mat);
  const vpart = info.map(r => r.part);
  // ambient occlusion from the SDF
  const ao = verts.map((p, i) => {
    const n = normals[i]; let occ = 0, w = 1;
    for (let s = 1; s <= 5; s++) {
      const hh = 0.012 * s; const d = sdf(add(p, mul(n, hh))).d;
      occ += (hh - d) * w; w *= 0.6;
    }
    let cav = 0; const hc = 0.004; cav = (hc - sdf(add(p, mul(n, hc))).d) / hc;
    return clamp(1 - occ * 6.5 - cav * 0.25, 0.25, 1);
  });
  // triangle groups by material (majority vote)
  const groups = {};
  for (const t of tris) {
    const m = [vmat[t[0]], vmat[t[1]], vmat[t[2]]];
    const mm = (m[0] === m[1] || m[0] === m[2]) ? m[0] : m[1];
    (groups[mm] ||= []).push(t);
  }
  return { verts, normals, ao, vpart, groups, adj };
}

function skinWeights(res) {
  const { verts, vpart, adj } = res;
  const J = (n) => JOINTS.indexOf(n);
  const segs = [];
  const S = (bone, a, c, side, allowed) => segs.push({ bone: J(bone), a, c, side, allowed });
  S('Hips', add(b('Hips'), V(0, -0.1, 0)), b('Spine'), 0, [P_TORSO, P_PELVIS, P_LEG]);
  S('Spine', b('Spine'), b('Spine1'), 0, [P_TORSO, P_PELVIS]);
  S('Spine1', b('Spine1'), b('Spine2'), 0, [P_TORSO]);
  S('Spine2', b('Spine2'), add(b('Neck'), V(0, -0.03, 0)), 0, [P_TORSO, P_ARM, P_NECK]);
  S('Neck', b('Neck'), b('Head'), 0, [P_NECK, P_TORSO]);
  S('Head', b('Head'), b('HeadTop_End'), 0, [P_NECK]);
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    S(side + 'Shoulder', b(side + 'Shoulder'), b(side + 'Arm'), s, [P_TORSO, P_ARM]);
    S(side + 'Arm', b(side + 'Arm'), b(side + 'ForeArm'), s, [P_ARM, P_TORSO]);
    S(side + 'ForeArm', b(side + 'ForeArm'), b(side + 'Hand'), s, [P_ARM]);
    S(side + 'Hand', b(side + 'Hand'), b(side + 'HandMiddle1'), s, [P_ARM]);
    S(side + 'UpLeg', b(side + 'UpLeg'), b(side + 'Leg'), s, [P_LEG, P_PELVIS]);
    S(side + 'Leg', b(side + 'Leg'), b(side + 'Foot'), s, [P_LEG]);
    S(side + 'Foot', b(side + 'Foot'), b(side + 'ToeBase'), s, [P_LEG]);
    S(side + 'ToeBase', b(side + 'ToeBase'), b(side + 'Toe_End'), s, [P_LEG]);
  }
  const nS = segs.length;
  const W = verts.map((p, vi) => {
    const w = new Float32Array(nS);
    for (let s = 0; s < nS; s++) {
      const sg = segs[s];
      if (sg.side !== 0 && Math.sign(p[0]) !== sg.side && Math.abs(p[0]) > 0.002) continue;
      const ab = sub(sg.c, sg.a); const t = clamp(dot(sub(p, sg.a), ab) / dot(ab, ab), 0, 1);
      const dd = Math.max(0.012, len(sub(p, add(sg.a, mul(ab, t)))));
      let f = sg.allowed.includes(vpart[vi]) ? 1 : 0.02;
      // arms: torso bones only near the shoulder
      w[s] = f / Math.pow(dd, 5);
    }
    let tot = 0; for (let s = 0; s < nS; s++) tot += w[s];
    for (let s = 0; s < nS; s++) w[s] /= tot;
    return w;
  });
  // smooth weights over the mesh
  for (let it = 0; it < 6; it++) {
    const NW = W.map((w, i) => {
      const o = new Float32Array(nS);
      for (let s = 0; s < nS; s++) o[s] = w[s] * 0.5;
      const k = 0.5 / Math.max(1, adj[i].size);
      for (const n of adj[i]) {
        // don't bleed across the leg gap / left-right
        const wn = W[n];
        for (let s = 0; s < nS; s++) o[s] += wn[s] * k;
      }
      return o;
    });
    for (let i = 0; i < W.length; i++) W[i] = NW[i];
  }
  const idx = new Uint8Array(verts.length * 4), wt = new Uint8Array(verts.length * 4);
  W.forEach((w, i) => {
    const order = [...w.keys()].sort((x, y) => w[y] - w[x]).slice(0, 4);
    let tot = 0; for (const o of order) tot += w[o];
    let acc = 0;
    order.forEach((o, k) => {
      idx[i * 4 + k] = segs[o].bone;
      let q = Math.round(w[o] / tot * 255);
      if (k === 3) q = 255 - acc; acc += q;
      wt[i * 4 + k] = Math.max(0, q);
    });
  });
  return { idx, wt };
}

function writeMesh(name, res, skin, extra = {}) {
  const { verts, normals, ao, groups } = res;
  const nV = verts.length;
  const order = Object.keys(groups).map(Number).sort((a, c) => a - c);
  const ind = []; const gl = [];
  for (const g of order) { gl.push({ start: ind.length, count: groups[g].length * 3, mat: g }); for (const t of groups[g]) ind.push(t[0], t[1], t[2]); }
  const pos = new Float32Array(nV * 3), nor = new Int8Array(nV * 4), col = new Uint8Array(nV);
  verts.forEach((p, i) => { pos.set(p, i * 3); const n = normals[i]; nor[i * 4] = Math.round(n[0] * 127); nor[i * 4 + 1] = Math.round(n[1] * 127); nor[i * 4 + 2] = Math.round(n[2] * 127); col[i] = Math.round(ao[i] * 255); });
  const index = nV > 65535 ? new Uint32Array(ind) : new Uint16Array(ind);
  const parts = [pos, nor, col]; if (skin) parts.push(skin.idx, skin.wt); parts.push(index);
  const meta = { vertexCount: nV, indexCount: ind.length, index32: nV > 65535, groups: gl, skinned: !!skin, layout: [], ...extra };
  let off = 0; const bufs = [];
  for (const [nm, arr] of [['position', pos], ['normal', nor], ['ao', col], ...(skin ? [['skinIndex', skin.idx], ['skinWeight', skin.wt]] : []), ['index', index]]) {
    const pad = (4 - (off % 4)) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; }
    meta.layout.push({ name: nm, offset: off, length: arr.byteLength });
    bufs.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); off += arr.byteLength;
  }
  meta.b64 = Buffer.concat(bufs).toString('base64');
  fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify(meta));
  console.log(name, 'verts', nV, 'tris', ind.length / 3, 'bytes', off);
}

const FIGHTERS = {
  body_a: { muscle: 1.0, torso: 1.0, definition: 1.0, belly: 0.0, shoulders: 1.02, neckBulk: 1.0, legs: 1.0, hem: 0.70 },
  body_b: { muscle: 1.12, torso: 1.07, definition: 0.6, belly: 0.008, shoulders: 1.08, neckBulk: 1.12, legs: 1.08, hem: 0.73 },
};
const which = process.argv[4];
const H = +(process.argv[5] || 0.0065);
for (const [name, cfg] of Object.entries(FIGHTERS)) {
  if (which && which !== name && which !== 'all') continue;
  const sd = makeBody(cfg);
  const mesh = surfaceNets(sd, H);
  const res = finalize(sd, mesh);
  const skin = skinWeights(res);
  writeMesh(name, res, skin, { shortsTop: 1.115, hem: cfg.hem, bootTop: 0.33, legX: BONES.LeftUpLeg[0] });
}
if (!which || which === 'all' || which === 'glove') {
  const g = makeGlove();
  const mesh = surfaceNets(g, 0.0045);
  const res = finalize(g, mesh);
  writeMesh('glove', res, null);
}
