// ============================================================
//  Engine — renderer, height fog, sky + IBL, post-processing
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from '../lib/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../lib/postprocessing/ShaderPass.js';
import { OutputPass } from '../lib/postprocessing/OutputPass.js';
import { GTAOPass } from '../lib/postprocessing/GTAOPass.js';

// ---------- quality ----------
const qs = new URLSearchParams(location.search);
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITY = qs.get('q') || (IS_TOUCH ? 'med' : 'high');
export const Q = {
  low: { pr: 0.75, shadow: 1024, msaa: 0, ao: false, tex: 256, grass: 6000, rays: 0 },
  med: { pr: 1.0, shadow: 2048, msaa: 0, ao: false, tex: 512, grass: 32000, rays: 12 },
  high: { pr: 1.5, shadow: 4096, msaa: 4, ao: true, tex: 1024, grass: 80000, rays: 24 },
}[QUALITY] || { pr: 1, shadow: 2048, msaa: 0, ao: false, tex: 512, grass: 16000, rays: 12 };

// ---------- global shared uniforms ----------
export const G = {
  time: { value: 0 },
  wind: { value: new THREE.Vector2(1, 0.3) },
  player: { value: new THREE.Vector3() },
};

// ---------- height fog (patches built-in shader chunks) ----------
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vec4 fogW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogWorld = (modelMatrix * fogW).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec3 fogRay = vFogWorld - cameraPosition;
  float fogDist = length(fogRay);
  float fh = fogFar;
  float camH = cameraPosition.y - FOG_BASE;
  float dy = fogRay.y;
  float integ = abs(dy) > 0.05 ? (exp(-fh * camH) - exp(-fh * (camH + dy))) / (fh * dy) : exp(-fh * camH);
  float fogAmt = 1.0 - exp(-fogDist * fogNear * (0.18 + clamp(integ, 0.0, 6.0) * 1.4));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogAmt, 0.0, 1.0));
#endif`;
// FOG_BASE is a define; inject it once via the common chunk
THREE.ShaderChunk.common = '#ifndef FOG_BASE\n#define FOG_BASE 0.0\n#endif\n' + THREE.ShaderChunk.common;

/** Exponential height fog. density = overall, falloff = how fast it thins with height. */
export class HeightFog extends THREE.Fog {
  constructor(color, density, falloff) { super(color, density, falloff); }
  set density(v) { this.near = v; } get density() { return this.near; }
  set falloff(v) { this.far = v; } get falloff() { return this.far; }
}

// ---------- renderer ----------
export const canvas = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
export const PR = Math.min(window.devicePixelRatio || 1, Q.pr);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.08, 1400);
scene.add(camera);

// ---------- sky ----------
const SKY_GLSL = /* glsl */`
  varying vec3 vDir;
  uniform vec3 zenith, horizon, groundCol, glowCol, sunDir, sunCol, cloudCol, cloudLit, auroraCol, nebulaCol;
  uniform float sunSize, stars, clouds, aurora, nebula, time, flash, craters, cloudSpeed;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float h3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<6;i++){ s += a*n2(p); p = p*2.03 + 17.1; a *= .5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.95, h), 0.55));
    col = mix(col, groundCol, smoothstep(0.0, -0.2, h));
    float m = max(dot(d, sunDir), 0.0);
    col += glowCol * (pow(m, 5.0)*0.18 + pow(m, 36.0)*0.55 + pow(m, 400.0)*1.6);
    // nebula (void)
    if (nebula > 0.0) {
      vec2 np = vec2(atan(d.z, d.x)*1.6, d.y*3.0);
      float nn = fbm(np*1.4 + vec2(time*0.004, 0.0));
      float nn2 = fbm(np*3.1 - 4.0);
      col += nebulaCol * pow(nn, 3.0) * 2.4 * nebula * smoothstep(-0.15, 0.3, h);
      col += nebulaCol.bgr * pow(nn2, 4.0) * 1.2 * nebula * smoothstep(0.0, 0.5, h);
    }
    // stars
    if (stars > 0.0) {
      vec3 sp = d * 300.0; vec3 cell = floor(sp); vec3 f = fract(sp) - 0.5;
      float s = h3(cell);
      if (s > 0.982) {
        vec3 o = vec3(h3(cell+1.3), h3(cell+2.7), h3(cell+4.1)) - 0.5;
        float st = smoothstep(0.2, 0.0, length(f - o*0.6));
        float tw = 0.55 + 0.45*sin(time*(1.5+s*3.) + s*500.0);
        vec3 sc = mix(vec3(1.0,0.8,0.7), vec3(0.75,0.85,1.0), h3(cell+9.));
        col += sc * st * tw * smoothstep(0.02, 0.3, h) * (s - 0.982) * 55.0 * stars;
      }
    }
    // aurora (frost)
    if (aurora > 0.0) {
      vec2 ap = d.xz / (h + 0.22);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float band = fbm(vec2(ap.x*0.35 + time*0.015 + fk*3.1, ap.y*0.08 + fk));
        float curtain = smoothstep(0.42, 0.55, band) * smoothstep(0.7, 0.55, band);
        float rays = 0.6 + 0.4*sin(ap.x*14.0 + fbm(ap*2.0)*6.0 + time*0.4);
        vec3 ac = mix(auroraCol, auroraCol.gbr*vec3(1.2,0.6,1.4), fk*0.4);
        col += ac * curtain * rays * smoothstep(0.04, 0.3, h) * smoothstep(0.95, 0.45, h) * aurora * 1.4;
      }
    }
    // disc
    float cs = cos(sunSize);
    float disc = smoothstep(cs - 0.00012, cs + 0.00006, m);
    if (disc > 0.0) {
      vec3 t = normalize(cross(sunDir, vec3(0,1,0))); vec3 b = cross(t, sunDir);
      vec2 mu = vec2(dot(d,t), dot(d,b)) / sunSize;
      float cr = fbm(mu*3.0 + 3.0);
      float limb = sqrt(max(0.0, 1.0 - dot(mu,mu)));
      vec3 dc = sunCol * mix(1.0, (0.55 + 0.6*smoothstep(0.35, 0.7, cr)), craters) * (0.6 + 0.4*limb);
      col = mix(col, dc, disc);
    }
    // clouds
    if (clouds > 0.0) {
      vec2 cp = d.xz / (h + 0.12) * 1.2 + vec2(time*cloudSpeed, time*cloudSpeed*0.35);
      float c1 = fbm(cp);
      float c2 = fbm(cp*2.3 + 5.0);
      float ca = smoothstep(0.62 - clouds*0.25, 0.95, c1*0.75 + c2*0.35) * smoothstep(-0.03, 0.12, h);
      float lit = pow(m, 10.0) + 0.25*pow(m, 2.0);
      vec3 cc = mix(cloudCol, cloudLit, clamp(lit + (c1-0.5)*0.4, 0.0, 1.0));
      col = mix(col, cc, clamp(ca, 0.0, 0.94));
      col += cloudLit * flash * (0.4 + ca*1.5) * smoothstep(-0.1, 0.3, h);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, groundCol: { value: new THREE.Color() },
      glowCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, sunCol: { value: new THREE.Color() },
      cloudCol: { value: new THREE.Color() }, cloudLit: { value: new THREE.Color() }, auroraCol: { value: new THREE.Color() }, nebulaCol: { value: new THREE.Color() },
      sunSize: { value: 0.03 }, stars: { value: 1 }, clouds: { value: 0.5 }, aurora: { value: 0 }, nebula: { value: 0 }, time: G.time, flash: { value: 0 }, craters: { value: 1 }, cloudSpeed: { value: 0.006 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL,
  });
}
export const skyMat = makeSkyMaterial();
export const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -100;
sky.userData.noAO = true;
scene.add(sky);

export function applySky(s) {
  const u = skyMat.uniforms;
  for (const k of ['zenith', 'horizon', 'groundCol', 'glowCol', 'sunCol', 'cloudCol', 'cloudLit', 'auroraCol', 'nebulaCol']) if (s[k] !== undefined) u[k].value.set(s[k]);
  if (s.sunColHDR) u.sunCol.value.multiplyScalar(s.sunColHDR);
  if (s.glowHDR) u.glowCol.value.multiplyScalar(s.glowHDR);
  for (const k of ['sunSize', 'stars', 'clouds', 'aurora', 'nebula', 'craters', 'cloudSpeed']) if (s[k] !== undefined) u[k].value = s[k];
  u.sunDir.value.copy(s.sunDir).normalize();
}

// image-based lighting baked from the sky (+ optional extra emitters)
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
export function bakeEnvironment(extra = []) {
  const envScene = new THREE.Scene();
  const s2 = new THREE.Mesh(sky.geometry, skyMat);
  envScene.add(s2);
  for (const e of extra) envScene.add(e);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02, 0.1, 1000);
  scene.environment = envRT.texture;
  return envRT.texture;
}

// ---------- post ----------
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: Q.msaa });
export const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
export let gtao = null;
if (Q.ao) {
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  // hide transparent / flagged objects from the AO normal pass
  const base = gtao.overrideVisibility.bind(gtao);
  gtao.overrideVisibility = function () {
    base();
    this.scene.traverse((o) => { if (o.userData.noAO || (o.material && (o.material.transparent || o.material.isShaderMaterial))) o.visible = false; });
  };
  composer.addPass(gtao);
}
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

export const finalPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, time: G.time, res: { value: new THREE.Vector2(innerWidth * PR, innerHeight * PR) },
    sunPos: { value: new THREE.Vector2(0.5, 0.8) }, sunVis: { value: 0 }, rayCol: { value: new THREE.Color(1, 0.6, 0.5) }, rayStr: { value: 0.6 },
    lift: { value: new THREE.Vector3(0, 0, 0) }, gamma: { value: new THREE.Vector3(1, 1, 1) }, gain: { value: new THREE.Vector3(1, 1, 1) },
    sat: { value: 1 }, contrast: { value: 1.05 }, vig: { value: 0.55 },
    damage: { value: 0 }, lowHp: { value: 0 }, heal: { value: 0 }, fade: { value: 0 }, fadeCol: { value: new THREE.Color(0, 0, 0) }, bars: { value: 0 },
  },
  defines: { RAYS: Q.rays },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, sunVis, rayStr, sat, contrast, vig, damage, lowHp, heal, fade, bars;
    uniform vec2 res, sunPos; uniform vec3 rayCol, lift, gamma, gain, fadeCol; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float asp = res.x/res.y;
      float d = length(c*vec2(asp,1.0));
      float ca = 0.0012 + damage*0.007;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c*ca).b;
      #if RAYS > 0
      if (sunVis > 0.001) {
        vec2 dir = (uv - sunPos);
        vec2 suv = uv; float ill = 1.0; vec3 acc = vec3(0.0);
        float jitter = hash(uv*res + fract(time)) ;
        suv -= dir * (jitter / float(RAYS)) * 0.95;
        for (int i = 0; i < RAYS; i++) {
          suv -= dir * (1.0 / float(RAYS)) * 0.95;
          vec3 s = texture2D(tDiffuse, suv).rgb;
          float l = max(dot(s, vec3(0.3, 0.55, 0.15)) - 0.42, 0.0);
          acc += l * ill; ill *= 0.955;
        }
        float fall = smoothstep(1.3, 0.0, length(dir*vec2(asp,1.0)));
        col += rayCol * acc / float(RAYS) * rayStr * sunVis * fall * 2.0;
      }
      #endif
      // grade: lift / gamma / gain
      col = max(col * gain + lift * (1.0 - col), 0.0);
      col = pow(col, 1.0 / gamma);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat - lowHp*0.5);
      col = (col - 0.5) * contrast + 0.5;
      // vignette
      col *= mix(1.0 - vig, 1.0, smoothstep(1.05, 0.25, d));
      float pulse = 0.6 + 0.4*sin(time*5.0);
      col = mix(col, vec3(0.35, 0.0, 0.02), clamp(damage*0.5 + lowHp*0.3*pulse, 0.0, 0.8) * smoothstep(0.2, 0.95, d));
      col += vec3(0.9, 0.6, 0.25) * heal * 0.2 * smoothstep(0.3, 0.95, d);
      // film grain
      float g = hash(floor(uv*res) + fract(time*13.7)*vec2(91.7, 47.3));
      col += (g - 0.5) * 0.028;
      col = mix(col, fadeCol, fade);
      // cinematic bars
      float bar = step(uv.y, bars) + step(1.0 - bars, uv.y);
      col *= 1.0 - bar;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(finalPass);

export function applyGrade(gr) {
  const u = finalPass.uniforms;
  u.lift.value.set(...gr.lift); u.gamma.value.set(...gr.gamma); u.gain.value.set(...gr.gain);
  u.sat.value = gr.sat; u.contrast.value = gr.contrast; u.vig.value = gr.vig ?? 0.55;
  u.rayCol.value.set(gr.rayCol ?? 0xffaa88); u.rayStr.value = gr.rayStr ?? 0.5;
  renderer.toneMappingExposure = gr.exposure ?? 1;
  bloom.strength = gr.bloom ?? 0.55;
  bloom.threshold = gr.bloomThreshold ?? 0.92;
}

// project the sun/moon for light shafts
const _v = new THREE.Vector3();
export function updateSunScreen() {
  const dir = skyMat.uniforms.sunDir.value;
  _v.copy(camera.position).addScaledVector(dir, 500).project(camera);
  const u = finalPass.uniforms;
  u.sunPos.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const facing = fwd.dot(dir);
  const onScreen = Math.max(0, 1 - Math.max(Math.abs(_v.x), Math.abs(_v.y)) * 0.6);
  u.sunVis.value = _v.z < 1 ? THREE.MathUtils.smoothstep(facing, 0.0, 0.5) * onScreen : 0;
}

export function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  finalPass.uniforms.res.value.set(innerWidth * PR, innerHeight * PR);
}
addEventListener('resize', onResize);

export function pointScale() { return innerHeight * PR * 0.5; }
