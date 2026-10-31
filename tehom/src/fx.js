import * as THREE from 'three';
import * as G from './glsl.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
const Z = new THREE.Vector3(0, 0, 1);

export class Particles {
  constructor(scene, cap = 40000) {
    this.cap = cap; this.i = 0; this.time = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.data = new Float32Array(cap * 4).fill(-999);
    this.col = new Float32Array(cap * 4);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aVel', this.aVel);
    g.setAttribute('aData', this.aData); g.setAttribute('aColor', this.aCol);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: G.PART_VERT, fragmentShader: G.PART_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.lo = Infinity; this.hi = -1;
  }
  // kind: 0 spark/trail, 1 smoke, 2 flash
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, kind = 0, drag = 0) {
    const i = this.i; this.i = (i + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.data[i * 4] = this.time; this.data[i * 4 + 1] = life; this.data[i * 4 + 2] = size; this.data[i * 4 + 3] = drag;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = kind;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }
  flush(time, scale) {
    this.time = time;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = scale;
    if (this.hi < 0) return;
    for (const [a, n] of [[this.aPos, 3], [this.aVel, 3], [this.aData, 4], [this.aCol, 4]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.lo * n, (this.hi - this.lo + 1) * n);
      a.needsUpdate = true;
    }
    this.lo = Infinity; this.hi = -1;
  }
}

export class Beams {
  constructor(scene, cap = 260) {
    this.cap = cap; this.list = [];
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2);
    const mk = () => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: true }), cap);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.frustumCulled = false; m.count = 0; scene.add(m); return m;
    };
    this.core = mk(); this.glow = mk();
    this.c = new THREE.Color();
  }
  add(a, b, color, width = 0.12, life = 0.22, intensity = 6) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ a: a.clone(), b: b.clone(), color, width, life, t: 0, intensity });
  }
  update(dt) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const B = this.list[i];
      B.t += dt;
      if (B.t >= B.life) { this.list.splice(i, 1); continue; }
    }
    for (const B of this.list) {
      const k = 1 - B.t / B.life;
      _v.subVectors(B.b, B.a);
      const len = _v.length();
      _q.setFromUnitVectors(Z, _v.divideScalar(len || 1));
      _s.set(B.width, B.width, len);
      _m.compose(B.a, _q, _s);
      this.core.setMatrixAt(n, _m);
      this.c.copy(B.color).multiplyScalar(B.intensity * k * k + 0.6 * k);
      this.c.lerp(new THREE.Color(B.intensity * k, B.intensity * k, B.intensity * k), 0.35);
      this.core.setColorAt(n, this.c);
      _s.set(B.width * 4.5, B.width * 4.5, len);
      _m.compose(B.a, _q, _s);
      this.glow.setMatrixAt(n, _m);
      this.c.copy(B.color).multiplyScalar(0.55 * k);
      this.glow.setColorAt(n, this.c);
      n++;
    }
    for (const m of [this.core, this.glow]) {
      m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    }
  }
}

export class Shocks {
  constructor(scene, cap = 48) {
    this.pool = [];
    const geo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < cap; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 1 }, uCol: { value: new THREE.Color() } },
        vertexShader: G.CORONA_VERT, fragmentShader: G.SHOCK_FRAG,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat); m.visible = false; scene.add(m);
      this.pool.push({ m, t: 1, life: 1, size: 1 });
    }
    this.k = 0;
  }
  add(pos, size, color, life = 0.9) {
    const s = this.pool[this.k]; this.k = (this.k + 1) % this.pool.length;
    s.m.position.copy(pos); s.m.visible = true;
    s.m.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.9, 0, Math.random() * 6);
    s.m.material.uniforms.uCol.value.copy(color).multiplyScalar(2.2);
    s.t = 0; s.life = life; s.size = size;
  }
  update(dt) {
    for (const s of this.pool) {
      if (!s.m.visible) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) { s.m.visible = false; continue; }
      s.m.scale.setScalar(s.size * (0.15 + 1.0 - Math.pow(1 - k, 3)));
      s.m.material.uniforms.uT.value = k;
    }
  }
}

// a handful of real lights that flare during big explosions and light up nearby hulls
export class Flares {
  constructor(scene, n = 4) {
    this.l = [];
    for (let i = 0; i < n; i++) {
      const p = new THREE.PointLight(0xffa860, 0, 90, 1.6);
      scene.add(p); this.l.push({ p, t: 1, life: 1, peak: 0 });
    }
    this.k = 0;
  }
  add(pos, peak, color, life = 0.7) {
    const f = this.l[this.k]; this.k = (this.k + 1) % this.l.length;
    f.p.position.copy(pos); f.p.color.copy(color); f.t = 0; f.life = life; f.peak = peak;
  }
  update(dt) {
    for (const f of this.l) {
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.p.intensity = f.peak * Math.pow(1 - k, 2) * 16;
    }
  }
}

export class FX {
  constructor(scene) {
    this.p = new Particles(scene);
    this.beams = new Beams(scene);
    this.shocks = new Shocks(scene);
    this.flares = new Flares(scene);
    this.shake = 0;
  }
  explosion(pos, scale, color, camPos) {
    const P = this.p;
    const n = Math.floor(18 + scale * 26);
    // flash
    P.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.3 + scale * 0.1, 2.5 + scale * 3.5, 2.6, 2.0, 1.5, 2);
    P.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.8 + scale * 0.3, 2 + scale * 3, color.r * 1.4, color.g * 1.1, color.b, 2);
    // sparks
    for (let i = 0; i < n; i++) {
      _v.randomDirection().multiplyScalar((10 + Math.random() * 30) * (0.6 + scale * 0.5));
      const hot = Math.random();
      P.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 0.6 + Math.random() * 0.9, 0.35 + Math.random() * 0.4 * scale,
        3.2, 1.4 + hot, 0.5 + hot * 0.3, 0, 2.2);
    }
    // smoke & embers
    for (let i = 0; i < n * 0.5; i++) {
      _v.randomDirection().multiplyScalar(2 + Math.random() * 6 * scale);
      P.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 1.6 + Math.random() * 2, 2.5 + scale * 3 * Math.random(),
        0.16, 0.12, 0.1, 1, 0.8);
    }
    // slow debris
    for (let i = 0; i < 4 + scale * 6; i++) {
      _v.randomDirection().multiplyScalar(3 + Math.random() * 8);
      P.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 3 + Math.random() * 3, 0.5, 1.4, 0.55, 0.25, 0, 0.3);
    }
    if (scale >= 1) {
      this.shocks.add(pos, 6 + scale * 9, color, 0.8 + scale * 0.25);
      this.flares.add(pos, scale, new THREE.Color(1, 0.62, 0.32), 0.6 + scale * 0.2);
    }
    if (camPos && scale >= 2) {
      const d = camPos.distanceTo(pos);
      this.shake = Math.min(1.2, this.shake + scale * 30 / Math.max(d, 30));
    }
  }
  sparks(pos, color, n = 6) {
    for (let i = 0; i < n; i++) {
      _v.randomDirection().multiplyScalar(8 + Math.random() * 16);
      this.p.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, 0.25 + Math.random() * 0.35, 0.28, color.r * 3, color.g * 3, color.b * 3, 0, 3);
    }
    this.p.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.15, 1.4, color.r * 2, color.g * 2, color.b * 2, 2);
  }
  update(dt, time, scale) {
    this.beams.update(dt);
    this.shocks.update(dt);
    this.flares.update(dt);
    this.p.flush(time, scale);
    this.shake *= Math.exp(-dt * 5);
  }
}
