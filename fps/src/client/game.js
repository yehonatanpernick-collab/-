// Client game: consumes server snapshots/events, interpolates remote entities, drives the
// local soldier or tank, renders effects/audio feedback and feeds the HUD.
import * as THREE from 'three';
import { WEAPONS, CLASSES, CLASS_LIST, TEAMS, RULES, TANK, MOVE } from '../shared/config.js';
import { destroyPanel, breakGlass, collapseBuilding, heightAt, raycast, los, F, MAT, BOUNDS } from '../shared/world.js';
import { stepTank, tankMuzzle, tankMg } from '../shared/vehicle.js';
import { fwd, clamp, wrapAngle, rayCapsuleY, raySphere } from '../shared/math.js';
import { Soldier } from './soldier.js';
import { TankView } from './tankview.js';
import { LocalPlayer } from './player.js';
import { buildGun } from './guns.js';

const INTERP = 0.105;
const PROJ_TYPES = ['gl', 'rocket', 'shell', 'frag'];
const WNAME = { vk30: 'VK-30', rx9: 'RX-9', hm250: 'HM-250', sr338: 'SR-338', p19: 'P-19', gl40: 'GL-40', rpg: 'AT-7', frag: 'FRAG', tank: 'TANK CANNON', tmg: 'TANK MG', collapse: 'BUILDING COLLAPSE', roadkill: 'ROADKILL', oob: 'DESERTION', fall: 'FALL', suicide: 'SUICIDE' };
const IMPACT_SND = { [MAT.CONCRETE]: 'impConcrete', [MAT.METAL]: 'impMetal', [MAT.WOOD]: 'impWood', [MAT.DIRT]: 'impDirt', [MAT.SAND]: 'impDirt', [MAT.FLESH]: 'impFlesh' };
const v3 = () => new THREE.Vector3();

function lerpA(a, b, t) { return a + wrapAngle(b - a) * t; }

export class Game {
  constructor(env) {
    Object.assign(this, env); // gfx, W, wv, effects, audio, hud, input, ui, settings, sprites, macro, tex
    this.queue = [];
    this.myId = -1; this.myTeam = 1;
    this.info = new Map(); this.rps = new Map(); this.vehs = new Map(); this.projs = new Map(); this.ents = [];
    this.flagStates = {}; for (const f of this.W.flags) this.flagStates[f.id] = { owner: 0, prog: 0, n1: 0, n2: 0 };
    this.tickets = [RULES.tickets, RULES.tickets];
    this.clockOff = null;
    this.me = new LocalPlayer(this);
    this.meState = { alive: false, downed: false, hp: 100, respawn: 0, bleed: 0, veh: -1 };
    this.mode = 'deploy'; // deploy | play | down | death | tank | end
    this.deathT = 0; this.killerId = -1;
    this.spawnOpts = ['hq'];
    this.inSendT = 0; this.shakeAmt = 0; this.supp = 0; this.dmgFlash = 0;
    this.myTank = null; this.tankAim = { yaw: 0, pitch: 0, mg: false, zoom: false, mgT: 0 };
    this.oobT = 0; this.reviveHold = 0; this.roster = [];
    this.phase = 'play'; this.lastRosterT = 0; this.frameN = 0;
    this.tmpV = v3(); this.tmpV2 = v3();
    this.meGadgetT = 0;
    this.killerOf = new Map();
    this.projGeo = {
      frag: new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.6, metalness: 0.4 })),
      gl: new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6a40, metalness: 0.6, roughness: 0.4 })),
      rocket: new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.6 })),
      shell: new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 5, 2) })),
    };
    this.crateMesh = (() => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x4d4f3c, roughness: 0.8 })); b.position.y = 0.25; b.castShadow = true; const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff })); c.position.set(0, 0.28, 0.31); g.add(b, c); return g; })();
    this.beaconMesh = (() => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x4d4f3c })); b.position.y = 0.2; const a = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9), new THREE.MeshStandardMaterial({ color: 0x111111 })); a.position.y = 0.8; const l = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.2) })); l.position.y = 1.25; g.add(b, a, l); g.userData.light = l; return g; })();
    this.entViews = new Map();
    this.tankLoops = new Map();
    // ambient battle smoke columns at a few craters / wrecks
    const amb = [...this.W.craters].slice(0, 4);
    for (const c of amb) this.effects.addAmbientSmoke(c.x, heightAt(this.W, c.x, c.z), c.z, 1.2);
    this.effects.addAmbientSmoke(-140, heightAt(this.W, -140, 60) + 1, 60, 1.6);
    this.effects.addAmbientSmoke(150, heightAt(this.W, 150, -40) + 1, -40, 1.4);
  }

  connect(net) {
    this.net = net;
    net.onMessage = (m) => this.queue.push(m);
    net.send({ t: 'hello', name: this.settings.name || 'Soldier' });
  }
  now() { return performance.now() / 1000; }
  serverNow() { return this.now() + (this.clockOff || 0); }

  // ------------------------------------------------------------------ messages
  handle(m) {
    switch (m.t) {
      case 'welcome': this.onWelcome(m); break;
      case 's': this.onSnap(m); break;
      case 'roster': this.onRoster(m); break;
      case 'ping': this.net.send({ t: 'pong', s: m.s }); break;
    }
  }
  onWelcome(m) {
    this.myId = m.id; this.myTeam = m.team;
    const W = this.W;
    for (const pid of m.destroyed) destroyPanel(W, pid);
    for (const b of m.glass) breakGlass(W, b);
    for (const bi of m.collapsed) collapseBuilding(W, bi);
    this.wv.syncAll();
    m.flags.forEach((f, i) => { const s = this.flagStates[W.flags[i].id]; s.prog = f[0] / 1000; s.owner = f[1]; });
    this.phase = m.phase;
    this.mode = 'deploy';
    this.ui.openDeploy(this);
  }
  onRoster(m) {
    this.roster = m.l.map((r) => ({ id: r[0], name: r[1], team: r[2], squad: r[3], bot: !!r[4], cls: r[5], score: r[6], kills: r[7], deaths: r[8], assists: r[9], ping: r[10], revives: r[11] }));
    for (const r of this.roster) this.info.set(r.id, r);
    const me = this.info.get(this.myId);
    if (me) { if (me.team !== this.myTeam) this.myTeam = me.team; this.mySquad = me.squad; }
    if (m.ph === 'end' && this.phase !== 'end') { this.phase = 'end'; }
    this.phase = m.ph; this.winner = m.w; this.endIn = m.endIn;
  }
  onSnap(m) {
    const nowS = this.now();
    const sample = m.st - nowS;
    if (this.clockOff == null || Math.abs(sample - this.clockOff) > 1) this.clockOff = sample;
    else this.clockOff += (sample - this.clockOff) * (sample > this.clockOff ? 0.2 : 0.03);
    const t = m.st;
    const seen = new Set();
    for (const a of m.p) {
      const id = a[0];
      seen.add(id);
      let rp = this.rps.get(id);
      if (!rp) { rp = { id, snaps: [], soldier: null, wasAlive: false, deadT: 0, cur: null, lastX: 0, lastZ: 0, vx: 0, vz: 0, firingT: -10 }; this.rps.set(id, rp); }
      rp.snaps.push({ t, x: a[1] / 100, y: a[2] / 100, z: a[3] / 100, yaw: a[4] / 1000, pitch: a[5] / 1000, fl: a[6], hp: a[7], slot: a[8], veh: a[9], cls: CLASS_LIST[a[10]], spd: a[11] / 10, timer: a[12] / 10 });
      if (rp.snaps.length > 24) rp.snaps.shift();
      if (id === this.myId) this.updateMeFromServer(rp.snaps[rp.snaps.length - 1]);
    }
    for (const [id, rp] of this.rps) if (!seen.has(id)) { if (rp.soldier) this.gfx.scene.remove(rp.soldier.root); this.rps.delete(id); }
    for (const a of m.v) {
      const id = a[0];
      let rv = this.vehs.get(id);
      if (!rv) { rv = { id, snaps: [], view: null, alive: true, team: a[14] }; this.vehs.set(id, rv); }
      rv.team = a[14];
      rv.snaps.push({ t, x: a[1] / 100, y: a[2] / 100, z: a[3] / 100, yaw: a[4] / 1000, pitch: a[5] / 1000, roll: a[6] / 1000, turretYaw: a[7] / 1000, gunPitch: a[8] / 1000, hp: a[9], driver: a[10], speed: a[11] / 100, alive: !!a[12], reload: a[13] / 10 });
      if (rv.snaps.length > 24) rv.snaps.shift();
    }
    const pseen = new Set();
    for (const a of m.pr) {
      const id = a[0]; pseen.add(id);
      let pj = this.projs.get(id);
      if (!pj) {
        const ty = PROJ_TYPES[a[1]];
        const mesh = this.projGeo[ty].clone();
        mesh.castShadow = ty !== 'shell';
        this.gfx.scene.add(mesh);
        pj = { id, ty, snaps: [], mesh, trailAcc: 0 };
        this.projs.set(id, pj);
      }
      pj.snaps.push({ t, x: a[2] / 100, y: a[3] / 100, z: a[4] / 100 });
      if (pj.snaps.length > 10) pj.snaps.shift();
    }
    for (const [id, pj] of this.projs) if (!pseen.has(id)) { pj.gone = (pj.gone || 0) + 1; if (pj.gone > 3) { this.gfx.scene.remove(pj.mesh); this.projs.delete(id); } }
    this.ents = m.en.map((e) => ({ id: e[0], ty: e[1] ? 'beacon' : 'crate', x: e[2] / 100, y: e[3] / 100, z: e[4] / 100, team: e[5], squad: e[6], owner: e[7] }));
    m.f.forEach((f, i) => { const s = this.flagStates[this.W.flags[i].id]; s.prog = f[0] / 1000; s.owner = f[1]; s.n1 = f[2]; s.n2 = f[3]; s.contested = f[2] > 0 && f[3] > 0; });
    this.tickets = m.tk;
    if (m.me) { this.meState.hp = m.me.hp; this.me.grenadesSrv = m.me.g; this.serverOob = m.me.oob; this.meGadgetT = m.me.gt; }
    if (m.so) this.spawnOpts = m.so;
    for (const e of m.ev) this.onEvent(e);
  }
  updateMeFromServer(s) {
    const ms = this.meState;
    ms.alive = !!(s.fl & 1); ms.downed = !!(s.fl & 2); ms.veh = s.veh;
    if (!ms.alive) ms.respawn = s.timer; else if (ms.downed) ms.bleed = s.timer;
    if (this.mode === 'play' && !ms.alive) this.enterDeath(this.killerId);
  }

  // ------------------------------------------------------------------ events
  rpPos(id) {
    const rp = this.rps.get(id);
    if (rp && rp.cur) return rp.cur;
    if (rp && rp.snaps.length) return rp.snaps[rp.snaps.length - 1];
    return null;
  }
  nameOf(id) { return this.info.get(id)?.name || '—'; }
  teamOf(id) { return this.info.get(id)?.team || 0; }
  onEvent(e) {
    const W = this.W, A = this.audio, H = this.hud, myId = this.myId;
    switch (e.e) {
      case 'shot': if (e.id !== myId) this.remoteShot(e); break;
      case 'hit':
        if (e.a === myId && e.v !== myId) {
          H.hit(e.k ? 'kill' : e.h ? 'head' : 'norm');
          A.play(e.k ? 'kill' : e.h ? 'hitHead' : 'hit', { vol: e.k ? 0.6 : 0.4, ui: true });
        }
        if (e.v === myId) {
          const ang = Math.atan2(e.x - this.me.body.x, e.z - this.me.body.z);
          const rel = wrapAngle(Math.atan2(-(e.x - this.me.body.x), -(e.z - this.me.body.z)) - this.me.yaw);
          if (e.a !== myId) H.damageFrom(-rel);
          void ang;
          this.dmgFlash = Math.min(1, this.dmgFlash + e.d / 60);
          this.shake(0.15);
          A.play('impFlesh', { vol: 0.5, ui: true });
        }
        break;
      case 'vhit': if (e.a === myId) { H.hit('veh'); A.play('impMetal', { vol: 0.5, ui: true }); } break;
      case 'kill': {
        this.killerOf.set(e.v, e.k);
        const kn = e.k >= 0 ? this.nameOf(e.k) : '', vn = this.nameOf(e.v);
        H.killfeed(kn, vn, WNAME[e.w] || e.w, e.h, this.teamOf(e.k), this.teamOf(e.v), this.myTeam, e.k === myId || e.v === myId);
        if (e.v === myId) { this.killerId = e.k; if (e.k >= 0 && e.k !== myId) H.centerMsg(`<small>KILLED BY</small><b class="en">${kn}</b><small>${WNAME[e.w] || ''}${e.h ? ' · HEADSHOT' : ''}</small>`, 3200, 'killed'); }
        if (e.k === myId && e.v !== myId) H.centerMsg(`<small>${e.h ? 'HEADSHOT' : 'ENEMY DOWN'}</small><b>${vn}</b>`, 1500, 'kill');
        break;
      }
      case 'down': if (e.id === myId) this.enterDown(); break;
      case 'dead': if (e.id === myId) this.enterDeath(e.k); break;
      case 'revive':
        if (e.id === myId) { this.mode = 'play'; H.downed(false); H.reward('REVIVED BY ' + this.nameOf(e.by).toUpperCase(), 0); }
        break;
      case 'spawn': if (e.id === myId) this.onSpawned(e); break;
      case 'proj': {
        if (e.owner === myId) break;
        const o = { x: e.o[0], y: e.o[1], z: e.o[2] };
        if (e.ty === 'frag') A.play('throw', { pos: o, vol: 0.5 });
        else if (e.ty !== 'shell') { A.play(e.ty === 'gl' ? 'gl' : 'rocket', { pos: o, vol: 1, delay: true, far: 'gunFar' }); this.effects.muzzle(new THREE.Vector3(o.x, o.y, o.z), new THREE.Vector3(...e.d), 1.5); }
        break;
      }
      case 'tshot': {
        const rv = this.vehs.get(e.v);
        const pos = rv?.view ? rv.view.muzzleWorld(v3()) : null;
        if (pos) {
          const s = rv.cur || rv.snaps[rv.snaps.length - 1];
          const d = fwd(s.turretYaw, s.gunPitch);
          const dv = new THREE.Vector3(...d);
          this.effects.muzzle(pos, dv, 4.5, true);
          for (let i = 0; i < 14; i++) this.effects.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dv.x * (4 + Math.random() * 8) + (Math.random() - 0.5) * 5, vy: Math.random() * 2, vz: dv.z * (4 + Math.random() * 8) + (Math.random() - 0.5) * 5, life: 3 + Math.random() * 2, s0: 1, s1: 5, cr: 0.6, cg: 0.58, cb: 0.55, a0: 0.55, a1: 0, drag: 2.5, buoy: 0.3 });
          if (rv.view) rv.view.recoil = 1;
          const mine = this.myTank && this.myTank.id === e.v;
          A.play('tank', { pos, vol: mine ? 1.4 : 1.2, delay: !mine, far: 'boomFar', farDist: 200, ref: 12, rev: 0.8 });
          const dist = pos.distanceTo(this.gfx.camera.position);
          this.shake(Math.max(0, 0.5 - dist / 120));
        }
        break;
      }
      case 'boom': {
        const scale = e.ty === 'shell' ? 1.5 : e.ty === 'frag' ? 1.0 : e.ty === 'rocket' ? 1.15 : 1.0;
        this.effects.explosion(e.x, e.y, e.z, scale, e.ty);
        const pos = { x: e.x, y: e.y, z: e.z };
        A.play('boom', { pos, vol: 1.3 * scale, delay: true, far: 'boomFar', farDist: 160, ref: 14, rev: 0.9, maxDist: 3000, absorb: 260 });
        const dist = Math.hypot(e.x - this.gfx.camera.position.x, e.y - this.gfx.camera.position.y, e.z - this.gfx.camera.position.z);
        this.shake(Math.max(0, 1.2 * scale - dist / 35));
        if (dist < 10) this.supp = Math.min(1.5, this.supp + 1.2 - dist / 10);
        break;
      }
      case 'panels': {
        for (const pid of e.l) {
          if (!W.panels[pid]) continue;
          const P = W.panels[pid];
          const color = W.boxes[P.boxes[0]]?.color ?? 0xcccccc;
          destroyPanel(W, pid);
          this.wv.hidePanel(pid);
          this.effects.panelBreak(P, color, !!e.crush);
        }
        A.play('debris', { pos: { x: e.x, y: e.y, z: e.z }, vol: 1, delay: true, ref: 10 });
        break;
      }
      case 'glass': {
        const b = W.boxes[e.b];
        if (b && b.active) {
          breakGlass(W, e.b);
          this.wv.setBoxVisible(e.b, false);
          const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
          const nx = b.x1 - b.x0 < 0.2 ? 1 : 0, nz = b.z1 - b.z0 < 0.2 ? 1 : 0;
          this.effects.glassShards(cx, cy, cz, nx * (Math.random() < 0.5 ? 1 : -1), 0, nz * (Math.random() < 0.5 ? 1 : -1));
          A.play('glass', { pos: { x: cx, y: cy, z: cz }, vol: 0.7, ref: 6 });
        }
        break;
      }
      case 'collapse': {
        const B = W.buildings[e.b];
        if (!B) break;
        collapseBuilding(W, e.b);
        this.wv.collapse(e.b);
        this.effects.collapseDust(B);
        const pos = { x: (B.x0 + B.x1) / 2, y: B.by + 3, z: (B.z0 + B.z1) / 2 };
        A.play('collapse', { pos, vol: 1.6, delay: true, ref: 30, rev: 1, maxDist: 3000 });
        const dist = Math.hypot(pos.x - this.gfx.camera.position.x, pos.z - this.gfx.camera.position.z);
        this.shake(Math.max(0, 1 - dist / 120));
        H.centerMsg('<small>STRUCTURE</small><b>COLLAPSED</b>', 1800, 'info');
        break;
      }
      case 'flag': {
        const f = W.flags.find((q) => q.id === e.f);
        if (e.o === this.myTeam) { H.centerMsg(`<small>OBJECTIVE CAPTURED</small><b class="my">${f.id} · ${f.name}</b>`, 2600); A.play('capture', { ui: true, vol: 0.8 }); }
        else if (e.o === 0 && e.was === this.myTeam) { H.centerMsg(`<small>OBJECTIVE LOST</small><b class="en">${f.id} · ${f.name}</b>`, 2600); A.play('lost', { ui: true, vol: 0.8 }); }
        else if (e.o !== 0) { H.centerMsg(`<small>ENEMY CAPTURED</small><b class="en">${f.id} · ${f.name}</b>`, 2600); A.play('lost', { ui: true, vol: 0.6 }); }
        else if (e.by === this.myTeam) H.centerMsg(`<small>OBJECTIVE NEUTRALIZED</small><b>${f.id} · ${f.name}</b>`, 2000);
        break;
      }
      case 'sc': H.reward(e.r, e.p); break;
      case 'enter':
        if (e.id === myId) this.enterTank(e.v);
        break;
      case 'exit':
        if (e.id === myId) {
          this.myTank = null; this.mode = 'play';
          const b = this.me.body; b.x = e.x; b.y = e.y; b.z = e.z; b.vx = b.vy = b.vz = 0;
          this.me.vm.root.visible = true; H.tankUI(false);
          if (this.engineLoop) { this.engineLoop.stop(); this.engineLoop = null; }
        }
        break;
      case 'vboom': {
        this.effects.explosion(e.x, e.y + 1.5, e.z, 2.2, 'shell');
        for (let i = 0; i < 3; i++) setTimeout(() => this.effects.explosion(e.x + (Math.random() - 0.5) * 3, e.y + 1 + Math.random(), e.z + (Math.random() - 0.5) * 3, 0.8), 150 + i * 220);
        A.play('boom', { pos: { x: e.x, y: e.y, z: e.z }, vol: 2, delay: true, far: 'boomFar', ref: 20, maxDist: 3000 });
        if (this.myTank && this.myTank.id === e.v) { this.myTank = null; }
        break;
      }
      case 'tp': if (e.to === myId) { const b = this.me.body; b.x = e.x; b.y = e.y; b.z = e.z; } break;
      case 'supply':
        if (e.to === myId) {
          for (const w of this.me.weapons) { const a = e.ammo[w.id]; if (a) { w.res = a[1]; } }
          this.me.grenades = e.g;
        }
        break;
      case 'end': {
        this.mode = 'end';
        this.ui.showEnd(this, e.w);
        A.play(e.w === this.myTeam ? 'capture' : 'lost', { ui: true });
        break;
      }
      case 'reset': {
        const Wd = this.W;
        for (const b of Wd.boxes) b.active = b.initActive;
        for (const P of Wd.panels) { P.alive = true; P.hp = P.maxHp; }
        for (const B of Wd.buildings) B.collapsed = false;
        this.wv.collapsing = [];
        this.wv.syncAll();
        this.effects.clearDecals();
        this.me.alive = false;
        this.myTank = null;
        this.mode = 'deploy';
        this.ui.hideEnd();
        this.ui.openDeploy(this);
        break;
      }
      case 'join': if (!this.info.get(e.id)?.bot && e.id !== myId) H.killfeed('', `${e.n} joined`, '', false, 0, 0, this.myTeam, false); break;
      case 'chat': H.killfeed(e.n, e.m, '💬', false, e.tm, 0, this.myTeam, false); break;
    }
  }

  // ------------------------------------------------------------------ local state transitions
  onSpawned(e) {
    this.mode = 'play';
    this.ui.closeDeploy();
    this.hud.show(true);
    this.input.showTouch(true);
    this.me.spawn(e.x, e.y, e.z, e.yaw, e.cls);
    this.hud.setClass(e.cls, this.mySquad || 1);
    this.hud.downed(false);
    this.oobT = 0;
    if (!this.input.isTouch) this.input.lock();
    if (e.veh >= 0) this.enterTank(e.veh);
    this.audio.play('uiConfirm', { ui: true });
  }
  enterDown() {
    this.mode = 'down';
    this.hud.downed(true, 1);
    this.me.vm.root.visible = false;
    this.input.resetAds();
  }
  enterDeath(killer) {
    if (this.mode === 'death' || this.mode === 'deploy' || this.mode === 'end') return;
    this.mode = 'death'; this.deathT = 0; this.killerId = killer;
    this.me.alive = false;
    if (this.me.vm) this.me.vm.root.visible = false;
    this.myTank = null; this.hud.tankUI(false); this.hud.scope(false); this.hud.downed(false);
    if (this.engineLoop) { this.engineLoop.stop(); this.engineLoop = null; }
    this.deathPos = this.gfx.camera.position.clone();
  }
  enterTank(vid) {
    const rv = this.vehs.get(vid);
    const s = rv && rv.snaps.length ? rv.snaps[rv.snaps.length - 1] : null;
    if (!s) return;
    this.myTank = { id: vid, team: rv.team, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: s.roll, speed: 0, turretYaw: s.turretYaw, gunPitch: s.gunPitch, hp: s.hp, reload: s.reload, mgCool: 0, tread: 0, hullYawRate: 0 };
    this.tankAim.yaw = s.turretYaw; this.tankAim.pitch = 0; this.tankAim.mg = false;
    this.mode = 'tank';
    if (this.me.vm) this.me.vm.root.visible = false;
    this.engineLoop = this.audio.loop('engine', { vol: 0.3 });
    this.hud.reward('ENTERED MBT-9 "RHINO"', 0);
  }
  requestSpawn(at, cls) {
    this.audio.init();
    this.net.send({ t: 'spawn', at, cls });
  }
  shake(a) { this.shakeAmt = Math.min(2, Math.max(this.shakeAmt, a)); }
  localFallDamage() { /* server-authoritative health: no client fall damage */ }

  // ------------------------------------------------------------------ shots
  vmMuzzleWorld(out) {
    const cam = this.gfx.camera;
    const vm = this.me.vm?.cur;
    const meta = vm ? vm.meta : { muzzle: [0, 0, -0.6], hip: [0.12, -0.13, -0.3] };
    const k = this.me.adsK;
    const x = THREE.MathUtils.lerp(meta.hip[0], 0, k) + meta.muzzle[0], y = THREE.MathUtils.lerp(meta.hip[1], -0.04, k) + meta.muzzle[1], z = meta.hip[2] + meta.muzzle[2] * 0.9;
    return out.set(x, y, z).applyMatrix4(cam.matrixWorld);
  }
  bulletTargets(excludeId) {
    const list = [];
    for (const rp of this.rps.values()) {
      if (rp.id === excludeId || !rp.cur || !(rp.cur.fl & 1) || (rp.cur.fl & 2) || rp.cur.veh >= 0) continue;
      if (rp.id === this.myId) continue;
      const c = rp.cur, cr = c.fl & 4;
      list.push({ id: rp.id, ray: (ox, oy, oz, dx, dy, dz, maxT) => {
        const t1 = rayCapsuleY(ox, oy, oz, dx, dy, dz, c.x, c.y + 0.15, c.y + (cr ? 1.0 : 1.45), c.z, 0.3, maxT);
        const t2 = raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y + (cr ? 1.08 : 1.62), c.z, 0.16, maxT);
        return t1 >= 0 && (t2 < 0 || t1 < t2) ? t1 : t2;
      } });
    }
    return list;
  }
  localShot(eye, dir, muzzle, d) {
    const tracer = Math.random() < (d.tracer ?? 0.5);
    this.effects.bullet([eye.x, eye.y, eye.z], dir, d.vel, { tracer, from: [muzzle.x, muzzle.y, muzzle.z], targets: this.bulletTargets(this.myId), local: true });
    this.audio.play(d.sound, { vol: 1, rev: 0.6, jitter: 0.04 });
    const dv = this.tmpV.set(dir[0], dir[1], dir[2]);
    this.effects.muzzle(muzzle, dv, d.id === 'rx9' ? 0.35 : d.id === 'sr338' ? 1.6 : 1, true);
    const cam = this.gfx.camera;
    const right = v3().set(1, 0, 0).applyQuaternion(cam.quaternion), up = v3().set(0, 1, 0).applyQuaternion(cam.quaternion);
    const ej = v3().set(0.1, -0.08, -0.32).applyMatrix4(cam.matrixWorld);
    if (!d.bolt) this.effects.ejectBrass(ej, right, up, 2.5, d.id === 'hm250' ? 1.2 : 1);
  }
  remoteShot(e) {
    const rp = this.rps.get(e.id);
    const w = e.w === 'tmg' ? { vel: 820, sound: 'tmg', tracer: 0.5, id: 'tmg' } : WEAPONS[e.w];
    if (!w) return;
    const o = e.o, d = e.d;
    let from = o;
    if (rp && rp.soldier && rp.soldier.root.visible && e.w !== 'tmg') {
      const gp = rp.soldier.gunHolder.getWorldPosition(this.tmpV2);
      from = [gp.x + d[0] * 0.75, gp.y + d[1] * 0.75 + 0.05, gp.z + d[2] * 0.75];
      this.effects.muzzle(new THREE.Vector3(...from), new THREE.Vector3(...d), w.id === 'rx9' ? 0.3 : 0.9, false);
      rp.soldier.fireKick = 1;
    } else if (e.w === 'tmg') this.effects.muzzle(new THREE.Vector3(...o), new THREE.Vector3(...d), 0.8, false);
    const enemy = this.teamOf(e.id) !== this.myTeam;
    this.effects.bullet(o, d, w.vel, {
      tracer: Math.random() < (w.tracer ?? 0.5) * 1.3, from, targets: this.bulletTargets(e.id),
      whiz: enemy && this.mode !== 'tank' ? (x, y, z, dd) => { this.audio.play(dd < 1.2 ? 'crack' : 'whiz', { pos: { x, y, z }, vol: 0.9, ref: 2, rev: 0.2 }); this.supp = Math.min(1.5, this.supp + 0.35); } : null,
    });
    const pos = { x: o[0], y: o[1], z: o[2] };
    this.audio.play(w.sound, { pos, vol: 1.0, delay: true, far: 'gunFar', farDist: 140, ref: 7, rev: 0.6, maxDist: 1400, absorb: 220 });
    if (rp) rp.firingT = this.now();
  }

  // ------------------------------------------------------------------ interpolation
  sample(snaps, t, out) {
    const n = snaps.length;
    if (!n) return null;
    if (t <= snaps[0].t || n === 1) return Object.assign(out, snaps[0]);
    for (let i = n - 1; i > 0; i--) {
      const a = snaps[i - 1], b = snaps[i];
      if (a.t <= t) {
        const k = Math.min(1.25, (t - a.t) / Math.max(1e-4, b.t - a.t));
        Object.assign(out, b);
        out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
        out.yaw = lerpA(a.yaw, b.yaw, Math.min(1, k)); out.pitch = a.pitch + (b.pitch - a.pitch) * Math.min(1, k);
        if (a.turretYaw != null) { out.turretYaw = lerpA(a.turretYaw, b.turretYaw, Math.min(1, k)); out.gunPitch = a.gunPitch + (b.gunPitch - a.gunPitch) * k; out.roll = a.roll + (b.roll - a.roll) * k; }
        if (Math.abs(b.x - a.x) > 20 || Math.abs(b.z - a.z) > 20) { out.x = b.x; out.y = b.y; out.z = b.z; }
        return out;
      }
    }
    return Object.assign(out, snaps[n - 1]);
  }
  gunFor(cls, slot) { const C = CLASSES[cls] || CLASSES.assault; return slot === 1 ? C.secondary : slot === 2 ? C.gadget : C.primary; }

  updateRemotes(dt, rt) {
    const camP = this.gfx.camera.position;
    const showSelf = this.mode === 'death' || this.mode === 'down';
    for (const rp of this.rps.values()) {
      if (!rp.cur) rp.cur = {};
      const s = this.sample(rp.snaps, rt, rp.cur);
      if (!s) continue;
      const info = this.info.get(rp.id);
      const team = info ? info.team : 1;
      const alive = !!(s.fl & 1);
      const isMe = rp.id === this.myId;
      if (isMe && !showSelf) { if (rp.soldier) rp.soldier.root.visible = false; rp.wasAlive = alive; continue; }
      if (!rp.soldier || rp.soldier.team !== team) {
        if (rp.soldier) this.gfx.scene.remove(rp.soldier.root);
        rp.soldier = new Soldier(team, this.macro);
        this.gfx.scene.add(rp.soldier.root);
      }
      const so = rp.soldier;
      if (alive && !rp.wasAlive) { so.revive(); rp.deadT = 0; }
      if (!alive && rp.wasAlive) {
        const kp = this.rpPos(this.killerOf?.get(rp.id));
        so.die(kp ? Math.cos(Math.atan2(kp.x - s.x, kp.z - s.z) - Math.atan2(-Math.sin(s.yaw), -Math.cos(s.yaw))) < 0 : Math.random() < 0.5);
      }
      rp.wasAlive = alive;
      if (!alive) rp.deadT += dt;
      const dist = Math.hypot(s.x - camP.x, s.z - camP.z);
      const vis = (alive || rp.deadT < 9) && s.veh < 0 && dist < 450 && rp.snaps.length > 0 && !(isMe && this.mode === 'death' && false);
      so.root.visible = vis;
      if (!vis) continue;
      // velocity estimate for leg animation
      const vx = (s.x - rp.lastX) / Math.max(dt, 1e-3), vz = (s.z - rp.lastZ) / Math.max(dt, 1e-3);
      rp.lastX = s.x; rp.lastZ = s.z;
      rp.vx += (clamp(vx, -12, 12) - rp.vx) * Math.min(1, dt * 8); rp.vz += (clamp(vz, -12, 12) - rp.vz) * Math.min(1, dt * 8);
      const sp = Math.hypot(rp.vx, rp.vz);
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const fw = sp > 0.2 ? (rp.vx * fx + rp.vz * fz) / sp : 1, rt2 = sp > 0.2 ? (rp.vx * -fz + rp.vz * fx) / sp : 0;
      so.root.position.set(s.x, s.y + (rp.deadT > 6 ? -(rp.deadT - 6) * 0.3 : 0), s.z);
      so.root.rotation.y = s.yaw;
      if (dist < 160 || this.frameN % 3 === 0) {
        so.setGun(this.gunFor(s.cls, s.slot));
        so.animate(dist < 160 ? dt : dt * 3, { speed: sp, fwd: fw, right: rt2, crouch: !!(s.fl & 4), sprint: !!(s.fl & 8), pitch: s.pitch, downed: !!(s.fl & 2), reloading: !!(s.fl & 128), firing: false });
      }
    }
  }
  updateVehicles(dt, rt) {
    for (const rv of this.vehs.values()) {
      if (!rv.cur) rv.cur = {};
      let s = this.sample(rv.snaps, rt, rv.cur);
      if (!s) continue;
      if (this.myTank && this.myTank.id === rv.id) s = Object.assign(rv.cur, this.myTank, { alive: true, hp: s.hp });
      if (!rv.view) { rv.view = new TankView(rv.team, this.macro, this.tex); this.gfx.scene.add(rv.view.root); }
      const wasAlive = rv.view.alive;
      rv.view.set(s, dt);
      if (rv.view.recoil) { rv.view.gun.position.z = -1.5 + rv.view.recoil * 0.35; rv.view.recoil = Math.max(0, rv.view.recoil - dt * 3); }
      if (!s.alive) {
        rv.burn = (rv.burn || 0) + dt;
        if (Math.random() < dt * 14) this.effects.fireSmoke(s.x, s.y + 2, s.z, 1.3);
      } else {
        rv.burn = 0;
        if (s.hp < 380 && Math.random() < dt * 8) this.effects.smoke.spawn({ x: s.x + (Math.random() - 0.5), y: s.y + 2.2, z: s.z + 1.5, vx: 0.3, vy: 2, vz: 0.3, life: 4, s0: 0.6, s1: 3.5, cr: 0.12, cg: 0.12, cb: 0.12, a0: 0.6, a1: 0, drag: 0.5 });
        // dust from tracks
        if (Math.abs(s.speed) > 3 && Math.random() < dt * 10) this.effects.smoke.spawn({ x: s.x + (Math.random() - 0.5) * 3, y: s.y + 0.3, z: s.z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5), life: 2.5, s0: 0.8, s1: 3, cr: 0.55, cg: 0.5, cb: 0.42, a0: 0.4, a1: 0, drag: 1 });
      }
      void wasAlive;
      // engine audio for nearby tanks
      const d = Math.hypot(s.x - this.gfx.camera.position.x, s.z - this.gfx.camera.position.z);
      let lp = this.tankLoops.get(rv.id);
      if (s.alive && d < 140 && !(this.myTank && this.myTank.id === rv.id) && this.audio.enabled) {
        if (!lp) { lp = this.audio.loop('engine', { vol: 0, positional: true, ref: 10 }); this.tankLoops.set(rv.id, lp); }
        lp && lp.set(new THREE.Vector3(s.x, s.y + 1, s.z), 0.5 + Math.min(0.5, Math.abs(s.speed) / 10), 0.8 + Math.abs(s.speed) / 18);
      } else if (lp) { lp.stop(); this.tankLoops.delete(rv.id); }
    }
  }
  updateProjs(dt, rt) {
    const tmp = {};
    for (const pj of this.projs.values()) {
      const s = this.sample(pj.snaps, rt + 0.03, tmp);
      if (!s) continue;
      const m = pj.mesh;
      const px = m.position.x, py = m.position.y, pz = m.position.z;
      m.position.set(s.x, s.y, s.z);
      const dx = s.x - px, dy = s.y - py, dz = s.z - pz;
      if (Math.hypot(dx, dy, dz) > 0.001) m.lookAt(s.x + dx, s.y + dy, s.z + dz);
      if (pj.ty === 'frag') m.rotation.x += dt * 10;
      pj.trailAcc += dt;
      if (pj.ty !== 'frag' && pj.trailAcc > 0.016) {
        pj.trailAcc = 0;
        const steps = pj.ty === 'rocket' ? 4 : 2;
        for (let k = 0; k < steps; k++) this.effects.rocketTrail(px + dx * k / steps, py + dy * k / steps, pz + dz * k / steps, pj.ty);
      }
    }
  }
  updateEnts(dt) {
    const seen = new Set();
    for (const e of this.ents) {
      seen.add(e.id);
      let v = this.entViews.get(e.id);
      if (!v) { v = (e.ty === 'crate' ? this.crateMesh : this.beaconMesh).clone(); this.gfx.scene.add(v); this.entViews.set(e.id, v); }
      v.position.set(e.x, e.y, e.z);
      v.visible = e.ty === 'crate' || e.team === this.myTeam;
      if (v.userData.light) v.children[2].visible = (this.gfx.time % 1) < 0.5;
    }
    for (const [id, v] of this.entViews) if (!seen.has(id)) { this.gfx.scene.remove(v); this.entViews.delete(id); }
    void dt;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.frameN++;
    const msgs = this.queue; this.queue = [];
    for (const m of msgs) this.handle(m);
    const inp = this.input.frame();
    const now = this.now();
    const rt = this.serverNow() - INTERP;
    const cam = this.gfx.camera;
    const set = this.settings;
    const baseFov = set.fov || 78;

    // global keys
    if (inp.esc && (this.mode === 'play' || this.mode === 'tank')) { this.input.unlock(); this.ui.showPause(this); }
    if (inp.suicide && this.mode === 'play') this.net.send({ t: 'suicide' });
    this.hud.scoreboard(inp.score || this.mode === 'end', this.roster, this.myId, this.myTeam, this.tickets);

    if (this.mode === 'play' && this.me.alive) this.updatePlay(dt, inp, now, baseFov);
    else if (this.mode === 'tank' && this.myTank) this.updateTank(dt, inp, baseFov);
    else if (this.mode === 'tank') { this.mode = 'play'; this.me.vm.root.visible = true; this.hud.tankUI(false); }
    else if (this.mode === 'down') this.updateDown(dt, inp, baseFov);
    else if (this.mode === 'death') this.updateDeath(dt, baseFov);
    else if (this.mode === 'deploy' || this.mode === 'end') this.updateOverview(dt);

    this.updateRemotes(dt, rt);
    this.updateVehicles(dt, rt);
    this.updateProjs(dt, rt);
    this.updateEnts(dt);
    this.effects.updateBullets(dt, (b, mat) => {
      const p = { x: b.x, y: b.y, z: b.z };
      const d = Math.hypot(p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z);
      if (d < 70 && mat !== 'glass') this.audio.play(IMPACT_SND[mat === 'flesh' ? MAT.FLESH : mat] || 'impConcrete', { pos: p, vol: 0.6, ref: 3, rev: 0.2 });
    }, cam.position);
    this.effects.update(dt, cam);
    this.wv.update(dt, cam.position);
    this.wv.updateFlags(this.flagStates, this.myTeam, dt);

    // post fx
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2) + this.effects.shake * 0.5;
    this.effects.shake = 0;
    this.supp = Math.max(0, this.supp - dt * 0.9);
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.4);
    const hp = this.meState.hp;
    this.gfx.setPost({ uSupp: Math.min(1, this.supp * 0.8), uDamage: Math.min(0.9, this.dmgFlash * 0.8 + (this.mode === 'play' && hp < 35 ? (35 - hp) / 70 : 0) + (this.mode === 'down' ? 0.5 : 0)), uSat: this.mode === 'down' || this.mode === 'death' ? 0.35 : 1.12 });
    this.hud.vignette(this.mode === 'play' ? hp : 100, this.dmgFlash * 0.6);

    this.audio.setListener(cam.position, this.tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion), this.tmpV2.set(0, 1, 0).applyQuaternion(cam.quaternion));
    this.audio.updateAmbience(dt, 1);
    this.gfx.updateShadow(cam.position.clone().add(this.tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(this.gfx.Q.shadowDist * 0.45)));
    this.updateHud(dt, inp);

    // send input @30Hz
    this.inSendT += dt;
    if (this.inSendT >= 1 / 30 && this.myId >= 0) {
      this.inSendT = 0;
      const b = this.me.body;
      if (this.mode === 'play' && this.me.alive) {
        this.net.send({ t: 'in', x: +b.x.toFixed(3), y: +b.y.toFixed(3), z: +b.z.toFixed(3), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2), vz: +b.vz.toFixed(2), yaw: +this.me.yaw.toFixed(4), pitch: +this.me.pitch.toFixed(4), c: b.crouch ? 1 : 0, sp: this.me.sprintK > 0.5 ? 1 : 0, ads: this.me.adsK > 0.5 ? 1 : 0, g: b.onGround ? 1 : 0, rl: this.me.reload ? 1 : 0, s: this.me.slot });
      } else if (this.mode === 'tank' && this.myTank) {
        const t = this.myTank;
        this.net.send({ t: 'in', yaw: this.tankAim.yaw, pitch: this.tankAim.pitch, v: [+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3), +t.yaw.toFixed(4), +t.pitch.toFixed(4), +t.roll.toFixed(4), +t.speed.toFixed(3), +t.turretYaw.toFixed(4), +t.gunPitch.toFixed(4)] });
      } else if (this.mode === 'down') this.net.send({ t: 'in', yaw: this.me.yaw, pitch: this.me.pitch });
    }
  }

  updatePlay(dt, inp, now, baseFov) {
    const me = this.me, cam = this.gfx.camera;
    me.update(dt, inp, now);
    me.applyCamera(cam, this.gfx.vmCamera, dt, baseFov);
    cam.updateMatrixWorld();
    // sniper scope overlay
    this.hud.scope(me.w.d.optic === 'scope' && me.adsK > 0.92);
    // viewmodel light follows sun; darken when sun is occluded
    if (this.frameN % 6 === 0) {
      const sd = this.gfx.sunDir;
      const lit = raycast(this.W, cam.position.x, cam.position.y, cam.position.z, sd.x, sd.y, sd.z, 120, F.SOLID, {}, false) < 0;
      this.vmLitTarget = lit ? 1 : 0.25;
    }
    this.vmLit = (this.vmLit ?? 1) + ((this.vmLitTarget ?? 1) - (this.vmLit ?? 1)) * Math.min(1, dt * 6);
    this.gfx.vmSun.intensity = 2.6 * this.vmLit;
    this.gfx.vmSun.position.copy(this.gfx.sunDir).applyQuaternion(cam.quaternion.clone().invert()).multiplyScalar(10);
    // interactions: enter tank / revive
    let prompt = '', touchUse = '';
    const b = me.body;
    let nearTank = null;
    for (const rv of this.vehs.values()) {
      const s = rv.cur; if (!s || !s.alive || s.driver >= 0 || rv.team !== this.myTeam) continue;
      if (Math.hypot(s.x - b.x, s.z - b.z) < 6.5) nearTank = rv;
    }
    let nearDown = null;
    for (const rp of this.rps.values()) {
      const s = rp.cur; if (!s || rp.id === this.myId || !(s.fl & 2) || !(s.fl & 1) || this.teamOf(rp.id) !== this.myTeam) continue;
      if (Math.hypot(s.x - b.x, s.z - b.z) < 2.6) nearDown = rp;
    }
    if (nearDown) {
      prompt = `<kbd>E</kbd> HOLD TO REVIVE <b>${this.nameOf(nearDown.id)}</b>`; touchUse = 'REVIVE';
      if (inp.use) { this.reviveHold += dt; if (this.reviveHold > RULES.reviveTime * (this.me.cls === 'support' ? 0.6 : 1)) { this.net.send({ t: 'revive', id: nearDown.id }); this.reviveHold = 0; } }
      else this.reviveHold = 0;
      if (this.reviveHold > 0) prompt += `<div class="pbar"><i style="width:${Math.min(100, this.reviveHold / RULES.reviveTime * 100)}%"></i></div>`;
    } else if (nearTank) {
      prompt = '<kbd>E</kbd> ENTER MBT-9 RHINO'; touchUse = 'ENTER';
      if (inp.usePressed) this.net.send({ t: 'enter' });
    }
    this.hud.prompt(prompt);
    this.input.setTouchUse(touchUse);
    // spotting
    if (inp.spot) this.doSpot();
    // out of bounds
    const out = b.x < BOUNDS.minX || b.x > BOUNDS.maxX || b.z < BOUNDS.minZ || b.z > BOUNDS.maxZ;
    this.oobT = out ? this.oobT + dt : 0;
    this.hud.oob(out ? RULES.outOfBoundsTime - this.oobT : null);
  }
  doSpot() {
    const cam = this.gfx.camera, ids = [];
    const p = this.tmpV;
    for (const rp of this.rps.values()) {
      const s = rp.cur;
      if (!s || !(s.fl & 1) || this.teamOf(rp.id) === this.myTeam) continue;
      p.set(s.x, s.y + 1.2, s.z);
      const d = p.distanceTo(cam.position);
      if (d > 380) continue;
      p.project(cam);
      if (p.z > 1 || Math.hypot(p.x, p.y * cam.aspect ** -1) > 0.18 + 2 / d) continue;
      if (!los(this.W, cam.position.x, cam.position.y, cam.position.z, s.x, s.y + 1.2, s.z)) continue;
      ids.push(rp.id);
    }
    if (ids.length) { this.net.send({ t: 'spot', ids }); this.audio.play('beep', { ui: true, vol: 0.5 }); }
  }
  updateDown(dt, inp, baseFov) {
    const cam = this.gfx.camera, b = this.me.body;
    cam.position.set(b.x, b.y + 0.35, b.z);
    this.me.yaw -= inp.mx * 0.0012; this.me.pitch = clamp(this.me.pitch - inp.my * 0.0012, -0.4, 0.6);
    cam.rotation.set(this.me.pitch + 0.15, this.me.yaw, 0.35);
    cam.fov = baseFov; cam.updateProjectionMatrix();
    this.hud.downed(true, clamp(this.meState.bleed / RULES.bleedOut, 0, 1));
    if (inp.jump) this.net.send({ t: 'giveup' });
    if (!this.hbT || this.now() - this.hbT > 0.9) { this.hbT = this.now(); this.audio.play('heartbeat', { ui: true, vol: 0.7 }); }
    this.hud.prompt('');
    void dt;
  }
  updateDeath(dt, baseFov) {
    const cam = this.gfx.camera;
    this.deathT += dt;
    const kp = this.killerId >= 0 && this.killerId !== this.myId ? this.rpPos(this.killerId) : null;
    const base = this.deathPos || cam.position;
    const k = Math.min(1, this.deathT / 1.2);
    cam.position.set(base.x, base.y + k * 2.5, base.z);
    if (kp) {
      const dx = kp.x - cam.position.x, dy = kp.y + 1.4 - cam.position.y, dz = kp.z - cam.position.z;
      const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
      cam.rotation.y = lerpA(cam.rotation.y, ty, Math.min(1, dt * 4));
      cam.rotation.x += (tp - cam.rotation.x) * Math.min(1, dt * 4);
      const d = Math.hypot(dx, dz);
      cam.fov += (clamp(baseFov * 12 / Math.max(12, d), 12, baseFov) - cam.fov) * Math.min(1, dt * 2);
    }
    cam.rotation.z *= 0.9;
    cam.updateProjectionMatrix();
    this.hud.prompt(''); this.hud.oob(null);
    if (this.deathT > 3.2) { this.mode = 'deploy'; this.ui.openDeploy(this); cam.fov = baseFov; }
  }
  updateOverview(dt) {
    // slow cinematic orbit over the battlefield behind the deploy map
    const cam = this.gfx.camera;
    this.ovT = (this.ovT || 0) + dt * 0.035;
    const r = 210;
    cam.position.set(Math.sin(this.ovT) * r, 95, Math.cos(this.ovT) * r);
    cam.lookAt(0, 10, 0);
    cam.fov = 60; cam.updateProjectionMatrix();
    this.hud.prompt(''); this.hud.oob(null); this.hud.scope(false);
    if (this.me.vm) this.me.vm.root.visible = false;
    this.ui.updateDeploy?.(this);
  }

  updateTank(dt, inp, baseFov) {
    const t = this.myTank, A = this.tankAim, cam = this.gfx.camera;
    const sens = (this.settings.sens ?? 1) * 0.0022 * (A.zoom ? 0.3 : 1);
    A.yaw -= inp.mx * sens; A.pitch = clamp(A.pitch - inp.my * sens, -0.3, 0.45);
    if (inp.slot2 || inp.swap) { A.mg = !A.mg; this.audio.play('swap', { vol: 0.5 }); }
    if (inp.slot1) A.mg = false;
    A.zoom = inp.ads;
    stepTank(this.W, t, { throttle: inp.moveY, steer: -inp.moveX, aimYaw: A.yaw, aimPitch: A.pitch }, dt);
    if (this.engineLoop) this.engineLoop.set(null, 0.35 + Math.min(0.4, Math.abs(t.speed) / 12), 0.8 + Math.abs(t.speed) / 14 + Math.abs(inp.moveY) * 0.15);
    // fire
    if (!A.mg && inp.firePressed && t.reload <= 0) {
      t.reload = TANK.reload;
      this.net.send({ t: 'tfire' });
      this.shake(0.6);
    }
    A.mgT -= dt;
    if (A.mg && inp.fire && A.mgT <= 0) {
      A.mgT = 60 / TANK.mgRpm;
      const mg = tankMg(t);
      const sr = 0.006;
      const d = [mg.d[0] + (Math.random() - 0.5) * sr, mg.d[1] + (Math.random() - 0.5) * sr, mg.d[2] + (Math.random() - 0.5) * sr];
      const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
      this.net.send({ t: 'tmg', d });
      this.effects.bullet(mg.o, d, 820, { tracer: Math.random() < 0.5, targets: this.bulletTargets(this.myId) });
      this.effects.muzzle(new THREE.Vector3(...mg.o), new THREE.Vector3(...d), 0.7, false);
      this.audio.play('tmg', { vol: 0.8 });
    }
    if (inp.usePressed) this.net.send({ t: 'exit' });
    // camera
    const dir = fwd(A.yaw, A.pitch);
    if (A.zoom) {
      const mz = tankMuzzle(t);
      cam.position.set(t.x + dir[0] * 0.5, t.y + 3.05, t.z + dir[2] * 0.5);
      cam.rotation.set(A.pitch, A.yaw, 0);
      cam.fov = baseFov / 4.5;
      void mz;
    } else {
      const back = 11.5;
      let cx = t.x - dir[0] * back, cz = t.z - dir[2] * back, cy = t.y + 4.2 - dir[1] * back;
      const h = heightAt(this.W, cx, cz) + 1.2;
      if (cy < h) cy = h;
      cam.position.set(cx, cy, cz);
      cam.rotation.set(A.pitch - 0.12, A.yaw, 0);
      cam.fov = baseFov;
    }
    const sh = this.shakeAmt;
    cam.rotation.x += (Math.random() - 0.5) * sh * 0.02; cam.rotation.y += (Math.random() - 0.5) * sh * 0.02;
    cam.updateProjectionMatrix();
    this.me.body.x = t.x; this.me.body.y = t.y + 1; this.me.body.z = t.z;
    this.me.yaw = A.yaw;
    // aim point indicator: where the barrel actually points
    const mz = tankMuzzle(t);
    const out = {};
    const hitT = raycast(this.W, mz.o[0], mz.o[1], mz.o[2], mz.d[0], mz.d[1], mz.d[2], 600, F.SHOOT, out);
    const ap = this.tmpV.set(mz.o[0] + mz.d[0] * (hitT > 0 ? hitT : 300), mz.o[1] + mz.d[1] * (hitT > 0 ? hitT : 300), mz.o[2] + mz.d[2] * (hitT > 0 ? hitT : 300)).project(cam);
    const rv = this.vehs.get(t.id);
    const hp = rv && rv.cur ? rv.cur.hp : t.hp;
    this.hud.tankUI(true, `<div class="tw ${A.mg ? '' : 'sel'}">1 · 125mm CANNON <span>${t.reload > 0 ? 'RELOADING ' + t.reload.toFixed(1) + 's' : 'READY'}</span></div><div class="tw ${A.mg ? 'sel' : ''}">2 · 7.62 COAX</div><div class="thp"><i style="width:${hp / TANK.hp * 100}%"></i></div><div class="tsp">${Math.abs(t.speed * 3.6).toFixed(0)} KM/H · <kbd>E</kbd> EXIT</div>`, (ap.x * 0.5 + 0.5) * innerWidth, (-ap.y * 0.5 + 0.5) * innerHeight);
    this.hud.prompt('');
    this.hud.scope(false);
    this.input.setTouchUse('EXIT');
    this.gfx.vmFlash.intensity = 0;
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, inp) {
    const H = this.hud, cam = this.gfx.camera, me = this.me;
    const playing = this.mode === 'play' || this.mode === 'tank' || this.mode === 'down';
    H.show(playing || this.mode === 'death');
    if (!playing && this.mode !== 'death') { H.endMarkers(); return; }
    const myT = this.myTeam, enT = myT === 1 ? 2 : 1;
    H.setTickets(this.tickets[myT - 1], this.tickets[enT - 1], RULES.tickets);
    // nearest flag inside radius
    const b = me.body;
    let inFlag = null;
    for (const f of this.W.flags) if ((b.x - f.x) ** 2 + (b.z - f.z) ** 2 < f.r * f.r && Math.abs(b.y - f.y) < 16) inFlag = f;
    H.setFlags(this.flagStates, myT, inFlag?.id);
    if (inFlag && this.mode !== 'death') { const s = this.flagStates[inFlag.id]; H.setCapture({ ...inFlag, owner: s.owner }, s.prog, myT, s.n1, s.n2); } else H.setCapture(null);
    const heading = ((-cam.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    const fm = this.W.flags.map((f) => {
      const s = this.flagStates[f.id];
      const ang = Math.atan2(f.x - cam.position.x, -(f.z - cam.position.z)) * 180 / Math.PI;
      return { id: f.id, deg: ((ang % 360) + 360) % 360, cls: s.owner === 0 ? 'neu' : s.owner === myT ? 'my' : 'en' };
    });
    H.setCompass(heading, fm);
    if (this.frameN % 2 === 0) {
      const plist = [];
      for (const rp of this.rps.values()) {
        const s = rp.cur; if (!s) continue;
        const info = this.info.get(rp.id);
        plist.push({ x: s.x, z: s.z, yaw: s.yaw, team: info?.team, alive: !!(s.fl & 1), downed: !!(s.fl & 2), spotted: !!(s.fl & 32), firingRecent: this.now() - rp.firingT < 1.5 && !(s.fl & 0), isMe: rp.id === this.myId, veh: s.veh, squadMate: info && info.squad === this.mySquad && info.team === myT });
      }
      const vl = [...this.vehs.values()].filter((v) => v.cur).map((v) => ({ x: v.cur.x, z: v.cur.z, yaw: v.cur.turretYaw ?? v.cur.yaw, team: v.team, alive: v.cur.alive, spotted: v.cur.driver >= 0 && this.rps.get(v.cur.driver)?.cur && (this.rps.get(v.cur.driver).cur.fl & 32) }));
      const mp = this.mode === 'tank' && this.myTank ? this.myTank : b;
      H.drawMinimap(mp, -cam.rotation.y, plist, this.W.flags.map((f) => ({ ...f, owner: this.flagStates[f.id].owner })), myT, vl, this.ents.filter((e) => e.team === myT));
    }
    H.setHealth(this.meState.hp);
    if (this.mode === 'play' && me.w) {
      const w = me.w;
      const gad = CLASSES[me.cls].gadget, gd = WEAPONS[gad];
      const gcd = gd.deploy ? me.gadgetCdLeft() : 0;
      const gadTxt = gd.deploy ? `✦ ${gd.name}${gcd > 0 ? ' ' + gcd.toFixed(0) + 's' : ''}` : `✦ ${gd.name} ${me.weapons[2].mag + me.weapons[2].res}`;
      H.setAmmo(w.d.name, w.d.deploy ? (gcd > 0 ? Math.ceil(gcd) + 's' : 'READY') : w.mag, w.d.deploy ? '' : w.res, me.grenades, gadTxt, me.reload ? 'RELOADING' : '');
      const spreadPx = me.spread() * (innerHeight / cam.fov) * 0.9;
      H.setCrosshair(spreadPx, me.adsK < 0.4 && me.sprintK < 0.5 && !w.d.deploy);
    } else H.setCrosshair(0, false);
    if (this.frameN % 15 === 0 && this.mySquad) {
      H.setSquad(this.roster.filter((r) => r.team === myT && r.squad === this.mySquad && r.id !== this.myId).map((r) => { const s = this.rps.get(r.id)?.cur; return { name: r.name, cls: r.cls, alive: s ? !!(s.fl & 1) : false, downed: s ? !!(s.fl & 2) : false }; }));
    }
    this.updateMarkers();
    if (set_fps(this)) H.fps(this.fpsText);
    void dt; void inp;
  }
  updateMarkers() {
    const H = this.hud, cam = this.gfx.camera;
    H.beginMarkers();
    const W = innerWidth, Hh = innerHeight;
    const p = this.tmpV;
    const proj = (x, y, z) => { p.set(x, y, z).project(cam); if (p.z > 1) return null; return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * Hh]; };
    const myT = this.myTeam;
    for (const f of this.W.flags) {
      const s = this.flagStates[f.id];
      const d = Math.hypot(f.x - cam.position.x, f.z - cam.position.z);
      const sc = proj(f.x, f.y + 6 + Math.min(20, d * 0.04), f.z);
      if (!sc) continue;
      const cls = s.owner === 0 ? 'neu' : s.owner === myT ? 'my' : 'en';
      H.marker(sc[0], sc[1], 'flag ' + cls + (s.contested ? ' cont' : ''), `<b>${f.id}</b><span>${Math.round(d)}m</span>`, 1);
    }
    for (const rp of this.rps.values()) {
      const s = rp.cur;
      if (!s || rp.id === this.myId || !(s.fl & 1) || s.veh >= 0) continue;
      const info = this.info.get(rp.id); if (!info) continue;
      const d = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      const friendly = info.team === myT;
      if (friendly) {
        const squad = info.squad === this.mySquad;
        if (s.fl & 2) { const sc = proj(s.x, s.y + 1.0, s.z); if (sc && d < 80) H.marker(sc[0], sc[1], 'down', `✚<span>${Math.round(d)}m</span>`, 1); continue; }
        if (d > (squad ? 300 : 60)) continue;
        const sc = proj(s.x, s.y + 2.15, s.z);
        if (!sc) continue;
        H.marker(sc[0], sc[1], squad ? 'sq' : 'fr', d < 30 ? `<i></i><span>${info.name}</span>` : '<i></i>', Math.max(0.6, 1 - d / 300));
      } else if (s.fl & 32) {
        const sc = proj(s.x, s.y + 2.1, s.z);
        if (sc && d < 450) H.marker(sc[0], sc[1], 'spot', '<i></i>', Math.max(0.6, 1 - d / 400));
      }
    }
    for (const rv of this.vehs.values()) {
      const s = rv.cur; if (!s || !s.alive) continue;
      if (this.myTank && this.myTank.id === rv.id) continue;
      const d = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      const friendly = rv.team === myT;
      const spotted = s.driver >= 0 && this.rps.get(s.driver)?.cur && (this.rps.get(s.driver).cur.fl & 32);
      if (!friendly && !spotted) continue;
      if (d > 500) continue;
      const sc = proj(s.x, s.y + 4, s.z);
      if (sc) H.marker(sc[0], sc[1], 'veh ' + (friendly ? 'my' : 'en'), `<i>▰</i><span>${s.driver < 0 && friendly ? 'EMPTY · ' : ''}${Math.round(d)}m</span>`, 1);
    }
    for (const e of this.ents) {
      if (e.team !== myT) continue;
      const d = Math.hypot(e.x - cam.position.x, e.z - cam.position.z);
      if (d > 60) continue;
      const sc = proj(e.x, e.y + 1.2, e.z);
      if (sc) H.marker(sc[0], sc[1], 'ent', e.ty === 'crate' ? '✚▣' : '⌖', 1);
    }
    H.endMarkers();
  }
}

function set_fps(g) {
  const n = performance.now();
  g._fpsN = (g._fpsN || 0) + 1;
  if (!g._fpsT) g._fpsT = n;
  if (n - g._fpsT > 500) {
    g.fpsText = Math.round(g._fpsN * 1000 / (n - g._fpsT)) + ' FPS';
    g._fpsN = 0; g._fpsT = n;
    return g.settings.showFps;
  }
  return false;
}
void buildGun; void TEAMS; void MOVE;
