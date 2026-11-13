// Post-processing: MSAA HDR target -> subtle bloom (sun glints, snow, water) -> colour grade
// (filmic contrast, saturation, warm highlights / cool shadows, vignette) -> AgX tone map + sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.42 }, uContrast: { value: 1.2 }, uVignette: { value: 0.3 }, uWarm: { value: 0.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uWarm; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
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

export class Post {
  constructor(renderer, scene, camera, quality) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: quality.msaa ?? 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x / 2, s.y / 2), 0.22, 0.55, 0.92);
    if (quality.bloom !== false) this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.renderer = renderer;
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render() { this.composer.render(); }
}
