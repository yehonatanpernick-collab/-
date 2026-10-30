// Post-processing chain: HDR scene → god rays → bloom → grade → tone map → FXAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { renderer, scene, camera, U, Q } from './core.js';

let composer = null, bloom, rays, grade, fxaa, builtFor = -1;
const sunScreen = new THREE.Vector3();

const GodRays = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAmt: { value: 0 }, uTint: { value: new THREE.Color() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAmt; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uAmt < 0.001) { gl_FragColor = base; return; }
      vec2 d = (vUv - uSun)/40.0; vec2 p = vUv; float acc = 0.0, w = 1.0;
      for (int i = 0; i < 40; i++) { p -= d; vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb; float l = dot(s, vec3(0.3, 0.5, 0.2)); acc += smoothstep(1.4, 4.0, l)*w; w *= 0.965; }
      float fall = 1.0 - smoothstep(0.0, 0.75, length((vUv - uSun)*vec2(1.6, 1.0)));
      gl_FragColor = vec4(base.rgb + uTint*acc/40.0*uAmt*fall*1.6, base.a);
    }`,
};
const Grade = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNight: { value: 0 }, uStorm: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uNight, uStorm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1 - 0.25*uNight - 0.2*uStorm);
      vec3 shadowT = vec3(0.92, 0.98, 1.08), highT = vec3(1.06, 1.0, 0.92);
      c *= mix(shadowT, highT, smoothstep(0.05, 0.9, l));
      c = mix(c, c*vec3(0.75, 0.85, 1.15), uNight*0.6);
      float v = length((vUv - 0.5)*vec2(1.25, 1.0));
      c *= 1.0 - smoothstep(0.45, 1.05, v)*0.42;
      c *= 1.0 + (h(vUv*1000.0 + fract(uTime)) - 0.5)*0.035;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};
function build() {
  const q = Q();
  if (composer) composer.dispose?.();
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  rays = new ShaderPass(GodRays); rays.enabled = q.post >= 2; composer.addPass(rays);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.65, 1.15); composer.addPass(bloom);
  grade = new ShaderPass(Grade); composer.addPass(grade);
  composer.addPass(new OutputPass());
  fxaa = new ShaderPass(FXAAShader); fxaa.enabled = q.msaa === 0; composer.addPass(fxaa);
  builtFor = q.post * 10 + q.msaa;
  resizePost();
}
export function resizePost() {
  if (!composer) return;
  const pr = renderer.getPixelRatio();
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
}
export function render(dt) {
  const q = Q();
  if (q.post === 0) { renderer.render(scene, camera); return; }
  if (builtFor !== q.post * 10 + q.msaa) build();
  // sun position on screen for god rays
  sunScreen.copy(U.sunDir.value).multiplyScalar(10000).add(camera.position).project(camera);
  const facing = camera.getWorldDirection(new THREE.Vector3()).dot(U.sunDir.value);
  rays.uniforms.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  rays.uniforms.uAmt.value = rays.enabled && sunScreen.z < 1 && facing > 0.2 ? Math.min(1, (facing - 0.2) * 2.5) * (1 - U.storm.value) * (1 - U.night.value) : 0;
  rays.uniforms.uTint.value.copy(U.sunTint.value);
  grade.uniforms.uTime.value = U.time.value % 100; grade.uniforms.uNight.value = U.night.value; grade.uniforms.uStorm.value = U.storm.value;
  bloom.strength = 0.28 + U.night.value * 0.2 + U.flash.value * 0.6;
  composer.render(dt);
}
