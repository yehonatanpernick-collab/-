// Particles, tracers, skid marks, bullet holes, flashes, camera shake
import * as THREE from 'three';
import { scene, camera, renderer, Q } from './render.js';
import { TEX } from './world.js';
import { rnd, clamp } from './core.js';

class Particles {
  constructor(cap, additive) {
    this.cap = cap; this.n = 0;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.c = new Float32Array(cap * 4); this.sz = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap); this.drag = new Float32Array(cap); this.grav = new Float32Array(cap); this.fade = new Uint8Array(cap); this.rgb = new Float32Array(cap * 3);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage); this.ca = new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage); this.sa = new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('pcol', this.ca); g.setAttribute('size', this.sa);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.soft }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 pcol; varying vec4 vC; uniform float uScale;
        void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * uScale / max(0.1,-mv.z), 600.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 3 : 2; scene.add(this.pts);
    g.setDrawRange(0, 0);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, gg, b, a, drag = 0, grav = 0, fade = 0) {
    let i = this.n; if (i >= this.cap) i = Math.floor(Math.random() * this.cap); else this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.rgb[i * 3] = r; this.rgb[i * 3 + 1] = gg; this.rgb[i * 3 + 2] = b; this.a0[i] = a; this.drag[i] = drag; this.grav[i] = grav; this.fade[i] = fade;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { n--; this.copy(n, i); i--; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.sz[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const a = this.fade[i] ? this.a0[i] * Math.min(1, t / 0.12) * (1 - t) : this.a0[i] * (1 - t * t);
      this.c[i * 4] = this.rgb[i * 3]; this.c[i * 4 + 1] = this.rgb[i * 3 + 1]; this.c[i * 4 + 2] = this.rgb[i * 3 + 2]; this.c[i * 4 + 3] = a;
    }
    this.n = n; this.pts.geometry.setDrawRange(0, n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
    this.mat.uniforms.uScale.value = renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
  }
  copy(from, to) {
    for (const [arr, s] of [[this.p, 3], [this.v, 3], [this.rgb, 3], [this.c, 4]]) for (let k = 0; k < s; k++) arr[to * s + k] = arr[from * s + k];
    for (const arr of [this.life, this.max, this.s0, this.s1, this.a0, this.drag, this.grav, this.sz, this.fade]) arr[to] = arr[from];
  }
}
export let PFX = null, PSM = null;
let tracers = null, skids = null, holes = null;
export const muzzleLight = new THREE.PointLight(0xffb060, 0, 16, 2);
export const boomLight = new THREE.PointLight(0xff7a30, 0, 80, 1.6);
export function initFX() {
  PFX = new Particles(1500, true); PSM = new Particles(2000, false);
  scene.add(muzzleLight, boomLight);
  // tracers as thin additive quads (visible width) built from line segments
  const N = 48, pos = new Float32Array(N * 6), col = new Float32Array(N * 6);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  ls.frustumCulled = false; scene.add(ls);
  tracers = { pos, col, g, life: new Float32Array(N), i: 0, N };
  const sg = new THREE.PlaneGeometry(0.24, 0.7); sg.rotateX(-Math.PI / 2);
  const sm = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x080808, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 800);
  sm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 800; i++) sm.setMatrixAt(i, z);
  sm.frustumCulled = false; scene.add(sm); skids = { mesh: sm, i: 0 };
  // bullet holes
  const hc = document.createElement('canvas'); hc.width = hc.height = 64; const hg = hc.getContext('2d');
  const gr = hg.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.25, 'rgba(25,20,16,.95)'); gr.addColorStop(0.45, 'rgba(60,55,50,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  hg.fillStyle = gr; hg.fillRect(0, 0, 64, 64);
  const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
  const hm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshStandardMaterial({ map: ht, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 }), 200);
  for (let i = 0; i < 200; i++) hm.setMatrixAt(i, z); hm.frustumCulled = false; scene.add(hm); holes = { mesh: hm, i: 0 };
}
export function tracer(ax, ay, az, bx, by, bz, r = 1, g = 0.85, b = 0.5) {
  const T = tracers, i = T.i; T.i = (T.i + 1) % T.N;
  // start a bit ahead of the muzzle so it reads as a streak
  T.pos.set([ax, ay, az, bx, by, bz], i * 6); T.life[i] = 0.06; T.col.set([r * 2, g * 2, b * 2, r * 0.3, g * 0.3, b * 0.3], i * 6);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
export function skidMark(x, y, z, h) { _m.compose(_v.set(x, y + 0.02, z), _q.setFromEuler(_e.set(0, h, 0)), _s.set(1, 1, 1)); skids.mesh.setMatrixAt(skids.i, _m); skids.i = (skids.i + 1) % 800; skids.mesh.instanceMatrix.needsUpdate = true; }
export function bulletHole(x, y, z, nx, ny, nz) {
  _n.set(nx, ny, nz).normalize(); _q.setFromUnitVectors(_z, _n);
  const s = rnd(0.8, 1.3); _m.compose(_v.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), _q, _s.set(s, s, s));
  holes.mesh.setMatrixAt(holes.i, _m); holes.i = (holes.i + 1) % 200; holes.mesh.instanceMatrix.needsUpdate = true;
}
export function updateFX(dt) {
  PFX.update(dt); PSM.update(dt);
  const T = tracers; for (let i = 0; i < T.N; i++) if (T.life[i] > 0) { T.life[i] -= dt; if (T.life[i] <= 0) T.col.fill(0, i * 6, i * 6 + 6); }
  T.g.attributes.position.needsUpdate = true; T.g.attributes.color.needsUpdate = true;
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 500);
  boomLight.intensity = Math.max(0, boomLight.intensity - dt * 1600);
  shakeAmt = Math.max(0, shakeAmt - dt * 2.4);
}
export let shakeAmt = 0;
export function decayShake(dt) { shakeAmt = Math.max(0, shakeAmt - dt * 2.2); }
export function shake(a) { shakeAmt = Math.min(1.2, shakeAmt + a); }
export function fx_sparks(x, y, z, n) { for (let i = 0; i < n; i++) PFX.emit(x, y, z, rnd(-6, 6), rnd(1, 7), rnd(-6, 6), rnd(0.25, 0.6), 0.12, 0.03, 1, rnd(0.6, 0.85), 0.3, 1, 1, 12); }
export function fx_dust(x, y, z, n, col = [0.62, 0.57, 0.5]) { for (let i = 0; i < n; i++) PSM.emit(x + rnd(-0.5, 0.5), y + 0.2, z + rnd(-0.5, 0.5), rnd(-1.5, 1.5), rnd(0.3, 1.5), rnd(-1.5, 1.5), rnd(0.8, 1.6), 0.5, 2.6, col[0], col[1], col[2], 0.45, 1.5, -0.3, 1); }
export function fx_smoke(x, y, z, dark = 0.3, s = 1) { PSM.emit(x + rnd(-0.3, 0.3), y, z + rnd(-0.3, 0.3), rnd(-0.4, 0.4), rnd(1.2, 2.4), rnd(-0.4, 0.4), rnd(1.8, 3.2), 0.8 * s, 3.5 * s, dark, dark, dark * 1.05, 0.55, 0.6, -0.4, 1); }
export function fx_fire(x, y, z, s = 1) { PFX.emit(x + rnd(-0.4, 0.4) * s, y, z + rnd(-0.4, 0.4) * s, rnd(-0.5, 0.5), rnd(1.5, 3.5), rnd(-0.5, 0.5), rnd(0.35, 0.7), 1.3 * s, 0.3, 1, rnd(0.35, 0.6), 0.12, 0.9, 1, -2); }
export function fx_tire(x, y, z) { PSM.emit(x, y + 0.2, z, rnd(-0.6, 0.6), rnd(0.4, 1.2), rnd(-0.6, 0.6), rnd(1, 1.8), 0.6, 3.2, 0.85, 0.85, 0.86, 0.32, 1.2, -0.2, 1); }
export function fx_water(x, y, z) { for (let i = 0; i < 3; i++) PSM.emit(x, y + 0.6, z, rnd(-0.8, 0.8), rnd(7, 10), rnd(-0.8, 0.8), rnd(1.2, 1.7), 0.25, 0.9, 0.8, 0.9, 1, 0.6, 0.1, 9.8); }
export function fx_splash(x, y, z, n = 20) { for (let i = 0; i < n; i++) PSM.emit(x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(-2, 2), rnd(2, 6), rnd(-2, 2), rnd(0.6, 1.2), 0.3, 1.2, 0.85, 0.92, 1, 0.7, 0.5, 9.8); }
export function fx_hit(x, y, z, kind) {
  if (kind === 'flesh') for (let i = 0; i < 7; i++) PSM.emit(x, y, z, rnd(-1.5, 1.5), rnd(-0.5, 2), rnd(-1.5, 1.5), rnd(0.25, 0.45), 0.1, 0.05, 0.42, 0.02, 0.03, 0.9, 2, 9);
  else if (kind === 'metal') fx_sparks(x, y, z, 8);
  else for (let i = 0; i < 6; i++) PSM.emit(x, y, z, rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1), rnd(0.4, 0.8), 0.12, 0.6, 0.7, 0.66, 0.6, 0.6, 3, 3);
}
export function fx_muzzle(x, y, z, big) {
  PFX.emit(x, y, z, 0, 0, 0, 0.05, big ? 1.1 : 0.7, 0.3, 1, 0.8, 0.45, 1);
  for (let i = 0; i < 3; i++) PSM.emit(x, y, z, rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3), rnd(0.4, 0.8), 0.15, 0.6, 0.7, 0.7, 0.7, 0.25, 2, -0.2, 1);
  muzzleLight.position.set(x, y, z); muzzleLight.intensity = big ? 60 : 35;
}
export function fx_explosion(x, y, z) {
  boomLight.position.set(x, y + 2, z); boomLight.intensity = 900;
  for (let i = 0; i < 80; i++) { const a = rnd(0, 6.28), s = rnd(2, 12); PFX.emit(x, y + 1, z, Math.cos(a) * s, rnd(2, 11), Math.sin(a) * s, rnd(0.4, 1.0), rnd(2, 3.8), 0.5, 1, rnd(0.4, 0.75), 0.15, 1, 2.5, -1); }
  for (let i = 0; i < 45; i++) PSM.emit(x + rnd(-2, 2), y + rnd(0.5, 3), z + rnd(-2, 2), rnd(-3, 3), rnd(2, 6), rnd(-3, 3), rnd(2.5, 4.5), 2, 9, 0.12, 0.11, 0.1, 0.75, 1, -0.6, 1);
  fx_sparks(x, y + 1, z, 60);
}
