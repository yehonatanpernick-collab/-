import * as THREE from 'three';
import * as A from './assets.js';
import { lerpAngle } from './hero.js';

const SK = { idle: 'Idle_Combat', walk: 'Walking_D_Skeletons', run: 'Running_C', hit: ['Hit_A', 'Hit_B'], death: 'Death_C_Skeletons', spawn: 'Spawn_Ground_Skeletons' };
const HU = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', hit: ['Hit_A', 'Hit_B'], death: 'Death_A', spawn: null };
export const TYPES = {
  minion: { model: 'Skeleton_Minion', w: [['Skeleton_Blade', 'handslot.r']], A: SK, hp: 55, speed: 2.4, run: 5.2, dmg: 9, range: 2.1, aggro: 22, radius: 0.55, attacks: [['1H_Melee_Attack_Chop', 0.45, 1.25], ['1H_Melee_Attack_Slice_Diagonal', 0.42, 1.3]], cd: 1.1, poise: 1, eyes: '#ffc24a', xp: 10 },
  warrior: { model: 'Skeleton_Warrior', w: [['Skeleton_Axe', 'handslot.r'], ['Skeleton_Shield_Large_A', 'handslot.l']], A: SK, hp: 140, speed: 2.0, run: 4.0, dmg: 17, range: 2.5, aggro: 20, radius: 0.75, attacks: [['1H_Melee_Attack_Slice_Diagonal', 0.45, 1.0], ['1H_Melee_Attack_Jump_Chop', 0.5, 1.0, true]], cd: 1.4, poise: 3, block: 0.3, scale: 1.1, eyes: '#ffb03a', xp: 25 },
  rogue: { model: 'Skeleton_Rogue', w: [['Skeleton_Blade', 'handslot.r']], A: SK, hp: 70, speed: 3, run: 6.6, dmg: 11, range: 2.0, aggro: 24, radius: 0.55, attacks: [['1H_Melee_Attack_Stab', 0.4, 1.45], ['1H_Melee_Attack_Slice_Horizontal', 0.4, 1.4]], cd: 0.9, poise: 1, dodge: 0.25, eyes: '#7affd6', xp: 15 },
  mage: { model: 'Skeleton_Mage', w: [['Skeleton_Staff', 'handslot.r']], A: SK, hp: 60, speed: 2.2, run: 4.2, dmg: 13, range: 15, aggro: 26, radius: 0.55, ranged: true, attacks: [['Spellcast_Shoot', 0.45, 1.1]], cd: 2.0, poise: 1, eyes: '#c27aff', bolt: '#c06aff', xp: 18 },
  thief: { model: 'Rogue_Hooded', hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'], A: HU, hp: 75, speed: 3, run: 6.8, dmg: 11, range: 2.0, aggro: 24, radius: 0.55, attacks: [['1H_Melee_Attack_Stab', 0.4, 1.4], ['1H_Melee_Attack_Slice_Diagonal', 0.42, 1.4]], cd: 0.95, poise: 1, dodge: 0.3, dark: true, rim: '#b78cff', xp: 15 },
  // bosses
  witch: { model: 'Mage', hide: ['Spellbook', 'Spellbook_open', '1H_Wand'], A: HU, hp: 900, speed: 3, run: 5, dmg: 16, range: 16, aggro: 50, radius: 0.8, boss: 'witch', scale: 1.35, attacks: [['Spellcast_Shoot', 0.45, 1.0]], cd: 1.2, poise: 99, dark: true, rim: '#ff6ad5', name: 'מורגנה, המכשפה האפלה', bolt: '#ff4fd0', xp: 300 },
  titan: { model: 'Barbarian', hide: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', 'Mug'], A: HU, hp: 1400, speed: 2.6, run: 4.6, dmg: 26, range: 5.2, aggro: 50, radius: 1.8, boss: 'titan', scale: 2.7, attacks: [['2H_Melee_Attack_Chop', 0.5, 0.85], ['2H_Melee_Attack_Slice', 0.48, 0.85]], cd: 1.3, poise: 99, stone: true, rim: '#ffd27a', name: 'אקמון, טיטאן השיש', xp: 500 },
  king: { model: 'Skeleton_Warrior', w: [['Skeleton_Axe', 'handslot.r'], ['Skeleton_Shield_Large_A', 'handslot.l']], A: SK, hp: 2000, speed: 2.8, run: 5, dmg: 30, range: 5.5, aggro: 60, radius: 2.0, boss: 'king', scale: 3.1, attacks: [['1H_Melee_Attack_Slice_Diagonal', 0.45, 0.85], ['1H_Melee_Attack_Jump_Chop', 0.5, 0.8, true]], cd: 1.0, poise: 99, dark: true, rim: '#ff2a4a', eyes: '#ff2030', name: 'המלך החלול', bolt: '#ff3a6a', xp: 800 },
};

class Enemy {
  constructor(mgr, type, pos, opts = {}) { this.mgr = mgr; this.type = type; this.cfg = TYPES[type]; this.spawnPos = pos.clone(); this.opts = opts; }
  async init() {
    const c = this.cfg;
    const ch = this.char = await A.character(c.model, { hide: c.hide, rim: c.rim || '#ff9a6a', rimStr: c.boss ? 0.45 : 0.25, stone: c.stone, dark: c.dark });
    for (const [f, slot] of c.w || []) await A.attach(ch, f, slot, { dark: c.dark, rim: c.rim || '#ff9a6a', rimStr: 0.2 });
    if (c.eyes) ch.root.traverse(o => { if (o.isMesh && /Eyes/.test(o.name)) { const m = new THREE.MeshStandardMaterial({ color: c.eyes, emissive: c.eyes, emissiveIntensity: 7 }); m.userData = { flash: { value: 0 }, rim: { value: new THREE.Color() } }; o.material = m; this.eyeMat = m; } });
    this.root = new THREE.Group(); this.root.add(ch.root); ch.root.scale.setScalar(c.scale || 1);
    this.mgr.scene.add(this.root);
    this.mixer = ch.mixer; this.actions = {};
    for (const [k, clip] of Object.entries(ch.clips)) this.actions[k] = this.mixer.clipAction(clip);
    for (const k of [...c.attacks.map(a => a[0]), ...c.A.hit, c.A.death, c.A.spawn, 'Spellcast_Summon', 'Taunt', 'Block_Hit', 'Dodge_Backward', '2H_Melee_Attack_Spin', 'Cheer'].filter(Boolean)) { const a = this.actions[k]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    this.pos = this.root.position.copy(this.spawnPos);
    this.hp = this.maxHp = Math.round(c.hp * (this.opts.hpMul || 1)); this.alive = true; this.radius = c.radius; this.height = 2.2 * (c.scale || 1);
    this.facing = this.opts.facing ?? Math.random() * 6.28; this.kb = new THREE.Vector3(); this.cd = 0.5 + Math.random(); this.poise = c.poise; this.t = 0; this.home = this.pos.clone();
    this.state = 'idle'; this.cur = null; this.flash = 0; this.rangedCD = 1 + Math.random() * 2; this.actT = 0; this.phase = 0;
    if (this.opts.rise && c.A.spawn) { this.state = 'spawn'; this.play(c.A.spawn, 0, 1.1); this.mgr.fx.emit(this.pos, { count: 30, color: '#6a5a48', speed: 4, life: 1, size: 0.6, up: 3, gravity: 9 }); this.mgr.sound('rise'); }
    else this.play(c.A.idle, 0);
    this.root.rotation.y = this.facing;
    this.mixer.update(0.01);
    return this;
  }
  play(name, fade = 0.15, speed = 1) {
    const a = this.actions[name]; if (!a) return;
    if (this.cur === a && a.isRunning() && a.loop !== THREE.LoopOnce) { a.timeScale = speed; return; }
    a.reset(); a.timeScale = speed; a.play(); if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false); this.cur = a; this.curName = name;
  }
  norm() { return this.cur ? this.cur.time / this.cur.getClip().duration : 1; }
  hit(dmg, from, kb = 5, heavy = false) {
    if (!this.alive || this.state === 'spawn') return false;
    const c = this.cfg;
    if (c.block && this.state !== 'attack' && Math.random() < c.block && !heavy) {
      const ang = Math.abs(((Math.atan2(from.x - this.pos.x, from.z - this.pos.z) - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ang < 1.0) { this.play('Block_Hit', 0.05, 1.3); this.state = 'stagger'; this.t = 0; this.mgr.onBlock(this); dmg = Math.round(dmg * 0.25); kb *= 0.4; }
    }
    this.hp -= dmg; this.flash = 0.12;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    if (!c.boss) this.kb.set(dx / d * kb, 0, dz / d * kb);
    if (this.state === 'idle') this.state = 'chase';
    this.poise -= heavy ? 2 : 1;
    if (this.hp <= 0) { this.die(); return true; }
    if (this.poise <= 0 && !c.boss) { this.poise = c.poise; this.state = 'stagger'; this.t = 0; this.play(c.A.hit[Math.floor(Math.random() * 2)], 0.05, 1.3); }
    if (c.boss && heavy && Math.random() < 0.15 && this.state !== 'act') { this.state = 'stagger'; this.t = 0; this.play('Hit_B', 0.05, 1.1); }
    return true;
  }
  die() {
    this.hp = 0; this.alive = false; this.state = 'dead'; this.t = 0;
    this.play(this.cfg.A.death, 0.08, this.cfg.boss ? 0.6 : 1); this.mgr.onDeath(this);
  }
  update(dt, hero, world, cam) {
    const c = this.cfg, fx = this.mgr.fx; this.t += dt; this.cd -= dt; this.rangedCD -= dt; this.flash -= dt;
    if (this.state === 'dead') {
      this.mixer.update(dt);
      if (this.t > (c.boss ? 2.5 : 1.3)) { const k = (this.t - (c.boss ? 2.5 : 1.3)) / 1.2; for (const m of this.char.mats) m.userData.dissolve.value = k; if (Math.random() < 0.5) fx.emit(this.pos, { count: 2, color: c.dark ? '#b05cff' : '#ffd88a', speed: 1, life: 1, size: 0.4, up: 1.5, spread: 1.2 }); if (k >= 1) return false; }
      return true;
    }
    const dx = hero.pos.x - this.pos.x, dz = hero.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let move = 0, run = false, face = this.facing;
    const toHero = Math.atan2(dx, dz);
    const homeD = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    switch (this.state) {
      case 'spawn': if (this.norm() > 0.92 || this.t > 2.6) { this.state = 'chase'; this.t = 0; } break;
      case 'idle':
        if (this.t > 3 + Math.random() * 3) { this.t = 0; this.wander = Math.random() < 0.6 ? Math.random() * 6.28 : null; }
        if (this.wander != null && homeD < 7) { face = this.wander; move = 1; } else if (homeD >= 7) { face = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z); move = 1; }
        if (d < c.aggro * (this.opts.alert ? 2 : 1) && !hero.dead && (!c.boss || this.mgr.bossActive === this)) { this.state = 'chase'; this.t = 0; this.mgr.onAggro(this); }
        break;
      case 'chase':
        face = toHero; run = true; move = 1;
        if (hero.dead) { this.state = 'idle'; break; }
        if (!c.boss && homeD > 55 && !this.opts.alert) { this.state = 'idle'; break; }
        if (c.boss) { if (this.bossThink(dt, hero, d)) break; }
        if (c.ranged) {
          if (d < 7) { face = toHero + Math.PI; move = 0.8; }
          else if (d < c.range) { move = 0; if (this.cd <= 0) this.startAttack(0); }
        } else if (d < c.range + (c.boss ? 0.5 : 0) && this.cd <= 0) this.startAttack(Math.floor(Math.random() * c.attacks.length));
        else if (d < c.range * 1.6 && !c.boss) { move = 0.45; run = false; }
        if (c.dodge && hero.state === 'attack' && d < 3.2 && Math.random() < c.dodge * dt * 4) { this.state = 'evade'; this.t = 0; this.play('Dodge_Backward', 0.05, 1.5); }
        break;
      case 'evade': face = toHero; this.pos.x -= Math.sin(this.facing) * 8 * dt * Math.max(0, 1 - this.t / 0.45); this.pos.z -= Math.cos(this.facing) * 8 * dt * Math.max(0, 1 - this.t / 0.45); if (this.t > 0.5) { this.state = 'chase'; this.t = 0; } break;
      case 'attack': {
        const [clip, hitF, , jump] = this.atk; const n = this.norm();
        if (n < hitF * 0.8) face = toHero;
        if (jump && n > 0.2 && n < hitF) { move = 1.4; run = true; }
        if (!this.struck && n >= hitF) { this.struck = true; this.strike(hero, d); }
        if (n >= 0.95) { this.state = 'chase'; this.cd = c.cd * (0.7 + Math.random() * 0.6); this.t = 0; }
        break;
      }
      case 'stagger': if (this.t > 0.45) { this.state = 'chase'; this.t = 0; } break;
      case 'act': this.bossAct(dt, hero, d); face = this.actFace ?? toHero; move = this.actMove || 0; run = true; break;
    }
    this.facing = lerpAngle(this.facing, face, Math.min(1, dt * (this.state === 'attack' ? 5 : 8)));
    // animation for locomotion states
    if (this.state === 'idle' || this.state === 'chase') this.play(move > 0.5 ? (run ? c.A.run : c.A.walk) : move > 0 ? c.A.walk : c.A.idle, 0.2, move > 0.5 && run ? 1 : 0.9);
    const sp = (run ? c.run : c.speed) * move;
    this.pos.x += (Math.sin(this.facing) * sp + this.kb.x) * dt; this.pos.z += (Math.cos(this.facing) * sp + this.kb.z) * dt;
    this.kb.multiplyScalar(Math.max(0, 1 - dt * 7));
    world.resolve(this.pos, c.radius);
    if (this.opts.arena) { const a = this.opts.arena, bx = this.pos.x - a.x, bz = this.pos.z - a.z, bd = Math.hypot(bx, bz); if (bd > a.r) { this.pos.x = a.x + bx / bd * a.r; this.pos.z = a.z + bz / bd * a.r; } }
    const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
    if (world.liquidAt(this.pos.x, this.pos.z, g) || !world.inBounds(this.pos.x, this.pos.z)) { this.pos.x -= Math.sin(this.facing) * sp * dt * 1.5; this.pos.z -= Math.cos(this.facing) * sp * dt * 1.5; }
    this.pos.y += (world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1) - this.pos.y) * Math.min(1, dt * 14);
    if (d < c.radius + 0.5 && d > 0.01) { this.pos.x -= dx / d * (c.radius + 0.5 - d); this.pos.z -= dz / d * (c.radius + 0.5 - d); }
    this.root.rotation.y = this.facing;
    this.mixer.update(dt);
    const fl = this.flash > 0 ? 0.9 : 0;
    for (const m of this.char.mats) m.userData.flash.value = fl;
    if (this.eyeMat) this.eyeMat.emissiveIntensity = (this.state === 'attack' && this.norm() < this.atk[1]) ? 18 : 7;
    return true;
  }
  startAttack(i) {
    const c = this.cfg; this.atk = c.attacks[i]; this.state = 'attack'; this.struck = false; this.t = 0;
    this.play(this.atk[0], 0.08, this.atk[2]);
    if (this.atk[3] || c.boss) this.mgr.fx.ring(this.pos, { color: '#ff3a2a', r0: 0.5, r1: c.range + 0.5, dur: this.atk[1] / this.atk[2] * this.cur.getClip().duration * 0.9, opacity: 0.5 });
  }
  strike(hero, d) {
    const c = this.cfg;
    if (c.ranged || (c.boss === 'witch')) { this.mgr.shootAt(this, hero, c.bolt || '#c06aff', 1.1, c.dmg, 0, 17); return; }
    const ang = Math.abs(((Math.atan2(hero.pos.x - this.pos.x, hero.pos.z - this.pos.z) - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    this.mgr.sound(c.boss ? 'slam' : 'swing2');
    if (this.atk[3] || c.boss) { this.mgr.fx.ring(this.pos, { color: '#ffb46a', r0: 0.5, r1: c.range + 1, dur: 0.35 }); this.mgr.fx.emit(this.pos, { count: 26, color: '#a89878', speed: 6, life: 0.7, size: 0.6, up: 2, gravity: 10 }); this.mgr.shake(c.boss ? 0.5 : 0.2); }
    if (d < c.range + 0.9 && (ang < 1.2 || this.atk[3] || (c.boss && d < c.range * 0.7))) this.mgr.hurtHero(c.dmg, this.pos);
  }
  // ---------- boss brains ----------
  bossThink(dt, hero, d) {
    if (this.cd > 0) return false;
    const k = this.hp / this.maxHp, b = this.cfg.boss;
    if (this.phase === 0 && k < 0.6) { this.phase = 1; this.startAct('summon'); return true; }
    if (this.phase === 1 && k < 0.3) { this.phase = 2; this.startAct('summon'); return true; }
    const r = Math.random();
    if (b === 'witch') { this.startAct(d < 6 ? (r < 0.6 ? 'blink' : 'nova') : r < 0.55 ? 'volley' : r < 0.8 ? 'nova' : 'blink'); return true; }
    if (b === 'titan') { if (d < 6) { if (r < 0.35) { this.startAct('spin'); return true; } return false; } this.startAct(r < 0.55 ? 'charge' : 'leap'); return true; }
    if (b === 'king') { if (d < 6.5) { if (r < 0.3) { this.startAct('nova'); return true; } return false; } this.startAct(r < 0.45 ? 'volley' : r < 0.75 ? 'charge' : 'nova'); return true; }
    return false;
  }
  startAct(name) {
    this.state = 'act'; this.act = name; this.actT = 0; this.fired = 0; this.actMove = 0; this.actFace = null; this.mgr.sound(this.cfg.boss === 'witch' ? 'cast' : 'roar');
    const fx = this.mgr.fx;
    if (name === 'summon') this.play('Spellcast_Summon', 0.1, 0.9);
    else if (name === 'volley' || name === 'nova') this.play(this.cfg.boss === 'witch' ? 'Spellcast_Long' : 'Taunt', 0.1, 1.2);
    else if (name === 'spin') { this.play('2H_Melee_Attack_Spin', 0.08, 0.8); fx.ring(this.pos, { color: '#ff3a2a', r0: 1, r1: 7, dur: 0.6, opacity: 0.5 }); }
    else if (name === 'charge') { this.play(this.cfg.A.run, 0.1, 1.5); }
    else if (name === 'leap') { this.play('1H_Melee_Attack_Jump_Chop', 0.1, 0.75); }
    else if (name === 'blink') { this.play('Spellcast_Shoot', 0.05, 1.5); }
  }
  bossAct(dt, hero, d) {
    this.actT += dt; const t = this.actT, fx = this.mgr.fx, k = this.hp / this.maxHp, rage = k < 0.4 ? 1.35 : 1;
    const end = cd => { this.state = 'chase'; this.cd = cd / rage; this.actMove = 0; this.actFace = null; };
    switch (this.act) {
      case 'summon':
        if (t > 1.1 && !this.fired) { this.fired = 1; this.mgr.summon(this, this.cfg.boss === 'witch' ? 'thief' : this.cfg.boss === 'titan' ? 'warrior' : 'minion', this.cfg.boss === 'king' ? 4 : 3); fx.ring(this.pos, { color: '#b05cff', r0: 1, r1: 14, dur: 1 }); this.mgr.shake(0.4); }
        if (t > 2) end(1.2); break;
      case 'volley': {
        const n = k < 0.5 ? 7 : 5;
        if (t > 0.6 && this.fired < 3 && t > 0.6 + this.fired * 0.42) { this.fired++; for (let i = 0; i < n; i++) this.mgr.shootAt(this, hero, this.cfg.bolt || '#ff3a6a', 1.4, 13, (i - (n - 1) / 2) * 0.16, 17); }
        if (t > 2.1) end(1.3); break;
      }
      case 'nova':
        if (t > 0.8 && this.fired < (k < 0.5 ? 2 : 1) && t > 0.8 + this.fired * 0.5) { this.fired++; const n = 18; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + this.fired * 0.17; this.mgr.shootDir(this, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), this.cfg.bolt || '#b05cff', 1.3, 13, 12); } fx.ring(this.pos, { color: this.cfg.bolt || '#b05cff', r0: 1, r1: 7, dur: 0.5 }); this.mgr.sound('boom'); }
        if (t > 1.9) end(1.4); break;
      case 'spin':
        this.actMove = 0.6;
        if (t > 0.55 && this.fired < 3 && t > 0.55 + this.fired * 0.35) { this.fired++; fx.ring(this.pos, { color: '#ffd27a', r0: 1, r1: 6.5, dur: 0.3 }); this.mgr.sound('swing2'); if (d < 6.2) this.mgr.hurtHero(this.cfg.dmg * 0.7, this.pos); }
        if (t > 1.8) end(1.2); break;
      case 'charge':
        if (t < 0.5) { this.actFace = Math.atan2(hero.pos.x - this.pos.x, hero.pos.z - this.pos.z); this.actMove = 0; }
        else if (t < 1.6) { this.actFace = this.facing; this.actMove = 2.4; if (Math.random() < 0.5) fx.emit(this.pos, { count: 2, color: '#a89878', speed: 2, life: 0.5, size: 0.6, up: 1 }); if (!this.fired && d < this.radius + 1.6) { this.fired = 1; this.mgr.hurtHero(this.cfg.dmg * 0.8, this.pos); } }
        else this.actMove = 0;
        if (t > 2.0) end(1.0); break;
      case 'leap': {
        const n = this.norm();
        if (n < 0.5) { this.actFace = Math.atan2(hero.pos.x - this.pos.x, hero.pos.z - this.pos.z); this.actMove = Math.min(2.5, d / 3); }
        else this.actMove = 0;
        if (!this.fired && n > 0.52) { this.fired = 1; fx.ring(this.pos, { color: '#ffd27a', r0: 1, r1: 9, dur: 0.6 }); fx.emit(this.pos, { count: 60, color: '#d8ccb0', speed: 10, life: 0.9, size: 0.8, up: 3, gravity: 10 }); this.mgr.sound('slam'); this.mgr.shake(0.8); if (d < 7) this.mgr.hurtHero(this.cfg.dmg, this.pos); }
        if (n > 0.95) end(1.0); break;
      }
      case 'blink':
        if (t > 0.35 && !this.fired) {
          this.fired = 1; fx.emit(this.pos, { count: 40, color: '#ff6ad5', speed: 5, life: 0.7, size: 0.6, up: 1 });
          const a = Math.random() * 6.28, r = 9 + Math.random() * 5; const ar = this.opts.arena;
          this.pos.x = (ar ? ar.x : hero.pos.x) + Math.cos(a) * r; this.pos.z = (ar ? ar.z : hero.pos.z) + Math.sin(a) * r;
          fx.emit(this.pos, { count: 40, color: '#ff6ad5', speed: 5, life: 0.7, size: 0.6, up: 1 }); this.mgr.sound('blink');
        }
        if (t > 0.8) end(0.5); break;
    }
  }
}

export class Enemies {
  constructor(scene, fx, hooks) { this.scene = scene; this.fx = fx; this.hooks = hooks; this.list = []; this.bossActive = null; this.bolts = []; }
  async spawn(type, pos, opts = {}) { const e = await new Enemy(this, type, pos, opts).init(); this.list.push(e); return e; }
  onDeath(e) { this.hooks.onDeath(e); }
  onAggro(e) { this.hooks.onAggro?.(e); }
  onBlock(e) { this.hooks.sound('block'); this.fx.emit(new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z), { count: 14, color: '#ffe0a0', speed: 6, life: 0.3, size: 0.3 }); }
  hurtHero(d, from) { this.hooks.hurtHero(d, from); }
  sound(n) { this.hooks.sound(n); }
  shake(a) { this.hooks.shake(a); }
  async summon(boss, type, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28; const p = new THREE.Vector3(boss.pos.x + Math.cos(a) * 6, 0, boss.pos.z + Math.sin(a) * 6);
      p.y = this.hooks.ground(p.x, p.z);
      const e = await this.spawn(type, p, { rise: true, alert: true, arena: boss.opts.arena, summoned: true });
      this.fx.emit(p, { count: 30, color: '#9a4cff', speed: 4, life: 0.8, size: 0.7, up: 2 });
    }
  }
  shootAt(e, hero, color, scale, dmg, spread = 0, speed = 16) {
    const o = new THREE.Vector3(e.pos.x + Math.sin(e.facing) * 0.8, e.pos.y + e.height * 0.62, e.pos.z + Math.cos(e.facing) * 0.8);
    const dir = new THREE.Vector3(hero.pos.x, hero.pos.y + 1.1, hero.pos.z).sub(o).normalize(); dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    this.fx.bolt(o, dir, { color, scale, speed, life: 3.2, hostile: true, dmg }); this.sound('eshoot');
  }
  shootDir(e, dir, color, scale, dmg, speed) { const o = new THREE.Vector3(e.pos.x, e.pos.y + 1.6, e.pos.z); this.fx.bolt(o, dir, { color, scale, speed, life: 3, hostile: true, dmg }); }
  update(dt, hero, world, cam) {
    for (let i = this.list.length - 1; i >= 0; i--) { const e = this.list[i]; if (!e.update(dt, hero, world, cam)) { this.scene.remove(e.root); this.list.splice(i, 1); } }
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, m = a.radius + b.radius; if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
      const d = Math.hypot(dx, dz); if (d < m && d > 1e-3) { const p = (m - d) / 2; a.pos.x -= dx / d * p; a.pos.z -= dz / d * p; b.pos.x += dx / d * p; b.pos.z += dz / d * p; }
    }
  }
  hitArc(origin, facing, range, cosHalf, dmg, kb, heavy) {
    const hits = [], fx = Math.sin(facing), fz = Math.cos(facing);
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius || Math.abs(e.pos.y - origin.y) > 3 + e.height * 0.5) continue;
      if (d > e.radius + 0.4 && cosHalf > -1 && (dx * fx + dz * fz) / d < cosHalf) continue;
      if (e.hit(dmg, origin, kb, heavy)) hits.push(e);
    }
    return hits;
  }
  nearest(p, maxD, facing, cosHalf = -1) {
    let best = null, bd = maxD; const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const e of this.list) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < bd && (d < 1.5 || (dx * fx + dz * fz) / d >= cosHalf)) { bd = d; best = e; }
    }
    return best;
  }
  aliveCount(filter) { let n = 0; for (const e of this.list) if (e.alive && (!filter || filter(e))) n++; return n; }
  clear() { for (const e of this.list) this.scene.remove(e.root); this.list = []; this.bossActive = null; }
}
