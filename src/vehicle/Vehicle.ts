import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../core/Physics';
import type { ControlState } from '../core/Input';
import type { WorldData } from '../data/WorldData';
import { Surface } from '../data/WorldData';
import type { RoadGraph } from '../ai/RoadGraph';
import { VehicleModel } from './VehicleModel';
import { U } from '../core/Uniforms';

export type VState = 'driving' | 'preparingFlight' | 'transformingToFlight' | 'flight' | 'preparingLanding' | 'transformingToDriving' | 'emergency';

export const STATE_LABEL: Record<VState, string> = {
  driving: 'DRIVE', preparingFlight: 'PRE-FLIGHT', transformingToFlight: 'TRANSFORMING', flight: 'FLIGHT',
  preparingLanding: 'LANDING', transformingToDriving: 'TRANSFORMING', emergency: 'STABILIZING',
};

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

/**
 * Player vehicle simulation.
 *  - Driving: Rapier DynamicRayCastVehicleController (per-wheel raycasts, spring/damper suspension,
 *    tyre friction & slip) + electric-motor torque curve, AWD, regenerative braking, aerodynamic drag,
 *    downforce, speed-sensitive steering, stability control, surface-dependent grip.
 *  - Flight: force/torque model on the same rigid body (hover thrust with vertical-speed control,
 *    vectored forward thrust, quadratic body-frame drag, aerodynamic lift, attitude PD controller with
 *    banking, ground cushion, emergency stabilisation).
 *  - Transformation state machine keeps the visual animation and the physics mode in lock-step.
 */
export class Vehicle {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  vc!: RAPIER.DynamicRayCastVehicleController;
  model = new VehicleModel();
  state: VState = 'driving';
  stateT = 0;
  fold = 0;           // 0 road wheels … 1 flight turbines
  hover = 0;          // hover thrust authority 0..1
  glow = 0;
  battery = 0.92;
  mass = 1850;
  steerAngle = 0;
  wheelSpin = [0, 0, 0, 0];
  suspension = [0, 0, 0, 0];
  thrustLevel = 0;
  brakeLight = 0;
  speed = 0;          // m/s signed forward
  agl = 0;            // height above ground
  slip = 0;           // tyre slip 0..1 (audio)
  onRoad = true;
  grounded = true;
  lastImpact = 0;
  private headingTarget = 0;
  private prevPos = new THREE.Vector3();
  private curPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private curRot = new THREE.Quaternion();
  private surfaceTimer = 0;
  private gripMul = 1;
  private lastVel = new THREE.Vector3();
  readonly wheelPos: [number, number][] = [];
  onStateChange?: (s: VState) => void;
  onImpact?: (strength: number) => void;
  readonly I = new THREE.Vector3(3150, 3500, 800); // pitch(x), yaw(y), roll(z)

  constructor(private physics: Physics, private world: WorldData, private graph: RoadGraph, private hasGround: (x: number, z: number) => boolean) {}

  async init(url: string): Promise<void> {
    await this.model.load(url);
    const R = Physics.R;
    const w = this.physics.world;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(0, 50, 0).setCcdEnabled(true).setCanSleep(false)
      .setAngularDamping(0.25).setLinearDamping(0.0);
    this.body = w.createRigidBody(bd);
    const main = R.ColliderDesc.cuboid(0.9, 0.3, 2.12).setTranslation(0, 0.62, 0.08).setFriction(0.4).setRestitution(0.1)
      .setMassProperties(this.mass, { x: 0, y: 0.48, z: 0.08 }, { x: this.I.x, y: this.I.y, z: this.I.z }, { x: 0, y: 0, z: 0, w: 1 })
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
    this.collider = w.createCollider(main, this.body);
    w.createCollider(R.ColliderDesc.cuboid(0.68, 0.2, 1.05).setTranslation(0, 1.0, -0.25).setDensity(0).setFriction(0.3), this.body);
    this.vc = w.createVehicleController(this.body);
    this.vc.indexUpAxis = 1;
    this.vc.setIndexForwardAxis = 2;
    const wb = this.model.wheels;
    for (let i = 0; i < 4; i++) {
      const base = wb[i]?.base ?? new THREE.Vector3(i % 2 ? -0.84 : 0.84, 0.36, i < 2 ? 1.45 : -1.31);
      const rest = 0.3;
      this.vc.addWheel({ x: base.x * 0.98, y: base.y + rest - 0.06, z: base.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, this.model.wheelRadius);
      this.vc.setWheelSuspensionStiffness(i, 36);
      this.vc.setWheelSuspensionCompression(i, 3.2);
      this.vc.setWheelSuspensionRelaxation(i, 3.6);
      this.vc.setWheelMaxSuspensionForce(i, 120000);
      this.vc.setWheelMaxSuspensionTravel(i, 0.22);
      this.vc.setWheelFrictionSlip(i, 2.7);
      this.vc.setWheelSideFrictionStiffness(i, 1.0);
      this.wheelPos.push([base.x, base.z]);
    }
  }

  get position(): THREE.Vector3 { const t = this.body.translation(); return _v.set(t.x, t.y, t.z); }
  get flying(): boolean { return this.state !== 'driving'; }
  get isAirMode(): boolean { return this.fold > 0.5; }

  spawn(x: number, z: number, heading: number, y?: number): void {
    const gy = y ?? this.groundHeight(x, z, 500);
    this.body.setTranslation({ x, y: gy + 0.6, z }, true);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.headingTarget = heading;
    this.setState('driving'); this.fold = 0; this.hover = 0; this.glow = 0;
    this.snapshot(); this.snapshot();
  }

  /** place the car on the nearest real road, aligned with it */
  resetToRoad(): void {
    const p = this.position;
    const n = this.graph.nearest(p.x, p.z, 400, (e) => e.cls <= 5 && !e.tunnel);
    if (!n) { this.spawn(p.x, p.z, 0); return; }
    const e = this.graph.edges[n.edge];
    const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
    this.graph.sample(e, n.s, o);
    const lane = e.oneway ? 0 : e.w / 4;
    const x = o.x - o.tz * lane, z = o.z + o.tx * lane;
    this.spawn(x, z, Math.atan2(o.tx, o.tz), e.el ? o.y + 0.1 : undefined);
  }

  /** ground (terrain, roofs, bridge decks) height under a point using a physics ray, falling back to the DEM */
  groundHeight(x: number, z: number, from = 3): number {
    const R = Physics.R;
    const top = (this.body ? this.body.translation().y : 0) + from;
    const ray = new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(ray, 1200, true, R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined, this.collider, this.body);
    const dem = Math.max(this.world.heightAt(x, z), 0);
    if (hit) return Math.max(top - hit.timeOfImpact, dem - 50);
    return dem;
  }

  setState(s: VState): void {
    if (this.state === s) return;
    this.state = s; this.stateT = 0;
    this.onStateChange?.(s);
  }

  /** F key: request a transformation; invalid/conflicting requests are ignored */
  toggleTransform(): boolean {
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    switch (this.state) {
      case 'driving':
        if (sp > 45) return false;
        this.setState('preparingFlight'); return true;
      case 'flight':
      case 'emergency':
        this.setState('preparingLanding'); return true;
      case 'preparingLanding':
        this.setState('flight'); return true; // abort landing
      default:
        return false; // mid-transformation: ignore
    }
  }

  private snapshot(): void {
    this.prevPos.copy(this.curPos); this.prevRot.copy(this.curRot);
    const t = this.body.translation(), r = this.body.rotation();
    this.curPos.set(t.x, t.y, t.z); this.curRot.set(r.x, r.y, r.z, r.w);
  }

  // ------------------------------------------------------------------ fixed-step simulation
  step(dt: number, c: ControlState): void {
    const R = Physics.R;
    this.stateT += dt;
    // Rapier user forces persist between steps: clear them every fixed step
    this.body.resetForces(true);
    this.body.resetTorques(true);
    const t = this.body.translation(), r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _f.set(0, 0, 1).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);
    const lv = this.body.linvel(), av = this.body.angvel();
    const vel = _v.set(lv.x, lv.y, lv.z);
    this.speed = vel.dot(_f);
    const ground = this.groundHeight(t.x, t.z, 1.5);
    this.agl = t.y - ground;

    // world-not-ready guard: hold the car if no collider exists under it yet
    if (!this.hasGround(t.x, t.z) && this.state === 'driving') {
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setTranslation({ x: t.x, y: Math.max(t.y, this.world.heightAt(t.x, t.z) + 0.5), z: t.z }, true);
      this.snapshot();
      return;
    }
    // never fall below the terrain (streaming safety net)
    const dem = this.world.heightAt(t.x, t.z);
    if (t.y < dem - 2.5 && dem > 0) this.body.setTranslation({ x: t.x, y: dem + 1.0, z: t.z }, true);
    if (t.y < -6) { this.resetToRoad(); return; }

    this.updateStateMachine(dt);

    // ---------------- wheels / driving
    const useWheels = this.fold < 0.5;
    if (useWheels) this.driveForces(dt, c, vel, av);
    else for (let i = 0; i < 4; i++) { this.vc.setWheelEngineForce(i, 0); this.vc.setWheelBrake(i, 0); }
    if (useWheels) this.vc.updateVehicle(dt, R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    this.grounded = useWheels && [0, 1, 2, 3].some((i) => this.vc.wheelIsInContact(i));

    // ---------------- flight
    if (this.hover > 0.001) this.flightForces(dt, c, vel, av);

    // ---------------- stabilisation for an airborne car in drive mode (jumps off SF hills)
    if (this.state === 'driving' && !this.grounded) {
      const w = new THREE.Vector3(av.x, av.y, av.z);
      const lvl = new THREE.Vector3().crossVectors(_u, new THREE.Vector3(0, 1, 0)).multiplyScalar(2200);
      this.body.addTorque({ x: lvl.x - w.x * 900, y: -w.y * 300, z: lvl.z - w.z * 900 }, true);
    }

    // battery model (kWh-ish normalised): propulsion power draw, regen when braking
    const power = useWheels ? Math.abs(c.throttle) * Math.abs(this.speed) * 0.000002 : (0.000012 + c.throttle * 0.00001) * this.hover;
    this.battery = Math.max(0.03, Math.min(1, this.battery - power * dt * 60 + (c.brake > 0 && useWheels ? Math.abs(this.speed) * 0.0000008 : 0)));
    // impact detection from velocity change
    const dv = vel.clone().sub(this.lastVel).length();
    if (dv > 6 && performance.now() - this.lastImpact > 400) { this.lastImpact = performance.now(); this.onImpact?.(Math.min(1, dv / 25)); }
    this.lastVel.copy(vel);
  }

  /** called after world.step() */
  postStep(): void { this.snapshot(); }

  private updateStateMachine(dt: number): void {
    const s = this.state;
    if (s === 'preparingFlight') {
      this.glow = Math.min(0.4, this.glow + dt * 1.5);
      if (this.stateT > 0.35) this.setState('transformingToFlight');
    } else if (s === 'transformingToFlight') {
      this.fold = Math.min(1, this.fold + dt / 1.6);
      this.glow = Math.min(1, this.glow + dt);
      this.hover = THREE.MathUtils.smoothstep(this.fold, 0.15, 0.55);
      if (this.fold >= 1) this.setState('flight');
    } else if (s === 'flight' || s === 'emergency') {
      this.fold = 1; this.hover = 1; this.glow = 1;
      if (s === 'emergency' && this.stateT > 1.6) this.setState('flight');
      if (this.battery <= 0.031) this.setState('preparingLanding');
    } else if (s === 'preparingLanding') {
      this.hover = 1;
      if (this.agl < 1.7) this.setState('transformingToDriving');
      if (this.stateT > 45) this.setState('transformingToDriving');
    } else if (s === 'transformingToDriving') {
      this.fold = Math.max(0, this.fold - dt / 1.3);
      this.hover = THREE.MathUtils.smoothstep(this.fold, 0.2, 0.7);
      this.glow = Math.max(0, this.glow - dt * 0.8);
      if (this.fold <= 0) { this.hover = 0; this.glow = 0; this.setState('driving'); }
    } else {
      this.fold = 0; this.hover = 0; this.glow = Math.max(0, this.glow - dt);
    }
  }

  private driveForces(dt: number, c: ControlState, vel: THREE.Vector3, av: RAPIER.Vector): void {
    const v = this.speed, av_ = Math.abs(v);
    // surface & road detection (throttled)
    this.surfaceTimer -= dt;
    if (this.surfaceTimer <= 0) {
      this.surfaceTimer = 0.25;
      const t = this.body.translation();
      const near = this.graph.nearest(t.x, t.z, 25);
      this.onRoad = !!near && near.d < this.graph.edges[near.edge].w / 2 + 3.5;
      const s = this.world.surfaceAt(t.x, t.z);
      const offroadGrip = s === Surface.Sand ? 0.55 : s === Surface.Grass || s === Surface.Golf || s === Surface.Forest || s === Surface.Scrub ? 0.7 : 0.85;
      this.gripMul = this.onRoad ? 1 - U.wet.value * 0.22 : offroadGrip;
    }
    // electric motor: constant torque then constant power
    const boost = c.boost ? 1.45 : 1;
    const Fmax = 15500 * boost, P = 520000 * boost;
    let drive = 0;
    let brake = 0;
    if (c.throttle > 0) drive = c.throttle * Math.min(Fmax, P / Math.max(av_, 1));
    if (c.brake > 0) {
      if (v > 1.0) brake = c.brake * 95;
      else drive = -c.brake * 7000; // reverse
    }
    if (v < -1.0 && c.throttle > 0) { brake = c.throttle * 95; drive = 0; }
    // speed limiter (top speed ~ 250 km/h, 290 with boost)
    const vmax = c.boost ? 80 : 69;
    if (v > vmax) drive = Math.min(drive, 0);
    // coasting regen / rolling resistance
    if (c.throttle === 0 && c.brake === 0 && av_ > 0.5) brake = 2.5;
    const front = 0.42, rear = 0.58; // AWD torque split
    this.vc.setWheelEngineForce(0, drive * front / 2); this.vc.setWheelEngineForce(1, drive * front / 2);
    this.vc.setWheelEngineForce(2, drive * rear / 2); this.vc.setWheelEngineForce(3, drive * rear / 2);
    const hb = c.handbrake ? 120 : 0;
    this.vc.setWheelBrake(0, brake); this.vc.setWheelBrake(1, brake);
    this.vc.setWheelBrake(2, brake + hb); this.vc.setWheelBrake(3, brake + hb);
    this.brakeLight = c.brake > 0 && v > 0.5 ? 1 : c.handbrake ? 0.7 : 0;
    // speed-sensitive steering with smoothing
    const maxSteer = 0.58 / (1 + av_ / 16);
    const target = -c.steer * maxSteer;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 9);
    this.vc.setWheelSteering(0, this.steerAngle); this.vc.setWheelSteering(1, this.steerAngle);
    // grip (weight-transfer aware: more front grip under braking, rear under acceleration)
    const g = 2.7 * this.gripMul;
    const longT = (drive / 15500) * 0.12 - (brake / 95) * 0.15;
    this.vc.setWheelFrictionSlip(0, g * (1 - longT)); this.vc.setWheelFrictionSlip(1, g * (1 - longT));
    this.vc.setWheelFrictionSlip(2, g * (1 + longT) * (c.handbrake ? 0.45 : 1)); this.vc.setWheelFrictionSlip(3, g * (1 + longT) * (c.handbrake ? 0.45 : 1));
    this.vc.setWheelSideFrictionStiffness(2, c.handbrake ? 0.35 : 1); this.vc.setWheelSideFrictionStiffness(3, c.handbrake ? 0.35 : 1);
    // aerodynamic drag + downforce
    const sp2 = vel.lengthSq();
    const drag = vel.clone().multiplyScalar(-0.5 * 1.225 * 0.62 * Math.sqrt(sp2));
    const down = _u.clone().multiplyScalar(-1.1 * sp2 * (this.grounded ? 1 : 0));
    this.body.addForce({ x: drag.x + down.x, y: drag.y + down.y, z: drag.z + down.z }, true);
    // stability control: limit yaw rate to what the steering asks for (unless drifting with handbrake)
    if (this.grounded && av_ > 4 && !c.handbrake) {
      const wheelbase = 2.8;
      const desired = (v * Math.tan(this.steerAngle)) / wheelbase;
      const yawRate = av.x * _u.x + av.y * _u.y + av.z * _u.z;
      const err = yawRate - desired;
      if (Math.abs(err) > 0.25) {
        const k = -Math.sign(err) * (Math.abs(err) - 0.25) * 2600;
        this.body.addTorque({ x: _u.x * k, y: _u.y * k, z: _u.z * k }, true);
      }
    }
    // anti-roll bar (roll damping)
    const rollRate = av.x * _f.x + av.y * _f.y + av.z * _f.z;
    this.body.addTorque({ x: -_f.x * rollRate * 900, y: -_f.y * rollRate * 900, z: -_f.z * rollRate * 900 }, true);
    // tyre slip estimate for audio/vfx
    let side = 0;
    for (let i = 0; i < 4; i++) side += Math.abs(this.vc.wheelSideImpulse(i) ?? 0);
    const lat = Math.abs(vel.dot(_r));
    this.slip = Math.min(1, Math.max(lat > 3 ? (lat - 3) / 8 : 0, c.handbrake && av_ > 5 ? 0.7 : 0, side * 0));
    // wheel visuals
    for (let i = 0; i < 4; i++) {
      this.wheelSpin[i] = this.vc.wheelRotation(i) ?? 0;
      const sl = this.vc.wheelSuspensionLength(i) ?? 0.24;
      this.suspension[i] = 0.24 - sl;
    }
  }

  private flightForces(dt: number, c: ControlState, vel: THREE.Vector3, av: RAPIER.Vector): void {
    const m = this.mass, g = 9.81, h = this.hover;
    const t = this.body.translation();
    const boost = c.boost ? 2.3 : 1;
    const vf = vel.dot(_f), vr = vel.dot(_r), vu = vel.dot(_u);
    const speedH = Math.hypot(vel.x, vel.z);
    // --- vertical: hover thrust with vertical-speed controller
    let vyTarget = c.lift * 16;
    const pitchNow = Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1));
    vyTarget += Math.max(-25, Math.min(25, vf * Math.sin(pitchNow) * 0.9));
    if (this.state === 'transformingToFlight') vyTarget = Math.max(vyTarget, this.agl < 4 ? 3.2 : 0.6);
    if (this.state === 'preparingLanding') vyTarget = -Math.min(9, Math.max(1.3, this.agl * 0.25));
    if (this.state === 'transformingToDriving') vyTarget = -1.0;
    if (this.state === 'emergency') vyTarget = Math.max(0, vyTarget);
    // ground cushion
    if (this.agl < 3 && vel.y < 0 && this.state !== 'transformingToDriving') vyTarget = Math.max(vyTarget, -1.2);
    // ceiling (thin air above 1500 m)
    if (t.y > 1500) vyTarget = Math.min(vyTarget, -2);
    const ay = THREE.MathUtils.clamp((vyTarget - vel.y) * 2.4, -9, 16);
    const upY = Math.max(_u.y, 0.35);
    const lift = (m * (g + ay) * h) / upY;
    // --- forward thrust (rear vectoring thrusters) and air brake
    const thrust = (c.throttle * m * 15 * boost - c.brake * m * 9 * Math.sign(vf || 1)) * h;
    this.thrustLevel = THREE.MathUtils.clamp(c.throttle * (c.boost ? 1 : 0.7) + Math.abs(ay) * 0.03, 0, 1) * h;
    // --- aerodynamic drag in body frame (streamlined forward, draggy sideways/vertically)
    const rho = 1.225;
    const Ff = -0.5 * rho * 0.75 * vf * Math.abs(vf);
    const Fr = -0.5 * rho * 7.5 * vr * Math.abs(vr) - m * 0.9 * vr;
    const Fu = -0.5 * rho * 5.0 * vu * Math.abs(vu);
    // hover station-keeping at low speed with no input
    const keep = (c.throttle === 0 && c.brake === 0 && speedH < 12) ? m * 0.8 : 0;
    const F = new THREE.Vector3()
      .addScaledVector(_u, lift)
      .addScaledVector(_f, thrust + Ff)
      .addScaledVector(_r, Fr)
      .addScaledVector(_u, Fu);
    F.x -= keep * vel.x * h; F.z -= keep * vel.z * h;
    this.body.addForce({ x: F.x, y: F.y, z: F.z }, true);

    // --- attitude controller (target yaw heading, bank and pitch)
    const heading = Math.atan2(_f.x, _f.z);
    const yawRateCmd = -c.yaw * (1.5 - Math.min(speedH, 90) / 90 * 0.8);
    this.headingTarget += yawRateCmd * dt;
    let dh = this.headingTarget - heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    if (Math.abs(dh) > 0.6) { this.headingTarget = heading + Math.sign(dh) * 0.6; dh = Math.sign(dh) * 0.6; }
    const bank = c.yaw * 0.62 * Math.min(1, 0.25 + speedH / 30);
    let pitchT = -c.pitch * 0.5 + c.lift * 0.1 - c.throttle * 0.05 + c.brake * 0.08;
    if (this.state === 'emergency') pitchT = 0;
    const qd = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitchT, this.headingTarget, this.state === 'emergency' ? 0 : bank, 'YXZ'));
    const qc = new THREE.Quaternion(this.body.rotation().x, this.body.rotation().y, this.body.rotation().z, this.body.rotation().w);
    const qe = qd.clone().multiply(qc.clone().invert());
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const angle = 2 * Math.acos(Math.min(1, qe.w));
    const s = Math.sqrt(1 - qe.w * qe.w) || 1;
    const err = new THREE.Vector3(qe.x / s, qe.y / s, qe.z / s).multiplyScalar(angle);
    const kp = this.state === 'emergency' ? 26 : 11, kd = this.state === 'emergency' ? 9 : 5.2;
    const alpha = err.multiplyScalar(kp).sub(new THREE.Vector3(av.x, av.y, av.z).multiplyScalar(kd)).multiplyScalar(h);
    // world → body, scale by principal inertia, back to world
    const qi = qc.clone().invert();
    const aLocal = alpha.clone().applyQuaternion(qi);
    aLocal.set(aLocal.x * this.I.x, aLocal.y * this.I.y, aLocal.z * this.I.z);
    const tau = aLocal.applyQuaternion(qc);
    this.body.addTorque({ x: tau.x, y: tau.y, z: tau.z }, true);
    this.steerAngle *= 0.9;
    // emergency trigger: tumbling or nearly inverted
    const tumble = Math.hypot(av.x, av.y, av.z);
    if ((this.state === 'flight') && (_u.y < 0.3 || tumble > 4.5)) this.setState('emergency');
    for (let i = 0; i < 4; i++) this.wheelSpin[i] += dt * 2;
  }

  // ------------------------------------------------------------------ render sync
  updateVisual(alpha: number, dt: number): void {
    const p = new THREE.Vector3().lerpVectors(this.prevPos, this.curPos, alpha);
    const q = new THREE.Quaternion().slerpQuaternions(this.prevRot, this.curRot, alpha);
    this.model.root.position.copy(p);
    this.model.root.quaternion.copy(q);
    this.model.animate(dt, this.steerAngle, this.wheelSpin, this.suspension, this.fold, this.glow, this.thrustLevel, this.brakeLight, U.night.value);
  }

  get renderPosition(): THREE.Vector3 { return this.model.root.position; }
  get renderQuaternion(): THREE.Quaternion { return this.model.root.quaternion; }
  get velocity(): THREE.Vector3 { const v = this.body.linvel(); return new THREE.Vector3(v.x, v.y, v.z); }
}
