// Global atmosphere: replaces three.js fog chunks with exponential height fog +
// aerial perspective + sun in-scattering, shared by every material through
// uniform objects that are passed by reference (plain {x,y,z,w} objects are not
// cloned by UniformsUtils, so one update reaches all programs).
import * as THREE from 'three';

export const ATMO = {
  // x: base density, y: height falloff (1/m), z: fog base altitude, w: aerial density
  params: { x: 0.00006, y: 0.0012, z: 1500, w: 0.000016 },
  sunDir: { x: 0.3, y: 0.6, z: -0.4 },
  sunColor: { x: 1.0, y: 0.92, z: 0.8 },
  horizon: { x: 0.62, y: 0.72, z: 0.84 },
  zenith: { x: 0.28, y: 0.45, z: 0.72 },
  misc: { x: 0, y: 0, z: 0, w: 0 }, // x: time (s), y: wetness, z: snow cover, w: wind
};

// terrain sun-shadow targets live here so they exist before any program clones its uniforms
function shadowRT(n) {
  const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  // uniform cloning nulls render-target textures and copies others: keep every clone on the live target
  rt.texture.isRenderTargetTexture = false;
  rt.texture.clone = function () { return this; };
  return rt;
}
export const TERRAIN_SHADOW_RT = [shadowRT(1024), shadowRT(512)];

export const atmoUniforms = {
  uFogParams: { value: ATMO.params },
  uFogSunDir: { value: ATMO.sunDir },
  uFogSunColor: { value: ATMO.sunColor },
  uFogHorizon: { value: ATMO.horizon },
  uFogZenith: { value: ATMO.zenith },
  uMisc: { value: ATMO.misc },
  uTerrShadowCore: { value: TERRAIN_SHADOW_RT[0].texture },
  uTerrShadowFar: { value: TERRAIN_SHADOW_RT[1].texture },
};

export const FOG_GLSL = /* glsl */`
uniform sampler2D uTerrShadowCore;
uniform sampler2D uTerrShadowFar;
// world-wide terrain sun shadow (1 lit, 0 in a mountain's shadow)
float terrSunShadow(vec3 wp) {
  vec2 a = abs(wp.xz);
  float wc = 1.0 - smoothstep(3700.0, 4000.0, max(a.x, a.y));
  float sf = texture2D(uTerrShadowFar, (wp.xz + 20480.0) / 40960.0).r;
  float sc = wc > 0.0 ? texture2D(uTerrShadowCore, (wp.xz + 4096.0) / 8192.0).r : 1.0;
  return mix(sf, sc, wc);
}
uniform vec4 uFogParams;
uniform vec3 uFogSunDir;
uniform vec3 uFogSunColor;
uniform vec3 uFogHorizon;
uniform vec3 uFogZenith;
vec3 skyTint(vec3 dir) {
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uFogHorizon, uFogZenith, pow(up, 0.45));
  float s = max(dot(dir, uFogSunDir), 0.0);
  c += uFogSunColor * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6) * clamp(uFogSunDir.y * 4.0 + 0.3, 0.0, 1.0);
  return c;
}
// returns rgb = in-scattered colour, a = opacity
vec4 atmosphere(vec3 camPos, vec3 worldPos) {
  vec3 d = worldPos - camPos;
  float L = length(d);
  vec3 dir = d / max(L, 1e-3);
  float f = uFogParams.y;
  float hc = camPos.y - uFogParams.z;
  float dy = d.y;
  // integral of density*exp(-f*(y-base)) along the ray
  float k = abs(dy * f) > 1e-4 ? (1.0 - exp(-dy * f)) / (dy * f) : 1.0;
  float heightFog = uFogParams.x * exp(-hc * f) * L * k;
  float aerial = uFogParams.w * L;
  float a = 1.0 - exp(-(heightFog + aerial));
  vec3 col = skyTint(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.6 + 0.02, dir.z)));
  return vec4(col, clamp(a, 0.0, 1.0));
}
`;

let installed = false;
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogView;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogView = mvPosition.xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor;\n varying vec3 vFogView;\n ${FOG_GLSL}\n#endif`;
  // terrain shadow attenuates the sun/moon only (headlights and other lights are unaffected)
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    `getDirectionalLightInfo( directionalLight, directLight );
    #ifdef USE_FOG
    directLight.color *= terrSunShadow(cameraPosition + transpose(mat3(viewMatrix)) * vFogView);
    #endif`);
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    vec3 fogWorld = cameraPosition + transpose(mat3(viewMatrix)) * vFogView;
    vec4 atm = atmosphere(cameraPosition, fogWorld);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, atm.rgb, atm.a);
  #endif`;
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && 'fogColor' in lib.uniforms) Object.assign(lib.uniforms, atmoUniforms);
  }
  // raw shader materials (e.g. sprites) that use UniformsLib.fog later
  Object.assign(THREE.UniformsLib.fog, atmoUniforms);
}

const tmp = new THREE.Vector3();
export function setSun(dirVec3, colorRGB) {
  ATMO.sunDir.x = dirVec3.x; ATMO.sunDir.y = dirVec3.y; ATMO.sunDir.z = dirVec3.z;
  ATMO.sunColor.x = colorRGB.r; ATMO.sunColor.y = colorRGB.g; ATMO.sunColor.z = colorRGB.b;
}
export function setSkyColors(horizon, zenith) {
  ATMO.horizon.x = horizon.r; ATMO.horizon.y = horizon.g; ATMO.horizon.z = horizon.b;
  ATMO.zenith.x = zenith.r; ATMO.zenith.y = zenith.g; ATMO.zenith.z = zenith.b;
}
