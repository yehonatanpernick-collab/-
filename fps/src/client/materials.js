// Custom PBR materials built on MeshStandardMaterial via shader injection:
//  - triplanar world-space albedo/normal/roughness (for instanced architecture)
//  - splat-blended terrain (grass/dirt/gravel/asphalt + slope rock), macro variation
//  - wind-animated foliage
import * as THREE from 'three';

const TP_VERT_DECL = 'varying vec3 vTpPos;\nvarying vec3 vTpN;\n';
const TP_VERT = `
{
  vec4 tp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    tp = instanceMatrix * tp;
  #endif
  tp = modelMatrix * tp;
  vTpPos = tp.xyz;
  vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tn = mat3(instanceMatrix) * tn;
  #endif
  vTpN = normalize(mat3(modelMatrix) * tn);
}
`;

export function triplanarMaterial(tex, macro, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff, roughness: o.rough ?? 1, metalness: o.metal ?? 0, envMapIntensity: o.env ?? 1,
    transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  const uniforms = {
    tAlb: { value: tex.map }, tNor: { value: tex.normal }, tMacro: { value: macro },
    uScale: { value: o.scale ?? 0.35 }, uNStr: { value: o.nstr ?? 1 }, uGrime: { value: o.grime ?? 0.35 },
    uMacroAmt: { value: o.macroAmt ?? 0.32 }, uWet: { value: 0 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + TP_VERT_DECL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TP_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      ${TP_VERT_DECL}
      uniform sampler2D tAlb; uniform sampler2D tNor; uniform sampler2D tMacro;
      uniform float uScale; uniform float uNStr; uniform float uGrime; uniform float uMacroAmt;
      vec3 tpW; vec2 tpUX; vec2 tpUY; vec2 tpUZ; float tpRough;`)
      .replace('#include <map_fragment>', `
        vec3 tpN0 = normalize(vTpN);
        tpW = pow(abs(tpN0), vec3(5.0)); tpW /= (tpW.x + tpW.y + tpW.z);
        tpUX = vTpPos.zy * uScale; tpUY = vTpPos.xz * uScale; tpUZ = vTpPos.xy * uScale;
        tpUX.x *= sign(tpN0.x); tpUZ.x *= -sign(tpN0.z);
        vec4 tpA = texture2D(tAlb, tpUX) * tpW.x + texture2D(tAlb, tpUY) * tpW.y + texture2D(tAlb, tpUZ) * tpW.z;
        vec3 mac = texture2D(tMacro, vTpPos.xz * 0.011 + vTpPos.y * 0.004).rgb;
        float grime = (1.0 - smoothstep(0.0, 2.2, vTpPos.y - 4.0)) * step(3.0, vTpPos.y) * uGrime;
        float drip = smoothstep(0.55, 0.8, texture2D(tMacro, vec2(vTpPos.x * 0.07 + vTpPos.z * 0.07, vTpPos.y * 0.012)).g) * 0.18 * (1.0 - tpW.y);
        diffuseColor.rgb *= tpA.rgb * (1.0 - uMacroAmt * 0.5 + mac.r * uMacroAmt) * (1.0 - grime * 0.6) * (1.0 - drip);
        tpRough = tpA.a;
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tpRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nX = texture2D(tNor, tpUX).xyz * 2.0 - 1.0;
          vec3 nY = texture2D(tNor, tpUY).xyz * 2.0 - 1.0;
          vec3 nZ = texture2D(tNor, tpUZ).xyz * 2.0 - 1.0;
          nX.xy *= uNStr; nY.xy *= uNStr; nZ.xy *= uNStr;
          nX.x *= sign(tpN0.x); nZ.x *= -sign(tpN0.z);
          nX = vec3(nX.xy + tpN0.zy, abs(nX.z) * tpN0.x);
          nY = vec3(nY.xy + tpN0.xz, abs(nY.z) * tpN0.y);
          nZ = vec3(nZ.xy + tpN0.xy, abs(nZ.z) * tpN0.z);
          vec3 wn = normalize(nX.zyx * tpW.x + nY.xzy * tpW.y + nZ.xyz * tpW.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'tp' + (o.key || '');
  return m;
}

export function terrainMaterial(T, splat, macro) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.6 });
  const uniforms = {
    tSplat: { value: splat }, tMacro: { value: macro },
    tGA: { value: T.grass.map }, tGN: { value: T.grass.normal },
    tDA: { value: T.dirt.map }, tDN: { value: T.dirt.normal },
    tRA: { value: T.rock.map }, tRN: { value: T.rock.normal },
    tVA: { value: T.gravel.map }, tVN: { value: T.gravel.normal },
    tAA: { value: T.asphalt.map }, tAN: { value: T.asphalt.normal },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP; varying vec3 vWN;
      uniform sampler2D tSplat; uniform sampler2D tMacro;
      uniform sampler2D tGA; uniform sampler2D tGN; uniform sampler2D tDA; uniform sampler2D tDN;
      uniform sampler2D tRA; uniform sampler2D tRN; uniform sampler2D tVA; uniform sampler2D tVN;
      uniform sampler2D tAA; uniform sampler2D tAN;
      vec3 trN; float trRough;
      vec4 hblend(vec4 a, float ha, vec4 b, float hb, float t) {
        float d = 0.25; float ma = max(ha + 1.0 - t, hb + t) - d;
        float wa = max(ha + 1.0 - t - ma, 0.0), wb = max(hb + t - ma, 0.0);
        return (a * wa + b * wb) / (wa + wb);
      }`)
      .replace('#include <map_fragment>', `
        vec2 wuv = vWP.xz;
        vec4 sp = texture2D(tSplat, wuv / 1024.0 + 0.5);
        vec3 mac = texture2D(tMacro, wuv * 0.0021).rgb;
        vec3 mac2 = texture2D(tMacro, wuv * 0.013).rgb;
        vec3 wn = normalize(vWN);
        float slope = 1.0 - wn.y;
        vec2 uvG = wuv * 0.21, uvD = wuv * 0.17, uvR = wuv * 0.07, uvV = wuv * 0.25, uvA = wuv * 0.12;
        vec4 g = mix(texture2D(tGA, uvG), texture2D(tGA, uvG * 0.23 + 0.31), 0.35);
        g.rgb *= mix(vec3(1.06, 1.0, 0.82), vec3(0.82, 0.92, 0.72), mac.r) * (0.85 + mac2.g * 0.3);
        vec4 dcol = texture2D(tDA, uvD); vec4 rc = texture2D(tRA, uvR); vec4 vc = texture2D(tVA, uvV); vec4 ac = texture2D(tAA, uvA);
        vec4 gn = texture2D(tGN, uvG), dn = texture2D(tDN, uvD), rn = texture2D(tRN, uvR), vn = texture2D(tVN, uvV), an = texture2D(tAN, uvA);
        float wD = clamp(sp.r + smoothstep(0.62, 0.8, mac.g) * 0.5, 0.0, 1.0);
        float wV = sp.b, wA = sp.g;
        float wR = smoothstep(0.16, 0.34, slope + (mac2.r - 0.5) * 0.12) * (1.0 - wA);
        vec4 col = g; vec3 nn = gn.xyz;
        col = hblend(col, 0.5, dcol, dn.a * 0.0 + dcol.a * 0.0 + 0.5 + (mac2.b - 0.5), wD); nn = mix(nn, dn.xyz, wD);
        col = mix(col, vc, wV); nn = mix(nn, vn.xyz, wV);
        col = mix(col, ac, wA); nn = mix(nn, an.xyz, wA);
        col = mix(col, rc, wR); nn = mix(nn, rn.xyz, wR);
        col.rgb *= 1.0 - sp.a * 0.75;
        diffuseColor.rgb *= col.rgb;
        trRough = col.a;
        trN = nn * 2.0 - 1.0;
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * trRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 N = normalize(vWN);
          vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
          vec3 Bg = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
          vec3 wnn = normalize(Tg * trN.x * 1.2 + Bg * trN.y * 1.2 + N * trN.z);
          normal = normalize((viewMatrix * vec4(wnn, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'terrain';
  return m;
}

// foliage: alpha-tested leaves with wind sway & translucency-ish lift
export function foliageMaterial(map, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, roughness: 0.85, metalness: 0, map, alphaTest: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  const uniforms = { uTime: { value: 0 }, uWind: { value: o.wind ?? 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 ip = vec4(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3];
          #endif
          float hgt = max(0.0, position.y);
          float ph = ip.x * 0.13 + ip.z * 0.17;
          float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * uWind * 0.025 * hgt;
          transformed.x += sway; transformed.z += sway * 0.6;
          transformed.xz += sin(uTime * 6.0 + position.y * 3.0 + ph) * 0.012 * hgt * uWind;
        }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.06;');
  };
  m.customProgramCacheKey = () => 'foliage' + (o.key || '');
  return m;
}

// camo / vertex-colour material for characters & vehicles
export function camoMaterial(macro, o = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, envMapIntensity: 0.8 });
  const uniforms = { tMacro: { value: macro }, uC1: { value: new THREE.Color(o.c1 ?? 0x6b6a4e) }, uC2: { value: new THREE.Color(o.c2 ?? 0x4a4a36) }, uC3: { value: new THREE.Color(o.c3 ?? 0x8a8466) }, uScale: { value: o.scale ?? 1.7 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCamo; varying float vCamo; varying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = aCamo; vOP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tMacro; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uScale; varying float vCamo; varying vec3 vOP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vCamo > 0.5) {
          vec2 cu = vOP.xy * uScale * 0.5 + vOP.z * uScale * 0.31;
          float n1 = texture2D(tMacro, cu * 0.5).r, n2 = texture2D(tMacro, cu * 0.9 + 0.37).g;
          vec3 c = uC1;
          c = mix(c, uC2, smoothstep(0.52, 0.56, n1));
          c = mix(c, uC3, smoothstep(0.6, 0.64, n2));
          float fine = texture2D(tMacro, vOP.xy * 9.0 + vOP.z * 7.0).b;
          diffuseColor.rgb = c * (0.88 + fine * 0.24) * vColor.rgb;
        }
        #ifdef USE_INSTANCING_COLOR
        #endif`);
  };
  m.customProgramCacheKey = () => 'camo' + (o.key || '');
  return m;
}
