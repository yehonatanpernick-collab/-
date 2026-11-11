// Character controller shared by the local player (client prediction) and bots (server).
// Body = vertical AABB (feet position x,y,z). Axis-separated collision with step-up.
import { queryBoxes, heightAt, F } from './world.js';
import { MOVE, GRAVITY } from './config.js';

export function makeBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouch: false, h: MOVE.height, r: MOVE.radius, slideT: 0, airT: 0, landV: 0 };
}

function collideAxis(W, b, axis, delta) {
  if (delta === 0) return 0;
  const r = b.r, h = b.h;
  let x0 = b.x - r, x1 = b.x + r, z0 = b.z - r, z1 = b.z + r, y0 = b.y + 0.001, y1 = b.y + h;
  if (axis === 0) { if (delta > 0) x1 += delta; else x0 += delta; }
  else if (axis === 2) { if (delta > 0) z1 += delta; else z0 += delta; }
  else { if (delta > 0) y1 += delta; else y0 += delta; }
  let d = delta;
  queryBoxes(W, x0, z0, x1, z1, F.SOLID, (bx) => {
    if (bx.y1 <= y0 || bx.y0 >= y1) return;
    if (axis !== 0 && (bx.x1 <= b.x - r || bx.x0 >= b.x + r)) return;
    if (axis !== 2 && (bx.z1 <= b.z - r || bx.z0 >= b.z + r)) return;
    if (axis === 1) {
      if (bx.x1 <= b.x - r || bx.x0 >= b.x + r || bx.z1 <= b.z - r || bx.z0 >= b.z + r) return;
      if (d > 0) { const lim = bx.y0 - (b.y + h); if (lim >= -0.01 && lim < d) d = Math.max(0, lim); }
      else { const lim = bx.y1 - b.y; if (lim <= 0.01 && lim > d) d = Math.min(0, lim); }
    } else if (axis === 0) {
      if (d > 0) { const lim = bx.x0 - (b.x + r); if (lim >= -0.01 && lim < d) d = Math.max(0, lim); }
      else { const lim = bx.x1 - (b.x - r); if (lim <= 0.01 && lim > d) d = Math.min(0, lim); }
    } else {
      if (d > 0) { const lim = bx.z0 - (b.z + r); if (lim >= -0.01 && lim < d) d = Math.max(0, lim); }
      else { const lim = bx.z1 - (b.z - r); if (lim <= 0.01 && lim > d) d = Math.min(0, lim); }
    }
  });
  return d;
}

function blockedAt(W, b, x, y, z, h) {
  let hit = false;
  const r = b.r;
  queryBoxes(W, x - r, z - r, x + r, z + r, F.SOLID, (bx) => {
    if (bx.y1 > y + 0.001 && bx.y0 < y + h) { hit = true; return false; }
  });
  return hit;
}

// wish: desired horizontal velocity (wx, wz) already scaled by speed. jump: bool.
export function stepBody(W, b, wx, wz, jump, dt, opts = {}) {
  const accel = b.onGround ? MOVE.accel : MOVE.airAccel;
  // accelerate horizontal velocity toward wish
  const dvx = wx - b.vx, dvz = wz - b.vz;
  const dl = Math.hypot(dvx, dvz);
  if (b.slideT > 0) {
    b.slideT -= dt;
    const f = Math.max(0, 1 - 1.6 * dt);
    b.vx *= f; b.vz *= f;
  } else if (dl > 0) {
    const m = Math.min(dl, accel * dt);
    b.vx += (dvx / dl) * m; b.vz += (dvz / dl) * m;
  }
  if (b.onGround && jump) { b.vy = MOVE.jump; b.onGround = false; b.slideT = 0; }
  b.vy -= GRAVITY * dt;
  if (b.vy < -40) b.vy = -40;

  // crouch height change (only stand up if space)
  const targetH = b.crouch || b.slideT > 0 ? MOVE.crouchHeight : MOVE.height;
  if (targetH > b.h) { if (!blockedAt(W, b, b.x, b.y, b.z, targetH)) b.h = targetH; }
  else b.h = targetH;

  const wasGround = b.onGround;
  // horizontal X
  let mx = b.vx * dt, mz = b.vz * dt;
  const sub = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(mz)) / 0.25));
  mx /= sub; mz /= sub;
  for (let s = 0; s < sub; s++) {
    for (const axis of [0, 2]) {
      const want = axis === 0 ? mx : mz;
      if (want === 0) continue;
      const got = collideAxis(W, b, axis, want);
      if (Math.abs(got - want) > 1e-5) {
        // try step-up
        let stepped = false;
        if (wasGround || b.onGround) {
          const up = MOVE.step;
          if (!blockedAt(W, b, b.x, b.y + up, b.z, b.h)) {
            const ox = b.x, oz = b.z, oy = b.y;
            b.y += up;
            const got2 = collideAxis(W, b, axis, want);
            if (Math.abs(got2) > Math.abs(got) + 1e-4) {
              if (axis === 0) b.x += got2; else b.z += got2;
              // settle down
              const down = collideAxis(W, b, 1, -up - 0.02);
              b.y += down;
              stepped = true;
            } else { b.x = ox; b.z = oz; b.y = oy; }
          }
        }
        if (!stepped) {
          if (axis === 0) { b.x += got; b.vx = 0; mx = 0; } else { b.z += got; b.vz = 0; mz = 0; }
        }
      } else {
        if (axis === 0) b.x += got; else b.z += got;
      }
    }
  }
  // vertical
  const my = b.vy * dt;
  const gy = collideAxis(W, b, 1, my);
  const prevVy = b.vy;
  b.y += gy;
  b.onGround = false;
  if (Math.abs(gy - my) > 1e-5) {
    if (my < 0) { b.onGround = true; }
    b.vy = 0;
  }
  // ground snapping when walking down steps/slopes
  const th = heightAt(W, b.x, b.z);
  if (!b.onGround && wasGround && b.vy <= 0 && !jump && b.slideT <= 0.5) {
    const snap = collideAxis(W, b, 1, -0.6);
    const boxY = snap > -0.59 ? b.y + snap : -1e9;
    const target = Math.max(boxY, th);
    if (b.y - target < 0.6) { b.y = target; b.onGround = true; b.vy = 0; }
  }
  if (b.y <= th) {
    b.y = th; if (b.vy < 0) b.vy = 0; b.onGround = true;
  } else if (!b.onGround && b.y - th < 0.05 && b.vy <= 0) {
    b.onGround = true;
  }
  if (b.onGround && !wasGround) { b.landV = -prevVy; b.airT = 0; } else b.landV = 0;
  if (!b.onGround) b.airT += dt;
  // world bounds hard limit (soft OOB handled by game rules)
  const lim = 470;
  if (b.x < -lim) b.x = -lim; if (b.x > lim) b.x = lim; if (b.z < -lim) b.z = -lim; if (b.z > lim) b.z = lim;
  void opts;
  return b;
}

export function moveSpeed(state) {
  if (state.slide) return MOVE.slideSpeed;
  if (state.crouch) return MOVE.crouch;
  if (state.ads) return MOVE.ads;
  if (state.sprint) return MOVE.sprint;
  return MOVE.walk;
}
