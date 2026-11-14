import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PAINTS = [
  { id: 'orange', name: 'כתום קלאסי', color: 0xc24a08 },
  { id: 'white', name: 'לבן אלפיני', color: 0xe8e8e4 },
  { id: 'black', name: 'שחור לילה', color: 0x0c0c0e },
  { id: 'red', name: 'אדום מירוץ', color: 0xb00a14 },
  { id: 'blue', name: 'כחול מטאלי', color: 0x0b3a8f },
  { id: 'lime', name: 'ירוק ליים', color: 0x5fae12 },
  { id: 'purple', name: 'סגול ניאון', color: 0x5a1ca8 },
  { id: 'yellow', name: 'צהוב', color: 0xe0a800 },
];
export const SMOKES = [
  { id: 'white', name: 'לבן', color: 0xeeeeee },
  { id: 'pink', name: 'ורוד', color: 0xff5fb8 },
  { id: 'cyan', name: 'תכלת', color: 0x45d8ff },
  { id: 'green', name: 'ירוק', color: 0x5bff7a },
  { id: 'purple', name: 'סגול', color: 0xa46bff },
  { id: 'orange', name: 'כתום', color: 0xff9a3c },
];

// ------------------------------------------------------------------ model
export async function buildCarModel(gltf) {
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const root = new THREE.Group();       // positioned by physics (ground contact frame)
  const body = new THREE.Group();       // suspension roll / pitch
  root.add(body);

  const mats = {};
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xc24a08, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.07, envMapIntensity: 1.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.42, envMapIntensity: 1.6, depthWrite: false, clearcoat: 1 });
  const mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.0 });
  const lightsOn = { head: null, tail: null, reverse: null };

  function convert(m) {
    if (mats[m.uuid]) return mats[m.uuid];
    let out = m;
    const n = m.name || '';
    if (n === 'body' || n === 'body_2') out = paint;
    else if (n === 'chrome') out = chrome;
    else if (n === 'window' || n === 'glass') out = glass;
    else if (n.startsWith('mirror')) out = mirror;
    else {
      out = m.clone();
      if (out.transmission) out.transmission = 0;
      out.envMapIntensity = 1;
      if (n.startsWith('detail_glass')) { out.transparent = true; out.opacity = 0.55; out.depthWrite = false; out.roughness = 0.05; }
      if (n === 'head_light') { out.emissive = new THREE.Color(0xfff4e0); out.emissiveMap = out.map; out.emissiveIntensity = 0; lightsOn.head = out; }
      if (n === 'tail_light_lod0') { out.emissive = new THREE.Color(0xff1a10); out.emissiveMap = out.map; out.emissiveIntensity = 0.3; lightsOn.tail = out; }
      if (n === 'reverse_light_lod0') { out.emissive = new THREE.Color(0xffffff); out.emissiveMap = out.map; out.emissiveIntensity = 0; lightsOn.reverse = out; }
      if (n === 'tire') { out.roughness = 0.9; out.metalness = 0; }
      if (n === 'material') { out.metalness = 0.9; out.roughness = 0.25; }
      if (n === 'gauge_emissive') { out.emissive = new THREE.Color(0xffb060); out.emissiveMap = out.map; out.emissiveIntensity = 0.6; }
    }
    mats[m.uuid] = out;
    return out;
  }

  const wheelParts = []; const bodyParts = new Map();
  src.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    // de-quantize (meshopt / KHR_mesh_quantization) BEFORE transforming, so values are not clamped
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k];
      if (!(a.array instanceof Float32Array) || a.isInterleavedBufferAttribute || a.normalized) {
        const f = new Float32Array(a.count * a.itemSize);
        const get = ['getX', 'getY', 'getZ', 'getW'];
        for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a[get[j]](i);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
    const name = (o.name + ' ' + (o.parent ? o.parent.name : '')).toLowerCase();
    const mat = convert(o.material);
    if (/wheel_rim|wheel_wheel/.test(name) || name.includes('rotor') || name.includes('caliper')) {
      wheelParts.push({ g, mat, kind: name.includes('rotor') ? 'rotor' : name.includes('caliper') ? 'caliper' : 'wheel', tire: o.material.name === 'tire' });
    } else {
      if (!bodyParts.has(mat)) bodyParts.set(mat, []);
      bodyParts.get(mat).push(g);
    }
  });

  // ground level & wheel radius from tyre geometry
  const tb = new THREE.Box3();
  for (const p of wheelParts) if (p.tire) { p.g.computeBoundingBox(); tb.union(p.g.boundingBox); }
  const radius = (tb.max.y - tb.min.y) / 2;
  const groundY = tb.min.y;
  const wheelY = (tb.max.y + tb.min.y) / 2 - groundY;

  for (const [mat, gs] of bodyParts) {
    const g = mergeGeometries(gs, false);
    g.translate(0, -groundY, 0);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = false;
    if (mat.transparent) mesh.renderOrder = 2;
    body.add(mesh);
  }

  // split paired wheel meshes (both sides of an axle are one mesh in the source) into 4 wheels
  const wheels = [];
  const wheelDefs = [];
  function splitByX(g, positive) {
    const pos = g.attributes.position, idx = g.index.array;
    const keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cx = (pos.getX(idx[i]) + pos.getX(idx[i + 1]) + pos.getX(idx[i + 2])) / 3;
      if ((cx > 0) === positive) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const ng = g.clone(); ng.setIndex(keep); return ng;
  }
  for (const side of [true, false]) for (const front of [true, false]) {
    const parts = [];
    for (const p of wheelParts) {
      p.g.computeBoundingBox();
      const cz = (p.g.boundingBox.min.z + p.g.boundingBox.max.z) / 2;
      if ((cz > 0) !== front) continue;
      const g = splitByX(p.g, side);
      if (g.index.count === 0) continue;
      parts.push({ g, mat: p.mat, kind: p.kind, tire: p.tire });
    }
    const box = new THREE.Box3();
    for (const p of parts) if (p.tire) { p.g.computeBoundingBox(); box.union(p.g.boundingBox); }
    const c = box.getCenter(new THREE.Vector3());
    const steerPivot = new THREE.Group(); steerPivot.position.set(c.x, c.y - groundY, c.z);
    const spin = new THREE.Group(); steerPivot.add(spin);
    const byMat = new Map();
    for (const p of parts) {
      p.g.translate(-c.x, -c.y, -c.z);
      const target = p.kind === 'caliper' ? 'cal' : 'spin';
      const key = p.mat.uuid + target;
      if (!byMat.has(key)) byMat.set(key, { mat: p.mat, target, gs: [] });
      byMat.get(key).gs.push(p.g);
    }
    for (const { mat, target, gs } of byMat.values()) {
      const m = new THREE.Mesh(mergeGeometries(gs, false), mat);
      m.castShadow = true;
      (target === 'cal' ? steerPivot : spin).add(m);
    }
    root.add(steerPivot);
    wheels.push({ pivot: steerPivot, spin, front, left: side, base: steerPivot.position.clone() });
    wheelDefs.push({ x: c.x, z: c.z, front });
  }

  // geometry facts for physics / fx (car faces +Z, left side is +X)
  const bb = new THREE.Box3().setFromObject(body);
  const info = {
    radius, wheelY,
    halfWidth: (bb.max.x - bb.min.x) / 2,
    front: bb.max.z, rear: bb.min.z, height: bb.max.y,
    axleF: wheelDefs.find(w => w.front).z, axleR: wheelDefs.find(w => !w.front).z,
    track: Math.abs(wheelDefs[0].x) * 2,
    exhaust: new THREE.Vector3(0.56, 0.14, bb.min.z + 0.02),
    headL: new THREE.Vector3(0.55, 0.40, bb.max.z - 0.05), headR: new THREE.Vector3(-0.55, 0.40, bb.max.z - 0.05),
    tailL: new THREE.Vector3(0.52, 0.40, bb.min.z + 0.08), tailR: new THREE.Vector3(-0.52, 0.40, bb.min.z + 0.08),
  };

  // soft contact shadow (works even with shadows disabled)
  const cs = document.createElement('canvas'); cs.width = cs.height = 128;
  const cx = cs.getContext('2d');
  const grd = cx.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(info.halfWidth * 2 + 0.9, info.front - info.rear + 1.0),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cs), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(0, 0.03, (info.front + info.rear) / 2);
  contact.renderOrder = 1;
  root.add(contact);

  return { root, body, wheels, paint, glass, lights: lightsOn, info, contact };
}

// ------------------------------------------------------------------ physics
const G = 9.81;
const GEARS = [3.35, 2.15, 1.55, 1.18, 0.94, 0.78];
const FINAL = 3.7, REDLINE = 7600, IDLE = 950;

function torqueCurve(rpm) {
  const x = Math.min(1, Math.max(0, (rpm - 1000) / 6400));
  return 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, x * 1.15)) + (x > 0.85 ? -0.15 * (x - 0.85) / 0.15 : 0);
}

const DEFAULT_TUNE = {
  traction: 1.45,                     // drive grip (x g)
  aLim: 20, aMax: 30, aSlide: 24,     // sideways acceleration (m/s^2): grip limit, what full steering asks for, path tightness while sliding
  rMin: 5.5,                          // tightest turning radius (m) at low speed
  hyst: 0.6,                          // already sliding: the grip limit drops to this share (easier to stay in the slide)
  hbGrip: 0.25, hbBrake: 0.3,         // handbrake: share of grip left, and drag
  betaMax: 0.78, kp: 12, kd: 7, maxAcc: 14, bRate: 0.95, bRelease: 0.55, kickUp: 1.5, kickDown: 0.9,   // slide angle: max (rad), spring, damper, max angular acceleration
  scrub: 0.3,                         // speed lost to sliding sideways
  slideDrive: 0.45,                   // power lost while sliding
};

export class CarPhysics {
  constructor(info, grid, spec = {}) {
    this.grid = grid;
    this.cgZ = 0.05;                        // CG location along body z
    this.h = 0.48;
    this.maxTorque = 680; this.m = 1180;
    this.tune = { ...DEFAULT_TUNE };
    this.driftW = 0; this._thr = 0; this._hb = 0; this._phi = 0; this._wv = 0; this._ref = 0; this._bt = 0; this._kick = 0;
    this.setCar(info, spec);
    this.assist = 0.65;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();         // world x,z
    this.heading = 0; this.yawRate = 0;
    this.vy = 0; this.air = false; this.airTime = 0;
    this.steerAngle = 0;
    this.gear = 1; this.rpm = IDLE; this.shiftTimer = 0; this.clutch = 1;
    this.ax = 0; this.ay = 0;
    this.wheelSpin = [0, 0, 0, 0]; this.wheelRot = [0, 0, 0, 0];
    this.rearSlip = 0; this.frontSlip = 0; this.spinRatio = 0;
    this.pitch = 0; this.roll = 0; this.visPitch = 0; this.visRoll = 0; this.visPitchV = 0; this.visRollV = 0;
    this.nitro = 1; this.nitroOn = false;
    this.events = [];
    this.limiter = false; this.reverse = false;
    this._g = { x: 0, y: 0 };
    this.frozen = false;
  }

  // apply a car model's measurements and its handling character
  setCar(info, spec = {}) {
    this.info = info;
    this.a = info.axleF - 0.05;            // CG -> front axle
    this.b = -info.axleR + 0.05;           // CG -> rear axle
    this.L = this.a + this.b;
    this.R = info.radius;
    this.m = spec.mass ?? 1180;
    this.maxTorque = spec.torque ?? 680;
    this.I = this.m * 1.3;                 // yaw inertia (used by wall collisions)
    this.tune = Object.assign({ ...DEFAULT_TUNE }, spec.tune || {});
  }

  place(x, z, heading) {
    this.pos.set(x, this.grid.height(x, z), z);
    this.heading = heading; this.vel.set(0, 0); this.yawRate = 0; this.vy = 0;
    this.steerAngle = 0; this.gear = 1; this.rpm = IDLE; this.air = false;
    this.visPitch = this.visRoll = this.visPitchV = this.visRollV = 0;
  }

  get speed() { return this.vel.length(); }
  get forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }
  get driftAngle() { // body slip angle, degrees, signed
    const f = this.forward; const sp = this.speed;
    if (sp < 1) return 0;
    const vx = this.vel.x * f.x + this.vel.y * f.z;
    const vy = this.vel.x * -f.z + this.vel.y * f.x; // rightward component
    return Math.atan2(vy, Math.abs(vx)) * 180 / Math.PI * (vx < 0 ? -1 : 1);
  }

  step(dt, inp) {
    const T = this.tune;
    if (this.frozen) { this.vel.set(0, 0); this.yawRate = 0; this.rpm += ((IDLE + inp.throttle * 5500) - this.rpm) * Math.min(1, dt * 6); this.limiter = this.rpm > REDLINE - 200; return; }
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const fx = sh, fz = ch;           // forward
    const rx = -ch, rz = sh;          // right
    let vx = this.vel.x * fx + this.vel.y * fz;     // forward speed
    let vy = this.vel.x * rx + this.vel.y * rz;     // right speed
    const speed = Math.hypot(vx, vy);
    const ground = !this.air;
    const A = this.assist;            // 0.3 pro ... 0.95 easy
    const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, sstep = THREE.MathUtils.smoothstep;
    const clamp01 = x => Math.min(1, Math.max(0, x));
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

    // ---------- reverse logic
    if (inp.brake > 0.1 && vx < 0.6 && inp.throttle < 0.1) this.reverse = true;
    if (inp.throttle > 0.1 && this.reverse && vx > -1.5) this.reverse = false;
    if (this.reverse && inp.brake < 0.1 && vx > -0.3) this.reverse = vx < -0.3;
    const thrRaw = this.reverse ? inp.brake : inp.throttle;
    const brk = this.reverse ? inp.throttle : inp.brake;
    // pedals are smoothed so a keyboard feels like a foot, not a switch
    this._thr += clamp(thrRaw - this._thr, -dt * 9, dt * 4.5);
    this._hb += (inp.handbrake - this._hb) * Math.min(1, dt * 18);
    const thr = this._thr;
    const s = inp.steer;              // + = left
    const sgn = Math.sign(s), absS = Math.abs(s);

    // slide angle: how far the nose points away from the direction of travel (+ = nose to the left)
    const fwd = ground && !this.reverse && vx > 1.5;
    const phi = Math.atan2(this.vel.x, this.vel.y);
    const beta = fwd ? wrap(this.heading - phi) : 0;
    this.driftW = sstep(Math.abs(beta), 0.1, 0.45);

    // ---------- load transfer + traction
    const Wr0 = this.m * G * this.a / this.L;
    const Fzr = Math.max(this.m * G * 0.15, Wr0 + this.m * this.ax * this.h / this.L);
    const maxR = T.traction * (1 + Math.min(speed, 55) / 140) * Fzr;

    // ---------- engine / gearbox
    const gr = this.reverse ? -3.2 : GEARS[this.gear - 1];
    const wheelRpm = Math.abs(vx) / this.R * 60 / (2 * Math.PI);
    let rpmFromWheels = wheelRpm * Math.abs(gr) * FINAL;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (!this.reverse && this.shiftTimer <= 0) {
      if (this.rpm > REDLINE - 350 && this.gear < GEARS.length && this.spinRatio < 0.5 && thr > 0.2) { this.gear++; this.shiftTimer = 0.26; this.events.push('shift'); }
      else if (this.gear > 1 && speed * 60 / (2 * Math.PI * this.R) * Math.abs(gr) * FINAL < 3300) { this.gear--; this.shiftTimer = 0.16; if (thr < 0.2) this.events.push('backfire'); }
    }
    if (this.reverse) this.gear = 1;
    const launch = IDLE + thr * 4200;
    const spinRpm = rpmFromWheels * (1 + this.spinRatio * 0.9);
    let targetRpm = Math.max(spinRpm, this.gear === 1 && speed < 9 ? launch : IDLE);
    if (!ground) targetRpm = IDLE + thr * 6800;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * (ground ? 14 : 6));
    this.limiter = false;
    if (this.rpm > REDLINE) { this.rpm = REDLINE - 150 * Math.random(); this.limiter = true; }
    let engine = 0;
    if (this.shiftTimer <= 0 && !this.limiter) engine = thr * this.maxTorque * torqueCurve(this.rpm) * gr * FINAL * 0.86 / this.R;
    if (this.nitroOn && !this.reverse) engine += 7500;
    if (this.reverse && vx < -7) engine = 0;      // reverse top speed
    let FxR = engine;
    let spin = 0;
    if (Math.abs(FxR) > maxR * 0.92 && engine !== 0) spin = Math.min(1, (Math.abs(FxR) - maxR * 0.92) / (maxR * 0.9));
    this.spinRatio += (spin - this.spinRatio) * Math.min(1, dt * 8);
    if (engine !== 0) FxR *= 1 - T.slideDrive * this.driftW;   // a car sliding sideways cannot also put all its power down
    FxR = clamp(FxR, -maxR * 0.98, maxR * 0.98);
    const brakeF = brk > 0 && Math.abs(vx) > 0.3 ? 12500 * brk : 0;

    // ---------- what the player is asking for
    // Steering decides how tightly the car's PATH curves. Gas and handbrake decide the SLIDE ANGLE.
    const slideBias = Math.abs(beta) > 0.22 ? T.hyst : 1;                 // once sliding, it is easier to stay sliding
    const aLim = T.aLim * (1 + Math.min(speed, 60) / 150) * slideBias * (1 - (1 - T.hbGrip) * this._hb);
    const aCmd = absS * Math.min(speed * speed / T.rMin, T.aMax);          // sideways acceleration requested
    const excess = Math.max(0, aCmd / aLim - 1);
    const hbKick = this._hb * (absS > 0.12 ? 1 : 0);
    const gas = Math.abs(beta) > 0.22 ? Math.max(clamp01(thr * 1.25), 0.45) : clamp01(thr * 1.25);   // lifting off narrows a slide, it does not end it
    const kick = clamp01(Math.max(sstep(excess, 0, 0.3) * gas, hbKick));   // 0 = grip, 1 = full slide
    this._kick += clamp(kick - this._kick, -dt * T.kickDown, dt * T.kickUp * (1 + this._hb));   // entering and leaving a slide is gradual
    const kickS = this._kick;
    const bMax = T.betaMax * (0.55 + 0.45 * thr);                          // more gas = wider angle
    const btWant = sgn * kickS * bMax * (0.55 + 0.45 * absS);               // target slide angle
    const growing = Math.abs(btWant) > Math.abs(this._bt) && Math.sign(btWant) === (Math.sign(this._bt) || Math.sign(btWant));
    const bRate = (growing ? T.bRate : T.bRelease) * (1 + this._hb);
    this._bt += clamp(btWant - this._bt, -dt * bRate, dt * bRate);   // the angle builds and fades progressively
    const bt = this._bt;
    const aTarget = lerp(Math.min(aCmd, aLim), Math.min(aCmd, T.aSlide), kickS);
    const wvT = fwd ? sgn * aTarget / Math.max(speed, 3) : 0;            // target rotation rate of the direction of travel
    this._wv += (wvT - this._wv) * Math.min(1, dt / (Math.abs(wvT) < Math.abs(this._wv) ? lerp(0.12, 0.45, kickS) : lerp(0.08, 0.2, kickS)));   // letting go of the wheel eases the path straight

    // slide angle spring-damper: smooth, no snapping
    let bd = this.yawRate - this._wv;
    bd += clamp(-T.kp * (beta - bt) - T.kd * bd, -T.maxAcc, T.maxAcc) * dt;
    const yawP = this._wv + bd;

    // low speed / reverse: plain kinematic steering
    const lockV = lerp(0.6, 0.22, clamp01((speed - 4) / 32));
    const yawK = clamp(vx * Math.tan(s * 0.55) / this.L, -1.8, 1.8);
    const kb = fwd ? sstep(speed, 3, 8) : 0;
    if (ground) this.yawRate = lerp(yawK, yawP, kb); else this.yawRate *= 1 - Math.min(1, dt * 0.4);
    const headingNew = this.heading + this.yawRate * dt;

    // ---------- longitudinal: forces along the direction of travel
    const gx0 = this.grid.height(this.pos.x + fx * 1.2, this.pos.z + fz * 1.2) - this.grid.height(this.pos.x - fx * 1.2, this.pos.z - fz * 1.2);
    const slope = ground ? G * clamp(gx0 / 2.4, -0.3, 0.3) : 0;
    const drag = (0.5 * speed * speed + 14 * speed) / this.m;
    const hbDrag = vx > 1 ? T.hbBrake * maxR * this._hb / this.m : 0;
    let aLong;
    if (ground) {
      // particle model: speed scalar along the velocity vector, which rotates at _wv
      const cb = Math.cos(beta);
      const aEng = FxR / this.m * (fwd ? Math.max(0.2, cb) : 1);
      const scrub = T.scrub * G * Math.abs(Math.sin(beta)) * (fwd ? 1 : 0);
      const aBrake = brakeF / this.m;
      aLong = aEng - drag * Math.sign(vx || 1) - aBrake * Math.sign(vx || 1) - hbDrag - scrub - 0.04 * aTarget - slope;
      if (!fwd) aLong = aEng - (drag + aBrake) * Math.sign(vx || 1) - hbDrag - slope;
      // (a) particle result (moving forward)
      let sp = Math.max(0, speed + aLong * dt);
      const rot = this._wv * dt;
      const cR = Math.cos(rot), sR = Math.sin(rot);
      let nx = (this.vel.x * cR + this.vel.y * sR), nz = (this.vel.y * cR - this.vel.x * sR);
      const nl = Math.hypot(nx, nz) || 1;
      const pvx = nx / nl * sp, pvz = nz / nl * sp;
      // (b) kinematic result: the car goes where the nose points
      let uK = vx + (FxR / this.m - (drag + aBrake) * Math.sign(vx || 1) - hbDrag * Math.sign(vx || 1) - slope) * dt;
      if (Math.abs(vx) < 0.4 && thr < 0.05 && brk < 0.05) uK *= 1 - Math.min(1, dt * 5);
      if (!this.reverse && uK < 0 && vx >= 0) uK = 0;
      const vK = vy * (1 - Math.min(1, dt * 9));
      const chN = Math.cos(headingNew), shN = Math.sin(headingNew);
      const kvx = uK * shN + vK * -chN, kvz = uK * chN + vK * shN;
      this.vel.set(lerp(kvx, pvx, kb), lerp(kvz, pvz, kb));
      const aLongV = fwd ? aLong : (FxR / this.m - (drag + aBrake) * Math.sign(vx || 1));
      this.ax += (aLongV - this.ax) * Math.min(1, dt * 10);
      this.ay += (-(vx * this.yawRate * (1 - kb) + speed * this._wv * kb) - this.ay) * Math.min(1, dt * 10);
    } else {
      this.vel.x -= this.vel.x * 0.02 * dt; this.vel.y -= this.vel.y * 0.02 * dt;
    }
    vx = this.vel.x * Math.sin(headingNew) + this.vel.y * Math.cos(headingNew);
    this.heading = headingNew;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;

    // ---------- front wheels (visual): lock into the turn, and counter-steer automatically while sliding
    const dTarget = lerp(s * lockV, clamp(-beta * 1.05 + s * 0.2, -0.9, 0.9), this.driftW);
    this.steerAngle += clamp(dTarget - this.steerAngle, -dt * 9, dt * 9);
    // smoke / skid amounts
    this.frontSlip = Math.max(0, aCmd / Math.max(T.aLim, 1) - 1) * 0.5;
    this.rearSlip = Math.abs(beta) * 1.3 + this.spinRatio * 0.6 + kickS * 0.25 + (this._hb > 0.5 && speed > 3 ? 0.4 : 0);

    // ---------- vertical
    const g = this.groundSample();
    if (this.air) {
      this.vy -= G * dt; this.pos.y += this.vy * dt; this.airTime += dt;
      if (this.pos.y <= g.y) { this.pos.y = g.y; if (this.vy < -3) this.events.push({ land: -this.vy }); this.vy = 0; this.air = false; this.airTime = 0; }
    } else {
      const prevY = this.pos.y;
      const rate = (g.y - prevY) / dt;
      if (g.y < prevY - 0.25 && this.vy > -1) { this.air = true; this.vy = Math.max(this.vy, 0); }
      else { this.vy = THREE.MathUtils.clamp(rate, -15, 15); this.pos.y = g.y; }
    }
    if (this.air && this.pos.y < g.y) this.pos.y = g.y;
    this.pitch += (g.pitch - this.pitch) * Math.min(1, dt * 12);
    this.roll += (g.roll - this.roll) * Math.min(1, dt * 12);

    // ---------- collisions vs walls (signed distance field)
    this.collide(dt);

    // ---------- visual suspension springs
    const tp = THREE.MathUtils.clamp(-this.ax * 0.006, -0.06, 0.06), tr = THREE.MathUtils.clamp(this.ay * 0.0075, -0.07, 0.07);
    this.visPitchV += ((tp - this.visPitch) * 120 - this.visPitchV * 14) * dt; this.visPitch += this.visPitchV * dt;
    this.visRollV += ((tr - this.visRoll) * 110 - this.visRollV * 12) * dt; this.visRoll += this.visRollV * dt;

    // wheels
    const wf = vx / this.R;
    const wr = wf + (this.spinRatio > 0.05 ? Math.sign(engine || 1) * this.spinRatio * 70 : 0);
    const lockR = inp.handbrake && speed > 1;
    this.wheelSpin = [wf, wf, lockR ? 0 : wr, lockR ? 0 : wr];
    for (let i = 0; i < 4; i++) this.wheelRot[i] += this.wheelSpin[i] * dt;

    // nitro
    if (inp.nitro && this.nitro > 0.02 && thr > 0.1 && !this.reverse) { this.nitroOn = true; this.nitro = Math.max(0, this.nitro - dt * 0.22); }
    else this.nitroOn = false;
  }

  groundSample() {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const af = this.info.axleF, ar = this.info.axleR, t = this.info.track / 2;
    const pt = (lz, lx) => this.grid.height(this.pos.x + sh * lz - ch * -lx, this.pos.z + ch * lz + sh * -lx);
    const fl = pt(af, t), fr = pt(af, -t), rl = pt(ar, t), rr = pt(ar, -t);
    const front = (fl + fr) / 2, rear = (rl + rr) / 2, left = (fl + rl) / 2, right = (fr + rr) / 2;
    const y = Math.max((front + rear) / 2, Math.max(fl, fr, rl, rr) - 0.12);
    return { y, pitch: Math.atan2(front - rear, af - ar), roll: Math.atan2(left - right, this.info.track) };
  }

  collide(dt) {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const hw = this.info.halfWidth - 0.04, fr = this.info.front - 0.1, re = this.info.rear + 0.1;
    const pts = [[fr, hw], [fr, -hw], [re, hw], [re, -hw], [fr, 0], [re, 0], [(fr + re) / 2, hw], [(fr + re) / 2, -hw], [fr * 0.5, hw], [fr * 0.5, -hw], [re * 0.5, hw], [re * 0.5, -hw]];
    let hit = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const [lz, lx] of pts) {
        const ox = sh * lz + ch * lx, oz = ch * lz - sh * lx; // left(+x local) maps to -right
        const px = this.pos.x + ox, pz = this.pos.z + oz;
        const s = this.grid.sdf(px, pz);
        const margin = 0.05;
        if (s >= margin) continue;
        const n = this.grid.grad(px, pz, this._g);
        const pen = margin - s;
        this.pos.x += n.x * pen * 0.9; this.pos.z += n.y * pen * 0.9;
        // velocity of contact point
        const cvx = this.vel.x + this.yawRate * oz, cvz = this.vel.y - this.yawRate * ox;
        const vn = cvx * n.x + cvz * n.y;
        if (vn < 0) {
          const e = 0.25;
          const rn = ox * n.y - oz * n.x; // r x n (2D, y-up sign convention)
          const invM = 1 / this.m, invI = 1 / this.I;
          const j = -(1 + e) * vn / (invM + rn * rn * invI * 1.0);
          this.vel.x += j * n.x * invM; this.vel.y += j * n.y * invM;
          this.yawRate -= j * rn * invI * 0.6;
          // tangential friction
          const tx = -n.y, tz = n.x;
          const vt = cvx * tx + cvz * tz;
          const jt = THREE.MathUtils.clamp(-vt * this.m * 0.3, -Math.abs(j) * 0.4, Math.abs(j) * 0.4);
          this.vel.x += jt * tx * invM; this.vel.y += jt * tz * invM;
          hit = Math.max(hit, -vn);
          this._lastHitPoint = { x: px, z: pz, nx: n.x, nz: n.y };
        }
      }
    }
    if (hit > 1.2) this.events.push({ hit, at: this._lastHitPoint });
    else if (hit > 0.2) this.events.push({ scrape: hit, at: this._lastHitPoint });
  }

  // min distance to walls around the rear (for "close call" bonus)
  rearClearance() {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const re = this.info.rear - 0.2, hw = this.info.halfWidth + 0.1;
    let m = 99;
    for (const [lz, lx] of [[re, hw], [re, -hw], [re, 0], [re * 0.5, hw], [re * 0.5, -hw]]) {
      m = Math.min(m, this.grid.sdf(this.pos.x + sh * lz + ch * lx, this.pos.z + ch * lz - sh * lx));
    }
    return m;
  }
}
