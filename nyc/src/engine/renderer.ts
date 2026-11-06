import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, screenUV, uniform, mix, float, vec3, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { loadBinary } from './assets';

export type Quality = 'low' | 'medium' | 'high';
export const isTouch = 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;

/** Renderer, sky/sun lighting and the post-processing chain. */
export class Engine {
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.4, 7000);
  sun = new THREE.DirectionalLight(0xffffff, 3.2);
  hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5c5248, 0.35);
  pipeline!: THREE.RenderPipeline;
  quality: Quality = ((new URLSearchParams(location.search).get('q') as Quality) || (isTouch ? 'low' : 'high'));
  night = uniform(0); // 0 day … 1 night, drives window lights etc.
  sunDir = new THREE.Vector3(0.4, 0.6, 0.3).normalize();
  isWebGPU = false;
  private skies: Record<string, { tex: THREE.DataTexture; sun: THREE.Vector3; fog: THREE.Color; night: number; sunI: number }> = {};
  skyName = 'day';
  private csm?: CSMShadowNode;

  constructor(canvas: HTMLCanvasElement) {
    const forceWebGL = /webgl/.test(location.search);
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(this.camera, this.sun, this.sun.target, this.hemi);
  }

  async init() {
    await this.renderer.init();
    this.isWebGPU = !!(this.renderer.backend as any).isWebGPUBackend;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setupShadows();
    this.buildPipeline();
  }

  resize() {
    const pr = Math.min(devicePixelRatio, this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  setupShadows() {
    const s = this.sun.shadow;
    s.mapSize.set(this.quality === 'low' ? 1024 : 2048, this.quality === 'low' ? 1024 : 2048);
    s.bias = -0.0002; s.normalBias = 0.6;
    this.sun.castShadow = true;
    s.camera.near = 1; s.camera.far = 3000;
    if (this.quality !== 'low') {
      this.csm = new CSMShadowNode(this.sun, { cascades: 3, maxFar: this.quality === 'high' ? 650 : 420, mode: 'practical', lightMargin: 400 });
      this.csm.fade = true;
      (s as any).shadowNode = this.csm;
    } else {
      const c = s.camera as THREE.OrthographicCamera; c.left = -160; c.right = 160; c.top = 160; c.bottom = -160; c.updateProjectionMatrix();
    }
  }

  /** scene → MRT(normal, velocity) → GTAO → bloom → TRAA */
  buildPipeline() {
    const scenePass = pass(this.scene, this.camera);
    const q = this.quality;
    if (q === 'low') { this.pipeline = new THREE.RenderPipeline(this.renderer, scenePass); return; }
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const nrm = scenePass.getTextureNode('normal');
    const vel = scenePass.getTextureNode('velocity');
    const sceneNormal = sample((uv) => unpackRGBToNormal(nrm.sample(uv)));
    const aoPass = ao(depth, sceneNormal, this.camera);
    aoPass.resolutionScale = q === 'high' ? 0.5 : 0.35;
    aoPass.distanceExponent.value = 1.2; aoPass.radius.value = 1.8; aoPass.scale.value = 1.15; aoPass.thickness.value = 2.5;
    const aoTex = aoPass.getTextureNode().sample(screenUV).r;
    const lit = color.rgb.mul(mix(float(1), aoTex, 0.9));
    const glow = bloom(vec4(lit, 1.0), 0.22, 0.45, 0.85);
    const comp = vec4(vec3(lit).add(glow.rgb), 1.0);
    const out = q === 'high' ? traa(comp, depth, vel, this.camera) : comp;
    this.pipeline = new THREE.RenderPipeline(this.renderer, out);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.resize();
    (this.sun.shadow as any).shadowNode = undefined; this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
    this.setupShadows();
    this.buildPipeline();
  }

  /** Load an equirect HDRI, use it as sky + IBL, and place the sun at its brightest point. */
  async loadSky(name: string, url: string, night = 0) {
    const hdr = new HDRLoader().setDataType(THREE.HalfFloatType).parse(await loadBinary(url)) as any;
    const tex = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.colorSpace = THREE.LinearSRGBColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = true; tex.needsUpdate = true;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const { width: w, height: h, data } = tex.image as { width: number; height: number; data: Uint16Array };
    let best = -1, bi = 0; const fog = new THREE.Color(0, 0, 0); let fn = 0;
    const H = THREE.DataUtils.fromHalfFloat;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4; const l = H(data[i]) * 0.2126 + H(data[i + 1]) * 0.7152 + H(data[i + 2]) * 0.0722;
      if (l > best) { best = l; bi = i / 4; }
      if (y > h * 0.47 && y < h * 0.5) { fog.r += H(data[i]); fog.g += H(data[i + 1]); fog.b += H(data[i + 2]); fn++; }
    }
    const px = bi % w, py = Math.floor(bi / w);
    // three's equirect lookup: u = atan(z, x)/(2π) + 0.5, v = asin(y)/π + 0.5 (image row 0 = top)
    const u = (px + 0.5) / w, v = 1 - (py + 0.5) / h;
    const phi = (u - 0.5) * Math.PI * 2, theta = (v - 0.5) * Math.PI;
    const sun = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)).normalize();
    fog.multiplyScalar(1 / Math.max(1, fn));
    const m = Math.max(fog.r, fog.g, fog.b, 1e-4); fog.multiplyScalar(0.92 / m);
    this.skies[name] = { tex, sun, fog, night, sunI: night > 0.3 ? 1.4 : 3.4 };
  }

  setSky(name: string) {
    const s = this.skies[name]; if (!s) return;
    this.skyName = name;
    this.scene.background = s.tex; this.scene.environment = s.tex;
    this.scene.backgroundIntensity = s.night > 0.3 ? 0.8 : 1.0;
    this.scene.environmentIntensity = s.night > 0.3 ? 0.55 : 0.85;
    this.sunDir.copy(s.sun.y < 0.12 ? s.sun.clone().setY(0.12).normalize() : s.sun);
    this.sun.intensity = s.sunI;
    this.sun.color.set(s.night > 0.3 ? 0xffb27a : 0xfff2e2);
    this.hemi.intensity = s.night > 0.3 ? 0.2 : 0.35;
    this.scene.fog = new THREE.FogExp2(s.fog.clone().convertSRGBToLinear().getHex(), s.night > 0.3 ? 0.00042 : 0.00028);
    this.night.value = s.night;
  }

  /** keep the sun's shadow frustum around the player */
  follow(target: THREE.Vector3) {
    this.sun.position.copy(target).addScaledVector(this.sunDir, 1200);
    this.sun.target.position.copy(target);
    if (this.quality === 'low') {
      const c = this.sun.shadow.camera as THREE.OrthographicCamera; const snap = (c.right * 2) / this.sun.shadow.mapSize.x;
      this.sun.target.position.set(Math.round(target.x / snap) * snap, 0, Math.round(target.z / snap) * snap);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 1200);
    }
  }

  render() { this.pipeline.render(); }
}
