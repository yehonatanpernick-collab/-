// Procedural soldier: rigid-skinned single SkinnedMesh (one draw call) built from ~60
// primitives (helmet, plate carrier, pouches, pack, pads, boots, gloves), with procedural
// locomotion, aiming, crouch, sprint, reload, downed and death animations.
import * as THREE from 'three';
import { camoMaterial } from './materials.js';
import { buildGun } from './guns.js';

const BONES = [
  ['hips', -1, [0, 0.98, 0]], ['spine', 0, [0, 1.12, 0]], ['chest', 1, [0, 1.3, 0]], ['neck', 2, [0, 1.5, 0]], ['head', 3, [0, 1.6, 0]],
  ['uarmL', 2, [-0.21, 1.44, 0]], ['farmL', 5, [-0.21, 1.15, 0]], ['handL', 6, [-0.21, 0.9, 0]],
  ['uarmR', 2, [0.21, 1.44, 0]], ['farmR', 8, [0.21, 1.15, 0]], ['handR', 9, [0.21, 0.9, 0]],
  ['thighL', 0, [-0.1, 0.93, 0]], ['shinL', 11, [-0.1, 0.52, 0]], ['footL', 12, [-0.1, 0.09, 0]],
  ['thighR', 0, [0.1, 0.93, 0]], ['shinR', 14, [0.1, 0.52, 0]], ['footR', 15, [0.1, 0.09, 0]],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

const TEAM_STYLE = {
  1: { camo: [0x8a8060, 0x6a6448, 0xa89a76], gear: 0x6e6650, gear2: 0x4f4a3a, skin: 0xc89c80, helmet: 0x6a6450, face: 0xc89c80, goggles: true },
  2: { camo: [0x4a4c48, 0x343633, 0x62625a], gear: 0x2e302c, gear2: 0x1e201d, skin: 0xb08a70, helmet: 0x3a3c38, face: 0x1e1e1c, goggles: false },
};

function buildGeometry(team) {
  const st = TEAM_STYLE[team];
  const parts = [];
  const col = new THREE.Color();
  const add = (g, bone, color, camo = 0, m) => {
    if (m) g.applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    col.setHex(color);
    const cArr = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), cm = new Float32Array(n);
    for (let i = 0; i < n; i++) { cArr[i * 3] = col.r; cArr[i * 3 + 1] = col.g; cArr[i * 3 + 2] = col.b; si[i * 4] = BI[bone]; sw[i * 4] = 1; cm[i] = camo; }
    g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('aCamo', new THREE.BufferAttribute(cm, 1));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    parts.push(g);
  };
  const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g; };
  const cyl = (rt, rb, h, x, y, z, seg = 10, rx = 0, rz = 0) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
  const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10, ts = 0, tl = Math.PI) => { const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, ts, tl); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
  const W = 0xffffff;
  // legs
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R', x = s * 0.1;
    add(cyl(0.085, 0.07, 0.42, x, 0.73, 0, 10), 'thigh' + L, W, 1);
    add(box(0.07, 0.12, 0.05, x + s * 0.07, 0.76, -0.01), 'thigh' + L, st.gear2); // thigh pocket
    add(cyl(0.068, 0.056, 0.42, x, 0.31, 0, 10), 'shin' + L, W, 1);
    add(box(0.1, 0.11, 0.05, x, 0.52, -0.06), 'shin' + L, st.gear2); // knee pad
    add(box(0.11, 0.12, 0.27, x, 0.06, -0.045), 'foot' + L, 0x2a241e); // boot
    add(box(0.115, 0.03, 0.28, x, 0.005, -0.045), 'foot' + L, 0x141210); // sole
    add(cyl(0.062, 0.062, 0.1, x, 0.15, 0, 10), 'shin' + L, 0x2a241e); // boot top
  }
  // pelvis / belt
  add(box(0.34, 0.18, 0.22, 0, 0.95, 0), 'hips', W, 1);
  add(box(0.36, 0.05, 0.24, 0, 1.03, 0), 'hips', 0x26231d);
  add(box(0.08, 0.09, 0.05, 0.12, 1.0, -0.13), 'hips', st.gear);
  add(box(0.08, 0.09, 0.05, -0.12, 1.0, -0.13), 'hips', st.gear);
  add(box(0.1, 0.12, 0.06, 0.18, 0.98, 0.06), 'hips', st.gear2); // dump pouch
  // torso
  add(box(0.32, 0.2, 0.2, 0, 1.15, 0), 'spine', W, 1);
  add(box(0.38, 0.3, 0.23, 0, 1.36, 0), 'chest', W, 1);
  add(box(0.4, 0.33, 0.29, 0, 1.33, 0), 'chest', st.gear); // plate carrier
  add(box(0.36, 0.02, 0.3, 0, 1.5, 0), 'chest', st.gear2);
  for (let k = -1; k <= 1; k++) add(box(0.1, 0.13, 0.055, k * 0.115, 1.23, -0.17), 'chest', st.gear2); // mag pouches
  add(box(0.08, 0.06, 0.04, -0.12, 1.41, -0.165), 'chest', 0x22201c); // radio/admin
  add(box(0.12, 0.08, 0.03, 0.1, 1.42, -0.165), 'chest', st.gear2);
  add(box(0.05, 0.18, 0.05, -0.17, 1.42, 0.12), 'chest', 0x1a1a1a); // radio
  add(cyl(0.008, 0.008, 0.4, -0.17, 1.7, 0.13, 4), 'chest', 0x111111); // antenna
  // backpack
  add(box(0.3, 0.36, 0.16, 0, 1.3, 0.22), 'chest', st.gear);
  add(box(0.26, 0.1, 0.06, 0, 1.18, 0.31), 'chest', st.gear2);
  add(cyl(0.06, 0.06, 0.28, 0, 1.52, 0.22, 8, 0, Math.PI / 2), 'chest', st.gear2); // bedroll
  // shoulders
  add(sph(0.075, -0.21, 1.44, 0, 1, 1, 1, 10, 8), 'uarmL', W, 1);
  add(sph(0.075, 0.21, 1.44, 0, 1, 1, 1, 10, 8), 'uarmR', W, 1);
  // arms
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R', x = s * 0.21;
    add(cyl(0.058, 0.05, 0.29, x, 1.3, 0, 9), 'uarm' + L, W, 1);
    add(cyl(0.05, 0.044, 0.26, x, 1.03, 0, 9), 'farm' + L, W, 1);
    add(box(0.07, 0.07, 0.05, x, 1.15, 0.04), 'farm' + L, st.gear2); // elbow pad
    add(box(0.06, 0.1, 0.09, x, 0.86, -0.01), 'hand' + L, 0x2c2a26); // glove
    add(box(0.03, 0.05, 0.03, x - s * 0.02, 0.86, -0.065), 'hand' + L, 0x2c2a26); // thumb
  }
  // neck / head
  add(cyl(0.05, 0.055, 0.1, 0, 1.52, 0, 8), 'neck', st.face === st.skin ? st.skin : st.face);
  add(sph(0.105, 0, 1.64, -0.005, 0.92, 1.1, 1), 'head', st.face);
  add(box(0.13, 0.07, 0.08, 0, 1.585, -0.06), 'head', st.face === st.skin ? 0x3a3428 : 0x1a1a18); // shemagh / balaclava lower face
  add(box(0.02, 0.03, 0.03, 0, 1.64, -0.11), 'head', st.skin); // nose
  // helmet
  add(sph(0.135, 0, 1.68, 0.005, 1, 0.88, 1.08, 16, 10, 0, Math.PI * 0.55), 'head', st.helmet);
  add(cyl(0.142, 0.142, 0.018, 0, 1.665, 0.0, 16), 'head', st.gear2);
  add(box(0.05, 0.04, 0.03, 0, 1.74, -0.13), 'head', 0x1a1a1a); // NVG mount
  add(cyl(0.035, 0.035, 0.03, -0.12, 1.63, 0, 10, 0, Math.PI / 2), 'head', 0x2a2a28); // ear pro
  add(cyl(0.035, 0.035, 0.03, 0.12, 1.63, 0, 10, 0, Math.PI / 2), 'head', 0x2a2a28);
  if (st.goggles) add(box(0.2, 0.045, 0.04, 0, 1.73, -0.1, -0.25), 'head', 0x222018);
  add(box(0.06, 0.05, 0.03, 0, 1.75, 0.13), 'head', st.gear2); // helmet battery
  const g = mergeParts(parts);
  g.computeBoundingSphere();
  g.boundingSphere.radius = 1.4; g.boundingSphere.center.set(0, 0.9, 0);
  return g;
}

function mergeParts(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight', 'aCamo'];
  for (const name of names) {
    const a0 = parts[0].attributes[name];
    const arr = new a0.array.constructor(n * a0.itemSize);
    let o = 0;
    for (const p of parts) { const a = p.attributes[name]; arr.set(a.array, o); o += a.array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize));
  }
  return out;
}

const GEOS = {};
const MATS = {};
export function soldierAssets(macro) {
  for (const t of [1, 2]) {
    if (!GEOS[t]) GEOS[t] = buildGeometry(t);
    if (!MATS[t]) { const s = TEAM_STYLE[t]; MATS[t] = camoMaterial(macro, { c1: s.camo[0], c2: s.camo[1], c3: s.camo[2], key: 't' + t, rough: 0.9 }); MATS[t].skinning = true; }
  }
}

export class Soldier {
  constructor(team, macro) {
    soldierAssets(macro);
    this.team = team;
    const bones = BONES.map(() => new THREE.Bone());
    BONES.forEach(([name, parent, pos], i) => {
      const b = bones[i]; b.name = name;
      const pp = parent >= 0 ? BONES[parent][2] : [0, 0, 0];
      b.position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]);
      if (parent >= 0) bones[parent].add(b);
    });
    this.bones = Object.fromEntries(BONES.map((b, i) => [b[0], bones[i]]));
    this.rest = BONES.map((b, i) => bones[i].position.clone());
    const mesh = new THREE.SkinnedMesh(GEOS[team], MATS[team]);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.mesh = mesh;
    this.root = new THREE.Group();
    this.root.add(mesh);
    this.gunHolder = new THREE.Group();
    this.bones.chest.add(this.gunHolder);
    this.gunHolder.position.set(0.13, 0.04, -0.28);
    this.gunId = null;
    this.phase = Math.random() * 10;
    this.crouchK = 0; this.sprintK = 0; this.deadT = -1; this.downK = 0; this.fireKick = 0; this.reloadK = 0;
    this.deathDir = 1; this.vis = true;
  }
  setGun(id) {
    if (id === this.gunId) return;
    this.gunId = id;
    this.gunHolder.clear();
    if (!id) return;
    const g = buildGun(id, 'tp');
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunHolder.add(g);
  }
  // s: {speed, fwd, right, crouch, sprint, pitch, alive, downed, firing, reloading, ads}
  animate(dt, s) {
    const b = this.bones;
    const k = (t) => 1 - Math.exp(-dt * t);
    this.crouchK += ((s.crouch ? 1 : 0) - this.crouchK) * k(10);
    this.sprintK += ((s.sprint ? 1 : 0) - this.sprintK) * k(8);
    this.reloadK += ((s.reloading ? 1 : 0) - this.reloadK) * k(8);
    this.downK += ((s.downed ? 1 : 0) - this.downK) * k(4);
    if (s.firing) this.fireKick = 1;
    this.fireKick = Math.max(0, this.fireKick - dt * 8);
    for (const name in b) b[name].rotation.set(0, 0, 0);
    BONES.forEach(([name], i) => b[name].position.copy(this.rest[i]));
    const sp = s.speed;
    this.phase += dt * (sp > 0.3 ? 2.2 + sp * 1.05 : 0);
    const amp = Math.min(0.75, sp * 0.13) * (1 - this.crouchK * 0.4);
    const ph = this.phase;
    const fl = sp > 0.1 ? s.fwd : 1, rl = sp > 0.1 ? s.right : 0;
    const legSwing = (side) => {
      const p = ph + (side ? Math.PI : 0);
      const th = b[side ? 'thighR' : 'thighL'], sh = b[side ? 'shinR' : 'shinL'], ft = b[side ? 'footR' : 'footL'];
      th.rotation.x = Math.sin(p) * amp * fl + this.crouchK * 1.25;
      th.rotation.z = Math.sin(p) * amp * rl * 0.5;
      sh.rotation.x = -Math.max(0, Math.sin(p + 1.2)) * amp * 1.5 - this.crouchK * 2.0;
      ft.rotation.x = this.crouchK * 0.7 + Math.max(0, -Math.sin(p)) * amp * 0.4;
    };
    legSwing(0); legSwing(1);
    b.hips.position.y = this.rest[0].y - this.crouchK * 0.34 + Math.abs(Math.cos(ph)) * 0.035 * Math.min(1, sp / 3);
    b.hips.rotation.y = Math.sin(ph) * 0.08 * Math.min(1, sp / 4);
    const pitch = s.pitch || 0;
    b.spine.rotation.x = -this.sprintK * 0.22 - this.crouchK * 0.2 + pitch * 0.25;
    b.spine.rotation.y = -Math.sin(ph) * 0.06 * Math.min(1, sp / 4);
    b.chest.rotation.x = pitch * 0.45 - this.fireKick * 0.05 + this.crouchK * 0.15;
    b.head.rotation.x = pitch * 0.3 + this.sprintK * 0.15;
    b.neck.rotation.x = this.crouchK * 0.05;
    // arms: rifle ready pose (gun attached to chest) blended to sprint carry
    const sprint = this.sprintK;
    b.uarmR.rotation.set(0.75 - sprint * 0.35, 0, -0.08 - sprint * 0.05);
    b.farmR.rotation.set(1.05 + sprint * 0.35, 0.1, 0);
    b.handR.rotation.set(0.1, 0, 0);
    b.uarmL.rotation.set(1.25 - sprint * 0.3 - this.reloadK * 0.8, 0.0, 0.62 - this.reloadK * 0.35);
    b.farmL.rotation.set(0.38 + sprint * 0.4 + this.reloadK * 1.2, 0.35, 0.25);
    b.handL.rotation.set(0, 0, 0.2);
    this.gunHolder.rotation.set(sprint * -0.55, sprint * 0.6, sprint * 0.4);
    this.gunHolder.position.set(0.13 - sprint * 0.06, 0.04 - sprint * 0.08, -0.28 + sprint * 0.08);
    // downed: slumped on the ground, one arm on wound
    if (this.downK > 0.01 && this.deadT < 0) {
      const d = this.downK;
      b.hips.position.y = THREE.MathUtils.lerp(b.hips.position.y, 0.18, d);
      b.hips.rotation.x = -1.2 * d;
      b.thighL.rotation.x = THREE.MathUtils.lerp(b.thighL.rotation.x, 1.3, d); b.thighR.rotation.x = THREE.MathUtils.lerp(b.thighR.rotation.x, 0.5, d);
      b.shinL.rotation.x = THREE.MathUtils.lerp(b.shinL.rotation.x, -1.6, d); b.shinR.rotation.x = THREE.MathUtils.lerp(b.shinR.rotation.x, -0.3, d);
      b.spine.rotation.x = THREE.MathUtils.lerp(b.spine.rotation.x, 0.5, d);
      b.chest.rotation.x = THREE.MathUtils.lerp(b.chest.rotation.x, 0.3 + Math.sin(this.phase * 0.0 + performance.now() * 0.004) * 0.04, d);
      b.uarmL.rotation.set(0.6 * d, 0, 0.1); b.farmL.rotation.set(1.6 * d, 0, 0);
      b.uarmR.rotation.set(-0.2 * d, 0, 0.4 * d);
      this.gunHolder.visible = d < 0.5;
    } else this.gunHolder.visible = true;
    // death fall
    if (this.deadT >= 0) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.7);
      const e = t * t * (3 - 2 * t);
      const dir = this.deathDir;
      b.hips.position.y = THREE.MathUtils.lerp(this.rest[0].y, 0.16, e);
      b.hips.rotation.x = dir * 1.45 * e;
      b.hips.rotation.z = Math.sin(this.deathSeed || 1) * 0.3 * e;
      b.spine.rotation.x = dir * 0.25 * e; b.chest.rotation.x = dir * 0.1 * e;
      b.head.rotation.y = Math.sin((this.deathSeed || 1) * 3) * 0.8 * e; b.head.rotation.x = dir * 0.4 * e;
      b.thighL.rotation.x = -dir * 0.2 * e + 0.25; b.thighR.rotation.x = -dir * 0.1 * e - 0.1; b.thighL.rotation.z = -0.25 * e; b.thighR.rotation.z = 0.2 * e;
      b.shinL.rotation.x = -0.6 * e; b.shinR.rotation.x = -0.15 * e;
      b.uarmL.rotation.set(-dir * 0.8 * e, 0, 1.1 * e); b.uarmR.rotation.set(-dir * 0.5 * e, 0, -1.2 * e);
      b.farmL.rotation.set(0.4 * e, 0, 0); b.farmR.rotation.set(0.3 * e, 0, 0);
      this.gunHolder.visible = t < 0.25;
    }
  }
  die(fromBehind) {
    this.deadT = 0; this.deathDir = fromBehind ? -1 : 1; this.deathSeed = Math.random() * 10;
  }
  revive() { this.deadT = -1; }
}
