// Wildlife: sculpted animals with jointed procedural gaits, herd behaviour, birds, butterflies and jumping trout.
import * as THREE from 'three';
import { clamp, lerp, ss, mulberry32, HALF, BASE, LAKES, valleyZ, lakeR } from './shared.js';
import { scene, camera, U, G, hex, heightAt, cellOf, waterAt } from './core.js';
import { patchLit, ATMOS_PARS, atmosUniforms, sky_state } from './atmos.js';

const V3 = THREE.Vector3;
export const SPECIES_INFO = {
  elk: { he: 'וָאפִּיטִי (איל אמריקאי)', en: 'Elk', note: 'עדרים גדולים רועים באחו בשעות הבוקר והערב. בקיץ הקרניים של הזכרים מכוסות "קטיפה".' },
  moose: { he: 'אייל קורא', en: 'Moose', note: 'היונק הגדול בפארק. אוהב ערבות ליד נהרות ואגמים, ואוכל צמחי מים.' },
  deer: { he: 'צבי הפרד', en: 'Mule deer', note: 'אוזניים גדולות כמו של פרד וזנב לבן עם קצה שחור.' },
  sheep: { he: 'כבש גדול-קרניים', en: 'Bighorn sheep', note: 'סמל הפארק. מטפס על מצוקים תלולים מעל קו העצים.' },
  marmot: { he: 'מרמיטה צהובת-בטן', en: 'Yellow-bellied marmot', note: 'שורקת בקול כשמתקרבים, ונהנית מהשמש על סלעים בטונדרה.' },
  pika: { he: 'פיקה אמריקאית', en: 'American pika', note: 'קרוב משפחה קטן של הארנב. אוסף עשב לחורף בין סלעי הטאלוס.' },
  fox: { he: 'שועל אדום', en: 'Red fox', note: 'צד מכרסמים באחו. זנב עבות עם קצה לבן.' },
  chipmunk: { he: 'צ׳יפמאנק', en: 'Least chipmunk', note: 'קטן ומהיר, עם פסים לאורך הגב.' },
  bluebird: { he: 'כחלי הרים', en: 'Mountain bluebird', note: 'ציפור בכחול עז שצדה חרקים באחו הפתוח.' },
  jay: { he: 'עורבני סטלר', en: "Steller's jay", note: 'כחול-כהה עם ציצית שחורה, רועש וסקרן ביער המחטניים.' },
  hawk: { he: 'עקב אדום-זנב', en: 'Red-tailed hawk', note: 'דואה במעגלים מעל העמקים ומחפש מכרסמים.' },
  trout: { he: 'פורל חתוך-גרון', en: 'Greenback cutthroat trout', note: 'דג המדינה של קולורדו. קופץ לתפוס חרקים מעל פני האגם.' },
};
let onSpot = () => {};
export const setSpotHandler = (fn) => { onSpot = fn; };
let onSound = () => {};
export const setAnimalSound = (fn) => { onSound = fn; };

const animalMat = patchLit(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'animal', ao: 0.4 });

// ---------------------------------------------------------------- mesh building
class B {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(g, col, m, shade) {
    if (m) g.applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position, Nn = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), c = typeof col === 'function' ? col(x, y, z) : col;
      const k = shade ? shade(x, y, z) : 1;
      this.p.push(x, y, z); this.n.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i)); this.c.push(c.r * k, c.g * k, c.b * k);
    }
    return this;
  }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); return g; }
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(1, 1, 1));
// deformable ellipsoid: f maps unit-sphere coords to an offset shape
function blob(rx, ry, rz, f, seg = 16) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, seg * 0.75 | 0)), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { let x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (f) [x, y, z] = f(x, y, z); P.setXYZ(i, x * rx, y * ry, z * rz); }
  g.computeVertexNormals(); return g;
}
function seg(a, b, r1, r2, n = 7) {
  const A = new V3(...a), Bv = new V3(...b), d = Bv.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, n, 2); g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize())); g.translate(A.x, A.y, A.z); return g;
}
const furShade = (top, belly) => (x, y) => lerp(belly, top, ss(-0.3, 0.3, y));

// per-species body plans: returns parts {body, head, ears, tail, legs:[{hip, upper, lower}]}
function plan(type, o = {}) {
  const P = { body: new B(), head: new B(), ear: new B(), tail: new B(), legs: [], neck: [0, 0, 0], earPos: [], tailPos: [0, 0, 0], h: 1 };
  const leg = (hip, up, low, rU, rL, col, hock) => P.legs.push({ hip, up, low, rU, rL, col, hock });
  if (type === 'elk' || type === 'deer' || type === 'moose') {
    const s = type === 'deer' ? 0.62 : type === 'moose' ? 1.12 : 1;
    const C = type === 'deer' ? { body: hex('#8f7b62'), dark: hex('#5f4c3a'), rump: hex('#eae2d0'), leg: hex('#6a5644') }
      : type === 'moose' ? { body: hex('#2c221b'), dark: hex('#1e1712'), rump: hex('#3a2c22'), leg: hex('#9a8a74') }
      : { body: hex('#a58257'), dark: hex('#4a3322'), rump: hex('#dcc69a'), leg: hex('#3e2c1e') };
    const hump = type === 'moose' ? 0.35 : 0.12;
    P.body.add(blob(0.42 * s, 0.5 * s, 1.1 * s, (x, y, z) => [x * (1 - 0.12 * Math.max(0, -z)), y + (y > 0 ? hump * ss(0.0, 0.8, z) : (z > 0.4 ? -0.1 : 0.12 * (1 - Math.abs(z)))), z]),
      (x, y, z) => z < -0.75 * s && y > 1.2 * s ? C.rump : C.body, M(0, 1.42 * s, 0), furShade(1.05, 0.72));
    P.body.add(blob(0.38 * s, 0.46 * s, 0.4 * s), C.dark, M(0, 1.42 * s, 0.7 * s), furShade(1, 0.8));
    P.body.add(blob(0.36 * s, 0.36 * s, 0.26 * s), C.rump, M(0, 1.46 * s, -0.92 * s));
    P.neck = [0, 1.6 * s, 0.95 * s]; P.tailPos = [0, 1.62 * s, -1.12 * s];
    P.tail.add(blob(0.06 * s, 0.11 * s, 0.05 * s), type === 'deer' ? hex('#efe9da') : C.rump, M(0, -0.08 * s, 0));
    if (type === 'deer') P.tail.add(blob(0.04 * s, 0.05 * s, 0.04 * s), hex('#141010'), M(0, -0.2 * s, 0));
    const nk = type === 'moose' ? 0.45 : 0.6;
    P.head.add(seg([0, 0, 0], [0, nk * s, 0.42 * s], 0.26 * s, 0.16 * s, 9), C.dark);
    if (type === 'elk') P.head.add(blob(0.2 * s, 0.3 * s, 0.32 * s), C.dark, M(0, 0.12 * s, 0.18 * s, -0.7));
    if (type === 'moose') P.head.add(blob(0.05, 0.22, 0.08), C.dark, M(0, -0.05, 0.55));
    const hl = type === 'moose' ? 0.56 : 0.36, hp = [0, nk * s + 0.05 * s, 0.55 * s];
    P.head.add(blob(0.15 * s, 0.17 * s, hl * s, (x, y, z) => [x * (1 - 0.35 * ss(0, 1, z)), y * (1 - 0.25 * ss(0, 1, z)) - (type === 'moose' ? 0.2 * ss(0.3, 1, z) : 0), z]), type === 'moose' ? hex('#3b2d22') : hex(type === 'deer' ? '#7a6652' : '#6e4f35'), M(...hp, 0.55));
    P.head.add(blob(0.08 * s, 0.08 * s, 0.09 * s), hex('#1e1612'), M(hp[0], hp[1] - hl * s * 0.48, hp[2] + hl * s * 0.78));
    for (const sd of [-1, 1]) P.head.add(blob(0.022 * s, 0.022 * s, 0.022 * s, null, 8), hex('#0a0806'), M(sd * 0.12 * s, hp[1] + 0.06 * s, hp[2] + 0.02 * s));
    P.earPos = [[0.12 * s, hp[1] + 0.12 * s, hp[2] - 0.12 * s], [-0.12 * s, hp[1] + 0.12 * s, hp[2] - 0.12 * s]];
    const ek = type === 'deer' ? 1.9 : 1;
    P.ear.add(blob(0.04 * s * ek, 0.12 * s * ek, 0.025 * s, (x, y, z) => [x, y + 1, z]), C.dark);
    if (o.bull) {
      const vel = hex(type === 'moose' ? '#7a644a' : '#6b5038');
      if (type === 'moose') for (const sd of [-1, 1]) {
        P.head.add(seg([sd * 0.1, hp[1] + 0.1, hp[2] - 0.15], [sd * 0.35, hp[1] + 0.2, hp[2] - 0.1], 0.05, 0.05), vel);
        P.head.add(blob(0.42, 0.05, 0.28, (x, y, z) => [x, y + 0.3 * x * x, z]), vel, M(sd * 0.68, hp[1] + 0.32, hp[2] - 0.05, 0, sd * 0.3, sd * 0.4));
      } else {
        const sc = s * (type === 'deer' ? 0.7 : 1);
        for (const sd of [-1, 1]) {
          const pts = [[0.08, 0.1, -0.12], [0.24, 0.42, -0.24], [0.36, 0.72, -0.48], [0.4, 0.98, -0.78], [0.32, 1.2, -1.0]].map(v => [v[0] * sd * sc + hp[0], v[1] * sc + hp[1], v[2] * sc + hp[2]]);
          for (let i = 0; i < pts.length - 1; i++) {
            P.head.add(seg(pts[i], pts[i + 1], 0.05 * sc, 0.04 * sc, 6), vel);
            if (i < 3) P.head.add(seg(pts[i + 1], [pts[i + 1][0] + 0.03 * sd * sc, pts[i + 1][1] + 0.18 * sc, pts[i + 1][2] + 0.26 * sc], 0.035 * sc, 0.02 * sc, 5), vel);
          }
          P.head.add(blob(0.05 * sc, 0.05 * sc, 0.05 * sc), vel, M(...pts[4]));
        }
      }
    }
    const lh = type === 'moose' ? 1.25 : 1;
    leg([0.2 * s, 1.15 * s, 0.7 * s], 0.5 * s * lh, 0.62 * s * lh, 0.09 * s, 0.05 * s, C.leg, false); leg([-0.2 * s, 1.15 * s, 0.7 * s], 0.5 * s * lh, 0.62 * s * lh, 0.09 * s, 0.05 * s, C.leg, false);
    leg([0.22 * s, 1.22 * s, -0.72 * s], 0.55 * s * lh, 0.62 * s * lh, 0.12 * s, 0.05 * s, C.leg, true); leg([-0.22 * s, 1.22 * s, -0.72 * s], 0.55 * s * lh, 0.62 * s * lh, 0.12 * s, 0.05 * s, C.leg, true);
    if (type === 'moose') P.legs.forEach(l => { l.hip[1] = 1.55; });
    P.h = s;
  } else if (type === 'sheep') {
    const c = hex('#7d6248');
    P.body.add(blob(0.3, 0.34, 0.64, (x, y, z) => [x, y + (y > 0 ? 0.08 * ss(0, 1, z) : 0), z]), (x, y, z) => z < -0.45 ? hex('#ebe3cf') : c, M(0, 0.92, 0), furShade(1.05, 0.75));
    P.body.add(blob(0.27, 0.33, 0.3), hex('#6c533c'), M(0, 0.96, 0.42));
    P.neck = [0, 1.05, 0.58]; P.tailPos = [0, 1.0, -0.66];
    P.tail.add(blob(0.04, 0.07, 0.03), hex('#3a2c20'), M(0, -0.05, 0));
    P.head.add(seg([0, 0, 0], [0, 0.22, 0.18], 0.16, 0.11, 8), c);
    P.head.add(blob(0.11, 0.12, 0.22, (x, y, z) => [x * (1 - 0.3 * ss(0, 1, z)), y, z]), hex('#86684c'), M(0, 0.26, 0.32, 0.35));
    P.head.add(blob(0.075, 0.07, 0.08), hex('#ece4d2'), M(0, 0.2, 0.5));
    for (const sd of [-1, 1]) P.head.add(new THREE.TorusGeometry(0.12, 0.05, 7, 16, Math.PI * 1.6).rotateY(Math.PI / 2).rotateX(-0.6), hex('#b8a27c'), M(0.13 * sd, 0.33, 0.22));
    P.earPos = [[0.1, 0.36, 0.24], [-0.1, 0.36, 0.24]]; P.ear.add(blob(0.025, 0.06, 0.02, (x, y, z) => [x, y + 1, z]), c);
    for (const [x, z, hk] of [[0.15, 0.42, false], [-0.15, 0.42, false], [0.15, -0.42, true], [-0.15, -0.42, true]]) leg([x, 0.76, z], 0.34, 0.4, 0.07, 0.035, hex('#5e4a37'), hk);
    P.h = 0.6;
  } else if (type === 'fox') {
    const c = hex('#c4622a');
    P.body.add(blob(0.12, 0.13, 0.32), (x, y) => y < 0.3 ? hex('#efe2cc') : c, M(0, 0.36, 0), furShade(1.05, 0.9));
    P.neck = [0, 0.42, 0.28]; P.tailPos = [0, 0.4, -0.3];
    P.tail.add(blob(0.07, 0.07, 0.24, (x, y, z) => [x, y, z - 1]), (x, y, z) => z < -0.4 ? hex('#f4efe6') : c, M(0, 0, 0, -0.5));
    P.head.add(blob(0.09, 0.08, 0.1), c, M(0, 0.06, 0.08));
    P.head.add(blob(0.04, 0.035, 0.09, (x, y, z) => [x * (1 - 0.5 * ss(0, 1, z)), y, z]), hex('#e9dccb'), M(0, 0.03, 0.18));
    P.head.add(blob(0.012, 0.012, 0.012, null, 6), hex('#0a0806'), M(0, 0.045, 0.27));
    P.earPos = [[0.05, 0.13, 0.06], [-0.05, 0.13, 0.06]]; P.ear.add(new THREE.ConeGeometry(0.03, 0.08, 6).translate(0, 0.04, 0), hex('#2a1a12'));
    for (const [x, z, hk] of [[0.06, 0.2, false], [-0.06, 0.2, false], [0.06, -0.2, true], [-0.06, -0.2, true]]) leg([x, 0.3, z], 0.15, 0.17, 0.035, 0.018, hex('#1e1410'), hk);
    P.h = 0.25;
  } else if (type === 'marmot' || type === 'pika' || type === 'chipmunk') {
    const k = type === 'marmot' ? 1 : type === 'pika' ? 0.45 : 0.4;
    const c = type === 'marmot' ? hex('#7c5a35') : type === 'pika' ? hex('#8a7a68') : hex('#a07040');
    const stripes = type === 'chipmunk' ? (x, y, z) => (Math.abs(x) < 0.03 * k * 3 && y > 0.18 * k ? hex('#2a1e14') : Math.abs(Math.abs(x) - 0.06) < 0.015 && y > 0.16 * k ? hex('#efe2c4') : c) : (x, y) => y < 0.12 * k ? hex(type === 'marmot' ? '#c9a24e' : '#cfc4b0') : c;
    P.body.add(blob(0.17 * k, 0.15 * k, 0.3 * k, (x, y, z) => [x, y, z * (type === 'pika' ? 0.7 : 1)]), stripes, M(0, 0.17 * k, 0), furShade(1.05, 0.85));
    for (const sd of [-1, 1]) for (const zz of [-0.15, 0.15]) P.body.add(blob(0.04 * k, 0.06 * k, 0.06 * k), hex('#3d2c1c'), M(0.12 * sd * k, 0.05 * k, zz * k));
    P.neck = [0, 0.22 * k, 0.26 * k * (type === 'pika' ? 0.7 : 1)]; P.tailPos = [0, 0.2 * k, -0.3 * k];
    if (type !== 'pika') P.tail.add(blob(0.05 * k, 0.05 * k, 0.16 * k, (x, y, z) => [x, y, z - 1]), c, M(0, 0, 0, type === 'chipmunk' ? -1.1 : -0.3));
    P.head.add(blob(0.1 * k, 0.09 * k, 0.11 * k), c, M(0, 0.03 * k, 0.05 * k));
    P.head.add(blob(0.05 * k, 0.045 * k, 0.05 * k), hex('#d9cfb8'), M(0, 0.0, 0.14 * k));
    for (const sd of [-1, 1]) P.head.add(blob(0.015 * k, 0.015 * k, 0.015 * k, null, 6), hex('#0a0806'), M(sd * 0.06 * k, 0.06 * k, 0.12 * k));
    P.earPos = [[0.06 * k, 0.1 * k, 0.03 * k], [-0.06 * k, 0.1 * k, 0.03 * k]]; P.ear.add(blob(0.03 * k * (type === 'pika' ? 1.6 : 1), 0.03 * k * (type === 'pika' ? 1.6 : 1), 0.01 * k), c);
    P.h = 0.2 * k;
  }
  return P;
}
function buildModel(type, o) {
  const P = plan(type, o);
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bm = new THREE.Mesh(P.body.geo(), animalMat); bm.castShadow = true; body.add(bm);
  const head = new THREE.Group(); head.position.set(...P.neck); const hm = new THREE.Mesh(P.head.geo(), animalMat); hm.castShadow = true; head.add(hm); body.add(head);
  const eg = P.ear.p.length ? P.ear.geo() : null, ears = [];
  if (eg) for (const [i, ep] of P.earPos.entries()) { const e = new THREE.Group(); e.position.set(ep[0] - P.neck[0], ep[1] - 0, ep[2] - 0); const m = new THREE.Mesh(eg, animalMat); m.rotation.z = (i ? 1 : -1) * 0.6; e.add(m); head.add(e); ears.push(e); }
  const tail = new THREE.Group(); tail.position.set(...P.tailPos); if (P.tail.p.length) tail.add(new THREE.Mesh(P.tail.geo(), animalMat)); body.add(tail);
  const legs = P.legs.map(L => {
    const hip = new THREE.Group(); hip.position.set(...L.hip);
    const ub = new B().add(new THREE.CylinderGeometry(L.rU * 0.7, L.rU, L.up, 7).translate(0, -L.up / 2, 0), L.col); hip.add(new THREE.Mesh(ub.geo(), animalMat));
    const knee = new THREE.Group(); knee.position.y = -L.up; hip.add(knee);
    const lb = new B().add(new THREE.CylinderGeometry(L.rL, L.rL * 0.8, L.low, 6).translate(0, -L.low / 2, 0), L.col).add(blob(L.rL * 1.1, L.rL * 0.8, L.rL * 1.4, null, 8), hex('#16100c'), M(0, -L.low, 0.01));
    const lm = new THREE.Mesh(lb.geo(), animalMat); lm.castShadow = true; knee.add(lm);
    body.add(hip); return { hip, knee, hock: L.hock, len: L.up + L.low };
  });
  return { group: g, body, head, ears, tail, legs, h: P.h };
}

// ---------------------------------------------------------------- behaviour
export const animals = [];
const SUIT = {
  elk: (e, s, wd) => s < 0.3 && wd > 3 && e < 3800, moose: (e, s, wd) => s < 0.2 && wd > -0.5 && wd < 70 && e < 3200,
  deer: (e, s, wd) => s < 0.38 && wd > 2 && e < 3400, sheep: (e, s, wd) => s > 0.22 && s < 0.62 && e > 3050 && wd > 2,
  marmot: (e, s, wd) => e > 3250 && s < 0.45 && wd > 2, pika: (e, s, wd) => e > 3150 && s > 0.2 && s < 0.6 && wd > 2,
  fox: (e, s, wd) => s < 0.3 && wd > 3 && e < 3300, chipmunk: (e, s, wd) => s < 0.4 && wd > 2 && e < 3500,
};
const suits = (type, x, z) => { if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) return false; const k = cellOf(x, z); return SUIT[type](G.H[k] + BASE, 1 - G.NRM[k * 3 + 1], Math.min(G.CHD[k], G.LKD[k])); };
const SPEED = { elk: [1.3, 3.2, 10], moose: [1.0, 2.6, 6], deer: [1.2, 3, 11], sheep: [0.8, 2, 7], marmot: [0.7, 1.5, 4], pika: [0.6, 1.4, 4], fox: [1.4, 3.5, 9], chipmunk: [1.0, 2, 5] };
const FLEE = { elk: 26, moose: 16, deer: 28, sheep: 18, marmot: 10, pika: 7, fox: 30, chipmunk: 6 };
function spawnHerd(type, cx, cz, rad, count, rnd) {
  const herd = { leader: null, members: [] };
  for (let i = 0; i < count; i++) {
    let x = cx, z = cz, ok = false;
    for (let t = 0; t < 90 && !ok; t++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * rad; x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; ok = suits(type, x, z); }
    if (!ok) continue;
    const bull = (type === 'elk' || type === 'deer' || type === 'moose') && (i === 0 && type !== 'elk' || i % 5 === 1);
    const m = buildModel(type, { bull });
    if (type === 'elk' && !bull) m.group.scale.setScalar(0.88 + rnd() * 0.08);
    const a = { type, ...m, x, z, yaw: rnd() * 6.283, home: [cx, cz, rad], herd, state: 'graze', timer: rnd() * 8, tx: x, tz: z, phase: rnd() * 6, speed: 0, gait: 0, headA: 0.8, headY: 0, lie: 0, earT: rnd() * 4, off: [(rnd() - 0.5) * 30, (rnd() - 0.5) * 30], len: m.h * 1.4 + 0.2 };
    herd.members.push(a); if (!herd.leader) herd.leader = a;
    scene.add(a.group); animals.push(a);
  }
}
function pickTarget(a, far) {
  for (let t = 0; t < 10; t++) {
    const ang = Math.random() * 6.283, d = Math.random() * (a.h < 0.2 ? 20 : far || 90);
    let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
    if (Math.hypot(x - a.home[0], z - a.home[1]) > a.home[2]) { x = lerp(x, a.home[0], 0.35); z = lerp(z, a.home[1], 0.35); }
    if (suits(a.type, x, z)) { a.tx = x; a.tz = z; return true; }
  }
  return false;
}
function nearWater(a) {
  for (let t = 0; t < 12; t++) { const ang = t / 12 * 6.283, x = a.x + Math.cos(ang) * 40, z = a.z + Math.sin(ang) * 40, k = cellOf(x, z); const wd = Math.min(G.CHD[k], G.LKD[k]); if (wd > 0 && wd < 4) { a.tx = x; a.tz = z; return true; } }
  return false;
}

// small birds and the soaring hawks / ravens
const birds = [], hawks = [];
function birdModel(kind) {
  const C = kind === 'bluebird' ? [hex('#3d7fd8'), hex('#7fb2f0'), hex('#c9b8a0')] : kind === 'jay' ? [hex('#1f3f78'), hex('#1a1a22'), hex('#2a4a88')] : kind === 'raven' ? [hex('#121216'), hex('#0c0c10'), hex('#1a1a20')] : [hex('#6b4a30'), hex('#5a3d27'), hex('#b3532c')];
  const s = kind === 'hawk' || kind === 'raven' ? 1.4 : 0.32;
  const b = new B().add(blob(0.08 * s, 0.07 * s, 0.22 * s), C[0]).add(blob(0.065 * s, 0.065 * s, 0.07 * s), C[1], M(0, 0.04 * s, 0.2 * s))
    .add(new THREE.ConeGeometry(0.018 * s, 0.07 * s, 5).rotateX(Math.PI / 2), hex('#2a2420'), M(0, 0.035 * s, 0.29 * s))
    .add(blob(0.09 * s, 0.012 * s, 0.13 * s), C[2], M(0, 0, -0.27 * s));
  if (kind === 'jay') b.add(new THREE.ConeGeometry(0.03 * s, 0.1 * s, 5), C[1], M(0, 0.12 * s, 0.17 * s, -0.5));
  const g = new THREE.Group(); g.add(new THREE.Mesh(b.geo(), animalMat));
  const wg = new B().add(blob(0.3 * s, 0.01 * s, 0.11 * s, (x, y, z) => [x + 1, y, z]), C[0]).geo(), wings = [];
  for (const sd of [-1, 1]) { const p = new THREE.Group(); p.position.set(0.05 * s * sd, 0.03 * s, 0.02 * s); const m = new THREE.Mesh(wg, animalMat); m.scale.x = sd; p.add(m); g.add(p); wings.push(p); }
  return { group: g, wings };
}

// butterflies: instanced wing pairs with flapping in the vertex shader
let butterflies;
const BF = 70, bfState = [];
function buildButterflies() {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [-0.05, 0, -0.035, 0, 0, -0.035, -0.05, 0, 0.035, 0, 0, 0.035, 0.05, 0, -0.035, 0, 0, -0.035, 0.05, 0, 0.035, 0, 0, 0.035];
  const side = [-1, 0, -1, 0, 1, 0, 1, 0], uv = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7]);
  const ip = new Float32Array(BF * 4), ic = new Float32Array(BF * 3), r = mulberry32(31);
  const cols = [[0.3, 0.55, 1.0], [1.0, 0.55, 0.12], [1, 1, 0.92], [1.0, 0.85, 0.2]];
  for (let i = 0; i < BF; i++) { const c = cols[(r() * 4) | 0]; ic.set(c, i * 3); bfState.push({ x: 0, y: -999, z: 0, h: r() * 100, vx: 0, vz: 0, ph: r() * 6 }); }
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(ip, 4)); g.setAttribute('aCol', new THREE.InstancedBufferAttribute(ic, 3)); g.instanceCount = BF;
  butterflies = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { ...atmosUniforms() },
    vertexShader: `uniform float uTime; attribute float aSide; attribute vec4 aPos; attribute vec3 aCol; varying vec3 vC; varying vec2 vUv; varying vec3 vW;
      void main(){ float fl = sin(uTime*18.0 + aPos.w*7.0)*1.1; vec3 p = position; float ca = cos(aPos.w), sa = sin(aPos.w);
        p.y += abs(p.x)*sin(fl)*aSide*aSide*1.0; p.x *= cos(fl)*0.9 + 0.1;
        p.xz = vec2(ca*p.x - sa*p.z, sa*p.x + ca*p.z); vec3 w = aPos.xyz + p*2.2; vC = aCol; vUv = uv; vW = w;
        gl_Position = projectionMatrix*viewMatrix*vec4(w, 1.0); }`,
    fragmentShader: `${ATMOS_PARS} varying vec3 vC; varying vec2 vUv; varying vec3 vW;
      void main(){ vec2 q = vUv - 0.5; if (length(q*vec2(1.0, 1.4)) > 0.5) discard;
        vec3 c = srgb(vC)*(0.7 + 0.5*smoothstep(0.1, 0.45, length(q))); c = mix(vec3(0.02), c, step(0.06, abs(q.x - 0.0) + 0.05));
        gl_FragColor = vec4(applyAtmos(c*(uSkyAmb*2.5 + uSunCol*sunVisAt(vW)*1.2), vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  }));
  butterflies.frustumCulled = false; scene.add(butterflies);
}

// trout jumping in the nearest lake: arc + splash rings
let fish, ring, jumpT = 0, nextJump = 5, jump = null;
function buildFish() {
  const b = new B().add(blob(0.05, 0.07, 0.24, (x, y, z) => [x * (1 - 0.6 * ss(-0.2, -1, z)), y * (1 - 0.5 * ss(-0.2, -1, z)), z]), (x, y) => y > 0 ? hex('#5d6b4a') : hex('#d8a090'));
  b.add(blob(0.004, 0.08, 0.07), hex('#4a5638'), M(0, 0, -0.26));
  fish = new THREE.Mesh(b.geo(), animalMat); fish.visible = false; scene.add(fish);
  ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdfeeee, transparent: true, opacity: 0.5, depthWrite: false }));
  ring.visible = false; scene.add(ring);
}

export function buildWildlife() {
  const rnd = mulberry32(77);
  spawnHerd('elk', -600, valleyZ(-600), 460, 14, rnd);
  spawnHerd('elk', 1500, valleyZ(1500), 420, 9, rnd);
  spawnHerd('elk', 800, -2150, 520, 8, rnd);
  spawnHerd('moose', -1700, valleyZ(-1700), 380, 3, rnd);
  spawnHerd('moose', 450, 700, 220, 1, rnd);
  spawnHerd('deer', 300, 450, 600, 5, rnd); spawnHerd('deer', -900, -350, 500, 4, rnd); spawnHerd('deer', -200, 850, 250, 3, rnd);
  spawnHerd('sheep', 1450, 1700, 650, 7, rnd); spawnHerd('sheep', -1400, -1800, 700, 5, rnd);
  for (const [x, z, n] of [[600, -2100, 4], [1250, 1850, 2], [-1850, 1300, 2], [200, -1900, 3]]) for (let i = 0; i < n; i++) spawnHerd('marmot', x, z, 650, 1, rnd);
  for (const [x, z] of [[1350, 1550], [-1650, 1100], [-1300, -1900], [900, 1900]]) for (let i = 0; i < 3; i++) spawnHerd('pika', x, z, 400, 1, rnd);
  for (const [x, z] of [[-300, valleyZ(-300) - 150], [1100, valleyZ(1100) + 120], [-1400, valleyZ(-1400)]]) spawnHerd('fox', x, z, 500, 1, rnd);
  for (const [x, z] of [[-200, 880], [-700, 760], [600, 600], [-1000, 1150], [1500, 700]]) for (let i = 0; i < 3; i++) spawnHerd('chipmunk', x, z, 120, 1, rnd);
  for (const [x, z, alt, kind] of [[0, 300, 160, 'hawk'], [-1200, 900, 220, 'hawk'], [900, -1500, 180, 'hawk'], [1300, 1600, 260, 'raven'], [-1700, -1900, 240, 'raven']]) {
    const m = birdModel(kind); scene.add(m.group);
    hawks.push({ kind, ...m, cx: x, cz: z, alt, rad: 120 + rnd() * 120, ang: rnd() * 6.283, sp: 0.12 + rnd() * 0.06 });
  }
  for (let i = 0; i < 8; i++) { const kind = i % 2 ? 'jay' : 'bluebird', m = birdModel(kind); m.group.visible = false; scene.add(m.group); birds.push({ kind, ...m, x: 0, y: -999, z: 0, state: 'idle', t: 0, vy: 0, yaw: 0 }); }
  buildButterflies(); buildFish();
}

// ---------------------------------------------------------------- per-frame update
const seenNow = new Set();
export function updateWildlife(dt, px, pz, py, now, started) {
  for (const a of animals) {
    const dP = Math.hypot(a.x - px, a.z - pz);
    a.group.visible = dP < (a.h < 0.3 ? 140 : 650);
    if (dP > 700) continue;
    if (started && dP < (a.h < 0.3 ? 22 : 50) && !seenNow.has(a.type)) { seenNow.add(a.type); onSpot(a.type, dP); }
    const [walk, trot, run] = SPEED[a.type];
    if (dP < FLEE[a.type] && a.state !== 'flee') {
      a.state = 'flee'; a.timer = 4 + Math.random() * 3; a.lie = Math.min(a.lie, 0.5);
      const ang = Math.atan2(a.z - pz, a.x - px) + (Math.random() - 0.5) * 0.8; a.tx = a.x + Math.cos(ang) * 120; a.tz = a.z + Math.sin(ang) * 120;
      if (a.type === 'marmot' || a.type === 'pika') onSound(a.type, a.group.position);
      if (a.herd.leader === a) for (const m of a.herd.members) if (m !== a && m.state !== 'flee') { m.state = 'flee'; m.timer = a.timer; m.tx = a.tx + m.off[0]; m.tz = a.tz + m.off[1]; }
    }
    a.timer -= dt;
    let target = 0, look = dP < 80 && dP > FLEE[a.type] && a.state !== 'flee';
    const leader = a.herd.leader;
    switch (a.state) {
      case 'graze':
        a.headA = lerp(a.headA, look ? -0.05 : 0.85, dt * 2);
        if (leader !== a && leader.state === 'walk' && Math.hypot(leader.x - a.x, leader.z - a.z) > 25) { a.state = 'follow'; a.timer = 20; }
        else if (a.timer < 0) {
          const r = Math.random();
          if (r < 0.12 && a.h > 0.5 && !look) { a.state = 'rest'; a.timer = 20 + Math.random() * 30; }
          else if (r < 0.2 && a.h > 0.5 && nearWater(a)) { a.state = 'drink'; a.timer = 25; }
          else { a.state = pickTarget(a) ? 'walk' : 'graze'; a.timer = 6 + Math.random() * 10; }
        }
        break;
      case 'walk': case 'drink': case 'follow':
        target = a.state === 'follow' ? trot : walk; a.headA = lerp(a.headA, 0.1, dt * 2);
        if (a.state === 'follow') { a.tx = leader.x + a.off[0]; a.tz = leader.z + a.off[1]; if (Math.hypot(a.tx - a.x, a.tz - a.z) < 6 || a.timer < 0) { a.state = 'graze'; a.timer = 3 + Math.random() * 6; } }
        else if (Math.hypot(a.tx - a.x, a.tz - a.z) < 2 || a.timer < 0) { a.state = a.state === 'drink' ? 'drinking' : 'graze'; a.timer = 6 + Math.random() * 10; }
        break;
      case 'drinking': a.headA = lerp(a.headA, 1.0, dt * 2); if (a.timer < 0) { a.state = 'graze'; a.timer = 5; } break;
      case 'rest': a.lie = Math.min(1, a.lie + dt * 0.5); a.headA = lerp(a.headA, look ? -0.1 : 0.15, dt); if (a.timer < 0 || look && dP < FLEE[a.type] * 1.6) { a.state = 'graze'; a.timer = 4; } break;
      case 'flee': target = run; a.headA = lerp(a.headA, -0.25, dt * 3); if (a.timer < 0) { a.state = 'graze'; a.timer = 3 + Math.random() * 5; } break;
    }
    if (a.state !== 'rest') a.lie = Math.max(0, a.lie - dt * 0.8);
    a.speed = lerp(a.speed, a.lie > 0.05 ? 0 : target, dt * 2.5);
    if (a.speed > 0.05) {
      const want = Math.atan2(a.tx - a.x, a.tz - a.z);
      let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += clamp(dy, -dt * 2.2, dt * 2.2);
      const nx = a.x + Math.sin(a.yaw) * a.speed * dt, nz = a.z + Math.cos(a.yaw) * a.speed * dt;
      if (suits(a.type, nx, nz) || a.state === 'flee' && Math.abs(nx) < HALF - 30 && Math.abs(nz) < HALF - 30 && (waterAt(nx, nz) ?? -1e9) - heightAt(nx, nz) < 0.8) { a.x = nx; a.z = nz; }
      else { a.state = 'graze'; a.timer = 2; }
      a.phase += dt * a.speed / Math.max(0.25, a.h) * 2.1;
    }
    // pose
    const sp = Math.sin(a.yaw), cp = Math.cos(a.yaw), L = a.len;
    const hf = heightAt(a.x + sp * L * 0.5, a.z + cp * L * 0.5), hb = heightAt(a.x - sp * L * 0.5, a.z - cp * L * 0.5);
    const gaitK = a.speed / walk, gallop = ss(1.6, 3.5, gaitK);
    a.group.position.set(a.x, (hf + hb) / 2, a.z); a.group.rotation.set(0, a.yaw, 0);
    a.body.rotation.x = -Math.atan2(hf - hb, L) - gallop * Math.sin(a.phase * 2) * 0.05;
    const legLen = a.legs.length ? a.legs[0].len : 0;
    a.body.position.y = -a.lie * legLen * 0.72 + Math.abs(Math.sin(a.phase)) * 0.04 * gaitK * a.h;
    // head looks at the hiker when alert
    const rel = Math.atan2(px - a.x, pz - a.z) - a.yaw, relN = Math.atan2(Math.sin(rel), Math.cos(rel));
    a.headY = lerp(a.headY, look || a.state === 'rest' && dP < 60 ? clamp(relN, -1.1, 1.1) : 0, dt * 2.5);
    a.head.rotation.set(a.headA + Math.sin(now * 1.3 + a.phase) * 0.03, a.headY, 0, 'YXZ');
    a.earT -= dt; if (a.earT < 0) { a.earT = 1.5 + Math.random() * 5; a.earKick = 1; }
    a.earKick = (a.earKick || 0) * Math.exp(-dt * 8);
    a.ears.forEach((e, i) => { e.rotation.x = Math.sin(now * 30) * a.earKick * 0.4 * (i ? 1 : -1) - (look ? 0.3 : 0); });
    a.tail.rotation.z = Math.sin(now * (a.speed > 2 ? 8 : 2.2) + a.phase) * 0.35; a.tail.rotation.x = a.state === 'flee' ? -0.7 : 0;
    const amp = clamp(gaitK, 0, 1) * lerp(0.42, 0.75, gallop);
    a.legs.forEach((l, i) => {
      const off = gallop > 0.5 ? (i < 2 ? 0 : Math.PI * 0.9) + (i & 1) * 0.35 : (i === 0 || i === 3 ? 0 : Math.PI);
      const ph = a.phase + off, sw = Math.sin(ph) * amp, lift = Math.max(0, Math.cos(ph)) * amp * 1.4;
      l.hip.rotation.x = a.lie > 0.05 ? lerp(sw, l.hock ? -0.9 : 1.2, a.lie) : sw;
      l.knee.rotation.x = a.lie > 0.05 ? lerp(0, l.hock ? 2.4 : -2.4, a.lie) : (l.hock ? lift : -lift);
    });
  }
  // soaring birds
  for (const h of hawks) {
    h.ang += h.sp * dt; const x = h.cx + Math.cos(h.ang) * h.rad, z = h.cz + Math.sin(h.ang) * h.rad;
    const y = heightAt(h.cx, h.cz) + h.alt + Math.sin(now * 0.2 + h.rad) * 15;
    h.group.position.set(x, y, z); h.group.rotation.set(0, Math.atan2(-Math.sin(h.ang), Math.cos(h.ang)), -0.35, 'YXZ');
    const flap = Math.sin(now * 0.4 + h.cx) > 0.6 ? Math.sin(now * 9) * 0.45 : 0.05 + Math.sin(now * 0.7) * 0.03;
    h.wings.forEach((w, i) => { w.rotation.z = (i === 0 ? -1 : 1) * flap; });
    const d = Math.hypot(x - px, z - pz, y - py); if (started && d < 300 && h.kind === 'hawk' && !seenNow.has('hawk')) { seenNow.add('hawk'); onSpot('hawk', d); }
  }
  updateSmallBirds(dt, px, pz, py, now, started);
  updateButterflies(dt, px, pz, now);
  updateFish(dt, px, pz, now, started);
}
function updateSmallBirds(dt, px, pz, py, now, started) {
  const day = sky_state.hour > 5.8 && sky_state.hour < 20.2 && U.storm.value < 0.5;
  for (const b of birds) {
    const d = Math.hypot(b.x - px, b.z - pz);
    if (b.state === 'idle' || d > 70) {
      b.group.visible = false; b.state = 'idle';
      if (!day || Math.random() > dt * 0.4) continue;
      const a = Math.random() * 6.283, r = 14 + Math.random() * 30, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, k = cellOf(x, z), e = G.H[k] + BASE;
      if (e > 3500 || waterAt(x, z) !== null || 1 - G.NRM[k * 3 + 1] > 0.35) continue;
      const forest = G.BIO[k * 4] > 100;
      if ((b.kind === 'jay') !== forest) continue;
      Object.assign(b, { x, z, y: heightAt(x, z), state: 'ground', t: 0, yaw: Math.random() * 6.283 }); b.group.visible = true;
    } else if (b.state === 'ground') {
      b.t -= dt;
      if (b.t < 0) { b.t = 0.4 + Math.random() * 1.2; b.vy = 1.6; b.yaw += (Math.random() - 0.5) * 2; }
      if (b.vy > 0 || b.y > heightAt(b.x, b.z)) { b.x += Math.sin(b.yaw) * 0.5 * dt; b.z += Math.cos(b.yaw) * 0.5 * dt; b.vy -= 9 * dt; b.y = Math.max(heightAt(b.x, b.z), b.y + b.vy * dt); }
      if (d < 7) { b.state = 'fly'; b.vy = 3; b.yaw = Math.atan2(b.x - px, b.z - pz); }
      if (started && d < 25 && !seenNow.has(b.kind)) { seenNow.add(b.kind); onSpot(b.kind, d); }
      b.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * 1.3; });
    } else {
      b.x += Math.sin(b.yaw) * 7 * dt; b.z += Math.cos(b.yaw) * 7 * dt; b.y += b.vy * dt; b.vy = Math.max(0.6, b.vy - dt);
      b.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * Math.sin(now * 30) * 0.9; });
      if (d > 60) b.state = 'idle';
    }
    b.group.position.set(b.x, b.y + 0.04, b.z); b.group.rotation.y = b.yaw;
  }
}
function updateButterflies(dt, px, pz, now) {
  const day = sky_state.hour > 8 && sky_state.hour < 19 && U.storm.value < 0.3;
  const A = butterflies.geometry.attributes.aPos;
  for (let i = 0; i < BF; i++) {
    const b = bfState[i];
    if (Math.hypot(b.x - px, b.z - pz) > 32 || !day) {
      b.y = -9999;
      if (day && Math.random() < dt * 2) { const a = Math.random() * 6.283, r = 5 + Math.random() * 25, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, k = cellOf(x, z); if (G.BIO[k * 4 + 1] > 50) { b.x = x; b.z = z; b.y = heightAt(x, z) + 0.6; } }
    } else {
      b.ph += dt; const h = heightAt(b.x, b.z);
      b.vx = lerp(b.vx, Math.sin(b.ph * 0.7 + i) * 1.4, dt * 2); b.vz = lerp(b.vz, Math.cos(b.ph * 0.6 + i * 2) * 1.4, dt * 2);
      b.x += b.vx * dt; b.z += b.vz * dt; b.y = h + 0.35 + Math.abs(Math.sin(b.ph * 2.3 + i)) * 0.9;
    }
    A.setXYZW(i, b.x, b.y, b.z, Math.atan2(b.vx, b.vz));
  }
  A.needsUpdate = true;
}
function updateFish(dt, px, pz, now, started) {
  if (jump) {
    jump.t += dt; const t = jump.t / 0.9;
    if (t < 1) { fish.visible = true; fish.position.set(lerp(jump.ax, jump.bx, t), jump.y + Math.sin(t * Math.PI) * 0.7, lerp(jump.az, jump.bz, t)); fish.rotation.set(-Math.cos(t * Math.PI) * 0.9, jump.yaw, Math.sin(now * 20) * 0.2, 'YXZ'); }
    else fish.visible = false;
    const rt = jump.t; ring.visible = rt < 2.2; ring.position.set(jump.ax, jump.y + 0.03, jump.az); ring.scale.setScalar(0.3 + rt * 1.6); ring.material.opacity = 0.5 * (1 - rt / 2.2);
    if (jump.t > 2.3) jump = null;
    return;
  }
  nextJump -= dt; if (nextJump > 0 || U.storm.value > 0.6) return;
  nextJump = 4 + Math.random() * 8;
  let best = null, bd = 150;
  for (const L of LAKES) { const d = Math.hypot(L.x - px, L.z - pz) - L.r; if (d < bd) { bd = d; best = L; } }
  if (!best) return;
  const a = Math.random() * 6.283, r = Math.random() * lakeR(best, a) * 0.7, ax = best.x + Math.cos(a) * r, az = best.z + Math.sin(a) * r, yaw = Math.random() * 6.283;
  jump = { t: 0, ax, az, bx: ax + Math.sin(yaw) * 1.2, bz: az + Math.cos(yaw) * 1.2, y: best.level, yaw };
  onSound('splash', new V3(ax, best.level, az));
  if (started && !seenNow.has('trout') && Math.hypot(ax - px, az - pz) < 80) { seenNow.add('trout'); onSpot('trout', Math.hypot(ax - px, az - pz)); }
}
export function markSeen(list) { for (const t of list) seenNow.add(t); }
