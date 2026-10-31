
// =====================================================================
// Enemies
// =====================================================================
const enemies = [];
const _t1 = new V3(), _t2 = new V3();
const PLAZA_TOP = 0.36;
function groundAt(x, z) { const h = heightAt(x, z); return Math.hypot(x, z) < 10.8 ? Math.max(h, PLAZA_TOP) : h; }
function resolveCollisions(pos, rad) {
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z, m = c.r + rad;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const d = Math.hypot(dx, dz); if (d < m && d > 1e-4) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; }
  }
  const r = Math.hypot(pos.x, pos.z); if (r > WORLD_R) { pos.x *= WORLD_R / r; pos.z *= WORLD_R / r; }
}

class Enemy {
  constructor(x, z) {
    this.g = new THREE.Group(); this.g.position.set(x, groundAt(x, z), z); scene.add(this.g);
    this.state = 'idle'; this.t = 0; this.cd = R(0.6, 1.4); this.kb = new V3(); this.flash = 0; this.dead = false; this.aggro = false;
    this.wander = rand() * TAU; this.hitDone = false; this.radius = 0.5; this.knock = 6; enemies.push(this);
  }
  get pos() { return this.g.position; }
  finish() { this.mats = collectMats(this.g); this.baseEm = this.mats.map(m => m.emissive.clone()); }
  setFlash() { const f = Math.max(0, this.flash / 0.16); this.mats.forEach((m, i) => m.emissive.copy(this.baseEm[i]).lerp(_white, f * 0.85)); }
  hit(dmg, dir) {
    if (this.dead || this.invuln) return false;
    this.hp -= dmg; this.flash = 0.16; this.kb.addScaledVector(dir, this.knock); this.aggro = true;
    if (this.hp <= 0) this.die(dir); else this.onHurt();
    return true;
  }
  onHurt() {}
  face(target, rate, dt) { this.g.rotation.y += angDiff(this.g.rotation.y, target) * (1 - Math.exp(-rate * dt)); }
  steer(dir, speed, dt) {
    for (const o of enemies) { if (o === this || o.dead) continue; const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, dd = Math.hypot(dx, dz), m = this.radius + o.radius;
      if (dd < m && dd > 0.01) { this.pos.x += dx / dd * (m - dd) * 0.5; this.pos.z += dz / dd * (m - dd) * 0.5; } }
    this.pos.x += (dir.x * speed + this.kb.x) * dt; this.pos.z += (dir.z * speed + this.kb.z) * dt;
    this.kb.multiplyScalar(Math.exp(-7 * dt));
  }
  remove() { const i = enemies.indexOf(this); if (i >= 0) enemies.splice(i, 1); }
}
const _white = new THREE.Color(1, 0.95, 0.85);
const _rust = rustMat;

// ---------------------------------------------------------------------
// Hollow — a risen skeleton soldier
// ---------------------------------------------------------------------
class Hollow extends Enemy {
  constructor(x, z, rising = true) {
    super(x, z);
    const bm = addRim(boneMat.clone(), 0.16, 0.17, 0.2); bm.color.setHex([0xa39478, 0x8d816b, 0xb0a084][RI(0, 2)]);
    this.sk = makeSkeleton(bm, new THREE.Color(4, 0.7, 0.15)); this.g.add(this.sk.root);
    const rm = ragMat.clone(); rm.color.setHex([0x2a2520, 0x3a2a22, 0x22201e][RI(0, 2)]);
    for (const sd of [1, -1]) { const p = addMesh(this.sk.hips, new THREE.PlaneGeometry(0.34, 0.55, 1, 4).translate(0, -0.27, 0), rm, 0, 0.03, sd * 0.11); if (sd < 0) p.rotation.y = Math.PI; }
    const sr = addMesh(this.sk.chest, new THREE.PlaneGeometry(0.5, 0.5).translate(0, -0.22, 0), rm, 0.05, 0.47, -0.05); sr.rotation.set(0.15, 0.3, 0.35);
    const rustMat = this.rust = _rust.clone();
    if (rand() < 0.5) { const helm = addMesh(this.sk.skull.g, new THREE.SphereGeometry(0.155, 14, 10, 0, TAU, 0, Math.PI * 0.5), rustMat, 0, 0.04, -0.01); helm.scale.set(1, 0.9, 1.15); }
    if (rand() < 0.6) {
      const w = new THREE.Group(); w.position.y = -0.06; this.sk.arms[1].hand.g.add(w);
      addMesh(w, new THREE.BoxGeometry(0.055, 0.8, 0.012), rustMat, 0, -0.5, 0);
      addMesh(w, new THREE.BoxGeometry(0.18, 0.03, 0.04), rustMat, 0, -0.09, 0);
      addMesh(w, new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6), rustMat, 0, 0, 0);
      w.rotation.x = -1.2; this.armed = true;
    }
    bake(this.g); this.finish();
    this.hp = this.maxHp = 3; this.radius = 0.42; this.knock = 7.5; this.speed = R(3.4, 4.3);
    this.state = rising ? 'rise' : 'idle'; if (rising) { this.sk.root.position.y = -1.9; this.invuln = true; }
    this.phase = rand() * TAU; this.twitch = 0; this.eye = this.sk.skull.eyeMat;
  }
  onHurt() { if (this.state !== 'strike') { this.state = 'stagger'; this.t = 0; } AudioFX.bone(); }
  die(dir) {
    this.dead = true; this.remove(); AudioFX.bone(true);
    const p = this.pos.clone().add(new V3(0, 1, 0));
    for (let i = 0; i < 26; i++) fxDark.spawn(p.x + R(-.4, .4), p.y + R(-.6, .6), p.z + R(-.4, .4), R(-1.5, 1.5), R(0, 2), R(-1.5, 1.5), R(0.8, 1.6), R(0.25, 0.5), [0.32, 0.29, 0.25], [0.12, 0.11, 0.1], { s1: 1.0, drag: 1.5, a: 0.6 });
    shatter(this.g, this.pos.clone().sub(dir), 5);
    onEnemyKilled(this, p);
  }
  update(dt, time) {
    const sk = this.sk; this.t += dt; this.cd -= dt; this.flash -= dt; this.setFlash();
    _t1.subVectors(P.position, this.pos).setY(0); const d = _t1.length(); const dir = _t1.normalize().clone();
    const faceP = Math.atan2(dir.x, dir.z);
    let speed = 0, mv = dir;
    const alive = state === 'play' && player.hp > 0;
    switch (this.state) {
      case 'rise': {
        const k = easeOut(this.t / 1.5); sk.root.position.y = lerp(-1.9, 0, k);
        if (rand() < 0.5) fxDark.spawn(this.pos.x + R(-.6, .6), this.pos.y + 0.1, this.pos.z + R(-.6, .6), R(-.5, .5), R(0.5, 1.5), R(-.5, .5), R(0.8, 1.4), R(0.3, 0.6), [0.16, 0.14, 0.12], [0.08, 0.07, 0.06], { s1: 1.2, a: 0.7 });
        this.face(faceP, 3, dt);
        if (this.t > 1.5) { this.state = 'chase'; this.aggro = true; this.invuln = false; }
        break;
      }
      case 'idle':
        this.wander += (rand() - 0.5) * dt * 2; mv = new V3(Math.sin(this.wander), 0, Math.cos(this.wander)); speed = 0.8;
        this.face(Math.atan2(mv.x, mv.z), 3, dt);
        if (alive && d < 26) { this.aggro = true; this.state = 'chase'; }
        break;
      case 'chase':
        if (!alive) { this.state = 'idle'; break; }
        speed = d > 1.6 ? this.speed : 0; this.face(faceP, 8, dt);
        if (d < 2.1 && this.cd <= 0) { this.state = 'wind'; this.t = 0; AudioFX.rattle(); }
        break;
      case 'wind': this.face(faceP, 10, dt); if (this.t > 0.42) { this.state = 'strike'; this.t = 0; this.hitDone = false; this.lunge = dir.clone(); } break;
      case 'strike':
        speed = 6.5 * (1 - this.t / 0.25); mv = this.lunge;
        if (!this.hitDone && this.t > 0.07) {
          this.hitDone = true;
          const fwd = _t2.set(Math.sin(this.g.rotation.y), 0, Math.cos(this.g.rotation.y));
          if (d < 2.0 && fwd.dot(dir) > 0.3) damagePlayer(this.armed ? 13 : 10, this.pos);
        }
        if (this.t > 0.25) { this.state = 'recover'; this.t = 0; }
        break;
      case 'recover': speed = 0.6; if (this.t > 0.65) { this.state = 'chase'; this.cd = R(0.7, 1.5); } break;
      case 'stagger': if (this.t > 0.35) { this.state = 'chase'; this.cd = Math.max(this.cd, 0.3); } break;
    }
    if (this.state !== 'rise') this.steer(mv, speed, dt);
    resolveCollisions(this.pos, this.radius);
    this.pos.y = damp(this.pos.y, groundAt(this.pos.x, this.pos.z), 20, dt);
    // ---- animation ----
    this.phase += speed * dt * 2.2;
    const k = Math.min(speed / 4, 1), ph = this.phase;
    sk.legs.forEach((L, i) => { const p = ph + (i ? Math.PI : 0); L.th.rotation.x = -Math.sin(p) * 0.7 * k - 0.15; L.kn.rotation.x = Math.max(0, Math.sin(p - 1.2)) * 1.1 * k + 0.25; });
    sk.chest.rotation.x = damp(sk.chest.rotation.x, 0.45 + (this.state === 'wind' ? -0.25 : 0) + (this.state === 'strike' ? 0.35 : 0) + (this.state === 'stagger' ? -0.4 : 0), 12, dt);
    sk.chest.rotation.y = Math.sin(ph) * 0.12 * k;
    sk.hips.position.y = 0.95 - 0.08 + Math.abs(Math.cos(ph)) * 0.04 * k;
    this.twitch -= dt; if (this.twitch < 0) { this.twitch = R(0.4, 2.5); this.tw = new V2(R(-.5, .5), R(-.4, .4)); }
    sk.neck.rotation.x = damp(sk.neck.rotation.x, -0.45 + (this.tw ? this.tw.y * 0.4 : 0), 18, dt);
    sk.neck.rotation.y = damp(sk.neck.rotation.y, this.tw ? this.tw.x : 0, 18, dt);
    sk.skull.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(time * 9 + ph)) * 0.25 + (this.state === 'wind' ? 0.4 : 0);
    sk.arms.forEach((A, i) => {
      let ax = Math.sin(ph + (i ? 0 : Math.PI)) * 0.5 * k - 0.2, el = -0.5, az = A.s * 0.15;
      if (this.state === 'wind') { ax = -2.5; el = -1.1; }
      if (this.state === 'strike') { ax = -1.3; el = -0.1; }
      if (this.state === 'rise') { ax = -2.8 + Math.sin(time * 6 + i) * 0.3; el = -0.4; }
      A.sh.rotation.x = damp(A.sh.rotation.x, ax, 16, dt); A.el.rotation.x = damp(A.el.rotation.x, el, 16, dt); A.sh.rotation.z = az;
      A.hand.fingers.forEach((f, j) => f.rotation.x = -0.3 - (this.state === 'wind' ? 0.6 : 0.2) * (j % 2 + 1) * 0.5);
    });
    const flare = this.state === 'wind' ? 2.2 : 1;
    this.eye.color.setRGB(4 * flare, 0.7 * flare, 0.15);
  }
}

// ---------------------------------------------------------------------
// Wraith — a hollow robe around a skull, trailing smoke
// ---------------------------------------------------------------------
const wraithAlpha = tatterAlpha(256, 256, 0.62, 40, 11);
const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x0e0c0e, roughness: 1, map: clothTex, alphaMap: tatterAlpha(32, 256, 0.6, 4, 3), alphaTest: 0.5, side: THREE.DoubleSide });
SHARED.add(ribbonMat);
ribbonMat.onBeforeCompile = (sh) => {
  sh.uniforms.uWind = windU;
  sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float wt = clamp(-position.y / 1.4, 0.0, 1.0);
    transformed.z += -wt * wt * 0.5 + sin(uWind * 3.5 + position.y * 3.0 + modelMatrix[3][0] * 3.0) * 0.12 * wt;
    transformed.x += sin(uWind * 2.7 + position.y * 2.0) * 0.07 * wt;`);
};
const wraithRobeGeo = (() => {
  const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new V2(0.95 - Math.pow(t, 0.7) * 0.77, -0.15 + t * 2.3)); }
  const g = new THREE.LatheGeometry(pts, 28), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x); const k = ss(0.9, -0.1, y); const s = 1 + Math.sin(a * 5 + y * 2) * 0.1 * k + Math.sin(a * 11) * 0.05 * k; p.setX(i, x * s); p.setZ(i, z * s); }
  g.computeVertexNormals(); return g;
})();
class Wraith extends Enemy {
  constructor(x, z) {
    super(x, z);
    const robe = addRim(new THREE.MeshStandardMaterial({ color: 0x100e10, roughness: 1, map: clothTex, normalMap: clothN, alphaMap: wraithAlpha, alphaTest: 0.42, side: THREE.DoubleSide }), 0.12, 0.05, 0.08, 2.0);
    this.robe = robe;
    const body = new THREE.Group(); this.g.add(body); this.body = body;
    addMesh(body, wraithRobeGeo, robe);
    const shroud = addMesh(body, new THREE.LatheGeometry([new V2(0.62, 1.15), new V2(0.55, 1.5), new V2(0.4, 1.85), new V2(0.22, 2.1)], 24), robe); shroud.scale.set(1.05, 1, 1.05);
    const hood = addMesh(body, new THREE.SphereGeometry(0.36, 18, 14, Math.PI / 2 + 0.7, TAU - 1.4, 0, Math.PI * 0.72), robe, 0, 2.2, -0.05); hood.scale.set(1, 1.3, 1.25);
    addMesh(body, new THREE.ConeGeometry(0.18, 0.55, 10), robe, 0, 2.62, -0.25).rotation.x = -1.15;
    const bm = boneMat.clone(); bm.color.setHex(0x8a8070);
    this.skull = makeSkull(bm, new THREE.Color(5, 0.45, 0.2)); this.skull.g.position.set(0, 2.12, 0.04); this.skull.g.scale.setScalar(1.25); body.add(this.skull.g);
    this.arms = [];
    for (const sd of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(sd * 0.36, 1.9, 0.02); sh.rotation.order = 'YXZ'; body.add(sh);
      addMesh(sh, new THREE.CylinderGeometry(0.18, 0.08, 1.0, 10, 1, true).translate(0, -0.5, 0), robe);
      const hand = makeHand(bm, 1.7); hand.g.position.y = -0.98; hand.g.scale.setScalar(1.3); sh.add(hand.g);
      this.arms.push({ sh, hand, sd });
    }
    for (let i = 0; i < 5; i++) { const rb = addMesh(body, new THREE.PlaneGeometry(0.13, 1.4, 1, 10).translate(0, -0.7, 0), ribbonMat, R(-0.35, 0.35), R(1.6, 2.0), -0.3 + R(-0.05, 0.05)); rb.rotation.y = R(-0.4, 0.4) + Math.PI; }
    bake(this.g); this.finish();
    this.hp = this.maxHp = 4; this.radius = 0.6; this.knock = 5; this.speed = R(2.8, 3.4); this.phase = rand() * TAU; this.eye = this.skull.eyeMat;
    this.state = 'appear'; this.t = 0; robe.alphaTest = 1;
  }
  onHurt() { if (this.state !== 'strike') { this.state = 'stagger'; this.t = 0; } AudioFX.hiss(); }
  die() {
    this.dead = true; this.state = 'dying'; this.t = 0; AudioFX.wail();
    const p = this.pos.clone().add(new V3(0, 1.4, 0));
    for (let i = 0; i < 40; i++) fxDark.spawn(p.x + R(-.6, .6), p.y + R(-1, 1), p.z + R(-.6, .6), R(-1, 1), R(0.3, 2), R(-1, 1), R(1.2, 2.4), R(0.4, 0.8), [0.03, 0.025, 0.03], [0.01, 0.01, 0.01], { s1: 1.8, drag: 1, turb: 1, a: 0.7 });
    onEnemyKilled(this, p);
  }
  update(dt, time) {
    this.t += dt; this.cd -= dt; this.flash -= dt; this.setFlash();
    if (this.state === 'dying') {
      this.robe.alphaTest = Math.min(1, 0.42 + this.t * 0.7); this.body.position.y += dt * 0.5; this.eye.color.multiplyScalar(0.9);
      if (this.t > 1) { this.remove(); scene.remove(this.g); }
      return;
    }
    _t1.subVectors(P.position, this.pos).setY(0); const d = _t1.length(); const dir = _t1.normalize().clone(), faceP = Math.atan2(dir.x, dir.z);
    let speed = 0, mv = dir; const alive = state === 'play' && player.hp > 0;
    switch (this.state) {
      case 'appear': this.robe.alphaTest = Math.max(0.42, 1 - this.t * 0.6); if (this.t > 1) { this.state = alive ? 'chase' : 'idle'; } break;
      case 'idle': this.wander += (rand() - 0.5) * dt * 2; mv = new V3(Math.sin(this.wander), 0, Math.cos(this.wander)); speed = 0.7; this.face(Math.atan2(mv.x, mv.z), 2, dt);
        if (alive && d < 30) { this.state = 'chase'; if (rand() < 0.5) AudioFX.wail(); } break;
      case 'chase': if (!alive) { this.state = 'idle'; break; } speed = d > 1.9 ? this.speed : 0; this.face(faceP, 5, dt);
        if (d < 2.7 && this.cd <= 0) { this.state = 'wind'; this.t = 0; AudioFX.hiss(); } break;
      case 'wind': this.face(faceP, 6, dt); speed = -0.6; if (this.t > 0.6) { this.state = 'strike'; this.t = 0; this.hitDone = false; this.lunge = dir.clone(); } break;
      case 'strike': speed = 9 * (1 - this.t / 0.3); mv = this.lunge;
        if (!this.hitDone && this.t > 0.1) { this.hitDone = true; const fwd = _t2.set(Math.sin(this.g.rotation.y), 0, Math.cos(this.g.rotation.y)); if (d < 2.4 && fwd.dot(dir) > 0.2) damagePlayer(14, this.pos); }
        if (this.t > 0.3) { this.state = 'recover'; this.t = 0; } break;
      case 'recover': speed = 0.4; if (this.t > 0.7) { this.state = 'chase'; this.cd = R(0.8, 1.8); } break;
      case 'stagger': if (this.t > 0.3) this.state = 'chase'; break;
    }
    this.steer(mv, speed, dt);
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > WORLD_R + 4) { this.pos.x *= (WORLD_R + 4) / r; this.pos.z *= (WORLD_R + 4) / r; }
    this.pos.y = heightAt(this.pos.x, this.pos.z) + 0.35 + Math.sin(time * 1.8 + this.phase) * 0.15;
    // ---- animation ----
    this.body.rotation.x = damp(this.body.rotation.x, 0.08 + (this.state === 'strike' ? 0.4 : 0) + (this.state === 'wind' ? -0.2 : 0) + speed * 0.02, 10, dt);
    this.body.rotation.z = Math.sin(time * 1.3 + this.phase) * 0.05;
    this.arms.forEach((A, i) => {
      let ax = -1.15 + Math.sin(time * 2.5 + this.phase + i) * 0.12, ay = 0;
      if (this.state === 'wind') { ax = -2.7; ay = -A.sd * 0.4; } if (this.state === 'strike') { ax = -1.2; ay = A.sd * 0.3; }
      A.sh.rotation.x = damp(A.sh.rotation.x, ax, 12, dt); A.sh.rotation.y = damp(A.sh.rotation.y, ay, 12, dt); A.sh.rotation.z = A.sd * 0.2;
      A.hand.fingers.forEach((f, j) => f.rotation.x = -0.2 - (Math.sin(time * 3 + j + this.phase) * 0.5 + 0.5) * 0.5 - (this.state === 'wind' ? 0.6 : 0));
    });
    this.skull.jaw.rotation.x = this.state === 'wind' ? 0.6 : 0.12 + Math.sin(time * 4 + this.phase) * 0.08;
    const flare = this.state === 'wind' ? 2 : 1; this.eye.color.setRGB(5 * flare, 0.45 * flare, 0.2);
    if (rand() < dt * 14) fxDark.spawn(this.pos.x + R(-.7, .7), this.pos.y + R(-.1, .3), this.pos.z + R(-.7, .7), R(-.2, .2), R(0.2, 0.7), R(-.2, .2), R(1, 2), R(0.4, 0.8), [0.03, 0.026, 0.03], [0.01, 0.01, 0.012], { s1: 1.6, turb: 0.8, a: 0.55 });
    if (rand() < dt * 3) { const e = this.skull.g.getWorldPosition(_t2); fx.spawn(e.x, e.y, e.z, R(-.1, .1), R(0.3, 0.6), R(-.1, .1), 0.9, 0.09, [4, 0.4, 0.1], [0.5, 0, 0]); }
  }
}

// ---------------------------------------------------------------------
// The Ashen King — seated on his throne until the five flames burn
// ---------------------------------------------------------------------
class King extends Enemy {
  constructor() {
    super(THRONE.x, THRONE.z);
    const S = 2.15; this.S = S;
    const bm = addRim(boneMat.clone(), 0.25, 0.08, 0.03); bm.color.setHex(0x8e826c);
    this.sk = makeSkeleton(bm, new THREE.Color(1.2, 0.25, 0.05)); this.sk.root.scale.setScalar(S); this.g.add(this.sk.root);
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a3f38, metalness: 0.85, roughness: 0.55, map: grimeTex, roughnessMap: scratchTex });
    const gold = new THREE.MeshStandardMaterial({ color: 0x6e5428, metalness: 1, roughness: 0.4, map: grimeTex });
    const royal = new THREE.MeshStandardMaterial({ color: 0x4a0d10, roughness: 0.9, map: clothTex, normalMap: clothN, alphaMap: tatterAlpha(128, 256, 0.7, 30, 21), alphaTest: 0.5, side: THREE.DoubleSide });
    const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.2, 0.2) }); this.ember = ember;
    const sk = this.sk;
    // armour
    const plate = addMesh(sk.chest, new THREE.LatheGeometry([new V2(0.2, 0.02), new V2(0.23, 0.15), new V2(0.25, 0.3), new V2(0.23, 0.42), new V2(0.15, 0.48)], 20, -Math.PI / 2, Math.PI), iron, 0, 0, 0.0);
    plate.material = iron.clone(); plate.material.side = THREE.DoubleSide; plate.scale.set(1, 1, 0.9);
    for (const sd of [1, -1]) {
      const pg = new THREE.Group(); pg.position.set(sd * 0.2, 0.44, 0); pg.rotation.z = -sd * 0.5; sk.chest.add(pg);
      const pm = iron.clone(); pm.side = THREE.DoubleSide;
      for (let k = 0; k < 3; k++) { const m = addMesh(pg, new THREE.SphereGeometry(0.13 - k * 0.012, 14, 8, 0, TAU, 0, Math.PI / 2), pm, 0, -k * 0.045, 0); m.scale.set(1.1, 0.7, 1.15); }
      for (let k = 0; k < 3; k++) { const sp = addMesh(pg, new THREE.ConeGeometry(0.02, 0.2 - k * 0.04, 6), iron, R(-0.03, 0.03), 0.1, -0.05 + k * 0.05); sp.rotation.set(-0.3 + k * 0.25, 0, sd * 0.2); }
    }
    for (const L of sk.legs) addMesh(L.kn, new THREE.CylinderGeometry(0.05, 0.04, 0.3, 10).translate(0, -0.2, 0), iron);
    for (const A of sk.arms) addMesh(A.el, new THREE.CylinderGeometry(0.045, 0.04, 0.2, 10).translate(0, -0.15, 0), iron);
    const skirt = addMesh(sk.hips, new THREE.LatheGeometry([new V2(0.3, -0.5), new V2(0.27, -0.3), new V2(0.2, -0.05), new V2(0.16, 0.06)], 22), royal);
    // crown
    const crown = new THREE.Group(); crown.position.set(0, 0.13, -0.01); sk.skull.g.add(crown); this.crown = crown;
    const band = addMesh(crown, new THREE.CylinderGeometry(0.15, 0.14, 0.05, 20, 1, true), gold); band.material = gold.clone(); band.material.side = THREE.DoubleSide;
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, h = i % 2 ? 0.1 : 0.17; const sp = addMesh(crown, new THREE.ConeGeometry(0.022, h, 4), gold, Math.sin(a) * 0.148, 0.025 + h / 2, Math.cos(a) * 0.148); sp.rotation.set(Math.cos(a) * 0.15, 0, -Math.sin(a) * 0.15); }
    for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.45; addMesh(crown, new THREE.SphereGeometry(0.013, 6, 5), ember, Math.sin(a) * 0.152, 0.0, Math.cos(a) * 0.152, false); }
    // royal cape
    const capeG = new THREE.PlaneGeometry(0.62, 1.15, 4, 12); capeG.translate(0, -0.575, 0);
    const capeM = royal.clone(); capeM.onBeforeCompile = ribbonMat.onBeforeCompile; capeM.customProgramCacheKey = () => 'kingcape';
    const cape = addMesh(sk.chest, capeG, capeM, 0, 0.46, -0.16); cape.rotation.x = 0.08; cape.rotation.y = Math.PI;
    // greatsword
    const sw = new THREE.Group(); this.sword = sw;
    const c = document.createElement('canvas'); c.width = 32; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 32, 256);
    x.strokeStyle = '#fff'; for (let i = 0; i < 26; i++) { x.lineWidth = 0.5 + Math.random() * 1.5; x.beginPath(); let px = Math.random() * 32, py = Math.random() * 256; x.moveTo(px, py); for (let k = 0; k < 4; k++) { px += R(-6, 6); py += R(-12, 12); x.lineTo(px, py); } x.stroke(); }
    x.fillStyle = '#fff'; x.fillRect(0, 0, 2, 256); x.fillRect(30, 0, 2, 256);
    const cracks = new THREE.CanvasTexture(c);
    const swMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.8, roughness: 0.5, map: grimeTex, emissive: new THREE.Color(1, 0.28, 0.04), emissiveMap: cracks, emissiveIntensity: 2.2 });
    const bladeG = new THREE.BoxGeometry(0.16, 1.9, 0.035); bladeG.translate(0, -1.15, 0);
    addMesh(sw, bladeG, swMat);
    addMesh(sw, new THREE.ConeGeometry(0.08, 0.25, 4).rotateZ(Math.PI).translate(0, -2.22, 0), swMat).scale.z = 0.25;
    addMesh(sw, new THREE.BoxGeometry(0.5, 0.06, 0.08), iron, 0, -0.17, 0);
    addMesh(sw, new THREE.CylinderGeometry(0.03, 0.035, 0.32, 8), iron, 0, 0.02, 0);
    addMesh(sw, new THREE.SphereGeometry(0.05, 8, 6), gold, 0, 0.2, 0);
    this.swTip = new THREE.Object3D(); this.swTip.position.y = -2.2; sw.add(this.swTip);
    this.swBase = new THREE.Object3D(); this.swBase.position.y = -0.4; sw.add(this.swBase);
    sw.scale.setScalar(S);
    bake(this.g); bake(sw); this.finish();
    this.mats.push(...collectMats(sw)); this.baseEm = this.mats.map(m => m.emissive.clone());
    // planted in front of the throne
    sw.position.set(THRONE.x + 0.15, 3.9, THRONE.z + 1.6); sw.rotation.set(0.05, 0.3, 0.04); scene.add(sw);
    this.hp = this.maxHp = 32; this.radius = 1.2; this.knock = 0.6; this.state = 'throne'; this.invuln = true; this.phase = 0; this.enraged = false;
    this.glow = new THREE.PointLight(0xff6a2a, 7, 9, 1.6); this.glow.position.set(0, 0.35, 0.35); sk.chest.add(this.glow);
    this.tele = makeTelegraph(); this.eye = sk.skull.eyeMat; this.trail = new Trail(14, [2.5, 0.6, 0.1]);
    this.seat();
  }
  seat() {
    const sk = this.sk, S = this.S;
    this.g.position.set(THRONE.x, 2.45 - 0.95 * S + 0.05, THRONE.z - 0.85); this.g.rotation.y = 0;
    sk.legs.forEach(L => { L.th.rotation.set(-1.5, 0, L.s * 0.12); L.kn.rotation.x = 1.25; });
    sk.chest.rotation.x = 0.35; sk.neck.rotation.x = 0.7; sk.skull.jaw.rotation.x = 0.35;
    sk.arms.forEach(A => { A.sh.rotation.set(-0.35, 0, A.s * 0.35); A.el.rotation.x = -0.9; });
    this.eye.color.setRGB(0.6, 0.1, 0.02);
  }
  reset() {
    this.hp = this.maxHp; this.state = 'guard'; this.t = 0; this.tele.visible = false; this.enraged = false; this.summoned = false; this.invuln = false;
    this.pos.set(0, PLAZA_TOP, 0); this.kb.set(0, 0, 0); $('bossBar').classList.remove('on'); AudioFX.bossMusic(false);
  }
  wake() { if (this.state !== 'throne') return; this.state = 'waking'; this.t = 0; AudioFX.roar(); }
  onHurt() { AudioFX.hit(true); }
  die(dir) {
    this.dead = true; this.state = 'dying'; this.t = 0; this.tele.visible = false; AudioFX.roar(true);
    onEnemyKilled(this, this.pos.clone().add(new V3(0, 2, 0)));
  }
  grabSword() { const hand = this.sk.arms[1].hand.g; hand.attach(this.sword); this.sword.position.set(0, -0.05, 0); this.sword.rotation.set(-1.25, 0, 0); this.sword.scale.setScalar(1); }
  update(dt, time) {
    const sk = this.sk, S = this.S; this.t += dt; this.cd -= dt; this.flash -= dt; this.setFlash();
    if (rand() < dt * 18 && this.state !== 'throne') { const e = sk.chest.getWorldPosition(_t2); fx.spawn(e.x + R(-.6, .6), e.y + R(0, 1.4), e.z + R(-.6, .6), R(-.3, .3), R(0.6, 1.6), R(-.3, .3), R(1, 2), R(0.06, 0.12), FIRE_EMBER[0], FIRE_EMBER[1], { turb: 2 }); }
    this.trail.update(dt);
    if (this.state === 'throne') { this.eye.color.setRGB(0.6 + Math.sin(time) * 0.2, 0.1, 0.02); sk.chest.rotation.x = 0.35 + Math.sin(time * 0.8) * 0.02; return; }
    if (this.state === 'waking') {
      const t = this.t / 3.2, k = easeInOut(t);
      this.eye.color.setRGB(lerp(0.6, 9, ss(0, 0.3, t)), lerp(0.1, 1.6, ss(0, 0.3, t)), 0.2);
      sk.neck.rotation.x = lerp(0.7, -0.25, ss(0.05, 0.4, t)); sk.skull.jaw.rotation.x = 0.5 * Math.sin(Math.min(t * 3, 1) * Math.PI);
      sk.chest.rotation.x = lerp(0.35, 0.1, k);
      sk.legs.forEach(L => { L.th.rotation.x = lerp(-1.5, 0, ss(0.35, 0.85, t)); L.kn.rotation.x = lerp(1.25, 0, ss(0.35, 0.85, t)); });
      this.g.position.set(THRONE.x, lerp(2.5 - 0.95 * S, PLAZA_TOP, ss(0.35, 0.9, t)), lerp(THRONE.z - 0.85, THRONE.z + 3.1, ss(0.35, 0.9, t)));
      if (t > 0.25 && !this.gotSword) { this.gotSword = true; this.grabSword(); }
      if (this.t > 0.4 && this.t < 2.2) shake = Math.max(shake, 0.12);
      if (t >= 1) { this.state = 'chase'; this.invuln = false; this.t = 0; this.cd = 1; }
      return;
    }
    if (this.state === 'dying') {
      const t = this.t;
      sk.legs.forEach(L => { L.th.rotation.x = damp(L.th.rotation.x, -1.4, 3, dt); L.kn.rotation.x = damp(L.kn.rotation.x, 2.2, 3, dt); });
      this.g.position.y = damp(this.g.position.y, PLAZA_TOP - 0.7 * S, 3, dt);
      sk.chest.rotation.x = damp(sk.chest.rotation.x, 0.6, 2, dt); sk.neck.rotation.x = damp(sk.neck.rotation.x, 0.6, 2, dt);
      this.eye.color.multiplyScalar(0.985);
      if (t > 1.2 && !this.crownFell) { this.crownFell = true; scene.attach(this.crown); this.crownV = new V3(R(-1, 1), 2, 2.5); }
      if (this.crownV) { this.crownV.y -= 9 * dt; this.crown.position.addScaledVector(this.crownV, dt); this.crown.rotation.x += dt * 4; const gy = groundAt(this.crown.position.x, this.crown.position.z) + 0.15; if (this.crown.position.y < gy) { this.crown.position.y = gy; this.crownV.multiplyScalar(-0.3); } }
      this.glow.intensity = Math.max(0, this.glow.intensity - dt * 3);
      if (t > 2.8 && !this.shattered) { this.shattered = true; shatter(this.g, this.pos.clone().add(new V3(0, 1, 0)), 7); scene.remove(this.sword); this.remove(); onBossShattered(this.pos.clone()); }
      return;
    }
    _t1.subVectors(P.position, this.pos).setY(0); const d = _t1.length(); const dir = _t1.normalize().clone(), faceP = Math.atan2(dir.x, dir.z);
    const alive = state === 'play' && player.hp > 0, rage = this.enraged ? 1.25 : 1;
    let speed = 0, mv = dir;
    if (!this.enraged && this.hp < this.maxHp * 0.5 && this.state === 'chase') { this.enraged = true; this.state = 'roar'; this.t = 0; AudioFX.roar(); }
    switch (this.state) {
      case 'guard':
        this.face(faceP, 2, dt);
        if (alive && d < 15) { this.state = 'chase'; this.cd = 1; $('bossBar').classList.add('on'); AudioFX.bossMusic(true); AudioFX.roar(); }
        break;
      case 'chase':
        if (!alive) break;
        speed = d > 3.2 ? 2.4 * rage : 0; this.face(faceP, 3, dt);
        if (this.cd <= 0) {
          if (d < 5) { this.state = 'sweepWind'; this.t = 0; }
          else if (d < 13) { this.state = 'slamWind'; this.t = 0; this.target = P.position.clone().addScaledVector(player.vel, 0.35); this.from = this.pos.clone(); }
        }
        break;
      case 'sweepWind': {
        this.face(faceP, 4, dt); const dur = 0.85 / rage;
        this.tele.visible = true; this.tele.position.set(this.pos.x, this.pos.y + 0.05, this.pos.z); this.tele.scale.setScalar(5.4); this.tele.rotation.y = this.g.rotation.y;
        this.tele.material.uniforms.uArc.value = 1.25; this.tele.material.uniforms.uProg.value = this.t / dur;
        if (this.t > dur) { this.state = 'sweep'; this.t = 0; this.hitDone = false; AudioFX.swing(true); }
        break;
      }
      case 'sweep':
        this.tele.visible = false;
        if (!this.hitDone && this.t > 0.12) {
          this.hitDone = true; const fwd = _t2.set(Math.sin(this.g.rotation.y), 0, Math.cos(this.g.rotation.y));
          if (d < 5.6 && Math.acos(clamp(fwd.dot(dir), -1, 1)) < 1.3) damagePlayer(24, this.pos);
        }
        if (this.t > 0.35) { this.state = 'recover'; this.t = 0; this.recoverDur = 0.8; }
        break;
      case 'slamWind': {
        const dur = 0.95 / rage; this.face(Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z), 6, dt);
        this.tele.visible = true; this.tele.position.set(this.target.x, groundAt(this.target.x, this.target.z) + 0.06, this.target.z); this.tele.scale.setScalar(3.8);
        this.tele.material.uniforms.uArc.value = 3.2; this.tele.material.uniforms.uProg.value = this.t / (dur + 0.55);
        if (this.t > dur) { this.state = 'leap'; this.t = 0; this.from = this.pos.clone(); AudioFX.swing(true); }
        break;
      }
      case 'leap': {
        const k = Math.min(this.t / 0.55, 1);
        this.pos.x = lerp(this.from.x, this.target.x, k); this.pos.z = lerp(this.from.z, this.target.z, k);
        this.pos.y = lerp(this.from.y, groundAt(this.target.x, this.target.z), k) + Math.sin(k * Math.PI) * 3.2;
        this.tele.material.uniforms.uProg.value = (0.95 / rage + this.t) / (0.95 / rage + 0.55);
        if (k >= 1) {
          this.tele.visible = false; this.state = 'recover'; this.t = 0; this.recoverDur = 1.4; shake = 0.6; AudioFX.slam(); hitStop = 0.08;
          if (Math.hypot(P.position.x - this.target.x, P.position.z - this.target.z) < 3.8) damagePlayer(30, this.target);
          for (let i = 0; i < 60; i++) { const a = rand() * TAU; fxDark.spawn(this.target.x + Math.cos(a) * 0.8, this.pos.y + 0.2, this.target.z + Math.sin(a) * 0.8, Math.cos(a) * R(4, 9), R(0.5, 2.5), Math.sin(a) * R(4, 9), R(0.8, 1.6), R(0.4, 0.9), [0.2, 0.18, 0.16], [0.08, 0.07, 0.06], { s1: 1.8, drag: 2.5, a: 0.75 }); }
          for (let i = 0; i < 40; i++) { const a = rand() * TAU; fx.spawn(this.target.x, this.pos.y + 0.3, this.target.z, Math.cos(a) * R(3, 8), R(1, 5), Math.sin(a) * R(3, 8), R(0.4, 0.9), R(0.08, 0.16), FIRE_EMBER[0], FIRE_EMBER[1], { g: 6 }); }
        }
        break;
      }
      case 'recover': if (this.t > this.recoverDur) { this.state = 'chase'; this.cd = R(0.6, 1.4) / rage; } break;
      case 'roar':
        sk.skull.jaw.rotation.x = 0.7; shake = Math.max(shake, 0.25);
        if (this.t > 0.5 && !this.summoned) { this.summoned = true; for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + rand(); new Hollow(this.pos.x + Math.cos(a) * 6, this.pos.z + Math.sin(a) * 6); } }
        if (this.t > 1.8) { this.state = 'chase'; this.cd = 0.6; }
        break;
    }
    if (this.state !== 'leap') { this.steer(mv, speed, dt); resolveCollisions(this.pos, 0.9); this.pos.y = damp(this.pos.y, groundAt(this.pos.x, this.pos.z), 20, dt); }
    // ---- animation ----
    this.phase += speed * dt * 1.4;
    const ph = this.phase, k = Math.min(speed / 2.4, 1);
    sk.legs.forEach((L, i) => { const p = ph + (i ? Math.PI : 0); L.th.rotation.x = damp(L.th.rotation.x, -Math.sin(p) * 0.55 * k - (this.state === 'slamWind' ? 0.6 : 0), 12, dt); L.kn.rotation.x = damp(L.kn.rotation.x, Math.max(0, Math.sin(p - 1.2)) * 0.9 * k + 0.1 + (this.state === 'slamWind' ? 1.0 : 0), 12, dt); L.th.rotation.z = L.s * 0.08; });
    let cx = 0.15, cy = 0, ax = -0.4, ay = -0.2, ael = -0.6;
    if (this.state === 'sweepWind') { cy = 0.7; ax = -1.3; ay = -1.9; ael = -0.4; }
    if (this.state === 'sweep') { const f = easeOut(this.t / 0.3); cy = lerp(0.7, -0.8, f); ax = -1.4; ay = lerp(-1.9, 1.6, f); ael = -0.1; }
    if (this.state === 'slamWind') { cx = -0.25; ax = -3.0; ay = -0.1; ael = -0.3; }
    if (this.state === 'leap') { const f = this.t / 0.55; cx = lerp(-0.25, 0.6, f); ax = lerp(-3.0, -0.6, f); ael = 0; }
    if (this.state === 'recover' && this.recoverDur > 1) { cx = 0.6; ax = -0.6; ael = 0; }
    if (this.state === 'roar') { cx = -0.35; ax = -0.3; }
    sk.chest.rotation.x = damp(sk.chest.rotation.x, cx, 10, dt); sk.chest.rotation.y = damp(sk.chest.rotation.y, cy + Math.sin(ph) * 0.1 * k, 10, dt);
    sk.neck.rotation.x = damp(sk.neck.rotation.x, this.state === 'roar' ? -0.7 : -0.15, 8, dt);
    const R_ = sk.arms[1], L_ = sk.arms[0], fast = this.state === 'sweep' || this.state === 'leap' ? 30 : 9;
    R_.sh.rotation.x = damp(R_.sh.rotation.x, ax, fast, dt); R_.sh.rotation.y = damp(R_.sh.rotation.y, ay, fast, dt); R_.el.rotation.x = damp(R_.el.rotation.x, ael, fast, dt); R_.sh.rotation.z = -0.15;
    L_.sh.rotation.x = damp(L_.sh.rotation.x, (this.state === 'slamWind' ? -2.8 : Math.sin(ph + Math.PI) * 0.4 * k - 0.2), 8, dt); L_.el.rotation.x = -0.5; L_.sh.rotation.z = 0.2;
    if (this.state !== 'roar') sk.skull.jaw.rotation.x = damp(sk.skull.jaw.rotation.x, this.state === 'sweepWind' || this.state === 'slamWind' ? 0.45 : 0.1, 8, dt);
    if (this.state === 'sweep' || this.state === 'leap') this.trail.push(this.swBase.getWorldPosition(new V3()), this.swTip.getWorldPosition(new V3()));
    this.eye.color.setRGB(9, 1.6 * (this.enraged ? 0.5 : 1), 0.2);
    if (rand() < dt * 6 && speed > 0.5) AudioFX.step(true);
  }
}
