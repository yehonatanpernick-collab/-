import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadMeshBin, bakeColors, b64ToBuffer } from './meshbin.js';
import { Rig } from './rig.js';

export async function loadFighterAssets(onProgress) {
  const loader = new GLTFLoader();
  let done = 0; const tick = () => onProgress && onProgress(++done / 4);
  const [gltf, bodyA, bodyB, glove] = await Promise.all([
    fetch('assets/fighter_head.json').then(r => r.json()).then(j => loader.parseAsync(b64ToBuffer(j.b64), '')).then(r => (tick(), r)),
    loadMeshBin('assets/body_a').then(r => (tick(), r)),
    loadMeshBin('assets/body_b').then(r => (tick(), r)),
    loadMeshBin('assets/glove').then(r => (tick(), r)),
  ]);
  // average skin colour of the neck area of the head texture
  const head = gltf.scene.getObjectByName('Wolf3D_Head');
  const skin = sampleNeckColor(head);
  return { gltf, bodies: { a: bodyA, b: bodyB }, glove, skin };
}

function sampleNeckColor(head) {
  const img = head.material.map.image;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const pos = head.geometry.attributes.position, uv = head.geometry.attributes.uv;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 1.535 && y < 1.6) {
      const u = uv.getX(i), v = uv.getY(i);
      const px = Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.floor(v * c.height)));
      const o = (py * c.width + px) * 4;
      r += data[o]; gg += data[o + 1]; b += data[o + 2]; n++;
    }
  }
  return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

const KEEP = ['EyeLeft', 'EyeRight', 'Wolf3D_Head', 'Wolf3D_Teeth', 'Wolf3D_Beard'];

// look: { body:'a'|'b', tint:[r,g,b], shorts, trim, glove, gloveTrim, boots, mustache }
export function buildFighter(assets, look, envMap) {
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(assets.gltf.scene);
  root.add(model);
  let headMesh = null; const faceMeshes = [];
  const tint = new THREE.Color().setRGB(...look.tint);
  const sweatMats = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    if (!KEEP.includes(o.name) || (o.name === 'Wolf3D_Beard' && !look.mustache)) { o.visible = false; return; }
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (o.name === 'Wolf3D_Head') {
      headMesh = o;
      const m = new THREE.MeshPhysicalMaterial({
        map: o.material.map, color: tint.clone(), roughness: 0.55, metalness: 0,
        sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.6, 0.25, 0.2),
        clearcoat: 0.1, clearcoatRoughness: 0.45,
      });
      o.material = m; sweatMats.push(m);
    }
    if (o.morphTargetDictionary) faceMeshes.push(o);
  });
  // procedural body
  const bodyGeo = assets.bodies[look.body];
  if (!bodyGeo.attributes.color) bakeColors(bodyGeo);
  const skinCol = assets.skin.clone().multiply(tint);
  const meta = bodyGeo.userData.meta;
  bodyGeo.clearGroups();
  const skinMat = makeBodyMaterial(look, skinCol, meta);
  sweatMats.push(skinMat);
  const mats = skinMat;
  const body = new THREE.SkinnedMesh(bodyGeo, mats);
  body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
  headMesh.parent.add(body);
  body.bind(headMesh.skeleton, headMesh.bindMatrix);

  const rig = new Rig(model);
  // gloves
  if (!assets.glove.attributes.color) { bakeColors(assets.glove, [0.4, 0.4, 0.4], 0.8); assets.glove.clearGroups(); }
  const gloveMat = makeGloveMaterial(look);
  const gloveMats = gloveMat;
  const gloves = {};
  for (const s of ['Left', 'Right']) {
    const g = new THREE.Mesh(assets.glove, gloveMats);
    g.castShadow = true; g.receiveShadow = true;
    g.quaternion.copy(rig.gloveFrames[s].q);
    if (s === 'Right') g.scale.x = -1;
    g.scale.multiplyScalar(look.gloveScale || 1);
    rig.bones[s + 'Hand'].add(g);
    gloves[s] = g;
  }
  return { root, model, rig, headMesh, faceMeshes, sweatMats, body, gloves, gloveMat };
}

const U = (v) => ({ value: v });
function makeBodyMaterial(look, skinCol, meta) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: 0xffffff, clearcoat: 1, clearcoatRoughness: 0.35,
  });
  const uni = {
    uSkin: U(skinCol), uShorts: U(new THREE.Color(look.shorts)), uTrim: U(new THREE.Color(look.trim)),
    uBoots: U(new THREE.Color(look.boots)), uBootTrim: U(new THREE.Color(look.bootTrim || 0xe6e6e6)),
    uTop: U(meta.shortsTop), uHem: U(meta.hem), uBootTop: U(meta.bootTop), uLegX: U(meta.legX),
    uSweat: U(0.12), uFlush: U(0),
  };
  m.userData.uni = uni;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uSkin, uShorts, uTrim, uBoots, uBootTrim;
uniform float uTop, uHem, uBootTop, uLegX, uSweat, uFlush;
float hash3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash3(i+vec3(0,0,0)),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float ry = vBind.y, ax = abs(vBind.x);
vec3 rBase = uSkin; float rRough = 0.5; vec3 rSheen = vec3(0.55,0.22,0.16)*0.6; float rCC = uSweat; float rCCR = 0.35;
float n1 = vnoise(vBind*90.0), n2 = vnoise(vBind*14.0);
bool inShorts = ry > uHem - 0.004 && ry < uTop + 0.003 && ax < 0.27;
bool inBoot = ry < uBootTop + 0.002 && !inShorts;
if (inShorts) {
  rBase = uShorts; rRough = 0.3; rSheen = mix(uShorts, vec3(1.0), 0.6); rCC = 0.0;
  if (ry > uTop - 0.05) { rBase = uTrim; rSheen = vec3(0.4); rRough = 0.45; }
  else if (ry < uHem + 0.022) { rBase = uTrim; rSheen = mix(uTrim, vec3(1.0), 0.5); }
  else if (ry < 0.99) { float ang = atan(vBind.z, ax - (uLegX + 0.02)); if (abs(ang) < 0.28) { rBase = uTrim; rSheen = mix(uTrim, vec3(1.0), 0.5);} }
  rBase *= 0.94 + 0.06 * n2;
} else if (inBoot) {
  rBase = uBoots; rRough = 0.28; rSheen = vec3(0.1); rCC = 0.7; rCCR = 0.25;
  if (ry > uBootTop - 0.025 || ry < 0.02) { rBase = uBootTrim; rCC = 0.2; rRough = 0.5; }
  // laces
  if (vBind.z > 0.0 && ry > 0.08 && ry < uBootTop - 0.03 && abs(fract(ry*55.0)-0.5) < 0.18 && abs(vBind.x - sign(vBind.x)*(uLegX+0.04)) < 0.018) rBase = uBootTrim;
} else {
  // skin: subtle mottling + flush
  rBase *= 0.95 + 0.07 * n2 + 0.03 * n1;
  rBase = mix(rBase, rBase * vec3(1.18, 0.82, 0.8), uFlush * smoothstep(1.2, 1.5, ry));
  rRough = 0.52 - 0.12 * uSweat + 0.1 * n1;
}
diffuseColor.rgb *= rBase;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rRough;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.sheenColor = rSheen; material.clearcoat = rCC; material.clearcoatRoughness = max(rCCR, 0.0525);`);
  };
  return m;
}

function makeGloveMaterial(look) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const uni = { uMain: U(new THREE.Color(look.glove)), uTrimG: U(new THREE.Color(look.gloveTrim)) };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\nuniform vec3 uMain, uTrimG;')
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gB = uMain; float gR = 0.3;
float gy = vLoc.y;
if ((gy < -0.036 && gy > -0.04) || (gy < -0.074 && gy > -0.078)) { gB = uMain * 0.6; }
else if (gy < -0.04 && gy > -0.074) { gB = uTrimG; gR = 0.45; }
if (gy < -0.1) gB = uTrimG;
// stitched seam along the side
if (abs(vLoc.x) < 0.003 && vLoc.z > 0.0 && gy > -0.03) gB *= 0.7;
diffuseColor.rgb *= gB;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gR;');
  };
  return m;
}
