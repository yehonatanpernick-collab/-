// Shared world definition: used by the generation worker and the main thread.
// ---------------------------------------------------------------- math & noise
export const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function makeSimplex(seed) {
  const rnd = mulberry32(seed), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { const g = perm[ii + perm[jj]] & 7; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}
export function fbm(n, x, y, o) { let s = 0, a = 0.5, f = 1, norm = 0; for (let k = 0; k < o; k++) { s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.02; } return s / norm; }
export function ridged(n, x, y, o, gain) { let s = 0, a = 0.5, f = 1, w = 1, norm = 0; for (let k = 0; k < o; k++) { let v = 1 - Math.abs(n(x * f, y * f)); v *= v; s += v * a * w; norm += a; w = Math.min(1, v * 1.6); a *= gain; f *= 2.0; } return s / norm; }
export const [nW1, nW2, nV, nA, nA2, nC, nD, nP, nF, nG, nH, nT, nM, nAs, nR] = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map(makeSimplex);

// ---------------------------------------------------------------- world constants
export const SIZE = 6000, HALF = 3000, N = 1025, CELL = SIZE / (N - 1), BASE = 2400, CH = 64, NCH = (N - 1) / CH;

export const valleyZ = x => 260 * Math.sin(x / 1300 + 0.4) + 90 * Math.sin(x / 470 + 2.0);
export const PEAKS = [
  { x: 1500, z: 2350, r: 560, a: 1050, he: 'פסגת לונגס', en: 'Longs Peak' },
  { x: -1350, z: 2000, r: 430, a: 430, he: 'פסגת האלט', en: 'Hallett Peak' },
  { x: -2150, z: 1850, r: 480, a: 520, he: 'הר טיילור', en: 'Taylor Peak' },
  { x: -1600, z: -2200, r: 450, a: 460, he: 'הר אידה', en: 'Mount Ida' },
  { x: -500, z: -2500, r: 420, a: 480, he: 'הר איפסילון', en: 'Ypsilon Mountain' },
  { x: 2300, z: 2500, r: 500, a: 380, he: 'הר מיקר', en: 'Mount Meeker' },
  { x: -2650, z: 300, r: 600, a: 400, he: 'קו פרשת המים היבשתי', en: 'Continental Divide' },
];

export function baseE(x, z) {
  const vz = valleyZ(x), dv = Math.abs(z - vz);
  const wx = x + 220 * nW1(x * 0.0005, z * 0.0005), wz = z + 220 * nW2(x * 0.0005 + 3.1, z * 0.0005 - 1.7);
  const vw = 430 + 150 * nV(x * 0.0007, 7.3);
  const west = ss(-1500, -2750, x);
  const m = Math.max(ss(vw * 0.55, vw + 1250, dv), west);
  const hills = fbm(nA, wx * 0.0011, wz * 0.0011, 4) * 55 + nA2(x * 0.005, z * 0.005) * 5;
  let e = 2440 - 0.026 * x + 520 * west + hills * (0.4 + 0.6 * m);
  let r = 0;
  if (m > 0.002) {
    r = ridged(nC, wx * 0.00018, wz * 0.00018, 6, 0.33);
    const d = fbm(nD, wx * 0.0004 + 11, wz * 0.0004 - 7, 4);
    e += m * (480 + r * 900 + d * 90);
  }
  e += 26 * Math.exp(-(((dv - vw * 0.95) / 90) ** 2)) * (1 - west);
  for (let i = 0; i < PEAKS.length; i++) {
    const p = PEAKS[i], dx = x - p.x, dz = z - p.z, d2 = (dx * dx + dz * dz) / (p.r * p.r);
    if (d2 < 9) e += p.a * 0.9 * Math.exp(-d2) * (0.55 + 0.6 * r);
  }
  const pw = Math.exp(-(((x - 800) / 1100) ** 2 + ((z + 2150) / 430) ** 2));
  if (pw > 0.01) { const k = pw * 0.85; e = e * (1 - k) + (3650 + hills * 1.4 + fbm(nP, x * 0.002, z * 0.002, 3) * 70) * k; }
  if (e > 4250) e = 4250 + (e - 4250) * 0.45;
  return e;
}


export const TR = 2048, TCELL = SIZE / TR;
export const LAKES = [
  { id: 'bear', he: 'אגם בר', en: 'Bear Lake', x: -300, z: 950, r: 95, sx: 1.2, sy: 0.9, a: 0.4, dep: 14, sh: '#3d9a92', dp: '#0d3a5a' },
  { id: 'nymph', he: 'אגם נימף', en: 'Nymph Lake', x: -540, z: 1040, r: 55, sx: 1, sy: 1, a: 0, dep: 4, sh: '#71945a', dp: '#24462f' },
  { id: 'dream', he: 'אגם דרים', en: 'Dream Lake', x: -760, z: 1130, r: 72, sx: 2.1, sy: 0.75, a: -0.45, dep: 10, sh: '#4aa58c', dp: '#0f4a43' },
  { id: 'emerald', he: 'אגם אמרלד', en: 'Emerald Lake', x: -1000, z: 1250, r: 95, sx: 1.25, sy: 1, a: 0.2, dep: 16, sh: '#3fcab0', dp: '#0a5d57' },
  { id: 'haiyaha', he: 'אגם הייאהה', en: 'Lake Haiyaha', x: -380, z: 1500, r: 85, sx: 1.3, sy: 0.9, a: 1.0, dep: 12, sh: '#8cdcd2', dp: '#2a97a2' },
  { id: 'loch', he: 'דה לוק', en: 'The Loch', x: -1500, z: 900, r: 115, sx: 1.4, sy: 0.85, a: 0.6, dep: 15, sh: '#5a98a8', dp: '#163d55' },
  { id: 'sky', he: 'סקיי פונד', en: 'Sky Pond', x: -1900, z: 1200, r: 105, sx: 1.4, sy: 0.9, a: 0.7, dep: 20, sh: '#4fa6d0', dp: '#08295a' },
  { id: 'chasm', he: 'אגם צ׳אזם', en: 'Chasm Lake', x: 1250, z: 1750, r: 90, sx: 1.2, sy: 1, a: 0, dep: 18, sh: '#7aa6b4', dp: '#1b3a52' },
  { id: 'sprague', he: 'אגם ספרייג', en: 'Sprague Lake', x: 450, z: 700, r: 110, sx: 1.3, sy: 0.8, a: -0.3, dep: 3, sh: '#8f9560', dp: '#2f4d3c' },
  { id: 'lawn', he: 'אגם לון', en: 'Lawn Lake', x: 900, z: -1500, r: 120, sx: 1.2, sy: 1, a: 0.3, dep: 15, sh: '#3e86aa', dp: '#0f3658' },
];
export const LK = Object.fromEntries(LAKES.map((l, i) => [l.id, i]));
export const lakeR = (L, ang) => {
  const c = Math.cos(ang - L.a) / L.sx, s = Math.sin(ang - L.a) / L.sy;
  return L.r / Math.sqrt(c * c + s * s) * (1 + 0.14 * Math.sin(3 * ang + L.x) + 0.08 * Math.sin(5 * ang + L.z));
};
export const riverPts = []; for (let x = -2300; x <= 3000; x += 220) riverPts.push([x, valleyZ(x) + 30 * Math.sin(x / 310)]);
export const CHANNELS = [
  { id: 'river', he: 'נהר ביג תומפסון', en: 'Big Thompson River', w: 7.5, dep: 1.6, trough: 0, mea: 40, pts: riverPts, sh: '#6f9f88', dp: '#2a5a58' },
  { id: 'tyndall', he: 'נחל טינדל', en: 'Tyndall Creek', w: 2.6, dep: 0.7, trough: 170, mea: 10, toRiver: true, pts: [[-1000, 1250], [-760, 1130], [-620, 960], [-520, 720], [-380, 430], [-260, 0]] },
  { id: 'bearc', he: 'נחל גלסייר', en: 'Glacier Creek', w: 2.2, dep: 0.6, trough: 60, mea: 8, toRiver: true, pts: [[-300, 950], [-160, 720], [-20, 470], [90, 0]] },
  { id: 'icy', he: 'נחל אייסי ברוק', en: 'Icy Brook', w: 3.0, dep: 0.8, trough: 200, mea: 10, toRiver: true, pts: [[-1900, 1200], [-1700, 1050], [-1500, 900], [-1300, 650], [-1120, 350], [-980, 0]] },
  { id: 'chasm', he: 'פלג צ׳אזם', en: 'Roaring Fork', w: 2.4, dep: 0.6, trough: 120, mea: 10, toRiver: true, pts: [[1250, 1750], [1320, 1350], [1220, 950], [1080, 560], [1000, 0]] },
  { id: 'haiyaha', he: 'פלג הייאהה', en: 'Chaos Creek', w: 1.6, dep: 0.5, trough: 0, mea: 6, pts: [[-380, 1500], [-260, 1250], [-190, 980], [-160, 722]] },
  { id: 'roaring', he: 'נהר רוארינג', en: 'Roaring River', w: 3.0, dep: 0.7, trough: 90, mea: 14, toRiver: true, pts: [[900, -1500], [820, -1100], [720, -700], [620, -300], [580, 0]] },
  { id: 'sprague', he: 'פלג ספרייג', en: 'Sprague Creek', w: 1.4, dep: 0.4, trough: 0, mea: 5, toRiver: true, pts: [[450, 700], [440, 480], [470, 0]] },
];
export const valleyTrail = []; for (let x = -1500; x <= 2500; x += 200) valleyTrail.push([x, valleyZ(x) - 95]);
export const TRAILS = [
  { he: 'שביל אגם אמרלד', en: 'Emerald Lake Trail', pts: [[-60, 880], [-230, 900], [-400, 1000], [-540, 1040], [-640, 1090], [-760, 1130], [-880, 1190], [-1000, 1250]], dests: ['nymph', 'dream', 'emerald'] },
  { he: 'שביל אגם הייאהה', en: 'Lake Haiyaha Trail', pts: [[-640, 1090], [-560, 1250], [-450, 1380], [-380, 1500]], dests: ['haiyaha'] },
  { he: 'שביל סקיי פונד', en: 'Sky Pond Trail', pts: [[-60, 880], [-200, 800], [-700, 750], [-1100, 760], [-1350, 850], [-1500, 900], [-1700, 1050], [-1900, 1200]], dests: ['loch', 'sky'] },
  { he: 'שביל עמק מוריין', en: 'Moraine Park Trail', pts: valleyTrail, dests: [] },
  { he: 'שביל פסגת לונגס', en: 'Longs Peak Trail', pts: [[1650, 500], [1500, 900], [1350, 1300], [1250, 1750], [1400, 2050], [1500, 2350]], dests: ['chasm'] },
  { he: 'שביל קהילות הטונדרה', en: 'Tundra Communities Trail', pts: [[300, -2050], [700, -2120], [1000, -2180], [1300, -2150]], dests: [] },
  { he: 'שביל אגם לון', en: 'Lawn Lake Trail', pts: [[620, 120], [750, -600], [850, -1100], [900, -1500]], dests: ['lawn'] },
];

export function crPt(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
export function spline(ctrl, spacing) {
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(i - 1, 0)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(i + 2, ctrl.length - 1)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spacing));
    for (let s = 0; s < n; s++) out.push(crPt(p0, p1, p2, p3, s / n));
  }
  out.push(ctrl[ctrl.length - 1].slice());
  return out;
}
export function meander(pts, amp, seed) {
  if (!amp) return pts;
  const n = pts.length; let s = 0;
  return pts.map((p, i) => {
    if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const fade = Math.min(1, i / 6, (n - 1 - i) / 6);
    const o = amp * (nM(s * 0.0045 + seed, seed * 1.7) + 0.4 * nM(s * 0.013, seed)) * fade;
    return [p[0] - tz * o, p[1] + tx * o];
  });
}

