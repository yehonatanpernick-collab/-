// Driving cameras: chase (spring-damped, orbit + zoom, terrain/obstacle aware), bumper, cockpit.
import * as THREE from 'three';

export class DriveCamera {
  constructor(camera, collision) {
    this.cam = camera; this.col = collision;
    this.mode = 0; // 0 chase, 1 bumper, 2 cockpit
    this.dist = 7.2; this.height = 2.4;
    this.yawOff = 0; this.pitchOff = 0; this.idle = 0;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this._g = { h: 0, nx: 0, ny: 1, nz: 0 };
    this.initialized = false;
    this.baseFov = 62;
  }

  cycle() { this.mode = (this.mode + 1) % 3; this.initialized = false; }

  update(dt, phys, model, input) {
    const q = phys.quat, p = phys.pos;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const speed = phys.vel.length();
    const m = input.mouse;
    if (m.dragging && (m.dx || m.dy)) { this.yawOff -= m.dx * 0.005; this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + m.dy * 0.004, -0.35, 0.9); this.idle = 0; }
    else this.idle += dt;
    if (m.wheel) this.dist = THREE.MathUtils.clamp(this.dist * (1 + m.wheel * 0.1), 4, 22);
    if (this.idle > 2.5) { this.yawOff *= 1 - Math.min(1, dt * 1.5); this.pitchOff *= 1 - Math.min(1, dt * 1.5); }

    // rough ground / impacts -> shake
    this.shake = Math.max(this.shake * (1 - dt * 6), phys.impacts * 0.6);
    let rough = 0;
    for (const w of phys.wheels) rough += Math.abs(w.lenVel);
    const shakeAmt = Math.min(0.06, this.shake * 0.1 + rough * 0.0015 * Math.min(1, speed / 10));

    if (this.mode === 0) {
      // follow the velocity direction when moving, the body heading when slow
      const flatF = fwd.clone().setY(0);
      if (speed > 3) { const vf = phys.vel.clone().setY(0); if (vf.lengthSq() > 1) flatF.lerp(vf.normalize(), Math.min(1, (speed - 3) / 12) * 0.6); }
      if (phys.forwardSpeed() < -1) flatF.negate();
      flatF.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOff);
      const target = p.clone().add(new THREE.Vector3(0, 1.25, 0));
      const d = this.dist * (1 + Math.min(0.35, speed / 90));
      const elev = this.height / this.dist + this.pitchOff;
      const desired = target.clone().addScaledVector(flatF, -d * Math.cos(elev)).add(new THREE.Vector3(0, d * Math.sin(elev) + 0.4, 0));
      // keep the line of sight clear of terrain: march from target to camera
      const dir = desired.clone().sub(target); const L = dir.length(); dir.divideScalar(L);
      let ok = L;
      for (let t = 1.5; t < L; t += 0.8) {
        const s = target.clone().addScaledVector(dir, t);
        const g = this.col.ground(s.x, s.z, s.y, this._g);
        if (s.y < g.h + 0.5) { ok = Math.max(2, t - 0.6); break; }
        // trunks and buildings block the view too
        const obs = this.col.near(s.x, s.z);
        let hit = false;
        if (obs) for (const o of obs) {
          if (o.type === 'cyl' && s.y < o.y + o.h && Math.hypot(s.x - o.x, s.z - o.z) < o.r + 0.35) hit = true;
          else if (o.type === 'box' && !o.rail && s.y < o.y + o.hy) {
            const c = Math.cos(o.rot), sn = Math.sin(o.rot);
            const lx = (s.x - o.x) * c - (s.z - o.z) * sn, lz = (s.x - o.x) * sn + (s.z - o.z) * c;
            if (Math.abs(lx) < o.hx + 0.3 && Math.abs(lz) < o.hz + 0.3) hit = true;
          }
        }
        if (hit) { ok = Math.max(2.2, t - 0.5); break; }
      }
      desired.copy(target).addScaledVector(dir, ok);
      const g = this.col.ground(desired.x, desired.z, desired.y, this._g);
      desired.y = Math.max(desired.y, g.h + 0.9);
      if (!this.initialized) { this.pos.copy(desired); this.vel.set(0, 0, 0); this.look.copy(target); this.initialized = true; }
      // critically damped spring
      const k = 38, c = 2 * Math.sqrt(k);
      const acc = desired.clone().sub(this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(acc, dt);
      this.pos.addScaledVector(this.vel, dt);
      const gp = this.col.ground(this.pos.x, this.pos.z, this.pos.y, this._g);
      if (this.pos.y < gp.h + 0.7) this.pos.y = gp.h + 0.7;
      this.look.lerp(target.clone().addScaledVector(fwd, Math.min(4, speed * 0.15)), Math.min(1, dt * 10));
      this.cam.position.copy(this.pos);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this.look);
    } else {
      const local = this.mode === 1 ? new THREE.Vector3(0, 1.05, 1.75) : new THREE.Vector3(0.34, 1.32, -0.12);
      const pos = local.applyQuaternion(model.root.quaternion).add(model.root.position);
      this.cam.position.copy(pos);
      const lookDir = new THREE.Vector3(0, -0.06, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOff).applyQuaternion(model.root.quaternion);
      this.cam.up.copy(up);
      this.cam.lookAt(pos.clone().add(lookDir));
    }
    if (shakeAmt > 0.0005) {
      this.cam.position.x += (Math.random() - 0.5) * shakeAmt;
      this.cam.position.y += (Math.random() - 0.5) * shakeAmt;
    }
    const fov = this.baseFov + Math.min(14, speed * 0.32) + (this.mode === 2 ? 6 : 0);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 3); this.cam.updateProjectionMatrix(); }
  }
}
