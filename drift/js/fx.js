import * as THREE from 'three';

function softTex(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function smokeTex() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const r = 14 + Math.random() * 26, px = s / 2 + (Math.random() - 0.5) * 50, py = s / 2 + (Math.random() - 0.5) * 50;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  }
  // fade edges
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.15, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Camera-facing instanced quads. Used for smoke (normal blend) and sparks/glows (additive).
class Billboards {
  constructor(max, tex, additive, scene, litColor = true) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.off = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.prm = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // size, alpha, rot, stretch
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('offset', this.off); g.setAttribute('prm', this.prm); g.setAttribute('icol', this.col);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, light: { value: new THREE.Color(1, 1, 1) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `
        attribute vec3 offset; attribute vec4 prm; attribute vec3 icol;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vFog;
        uniform float fogDensity;
        void main(){
          vUv = uv; vA = prm.y; vC = icol;
          vec4 mv = modelViewMatrix * vec4(offset,1.0);
          float c = cos(prm.z), s = sin(prm.z);
          vec2 p = vec2(position.x*c - position.y*s, position.x*s + position.y*c) * prm.x;
          p.y *= prm.w;
          mv.xy += p;
          float d = length(mv.xyz);
          vFog = 1.0 - exp(-fogDensity*fogDensity*d*d);
          vA *= smoothstep(0.8, 4.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 light; uniform vec3 fogColor;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vFog;
        void main(){
          vec4 t = texture2D(map, vUv);
          vec3 c = vC * ${litColor ? 'light' : 'vec3(1.0)'};
          ${additive ? 'gl_FragColor = vec4(c * t.rgb * vA * (1.0-vFog), 1.0);' : 'gl_FragColor = vec4(mix(c, fogColor, vFog), t.a * vA);'}
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 4 : 3;
    scene.add(this.mesh);
    this.p = [];
  }
  spawn(o) { if (this.p.length >= this.max) this.p.shift(); this.p.push(o); }
  update(dt) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vx *= 1 - dt * (q.drag ?? 1.2); q.vz *= 1 - dt * (q.drag ?? 1.2); q.vy = q.vy * (1 - dt * (q.drag ?? 1.2)) + (q.g ?? 0) * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.floor !== undefined && q.y < q.floor) { q.y = q.floor; q.vy = -q.vy * 0.4; }
      p[w++] = q;
    }
    p.length = w;
    const off = this.off.array, prm = this.prm.array, col = this.col.array;
    for (let i = 0; i < w; i++) {
      const q = p[i], t = q.age / q.life;
      off[i * 3] = q.x; off[i * 3 + 1] = q.y; off[i * 3 + 2] = q.z;
      prm[i * 4] = q.s0 + (q.s1 - q.s0) * t;
      prm[i * 4 + 1] = q.a * (q.fadeIn ? Math.min(1, t * 6) : 1) * (1 - t) * (1 - t * 0.3);
      prm[i * 4 + 2] = q.rot + (q.spin || 0) * q.age;
      prm[i * 4 + 3] = q.stretch || 1;
      col[i * 3] = q.r; col[i * 3 + 1] = q.gg; col[i * 3 + 2] = q.b;
    }
    this.mesh.geometry.instanceCount = w;
    this.off.needsUpdate = this.prm.needsUpdate = this.col.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.geometry.instanceCount = 0; }
}

// Ring-buffer ribbon of tyre marks
class Skids {
  constructor(scene, maxSeg = 2400) {
    this.max = maxSeg; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxSeg * 4 * 3);
    this.alpha = new Float32Array(maxSeg * 4);
    const idx = new Uint32Array(maxSeg * 6);
    for (let s = 0; s < maxSeg; s++) { const b = s * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], s * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x070707) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor=vec4(color, vA); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
  }
  add(w, x, y, z, rx, rz, a, width = 0.21) {
    const L = this.last[w];
    const lx = x + rx * width, lz = z + rz * width, qx = x - rx * width, qz = z - rz * width;
    if (L && a > 0.01) {
      const dx = x - L.x, dz = z - L.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.04) return;
      if (d2 < 9) {
        const s = this.i, b = s * 12;
        this.pos.set([L.lx, L.y, L.lz, L.qx, L.y, L.qz, lx, y, lz, qx, y, qz], b);
        this.alpha.set([L.a, L.a, a, a], s * 4);
        this.i = (this.i + 1) % this.max;
        this.dirty = true;
      }
    }
    this.last[w] = a > 0.01 ? { x, z, y, lx, lz, qx, qz, a } : null;
  }
  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }
  clear() { this.pos.fill(0); this.alpha.fill(0); this.dirty = true; this.last = [null, null, null, null]; }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Billboards(700, smokeTex(), false, scene, true);
    this.glow = new Billboards(500, softTex(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]), true, scene, false);
    this.skids = new Skids(scene);
    this.smokeColor = new THREE.Color(0xeeeeee);
    this.smokeAcc = 0;
  }
  setFog(fog) {
    for (const b of [this.smoke, this.glow]) { b.mat.uniforms.fogColor.value.copy(fog.color); b.mat.uniforms.fogDensity.value = fog.density; }
  }
  setLight(c) { this.smoke.mat.uniforms.light.value.copy(c); }
  tyreSmoke(x, y, z, vx, vz, amount, scale = 1) {
    const c = this.smokeColor;
    this.smoke.spawn({
      x: x + (Math.random() - 0.5) * 0.4, y: y + 0.25, z: z + (Math.random() - 0.5) * 0.4,
      vx: vx * 0.25 + (Math.random() - 0.5) * 2.2, vy: 0.5 + Math.random() * 1.4, vz: vz * 0.25 + (Math.random() - 0.5) * 2.2,
      age: 0, life: 2.2 + Math.random() * 1.8 * scale, s0: 0.8, s1: (4.5 + Math.random() * 3.5) * scale, a: 0.55 * amount + 0.1,
      rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.8, r: c.r, gg: c.g, b: c.b, fadeIn: true, drag: 1.1, g: 0.35,
    });
  }
  sparks(x, y, z, nx, nz, vx, vz, n = 14) {
    for (let i = 0; i < n; i++) {
      const sp = 4 + Math.random() * 9;
      this.glow.spawn({
        x, y: y + 0.3 + Math.random() * 0.4, z,
        vx: vx * 0.6 + nx * sp * 0.6 + (Math.random() - 0.5) * sp, vy: 1 + Math.random() * 4, vz: vz * 0.6 + nz * sp * 0.6 + (Math.random() - 0.5) * sp,
        age: 0, life: 0.25 + Math.random() * 0.45, s0: 0.16, s1: 0.04, a: 2.5, rot: 0, r: 1, gg: 0.62, b: 0.25, g: -14, drag: 0.6, floor: y, stretch: 2.5,
      });
    }
  }
  flame(x, y, z, dx, dz, nitro) {
    const n = nitro ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const sp = nitro ? 9 : 6;
      this.glow.spawn({
        x, y, z, vx: dx * sp * (0.6 + Math.random() * 0.6), vy: (Math.random() - 0.3) * 0.8, vz: dz * sp * (0.6 + Math.random() * 0.6),
        age: 0, life: nitro ? 0.12 + Math.random() * 0.08 : 0.08 + Math.random() * 0.1, s0: nitro ? 0.45 : 0.5, s1: 0.1, a: nitro ? 1.6 : 2.2, rot: Math.random() * 6,
        r: nitro ? 0.35 : 1.0, gg: nitro ? 0.55 : 0.5, b: nitro ? 1.0 : 0.15, drag: 3,
      });
    }
  }
  update(dt) { this.smoke.update(dt); this.glow.update(dt); this.skids.update(); }
  clear() { this.smoke.clear(); this.glow.clear(); this.skids.clear(); }
}
