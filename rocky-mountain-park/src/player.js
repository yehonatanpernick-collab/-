// Hiker: keyboard/mouse/touch input, smoothed walking, flying, footsteps, teleporting.
import { clamp, lerp, ss, HALF, LAKES, lakeR } from './shared.js';
import { $, isTouch, canvas, camera, G, U, cellOf, trailAt, groundAt, heightAt, waterAt, surfaceAt } from './core.js';
import { footstep } from './audio.js';

export const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, fly: false, run: false, onGround: true, bob: 0, stepPh: 0, speed: 0, fov: 66, inputLock: false };
export const keys = {};
const joy = { x: 0, y: 0, id: null }, look = { id: null, x: 0, y: 0 };
let flyUp = 0;
const hooks = { onFly: () => {}, onKey: () => {} };
export const setPlayerHooks = (h) => Object.assign(hooks, h);
function lookBy(dx, dy, sens) { if (P.inputLock) return; P.yaw -= dx * sens; P.pitch = clamp(P.pitch - dy * sens, -1.45, 1.45); }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  hooks.onKey(e.code);
  if (e.code === 'Space' && !P.fly && P.onGround && !P.inputLock) { P.vy = 6.2; P.onGround = false; }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
canvas.addEventListener('mousedown', e => {
  if (isTouch) return; drag = { x: e.clientX, y: e.clientY };
  if (!document.pointerLockElement && !P.inputLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
});
addEventListener('mouseup', () => { drag = null; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) lookBy(e.movementX, e.movementY, 0.0021);
  else if (drag) { lookBy(e.clientX - drag.x, e.clientY - drag.y, 0.004); drag.x = e.clientX; drag.y = e.clientY; }
});
const joyEl = $('joy'), knob = $('joyKnob');
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.45 && joy.id === null) { joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joyEl.style.display = 'block'; joyEl.style.left = t.clientX + 'px'; joyEl.style.top = t.clientY + 'px'; knob.style.transform = ''; $('joyHint').style.display = 'none'; }
    else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy; const l = Math.hypot(dx, dy), m = 55; if (l > m) { dx *= m / l; dy *= m / l; }
      joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (t.identifier === look.id) { lookBy(t.clientX - look.x, t.clientY - look.y, 0.0055); look.x = t.clientX; look.y = t.clientY; }
  }
}, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; joyEl.style.display = 'none'; } if (t.identifier === look.id) look.id = null; } };
canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
const hold = (el, on, off) => { el.addEventListener('pointerdown', e => { e.preventDefault(); on(); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, off); };
hold($('bUp'), () => flyUp = 1, () => flyUp = 0); hold($('bDown'), () => flyUp = -1, () => flyUp = 0);
$('bJump').addEventListener('pointerdown', e => { e.preventDefault(); if (!P.fly && P.onGround) { P.vy = 6.2; P.onGround = false; } });
$('bRun').addEventListener('click', () => { P.run = !P.run; $('bRun').classList.toggle('on', P.run); });
$('bFly').addEventListener('click', () => toggleFly());
export function toggleFly() {
  P.fly = !P.fly; document.body.classList.toggle('flying', P.fly); $('bFly').classList.toggle('on', P.fly);
  if (P.fly) P.y = Math.max(P.y, groundAt(P.x, P.z) + 40); else P.vy = 0;
  hooks.onFly(P.fly);
}
export function updatePlayer(dt) {
  let fwd = 0, str = 0;
  if (!P.inputLock) {
    if (keys.KeyW || keys.ArrowUp) fwd += 1; if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1; if (keys.KeyA || keys.ArrowLeft) str -= 1;
    fwd -= joy.y; str += joy.x;
  }
  const ml = Math.hypot(fwd, str); if (ml > 1) { fwd /= ml; str /= ml; }
  const run = P.run || keys.ShiftLeft || keys.ShiftRight;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), fx = -sy, fz = -cy, rx = cy, rz = -sy;
  if (P.fly) {
    const sp = run ? 160 : 48, cpch = Math.cos(P.pitch), spch = Math.sin(P.pitch);
    const tvx = (fx * cpch * fwd + rx * str) * sp, tvz = (fz * cpch * fwd + rz * str) * sp;
    P.vx = lerp(P.vx, tvx, Math.min(1, dt * 3)); P.vz = lerp(P.vz, tvz, Math.min(1, dt * 3));
    const tvy = spch * fwd * sp + ((keys.Space ? 1 : 0) - (keys.KeyC || keys.ControlLeft ? 1 : 0) + flyUp) * sp * 0.6;
    P.vy = lerp(P.vy, tvy, Math.min(1, dt * 3));
    P.x = clamp(P.x + P.vx * dt, -HALF + 40, HALF - 40); P.z = clamp(P.z + P.vz * dt, -HALF + 40, HALF - 40);
    P.y = clamp(P.y + P.vy * dt, groundAt(P.x, P.z) + 1.2, 2600);
    P.onGround = false; P.speed = Math.hypot(P.vx, P.vz, P.vy);
  } else {
    const k = cellOf(P.x, P.z), slope = 1 - G.NRM[k * 3 + 1];
    let sp = (run ? 9.5 : 4.0) * (1 - 0.45 * ss(0.25, 0.6, slope));
    const here = waterAt(P.x, P.z), wading = here !== null && here > heightAt(P.x, P.z) + 0.3; if (wading) sp *= 0.5;
    const tvx = (fx * fwd + rx * str) * sp, tvz = (fz * fwd + rz * str) * sp, acc = P.onGround ? 7 : 1.5;
    P.vx = lerp(P.vx, tvx, Math.min(1, dt * acc)); P.vz = lerp(P.vz, tvz, Math.min(1, dt * acc));
    const tryMove = (nx, nz) => {
      if (Math.abs(nx) > HALF - 15 || Math.abs(nz) > HALF - 15) return false;
      const g = groundAt(nx, nz), w = waterAt(nx, nz);
      if (w !== null && w - g > 1.05 && g < w - 0.3) return false;
      if (g - P.y > 1.6 && P.onGround) return false;
      P.x = nx; P.z = nz; return true;
    };
    const dx = P.vx * dt, dz = P.vz * dt;
    if (Math.abs(dx) + Math.abs(dz) > 1e-5) { if (!tryMove(P.x + dx, P.z + dz)) { if (!tryMove(P.x + dx, P.z)) P.vx = 0; if (!tryMove(P.x, P.z + dz)) P.vz = 0; } }
    P.speed = Math.hypot(P.vx, P.vz);
    P.vy -= 22 * dt; P.y += P.vy * dt;
    const g = groundAt(P.x, P.z);
    const wasAir = !P.onGround;
    if (P.y <= g || (P.onGround && P.y - g < 1.2 && P.vy <= 0)) { P.y = g; P.vy = 0; P.onGround = true; } else P.onGround = false;
    if (P.onGround) {
      const prev = P.stepPh; P.stepPh += P.speed * dt * (run ? 0.75 : 0.95);
      if (Math.floor(prev) !== Math.floor(P.stepPh) && P.speed > 0.6) footstep(onBridge() ? 'wood' : wading ? 'water' : surfaceAt(P.x, P.z), run);
      if (wasAir) footstep(surfaceAt(P.x, P.z), true);
    }
  }
  const bobAmt = P.fly || !P.onGround ? 0 : clamp(P.speed / 4, 0, 1.6);
  const bob = Math.sin(P.stepPh * Math.PI) * 0.045 * bobAmt, sway = Math.cos(P.stepPh * Math.PI) * 0.02 * bobAmt;
  camera.position.set(P.x + Math.cos(P.yaw) * sway, P.y + 1.68 + Math.abs(bob) - 0.02 * bobAmt, P.z - Math.sin(P.yaw) * sway);
  camera.rotation.set(P.pitch, P.yaw, (P.fly ? clamp(-(P.vx * Math.cos(P.yaw) - P.vz * Math.sin(P.yaw)) * 0.004, -0.25, 0.25) : sway * 0.15), 'YXZ');
  const tf = P.fov + (P.fly && run ? 8 : 0) + (run && !P.fly ? 3 : 0) * clamp(P.speed / 9, 0, 1);
  if (Math.abs(camera.fov - tf) > 0.05) { camera.fov = lerp(camera.fov, tf, Math.min(1, dt * 4)); camera.updateProjectionMatrix(); }
  U.player.value.set(P.x, P.y, P.z);
}
function onBridge() { return groundAt(P.x, P.z) > heightAt(P.x, P.z) + 0.1; }
export function teleport(x, z, faceX, faceZ) {
  x = clamp(x, -HALF + 40, HALF - 40); z = clamp(z, -HALF + 40, HALF - 40);
  for (let t = 0; t < 60; t++) { const w = waterAt(x, z); if (w === null || w - heightAt(x, z) < 0.5) break; const a = t * 2.4, d = 6 + t * 4; x += Math.cos(a) * d * 0.3; z += Math.sin(a) * d * 0.3; }
  P.x = x; P.z = z; P.y = groundAt(x, z) + (P.fly ? 40 : 0); P.vy = P.vx = P.vz = 0;
  if (faceX !== undefined) { P.yaw = Math.atan2(-(faceX - x), -(faceZ - z)); P.pitch = -0.05; }
}
export function lakeSpot(L) {
  let best = null, bs = 1e9;
  for (let a = 0; a < 24; a++) {
    const an = a / 24 * Math.PI * 2, r = lakeR(L, an) + 14, x = L.x + Math.cos(an) * r, z = L.z + Math.sin(an) * r, k = cellOf(x, z);
    const s = 1 - G.NRM[k * 3 + 1] + (G.LKD[k] < 3 ? 1 : 0) + (G.CHD[k] < 3 ? 1 : 0) + (G.TRL[trailAt(x, z)] > 80 ? -0.3 : 0);
    if (s < bs) { bs = s; best = [x, z]; }
  }
  return best;
}
export { LAKES };
