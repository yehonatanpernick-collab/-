// RZR XP 1000 vehicle dynamics (200 Hz fixed step).
// Rigid body + 4 independent long-travel suspensions + combined-slip tyre model +
// CVT drivetrain (locked rear "spool", open front diff, AWD/2WD) + chassis contacts.
import * as THREE from 'three';
import { SURFACES } from '../world/collision.js';

const V = () => new THREE.Vector3();
const G = 9.81;

export const SPEC = {
  mass: 790,                    // kg, vehicle + driver + fuel
  inertia: [690, 760, 300],     // pitch(X), yaw(Y), roll(Z) kg m^2 (body frame)
  com: [0, 0.56, -0.12],        // centre of mass in model coords (forward = +Z, left = +X)
  wheelBase: 2.286, track: 1.4,
  wheelR: 0.375, wheelI: 1.6, wheelMass: 32,
  // suspension (per corner): strut top at y = topY, travel = [lenMin, lenMax]
  topY: 0.62, lenMin: 0.04, lenMax: 0.56, restLen: 0.345,
  kFront: 21000, kRear: 24000, cBump: 2300, cRebound: 3100, bumpStop: 240000,
  arbFront: 6500, arbRear: 4500,
  maxSteer: 0.56,              // rad (~32 deg)
  enginePower: 82000,          // W (110 hp)
  turboPower: 124000,          // W, boost (Turbo S-like)
  maxWheelTorque: 2700,        // Nm total at the wheels in low ratio
  topSpeedRad: 95,             // wheel rad/s at max CVT ratio (~128 km/h)
  reverseMax: 7.5,             // m/s
  brakeTorque: 2600,           // Nm per wheel
  handbrakeTorque: 3200,       // rear
  CdA: 1.15,
};

// body-frame collision probes (model coords): bottom skid plate, bumpers, cage, sides
const PROBES = [
  [0.7, 0.32, 1.42], [-0.7, 0.32, 1.42], [0.72, 0.3, -1.45], [-0.72, 0.3, -1.45], [0, 0.26, 0.4], [0, 0.26, -0.6],
  [0.78, 0.35, 0], [-0.78, 0.35, 0], [0, 0.62, 1.6], [0, 0.72, -1.58],
  [0.55, 1.86, 0.38], [-0.55, 1.86, 0.38], [0.55, 1.86, -0.42], [-0.55, 1.86, -0.42],
  [0.8, 1.0, 0.1], [-0.8, 1.0, 0.1], [0.7, 1.1, 1.1], [-0.7, 1.1, 1.1],
];

export class VehiclePhysics {
  constructor(collision) {
    this.col = collision;
    this.s = SPEC;
    this.pos = V(); this.vel = V(); this.angVel = V();
    this.quat = new THREE.Quaternion();
    this.invI = new THREE.Vector3(1 / SPEC.inertia[0], 1 / SPEC.inertia[1], 1 / SPEC.inertia[2]);
    this.awd = true;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
    this.steerAngle = 0;
    this.engineRpm = 900;
    this.reversing = false;
    this.wheels = ['FL', 'FR', 'RL', 'RR'].map((name, i) => {
      const front = i < 2, left = i % 2 === 0;
      return {
        name, front, left,
        mount: new THREE.Vector3((left ? 1 : -1) * SPEC.track / 2 - SPEC.com[0], SPEC.topY - SPEC.com[1], (front ? 1 : -1) * SPEC.wheelBase / 2 - SPEC.com[2]),
        len: SPEC.restLen, lenVel: 0, omega: 0, angle: 0, steer: 0,
        contact: false, load: 0, slip: 0, slipLat: 0, surface: 'grass', depth: 0,
        cpos: V(), cnorm: V(0, 1, 0), center: V(), fx: 0, fy: 0, sinkage: 0, water: 0,
      };
    });
    this.probes = PROBES.map(p => new THREE.Vector3(p[0] - SPEC.com[0], p[1] - SPEC.com[1], p[2] - SPEC.com[2]));
    this.g = { h: 0, nx: 0, ny: 1, nz: 0, bridge: false };
    this.impacts = 0;           // for camera shake / audio
    this.inWater = 0;
    this.airTime = 0;
    // temporaries
    this._f = V(); this._t = V(); this._a = V(); this._b = V(); this._c = V(); this._d = V(); this._e = V();
    this._m = new THREE.Matrix3(); this._q = new THREE.Quaternion();
  }

  // place with the model's ground contact at y (wheels resting)
  reset(x, z, heading) {
    const g = this.col.ground(x, z, undefined, this.g);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    // align to ground normal
    const n = new THREE.Vector3(g.nx, g.ny, g.nz);
    const q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.quat.premultiply(q2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    this.pos.set(x, g.h, z).addScaledVector(up, SPEC.com[1] + 0.12);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    for (const w of this.wheels) { w.len = SPEC.restLen; w.lenVel = 0; w.omega = 0; }
    this.airTime = 0;
  }

  toWorld(local, out) { return out.copy(local).applyQuaternion(this.quat).add(this.pos); }
  dirWorld(local, out) { return out.copy(local).applyQuaternion(this.quat); }

  _applyForce(F, at, Facc, Tacc) {
    Facc.add(F);
    const r = this._tq || (this._tq = new THREE.Vector3());
    r.subVectors(at, this.pos).cross(F);
    Tacc.add(r);
  }

  // world inverse inertia * v
  _invInertiaWorld(v, out) {
    // rotate to body, scale, rotate back
    this._q.copy(this.quat).invert();
    out.copy(v).applyQuaternion(this._q);
    out.x *= this.invI.x; out.y *= this.invI.y; out.z *= this.invI.z;
    return out.applyQuaternion(this.quat);
  }

  speed() { return this.vel.length(); }
  forward(out) { return this.dirWorld(this._fwd || (this._fwd = new THREE.Vector3(0, 0, 1)), out); }
  forwardSpeed() { const f = this.forward(this._d); return this.vel.dot(f); }

  step(dt) {
    const s = SPEC, inp = this.input, col = this.col;
    const F = this._f.set(0, -G * s.mass, 0), T = this._t.set(0, 0, 0);
    const up = this.dirWorld(new THREE.Vector3(0, 1, 0), V());
    const fwd = this.dirWorld(new THREE.Vector3(0, 0, 1), V());
    const left = this.dirWorld(new THREE.Vector3(1, 0, 0), V());
    const down = up.clone().negate();
    const vF = this.vel.dot(fwd);

    // --- steering: rate-limited, reduced at speed
    const speedK = 1 / (1 + Math.abs(vF) / 22);
    const target = inp.steer * s.maxSteer * (0.35 + 0.65 * speedK);
    const rate = 2.6 * dt;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));

    // --- drivetrain: CVT keeps the engine in its power band
    const rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    const avgOmega = this.awd ? (this.wheels[0].omega + this.wheels[1].omega + rearOmega * 2) / 4 : rearOmega;
    // gear logic: brake at standstill -> reverse; throttle -> forward
    if (!this.reversing && inp.brake > 0.5 && vF < 0.6 && inp.throttle < 0.1) this.reversing = true;
    if (this.reversing && (inp.throttle > 0.1 || (vF > 1.5))) this.reversing = false;
    let drive = 0;
    const power = inp.boost ? s.turboPower : s.enginePower;
    if (!this.reversing) {
      drive = inp.throttle;
    } else {
      drive = -inp.brake * (Math.abs(vF) < s.reverseMax ? 0.7 : 0);
    }
    const wAbs = Math.max(Math.abs(avgOmega), 4);
    let wheelTorque = Math.min(s.maxWheelTorque, power * 0.86 / wAbs) * drive;
    if (Math.abs(avgOmega) > s.topSpeedRad && Math.sign(avgOmega) === Math.sign(drive)) wheelTorque = 0;
    // CVT engine braking when off throttle
    const engBrake = drive === 0 ? -Math.sign(avgOmega) * Math.min(260, Math.abs(avgOmega) * 9) : 0;
    const totalT = wheelTorque + engBrake;
    const targetRpm = 1100 + 6900 * Math.min(1, Math.abs(drive) * (0.6 + 0.4 * Math.min(1, Math.abs(avgOmega) / 30)));
    const cvtRpm = Math.abs(avgOmega) * 9.5 * 60 / (2 * Math.PI);
    this.engineRpm += (Math.max(targetRpm, Math.min(8600, cvtRpm)) - this.engineRpm) * Math.min(1, dt * 6);
    const brakingFwd = !this.reversing && inp.brake > 0;

    // --- wheels
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const k = w.front ? s.kFront : s.kRear;
      const hard = this.toWorld(w.mount, this._a);
      // steering (Ackermann: inner wheel turns more)
      let st = 0;
      if (w.front) {
        const a = this.steerAngle;
        const inner = (a > 0) === w.left;
        st = a * (inner ? 1.12 : 0.9);
      }
      w.steer = st;
      const cs = Math.cos(st), sn = Math.sin(st);
      const wf = this._b.copy(fwd).multiplyScalar(cs).addScaledVector(left, sn); // wheel heading

      // find suspension length that puts the tyre on the ground (2 Newton steps on the local plane)
      let len = s.lenMax, dist = 0;
      const g = this.g;
      let ok = false;
      for (let it = 0; it < 3; it++) {
        const cx = hard.x + down.x * len, cy = hard.y + down.y * len, cz = hard.z + down.z * len;
        col.ground(cx, cz, cy, g);
        dist = ((cx - cx) * g.nx + (cy - g.h) * g.ny + (cz - cz) * g.nz);
        const dd = -(down.x * g.nx + down.y * g.ny + down.z * g.nz); // d(dist)/d(len) = n.down (neg)
        if (dd < 0.2) break;
        const nl = len - (s.wheelR - dist) / dd;
        len = nl; ok = true;
      }
      // boulders (sphere colliders) can lift the wheel too
      const obs = col.near(hard.x, hard.z);
      let rockN = null;
      if (obs) {
        for (const o of obs) {
          if (o.type !== 'sphere') continue;
          // wheel centre at length L: find L where |C - S| = r + R (closest approach along the strut)
          const rel = this._c.set(hard.x - o.x, hard.y - o.y, hard.z - o.z);
          const b = rel.dot(down), c = rel.lengthSq() - (o.r + s.wheelR) ** 2;
          const disc = b * b - c;
          if (disc > 0) {
            const L = -b - Math.sqrt(disc);
            if (L < len && L > s.lenMin - 0.3) {
              len = L; ok = true;
              const cx = hard.x + down.x * L, cy = hard.y + down.y * L, cz = hard.z + down.z * L;
              rockN = this._d.set(cx - o.x, cy - o.y, cz - o.z).normalize().clone();
            }
          }
        }
      }
      const inAir = !ok || len > s.lenMax;
      if (inAir) len = s.lenMax;
      let bottomed = false;
      if (len < s.lenMin) { len = s.lenMin; bottomed = true; }
      w.lenVel = (len - w.len) / dt;
      w.len = len;
      w.center.copy(hard).addScaledVector(down, len);
      w.contact = !inAir;
      w.water = 0;
      if (!w.contact) { w.load = 0; w.fx = w.fy = 0; w.slip = 0; w.slipLat = 0; }
      else {
        contacts++;
        const n = rockN || this._c.set(g.nx, g.ny, g.nz);
        w.cnorm.copy(n);
        w.cpos.copy(w.center).addScaledVector(n, -s.wheelR);
        const surfName = rockN ? 'rock' : col.surfaceAt(w.cpos.x, w.cpos.z, g.h, g.bridge);
        w.surface = surfName;
        const surf = SURFACES[surfName];
        // water depth at the contact
        const wl = col.field.waterLevel(w.cpos.x, w.cpos.z);
        if (wl > w.cpos.y && surfName !== 'ice') w.water = Math.min(1.2, wl - w.cpos.y);
        // spring + damper + bump stop
        const comp = s.restLen - len;
        let Fs = Math.max(0, k * comp);
        const damp = w.lenVel < 0 ? s.cBump : s.cRebound;
        Fs += -w.lenVel * damp;
        if (len < s.lenMin + 0.05) Fs += s.bumpStop * (s.lenMin + 0.05 - len);
        if (bottomed) this.impacts = Math.max(this.impacts, Math.min(1, -w.lenVel * 0.25));
        Fs = Math.max(0, Fs);
        w.load = Fs;
        // suspension force acts along the strut (body up), at the hardpoint
        this._e.copy(up).multiplyScalar(Fs);
        this._applyForce(this._e, hard, F, T);

        // tyre frame on the contact plane
        const tf = this._a.copy(wf).addScaledVector(n, -wf.dot(n)).normalize();
        const ts = this._b.crossVectors(n, tf).normalize(); // points to the wheel's left
        // contact patch velocity
        const r = this._e.subVectors(w.cpos, this.pos);
        const vc = this._d.crossVectors(this.angVel, r).add(this.vel);
        const vLong = vc.dot(tf), vLat = vc.dot(ts);
        let mu = surf.mu * (1 - 0.14 * col.wetness * (surf.snow ? 0 : 1));
        if (w.water > 0.05) mu *= 0.85;
        const Fz = Math.max(0, Fs) * Math.max(0.2, n.dot(up));
        const Fmax = mu * Fz;
        // slip
        const vRef = Math.max(Math.abs(vLong), 2.5);
        const kappa = (w.omega * s.wheelR - vLong) / vRef;
        const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.2));
        let fx = Math.sin(1.4 * Math.atan(10 * kappa));
        let fy = -Math.sin(1.35 * Math.atan(7.5 * alpha));
        const sum = Math.hypot(fx, fy);
        if (sum > 1) { fx /= sum; fy /= sum; }
        fx *= Fmax; fy *= Fmax;
        // low speed: viscous contact so the car can stand still on slopes without creeping
        const sp = Math.hypot(vLong, vLat);
        if (sp < 1.5) {
          const lowK = 1 - sp / 1.5;
          const visc = 5200;
          fy = fy * (1 - lowK) + Math.max(-Fmax, Math.min(Fmax, -vLat * visc)) * lowK;
          if (Math.abs(drive) < 0.05 && (brakingFwd || inp.handbrake || Math.abs(vLong) < 0.25))
            fx = fx * (1 - lowK) + Math.max(-Fmax, Math.min(Fmax, -vLong * visc)) * lowK;
        }
        // rolling resistance + sinkage drag (mud, snow, water)
        const rr = (surf.rr + w.water * 0.08) * Fz * Math.tanh(vLong * 2);
        fx -= rr;
        w.fx = fx; w.fy = fy; w.slip = kappa; w.slipLat = alpha;
        w.sinkage = (surf.mud ? 0.05 : surf.snow ? 0.06 : 0) + w.water * 0.02;
        this._e.copy(tf).multiplyScalar(fx).addScaledVector(ts, fy);
        this._applyForce(this._e, w.cpos, F, T);
        // water drag on the wheel
        if (w.water > 0.05) {
          this._e.copy(vc).multiplyScalar(-w.water * 260);
          this._applyForce(this._e, w.center, F, T);
        }
      }

      // wheel spin dynamics
      let tq = 0;
      const driven = !w.front || this.awd;
      if (driven) {
        const share = this.awd ? (w.front ? 0.18 : 0.32) : (w.front ? 0 : 0.5);
        tq += totalT * share;
      }
      let brake = 0;
      if (brakingFwd) brake += s.brakeTorque * inp.brake * (w.front ? 1.15 : 0.85);
      if (inp.handbrake && !w.front) brake += s.handbrakeTorque * inp.handbrake;
      tq -= w.fx * s.wheelR;
      let om = w.omega + tq / s.wheelI * dt;
      // brakes can stop the wheel but never reverse it
      if (brake > 0) {
        const dOm = brake / s.wheelI * dt;
        if (Math.abs(om) <= dOm) om = 0; else om -= Math.sign(om) * dOm;
      }
      if (!w.contact) om *= 1 - 0.4 * dt;
      w.omega = om;
      w.angle += w.omega * dt;
    }
    // locked rear (spool): both rear wheels turn together
    {
      const a = this.wheels[2], b = this.wheels[3];
      const m = (a.omega + b.omega) / 2;
      a.omega = b.omega = m;
    }
    // anti-roll bars
    for (const [i, j, karb] of [[0, 1, s.arbFront], [2, 3, s.arbRear]]) {
      const wa = this.wheels[i], wb = this.wheels[j];
      if (!wa.contact && !wb.contact) continue;
      const diff = (s.restLen - wa.len) - (s.restLen - wb.len);
      const fa = this._e.copy(up).multiplyScalar(diff * karb);
      this._applyForce(fa, this.toWorld(wa.mount, this._a), F, T);
      fa.negate();
      this._applyForce(fa, this.toWorld(wb.mount, this._a), F, T);
    }

    // aero drag
    const sp = this.vel.length();
    if (sp > 0.1) F.addScaledVector(this.vel, -0.5 * 1.0 * s.CdA * sp);

    // chassis contacts: terrain + obstacles (penalty springs with friction)
    this.impacts *= 0.9;
    let chassisHit = 0;
    for (const p of this.probes) {
      const X = this.toWorld(p, this._a);
      const g = col.ground(X.x, X.z, X.y, this.g);
      const depth = (g.h - X.y) * g.ny;
      const r = this._e.subVectors(X, this.pos);
      const vp = this._d.crossVectors(this.angVel, r).add(this.vel);
      if (depth > 0) {
        const n = this._b.set(g.nx, g.ny, g.nz);
        const vn = vp.dot(n);
        const fn = Math.max(0, 260000 * depth - 9000 * vn);
        const vt = this._c.copy(vp).addScaledVector(n, -vn);
        const vtl = vt.length();
        const ff = this._f2 || (this._f2 = V());
        ff.copy(n).multiplyScalar(fn);
        if (vtl > 0.01) ff.addScaledVector(vt, -Math.min(0.55 * fn, vtl * 4000) / vtl);
        this._applyForce(ff, X, F, T);
        chassisHit = Math.max(chassisHit, -vn);
      }
      const obs = col.near(X.x, X.z);
      if (obs) for (const o of obs) {
        let nx = 0, ny = 0, nz = 0, pen = 0;
        if (o.type === 'cyl') {
          if (X.y < o.y - 0.5 || X.y > o.y + o.h) continue;
          const dx = X.x - o.x, dz = X.z - o.z, d = Math.hypot(dx, dz);
          if (d < o.r && d > 1e-4) { pen = o.r - d; nx = dx / d; nz = dz / d; }
        } else if (o.type === 'sphere') {
          const dx = X.x - o.x, dy = X.y - o.y, dz = X.z - o.z, d = Math.hypot(dx, dy, dz);
          if (d < o.r && d > 1e-4) { pen = o.r - d; nx = dx / d; ny = dy / d; nz = dz / d; }
        } else if (o.type === 'box') {
          if (X.y < o.y - 0.3 || X.y > o.y + o.hy) continue;
          const c = Math.cos(o.rot), sn = Math.sin(o.rot);
          const lx = (X.x - o.x) * c - (X.z - o.z) * sn, lz = (X.x - o.x) * sn + (X.z - o.z) * c;
          const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
          if (px > 0 && pz > 0) {
            if (px < pz) { pen = px; const s2 = Math.sign(lx); nx = s2 * c; nz = -s2 * sn; }
            else { pen = pz; const s2 = Math.sign(lz); nx = s2 * sn; nz = s2 * c; }
          }
        }
        if (pen > 0) {
          const n = this._b.set(nx, ny, nz);
          const vn = vp.dot(n);
          const fn = Math.max(0, 420000 * pen - 14000 * vn);
          const ff = this._f2 || (this._f2 = V());
          ff.copy(n).multiplyScalar(fn);
          const vt = this._c.copy(vp).addScaledVector(n, -vn);
          const vtl = vt.length();
          if (vtl > 0.01) ff.addScaledVector(vt, -Math.min(0.4 * fn, vtl * 3000) / vtl);
          this._applyForce(ff, X, F, T);
          chassisHit = Math.max(chassisHit, -vn);
        }
      }
    }
    if (chassisHit > 1) this.impacts = Math.max(this.impacts, Math.min(1, chassisHit / 8));

    // body in water: buoyancy + drag
    const wl = col.field.waterLevel(this.pos.x, this.pos.z);
    this.inWater = 0;
    if (wl > this.pos.y - 0.4) {
      const sub = Math.min(1.2, wl - (this.pos.y - 0.4));
      this.inWater = sub;
      F.y += sub * 3800;
      F.addScaledVector(this.vel, -sub * 900);
      this.angVel.multiplyScalar(1 - Math.min(0.5, sub * 1.2 * dt));
    }

    // integrate (semi-implicit Euler)
    this.vel.addScaledVector(F, dt / s.mass);
    const Iw = this._invInertiaWorld(T, this._c);
    this.angVel.addScaledVector(Iw, dt);
    this.angVel.multiplyScalar(1 - 0.08 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const wl2 = this.angVel.length();
    if (wl2 > 1e-6) {
      this._q.setFromAxisAngle(this._a.copy(this.angVel).divideScalar(wl2), wl2 * dt);
      this.quat.premultiply(this._q).normalize();
    }
    this.airTime = contacts === 0 ? this.airTime + dt : 0;
    this.contacts = contacts;
  }
}
