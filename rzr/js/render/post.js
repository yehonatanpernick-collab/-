// Post-processing: MSAA HDR scene with screen-space ambient occlusion (N8AO, high/ultra) ->
// subtle bloom (sun glints, snow, water) -> colour grade + adaptive sharpening (filmic
// contrast, saturation, warm highlights / cool shadows, vignette) -> AgX tone map + sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from '../../vendor/n8ao/N8AO.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uSharp: { value: 0.55 }, uSat: { value: 1.42 }, uContrast: { value: 1.2 }, uVignette: { value: 0.3 }, uWarm: { value: 0.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp, uSat, uContrast, uVignette, uWarm; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // contrast-adaptive sharpening: restores texture crispness lost to MSAA resolve / upscaling,
      // backing off on strong edges so it never rings
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
      vec3 wt = -amp * uSharp * 0.2;
      c = max((c + (n + s + e + w) * wt) / (1.0 + 4.0 * wt), vec3(0.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);                                   // richer colour
      vec3 lc = log2(max(c, 1e-5));                                // contrast around mid-grey in log space
      c = exp2((lc + 2.47) * uContrast - 2.47);
      float hl = smoothstep(0.2, 1.5, l);
      c *= mix(vec3(1.0 - uWarm, 1.0, 1.0 + uWarm), vec3(1.0 + uWarm, 1.0, 1.0 - uWarm * 1.5), hl); // cool shade, warm light
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Sun shafts: radial blur toward the sun of the visible sky (from the scene depth), so
// light streams through gaps between peaks, trees and clouds' edges.
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.75) }, uStrength: { value: 0 }, uAspect: { value: 1.6 },
    uNear: { value: 0.15 }, uFar: { value: 60000 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth; uniform vec2 uSun; uniform vec3 uSunCol; uniform float uStrength, uAspect, uNear, uFar;
    varying vec2 vUv;
    float skyAt(vec2 uv) {
      float d = texture2D(tDepth, uv).r;
      float z = uNear * uFar / (uFar - d * (uFar - uNear));
      vec2 o = (uv - uSun) * vec2(uAspect, 1.0);
      return step(21000.0, z) * exp(-dot(o, o) * 9.0);   // sky pixels, weighted toward the sun disc
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uStrength <= 0.0) { gl_FragColor = vec4(c, 1.0); return; }
      vec2 dv = (uSun - vUv) / 36.0;
      vec2 uv = vUv + dv * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float acc = 0.0, w = 1.0;
      for (int i = 0; i < 36; i++) { acc += skyAt(uv) * w; w *= 0.965; uv += dv; }
      acc /= 36.0;
      vec2 o = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = 1.0 / (1.0 + dot(o, o) * 2.5);
      gl_FragColor = vec4(c + uSunCol * acc * fall * uStrength, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: quality.msaa ?? 4 });
    this.composer = new EffectComposer(renderer, rt);
    if (quality.ao) {
      // N8AO renders the scene itself (beauty + depth) and composites contact shadows
      const ao = new N8AOPass(scene, camera, s.x, s.y);
      ao.beautyRenderTarget.samples = quality.msaa ?? 4;
      Object.assign(ao.configuration, {
        aoRadius: 2.2, distanceFalloff: 1.2, intensity: 2.4, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10,
        halfRes: quality.ao === 'half', gammaCorrection: false, color: new THREE.Color(0, 0, 0),
      });
      this.ao = ao;
      this.composer.addPass(ao);
    } else this.composer.addPass(new RenderPass(scene, camera));
    if (this.ao) { this.shafts = new ShaderPass(ShaftShader); this.composer.addPass(this.shafts); }
    this.camera = camera;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x / 2, s.y / 2), 0.22, 0.55, 0.92);
    if (quality.bloom !== false) this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.renderer = renderer;
    this.grade.uniforms.uTexel.value.set(1 / s.x, 1 / s.y);
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.grade.uniforms.uTexel.value.set(1 / s.x, 1 / s.y);
  }
  // sun position on screen + strength (fades as the sun leaves the view or sets)
  setSun(dir, color, dayK, cloudCover) {
    if (!this.shafts) return;
    const u = this.shafts.uniforms, cam = this.camera;
    const p = (this._p || (this._p = new THREE.Vector3())).copy(dir).multiplyScalar(10000).add(cam.position).project(cam);
    const behind = cam.getWorldDirection(this._f || (this._f = new THREE.Vector3())).dot(dir) <= 0.05;
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    u.uStrength.value = behind ? 0 : 1.1 * dayK * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.8)) * (1 - 0.6 * cloudCover);
    u.uSunCol.value.copy(color);
    u.uAspect.value = cam.aspect; u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.tDepth.value = this.ao.beautyRenderTarget.depthTexture;
  }
  render() { this.composer.render(); }
}
