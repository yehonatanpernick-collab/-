import * as THREE from 'three';
import { Tree } from '../lib/eztree/tree.js';
import { loadPreset } from '../lib/eztree/presets/index.js';
import * as A from './assets.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
export const windU = { value: 0 };

function windPatch(mat, strength = 0.18, leaf = true) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = windU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 ip = vec4(0.,0.,0.,1.);
          #ifdef USE_INSTANCING
          ip = instanceMatrix * ip;
          #endif
          float ph = ip.x * 0.11 + ip.z * 0.07;
          float h = max(position.y, 0.) * 0.08;
          float sw = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.3) * ${strength.toFixed(3)} * h;
          transformed.x += sw; transformed.z += sw * 0.6;
          ${leaf ? 'transformed += normal * sin(uTime * 4.0 + position.x * 0.9 + position.z * 1.3 + ph) * 0.06;' : ''}
        }`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength + leaf;
}

// Build a tree variant from an EZ-Tree preset, normalised to `height` world units.
export async function treeVariant(preset, o = {}) {
  const json = loadPreset(preset);
  if (o.seed !== undefined) json.seed = o.seed;
  if (o.leafTint !== undefined) json.leaves.tint = o.leafTint;
  if (o.leafType) json.leaves.type = o.leafType;
  if (o.leafCount !== undefined) json.leaves.count = o.leafCount;
  if (o.leafSize !== undefined) json.leaves.size = o.leafSize;
  if (o.barkTint !== undefined) json.bark.tint = o.barkTint;
  if (o.levels !== undefined) json.branch.levels = o.levels;
  const t = new Tree(); t.loadFromJson(json);
  const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
  bg.computeBoundingBox(); lg.computeBoundingBox();
  const bb = bg.boundingBox.clone(); if (lg.attributes.position.count) bb.union(lg.boundingBox);
  const s = (o.height || 12) / (bb.max.y - bb.min.y);
  bg.scale(s, s, s); lg.scale(s, s, s);
  // soft foliage normals: point away from canopy centre
  if (lg.attributes.position.count) {
    lg.computeBoundingBox(); const c = lg.boundingBox.getCenter(new THREE.Vector3()); c.y -= (lg.boundingBox.max.y - lg.boundingBox.min.y) * 0.25;
    const p = lg.attributes.position, n = lg.attributes.normal || new THREE.BufferAttribute(new Float32Array(p.count * 3), 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    lg.setAttribute('normal', n);
  }
  const barkType = json.bark.type === 'willow' ? 'oak' : json.bark.type;
  const [bc, bn] = await Promise.all([A.tex(`nature/${barkType}_color_1k.jpg`), A.tex(`nature/${barkType}_normal_1k.jpg`, { srgb: false })]);
  const bcol = bc.clone(), bnor = bn.clone(); bcol.repeat.set(1, 0.25); bnor.repeat.set(1, 0.25); bcol.needsUpdate = bnor.needsUpdate = true;
  const barkMat = new THREE.MeshStandardMaterial({ map: bcol, normalMap: bnor, color: new THREE.Color(o.barkColor || 0xffffff), roughness: 0.92 });
  windPatch(barkMat, 0.05, false);
  let leafMat = null, leafDepth = null;
  if (lg.attributes.position.count) {
    const lt = await A.tex(`nature/${json.leaves.type}_color.png`, { repeat: false });
    leafMat = new THREE.MeshStandardMaterial({ map: lt, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(json.leaves.tint), roughness: 0.75, emissive: new THREE.Color(o.leafGlow || 0x000000) });
    if (o.leafGlow) leafMat.emissiveMap = lt;
    windPatch(leafMat, 0.18, true);
    leafDepth = new THREE.MeshDepthMaterial({ map: lt, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  }
  t.branchesMesh.material.dispose(); if (t.leavesMesh.material) t.leavesMesh.material.dispose();
  return { bg, lg, barkMat, leafMat, leafDepth, radius: o.radius ?? 0.5 * (o.height || 12) / 12 };
}

// Place instances of a tree variant. list: [{x,y,z,s,r}]
export function plantTrees(scene, v, list) {
  const out = [];
  const B = new THREE.InstancedMesh(v.bg, v.barkMat, list.length); B.castShadow = B.receiveShadow = true;
  let L = null; if (v.leafMat) { L = new THREE.InstancedMesh(v.lg, v.leafMat, list.length); L.castShadow = true; L.receiveShadow = true; L.customDepthMaterial = v.leafDepth; }
  list.forEach((t, i) => { _e.set(0, t.r, 0); _q.setFromEuler(_e); _m.compose(_p.set(t.x, t.y - 0.15, t.z), _q, t.sv || _s.setScalar(t.s)); B.setMatrixAt(i, _m); L && L.setMatrixAt(i, _m); });
  B.computeBoundingSphere(); scene.add(B); out.push(B);
  if (L) { L.computeBoundingSphere(); scene.add(L); out.push(L); }
  return out;
}

// Instance every mesh in a loaded scene graph. list: [{x,y,z,s,r, rx?, rz?}]
export function instanceScene(scene, src, list, { shadow = true, receive = true, material = null } = {}) {
  if (!list.length) return [];
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const out = [];
  src.traverse(o => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, material || o.material, list.length);
    list.forEach((t, i) => { _e.set(t.rx || 0, t.r || 0, t.rz || 0); _q.setFromEuler(_e); _m.compose(_p.set(t.x, t.y, t.z), _q, t.sv || _s.setScalar(t.s || 1)); _m.multiply(local); im.setMatrixAt(i, _m); });
    im.castShadow = shadow; im.receiveShadow = receive; im.computeBoundingSphere();
    scene.add(im); out.push(im);
  });
  return out;
}

// ---------- GPU grass field that follows the player ----------
export class GrassField {
  constructor(scene, terrain, Q, colors) {
    const R = this.R = Q.grassR, count = Q.grass;
    if (!count) return;
    const segs = Q.grassSegs;
    const blade = new THREE.BufferGeometry(); const pos = [], idx = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs, w = 0.06 * (1 - t * 0.85); pos.push(-w, t, 0, w, t, 0); if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); blade.setIndex(idx);
    const geo = new THREE.InstancedBufferGeometry(); geo.index = blade.index; geo.attributes.position = blade.attributes.position;
    const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { off[i * 2] = (Math.random() * 2 - 1) * R; off[i * 2 + 1] = (Math.random() * 2 - 1) * R; rnd[i * 4] = Math.random() * 6.283; rnd[i * 4 + 1] = Math.random(); rnd[i * 4 + 2] = Math.random(); rnd[i * 4 + 3] = Math.random(); }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2)); geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;
    this.u = {
      uHeight: { value: terrain.dataTex }, uN: { value: terrain.N }, uSize: { value: terrain.size }, uCenter: { value: new THREE.Vector2() }, uR: { value: R },
      uTime: windU, uHero: { value: new THREE.Vector3() }, uBase: { value: new THREE.Color(colors.base) }, uTip: { value: new THREE.Color(colors.tip) }, uTip2: { value: new THREE.Color(colors.tip2 || colors.tip) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uHeightScale: { value: colors.height || 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.DoubleSide,
      vertexShader: `
        uniform sampler2D uHeight; uniform float uN, uSize, uR, uTime, uHeightScale; uniform vec2 uCenter; uniform vec3 uHero, uBase, uTip, uTip2, uSunDir, uSun, uAmb;
        attribute vec2 aOff; attribute vec4 aRnd; varying vec3 vCol;
        vec2 tx(vec2 w){ return (w + uSize * 0.5) / uSize * uN; }
        vec2 hs(vec2 w){ vec2 g = tx(w); vec2 i = floor(g), f = g - i; ivec2 ii = ivec2(clamp(i, vec2(0.), vec2(uN)));
          ivec2 i1 = ivec2(clamp(i + vec2(1., 0.), vec2(0.), vec2(uN))), i2 = ivec2(clamp(i + vec2(0., 1.), vec2(0.), vec2(uN))), i3 = ivec2(clamp(i + 1., vec2(0.), vec2(uN)));
          vec2 a = texelFetch(uHeight, ii, 0).xy, b = texelFetch(uHeight, i1, 0).xy, c = texelFetch(uHeight, i2, 0).xy, d = texelFetch(uHeight, i3, 0).xy;
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main(){
          vec2 wp = aOff + 2. * uR * floor((uCenter - aOff + uR) / (2. * uR));
          vec2 hm = hs(wp);
          float dC = length(wp - uCenter);
          float keep = step(aRnd.w, hm.y) * (1. - smoothstep(uR * 0.65, uR, dC)) * smoothstep(1.2, 3.5, distance(vec3(wp.x, hm.x, wp.y), cameraPosition));
          float H = (0.45 + aRnd.y * 0.7) * uHeightScale * keep;
          float t = position.y;
          float ca = cos(aRnd.x), sa = sin(aRnd.x);
          vec3 p = vec3(position.x * ca, t * H, position.x * sa);
          float wph = wp.x * 0.15 + wp.y * 0.11;
          float wind = sin(uTime * 1.6 + wph) * 0.35 + sin(uTime * 3.1 + wph * 2.3) * 0.12 + 0.15;
          vec2 bend = vec2(wind, wind * 0.4) + vec2(cos(aRnd.x), sin(aRnd.x)) * (aRnd.z - 0.5) * 0.5;
          vec2 away = wp - uHero.xz; float ad = length(away); bend += away / max(ad, 0.01) * (1. - smoothstep(0.2, 1.6, ad)) * 1.4 * step(abs(uHero.y - hm.x), 2.5);
          p.xz += bend * t * t * H;
          p.y -= dot(bend, bend) * t * t * H * 0.25;
          vec3 world = vec3(wp.x, hm.x - 0.05, wp.y) + p;
          vec3 nrm = normalize(vec3(-sa, 0.6, ca) + vec3(bend.x, 0., bend.y) * 0.3);
          float dif = abs(dot(nrm, uSunDir)) * 0.55 + 0.45 * max(uSunDir.y, 0.);
          vec3 col = mix(uBase, mix(uTip, uTip2, aRnd.z), t);
          float ao = mix(0.35, 1., t);
          vCol = col * (uAmb * ao + uSun * dif * (0.4 + t * 0.6)) + uSun * pow(t, 3.) * 0.08;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
        }`,
      fragmentShader: `varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  update(heroPos, sunDir, sun, hemi) {
    if (!this.u) return;
    this.u.uCenter.value.set(heroPos.x, heroPos.z); this.u.uHero.value.copy(heroPos);
    this.u.uSunDir.value.copy(sunDir); this.u.uSun.value.copy(sun.color).multiplyScalar(sun.intensity * 0.32);
    this.u.uAmb.value.copy(hemi.color).lerp(hemi.groundColor, 0.4).multiplyScalar(hemi.intensity * 0.55);
  }
}

// stylised-but-detailed glowing mushroom (lathe geometry)
export function mushroomGeometry() {
  const cap = new THREE.LatheGeometry([new THREE.Vector2(0, 1.25), new THREE.Vector2(0.55, 1.2), new THREE.Vector2(0.95, 1.02), new THREE.Vector2(1.15, 0.8), new THREE.Vector2(1.08, 0.7), new THREE.Vector2(0.7, 0.72), new THREE.Vector2(0.2, 0.78)], 24);
  const stem = new THREE.LatheGeometry([new THREE.Vector2(0.28, 0), new THREE.Vector2(0.2, 0.25), new THREE.Vector2(0.16, 0.6), new THREE.Vector2(0.2, 0.78), new THREE.Vector2(0.0, 0.8)], 14);
  return { cap, stem };
}
