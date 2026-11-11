// VFX: instanced billboard particles (lit smoke / additive fire), tracers with ballistic
// visual bullets, bullet-hole & scorch decals, physics debris, ejected brass, explosions,
// building-destruction dust and ambient battlefield smoke columns.
import * as THREE from 'three';
import { raycast, heightAt, queryBoxes, F, MAT } from '../shared/world.js';
import { GRAVITY } from '../shared/config.js';

const PVERT = `
attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSRF; // size, rotation, frame
varying vec2 vUv; varying vec4 vCol; varying float vFog;
uniform float uAtlas;
void main(){
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSRF.y), s = sin(iSRF.y);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += p * iSRF.x;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(iSRF.z, 2.0), floor(iSRF.z / 2.0));
  vUv = uAtlas > 0.5 ? (uv + cell) * 0.5 : uv;
  vCol = iCol;
  vFog = -mv.z;
}`;
const PFRAG = `
uniform sampler2D tMap; uniform vec3 uLight; uniform vec3 uFogCol; uniform float uFogD; uniform float uAdd;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main(){
  vec4 t = texture2D(tMap, vUv);
  vec4 c = t * vCol;
  float f = 1.0 - exp(-uFogD * uFogD * vFog * vFog);
  if (uAdd > 0.5) { c.rgb *= c.a * (1.0 - f); gl_FragColor = vec4(c.rgb, 1.0); }
  else { c.rgb *= uLight; c.rgb = mix(c.rgb, uFogCol, f); gl_FragColor = c; }
  if (c.a < 0.003 && uAdd < 0.5) discard;
}`;

class Particles {
  constructor(scene, tex, max, additive, atlas) {
    this.max = max; this.n = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.srf = new Float32Array(max * 3);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSrf = new THREE.InstancedBufferAttribute(this.srf, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSRF', this.aSrf);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { tMap: { value: tex }, uLight: { value: new THREE.Color(1, 1, 1) }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.002 }, uAdd: { value: additive ? 1 : 0 }, uAtlas: { value: atlas ? 1 : 0 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
    this.g = g;
    this.p = []; // particle state objects
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, t: 0,
      s0: o.s0 ?? 1, s1: o.s1 ?? 2, r: o.r ?? Math.random() * 6.28, rv: o.rv ?? (Math.random() - 0.5), drag: o.drag ?? 1.5, grav: o.grav ?? 0,
      cr: o.cr ?? 1, cg: o.cg ?? 1, cb: o.cb ?? 1, a0: o.a0 ?? 1, a1: o.a1 ?? 0, fr: o.fr ?? ((Math.random() * 4) | 0), fade: o.fade ?? 0.15, buoy: o.buoy ?? 0,
    });
  }
  update(dt) {
    const keep = [];
    for (const p of this.p) {
      p.t += dt;
      if (p.t >= p.life) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - p.grav * dt + p.buoy * dt; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.r += p.rv * dt;
      keep.push(p);
    }
    this.p = keep;
    const n = keep.length;
    for (let i = 0; i < n; i++) {
      const p = keep[i], k = p.t / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const fin = Math.min(1, p.t / (p.life * p.fade + 1e-4));
      const a = (p.a0 + (p.a1 - p.a0) * k) * fin;
      this.col[i * 4] = p.cr; this.col[i * 4 + 1] = p.cg; this.col[i * 4 + 2] = p.cb; this.col[i * 4 + 3] = a;
      this.srf[i * 3] = p.s0 + (p.s1 - p.s0) * Math.sqrt(k); this.srf[i * 3 + 1] = p.r; this.srf[i * 3 + 2] = p.fr;
    }
    this.g.instanceCount = n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSrf.needsUpdate = true;
  }
}

class Decals {
  constructor(scene, tex, max, size, opts = {}) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1, ...opts });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.max = max; this.i = 0; this.size = size;
    this.q = new THREE.Quaternion(); this.m = new THREE.Matrix4(); this.n = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.spin = new THREE.Quaternion();
  }
  add(x, y, z, nx, ny, nz, size = this.size) {
    this.n.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.z, this.n);
    this.spin.setFromAxisAngle(this.z, Math.random() * 6.28);
    this.q.multiply(this.spin);
    this.p.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    this.s.set(size, size, size);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m);
    this.i = (this.i + 1) % this.max;
    this.mesh.count = Math.max(this.mesh.count, this.i === 0 ? this.max : this.i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.i = 0; }
}

class Debris {
  constructor(scene, material, max, geo) {
    this.mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1), material, max);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.max = max; this.list = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
  }
  add(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ ...o, t: 0, rest: false, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6 });
  }
  update(dt, W) {
    const keep = [];
    for (const d of this.list) {
      d.t += dt;
      if (d.t > d.life) continue;
      if (!d.rest) {
        d.vy -= GRAVITY * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.rx += d.avx * dt; d.ry += d.avy * dt; d.rz += d.avz * dt;
        let floor = heightAt(W, d.x, d.z);
        if (d.y < floor + d.sy * 0.5 + 2) {
          queryBoxes(W, d.x - 0.05, d.z - 0.05, d.x + 0.05, d.z + 0.05, F.SOLID, (b) => {
            if (d.x > b.x0 && d.x < b.x1 && d.z > b.z0 && d.z < b.z1 && b.y1 < d.y + 0.4 && b.y1 > floor) floor = b.y1;
          });
        }
        if (d.y < floor + d.sy * 0.5) {
          d.y = floor + d.sy * 0.5;
          if (Math.abs(d.vy) < 1.2) { d.rest = true; d.rx = Math.round(d.rx / (Math.PI / 2)) * Math.PI / 2; d.rz = Math.round(d.rz / (Math.PI / 2)) * Math.PI / 2; }
          d.vy = -d.vy * 0.3; d.vx *= 0.5; d.vz *= 0.5; d.avx *= 0.5; d.avz *= 0.5;
        }
      }
      keep.push(d);
    }
    this.list = keep;
    let i = 0;
    for (const d of keep) {
      const sink = Math.max(0, d.t - (d.life - 1.5)) * 0.4;
      this.e.set(d.rx, d.ry, d.rz); this.q.setFromEuler(this.e);
      this.v.set(d.x, d.y - sink, d.z); this.s.set(d.sx, d.sy, d.sz);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.c.setRGB(d.cr, d.cg, d.cb);
      this.mesh.setColorAt(i, this.c);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(gfx, W, sprites, tex, quality) {
    this.gfx = gfx; this.W = W; this.S = sprites;
    const scene = gfx.scene;
    const pm = quality.particles;
    this.qp = pm;
    this.smoke = new Particles(scene, sprites.smoke, Math.floor(1400 * pm) + 200, false, true);
    this.fire = new Particles(scene, sprites.fire, Math.floor(500 * pm) + 100, true, false);
    this.sparks = new Particles(scene, sprites.spark, Math.floor(600 * pm) + 100, true, false);
    this.flashes = new Particles(scene, sprites.muzzle, 64, true, false);
    this.holes = new Decals(scene, sprites.hole, quality.decals, 0.11);
    this.scorch = new Decals(scene, sprites.scorch, 40, 5, { color: 0xffffff });
    this.blood = new Decals(scene, sprites.blood, 40, 0.7);
    const dm = new THREE.MeshStandardMaterial({ map: tex.concrete.map, roughness: 0.95 });
    this.debris = new Debris(scene, dm, Math.floor(260 * pm) + 60);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.9, roughness: 0.3 });
    this.brass = new Debris(scene, brass, 60, new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    // tracers
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5.5, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true); this.tracerGeo.rotateX(Math.PI / 2); this.tracerGeo.translate(0, 0, -0.5);
    this.tracers = [];
    this.bullets = [];
    this.ambient = [];
    this.tmp = {};
    this.shake = 0;
  }

  // ------------------------------------------------------------ visual bullets
  bullet(o, d, vel, opts = {}) {
    // opts: tracer (bool), from (muzzle world pos for tracer start), owner, onNear
    const b = { x: o[0], y: o[1], z: o[2], vx: d[0] * vel, vy: d[1] * vel, vz: d[2] * vel, t: 0, tracer: null, opts, dist: 0, mx: 0, my: 0, mz: 0 };
    if (opts.tracer) {
      const m = this.tracers.pop() || new THREE.Mesh(this.tracerGeo, this.tracerMat);
      m.visible = true; m.renderOrder = 7;
      this.gfx.scene.add(m);
      b.tracer = m;
      const f = opts.from || o;
      b.mx = f[0] - o[0]; b.my = f[1] - o[1]; b.mz = f[2] - o[2]; // muzzle offset, converges
    }
    this.bullets.push(b);
  }
  updateBullets(dt, onImpact, listener) {
    const W = this.W, out = this.tmp;
    const keep = [];
    for (const b of this.bullets) {
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const len = sp * dt;
      const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
      const t = raycast(W, b.x, b.y, b.z, dx, dy, dz, len, F.SHOOT, out);
      let hitT = t >= 0 ? t : len;
      let flesh = null;
      if (b.opts.targets) {
        for (const tg of b.opts.targets) {
          const r = tg.ray(b.x, b.y, b.z, dx, dy, dz, hitT);
          if (r >= 0 && r < hitT) { hitT = r; flesh = tg; }
        }
      }
      const ox = b.x, oy = b.y, oz = b.z;
      if (listener && b.opts.whiz && !b.whizzed) {
        // closest approach to listener on this segment
        const lx = listener.x - ox, ly = listener.y - oy, lz = listener.z - oz;
        const tc = Math.max(0, Math.min(hitT, lx * dx + ly * dy + lz * dz));
        const cx = ox + dx * tc - listener.x, cy = oy + dy * tc - listener.y, cz = oz + dz * tc - listener.z;
        const dd = Math.hypot(cx, cy, cz);
        if (dd < 3.2 && b.dist + tc > 6) { b.whizzed = true; b.opts.whiz(ox + dx * tc, oy + dy * tc, oz + dz * tc, dd); }
      }
      b.x += dx * hitT; b.y += dy * hitT; b.z += dz * hitT;
      b.dist += hitT; b.t += dt;
      b.vy -= GRAVITY * dt;
      const conv = Math.max(0, 1 - b.dist / 25);
      if (b.tracer) {
        const tl = Math.min(b.dist, 5 + sp * 0.006);
        const tx = b.x + b.mx * conv, ty = b.y + b.my * conv, tz = b.z + b.mz * conv;
        b.tracer.position.set(tx, ty, tz);
        b.tracer.lookAt(tx + dx, ty + dy, tz + dz);
        b.tracer.scale.set(1 + b.dist * 0.004, 1 + b.dist * 0.004, tl);
      }
      const done = flesh || t >= 0 || b.t > 2.2;
      if (flesh) { this.impact(b.x, b.y, b.z, -dx, -dy, -dz, MAT.FLESH, dx, dy, dz); onImpact && onImpact(b, 'flesh'); }
      else if (t >= 0) {
        const box = out.box >= 0 ? W.boxes[out.box] : null;
        const mat = out.terrain ? MAT.DIRT : box ? box.mat : MAT.CONCRETE;
        if (box && (box.flags & F.BREAK)) {
          // glass: shatter visually, keep going
          this.glassShards(b.x, b.y, b.z, out.nx, out.ny, out.nz);
          b.x += dx * 0.05; b.y += dy * 0.05; b.z += dz * 0.05;
          onImpact && onImpact(b, 'glass', out.box);
          keep.push(b);
          continue;
        }
        this.impact(b.x, b.y, b.z, out.nx, out.ny, out.nz, mat, dx, dy, dz);
        onImpact && onImpact(b, mat);
      }
      if (done) { if (b.tracer) { b.tracer.visible = false; this.gfx.scene.remove(b.tracer); this.tracers.push(b.tracer); } }
      else keep.push(b);
    }
    this.bullets = keep;
  }

  // ------------------------------------------------------------ impacts
  impact(x, y, z, nx, ny, nz, mat, dx = 0, dy = 0, dz = 0) {
    const r = Math.random;
    const q = this.qp;
    if (mat === MAT.FLESH) {
      for (let i = 0; i < 6 * q + 2; i++) this.smoke.spawn({ x, y, z, vx: nx * 1.5 + (r() - 0.5) * 2 + dx * 2, vy: ny * 1.5 + r() * 1.5, vz: nz * 1.5 + (r() - 0.5) * 2 + dz * 2, life: 0.35 + r() * 0.3, s0: 0.08, s1: 0.45, cr: 0.45, cg: 0.03, cb: 0.02, a0: 0.9, a1: 0, drag: 4, grav: 4 });
      const t = raycast(this.W, x, y, z, dx * 0.3, -0.95, dz * 0.3, 2.5, F.SOLID, this.tmp);
      if (t >= 0 && this.tmp.ny > 0.6) this.blood.add(this.tmp.x, this.tmp.y, this.tmp.z, this.tmp.nx, this.tmp.ny, this.tmp.nz, 0.4 + r() * 0.5);
      return;
    }
    this.holes.add(x, y, z, nx, ny, nz, mat === MAT.METAL ? 0.07 : 0.1 + r() * 0.04);
    const dust = mat === MAT.DIRT ? [0.42, 0.35, 0.26] : mat === MAT.SAND ? [0.6, 0.54, 0.42] : mat === MAT.WOOD ? [0.5, 0.4, 0.28] : [0.62, 0.6, 0.56];
    if (mat !== MAT.METAL) {
      for (let i = 0; i < 3 * q + 1; i++) this.smoke.spawn({ x, y, z, vx: nx * (1 + r() * 2) + (r() - 0.5), vy: ny * (1 + r() * 2) + r() * 0.6, vz: nz * (1 + r() * 2) + (r() - 0.5), life: 0.9 + r() * 0.9, s0: 0.1, s1: 0.9 + r() * 0.6, cr: dust[0], cg: dust[1], cb: dust[2], a0: 0.55, a1: 0, drag: 3.2, buoy: 0.3 });
      for (let i = 0; i < 4 * q; i++) this.debris.add({ x, y, z, vx: nx * 3 + (r() - 0.5) * 3, vy: ny * 3 + r() * 3, vz: nz * 3 + (r() - 0.5) * 3, avx: r() * 20, avy: r() * 20, avz: r() * 20, sx: 0.025, sy: 0.02, sz: 0.03, cr: dust[0] * 0.8, cg: dust[1] * 0.8, cb: dust[2] * 0.8, life: 2 });
    }
    if (mat === MAT.METAL || mat === MAT.CONCRETE && r() < 0.4) {
      for (let i = 0; i < (mat === MAT.METAL ? 9 : 3) * q + 1; i++) {
        const sp = 4 + r() * 8;
        this.sparks.spawn({ x, y, z, vx: (nx + (r() - 0.5) * 1.4) * sp, vy: (ny + (r() - 0.5) * 1.4) * sp + 2, vz: (nz + (r() - 0.5) * 1.4) * sp, life: 0.15 + r() * 0.3, s0: 0.05, s1: 0.02, cr: 4, cg: 2.6, cb: 1.2, a0: 1, a1: 0.5, drag: 2, grav: 9, fade: 0.01 });
      }
    }
  }
  glassShards(x, y, z, nx, ny, nz) {
    const r = Math.random;
    for (let i = 0; i < 14; i++) this.debris.add({ x: x + (r() - 0.5) * 0.6, y: y + (r() - 0.5) * 0.6, z: z + (r() - 0.5) * 0.6, vx: -nx * (1 + r() * 3) + (r() - 0.5) * 2, vy: r() * 2, vz: -nz * (1 + r() * 3) + (r() - 0.5) * 2, avx: r() * 20, avy: r() * 20, avz: r() * 20, sx: 0.08 + r() * 0.1, sy: 0.006, sz: 0.06 + r() * 0.1, cr: 0.35, cg: 0.45, cb: 0.5, life: 6 });
    for (let i = 0; i < 6; i++) this.sparks.spawn({ x, y, z, vx: (r() - 0.5) * 4, vy: r() * 2, vz: (r() - 0.5) * 4, life: 0.4, s0: 0.05, s1: 0.03, cr: 0.8, cg: 0.9, cb: 1.0, a0: 0.8, a1: 0, grav: 9, fade: 0.01 });
  }
  muzzle(pos, dir, big = 1, smoke = true) {
    const r = Math.random;
    this.flashes.spawn({ x: pos.x + dir.x * 0.08, y: pos.y + dir.y * 0.08, z: pos.z + dir.z * 0.08, life: 0.05, s0: 0.45 * big, s1: 0.6 * big, cr: 3.5, cg: 2.6, cb: 1.6, a0: 1, a1: 0.6, drag: 0, fade: 0.001 });
    if (smoke) for (let i = 0; i < 2; i++) this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * (1.5 + r()) + (r() - 0.5) * 0.4, vy: dir.y * 1.5 + 0.3 + r() * 0.3, vz: dir.z * (1.5 + r()) + (r() - 0.5) * 0.4, life: 0.8 + r() * 0.6, s0: 0.08 * big, s1: 0.6 * big, cr: 0.7, cg: 0.7, cb: 0.7, a0: 0.18, a1: 0, drag: 2.5, buoy: 0.4 });
    this.gfx.flashLight(pos, 0xffa850, 6 * big, 9 * big, 0.06);
  }
  ejectBrass(pos, right, up, vel = 2.5, big = 1) {
    const r = Math.random;
    this.brass.add({ x: pos.x, y: pos.y, z: pos.z, vx: right.x * vel + up.x * 1.4 + (r() - 0.5) * 0.4, vy: right.y * vel + up.y * 1.4 + 1.2, vz: right.z * vel + up.z * 1.4 + (r() - 0.5) * 0.4, avx: 25 * r(), avy: 25 * r(), avz: 25 * r(), sx: 0.011 * big, sy: 0.045 * big, sz: 0.011 * big, cr: 1, cg: 0.85, cb: 0.55, life: 4 });
  }

  // ------------------------------------------------------------ explosions & destruction
  explosion(x, y, z, scale = 1, type = 'gl') {
    const r = Math.random, q = this.qp;
    const v = new THREE.Vector3(x, y, z);
    this.gfx.flashLight(v.clone().setY(y + 1), 0xffa040, 60 * scale, 30 * scale, 0.45);
    // fireball
    for (let i = 0; i < 16 * scale; i++) {
      const a = r() * 6.28, e = r() * 1.2 - 0.2, sp = (4 + r() * 9) * scale;
      this.fire.spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 3, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.35 + r() * 0.35, s0: 1.2 * scale, s1: (3.5 + r() * 2) * scale, cr: 3.2, cg: 1.7, cb: 0.6, a0: 1, a1: 0, drag: 5, buoy: 3, fade: 0.05 });
    }
    this.fire.spawn({ x, y: y + 0.5, z, life: 0.12, s0: 4 * scale, s1: 9 * scale, cr: 6, cg: 5, cb: 4, a0: 1, a1: 0, drag: 0, fade: 0.001 });
    // smoke plume
    for (let i = 0; i < 22 * scale * q + 6; i++) {
      const a = r() * 6.28, sp = (1 + r() * 6) * scale;
      const g = 0.16 + r() * 0.12;
      this.smoke.spawn({ x: x + (r() - 0.5) * 2, y: y + r() * 2, z: z + (r() - 0.5) * 2, vx: Math.cos(a) * sp, vy: 1.5 + r() * 5 * scale, vz: Math.sin(a) * sp, life: 5 + r() * 6, s0: 2 * scale, s1: (7 + r() * 6) * scale, cr: g, cg: g * 0.96, cb: g * 0.92, a0: 0.85, a1: 0, drag: 1.2, buoy: 0.6, fade: 0.04 });
    }
    // ground dust ring
    for (let i = 0; i < 18 * q + 4; i++) {
      const a = (i / 18) * 6.28, sp = 9 * scale;
      this.smoke.spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 0.5, vz: Math.sin(a) * sp, life: 2.5 + r() * 2, s0: 1.2, s1: 5 * scale, cr: 0.55, cg: 0.49, cb: 0.4, a0: 0.6, a1: 0, drag: 2.4, buoy: 0.2 });
    }
    // sparks / embers
    for (let i = 0; i < 30 * q * scale; i++) {
      const a = r() * 6.28, e = r() * 1.4, sp = 10 + r() * 22;
      this.sparks.spawn({ x, y: y + 0.4, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.6 + r() * 1.4, s0: 0.12, s1: 0.04, cr: 4, cg: 2, cb: 0.6, a0: 1, a1: 0.3, drag: 1.5, grav: 9.8, fade: 0.01 });
    }
    // debris
    for (let i = 0; i < 12 * q * scale; i++) {
      const a = r() * 6.28, sp = 4 + r() * 10, s = 0.06 + r() * 0.18;
      this.debris.add({ x, y: y + 0.4, z, vx: Math.cos(a) * sp, vy: 4 + r() * 9, vz: Math.sin(a) * sp, avx: r() * 15, avy: r() * 15, avz: r() * 15, sx: s, sy: s * 0.7, sz: s * 1.2, cr: 0.32, cg: 0.29, cb: 0.25, life: 10 });
    }
    // scorch
    const h = heightAt(this.W, x, z);
    if (Math.abs(h - y) < 1.5) this.scorch.add(x, h + 0.02, z, 0, 1, 0, 3.5 * scale + r());
    else {
      const t = raycast(this.W, x, y + 0.5, z, 0, -1, 0, 2, F.SOLID, this.tmp);
      if (t >= 0) this.scorch.add(this.tmp.x, this.tmp.y, this.tmp.z, 0, 1, 0, 3 * scale);
    }
    void type;
  }
  panelBreak(P, color, crush = false) {
    const r = Math.random, q = this.qp;
    const c = new THREE.Color(color);
    const W = this.W;
    let cnt = 0;
    for (const bi of P.boxes) {
      const b = W.boxes[bi];
      if (!b.flags) continue;
      const vol = (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0);
      const n = Math.min(10, Math.ceil(vol * 7 * q));
      for (let i = 0; i < n; i++) {
        const s = 0.15 + r() * 0.35;
        const px = b.x0 + r() * (b.x1 - b.x0), py = b.y0 + r() * (b.y1 - b.y0), pz = b.z0 + r() * (b.z1 - b.z0);
        const out = crush ? 1.5 : 3.5;
        this.debris.add({ x: px, y: py, z: pz, vx: P.nx * out * (r() + 0.3) + (r() - 0.5) * 3, vy: r() * 3, vz: P.nz * out * (r() + 0.3) + (r() - 0.5) * 3, avx: r() * 8, avy: r() * 8, avz: r() * 8, sx: s * 1.4, sy: s, sz: s * 0.9, cr: c.r * 0.9, cg: c.g * 0.9, cb: c.b * 0.9, life: 14 + r() * 8 });
        cnt++;
      }
    }
    for (let i = 0; i < 10 * q + 3; i++) {
      const g = 0.5 + r() * 0.15;
      this.smoke.spawn({ x: P.cx + (r() - 0.5) * 3, y: P.cy + (r() - 0.5) * 2.5, z: P.cz + (r() - 0.5) * 3, vx: P.nx * 2 + (r() - 0.5) * 2, vy: -0.3 + r() * 0.8, vz: P.nz * 2 + (r() - 0.5) * 2, life: 4 + r() * 4, s0: 1.5, s1: 5 + r() * 3, cr: g * c.r * 1.1, cg: g * c.g * 1.05, cb: g * c.b, a0: 0.75, a1: 0, drag: 1.6, buoy: 0.15, fade: 0.05 });
    }
    void cnt;
  }
  collapseDust(B) {
    const r = Math.random, q = this.qp;
    const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, w = B.x1 - B.x0, d = B.z1 - B.z0, h = B.top - B.by;
    for (let i = 0; i < (60 + h * 3) * q + 10; i++) {
      const g = 0.5 + r() * 0.15;
      const px = cx + (r() - 0.5) * w * 1.2, pz = cz + (r() - 0.5) * d * 1.2;
      this.smoke.spawn({ x: px, y: B.by + r() * h, z: pz, vx: (px - cx) * 0.5 + (r() - 0.5) * 3, vy: r() * 2, vz: (pz - cz) * 0.5 + (r() - 0.5) * 3, life: 8 + r() * 8, s0: 4, s1: 12 + r() * 10, cr: g, cg: g * 0.95, cb: g * 0.88, a0: 0.9, a1: 0, drag: 0.8, buoy: 0.3, fade: 0.03 });
    }
    for (let i = 0; i < 40 * q; i++) {
      const s = 0.3 + r() * 0.6;
      this.debris.add({ x: cx + (r() - 0.5) * w, y: B.by + r() * h, z: cz + (r() - 0.5) * d, vx: (r() - 0.5) * 8, vy: r() * 3, vz: (r() - 0.5) * 8, avx: r() * 5, avy: r() * 5, avz: r() * 5, sx: s * 1.5, sy: s, sz: s, cr: 0.55, cg: 0.52, cb: 0.48, life: 20 });
    }
    this.shake = Math.max(this.shake, 0.6);
  }
  rocketTrail(x, y, z, type) {
    const r = Math.random;
    if (type === 'rocket' || type === 'shell') {
      const g = 0.75;
      this.smoke.spawn({ x, y, z, vx: (r() - 0.5) * 0.4, vy: 0.3, vz: (r() - 0.5) * 0.4, life: type === 'rocket' ? 2.5 : 0.6, s0: 0.25, s1: type === 'rocket' ? 1.8 : 0.8, cr: g, cg: g, cb: g, a0: 0.5, a1: 0, drag: 1, buoy: 0.3 });
      if (type === 'rocket') this.fire.spawn({ x, y, z, life: 0.06, s0: 0.5, s1: 0.2, cr: 4, cg: 2.5, cb: 1, a0: 1, a1: 0, fade: 0.001 });
    } else if (type === 'gl') {
      this.smoke.spawn({ x, y, z, life: 0.6, s0: 0.08, s1: 0.35, cr: 0.7, cg: 0.7, cb: 0.7, a0: 0.25, a1: 0, drag: 1 });
    }
  }
  fireSmoke(x, y, z, k = 1) {
    const r = Math.random;
    if (r() < 0.6) this.fire.spawn({ x: x + (r() - 0.5) * 1.2, y: y + r() * 0.5, z: z + (r() - 0.5) * 1.2, vx: (r() - 0.5) * 0.5, vy: 1.5 + r() * 1.5, vz: (r() - 0.5) * 0.5, life: 0.5 + r() * 0.4, s0: 0.8 * k, s1: 0.3 * k, cr: 3, cg: 1.4, cb: 0.4, a0: 0.9, a1: 0, drag: 1, fade: 0.1 });
    const g = 0.1 + r() * 0.08;
    this.smoke.spawn({ x: x + (r() - 0.5), y: y + 0.6, z: z + (r() - 0.5), vx: 0.6 + (r() - 0.5) * 0.4, vy: 2 + r() * 1.5, vz: 0.3 + (r() - 0.5) * 0.4, life: 6 + r() * 4, s0: 1 * k, s1: 6 * k, cr: g, cg: g, cb: g, a0: 0.7, a1: 0, drag: 0.4, buoy: 0.2 });
  }
  addAmbientSmoke(x, y, z, k) { this.ambient.push({ x, y, z, k, acc: 0 }); }

  update(dt, cam) {
    // ambient smoke columns
    for (const a of this.ambient) {
      a.acc += dt;
      if (a.acc > 0.25 / Math.max(0.3, this.qp)) {
        a.acc = 0;
        const r = Math.random, g = 0.16 + r() * 0.1;
        this.smoke.spawn({ x: a.x + (r() - 0.5) * 2, y: a.y, z: a.z + (r() - 0.5) * 2, vx: 1.2 + r() * 0.6, vy: 2.5 + r(), vz: 0.4 + r() * 0.4, life: 16 + r() * 6, s0: 2 * a.k, s1: 16 * a.k, cr: g, cg: g * 0.97, cb: g * 0.93, a0: 0.6, a1: 0, drag: 0.05, buoy: 0.05, fade: 0.08 });
        if (r() < 0.5) this.fire.spawn({ x: a.x + (r() - 0.5) * 1.5, y: a.y, z: a.z + (r() - 0.5) * 1.5, vy: 1.5, life: 0.7, s0: 1.5 * a.k, s1: 0.5, cr: 3, cg: 1.3, cb: 0.4, a0: 0.8, a1: 0, fade: 0.1 });
      }
    }
    const fog = this.gfx.scene.fog;
    const sunI = 0.9;
    for (const p of [this.smoke, this.fire, this.sparks, this.flashes]) {
      p.mat.uniforms.uFogCol.value.copy(fog.color);
      p.mat.uniforms.uFogD.value = fog.density;
      if (p === this.smoke) p.mat.uniforms.uLight.value.setRGB(1.05 * sunI, 0.98 * sunI, 0.9 * sunI);
      p.update(dt);
    }
    this.debris.update(dt, this.W);
    this.brass.update(dt, this.W);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    void cam;
  }
  clearDecals() { this.holes.clear(); this.scorch.clear(); this.blood.clear(); }
}
