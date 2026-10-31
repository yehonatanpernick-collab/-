import * as THREE from 'three';
import { lerpAngle } from './hero.js';

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, ...o });
const glow = (c, i = 3) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, flatShading: true });

const TYPES = {
  imp: { hp: 55, speed: 6.2, dmg: 9, range: 1.9, aggro: 19, radius: 0.55, height: 1.4, windup: 0.38, cd: 0.9, name: 'גובלין פטריות' },
  sentinel: { hp: 150, speed: 3.3, dmg: 18, range: 3.2, aggro: 17, radius: 1.1, height: 3.4, windup: 0.85, cd: 1.3, name: 'שומר אבן' },
  stalker: { hp: 85, speed: 7.4, dmg: 12, range: 2.4, aggro: 23, radius: 0.9, height: 1.3, windup: 0.5, cd: 1.0, name: 'עכביש בדולח' },
  wraith: { hp: 95, speed: 5.4, dmg: 14, range: 2.3, aggro: 25, radius: 0.65, height: 2.4, windup: 0.5, cd: 1.1, name: 'רוח צל' },
  boss: { hp: 1100, speed: 4.6, dmg: 26, range: 4.2, aggro: 60, radius: 2.2, height: 6.5, windup: 0.9, cd: 1.0, name: 'המלך החלול' },
};

function mk(parent, geo, mat, p = [0, 0, 0], s) { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (s) m.scale.set(...s); m.castShadow = true; parent.add(m); return m; }

function buildImp(e) {
  const g = new THREE.Group(), skin = std('#7a58a8'), cloth = std('#3a6a3a'), cap = glow('#ff4fa8', 0.9), eye = glow('#ffe14a', 4);
  e.flash = [skin, cloth];
  const body = new THREE.Group(); body.position.y = 0.55; g.add(body);
  mk(body, new THREE.SphereGeometry(0.42, 10, 8), cloth, [0, 0.1, 0], [1, 1.1, 0.9]);
  const head = new THREE.Group(); head.position.y = 0.7; body.add(head);
  mk(head, new THREE.SphereGeometry(0.36, 10, 8), skin);
  mk(head, new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap, [0, 0.18, 0], [1, 0.6, 1]);
  for (const s of [-1, 1]) {
    mk(head, new THREE.ConeGeometry(0.1, 0.5, 5), skin, [s * 0.38, 0, 0], [1, 1, 0.5]).rotation.z = -s * 1.2;
    mk(head, new THREE.SphereGeometry(0.08, 8, 6), eye, [s * 0.13, 0.02, 0.3]);
    mk(head, new THREE.SphereGeometry(0.07, 6, 4), glow('#ffffff', 1), [s * 0.3, 0.38, 0.25]);
  }
  mk(head, new THREE.ConeGeometry(0.06, 0.22, 5), skin, [0, -0.08, 0.36]).rotation.x = 1.4;
  e.arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 0.42, 0.2, 0); body.add(a); e.arms.push(a);
    mk(a, new THREE.CapsuleGeometry(0.08, 0.35, 3, 6), skin, [0, -0.25, 0]);
    mk(a, new THREE.ConeGeometry(0.07, 0.2, 4), glow('#d8ffd0', 0.6), [0, -0.55, 0.05]).rotation.x = Math.PI;
  }
  e.legs = [];
  for (const s of [-1, 1]) { const l = new THREE.Group(); l.position.set(s * 0.18, 0.15, 0); body.add(l); mk(l, new THREE.CapsuleGeometry(0.09, 0.25, 3, 6), skin, [0, -0.3, 0]); e.legs.push(l); }
  e.body = body; e.eyes = eye; return g;
}
function buildSentinel(e) {
  const g = new THREE.Group(), stone = std('#bdb39a'), stone2 = std('#a39a82'), gold = std('#e0b048', { metalness: 0.4, roughness: 0.4 }), eye = glow('#ffb84a', 4), rune = glow('#5ff0ff', 2);
  e.flash = [stone, stone2, gold];
  const body = new THREE.Group(); body.position.y = 1.4; g.add(body);
  mk(body, new THREE.BoxGeometry(1.6, 1.5, 1.1), stone, [0, 0.4, 0]);
  mk(body, new THREE.BoxGeometry(1.7, 0.2, 1.2), gold, [0, -0.1, 0]);
  mk(body, new THREE.OctahedronGeometry(0.22), rune, [0, 0.55, 0.58]);
  const head = new THREE.Group(); head.position.y = 1.55; body.add(head);
  mk(head, new THREE.BoxGeometry(0.85, 0.75, 0.8), stone2);
  mk(head, new THREE.BoxGeometry(0.95, 0.15, 0.9), gold, [0, 0.42, 0]);
  mk(head, new THREE.SphereGeometry(0.15, 10, 8), eye, [0, 0.05, 0.4]);
  mk(head, new THREE.ConeGeometry(0.18, 0.6, 4), gold, [0, 0.75, 0]);
  e.arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 1.05, 0.9, 0); body.add(a); e.arms.push(a);
    mk(a, new THREE.SphereGeometry(0.42, 8, 6), stone2);
    mk(a, new THREE.BoxGeometry(0.55, 1.2, 0.55), stone, [0, -0.85, 0]);
    mk(a, new THREE.BoxGeometry(0.75, 0.6, 0.75), stone2, [0, -1.7, 0]);
  }
  e.legs = [];
  for (const s of [-1, 1]) { const l = new THREE.Group(); l.position.set(s * 0.45, -0.3, 0); body.add(l); mk(l, new THREE.BoxGeometry(0.55, 1.1, 0.6), stone2, [0, -0.5, 0]); e.legs.push(l); }
  e.orbit = [];
  for (let i = 0; i < 3; i++) { const r = mk(g, new THREE.DodecahedronGeometry(0.22), stone2); e.orbit.push(r); }
  e.body = body; e.eyes = eye; return g;
}
function buildStalker(e) {
  const g = new THREE.Group(), shell = std('#3a4658'), leg = std('#2a3240'), cr = glow('#56eaff', 2.2), eye = glow('#aaffff', 4);
  e.flash = [shell, leg];
  const body = new THREE.Group(); body.position.y = 0.9; g.add(body);
  mk(body, new THREE.SphereGeometry(0.65, 10, 8), shell, [0, 0, -0.3], [1, 0.7, 1.3]);
  mk(body, new THREE.SphereGeometry(0.4, 10, 8), shell, [0, 0.05, 0.6]);
  for (let i = 0; i < 4; i++) { const c = mk(body, new THREE.OctahedronGeometry(0.22), cr, [(i % 2 ? 0.25 : -0.25), 0.5, -0.6 + i * 0.25], [0.7, 2.2, 0.7]); c.rotation.z = (i % 2 ? -0.4 : 0.4); }
  for (const s of [-1, 1]) for (const k of [0, 1]) mk(body, new THREE.SphereGeometry(0.06, 6, 4), eye, [s * (0.12 + k * 0.1), 0.15 + k * 0.08, 0.95]);
  e.legs = [];
  for (let i = 0; i < 6; i++) {
    const s = i < 3 ? -1 : 1, k = i % 3;
    const l = new THREE.Group(); l.position.set(s * 0.45, 0, 0.4 - k * 0.45); l.rotation.y = s * (Math.PI / 2) + (k - 1) * 0.5 * s; body.add(l);
    const up = mk(l, new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5), leg, [0, 0.25, 0.4]); up.rotation.x = 1.0;
    const lo = mk(l, new THREE.CylinderGeometry(0.03, 0.05, 1.1, 5), leg, [0, -0.2, 0.95]); lo.rotation.x = -0.4;
    e.legs.push(l);
  }
  e.arms = [];
  e.body = body; e.eyes = eye; return g;
}
function buildWraith(e, scale = 1, boss = false) {
  const g = new THREE.Group(), cloak = std(boss ? '#140c1c' : '#1e1428', { side: THREE.DoubleSide }), inner = std('#000000'), eye = glow('#ff2a3a', 5), aura = glow('#9a4cff', 2.4);
  e.flash = [cloak];
  const body = new THREE.Group(); body.position.y = 1.0 * scale; g.add(body);
  const cg = new THREE.ConeGeometry(0.75, 2.2, 10, 3, true); const p = cg.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -1.0) p.setY(i, p.getY(i) + Math.sin(i * 2.7) * 0.25);
  cg.computeVertexNormals();
  mk(body, cg, cloak, [0, 0.2, 0]);
  const head = new THREE.Group(); head.position.y = 1.35; body.add(head);
  mk(head, new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.7), cloak, [0, 0, 0]);
  mk(head, new THREE.SphereGeometry(0.33, 10, 8), inner, [0, -0.05, 0.1]);
  for (const s of [-1, 1]) mk(head, new THREE.SphereGeometry(0.07, 8, 6), eye, [s * 0.12, -0.02, 0.38], [1.3, 0.7, 1]);
  e.arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 0.55, 0.8, 0); body.add(a); e.arms.push(a);
    mk(a, new THREE.ConeGeometry(0.2, 0.9, 6, 1, true), cloak, [0, -0.35, 0]).rotation.x = Math.PI;
    for (let f = 0; f < 3; f++) mk(a, new THREE.ConeGeometry(0.035, 0.4, 4), aura, [(f - 1) * 0.07, -0.95, 0.05]).rotation.x = Math.PI;
  }
  if (boss) {
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const c = mk(head, new THREE.ConeGeometry(0.07, 0.6, 4), aura, [Math.cos(a) * 0.36, 0.42, Math.sin(a) * 0.36]); c.rotation.z = -Math.cos(a) * 0.3; c.rotation.x = Math.sin(a) * 0.3; }
    for (const s of [-1, 1]) { const sp = mk(body, new THREE.SphereGeometry(0.35, 8, 6), std('#2a2230', { metalness: 0.3, roughness: 0.5 }), [s * 0.6, 1.05, 0]); for (let k = 0; k < 3; k++) mk(sp, new THREE.ConeGeometry(0.08, 0.5, 4), std('#3a3040'), [0, 0.3, (k - 1) * 0.2]); }
    mk(body, new THREE.OctahedronGeometry(0.25), aura, [0, 0.6, 0.6]);
  }
  e.orbit = [];
  const no = boss ? 5 : 2;
  for (let i = 0; i < no; i++) e.orbit.push(mk(g, new THREE.SphereGeometry(boss ? 0.3 : 0.12, 8, 6), aura));
  g.scale.setScalar(scale);
  e.legs = []; e.body = body; e.eyes = eye; e.float = true; return g;
}

class Enemy {
  constructor(type, realm, pos, mgr) {
    const c = this.cfg = TYPES[type]; this.type = type; this.realm = realm; this.mgr = mgr;
    this.hp = this.maxHp = c.hp; this.alive = true; this.height = c.height; this.radius = c.radius;
    this.root = type === 'imp' ? buildImp(this) : type === 'sentinel' ? buildSentinel(this) : type === 'stalker' ? buildStalker(this) : buildWraith(this, type === 'boss' ? 2.6 : 1, type === 'boss');
    this.pos = this.root.position.copy(pos); this.home = pos.clone();
    mgr.scene.add(this.root);
    this.state = 'idle'; this.t = 0; this.cd = Math.random(); this.phase = Math.random() * 6; this.facing = Math.random() * 6;
    this.kb = new THREE.Vector3(); this.flashT = 0; this.wander = null; this.deadT = 0; this.rangedCD = 2 + Math.random() * 2;
    // hp bar
    const bar = this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), new THREE.MeshBasicMaterial({ color: '#1a0a10', depthTest: false, transparent: true, opacity: 0.8 }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.09), new THREE.MeshBasicMaterial({ color: '#ff4a5a', depthTest: false }));
    fg.geometry.translate(0.57, 0, 0); fg.position.x = -0.57; fg.position.z = 0.001; bg.renderOrder = 20; fg.renderOrder = 21;
    bar.add(bg, fg); this.barFg = fg; bar.visible = false; mgr.scene.add(bar);
    if (type === 'boss') { this.attackPlan = 0; this.summoned = 0; bar.visible = false; }
  }
  hit(dmg, from, kb = 6) {
    if (!this.alive) return false;
    this.hp -= dmg; this.flashT = 0.12;
    if (this.type !== 'boss') {
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
      const res = this.type === 'sentinel' ? 0.35 : 1;
      this.kb.set(dx / d * kb * res, 0, dz / d * kb * res);
      if (this.state === 'windup' && this.type !== 'sentinel') { this.state = 'recover'; this.t = 0; }
    }
    if (this.state === 'idle') this.state = 'chase';
    this.bar.visible = this.type !== 'boss';
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.state = 'dead'; this.deadT = 0; this.mgr.onDeath(this); }
    return true;
  }
  update(dt, hero, world, cam) {
    const c = this.cfg, fx = this.mgr.fx;
    this.phase += dt * 6; this.t += dt; this.flashT -= dt; this.cd -= dt; this.rangedCD -= dt;
    if (this.state === 'dead') {
      this.deadT += dt; const k = this.deadT / 0.8;
      this.root.scale.setScalar((this.type === 'boss' ? 2.6 : 1) * Math.max(0.01, 1 - k)); this.root.rotation.y += dt * 10; this.pos.y += dt * 1.5;
      if (Math.random() < 0.6) fx.emit(this.pos, { count: 2, color: '#b05cff', speed: 2, life: 0.6, size: 0.5, up: 1 });
      this.bar.visible = false;
      return k < 1;
    }
    const dx = hero.pos.x - this.pos.x, dz = hero.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let move = 0, targetFacing = this.facing;
    const homeD = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    const leash = this.type === 'boss' ? 26 : 45;
    switch (this.state) {
      case 'idle':
        if (!this.wander || this.t > 4) { this.t = 0; const a = Math.random() * 6.28, r = Math.random() * 6; this.wander = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }; }
        { const wx = this.wander.x - this.pos.x, wz = this.wander.z - this.pos.z; if (Math.hypot(wx, wz) > 0.6) { targetFacing = Math.atan2(wx, wz); move = 0.3; } }
        if (d < c.aggro && !hero.dead && (this.type !== 'boss' || this.mgr.bossActive)) { this.state = 'chase'; this.mgr.onAggro(this); }
        break;
      case 'chase':
        targetFacing = Math.atan2(dx, dz); move = 1;
        if (hero.dead || homeD > leash) { this.state = 'return'; break; }
        if (this.type === 'boss') { this.bossThink(dt, hero, d); break; }
        if (this.type === 'wraith' && d > 7 && d < 18 && this.rangedCD <= 0) { this.rangedCD = 3 + Math.random() * 2; this.mgr.shootAt(this, hero, '#c04aff', 1, c.dmg * 0.8); }
        if (d < c.range && this.cd <= 0) { this.state = 'windup'; this.t = 0; move = 0; if (this.type === 'sentinel') fx.ring(this.pos, { color: '#ff7a3a', r0: 0.5, r1: 4, dur: c.windup, opacity: 0.6 }); }
        break;
      case 'return':
        targetFacing = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z); move = 0.8;
        if (homeD < 3) { this.state = 'idle'; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5); }
        if (d < c.aggro * 0.6 && !hero.dead && homeD < leash * 0.8) this.state = 'chase';
        break;
      case 'windup':
        targetFacing = Math.atan2(dx, dz); move = this.type === 'stalker' ? 0 : 0.1;
        if (this.t >= c.windup) { this.state = 'attack'; this.t = 0; this.doAttack(hero, d); }
        break;
      case 'attack':
        if (this.type === 'stalker' && this.t < 0.25) { move = 3.2; }
        if (this.t > 0.3) { this.state = 'recover'; this.t = 0; this.cd = c.cd; }
        break;
      case 'recover':
        targetFacing = Math.atan2(dx, dz); move = 0.2;
        if (this.t > 0.35) this.state = 'chase';
        break;
      case 'bossAct':
        this.bossAct(dt, hero, d); move = this.bossMove || 0; targetFacing = Math.atan2(dx, dz);
        break;
    }
    this.facing = lerpAngle(this.facing, targetFacing, Math.min(1, dt * 8));
    const sp = c.speed * move;
    this.pos.x += (Math.sin(this.facing) * sp + this.kb.x) * dt; this.pos.z += (Math.cos(this.facing) * sp + this.kb.z) * dt;
    this.kb.multiplyScalar(Math.max(0, 1 - dt * 8));
    world.resolve(this.pos, c.radius);
    if (this.type !== 'boss' && world.barrier.visible && !world.barrierOpen) { const bx = this.pos.x - world.arena.x, bz = this.pos.z - world.arena.z, bd = Math.hypot(bx, bz); if (bd < 31) { this.pos.x = world.arena.x + bx / bd * 31; this.pos.z = world.arena.z + bz / bd * 31; } }
    if (this.type === 'boss') { const bx = this.pos.x - world.arena.x, bz = this.pos.z - world.arena.z, bd = Math.hypot(bx, bz); if (bd > 24) { this.pos.x = world.arena.x + bx / bd * 24; this.pos.z = world.arena.z + bz / bd * 24; } }
    // keep out of water
    let gh = world.groundAt(this.pos.x, this.pos.z);
    if (gh < 0.3) { this.pos.x -= Math.sin(this.facing) * sp * dt * 2; this.pos.z -= Math.cos(this.facing) * sp * dt * 2; gh = world.groundAt(this.pos.x, this.pos.z); }
    const hover = this.float ? 0.6 + Math.sin(this.phase * 0.4) * 0.25 : 0;
    this.pos.y += (gh + hover - this.pos.y) * Math.min(1, dt * 12);
    // separate from hero
    if (d < c.radius + 0.5 && d > 0.01) { this.pos.x -= dx / d * (c.radius + 0.5 - d); this.pos.z -= dz / d * (c.radius + 0.5 - d); }
    this.root.rotation.y = this.facing;
    this.animate(dt, move);
    // bar
    if (this.bar.visible) { this.bar.position.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z); this.bar.quaternion.copy(cam.quaternion); this.barFg.scale.x = Math.max(0.001, this.hp / this.maxHp); }
    return true;
  }
  doAttack(hero, d) {
    const c = this.cfg, fx = this.mgr.fx;
    const ang = Math.abs(((Math.atan2(hero.pos.x - this.pos.x, hero.pos.z - this.pos.z) - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (this.type === 'sentinel') {
      fx.ring(this.pos, { color: '#ffb84a', r0: 0.5, r1: 4.5, dur: 0.4 }); fx.emit(this.pos, { count: 25, color: '#d9c9a0', speed: 6, life: 0.6, size: 0.6, up: 2, gravity: 8 });
      this.mgr.sound('slam');
      if (d < 4.2) this.mgr.hurtHero(c.dmg, this.pos);
    } else if (this.type === 'stalker') {
      this.mgr.sound('hiss');
      if (d < c.range + 1.6 && ang < 1.0) this.mgr.hurtHero(c.dmg, this.pos);
    } else {
      this.mgr.sound('claw');
      if (d < c.range + 0.8 && ang < 1.1) this.mgr.hurtHero(c.dmg, this.pos);
    }
  }
  // ---- boss ----
  bossThink(dt, hero, d) {
    if (this.cd > 0) return;
    const hpK = this.hp / this.maxHp;
    if ((hpK < 0.66 && this.summoned === 0) || (hpK < 0.33 && this.summoned === 1)) { this.summoned++; this.startAct('summon'); return; }
    const opts = d < 7 ? ['slam', 'slam', 'nova', 'volley'] : ['volley', 'nova', 'charge', 'volley'];
    this.startAct(opts[Math.floor(Math.random() * opts.length)]);
  }
  startAct(name) { this.state = 'bossAct'; this.act = name; this.t = 0; this.fired = 0; this.bossMove = 0; this.mgr.sound('roar'); if (name === 'slam') this.mgr.fx.ring(this.pos, { color: '#ff2a3a', r0: 1, r1: 8, dur: 0.95, opacity: 0.55 }); }
  bossAct(dt, hero, d) {
    const fx = this.mgr.fx, hpK = this.hp / this.maxHp, rage = hpK < 0.4 ? 1.4 : 1;
    const end = (cd) => { this.state = 'chase'; this.cd = cd / rage; this.bossMove = 0; };
    if (this.act === 'slam') {
      if (this.t > 0.95 && !this.fired) {
        this.fired = 1; fx.ring(this.pos, { color: '#b05cff', r0: 1, r1: 10, dur: 0.6 }); fx.ring(this.pos, { color: '#ff3a4a', r0: 1, r1: 7, dur: 0.4 });
        fx.emit(this.pos, { count: 60, color: '#b05cff', speed: 12, life: 0.8, size: 0.9, up: 3 }); this.mgr.sound('slam'); this.mgr.shake(0.6);
        if (d < 8) this.mgr.hurtHero(this.cfg.dmg, this.pos);
      }
      if (this.t > 1.5) end(1.2);
    } else if (this.act === 'volley') {
      const n = hpK < 0.5 ? 7 : 5;
      if (this.t > 0.5 && this.fired < 3 && this.t > 0.5 + this.fired * 0.45) {
        this.fired++;
        for (let i = 0; i < n; i++) this.mgr.shootAt(this, hero, '#ff3a6a', 1.6, 14, (i - (n - 1) / 2) * 0.16, 18);
      }
      if (this.t > 2) end(1.4);
    } else if (this.act === 'nova') {
      if (this.t > 0.7 && !this.fired) {
        this.fired = 1; const n = hpK < 0.5 ? 22 : 16;
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; this.mgr.shootDir(this, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), '#b05cff', 1.5, 14, 13); }
        fx.ring(this.pos, { color: '#b05cff', r0: 1, r1: 6, dur: 0.5 });
      }
      if (this.t > 1.3) end(1.3);
    } else if (this.act === 'charge') {
      this.bossMove = this.t > 0.5 && this.t < 1.4 ? 3.2 : 0;
      if (this.bossMove && d < 4 && !this.fired) { this.fired = 1; this.mgr.hurtHero(this.cfg.dmg * 0.8, this.pos); }
      if (this.t > 1.7) end(1.2);
    } else if (this.act === 'summon') {
      if (this.t > 1 && !this.fired) { this.fired = 1; this.mgr.summon(this, 3); fx.ring(this.pos, { color: '#9a4cff', r0: 1, r1: 14, dur: 1 }); }
      if (this.t > 1.8) end(1);
    }
  }
  animate(dt, move) {
    const s = Math.sin(this.phase * (0.6 + move * 0.6));
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i];
      if (this.type === 'stalker') l.rotation.x = Math.sin(this.phase * 1.6 + i * 1.7) * 0.35 * Math.min(1, move);
      else l.rotation.x = (i % 2 ? s : -s) * 0.7 * Math.min(1, move);
    }
    let armX = 0;
    if (this.state === 'windup') armX = -2.2 * Math.min(1, this.t / this.cfg.windup);
    else if (this.state === 'attack') armX = 0.6;
    else if (this.state === 'bossAct') armX = this.act === 'slam' ? (this.t < 0.9 ? -2.6 : 0.8) : -1.2 * Math.sin(Math.min(1, this.t) * Math.PI);
    else armX = s * 0.3 * move;
    this.arms.forEach((a, i) => { a.rotation.x = armX + (this.float ? Math.sin(this.phase * 0.5 + i) * 0.15 : 0); });
    this.body.position.y = this.body.userData.y0 ??= this.body.position.y;
    if (!this.float) this.body.position.y = this.body.userData.y0 + Math.abs(s) * 0.08 * move;
    if (this.type === 'stalker' && this.state === 'windup') this.body.position.y = this.body.userData.y0 - 0.25;
    if (this.orbit) this.orbit.forEach((o, i) => { const a = this.phase * 0.35 + i * Math.PI * 2 / this.orbit.length, r = this.type === 'sentinel' ? 1.8 : this.type === 'boss' ? 1.5 : 0.8; o.position.set(Math.cos(a) * r, (this.type === 'sentinel' ? 2.6 : 1.8) + Math.sin(a * 2) * 0.3, Math.sin(a) * r); });
    const fl = this.flashT > 0 ? 1 : 0;
    for (const m of this.flash) m.emissive.setRGB(fl, fl, fl);
    if (this.eyes) this.eyes.emissiveIntensity = this.state === 'windup' || this.state === 'bossAct' ? 9 : 4;
  }
}

export class Enemies {
  constructor(scene, fx, hooks) {
    this.scene = scene; this.fx = fx; this.list = []; this.hooks = hooks; this.bossActive = false; this.boss = null;
  }
  spawn(type, realm, pos) { const e = new Enemy(type, realm, pos.clone(), this); this.list.push(e); return e; }
  camp(type, realm, center, n, world, r0 = 5, r1 = 12) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.random() * 0.5, r = r0 + Math.random() * (r1 - r0);
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r); p.y = world.groundAt(p.x, p.z);
      this.spawn(type, realm, p).camp = realm;
    }
  }
  campAlive(realm) { let n = 0; for (const e of this.list) if (e.alive && e.camp === realm) n++; return n; }
  onDeath(e) { this.hooks.onDeath(e); }
  onAggro(e) { this.hooks.onAggro?.(e); }
  hurtHero(dmg, from) { this.hooks.hurtHero(dmg, from); }
  sound(n) { this.hooks.sound(n); }
  shake(a) { this.hooks.shake(a); }
  summon(boss, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; const p = new THREE.Vector3(boss.pos.x + Math.cos(a) * 6, 0, boss.pos.z + Math.sin(a) * 6); p.y = boss.pos.y; const w = this.spawn('wraith', 4, p); w.state = 'chase'; w.home = this.hooks.arena.clone(); this.fx.emit(p, { count: 30, color: '#9a4cff', speed: 4, life: 0.8, size: 0.7, up: 2 }); }
  }
  shootAt(e, hero, color, scale, dmg, spread = 0, speed = 16) {
    const o = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z);
    const t = new THREE.Vector3(hero.pos.x, hero.pos.y + 1.1, hero.pos.z);
    const dir = t.sub(o).normalize(); dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    this.fx.bolt(o, dir, { color, scale, speed, life: 3, hostile: true, dmg });
    this.sound('eshoot');
  }
  shootDir(e, dir, color, scale, dmg, speed) {
    const o = new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z);
    this.fx.bolt(o, dir, { color, scale, speed, life: 3, hostile: true, dmg });
  }
  update(dt, hero, world, cam) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.update(dt, hero, world, cam)) { this.scene.remove(e.root); this.scene.remove(e.bar); this.list.splice(i, 1); }
    }
    // separation
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, m = a.radius + b.radius; if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
      const d = Math.hypot(dx, dz); if (d < m && d > 1e-3) { const p = (m - d) / 2; a.pos.x -= dx / d * p; a.pos.z -= dz / d * p; b.pos.x += dx / d * p; b.pos.z += dz / d * p; }
    }
  }
  hitArc(origin, facing, range, cosHalf, dmg, kb) {
    const hits = []; const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius || Math.abs(e.pos.y - origin.y) > 3 + e.height) continue;
      if (d > 0.5 && (dx * fx + dz * fz) / d < cosHalf) continue;
      e.hit(dmg, origin, kb); hits.push(e);
    }
    return hits;
  }
  nearest(p, maxD, facing, cosHalf = -1) {
    let best = null, bd = maxD; const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < bd && (d < 1 || (dx * fx + dz * fz) / d >= cosHalf)) { bd = d; best = e; }
    }
    return best;
  }
}
