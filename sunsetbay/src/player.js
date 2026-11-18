import * as THREE from 'three';
import { $, CFG, clamp, damp, lerp, wrapA, rnd, pick, fmtMoney, IS_TOUCH, sound, store } from './core.js';
import { camera, canvas, scene, Q, qualityName } from './render.js';
import * as W from './world.js';
import { R, world, G, groups, colliderInfo, makeHumanCollider, moveHumanCollider } from './physics.js';
import { player, humans, vehicles, cam, wanted, mission, flags, input, clock, stats, WEAPONS } from './state.js';
import { lib, PLAYER_MODEL } from './characters.js';
import * as FX from './fx.js';
import { toast, banner, addMoney, hitMarker, setHintSource, drawBigMap } from './hud.js';
import { spawnHuman, removeHuman, removeVehicle, damageHuman, addHeat, clearHeat, alarm, deployCops, shootFrom, ragdollStep, knockLoose, launchFrom } from './ai.js';
import { MISSIONS, missionFail, closeMissionCard, computeGPS, save } from './missions.js';

const { POI, groundHeight, bAt, inBounds } = W;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _hp = new THREE.Vector3(), _fwd = new THREE.Vector3();

/* =====================================================================
   SPAWN
   ===================================================================== */
export let headL = [];
export function initPlayer() {
  const S = POI.safehouse;
  const h = spawnHuman('player', S.x, S.z, S.h, lib.ready(PLAYER_MODEL + '@hi') ? PLAYER_MODEL + '@hi' : PLAYER_MODEL); player.h = h; h.weapon = player.weapon; h.hp = 100;
  player.x = S.x; player.z = S.z; cam.yaw = S.h;
  player.collider = makeHumanCollider(S.x, groundHeight(S.x, S.z), S.z);
  // car headlights (always present so light count never changes -> no shader recompiles)
  if (Q.shadow) for (let i = 0; i < 2; i++) { const s = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.4); s.castShadow = false; scene.add(s); scene.add(s.target); headL.push(s); }
}
function placeCollider(x, y, z) { player.collider.setTranslation({ x, y: y + 0.86, z }); }

/* =====================================================================
   CARS: enter / exit / jack
   ===================================================================== */
export function nearestEnterable(extra = 1.7) {
  let best = null, bd = 1e9; const h = player.h;
  for (const v of vehicles) {
    if (v.removed || v.dead || v.locked || v.fire > 0 || v.mode === 'racer' || v.drowned) continue;
    const d = Math.hypot(v.x - player.x, v.z - player.z); if (d < v.hlen + extra && d < bd && Math.abs(v.y - h.y) < 1.6) { bd = d; best = v; }
  }
  return best;
}
export function enterCar(v, silent) {
  const P = player;
  if (v.mode === 'traffic') {
    const lx = Math.cos(v.h), lz = -Math.sin(v.h);
    knockLoose(v, 0, 0); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const ped = spawnHuman('ped', v.x + lx * (v.hwid + 0.9), v.z + lz * (v.hwid + 0.9), v.h + Math.PI / 2, v.driverModel || undefined);
    if (ped) { ped.ai = { mode: 'flee', flee: 9, fx: P.x, fz: P.z, bi: 0, bj: 0, k: 0, dir: 1, speed: 1.3, pause: 30 }; ped.state = 'down'; ped.timer = 1.1; ped.playOnce('knock', { fade: 0.05, ts: 1.3 }); }
    v.driverModel = null; v.bail = null;
    let copNear = false; for (const h of humans) if (h.kind === 'cop' && h.alive && Math.hypot(h.x - P.x, h.z - P.z) < 50) copNear = true;
    for (const o of vehicles) if (o.variant === 'police' && o !== v && Math.hypot(o.x - P.x, o.z - P.z) < 50) copNear = true;
    addHeat(copNear ? 1.3 : 0.55, 'jack'); alarm(v.x, v.z, 20, 1);
  } else if (v.mode === 'police' && !v.ai.deployed) { deployCops(v); addHeat(1.5, 'copcar'); }
  if (v.variant === 'police') addHeat(0.6, 'copcar');
  if (!v.dynamic) v.toDynamic(0, 0);
  P.car = v; v.mode = 'player'; v.isPlayer = true; v.siren = false; v.hand = false; v.ai = null; v.lights = true;
  P.h.hidden = true; P.h.aiming = false; P.h.setUpper(null, 0); player.collider.setEnabled(false);
  if (!silent) sound.door();
  cam.look = 0; cam.yaw = v.h; cam.pitch = 0.2;
  sound.setRadio(true);
}
export function exitCar(force) {
  const P = player, v = P.car; if (!v) return;
  const fx = Math.sin(v.h), fz = Math.cos(v.h), lx = fz, lz = -fx;
  let x = v.x + lx * (v.hwid + 0.7), z = v.z + lz * (v.hwid + 0.7);
  if (bAt(x, z, 0.35) || !inBounds(x, z)) { x = v.x - lx * (v.hwid + 0.7); z = v.z - lz * (v.hwid + 0.7); }
  if (bAt(x, z, 0.35) || !inBounds(x, z)) { x = v.x - fx * (v.hlen + 1); z = v.z - fz * (v.hlen + 1); }
  const h = P.h, y = Math.max(groundHeight(x, z), v.y - 0.2);
  h.setPosition(x, y, z); h.yaw = v.h; h.hidden = false; h.vx = h.vz = 0; P.vy = 0;
  player.collider.setEnabled(true); placeCollider(x, y, z);
  const sp = v.speedAbs;
  v.mode = v.dead ? 'wreck' : 'parked'; v.isPlayer = false; v.throttle = 0; v.brake = 0; v.hand = sp < 3; v.braking = false; v.steer = 0;
  P.car = null; sound.setRadio(false); sound.setEngine(false, 0, 0); sound.setSkid(0);
  if (!force) sound.door();
  if (sp > 9 && !force) { launchFrom(h, x - v.vx, z - v.vz, sp * 0.5); hurtPlayer(Math.min(30, sp * 0.8), v.x, v.z); }
  headL.forEach(s => s.intensity = 0);
  P.x = x; P.z = z;
}

/* =====================================================================
   DAMAGE / DEATH
   ===================================================================== */
export function hurtPlayer(n, sx, sz) {
  const P = player; if (P.dead || n <= 0) return;
  const a = Math.min(P.armor, n * 0.7); P.armor -= a; P.hp -= (n - a); P.hurtT = Math.min(0.9, P.hurtT + n / 40);
  FX.shake(clamp(n / 60, 0.05, 0.4));
  if (P.hp <= 0) { P.hp = 0; wasted(); }
}
function wasted() {
  const P = player; if (P.dead) return; P.dead = true; flags.timeScale = 0.35;
  if (P.car) exitCar(true);
  const h = P.h; h.aiming = false; h.setUpper(null, 0.1);
  if (h.state !== 'air') { h.state = 'dead'; h.playOnce(pick(['death1', 'death2', 'death3']), { fade: 0.1 }); }
  h.alive = false; canvas.classList.add('dead');
  const fee = Math.min(P.money, Math.round(P.money * CFG.respawnFeePct / 10) * 10 + 200);
  banner('חוסלת', `בית החולים גבה <b>${fmtMoney(fee)}</b>`, true, 4200); sound.jingle(false);
  setTimeout(() => respawn('hospital', fee), 4300);
}
export function bust() {
  const P = player; if (P.dead) return; P.dead = true; P.busted = true;
  if (P.car) exitCar(true);
  const h = P.h; h.aiming = false; h.setUpper(null, 0.1); h.vx = h.vz = 0; h.playBase('terrified', 0.3); canvas.classList.add('busted');
  const fee = Math.min(P.money, Math.round(P.money * CFG.respawnFeePct / 10) * 10 + 300);
  banner('נעצרת', `הערבות עלתה <b>${fmtMoney(fee)}</b> · הנשק הוחרם`, true, 4200); sound.jingle(false);
  setTimeout(() => respawn('police', fee), 4300);
}
function respawn(where, fee) {
  const P = player;
  if (mission.active) missionFail(where === 'police' ? 'נעצרת' : 'חוסלת');
  addMoney(-fee);
  if (P.busted) { P.owned = [true, true, false, false]; P.ammo = [0, 24, 0, 0]; P.mag = [0, 12, 0, 0]; P.weapon = 0; }
  P.dead = false; P.busted = false; P.hp = 100; P.armor = 0; flags.timeScale = 1; canvas.classList.remove('dead', 'busted');
  clearHeat(); for (const h of humans.slice()) if (h.kind === 'cop') removeHuman(h); for (const v of vehicles.slice()) if ((v.mode === 'police' || v.mode === 'policeStop')) removeVehicle(v);
  const S = where === 'police' ? POI.police : POI.hospital;
  const h = P.h, y = groundHeight(S.x, S.z); h.setPosition(S.x, y, S.z); h.state = 'normal'; h.alive = true; h.hidden = false; h.vx = h.vz = 0; h.yaw = S.h || 0; h.hp = 100;
  h.oneShot = null; h.oneShotFull = false; h.base = null; h.playBase('idle', 0);
  placeCollider(S.x, y, S.z);
  cam.yaw = h.yaw; P.x = h.x; P.z = h.z; save();
}
function stuntBonus(air, dist) {
  const cash = Math.round((100 + air * 220 + dist * 6) / 10) * 10; addMoney(cash); stats.stunts++;
  banner('קפיצה מטורפת!', `${air.toFixed(1)} שניות באוויר · ${Math.round(dist)} מ׳ · <b>+${fmtMoney(cash)}</b>`, false, 2600); sound.jingle(true);
}

/* =====================================================================
   WEAPONS
   ===================================================================== */
function cycleWeapon(dir) { const P = player; for (let k = 1; k <= 4; k++) { const w = (P.weapon + dir * k + 8) % 4; if (P.owned[w]) { P.weapon = w; sound.ui(); return; } } }
function reload() {
  const P = player, w = P.weapon, Wp = WEAPONS[w]; if (Wp.melee || P.reloadT > 0) return;
  if (P.mag[w] >= Wp.mag || P.ammo[w] <= 0) return;
  P.reloadT = P.h.playOnce('reload', { full: false, ts: 1.5, fade: 0.1 }) || 1.2; sound.reload();
  P.reloadPending = true;
}
function finishReload() { const P = player, w = P.weapon, Wp = WEAPONS[w]; const take = Math.min(Wp.mag - P.mag[w], P.ammo[w]); P.mag[w] += take; P.ammo[w] -= take; P.reloadPending = false; }
function aimRay(origin, dir) {
  camera.getWorldDirection(dir); origin.copy(camera.position);
  // start the ray at the player's depth so walls behind the player don't block it
  const h = player.h; _v.set(h.x, h.y + 1.4, h.z).sub(origin); const t0 = Math.max(0, _v.dot(dir) - 0.6); origin.addScaledVector(dir, t0);
}
function playerFire() {
  const P = player, h = P.h, w = P.weapon, Wp = WEAPONS[w];
  if (P.fireT > 0 || P.reloadT > 0) return;
  if (Wp.melee) {
    P.fireT = Wp.rate; const hook = Math.random() < 0.4;
    h.aiming = false; h.playOnce(hook ? 'hook' : 'punch', { full: false, ts: 1.5, fade: 0.06 }); P.meleeT = 0.55;
    setTimeout(() => {
      if (P.dead) return; let hit = false;
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
      for (const o of humans) { if (o === h || !o.alive || o.hidden) continue; const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz); if (d > 1.6 || (dx * fx + dz * fz) / (d || 1) < 0.5) continue; damageHuman(o, Wp.dmg * (hook ? 1.5 : 1), 'player', h.x, h.z, hook && o.hp < 40); hit = true; FX.fx_hit(o.x, o.y + 1.4, o.z, 'flesh'); }
      for (const v of vehicles) { if (v.removed) continue; const dx = v.x - h.x, dz = v.z - h.z; if (dx * dx + dz * dz < (v.hlen + 0.8) ** 2 && (dx * fx + dz * fz) > 0) { /* punching cars does nothing but sound */ } }
      if (hit) { sound.punch(); hitMarker(); FX.shake(0.12); } else sound.ui();
    }, 220);
    return;
  }
  if (P.mag[w] <= 0) { if (P.ammo[w] > 0) reload(); else { sound.ui(); P.fireT = 0.3; } return; }
  P.fireT = Wp.rate; P.mag[w]--; P.aimHold = 0.9; h.aiming = true; h.recoil = 1;
  if (!P.wasAiming) { h.yaw = cam.yaw; }
  const o = new THREE.Vector3(), d = new THREE.Vector3(); aimRay(o, d);
  h.mixer.update(0); h.handPos(_hp);
  shootFrom(_hp, o, d, Wp, 'player');
  FX.fx_muzzle(_hp.x, _hp.y, _hp.z, w === 3); sound.shot(Wp.snd, 0);
  cam.pitch = clamp(cam.pitch - (w === 3 ? 0.035 : w === 2 ? 0.008 : 0.016), -0.55, 1.2); cam.yaw += rnd(-1, 1) * (w === 2 ? 0.004 : 0.002);
  FX.shake(w === 3 ? 0.18 : 0.04);
  alarm(h.x, h.z, 35, 1);
  P.noiseT = 2;
  // police hear shots nearby
  if (wanted.level === 0) for (const c of humans) if (c.kind === 'cop' && c.alive && Math.hypot(c.x - h.x, c.z - h.z) < 30) { addHeat(1.2, 'shots'); break; }
  if (P.mag[w] === 0 && P.ammo[w] > 0) setTimeout(reload, 250);
}

/* =====================================================================
   UPDATE
   ===================================================================== */
const K = c => !!input.keys[c];
export function updatePlayer(dt) {
  const P = player, h = P.h, inp = input;
  P.fireT -= dt; P.aimHold -= dt; P.noiseT -= dt; P.hurtT = Math.max(0, P.hurtT - dt * 0.8); P.meleeT = (P.meleeT || 0) - dt;
  if (P.reloadT > 0) { P.reloadT -= dt; if (P.reloadT <= 0 && P.reloadPending) finishReload(); }
  const ix = (K('KeyD') || K('ArrowRight') ? 1 : 0) - (K('KeyA') || K('ArrowLeft') ? 1 : 0) + inp.joy.x;
  const iz = (K('KeyW') || K('ArrowUp') ? 1 : 0) - (K('KeyS') || K('ArrowDown') ? 1 : 0) - inp.joy.y;
  const pr = inp.pressed;
  if (P.dead) {
    if (P.car) exitCar(true);
    if (h.state === 'air' || h.state === 'down') ragdollStep(h, dt);
    P.x = h.x; P.z = h.z; return;
  }
  if (pr.has('KeyF')) { if (P.car) exitCar(false); else if (P.entering) cancelEnter(); else if (h.state === 'normal') { const v = nearestEnterable(3.6); if (v) startEnter(v); } }
  if (P.car) updateDriving(dt, ix, iz, pr);
  else updateOnFoot(dt, ix, iz, pr);
}
function updateDriving(dt, ix, iz, pr) {
  const P = player, v = P.car, h = P.h;
  if (pr.has('KeyC')) cam.carMode = (cam.carMode + 1) % 3;
  if (pr.has('KeyH')) { sound.horn(); alarm(P.x, P.z, 12, 0); }
  if (pr.has('KeyR')) { const n = sound.cycleStation(); toast(n ? `רדיו · <b>${n}</b>` : 'רדיו כבוי', 1600); sound.setRadio(true); }
  if (pr.has('KeyL')) v.lights = !v.lights;
  v.throttle = clamp(iz, 0, 1); v.brake = clamp(-iz, 0, 1); v.hand = !!(K('Space') || input.touch.jump);
  const st = clamp(ix, -1, 1); v.steer = IS_TOUCH && Math.abs(input.joy.x) > 0 ? st : damp(v.steer, st, st === 0 ? 9 : 6, dt);
  if (v.dead || v.drowned) { v.throttle = v.brake = 0; }
  // flip back onto the wheels
  if (v.upY < 0.3 && v.speedAbs < 2) { v.flipT = (v.flipT || 0) + dt; if (v.flipT > 2.5 && pr.size >= 0) { v.flipT = 0; v.place(v.x, v.z, v.h, v.y + 0.6); } } else v.flipT = 0;
  P.x = v.x; P.z = v.z; h.x = v.x; h.z = v.z; h.y = v.y;
  // engine & tyre audio, skid marks
  const sp = Math.abs(v.fwdSpeed), gearW = v.C.maxV / 5, gear = Math.min(4, Math.floor(sp / gearW)), rpm = sp < 0.5 ? 0.08 : clamp(0.25 + 0.75 * (sp - gear * gearW) / gearW, 0, 1);
  sound.setEngine(!v.dead, rpm, Math.max(v.throttle, v.brake * 0.5));
  const lat = v.fwdV ? Math.abs(v.vx * v.fwdV.z - v.vz * v.fwdV.x) : 0;
  const skidding = v.inContact >= 3 && ((lat > 3.2 && v.speedAbs > 5) || (v.hand && v.speedAbs > 7) || (v.braking && v.speedAbs > 14 && v.brake > 0.5));
  sound.setSkid(skidding ? clamp(lat / 10 + 0.3, 0, 1) : 0);
  if (skidding) { v.skidT = (v.skidT || 0) - dt; if (v.skidT <= 0) { v.skidT = 0.03; const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx; for (const s of [-1, 1]) { const wx = v.x - fx * (v.hlen - 0.9) + rx * s * (v.hwid - 0.25), wz = v.z - fz * (v.hlen - 0.9) + rz * s * (v.hwid - 0.25); FX.skidMark(wx, groundHeight(wx, wz), wz, v.h); if (Math.random() < 0.5) FX.fx_tire(wx, v.y, wz); } } }
  // stunts
  if (v.inContact === 0 && v.y > 0.6) { if (!P.airT) { P.airT = 0; P.airX = v.x; P.airZ = v.z; } P.airT += dt; }
  else if (P.airT !== undefined && P.airT !== null) { if (P.airT > CFG.stuntMinAir && !v.dead) stuntBonus(P.airT, Math.hypot(v.x - P.airX, v.z - P.airZ)); P.airT = null; }
}
const CAM_FILTER = groups(0xffff, G.STATIC);
function startEnter(v) { player.entering = { v, t: 0, phase: 'walk' }; if (v.mode === 'traffic' && v.ai) v.ai.hold = true; }
function cancelEnter() { const E = player.entering; if (E && E.v.ai) E.v.ai.hold = false; player.entering = null; }
// walk to the driver's door, turn to the car, climb in
function enterStep(dt, ix, iz) {
  const P = player, h = P.h, E = P.entering, v = E.v;
  if (v.removed || v.dead || v.fire > 0 || (Math.abs(ix) + Math.abs(iz) > 0.5 && E.t > 0.25 && E.phase === 'walk')) { cancelEnter(); return false; }
  E.t += dt; h.aiming = false; h.setUpper(null, 0.15);
  const lx = Math.cos(v.h), lz = -Math.sin(v.h), fx = Math.sin(v.h), fz = Math.cos(v.h);
  let tx = v.x + lx * (v.hwid + 0.5) + fx * 0.35, tz = v.z + lz * (v.hwid + 0.5) + fz * 0.35;
  const doorD = Math.hypot(tx - h.x, tz - h.z);
  // not on the driver's side yet: walk around the nearer end of the car first
  const ox = h.x - v.x, oz = h.z - v.z, lat = ox * lx + oz * lz, lon = ox * fx + oz * fz;
  if (lat < v.hwid + 0.2) {
    const sgn = lon >= 0 ? 1 : -1;
    if (Math.abs(lon) < v.hlen + 0.5) { const l2 = clamp(lat, -(v.hwid + 0.7), v.hwid + 0.7); tx = v.x + fx * sgn * (v.hlen + 0.9) + lx * l2; tz = v.z + fz * sgn * (v.hlen + 0.9) + lz * l2; }
    else { tx = v.x + fx * sgn * (v.hlen + 0.6) + lx * (v.hwid + 0.7); tz = v.z + fz * sgn * (v.hlen + 0.6) + lz * (v.hwid + 0.7); }
  }
  const dx = tx - h.x, dz = tz - h.z, d = Math.max(0.01, Math.hypot(dx, dz));
  if (E.phase === 'walk' && (doorD < 0.3 || E.t > 4)) { E.phase = 'in'; E.t2 = 0; }
  if (E.phase === 'in') {
    E.t2 += dt; const face = Math.atan2(-lx, -lz);
    h.yaw += wrapA(face - h.yaw) * Math.min(1, dt * 14);
    h.vx = damp(h.vx, 0, 14, dt); h.vz = damp(h.vz, 0, 14, dt); h.locomote(0, dt);
    if (E.t2 > 0.28) { player.entering = null; enterCar(v); }
    return true;
  }
  const sp = doorD > 2.5 ? CFG.jogSpeed : Math.max(1.3, doorD * 1.8);
  h.yaw += wrapA(Math.atan2(dx, dz) - h.yaw) * Math.min(1, dt * 10);
  h.vx = damp(h.vx, dx / d * sp, 9, dt); h.vz = damp(h.vz, dz / d * sp, 9, dt);
  P.vy -= CFG.gravity * dt; const r = moveHumanCollider(player.collider, h.vx * dt, P.vy * dt, h.vz * dt), t = player.collider.translation();
  P.grounded = r.grounded; if (P.grounded && P.vy < 0) P.vy = -1;
  h.x = t.x; h.z = t.z; h.y = t.y - 0.86; P.x = h.x; P.z = h.z;
  h.locomote(Math.hypot(h.vx, h.vz), dt);
  footstep(dt, Math.hypot(h.vx, h.vz));
  return true;
}
function footstep(dt, hs) { const P = player; if (P.grounded && hs > 0.5) { P.stepD = (P.stepD || 0) + hs * dt; const stride = hs > 5 ? 1.55 : hs > 2.7 ? 1.25 : 0.72; if (P.stepD > stride) { P.stepD = 0; sound.step(0, hs > 5 ? 0.5 : 0.32); } } }
// GTA-style soft lock: when aiming starts, swing the crosshair onto the nearest target in front
function findLockTarget() {
  const c = camera.position; camera.getWorldDirection(_fwd); let best = null, bs = 1e9;
  for (const o of humans) {
    if (o === player.h || !o.alive || o.hidden || o.state === 'dead') continue;
    const dx = o.x - c.x, dy = o.y + 1.25 - c.y, dz = o.z - c.z, d = Math.hypot(dx, dy, dz); if (d > 45 || d < 1) continue;
    const cosA = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d; if (cosA < 0.94) continue;
    if (!W.losClear(player.x, player.z, o.x, o.z)) continue;
    const hostile = o.kind === 'gang' && o.ai.hostile || o.kind === 'cop' && wanted.level > 0;
    const score = (1 - cosA) * 60 + d * 0.05 - (hostile ? 3 : 0); if (score < bs) { bs = score; best = o; }
  }
  return best;
}
function updateOnFoot(dt, ix, iz, pr) {
  const P = player, h = P.h, inp = input;
  sound.setEngine(false, 0, 0); sound.setSkid(0);
  if (h.state === 'air' || h.state === 'down' || h.state === 'dead') {
    ragdollStep(h, dt); P.x = h.x; P.z = h.z; placeCollider(h.x, h.y, h.z); return;
  }
  if (P.entering && h.state === 'normal') { if (enterStep(dt, ix, iz)) return; }
  // weapons
  if (pr.has('KeyQ') || pr.has('WheelUp')) cycleWeapon(-1);
  if (pr.has('KeyE') || pr.has('WheelDown') || inp.touch.weapTap) cycleWeapon(1);
  for (let k = 1; k <= 4; k++) if (pr.has('Digit' + k) && P.owned[k - 1]) { P.weapon = k - 1; sound.ui(); }
  if (pr.has('KeyR')) reload();
  h.weapon = P.weapon;
  const Wp = WEAPONS[P.weapon];
  const canShoot = flags.running && !flags.modal && (inp.locked || IS_TOUCH || !inp.lockSupported || !inp.mouse.dragged);
  const firing = (inp.mouse.l || inp.touch.fire) && canShoot;
  if (firing && (Wp.auto || Wp.melee || !P.fireHeld)) playerFire();
  P.fireHeld = firing;
  const aiming = !Wp.melee && (inp.mouse.r || P.aimHold > 0 || inp.touch.fire);
  if (aiming && !P.wasAiming && (inp.mouse.r || inp.touch.fire)) { const tg = findLockTarget(); P.lock = tg ? { h: tg, t: 0.22 } : null; }
  if (P.lock) {
    const o = P.lock.h, c = camera.position; P.lock.t -= dt;
    if (!aiming || !o.alive || P.lock.t <= 0) P.lock = null;
    else { const dx = o.x - c.x, dy = o.y + 1.3 * (o.height / 1.78) - c.y, dz = o.z - c.z, hd = Math.hypot(dx, dz), k = Math.min(1, dt * 16);
      cam.yaw += wrapA(Math.atan2(dx, dz) - cam.yaw) * k; cam.pitch += (Math.atan2(-dy, hd) - cam.pitch) * k; }
  }
  h.aiming = aiming; P.wasAiming = aiming;
  if (aiming) { h.yaw += wrapA(cam.yaw - h.yaw) * Math.min(1, dt * 20); h.aimPitch = clamp(-cam.pitch * 0.9 + 0.12, -0.7, 0.7); h.setUpper(P.reloadT > 0 ? null : 'aim', 0.12); }
  else h.setUpper(null, 0.2);
  // movement relative to camera
  let mx = Math.sin(cam.yaw) * iz + -Math.cos(cam.yaw) * ix, mz = Math.cos(cam.yaw) * iz + Math.sin(cam.yaw) * ix;
  const ml = Math.hypot(mx, mz), mag = Math.min(1, ml); if (ml > 0.01) { mx /= ml; mz /= ml; }
  const sprint = K('ShiftLeft') || K('ShiftRight') || inp.touch.sprint;
  const walk = K('AltLeft') || K('ControlLeft');
  const speed = (aiming ? CFG.aimSpeed * 1.25 : sprint ? CFG.runSpeed : walk ? CFG.walkSpeed : CFG.jogSpeed) * mag * (P.meleeT > 0 ? 0.3 : 1);
  let ux = mx, uz = mz;
  if (mag > 0.1 && !aiming) {
    const dy = wrapA(Math.atan2(mx, mz) - h.yaw); h.yaw += dy * Math.min(1, dt * (Math.abs(dy) > 2.2 ? 16 : 9));
    // run along the facing direction so turns curve naturally instead of sliding sideways
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), al = Math.max(0, fx * mx + fz * mz); ux = fx * al; uz = fz * al;
  }
  const curS = Math.hypot(h.vx, h.vz), rate = speed > curS ? 6.5 : 9;
  h.vx = damp(h.vx, ux * speed, rate, dt); h.vz = damp(h.vz, uz * speed, rate, dt);
  // jump & gravity
  if ((pr.has('Space') || inp.touch.jumpTap) && P.grounded && P.meleeT <= 0) {
    P.vy = CFG.jumpV; P.grounded = false; h.playOnce(Math.hypot(h.vx, h.vz) > 3 ? 'runJump' : 'jump', { fade: 0.1, ts: 1.25 }); P.jumpT = 0;
  }
  P.vy -= CFG.gravity * dt; if (P.vy < -30) P.vy = -30;
  const r = moveHumanCollider(player.collider, h.vx * dt, P.vy * dt, h.vz * dt);
  const t = player.collider.translation();
  const wasAir = !P.grounded; P.grounded = r.grounded; if (P.grounded && P.vy < 0) { if (wasAir && P.vy < -6) { sound.thud(); if (P.vy < -16) hurtPlayer((-P.vy - 16) * 4, h.x, h.z); } P.vy = -1; }
  if (r.my > 0 && P.vy > 0 && Math.abs(r.my) < Math.abs(P.vy * dt) * 0.2) P.vy = 0; // bonked head
  h.x = t.x; h.z = t.z; h.y = t.y - 0.86;
  // airborne anim
  if (!P.grounded) { P.jumpT = (P.jumpT || 0) + dt; if (P.jumpT > 0.5 && !h.oneShot && P.vy < -2) h.playBase('fall', 0.2); }
  else if (h.oneShot && (h.baseName === 'jump' || h.baseName === 'runJump') && P.jumpT > 0.25) { h.oneShot = null; h.oneShotFull = false; }
  // locomotion animation
  const hs = Math.hypot(h.vx, h.vz);
  if (P.grounded || P.jumpT < 0.5) {
    if (aiming && hs > 0.3) {
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), fwd = (h.vx * fx + h.vz * fz) / hs, side = (h.vx * -fz + h.vz * fx) / hs;
      const clip = fwd < -0.5 ? 'walkBack' : side > 0.55 ? 'strafeL' : side < -0.55 ? 'strafeR' : null;
      h.locomote(hs, dt, clip ? { walk: clip } : {});
    } else h.locomote(hs, dt, { idle: P.weapon > 0 ? 'pistolIdle' : 'idle' });
  }
  footstep(dt, hs);
  P.x = h.x; P.z = h.z;
}

/* =====================================================================
   CAMERA
   ===================================================================== */
const _tgt = new THREE.Vector3(), _des = new THREE.Vector3(), _dir = new THREE.Vector3();
let camDist = 4;
function camRay(from, dir, maxD, exclude) {
  const ray = new R.Ray(from, dir);
  const hit = world.castRay(ray, maxD, true, undefined, CAM_FILTER, exclude || undefined, undefined, c => { const i = colliderInfo.get(c.handle); return !i || (i.kind !== 'prop' && i.kind !== 'car'); });
  if (!hit) return maxD; return hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
}
export function updateCamera(dt) {
  if (!flags.running) {
    cam.menuA += dt * 0.035; const a = cam.menuA, S = POI.fountain || { x: 0, z: 0 };
    camera.position.set(S.x + 190 + Math.sin(a) * 30, 26 + Math.sin(a * 0.7) * 5, S.z - 120 + Math.cos(a * 0.8) * 40);
    camera.lookAt(S.x, 30, S.z + Math.sin(a * 0.5) * 40); setFov(52, dt); return;
  }
  const P = player; let D, fovT = 60, smoothPos = false;
  if (P.car) {
    const v = P.car, sp = v.speedAbs;
    cam.look = Math.max(0, cam.look - dt);
    if (cam.look <= 0) { const behind = v.fwdSpeed < -3 ? v.h + Math.PI : v.h; cam.yaw += wrapA(behind - cam.yaw) * (1 - Math.exp(-dt * (2.0 + sp * 0.05))); cam.pitch = damp(cam.pitch, cam.carMode === 2 ? 0.3 : 0.16, 2, dt); }
    D = [5.6, 7.6, 11.5][cam.carMode] * (0.6 + v.hlen / 5.5) + sp * 0.03;
    const mp = v.mesh.position; _tgt.set(mp.x, mp.y + 0.75 + v.H * 0.5, mp.z); cam.ty = undefined;
    fovT = 58 + clamp(sp - 12, 0, 45) * 0.3; smoothPos = true;
  } else {
    const h = P.h, aim = h.aiming && !P.dead, rp = h.root.position, hs = Math.hypot(h.vx, h.vz);
    D = aim ? 1.9 : 3.4; fovT = aim ? 44 : 58;
    cam.so = damp(cam.so ?? 0.42, aim ? 0.62 : 0.42, 10, dt);
    const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw), so = cam.so;
    const down = h.state === 'dead' || h.state === 'down';
    // smooth the height so curb steps and landings don't jolt the view
    const ty = rp.y + (down ? 0.5 : aim ? 1.6 : 1.5) * (h.height / 1.78);
    cam.ty = cam.ty === undefined || Math.abs(cam.ty - ty) > 3 ? ty : damp(cam.ty, ty, 9, dt);
    _tgt.set(rp.x + rx * so, cam.ty, rp.z + rz * so);
    // drift the camera back behind the player while running and the mouse is idle
    cam.look = Math.max(0, cam.look - dt);
    if (!aim && cam.look <= 0 && hs > 1.5 && !P.entering) cam.yaw += wrapA(h.yaw - cam.yaw) * (1 - Math.exp(-dt * 0.9));
    if (P.dead) { D = 6.5; cam.yaw += dt * 0.25; cam.pitch = damp(cam.pitch, 0.55, 1, dt); }
  }
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  _dir.set(-fx * cp, sp, -fz * cp);
  const hit = camRay({ x: _tgt.x, y: _tgt.y, z: _tgt.z }, { x: _dir.x, y: _dir.y, z: _dir.z }, Math.max(D, cam.D || 0) + 0.3, P.car ? P.car.collider : null);
  cam.D = damp(cam.D ?? D, D, 9, dt); if (P.car && Math.abs(cam.D - D) > 4) cam.D = D;
  const want = Math.max(0.6, Math.min(cam.D, hit - 0.3));
  camDist = want < camDist ? want : damp(camDist, want, 4, dt);
  _des.copy(_tgt).addScaledVector(_dir, camDist);
  const gy = groundHeight(_des.x, _des.z) + 0.3; if (_des.y < gy) _des.y = gy;
  if (smoothPos) camera.position.lerp(_des, 1 - Math.exp(-dt * 20)); else camera.position.copy(_des);
  if (FX.shakeAmt > 0) { const s = FX.shakeAmt; camera.position.x += rnd(-1, 1) * s * 0.2; camera.position.y += rnd(-1, 1) * s * 0.16; camera.position.z += rnd(-1, 1) * s * 0.2; FX.decayShake(dt); }
  camera.lookAt(_tgt);
  setFov(fovT, dt);
  // headlights for the player car
  if (headL.length) {
    const v = P.car, n = W.lampsOn(sky_night()), on = v && !v.dead && v.lights && n > 0.05;
    headL.forEach((s, i) => { s.intensity = on ? 220 * n : 0; if (on) { const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx, side = i ? 1 : -1; s.position.set(v.x + fx * (v.hlen - 0.2) + rx * side * 0.7, v.y + 0.75, v.z + fz * (v.hlen - 0.2) + rz * side * 0.7); s.target.position.set(v.x + fx * 30 + rx * side * 1.5, v.y - 1.5, v.z + fz * 30 + rz * side * 1.5); s.target.updateMatrixWorld(); } });
  }
}
let sky_night = () => 0; export function setNightSource(fn) { sky_night = fn; }
function setFov(f, dt) { const n = damp(camera.fov, f, 6, dt); if (Math.abs(n - camera.fov) > 0.01) { camera.fov = n; camera.updateProjectionMatrix(); } }

/* =====================================================================
   INPUT
   ===================================================================== */
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'AltLeft']);
input.lockSupported = 'requestPointerLock' in canvas;
export function lockPointer() { if (IS_TOUCH || !input.lockSupported) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
let lockLostAt = 0;
export function toggleMap() { const bm = $('bigmap'); bm.hidden = !bm.hidden; flags.modal = !bm.hidden; if (!bm.hidden) { computeGPS(); drawBigMap(); document.exitPointerLock && document.exitPointerLock(); } else lockPointer(); }
export function togglePause(force) {
  if (!flags.running) return;
  flags.paused = force === true ? true : !flags.paused;
  $('pause').hidden = !flags.paused; $('resetConfirm').hidden = true; resetArm = false;
  if (flags.paused) { document.exitPointerLock && document.exitPointerLock(); $('pMoney').textContent = fmtMoney(player.money); $('pMissions').textContent = `${Math.min(mission.idx, MISSIONS.length)}/${MISSIONS.length}`; sound.setRadio(false); sound.setEngine(false, 0, 0); sound.setSiren(0); sound.setSkid(0); markSegs(); }
  else { lockPointer(); sound.setRadio(!!player.car); }
}
let resetArm = false;
let moodGetter = () => 'auto', moodSetter = () => { };
export function setMoodHooks(get, set) { moodGetter = get; moodSetter = set; }
export function markSegs() {
  document.querySelectorAll('#qualSeg button, #qualSeg2 button').forEach(b => b.classList.toggle('on', b.dataset.q === qualityName));
  document.querySelectorAll('#sndSeg button').forEach(b => b.classList.toggle('on', (b.dataset.s === '1') === sound.on));
  document.querySelectorAll('#timeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === moodGetter()));
}
export function setupInput() {
  window.addEventListener('keydown', e => {
    if (e.repeat) { if (GAME_KEYS.has(e.code)) e.preventDefault(); return; }
    if (!$('missionCard').hidden) { if (e.code === 'Enter' || e.code === 'KeyF') { e.preventDefault(); closeMissionCard(true); } else if (e.code === 'Escape') closeMissionCard(false); return; }
    if (!flags.running) return;
    if (e.code === 'KeyM') { toggleMap(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { if (performance.now() - lockLostAt < 400) return; if (!$('bigmap').hidden) toggleMap(); else togglePause(); return; }
    input.keys[e.code] = true; input.pressed.add(e.code); if (GAME_KEYS.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in input.keys) input.keys[k] = false; input.mouse.l = input.mouse.r = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!flags.running || flags.paused || flags.modal) return;
    if (!input.locked && input.lockSupported && !IS_TOUCH) lockPointer();
    if (e.button === 0) input.mouse.l = true; if (e.button === 2) input.mouse.r = true; input.mouse.dragged = false; canvas.focus();
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) input.mouse.l = false; if (e.button === 2) input.mouse.r = false; });
  window.addEventListener('mousemove', e => {
    if (!flags.running || flags.paused || flags.modal) return;
    const s = player.h && player.h.aiming ? 0.0016 : 0.0023;
    if (input.locked) { cam.yaw -= e.movementX * s; cam.pitch = clamp(cam.pitch + e.movementY * s, -0.6, 1.2); cam.look = 1.6; }
    else if (e.buttons & 3) { cam.yaw -= e.movementX * s * 1.2; cam.pitch = clamp(cam.pitch + e.movementY * s * 1.2, -0.6, 1.2); cam.look = 1.6; if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) input.mouse.dragged = true; }
  });
  canvas.addEventListener('wheel', e => { if (!flags.running) return; e.preventDefault(); input.pressed.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { const was = input.locked; input.locked = document.pointerLockElement === canvas; if (was && !input.locked && flags.running && !flags.paused && !flags.modal && $('bigmap').hidden) { lockLostAt = performance.now(); togglePause(true); } });
  $('bigmap').addEventListener('click', () => toggleMap());
  $('resumeBtn').addEventListener('click', () => togglePause());
  $('resetBtn').addEventListener('click', () => { if (!resetArm) { resetArm = true; $('resetConfirm').hidden = false; return; } store.del('sb2-save'); location.reload(); });
  $('mcGo').addEventListener('click', () => closeMissionCard(true));
  $('mcNo').addEventListener('click', () => closeMissionCard(false));
  document.querySelectorAll('#qualSeg button, #qualSeg2 button').forEach(b => b.addEventListener('click', () => { if (b.dataset.q === qualityName) return; store.set('sb2-quality', b.dataset.q); if (flags.running) save(); location.reload(); }));
  document.querySelectorAll('#sndSeg button').forEach(b => b.addEventListener('click', () => { sound.setOn(b.dataset.s === '1'); markSegs(); }));
  document.querySelectorAll('#timeSeg button').forEach(b => b.addEventListener('click', () => { moodSetter(b.dataset.m); markSegs(); }));
  setHintSource(() => {
    if (!player.car && !player.entering) { const v = nearestEnterable(3.6); if (v) return IS_TOUCH ? (v.mode === 'traffic' ? 'הקש <kbd>רכב</kbd> כדי לגנוב' : 'הקש <kbd>רכב</kbd> כדי להיכנס') : (v.mode === 'traffic' || (v.mode === 'police' && !v.ai.deployed) ? 'לחץ <kbd>F</kbd> כדי לגנוב את הרכב' : 'לחץ <kbd>F</kbd> כדי להיכנס לרכב'); }
    else if (!player.car) return '';
    else if (player.car.fire > 0) return 'הרכב עולה באש! צא ממנו <kbd>F</kbd>';
    else if (player.car.upY < 0.3 && player.car.speedAbs < 2) return 'הרכב התהפך… מיד יוחזר לגלגלים';
    return '';
  });
}
export function setupTouch() {
  document.body.classList.add('touch'); $('touch').hidden = false;
  const stick = $('stick'), knob = stick.firstElementChild; let sid = null; const joy = input.joy, tb = input.touch;
  const upd = (t) => { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * 44}px,${dy * 44}px)`; };
  stick.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; upd(t); }, { passive: false });
  stick.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) upd(t); }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; joy.x = joy.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
  const hold = (id, key) => { const el = $(id); el.addEventListener('touchstart', e => { e.preventDefault(); tb[key] = true; el.classList.add('act'); if (key === 'jump') tb.jumpTap = true; }, { passive: false }); const off = () => { tb[key] = false; el.classList.remove('act'); }; el.addEventListener('touchend', off); el.addEventListener('touchcancel', off); };
  hold('tFire', 'fire'); hold('tJump', 'jump'); hold('tSprint', 'sprint');
  $('tEnter').addEventListener('touchstart', e => { e.preventDefault(); input.pressed.add('KeyF'); }, { passive: false });
  $('tWeap').addEventListener('touchstart', e => { e.preventDefault(); if (player.car) input.pressed.add('KeyR'); else tb.weapTap = true; }, { passive: false });
  $('minimap').addEventListener('touchstart', e => { e.preventDefault(); toggleMap(); }, { passive: false });
  $('mapWrap').style.pointerEvents = 'auto';
  $('tPause').addEventListener('touchstart', e => { e.preventDefault(); togglePause(); }, { passive: false });
  let lid = null, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', e => { for (const t of e.changedTouches) if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: true });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === lid) { cam.yaw -= (t.clientX - lx) * 0.006; cam.pitch = clamp(cam.pitch + (t.clientY - ly) * 0.005, -0.6, 1.2); lx = t.clientX; ly = t.clientY; cam.look = 1.6; } }, { passive: false });
  const cend = e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; };
  canvas.addEventListener('touchend', cend); canvas.addEventListener('touchcancel', cend);
}
