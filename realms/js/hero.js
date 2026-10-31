import * as THREE from 'three';
import * as A from './assets.js';

export function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)); if (d < 0) d += Math.PI * 2; return a + (d - Math.PI) * t; }

const COMBO = [
  { clip: '1H_Melee_Attack_Slice_Diagonal', speed: 1.45, hit: 0.38, end: 0.72, dmg: 22, range: 3.1, arc: 0.25, kb: 5 },
  { clip: '1H_Melee_Attack_Slice_Horizontal', speed: 1.5, hit: 0.36, end: 0.7, dmg: 24, range: 3.2, arc: 0.1, kb: 5 },
  { clip: '1H_Melee_Attack_Chop', speed: 1.3, hit: 0.42, end: 0.78, dmg: 40, range: 3.4, arc: 0.35, kb: 11, heavy: true },
];
const SPIN = { clip: '2H_Melee_Attack_Spin', speed: 1.35, hit: 0.3, hit2: 0.55, end: 0.85, dmg: 34, range: 4.4, arc: -1, kb: 12 };

export class Hero {
  async init(scene) {
    const c = this.char = await A.character('Knight', { rim: '#a8c8ff', rimStr: 0.28 });
    this.root = new THREE.Group(); this.root.add(c.root); scene.add(this.root);
    c.root.scale.setScalar(0.92);
    this.mixer = c.mixer; this.actions = {};
    for (const [k, clip] of Object.entries(c.clips)) this.actions[k] = this.mixer.clipAction(clip);
    for (const k of ['Jump_Start', 'Jump_Land', 'Dodge_Forward', 'Hit_A', 'Death_A', 'Cheer', 'Interact', 'Spellcast_Shoot', ...COMBO.map(x => x.clip), SPIN.clip]) { const a = this.actions[k]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
    this.cur = null; this.play('Idle', 0);
    // sword trail
    let sword = null; c.root.traverse(o => { if (o.name === '1H_Sword') sword = o; });
    this.sword = sword;
    const bb = new THREE.Box3().setFromBufferAttribute(sword.geometry.attributes.position);
    const size = bb.getSize(new THREE.Vector3()); const ax = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');
    const far = Math.abs(bb.max[ax]) > Math.abs(bb.min[ax]) ? bb.max[ax] : bb.min[ax];
    this.tipL = new THREE.Vector3(); this.tipL[ax] = far; this.baseL = new THREE.Vector3(); this.baseL[ax] = far * 0.3;
    const TN = this.TN = 18; this.trailPts = []; for (let i = 0; i < TN; i++) this.trailPts.push([new THREE.Vector3(), new THREE.Vector3()]);
    const tg = new THREE.BufferGeometry(); this.trailPos = new Float32Array(TN * 6); const ta = new Float32Array(TN * 2), tv = new Float32Array(TN * 2);
    for (let i = 0; i < TN; i++) { ta[i * 2] = ta[i * 2 + 1] = 1 - i / (TN - 1); tv[i * 2] = 0; tv[i * 2 + 1] = 1; }
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3)); tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1)); tg.setAttribute('aV', new THREE.BufferAttribute(tv, 1));
    const idx = []; for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } tg.setIndex(idx);
    this.trailU = { uOp: { value: 0 }, uCol: { value: new THREE.Color('#bfe6ff') } };
    this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      uniforms: this.trailU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aA, aV; varying float vA, vV; void main(){ vA = aA; vV = aV; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float uOp; uniform vec3 uCol; varying float vA, vV; void main(){ float e = smoothstep(0., 0.6, vV); gl_FragColor = vec4(uCol * pow(vA, 1.6) * e * uOp * 2.2, 1.); }`,
    }));
    this.trail.frustumCulled = false; scene.add(this.trail);
    // state
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.facing = 0; this.speed = 0;
    this.grounded = true; this.state = 'move'; this.stateT = 0; this.combo = 0; this.queued = false; this.struck = 0;
    this.maxHp = 100; this.hp = 100; this.maxMp = 100; this.mp = 100; this.energy = 0; this.dmgMul = 1;
    this.invuln = 0; this.dead = false; this.dodgeCD = 0; this.hurtFlash = 0; this.airT = 0;
    this._v = new THREE.Vector3(); this.lastSafe = new THREE.Vector3();
    return this;
  }
  get height() { return 2.1; }
  play(name, fade = 0.15, speed = 1) {
    const a = this.actions[name]; if (!a) return null;
    if (this.cur === a && a.isRunning() && a.loop !== THREE.LoopOnce) { a.timeScale = speed; return a; }
    a.reset(); a.timeScale = speed; a.setEffectiveWeight(1); a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
    this.cur = a; this.curName = name; return a;
  }
  norm() { const a = this.cur; return a ? a.time / a.getClip().duration : 0; }

  update(dt, inp, camYaw, world, aim) {
    const ev = [];
    this.invuln -= dt; this.dodgeCD -= dt; this.hurtFlash -= dt; this.stateT += dt;
    this.mp = Math.min(this.maxMp, this.mp + dt * 8);
    if (this.dead) { this.mixer.update(dt); return ev; }
    let mx = inp.mx, mz = inp.mz; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dx = -mx * cos + mz * sin, dz = mx * sin + mz * cos, amt = Math.min(1, Math.hypot(dx, dz));
    const wantDir = amt > 0.08 ? Math.atan2(dx, dz) : null;
    let vx = 0, vz = 0;
    const S = this.state;
    // ----- input → state transitions
    if (inp.dodge && this.dodgeCD <= 0 && this.grounded && S !== 'hit') {
      this.state = 'dodge'; this.stateT = 0; this.dodgeCD = 0.6; this.invuln = 0.42;
      if (wantDir !== null) this.facing = wantDir;
      this.play('Dodge_Forward', 0.06, 1.55); ev.push({ type: 'dodge' });
    } else if (inp.special && this.energy >= 100 && (S === 'move' || S === 'attack') && this.grounded) {
      this.energy = 0; this.state = 'spin'; this.stateT = 0; this.struck = 0; this.play(SPIN.clip, 0.08, SPIN.speed); ev.push({ type: 'special' });
    } else if (inp.attack) {
      if (S === 'move' && this.grounded) this.startAttack(0, aim);
      else if (S === 'attack') this.queued = true;
      else if (!this.grounded && S === 'move') this.startAttack(2, aim);
    } else if (inp.magic && S === 'move' && this.mp >= 22) {
      this.mp -= 22; this.state = 'cast'; this.stateT = 0; this.cast = false; if (aim) this.faceTo(aim.pos); this.play('Spellcast_Shoot', 0.08, 1.7);
    }
    if (inp.jump && this.grounded && (this.state === 'move')) { this.vel.y = 10.5; this.grounded = false; this.play('Jump_Start', 0.08, 1.4); this.airT = 0; ev.push({ type: 'jump' }); }

    // ----- state behaviour
    switch (this.state) {
      case 'move': {
        const speed = 7.6 * amt;
        if (wantDir !== null) { this.facing = lerpAngle(this.facing, wantDir, Math.min(1, dt * 12)); vx = Math.sin(this.facing) * speed; vz = Math.cos(this.facing) * speed; }
        if (this.grounded) {
          if (amt > 0.55) this.play('Running_A', 0.2, 0.75 + amt * 0.4);
          else if (amt > 0.08) this.play('Walking_A', 0.2, 0.8 + amt * 1.2);
          else this.play('Idle', 0.25);
        } else if (this.curName !== 'Jump_Start' || this.norm() > 0.95) this.play('Jump_Idle', 0.15);
        break;
      }
      case 'attack': {
        const C = COMBO[this.combo], n = this.norm();
        if (n < C.hit) { const lunge = 4.5 * (1 - n / C.hit); vx = Math.sin(this.facing) * lunge; vz = Math.cos(this.facing) * lunge; if (aim && n < 0.2) this.faceTo(aim.pos, 0.4); }
        if (!this.struck && n >= C.hit) { this.struck = 1; ev.push({ type: 'strike', ...C, combo: this.combo }); }
        if (n >= C.end) {
          if (this.queued && this.combo < 2) this.startAttack(this.combo + 1, aim);
          else if (n >= 0.97 || wantDir !== null) { this.state = 'move'; this.queued = false; this.combo = 0; }
        }
        break;
      }
      case 'spin': {
        const n = this.norm();
        if (wantDir !== null) { vx = Math.sin(wantDir) * 3; vz = Math.cos(wantDir) * 3; }
        if (this.struck === 0 && n >= SPIN.hit) { this.struck = 1; ev.push({ type: 'strike', ...SPIN, combo: 3 }); }
        if (this.struck === 1 && n >= SPIN.hit2) { this.struck = 2; ev.push({ type: 'strike', ...SPIN, combo: 3 }); }
        if (n >= SPIN.end) this.state = 'move';
        break;
      }
      case 'cast': {
        const n = this.norm();
        if (!this.cast && n > 0.38) { this.cast = true; ev.push({ type: 'cast' }); }
        if (n > 0.8) this.state = 'move';
        break;
      }
      case 'dodge': {
        const k = Math.max(0, 1 - this.stateT / 0.5);
        vx = Math.sin(this.facing) * 15 * k; vz = Math.cos(this.facing) * 15 * k;
        if (this.stateT > 0.5) this.state = 'move';
        break;
      }
      case 'hit': if (this.stateT > 0.38) this.state = 'move'; break;
      case 'interact': if (this.stateT > 0.9) this.state = 'move'; break;
      case 'cheer': break;
    }
    // ----- integrate
    const np = this._v.set(this.pos.x + vx * dt, this.pos.y, this.pos.z + vz * dt);
    world.resolve(np, 0.5);
    const gNew = world.groundAt(np.x, np.z, this.pos.y), gOld = world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const blocked = (gNew - this.pos.y > 1.2) || !world.inBounds(np.x, np.z) || (world.blockLiquid && world.liquidAt(np.x, np.z, gNew));
    if (!blocked) { this.pos.x = np.x; this.pos.z = np.z; }
    this.vel.y -= 28 * dt; this.pos.y += this.vel.y * dt;
    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
    if (this.pos.y <= ground) {
      if (!this.grounded) { ev.push({ type: 'land', hard: this.vel.y < -14 }); if (this.state === 'move') this.play('Jump_Land', 0.05, 1.6); this.landT = 0.15; }
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
      if (!world.liquidAt(this.pos.x, this.pos.z, ground)) this.lastSafe.copy(this.pos);
    } else if (this.pos.y > ground + 0.25) { this.grounded = false; this.airT += dt; }
    else if (this.vel.y <= 0) { this.pos.y = ground; this.vel.y = 0; this.grounded = true; }
    if (this.landT > 0) { this.landT -= dt; }
    if (this.pos.y < world.killY) ev.push({ type: 'fall' });
    this.speed = Math.hypot(vx, vz);
    this.root.rotation.y = this.facing;
    this.mixer.update(dt);
    this.updateTrail(dt);
    const f = Math.max(0, this.hurtFlash) * 3;
    for (const m of this.char.mats) m.userData.flash.value = f > 0 ? 0.6 * f : 0;
    return ev;
  }
  startAttack(i, aim) {
    this.state = 'attack'; this.stateT = 0; this.combo = i; this.struck = 0; this.queued = false;
    if (aim) this.faceTo(aim.pos);
    this.play(COMBO[i].clip, 0.07, COMBO[i].speed);
  }
  faceTo(p, k = 1) { this.facing = lerpAngle(this.facing, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), k); }
  damage(n, from) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= n; this.hurtFlash = 0.18; this.invuln = 0.5;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.state = 'dead'; this.play('Death_A', 0.1); return true; }
    if (this.state === 'move' || this.state === 'cast' || (this.state === 'attack' && n >= 15)) { this.state = 'hit'; this.stateT = 0; this.play('Hit_A', 0.05, 1.4); }
    return true;
  }
  revive() { this.dead = false; this.hp = this.maxHp; this.mp = this.maxMp; this.state = 'move'; this.play('Idle', 0.1); }
  cheer() { this.state = 'cheer'; this.play('Cheer', 0.2); }
  interact() { this.state = 'interact'; this.stateT = 0; this.play('Interact', 0.1, 1.3); }
  updateTrail(dt) {
    this.root.updateMatrixWorld(true);
    const pts = this.trailPts, last = pts.pop(); pts.unshift(last);
    this.sword.localToWorld(last[0].copy(this.baseL)); this.sword.localToWorld(last[1].copy(this.tipL));
    let on = false;
    if (this.state === 'attack') { const n = this.norm(), C = COMBO[this.combo]; on = n > C.hit - 0.18 && n < C.hit + 0.2; }
    if (this.state === 'spin') { const n = this.norm(); on = n > 0.15 && n < 0.75; }
    this.trailU.uOp.value += ((on ? 1 : 0) - this.trailU.uOp.value) * Math.min(1, dt * (on ? 40 : 9));
    if (!on && this.trailU.uOp.value < 0.02) for (let i = 0; i < this.TN; i++) { pts[i][0].copy(last[0]); pts[i][1].copy(last[1]); }
    for (let i = 0; i < this.TN; i++) { pts[i][0].toArray(this.trailPos, i * 6); pts[i][1].toArray(this.trailPos, i * 6 + 3); }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
  tipWorld(v) { return this.sword.localToWorld(v.copy(this.tipL)); }
  handWorld(v) { const b = this.char.bones['handslot.l'] || this.sword; return b.getWorldPosition(v); }
}

// companion fairy (Liora)
export class Fairy {
  constructor(scene) {
    this.g = new THREE.Group(); scene.add(this.g);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#ffe7a0', emissiveIntensity: 8 }));
    this.g.add(core);
    const wm = new THREE.MeshBasicMaterial({ color: '#cff6ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const wg = new THREE.CircleGeometry(0.3, 16); wg.scale(1, 0.5, 1); wg.translate(0.28, 0.06, 0);
    const wg2 = new THREE.CircleGeometry(0.22, 16); wg2.scale(1, 0.45, 1); wg2.translate(0.2, -0.1, 0);
    this.wings = [];
    for (const s of [-1, 1]) for (const geo of [wg, wg2]) { const w = new THREE.Mesh(geo, wm); w.scale.x = s; this.g.add(w); this.wings.push([w, s]); }
    this.light = new THREE.PointLight('#ffe3a0', 6, 7, 2); this.g.add(this.light);
    this.pos = this.g.position; this.t = 0;
  }
  update(dt, target, facing, fx) {
    this.t += dt;
    const a = facing + 0.85, tx = target.x + Math.sin(a) * 1.3 + Math.sin(this.t * 1.3) * 0.25, ty = target.y + 2.5 + Math.sin(this.t * 2.2) * 0.2, tz = target.z + Math.cos(a) * 1.3 + Math.cos(this.t * 1.1) * 0.25;
    const k = Math.min(1, dt * 3);
    this.pos.x += (tx - this.pos.x) * k; this.pos.y += (ty - this.pos.y) * k; this.pos.z += (tz - this.pos.z) * k;
    this.g.rotation.y = facing;
    const f = Math.sin(this.t * 34) * 0.8; for (const [w, s] of this.wings) w.rotation.y = f * s;
    if (Math.random() < dt * 18) fx.emit(this.pos, { count: 1, color: '#ffe7a0', speed: 0.25, life: 1.0, size: 0.22, gravity: 0.5 });
  }
}
