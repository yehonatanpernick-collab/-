import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const base = new URL('../assets/', import.meta.url).href;
const gltfLoader = new GLTFLoader(), texLoader = new THREE.TextureLoader(), hdrLoader = new HDRLoader();
const cache = new Map();
let onProgress = null, pending = 0, done = 0;
export function setProgressHandler(f) { onProgress = f; }
function track(p) { pending++; p.finally(() => { done++; onProgress && onProgress(done, pending); }); return p; }

export function gltf(path) {
  if (!cache.has(path)) cache.set(path, track(gltfLoader.loadAsync(base + path)));
  return cache.get(path);
}
export function tex(path, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const key = 'tex:' + path + srgb;
  if (!cache.has(key)) {
    cache.set(key, track(texLoader.loadAsync(base + path).then(t => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso; return t;
    })));
  }
  return cache.get(key);
}
export function hdr(path) {
  const key = 'hdr:' + path;
  if (!cache.has(key)) cache.set(key, track(hdrLoader.loadAsync(base + path).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; return t; })));
  return cache.get(key);
}

// ---------- characters ----------
let animClips = null;
export async function animations() {
  if (!animClips) { const g = await gltf('chars/anims.glb'); animClips = {}; for (const c of g.animations) animClips[c.name] = c; }
  return animClips;
}

// rim light + hit flash injected into character materials
export function characterMaterial(src, { rim = '#9fc8ff', rimStr = 0.22, tint = null, stone = false, dark = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, color: tint ? new THREE.Color(tint) : src.color.clone().multiplyScalar(0.82), roughness: stone ? 0.75 : 0.62, metalness: stone ? 0.0 : 0.08, envMapIntensity: 0.55 });
  m.userData.rim = { value: new THREE.Color(rim).multiplyScalar(rimStr) };
  m.userData.flash = { value: 0 };
  m.userData.dissolve = { value: 0 };
  m.userData.stone = stone; m.userData.dark = dark;
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = m.userData.rim; sh.uniforms.uFlash = m.userData.flash; sh.uniforms.uDissolve = m.userData.dissolve;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uRim; uniform float uFlash, uDissolve; varying vec3 vObjPos;
      float h3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
        return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${stone ? `{ float n = vn(vObjPos * 9.) * 0.6 + vn(vObjPos * 31.) * 0.4; float g = dot(diffuseColor.rgb, vec3(0.33)); diffuseColor.rgb = mix(vec3(0.83, 0.8, 0.74), vec3(0.95, 0.93, 0.88), n) * (0.55 + g * 0.6); }` : ''}
        ${dark ? `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.35, 0.28, 0.4), 0.75);` : ''}
        if (uDissolve > 0.) { float n = vn(vObjPos * 6.); if (n < uDissolve) discard; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 vd = normalize(vViewPosition); float fr = pow(1. - clamp(dot(normalize(normal), -vd), 0., 1.), 3.); totalEmissiveRadiance += uRim * fr + vec3(uFlash);
          if (uDissolve > 0.) { float n = vn(vObjPos * 6.); totalEmissiveRadiance += vec3(1.2, 0.5, 2.2) * smoothstep(uDissolve + 0.08, uDissolve, n) * 3.; } }`);
  };
  m.customProgramCacheKey = () => 'char' + stone + dark;
  return m;
}

const HIDE = {
  Knight: ['2H_Sword', '1H_Sword_Offhand', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield'],
  Barbarian: [], Mage: [], Rogue_Hooded: [],
};
export async function character(name, opts = {}) {
  const g = await gltf(`chars/${name}.glb`);
  const root = SkeletonUtils.clone(g.scene);
  const hide = opts.hide || HIDE[name] || [];
  const mats = []; const matMap = new Map();
  root.traverse(o => {
    if (hide.includes(o.name)) o.visible = false;
    if (opts.keepOnly && o.isMesh && !opts.keepOnly(o.name, o)) o.visible = false;
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      if (!matMap.has(o.material)) { const m = characterMaterial(o.material, opts); matMap.set(o.material, m); mats.push(m); }
      o.material = matMap.get(o.material);
    }
  });
  const bones = {}; root.traverse(o => { if (o.isBone || o.name.startsWith('handslot')) bones[o.name] = o; });
  const clips = await animations();
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips, mats, bones };
}
export async function attach(char, file, slot, opts = {}) {
  const g = await gltf(`chars/${file}.glb`);
  const o = g.scene.clone(true);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; const nm = characterMaterial(m.material, opts); m.material = nm; char.mats.push(nm); } });
  const bone = char.bones[slot]; if (bone) bone.add(o);
  return o;
}
// static props (shared geometry/material, cloned scene)
export async function prop(path) { const g = await gltf(path); return g.scene; }
