// Deterministic first-person character controller.
// Runs identically on the server (authoritative) and on the client (prediction):
// one call == one fixed-timestep command.
import { PLAYER } from './config';
import { clamp } from './math';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_SPRINT, BTN_TAC, type Cmd, type PlayerState } from './types';
import { F_SOLID, type World } from './world/World';

export interface DynBox { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export interface MoveParams {
  /** Class + weapon speed multiplier. */
  speedMul: number;
  /** Speed factor at full ADS. */
  adsMoveFactor: number;
  /** Additional temporary multiplier (stim etc). */
  boost: number;
}

const R = PLAYER.RADIUS;
const SKIN = 0.002;
const EPS = 0.0015;
const scratch: number[] = [];

// Result of the last probe() call.
const P = { hit: false, top: 0, bottom: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

function probe(world: World, extra: readonly DynBox[] | null, x: number, y: number, z: number, h: number): boolean {
  const minX = x - R, maxX = x + R, minZ = z - R, maxZ = z + R, minY = y + SKIN, maxY = y + h;
  const n = world.query(minX, minY, minZ, maxX, maxY, maxZ, F_SOLID, scratch);
  P.hit = false; P.top = -Infinity; P.bottom = Infinity;
  P.minX = Infinity; P.maxX = -Infinity; P.minZ = Infinity; P.maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = scratch[k];
    if (i >= 0) {
      const b = world.boxes[i];
      P.hit = true;
      if (b.maxY > P.top) P.top = b.maxY;
      if (b.minY < P.bottom) P.bottom = b.minY;
      if (b.minX < P.minX) P.minX = b.minX;
      if (b.maxX > P.maxX) P.maxX = b.maxX;
      if (b.minZ < P.minZ) P.minZ = b.minZ;
      if (b.maxZ > P.maxZ) P.maxZ = b.maxZ;
    } else {
      const r = world.ramps[-1 - i];
      const hgt = world.rampHeight(r, x, z);
      if (hgt > minY) {
        P.hit = true;
        if (hgt > P.top) P.top = hgt;
        if (r.y0 < P.bottom) P.bottom = r.y0;
        if (r.minX < P.minX) P.minX = r.minX;
        if (r.maxX > P.maxX) P.maxX = r.maxX;
        if (r.minZ < P.minZ) P.minZ = r.minZ;
        if (r.maxZ > P.maxZ) P.maxZ = r.maxZ;
      }
    }
  }
  if (extra) {
    for (let k = 0; k < extra.length; k++) {
      const b = extra[k];
      if (b.minX < maxX && b.maxX > minX && b.minZ < maxZ && b.maxZ > minZ && b.minY < maxY && b.maxY > minY) {
        P.hit = true;
        if (b.maxY > P.top) P.top = b.maxY;
        if (b.minY < P.bottom) P.bottom = b.minY;
        if (b.minX < P.minX) P.minX = b.minX;
        if (b.maxX > P.maxX) P.maxX = b.maxX;
        if (b.minZ < P.minZ) P.minZ = b.minZ;
        if (b.maxZ > P.maxZ) P.maxZ = b.maxZ;
      }
    }
  }
  return P.hit;
}

/** Highest supporting surface within `depth` below the feet, or -Infinity. */
export function findFloor(world: World, extra: readonly DynBox[] | null, x: number, y: number, z: number, depth: number): number {
  const minX = x - R, maxX = x + R, minZ = z - R, maxZ = z + R;
  const lo = y - depth, hi = y + SKIN * 2;
  const n = world.query(minX, lo, minZ, maxX, hi, maxZ, F_SOLID, scratch);
  let best = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = scratch[k];
    if (i >= 0) {
      const t = world.boxes[i].maxY;
      if (t <= hi && t >= lo && t > best) best = t;
    } else {
      const t = world.rampHeight(world.ramps[-1 - i], x, z);
      if (t <= hi && t >= lo && t > best) best = t;
    }
  }
  if (extra) {
    for (let k = 0; k < extra.length; k++) {
      const b = extra[k];
      if (b.minX < maxX && b.maxX > minX && b.minZ < maxZ && b.maxZ > minZ && b.maxY <= hi && b.maxY >= lo && b.maxY > best) best = b.maxY;
    }
  }
  return best;
}

function accelerate(s: PlayerState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  s.vx += wx * a;
  s.vz += wz * a;
}

export function playerHeight(s: PlayerState): number {
  return s.crouching ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
}

export function eyeHeight(s: PlayerState): number {
  return s.slideT > 0 ? PLAYER.SLIDE_EYE : s.crouching ? PLAYER.CROUCH_EYE : PLAYER.EYE;
}

function tryStep(s: PlayerState, world: World, extra: readonly DynBox[] | null, nx: number, nz: number, h: number): boolean {
  const stepH = P.top - s.y;
  if (stepH < -1e-3 || stepH > PLAYER.STEP_HEIGHT + 1e-3) return false;
  if (!s.grounded && stepH > 0.3) return false;
  const top = P.top;
  if (probe(world, extra, nx, top, nz, h)) return false;
  s.x = nx; s.z = nz; s.y = top;
  return true;
}

/** Advance one command. Mutates `s`. */
export function stepMove(s: PlayerState, cmd: Cmd, dt: number, world: World, params: MoveParams, extra: readonly DynBox[] | null = null): void {
  const btn = cmd.buttons;
  s.landSpeed = 0;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;

  const wantCrouch = (btn & BTN_CROUCH) !== 0;
  const crouchPressed = wantCrouch && !s.crouchLatch;
  s.crouchLatch = wantCrouch;
  const wantJump = (btn & BTN_JUMP) !== 0;
  const jumpPressed = wantJump && !s.jumpLatch;
  s.jumpLatch = wantJump;

  let mx = clamp(cmd.mx, -1, 1), mz = clamp(cmd.mz, -1, 1);
  let mlen = Math.hypot(mx, mz);
  if (mlen > 1) { mx /= mlen; mz /= mlen; mlen = 1; }
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  let wx = -sy * mz + cy * mx;
  let wz = -cy * mz - sy * mx;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-5) { wx /= wl; wz /= wl; }

  let hSpeed = Math.hypot(s.vx, s.vz);
  if (s.slideCd > 0) s.slideCd = Math.max(0, s.slideCd - dt);

  // ---------------------------------------------------------------- slide
  if (crouchPressed && s.sprinting && s.grounded && s.slideT <= 0 && s.slideCd <= 0 && hSpeed >= PLAYER.SLIDE_MIN_SPEED) {
    s.slideT = PLAYER.SLIDE_TIME;
    const boost = Math.max(hSpeed, PLAYER.SLIDE_BOOST_SPEED) / hSpeed;
    s.vx *= boost; s.vz *= boost;
    hSpeed *= boost;
  }
  const sliding = s.slideT > 0;

  // ---------------------------------------------------------------- stance
  const wasCrouching = s.crouching;
  let crouching = wantCrouch || sliding;
  if (!crouching && wasCrouching) {
    // need head room to stand up
    if (world.overlaps(s.x - R, s.y + PLAYER.CROUCH_HEIGHT, s.z - R, s.x + R, s.y + PLAYER.HEIGHT, s.z + R, F_SOLID)) crouching = true;
  }
  s.crouching = crouching;
  const h = crouching ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;

  // ---------------------------------------------------------------- sprint
  const sprint = (btn & BTN_SPRINT) !== 0 && mz > 0.5 && !crouching && (btn & (BTN_ADS | BTN_FIRE)) === 0;
  s.sprinting = sprint;
  s.tac = sprint && (btn & BTN_TAC) !== 0 && s.tacT > 0;
  if (s.tac) s.tacT = Math.max(0, s.tacT - dt);
  else if (!sprint || (btn & BTN_TAC) === 0) s.tacT = Math.min(PLAYER.TAC_SPRINT_MAX, s.tacT + PLAYER.TAC_SPRINT_RECHARGE * dt);

  // ---------------------------------------------------------------- horizontal velocity
  if (sliding) {
    s.slideT -= dt;
    const ns = Math.max(0, hSpeed - PLAYER.SLIDE_FRICTION * dt);
    if (hSpeed > 1e-4) { s.vx *= ns / hSpeed; s.vz *= ns / hSpeed; }
    // a little steering
    if (mlen > 0.1) accelerate(s, wx, wz, ns, 1.2, dt);
    if (s.slideT <= 0 || ns < 3 || jumpPressed) {
      s.slideT = 0;
      s.slideCd = PLAYER.SLIDE_COOLDOWN;
    }
  } else {
    let maxSpeed: number = crouching ? PLAYER.CROUCH_SPEED : s.tac ? PLAYER.TAC_SPRINT_SPEED : sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED;
    maxSpeed *= params.speedMul * params.boost;
    maxSpeed *= 1 + (params.adsMoveFactor - 1) * s.ads;
    if (mz < -0.1) maxSpeed *= PLAYER.BACKPEDAL_FACTOR;
    else if (Math.abs(mx) > 0.1 && mz < 0.1) maxSpeed *= PLAYER.STRAFE_FACTOR;
    const wishSpeed = maxSpeed * mlen;
    if (s.grounded) {
      if (hSpeed > 1e-4) {
        const control = Math.max(hSpeed, PLAYER.STOP_SPEED);
        const ns = Math.max(0, hSpeed - control * PLAYER.GROUND_FRICTION * dt) / hSpeed;
        s.vx *= ns; s.vz *= ns;
      }
      accelerate(s, wx, wz, wishSpeed, PLAYER.GROUND_ACCEL, dt);
    } else {
      accelerate(s, wx, wz, Math.min(wishSpeed, PLAYER.AIR_WISH_SPEED), PLAYER.AIR_ACCEL * 10, dt);
    }
  }

  // ---------------------------------------------------------------- jump / gravity
  if (jumpPressed && s.grounded && (!wasCrouching || !world.overlaps(s.x - R, s.y + PLAYER.CROUCH_HEIGHT, s.z - R, s.x + R, s.y + PLAYER.HEIGHT + 0.3, s.z + R, F_SOLID))) {
    s.vy = PLAYER.JUMP_VELOCITY;
    s.grounded = false;
  }
  if (!s.grounded) s.vy = Math.max(-PLAYER.TERMINAL_VELOCITY, s.vy - PLAYER.GRAVITY * dt);

  // ---------------------------------------------------------------- horizontal move (X then Z)
  const dx = s.vx * dt;
  if (dx !== 0) {
    const nx = s.x + dx;
    if (!probe(world, extra, nx, s.y, s.z, h)) s.x = nx;
    else {
      const limMin = P.minX, limMax = P.maxX;
      if (!tryStep(s, world, extra, nx, s.z, h)) {
        if (dx > 0) s.x = Math.max(s.x, Math.min(nx, limMin - R - EPS));
        else s.x = Math.min(s.x, Math.max(nx, limMax + R + EPS));
        s.vx = 0;
      }
    }
  }
  const dz = s.vz * dt;
  if (dz !== 0) {
    const nz = s.z + dz;
    if (!probe(world, extra, s.x, s.y, nz, h)) s.z = nz;
    else {
      const limMin = P.minZ, limMax = P.maxZ;
      if (!tryStep(s, world, extra, s.x, nz, h)) {
        if (dz > 0) s.z = Math.max(s.z, Math.min(nz, limMin - R - EPS));
        else s.z = Math.min(s.z, Math.max(nz, limMax + R + EPS));
        s.vz = 0;
      }
    }
  }

  // ---------------------------------------------------------------- vertical move
  if (s.grounded && s.vy <= 0) {
    const floor = findFloor(world, extra, s.x, s.y, s.z, PLAYER.STEP_HEIGHT + 0.05);
    if (floor > -Infinity) { s.y = floor; s.vy = 0; }
    else s.grounded = false;
  } else {
    const dy = s.vy * dt;
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.25));
    const sub = dy / steps;
    for (let i = 0; i < steps; i++) {
      const ny = s.y + sub;
      if (!probe(world, extra, s.x, ny, s.z, h)) { s.y = ny; continue; }
      if (sub < 0) {
        if (P.top <= s.y + 0.05) {
          s.y = P.top;
          s.landSpeed = -s.vy;
          s.grounded = true;
        }
        s.vy = 0;
      } else {
        s.y = Math.max(s.y, P.bottom - h - EPS);
        s.vy = 0;
      }
      break;
    }
  }
  s.airT = s.grounded ? 0 : s.airT + dt;

  // ---------------------------------------------------------------- world bounds
  if (s.x < world.minX + R) { s.x = world.minX + R; s.vx = 0; }
  else if (s.x > world.maxX - R) { s.x = world.maxX - R; s.vx = 0; }
  if (s.z < world.minZ + R) { s.z = world.minZ + R; s.vz = 0; }
  else if (s.z > world.maxZ - R) { s.z = world.maxZ - R; s.vz = 0; }
}
