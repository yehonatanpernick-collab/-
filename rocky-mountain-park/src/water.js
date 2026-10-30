// Lakes and streams: depth-tinted water, wind ripples, flowing creeks, sky/planar reflections.
import * as THREE from 'three';
import { clamp, LAKES, CHANNELS, lakeR } from './shared.js';
import { scene, renderer, camera, U, G, Q, heightAt, cellOf } from './core.js';
import { N } from './shared.js';
import { NC } from './worldgen.js';
import { ATMOS_PARS, atmosUniforms } from './atmos.js';

const VS = `attribute float aDepth; attribute float aFoam; varying vec3 vW; varying float vD; varying float vFoam; varying vec2 vUv;
  void main(){ vec4 w = modelMatrix*vec4(position, 1.0); vW = w.xyz; vD = aDepth; vFoam = aFoam; vUv = uv; gl_Position = projectionMatrix*viewMatrix*w; }`;
const FS = `${ATMOS_PARS}
  uniform vec3 uShallow, uDeep; uniform float uDScale, uUseRefl, uUseEnv, uFlow; uniform sampler2D uRefl; uniform mat4 uReflMat; uniform samplerCube uEnv;
  varying vec3 vW; varying float vD; varying float vFoam; varying vec2 vUv;
  float wave(vec2 q){ return vnoise(q + uTime*vec2(0.25, 0.1))*0.55 + vnoise(q*2.3 - uTime*vec2(0.18, 0.33))*0.3 + vnoise(q*5.1 + uTime*vec2(0.4, -0.2))*0.15; }
  void main(){
    if (vD < -0.25) discard;
    vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC/dist;
    float gust = 0.55 + 0.45*vnoise(vW.xz*0.012 + uTime*vec2(0.05, 0.02)) + uStorm*1.5;
    vec2 q = uFlow > 0.5 ? vec2(vUv.x*3.0, vUv.y*1.1 - uTime*1.7) : vW.xz*0.32;
    float e = 0.1, h0 = wave(q), hx = wave(q + vec2(e, 0.0)), hz = wave(q + vec2(0.0, e));
    float amp = (uFlow > 0.5 ? 0.9 + vFoam*1.8 : 0.32*gust)*(1.0 - 0.8*smoothstep(40.0, 900.0, dist));
    if (uStorm > 0.5 && uFlow < 0.5) { vec2 rc = floor(vW.xz*3.0); float ph = fract(uTime*1.3 + hash12(rc)); amp += (1.0 - ph)*step(0.7, hash12(rc + 3.0))*0.6*uStorm; }
    vec3 N = normalize(vec3(-(hx - h0)/e*amp*0.25, 1.0, -(hz - h0)/e*amp*0.25));
    float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 refl = (uUseEnv > 0.5 ? textureCube(uEnv, R).rgb : skyL(R)) + vec3(0.6, 0.65, 0.8)*uFlash*0.3;
    if (uUseRefl > 0.5) { vec4 c = uReflMat*vec4(vW, 1.0); refl = texture2D(uRefl, c.xy/c.w + N.xz*0.035).rgb; }
    float lvis = sunVisAt(vW)*cloudShadow(vW);
    vec3 amb = uSkyAmb*1.1 + uSunCol*max(uLightDir.y, 0.0)*lvis*0.75;
    vec3 body = mix(uShallow, uDeep, smoothstep(0.0, uDScale, vD))*amb;
    vec3 col = mix(body, refl, fres);
    col += uSunTint*pow(max(dot(R, uSunDir), 0.0), 420.0)*22.0*lvis*(1.0 - uStorm);
    float fo = vFoam*smoothstep(0.42, 0.72, vnoise(q*3.0 + 1.7)) + (1.0 - smoothstep(0.0, 0.3, vD))*0.35*vnoise(vW.xz*2.0 + uTime);
    fo = clamp(fo, 0.0, 1.0);
    col = mix(col, vec3(0.85)*(uSkyAmb*2.5 + uSunCol*max(uLightDir.y, 0.0)*lvis*1.2), fo);
    float alpha = clamp(smoothstep(-0.2, uFlow > 0.5 ? 1.6 : 3.8, vD)*0.9 + fres*0.45 + fo, 0.0, 1.0);
    gl_FragColor = vec4(applyAtmos(col, vW), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
export const reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
// low-res surroundings cubemap: reflections for every lake that is not the planar-reflected one
const envRT = new THREE.WebGLCubeRenderTarget(96, { type: THREE.HalfFloatType });
const envCam = new THREE.CubeCamera(2, 22000, envRT), envOn = { value: 0 };
let envT = 0;
export function renderEnv(dt, hide) {
  envOn.value = Q().reflect ? 1 : 0;
  if (!envOn.value || (envT -= dt) > 0) return;
  envT = 3;
  envCam.position.copy(camera.position); envCam.position.y += 2;
  const hidden = [...waterMeshes, ...hide], vis = hidden.map(m => m.visible); hidden.forEach(m => m.visible = false);
  envCam.update(renderer, scene);
  hidden.forEach((m, i) => m.visible = vis[i]);
}
function makeWaterMat(shallow, deep, dscale, flow) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmosUniforms(), uShallow: { value: new THREE.Color(shallow) }, uDeep: { value: new THREE.Color(deep) }, uDScale: { value: dscale }, uFlow: { value: flow ? 1 : 0 },
      uUseRefl: { value: 0 }, uRefl: { value: reflRT.texture }, uReflMat: { value: new THREE.Matrix4() }, uUseEnv: envOn, uEnv: { value: envRT.texture },
    }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
  });
}
export const lakeMeshes = [], waterMeshes = [];
export function buildWater() {
  const { LKD } = G;
  LAKES.forEach(L => {
    const RINGS = 32, SEG = 96, rmax = L.r * Math.max(L.sx, L.sy) * 1.35 + 10, pos = [], dep = [], idx = [], uv = [];
    pos.push(L.x, L.level, L.z); dep.push(L.level - heightAt(L.x, L.z)); uv.push(0, 0);
    for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEG; s++) {
      const an = s / SEG * Math.PI * 2, rr = Math.pow(r / RINGS, 0.8) * rmax, x = L.x + Math.cos(an) * rr, z = L.z + Math.sin(an) * rr;
      pos.push(x, L.level, z); dep.push(L.level - heightAt(x, z)); uv.push(0, 0);
    }
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + (s + 1) % SEG, 1 + s);
    for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const a = 1 + (r - 1) * SEG + s, b = 1 + (r - 1) * SEG + (s + 1) % SEG, c = a + SEG, d = b + SEG; idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(new Float32Array(dep.length), 1)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, makeWaterMat(L.sh, L.dp, Math.min(L.dep, 9), false)); m.userData.lake = L;
    scene.add(m); lakeMeshes.push(m); waterMeshes.push(m);
  });
  CHANNELS.forEach((c, ci) => {
    const pos = [], dep = [], foam = [], uv = [], idx = [];
    let piece = [], vlen = 0;
    const flush = () => {
      if (piece.length >= 2) {
        const base = pos.length / 3;
        piece.forEach(([x, z, W, n0, n1, fo, v]) => {
          for (let k = 0; k <= 4; k++) {
            const s = -1 + k / 2, px = x + n0 * s * (c.w + 1.4), pz = z + n1 * s * (c.w + 1.4);
            pos.push(px, W, pz); dep.push(W - heightAt(px, pz)); foam.push(fo); uv.push(k / 4, v);
          }
        });
        for (let i = 0; i < piece.length - 1; i++) for (let k = 0; k < 4; k++) { const a = base + i * 5 + k, b = a + 1, cc = a + 5, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
      }
      piece = [];
    };
    const P = c.path;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i], k = cellOf(x, z);
      if (i > 0) vlen += Math.hypot(x - P[i - 1][0], z - P[i - 1][1]) / (c.w * 2 + 2);
      if (LKD[k] < 1.5) { flush(); continue; }
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      const sl = (c.W[Math.max(0, i - 1)] - c.W[Math.min(P.length - 1, i + 1)]) / l;
      piece.push([x, z, c.W[i], -tz / l, tx / l, clamp((sl - 0.02) * 9, 0, 1), vlen]);
    }
    flush();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, makeWaterMat(ci === 0 ? '#5f9a86' : '#7fb3a0', ci === 0 ? '#244f52' : '#2f5f5a', c.dep * 1.2, true));
    scene.add(m); waterMeshes.push(m);
  });
}

// planar reflection for the nearest lake
const reflCam = new THREE.PerspectiveCamera(), clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const biasM = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
export function renderReflection(P, pixelRatio, hide) {
  let best = null, bd = 1e9;
  for (const m of lakeMeshes) { m.material.uniforms.uUseRefl.value = 0; const L = m.userData.lake, d = Math.hypot(L.x - P.x, L.z - P.z) - L.r * 1.5; if (d < bd) { bd = d; best = m; } }
  if (!Q().reflect || !best || bd > 900 || camera.position.y < best.userData.lake.level + 0.3) return;
  const L = best.userData.lake;
  const w = Math.max(256, Math.round(innerWidth * pixelRatio * 0.5)), h = Math.max(256, Math.round(innerHeight * pixelRatio * 0.5));
  if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
  reflCam.copy(camera); reflCam.position.y = 2 * L.level - camera.position.y; reflCam.rotation.set(-P.pitch, P.yaw, 0, 'YXZ'); reflCam.updateMatrixWorld();
  best.material.uniforms.uReflMat.value.copy(biasM).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  clipPlane.constant = -L.level + 0.05; renderer.clippingPlanes = [clipPlane];
  const hidden = [...waterMeshes, ...hide]; const vis = hidden.map(m => m.visible); hidden.forEach(m => m.visible = false);
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(reflRT); renderer.render(scene, reflCam); renderer.setRenderTarget(prev);
  hidden.forEach((m, i) => m.visible = vis[i]);
  renderer.clippingPlanes = [];
  best.material.uniforms.uUseRefl.value = 1;
}

// water-surface level on the coarse grid: lets the terrain shader tint beds and draw caustics
export function buildWaterLevel() {
  const out = new Uint16Array(NC * NC), { LKD, LKID, CHD, CHL } = G;
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    const k = Math.min(N - 1, j * 2) * N + Math.min(N - 1, i * 2);
    let lv = -500;
    if (LKD[k] < 30) lv = LAKES[LKID[k]].level; else if (CHD[k] < 12) lv = CHL[k];
    out[j * NC + i] = THREE.DataUtils.toHalfFloat(lv);
  }
  const t = new THREE.DataTexture(out, NC, NC, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  U.waterLvl.value = t;
}

// mist rising at the foot of steep cascades
export function buildFalls() {
  const pts = [], seeds = [];
  CHANNELS.forEach(c => {
    const P = c.path, W = c.W;
    for (let i = 0; i < P.length - 3; i++) {
      const drop = W[i] - W[i + 3];
      if (drop > 4 && G.LKD[cellOf(P[i + 3][0], P[i + 3][1])] > 2) {
        const [x, z] = P[i + 3];
        for (let n = 0; n < 70; n++) { pts.push(x, W[i + 3], z); seeds.push(Math.random(), Math.random(), Math.random(), Math.min(1, drop / 12)); }
        i += 6;
      }
    }
  });
  if (!pts.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uSkyAmb: U.skyAmb, uSunCol: U.sunCol },
    vertexShader: `uniform float uTime; attribute vec4 aSeed; varying float vA;
      void main(){ float t = fract(uTime*(0.15 + aSeed.x*0.2) + aSeed.y);
        vec3 p = position + vec3((aSeed.x - 0.5)*6.0*t, t*(4.0 + aSeed.w*8.0), (aSeed.z - 0.5)*6.0*t);
        vec4 mv = viewMatrix*vec4(p, 1.0); vA = (1.0 - t)*smoothstep(0.0, 0.15, t)*aSeed.w*smoothstep(400.0, 80.0, -mv.z);
        gl_PointSize = (2.5 + t*7.0)*300.0/max(-mv.z, 1.0); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uSkyAmb, uSunCol; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uSkyAmb*1.6 + uSunCol*0.55, (1.0 - d*2.0)*vA*0.3); }`,
    transparent: true, depthWrite: false,
  }));
  m.frustumCulled = false; scene.add(m);
}
