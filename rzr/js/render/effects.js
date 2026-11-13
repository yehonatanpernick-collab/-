// Wheel particles (dust / mud / water / snow), tyre marks, precipitation and waterfall mist.
import * as THREE from 'three';
import { SURFACES } from '../world/collision.js';

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const PVS = /* glsl */`
attribute float size; attribute float alpha; attribute vec3 pcolor;
varying float vA; varying vec3 vC; varying float vNear;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(-mv.z, 0.1);
  vA = alpha; vC = pcolor;
  vNear = smoothstep(3.0, 11.0, -mv.z);   // vanish within ~3 m of the camera
}`;
const PFS = /* glsl */`
uniform sampler2D uTex; uniform vec3 uLight;
varying float vA; varying vec3 vC; varying float vNear;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vC * uLight, t.a * vA * vNear);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(max, scene, tex) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = { uTex: { value: tex }, uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, alpha, r, g, b, drag = 1.5, grav = -1) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.size[i] = size; this.grow[i] = grow; this.a0[i] = alpha; this.alpha[i] = alpha;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.alpha[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.alpha[i] = 0; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = g.attributes.pcolor.needsUpdate = true;
  }
}

class TyreMarks {
  constructor(scene, max = 6000) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 4 * 3); this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.07, 0.06, 0.05, vA); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
    this.dirty = false;
  }
  add(i, p, side, a) {
    const last = this.last[i];
    if (last && p.distanceTo(last.p) < 0.35) return;
    if (last && p.distanceTo(last.p) < 3) {
      const k = this.head; this.head = (this.head + 1) % this.max;
      const P = this.pos, o = k * 12;
      const w = 0.15;
      P[o] = last.p.x + last.s.x * w; P[o + 1] = last.p.y; P[o + 2] = last.p.z + last.s.z * w;
      P[o + 3] = last.p.x - last.s.x * w; P[o + 4] = last.p.y; P[o + 5] = last.p.z - last.s.z * w;
      P[o + 6] = p.x + side.x * w; P[o + 7] = p.y; P[o + 8] = p.z + side.z * w;
      P[o + 9] = p.x - side.x * w; P[o + 10] = p.y; P[o + 11] = p.z - side.z * w;
      for (let j = 0; j < 4; j++) this.alpha[k * 4 + j] = j < 2 ? last.a : a;
      this.dirty = true;
    }
    this.last[i] = { p: p.clone(), s: side.clone(), a };
  }
  cut(i) { this.last[i] = null; }
  update() {
    if (!this.dirty) return;
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = g.attributes.alpha.needsUpdate = true; this.dirty = false;
  }
}

class Precipitation {
  constructor(scene) {
    // rain: short streaks in a box that follows the camera
    const N = 7000, R = 32, Hh = 22;
    this.N = N; this.R = R; this.H = Hh;
    const pos = new Float32Array(N * 6), seeds = new Float32Array(N * 2);
    this.seeds = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.seeds[i * 3] = Math.random() * 2 * R - R; this.seeds[i * 3 + 1] = Math.random() * Hh; this.seeds[i * 3 + 2] = Math.random() * 2 * R - R; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    // snow: points
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false; this.snow.visible = false; scene.add(this.snow);
    this.t = 0;
  }
  update(dt, cam, rain, snow, wind) {
    this.t += dt;
    const { N, R, H } = this;
    this.rain.visible = rain > 0.02; this.snow.visible = snow > 0.02;
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array, n = Math.floor(N * rain);
      for (let i = 0; i < N; i++) {
        const s = this.seeds;
        if (i >= n) { p.fill(0, i * 6, i * 6 + 6); continue; }
        let y = (s[i * 3 + 1] - this.t * 14) % H; if (y < 0) y += H;
        const x = cam.x + ((s[i * 3] + wind * this.t * 2 - cam.x) % (2 * R) + 3 * R) % (2 * R) - R;
        const z = cam.z + ((s[i * 3 + 2] - cam.z) % (2 * R) + 3 * R) % (2 * R) - R;
        const yy = cam.y - H * 0.5 + y;
        p[i * 6] = x; p[i * 6 + 1] = yy; p[i * 6 + 2] = z; p[i * 6 + 3] = x + wind * 0.05; p[i * 6 + 4] = yy - 0.55; p[i * 6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.18 + 0.25 * rain;
    }
    if (this.snow.visible) {
      const p = this.snow.geometry.attributes.position.array, n = Math.floor(N * snow);
      for (let i = 0; i < N; i++) {
        const s = this.seeds;
        if (i >= n) { p[i * 3 + 1] = -1e5; continue; }
        let y = (s[i * 3 + 1] - this.t * 1.3) % H; if (y < 0) y += H;
        const sway = Math.sin(this.t * 0.8 + i) * 0.8;
        const x = cam.x + ((s[i * 3] + sway + wind * this.t * 0.8 - cam.x) % (2 * R) + 3 * R) % (2 * R) - R;
        const z = cam.z + ((s[i * 3 + 2] + Math.cos(this.t * 0.7 + i) * 0.8 - cam.z) % (2 * R) + 3 * R) % (2 * R) - R;
        p[i * 3] = x; p[i * 3 + 1] = cam.y - H * 0.5 + y; p[i * 3 + 2] = z;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}

class Effects {
  constructor(game) {
    this.game = game;
    const tex = softDot();
    this.dust = new Particles(5000, game.scene, tex);
    this.mist = new Particles(2500, game.scene, tex);
    this.marks = new TyreMarks(game.scene); this.marks.mesh.visible = false;
    this.precip = new Precipitation(game.scene);
    this.falls = [];
    for (const r of game.world.meta.rivers) for (const f of r.falls) if (f.drop > 12) this.falls.push(f);
    this.tmp = new THREE.Vector3(); this.side = new THREE.Vector3();
    this.emitAcc = 0;
  }

  update(dt, game) {
    const ph = game.phys, cam = game.camera.position;
    const sun = game.sky.sun, hemi = game.sky.hemi;
    const light = new THREE.Color().copy(hemi.color).multiplyScalar(hemi.intensity * 0.9).add(new THREE.Color().copy(sun.color).multiplyScalar(sun.intensity * 0.28));
    this.dust.uniforms.uLight.value.copy(light); this.mist.uniforms.uLight.value.copy(light);
    const scale = game.renderer.domElement.height * 0.9;
    this.dust.uniforms.uScale.value = scale; this.mist.uniforms.uScale.value = scale;
    const speed = ph.vel.length();
    const fwd = this.tmp.set(0, 0, 1).applyQuaternion(ph.quat);
    const wet = game.collision.wetness;
    ph.wheels.forEach((w, i) => {
      if (!w.contact) { this.marks.cut(i); return; }
      const surf = SURFACES[w.surface] || SURFACES.dirt;
      const slip = Math.abs(w.omega * 0.375 - ph.forwardSpeed());
      const lat = Math.abs(w.slipLat) * speed;
      const energy = speed * 0.25 + slip + lat;
      const c = surf.dust;
      // dust: just a thin, low haze at the tyre when really moving or sliding (never a cloud around the car)
      const dusty = surf.dusty * (1 - wet * 0.85);
      const dustE = Math.max(0, speed - 9) * 0.5 + Math.max(0, slip - 3) + Math.max(0, lat - 3);
      if (dusty > 0 && dustE > 1) {
        const n = Math.min(0.9, dustE * dusty * dt * 1.6);
        if (Math.random() < n) {
          this.dust.emit(w.cpos.x + (Math.random() - 0.5) * 0.3, w.cpos.y + 0.05, w.cpos.z + (Math.random() - 0.5) * 0.3,
            -fwd.x * speed * 0.08 + (Math.random() - 0.5) * 0.8, 0.12 + Math.random() * 0.25, -fwd.z * speed * 0.08 + (Math.random() - 0.5) * 0.8,
            0.9 + Math.random() * 0.7, 0.35 + Math.min(0.5, dustE * 0.02), 0.9, 0.09 * dusty, c[0], c[1], c[2], 1.8, 0.0);
        }
      }
      // mud & snow clods thrown from spinning tyres
      if ((surf.mud || surf.snow) && energy > 2) {
        const n = Math.min(2, Math.max(0, energy - 4) * dt * 4);
        for (let k = 0; k < n; k++) this.dust.emit(w.cpos.x, w.cpos.y + 0.3, w.cpos.z,
          -fwd.x * (2 + slip * 0.6) + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 3, -fwd.z * (2 + slip * 0.6) + (Math.random() - 0.5) * 2,
          0.7 + Math.random() * 0.4, surf.snow ? 0.18 : 0.12, surf.snow ? 0.3 : 0.02, 0.8, c[0], c[1], c[2], 0.4, -9);
      }
      // water: splash sheets and spray
      if (w.water > 0.04 && speed > 1) {
        const n = Math.min(3, speed * w.water * dt * 25);
        for (let k = 0; k < n; k++) {
          const sideV = (Math.random() - 0.5) * 2;
          this.dust.emit(w.cpos.x, w.cpos.y + w.water, w.cpos.z,
            fwd.z * sideV * speed * 0.35 - fwd.x * speed * 0.1, 1 + Math.random() * speed * 0.35, -fwd.x * sideV * speed * 0.35 - fwd.z * speed * 0.1,
            0.8 + Math.random() * 0.6, 0.3, 1.2, 0.7, 0.86, 0.9, 0.95, 0.6, -9);
        }
      }
      // tyre marks: soft ground always, hard ground when sliding
      const soft = surf.mud || surf.snow || w.surface === 'grass' || w.surface === 'forest' || w.surface === 'track' || w.surface === 'dirt';
      const sliding = slip > 2.5 || Math.abs(w.slipLat) > 0.18;
      if (!w.water && (soft || sliding) && speed > 0.8) {
        this.side.set(fwd.z, 0, -fwd.x).normalize();
        const a = Math.min(0.55, (soft ? 0.22 : 0) + (sliding ? 0.35 : 0) + (surf.mud ? 0.2 : 0));
        // tyre marks removed (read as black graffiti on the ground)
        this.tmp.set(0, 0, 1).applyQuaternion(ph.quat);
      } else this.marks.cut(i);
    });
    // waterfall mist near the camera
    this.emitAcc += dt;
    if (this.emitAcc > 0.05) {
      this.emitAcc = 0;
      for (const f of this.falls) {
        const d = Math.hypot(f.bottom[0] - cam.x, f.bottom[2] - cam.z);
        if (d > 700) continue;
        const n = Math.min(6, f.drop / 20);
        for (let k = 0; k < n; k++) this.mist.emit(f.bottom[0] + (Math.random() - 0.5) * 6, f.bottom[1] + Math.random() * 2, f.bottom[2] + (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 4 + Math.random() * 3, 3 + Math.random() * 3, 2.5, 0.22, 0.95, 0.97, 1.0, 0.6, 0.2);
        // falling sheet spray along the drop
        for (let k = 0; k < 2; k++) {
          const t = Math.random();
          this.mist.emit(f.top[0] + (f.bottom[0] - f.top[0]) * t, f.top[1] + (f.bottom[1] - f.top[1]) * t, f.top[2] + (f.bottom[2] - f.top[2]) * t,
            (Math.random() - 0.5) * 0.6, -2, (Math.random() - 0.5) * 0.6, 1.2, 1.2, 1.5, 0.3, 0.95, 0.97, 1, 0.3, -6);
        }
      }
    }
    this.dust.update(dt); this.mist.update(dt); this.marks.update();
    const W = game.weather;
    this.precip.update(dt, cam, W ? W.rain : 0, W ? W.snow : 0, W ? W.windSpeed : 1);
  }
}

export function create(game) { return new Effects(game); }
