// Local player: client-predicted movement (shared controller), weapon state machine
// (fire modes, recoil patterns, spread bloom, ADS, reload/bolt/swap/throw), camera feel
// (bob, sway, landing, slide tilt, shake) and the animated first-person viewmodel.
import * as THREE from 'three';
import { makeBody, stepBody } from '../shared/movement.js';
import { WEAPONS, CLASSES, MOVE, RULES } from '../shared/config.js';
import { raycast, heightAt, F } from '../shared/world.js';
import { fwd, clamp } from '../shared/math.js';
import { buildGun, gunMaterials } from './guns.js';

const DEG = Math.PI / 180;

class Viewmodel {
  constructor(gfx, team) {
    this.gfx = gfx;
    this.root = new THREE.Group();
    gfx.vmScene.add(this.root);
    this.guns = {};
    this.cur = null; this.id = null;
    const sleeve = new THREE.MeshStandardMaterial({ color: team === 1 ? 0x7a7258 : 0x44463f, roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a2824, roughness: 0.8 });
    const pad = new THREE.MeshStandardMaterial({ color: team === 1 ? 0x5a5442 : 0x2a2c28, roughness: 0.85 });
    this.mats = { sleeve, glove, pad };
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: null, color: new THREE.Color(4, 3, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.flash2 = this.flash.clone(); this.flash2.material = this.flash.material; this.flash2.rotation.y = Math.PI / 2;
    this.t = 0;
  }
  setFlashTex(t) { this.flash.material.map = t; this.flash.material.needsUpdate = true; }
  limb(from, to, r0, r1, mat) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1, r0, len, 10);
    g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }
  buildArms(meta) {
    const arms = new THREE.Group();
    const { sleeve, glove, pad } = this.mats;
    // right hand on grip
    const rg = [0.0, -0.045, 0.06];
    const rArm = new THREE.Group();
    rArm.add(this.limb([rg[0] + 0.02, rg[1] - 0.03, rg[2] + 0.05], [0.07, -0.2, 0.36], 0.033, 0.042, sleeve));
    rArm.add(this.limb([0.07, -0.2, 0.36], [0.12, -0.32, 0.62], 0.044, 0.05, sleeve));
    const rh = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.085, 0.09), glove); rh.position.set(rg[0] + 0.012, rg[1] - 0.005, rg[2] + 0.005); rh.rotation.x = -0.3;
    const rf = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.07), glove); rf.position.set(rg[0] - 0.012, rg[1] + 0.03, rg[2] - 0.04);
    rArm.add(rh, rf);
    const wr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), pad); wr.position.set(0.035, -0.13, 0.22); rArm.add(wr);
    arms.add(rArm);
    // left hand on handguard
    const h2 = meta.hand2 || [0, -0.02, -0.35];
    const lArm = new THREE.Group();
    lArm.position.set(...h2);
    const base = [-0.13, -0.2, 0.22];
    lArm.add(this.limb([-0.01, -0.03, 0.02], [base[0] - h2[0], base[1] - h2[1], base[2] - h2[2]], 0.032, 0.04, sleeve));
    lArm.add(this.limb([base[0] - h2[0], base[1] - h2[1], base[2] - h2[2]], [-0.22 - h2[0], -0.3 - h2[1], 0.5 - h2[2]], 0.042, 0.05, sleeve));
    const lh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.1), glove); lh.position.set(-0.012, -0.02, 0); lh.rotation.z = 0.5;
    const lt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.03), glove); lt.position.set(0.02, 0.02, 0.02);
    lArm.add(lh, lt);
    arms.add(lArm);
    return { arms, lArm, rArm };
  }
  setWeapon(id) {
    if (this.id === id) return;
    this.id = id;
    if (this.cur) this.root.remove(this.cur.group);
    if (!this.guns[id]) {
      const gun = buildGun(id, 'fp');
      const meta = gun.userData.meta;
      const group = new THREE.Group();
      group.add(gun);
      const a = this.buildArms(meta);
      gun.add(a.arms);
      const fl = this.flash;
      group.userData = { meta, gun, nodes: gun.userData.nodes, lArm: a.lArm, l0: a.lArm.position.clone() };
      gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      this.guns[id] = { group, meta, gun, nodes: gun.userData.nodes, lArm: a.lArm, l0: a.lArm.position.clone() };
      void fl;
    }
    this.cur = this.guns[id];
    this.root.add(this.cur.group);
    this.cur.gun.add(this.flash); this.cur.gun.add(this.flash2);
    const m = this.cur.meta.muzzle;
    this.flash.position.set(m[0], m[1], m[2] - 0.08); this.flash2.position.copy(this.flash.position);
  }
}

export class LocalPlayer {
  constructor(game) {
    this.g = game;
    this.body = makeBody();
    this.yaw = 0; this.pitch = 0;
    this.alive = false; this.cls = 'assault';
    this.vm = null;
    this.reset();
  }
  reset() {
    this.weapons = []; this.slot = 0; this.adsK = 0; this.sprintK = 0; this.crouch = false; this.eyeH = MOVE.eye;
    this.reload = null; this.swap = null; this.nextFire = 0; this.bolt = 0; this.throwT = -1; this.bloom = 0;
    this.kickP = 0; this.kickY = 0; this.recV = 0; this.recR = 0; this.recZ = 0; this.recX = 0;
    this.swayX = 0; this.swayY = 0; this.bobT = 0; this.stepDist = 0; this.landK = 0; this.slideTilt = 0;
    this.fireHeldLast = false; this.semiLatch = false; this.flashT = 0; this.reviveT = 0; this.grenades = 2; this.gadgetCd = 0;
    this.shotsFired = 0; this.lastShotT = -10; this.inspectK = 0; this.wantAds = false;
  }
  ensureVm() {
    if (!this.vm) { this.vm = new Viewmodel(this.g.gfx, this.g.myTeam); this.vm.setFlashTex(this.g.sprites.muzzle); }
  }
  spawn(x, y, z, yaw, cls) {
    this.reset();
    this.ensureVm();
    this.cls = cls;
    const C = CLASSES[cls];
    this.weapons = [C.primary, C.secondary, C.gadget].map((id) => { const d = WEAPONS[id]; return { id, d, mag: d.mag || 0, res: d.reserve || 0 }; });
    this.grenades = C.grenades;
    Object.assign(this.body, makeBody(x, y, z));
    this.yaw = yaw; this.pitch = 0;
    this.alive = true;
    this.slot = 0;
    this.vm.setWeapon(this.weapons[0].id);
    this.swap = { t: 0, dur: 0.5, to: 0, raise: true };
    this.vm.root.visible = true;
  }
  get w() { return this.weapons[this.slot]; }
  eyePos(out) { return out.set(this.body.x, this.body.y + this.eyeH, this.body.z); }

  update(dt, inp, now) {
    const g = this.g, W = g.W, b = this.body, set = g.settings;
    const w = this.w;
    const d = w.d;
    // ---- look
    const adsSens = 1 - this.adsK * (1 - (set.adsSens ?? 0.7) / Math.max(1, (d.zoom || 1) * 0.65));
    const sens = (set.sens ?? 1) * 0.0022 * adsSens;
    this.yaw -= inp.mx * sens;
    this.pitch -= inp.my * sens * (set.invert ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    // ---- stance
    if (inp.crouchToggle) {
      if (this.sprintK > 0.6 && b.onGround && b.slideT <= 0 && Math.hypot(b.vx, b.vz) > 5.5) {
        b.slideT = MOVE.slideTime; const l = Math.hypot(b.vx, b.vz); b.vx = b.vx / l * MOVE.slideSpeed; b.vz = b.vz / l * MOVE.slideSpeed; g.audio.play('impDirt', { vol: 0.5, rate: 0.6 });
        this.crouch = true;
      } else this.crouch = !this.crouch;
    }
    const crouching = this.crouch || inp.crouchHold;
    // ---- ADS
    const busy = this.reload || this.swap || this.throwT >= 0;
    let ads = inp.ads && !busy && !(d.deploy) && this.sprintK < 0.5;
    if (inp.touch && inp.fire && !d.deploy && g.settings.autoAdsTouch) ads = true;
    const adsTime = d.ads || 0.2;
    this.adsK = clamp(this.adsK + (ads ? 1 : -1) * dt / adsTime, 0, 1);
    // ---- movement
    const moving = Math.hypot(inp.moveX, inp.moveY) > 0.1;
    const sprint = inp.sprint && inp.moveY > 0.3 && !ads && !crouching && !(this.reload && !set.sprintReload);
    if (sprint && this.reload && this.reload.cancelable) this.reload = null;
    this.sprintK = clamp(this.sprintK + (sprint && moving ? 1 : -1) * dt * 5, 0, 1);
    b.crouch = crouching && b.slideT <= 0 ? true : b.slideT > 0;
    if (!crouching && b.slideT <= 0) b.crouch = false;
    const sp = b.slideT > 0 ? 0 : crouching ? MOVE.crouch : this.adsK > 0.5 ? MOVE.ads : sprint ? MOVE.sprint : MOVE.walk;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wx = (-sy * inp.moveY + cy * inp.moveX) * sp, wz = (-cy * inp.moveY - sy * inp.moveX) * sp;
    if (inp.jump && b.slideT > 0) b.slideT = 0;
    if (inp.jump && crouching && b.onGround) this.crouch = false;
    const prevGround = b.onGround;
    stepBody(W, b, wx, wz, inp.jump && !crouching, dt);
    if (b.landV > 4) { this.landK = Math.min(1, b.landV / 10); g.audio.play('land', { vol: Math.min(1, b.landV / 9) }); if (b.landV > 11) g.localFallDamage((b.landV - 11) * 12); }
    if (!prevGround && b.onGround && b.landV <= 4) { /* soft land */ }
    const tgtEye = b.crouch ? MOVE.crouchEye : MOVE.eye;
    this.eyeH += (tgtEye - this.eyeH) * Math.min(1, dt * 12);
    // footsteps
    const hs = Math.hypot(b.vx, b.vz);
    if (b.onGround && hs > 1) {
      this.stepDist += hs * dt;
      const stride = this.sprintK > 0.5 ? 2.6 : b.crouch ? 1.4 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; g.audio.play('step' + ((Math.random() * 4) | 0), { vol: b.crouch ? 0.15 : this.sprintK > 0.5 ? 0.55 : 0.35, rate: 0.9 + Math.random() * 0.2, rev: 0.15 }); }
    }
    this.bobT += hs * dt * (this.sprintK > 0.5 ? 1.25 : 1.5);
    this.slideTilt += ((b.slideT > 0 ? 1 : 0) - this.slideTilt) * dt * 8;

    // ---- weapon switching
    if (!this.reload && this.throwT < 0) {
      let to = -1;
      if (inp.slot1) to = 0; else if (inp.slot2) to = 1; else if (inp.slot3) to = 2;
      else if (inp.swap) to = inp.wheel < 0 ? (this.slot + 2) % 3 : (this.slot + 1) % 3;
      if (to >= 0 && to !== this.slot && (!this.swap || this.swap.raise)) { this.swap = { t: 0, dur: 0.32, to, raise: false }; g.audio.play('swap', { vol: 0.5 }); }
    }
    if (this.swap) {
      this.swap.t += dt;
      if (!this.swap.raise && this.swap.t >= this.swap.dur) { this.slot = this.swap.to; this.vm.setWeapon(this.w.id); this.swap = { t: 0, dur: 0.38, to: this.slot, raise: true }; this.adsK = 0; }
      else if (this.swap.raise && this.swap.t >= this.swap.dur) this.swap = null;
    }
    // ---- reload
    if (inp.reload && !this.reload && !this.swap && this.w.d.mag && this.w.mag < this.w.d.mag && this.w.res > 0 && this.throwT < 0) this.startReload();
    if (this.reload) {
      const r = this.reload;
      const prev = r.t;
      r.t += dt;
      const k = r.t / r.dur;
      if (prev / r.dur < 0.22 && k >= 0.22) g.audio.play('magOut', { vol: 0.6 });
      if (prev / r.dur < 0.62 && k >= 0.62) g.audio.play('magIn', { vol: 0.7 });
      if (r.empty && prev / r.dur < 0.85 && k >= 0.85) g.audio.play('boltFwd', { vol: 0.6 });
      if (k >= 1) {
        const ww = this.w, need = ww.d.mag - ww.mag, take = Math.min(need, ww.res);
        ww.mag += take; ww.res -= take; this.reload = null;
        g.net.send({ t: 'reload', w: ww.id });
      }
    }
    // ---- bolt cycling
    if (this.bolt > 0) { const pb = this.bolt; this.bolt -= dt; if (pb > 0.55 && this.bolt <= 0.55) g.audio.play('boltBack', { vol: 0.6 }); if (pb > 0.25 && this.bolt <= 0.25) g.audio.play('boltFwd', { vol: 0.6 }); }
    // ---- grenade
    if (inp.grenade && this.throwT < 0 && this.grenades > 0 && !this.reload && !this.swap) { this.throwT = 0; this.thrown = false; g.audio.play('pin', { vol: 0.6 }); }
    if (this.throwT >= 0) {
      this.throwT += dt;
      if (!this.thrown && this.throwT > 0.38) {
        this.thrown = true; this.grenades--;
        const e = this.eyePos(new THREE.Vector3());
        const dir = fwd(this.yaw, this.pitch + 0.16);
        g.net.send({ t: 'proj', ty: 'frag', o: [e.x, e.y - 0.1, e.z], d: dir });
        g.audio.play('throw', { vol: 0.7 });
      }
      if (this.throwT > 0.85) this.throwT = -1;
    }
    // ---- firing
    this.nextFire -= dt;
    const fireHeld = inp.fire && !this.swap && !this.reload && this.throwT < 0 && this.bolt <= 0;
    if (!inp.fire) this.semiLatch = false;
    if (fireHeld && this.sprintK < 0.2) {
      const ww = this.w;
      if (ww.d.deploy) {
        if (!this.semiLatch && this.gadgetCdLeft() <= 0) { this.semiLatch = true; this.deployGadget(); }
      } else if (ww.mag <= 0) {
        if (!this.semiLatch) { this.semiLatch = true; g.audio.play('empty', { vol: 0.6 }); if (ww.res > 0) this.startReload(); }
      } else if (this.nextFire <= 0 && (ww.d.auto || !this.semiLatch)) {
        this.semiLatch = true;
        this.fire(now);
      }
    } else if (inp.fire && this.sprintK >= 0.2) { this.sprintK = Math.max(0, this.sprintK - dt * 10); }
    if (this.sprintK > 0.2 && this.reload == null) { /* sprinting blocks fire */ }
    // recoil recovery
    const rr = (d.recoilRecover ?? 0.5) * 9;
    if (now - this.lastShotT > 0.12) {
      const rec = Math.min(1, dt * rr);
      this.pitch -= this.kickP * rec; this.kickP -= this.kickP * rec;
      this.shotsFired = Math.max(0, this.shotsFired - dt * 12);
    }
    this.bloom = Math.max(0, this.bloom - dt * 4.5);
    // viewmodel springs
    this.recV += (-this.recV) * Math.min(1, dt * 16); this.recR += (-this.recR) * Math.min(1, dt * 12); this.recZ += (-this.recZ) * Math.min(1, dt * 18); this.recX += (-this.recX) * Math.min(1, dt * 14);
    this.swayX += (clamp(-inp.mx * 0.0009, -0.06, 0.06) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (clamp(inp.my * 0.0009, -0.06, 0.06) - this.swayY) * Math.min(1, dt * 10);
    this.landK = Math.max(0, this.landK - dt * 3.5);
    this.flashT -= dt;
    this.gadgetCd = Math.max(0, this.gadgetCd - dt);
    // auto-reload when empty after letting go
    if (!inp.fire && this.w.d.mag && this.w.mag === 0 && this.w.res > 0 && !this.reload && !this.swap && !this.w.d.gadget) this.startReload();
    if (this.w.d.gadget && this.w.d.mag && this.w.mag === 0 && this.w.res > 0 && !this.reload && !this.swap) this.startReload();
  }
  gadgetCdLeft() { return Math.max(this.gadgetCd, this.g.meGadgetT || 0); }
  startReload() {
    const ww = this.w;
    if (!ww.d.mag || ww.mag >= ww.d.mag || ww.res <= 0) return;
    const empty = ww.mag === 0;
    this.reload = { t: 0, dur: empty ? ww.d.reloadEmpty : ww.d.reload, empty, cancelable: true };
    this.adsK = Math.min(this.adsK, 0.3);
  }
  spread() {
    const d = this.w.d, b = this.body;
    const hs = Math.hypot(b.vx, b.vz);
    let s = (d.hip ?? 2) * (1 - this.adsK) + (d.adsSpread ?? 0.1) * this.adsK;
    s += (d.moveSpread ?? 1) * Math.min(1, hs / 5) * (1 - this.adsK * 0.6);
    if (!b.onGround) s += 3;
    if (b.crouch) s *= 0.75;
    s += this.bloom;
    return s;
  }
  fire(now) {
    const g = this.g, ww = this.w, d = ww.d;
    const eye = this.eyePos(new THREE.Vector3());
    const spr = this.spread() * DEG;
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spr;
    const dir = fwd(this.yaw + Math.cos(a) * rr, this.pitch + Math.sin(a) * rr);
    this.lastShotT = now;
    const muzzle = g.vmMuzzleWorld(new THREE.Vector3());
    const dv = new THREE.Vector3(dir[0], dir[1], dir[2]);
    if (d.proj) {
      ww.mag--;
      g.net.send({ t: 'proj', ty: d.proj, o: [eye.x, eye.y - 0.05, eye.z], d: dir });
      g.audio.play(d.sound, { vol: 1 });
      g.effects.muzzle(muzzle, dv, 1.6, true);
      if (d.proj === 'rocket') { for (let i = 0; i < 8; i++) g.effects.smoke.spawn({ x: eye.x - dv.x * 1.2, y: eye.y - 0.1, z: eye.z - dv.z * 1.2, vx: -dv.x * 6 + (Math.random() - 0.5) * 3, vy: Math.random(), vz: -dv.z * 6 + (Math.random() - 0.5) * 3, life: 2.5, s0: 0.5, s1: 3, cr: 0.8, cg: 0.8, cb: 0.8, a0: 0.5, a1: 0, drag: 2 }); }
      this.nextFire = 60 / d.rpm;
      this.kickP += (d.recoil[0]) * DEG; this.pitch += d.recoil[0] * DEG;
      this.recV += 0.12; this.recZ += 0.12;
      g.shake(0.25);
      return;
    }
    ww.mag--;
    this.nextFire = 60 / d.rpm;
    this.shotsFired++;
    g.net.send({ t: 'fire', w: ww.id, o: [+eye.x.toFixed(3), +eye.y.toFixed(3), +eye.z.toFixed(3)], d: dir.map((v) => +v.toFixed(5)) });
    g.localShot(eye, dir, muzzle, d);
    // recoil: vertical climb with pattern drift, horizontal random walk
    const adsMul = 1 - this.adsK * 0.25, crouchMul = this.body.crouch ? 0.8 : 1;
    const v = d.recoil[0] * adsMul * crouchMul * (1 + Math.min(this.shotsFired, 10) * 0.025);
    const h = (Math.random() - 0.45 + Math.sin(this.shotsFired * 0.7) * 0.25) * d.recoil[1] * adsMul * 2;
    this.pitch += v * DEG; this.kickP += v * DEG * (d.recoilRecover ?? 0.5);
    this.yaw -= h * DEG;
    this.bloom = Math.min(this.bloom + (d.auto ? 0.28 : 0.6) * (1 - this.adsK * 0.7), 4);
    this.recV += 0.045 + v * 0.03; this.recZ += d.bolt ? 0.09 : 0.032; this.recR += (Math.random() - 0.5) * 0.06; this.recX += (Math.random() - 0.5) * 0.01;
    this.flashT = 0.045;
    if (d.bolt) this.bolt = 60 / d.rpm;
    g.shake(d.bolt ? 0.18 : 0.04);
  }
  deployGadget() {
    const g = this.g, b = this.body;
    const f = fwd(this.yaw, 0);
    let x = b.x + f[0] * 1.2, z = b.z + f[2] * 1.2;
    const out = {};
    let y = heightAt(g.W, x, z);
    if (raycast(g.W, x, b.y + 1.5, z, 0, -1, 0, 3, F.SOLID, out, true) >= 0) y = Math.max(y, out.y);
    if (Math.abs(y - b.y) > 1.5) { x = b.x; z = b.z; y = b.y; }
    g.net.send({ t: 'deploy', x, y, z });
    this.gadgetCd = this.w.d.cooldown;
    g.audio.play('swap', { vol: 0.8 });
    g.hud.reward(this.w.d.name.toUpperCase() + ' DEPLOYED', 0);
  }

  // ------------------------------------------------------------ camera & viewmodel
  applyCamera(cam, vmCam, dt, baseFov) {
    const b = this.body;
    const d = this.w.d;
    const bobAmt = (this.sprintK > 0.5 ? 1.6 : 1) * (1 - this.adsK * 0.85) * (b.onGround ? 1 : 0) * Math.min(1, Math.hypot(b.vx, b.vz) / 4);
    const bobY = Math.abs(Math.sin(this.bobT * 3.1)) * 0.035 * bobAmt;
    const bobX = Math.sin(this.bobT * 3.1) * 0.02 * bobAmt;
    cam.position.set(b.x, b.y + this.eyeH + bobY - this.landK * 0.12, b.z);
    const g = this.g;
    const sh = g.shakeAmt;
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.03, this.yaw + (Math.random() - 0.5) * sh * 0.03, -this.slideTilt * 0.08 + bobX * 0.3 + (Math.random() - 0.5) * sh * 0.02);
    const zoom = 1 + ((d.zoom || 1) - 1) * this.adsK;
    const sprintFov = this.sprintK * 6;
    cam.fov = baseFov / zoom + sprintFov;
    cam.updateProjectionMatrix();
    vmCam.fov = 54 - this.adsK * (d.optic === 'scope' ? 0 : 12);
    vmCam.updateProjectionMatrix();
    // viewmodel transform
    const vm = this.vm;
    if (!vm || !vm.cur) return;
    const meta = vm.cur.meta;
    const hip = meta.hip, ads = meta.ads;
    const k = this.adsK, ke = k * k * (3 - 2 * k);
    const sy = meta.sightY || 0.08, sx = meta.sightX || 0;
    let px = THREE.MathUtils.lerp(hip[0], ads[0] - sx, ke), py = THREE.MathUtils.lerp(hip[1], ads[1] - sy, ke), pz = THREE.MathUtils.lerp(hip[2], ads[2], ke);
    let rx = 0, ry = 0, rz = 0;
    const t = this.g.gfx.time;
    // idle breathing + sway + bob
    const breathe = (1 - ke * 0.8);
    py += Math.sin(t * 1.6) * 0.003 * breathe; px += Math.sin(t * 0.8) * 0.0015 * breathe;
    px += this.swayX * (1 - ke * 0.7); py += this.swayY * (1 - ke * 0.7);
    rz += this.swayX * 2;
    py += -bobY * 0.6 - this.landK * 0.04; px += bobX * 0.8;
    // sprint pose
    const s = this.sprintK;
    if (meta.pistol) { py -= s * 0.08; rx -= s * 0.6; }
    else { px -= s * 0.06; py -= s * 0.05; ry += s * 0.75; rz += s * 0.35; rx -= s * 0.15; }
    px += Math.sin(this.bobT * 1.55) * 0.02 * s; py += Math.abs(Math.cos(this.bobT * 1.55)) * 0.015 * s;
    // slide
    rz -= this.slideTilt * 0.3; py -= this.slideTilt * 0.03;
    // recoil
    pz += this.recZ * (1 - ke * 0.4); rx += this.recV * (1 - ke * 0.5); rz += this.recR; px += this.recX;
    py += this.recV * 0.12 * ke;
    // reload choreography
    if (this.reload) {
      const r = this.reload, q = r.t / r.dur;
      const env = Math.sin(Math.min(1, q * 1.15) * Math.PI);
      rx -= env * 0.35; rz += env * 0.55; py -= env * 0.06; px -= env * 0.02;
      const mag = vm.cur.nodes.mag;
      if (mag) {
        const out = q < 0.22 ? 0 : q < 0.42 ? (q - 0.22) / 0.2 : q < 0.5 ? 1 : q < 0.65 ? 1 - (q - 0.5) / 0.15 : 0;
        mag.position.set(-out * 0.04, -out * 0.28, out * 0.06);
        mag.visible = !(q > 0.4 && q < 0.5);
      }
      const la = vm.cur.lArm;
      const reach = q < 0.18 ? q / 0.18 : q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
      la.position.set(vm.cur.l0.x + 0.02 * reach, vm.cur.l0.y - 0.13 * reach, vm.cur.l0.z + (0.3) * reach * (meta.pistol ? 0 : 1));
      const bolt = vm.cur.nodes.bolt;
      if (bolt && r.empty) bolt.position.z = q > 0.8 && q < 0.88 ? 0.04 : 0;
    } else {
      const mag = vm.cur.nodes.mag; if (mag) { mag.position.set(0, 0, 0); mag.visible = true; }
      vm.cur.lArm.position.copy(vm.cur.l0);
    }
    // bolt action cycling
    if (this.bolt > 0) {
      const q = 1 - this.bolt / (60 / d.rpm);
      const e = q > 0.25 && q < 0.85 ? Math.sin((q - 0.25) / 0.6 * Math.PI) : 0;
      rz += e * 0.25; rx -= e * 0.06;
      const bolt = vm.cur.nodes.bolt; if (bolt) bolt.position.z = e * 0.09;
    } else if (!this.reload && vm.cur.nodes.bolt && d.auto) {
      vm.cur.nodes.bolt.position.z = this.flashT > 0 ? 0.025 : 0;
    }
    // slide for pistol
    if (meta.pistol && vm.cur.nodes.bolt) vm.cur.nodes.bolt.position.z = this.flashT > 0 ? 0.03 : (this.w.mag === 0 ? 0.03 : 0);
    // swap
    if (this.swap) {
      const q = this.swap.t / this.swap.dur;
      const down = this.swap.raise ? 1 - q : q;
      py -= down * 0.3; rx -= down * 0.6;
    }
    // grenade throw: weapon drops, hand comes up
    if (this.throwT >= 0) {
      const q = this.throwT / 0.85;
      const e = Math.sin(Math.min(1, q) * Math.PI);
      py -= e * 0.25; rx -= e * 0.5; rz += e * 0.3;
    }
    vm.root.position.set(px, py, pz);
    vm.root.rotation.set(rx, ry, rz);
    vm.root.visible = !(d.optic === 'scope' && this.adsK > 0.92);
    // reticle visibility
    const ret = vm.cur.nodes.reticle; if (ret) ret.visible = this.adsK > 0.3;
    // muzzle flash
    const fl = vm.flash;
    const on = this.flashT > 0 && !this.w.d.deploy;
    fl.visible = on; vm.flash2.visible = on;
    if (on) { fl.rotation.z = Math.random() * 6.28; const sc = (this.w.id === 'rx9' ? 0.4 : 1) * (0.8 + Math.random() * 0.5); fl.scale.setScalar(sc); vm.flash2.scale.set(sc * 0.6, sc * 1.6, 1); }
    this.g.gfx.vmFlash.intensity = on ? 3 : 0;
    // viewmodel shading: dim indoors / in shadow
    void dt;
  }
}

export { gunMaterials };
export const VM_RULES = RULES;
