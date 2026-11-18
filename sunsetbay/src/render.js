import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { QUALITY, store, HEADLESS, IS_TOUCH, $, clamp, lerp, smooth } from './core.js';

export let qualityName = store.get('sb2-quality', null) || (HEADLESS ? 'low' : IS_TOUCH ? 'medium' : 'high');
if (location.hash === '#low') qualityName = 'low';
export const Q = QUALITY[qualityName];

export const canvas = $('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.smaa && !Q.ao && !Q.bloom, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const MAX_ANISO = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, Q.far);
camera.position.set(0, 50, 100);
scene.fog = new THREE.FogExp2(0xb9c8d6, 0.0012);

/* ---------------- asset loading ---------------- */
export const ASSET_BASE = new URL('../assets/', import.meta.url).href;
export const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const rgbeLoader = new RGBELoader();
export const progress = { done: 0, total: 0, onChange: null };
const track = p => { progress.total++; return p.finally(() => { progress.done++; progress.onChange && progress.onChange(progress.done / progress.total); }); };
export const loadGLTF = path => track(gltfLoader.loadAsync(ASSET_BASE + path));
export function loadTex(path, { srgb = true, repeat = true } = {}) {
  return track(texLoader.loadAsync(ASSET_BASE + path)).then(t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = MAX_ANISO; return t;
  });
}
export const loadHDR = path => track(rgbeLoader.loadAsync(ASSET_BASE + path));

/* ---------------- lights ---------------- */
export const sun = new THREE.DirectionalLight(0xffffff, 3);
scene.add(sun, sun.target);
if (Q.shadow) {
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const c = sun.shadow.camera, R = Q.shadowR; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 700;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2;
}
export const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a3b2c, 0.25); scene.add(hemi);

/* ---------------- sky moods ---------------- */
// sun direction from equirect (u,v) where v is measured from the top of the image
const dirFromUV = (u, v, elevOverride) => {
  const phi = (u - 0.5) * 2 * Math.PI; let el = (0.5 - v) * Math.PI; if (elevOverride !== undefined) el = elevOverride * Math.PI / 180;
  return new THREE.Vector3(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi)).normalize();
};
export const MOODS = {
  day: { file: 'day', sun: dirFromUV(0.613, 0.474, 40), sunColor: new THREE.Color(0xfff0dc), sunInt: 3.4, env: 1.0, exposure: 0.95, fog: new THREE.Color(0xbcc9d4), fogD: 0.0010, night: 0, hemi: 0.25, bloom: 0.18 },
  sunset: { file: 'sunset', sun: dirFromUV(0.613, 0.474, 8), sunColor: new THREE.Color(0xffa060), sunInt: 3.0, env: 1.0, exposure: 1.0, fog: new THREE.Color(0xd9b49c), fogD: 0.0013, night: 0.35, hemi: 0.2, bloom: 0.35 },
  night: { file: 'night', sun: dirFromUV(0.599, 0.406, 38), sunColor: new THREE.Color(0x9ab4ff), sunInt: 0.55, env: 0.5, exposure: 1.05, fog: new THREE.Color(0x0a0f19), fogD: 0.0014, night: 1, hemi: 0.06, bloom: 0.5 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: { mapA: { value: null }, mapB: { value: null }, mixAB: { value: 0 }, bright: { value: 1 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
  fragmentShader: `uniform sampler2D mapA, mapB; uniform float mixAB, bright; varying vec3 vDir;
    vec2 eq(vec3 d){ return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
    void main(){ vec3 d = normalize(vDir); vec2 uv = eq(d); vec3 c = mix(texture2D(mapA, uv).rgb, texture2D(mapB, uv).rgb, mixAB) * bright; gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
});
export const skyDome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
skyDome.renderOrder = -10; skyDome.frustumCulled = false; scene.add(skyDome);

const pmrem = new THREE.PMREMGenerator(renderer);
export const sky = { cur: 'day', next: null, t: 1, dur: 1, envs: {}, bgs: {}, night: 0, auto: true, timer: 0, blend: null };
export async function loadMoods() {
  await Promise.all(Object.entries(MOODS).map(async ([k, m]) => {
    const [hdr, bg] = await Promise.all([loadHDR(`hdri/${m.file}.hdr`), loadTex(`hdri/${m.file}.jpg`, { repeat: false })]);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    sky.envs[k] = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
    bg.colorSpace = THREE.SRGBColorSpace; bg.generateMipmaps = true; bg.minFilter = THREE.LinearMipmapLinearFilter; bg.magFilter = THREE.LinearFilter;
    sky.bgs[k] = bg;
  }));
  setMood(sky.cur, 0);
}
export function setMood(name, dur = 6) {
  if (!MOODS[name]) return;
  if (dur <= 0) { sky.cur = name; sky.next = null; sky.t = 1; applyMood(MOODS[name], MOODS[name], 1); skyMat.uniforms.mapA.value = sky.bgs[name]; skyMat.uniforms.mapB.value = sky.bgs[name]; skyMat.uniforms.mixAB.value = 0; scene.environment = sky.envs[name]; return; }
  if (name === sky.cur && !sky.next) return;
  if (sky.next) { sky.cur = sky.next; }
  sky.next = name; sky.t = 0; sky.dur = dur;
  skyMat.uniforms.mapA.value = sky.bgs[sky.cur]; skyMat.uniforms.mapB.value = sky.bgs[name];
}
const _c = new THREE.Color(), _v = new THREE.Vector3();
function applyMood(a, b, t) {
  const s = smooth(0, 1, t);
  _v.copy(a.sun).lerp(b.sun, s).normalize(); sky.sunDir = sky.sunDir || new THREE.Vector3(); sky.sunDir.copy(_v);
  sun.color.copy(a.sunColor).lerp(b.sunColor, s); sun.intensity = lerp(a.sunInt, b.sunInt, s);
  scene.fog.color.copy(a.fog).lerp(b.fog, s); scene.fog.density = lerp(a.fogD, b.fogD, s);
  renderer.toneMappingExposure = lerp(a.exposure, b.exposure, s);
  hemi.intensity = lerp(a.hemi, b.hemi, s);
  sky.night = lerp(a.night, b.night, s);
  sky.bloom = lerp(a.bloom, b.bloom, s);
  // environment map swaps at the midpoint; dip its intensity around it so the switch is invisible
  const dip = 1 - Math.sin(Math.PI * clamp(t, 0, 1)) * 0.6;
  scene.environmentIntensity = lerp(a.env, b.env, s) * (t > 0 && t < 1 ? dip : 1);
}
export function updateSky(dt, focus) {
  if (sky.next) {
    sky.t += dt / sky.dur; const a = MOODS[sky.cur], b = MOODS[sky.next], t = Math.min(1, sky.t);
    skyMat.uniforms.mixAB.value = smooth(0, 1, t);
    scene.environment = t < 0.5 ? sky.envs[sky.cur] : sky.envs[sky.next];
    applyMood(a, b, t);
    if (sky.t >= 1) { sky.cur = sky.next; sky.next = null; skyMat.uniforms.mapA.value = sky.bgs[sky.cur]; skyMat.uniforms.mixAB.value = 0; }
  } else applyMood(MOODS[sky.cur], MOODS[sky.cur], 1);
  if (sky.auto) {
    sky.timer += dt; const order = ['day', 'sunset', 'night'], cur = sky.next || sky.cur;
    if (sky.timer > (CFG_MOOD[cur] || 300)) { sky.timer = 0; setMood(order[(order.indexOf(cur) + 1) % 3], 25); }
  }
  skyDome.position.copy(camera.position);
  skyMat.uniforms.bright.value = 1;
  // sun follows the focus point so the shadow map covers the player
  const P = focus || camera.position;
  const R = Q.shadowR || 60;
  if (Q.shadow) {
    const step = (2 * R) / Q.shadow, tx = Math.round(P.x / step) * step, tz = Math.round(P.z / step) * step;
    sun.position.set(tx + sky.sunDir.x * 300, sky.sunDir.y * 300, tz + sky.sunDir.z * 300); sun.target.position.set(tx, 0, tz);
  } else { sun.position.set(P.x + sky.sunDir.x * 300, sky.sunDir.y * 300, P.z + sky.sunDir.z * 300); sun.target.position.set(P.x, 0, P.z); }
  sun.target.updateMatrixWorld();
  if (bloom) { bloom.strength = sky.bloom; bloom.threshold = lerp(0.95, 0.82, sky.night); bloom.radius = 0.45; }
}
let CFG_MOOD = {};
export function setMoodTimes(t) { CFG_MOOD = t; }

/* ---------------- post processing ---------------- */
export let composer = null, bloom = null, gtao = null;
export function setupPost() {
  if (!Q.bloom && !Q.ao && !Q.smaa) return;
  const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: Q.smaa ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (Q.ao) {
    gtao = new GTAOPass(scene, camera, w, h);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: qualityName === 'ultra' ? 16 : 10 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  if (Q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.55, 0.9); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  if (Q.smaa) composer.addPass(new SMAAPass(w * pr, h * pr));
}
export function resize() {
  const w = window.innerWidth, h = window.innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
export function renderFrame() { if (composer) composer.render(); else renderer.render(scene, camera); }
