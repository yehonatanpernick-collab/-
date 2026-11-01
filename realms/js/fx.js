import * as THREE from 'three';

const PVERT = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying vec3 vC; varying float vA; uniform float uScale;
void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = aSize*uScale/ -mv.z; gl_Position = projectionMatrix*mv; }`;
const PFRAG = `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if(r>0.5) discard;
float a = (1. - smoothstep(0.0,0.5,r)); a = a*a; gl_FragColor = vec4(vC*a*vA*1.6, 1.0); }`;

export class FX {
  constructor(scene, pixelScale) {
    this.scene = scene;
    // ---- burst particles ----
    const N = this.N = 2400;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grav = new Float32Array(N); this.s0 = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uScale = { value: pixelScale };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uScale: this.uScale }, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.head = 0;
    // ---- ambient motes ----
    const A = 700, ap = new Float32Array(A * 3), ar = new Float32Array(A);
    for (let i = 0; i < A; i++) { ap[i * 3] = Math.random() * 80 - 40; ap[i * 3 + 1] = Math.random() * 24; ap[i * 3 + 2] = Math.random() * 80 - 40; ar[i] = Math.random(); }
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(ap, 3)); ag.setAttribute('aRnd', new THREE.BufferAttribute(ar, 1));
    this.ambU = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uScale: this.uScale, uRise: { value: 0 } };
    this.ambient = new THREE.Points(ag, new THREE.ShaderMaterial({
      uniforms: this.ambU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime, uScale, uRise; uniform vec3 uCenter; attribute float aRnd; varying float vA;
        void main(){ vec3 p = position; float t = uTime*(0.3+aRnd*0.4);
          p += vec3(sin(t+aRnd*30.)*2., sin(t*1.3+aRnd*10.)*1.2 + uTime*uRise*(0.5+aRnd), cos(t*0.8+aRnd*20.)*2.);
          p.xz = mod(p.xz - uCenter.xz + 40., 80.) - 40. + uCenter.xz; p.y = mod(p.y, 24.) + uCenter.y - 6.;
          vec4 mv = modelViewMatrix*vec4(p,1.); vA = (0.5+0.5*sin(uTime*2.+aRnd*50.)) * (1. - smoothstep(10.,45.,-mv.z));
          vA *= smoothstep(1.5,5.,-mv.z); gl_PointSize = min((0.25+aRnd*0.35)*uScale/-mv.z, 24.); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float r = length(gl_PointCoord-0.5); if(r>0.5) discard; float a = (1. - smoothstep(0.,0.5,r)); gl_FragColor = vec4(uColor*a*a*vA*2.,1.); }`,
    }));
    this.ambient.frustumCulled = false; scene.add(this.ambient);
    // ---- rings / shockwaves ----
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48); this.ringGeo.rotateX(-Math.PI / 2);
    // ---- bolts ----
    this.bolts = [];
    this.boltGeo = new THREE.IcosahedronGeometry(0.28, 1);
    this.tmp = new THREE.Vector3();
  }
  emit(p, o = {}) {
    const count = o.count || 10, c = new THREE.Color(o.color || '#ffffff');
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      const sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.6);
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1; const l = Math.hypot(vx, vy, vz) || 1;
      vx = vx / l * sp; vy = vy / l * sp + (o.up || 0); vz = vz / l * sp;
      const sr = o.spread || 0;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * sr; this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * sr * 0.5; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * sr;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.max[i] = this.life[i] = (o.life || 0.8) * (0.6 + Math.random() * 0.6);
      this.s0[i] = (o.size || 0.4) * (0.6 + Math.random() * 0.8); this.grav[i] = o.gravity ?? 0;
    }
  }
  ring(p, o = {}) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: o.color || '#fff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(p.x, p.y + 0.15, p.z); this.scene.add(m);
    this.rings.push({ m, t: 0, dur: o.dur || 0.5, r0: o.r0 || 0.5, r1: o.r1 || 5, op: o.opacity ?? 1 });
  }
  bolt(p, dir, o) {
    const m = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: o.color })); m.scale.setScalar(o.scale || 1);
    const halo = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(2.2); m.add(halo);
    m.position.copy(p); this.scene.add(m);
    const b = { m, vel: dir.clone().multiplyScalar(o.speed || 28), life: o.life || 1.6, ...o };
    this.bolts.push(b); return b;
  }
  update(dt, t, center, color, rise) {
    const N = this.N, P = this.pos, V = this.vel;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      V[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 1.8); V[i * 3] *= drag; V[i * 3 + 1] *= drag; V[i * 3 + 2] *= drag;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.alpha[i] = k; this.size[i] = this.s0[i] * (0.4 + k * 0.6);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    this.ambU.uTime.value = t; this.ambU.uCenter.value.copy(center); this.ambU.uColor.value.copy(color); this.ambU.uRise.value = rise;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const k = r.t / r.dur;
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k)); r.m.scale.setScalar(s); r.m.material.opacity = (1 - k) * r.op;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
  }
  updateBolts(dt, onStep) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.homing && b.target && b.target.alive) {
        this.tmp.copy(b.target.pos); this.tmp.y += b.target.height * 0.5; this.tmp.sub(b.m.position).normalize().multiplyScalar(b.vel.length());
        b.vel.lerp(this.tmp, Math.min(1, dt * b.homing));
      }
      b.m.position.addScaledVector(b.vel, dt);
      b.m.rotation.x += dt * 8; b.m.rotation.y += dt * 6;
      this.emit(b.m.position, { count: 2, color: b.color, speed: 0.6, life: 0.4, size: 0.5 * (b.scale || 1) });
      if (b.life <= 0 || onStep(b) === true) { this.kill(i); }
    }
  }
  kill(i) { const b = this.bolts[i]; this.scene.remove(b.m); b.m.material.dispose(); this.bolts.splice(i, 1); }
}
