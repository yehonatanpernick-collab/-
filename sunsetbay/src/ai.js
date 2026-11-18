import * as THREE from 'three';
import { CFG, clamp, damp, lerp, wrapA, rnd, rndi, pick, dist2, headingTo, sound, IS_TOUCH } from './core.js';
import { camera, Q } from './render.js';
import * as W from './world.js';
import { lib, Human, PED_MODELS, COP_MODELS, GANG_MODELS, frustum } from './characters.js';
import { Vehicle, carReady, TRAFFIC_TYPES, yawQ, NIGHT } from './vehicles.js';
import { R, world, G, groups, raycast, colliderInfo, removePropCollider } from './physics.js';
import { humans, vehicles, player, wanted, mission, clock, stats, WEAPONS, input, cam, flags } from './state.js';
import * as FX from './fx.js';
import { toast, hudHeat, hitMarker } from './hud.js';
import { hurtPlayer, bust, exitCar } from './player.js';
import { dropPickup } from './missions.js';

const { CELL, HRW, NB, NI, RW, nodeC, blockLo, blockHi } = W;
export let gunModel = null;
export function setGunModel(m) { gunModel = m; }

/* =====================================================================
   HUMANS
   ===================================================================== */
export function spawnHuman(kind, x, z, yaw = 0, model) {
  const name = model || (kind === 'cop' ? pick(COP_MODELS) : kind === 'gang' ? pick(GANG_MODELS) : pick(PED_MODELS));
  const inst = lib.instantiateSync(name); if (!inst) return null;
  const h = new Human(inst, kind);
  h.setPosition(x, W.groundHeight(x, z), z); h.yaw = yaw; h.vx = h.vz = 0; h.ai = {};
  if (kind === 'cop' || kind === 'gang' || kind === 'player') h.attachGun(gunModel);
  h.playBase(h.idleClip, 0);
  humans.push(h); return h;
}
export function removeHuman(h) { h.dispose(); h.removed = true; const i = humans.indexOf(h); if (i >= 0) humans.splice(i, 1); }
export function moveHuman(h, dx, dz) {
  let x = h.x + dx, z = h.z + dz; const r = 0.32;
  for (const b of W.bQuery(x - 1, z - 1, x + 1, z + 1)) {
    if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) {
      const pl = x - (b.x0 - r), pr = (b.x1 + r) - x, pt = z - (b.z0 - r), pb = (b.z1 + r) - z, m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = b.x0 - r; else if (m === pr) x = b.x1 + r; else if (m === pt) z = b.z0 - r; else z = b.z1 + r;
    }
  }
  W.pNear(x, z, p => { if (!p.solid && !p.knock) return; const ddx = x - p.x, ddz = z - p.z, d = Math.hypot(ddx, ddz), m = p.r + 0.28; if (d < m && d > 0.001) { x = p.x + ddx / d * m; z = p.z + ddz / d * m; } });
  if (!W.inBounds(x, z)) { x = h.x; z = h.z; }
  h.x = x; h.z = z;
}
const DEATHS = ['death1', 'death2', 'death3', 'death4'];
export function killHuman(h, fromX, fromZ) {
  if (h.state === 'dead') return;
  h.alive = false; h.hp = 0; h.state = 'dead'; h.aiming = false; h.setUpper(null, 0.1); h.deadT = 0;
  // fall backwards when hit from the front
  const ang = Math.abs(wrapA(Math.atan2(fromX - h.x, fromZ - h.z) - h.yaw));
  const clip = ang < 1.6 ? pick(['death3', 'death4', 'death2']) : 'death1';
  h.playOnce(clip, { fade: 0.08 });
}
export function damageHuman(h, n, by, sx, sz, launch = false) {
  if (!h.alive) return;
  if (h === player.h) { hurtPlayer(n, sx, sz); return; }
  h.hp -= n;
  if (h.kind === 'ped' && h.hp > 0) { h.ai.mode = 'flee'; h.ai.flee = 10; h.ai.fx = sx; h.ai.fz = sz; }
  if (h.kind === 'cop' || h.kind === 'gang') { h.ai.provoked = true; h.ai.hostile = true; }
  if (h.hp <= 0) {
    if (!launch && h.state !== 'air') killHuman(h, sx, sz); else { h.alive = false; h.hp = 0; }
    if (by === 'player') {
      if (h.kind === 'cop') { addHeat(3.2, 'copkill'); stats.copsKilled++; }
      else if (h.kind === 'ped') { addHeat(1.1, 'kill'); if (Math.random() < 0.45) dropPickup(h.x, h.z, 'cash', rndi(10, 80)); }
      else if (h.kind === 'gang') { if (Math.random() < 0.6) dropPickup(h.x, h.z, 'cash', rndi(40, 160)); }
    }
    alarm(h.x, h.z, 25, 1);
  } else {
    if (by === 'player') { if (h.kind === 'cop') addHeat(1.4, 'copshot'); else if (h.kind === 'ped') addHeat(0.45, 'assault'); }
    if (!launch && h.state === 'normal' && !h.oneShot) h.playOnce(pick(['hit', 'hitBody']), { fade: 0.06, ts: 1.3 });
  }
  if (launch) launchFrom(h, sx, sz, 6);
}
export function launchFrom(h, sx, sz, sp) {
  const dx = h.x - sx, dz = h.z - sz, d = Math.hypot(dx, dz) || 1;
  h.state = 'air'; h.vx = dx / d * sp; h.vz = dz / d * sp; h.vy = 4; h.aiming = false; h.setUpper(null, 0.05);
  h.playOnce('knock', { fade: 0.05, ts: 1.2 });
}
export function launchByCar(h, v, sp) {
  h.state = 'air'; h.vx = v.vx * 0.8 + rnd(-1, 1); h.vz = v.vz * 0.8 + rnd(-1, 1); h.vy = 2.5 + sp * 0.16; h.y += 0.3; h.aiming = false; h.setUpper(null, 0.05);
  h.playOnce('knock', { fade: 0.05, ts: 1.1 });
}
export function ragdollStep(h, dt) {
  if (h.state === 'air') {
    h.vy -= CFG.gravity * dt; h.y += h.vy * dt;
    const ox = h.x, oz = h.z; moveHuman(h, h.vx * dt, h.vz * dt); if (h.x === ox && h.z === oz) { h.vx *= -0.3; h.vz *= -0.3; }
    const g = W.groundHeight(h.x, h.z);
    if (h.y <= g) {
      h.y = g; h.vy = 0; h.vx *= 0.25; h.vz *= 0.25; sound.thud();
      if (!h.alive) { h.state = 'dead'; h.deadT = 0; }
      else { h.state = 'down'; h.timer = rnd(1.2, 2.2); }
    }
  } else if (h.state === 'down') {
    h.vx = damp(h.vx, 0, 4, dt); h.vz = damp(h.vz, 0, 4, dt); moveHuman(h, h.vx * dt, h.vz * dt);
    h.timer -= dt;
    if (h.timer <= 0 && !h.gettingUp) {
      h.gettingUp = true;
      h.playOnce('getUp', { fade: 0.15, ts: 1.15, then: () => { h.gettingUp = false; h.state = 'normal'; if (h.kind === 'ped') { h.ai.mode = 'flee'; h.ai.flee = 8; h.ai.fx = player.x; h.ai.fz = player.z; } } });
    }
  }
}

/* =====================================================================
   ROAD GRAPH helpers
   ===================================================================== */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const dirH = d => Math.atan2(DIRS[d][0], DIRS[d][1]);
export const validNode = (i, j) => i >= 0 && j >= 0 && i < NI && j < NI;
const laneOff = l => l ? 5.8 : 2.2;
export function nearestNode(x, z) { return [clamp(Math.round(x / CELL + 3.5), 0, NI - 1), clamp(Math.round(z / CELL + 3.5), 0, NI - 1)]; }
export function bfsRoute(si, sj, ti, tj) {
  if (si === ti && sj === tj) return [[si, sj]];
  const prev = new Map(), q = [[si, sj]], key = (i, j) => j * 10 + i; prev.set(key(si, sj), null);
  while (q.length) { const [i, j] = q.shift(); if (i === ti && j === tj) break; for (const [dx, dz] of DIRS) { const ni = i + dx, nj = j + dz; if (!validNode(ni, nj) || prev.has(key(ni, nj))) continue; prev.set(key(ni, nj), [i, j]); q.push([ni, nj]); } }
  const path = []; let cur = [ti, tj]; while (cur) { path.unshift(cur); cur = prev.get(key(cur[0], cur[1])); } return path;
}
export const _frus = frustum;
export function inView(x, y, z, r) { return frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), r)); }

/* =====================================================================
   VEHICLES: spawning, traffic
   ===================================================================== */
export function spawnVehicle(type, x, z, h, opts = {}) {
  const tpl = carReady.get(type); if (!tpl) return null;
  const v = new Vehicle(tpl, type, opts); v.place(x, z, h);
  v.makeBody(!!opts.kinematic); v.place(x, z, h);
  vehicles.push(v); return v;
}
export function removeVehicle(v) { v.dispose(); v.removed = true; const i = vehicles.indexOf(v); if (i >= 0) vehicles.splice(i, 1); }
function chooseNext(i, j, d) {
  const opts = [];
  for (const [nd, w] of [[d, 0.55], [(d + 1) % 4, 0.25], [(d + 3) % 4, 0.2]]) { const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1]; if (validNode(ni, nj)) opts.push([nd, w]); }
  let tw = opts.reduce((a, o) => a + o[1], 0), r = Math.random() * tw;
  for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; } return opts[0][0];
}
function setTraffic(v, i, j, d, s, lane) {
  v.mode = 'traffic'; v.isPlayer = false;
  const a = v.ai = { i, j, d, s, lane, lo: laneOff(lane), phase: 'edge', speed: rnd(9, 13), cruise: rnd(11, 15.5), blocked: 0, braking: false };
  a.next = chooseNext(i + DIRS[d][0], j + DIRS[d][1], d);
  a.tlane = a.next === (d + 1) % 4 ? 1 : a.next === (d + 3) % 4 ? 0 : lane;
  placeTraffic(v);
}
function placeTraffic(v) {
  const a = v.ai, [fx, fz] = DIRS[a.d], h = dirH(a.d), rx = -Math.cos(h), rz = Math.sin(h);
  v.x = nodeC(a.i) + fx * a.s + rx * a.lo; v.z = nodeC(a.j) + fz * a.s + rz * a.lo; v.h = h; v.y = 0;
}
function aheadLimit(v, fx, fz, maxD, latW) {
  const rx = -fz, rz = fx; let lim = 1e9; let who = null;
  for (const o of vehicles) {
    if (o === v || o.removed) continue; const dx = o.x - v.x, dz = o.z - v.z, a = dx * fx + dz * fz; if (a <= 0 || a > maxD) continue;
    const l = dx * rx + dz * rz; if (Math.abs(l) > latW + o.hwid * 0.5) continue;
    const gap = a - v.hlen - o.hlen, s = Math.max(0, (gap - 2.2) * 1.3); if (s < lim) { lim = s; who = o; }
  }
  for (const h of humans) {
    if (!h.alive || h.hidden) continue; const dx = h.x - v.x, dz = h.z - v.z, a = dx * fx + dz * fz; if (a <= 0 || a > maxD * 0.7) continue;
    const l = dx * rx + dz * rz; if (Math.abs(l) > 1.6) continue; const s = Math.max(0, (a - v.hlen - 2.5) * 1.2); if (s < lim) { lim = s; who = h; }
  }
  return [lim, who];
}
export function updateTraffic(v, dt) {
  const a = v.ai, [fx, fz] = DIRS[a.d];
  let target = a.hold ? 0 : a.cruise;
  if (a.phase === 'edge') {
    const stopS = CELL - HRW - 5.6;
    const ls = W.lightState(a.d % 2 === 0 ? 0 : 1, clock.t);
    if (ls !== 'g' && a.s < stopS && a.s > stopS - 40) { if (ls === 'r' || a.s < stopS - 6) target = Math.min(target, Math.max(0, (stopS - a.s - 0.6) * 0.75)); }
    const [lim, who] = aheadLimit(v, fx, fz, 26, 1.7); if (lim < target) target = lim;
    if (who && (who === player.car || who === player.h) && a.speed < 0.5) { a.blocked += dt; if (a.blocked > 2.5 && Math.random() < dt * 0.6 && v.camDist < 50) { sound.horn(); a.blocked = 0.5; } } else a.blocked = 0;
    a.speed = a.speed < target ? Math.min(target, a.speed + 3.0 * dt) : Math.max(target, a.speed - 8 * dt);
    a.braking = target < a.speed - 0.5 || (a.speed < 0.3 && target < 0.5);
    a.s += a.speed * dt;
    a.lo = damp(a.lo, laneOff(a.tlane), 0.8, dt);
    placeTraffic(v);
    if (a.s >= CELL - HRW - 1) {
      const nd = a.next, bi = a.i + fx, bj = a.j + fz, h2 = dirH(nd), r2x = -Math.cos(h2), r2z = Math.sin(h2), [f2x, f2z] = DIRS[nd];
      const lo2 = nd === a.d ? a.lo : laneOff(a.tlane);
      const E = [v.x, v.z], X = [nodeC(bi) + f2x * (HRW + 1) + r2x * lo2, nodeC(bj) + f2z * (HRW + 1) + r2z * lo2];
      let C; if (nd === a.d) C = [(E[0] + X[0]) / 2, (E[1] + X[1]) / 2]; else { const t = (X[0] - E[0]) * fx + (X[1] - E[1]) * fz; C = [E[0] + fx * t, E[1] + fz * t]; }
      let len = 0, px = E[0], pz = E[1]; for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t, x = u * u * E[0] + 2 * u * t * C[0] + t * t * X[0], z = u * u * E[1] + 2 * u * t * C[1] + t * t * X[1]; len += Math.hypot(x - px, z - pz); px = x; pz = z; }
      a.turn = { E, C, X, len, t: 0, bi, bj, nd, lo2 }; a.phase = 'turn';
    }
  } else {
    const T = a.turn, turning = T.nd !== a.d;
    const [lim] = aheadLimit(v, Math.sin(v.h), Math.cos(v.h), 12, 1.3); target = a.hold ? 0 : Math.min(turning ? 8 : a.cruise, lim);
    a.speed = a.speed < target ? Math.min(target, a.speed + 3 * dt) : Math.max(target, a.speed - 8 * dt);
    a.braking = target < a.speed - 0.5;
    T.t += a.speed * dt / T.len;
    const t = Math.min(1, T.t), u = 1 - t;
    v.x = u * u * T.E[0] + 2 * u * t * T.C[0] + t * t * T.X[0]; v.z = u * u * T.E[1] + 2 * u * t * T.C[1] + t * t * T.X[1];
    const dx = 2 * u * (T.C[0] - T.E[0]) + 2 * t * (T.X[0] - T.C[0]), dz = 2 * u * (T.C[1] - T.E[1]) + 2 * t * (T.X[1] - T.C[1]);
    if (dx * dx + dz * dz > 1e-6) v.h = Math.atan2(dx, dz);
    if (T.t >= 1) {
      a.i = T.bi; a.j = T.bj; a.d = T.nd; a.s = HRW + 1; a.lo = T.lo2; a.lane = a.lo > 4 ? 1 : 0; a.phase = 'edge';
      a.next = chooseNext(a.i + DIRS[a.d][0], a.j + DIRS[a.d][1], a.d);
      a.tlane = a.next === (a.d + 1) % 4 ? 1 : a.next === (a.d + 3) % 4 ? 0 : (Math.random() < 0.5 ? a.lane : 1 - a.lane);
    }
  }
  const sh = Math.sin(v.h), ch = Math.cos(v.h);
  v.vx = sh * a.speed; v.vz = ch * a.speed; v.fwdSpeed = a.speed; v.speedAbs = a.speed; v.braking = a.braking;
  v.steerVis = a.phase === 'turn' && a.turn.nd !== a.d ? (a.turn.nd === (a.d + 1) % 4 ? -0.45 : 0.45) : 0;
  v.body.setNextKinematicTranslation({ x: v.x, y: 0.0, z: v.z }); v.body.setNextKinematicRotation(yawQ(v.h));
}
export function spawnTrafficCar(near) {
  for (let tries = 0; tries < 12; tries++) {
    const axisAlongX = Math.random() < 0.5, line = rndi(0, NI - 1), seg = rndi(0, NB - 1);
    const d = axisAlongX ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3);
    let i, j; if (axisAlongX) { i = d === 0 ? seg : seg + 1; j = line; } else { i = line; j = d === 1 ? seg : seg + 1; }
    const s = rnd(14, CELL - 30), lane = Math.random() < 0.5 ? 0 : 1, [fx, fz] = DIRS[d], h = dirH(d);
    const x = nodeC(i) + fx * s - Math.cos(h) * laneOff(lane), z = nodeC(j) + fz * s + Math.sin(h) * laneOff(lane);
    const dd = Math.hypot(x - near.x, z - near.z); if (dd < 70 || dd > 190) continue;
    if (vehicles.some(o => dist2(o.x, o.z, x, z) < 196)) continue;
    if (inView(x, 1, z, 6) && dd < 120) continue;
    const r = Math.random(), type = pick(TRAFFIC_TYPES), variant = r < 0.12 ? 'taxi' : null;
    const v = spawnVehicle(variant ? 'volt' : type, x, z, h, { kinematic: true, variant }); if (!v) return null;
    setTraffic(v, i, j, d, s, lane); v.place(v.x, v.z, v.h, 0); v.driverModel = pick(PED_MODELS); return v;
  }
  return null;
}
export function knockLoose(v, vx, vz) {
  if (v.mode !== 'traffic') return;
  v.mode = 'wreck'; v.toDynamic(vx, vz); v.ai = null; v.bail = 1.2 + Math.random();
}
// before stepping physics: dynamic cars hitting kinematic traffic knock it loose
export function preStepTrafficHits() {
  for (const a of vehicles) {
    if (a.removed || !a.dynamic || a.speedAbs < 2) continue;
    for (const b of vehicles) {
      if (b === a || b.removed || b.mode !== 'traffic') continue;
      const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > 49) continue;
      const hit = obbHit(a, b, 0.25); if (!hit) continue;
      const rvx = a.vx - b.vx, rvz = a.vz - b.vz, vn = rvx * hit.nx + rvz * hit.nz;
      if (vn > 2.0) { knockLoose(b, b.vx + hit.nx * vn * 0.6, b.vz + hit.nz * vn * 0.6); if (a.isPlayer) { const by = 'player'; b.lastBy = by; } }
    }
  }
}
export function obbHit(a, b, grow = 0) {
  const ax = [Math.sin(a.h), Math.cos(a.h)], ar = [-ax[1], ax[0]], bx = [Math.sin(b.h), Math.cos(b.h)], br = [-bx[1], bx[0]];
  const dx = b.x - a.x, dz = b.z - a.z; let best = 1e9, nx = 0, nz = 0;
  for (const A of [ax, ar, bx, br]) {
    const ra = (a.hlen + grow) * Math.abs(ax[0] * A[0] + ax[1] * A[1]) + (a.hwid + grow) * Math.abs(ar[0] * A[0] + ar[1] * A[1]);
    const rb = b.hlen * Math.abs(bx[0] * A[0] + bx[1] * A[1]) + b.hwid * Math.abs(br[0] * A[0] + br[1] * A[1]);
    const d = dx * A[0] + dz * A[1], o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const s = d < 0 ? -1 : 1; nx = A[0] * s; nz = A[1] * s; }
  }
  return { nx, nz, depth: best };
}

/* =====================================================================
   PEDESTRIANS
   ===================================================================== */
export function sidewalkLoop(bi, bj) { const o = 2.6; return [[blockLo(bi) + o, blockLo(bj) + o], [blockHi(bi) - o, blockLo(bj) + o], [blockHi(bi) - o, blockHi(bj) - o], [blockLo(bi) + o, blockHi(bj) - o]]; }
const validBlock = (bi, bj) => bi >= 0 && bj >= 0 && bi < NB && bj < NB;
function cornerIndex(sx, sz) { return sx < 0 ? (sz < 0 ? 0 : 3) : (sz < 0 ? 1 : 2); }
export function spawnPed(near) {
  for (let tries = 0; tries < 10; tries++) {
    const bi = rndi(0, NB - 1), bj = rndi(0, NB - 1), loop = sidewalkLoop(bi, bj), k = rndi(0, 3), t = Math.random();
    const a = loop[k], b = loop[(k + 1) % 4], x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
    const d = Math.hypot(x - near.x, z - near.z); if (d < 40 || d > 130) continue;
    if (inView(x, 1, z, 2) && d < 75) continue;
    const h = spawnHuman('ped', x, z, 0); if (!h) return null;
    const dir = Math.random() < 0.5 ? 1 : -1;
    h.ai = { mode: 'walk', bi, bj, k: dir > 0 ? (k + 1) % 4 : k, dir, speed: rnd(1.15, 1.55), flee: 0, fx: 0, fz: 0, pause: rnd(8, 30) };
    return h;
  }
  return null;
}
export function alarm(x, z, r, lvl) {
  for (const h of humans) {
    if (h.kind !== 'ped' || !h.alive || h.hidden || h.state !== 'normal') continue; const d = Math.hypot(h.x - x, h.z - z); if (d > r) continue;
    h.ai.mode = Math.random() < 0.2 && d < r * 0.5 ? 'cower' : 'flee'; h.ai.flee = rnd(6, 11); h.ai.fx = x; h.ai.fz = z; h.ai.idle = 0;
  }
}
export function updatePed(h, dt) {
  const a = h.ai;
  if (h.state === 'dead') { h.vx = h.vz = 0; return; }
  if (h.state === 'air' || h.state === 'down') { ragdollStep(h, dt); return; }
  if (h.oneShot) { h.vx = h.vz = 0; return; }
  if (a.mode === 'cower') { h.vx = h.vz = 0; h.playBase('terrified', 0.2); a.flee -= dt; if (a.flee <= 0) { a.mode = 'flee'; a.flee = 5; } return; }
  if (a.mode === 'flee') {
    a.flee -= dt; let dx = h.x - a.fx, dz = h.z - a.fz; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const sp = 5.2; h.yaw += wrapA(Math.atan2(dx, dz) - h.yaw) * Math.min(1, dt * 6);
    h.vx = Math.sin(h.yaw) * sp; h.vz = Math.cos(h.yaw) * sp; const ox = h.x, oz = h.z; moveHuman(h, h.vx * dt, h.vz * dt);
    if (Math.hypot(h.x - ox, h.z - oz) < sp * dt * 0.3) h.yaw += rnd(-1.5, 1.5);
    h.locomote(sp, dt);
    if (a.flee <= 0) { a.bi = clamp(Math.floor(h.x / CELL + 3.5), 0, NB - 1); a.bj = clamp(Math.floor(h.z / CELL + 3.5), 0, NB - 1); a.mode = 'return'; a.k = 0; }
    return;
  }
  // idle activity (phone, texting, looking around)
  if (a.idle > 0) { a.idle -= dt; h.vx = h.vz = 0; h.locomote(0, dt, { idle: a.idleClip }); return; }
  a.pause -= dt; if (a.pause <= 0 && !a.cross) { a.pause = rnd(15, 45); if (Math.random() < 0.6) { a.idle = rnd(4, 10); a.idleClip = pick(['phone', 'text', 'look', 'talk', 'idle2']); return; } }
  const loop = sidewalkLoop(a.bi, a.bj);
  let tgt = a.cross || loop[a.k];
  if (a.mode === 'return') { let best = 0, bd = 1e9; loop.forEach((p, i) => { const d = dist2(p[0], p[1], h.x, h.z); if (d < bd) { bd = d; best = i; } }); a.k = best; tgt = loop[best]; a.mode = 'walk'; }
  const dx = tgt[0] - h.x, dz = tgt[1] - h.z, d = Math.hypot(dx, dz);
  if (d < 0.6) {
    if (a.cross) { a.bi = a.cross[2]; a.bj = a.cross[3]; a.k = a.cross[4]; a.cross = null; }
    else {
      const corner = loop[a.k];
      if (Math.random() < 0.3) {
        const opts = [], cx = a.k === 1 || a.k === 2 ? 1 : -1, cz = a.k >= 2 ? 1 : -1;
        if (validBlock(a.bi + cx, a.bj)) opts.push([corner[0] + cx * (2 * 2.6 + RW), corner[1], a.bi + cx, a.bj, cornerIndex(-cx, cz)]);
        if (validBlock(a.bi, a.bj + cz)) opts.push([corner[0], corner[1] + cz * (2 * 2.6 + RW), a.bi, a.bj + cz, cornerIndex(cx, -cz)]);
        if (opts.length) { a.cross = pick(opts); return; }
      }
      a.k = (a.k + a.dir + 4) % 4;
    }
    return;
  }
  const want = Math.atan2(dx, dz); h.yaw += wrapA(want - h.yaw) * Math.min(1, dt * 5);
  let sp = a.speed;
  if (a.cross) { for (const v of vehicles) { if (v.removed) continue; const vd = Math.hypot(v.x - h.x, v.z - h.z); if (vd < 14 && v.speedAbs > 2 && W.onRoad(h.x + Math.sin(h.yaw) * 1.5, h.z + Math.cos(h.yaw) * 1.5) && !W.onRoad(h.x, h.z)) { sp = 0; break; } } }
  h.vx = Math.sin(h.yaw) * sp; h.vz = Math.cos(h.yaw) * sp; moveHuman(h, h.vx * dt, h.vz * dt);
  h.locomote(sp, dt);
}
// people vs moving cars
export function humanCarCollisions() {
  for (const v of vehicles) {
    if (v.removed) continue; const sp = v.speedAbs;
    const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx;
    for (const h of humans) {
      if (h.hidden || h.state === 'air') continue;
      const dx = h.x - v.x, dz = h.z - v.z; if (dx * dx + dz * dz > 20) continue;
      if (Math.abs(h.y - v.y) > 1.6) continue;
      const la = dx * fx + dz * fz, ll = dx * rx + dz * rz, r = 0.3;
      if (Math.abs(la) > v.hlen + r || Math.abs(ll) > v.hwid + r) continue;
      const vn = (v.vx * dx + v.vz * dz) / (Math.hypot(dx, dz) || 1);
      if (sp > 4.5 && vn > 2 && h.state !== 'dead') {
        const dmg = (sp - 3.5) * 9;
        if (h === player.h) { hurtPlayer(dmg * 0.7, v.x, v.z); launchByCar(h, v, sp); }
        else { const by = v.isPlayer ? 'player' : null; launchByCar(h, v, sp); damageHuman(h, dmg, by, v.x, v.z, false); if (!h.alive) h.state = 'air'; if (by && h.kind === 'ped' && h.alive) addHeat(0.35, 'hit'); }
        if (v.camDist < 60) { sound.thud(); sound.impact(0.3, v.camDist); }
        if (v.body && v.dynamic) { const lv = v.body.linvel(); v.body.setLinvel({ x: lv.x * 0.95, y: lv.y, z: lv.z * 0.95 }, true); }
      } else if (h.state !== 'dead' || h !== player.h) {
        const ox = (v.hlen + r) - Math.abs(la), oy = (v.hwid + r) - Math.abs(ll);
        if (ox < oy) { h.x += fx * Math.sign(la) * ox; h.z += fz * Math.sign(la) * ox; } else { h.x += rx * Math.sign(ll) * oy; h.z += rz * Math.sign(ll) * oy; }
        if (h === player.h && player.collider) player.collider.setTranslation({ x: h.x, y: h.y + 0.86, z: h.z });
      }
    }
  }
}

/* =====================================================================
   HEAT & POLICE
   ===================================================================== */
function levelFor(p) { let l = 0; CFG.heatThresholds.forEach((t, i) => { if (p >= t && i > 0) l = i; }); return l; }
export function addHeat(p, why) {
  if (player.dead || p <= 0) return;
  const before = wanted.level;
  wanted.points = Math.min(30, wanted.points + p);
  wanted.level = Math.max(wanted.level, levelFor(wanted.points));
  if (wanted.level > 0) { wanted.evade = 0; }
  if (wanted.level > before) { hudHeat(true); if (before === 0) toast('המשטרה בדרך'); }
}
export function setHeat(l) { wanted.points = Math.max(wanted.points, CFG.heatThresholds[l]); wanted.level = Math.max(wanted.level, l); wanted.evade = 0; hudHeat(true); }
export function clearHeat(msg) {
  if (wanted.level === 0) return; wanted.level = 0; wanted.points = 0; wanted.evade = 0; hudHeat(true);
  for (const v of vehicles) if (v.mode === 'police' || v.mode === 'policeStop') { v.mode = 'police'; v.ai.leaving = true; }
  for (const h of humans) if (h.kind === 'cop' && h.alive) h.ai.leaving = true;
  if (msg) toast(msg);
}
function policeUnits() { let n = 0; for (const v of vehicles) if ((v.mode === 'police' || v.mode === 'policeStop') && !v.ai.leaving && !v.dead) n++; return n; }
function spawnPoliceCar() {
  const px = player.x, pz = player.z;
  for (let tries = 0; tries < 16; tries++) {
    const i = rndi(0, NI - 1), j = rndi(0, NI - 1), x = nodeC(i) + rnd(-3, 3), z = nodeC(j) + rnd(-3, 3), d = Math.hypot(x - px, z - pz);
    if (d < 90 || d > 200) continue; if (inView(x, 1, z, 5) && d < 140) continue;
    if (vehicles.some(o => dist2(o.x, o.z, x, z) < 100)) continue;
    const v = spawnVehicle('volt', x, z, headingTo(px - x, pz - z), { variant: 'police', color: wanted.level >= 4 ? 0x16181c : 0xf1f1f1, hp: 1300 });
    if (!v) return null;
    v.mode = 'police'; v.siren = true; v.ai = { wp: null, stuck: 0, rev: 0, crew: wanted.level >= 2 ? 2 : 1, deployed: false, leaving: false };
    return v;
  }
  return null;
}
export function driveToward(v, tx, tz, maxV, dt, slowDist = 0) {
  const a = v.ai, dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
  const ang = wrapA(Math.atan2(dx, dz) - v.h), sp = v.fwdSpeed;
  if (a.rev > 0) { a.rev -= dt; v.throttle = 0; v.brake = 1; v.steer = clamp(ang * 2, -1, 1); v.hand = false; return; }
  v.steer = clamp(-ang * 2.2, -1, 1);
  let want = maxV; if (Math.abs(ang) > 0.45) want = Math.min(want, lerp(maxV, 8, clamp((Math.abs(ang) - 0.45) / 1, 0, 1)));
  if (slowDist && d < slowDist) want = Math.min(want, d * 0.6 + 2);
  if (sp < want) { v.throttle = 1; v.brake = 0; } else { v.throttle = 0; v.brake = sp - want > 4 ? 1 : 0.25; }
  v.hand = Math.abs(ang) > 1.15 && sp > 14;
  if (Math.abs(sp) < 1.2 && v.throttle > 0) { a.stuck += dt; if (a.stuck > 1.2) { a.rev = 1.2; a.stuck = 0; } } else a.stuck = Math.max(0, a.stuck - dt);
}
function roadWaypoint(v, tx, tz) {
  const a = v.ai;
  if (!a.wp || dist2(v.x, v.z, a.wp[0], a.wp[1]) < 120) {
    const [ci, cj] = a.wpn || nearestNode(v.x, v.z), [ti, tj] = nearestNode(tx, tz);
    let best = null, bd = 1e9;
    if (!a.wpn) best = [ci, cj];
    else for (const [dx, dz] of DIRS) { const ni = ci + dx, nj = cj + dz; if (!validNode(ni, nj)) continue; const s = Math.abs(ni - ti) + Math.abs(nj - tj) + Math.random() * 0.3; if (s < bd) { bd = s; best = [ni, nj]; } }
    if (a.wpn && ci === ti && cj === tj) best = [ci, cj];
    a.wpn = best; a.wp = [nodeC(best[0]), nodeC(best[1])];
  }
  return a.wp;
}
export function updatePoliceCar(v, dt) {
  const a = v.ai;
  if (v.dead) { v.throttle = v.brake = 0; v.siren = false; return; }
  if (a.leaving) { v.siren = false; const wp = roadWaypoint(v, (v.x + (v.x - player.x)) * 3, (v.z + (v.z - player.z)) * 3); driveToward(v, wp[0], wp[1], 16, dt); return; }
  const tgt = player.car || player.h, tx = tgt.x, tz = tgt.z, d = Math.hypot(tx - v.x, tz - v.z);
  const see = d < 55 && W.losClear(v.x, v.z, tx, tz);
  if (v.mode === 'policeStop') { v.throttle = 0; v.brake = 0.8; v.hand = true; v.siren = true; if (player.car && d > 30) v.mode = 'police'; return; }
  if (!player.car && d < 18 && Math.abs(v.fwdSpeed) < 5 && !a.deployed) { deployCops(v); return; }
  if (!player.car && d < 22) { driveToward(v, tx, tz, 8, dt, 14); if (d < 10) { v.throttle = 0; v.brake = 1; } return; }
  let wx, wz;
  if (see) { const lead = player.car ? 0.6 : 0; wx = tx + (player.car ? player.car.vx : 0) * lead; wz = tz + (player.car ? player.car.vz : 0) * lead; a.wpn = null; a.wp = null; }
  else { const wp = roadWaypoint(v, tx, tz); wx = wp[0]; wz = wp[1]; }
  const maxV = (wanted.level >= 4 ? 0.95 : wanted.level >= 2 ? 0.85 : 0.75) * v.C.maxV;
  driveToward(v, wx, wz, maxV, dt);
  if (player.car && wanted.level <= 2 && d < 7 && player.car.speedAbs < 1.5) { a.pin = (a.pin || 0) + dt; if (a.pin > 2.2) bust(); } else a.pin = 0;
}
export function deployCops(v) {
  const a = v.ai; a.deployed = true; v.mode = 'policeStop'; v.throttle = 0;
  for (let k = 0; k < a.crew; k++) {
    const side = k ? 1 : -1, fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx;
    const x = v.x + rx * side * (v.hwid + 0.7), z = v.z + rz * side * (v.hwid + 0.7);
    if (W.bAt(x, z, 0.3)) continue;
    const c = spawnHuman('cop', x, z, v.h); if (!c) continue;
    c.weapon = 1; c.ai = { car: v, fireT: rnd(0.5, 1.5), arrest: 0, strafe: rnd(-1, 1) };
  }
  sound.door();
}
export function updateCop(h, dt) {
  const a = h.ai;
  if (h.state === 'dead') return;
  if (h.state === 'air' || h.state === 'down') { ragdollStep(h, dt); return; }
  if (h.oneShot) return;
  if (a.leaving || player.dead) { h.aiming = false; h.setUpper(null); const dx = h.x - player.x, dz = h.z - player.z; h.yaw = Math.atan2(dx, dz); h.vx = Math.sin(h.yaw) * 1.5; h.vz = Math.cos(h.yaw) * 1.5; moveHuman(h, h.vx * dt, h.vz * dt); h.locomote(1.5, dt); return; }
  const tgt = player.car || player.h, dx = tgt.x - h.x, dz = tgt.z - h.z, d = Math.hypot(dx, dz);
  const hostile = wanted.level >= CFG.copShootFrom || a.provoked;
  const see = d < 45 && W.losClear(h.x, h.z, tgt.x, tgt.z);
  const face = Math.atan2(dx, dz);
  if (hostile && see && d < 34) {
    h.yaw += wrapA(face - h.yaw) * Math.min(1, dt * 8); h.aiming = true; h.aimPitch = 0; h.setUpper('aim');
    const sp = d < 9 ? -1.4 : d > 22 ? 2.2 : 0, s = a.strafe;
    h.vx = Math.sin(face) * sp + Math.cos(face) * s * 0.8; h.vz = Math.cos(face) * sp - Math.sin(face) * s * 0.8; moveHuman(h, h.vx * dt, h.vz * dt);
    h.locomote(Math.hypot(h.vx, h.vz), dt, { back: sp < 0 });
    a.fireT -= dt; if (a.fireT <= 0) { a.fireT = rnd(0.55, 1.1); npcShoot(h, tgt, d); if (Math.random() < 0.15) a.strafe = rnd(-1, 1); }
  } else {
    h.aiming = false; h.setUpper(null); h.yaw += wrapA(face - h.yaw) * Math.min(1, dt * 6);
    const sp = d > 3 ? 5.0 : 0; h.vx = Math.sin(h.yaw) * sp; h.vz = Math.cos(h.yaw) * sp; const ox = h.x, oz = h.z; moveHuman(h, h.vx * dt, h.vz * dt);
    if (sp > 0 && Math.hypot(h.x - ox, h.z - oz) < sp * dt * 0.25) h.yaw += 1.2;
    h.locomote(sp, dt);
    if (!hostile && !player.car && d < 1.8) { a.arrest += dt; if (a.arrest > 1.4) bust(); } else a.arrest = Math.max(0, a.arrest - dt);
  }
}
const _hp = new THREE.Vector3();
export function npcShoot(h, tgt, d) {
  h.handPos(_hp); h.recoil = 1;
  const pm = player.car ? 0.85 : (Math.hypot(player.h.vx, player.h.vz) > 4 ? 0.55 : 1);
  const hit = Math.random() < CFG.copAccuracy * pm * clamp(1.2 - d / 40, 0.2, 1);
  const ty = (player.car ? player.car.y + 0.9 : player.h.y + 1.25);
  const ox = hit ? 0 : rnd(-1.5, 1.5), oy = hit ? 0 : rnd(-0.6, 1.2), oz = hit ? 0 : rnd(-1.5, 1.5);
  FX.tracer(_hp.x, _hp.y, _hp.z, tgt.x + ox, ty + oy, tgt.z + oz, 1, 0.7, 0.35);
  FX.fx_muzzle(_hp.x, _hp.y, _hp.z, false);
  sound.shot(h.kind === 'gang' && h.weapon === 2 ? 'gang' : 'cop', Math.hypot(h.x - camera.position.x, h.z - camera.position.z));
  if (hit) {
    if (player.car) { player.car.hp -= rnd(18, 32); FX.fx_hit(tgt.x, ty, tgt.z, 'metal'); }
    else { hurtPlayer(rnd(5, 9), h.x, h.z); FX.fx_hit(tgt.x, ty, tgt.z, 'flesh'); }
  } else if (Math.random() < 0.5) FX.fx_hit(tgt.x + ox, Math.max(0.1, ty + oy - 1), tgt.z + oz, 'dust');
}
export function updateWanted(dt) {
  if (wanted.level === 0) return;
  wanted.seenT -= dt;
  if (wanted.seenT <= 0) {
    wanted.seenT = 0.3; wanted.seen = false;
    const tx = player.x, tz = player.z;
    for (const v of vehicles) if ((v.mode === 'police' || v.mode === 'policeStop') && !v.ai.leaving && !v.dead) { const d = Math.hypot(v.x - tx, v.z - tz); if (d < 75 && W.losClear(v.x, v.z, tx, tz)) { wanted.seen = true; break; } }
    if (!wanted.seen) for (const h of humans) if (h.kind === 'cop' && h.alive && !h.ai.leaving) { const d = Math.hypot(h.x - tx, h.z - tz); if (d < 50 && W.losClear(h.x, h.z, tx, tz)) { wanted.seen = true; break; } }
    if (wanted.seen) wanted.evade = 0;
  }
  if (!wanted.seen) { wanted.evade += dt; if (wanted.evade > CFG.evadeTime[wanted.level] && wanted.level > wanted.lockMin) clearHeat('איבדת את המשטרה'); }
  hudHeat(false);
  wanted.spawnT -= dt;
  if (wanted.spawnT <= 0 && policeUnits() < CFG.heatUnits[wanted.level]) { wanted.spawnT = wanted.level >= 3 ? 2.5 : 4; spawnPoliceCar(); }
}
export function updateGang(h, dt) {
  const a = h.ai;
  if (h.state === 'dead') return;
  if (h.state === 'air' || h.state === 'down') { ragdollStep(h, dt); return; }
  if (h.oneShot) return;
  const tgt = player.car || player.h, dx = tgt.x - h.x, dz = tgt.z - h.z, d = Math.hypot(dx, dz);
  if (!a.hostile) { if (h.mission && (d < 42 || a.provoked)) { a.hostile = true; alarm(h.x, h.z, 40, 1); } else { h.vx = h.vz = 0; h.aiming = false; h.locomote(0, dt, { idle: a.idleClip || 'idle2' }); return; } }
  if (player.dead) { h.aiming = false; h.setUpper(null); h.vx = h.vz = 0; h.locomote(0, dt); return; }
  const face = Math.atan2(dx, dz); h.yaw += wrapA(face - h.yaw) * Math.min(1, dt * 7);
  const see = d < 48 && W.losClear(h.x, h.z, tgt.x, tgt.z);
  if (see) {
    h.aiming = true; h.aimPitch = 0; h.setUpper('aim'); const sp = d > 25 ? 2.6 : d < 8 ? -1.4 : 0;
    h.vx = Math.sin(face) * sp + Math.cos(face) * a.strafe; h.vz = Math.cos(face) * sp - Math.sin(face) * a.strafe; moveHuman(h, h.vx * dt, h.vz * dt);
    h.locomote(Math.hypot(h.vx, h.vz), dt, { back: sp < 0 });
    a.fireT -= dt; if (a.fireT <= 0) { a.fireT = h.weapon === 2 ? rnd(0.18, 0.5) : rnd(0.6, 1.1); npcShoot(h, tgt, d); if (Math.random() < 0.2) a.strafe = rnd(-1.4, 1.4); }
  } else { h.aiming = false; h.setUpper(null); const sp = 4.6; h.vx = Math.sin(face) * sp; h.vz = Math.cos(face) * sp; const ox = h.x, oz = h.z; moveHuman(h, h.vx * dt, h.vz * dt); if (Math.hypot(h.x - ox, h.z - oz) < sp * dt * 0.25) h.yaw += 1.3; h.locomote(sp, dt); }
}

/* =====================================================================
   COMBAT
   ===================================================================== */
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _rv = new THREE.Vector3();
// humans as spheres; world (buildings, cars, props) via the physics raycast
export function raycastAll(origin, dir, maxD, skipCar) {
  let best = { t: maxD, kind: 'none' };
  for (const h of humans) {
    if (h === player.h || h.hidden || h.state === 'dead') continue;
    const ox = h.x - origin.x, oz = h.z - origin.z; if (ox * ox + oz * oz > maxD * maxD) continue;
    const down = h.state === 'down';
    const sc = h.height / 1.78;
    for (const [yy, rr, head] of down ? [[0.25, 0.45, false]] : [[1.1 * sc, 0.4, false], [0.55 * sc, 0.32, false], [1.62 * sc, 0.16, true]]) {
      _rv.set(h.x, h.y + yy, h.z).sub(origin); const tca = _rv.dot(dir); if (tca < 0) continue;
      const d2 = _rv.lengthSq() - tca * tca; if (d2 > rr * rr) continue; const t = tca - Math.sqrt(rr * rr - d2);
      if (t < best.t) best = { t, kind: 'human', h, head };
    }
  }
  const exclude = skipCar && skipCar.collider ? skipCar.collider : (player.collider || null);
  const r = raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, best.t, G.STATIC | G.CAR | G.PROP, exclude);
  if (r && r.toi < best.t) {
    const info = colliderInfo.get(r.collider.handle);
    best = { t: r.toi, kind: info ? (info.kind === 'car' ? 'car' : info.kind === 'prop' ? 'prop' : 'wall') : 'wall', v: info && info.kind === 'car' ? info.ref : null, prop: info && info.kind === 'prop' ? info.ref : null, n: [r.nx, r.ny, r.nz] };
  }
  best.p = origin.clone().addScaledVector(dir, best.t);
  return best;
}
export function shootFrom(muzzle, aimOrigin, aimDir, W_, by) {
  const n = W_.pellets || 1;
  let anyHit = false;
  for (let k = 0; k < n; k++) {
    const sp = W_.spread;
    _d.copy(aimDir).add(_rv.set(rnd(-sp, sp), rnd(-sp, sp), rnd(-sp, sp))).normalize();
    const hit = raycastAll(aimOrigin, _d.clone(), W_.range, player.car);
    FX.tracer(muzzle.x, muzzle.y, muzzle.z, hit.p.x, hit.p.y, hit.p.z);
    if (hit.kind === 'human') { damageHuman(hit.h, W_.dmg * (hit.head ? 2.6 : 1), by, player.x, player.z, false); FX.fx_hit(hit.p.x, hit.p.y, hit.p.z, 'flesh'); anyHit = true; }
    else if (hit.kind === 'car') { damageCar(hit.v, W_.dmg * 1.2, by); FX.fx_hit(hit.p.x, hit.p.y, hit.p.z, 'metal'); if (hit.v.variant === 'police') addHeat(0.5, 'copcar'); if (hit.v.mode === 'traffic' && Math.random() < 0.35) knockLoose(hit.v, hit.v.vx, hit.v.vz); anyHit = true; }
    else if (hit.kind !== 'none') { FX.fx_hit(hit.p.x, hit.p.y, hit.p.z, 'dust'); if (hit.n && hit.kind === 'wall') FX.bulletHole(hit.p.x, hit.p.y, hit.p.z, hit.n[0], hit.n[1], hit.n[2]); }
  }
  if (anyHit) hitMarker();
}
export function damageCar(v, n, by) {
  if (!v || v.dead) return; v.hp -= n; if (by) v.lastBy = by;
  if (v.mode === 'traffic' && n > 30) knockLoose(v, v.vx, v.vz);
  if (v.hp <= 0 && !v.fire) { v.hp = 0; v.fire = 0.01; }
}
export function explode(x, y, z, by) {
  const cd = Math.hypot(x - camera.position.x, z - camera.position.z);
  sound.explosion(cd); FX.shake(clamp(1.4 - cd / 60, 0, 1.2)); FX.fx_explosion(x, y, z);
  for (const v of vehicles) {
    const d = Math.hypot(v.x - x, v.z - z); if (d > 11 || v.removed) continue;
    const f = 1 - d / 11; if (v.mode === 'traffic') knockLoose(v, v.vx, v.vz);
    if (v.body && v.dynamic) { const nx = (v.x - x) / (d || 1), nz = (v.z - z) / (d || 1), m = v.C.mass; v.body.applyImpulse({ x: nx * f * m * 9, y: f * m * 7, z: nz * f * m * 9 }, true); v.body.applyTorqueImpulse({ x: rnd(-1, 1) * m * f * 3, y: rnd(-1, 1) * m * f, z: rnd(-1, 1) * m * f * 3 }, true); }
    if (d > 0.5) damageCar(v, f * 700, by);
  }
  for (const h of humans) {
    if (!h.alive || h.hidden) continue; const d = Math.hypot(h.x - x, h.z - z); if (d > 8) continue; const f = 1 - d / 8;
    if (h === player.h) { hurtPlayer(f * 140, x, z); if (f > 0.35) launchFrom(h, x, z, 7 * f); continue; }
    damageHuman(h, f * 200, by, x, z, true);
  }
  alarm(x, z, 60, 1);
}
export function blowUp(v) {
  if (v.dead) return; v.dead = true; v.fire = 0; v.hp = 0; v.burnt(); v.siren = false;
  const by = v.lastBy === 'player' || v.isPlayer ? 'player' : null;
  const wasMine = player.car === v; if (wasMine) exitCar(true);
  explode(v.x, v.y, v.z, by);
  if (wasMine) hurtPlayer(999, v.x, v.z);
  if (by && v.variant === 'police') addHeat(3, 'copcar');
  if (v.body && v.dynamic) v.body.applyImpulse({ x: 0, y: v.C.mass * 6, z: 0 }, true);
  v.mode = 'wreck'; v.bail = null; v.driverModel = null;
  return by;
}
export function vehicleStatus(v, dt) {
  if (v.removed) return;
  if (v.dead) { if (Math.random() < dt * 3 && v.camDist < 150) FX.fx_smoke(v.x, v.y + 1.2, v.z, 0.12, 1.3); v.deadT = (v.deadT || 0) + dt; return; }
  const fx = Math.sin(v.h), fz = Math.cos(v.h), hx = v.x + fx * (v.hlen - 0.9), hz = v.z + fz * (v.hlen - 0.9);
  if (v.hp < v.maxHp * 0.35 && v.camDist < 120 && Math.random() < dt * (v.hp < v.maxHp * 0.15 ? 14 : 6)) FX.fx_smoke(hx, v.y + v.H * 0.7, hz, v.hp < v.maxHp * 0.15 ? 0.15 : 0.55, 0.8);
  if (v.fire > 0) {
    v.fire += dt; if (v.camDist < 150) { FX.fx_fire(hx, v.y + v.H * 0.6, hz, 0.9); if (Math.random() < 0.5) FX.fx_smoke(hx, v.y + v.H, hz, 0.1, 1.2); }
    if (v.driverModel && v.bail === undefined) v.bail = 0;
    if (v.fire > 5.5) blowUp(v);
  }
  // sinking in the sea
  if (v.y < -0.9 && !v.drowned) { v.drowned = true; v.hp = Math.min(v.hp, 1); FX.fx_splash(v.x, -0.5, v.z, 40); sound.impact(0.6, v.camDist); }
  if (v.bail !== undefined && v.bail !== null) {
    v.bail -= dt;
    if (v.bail <= 0 && (v.speedAbs < 3 || v.fire > 0)) {
      v.bail = null;
      if (v.driverModel && !v.isPlayer) { const lx = Math.cos(v.h), lz = -Math.sin(v.h); const p = spawnHuman('ped', v.x + lx * (v.hwid + 0.8), v.z + lz * (v.hwid + 0.8), v.h, v.driverModel); if (p) p.ai = { mode: 'flee', flee: 9, fx: v.x, fz: v.z, bi: 0, bj: 0, k: 0, dir: 1, speed: 1.3, pause: 30 }; }
      v.driverModel = null;
    }
  }
}
// contact force events from the physics step -> damage, sparks, sounds
export function handleContacts(ev) {
  ev.drainContactForceEvents(e => {
    const a = colliderInfo.get(e.collider1()), b = colliderInfo.get(e.collider2());
    const F = e.totalForceMagnitude();
    for (const [me, other] of [[a, b], [b, a]]) {
      if (!me || me.kind !== 'car') continue; const v = me.ref; if (v.removed) continue;
      const imp = F / v.C.mass; // m/s^2-ish
      if (v.graceT && performance.now() - v.graceT < 800) { if (other && other.kind === 'prop' && other.ref.alive) { if (other.ref.knock) knockProp(other.ref, v); else removePropCollider(other.ref); } continue; }
      const thr = other && (other.kind === 'ground' || other.kind === 'sand') ? 45 : 25;
      if (imp > thr) {
        const dmg = Math.min(350, (imp - thr) * 1.6); damageCar(v, dmg, other && other.kind === 'car' && other.ref.isPlayer ? 'player' : v.lastBy);
        if (v.camDist < 70 && (!v._snd || clock.t - v._snd > 0.25)) { v._snd = clock.t; sound.impact(clamp(imp / 160, 0.15, 1), v.camDist); FX.fx_sparks(v.x, v.y + 0.6, v.z, Math.min(30, imp / 6)); }
        if (v.isPlayer) FX.shake(clamp(imp / 300, 0.05, 0.7));
        if (other && other.kind === 'car' && other.ref.variant === 'police' && v.isPlayer) addHeat(0.5, 'ram');
      }
      if (other && other.kind === 'prop' && other.ref.knock && other.ref.alive && v.speedAbs > 3) knockProp(other.ref, v);
    }
  });
}
export const geysers = [];
export function knockProp(p, v) {
  p.alive = false; removePropCollider(p);
  const d = W.INST[p.inst ? p.inst[0] : 'x'];
  if (p.inst) for (const name of p.inst) {
    const m = W.INST[name] && W.INST[name].mesh; if (!m) continue;
    if (p.kind === 'lamp') { const ang = Math.atan2(v.vx, v.vz); m.setMatrixAt(p.idx, W.M4(p.x, W.CURB, p.z, ang, 1, 1, 1, Math.PI / 2 - 0.12, 0)); }
    else m.setMatrixAt(p.idx, new THREE.Matrix4().makeScale(0, 0, 0));
    m.instanceMatrix.needsUpdate = true;
  }
  if (p.kind === 'hydrant') geysers.push({ x: p.x, z: p.z, t: 9 });
  FX.fx_sparks(p.x, 1, p.z, 10); if (v.camDist < 60) sound.impact(0.5, v.camDist);
  if (v.isPlayer) addHeat(0.08, 'vandal');
}
