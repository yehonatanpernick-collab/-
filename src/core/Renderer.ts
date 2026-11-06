import * as THREE from 'three/webgpu';
import { pass, renderOutput, vec3, vec4, float, mix, dot, uv, smoothstep, length, uniform, clamp, toneMappingExposure } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import type { QualityPreset } from './Quality';

/**
 * Rendering pipeline: WebGPURenderer (WebGPU backend when available, automatic WebGL2 fallback),
 * HDR scene pass → bloom → colour grading/vignette → ACES tone mapping → FXAA.
 */
export class Renderer {
  renderer!: THREE.WebGPURenderer;
  pipeline!: THREE.RenderPipeline;
  backend = 'unknown';
  private bloomNode: ReturnType<typeof bloom> | null = null;
  grade = { saturation: uniform(1.12), contrast: uniform(1.1), vignette: uniform(0.28), lift: uniform(new THREE.Color(0, 0, 0)) };
  resScale = 1;
  usePost = true;

  async init(canvasHost: HTMLElement, forceWebGL: boolean): Promise<void> {
    this.renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, powerPreference: 'high-performance' });
    await this.renderer.init();
    this.backend = (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    canvasHost.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';
  }

  buildPipeline(scene: THREE.Scene, camera: THREE.Camera, q: QualityPreset): void {
    const scenePass = pass(scene, camera);
    let col: any = scenePass.getTextureNode('output');
    if (q.bloom) {
      // bloom thresholded in exposed (display-referred) space so only genuinely bright pixels glow
      const exp: any = toneMappingExposure;
      const exposed = col.mul(exp);
      this.bloomNode = bloom(exposed, 0.28, 0.35, 0.92);
      col = col.add((this.bloomNode as any).div(exp));
    } else this.bloomNode = null;
    // colour grading in linear HDR (before tone mapping)
    const lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
    let c: any = mix(vec3(lum), col.rgb, this.grade.saturation);
    c = c.sub(0.18).mul(this.grade.contrast).add(0.18).max(0);
    c = c.add(this.grade.lift);
    const d = length(uv().sub(0.5)).mul(1.35);
    c = c.mul(mix(float(1), smoothstep(1.1, 0.25, d), this.grade.vignette));
    let out: any = renderOutput(vec4(c, 1));
    if (q.pixelRatio <= 1.25) out = fxaa(out);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = clamp(out, 0, 1);
    this.renderer.shadowMap.enabled = q.shadows;
  }

  setBloom(strength: number): void { if (this.bloomNode) this.bloomNode.strength.value = strength; }

  applyQuality(q: QualityPreset, scale: number): void {
    this.resScale = scale;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.usePost && this.pipeline) this.pipeline.render();
    else this.renderer.render(scene, camera);
  }
}
