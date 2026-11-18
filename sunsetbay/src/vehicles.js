import * as THREE from 'three';
import { R, world, G, groups, colliderInfo } from './physics.js';
import { loadGLTF, scene, camera } from './render.js';
import { clamp, damp, lerp, pick, rnd } from './core.js';
import { TEX, groundHeight } from './world.js';
import { interp } from './state.js';

export const CARS = {
  bavaria: { file: 'cars/bavaria.glb', name: 'Bavaria 30', len: 4.36, paint: /PAINT/i, hide: /EMBLEM/i, head: /LENS/i, tail: /TAILLIGHT/i, wheel: /RIM|TIRE|Brake_disc|Brake_Disc|Calipers|Logo_Plane/i, mass: 1250, force: 8000, maxV: 52, grip: 2.2, colors: [0xb3141e, 0xe8e5dc, 0x1b1d22, 0x23395e, 0x6b7076, 0x2d5a3d, 0xc7b38a] },
  volt: { file: 'cars/volt.glb', name: 'Volt', len: 4.69, paint: /^primary/i, head: /front_light|head_l|foglight/i, tail: /rear_light|breaklight|tembus_red/i, wheel: /^hub_|wheels\.|hub_r|hub_l/i, wheelNode: /^hub_(rb|lb|rf|lf)/i, mass: 1600, force: 10500, maxV: 58, grip: 2.4, colors: [0xf2f2f0, 0x1a1c20, 0x7b8188, 0x2a3f74, 0xa01822, 0xd7d9db, 0x3a4a3f] },
  ferrari: { file: 'cars/ferrari.glb', name: 'Rosso 458', len: 4.53, paint: /Body_Color/i, hide: /Ferrari_Yellow/i, glass: /Glass_Gray/i, head: /Projector_Glass|Turn_Signal/i, tail: /Taillight/i, wheelNode: /^wheel_(fl|fr|rl|rr)$/i, mass: 1450, force: 15500, maxV: 82, grip: 2.7, colors: [0xc8101a, 0xffc61a, 0x111111, 0xf4f4f4, 0x1d4fd0, 0x0f7a3e] },
  aurora: { file: 'cars/aurora.glb', name: 'Aurora GT', len: 4.36, paint: /^Paint/i, glass: /^Glass$/i, head: /Headlight/i, tail: /Brakelight|Signallight/i, wheelNode: /^Wheel(Front|Rear)(L|R)$/, mass: 1350, force: 16500, maxV: 88, grip: 2.8, colors: [0x8b0f16, 0x0c0c0c, 0xe6e6e6, 0x1a3f8f, 0xff6a00, 0x2b2f35] },
};
export const TRAFFIC_TYPES = ['volt', 'volt', 'bavaria', 'bavaria', 'volt', 'bavaria', 'aurora', 'ferrari'];

const templates = new Map();
export const carReady = new Map();
const _box = new THREE.Box3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
export async function loadCar(type) {
  if (templates.has(type)) return templates.get(type);
  const C = CARS[type];
  const p = loadGLTF(C.file).then(g => { const t = normalizeCar(g.scene, C); carReady.set(type, t); return t; });
  templates.set(type, p); return p;
}
function matName(o) { return [].concat(o.material).map(m => m && m.name || '').join(' '); }
function normalizeCar(src, C) {
  const holder = new THREE.Group(); holder.add(src); holder.updateMatrixWorld(true);
  _box.setFromObject(src); const size = _box.getSize(new THREE.Vector3());
  if (size.x > size.z) { src.rotation.y += Math.PI / 2; holder.updateMatrixWorld(true); _box.setFromObject(src); _box.getSize(size); }
  const s = C.len / size.z; src.scale.multiplyScalar(s); holder.updateMatrixWorld(true);
  // front = side where headlights are
  let headZ = 0, nh = 0; src.traverse(o => { if (o.isMesh && C.head.test(matName(o) + ' ' + o.name)) { _box.setFromObject(o); headZ += _box.getCenter(_v).z; nh++; } });
  _box.setFromObject(src); const c0 = _box.getCenter(new THREE.Vector3());
  if (nh && headZ / nh < c0.z) { src.rotation.y += Math.PI; holder.updateMatrixWorld(true); }
  _box.setFromObject(src); const c = _box.getCenter(new THREE.Vector3());
  src.position.x -= c.x; src.position.z -= c.z; src.position.y -= _box.min.y; holder.updateMatrixWorld(true);
  _box.setFromObject(src); const dims = _box.getSize(new THREE.Vector3());
  // collect wheel parts
  const parts = [];
  if (C.wheelNode) src.traverse(o => { if (C.wheelNode.test(o.name)) parts.push(o); });
  if (!parts.length && C.wheel) src.traverse(o => { if (o.isMesh && C.wheel.test(matName(o) + ' ' + o.name)) parts.push(o); });
  const corners = { fl: [], fr: [], rl: [], rr: [] };
  for (const o of parts) { _box.setFromObject(o); _box.getCenter(_v); if (Math.abs(_v.z) < 0.2) continue; const k = (_v.z > 0 ? 'f' : 'r') + (_v.x > 0 ? 'l' : 'r'); corners[k].push(o); }
  const wheels = [];
  for (const k of ['fl', 'fr', 'rl', 'rr']) {
    const list = corners[k]; if (!list.length) continue;
    const b = new THREE.Box3(); list.forEach(o => b.expandByObject(o));
    const ctr = b.getCenter(new THREE.Vector3()), r = (b.max.y - b.min.y) / 2;
    const pivot = new THREE.Group(); pivot.name = 'pivot_' + k; pivot.position.copy(ctr); holder.add(pivot);
    const spin = new THREE.Group(); spin.name = 'spin_' + k; pivot.add(spin);
    holder.updateMatrixWorld(true);
    for (const o of list) spin.attach(o);
    unsteer(spin, list);
    wheels.push({ key: k, x: ctr.x, y: ctr.y, z: ctr.z, r: Math.max(0.25, ctr.y) });
  }
  // materials
  holder.traverse(o => {
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    const n = matName(o) + ' ' + o.name;
    if (C.hide && C.hide.test(n)) { o.visible = false; return; }
    for (const m of [].concat(o.material)) {
      if (!m) continue; m.envMapIntensity = 1.1;
      if ((C.glass && C.glass.test(m.name)) || m.transparent || (m.opacity !== undefined && m.opacity < 0.99) || /glass/i.test(m.name)) {
        m.transparent = true; m.opacity = Math.min(m.opacity || 1, 0.42); m.color.multiplyScalar(0.35); m.roughness = 0.04; m.metalness = 0.1; m.envMapIntensity = 1.6; m.depthWrite = false; o.castShadow = false; m.userData.glass = true;
      }
    }
    if (C.paint.test(n)) o.userData.paint = true;
    if (C.head.test(n)) o.userData.head = true;
    if (C.tail.test(n)) o.userData.tail = true;
  });
  return { holder, dims, wheels, C };
}

// some models ship with the front wheels turned: find the axle (direction of least spread) and straighten it
const _Y = new THREE.Vector3(0, 1, 0), _inv = new THREE.Matrix4();
function unsteer(spin, list) {
  spin.updateMatrixWorld(true); _inv.copy(spin.matrixWorld).invert();
  const pts = [];
  for (const o of list) o.traverse(m => {
    if (!m.isMesh) return; const pa = m.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 600));
    for (let i = 0; i < pa.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld).applyMatrix4(_inv));
  });
  if (pts.length < 20) return;
  let best = 0, bv = 1e9;
  for (let d = -50; d <= 50; d += 0.5) {
    const t = d * Math.PI / 180, ax = Math.cos(t), az = -Math.sin(t); let m = 0, m2 = 0;
    for (const p of pts) { const u = p.x * ax + p.z * az; m += u; m2 += u * u; }
    const v = m2 / pts.length - (m / pts.length) ** 2; if (v < bv) { bv = v; best = t; }
  }
  if (Math.abs(best) < 0.02) return;
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, -best);
  for (const o of list) { o.position.applyQuaternion(q); o.quaternion.premultiply(q); }
}
const PAINT_CACHE = new Map();
function paintMat(base, color) {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.2, normalMap: base.normalMap || null });
  return m;
}
let VID = 0;
export class Vehicle {
  constructor(tpl, type, opts = {}) {
    this.id = ++VID; this.type = type; this.C = CARS[type]; this.tpl = tpl; this.variant = opts.variant || null;
    this.mesh = tpl.holder.clone(true); scene.add(this.mesh);
    this.dims = tpl.dims; this.hlen = tpl.dims.z / 2; this.hwid = tpl.dims.x / 2; this.H = tpl.dims.y;
    const color = opts.color !== undefined ? opts.color : this.variant === 'police' ? 0xf1f1f1 : this.variant === 'taxi' ? 0xf2c21b : pick(this.C.colors);
    this.paint = paintMat({}, color); this.color = new THREE.Color(color);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xfff3dd, emissiveIntensity: 0.3, roughness: 0.1, metalness: 0.3 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550606, emissive: 0xff1810, emissiveIntensity: 0.4, roughness: 0.2 });
    this.mesh.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData.paint) o.material = this.paint;
      else if (o.userData.head) o.material = this.headMat;
      else if (o.userData.tail) o.material = this.tailMat;
    });
    this.pivots = {}; this.mesh.traverse(o => { if (o.name.startsWith('pivot_')) this.pivots[o.name.slice(6)] = o; });
    if (this.variant === 'police') this.addLightbar(); else if (this.variant === 'taxi') this.addTaxiSign();
    // headlight throw on the road
    const thr = new THREE.PlaneGeometry(5, 14); thr.rotateX(-Math.PI / 2); thr.translate(0, 0.03, 7 + this.hlen);
    this.throw = new THREE.Mesh(thr, THROW_MAT); this.mesh.add(this.throw); this.throw.visible = false;
    // physics
    this.hp = opts.hp || 1000; this.maxHp = this.hp; this.dead = false; this.fire = 0; this.mode = 'parked'; this.driver = null; this.isPlayer = false;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.hand = false; this.siren = false; this.lights = true; this.braking = false;
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.vx = 0; this.vz = 0; this.speedAbs = 0; this.fwdSpeed = 0; this.camDist = 999; this.air = 0;
    this.body = null; this.ctrl = null;
  }
  addLightbar() {
    const bar = new THREE.Group(); const y = this.H + 0.02;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.28), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.6 })); base.position.y = y; bar.add(base);
    this.sirR = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1020, emissiveIntensity: 0.2, roughness: 0.2 });
    this.sirB = new THREE.MeshStandardMaterial({ color: 0x000030, emissive: 0x1050ff, emissiveIntensity: 0.2, roughness: 0.2 });
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.sirR); l.position.set(-0.28, y + 0.1, 0); bar.add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.sirB); r.position.set(0.28, y + 0.1, 0); bar.add(r);
    bar.position.z = -0.25; this.mesh.add(bar);
    // dark lower door band
    const band = new THREE.Mesh(new THREE.BoxGeometry(this.dims.x * 1.005, 0.32, this.dims.z * 0.5), new THREE.MeshPhysicalMaterial({ color: 0x0f1d3a, clearcoat: 1, roughness: 0.3, metalness: 0.4 }));
    band.position.set(0, this.H * 0.42, -0.05); this.mesh.add(band);
  }
  addTaxiSign() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 40; const g = c.getContext('2d');
    g.fillStyle = '#ffd23a'; g.fillRect(0, 0, 128, 40); g.fillStyle = '#111'; g.font = '900 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 64, 21);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.signMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.2 });
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.2), this.signMat); s.position.set(0, this.H + 0.1, -0.2); this.mesh.add(s);
  }
  // ---- physics
  makeBody(kinematic) {
    const d = this.dims, mass = this.C.mass;
    const desc = (kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic()).setTranslation(this.x, this.y, this.z)
      .setRotation(yawQ(this.h)).setLinearDamping(0.05).setAngularDamping(0.8).setCcdEnabled(!kinematic);
    this.body = world.createRigidBody(desc);
    const hx = d.x / 2 - 0.06, hz = d.z / 2 - 0.05, bottom = 0.32, top = Math.min(d.y - 0.15, 1.25), hy = (top - bottom) / 2;
    const Ix = mass / 12 * (4 * hy * hy + 4 * hz * hz), Iy = mass / 12 * (4 * hx * hx + 4 * hz * hz), Iz = mass / 12 * (4 * hx * hx + 4 * hy * hy);
    const cd = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, bottom + hy, 0).setMassProperties(mass, { x: 0, y: 0.3, z: 0 }, { x: Ix, y: Iy, z: Iz }, { w: 1, x: 0, y: 0, z: 0 })
      .setFriction(0.5).setRestitution(0.1).setCollisionGroups(groups(G.CAR, G.STATIC | G.CAR | G.PROP | G.HUMAN))
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass * 18);
    this.collider = world.createCollider(cd, this.body);
    colliderInfo.set(this.collider.handle, { kind: 'car', ref: this });
    if (!kinematic) { this.makeController(); this.graceT = performance.now(); }
  }
  makeController() {
    if (this.ctrl) return;
    const ctrl = world.createVehicleController(this.body); this.ctrl = ctrl;
    const rest = 0.3;
    this.wheelDefs = [];
    for (const w of this.tpl.wheels) {
      const cy = w.y + rest * 0.75;
      ctrl.addWheel({ x: w.x, y: cy, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, w.r);
      this.wheelDefs.push({ ...w, cy });
    }
    for (let i = 0; i < ctrl.numWheels(); i++) {
      ctrl.setWheelSuspensionStiffness(i, 38); ctrl.setWheelSuspensionCompression(i, 2.6); ctrl.setWheelSuspensionRelaxation(i, 3.4);
      ctrl.setWheelMaxSuspensionTravel(i, 0.28); ctrl.setWheelMaxSuspensionForce(i, 1e5);
      ctrl.setWheelFrictionSlip(i, this.C.grip); ctrl.setWheelSideFrictionStiffness(i, 1.0);
    }
  }
  toDynamic(vx = 0, vz = 0) {
    if (!this.body) return; if (this.body.bodyType() === R.RigidBodyType.Dynamic) return;
    this.body.setBodyType(R.RigidBodyType.Dynamic, true); this.body.enableCcd(true); this.body.recomputeMassPropertiesFromColliders(); this.graceT = performance.now(); this.body.setTranslation({ x: this.x, y: Math.max(this.y, 0) + 0.05, z: this.z }, true);
    this.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    this.makeController();
  }
  place(x, z, h, y) {
    this.x = x; this.z = z; this.h = h; this.y = y !== undefined ? y : Math.max(0, groundHeight(x, z)); this.pP = null;
    if (this.body) { this.body.setTranslation({ x, y: this.y + 0.05, z }, true); this.body.setRotation(yawQ(h), true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    this.sync();
  }
  savePrev() { if (!this.body) return; const t = this.body.translation(), r = this.body.rotation(); this.pP = [t.x, t.y, t.z]; this.pQ = [r.x, r.y, r.z, r.w]; }
  get dynamic() { return this.body && this.body.bodyType() === R.RigidBodyType.Dynamic; }
  drive(dt) {
    const c = this.ctrl; if (!c || !this.dynamic) return;
    const fwd = this.fwdSpeed, sp = Math.abs(fwd), C = this.C;
    const dead = this.dead || this.drowned;
    let engine = 0, brake = 0;
    if (!dead) {
      if (this.throttle > 0) { if (fwd < -1) brake = 14 * this.throttle; else engine = C.force * this.throttle * clamp(1 - Math.pow(fwd / C.maxV, 2), 0, 1); }
      if (this.brake > 0) { if (fwd > 1) brake = 14 * this.brake; else engine = -C.force * 0.45 * this.brake * (fwd > -14 ? 1 : 0); }
      if (this.hp < this.maxHp * 0.2) engine *= 0.5;
    }
    if (!this.throttle && !this.brake) brake = 0.6;
    this.braking = brake > 5 && fwd > 1;
    const steerMax = lerp(0.6, 0.13, clamp(sp / 40, 0, 1));
    this.steerA = damp(this.steerA || 0, -this.steer * steerMax, 12, dt);
    for (let i = 0; i < c.numWheels(); i++) {
      const front = this.wheelDefs[i].key[0] === 'f';
      c.setWheelSteering(i, front ? this.steerA : 0);
      c.setWheelEngineForce(i, front ? engine * 0.2 : engine * 0.8);
      c.setWheelBrake(i, (this.hand && !front) ? 18 : brake);
      c.setWheelFrictionSlip(i, this.hand && !front ? C.grip * 0.45 : C.grip * (this.dead ? 0.6 : 1.5));
      c.setWheelSideFrictionStiffness(i, this.hand && !front ? 0.6 : 1.25);
    }
    c.updateVehicle(dt, undefined, groups(G.CAR, G.STATIC | G.CAR | G.PROP), this.collider ? (col => col.handle !== this.collider.handle) : undefined);
    // downforce + air control + self-righting
    const lv = this.body.linvel(), v2 = lv.x * lv.x + lv.z * lv.z;
    let inContact = 0; for (let i = 0; i < c.numWheels(); i++) if (c.wheelIsInContact(i)) inContact++;
    this.inContact = inContact;
    if (inContact) this.body.addForce({ x: 0, y: -v2 * 3.5, z: 0 }, true);
    if (inContact >= 3 && this.isPlayer) {
      // arcade assists: kill excess sideways slide (unless drifting on the handbrake), resist body roll, and help the car rotate into turns
      const r = this.body.rotation(); _q.set(r.x, r.y, r.z, r.w);
      const f = _v.set(0, 0, 1).applyQuaternion(_q), rt = _v2.set(1, 0, 0).applyQuaternion(_q);
      const lat = lv.x * rt.x + lv.z * rt.z, m = C.mass;
      const keep = this.hand ? 0.015 : 0.09; this.body.applyImpulse({ x: -rt.x * lat * m * keep, y: 0, z: -rt.z * lat * m * keep }, true);
      const up = _v3.set(0, 1, 0).applyQuaternion(_q), roll = f.x * (up.y * 0) + (up.x * f.z - up.z * f.x);
      const av = this.body.angvel(); this.body.setAngvel({ x: av.x * 0.97, y: av.y, z: av.z * 0.97 }, true);
      if (Math.abs(this.steer) < 0.05 && !this.hand) this.body.setAngvel({ x: av.x * 0.97, y: av.y * 0.94, z: av.z * 0.97 }, true);
    }
    if (!inContact) { this.air += dt; const av = this.body.angvel(); this.body.setAngvel({ x: av.x * 0.995, y: av.y + -this.steer * 1.5 * dt, z: av.z * 0.995 }, true); }
  }
  readBack(dt) {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation(), lv = this.body.linvel();
    this.x = t.x; this.y = t.y; this.z = t.z;
    _q.set(r.x, r.y, r.z, r.w); _v.set(0, 0, 1).applyQuaternion(_q); this.h = Math.atan2(_v.x, _v.z); this.fwdV = _v.clone();
    _v2.set(0, 1, 0).applyQuaternion(_q); this.upY = _v2.y;
    this.vx = lv.x; this.vz = lv.z; this.vy = lv.y; this.speedAbs = Math.hypot(lv.x, lv.z); this.fwdSpeed = lv.x * _v.x + lv.z * _v.z;
  }
  sync(dt = 0) {
    if (this.body) {
      const t = this.body.translation(), r = this.body.rotation(), a = interp.a;
      this.mesh.position.set(t.x, t.y, t.z); this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (this.pP && a < 1) { this.mesh.position.set(this.pP[0] + (t.x - this.pP[0]) * a, this.pP[1] + (t.y - this.pP[1]) * a, this.pP[2] + (t.z - this.pP[2]) * a); _q2.set(this.pQ[0], this.pQ[1], this.pQ[2], this.pQ[3]); this.mesh.quaternion.copy(_q2.slerp(this.mesh.quaternion, a)); }
    }
    else { this.mesh.position.set(this.x, this.y, this.z); this.mesh.rotation.set(0, this.h, 0); }
    // wheels
    const c = this.ctrl;
    for (const k in this.pivots) {
      const p = this.pivots[k], spin = p.children[0], i = this.wheelDefs ? this.wheelDefs.findIndex(w => w.key === k) : -1;
      if (c && this.dynamic && i >= 0) {
        const sl = c.wheelSuspensionLength(i) ?? 0.2; p.position.y = this.wheelDefs[i].cy - sl;
        p.rotation.y = c.wheelSteering(i) || 0; spin.rotation.x = c.wheelRotation(i) || 0;
      } else { spin.rotation.x += (this.fwdSpeed || 0) * dt / 0.34; if (k[0] === 'f') p.rotation.y = damp(p.rotation.y, (this.steerVis || 0), 8, dt); }
    }
    this.tailMat.emissiveIntensity = (this.braking ? 3.2 : 0.35 + (this.lights ? NIGHT.v * 1.6 : 0)) * (this.dead ? 0 : 1);
    this.headMat.emissiveIntensity = this.dead ? 0 : 0.2 + (this.lights ? NIGHT.v * 6 : 0);
    this.throw.visible = NIGHT.v > 0.25 && !this.dead && this.camDist < 140; if (this.throw.visible) this.throw.material.opacity = 0.35 * NIGHT.v;
    if (this.sirR) { const ph = Math.floor(performance.now() / 140) % 2; this.sirR.emissiveIntensity = this.siren ? (ph ? 7 : 0.2) : 0.2; this.sirB.emissiveIntensity = this.siren ? (ph ? 0.2 : 7) : 0.2; }
    if (this.signMat) this.signMat.emissiveIntensity = 0.2 + NIGHT.v * 1.5;
  }
  burnt() { this.paint.color.set(0x1b1917); this.paint.roughness = 0.95; this.paint.metalness = 0.2; this.paint.clearcoat = 0; }
  dispose() {
    scene.remove(this.mesh); this.paint.dispose(); this.headMat.dispose(); this.tailMat.dispose();
    if (this.ctrl) { world.removeVehicleController(this.ctrl); this.ctrl = null; }
    if (this.collider) colliderInfo.delete(this.collider.handle);
    if (this.body) { world.removeRigidBody(this.body); this.body = null; }
  }
}
export const NIGHT = { v: 0 };
const _q2 = new THREE.Quaternion();
const THROW_MAT = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4, fog: false });
export function initVehicleFX() { THROW_MAT.map = TEX.headThrow; THROW_MAT.needsUpdate = true; }
export function yawQ(h) { _q.setFromEuler(new THREE.Euler(0, h, 0)); return { x: _q.x, y: _q.y, z: _q.z, w: _q.w }; }
