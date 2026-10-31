
// =====================================================================
// Particles: one additive pool (fire, souls, sparks), one alpha pool (ash, smoke, dust, gore)
// =====================================================================
class Particles {
  constructor(max, additive) {
    this.max = max; this.cursor = 0;
    const F = (n) => new Float32Array(n);
    this.pos = F(max * 3); this.col = F(max * 3); this.size = F(max); this.alpha = F(max);
    this.vel = F(max * 3); this.life = F(max); this.maxLife = F(max); this.c0 = F(max * 3); this.c1 = F(max * 3);
    this.s0 = F(max); this.s1 = F(max); this.grav = F(max); this.drag = F(max); this.turb = F(max); this.a0 = F(max);
    const g = new THREE.BufferGeometry();
    const att = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', att(this.pos, 3)); g.setAttribute('aColor', att(this.col, 3));
    g.setAttribute('aSize', att(this.size, 1)); g.setAttribute('aAlpha', att(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aAlpha <= 0.0 ? 0.0 : min(aSize * uScale / max(-mv.z, 0.1), 90.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = max(exp(-dot(c,c)*14.0) - 0.03, 0.0); gl_FragColor = vec4(vC, a * vA); }`
        : `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c)); gl_FragColor = vec4(vC, a * vA); }`
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size, c0, c1, o = {}) {
    const i = this.cursor; this.cursor = (i + 1) % this.max; const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i] = this.maxLife[i] = life; this.s0[i] = size; this.s1[i] = o.s1 !== undefined ? o.s1 : size * 0.5;
    this.c0[j] = c0[0]; this.c0[j + 1] = c0[1]; this.c0[j + 2] = c0[2]; this.c1[j] = c1[0]; this.c1[j + 1] = c1[1]; this.c1[j + 2] = c1[2];
    this.grav[i] = o.g || 0; this.drag[i] = o.drag || 0; this.turb[i] = o.turb || 0; this.a0[i] = o.a !== undefined ? o.a : 1;
  }
  update(dt, time) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt; const t = 1 - this.life[i] / this.maxLife[i], j = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j + 1] -= this.grav[i] * dt;
      const tb = this.turb[i];
      if (tb > 0) { this.vel[j] += Math.sin(time * 2.1 + i * 1.7 + this.pos[j + 1]) * tb * dt; this.vel[j + 2] += Math.cos(time * 1.7 + i * 2.3 + this.pos[j + 1]) * tb * dt; }
      this.vel[j] *= dr; this.vel[j + 1] *= dr; this.vel[j + 2] *= dr;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.col[j] = lerp(this.c0[j], this.c1[j], t); this.col[j + 1] = lerp(this.c0[j + 1], this.c1[j + 1], t); this.col[j + 2] = lerp(this.c0[j + 2], this.c1[j + 2], t);
      this.alpha[i] = Math.min(1, t * 8) * (1 - t) * this.a0[i];
      this.size[i] = lerp(this.s0[i], this.s1[i], t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}
const fx = new Particles(LOW ? 3500 : 6000, true);
const fxDark = new Particles(LOW ? 1800 : 3500, false);

const FIRE_ORANGE = [[3.4, 1.4, 0.35], [1.2, 0.12, 0.02]];
const FIRE_SOUL = [[1.0, 2.6, 3.4], [0.05, 0.3, 0.9]];
const FIRE_CURSED = [[2.4, 0.3, 0.2], [0.45, 0.02, 0.02]];
const FIRE_EMBER = [[3.0, 0.9, 0.25], [0.8, 0.08, 0.0]];

class Flame {
  constructor(pos, palette, rate = 45, spread = 0.25, scale = 1, smoke = true) {
    this.pos = pos.clone(); this.palette = palette; this.rate = rate; this.spread = spread; this.scale = scale; this.acc = 0; this.active = true; this.smoke = smoke;
  }
  update(dt) {
    if (!this.active) return;
    this.acc += dt * this.rate;
    while (this.acc > 1) {
      this.acc--;
      const a = rand() * TAU, r = Math.sqrt(rand()) * this.spread;
      fx.spawn(this.pos.x + Math.cos(a) * r, this.pos.y, this.pos.z + Math.sin(a) * r, R(-.2, .2), R(1.2, 2.3) * this.scale, R(-.2, .2),
        R(0.4, 0.85), R(0.42, 0.8) * this.scale, this.palette[0], this.palette[1], { g: -0.5, drag: 0.6, turb: 1.5, s1: 0.1 });
      if (rand() < 0.06) fx.spawn(this.pos.x, this.pos.y + 0.3, this.pos.z, R(-.6, .6), R(2, 3.5), R(-.6, .6), R(1.2, 2.2), 0.07, [3, 1.2, 0.3], [1, 0.1, 0], { drag: 0.3, turb: 3 });
      if (this.smoke && rand() < 0.12) fxDark.spawn(this.pos.x, this.pos.y + 0.9 * this.scale, this.pos.z, R(-.2, .2), R(0.8, 1.4), R(-.2, .2), R(2, 3.5), 0.5 * this.scale, [0.05, 0.045, 0.04], [0.02, 0.02, 0.02], { s1: 1.6 * this.scale, turb: 0.8, a: 0.35 });
    }
  }
}
const flames = [];

// =====================================================================
// Sword trail ribbon
// =====================================================================
class Trail {
  constructor(n, color) {
    this.n = n; this.base = []; this.tip = []; this.active = false;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.age = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); } g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(...color) }, uFade: { value: 0 } },
      vertexShader: `attribute float aAge; varying float vA; varying float vS; void main(){ vA = aAge; vS = mod(float(gl_VertexID), 2.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade; varying float vA; varying float vS;
        void main(){ float a = (1.0 - vA) * (1.0 - vA) * smoothstep(0.0, 0.9, vS) * (1.0 - uFade); gl_FragColor = vec4(uColor * a, a); }`
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; scene.add(this.mesh);
    this.fade = 1;
  }
  push(b, t) {
    this.base.unshift(b.clone()); this.tip.unshift(t.clone());
    if (this.base.length > this.n) { this.base.pop(); this.tip.pop(); }
    this.fade = 0;
  }
  update(dt) {
    this.fade = Math.min(1, this.fade + dt * 4); this.mat.uniforms.uFade.value = this.fade;
    const m = this.base.length; if (m < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = this.fade < 1;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, m - 1), b = this.base[k], t = this.tip[k];
      this.pos.set([b.x, b.y, b.z], i * 6); this.pos.set([t.x, t.y, t.z], i * 6 + 3);
      this.age[i * 2] = this.age[i * 2 + 1] = i / (this.n - 1);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.aAge.needsUpdate = true;
    if (this.fade >= 1) { this.base.length = 0; this.tip.length = 0; }
  }
}

// =====================================================================
// Ground telegraphs for enemy attacks (circle or sector)
// =====================================================================
function makeTelegraph() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uProg: { value: 0 }, uArc: { value: 3.2 }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uProg, uArc, uAlpha, uTime; varying vec2 vUv;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = length(p);
        float ang = abs(atan(p.x, p.y));
        float inArc = 1.0 - smoothstep(uArc - 0.04, uArc, ang);
        float rim = smoothstep(0.9, 0.96, d) * (1.0 - smoothstep(0.98, 1.0, d));
        float fill = (1.0 - smoothstep(uProg - 0.03, uProg, d)) * 0.28;
        float edge = (1.0 - smoothstep(0.0, 0.03, abs(d - uProg))) * 0.6;
        float a = (rim + fill + edge) * inArc * (1.0 - smoothstep(0.99, 1.0, d)) * uAlpha;
        gl_FragColor = vec4(vec3(1.6, 0.12, 0.05) * a, a); }`
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 4; m.visible = false; scene.add(m); return m;
}

// =====================================================================
// Debris (bones and armour scattering on death)
// =====================================================================
const debris = [];
function shatter(group, origin, force = 5) {
  const meshes = []; group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    scene.attach(m);
    const dir = m.getWorldPosition(new V3()).sub(origin).setY(0.6).normalize();
    debris.push({ m, v: dir.multiplyScalar(R(0.5, 1) * force).add(new V3(R(-1, 1), R(1, 4), R(-1, 1))), w: new V3(R(-8, 8), R(-8, 8), R(-8, 8)), t: 0, life: R(3.5, 5) });
  }
  scene.remove(group);
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.t += dt; const m = d.m;
    d.v.y -= 14 * dt; m.position.addScaledVector(d.v, dt);
    m.rotation.x += d.w.x * dt; m.rotation.y += d.w.y * dt; m.rotation.z += d.w.z * dt;
    const gy = heightAt(m.position.x, m.position.z) + 0.04;
    if (m.position.y < gy) { m.position.y = gy; d.v.y *= -0.25; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
    if (d.t > d.life - 1) { m.position.y -= dt * 0.25; }
    if (d.t > d.life) { scene.remove(m); debris.splice(i, 1); }
  }
}
