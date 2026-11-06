import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, type Physics } from '../engine/physics';

export interface Controls { steer: number; throttle: number; up: number; down: number; boost: boolean; handbrake: boolean }

/** Tuning (SI units). Numbers were checked with the headless sim in tools/tune-vehicle.mjs. */
export const TUNE = {
  mass: 1650,
  power: 460_000,          // W (EV dual motor)
  maxForce: 15_000,        // N at the wheels, low speed
  drag: 0.4,              // N / (m/s)^2   (Cd·A·ρ/2)
  roll: 18,                // N / (m/s)
  downforce: 0.9,          // N / (m/s)^2
  brake: 55,               // per wheel
  steerLow: 0.6, steerHigh: 0.1, steerFalloff: 38,   // rad, rad, m/s
  wheelR: 0.36, rest: 0.32, stiff: 34, compress: 3.4, relax: 4.2, slip: 2.4,
  // flight
  flyAccel: 26, flyBoost: 52, flyDrag: 0.0026, flyLatDamp: 2.2,
  climb: 22, yawRate: 1.45, bank: 0.55, pitchK: 0.11,
};

export class Vehicle {
  body!: RAPIER.RigidBody;
  ctrl!: RAPIER.DynamicRayCastVehicleController;
  mode: 'drive' | 'fly' = 'drive';
  fold = 0;              // 0 wheels down … 1 thrusters
  steer = 0;
  speed = 0;             // forward m/s (signed)
  airborne = 0;
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  private prevPos = new THREE.Vector3(); private prevQuat = new THREE.Quaternion();
  readonly fwd = new THREE.Vector3(); readonly up = new THREE.Vector3(); readonly right = new THREE.Vector3();
  readonly wheelY = [0, 0, 0, 0]; readonly wheelSpin = [0, 0, 0, 0];
  private v3 = new THREE.Vector3(); private q = new THREE.Quaternion();
  input: Controls = { steer: 0, throttle: 0, up: 0, down: 0, boost: false, handbrake: false };
  energy = 1;

  constructor(private physics: Physics) {}

  spawn(x: number, y: number, z: number, yaw: number) {
    const w = this.physics.world;
    if (this.body) { w.removeVehicleController(this.ctrl); w.removeRigidBody(this.body); }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setCanSleep(false).setCcdEnabled(true).setAngularDamping(0.6).setLinearDamping(0.01));
    // low, wide chassis box; mass properties set explicitly with a low centre of mass
    w.createCollider(R.ColliderDesc.cuboid(0.92, 0.3, 2.25).setTranslation(0, 0.55, 0).setFriction(0.3).setRestitution(0.1)
      .setMassProperties(TUNE.mass, { x: 0, y: 0.38, z: 0.05 }, { x: TUNE.mass * 1.6, y: TUNE.mass * 2.1, z: TUNE.mass * 0.7 }, { x: 0, y: 0, z: 0, w: 1 }), this.body);
    w.createCollider(R.ColliderDesc.cuboid(0.6, 0.2, 1.0).setTranslation(0, 0.95, -0.35).setDensity(0.0001), this.body);
    this.ctrl = w.createVehicleController(this.body);
    const T = TUNE;
    [[-0.88, 1.42], [0.88, 1.42], [-0.88, -1.42], [0.88, -1.42]].forEach(([wx, wz], i) => {
      this.ctrl.addWheel({ x: wx, y: 0.36, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, T.rest, T.wheelR);
      this.ctrl.setWheelSuspensionStiffness(i, T.stiff);
      this.ctrl.setWheelSuspensionCompression(i, T.compress);
      this.ctrl.setWheelSuspensionRelaxation(i, T.relax);
      this.ctrl.setWheelMaxSuspensionTravel(i, 0.24);
      this.ctrl.setWheelMaxSuspensionForce(i, 60000);
      this.ctrl.setWheelFrictionSlip(i, T.slip);
      this.ctrl.setWheelSideFrictionStiffness(i, 1.0);
    });
    this.ctrl.indexUpAxis = 1;
    this.mode = 'drive'; this.fold = 0;
    this.readState(); this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
  }

  private readState() {
    const t = this.body.translation(), r = this.body.rotation(), lv = this.body.linvel();
    this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w); this.vel.set(lv.x, lv.y, lv.z);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat); this.up.set(0, 1, 0).applyQuaternion(this.quat); this.right.set(-1, 0, 0).applyQuaternion(this.quat);
    this.speed = this.vel.dot(this.fwd);
  }

  get yaw() { return Math.atan2(this.fwd.x, this.fwd.z); }

  setMode(m: 'drive' | 'fly') {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'fly') { const g = this.groundClearance(); if (g < 1.5) this.body.applyImpulse({ x: 0, y: TUNE.mass * 4.5, z: 0 }, true); }
  }

  groundClearance() {
    const toi = this.physics.castRay(this.pos.x, this.pos.y + 0.2, this.pos.z, 0, -1, 0, 400, this.body);
    return toi == null ? 400 : toi - 0.2;
  }

  /** one fixed physics substep */
  step(dt: number) {
    this.readState();
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    const I = this.input, T = TUNE, m = T.mass, v = this.vel, spd = v.length();
    this.fold += ((this.mode === 'fly' ? 1 : 0) - this.fold) * Math.min(1, dt * 3.2);
    const boosting = I.boost && this.energy > 0.02 && I.throttle > 0;
    this.energy = boosting ? Math.max(0, this.energy - dt * 0.22) : Math.min(1, this.energy + dt * 0.1);
    this.body.resetForces(true); this.body.resetTorques(true);
    // smoothed, speed-sensitive steering
    const steerMax = T.steerHigh + (T.steerLow - T.steerHigh) / (1 + Math.max(0, Math.abs(this.speed) - 3) / T.steerFalloff);
    this.steer += (I.steer * steerMax - this.steer) * Math.min(1, dt * (Math.abs(I.steer) > Math.abs(this.steer / steerMax) ? 7 : 10));

    if (this.mode === 'drive' || this.fold < 0.35) {
      const c = this.ctrl; const fs = this.speed;
      let engine = 0, brake = 0;
      if (I.throttle > 0.02) { const F = Math.min(T.maxForce * (boosting ? 1.35 : 1), (T.power * (boosting ? 1.5 : 1)) / Math.max(4, Math.abs(fs))); engine = fs < -1 ? 0 : F * I.throttle; if (fs < -1) brake = T.brake * I.throttle; }
      else if (I.throttle < -0.02) { if (fs > 1.2) brake = T.brake * -I.throttle; else engine = -T.maxForce * 0.45 * -I.throttle * (fs < -14 ? 0 : 1); }
      else brake = 0.6;
      for (let i = 0; i < 4; i++) {
        c.setWheelEngineForce(i, engine / 4); // +force drives along chassis +z (verified in tools/tune-vehicle.mjs)
        c.setWheelBrake(i, brake + (I.handbrake && i >= 2 ? T.brake * 1.6 : 0));
        c.setWheelFrictionSlip(i, I.handbrake && i >= 2 ? T.slip * 0.42 : T.slip);
        c.setWheelSteering(i, i < 2 ? this.steer : 0);
      }
      c.updateVehicle(dt);
      for (let i = 0; i < 4; i++) { this.wheelY[i] = 0.36 - (c.wheelSuspensionLength(i) ?? T.rest) + T.rest - 0.0; this.wheelSpin[i] = c.wheelRotation(i) ?? 0; }
      let grounded = 0; for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) grounded++;
      this.airborne = grounded ? 0 : this.airborne + dt;
      // aerodynamic drag, rolling resistance, downforce
      const dragF = T.drag * spd + T.roll; this.body.addForce({ x: -v.x * dragF, y: -v.y * T.drag * spd, z: -v.z * dragF }, true);
      if (grounded) this.body.addForce({ x: 0, y: -T.downforce * spd * spd, z: 0 }, true);
      // gentle air control + self-righting when flipped
      if (!grounded && this.up.y < 0.3) this.uprightTorque(0.6);
    }
    if (this.mode === 'fly' || this.fold > 0.35) this.flight(dt, boosting);
  }

  private uprightTorque(k: number) {
    const target = this.v3.set(0, 1, 0); const axis = new THREE.Vector3().crossVectors(this.up, target);
    const w = this.body.angvel();
    this.body.addTorque({ x: axis.x * TUNE.mass * 18 * k - w.x * TUNE.mass * 2.5, y: -w.y * TUNE.mass * 0.6, z: axis.z * TUNE.mass * 18 * k - w.z * TUNE.mass * 2.5 }, true);
  }

  /** custom flight model: hover lift + ground effect, thrust, yaw control, banking and pitch stabilisation */
  private flight(dt: number, boosting: boolean) {
    const I = this.input, T = TUNE, m = T.mass, v = this.vel, f = this.fold;
    const flatF = this.v3.set(this.fwd.x, 0, this.fwd.z).normalize();
    const flatR = new THREE.Vector3(-flatF.z, 0, flatF.x).negate(); // right
    const vF = v.dot(flatF), vR = v.dot(flatR);
    // vertical: hold altitude, climb/descend on input
    const clear = this.groundClearance();
    const vyT = (I.up - I.down) * T.climb * (boosting ? 1.35 : 1);
    const ground = clear < 3 ? (3 - clear) * 9.0 : 0;          // ground-effect cushion
    let fy = m * (9.81 + (vyT - v.y) * 2.6 + ground);
    fy = Math.max(0, fy) * f;
    // forward thrust, quadratic drag, lateral damping (no sideways skating)
    const acc = (boosting ? T.flyBoost : T.flyAccel) * I.throttle;
    const fx = flatF.x * m * acc - v.x * Math.abs(vF) * T.flyDrag * m - flatR.x * vR * T.flyLatDamp * m - flatF.x * vF * 0.08 * m;
    const fz = flatF.z * m * acc - v.z * Math.abs(vF) * T.flyDrag * m - flatR.z * vR * T.flyLatDamp * m - flatF.z * vF * 0.08 * m;
    this.body.addForce({ x: fx * f, y: fy, z: fz * f }, true);
    // attitude: yaw-rate target, bank into turns, nose down when accelerating
    const w = this.body.angvel();
    const yawT = -I.steer * T.yawRate / (1 + Math.abs(vF) / 160);
    const pitchT = -I.throttle * T.pitchK * (boosting ? 1.6 : 1) - THREE.MathUtils.clamp(v.y * 0.006, -0.12, 0.12);
    const rollT = THREE.MathUtils.clamp(-yawT * Math.abs(vF) * 0.012 * T.bank * 10, -0.6, 0.6);
    const yaw = this.yaw;
    const qT = this.q.setFromEuler(new THREE.Euler(pitchT, yaw, rollT, 'YXZ'));
    const upT = new THREE.Vector3(0, 1, 0).applyQuaternion(qT);
    const err = new THREE.Vector3().crossVectors(this.up, upT);
    const kp = m * 26, kd = m * 7;
    this.body.addTorque({ x: (err.x * kp - w.x * kd) * f, y: (yawT - w.y) * m * 3.2 * f, z: (err.z * kp - w.z * kd) * f }, true);
    for (let i = 0; i < 4; i++) this.wheelSpin[i] += dt * 40 * f;
  }

  /** interpolated pose for rendering */
  pose(alpha: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    pos.copy(this.prevPos).lerp(this.pos, alpha); quat.copy(this.prevQuat).slerp(this.quat, alpha);
  }
  afterStep() { this.readState(); }

  respawnAt(x: number, z: number, yaw: number, y = 1) { this.spawn(x, y, z, yaw); }
}
