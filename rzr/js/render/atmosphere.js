// Global atmosphere: replaces three.js fog chunks with exponential height fog +
// aerial perspective + sun in-scattering, shared by every material through
// uniform objects that are passed by reference (plain {x,y,z,w} objects are not
// cloned by UniformsUtils, so one update reaches all programs).
import * as THREE from 'three';

export const ATMO = {
  // x: base density, y: height falloff (1/m), z: fog base altitude, w: aerial density
  params: { x: 0.00012, y: 0.0011, z: 1500, w: 0.000035 },
  sunDir: { x: 0.3, y: 0.6, z: -0.4 },
  sunColor: { x: 1.0, y: 0.92, z: 0.8 },
  horizon: { x: 0.62, y: 0.72, z: 0.84 },
  zenith: { x: 0.28, y: 0.45, z: 0.72 },
  misc: { x: 0, y: 0, z: 0, w: 0 }, // x: time (s), y: wetness, z: snow cover, w: wind
};

export const atmoUniforms = {
  uFogParams: { value: ATMO.params },
  uFogSunDir: { value: ATMO.sunDir },
  uFogSunColor: { value: ATMO.sunColor },
  uFogHorizon: { value: ATMO.horizon },
  uFogZenith: { value: ATMO.zenith },
  uMisc: { value: ATMO.misc },
};

export const FOG_GLSL = /* glsl */`
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
