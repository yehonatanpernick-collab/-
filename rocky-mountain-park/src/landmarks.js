// Landmarks of the real park: Trail Ridge Road with traffic, the Alpine Visitor Center, Moraine Park
// Campground, beaver dams, the Keyhole shelter, and other hikers on the trails.
import * as THREE from 'three';
import { clamp, lerp, mulberry32, ROAD, VISITOR, CAMP, KEYHOLE, LAKES, TRAILS, BASE } from './shared.js';
import { scene, U, hex, heightAt } from './core.js';
import { patchLit } from './atmos.js';

const V3 = THREE.Vector3;
const mat = patchLit(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'landmark', ao: 0.6, wet: 0.3 });
// tiny vertex-colour merger for props
class B {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(g, col, m) {
    if (m) g.applyMatrix4(m); if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position, Nn = g.attributes.normal, c = hex(col);
    for (let i = 0; i < P.count; i++) { this.p.push(P.getX(i), P.getY(i), P.getZ(i)); this.n.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i)); this.c.push(c.r, c.g, c.b); }
    return this;
  }
  mesh() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; }
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------- Trail Ridge Road
let roadCum = [];
function buildRoad() {
  const P = ROAD.path, n = P.length, pos = [], col = [], idx = [];
  const asphalt = hex('#46464a'), line = hex('#e8c63a'), edge = hex('#e6e6e0');
  // five strips across: shoulder, white edge, lane, centre (yellow), lane, edge, shoulder
  const xs = [-ROAD.w - 1.2, -ROAD.w, -ROAD.w + 0.2, -0.12, 0.12, ROAD.w - 0.2, ROAD.w, ROAD.w + 1.2];
  const cs = [hex('#7a7266'), edge, asphalt, line, asphalt, edge, hex('#7a7266')];
  roadCum = [0];
  for (let i = 0; i < n; i++) {
    if (i) roadCum.push(roadCum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    const dash = Math.floor(roadCum[i] / 6) % 2 === 0;
    for (let k = 0; k < xs.length; k++) {
      const x = P[i][0] + nx * xs[k], z = P[i][1] + nz * xs[k];
      pos.push(x, Math.max(heightAt(x, z), ROAD.prof[i] - 0.2) + 0.06, z);
      const c = k === 3 || k === 4 ? (dash ? line : asphalt) : cs[Math.min(k, cs.length - 1)];
      const v = 0.92 + 0.12 * Math.sin(i * 1.7 + k);
      col.push(c.r * v, c.g * v, c.b * v);
    }
  }
  const W = xs.length;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < W - 1; k++) { const a = i * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, patchLit(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), { key: 'road', ao: 1, wet: 0.45 }));
  m.receiveShadow = true; scene.add(m);
  // roadside posts every 40 m
  const pb = new B();
  for (let i = 0; i < n; i += 7) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    for (const sd of [-1, 1]) { const x = P[i][0] + nx * sd * (ROAD.w + 1.6), z = P[i][1] + nz * sd * (ROAD.w + 1.6); pb.add(box(0.12, 1.1, 0.12), '#6b5a46', M(x, heightAt(x, z) + 0.5, z)); pb.add(box(0.13, 0.12, 0.13), '#d8d4c8', M(x, heightAt(x, z) + 1.0, z)); }
  }
  scene.add(pb.mesh());
}
function carGeo(color) {
  const b = new B();
  b.add(box(1.8, 0.7, 4.4), color, M(0, 0.65, 0)).add(box(1.62, 0.62, 2.3), '#20262c', M(0, 1.28, -0.25)).add(box(1.66, 0.08, 2.2), color, M(0, 1.62, -0.25));
  for (const [x, z] of [[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]]) b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12).rotateZ(Math.PI / 2), '#111214', M(x, 0.34, z));
  b.add(box(1.5, 0.12, 0.05), '#fff4d0', M(0, 0.78, 2.21)).add(box(1.5, 0.12, 0.05), '#a01a14', M(0, 0.82, -2.21));
  return b.mesh();
}
const cars = [];
function buildCars() {
  const rnd = mulberry32(51), cols = ['#b03024', '#1f4f8a', '#e8e6e0', '#2e2e30', '#4f6b3a', '#c9a23a', '#7a7f86', '#264a52'];
  const L = roadCum[roadCum.length - 1];
  for (let i = 0; i < 9; i++) { const m = carGeo(cols[i % cols.length]); scene.add(m); cars.push({ m, s: rnd() * L, dir: i % 2 ? 1 : -1, v: 10 + rnd() * 6 }); }
}
function roadAt(s) {
  const P = ROAD.path; let lo = 0, hi = roadCum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (roadCum[mid] < s) lo = mid; else hi = mid; }
  const t = (s - roadCum[lo]) / Math.max(roadCum[hi] - roadCum[lo], 1e-3);
  return { x: lerp(P[lo][0], P[hi][0], t), z: lerp(P[lo][1], P[hi][1], t), y: lerp(ROAD.prof[lo], ROAD.prof[hi], t), tx: P[hi][0] - P[lo][0], tz: P[hi][1] - P[lo][1], ty: ROAD.prof[hi] - ROAD.prof[lo] };
}
function updateCars(dt, px, pz) {
  const L = roadCum[roadCum.length - 1];
  for (const c of cars) {
    c.s += c.v * c.dir * dt; if (c.s > L - 5) c.dir = -1; if (c.s < 5) c.dir = 1;
    const r = roadAt(c.s), l = Math.hypot(r.tx, r.tz) || 1, nx = -r.tz / l, nz = r.tx / l, lane = 2.1 * c.dir;
    const x = r.x + nx * lane, z = r.z + nz * lane;
    c.m.visible = Math.hypot(x - px, z - pz) < 1600;
    if (!c.m.visible) continue;
    c.m.position.set(x, Math.max(r.y, heightAt(x, z) - 0.1) + 0.02, z);
    c.m.rotation.set(-Math.atan2(r.ty, l) * c.dir, Math.atan2(r.tx * c.dir, r.tz * c.dir), 0, 'YXZ');
  }
}

// ---------------------------------------------------------------- buildings and camp
function buildVisitorCenter() {
  const b = new B(), y = heightAt(VISITOR.x, VISITOR.z), yaw = VISITOR.yaw || 0;
  const R = (x, yy, z, tilt = 0) => { const v = new V3(x, 0, z).applyAxisAngle(new V3(0, 1, 0), yaw); return new THREE.Matrix4().compose(new V3(VISITOR.x + v.x, y + yy, VISITOR.z + v.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ')), new V3(1, 1, 1)); };
  b.add(box(30, 4.2, 13), '#8a8178', R(0, 2.1, 0)).add(box(30.5, 0.6, 13.5), '#6a5a48', R(0, 0.3, 0));
  for (const sd of [-1, 1]) b.add(box(31.5, 0.35, 8.2), '#5a3f2c', R(0, 5.35, sd * 3.55, sd * 0.42));
  b.add(box(30.8, 0.4, 0.6), '#4a3424', R(0, 6.85, 0));
  for (let i = -3; i <= 3; i++) b.add(box(2.2, 1.6, 0.1), '#2c3e48', R(i * 4, 2.6, 6.56));
  b.add(box(2.4, 2.8, 0.2), '#4a3424', R(-12, 1.4, 6.6));
  b.add(box(1.6, 7.5, 1.6), '#7d746a', R(10, 3.75, -3));
  const flag = new B().add(new THREE.CylinderGeometry(0.06, 0.08, 9, 6), '#c8c8c8', R(-17, 4.5, 8));
  scene.add(b.mesh(), flag.mesh());
  for (let i = 0; i < 7; i++) { const c = carGeo(['#b03024', '#e8e6e0', '#1f4f8a', '#2e2e30', '#7a7f86', '#4f6b3a', '#c9a23a'][i]); const v = new V3(-14 + i * 4.2, 0, 19).applyAxisAngle(new V3(0, 1, 0), yaw); c.position.set(VISITOR.x + v.x, heightAt(VISITOR.x + v.x, VISITOR.z + v.z) + 0.02, VISITOR.z + v.z); c.rotation.y = yaw; scene.add(c); }
}
let fire, fireLight;
function buildCamp() {
  const b = new B(), rnd = mulberry32(61), tents = ['#d8762a', '#2f6aa8', '#4f7a3a', '#c23a2a', '#e0c24a', '#6a4a8a'];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rnd() * 0.3, r = CAMP.r * (0.45 + rnd() * 0.35), x = CAMP.x + Math.cos(a) * r, z = CAMP.z + Math.sin(a) * r, y = heightAt(x, z), yaw = a + Math.PI / 2;
    const tent = new THREE.CylinderGeometry(0.02, 1.35, 2.6, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2); tent.scale(1, 0.9, 1.15);
    b.add(tent, tents[i % tents.length], M(x, y + 0.62, z, 0, yaw));
    const tx = x + Math.cos(a) * 4, tz = z + Math.sin(a) * 4, ty = heightAt(tx, tz);
    b.add(box(1.8, 0.08, 0.8), '#7a5a3c', M(tx, ty + 0.75, tz, 0, yaw)); for (const s of [-1, 1]) b.add(box(1.8, 0.06, 0.28), '#6a4a30', M(tx + Math.sin(yaw) * s * 0.65, ty + 0.45, tz + Math.cos(yaw) * s * 0.65, 0, yaw));
  }
  const fy = heightAt(CAMP.x, CAMP.z);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.add(new THREE.DodecahedronGeometry(0.22, 0), '#6e6a64', M(CAMP.x + Math.cos(a) * 0.9, fy + 0.12, CAMP.z + Math.sin(a) * 0.9)); }
  for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6).rotateZ(Math.PI / 2), '#3a2a1c', M(CAMP.x, fy + 0.15, CAMP.z, 0, i * 0.8));
  scene.add(b.mesh());
  // the campfire: flickering additive flames and a warm light that matters after dusk
  const pts = [], seeds = [];
  for (let i = 0; i < 90; i++) { pts.push(CAMP.x, fy + 0.15, CAMP.z); seeds.push(Math.random(), Math.random(), Math.random()); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3));
  fire = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time },
    vertexShader: `uniform float uTime; attribute vec3 aSeed; varying float vT;
      void main(){ float t = fract(uTime*(0.9 + aSeed.x) + aSeed.y); vT = t;
        vec3 p = position + vec3((aSeed.x - 0.5)*0.6*(1.0 - t), t*1.3, (aSeed.z - 0.5)*0.6*(1.0 - t));
        vec4 mv = viewMatrix*vec4(p, 1.0); gl_PointSize = (1.0 - t)*0.55*700.0/max(-mv.z, 1.0); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vT; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      vec3 c = mix(vec3(6.0, 3.2, 0.9), vec3(2.2, 0.4, 0.05), vT); gl_FragColor = vec4(c*(1.0 - d*2.0), (1.0 - vT)*(1.0 - d*2.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  fire.frustumCulled = false; scene.add(fire);
  fireLight = new THREE.PointLight(0xff8a3a, 0, 22, 1.6); fireLight.position.set(CAMP.x, fy + 1.0, CAMP.z); scene.add(fireLight);
}
function buildBeaverDams() {
  const b = new B(), rnd = mulberry32(71);
  for (const L of LAKES.filter(l => l.minor)) {
    const a0 = L.a + Math.PI * 0.5;
    for (let i = 0; i < 26; i++) {
      const t = (i / 25 - 0.5) * 1.2, an = a0 + t, rr = L.r * 0.95, x = L.x + Math.cos(an) * rr * L.sy, z = L.z + Math.sin(an) * rr * L.sy;
      b.add(new THREE.CylinderGeometry(0.09, 0.12, 2.2 + rnd() * 1.5, 5).rotateZ(Math.PI / 2 + (rnd() - 0.5) * 0.4), rnd() < 0.5 ? '#5a4632' : '#7a6248', M(x, L.level + 0.1 + (i % 3) * 0.12, z, 0, an + (rnd() - 0.5) * 0.8));
    }
    const lx = L.x - Math.cos(L.a) * L.r * 0.4, lz = L.z - Math.sin(L.a) * L.r * 0.4;
    b.add(new THREE.SphereGeometry(2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), '#5e4a34', M(lx, L.level - 0.1, lz));
  }
  scene.add(b.mesh());
}
function buildKeyhole() {
  const b = new B(), sx = KEYHOLE.x - 40, sz = KEYHOLE.z - 50, y = heightAt(sx, sz);
  b.add(new THREE.SphereGeometry(2.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#8a8580', M(sx, y, sz)).add(box(0.9, 1.3, 0.3), '#2a2420', M(sx, y + 0.65, sz + 2.2));
  scene.add(b.mesh());
}

// ---------------------------------------------------------------- hikers
const hikers = [];
const GREET = ['Hi there!', 'Beautiful day!', 'Almost there — keep going!', 'Saw an elk back there!', 'Enjoy the lake!', 'Watch the weather up top.'];
let greetCb = () => {};
export const setGreetHandler = (fn) => { greetCb = fn; };
function hikerModel(rnd) {
  const shirt = ['#c23a2a', '#2f6aa8', '#e0c24a', '#4f7a3a', '#e8e6e0', '#d8762a'][(rnd() * 6) | 0], pack = ['#2e2e30', '#7a3a2a', '#2a4a6a', '#5a6a2a'][(rnd() * 4) | 0];
  const g = new THREE.Group();
  const body = new B().add(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), shirt, M(0, 1.22, 0)).add(box(0.36, 0.5, 0.22), pack, M(0, 1.28, -0.24))
    .add(new THREE.SphereGeometry(0.12, 10, 8), '#d9a77c', M(0, 1.72, 0)).add(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12), '#c8b07a', M(0, 1.8, 0)).add(new THREE.CylinderGeometry(0.1, 0.11, 0.1, 10), '#c8b07a', M(0, 1.85, 0));
  g.add(body.mesh());
  const legs = [];
  for (const sd of [-1, 1]) { const p = new THREE.Group(); p.position.set(sd * 0.1, 0.92, 0); p.add(new B().add(new THREE.CapsuleGeometry(0.075, 0.68, 3, 6), '#4a4640', M(0, -0.44, 0)).add(box(0.12, 0.1, 0.24), '#3a2a1c', M(0, -0.88, 0.05)).mesh()); g.add(p); legs.push(p); }
  return { g, legs };
}
function buildHikers() {
  const rnd = mulberry32(81), plan = [[0, 3], [2, 3], [1, 1], [3, 2], [4, 2], [5, 1], [6, 1]];
  for (const [ti, n] of plan) for (let i = 0; i < n; i++) {
    const T = TRAILS[ti], m = hikerModel(rnd); scene.add(m.g);
    hikers.push({ ...m, T, s: rnd() * T.cum[T.cum.length - 1], dir: rnd() < 0.5 ? 1 : -1, v: 1.1 + rnd() * 0.4, ph: rnd() * 6, pause: 0, greeted: -1e9 });
  }
}
function trailAt(T, s) {
  const c = T.cum, P = T.path; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < s) lo = mid; else hi = mid; }
  const t = (s - c[lo]) / Math.max(c[hi] - c[lo], 1e-3);
  return [lerp(P[lo][0], P[hi][0], t), lerp(P[lo][1], P[hi][1], t), P[hi][0] - P[lo][0], P[hi][1] - P[lo][1]];
}
function updateHikers(dt, px, pz, now) {
  for (const h of hikers) {
    const L = h.T.cum[h.T.cum.length - 1];
    const [x0, z0] = trailAt(h.T, h.s), dP = Math.hypot(x0 - px, z0 - pz);
    h.g.visible = dP < 350; if (!h.g.visible) { h.s += h.v * h.dir * dt; if (h.s > L - 2 || h.s < 2) h.dir *= -1; continue; }
    const near = dP < 6;
    if (near && now - h.greeted > 60) { h.greeted = now; greetCb(GREET[(Math.random() * GREET.length) | 0]); }
    const speed = near ? 0 : h.v;
    h.s += speed * h.dir * dt; if (h.s > L - 2) { h.s = L - 2; h.dir = -1; } if (h.s < 2) { h.s = 2; h.dir = 1; }
    const [x, z, tx, tz] = trailAt(h.T, h.s), l = Math.hypot(tx, tz) || 1, off = 0.45 * h.dir;
    const wx = x - tz / l * off, wz = z + tx / l * off;
    h.g.position.set(wx, heightAt(wx, wz) + 0.02, wz);
    const face = near ? Math.atan2(px - wx, pz - wz) : Math.atan2(tx * h.dir, tz * h.dir);
    let dy = face - h.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); h.g.rotation.y += dy * Math.min(1, dt * 4);
    h.ph += speed * dt * 4.2;
    h.legs.forEach((l2, i) => { l2.rotation.x = Math.sin(h.ph + i * Math.PI) * 0.45 * (speed > 0 ? 1 : 0); });
  }
}

export function buildLandmarks() {
  buildRoad(); buildCars(); buildVisitorCenter(); buildCamp(); buildBeaverDams(); buildKeyhole(); buildHikers();
}
export function updateLandmarks(dt, px, pz, now) {
  updateCars(dt, px, pz); updateHikers(dt, px, pz, now);
  const night = U.night.value, dusk = 1 - clamp(U.sunDir.value.y * 4, 0, 1);
  fireLight.intensity = (0.4 + 0.6 * dusk + night * 2) * (14 + Math.sin(now * 13) * 2 + Math.sin(now * 7.3) * 2) * (1 - U.storm.value * 0.8);
  fire.visible = U.storm.value < 0.7 && Math.hypot(CAMP.x - px, CAMP.z - pz) < 900;
}
export const LANDMARK_POIS = () => [
  { id: 'lm:road', he: 'טרייל רידג׳ רואד', en: 'Trail Ridge Road', x: ROAD.path[Math.floor(ROAD.path.length * 0.5)][0], z: ROAD.path[Math.floor(ROAD.path.length * 0.5)][1], r: 200, kind: 'landmark', note: 'הכביש הסלול הגבוה ביבשת: חוצה את הטונדרה בגובה של יותר מ-3,600 מ׳ ופתוח רק בקיץ.' },
  { id: 'lm:visitor', he: VISITOR.he, en: VISITOR.en, x: VISITOR.x, z: VISITOR.z, r: 120, kind: 'landmark', note: 'מרכז המבקרים הגבוה במערכת הפארקים של ארה״ב, על רכס פול ריבר. מכאן יוצא שביל קצר לטונדרה.' },
  { id: 'lm:camp', he: CAMP.he, en: CAMP.en, x: CAMP.x, z: CAMP.z, r: 150, kind: 'landmark', note: 'אתרי אוהלים מעל עמק מוריין. בערבים אפשר לשמוע את עדרי הוואפיטי מהאחו.' },
  { id: 'lm:keyhole', he: KEYHOLE.he, en: KEYHOLE.en, x: KEYHOLE.x, z: KEYHOLE.z, r: 140, kind: 'landmark', note: 'חריץ ברכס של לונגס פיק, השער אל מסלול הטיפוס הקלאסי לפסגה. לידו מקלט האבן אגנס וייל.' },
];
export { roadAt };
