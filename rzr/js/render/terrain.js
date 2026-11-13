// CDLOD terrain: one instanced draw call covering 40 km, 1 m vertices near the
// camera, vertex morphing between LOD levels (no cracks / popping), bicubic height
// sampled from integer textures in the vertex shader, and a PBR splat material
// (8 scanned layers, height-blended, anti-tiled, triplanar on cliffs).
import * as THREE from 'three';
import { HEIGHT_GLSL } from './glsl.js';
import { WORLD } from '../world/heightfield.js';

const G = 32;                 // grid cells per node
const LEAF = 32;              // leaf node size (m) -> 1 m vertices
const LEVELS = 12;            // root = 32 * 2^11 = 65536 m
const MAX_INSTANCES = 3000;

function makeGrid() {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((G + 1) * (G + 1) * 3);
  let k = 0;
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { pos[k++] = i; pos[k++] = 0; pos[k++] = j; }
  const idx = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
    // alternate diagonals for isotropic shading
    if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('node', inst);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

function u16Texture(data, n) {
  const t = new THREE.DataTexture(data, n, n, THREE.RedIntegerFormat, THREE.UnsignedShortType);
  t.internalFormat = 'R16UI';
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function splitMasks(masks, n) {
  const a = new Uint8Array(n * n * 4), b = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    a[k * 4] = masks[k * 8]; a[k * 4 + 1] = masks[k * 8 + 1]; a[k * 4 + 2] = masks[k * 8 + 2]; a[k * 4 + 3] = masks[k * 8 + 3];
    b[k * 4] = masks[k * 8 + 4]; b[k * 4 + 1] = masks[k * 8 + 5]; b[k * 4 + 2] = masks[k * 8 + 6]; b[k * 4 + 3] = masks[k * 8 + 7];
  }
  const mk = (d) => {
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true; return t;
  };
  return [mk(a), mk(b)];
}

// normal (xyz) + cavity AO (w) from a u16 height grid
function normalTexture(h, n, cell) {
  const H = (i, j) => h[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))] * WORLD.hUnit;
  const out = new Uint8Array(n * n * 4);
  // local mean for cavity term (separable box, radius 6 cells)
  const R = 6, tmp = new Float32Array(n * n), mean = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    let s = 0; for (let i = -R; i <= R; i++) s += H(i, j);
    for (let i = 0; i < n; i++) { tmp[j * n + i] = s / (2 * R + 1); s += H(i + R + 1, j) - H(i - R, j); }
  }
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = -R; j <= R; j++) s += tmp[Math.min(n - 1, Math.max(0, j)) * n + i];
    for (let j = 0; j < n; j++) { mean[j * n + i] = s / (2 * R + 1); s += tmp[Math.min(n - 1, j + R + 1) * n + i] - tmp[Math.max(0, j - R) * n + i]; }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * cell;
    const l = Math.hypot(nx, ny, nz), k = (j * n + i) * 4;
    out[k] = (nx / l * 0.5 + 0.5) * 255; out[k + 1] = (ny / l * 0.5 + 0.5) * 255; out[k + 2] = (nz / l * 0.5 + 0.5) * 255;
    const cav = (H(i, j) - mean[j * n + i]) / (cell * 3);
    out[k + 3] = Math.max(0, Math.min(1, 0.82 + cav)) * 255;
  }
  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export async function loadArrayTexture(url, layers, srgb, maxAniso) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w = img.width, h = img.height / layers;
  const c = document.createElement('canvas'); c.width = w; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, img.height).data; // opaque JPG: no premultiply loss
  const t = new THREE.DataArrayTexture(new Uint8Array(data.buffer), w, h, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const SPLAT_GLSL = /* glsl */`
uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uNormal;
uniform highp sampler2DArray uARM;
uniform sampler2D uNormCore;
uniform sampler2D uNormFar;
uniform vec3 uLayerAvg[8];
uniform vec4 uWeather;   // x wetness, y snow cover, z time, w puddles
varying vec3 vWorld;
varying float vDist;

const float TILE[8] = float[8](7.0, 9.0, 5.5, 14.0, 6.5, 4.5, 8.0, 4.0);

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// two-scale sample to break tiling
void sampleLayer(int L, vec2 p, float far, float mixN, out vec3 alb, out vec3 nrm, out vec3 arm) {
  float t = TILE[L];
  vec2 uv1 = p / t;
  vec2 uv2 = rot2(p, 0.73) / (t * 3.7);
  vec3 a1 = texture(uAlbedo, vec3(uv1, float(L))).rgb;
  vec3 a2 = texture(uAlbedo, vec3(uv2, float(L))).rgb;
  vec3 n1 = texture(uNormal, vec3(uv1, float(L))).rgb * 2.0 - 1.0;
  vec3 m1 = texture(uARM, vec3(uv1, float(L))).rgb;
  vec3 m2 = texture(uARM, vec3(uv2, float(L))).rgb;
  float k = mix(0.35, 0.65, mixN);
  alb = mix(a1, a2 * (dot(a1, vec3(0.333)) / max(dot(a2, vec3(0.333)), 0.02)), k * 0.6);
  alb = mix(alb, uLayerAvg[L], far);
  nrm = mix(n1, vec3(0.0, 0.0, 1.0), far * 0.8);
  arm = mix(m1, m2, k * 0.5);
}

vec3 triA(vec3 P, vec3 bw, float t) {
  return texture(uAlbedo, vec3(P.zy * t, 3.0)).rgb * bw.x + texture(uAlbedo, vec3(P.xz * t, 3.0)).rgb * bw.y + texture(uAlbedo, vec3(P.xy * t, 3.0)).rgb * bw.z;
}
void sampleRockTri(vec3 P, vec3 N, float far, out vec3 alb, out vec3 nrm, out vec3 arm) {
  vec3 bw = pow(abs(N), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  float t = 1.0 / TILE[3], tL = t * 0.25;
  // large-scale structure everywhere, fine detail fading in close up
  float nearK = 1.0 - smoothstep(40.0, 260.0, vDist);
  vec3 aL = triA(P + vec3(13.0, 0.0, 7.0), bw, tL);
  vec3 aS = triA(P, bw, t);
  alb = mix(aL, aS * (dot(aL, vec3(0.333)) / max(dot(aS, vec3(0.333)), 0.03)), 0.65 * nearK);
  // pale limestone <-> darker granite bands at the kilometre scale
  float geo = vnoiseD(P.xz * 0.0016 + 3.0).x * 0.7 + vnoiseD(P.xz * 0.006 - 9.0).x * 0.3;
  alb *= mix(vec3(0.3, 0.29, 0.28), vec3(0.62, 0.6, 0.57), smoothstep(0.25, 0.75, geo));
  // horizontal strata (limestone bedding) give walls ledge structure at range
  float strata = sin(P.y * 0.21 + vnoiseD(P.xz * 0.01 + 40.0).x * 6.0) * 0.5 + 0.5;
  alb *= 0.86 + 0.22 * strata;
  alb = mix(alb, uLayerAvg[3], far);
  vec3 nx = texture(uNormal, vec3(P.zy * t, 3.0)).rgb * 2.0 - 1.0, ny = texture(uNormal, vec3(P.xz * t, 3.0)).rgb * 2.0 - 1.0, nz = texture(uNormal, vec3(P.xy * t, 3.0)).rgb * 2.0 - 1.0;
  vec3 mx = texture(uARM, vec3(P.zy * t, 3.0)).rgb, my = texture(uARM, vec3(P.xz * t, 3.0)).rgb, mz = texture(uARM, vec3(P.xy * t, 3.0)).rgb;
  vec3 wx = vec3(0.0, nx.y, nx.x) * sign(N.x), wy = vec3(ny.x, 0.0, ny.y) * sign(N.y), wz = vec3(nz.x, nz.y, 0.0) * sign(N.z);
  nrm = (wx * bw.x + wy * bw.y + wz * bw.z) * (1.0 - far * 0.8) * (0.4 + 0.6 * nearK);
  arm = mx * bw.x + my * bw.y + mz * bw.z;
}

vec3 terrN; float terrRough; float terrAO;
void terrainSplat(out vec3 albedoOut) {
  vec3 P = vWorld;
  vec2 p = P.xz;
  float cw = coreWeight(p);
  vec4 nc = texture(uNormCore, ((p + CORE_HALF) / CORE_CELL + 0.5) / float(CORE_N));
  vec4 nf = texture(uNormFar, ((p + FAR_HALF) / FAR_CELL + 0.5) / float(FAR_N));
  vec4 nn = mix(nf, nc, cw);
  vec3 N = normalize(nn.xyz * 2.0 - 1.0);
  float cav = nn.w;
  vec4 ma = cw > 0.0 ? texture(uMaskA, maskUV(p)) : vec4(0.2, 0.1, 0.0, 0.0);
  vec4 mb = cw > 0.0 ? texture(uMaskB, maskUV(p)) : vec4(0.0, 0.0, 0.0, 0.3);
  // micro relief normal (same noise the wheels feel)
  if (vDist < 160.0 && cw > 0.0) {
    vec3 d = detailNoiseD(p, mb.r, mb.a) * (1.0 - smoothstep(90.0, 160.0, vDist));
    N = normalize(N + vec3(-d.y, 0.0, -d.z));
  }
  float far = smoothstep(900.0, 5200.0, vDist) * 0.8;
  float h = P.y;
  float slope = 1.0 - N.y;
  vec3 nz3 = vnoiseD(p * 0.045 + 500.0);
  float n1 = nz3.x;
  // in the far ring there are no baked masks: derive snow/rock from altitude & slope
  float snowBase = ma.a;
  if (cw < 1.0) {
    float s2 = smoothstep(2900.0, 3300.0, h + n1 * 300.0) * (1.0 - smoothstep(0.42, 0.62, slope));
    snowBase = mix(s2, snowBase, cw);
  }
  float w[8];
  w[3] = smoothstep(0.12, 0.26, slope + (n1 - 0.5) * 0.1) * 1.3 + mb.a * 0.6 * smoothstep(0.05, 0.16, slope);   // rock
  w[4] = (ma.g * 1.4 + smoothstep(2250.0, 2750.0, h) * 0.5 * smoothstep(0.06, 0.2, slope)) * (1.0 - smoothstep(0.3, 0.45, slope)); // scree
  w[6] = clamp(snowBase * 1.3 + uWeather.y * smoothstep(1500.0, 2100.0, h + n1 * 200.0), 0.0, 1.2) * (1.0 - smoothstep(0.24, 0.42, slope));
  w[2] = ma.b * 1.3;                                               // forest floor
  w[5] = (smoothstep(0.72, 0.92, ma.r + uWeather.w * 0.1) * 1.2 * (1.0 - smoothstep(0.1, 0.3, slope)) + mb.r * ma.b * 0.6);   // mud
  w[7] = smoothstep(0.8, 0.98, mb.g) * 1.4;                        // riverbed / shore
  float tundra = smoothstep(2050.0, 2450.0, h + (n1 - 0.5) * 260.0);
  w[1] = tundra * 0.9 + 0.15;
  w[0] = (1.0 - tundra) * 0.95 + 0.05;
  // height-blend using each layer's AO as a height proxy happens below on the top 3
  int i0 = 0, i1 = 1, i2 = 2;
  float b0 = -1.0, b1 = -1.0, b2 = -1.0;
  for (int i = 0; i < 8; i++) {
    float v = w[i];
    if (v > b0) { b2 = b1; i2 = i1; b1 = b0; i1 = i0; b0 = v; i0 = i; }
    else if (v > b1) { b2 = b1; i2 = i1; b1 = v; i1 = i; }
    else if (v > b2) { b2 = v; i2 = i; }
  }
  vec3 A[3], Nn[3], M[3];
  int ids[3] = int[3](i0, i1, i2);
  float ws[3] = float[3](b0, b1, b2);
  float hsum = 0.0;
  for (int k = 0; k < 3; k++) {
    if (ids[k] == 3) sampleRockTri(P, N, far, A[k], Nn[k], M[k]);
    else sampleLayer(ids[k], p, far, nz3.x, A[k], Nn[k], M[k]);
  }
  // height blend: weight * (ao-height + bias)
  float hb[3];
  float mx = 0.0;
  for (int k = 0; k < 3; k++) { hb[k] = max(ws[k], 0.0) + M[k].r * 0.35; mx = max(mx, hb[k]); }
  float tot = 0.0;
  for (int k = 0; k < 3; k++) { hb[k] = max(hb[k] - mx + 0.25, 0.0) * max(ws[k], 0.0); tot += hb[k]; }
  vec3 alb = vec3(0.0), nrm = vec3(0.0); float rough = 0.0, ao = 0.0;
  for (int k = 0; k < 3; k++) {
    float f = hb[k] / max(tot, 1e-4);
    alb += A[k] * f;
    vec3 wn = ids[k] == 3 ? Nn[k] : vec3(Nn[k].x, 0.0, -Nn[k].y);   // tangent -> world (xz-projected)
    nrm += wn * f;
    rough += M[k].g * f; ao += M[k].r * f;
  }
  // large-scale tonal variation (sun-bleached vs. damp patches) breaks uniformity at range
  float macroV = vnoiseD(p * 0.0035 + 77.0).x * 0.6 + vnoiseD(p * 0.011 + 13.0).x * 0.4;
  alb *= 0.82 + 0.36 * macroV;
  // distant forests read as canopy colour beyond the impostor range
  float canopy = ma.b * smoothstep(1300.0, 1900.0, vDist) * cw;
  alb = mix(alb, vec3(0.045, 0.07, 0.04), canopy * 0.9);
  // weather: wet ground darkens and turns glossy
  float wet = clamp(uWeather.x * (1.0 - w[6]) + smoothstep(0.75, 0.95, ma.r) * 0.35, 0.0, 1.0);
  alb *= mix(1.0, 0.62, wet);
  rough = mix(rough, 0.18, wet * 0.85);
  // flowers sprinkled in meadows (distance-faded)
  albedoOut = alb;
  terrN = normalize(N + nrm * 0.9);
  terrRough = clamp(rough, 0.05, 1.0);
  terrAO = mix(ao, 1.0, far) * (0.7 + 0.3 * cav);
}
`;

export class Terrain {
  constructor(renderer, data, opts) {
    this.data = data;
    this.renderer = renderer;
    this.range0 = opts.range0 ?? 56;
    const N = WORLD.n, NF = WORLD.farN;
    this.texCore = u16Texture(data.height, N);
    this.texFar = u16Texture(data.far, NF);
    [this.maskA, this.maskB] = splitMasks(data.masks, WORLD.maskN);
    this.normCore = normalTexture(data.height, N, WORLD.cell);
    this.normFar = normalTexture(data.far, NF, WORLD.farSize / (NF - 1));
    this.geometry = makeGrid();
    this.uniforms = {
      uHeightCore: { value: this.texCore }, uHeightFar: { value: this.texFar },
      uMaskA: { value: this.maskA }, uMaskB: { value: this.maskB },
      uNormCore: { value: this.normCore }, uNormFar: { value: this.normFar },
      uAlbedo: { value: opts.arrays.albedo }, uNormal: { value: opts.arrays.normal }, uARM: { value: opts.arrays.arm },
      uLayerAvg: { value: opts.layerAvg.map(c => new THREE.Vector3(...c)) },
      uRange0: { value: this.range0 },
      uCamPos: { value: new THREE.Vector3() },
      uWeather: opts.weatherUniform,
    };
    this.material = this._material();
    this.depthMaterial = this._depthMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.matrixAutoUpdate = false;
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._bounds = new Map();
    this.stats = { nodes: 0 };
  }

  _vertexPrelude() {
    return `${HEIGHT_GLSL}
attribute vec4 node;
uniform float uRange0;
uniform vec3 uCamPos;
varying vec3 vWorld;
varying float vDist;
vec3 terrainVertex() {
  float level = node.w;
  float size = node.z;
  vec2 g = position.xz;
  vec2 wp = node.xy + g * (size / ${G}.0);
  float h0 = baseHeight(wp);
  float d = distance(vec3(wp.x, h0, wp.y), uCamPos);
  float r = uRange0 * exp2(level);
  float morph = clamp((d - r * 0.62) / (r * 0.34), 0.0, 1.0);
  vec2 odd = fract(g * 0.5) * 2.0;
  g -= odd * morph;
  wp = node.xy + g * (size / ${G}.0);
  float h = baseHeight(wp);
  // micro relief fades with distance (a per-position rule, so adjacent LOD levels agree)
  float dfade = 1.0 - smoothstep(170.0, 300.0, length(wp - uCamPos.xz));
  if (dfade > 0.0 && coreWeight(wp) > 0.0) {
    vec4 mb = texture(uMaskB, maskUV(wp));
    h += detailNoiseD(wp, mb.r, mb.a).x * coreWeight(wp) * dfade;
  }
  vDist = distance(vec3(wp.x, h, wp.y), uCamPos);
  vWorld = vec3(wp.x, h, wp.y);
  return vWorld;
}
`;
  }

  _material() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + this._vertexPrelude())
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', 'vec3 transformed = terrainVertex();');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + HEIGHT_GLSL + SPLAT_GLSL)
        .replace('#include <map_fragment>', 'vec3 terrAlb; terrainSplat(terrAlb); diffuseColor.rgb = terrAlb;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrRough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrN, 0.0)).xyz);')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= terrAO; reflectedLight.indirectSpecular *= terrAO; reflectedLight.directDiffuse *= mix(1.0, terrAO, 0.5);');
      this._shader = s;
    };
    m.customProgramCacheKey = () => 'cdlod-terrain';
    return m;
  }

  _depthMaterial() {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + this._vertexPrelude())
        .replace('#include <begin_vertex>', 'vec3 transformed = terrainVertex();');
    };
    m.customProgramCacheKey = () => 'cdlod-terrain-depth';
    return m;
  }

  // coarse bounds of a node from the far map (cached)
  _nodeBounds(x, z, size, level) {
    const key = level * 1e8 + Math.round((x + 32768) / size) * 1e4 + Math.round((z + 32768) / size);
    let b = this._bounds.get(key);
    if (!b) {
      let lo = Infinity, hi = -Infinity;
      const n = 6;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const h = this.sampleFar(x + size * i / n, z + size * j / n);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      const pad = 25 + size * 0.06;
      b = [lo - pad, hi + pad];
      this._bounds.set(key, b);
    }
    return b;
  }

  sampleFar(x, z) {
    const NF = WORLD.farN, c = WORLD.farSize / (NF - 1), half = WORLD.farSize / 2;
    if (Math.abs(x) < WORLD.half - 8 && Math.abs(z) < WORLD.half - 8) return this.data.field.baseHeight(x, z);
    const gx = Math.min(NF - 1.001, Math.max(0, (x + half) / c)), gz = Math.min(NF - 1.001, Math.max(0, (z + half) / c));
    const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j, f = this.data.far;
    const a = f[j * NF + i], b = f[j * NF + i + 1], cc = f[(j + 1) * NF + i], d = f[(j + 1) * NF + i + 1];
    return ((a + (b - a) * tx) * (1 - tz) + (cc + (d - cc) * tx) * tz) * WORLD.hUnit;
  }

  update(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const cam = camera.position;
    this.uniforms.uCamPos.value.copy(cam);
    const attr = this.geometry.attributes.node, arr = attr.array;
    let count = 0;
    const box = this._box, fr = this._frustum, r0 = this.range0, FH = WORLD.farSize / 2;
    const sphereBox = (r) => {
      const dx = Math.max(box.min.x - cam.x, 0, cam.x - box.max.x);
      const dy = Math.max(box.min.y - cam.y, 0, cam.y - box.max.y);
      const dz = Math.max(box.min.z - cam.z, 0, cam.z - box.max.z);
      return dx * dx + dy * dy + dz * dz < r * r;
    };
    const visit = (x, z, size, level) => {
      if (x >= FH || z >= FH || x + size <= -FH || z + size <= -FH) return;
      const [lo, hi] = this._nodeBounds(x, z, size, level);
      box.min.set(x, lo, z); box.max.set(x + size, hi, z + size);
      if (!fr.intersectsBox(box)) return;
      if (level === 0 || !sphereBox(r0 * Math.pow(2, level - 1))) {
        if (count < MAX_INSTANCES) { const o = count * 4; arr[o] = x; arr[o + 1] = z; arr[o + 2] = size; arr[o + 3] = level; count++; }
        return;
      }
      const h = size / 2;
      visit(x, z, h, level - 1); visit(x + h, z, h, level - 1); visit(x, z + h, h, level - 1); visit(x + h, z + h, h, level - 1);
    };
    const root = LEAF * Math.pow(2, LEVELS - 1);
    visit(-root / 2, -root / 2, root, LEVELS - 1);
    this.geometry.instanceCount = count;
    attr.needsUpdate = true;
    attr.clearUpdateRanges?.();
    this.stats.nodes = count;
  }
}
