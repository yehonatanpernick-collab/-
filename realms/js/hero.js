import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, flatShading: false, ...o });
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

function limb(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(0, -len / 2 - r * 0.3, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

export class Hero {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.body = new THREE.Group(); this.root.add(this.body);
    const armor = std('#c8d2e0', { metalness: 0.35, roughness: 0.4 }), cloth = std('#2b5aa6', { roughness: 0.8 }), skin = std('#f1c6a3', { roughness: 0.7 });
    const gold = std('#e8b84a', { metalness: 0.4, roughness: 0.35 }), dark = std('#3a2b25', { roughness: 0.8 }), hair = std('#7a4420', { roughness: 0.9 });
    this.mats = [armor, cloth, skin, gold, dark, hair];
    const add = (geo, mat, parent = this.body, p = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.castShadow = true; parent.add(m); return m; };
    // torso
    this.torso = new THREE.Group(); this.torso.position.y = 1.05; this.body.add(this.torso);
    add(new THREE.CapsuleGeometry(0.34, 0.42, 4, 12), armor, this.torso, [0, 0.3, 0]).scale.set(1, 1, 0.75);
    add(new THREE.CylinderGeometry(0.36, 0.42, 0.42, 12), cloth, this.torso, [0, -0.08, 0]).scale.set(1, 1, 0.8);
    add(new THREE.TorusGeometry(0.36, 0.05, 6, 20), gold, this.torso, [0, 0.08, 0]).rotation.x = Math.PI / 2;
    add(new THREE.OctahedronGeometry(0.11), std('#5ff0ff', { emissive: '#5ff0ff', emissiveIntensity: 2 }), this.torso, [0, 0.45, 0.27]);
    for (const s of [-1, 1]) { const sp = add(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, this.torso, [s * 0.4, 0.66, 0]); sp.scale.set(1, 0.8, 1); }
    // head
    this.head = new THREE.Group(); this.head.position.set(0, 0.95, 0); this.torso.add(this.head);
    add(new THREE.SphereGeometry(0.27, 16, 12), skin, this.head, [0, 0.12, 0]);
    const hr = add(new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, this.head, [0, 0.16, -0.03]); hr.rotation.x = -0.3;
    add(new THREE.SphereGeometry(0.16, 10, 8), hair, this.head, [0, 0.0, -0.22]).scale.set(1.3, 1.4, 0.8);
    add(new THREE.TorusGeometry(0.28, 0.025, 6, 24), gold, this.head, [0, 0.22, 0]).rotation.x = Math.PI / 2 - 0.25;
    const eyeM = std('#1a2440'); for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 8, 6), eyeM, this.head, [s * 0.09, 0.13, 0.245]);
    // cape
    const cg = new THREE.PlaneGeometry(0.8, 1.25, 4, 8); cg.translate(0, -0.62, 0);
    this.capeGeo = cg; this.capeBase = cg.attributes.position.array.slice();
    this.cape = add(cg, std('#b0283a', { side: THREE.DoubleSide, roughness: 0.85 }), this.torso, [0, 0.72, -0.3]);
    // arms
    this.armL = new THREE.Group(); this.armL.position.set(0.45, 0.6, 0); this.torso.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(-0.45, 0.6, 0); this.torso.add(this.armR);
    for (const a of [this.armL, this.armR]) { a.add(limb(0.1, 0.5, armor)); const h = add(new THREE.SphereGeometry(0.1, 10, 8), dark, a, [0, -0.72, 0]); }
    // sword in right hand
    this.sword = new THREE.Group(); this.sword.position.set(0, -0.72, 0.02); this.armR.add(this.sword);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), dark, this.sword, [0, 0, 0]).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.4, 0.06, 0.08), gold, this.sword, [0, 0, 0.17]);
    const blade = new THREE.BoxGeometry(0.08, 0.02, 1.15); blade.translate(0, 0, 0.78);
    this.blade = add(blade, std('#dff4ff', { metalness: 0.5, roughness: 0.2, emissive: '#6fd8ff', emissiveIntensity: 0.55 }), this.sword);
    add(new THREE.SphereGeometry(0.05, 8, 6), gold, this.sword, [0, 0, -0.17]);
    this.tipLocal = new THREE.Vector3(0, 0, 1.35); this.baseLocal = new THREE.Vector3(0, 0, 0.35);
    // legs
    this.legL = new THREE.Group(); this.legL.position.set(-0.17, 0.92, 0); this.body.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.17, 0.92, 0); this.body.add(this.legR);
    for (const l of [this.legL, this.legR]) { l.add(limb(0.13, 0.5, cloth)); add(new THREE.BoxGeometry(0.24, 0.2, 0.36), dark, l, [0, -0.82, 0.05]); }
    // magic hand glow
    this.handGlow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.handGlow.position.set(0, -0.75, 0); this.armL.add(this.handGlow);
    // sword trail
    const TN = this.TN = 14;
    this.trailPts = []; for (let i = 0; i < TN; i++) this.trailPts.push([new THREE.Vector3(), new THREE.Vector3()]);
    const tg = new THREE.BufferGeometry(); this.trailPos = new Float32Array(TN * 2 * 3); const ta = new Float32Array(TN * 2);
    for (let i = 0; i < TN; i++) { ta[i * 2] = ta[i * 2 + 1] = 1 - i / (TN - 1); }
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3)); tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1));
    const idx = []; for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } tg.setIndex(idx);
    this.trailU = { uOp: { value: 0 }, uCol: { value: new THREE.Color('#8fe6ff') } };
    this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms: this.trailU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uOp; uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol*vA*vA*uOp*1.5, 1.); }` }));
    this.trail.frustumCulled = false; scene.add(this.trail);

    // state
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.facing = 0;
    this.grounded = true; this.phase = 0; this.speed = 0;
    this.attackT = -1; this.combo = 0; this.comboWindow = 0; this.queued = false; this.struck = false;
    this.castT = -1; this.dashT = -1; this.dashCD = 0; this.hurtT = 0; this.invuln = 0;
    this.maxHp = 100; this.hp = 100; this.maxMp = 100; this.mp = 100; this.dmgMul = 1;
    this.dead = false; this.time = 0;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }

  get height() { return 2.2; }

  update(dt, inp, camYaw, world, aimTarget) {
    const ev = []; this.time += dt;
    if (this.dead) { this.animate(dt, 0); return ev; }
    // movement input relative to camera
    let mx = inp.mx, mz = inp.mz; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dx = -mx * cos + mz * sin, dz = mx * sin + mz * cos;
    const busy = this.attackT >= 0 || this.castT >= 0;
    const amt = Math.min(1, Math.hypot(dx, dz));
    let speed = 8.5 * amt * (busy ? 0.35 : 1);
    if (amt > 0.05 && this.dashT < 0) { const target = Math.atan2(dx, dz); if (!busy || !aimTarget) this.facing = lerpAngle(this.facing, target, Math.min(1, dt * 14)); }
    // timers
    this.dashCD -= dt; this.invuln -= dt; this.hurtT -= dt; this.comboWindow -= dt;
    this.mp = Math.min(this.maxMp, this.mp + dt * 7);
    // actions
    if (inp.dash && this.dashCD <= 0 && this.grounded !== null) {
      this.dashT = 0; this.dashCD = 0.75; this.invuln = 0.35; this.attackT = -1; this.castT = -1;
      if (amt > 0.05) this.facing = Math.atan2(dx, dz);
      ev.push({ type: 'dash' });
    }
    if (inp.attack) {
      if (this.attackT < 0 && this.dashT < 0) this.startAttack(aimTarget);
      else if (this.attackT > 0.35) this.queued = true;
    }
    if (inp.magic && this.castT < 0 && this.attackT < 0 && this.mp >= 20) { this.castT = 0; this.mp -= 20; if (aimTarget) this.faceTo(aimTarget.pos); this.castFired = false; }
    if (inp.jump && this.grounded) { this.vel.y = 11; this.grounded = false; ev.push({ type: 'jump' }); }

    let vx = Math.sin(this.facing) * 0, vz = 0;
    if (this.dashT >= 0) {
      this.dashT += dt; const k = 1 - this.dashT / 0.28;
      vx = Math.sin(this.facing) * 30 * Math.max(0, k); vz = Math.cos(this.facing) * 30 * Math.max(0, k);
      if (this.dashT > 0.28) this.dashT = -1;
    } else if (amt > 0.05) { vx = dx / Math.max(amt, 1e-3) * speed; vz = dz / Math.max(amt, 1e-3) * speed; }
    if (this.attackT >= 0) {
      const lunge = this.attackT < 0.25 ? 5 : 0; vx += Math.sin(this.facing) * lunge; vz += Math.cos(this.facing) * lunge;
      this.attackT += dt / (this.combo === 2 ? 0.5 : 0.38);
      if (!this.struck && this.attackT > 0.42) { this.struck = true; ev.push({ type: 'strike', combo: this.combo }); }
      if (this.attackT >= 1) {
        this.attackT = -1; this.comboWindow = 0.35;
        if (this.queued) { this.combo = (this.combo + 1) % 3; this.queued = false; this.startAttack(aimTarget, true); }
        else this.combo = 0;
      }
    }
    if (this.castT >= 0) {
      this.castT += dt / 0.45;
      if (!this.castFired && this.castT > 0.4) { this.castFired = true; ev.push({ type: 'cast' }); }
      if (this.castT >= 1) this.castT = -1;
    }
    // integrate
    const np = this._v.set(this.pos.x + vx * dt, this.pos.y, this.pos.z + vz * dt);
    world.resolve(np, 0.45);
    const gh = world.groundAt(np.x, np.z);
    const r = Math.hypot(np.x, np.z);
    if (gh > -0.6 && r < 262 && !(gh - this.pos.y > 2.5 && this.grounded && gh - world.groundAt(this.pos.x, this.pos.z) > 1.6)) { this.pos.x = np.x; this.pos.z = np.z; }
    if (world.barrier.visible && !world.barrierOpen) {
      const bx = this.pos.x - world.arena.x, bz = this.pos.z - world.arena.z, bd = Math.hypot(bx, bz);
      if (bd < 30.5) { this.pos.x = world.arena.x + bx / bd * 30.5; this.pos.z = world.arena.z + bz / bd * 30.5; ev.push({ type: 'barrier' }); }
    }
    const ground = world.groundAt(this.pos.x, this.pos.z);
    this.vel.y -= 30 * dt; this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vel.y < -12) ev.push({ type: 'land' });
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else if (this.pos.y > ground + 0.35) this.grounded = false;
    else if (this.vel.y <= 0) { this.pos.y = ground; this.vel.y = 0; this.grounded = true; }
    this.speed = Math.hypot(vx, vz);
    this.root.rotation.y = this.facing;
    this.animate(dt, this.speed);
    return ev;
  }

  faceTo(p) { this.facing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  startAttack(aim, chained) {
    if (!chained && this.comboWindow > 0) this.combo = (this.combo + 1) % 3; else if (!chained) this.combo = 0;
    this.attackT = 0; this.struck = false; this.queued = false;
    if (aim) this.faceTo(aim.pos);
  }

  damage(n) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= n; this.hurtT = 0.25; this.invuln = 0.6;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return true;
  }

  animate(dt, speed) {
    const t = this.time;
    const run = Math.min(1, speed / 8.5);
    this.phase += dt * (4 + speed * 1.05);
    const s = Math.sin(this.phase);
    const B = this.body, T = this.torso;
    if (this.dead) { B.rotation.x += (-1.45 - B.rotation.x) * Math.min(1, dt * 6); B.position.y += (0.3 - B.position.y) * Math.min(1, dt * 6); return; }
    B.rotation.x = 0; B.rotation.z = 0;
    // legs
    let lL = s * 0.9 * run, lR = -s * 0.9 * run;
    if (!this.grounded) { lL = -0.6; lR = 0.4; }
    this.legL.rotation.x = lL; this.legR.rotation.x = lR;
    B.position.y = this.grounded ? Math.abs(Math.cos(this.phase)) * 0.12 * run + Math.sin(t * 2) * 0.01 : 0;
    T.rotation.set(run * 0.12, 0, 0);
    // arms default
    let aLx = -s * 0.7 * run, aLz = 0.12, aRx = s * 0.5 * run - 0.25, aRy = 0, aRz = -0.15;
    let swordX = 0.0, swordY = 0, swordZ = 0;
    // idle: sword held forward-down
    swordX = -1.1 + run * 0.4;
    if (this.attackT >= 0) {
      const k = this.attackT;
      const wind = Math.min(1, k / 0.35), strike = ease(Math.min(1, Math.max(0, (k - 0.3) / 0.25)));
      if (this.combo === 0) { aRx = -1.4; aRz = -0.2; aRy = 0; T.rotation.y = 0.9 * wind - 1.8 * strike; aRz = -1.2 * wind + 2.2 * strike - 0.2; swordX = 0.1; }
      else if (this.combo === 1) { aRx = -1.3; T.rotation.y = -0.8 * wind + 1.7 * strike; aRz = 1.3 * wind - 2.4 * strike; swordX = 0.1; }
      else { aRx = -2.8 * wind + 2.9 * strike; aRz = -0.1; T.rotation.x = -0.25 * wind + 0.55 * strike; swordX = 0.2; }
      const rec = Math.max(0, (k - 0.7) / 0.3); aRx *= 1 - rec * 0.6;
      aLx = -0.4; aLz = 0.4;
    }
    if (this.castT >= 0) { const k = Math.sin(Math.min(1, this.castT) * Math.PI); aLx = -1.6 * k; aLz = -0.2 * k; T.rotation.y = 0.3 * k; this.handGlow.material.opacity = k; this.handGlow.scale.setScalar(1 + k); }
    else this.handGlow.material.opacity *= 0.8;
    if (this.dashT >= 0) { T.rotation.x = 0.5; aLx = 1; aRx = 1; this.legL.rotation.x = -0.9; this.legR.rotation.x = 0.7; }
    this.armL.rotation.set(aLx, 0, aLz);
    this.armR.rotation.set(aRx, aRy, aRz);
    this.sword.rotation.set(swordX, swordY, swordZ);
    this.head.rotation.y = -T.rotation.y * 0.5;
    // cape physics-ish
    const pa = this.capeGeo.attributes.position, b = this.capeBase;
    const flow = 0.2 + run * 1.1 + (this.grounded ? 0 : 0.5) + (this.dashT >= 0 ? 1.2 : 0);
    for (let i = 0; i < pa.count; i++) {
      const y = b[i * 3 + 1], x = b[i * 3], k = Math.max(0, -y / 1.25);
      pa.setZ(i, b[i * 3 + 2] - Math.pow(k, 1.4) * flow * 0.55 + Math.sin(t * 9 + k * 4 + x * 2) * 0.04 * k * (0.4 + run));
      pa.setY(i, y + Math.pow(k, 2) * flow * 0.18);
    }
    pa.needsUpdate = true; this.capeGeo.computeVertexNormals();
    // hurt flash
    const f = this.hurtT > 0 ? 1 : 0;
    for (const m of this.mats) m.emissive.setRGB(f * 0.8, f * 0.1, f * 0.1);
    // sword trail
    this.root.updateMatrixWorld(true);
    const pts = this.trailPts; const last = pts.pop(); pts.unshift(last);
    this.blade.localToWorld(last[0].copy(this.baseLocal).setZ(0.4));
    this.blade.localToWorld(last[1].copy(this.tipLocal));
    const on = this.attackT >= 0 && this.attackT > 0.25 && this.attackT < 0.85;
    this.trailU.uOp.value += ((on ? 1 : 0) - this.trailU.uOp.value) * Math.min(1, dt * (on ? 30 : 10));
    for (let i = 0; i < this.TN; i++) { pts[i][0].toArray(this.trailPos, i * 6); pts[i][1].toArray(this.trailPos, i * 6 + 3); }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
  tipWorld(v) { return this.blade.localToWorld(v.copy(this.tipLocal)); }
  handWorld(v) { return this.handGlow.getWorldPosition(v); }
}

export function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)); if (d < 0) d += Math.PI * 2; return a + (d - Math.PI) * t; }

// companion fairy
export class Fairy {
  constructor(scene) {
    this.g = new THREE.Group(); scene.add(this.g);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#ffe7a0', emissiveIntensity: 4 }));
    this.g.add(core);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.g.add(halo);
    const wm = new THREE.MeshBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const wg = new THREE.CircleGeometry(0.32, 12); wg.scale(1, 0.55, 1); wg.translate(0.3, 0.05, 0);
    this.wings = [];
    for (const s of [-1, 1]) { const w = new THREE.Mesh(wg, wm); w.scale.x = s; this.g.add(w); this.wings.push(w); }
    this.pos = this.g.position; this.t = 0;
  }
  update(dt, target, facing, fx) {
    this.t += dt;
    const ox = Math.sin(facing + 0.9) * 1.2, oz = Math.cos(facing + 0.9) * 1.2;
    const tx = target.x + ox + Math.sin(this.t * 1.3) * 0.3, ty = target.y + 2.6 + Math.sin(this.t * 2.2) * 0.25, tz = target.z + oz + Math.cos(this.t * 1.1) * 0.3;
    const k = Math.min(1, dt * 3);
    this.pos.x += (tx - this.pos.x) * k; this.pos.y += (ty - this.pos.y) * k; this.pos.z += (tz - this.pos.z) * k;
    this.g.rotation.y = facing;
    const f = Math.sin(this.t * 30) * 0.7; this.wings[0].rotation.y = f; this.wings[1].rotation.y = -f;
    if (Math.random() < dt * 20) fx.emit(this.pos, { count: 1, color: '#ffe7a0', speed: 0.3, life: 0.9, size: 0.3, gravity: 0.6 });
  }
}
