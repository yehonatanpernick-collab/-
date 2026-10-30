// Sky, atmosphere, clouds, time of day, weather and the lighting patch shared by all lit materials.
import * as THREE from 'three';
import { ss, clamp, lerp, mulberry32, HALF, SIZE } from './shared.js';
import { renderer, scene, camera, U, Q, lin, heightAt } from './core.js';

export const CLOUD_H = 2900; // cloud deck height (scene units, ~5,300 m elevation)

// ---------------------------------------------------------------- shared GLSL
export const GLSL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  float a = hash12(i), b = hash12(i+vec2(1.0,0.0)), c = hash12(i+vec2(0.0,1.0)), d = hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }
float fbm3(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.1; a*=0.5;} return s/0.875; }
float fbm5(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+17.1; a*=0.5;} return s/0.96875; }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
`;
export const ATMOS_PARS = `
uniform float uTime, uFogDen, uMist, uNight, uStorm, uWet, uFlash, uCloudCov, uSkyGain;
uniform vec3 uSunDir, uLightDir, uSunTint, uSunCol, uSkyAmb;
uniform sampler2D uSkyLUT, uSunVis, uExtra;
${GLSL_NOISE}
const float CLOUD_H = ${CLOUD_H.toFixed(1)};
float cloudD(vec2 p){
  vec2 q = p*0.00042 + uTime*vec2(0.0035, 0.0012);
  float w = fbm3(q*0.6 + 3.1);
  float n = fbm5(q + w*0.9);
  return smoothstep(1.0 - uCloudCov, 1.18 - uCloudCov, n);
}
float cloudShadow(vec3 wp){
  vec2 p = wp.xz + uLightDir.xz/max(uLightDir.y, 0.12)*(CLOUD_H - wp.y);
  return 1.0 - 0.7*cloudD(p);
}
vec2 worldUV(vec3 wp){ return (wp.xz + ${HALF.toFixed(1)})/${SIZE.toFixed(1)}; }
float sunVisAt(vec3 wp){ return texture2D(uSunVis, worldUV(wp)).r; }
float aoAt(vec3 wp){ return texture2D(uExtra, worldUV(wp)).r; }
vec3 skyL(vec3 d){ d.y = max(d.y, 0.0); float u = atan(d.z, d.x)/6.2831853 + 0.5; return texture2D(uSkyLUT, vec2(u, sqrt(d.y))).rgb*uSkyGain; }
vec3 fogColor(vec3 rd){
  vec3 fc = skyL(normalize(vec3(rd.x, max(rd.y, 0.0)*0.3 + 0.025, rd.z)));
  fc += uSunTint*pow(max(dot(rd, uSunDir), 0.0), 8.0)*0.35*(1.0 - uNight);
  fc = mix(fc, vec3(dot(fc, vec3(0.3, 0.4, 0.3))), uStorm*0.55);
  return fc + vec3(0.6, 0.65, 0.8)*uFlash*0.25;
}
vec3 applyAtmos(vec3 col, vec3 wp){
  vec3 rd = wp - cameraPosition; float d = length(rd); rd /= max(d, 1e-3);
  float k = 1.0/1500.0;
  float a = uFogDen*exp(-k*max(cameraPosition.y + 50.0, -50.0));
  float dy = rd.y*d;
  float f = a*d*(abs(dy*k) > 1e-4 ? (1.0 - exp(-k*dy))/(k*dy) : 1.0);
  f += uMist*0.0035*min(d, 2500.0)*exp(-max(min(wp.y, cameraPosition.y) - 70.0, 0.0)/45.0);
  vec3 ext = 1.0 - exp(-f*vec3(0.72, 0.88, 1.15));
  return mix(col, fogColor(rd), ext);
}
`;
export const atmosUniforms = () => ({
  uTime: U.time, uFogDen: U.fogDen, uMist: U.mist, uNight: U.night, uStorm: U.storm, uWet: U.wet, uFlash: U.flash, uCloudCov: U.cloudCov,
  uSkyGain: skyGain, uSunDir: U.sunDir, uLightDir: U.lightDir, uSunTint: U.sunTint, uSunCol: U.sunCol, uSkyAmb: U.skyAmb,
  uSkyLUT: U.skyLUT, uSunVis: U.sunVis, uExtra: U.extra,
});
const skyGain = { value: 0.32 };

// Patch a built-in (Lambert) material: mountain shadows, terrain AO, cloud shadows, storm flash and aerial perspective.
export function patchLit(m, { ao = 1, wet = 0, key = 'lit', extraPars = '', vertex, fragment } = {}) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, s, r);
    Object.assign(s.uniforms, atmosUniforms());
    s.vertexShader = 'varying vec3 vAW;\n' + s.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 aw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        aw = instanceMatrix*aw;
      #endif
      vAW = (modelMatrix*aw).xyz;`);
    if (vertex) s.vertexShader = vertex(s.vertexShader);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAW;\n${ATMOS_PARS}\n${extraPars}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float lvis = sunVisAt(vAW)*cloudShadow(vAW);
        reflectedLight.directDiffuse *= lvis;
        reflectedLight.indirectDiffuse *= mix(1.0, aoAt(vAW), ${ao.toFixed(2)});
        reflectedLight.indirectDiffuse += diffuseColor.rgb*uFlash*1.5;`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vAW);');
    if (wet) s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= 1.0 - ${wet.toFixed(2)}*uWet;`);
    if (fragment) s.fragmentShader = fragment(s.fragmentShader);
  };
  const pk = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => pk() + '|' + key;
  return m;
}

// ---------------------------------------------------------------- sky LUT (single-scattering Rayleigh + Mie)
const lutRT = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, depthBuffer: false });
lutRT.texture.wrapS = THREE.RepeatWrapping; lutRT.texture.minFilter = lutRT.texture.magFilter = THREE.LinearFilter;
U.skyLUT.value = lutRT.texture;
const lutMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: new THREE.Vector3() }, uStorm: U.storm },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform vec3 uSun; uniform float uStorm;
    vec2 rsi(vec3 r0, vec3 rd, float sr){ float a = dot(rd, rd), b = 2.0*dot(rd, r0), c = dot(r0, r0) - sr*sr, d = b*b - 4.0*a*c;
      if (d < 0.0) return vec2(1e5, -1e5); return vec2((-b - sqrt(d))/(2.0*a), (-b + sqrt(d))/(2.0*a)); }
    void main(){
      float az = (vUv.x - 0.5)*6.2831853, y = vUv.y*vUv.y, hz = sqrt(max(1.0 - y*y, 0.0));
      vec3 r = vec3(cos(az)*hz, max(y, 0.002), sin(az)*hz);
      const float Rp = 6371e3, Ra = 6471e3; vec3 r0 = vec3(0.0, Rp + 2600.0, 0.0);
      const vec3 kR = vec3(5.5e-6, 13.0e-6, 22.4e-6); float kM = 21e-6*(1.0 + uStorm*4.0);
      vec2 p = rsi(r0, r, Ra); vec2 pl = rsi(r0, r, Rp); if (pl.x > 0.0) p.y = min(p.y, pl.x); p.x = max(p.x, 0.0);
      float st = (p.y - p.x)/16.0, t = 0.0, odR = 0.0, odM = 0.0; vec3 tR = vec3(0.0), tM = vec3(0.0);
      float mu = dot(r, uSun), g = 0.76, gg = g*g;
      float pR = 3.0/(16.0*3.14159)*(1.0 + mu*mu);
      float pM = 3.0/(8.0*3.14159)*((1.0 - gg)*(mu*mu + 1.0))/(pow(1.0 + gg - 2.0*mu*g, 1.5)*(2.0 + gg));
      for (int i = 0; i < 16; i++) {
        vec3 ip = r0 + r*(t + st*0.5); float ih = length(ip) - Rp;
        float dR = exp(-ih/8e3)*st, dM = exp(-ih/1.2e3)*st; odR += dR; odM += dM;
        float js = rsi(ip, uSun, Ra).y/8.0, jt = 0.0, jR = 0.0, jM = 0.0;
        for (int j = 0; j < 8; j++) { vec3 jp = ip + uSun*(jt + js*0.5); float jh = length(jp) - Rp; jR += exp(-jh/8e3)*js; jM += exp(-jh/1.2e3)*js; jt += js; }
        vec3 att = exp(-(kM*(odM + jM) + kR*(odR + jR)));
        tR += dR*att; tM += dM*att; t += st;
      }
      vec3 c = 22.0*(pR*kR*tR + pM*kM*tM);
      c = mix(c, vec3(dot(c, vec3(0.3, 0.45, 0.25)))*vec3(0.85, 0.9, 1.0), uStorm*0.7)*(1.0 - uStorm*0.55);
      gl_FragColor = vec4(c + vec3(0.0015, 0.0025, 0.006), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const lutScene = new THREE.Scene(), lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const lutQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lutMat); lutQuad.frustumCulled = false; lutScene.add(lutQuad);
let lutKey = '';
function renderLUT() {
  const s = U.sunDir.value, key = `${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)},${U.storm.value.toFixed(2)}`;
  if (key === lutKey) return; lutKey = key;
  lutMat.uniforms.uSun.value.copy(s);
  const prevT = renderer.getRenderTarget(); renderer.setRenderTarget(lutRT); renderer.render(lutScene, lutCam); renderer.setRenderTarget(prevT);
}

// ---------------------------------------------------------------- sky dome: scattering, sun, clouds, stars, moon
export let sky;
const moonDir = new THREE.Vector3();
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosUniforms(), uMoonDir: { value: moonDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `${ATMOS_PARS} uniform vec3 uMoonDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyL(d);
        if (d.y < 0.0) col = mix(col, fogColor(d)*0.8, smoothstep(0.0, -0.1, d.y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunTint*smoothstep(0.99955, 0.99985, sd)*40.0*(1.0 - uStorm);
        // night sky
        if (uNight > 0.01) {
          vec3 sp = floor(d*420.0); float st = hash13(sp);
          float star = step(0.9965, st)*pow(hash13(sp + 7.0), 6.0)*(0.6 + 0.4*sin(uTime*3.0 + st*90.0));
          vec3 bandN = normalize(vec3(0.35, 0.55, 0.76));
          float mw = exp(-pow(dot(d, bandN)/0.2, 2.0))*fbm5(vec2(atan(d.z, d.x)*6.0, d.y*8.0))*0.05;
          col += (vec3(star)*2.2 + vec3(0.75, 0.8, 1.0)*mw)*uNight*smoothstep(-0.05, 0.15, d.y)*(1.0 - uStorm);
          float md = dot(d, uMoonDir);
          float disc = smoothstep(0.99955, 0.9998, md);
          vec3 lp = normalize(d - uMoonDir*md);
          float lit = 0.25 + 0.75*smoothstep(-0.2, 0.6, dot(lp, normalize(uSunDir - uMoonDir*dot(uSunDir, uMoonDir))));
          col += vec3(0.9, 0.92, 1.0)*(disc*lit*3.0*(0.8 + 0.2*vnoise(d.xz*900.0)) + pow(max(md, 0.0), 300.0)*0.08)*uNight;
        }
        // cloud deck
        if (d.y > 0.0) {
          float t = (CLOUD_H - cameraPosition.y)/max(d.y, 0.02);
          vec2 p = cameraPosition.xz + d.xz*t;
          float den = cloudD(p);
          if (den > 0.002) {
            float tow = cloudD(p + uSunDir.xz*220.0), tow2 = cloudD(p + uSunDir.xz*600.0);
            float lightT = exp(-(tow*1.6 + tow2*0.9));
            vec3 amb = skyL(vec3(0.0, 1.0, 0.0))*1.1 + vec3(0.03, 0.035, 0.05);
            vec3 cc = uSunTint*lightT*1.25*(1.0 - uNight*0.9) + amb*(0.6 + 0.4*(1.0 - den));
            cc += uSunTint*pow(sd, 6.0)*0.8*(1.0 - den)*lightT;
            cc = mix(cc, vec3(0.16, 0.17, 0.2)*(dot(amb, vec3(0.3)) + 0.12), uStorm*den*0.85);
            cc += vec3(0.75, 0.78, 1.0)*uFlash*den*2.0;
            float far = exp(-t*0.000045);
            col = mix(col, cc, den*far*0.97);
          }
          // high cirrus
          vec2 ci = cameraPosition.xz*0.00003 + d.xz/max(d.y, 0.05)*0.25 + uTime*vec2(0.002, 0.0006);
          float cir = smoothstep(0.55, 0.9, fbm5(vec2(ci.x*1.0, ci.y*5.0)))*0.35*smoothstep(0.02, 0.2, d.y)*(1.0 - uStorm);
          col = mix(col, uSunTint*0.9 + skyL(vec3(0.0, 1.0, 0.0)), cir);
        }
        col += vec3(0.55, 0.6, 0.85)*uFlash*0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32), mat);
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
}

// ---------------------------------------------------------------- lights & time of day
export const sun = new THREE.DirectionalLight(0xffffff, 4);
sun.castShadow = true; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
export const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a5a32, 1.2); scene.add(hemi);
export function applyShadowQuality() {
  const s = Q().shadow; sun.castShadow = s > 0;
  if (s > 0) {
    sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    const e = s >= 4096 ? 220 : s > 1024 ? 160 : 100;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 1600 }); sun.shadow.camera.updateProjectionMatrix();
  }
}
export const sky_state = { hour: 10.5, weather: 'fair', stormT: 0 };
const WEATHER = { clear: 0.3, fair: 0.46, storm: 0.86 };
let sunBake = null;
export function setSunBaker(fn) { sunBake = fn; }
export function setTime(hour) {
  sky_state.hour = hour;
  const t = (hour - 5.6) / 15, phi = Math.PI * t, el = Math.sin(Math.PI * t) * 1.2 - 0.05, ce = Math.cos(el);
  const sd = U.sunDir.value.set(Math.cos(phi) * ce, Math.sin(el), Math.sin(phi) * ce * 0.9 - 0.25 * ce).normalize();
  moonDir.set(-sd.x * 0.8 + 0.2, -sd.y * 0.9 + 0.25, -sd.z * 0.8 - 0.3).normalize();
  updateLighting();
}
// sun colour from optical air mass, normalised so noon is near-white
function sunColour(h) {
  const el = Math.max(h, -0.02), m = 1 / (Math.sin(Math.asin(clamp(el, -1, 1))) + 0.15 * Math.pow(Math.max(Math.asin(clamp(el, -1, 1)) * 57.3 + 3.885, 0.1), -1.253));
  const k = [0.05, 0.11, 0.27];
  return lin(Math.exp(-k[0] * (m - 1)), Math.exp(-k[1] * (m - 1)), Math.exp(-k[2] * (m - 1)));
}
function updateLighting() {
  const sd = U.sunDir.value, h = sd.y, storm = U.storm.value;
  const day = ss(-0.06, 0.25, h), night = 1 - ss(-0.14, -0.02, h);
  U.night.value = night;
  const sc = sunColour(h);
  U.sunTint.value.copy(sc).multiplyScalar(ss(-0.03, 0.05, h));
  const useMoon = h < -0.02;
  const ld = useMoon ? moonDir : sd;
  U.lightDir.value.copy(ld);
  const si = useMoon ? 0.5 * ss(0.0, 0.3, moonDir.y) : 4.8 * ss(-0.02, 0.12, h) * (1 - 0.85 * storm);
  sun.color.copy(useMoon ? lin(0.62, 0.7, 0.95) : sc); sun.intensity = si;
  hemi.color.copy(lin(0.58, 0.7, 0.95).lerp(lin(0.95, 0.72, 0.6), (1 - ss(0.05, 0.4, h)) * day * 0.6).lerp(lin(0.6, 0.63, 0.68), storm * 0.7));
  hemi.groundColor.copy(lin(0.32, 0.32, 0.22));
  hemi.intensity = (0.16 + 1.3 * day + 0.35 * (1 - ss(0.05, 0.35, h)) * day) * (1 - 0.3 * storm) + night * 0.14;
  U.sunCol.value.copy(sun.color).multiplyScalar(si / Math.PI);
  U.skyAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI);
  renderer.toneMappingExposure = (0.92 + 0.35 * (1 - ss(0.05, 0.4, h)) + 0.6 * (1 - day) + 1.8 * night) * (1 + 0.35 * storm);
  U.mist.value = (1 - ss(8.0, 10.0, sky_state.hour)) * ss(4.5, 6.2, sky_state.hour) * 1.0 + storm * 0.3;
  U.fogDen.value = 9e-5 * (1 + storm * 2.2);
  sunBake?.(ld);
}

// ---------------------------------------------------------------- weather: storm build-up, rain, lightning
let rain, bolt, boltT = 0, nextStrike = 8;
const rnd = mulberry32(5);
export const thunderQueue = [];
export function setWeather(w) { sky_state.weather = w; }
export function buildWeather() {
  const COUNT = 9000, pos = new Float32Array(COUNT * 4 * 3), off = new Float32Array(COUNT * 4 * 3), idx = [];
  for (let i = 0; i < COUNT; i++) {
    const x = rnd() * 2 - 1, y = rnd(), z = rnd() * 2 - 1;
    for (let v = 0; v < 4; v++) { off.set([x, y, z], (i * 4 + v) * 3); pos.set([v & 1 ? 0.5 : -0.5, v >> 1, 0], (i * 4 + v) * 3); }
    const b = i * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.BufferAttribute(off, 3)); g.setIndex(idx);
  rain = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uStorm: U.storm, uSkyAmb: U.skyAmb, uFlash: U.flash },
    vertexShader: `uniform float uTime, uStorm; attribute vec3 aOff; varying float vA; varying float vY;
      void main(){
        float R = 26.0, Hh = 34.0;
        vec3 c = cameraPosition; vec3 o = vec3(aOff.x*R, aOff.y*Hh, aOff.z*R);
        o.y = mod(o.y - uTime*11.0 - c.y, Hh) + c.y - Hh*0.45;
        o.xz = o.xz + 2.0*R*floor((c.xz - o.xz)/(2.0*R) + 0.5);
        o.x += (o.y - c.y)*0.12;
        vec3 toC = normalize(vec3(c.x - o.x, 0.0, c.z - o.z)); vec3 side = vec3(toC.z, 0.0, -toC.x);
        vec3 p = o + side*position.x*0.012 + vec3(0.12, 1.0, 0.0)*position.y*0.75;
        vA = smoothstep(0.45, 0.85, uStorm)*(1.0 - smoothstep(R*0.6, R, length(o.xz - c.xz))); vY = position.y;
        gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uSkyAmb; uniform float uFlash; varying float vA; varying float vY;
      void main(){ if (vA < 0.01) discard; gl_FragColor = vec4((uSkyAmb*4.0 + 0.08 + uFlash)*vec3(0.85, 0.9, 1.0), vA*0.32*vY); }`,
    transparent: true, depthWrite: false,
  }));
  rain.frustumCulled = false; scene.add(rain);
  bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 8), fog: false, toneMapped: false }));
  bolt.visible = false; bolt.frustumCulled = false; scene.add(bolt);
}
function strike() {
  const a = rnd() * 6.283, d = 1200 + rnd() * 2600, x = camera.position.x + Math.cos(a) * d, z = camera.position.z + Math.sin(a) * d;
  const top = CLOUD_H - 300, bot = heightAt(x, z), pts = [];
  let px = x, pz = z; for (let y = top; y > bot; y -= 60 + rnd() * 90) { px += (rnd() - 0.5) * 110; pz += (rnd() - 0.5) * 110; pts.push(new THREE.Vector3(px, y, pz)); }
  pts.push(new THREE.Vector3(px, bot, pz));
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), pts.length * 3, 4, 4, false);
  bolt.geometry.dispose(); bolt.geometry = tube; bolt.visible = true; boltT = 0.28; U.flash.value = 1;
  thunderQueue.push({ at: performance.now() / 1000 + d / 340, gain: clamp(1.6 - d / 3000, 0.25, 1) });
}
export function updateWeather(dt) {
  const target = sky_state.weather === 'storm' ? 1 : 0;
  U.storm.value = clamp(U.storm.value + Math.sign(target - U.storm.value) * dt / 18, 0, 1);
  if (Math.abs(target - U.storm.value) < dt / 18) U.storm.value = target;
  const cov = WEATHER[sky_state.weather];
  U.cloudCov.value = lerp(U.cloudCov.value, cov, dt * 0.08);
  U.wet.value = clamp(U.wet.value + (U.storm.value > 0.55 ? dt / 40 : -dt / 160), 0, 1);
  if (U.storm.value > 0.7) { nextStrike -= dt; if (nextStrike < 0) { strike(); nextStrike = 5 + rnd() * 13; } }
  if (boltT > 0) { boltT -= dt; U.flash.value = boltT > 0 ? (0.6 + 0.4 * Math.sin(boltT * 90)) * boltT / 0.28 : 0; if (boltT <= 0) bolt.visible = false; }
  if (U.storm.value > 0 || boltT > 0) updateLighting();
  renderLUT();
}
