import * as THREE from 'three';
import { Pose } from './rig.js';
import { MOVES } from './moves.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _v = new V3(), _v2 = new V3(), _v3 = new V3();

// ---------- base stance (character space) ----------
function stancePose() {
  const p = new Pose();
  p.hips.set(0, -0.075, 0); p.hipsYaw = -0.42; p.chestYaw = -0.52; p.chestPitch = 0.12;
  p.headYaw = 0.32; p.headPitch = 0.1;
  p.handL.set(0.07, 1.44, 0.31); p.handR.set(-0.1, 1.46, 0.17);
  p.poleL.set(0.45, -1, -0.25); p.poleR.set(-0.35, -1, -0.35);
  p.twistL = 0.25; p.twistR = -0.2;
  p.footL.set(0.13, 0, 0.2); p.footR.set(-0.14, 0, -0.22); p.footYawL = -0.3; p.footYawR = -0.75;
  p.kneeL.set(0.25, 0, 1); p.kneeR.set(-0.1, 0, 1);
  p.shrugL = 0.08; p.shrugR = 0.08;
  return p;
}
const STANCE = stancePose();
const STANCE_FOOT = { L: STANCE.footL.clone(), R: STANCE.footR.clone() };

class Spring {
  constructor(k = 160, c = 15) { this.x = 0; this.v = 0; this.k = k; this.c = c; }
  kick(v) { this.v += v; }
  step(dt) { this.v += (-this.k * this.x - this.c * this.v) * dt; this.x += this.v * dt; }
}

export class Fighter {
  constructor(model, info) {
    this.m = model; this.rig = model.rig; this.info = info;
    this.root = model.root;
    this.pivot = new THREE.Group();
    this.root.add(this.pivot); this.pivot.add(model.model);
    this.pos = new V3(); this.vel = new V3(); this.yaw = 0;
    this.pose = new Pose();
    this.reset();
    this.sp = {
      hp: new Spring(170, 13), hy: new Spring(150, 12), hr: new Spring(150, 12),
      cp: new Spring(120, 12), cy: new Spring(120, 12), cr: new Spring(120, 12),
      hz: new Spring(90, 11), hx: new Spring(90, 11), hyy: new Spring(110, 12),
    };
    this.time = Math.random() * 10;
  }

  reset() {
    this.health = 100; this.maxHealth = 100; this.stamina = 100; this.legDmg = 0;
    this.state = 'idle'; this.stateT = 0;
    this.move = null; this.moveT = 0; this.moveHit = false; this.queued = null; this.queueT = 0;
    this.blockW = 0; this.slipW = 0; this.slipDir = 1; this.slipT = 0; this.bodyW = 0;
    this.stun = 0; this.stunT = 0; this.wobble = 0;
    this.knockdowns = 0; this.fall = 0; this.fallDir = -1; this.getupPresses = 0;
    this.hitFlash = 0; this.sweat = 0.12; this.flush = 0;
    this.intent = { mx: 0, my: 0, block: false, slip: false, attack: null, body: false };
    this.stats = { thrown: 0, landed: 0, power: 0, dmgDealt: 0, kd: 0, roundDmg: 0, roundLanded: 0 };
    this.target = new V3();
    this.feet = {
      L: { pos: new V3(), yaw: 0, from: new V3(), to: new V3(), fromYaw: 0, toYaw: 0, t: 1, lock: false },
      R: { pos: new V3(), yaw: 0, from: new V3(), to: new V3(), fromYaw: 0, toYaw: 0, t: 1, lock: false },
    };
    this.victory = false;
    if (this.pivot) { this.pivot.rotation.set(0, 0, 0); this.pivot.position.set(0, 0, 0); }
  }

  place(x, z, yaw) {
    this.pos.set(x, 0, z); this.yaw = yaw; this.vel.set(0, 0, 0);
    for (const s of ['L', 'R']) {
      const f = this.feet[s];
      this.charToWorld(STANCE_FOOT[s], f.pos); f.yaw = yaw; f.t = 1; f.to.copy(f.pos); f.toYaw = yaw;
    }
    this.syncRoot();
  }

  charToWorld(c, out) { // char-space point -> world
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    return out.set(this.pos.x + c.x * co + c.z * s, c.y, this.pos.z - c.x * s + c.z * co);
  }
  worldToChar(w, out) {
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
    return out.set(dx * co - dz * s, w.y, dx * s + dz * co);
  }
  // world position of a bone (char data from the rig)
  bonePos(name, out) { return this.charToWorld(this.rig.b[name].p, out); }
  headPos(out) { this.bonePos('Head', out); out.y += 0.07; return out; }
  bodyPos(out) { return this.bonePos('Spine1', out); }

  get canAct() {
    return (this.state === 'idle') || (this.state === 'attack' && false);
  }
  get busy() { return this.state !== 'idle'; }
  get down() { return this.state === 'down' || this.state === 'falling' || this.state === 'getup' || this.state === 'ko'; }
  get isEvading() { return this.state === 'slip' && this.stateT > 0.03 && this.stateT < 0.34; }
  get vulnerablePhase() {
    if (this.state !== 'attack') return false;
    const m = this.move; return this.moveT < m.startup * 0.95 || this.moveT > m.startup + m.active;
  }

  startMove(id, game) {
    const m = MOVES[id];
    if (!m) return false;
    const cost = m.stam * (this.stamina < 15 ? 0.5 : 1);
    this.stamina = Math.max(0, this.stamina - cost);
    this.state = 'attack'; this.stateT = 0; this.move = m; this.moveT = 0; this.moveHit = false;
    this.stats.thrown++;
    // speed factor from stamina
    this.moveSpeed = (0.82 + 0.18 * (this.stamina / 100)) * (this.speed || 1);
    if (m.kind === 'kick') this.feet[m.leg].lock = true;
    game && game.onSwing(this, m);
    return true;
  }

  // called by controller each frame through intent
  think(dt, opp, game) {
    const it = this.intent;
    if (this.state === 'idle') {
      if (it.attack) { this.tryAttack(it.attack, it.body, game); }
      else if (it.slip && this.stamina > 4) { this.state = 'slip'; this.stateT = 0; this.slipDir = it.mx !== 0 ? Math.sign(it.mx) : -this.slipDir; this.stamina -= 3; game && game.sfx('whoosh', 0.3); }
    } else if (it.attack && !this.down) {
      // buffer the next strike (combos / pressing during hit-stun)
      this.queued = { id: it.attack, body: it.body }; this.queueT = this.state === 'attack' ? 0.4 : 0.25;
    }
    if (this.state === 'idle' && this.queued && this.queueT > 0) { const q = this.queued; this.queued = null; this.tryAttack(q.id, q.body, game); }
    it.attack = null; it.slip = false;
  }
  tryAttack(id, body, game) {
    let mid = id;
    if (body && MOVES[id + '_body']) mid = id + '_body';
    if (this.stamina < 2) return false;
    return this.startMove(mid, game);
  }

  update(dt, opp, game) {
    this.time += dt; this.stateT += dt;
    const it = this.intent;
    // ----- state machine
    if (this.state === 'attack') {
      this.moveT += dt * this.moveSpeed;
      const m = this.move;
      if (!this.moveHit && this.moveT >= m.startup) { this.moveHit = true; game.resolveHit(this, opp, m); }
      if (this.moveT >= m.total) {
        if (m.kind === 'kick') this.feet[m.leg].lock = false;
        this.state = 'idle'; this.move = null;
        if (this.queued && this.queueT > 0) { const q = this.queued; this.queued = null; this.tryAttack(q.id, q.body, game); }
      } else if (this.queued && this.moveT > m.startup + m.active + m.recovery * 0.45) {
        // cancel late recovery into the next strike (combo flow)
        if (MOVES[this.queued.id] && MOVES[this.queued.id].kind === 'punch' && m.kind === 'punch') {
          const q = this.queued; this.queued = null; this.state = 'idle'; this.move = null; this.tryAttack(q.id, q.body, game);
        }
      }
    } else if (this.state === 'slip') {
      if (this.stateT > 0.46) this.state = 'idle';
    } else if (this.state === 'hit') {
      if (this.stateT > this.stunT) this.state = 'idle';
    } else if (this.state === 'rocked') {
      if (this.stateT > this.stunT) this.state = 'idle';
    } else if (this.state === 'falling') {
      this.fall = Math.min(1, this.fall + dt * 1.9);
      if (this.fall >= 1) { this.state = 'down'; this.stateT = 0; game.onDown(this); }
    } else if (this.state === 'getup') {
      this.fall = Math.max(0, this.fall - dt * 0.9);
      if (this.fall <= 0) { this.state = 'idle'; this.stateT = 0; game.onUp(this); }
    }
    if (this.queueT > 0) this.queueT -= dt; else this.queued = null;

    // ----- block / guard
    const wantBlock = it.block && (this.state === 'idle' || this.state === 'hit') && !this.down;
    this.blockW = damp(this.blockW, wantBlock ? 1 : 0, 22, dt);
    this.bodyW = damp(this.bodyW, it.body && !this.down ? 1 : 0, 10, dt);

    // ----- stamina regen
    const regen = this.state === 'attack' ? 0 : (wantBlock ? 5 : 13) * (0.55 + 0.45 * this.health / 100);
    this.stamina = Math.min(100, this.stamina + regen * dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.lastHitT = (this.lastHitT || 0) + dt;
    if (this.lastHitT > 2.2 && !this.down && this.health > 0) this.health = Math.min(this.maxHealth, this.health + 1.6 * dt);
    this.flush = damp(this.flush, (1 - this.health / 100) * 0.9, 1.5, dt);

    // ----- movement
    const toOpp = _v.set(opp.pos.x - this.pos.x, 0, opp.pos.z - this.pos.z);
    const dist = toOpp.length(); toOpp.multiplyScalar(1 / (dist || 1));
    let speed = 1.75 * (1 - this.legDmg * 0.45) * (0.7 + 0.3 * this.stamina / 100);
    let mx = it.mx, my = it.my;
    if (this.down || this.state === 'rocked') { mx = 0; my = 0; }
    if (this.state === 'attack') speed *= this.move.kind === 'kick' ? 0.1 : 0.45;
    if (this.state === 'hit') speed *= 0.3;
    if (wantBlock) speed *= 0.55;
    const side = _v2.set(toOpp.z, 0, -toOpp.x); // to the fighter's right? (left-handed)
    const desired = _v3.set(0, 0, 0).addScaledVector(toOpp, my * speed).addScaledVector(side, -mx * speed * 0.85);
    // rocked fighters stagger
    if (this.state === 'rocked') desired.set(Math.sin(this.time * 3.1) * 0.5, 0, Math.cos(this.time * 2.3) * 0.5);
    this.vel.x = damp(this.vel.x, desired.x, this.down ? 30 : 9, dt);
    this.vel.z = damp(this.vel.z, desired.z, this.down ? 30 : 9, dt);
    if (!this.down) this.pos.addScaledVector(this.vel, dt);
    // facing
    if (!this.down) {
      const want = Math.atan2(toOpp.x, toOpp.z);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = this.state === 'attack' ? 6 : 10;
      this.yaw += d * (1 - Math.exp(-turn * dt));
    }
    this.dist = dist;

    // springs
    for (const k in this.sp) this.sp[k].step(dt);

    this.updateFeet(dt);
    this.buildPose(dt, opp);
    this.rig.apply(this.pose);
    this.syncRoot();
    // sweat
    for (const m of this.m.sweatMats) {
      if (m.userData.uni) { m.userData.uni.uSweat.value = this.sweat; m.userData.uni.uFlush.value = this.flush; }
      else {
        m.clearcoat = this.sweat * 0.8; m.roughness = 0.55 - this.sweat * 0.2;
        const bc = m.userData.base || (m.userData.base = m.color.clone());
        m.color.setRGB(bc.r * (1 + this.flush * 0.12 + this.hitFlash * 0.1), bc.g * (1 - this.flush * 0.12), bc.b * (1 - this.flush * 0.14));
      }
    }
    // face
    const mouth = this.pose.mouth;
    for (const fm of this.m.faceMeshes) {
      const i = fm.morphTargetDictionary.mouthOpen; if (i !== undefined) fm.morphTargetInfluences[i] = mouth;
    }
  }

  syncRoot() {
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = this.yaw;
    // falling pivot: rotate around the feet
    const a = smooth(this.fall) * Math.PI * 0.5;
    if (this.fallDir < 0) { this.pivot.rotation.set(-a, 0, 0); this.pivot.position.set(0, Math.sin(a) * 0.13, -Math.sin(a) * 0.15); }
    else { this.pivot.rotation.set(a * 0.98, 0, 0); this.pivot.position.set(0, Math.sin(a) * 0.16, Math.sin(a) * 0.05); }
  }

  updateFeet(dt) {
    const yaw = this.yaw;
    const order = ['L', 'R'];
    let stepping = order.some(s => this.feet[s].t < 1);
    for (const s of order) {
      const f = this.feet[s];
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / 0.15);
        const k = smooth(f.t);
        f.pos.lerpVectors(f.from, f.to, k);
        f.pos.y = Math.sin(Math.PI * f.t) * 0.045;
        let dy = f.toYaw - f.fromYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        f.yaw = f.fromYaw + dy * k;
      }
    }
    if (this.down) return;
    // pick the foot that is furthest from its desired spot
    let best = null, bestD = 0;
    for (const s of order) {
      const f = this.feet[s];
      if (f.lock || f.t < 1) continue;
      const want = this.charToWorld(STANCE_FOOT[s], new V3()).addScaledVector(this.vel, 0.16);
      want.y = 0;
      let dyaw = yaw - f.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const d = Math.hypot(want.x - f.pos.x, want.z - f.pos.z) + Math.abs(dyaw) * 0.25;
      if (d > bestD) { bestD = d; best = { s, want }; }
    }
    if (best && !stepping && bestD > 0.075) {
      const f = this.feet[best.s];
      f.from.copy(f.pos); f.from.y = 0; f.to.copy(best.want); f.fromYaw = f.yaw; f.toYaw = yaw; f.t = 0;
    }
  }

  buildPose(dt, opp) {
    const p = this.pose.copy(STANCE);
    const t = this.time;
    const tired = 1 - this.stamina / 100;
    // breathing + bounce
    const moving = Math.min(1, this.vel.length() / 1.2);
    const bounce = Math.sin(t * 2 * Math.PI * 1.7);
    p.hips.y += bounce * 0.012 * (1 - this.blockW * 0.6) - moving * 0.01 - this.bodyW * 0.06;
    p.chestPitch += Math.sin(t * 2.2) * 0.015 * (1 + tired * 2) + this.bodyW * 0.12;
    p.hipsPitch += this.bodyW * 0.06;
    p.headPitch += -this.bodyW * 0.05;
    // tired: hands drop
    const drop = clamp((tired - 0.45) * 0.25, 0, 0.12) + (this.state === 'rocked' ? 0.18 : 0);
    p.handL.y -= drop; p.handR.y -= drop; p.handL.z += drop * 0.4;
    p.mouth = clamp(tired * 0.5 - 0.1, 0, 0.35) * (0.6 + 0.4 * Math.sin(t * 4));
    // lean in movement direction (char space)
    const lv = this.worldToChar(_v.copy(this.vel).add(this.pos), _v2);
    p.chestPitch += clamp(lv.z, -1, 1) * 0.06; p.chestRoll -= clamp(lv.x, -1, 1) * 0.05;

    // ---- block
    if (this.blockW > 0.01) {
      const b = this.blockW, bd = this.bodyW;
      _v.set(0.07, 1.53 - bd * 0.2, 0.2 - bd * 0.04); p.handL.lerp(_v, b);
      _v.set(-0.07, 1.54 - bd * 0.2, 0.16 - bd * 0.02); p.handR.lerp(_v, b);
      p.poleL.lerp(_v.set(0.15, -1, 0.1), b); p.poleR.lerp(_v.set(-0.15, -1, 0.1), b);
      p.chestPitch += 0.16 * b; p.headPitch += 0.22 * b; p.shrugL += 0.12 * b; p.shrugR += 0.12 * b;
      p.chestYaw += 0.12 * b; p.headYaw -= 0.08 * b; p.twistL += 0.5 * b; p.twistR -= 0.5 * b;
    }
    // ---- slip / duck
    if (this.state === 'slip') {
      const k = Math.sin(clamp(this.stateT / 0.46, 0, 1) * Math.PI);
      const e = k * (2 - k);
      p.hips.y -= 0.12 * e; p.chestPitch += 0.32 * e; p.chestRoll += 0.32 * e * this.slipDir; p.headRoll += 0.15 * e * this.slipDir;
      p.hips.x += 0.05 * this.slipDir * e; p.chestYaw += 0.1 * e;
    }
    // ---- attacks
    if (this.state === 'attack') this.attackPose(p, opp);
    // ---- rocked
    if (this.state === 'rocked') {
      p.headRoll += Math.sin(t * 5) * 0.12; p.chestRoll += Math.sin(t * 3.3) * 0.1; p.hips.y -= 0.04;
      p.headPitch += 0.15; p.mouth = 0.6;
    }
    if (this.state === 'hit') p.mouth = Math.max(p.mouth, 0.7 * (1 - this.stateT / Math.max(0.01, this.stunT)));
    // ---- victory
    if (this.victory) {
      const v = clamp(this.stateT * 2, 0, 1);
      p.handL.lerp(_v.set(0.32, 2.0, 0.1), v); p.handR.lerp(_v.set(-0.32, 2.0, 0.1), v);
      p.poleL.lerp(_v.set(1, 0, -0.3), v); p.poleR.lerp(_v.set(-1, 0, -0.3), v);
      p.headPitch -= 0.3 * v; p.chestPitch -= 0.15 * v; p.hipsYaw *= 1 - v; p.chestYaw *= 1 - v; p.headYaw *= 1 - v;
      p.mouth = 0.5 * v; p.hips.y += 0.04 * v;
    }
    if (this.dejected) { p.headPitch += 0.45; p.handL.set(0.2, 1.0, 0.1); p.handR.set(-0.2, 1.0, 0.1); p.chestPitch += 0.15; }
    // ---- falling / down
    if (this.fall > 0) {
      const f = smooth(this.fall);
      p.handL.lerp(_v.set(0.42, 1.55, -0.05), f); p.handR.lerp(_v.set(-0.42, 1.45, 0.05), f);
      p.poleL.lerp(_v.set(0, 0, -1), f); p.poleR.lerp(_v.set(0, 0, -1), f);
      p.hips.lerp(_v.set(0, -0.02, 0), f);
      p.hipsYaw *= 1 - f; p.chestYaw *= 1 - f; p.headYaw = lerp(p.headYaw, 0.5, f); p.headPitch = lerp(p.headPitch, -0.3 * this.fallDir, f);
      p.chestPitch = lerp(p.chestPitch, 0, f);
      p.footL.lerp(_v.set(0.18, 0, 0.12), f); p.footR.lerp(_v.set(-0.16, 0, -0.02), f);
      p.kneeL.lerp(_v.set(0.4, 0.5, 1), f); p.mouth = 0.5 * f;
    }
    // ---- springs (hit reactions)
    const S = this.sp;
    p.headPitch += S.hp.x; p.headYaw += S.hy.x; p.headRoll += S.hr.x;
    p.chestPitch += S.cp.x; p.chestYaw += S.cy.x; p.chestRoll += S.cr.x;
    p.hips.z += S.hz.x; p.hips.x += S.hx.x; p.hips.y += S.hyy.x;
    // ---- feet (world planted -> char)
    if (this.fall <= 0) {
      for (const s of ['L', 'R']) {
        const f = this.feet[s];
        if (f.lock) continue;
        const c = this.worldToChar(f.pos, _v);
        let dy = f.yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (s === 'L') { p.footL.copy(c); p.footYawL += dy; } else { p.footR.copy(c); p.footYawR += dy; }
      }
      // rear heel lifts a bit when on the toes
      p.footPitchR += 0.12 + 0.05 * Math.max(0, bounce);
    }
  }

  // target point (char space) for the current strike
  strikeTarget(opp, m, out) {
    if (m.target === 'head') opp.headPos(out);
    else if (m.target === 'body') { opp.bodyPos(out); out.y += 0.02; }
    else { opp.bonePos(m.leg === 'R' ? 'LeftUpLeg' : 'RightUpLeg', out); out.y = 0.55; }
    this.worldToChar(out, out);
    return out;
  }

  attackPose(p, opp) {
    const m = this.move, T = this.moveT;
    // extension curve
    let e;
    if (T < m.startup) e = easeIn(T / m.startup);
    else if (T < m.startup + m.active) e = 1;
    else e = 1 - easeOut((T - m.startup - m.active) / m.recovery);
    e = clamp(e, 0, 1);
    const pre = clamp(T / m.startup, 0, 1);
    // track target during startup
    if (T < m.startup + m.active) this.strikeTarget(opp, m, this.target);
    const tg = this.target;
    const body = m.target === 'body';
    if (body) { p.hips.y -= 0.07 * Math.min(1, pre * 2) * (T < m.startup + m.active ? 1 : e); p.chestPitch += 0.18 * e; }
    const base = m.base;
    const reachTo = (sh, tgt, out, extra = 0) => {
      // wrist target: glove centre lands on target -> pull back 0.1 along the line from the shoulder
      const sp = this.rig.b[sh].p;
      out.copy(tgt).sub(sp); const L = out.length();
      const maxL = 0.56 + extra;
      out.multiplyScalar(Math.min(L - 0.09, maxL) / L).add(sp);
      return out;
    };
    if (base === 'jab') {
      p.chestYaw -= 0.22 * e; p.hipsYaw -= 0.06 * e; p.shrugL += 0.14 * e; p.headRoll += 0.08 * e; p.headYaw += 0.12 * e;
      p.hips.z += 0.05 * e;
      const w = reachTo('LeftArm', tg, _v3); p.handL.lerp(w, e);
      p.twistL = lerp(p.twistL, -1.0, e); p.poleL.lerp(_v.set(0.6, -0.6, -0.2), e);
      p.handR.y += 0.04 * e; p.handR.x += 0.03 * e;
    } else if (base === 'cross') {
      p.chestYaw += 0.8 * e; p.hipsYaw += 0.42 * e; p.hips.z += 0.08 * e; p.hips.x -= 0.03 * e; p.shrugR += 0.16 * e;
      p.headYaw -= 0.55 * e; p.headRoll -= 0.08 * e;
      const w = reachTo('RightArm', tg, _v3); p.handR.lerp(w, e);
      p.twistR = lerp(p.twistR, 1.0, e); p.poleR.lerp(_v.set(-0.6, -0.6, -0.2), e);
      p.footYawR += 0.6 * e; p.footPitchR += 0.35 * e;
      p.handL.set(0.1, 1.5, 0.2);
    } else if (base === 'hook') {
      // swing from the side
      const sideOff = (1 - e) * 0.26;
      p.chestYaw += 0.75 * e - 0.15 * (1 - pre); p.hipsYaw += 0.35 * e; p.shrugL += 0.12 * e;
      p.headYaw -= 0.4 * e; p.hips.x += 0.03 * e;
      _v2.copy(tg); _v2.x += sideOff + 0.05; _v2.z -= sideOff * 0.6;
      const w = reachTo('LeftArm', _v2, _v3, -0.06); w.y = lerp(w.y, tg.y - 0.05, 0.5);
      p.handL.lerp(w, e);
      p.poleL.lerp(_v.set(1, 0.35, -0.5), Math.min(1, pre * 1.5) * (T < m.startup + m.active ? 1 : e));
      p.twistL = lerp(p.twistL, -1.4, e); p.footYawL += 0.45 * e;
      p.handR.set(-0.08, 1.52, 0.17);
    } else if (base === 'uppercut') {
      const dip = Math.sin(clamp(pre, 0, 1) * Math.PI) * (T < m.startup ? 1 : 0);
      p.hips.y -= 0.06 * dip; p.chestRoll -= 0.18 * dip; p.chestPitch += 0.1 * dip;
      p.chestYaw += 0.5 * e; p.hipsYaw += 0.3 * e; p.chestPitch -= 0.12 * e; p.hips.y += 0.03 * e; p.hips.z += 0.04 * e;
      _v2.copy(tg); _v2.y -= 0.1 * (1 - e);
      const w = reachTo('RightArm', _v2, _v3, -0.08);
      _v.set(-0.06, 1.15, 0.2);
      p.handR.lerp(_v, dip * 0.8); p.handR.lerp(w, e);
      p.poleR.lerp(_v.set(-0.2, -1, 0.4), 0.8); p.twistR = lerp(p.twistR, -1.2, e);
      p.footYawR += 0.4 * e; p.footPitchR += 0.3 * e;
      p.handL.set(0.09, 1.5, 0.22);
    } else if (m.kind === 'kick' && m.leg === 'R') {
      // rear-leg roundhouse
      const hi = m.id === 'highkick' ? 1 : 0, mid = m.id === 'bodykick' ? 1 : 0;
      const chamber = Math.min(1, pre * 1.6);
      const ext = e;
      p.hipsYaw += (0.9 + 0.3 * hi) * ext + 0.25 * chamber; p.chestYaw += 0.25 * ext; p.hipsRoll -= (0.1 + 0.25 * hi + 0.12 * mid) * ext;
      p.chestRoll -= (0.25 + 0.35 * hi + 0.15 * mid) * ext; p.headRoll += 0.3 * ext * (0.5 + hi);
      p.hips.y += (0.04 + 0.05 * hi) * ext; p.hips.x += 0.05 * ext; p.chestPitch -= 0.05 * ext;
      // arms: rear arm swings down for counter balance
      p.handR.lerp(_v.set(-0.35, 1.05, -0.15), ext); p.poleR.lerp(_v.set(-1, -0.2, 0), ext);
      p.handL.lerp(_v.set(0.12, 1.5, 0.26), ext);
      const strike = _v2.copy(tg);
      strike.x += 0.12; strike.z = Math.min(strike.z, 0.95);
      if (hi) { strike.y = Math.min(strike.y, 1.55); }
      // chamber point
      _v3.set(-0.08, 0.5 + 0.25 * hi + 0.12 * mid, 0.18);
      const foot = _v.copy(STANCE.footR);
      foot.lerp(_v3, chamber);
      foot.lerp(strike, ext);
      p.footR.copy(foot);
      p.kneeR.lerp(_v3.set(1, 0.6 + 0.4 * hi, 0.5), chamber);
      p.footPitchR += 1.1 * chamber; p.footYawR += 0.8 * chamber;
      p.footYawL += (0.9 + 0.4 * hi) * Math.max(chamber, ext);
    } else if (m.kind === 'kick') {
      // lead teep
      const chamber = Math.min(1, pre * 1.7);
      p.chestPitch -= 0.15 * e; p.hips.z -= 0.06 * e; p.hipsYaw += 0.15 * e; p.hips.y += 0.03 * e;
      _v3.set(0.12, 0.55, 0.32);
      const foot = _v.copy(STANCE.footL).lerp(_v3, chamber);
      _v2.set(0.1, Math.max(0.85, Math.min(tg.y, 1.05)), Math.min(tg.z, 0.85)); foot.lerp(_v2, e);
      p.footL.copy(foot); p.kneeL.lerp(_v3.set(0.2, 1, 1), chamber);
      p.footPitchL -= 0.9 * e; p.footYawL += 0.3 * e;
      p.handL.set(0.1, 1.45, 0.25); p.handR.set(-0.12, 1.5, 0.12);
    }
    p.mouth = Math.max(p.mouth, 0.15 * e);
  }

  // ---- reactions
  takeHit(m, dir, dmg, game) {
    // dir: char-space unit vector of the strike travel (in this fighter's char space)
    const S = this.sp, pw = m.power * (0.6 + dmg / 14);
    if (m.target === 'head') {
      if (m.base === 'uppercut') { S.hp.kick(-11 * pw); S.cp.kick(-3 * pw); }
      else if (m.base === 'hook' || m.id === 'highkick') { S.hy.kick(-dir.x * 12 * pw); S.hr.kick(dir.x * 7 * pw); S.hp.kick(-2 * pw); S.cy.kick(-dir.x * 3 * pw); }
      else { S.hp.kick(-9 * pw); S.hy.kick(-dir.x * 4 * pw); S.cp.kick(-2.5 * pw); }
      S.hz.kick(-0.45 * pw);
    } else if (m.target === 'body') {
      S.cp.kick(5 * pw); S.cr.kick(dir.x * 3 * pw); S.hz.kick(-0.4 * pw); S.hyy.kick(-0.3 * pw);
    } else {
      S.hyy.kick(-0.6 * pw); S.hx.kick(dir.x * 0.5 * pw); S.cr.kick(-dir.x * 3 * pw);
    }
    this.hitFlash = 1;
    this.sweat = Math.min(0.9, this.sweat + 0.004 * dmg);
  }
  pushBack(dirWorld, amt) { this.vel.addScaledVector(dirWorld, amt); }
}
