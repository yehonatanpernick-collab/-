import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../core/Physics';
import { lookAtAbs } from '../core/lookAtAbs';
import type { Vehicle } from '../vehicle/Vehicle';
import type { WorldData } from '../data/WorldData';

export type CamMode = 'chase' | 'cockpit' | 'far' | 'cinematic';
export const CAM_LABEL: Record<CamMode, string> = { chase: 'Chase', cockpit: 'Cockpit', far: 'Far Chase', cinematic: 'Cinematic' };

/**
 * Camera system: smooth spring chase (driving / flight variants with speed-based distance & FOV,
 * banking, shake), first-person cockpit, far chase and an automatic cinematic director.
 * Camera collision avoidance uses physics ray casts against the streamed city colliders.
 */
export class CameraRig {
  mode: CamMode = 'chase';
  camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yawOff = 0; private pitchOff = 0.18;
  private userIdle = 10;
  private shake = 0;
  private fov = 62;
  private dist = 7.5;
  private cine = { t: 0, shot: 0, from: new THREE.Vector3(), anchor: new THREE.Vector3() };
  private tmp = new THREE.Vector3();
  private initialised = false;
  roll = 0;
  zoom = 1;
  flyover: { pts: THREE.Vector3[]; t: number; dur: number } | null = null;

  constructor(private physics: Physics, private world: WorldData, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.25, 30000);
  }

  cycle(): CamMode {
    const order: CamMode[] = ['chase', 'cockpit', 'far', 'cinematic'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    this.cine.t = 99;
    return this.mode;
  }

  addShake(a: number): void { this.shake = Math.min(1.5, this.shake + a); }

  orbit(dx: number, dy: number, wheel: number): void {
    if (dx || dy) this.userIdle = 0;
    this.yawOff -= dx * 0.004;
    this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + dy * 0.003, -0.35, 1.3);
    if (wheel) this.zoom = THREE.MathUtils.clamp(this.zoom * (wheel > 0 ? 1.1 : 0.9), 0.55, 2.6);
  }

  private collide(from: THREE.Vector3, to: THREE.Vector3, exclude: RAPIER.Collider, excludeBody?: RAPIER.RigidBody): THREE.Vector3 {
    const R = Physics.R;
    const d = this.tmp.subVectors(to, from);
    const len = d.length();
    if (len < 0.01) return to;
    d.divideScalar(len);
    const hit = this.physics.world.castRay(new R.Ray(from, d), len, true, R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined, exclude, excludeBody);
    if (hit && hit.timeOfImpact < len) return from.clone().addScaledVector(d, Math.max(0.6, hit.timeOfImpact - 0.4));
    return to;
  }

  update(dt: number, v: Vehicle): void {
    const cam = this.camera;
    const p = v.renderPosition, q = v.renderQuaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const vel = v.velocity;
    const speed = vel.length();
    const air = v.fold > 0.5;
    this.userIdle += dt;
    if (this.userIdle > 2.5) { this.yawOff *= Math.exp(-dt * 1.8); this.pitchOff += ((air ? 0.22 : 0.16) - this.pitchOff) * (1 - Math.exp(-dt * 1.5)); }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    let targetFov = 62;
    if (this.flyover) { this.updateFlyover(dt); return; }

    if (this.mode === 'cockpit') {
      const eye = v.model.driverEye.clone().applyQuaternion(q).add(p);
      cam.position.copy(eye);
      const lookDir = fwd.clone().applyAxisAngle(up, this.yawOff * 0.8);
      const target = eye.clone().addScaledVector(lookDir, 20).addScaledVector(up, -1.6 + this.pitchOff * -4);
      cam.up.copy(up);
      lookAtAbs(cam, target);
      cam.near = 0.05;
      targetFov = 72 + Math.min(speed, 80) * 0.08;
      this.initialised = false;
    } else if (this.mode === 'cinematic') {
      this.cinematic(dt, v, p, fwd, speed);
      cam.near = 0.25;
      targetFov = 50;
    } else {
      cam.near = 0.25;
      // heading-aligned chase (ignores body pitch/roll on the road, follows velocity in the air)
      let dir = new THREE.Vector3(fwd.x, 0, fwd.z);
      if (air && speed > 15) dir = new THREE.Vector3(vel.x, 0, vel.z).normalize().lerp(dir, 0.5);
      if (!air && this.speedSigned(v) < -2) dir.negate();
      dir.normalize();
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOff);
      const far = this.mode === 'far';
      const baseDist = (air ? 11 : 6.6) * (far ? 2.2 : 1) * this.zoom;
      const dist = baseDist + Math.min(speed, 90) * (air ? 0.06 : 0.035);
      this.dist += (dist - this.dist) * (1 - Math.exp(-dt * 3));
      const h = Math.sin(this.pitchOff) * this.dist + (air ? 1.8 : 1.5);
      const horiz = Math.cos(this.pitchOff) * this.dist;
      const want = p.clone().addScaledVector(dir, -horiz).add(new THREE.Vector3(0, h, 0));
      // keep above terrain
      const g = this.world.heightAt(want.x, want.z) + 1.2;
      if (want.y < g) want.y = g;
      if (!this.initialised) { this.pos.copy(want); this.initialised = true; }
      const stiff = air ? 4.5 : 7;
      this.pos.lerp(want, 1 - Math.exp(-dt * stiff));
      const lookAt = p.clone().add(new THREE.Vector3(0, air ? 1.2 : 1.0, 0)).addScaledVector(fwd, air ? 4 : 2.5);
      this.look.lerp(lookAt, this.look.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 12));
      const from = p.clone().add(new THREE.Vector3(0, 1.4, 0));
      const final = this.collide(from, this.pos, v.collider, v.body);
      cam.position.copy(final);
      // banking in flight
      const rollT = air ? THREE.MathUtils.clamp(-new THREE.Vector3(1, 0, 0).applyQuaternion(q).y, -0.6, 0.6) * 0.45 : 0;
      this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 3));
      cam.up.set(0, 1, 0).applyAxisAngle(dir, this.roll);
      lookAtAbs(cam, this.look);
      targetFov = (air ? 66 : 60) + Math.min(speed, 120) * (air ? 0.17 : 0.2) * (far ? 0.5 : 1);
    }
    // shake (speed buzz + impacts)
    const sh = this.shake * 0.12 + Math.max(0, speed - 40) * 0.0006 * (this.mode === 'cockpit' ? 0.5 : 1);
    if (sh > 0) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 37.1) * sh; cam.position.y += Math.sin(t * 41.7 + 1) * sh; cam.position.z += Math.sin(t * 33.3 + 2) * sh;
    }
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 2.5));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  private speedSigned(v: Vehicle): number { return v.speed; }

  private cinematic(dt: number, v: Vehicle, p: THREE.Vector3, fwd: THREE.Vector3, speed: number): void {
    const c = this.cine, cam = this.camera;
    c.t += dt;
    if (c.t > 7) {
      c.t = 0; c.shot = (c.shot + 1) % 4;
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
      const ahead = Math.max(20, speed * 3.5);
      if (c.shot === 0) c.anchor.copy(p).addScaledVector(fwd, ahead).addScaledVector(side, 9).setY(p.y + 1.2);      // roadside pass-by
      else if (c.shot === 1) c.anchor.copy(p).addScaledVector(side, -14).setY(p.y + 4);                             // tracking side
      else if (c.shot === 2) c.anchor.copy(p).addScaledVector(fwd, ahead * 1.4).setY(p.y + 35);                     // high crane
      else c.anchor.copy(p).addScaledVector(fwd, -9).addScaledVector(side, 3).setY(p.y + 0.7);                      // low rear
      const g = this.world.heightAt(c.anchor.x, c.anchor.z) + 0.8;
      if (c.anchor.y < g) c.anchor.y = g;
      c.from.copy(c.anchor);
    }
    if (c.shot === 1) {
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
      c.from.lerp(p.clone().addScaledVector(side, -14).setY(p.y + 3.5), 1 - Math.exp(-dt * 2));
    } else if (c.shot === 3) {
      c.from.lerp(p.clone().addScaledVector(fwd, -8).setY(p.y + 1.0 + Math.sin(c.t * 0.4) * 0.5), 1 - Math.exp(-dt * 3));
    }
    cam.position.copy(c.from);
    cam.up.set(0, 1, 0);
    this.look.lerp(p.clone().setY(p.y + 0.8), 1 - Math.exp(-dt * 6));
    lookAtAbs(cam, this.look);
  }

  /** Landmark flyover: a smooth Catmull-Rom path through given waypoints. */
  startFlyover(pts: THREE.Vector3[], dur: number): void { this.flyover = { pts, t: 0, dur }; }

  private updateFlyover(dt: number): void {
    const f = this.flyover!;
    f.t += dt;
    const u = Math.min(1, f.t / f.dur);
    const curve = new THREE.CatmullRomCurve3(f.pts, false, 'centripetal');
    const pos = curve.getPointAt(u), ahead = curve.getPointAt(Math.min(1, u + 0.02));
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    lookAtAbs(this.camera, ahead.lerp(f.pts[Math.min(f.pts.length - 1, Math.floor(u * (f.pts.length - 1)) + 1)], 0.3));
    this.camera.fov = 55; this.camera.updateProjectionMatrix();
    if (u >= 1) { this.flyover = null; this.initialised = false; }
  }
}
