// PlayCanvas application bootstrap: graphics device selection (WebGPU → WebGL 2),
// cameras, post-processing, environment lighting and quality management.
import * as pc from 'playcanvas';
import { IS_MOBILE, QUALITY, type QualityPreset, type Settings } from './settings';

export interface EnvPreset {
  id: string;
  name: string;
  hdr: string;
  sky: string;
  /** Direction towards the sun inside the (unrotated) sky image. */
  sun: [number, number, number];
  /** Minimum elevation (radians) used for the shadow casting light so streets stay readable at dusk. */
  minElevation: number;
  sunColor: [number, number, number];
  sunIntensity: number;
  /** Multiplier for image based lighting. */
  skyIntensity: number;
  /** Brightness of the visible sky. */
  skyVisible: number;
  ambient: number;
  fogColor: [number, number, number];
  fogDensity: number;
  exposure: number;
  /** Sky rotation in degrees so the visible sun matches the light. */
  skyYaw: number;
  grade: { brightness: number; contrast: number; saturation: number; tint: [number, number, number] };
}

export const ENVIRONMENTS: EnvPreset[] = [
  {
    id: 'day', name: 'Overcast Day', hdr: 'assets/hdri/kloofendal_48d_partly_cloudy_puresky_ibl.hdr', sky: 'assets/hdri/kloofendal_48d_partly_cloudy_puresky_sky.jpg',
    sun: [-0.404, 0.739, 0.539], minElevation: 0.3, sunColor: [1, 0.95, 0.86], sunIntensity: 3.2, skyIntensity: 2.6, skyVisible: 1.15, ambient: 0.85,
    fogColor: [0.68, 0.73, 0.78], fogDensity: 0.0068, exposure: 0.8, skyYaw: 28,
    grade: { brightness: 1.03, contrast: 1.12, saturation: 1.02, tint: [1, 0.985, 0.955] },
  },
  {
    id: 'dusk', name: 'Dusk Assault', hdr: 'assets/hdri/industrial_sunset_puresky_ibl.hdr', sky: 'assets/hdri/industrial_sunset_puresky_sky.jpg',
    sun: [-0.638, 0.061, 0.768], minElevation: 0.27, sunColor: [1, 0.66, 0.4], sunIntensity: 3.4, skyIntensity: 2.8, skyVisible: 1.25, ambient: 0.9,
    fogColor: [0.62, 0.5, 0.44], fogDensity: 0.0068, exposure: 0.9, skyYaw: 28,
    grade: { brightness: 1.02, contrast: 1.14, saturation: 1.05, tint: [1.04, 0.975, 0.92] },
  },
];

export const LAYER_VIEWMODEL = 'ViewModel';

export class Engine {
  readonly app: pc.Application;
  readonly device: pc.GraphicsDevice;
  readonly camera: pc.Entity;
  readonly viewCamera: pc.Entity;
  readonly sun: pc.Entity;
  readonly frame: pc.CameraFrame | null;
  readonly isWebGPU: boolean;
  preset: QualityPreset;
  env: EnvPreset = ENVIRONMENTS[0];
  viewLayerId = 0;
  private envTextures: pc.Texture[] = [];
  /** Unit vector pointing towards the sun. */
  readonly sunDir = new pc.Vec3(0.4, 0.74, 0.54);
  private fpsSamples: number[] = [];
  private scale = 1;
  private scaleCooldown = 0;
  fps = 60;
  frameMs = 16;

  private constructor(app: pc.Application, private settings: Settings) {
    this.app = app;
    this.device = app.graphicsDevice;
    this.isWebGPU = this.device.isWebGPU;
    this.preset = QUALITY[settings.quality];

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.scene.clusteredLightingEnabled = true;
    const lighting = app.scene.lighting;
    lighting.shadowsEnabled = false;
    lighting.cookiesEnabled = false;
    lighting.cells = new pc.Vec3(24, 6, 24);
    lighting.maxLightsPerCell = 24;

    // dedicated layer for the first-person weapon, drawn after the world with a fresh depth buffer
    const layers = app.scene.layers;
    const viewLayer = new pc.Layer({ name: LAYER_VIEWMODEL });
    layers.insert(viewLayer, layers.getTransparentIndex(layers.getLayerByName('Immediate') as pc.Layer) + 1);
    this.viewLayerId = viewLayer.id;
    const worldLayers = [pc.LAYERID_WORLD, pc.LAYERID_DEPTH, pc.LAYERID_SKYBOX, pc.LAYERID_IMMEDIATE];

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0.5, 0.55, 0.6), fov: settings.fov, nearClip: 0.08, farClip: 900, layers: worldLayers,
      toneMapping: pc.TONEMAP_ACES2, gammaCorrection: pc.GAMMA_SRGB, priority: 0,
    });
    app.root.addChild(this.camera);

    this.viewCamera = new pc.Entity('viewCamera');
    this.viewCamera.addComponent('camera', {
      clearColorBuffer: false, clearDepthBuffer: true, fov: 58, nearClip: 0.01, farClip: 10, layers: [viewLayer.id],
      toneMapping: pc.TONEMAP_ACES2, gammaCorrection: pc.GAMMA_SRGB, priority: 1,
    });
    this.camera.addChild(this.viewCamera);

    this.sun = new pc.Entity('sun');
    this.sun.addComponent('light', {
      type: 'directional', color: new pc.Color(1, 0.95, 0.85), intensity: 2.6, castShadows: true,
      shadowBias: 0.12, normalOffsetBias: 0.06, shadowType: pc.SHADOW_PCF3_32F,
      layers: [pc.LAYERID_WORLD, viewLayer.id],
    });
    app.root.addChild(this.sun);

    let frame: pc.CameraFrame | null = null;
    try {
      frame = new pc.CameraFrame(app, this.camera.camera as pc.CameraComponent);
    } catch (e) {
      console.warn('[engine] CameraFrame unavailable, falling back to forward rendering', e);
    }
    this.frame = frame;
    this.applyQuality();
    window.addEventListener('resize', () => app.resizeCanvas());
  }

  static async create(canvas: HTMLCanvasElement, settings: Settings): Promise<Engine> {
    const params = new URLSearchParams(location.search);
    const forced = params.get('renderer');
    const wantGpu = (forced ?? settings.renderer) !== 'webgl2' && 'gpu' in navigator;
    const deviceTypes = wantGpu ? [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGL2];
    let device: pc.GraphicsDevice;
    try {
      device = await pc.createGraphicsDevice(canvas, { deviceTypes, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('[engine] preferred device failed, retrying with WebGL 2', e);
      device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: false });
    }
    const app = new pc.Application(canvas, { graphicsDevice: device });
    app.start();
    return new Engine(app, settings);
  }

  /** Apply the current quality preset to renderer, shadows and post effects. */
  applyQuality(): void {
    const s = this.settings;
    const q = (this.preset = QUALITY[s.quality]);
    const maxRatio = IS_MOBILE ? Math.min(q.pixelRatio, 1.5) : q.pixelRatio;
    this.device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, maxRatio);
    this.app.resizeCanvas();

    const light = this.sun.light as pc.LightComponent;
    light.castShadows = q.shadows;
    light.shadowResolution = q.shadowRes;
    light.shadowDistance = q.shadowDistance;
    light.numCascades = q.cascades;
    light.cascadeDistribution = 0.6;
    light.shadowType = q.cascades >= 3 ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;

    (this.camera.camera as pc.CameraComponent).fov = s.fov;
    (this.camera.camera as pc.CameraComponent).farClip = q.farClip;
    const f = this.frame;
    if (f) {
      f.rendering.toneMapping = pc.TONEMAP_ACES2;
      f.rendering.samples = q.msaa;
      f.rendering.renderTargetScale = q.renderScale * this.scale;
      f.rendering.sharpness = q.renderScale * this.scale < 0.95 ? 0.18 : 0.08;
      f.rendering.sceneDepthMap = q.ssao;
      f.ssao.type = q.ssao ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
      f.ssao.intensity = 0.55; f.ssao.radius = 1.4; f.ssao.samples = 10; f.ssao.power = 5; f.ssao.blurEnabled = true;
      f.bloom.enabled = q.bloom;
      f.bloom.intensity = 0.012; f.bloom.blurLevel = 6; f.bloom.threshold = 0;
      f.vignette.enabled = true;
      f.vignette.intensity = 0.42; f.vignette.inner = 0.55; f.vignette.outer = 1.25; f.vignette.curvature = 0.6;
      f.grading.enabled = true;
      this.applyGrade();
      f.update();
    }
  }

  private applyGrade(): void {
    const f = this.frame;
    if (!f) return;
    const g = this.env.grade;
    f.grading.brightness = g.brightness; f.grading.contrast = g.contrast; f.grading.saturation = g.saturation;
    f.grading.tint = new pc.Color(g.tint[0], g.tint[1], g.tint[2]);
  }

  /** Load and apply an environment (sky, image based lighting, sun, fog). */
  async setEnvironment(index: number, loadTexture: (url: string, opts?: object) => Promise<pc.Texture>): Promise<void> {
    const env = (this.env = ENVIRONMENTS[index] ?? ENVIRONMENTS[0]);
    const scene = this.app.scene;
    const [hdr, sky] = await Promise.all([loadTexture(env.hdr, { mipmaps: false }), loadTexture(env.sky, { mipmaps: false, srgb: true })]);
    for (const t of this.envTextures) t.destroy();
    this.envTextures = [];
    try {
      hdr.projection = pc.TEXTUREPROJECTION_EQUIRECT;
      const lightingSource = pc.EnvLighting.generateLightingSource(hdr);
      const atlas = pc.EnvLighting.generateAtlas(lightingSource);
      lightingSource.destroy();
      // The image based lighting is boosted (skyIntensity) to give shadowed surfaces enough fill light,
      // so the visible sky image is pre-dimmed by the same factor to keep its original brightness.
      const src = sky.getSource() as unknown as CanvasImageSource & { width: number; height: number };
      const cv = document.createElement('canvas');
      // the visible sky only needs to be as sharp as the cubemap built from it: keep it small (it was the heaviest asset)
      cv.width = Math.min(2048, this.preset.skyRes * 4); cv.height = cv.width / 2;
      const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
      ctx.filter = `brightness(${(env.skyVisible / env.skyIntensity).toFixed(3)})`;
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      const dim = new pc.Texture(this.device, { name: 'sky-dim', width: cv.width, height: cv.height, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, projection: pc.TEXTUREPROJECTION_EQUIRECT });
      dim.setSource(cv);
      const skybox = pc.EnvLighting.generateSkyboxCubemap(dim, IS_MOBILE ? Math.min(256, this.preset.skyRes) : this.preset.skyRes);
      dim.destroy();
      scene.envAtlas = atlas;
      scene.skybox = skybox;
      this.envTextures.push(atlas, skybox);
    } catch (e) {
      console.warn('[engine] environment lighting failed', e);
    }
    scene.skyboxIntensity = env.skyIntensity;
    // NOTE: a non-identity sky rotation is intentional – with an unrotated environment, surfaces
    // facing exactly -Z sampled the atlas seam and lost their ambient term.
    const skyRot = new pc.Quat().setFromEulerAngles(0, env.skyYaw, 0);
    scene.skyboxRotation = skyRot;
    scene.ambientLight = new pc.Color(env.ambient * 0.5, env.ambient * 0.52, env.ambient * 0.56);
    scene.exposure = env.exposure;
    scene.fog.type = pc.FOG_EXP2;
    scene.fog.color = new pc.Color(env.fogColor[0], env.fogColor[1], env.fogColor[2]);
    scene.fog.density = env.fogDensity;
    const light = this.sun.light as pc.LightComponent;
    light.color = new pc.Color(env.sunColor[0], env.sunColor[1], env.sunColor[2]);
    light.intensity = env.sunIntensity;
    const toSun = skyRot.transformVector(new pc.Vec3(env.sun[0], env.sun[1], env.sun[2]), new pc.Vec3());
    const flat = Math.hypot(toSun.x, toSun.z) || 1;
    const elev = Math.max(env.minElevation, Math.atan2(toSun.y, flat));
    toSun.set((toSun.x / flat) * Math.cos(elev), Math.sin(elev), (toSun.z / flat) * Math.cos(elev));
    this.sunDir.copy(toSun);
    // a directional light shines along its local -Y axis, so +Y must point at the sun
    const up = toSun;
    const q = new pc.Quat();
    const from = pc.Vec3.UP;
    const axis = new pc.Vec3().cross(from, up);
    const dot = from.dot(up);
    if (axis.length() < 1e-5) q.setFromEulerAngles(dot > 0 ? 0 : 180, 0, 0);
    else q.setFromAxisAngle(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, dot))) * pc.math.RAD_TO_DEG);
    this.sun.setRotation(q);
    (this.camera.camera as pc.CameraComponent).clearColor = new pc.Color(env.fogColor[0], env.fogColor[1], env.fogColor[2]);
    this.applyGrade();
    this.frame?.update();
  }

  /** Track frame time and adapt the internal render scale to hold the target frame rate. */
  tick(dt: number): void {
    const ms = dt * 1000;
    this.fpsSamples.push(ms);
    if (this.fpsSamples.length > 45) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.frameMs = avg;
    this.fps = 1000 / Math.max(0.01, avg);
    if (!this.settings.adaptiveResolution || this.fpsSamples.length < 45) return;
    this.scaleCooldown -= dt;
    if (this.scaleCooldown > 0) return;
    const target = IS_MOBILE ? 1000 / 30 : 1000 / 58;
    let next = this.scale;
    if (avg > target * 1.18) next = Math.max(0.55, this.scale - 0.08);
    else if (avg < target * 0.86) next = Math.min(1, this.scale + 0.05);
    if (next !== this.scale) {
      this.scale = next;
      this.scaleCooldown = 1.5;
      this.fpsSamples.length = 0;
      if (this.frame) {
        this.frame.rendering.renderTargetScale = this.preset.renderScale * this.scale;
        this.frame.rendering.sharpness = this.preset.renderScale * this.scale < 0.95 ? 0.18 : 0.08;
        this.frame.update();
      } else {
        this.device.maxPixelRatio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.scale);
        this.app.resizeCanvas();
      }
    }
  }

  get renderScale(): number { return this.scale; }
}
