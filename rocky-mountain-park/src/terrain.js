// Terrain: chunked LOD heightfield, distant mountain ring, splatted procedural ground materials.
import * as THREE from 'three';
import { HALF, N, CELL, BASE, CH, NCH, baseE } from './shared.js';
import { scene, U, GRID, G, Q } from './core.js';
import { patchLit } from './atmos.js';

let albTex, nrmTex;
export const groundAlb = () => albTex;
export function makeGroundTextures(tex) {
  albTex = new THREE.DataArrayTexture(tex.alb, tex.size, tex.size, tex.layers);
  albTex.colorSpace = THREE.SRGBColorSpace;
  nrmTex = new THREE.DataArrayTexture(tex.nrm, tex.size, tex.size, tex.layers);
  for (const t of [albTex, nrmTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  }
}

export let terrainMat;
export function makeTerrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const useN = Q().normals;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, GRID, { uBiome: U.biomeTex, uTrail: U.trailTex, uAlb: { value: albTex }, uNrm: { value: nrmTex }, uWL: U.waterLvl });
    s.vertexShader = 'varying vec3 vWPos; varying vec3 vWN;\n' + s.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
  };
  patchLit(m, {
    key: 'terrain' + (useN ? 'N' : ''), ao: 1,
    extraPars: `varying vec3 vWPos; varying vec3 vWN; uniform sampler2D uBiome, uTrail; uniform float uHalf, uCell, uN, uSize, uBase;
      uniform highp sampler2DArray uAlb, uNrm;
      float layerMix(vec2 p, float l){ return smoothstep(0.3, 0.7, vnoise(p*0.045 + l*7.3)); }
      vec4 alb(vec2 p, float sc, float l){ vec2 uv = p/sc; vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8)*uv*0.41 + 0.31;
        return mix(texture(uAlb, vec3(uv, l)), texture(uAlb, vec3(uv2, l)), layerMix(p, l)); }
      vec3 nrm(vec2 p, float sc, float l){ vec2 uv = p/sc; vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8)*uv*0.41 + 0.31;
        return mix(texture(uNrm, vec3(uv, l)).xyz, texture(uNrm, vec3(uv2, l)).xyz, layerMix(p, l))*2.0 - 1.0; }
      vec3 triW(vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); return b/dot(b, vec3(1.0)); }
      uniform sampler2D uWL;
      float caust(vec2 uv, float t){
        vec2 p = mod(uv*6.28318, 6.28318) - 250.0, i = p; float c = 1.0;
        for (int n = 0; n < 4; n++) { float tt = t*(1.0 - 3.5/float(n + 1)); i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)); c += 1.0/length(vec2(p.x/(sin(i.x + tt)/0.005), p.y/(cos(i.y + tt)/0.005))); }
        c /= 4.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0);
      }
      float hblend(float t, float ha, float hb){ return clamp((t - 0.5)*3.0 + 0.5 + (hb - ha)*2.2, 0.0, 1.0)*step(0.001, t); }`,
    fragment: (f) => f.replace('#include <color_fragment>', `
      vec3 Nw = normalize(vWN); float slope = 1.0 - Nw.y; float E = vWPos.y + uBase;
      float inside = step(abs(vWPos.x), uHalf)*step(abs(vWPos.z), uHalf);
      vec4 bio = mix(vec4(0.55, 0.0, 0.0, 0.3), texture2D(uBiome, ((vWPos.xz + uHalf)/uCell + 0.5)/uN), inside);
      float trl = texture2D(uTrail, (vWPos.xz + uHalf)/uSize).r*inside;
      vec4 ex = texture2D(uExtra, worldUV(vWPos)); float flow = ex.g*inside, depo = ex.b*inside;
      float camD = length(vWPos - cameraPosition), df = 1.0 - smoothstep(60.0, 650.0, camD);
      vec2 P = vWPos.xz;
      float nL = vnoise(P*0.0035), n1 = vnoise(P*0.045), n2 = vnoise(P*0.21 + 3.7);
      float tl = 3460.0 + (nL - 0.5)*220.0;
      float wTun = smoothstep(tl - 40.0, tl + 90.0, E);
      float wFor = smoothstep(0.12, 0.65, bio.r)*(1.0 - wTun);
      float rk = smoothstep(0.30, 0.50, slope + (n1 - 0.5)*0.18);
      rk = max(rk, smoothstep(3720.0, 3980.0, E + (n2 - 0.5)*200.0)*0.75);
      float grav = max(smoothstep(0.95, 1.0, bio.b)*0.75, smoothstep(0.2, 0.6, depo)*smoothstep(2850.0, 3150.0, E));
      grav = max(grav, smoothstep(0.2, 0.3, slope)*smoothstep(3050.0, 3300.0, E)*0.8)*(1.0 - rk);
      float sl = 3800.0 + (nL - 0.5)*380.0 + Nw.z*320.0 + (vnoise(P*0.02) - 0.5)*120.0;
      float sn = smoothstep(sl, sl + 50.0, E + (n2 - 0.5)*90.0)*(1.0 - smoothstep(0.42, 0.62, slope));
      sn = max(sn, smoothstep(4150.0, 4260.0, E)*(1.0 - smoothstep(0.55, 0.8, slope)));
      sn *= smoothstep(0.2, 0.45, vnoise(P*0.008) + 0.25*Nw.y);
      float wDirt = smoothstep(0.3, 0.9, trl);
      // base vegetation layers
      vec4 aG = alb(P, 3.2, 0.0), aF = alb(P, 3.6, 1.0), aT = alb(P, 3.4, 6.0);
      vec3 gcol = aG.rgb;
      float dry = smoothstep(0.55, 0.85, nL + 0.3*n1 - 0.15)*(1.0 - bio.b);
      gcol = mix(gcol, gcol*vec3(1.35, 1.15, 0.8), dry*0.8);
      gcol = mix(gcol, gcol*vec3(0.75, 1.05, 0.7), bio.b*0.6);
      vec4 L = vec4(gcol, aG.a);
      L = mix(L, aF, hblend(wFor, L.a, aF.a));
      L = mix(L, aT, hblend(wTun, L.a, aT.a));
      vec4 aGr = alb(P, 1.5, 3.0); L = mix(L, aGr, hblend(grav, L.a, aGr.a));
      vec4 aD = alb(P, 2.2, 5.0); L = mix(L, aD, hblend(wDirt, L.a, aD.a)*0.9);
      vec3 tw = triW(Nw);
      vec4 aR = texture(uAlb, vec3(vWPos.zy/7.0, 2.0))*tw.x + texture(uAlb, vec3(P/7.0, 2.0))*tw.y + texture(uAlb, vec3(vWPos.xy/7.0, 2.0))*tw.z;
      aR.rgb *= mix(vec3(1.06, 0.98, 0.94), vec3(0.92, 0.95, 1.02), vnoise(P*0.006))*(1.0 - 0.38*smoothstep(0.35, 0.9, flow)*rk);
      aR.rgb *= 0.95 + 0.05*sin(E*0.25 + n1*8.0 + vnoise(P*0.01)*6.0);
      aR.rgb *= mix(vec3(0.85, 0.83, 0.82), vec3(1.08, 1.02, 0.96), smoothstep(0.3, 0.7, vnoise(P*0.0025 + 3.0)));
      L = mix(L, aR, hblend(rk, L.a, aR.a + 0.2));
      vec4 aS = alb(P, 6.0, 4.0); L = mix(L, aS, hblend(sn, L.a - 0.1, aS.a + 0.15));
      vec3 col = L.rgb*(0.86 + 0.28*vnoise(P*0.012));
      // wildflower specks for the mid distance
      float fl = bio.g*(1.0 - rk);
      if (camD < 170.0 && fl > 0.02) {
        vec2 fc = floor(P*2.5); float fh = hash12(fc);
        if (fh < fl*0.5) {
          float sp = hash12(fc + 11.3);
          vec3 fcol = sp < 0.2 ? srgb(vec3(0.62,0.62,0.95)) : sp < 0.4 ? srgb(vec3(0.88,0.22,0.15)) : sp < 0.6 ? srgb(vec3(0.98,0.82,0.2)) : sp < 0.8 ? srgb(vec3(0.62,0.42,0.9)) : srgb(vec3(0.95,0.95,0.92));
          vec2 fp = fract(P*2.5) - 0.5;
          col = mix(col, fcol, (1.0 - smoothstep(0.16, 0.3, length(fp)))*(1.0 - smoothstep(90.0, 170.0, camD))*smoothstep(10.0, 30.0, camD));
        }
      }
      col = mix(col, srgb(vec3(0.66, 0.52, 0.58)), fl*smoothstep(60.0, 300.0, camD)*0.2);
      col *= 1.0 - 0.38*uWet*(1.0 - sn);
      float uwD = texture2D(uWL, worldUV(vWPos)).r - vWPos.y;
      float under = smoothstep(0.0, 0.15, uwD);
      vec3 silt = mix(aD.rgb*vec3(0.75, 0.78, 0.6), aF.rgb*vec3(0.8, 0.95, 0.75), vnoise(P*0.15));
      col = mix(col, mix(col, silt, 0.6*(1.0 - rk))*mix(vec3(0.75, 0.88, 0.82), vec3(0.3, 0.46, 0.5), smoothstep(0.5, 6.0, uwD)), under);
      diffuseColor.rgb = col;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${useN ? `if (df > 0.01) {
        vec3 nG = nrm(P, 3.2, 0.0)*(1.0 - rk)*(1.0 - sn);
        vec3 nR = texture(uNrm, vec3(P/7.0, 2.0)).xyz*2.0 - 1.0;
        vec3 nS = nrm(P, 6.0, 4.0);
        vec3 nd = nG + nR*rk*1.6 + nS*sn + nrm(P, 1.5, 3.0)*grav;
        vec3 nb = normalize(Nw + vec3(nd.x, 0.0, nd.y)*df*0.9);
        normal = normalize((viewMatrix*vec4(nb, 0.0)).xyz);
      }` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (under > 0.01 && camD < 220.0) totalEmissiveRadiance += diffuseColor.rgb*uSunCol*caust(P/3.2, uTime*0.6)*under*exp(-uwD*0.35)*sunVisAt(vWPos)*2.2*(1.0 - camD/220.0);
      if (sn > 0.3 && camD < 90.0) { float g = step(0.9975, hash12(floor(P*30.0) + floor(cameraPosition.xz*0.8)*1.7));
        totalEmissiveRadiance += uSunCol*g*sn*6.0*sunVisAt(vWPos)*(1.0 - camD/90.0); }`),
  });
  terrainMat = m;
  return m;
}

// ---------------------------------------------------------------- chunked LOD mesh with skirts
const idxCache = {};
const EDGE = [(n, i) => i, (n, i) => (n - 1) * n + i, (n, i) => i * n, (n, i) => i * n + n - 1];
function chunkIndex(n) {
  if (idxCache[n]) return idxCache[n];
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const base = n * n;
  for (let e = 0; e < 4; e++) for (let i = 0; i < n - 1; i++) {
    const t0 = EDGE[e](n, i), t1 = EDGE[e](n, i + 1), s0 = base + e * n + i, s1 = s0 + 1;
    idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  return idxCache[n] = new THREE.BufferAttribute(new Uint16Array(idx), 1);
}
function buildChunkGeo(cx, cz, lod) {
  const { H, NRM } = G;
  const step = 1 << lod, n = CH / step + 1, i0 = cx * CH, j0 = cz * CH, vc = n * n + 4 * n;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  let v = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, v++) {
    const gi = i0 + i * step, gj = j0 + j * step, k = gj * N + gi;
    pos[v * 3] = -HALF + gi * CELL; pos[v * 3 + 1] = H[k]; pos[v * 3 + 2] = -HALF + gj * CELL;
    nor[v * 3] = NRM[k * 3]; nor[v * 3 + 1] = NRM[k * 3 + 1]; nor[v * 3 + 2] = NRM[k * 3 + 2];
  }
  const worldEdge = [cz === 0, cz === NCH - 1, cx === 0, cx === NCH - 1];
  for (let e = 0; e < 4; e++) {
    const drop = worldEdge[e] ? 160 : 6 * step + 4;
    for (let i = 0; i < n; i++, v++) {
      const s = EDGE[e](n, i);
      pos[v * 3] = pos[s * 3]; pos[v * 3 + 1] = pos[s * 3 + 1] - drop; pos[v * 3 + 2] = pos[s * 3 + 2];
      nor[v * 3] = nor[s * 3]; nor[v * 3 + 1] = nor[s * 3 + 1]; nor[v * 3 + 2] = nor[s * 3 + 2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(chunkIndex(n)); g.computeBoundingSphere();
  return g;
}
export const chunks = [];
export function buildTerrain() {
  makeTerrainMaterial();
  const { H } = G;
  for (let cz = 0; cz < NCH; cz++) for (let cx = 0; cx < NCH; cx++) {
    let mx = -1e9;
    for (let j = cz * CH; j <= cz * CH + CH; j += 4) for (let i = cx * CH; i <= cx * CH + CH; i += 4) mx = Math.max(mx, H[j * N + i]);
    const ch = { cx, cz, lod: -1, geos: [], x0: -HALF + cx * CH * CELL, z0: -HALF + cz * CH * CELL, mx };
    ch.x1 = ch.x0 + CH * CELL; ch.z1 = ch.z0 + CH * CELL;
    ch.mesh = new THREE.Mesh(undefined, terrainMat); ch.mesh.receiveShadow = true; ch.mesh.matrixAutoUpdate = false;
    chunks.push(ch); scene.add(ch.mesh);
  }
  const RS = 200, RR = 70, r0 = 2500, r1 = 21000, pos = [], idx = [];
  for (let a = 0; a <= RR; a++) {
    const r = r0 * Math.pow(r1 / r0, a / RR);
    for (let s = 0; s <= RS; s++) {
      const th = s / RS * Math.PI * 2, x = Math.cos(th) * r, z = Math.sin(th) * r;
      let y = baseE(x, z) - BASE; if (Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4) y -= 90;
      pos.push(x, y, z);
    }
  }
  for (let a = 0; a < RR; a++) for (let s = 0; s < RS; s++) { const p = a * (RS + 1) + s, q = p + RS + 1; idx.push(p, p + 1, q, p + 1, q + 1, q); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
  scene.add(new THREE.Mesh(rg, terrainMat));
}
export function resetTerrainLOD() { for (const ch of chunks) ch.lod = -1; }
export function updateTerrainLOD(cx, cy, cz) {
  const q = Q().lod;
  for (const ch of chunks) {
    const dx = Math.max(ch.x0 - cx, 0, cx - ch.x1), dz = Math.max(ch.z0 - cz, 0, cz - ch.z1);
    const d = Math.hypot(dx, dz, Math.max(0, cy - ch.mx) * 0.7);
    const lod = d < 260 * q ? 0 : d < 750 * q ? 1 : d < 1700 * q ? 2 : d < 3200 * q ? 3 : 4;
    if (lod !== ch.lod) { ch.lod = lod; ch.mesh.geometry = ch.geos[lod] || (ch.geos[lod] = buildChunkGeo(ch.cx, ch.cz, lod)); }
  }
}
