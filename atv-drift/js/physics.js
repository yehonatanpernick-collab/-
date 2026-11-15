// Arcade rigid-body vehicle: 4 raycast wheels with suspension, a friction-circle
// tyre model tuned for drifting, air control, and impulse-based chassis contacts.
import * as THREE from 'three';
import { groundQuery, pointPenetration, waterAt, terrainHeight, HALF, surfaceAt, GRIP } from './terrain.js';

export const GRAVITY = 13;
const V = () => new THREE.Vector3();

export const CFG = {
  mass: 650,
  inertia: new THREE.Vector3(620, 680, 330),   // pitch(x) yaw(y) roll(z)
  comHeight: 0.55,                              // CoM above ground origin of the model
  wheelR: 0.375,
  restLen: 0.40,
  spring: 15500,
  damper: 1900,
  maxSteer: 0.62,
  minSteer: 0.16,
  engine: 9400,
  boostEngine: 6500,
  maxSpeed: 44,
  boostSpeed: 58,
  reverseSpeed: 11,
  brake: 9500,
  muFront: 1.24,
  muRear: 1.4,
};
// per-mode handling
export const MODES = {
  normal: { muRear: 1.42, handbrakeRear: 0.4, maxSlide: 0.6, assist: 0.6, powerOver: 1.0, drift_aLat: 9, drift_wMax: 1.1, drift_kp: 4.0, drift_scrub: 3.0 },
  drift:  { muRear: 1.36, handbrakeRear: 0.34, maxSlide: 0.95, assist: 1.0, powerOver: 0.75, drift_aLat: 13, drift_wMax: 1.5, drift_kp: 4.5, drift_scrub: 2.6 },
};

// wheel local positions relative to CoM: x left(+), z forward(+)
const STATIC_WHEEL_Y = 0.374 - CFG.comHeight;        // model's wheel centre
const STATIC_COMP = (CFG.mass * GRAVITY / 4) / CFG.spring;
const ANCHOR_Y = STATIC_WHEEL_Y + (CFG.restLen - STATIC_COMP);

export const WHEELS = [
  { x: 0.70, z: 1.14, front: true },
  { x: -0.70, z: 1.14, front: true },
  { x: 0.70, z: -1.14, front: false },
  { x: -0.70, z: -1.14, front: false },
];

// chassis collision points (local to CoM)
const BODY_PTS = [];
{
  const b = 0.30 - CFG.comHeight + 0.02, t = 1.88 - CFG.comHeight;
  for (const sx of [-1, 1]) {
    for (const z of [-1.38, 0, 1.36]) BODY_PTS.push(new THREE.Vector3(0.68 * sx, b, z));
    BODY_PTS.push(new THREE.Vector3(0.66 * sx, t - 0.05, 0.95));
    BODY_PTS.push(new THREE.Vector3(0.66 * sx, t - 0.05, -0.75));
    BODY_PTS.push(new THREE.Vector3(0.76 * sx, 0.45, 1.25));
    BODY_PTS.push(new THREE.Vector3(0.76 * sx, 0.45, -1.3));
    BODY_PTS.push(new THREE.Vector3(0.78 * sx, 0.95, 0.1));
  }
  BODY_PTS.push(new THREE.Vector3(0, 0.25, 1.55));
  BODY_PTS.push(new THREE.Vector3(0, 0.35, -1.5));
  BODY_PTS.push(new THREE.Vector3(0, t, 0.1));
}

const tmpQ = { n: { x: 0, y: 1, z: 0 }, h: 0, surface: 'terrain' };
const tmpP = { n: { x: 0, y: 1, z: 0 }, kind: '' };

export class Vehicle {
  constructor() {
    this.pos = V(); this.vel = V(); this.q = new THREE.Quaternion(); this.w = V();
    this.up = V(); this.fwd = V(); this.left = V();
    this.steer = 0;       // smoothed steering (-1..1, + = right)
    this.wheels = WHEELS.map(w => ({
      ...w,
      anchor: new THREE.Vector3(w.x, ANCHOR_Y, w.z),
      contact: false, comp: STATIC_COMP, prevComp: STATIC_COMP,
      susp: CFG.restLen - STATIC_COMP, load: 0,
      point: V(), normal: V(), surface: 'terrain',
      slipLat: 0, slipLong: 0, spin: 0, spinVel: 0,
      steerAngle: 0, vLong: 0, vLat: 0,
    }));
    this.grounded = 0;
    this.airTime = 0;
    this.impact = 0;          // strongest contact impulse this frame (m/s)
    this.wallHit = 0;
    this.inWater = 0;
    this.boostActive = false;
    this.boostFuel = 1;
    this._driveGround = 1;
    this.mode = 'normal'; this._offThrottle = 0; this.wheelie = 0; this._centred = 0; this._flick = 0;
    this.drifting = false; this._driftCalm = 0; this.slipAngle = 0;
    this.rpm = 0.2;
    this._f = V(); this._t = V();
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    const h = terrainHeight(x, z);
    const gq = { n: { x: 0, y: 1, z: 0 } };
    const gh = groundQuery(x, z, h + 30, gq);
    this.pos.set(x, Math.max(h, gh) + 1.2, z);
    this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.steer = 0;
    this.airTime = 0;
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.dot(this.fwd); }

  updateAxes() {
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.left.set(1, 0, 0).applyQuaternion(this.q);
  }

  // world-space inverse inertia applied to vector v (in place)
  invI(v) {
    const qi = this._qi || (this._qi = new THREE.Quaternion());
    qi.copy(this.q).invert();
    v.applyQuaternion(qi);
    v.x /= CFG.inertia.x; v.y /= CFG.inertia.y; v.z /= CFG.inertia.z;
    v.applyQuaternion(this.q);
    return v;
  }

  // input: {throttle 0..1, brake 0..1, steer -1..1, handbrake bool, boost bool, roll -1..1}
  step(dt, input) {
    this.updateAxes();
    const m = CFG.mass;
    const F = this._f.set(0, -m * GRAVITY, 0);
    const T = this._t.set(0, 0, 0);
    const up = this.up, fwd = this.fwd, left = this.left;

    const vF = this.vel.dot(fwd);
    const speed = this.vel.length();

    const M = MODES[this.mode] || MODES.normal;
    // ---- steering (speed sensitive, smoothed)
    const steerTarget = input.steer;
    const rate = (Math.abs(steerTarget) > Math.abs(this.steer) ? 6 : 9) * dt;
    this.steer += THREE.MathUtils.clamp(steerTarget - this.steer, -rate, rate);
    const speedK = THREE.MathUtils.clamp(Math.abs(vF) / 32, 0, 1);
    let maxSteer = THREE.MathUtils.lerp(CFG.maxSteer, CFG.minSteer, Math.pow(speedK, 0.7));

    // slip angle: angle between heading and travel direction on the ground plane
    const hv = this._hv || (this._hv = V());
    hv.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
    const hs = hv.length();
    this.slipAngle = hs > 2 ? Math.atan2(-hv.dot(left), Math.max(hv.dot(fwd), -hs)) : 0; // + = sliding right
    // more lock while sliding so you can catch it
    if (this.drifting && vF > 3) maxSteer = Math.max(maxSteer, 0.5);
    const steerAngle = -this.steer * maxSteer;

    // ---- driving forces
    const boosting = input.boost && this.boostFuel > 0;
    this.boostActive = boosting;
    const vmax = boosting ? CFG.boostSpeed : CFG.maxSpeed;
    let drive = 0, braking = 0;
    if (input.throttle > 0) {
      // limit by the speed along the direction of travel (not along the heading), so a
      // sliding car can't run away to absurd speeds
      const vRef = this.drifting ? hs : Math.max(vF, 0);
      const fade = Math.max(0, 1 - Math.pow(vRef / vmax, 2.5));
      drive = input.throttle * (CFG.engine * (0.82 + 0.18 * (1 - speedK)) * fade + (boosting ? CFG.boostEngine * Math.max(0, 1 - Math.pow(vRef / vmax, 3)) : 0));
    }
    if (input.brake > 0) {
      if (vF > 1.0) braking = input.brake * CFG.brake;
      else {
        const fade = Math.max(0, 1 - Math.max(-vF, 0) / CFG.reverseSpeed);
        drive -= input.brake * CFG.engine * 0.6 * fade;
      }
    }
    this.reversing = vF < -0.5 && input.brake > 0;
    this.braking = braking > 0 || (input.handbrake && Math.abs(vF) > 1);

    // ---- wheels
    let grounded = 0;
    const anchorW = this._aw || (this._aw = V());
    const r = this._r || (this._r = V());
    const vp = this._vp || (this._vp = V());
    const wf = this._wf || (this._wf = V());
    const ws = this._ws || (this._ws = V());
    const n = this._n || (this._n = V());
    const Fw = this._Fw || (this._Fw = V());
    const dir = this._dir || (this._dir = V());
    dir.copy(up).negate();

    for (const wh of this.wheels) {
      anchorW.copy(wh.anchor).applyQuaternion(this.q).add(this.pos);
      wh.steerAngle = wh.front ? steerAngle : 0;
      wh.contact = false;
      wh.load = 0;
      const maxLen = CFG.restLen + CFG.wheelR;
      if (dir.y > -0.25) { this._droop(wh, dt); continue; }
      // ray / height-field intersection
      let t = 0;
      for (let k = 0; k < 4; k++) {
        const px = anchorW.x + dir.x * t, pz = anchorW.z + dir.z * t;
        const g = groundQuery(px, pz, anchorW.y + 0.1, tmpQ);
        t = (anchorW.y - g) / (-dir.y);
        if (t > maxLen + 0.6) break;
      }
      if (t > maxLen || t < -0.6) { this._droop(wh, dt); continue; }
      wh.contact = true; grounded++;
      wh.surface = tmpQ.surface;
      n.set(tmpQ.n.x, tmpQ.n.y, tmpQ.n.z);
      wh.normal.copy(n);
      const len = Math.max(t - CFG.wheelR, 0);
      wh.susp = len;
      wh.prevComp = wh.comp;
      wh.comp = CFG.restLen - len;
      const compVel = (wh.comp - wh.prevComp) / dt;
      let Fs = CFG.spring * wh.comp + CFG.damper * compVel;
      if (wh.comp > CFG.restLen * 0.85) Fs += (wh.comp - CFG.restLen * 0.85) * 160000;
      Fs = THREE.MathUtils.clamp(Fs, 0, 26000);
      wh.load = Fs;
      wh.point.copy(anchorW).addScaledVector(dir, t);

      r.copy(wh.point).sub(this.pos);
      vp.copy(this.w).cross(r).add(this.vel);

      // wheel frame on the ground plane
      wf.copy(fwd).multiplyScalar(Math.cos(wh.steerAngle)).addScaledVector(left, Math.sin(wh.steerAngle));
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      ws.copy(n).cross(wf); // points left
      const vLong = vp.dot(wf), vLat = vp.dot(ws);
      wh.vLong = vLong; wh.vLat = vLat;

      // surface grip
      const surf = wh.surface === 'terrain' ? surfaceAt(wh.point.x, wh.point.z) : 'ramp';
      wh.surf = surf;
      const baseMu = wh.front ? CFG.muFront : M.muRear;
      let mu = baseMu * (GRIP[surf] ?? 1);
      const share = m / 4;

      // slip angle -> grip falloff (sliding friction lower than peak)
      const alpha = Math.atan2(Math.abs(vLat), Math.abs(vLong) + 0.5);
      let latMu = mu * (1 - 0.22 * THREE.MathUtils.smoothstep(alpha, 0.12, 0.6));
      if (!wh.front && input.handbrake) latMu *= M.handbrakeRear;
      if (!wh.front && this.drifting) latMu *= this.mode === 'drift' ? 0.38 : 0.6;
      if (wh.front && this.drifting) latMu *= 0.75;
      if (!wh.front && input.throttle > 0.5 && alpha > 0.2 && vF > 4) latMu *= M.powerOver; // power-over

      // longitudinal
      let Fx = 0;
      const driveShare = wh.front ? 0.17 : 0.33;   // 34% front / 66% rear
      // drive is shared among the wheels that touch the ground (4x4)
      Fx += drive * driveShare / this._driveGround;
      if (braking > 0) Fx -= Math.sign(vLong) * Math.min(braking * 0.25, Math.abs(vLong) * share / dt);
      if (!wh.front && input.handbrake) {
        const lock = this.mode === 'drift' ? 0.18 : 0.35;
        Fx -= THREE.MathUtils.clamp(vLong * share / dt * 0.5, -mu * Fs * lock, mu * Fs * lock);
      }
      // rolling resistance / holding still
      if (input.throttle === 0 && input.brake === 0 && Math.abs(vLong) < 1.2) {
        Fx -= THREE.MathUtils.clamp(vLong * share / dt * 0.4, -mu * Fs, mu * Fs);
      } else {
        Fx -= vLong * 2.2;
      }
      // traction for driving/braking doesn't depend on the surface, so sand and
      // dirt are as fast as asphalt; only cornering grip changes
      const maxF = baseMu * 1.2 * Fs;
      Fx = THREE.MathUtils.clamp(Fx, -maxF, maxF);
      wh.slipLong = (drive * driveShare > maxF * 0.95 && Math.abs(vLong) < 25) ? 1 : 0;

      // lateral: cancel lateral velocity, bounded by friction circle
      let Fy = -vLat * share / dt * 0.55;
      const latMax = Math.max(Math.sqrt(Math.max(0, (latMu * Fs) ** 2 - Fx * Fx)), 0.38 * latMu * Fs);
      wh.slipLat = Math.abs(Fy) > latMax ? Math.min(1, Math.abs(vLat) / 6) : 0;
      Fy = THREE.MathUtils.clamp(Fy, -latMax, latMax);

      // suspension force acts at the contact patch; tyre forces are applied at a
      // raised point (lower effective roll centre) so the buggy doesn't trip over itself
      Fw.copy(n).multiplyScalar(Fs);
      F.add(Fw);
      T.add(r.clone().cross(Fw));
      Fw.copy(wf).multiplyScalar(Fx).addScaledVector(ws, Fy);
      F.add(Fw);
      const rr = r.clone().addScaledVector(up, -r.dot(up) * 0.8);
      T.add(rr.cross(Fw));

      // wheel spin (visual)
      let targetSpin = vLong / CFG.wheelR;
      if (!wh.front && input.handbrake) targetSpin = 0;
      if (wh.slipLong) targetSpin += 30 * Math.sign(drive || 1);
      wh.spinVel += (targetSpin - wh.spinVel) * Math.min(1, dt * 20);
      wh.spin += wh.spinVel * dt;
    }
    this.grounded = grounded;
    {
      let g = 0;
      for (const w of this.wheels) if (w.contact) g += w.front ? 0.17 : 0.33;
      this._driveGround = Math.max(0.5, g);
    }
    // anti-roll bars
    for (let a = 0; a < 4; a += 2) {
      const L = this.wheels[a], R = this.wheels[a + 1];
      if (!L.contact && !R.contact) continue;
      const d = (L.comp - R.comp) * 11000;
      const pl = this._pl || (this._pl = V());
      if (L.contact) { pl.copy(L.point).sub(this.pos); T.add(pl.clone().cross(up.clone().multiplyScalar(d))); F.addScaledVector(up, d); }
      if (R.contact) { pl.copy(R.point).sub(this.pos); T.add(pl.clone().cross(up.clone().multiplyScalar(-d))); F.addScaledVector(up, -d); }
    }

    // ---- aero, downforce
    F.addScaledVector(this.vel, -0.22 * speed - 4);
    if (grounded >= 3) F.addScaledVector(up, -speed * speed * 0.9);

    // ---- drift controller / stability on the ground
    const wy = this.w.dot(up);
    // angular rate of the velocity direction (about up)
    const hvDir = this._hvd || (this._hvd = V());
    let wVel = 0;
    if (hs > 1) {
      hvDir.copy(hv).multiplyScalar(1 / hs);
      if (this._prevHv && this._prevHvOk) {
        const c = this._prevHv.clone().cross(hvDir).dot(up);
        wVel = Math.asin(THREE.MathUtils.clamp(c, -1, 1)) / dt;
      }
      (this._prevHv || (this._prevHv = V())).copy(hvDir); this._prevHvOk = true;
    } else this._prevHvOk = false;

    // ground reference for wheelies: average contact normal (or world up)
    const gN = this._gN || (this._gN = V());
    gN.set(0, 0, 0);
    for (const w of this.wheels) if (w.contact) gN.add(w.normal);
    if (gN.lengthSq() < 0.01) gN.set(0, 1, 0); gN.normalize();
    const frontOn = this.wheels[0].contact || this.wheels[1].contact;
    const rearOn = this.wheels[2].contact || this.wheels[3].contact;
    this.wheelie = rearOn && !frontOn ? 1 : (frontOn && !rearOn ? -1 : 0);
    const lean = input.lean || 0;                    // +1 forward (nose down), -1 back (nose up)

    if (grounded >= 1) {
      const s = this.slipAngle;
      const sliding = Math.abs(s) > 0.1;
      // ---- drift state: only ever starts from a deliberate input
      if (!this.drifting && vF > 8 && grounded >= 2) {
        const sameWay = Math.sign(input.steer) === -Math.sign(s || -input.steer);
        if (input.handbrake && Math.abs(input.steer) > 0.25) this.drifting = true;
        else if (this.mode === 'drift' && input.throttle > 0.6 && Math.abs(input.steer) > 0.6 && Math.abs(s) > 0.16 && sameWay) this.drifting = true;
        // drift mode: full lock + gas at speed flicks the tail out
        this._flick = (this.mode === 'drift' && input.throttle > 0.7 && Math.abs(input.steer) > 0.85 && vF > 11) ? this._flick + dt : 0;
        if (this._flick > 0.22) this.drifting = true;
      }
      if (this.drifting) {
        if (!input.throttle && !input.handbrake) this._offThrottle += dt; else this._offThrottle = 0;
        if (Math.abs(s) < 0.12 && !input.handbrake) this._driftCalm += dt; else this._driftCalm = 0;
        // centred wheel for a moment ends the drift: grip and stability control take over
        const centred = Math.abs(input.steer) < 0.15 && !input.handbrake;
        this._centred = centred ? this._centred + dt : 0;
        if (this._driftCalm > 0.12 || this._centred > 1.4 || hs < 4 || vF < -2 || this._offThrottle > 1.2 || grounded < 2) this.drifting = false;
      }
      if (this.drifting) {
        // Arcade drift: the wheel directly sets how fast the direction of TRAVEL turns, and a
        // yaw controller holds the nose at a chosen angle to that direction. That is what
        // makes the car carve a real arc instead of sliding sideways in a line.
        const st = THREE.MathUtils.clamp(this.steer, -1, 1);                 // + = right
        const aLat = M.drift_aLat;                                          // m/s^2 of cornering force
        const wMax = Math.min(M.drift_wMax, aLat / Math.max(hs, 5));
        const wCmd = -st * wMax * THREE.MathUtils.smoothstep(hs, 2, 7);      // right turn = negative about up
        // centripetal force: rotates the velocity without changing its length
        const cen = this._cen || (this._cen = V());
        cen.copy(up).cross(hv).multiplyScalar(m * wCmd);
        F.add(cen);
        // slide angle the nose is held at: wider with more lock and more throttle
        const sg = Math.abs(st) > 0.12 ? -Math.sign(st) : Math.sign(s || 1);
        let mag = Math.abs(st) < 0.12 ? 0 : M.maxSlide * (0.4 + 0.6 * Math.abs(st));
        if (input.handbrake) mag = Math.max(mag, M.maxSlide * 0.7);
        if (!input.throttle && !input.handbrake) mag *= 0.6;
        const err = sg * mag - s;
        const wTarget = wCmd + err * M.drift_kp;
        T.addScaledVector(up, (wTarget - wy) * CFG.inertia.y * 9);
        // sliding scrubs some speed; throttle's push along the nose pays it back
        const scrub = m * (0.5 + M.drift_scrub * Math.abs(Math.sin(s))) * THREE.MathUtils.smoothstep(hs, 2, 8);
        F.addScaledVector(hvDir, -scrub);
      } else if (grounded >= 2) {
        // ---- stability control: yaw follows the steering, no wandering
        let wantYaw = vF * Math.tan(steerAngle) / 2.28;      // bicycle model (about up)
        const yawCap = CFG.muFront * GRAVITY * 1.15 / Math.max(Math.abs(vF), 3);   // what grip can deliver
        if (Math.abs(wantYaw) > yawCap) wantYaw = Math.sign(wantYaw) * yawCap;
        // only ever removes rotation beyond what the steering asks for (never adds yaw)
        const errYaw = wy - wantYaw;
        const excess = Math.sign(errYaw) !== Math.sign(wantYaw) || Math.abs(wy) > Math.abs(wantYaw);
        if (!input.handbrake && excess) {
          const tol = 0.15 + Math.abs(wantYaw) * 0.15;
          if (Math.abs(errYaw) > tol) T.addScaledVector(up, -(errYaw - Math.sign(errYaw) * tol) * CFG.inertia.y * 7);
          T.addScaledVector(up, -errYaw * CFG.inertia.y * (Math.abs(input.steer) < 0.05 ? 2.5 : 0.8));
        }
        // catch big slides that aren't a drift
        const over = Math.abs(s) - (Math.abs(input.steer) < 0.15 ? 0.2 : 0.5);
        if (over > 0 && vF > 2 && !input.handbrake) T.addScaledVector(up, -Math.sign(s) * over * CFG.inertia.y * 14);
        // side-slip damping when going straight (no crab-walking on side slopes)
        if (!sliding && Math.abs(input.steer) < 0.05 && hs > 3) F.addScaledVector(left, -hv.dot(left) * m * 1.5);
      }
      // ---- wheelie / stoppie: lean keys tilt the buggy on the ground
      if (lean !== 0) {
        const pitchUp = Math.asin(THREE.MathUtils.clamp(fwd.dot(gN), -1, 1));   // + nose up
        const noseUpRate = -this.w.dot(left);
        const target = lean < 0 ? 0.5 * -lean : -0.38 * lean;
        const arm = lean < 0 ? 1.14 : 1.14;
        const ff = m * GRAVITY * arm * Math.cos(pitchUp) * (lean < 0 ? 1 : -1) * Math.min(1, Math.abs(lean));
        let tq = CFG.inertia.x * (32 * (target - pitchUp) - 8 * noseUpRate) + ff;
        tq = THREE.MathUtils.clamp(tq, -22000, 22000);
        T.addScaledVector(left, -tq);
      }
      this.airTime = 0;
    } else {
      // ---- air control: lean = flips, steer = spin, roll keys = barrel roll
      this.airTime += dt;
      this.drifting = false;
      // lean sets a target pitch RATE (about 1 flip per 1.3 s) instead of a constant torque,
      // so a flip never spins up out of control and stops soon after the key is released
      const pitchRate = this.w.dot(left);
      const want = lean * 4.8;
      T.addScaledVector(left, CFG.inertia.x * THREE.MathUtils.clamp((want - pitchRate) * 9, -18, 18));
      T.addScaledVector(up, -input.steer * CFG.inertia.y * 3.6);
      T.addScaledVector(fwd, (input.roll || 0) * CFG.inertia.z * 5.5);
      if (!lean && Math.abs(input.steer) < 0.1 && !input.roll) {
        T.addScaledVector(this.w, -3.0 * CFG.inertia.x);
        const axis = this._lv || (this._lv = V());
        axis.copy(up).cross(new THREE.Vector3(0, 1, 0));
        if (up.y > 0.3) T.addScaledVector(axis, CFG.inertia.x * 2.2);
      }
    }

    // ---- water
    this.inWater = 0;
    const wl = waterAt(this.pos.x, this.pos.z);
    if (this.pos.y < wl + 0.3) {
      const depth = wl + 0.3 - this.pos.y;
      this.inWater = Math.min(1, depth / 0.8);
      F.addScaledVector(this.vel, -this.inWater * 900);
      F.y += this.inWater * m * GRAVITY * 0.35;
    }

    // ---- integrate
    this.vel.addScaledVector(F, dt / m);
    const dw = this.invI(T.clone()).multiplyScalar(dt);
    this.w.add(dw);
    const angDamp = grounded ? 0.994 : 0.999;
    this.w.multiplyScalar(angDamp);
    if (this.w.length() > 14) this.w.setLength(14);
    this.pos.addScaledVector(this.vel, dt);
    const wq = new THREE.Quaternion(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0);
    wq.multiply(this.q);
    this.q.x += wq.x; this.q.y += wq.y; this.q.z += wq.z; this.q.w += wq.w;
    this.q.normalize();

    this._collide(dt);

    // world bounds
    const lim = HALF - 12;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = Math.sign(this.pos.x) * lim; this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = Math.sign(this.pos.z) * lim; this.vel.z *= -0.3; }

    // fake rpm with gears for the HUD / audio
    const sp = Math.abs(vF);
    const gears = [0, 9, 16, 24, 32, 42, 60];
    let g = 1; while (g < gears.length - 1 && sp > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    let rpm = 0.25 + 0.75 * (sp - lo) / (hi - lo);
    if (g > 1) rpm = 0.45 + 0.55 * (sp - lo) / (hi - lo);
    const spinning = this.wheels.some(w => w.slipLong) || (grounded === 0);
    if (spinning && input.throttle > 0) rpm = Math.max(rpm, 0.85);
    if (input.throttle === 0 && grounded === 0) rpm *= 0.98;
    this.rpm += (THREE.MathUtils.clamp(rpm, 0.18, 1.05) - this.rpm) * Math.min(1, dt * 10);
    this.gear = this.reversing ? 'R' : String(g);
  }

  _droop(wh, dt) {
    wh.prevComp = wh.comp;
    wh.comp = Math.max(0, wh.comp - dt * 4);
    wh.susp = CFG.restLen - wh.comp;
    wh.slipLat = 0; wh.slipLong = 0;
    wh.spinVel *= 0.995;
    wh.spin += wh.spinVel * dt;
  }


  _collide(dt) {
    let worst = 0, wall = 0;
    const p = this._cp || (this._cp = V());
    const r = this._cr || (this._cr = V());
    const vp = this._cv || (this._cv = V());
    const n = this._cn || (this._cn = V());
    const corr = this._cc || (this._cc = V());
    const tmp = this._ct || (this._ct = V());
    corr.set(0, 0, 0);
    let maxDepth = 0;
    for (const lp of BODY_PTS) {
      p.copy(lp).applyQuaternion(this.q).add(this.pos);
      const depth = pointPenetration(p.x, p.y, p.z, tmpP);
      if (depth <= 0) continue;
      n.set(tmpP.n.x, tmpP.n.y, tmpP.n.z);
      r.copy(p).sub(this.pos);
      vp.copy(this.w).cross(r).add(this.vel);
      const vn = vp.dot(n);
      if (depth > maxDepth) { maxDepth = depth; corr.copy(n).multiplyScalar(depth); }
      if (vn >= 0) continue;
      // effective mass along n
      tmp.copy(r).cross(n); this.invI(tmp); tmp.cross(r);
      const k = 1 / CFG.mass + n.dot(tmp);
      const e = vn < -6 ? 0.25 : 0.05;
      const j = -(1 + e) * vn / k;
      this.vel.addScaledVector(n, j / CFG.mass);
      tmp.copy(r).cross(n).multiplyScalar(j); this.w.add(this.invI(tmp));
      if (-vn > worst) worst = -vn;
      if (tmpP.kind === 'wall' && -vn > wall) wall = -vn;
      // friction
      vp.copy(this.w).cross(r).add(this.vel);
      const vt = vp.addScaledVector(n, -vp.dot(n));
      const vtl = vt.length();
      if (vtl > 1e-3) {
        vt.multiplyScalar(1 / vtl);
        tmp.copy(r).cross(vt); this.invI(tmp); tmp.cross(r);
        const kt = 1 / CFG.mass + vt.dot(tmp);
        const jt = Math.min(0.55 * j, vtl / kt);
        this.vel.addScaledVector(vt, -jt / CFG.mass);
        tmp.copy(r).cross(vt).multiplyScalar(-jt); this.w.add(this.invI(tmp));
      }
    }
    if (maxDepth > 0.005) this.pos.addScaledVector(corr, Math.min(1, 0.5 + maxDepth) * (1 - 0.005 / maxDepth));
    this.impact = Math.max(this.impact, worst);
    this.wallHit = Math.max(this.wallHit, wall);
  }
}
