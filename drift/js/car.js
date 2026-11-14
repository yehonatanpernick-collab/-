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
    if (name.includes('wheel_rim') || name.includes('rotor') || name.includes('caliper')) {
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

export class CarPhysics {
  constructor(info, grid) {
    this.grid = grid;
    this.info = info;
    this.m = 1180;
    this.a = info.axleF - 0.05;            // CG -> front axle
    this.b = -info.axleR + 0.05;           // CG -> rear axle
    this.cgZ = 0.05;                        // CG location along body z
    this.L = this.a + this.b;
    this.I = this.m * 1.55;
    this.h = 0.48;
    this.R = info.radius;
    this.maxTorque = 680;
    this.tune = { align: 0.12, rearMin: 0.22, rearFx: 1.0, spinLoss: 0.35, cs: 1.0, hb: 0.35, kick: 0.75, bt: 0.74, kb: 6, grip: 2.0, turn: 1.0 };
    this._phi = 0; this._wv = 0; this.driftW = 0;
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

    // ---------- steering (speed sensitive + counter-steer assist)
    const beta = speed > 1.5 ? Math.atan2(vy, Math.abs(vx)) : 0;
    const maxIn = THREE.MathUtils.lerp(0.74, 0.32, Math.min(1, speed / 45));
    let target = inp.steer * maxIn;
    if (vx > 2) target += -beta * this.assist * this.tune.cs * (1 - Math.abs(inp.steer) * 0.35);
    target = THREE.MathUtils.clamp(target, -0.85, 0.85);
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -dt * 11, dt * 11);
    const d = this.steerAngle;

    // ---------- reverse logic
    if (inp.brake > 0.1 && vx < 0.6 && inp.throttle < 0.1) this.reverse = true;
    if (inp.throttle > 0.1 && this.reverse && vx > -1.5) this.reverse = false;
    if (this.reverse && inp.brake < 0.1 && vx > -0.3) this.reverse = vx < -0.3;
    const thr = this.reverse ? inp.brake : inp.throttle;
    const brk = this.reverse ? inp.throttle : inp.brake;

    // ---------- load transfer
    const Wf0 = this.m * G * this.b / this.L, Wr0 = this.m * G * this.a / this.L;
    const dW = this.m * this.ax * this.h / this.L;
    const Fzf = Math.max(this.m * G * 0.15, Wf0 - dW), Fzr = Math.max(this.m * G * 0.15, Wr0 + dW);
    const mu = this.tune.grip * (1 + Math.min(speed, 55) / 120);

    // ---------- engine / gearbox
    const gr = this.reverse ? -3.2 : GEARS[this.gear - 1];
    const wheelRpm = Math.abs(vx) / this.R * 60 / (2 * Math.PI);
    let rpmFromWheels = wheelRpm * Math.abs(gr) * FINAL;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (!this.reverse && this.shiftTimer <= 0) {
      if (this.rpm > REDLINE - 350 && this.gear < GEARS.length && this.spinRatio < 0.5 && thr > 0.2) { this.gear++; this.shiftTimer = 0.28; this.events.push('shift'); }
      else if (this.gear > 1 && speed * 60 / (2 * Math.PI * this.R) * Math.abs(gr) * FINAL < 3300 && Math.abs(beta) < 0.3) { this.gear--; this.shiftTimer = 0.18; if (thr < 0.2) this.events.push('backfire'); }
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

    // ---------- tyres
    // rear longitudinal: drive or brake
    const rollDir = Math.sign(vx) || 1;
    let FxR = engine;
    let FxF = 0;
    if (brk > 0) {
      const B = 12500 * brk;
      if (Math.abs(vx) > 0.3) { FxF -= rollDir * B * 0.62; FxR -= rollDir * B * 0.38; }
      else { vx *= 0.8; }
    }
    if (inp.handbrake) FxR -= rollDir * Math.min(Fzr * mu * 0.8, Math.abs(vx) * 2500);
    const maxR = mu * Fzr, maxF = mu * Fzf;
    // wheelspin
    let spin = 0;
    if (Math.abs(FxR) > maxR * 0.92 && engine !== 0) spin = Math.min(1, (Math.abs(FxR) - maxR * 0.92) / (maxR * 0.9));
    this.spinRatio += (spin - this.spinRatio) * Math.min(1, dt * 8);
    FxR = THREE.MathUtils.clamp(FxR, -maxR * 0.98, maxR * 0.98);
    FxF = THREE.MathUtils.clamp(FxF, -maxF * 0.95, maxF * 0.95);

    // lateral
    const vyF = vy - this.yawRate * this.a;
    const vyR = vy + this.yawRate * this.b;
    const sd = Math.sin(d), cd = Math.cos(d);
    const vlatF = vx * sd + vyF * cd;
    const vlongF = vx * cd - vyF * sd;
    const minV = 4;
    const alphaF = Math.atan2(vlatF, Math.max(Math.abs(vlongF), minV));
    const alphaR = Math.atan2(vyR, Math.max(Math.abs(vx), minV));
    const CF = 125000, CR = 130000;
    const tyre = (alpha, C, max) => {
      const lin = -C * alpha;
      const peak = max / C;
      const a = Math.abs(alpha);
      if (a <= peak) return lin;
      const fall = 1 - 0.22 * Math.min(1, (a - peak) / 0.5);
      return -Math.sign(alpha) * max * fall;
    };
    let latAvailR = maxR * Math.sqrt(Math.max(T.rearMin, 1 - (FxR / maxR) ** 2 * T.rearFx));
    latAvailR *= 1 - this.spinRatio * T.spinLoss;
    if (inp.handbrake) latAvailR *= T.hb;
    // power-oversteer feel: hard lock + throttle at speed loosens the rear (weight transfer / clutch-kick style)
    const lock = Math.min(1, Math.max(0, Math.abs(inp.steer) - 0.3) / 0.4);
    if (thr > 0.55 && speed > 9 && !this.reverse) latAvailR *= 1 - T.kick * lock * Math.min(1, (speed - 9) / 6) * thr;
    const latAvailF = maxF * Math.sqrt(Math.max(0.3, 1 - (FxF / maxF) ** 2));
    let FyF = tyre(alphaF, CF, latAvailF);
    let FyR = tyre(alphaR, CR, latAvailR);
    this.frontSlip = Math.abs(alphaF);
    this.rearSlip = Math.abs(alphaR) + this.spinRatio * 0.6 + (inp.handbrake && speed > 3 ? 0.4 : 0);

    // car frame forces (forward, right)
    let Fx = FxR + FxF * cd - FyF * sd;
    let Fy = FyR + FxF * sd + FyF * cd;
    // aero + rolling
    Fx -= 0.5 * vx * Math.abs(vx) + 14 * vx;
    Fy -= 0.6 * vy * Math.abs(vy) * 0.2;
    // slope (gravity along surface)
    const gx0 = this.grid.height(this.pos.x + fx * 1.2, this.pos.z + fz * 1.2) - this.grid.height(this.pos.x - fx * 1.2, this.pos.z - fz * 1.2);
    if (ground) Fx -= this.m * G * THREE.MathUtils.clamp(gx0 / 2.4, -0.3, 0.3);

    let torque = 0;
    if (ground) {
      torque = -this.a * (FyF * cd + FxF * sd) + this.b * FyR;
    } else { Fx = -0.42 * vx * Math.abs(vx); Fy = 0; }

    // integrate
    const axl = Fx / this.m, ayl = Fy / this.m;
    this.ax += (axl - this.ax) * Math.min(1, dt * 10);
    this.ay += (ayl - this.ay) * Math.min(1, dt * 10);
    vx += axl * dt; vy += ayl * dt;
    this.yawRate += torque / this.I * dt;
    // stability: yaw damping, mild when sliding so drifts are sustainable
    this.yawRate *= 1 - Math.min(1, dt * (ground ? 0.9 : 0.4));
    // low speed: blend to kinematic bicycle model (stops jitter, allows parking-lot turns)
    if (ground && speed < 6) {
      const k = 1 - speed / 6;
      const kin = vx * Math.tan(d) / this.L;
      this.yawRate += (kin - this.yawRate) * Math.min(1, k * dt * 12);
      vy *= 1 - Math.min(1, k * dt * 8);
    }
    if (ground && Math.abs(vx) < 0.3 && thr < 0.05) vx *= 1 - Math.min(1, dt * 4);
    // ---- arcade handling layer
    const sp2 = Math.hypot(vx, vy);
    const betaNow = Math.atan2(vy, Math.abs(vx) + 0.001);
    const phiNow = Math.atan2(this.vel.x, this.vel.y);
    let dphi = phiNow - this._phi; dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi));
    this._wv += ((dphi / Math.max(dt, 1e-4)) - this._wv) * Math.min(1, dt * 20); this._phi = phiNow;
    const A = 0.45 + this.assist * 0.6;
    if (ground && sp2 > 5 && vx > 0) {
      // how deep in a slide are we (0 = gripping, 1 = drifting)
      const w = THREE.MathUtils.smoothstep(Math.abs(betaNow), 0.1, 0.32) * Math.min(1, (sp2 - 5) / 6) * (thr > 0.15 || inp.handbrake ? 1 : 0.5);
      this.driftW += (w - this.driftW) * Math.min(1, dt * 10);
      // 1) drift controller: the steering input sets the slide angle; the car holds it while you hold the gas
      const bt = Math.sign(inp.steer) * Math.pow(Math.abs(inp.steer), 0.8) * T.bt;
      const wDes = this._wv + T.kb * (bt - betaNow);
      this.yawRate += (wDes - this.yawRate) * Math.min(1, dt * 9) * this.driftW * Math.min(1, A);
      // keep the car from looping out
      const ex = Math.abs(betaNow) - 1.15;
      if (ex > 0) this.yawRate -= Math.sign(betaNow) * Math.min(Math.abs(this.yawRate) + 0.5, ex * 14 * dt * (0.5 + this.assist));
      // 2) a slide carries speed: gentle push along the nose while on the gas
      if (this.driftW > 0.2 && thr > 0.3) vx += 6.5 * this.driftW * thr * dt;
      vx -= vx * 0.22 * this.driftW * dt * (0.4 + Math.abs(betaNow)); // sliding scrubs a bit of speed
      // 3) velocity slowly swings toward the nose so exits are clean
      if (Math.abs(betaNow) > 0.12) {
        const rot = Math.min(Math.abs(betaNow) - 0.1, dt * this.assist * (0.3 + 0.7 * thr) * T.align);
        const nb = betaNow - Math.sign(betaNow) * rot;
        vx = sp2 * Math.cos(nb); vy = sp2 * Math.sin(nb);
      }
    } else this.driftW *= 1 - Math.min(1, dt * 6);
    // direct turn-in while gripping: the car answers the wheel immediately and rotates sharply
    if (ground && sp2 > 3 && !this.reverse && vx > 0) {
      const lim = Math.min(2.6, mu * G * 0.92 / Math.max(sp2, 6));
      const wDes = inp.steer * lim * T.turn * (1 - this.driftW) * Math.min(1, sp2 / 9);
      this.yawRate += (wDes - this.yawRate) * Math.min(1, dt * 11) * (1 - this.driftW) * (0.5 + this.assist * 0.5);
    }

    // back to world space using the frame the forces were computed in (velocity must NOT rotate with the body)
    this.vel.set(vx * sh + vy * -ch, vx * ch + vy * sh);
    this.heading += this.yawRate * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;

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
