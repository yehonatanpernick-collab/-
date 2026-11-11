// Main battle tank physics (shared). Hull follows terrain/low geometry, pushes out of
// solid boxes, and crushes destructible wall panels it drives through.
import { queryBoxes, heightAt, F } from './world.js';
import { TANK } from './config.js';
import { clamp, wrapAngle } from './math.js';

export function makeTank(id, team, x, y, z, yaw) {
  return {
    id, type: 'tank', team, x, y, z, yaw, pitch: 0, roll: 0, speed: 0, turretYaw: yaw, gunPitch: 0,
    hp: TANK.hp, driver: -1, reload: 0, mgCool: 0, alive: true, respawnAt: 0, tread: 0, lastHitBy: -1, hullYawRate: 0,
  };
}

function supportHeight(W, x, z, curY) {
  let h = heightAt(W, x, z);
  queryBoxes(W, x - 0.2, z - 0.2, x + 0.2, z + 0.2, F.SOLID, (b) => {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return;
    if (b.y1 <= curY + 1.25 && b.y1 > h) h = b.y1;
  });
  return h;
}

// inp: { throttle -1..1, steer -1..1, aimYaw, aimPitch }
// onCrush(panelId) called for destructible panels the hull rams through.
export function stepTank(W, t, inp, dt, onCrush) {
  const thr = clamp(inp.throttle || 0, -1, 1), st = clamp(inp.steer || 0, -1, 1);
  // drive
  if (thr > 0.05) t.speed += (t.speed < 0 ? TANK.brake : TANK.accel) * thr * dt;
  else if (thr < -0.05) t.speed += (t.speed > 0 ? TANK.brake : TANK.accel) * thr * dt;
  else { const f = Math.min(Math.abs(t.speed), 5 * dt); t.speed -= Math.sign(t.speed) * f; }
  t.speed = clamp(t.speed, -TANK.maxRev, TANK.maxFwd);
  const turnScale = 0.55 + 0.45 * (1 - Math.min(1, Math.abs(t.speed) / TANK.maxFwd));
  const yr = st * TANK.turn * turnScale * (t.speed < -0.2 ? -1 : 1);
  t.hullYawRate = yr;
  t.yaw = wrapAngle(t.yaw + yr * dt);
  const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
  let nx = t.x + fx * t.speed * dt, nz = t.z + fz * t.speed * dt;
  t.tread += t.speed * dt;

  // collision: two circles along hull
  const R = 1.95;
  for (const off of [1.8, -1.8]) {
    for (let it = 0; it < 2; it++) {
      const cx = nx + fx * off, cz = nz + fz * off;
      queryBoxes(W, cx - R, cz - R, cx + R, cz + R, F.SOLID, (b) => {
        if (b.y1 <= t.y + 1.25 || b.y0 >= t.y + 2.8) return;
        const px = clamp(cx, b.x0, b.x1), pz = clamp(cz, b.z0, b.z1);
        let dx = cx - px, dz = cz - pz;
        let d = Math.hypot(dx, dz);
        if (d >= R) return;
        if (b.panel >= 0 && W.panels[b.panel].alive && Math.abs(t.speed) > 2.2 && W.panels[b.panel].maxHp < 400) {
          if (onCrush) onCrush(b.panel);
          t.speed *= 0.82;
          return;
        }
        if (d < 1e-4) { // center inside box: push along smallest axis
          const l = cx - b.x0, r = b.x1 - cx, u = cz - b.z0, v = b.z1 - cz;
          const m = Math.min(l, r, u, v);
          if (m === l) { dx = -1; dz = 0; d = 0; nx -= l + R; }
          else if (m === r) { nx += r + R; }
          else if (m === u) { nz -= u + R; }
          else { nz += v + R; }
        } else {
          const push = R - d;
          nx += (dx / d) * push; nz += (dz / d) * push;
        }
        t.speed *= 0.6;
      });
    }
  }
  t.x = nx; t.z = nz;
  // terrain following
  const L = 3.0, Wd = 1.6;
  const rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw); // right vector
  const hf = supportHeight(W, t.x + fx * L, t.z + fz * L, t.y);
  const hb = supportHeight(W, t.x - fx * L, t.z - fz * L, t.y);
  const hl = supportHeight(W, t.x - rx * Wd, t.z - rz * Wd, t.y);
  const hr = supportHeight(W, t.x + rx * Wd, t.z + rz * Wd, t.y);
  const hc = supportHeight(W, t.x, t.z, t.y);
  const targetY = Math.max(hc, (hf + hb + hl + hr) / 4);
  t.y += (targetY - t.y) * Math.min(1, dt * 10);
  const tp = Math.atan2(hf - hb, 2 * L), tr = Math.atan2(hr - hl, 2 * Wd);
  t.pitch += (tp - t.pitch) * Math.min(1, dt * 6);
  t.roll += (tr - t.roll) * Math.min(1, dt * 6);
  // turret / gun
  if (inp.aimYaw != null) {
    const dy = wrapAngle(inp.aimYaw - t.turretYaw);
    const mx = TANK.turretSpeed * dt;
    t.turretYaw = wrapAngle(t.turretYaw + clamp(dy, -mx, mx) + yr * dt * 0);
    const gp = clamp(inp.aimPitch - t.pitch * Math.cos(t.turretYaw - t.yaw), TANK.gunMin, TANK.gunMax);
    t.gunPitch += clamp(gp - t.gunPitch, -0.6 * dt, 0.6 * dt);
  }
  t.reload = Math.max(0, t.reload - dt);
  t.mgCool = Math.max(0, t.mgCool - dt);
  const lim = 460;
  t.x = clamp(t.x, -lim, lim); t.z = clamp(t.z, -lim, lim);
  return t;
}

// world-space muzzle position + direction of the main gun
export function tankMuzzle(t, out = { o: [0, 0, 0], d: [0, 0, 0] }) {
  const pitch = t.gunPitch + t.pitch * Math.cos(t.turretYaw - t.yaw);
  const cp = Math.cos(pitch);
  const dx = -Math.sin(t.turretYaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(t.turretYaw) * cp;
  const px = t.x, py = t.y + 2.45, pz = t.z;
  out.o[0] = px + dx * 5.9; out.o[1] = py + dy * 5.9; out.o[2] = pz + dz * 5.9;
  out.d[0] = dx; out.d[1] = dy; out.d[2] = dz;
  return out;
}
export function tankMg(t, out = { o: [0, 0, 0], d: [0, 0, 0] }) {
  const m = tankMuzzle(t, out);
  const rx = Math.cos(t.turretYaw), rz = -Math.sin(t.turretYaw);
  m.o[0] = t.x + rx * 0.45 + m.d[0] * 2.4; m.o[1] = t.y + 2.4 + m.d[1] * 2.4; m.o[2] = t.z + rz * 0.45 + m.d[2] * 2.4;
  return m;
}
