// Terrain sun shadows for the whole world: a GPU pass ray-marches the heightfield toward
// the sun for every texel of a core map (8.2 km, 8 m texels) and a far map (41 km, 80 m),
// producing soft penumbra shadows (SDF-style min of clearance / distance). Every lit
// material samples it in lights_fragment_end (see atmosphere.js), so mountains throw long
// shadows across valleys, onto trees, grass, water and the car. Rebuilt in strips across
// frames as the sun moves, so the cost never lands on a single frame.
import * as THREE from 'three';
import { HEIGHT_GLSL } from './glsl.js';
import { TERRAIN_SHADOW_RT } from './atmosphere.js';

const FS = /* glsl */`
${HEIGHT_GLSL}
uniform vec3 uSun;        // direction toward the light
uniform vec2 uCenter;     // world centre of this map
uniform float uExtent;    // world size covered
uniform float uMaxDist;   // ray length
in vec2 vUv;
out vec4 outColor;
float hBil(vec2 p) {
  float w = coreWeight(p);
  vec2 g; vec2 fl; vec2 t; float a, b, c, d;
  float hc = 0.0, hf = 0.0;
  if (w > 0.0) {
    g = (p + CORE_HALF) / CORE_CELL; fl = floor(g); t = g - fl;
    int i = int(fl.x), j = int(fl.y);
    a = hCore(i, j); b = hCore(i + 1, j); c = hCore(i, j + 1); d = hCore(i + 1, j + 1);
    hc = mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  if (w < 1.0) {
    g = (p + FAR_HALF) / FAR_CELL; fl = floor(g); t = g - fl;
    int i = int(fl.x), j = int(fl.y);
    a = hFar(i, j); b = hFar(i + 1, j); c = hFar(i, j + 1); d = hFar(i + 1, j + 1);
    hf = mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  return mix(hf, hc, w);
}
void main() {
  vec2 p = uCenter + (vUv - 0.5) * uExtent;
  // start slightly above the averaged surface so a texel does not shadow itself
  float h0 = max(max(hBil(p), hBil(p + vec2(uExtent / 1024.0, 0.0))), hBil(p + vec2(0.0, uExtent / 1024.0))) + 2.0;
  vec3 L = normalize(uSun);
  vec2 dir = normalize(L.xz + 1e-6);
  float tanE = L.y / max(length(L.xz), 1e-4);
  float lit = 1.0;
  float t = uExtent / 1500.0;
  for (int i = 0; i < 56; i++) {
    vec2 q = p + dir * t;
    float ray = h0 + t * tanE;
    float clear = ray - hBil(q);
    // penumbra widens with distance (sun disc ~0.5 deg, plus atmospheric softening)
    lit = min(lit, clamp(clear / (t * 0.035 + 4.0), 0.0, 1.0));
    if (lit <= 0.0 || ray > 4800.0 || t > uMaxDist) break;
    t *= 1.085;
    t += uExtent / 4000.0;
  }
  outColor = vec4(lit * lit * (3.0 - 2.0 * lit), 0.0, 0.0, 1.0);
}`;

const VS = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class TerrainShadow {
  constructor(renderer, terrain) {
    this.renderer = renderer;
    this.maps = [
      { rt: TERRAIN_SHADOW_RT[0], center: new THREE.Vector2(0, 0), extent: 8192, maxDist: 9000, strips: 8 },
      { rt: TERRAIN_SHADOW_RT[1], center: new THREE.Vector2(0, 0), extent: 40960, maxDist: 16000, strips: 4 },
    ];
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'precision highp float;\nin vec3 position; in vec2 uv;\n' + VS,
      fragmentShader: 'precision highp float;\nprecision highp int;\nprecision highp usampler2D;\n' + FS,
      uniforms: {
        uHeightCore: terrain.uniforms.uHeightCore, uHeightFar: terrain.uniforms.uHeightFar,
        uMaskA: terrain.uniforms.uMaskA, uMaskB: terrain.uniforms.uMaskB,
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uCenter: { value: new THREE.Vector2() },
        uExtent: { value: 1 }, uMaxDist: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.Camera();
    this.sun = new THREE.Vector3(9, 9, 9);   // direction of the current build
    this.pending = new THREE.Vector3();
    this.job = null;                         // { map index, strip }
    this.first = true;
  }

  _renderStrip(m, s) {
    const r = this.renderer, n = m.rt.width, h = Math.ceil(n / m.strips);
    const u = this.mat.uniforms;
    u.uSun.value.copy(this.pending); u.uCenter.value.copy(m.center); u.uExtent.value = m.extent; u.uMaxDist.value = m.maxDist;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = false;
    m.rt.scissorTest = true;
    m.rt.scissor.set(0, s * h, n, h); m.rt.viewport.set(0, 0, n, n);
    r.setRenderTarget(m.rt);
    r.render(this.scene, this.cam);
    m.rt.scissorTest = false;
    r.setRenderTarget(prevRT); r.autoClear = prevAuto;
  }

  update(lightDir) {
    if (!this.job) {
      if (this.sun.angleTo(lightDir) < 0.0035 && !this.first) return;   // ~0.2 deg
      this.pending.copy(lightDir);
      this.job = { m: 0, s: 0 };
    }
    // the first build happens at once; later rebuilds spread one strip per frame
    const budget = this.first ? 64 : 1;
    for (let k = 0; k < budget && this.job; k++) {
      const m = this.maps[this.job.m];
      this._renderStrip(m, this.job.s);
      if (++this.job.s >= m.strips) { this.job.s = 0; if (++this.job.m >= this.maps.length) { this.job = null; this.sun.copy(this.pending); } }
    }
    this.first = false;
  }
}
