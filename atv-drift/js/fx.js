// Particles (dust, smoke, splash, sparkles) and tyre tracks.
import * as THREE from 'three';

export class Particles {
  constructor(scene, tex, max = 4000) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      vertexShader: `
        attribute float alpha; attribute float size; attribute vec3 color;
        varying float vA; varying vec3 vC; varying float vFog;
        uniform float scale; uniform float fogNear; uniform float fogFar;
        void main(){
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
          vFog = smoothstep(fogNear, fogFar, -mv.z);
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor;
        varying float vA; varying vec3 vC; varying float vFog;
        void main(){
          vec4 t = texture2D(map, gl_PointCoord);
          float a = t.a * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(vC, fogColor, vFog), a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = opts.grow ?? 1.5; this.grav[i] = opts.grav ?? -0.4;
    this.a0[i] = opts.alpha ?? 0.55; this.drag[i] = opts.drag ?? 1.6;
    this.alpha[i] = this.a0[i];
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[n * 3 + k]; this.vel[i * 3 + k] = this.vel[n * 3 + k]; this.col[i * 3 + k] = this.col[n * 3 + k];
          }
          this.size[i] = this.size[n]; this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n];
          this.grow[i] = this.grow[n]; this.grav[i] = this.grav[n]; this.a0[i] = this.a0[n]; this.drag[i] = this.drag[n];
          i--;
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'alpha', 'size']) this.geo.attributes[k].needsUpdate = true;
  }
}

// Ribbon tyre tracks
export class Skids {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.i = 0;
    this.count = 0;
    this.last = [null, null, null, null];
    this.dirty = false;
  }
  // p: contact point, side: lateral vector, w: half width
  add(wi, p, side, w, rgba) {
    const L = this.last[wi];
    const lx = p.x + side.x * w, ly = p.y + 0.035, lz = p.z + side.z * w;
    const rx = p.x - side.x * w, ry = p.y + 0.035, rz = p.z - side.z * w;
    if (!L) { this.last[wi] = { lx, ly, lz, rx, ry, rz, x: p.x, z: p.z, a: rgba[3] }; return; }
    const d = Math.hypot(p.x - L.x, p.z - L.z);
    if (d < 0.35) return;
    if (d > 3) { this.last[wi] = { lx, ly, lz, rx, ry, rz, x: p.x, z: p.z, a: rgba[3] }; return; }
    const i = this.i;
    const P = this.pos, C = this.col;
    const v = [L.lx, L.ly, L.lz, L.rx, L.ry, L.rz, rx, ry, rz, L.lx, L.ly, L.lz, rx, ry, rz, lx, ly, lz];
    P.set(v, i * 18);
    const a0 = L.a, a1 = rgba[3];
    for (let k = 0; k < 6; k++) {
      const a = (k === 0 || k === 1 || k === 3) ? a0 : a1;
      C[i * 24 + k * 4] = rgba[0]; C[i * 24 + k * 4 + 1] = rgba[1]; C[i * 24 + k * 4 + 2] = rgba[2]; C[i * 24 + k * 4 + 3] = a;
    }
    this.i = (i + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.last[wi] = { lx, ly, lz, rx, ry, rz, x: p.x, z: p.z, a: rgba[3] };
    this.dirty = true;
  }
  break(wi) { this.last[wi] = null; }
  update() {
    if (!this.dirty) return;
    this.geo.setDrawRange(0, this.count * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.dirty = false;
  }
}
