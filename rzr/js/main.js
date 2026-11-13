// Alpine RZR Wilderness — bootstrap and main loop.
import * as THREE from 'three';
import { loadWorld } from './world/loader.js';
import { installAtmosphere, ATMO } from './render/atmosphere.js';
import { Terrain, loadArrayTexture } from './render/terrain.js';
import { SkySystem } from './render/sky.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const loadText = (t, f) => { $('load-text').textContent = t; if (f !== undefined) $('load-fill').style.width = `${Math.round(f * 100)}%`; };

export const QUALITY = {
  low: { pixelRatio: 0.75, range0: 44, shadows: false, shadowSize: 1024, grass: 0.35, trees: 0.55, treeDist: 900 },
  medium: { pixelRatio: 1, range0: 52, shadows: true, shadowSize: 1024, grass: 0.6, trees: 0.8, treeDist: 1300 },
  high: { pixelRatio: Math.min(1.5, devicePixelRatio), range0: 58, shadows: true, shadowSize: 2048, grass: 1, trees: 1, treeDist: 1700 },
  ultra: { pixelRatio: Math.min(2, devicePixelRatio), range0: 68, shadows: true, shadowSize: 4096, grass: 1.4, trees: 1.25, treeDist: 2200 },
};

class Game {
  constructor() {
    this.quality = QUALITY[params.get('q') || localStorage.getItem('rzr.quality') || 'high'] || QUALITY.high;
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.75;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    installAtmosphere();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaabbcc, 0.0001);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.25, 60000);
    this.clock = new THREE.Clock();
    this.weatherUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async load() {
    let bytes = 0;
    const totalGuess = 9.2e6;
    loadText('Loading terrain data…', 0.02);
    const worldP = loadWorld('assets/world/', (b) => { bytes += b; loadText(`Loading terrain data… ${(bytes / 1048576).toFixed(1)} MB`, 0.05 + 0.45 * Math.min(1, bytes / totalGuess)); });
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const layersP = fetch('assets/textures/terrain_layers.json').then(r => r.json());
    const arraysP = Promise.all([
      loadArrayTexture('assets/textures/terrain_albedo.jpg', 8, true, Math.min(8, aniso)),
      loadArrayTexture('assets/textures/terrain_normal.jpg', 8, false, Math.min(8, aniso)),
      loadArrayTexture('assets/textures/terrain_arm.jpg', 8, false, Math.min(8, aniso)),
    ]);
    this.world = await worldP;
    loadText('Building terrain…', 0.55);
    const [albedo, normal, arm] = await arraysP;
    const layers = await layersP;
    // average colours are in sRGB; the shader works in linear
    const lin = (c) => c.map(v => Math.pow(v, 2.2));
    // distant tones: tuned to read like alpine meadows / grey rock rather than the scans' moss-brown mean
    const FAR_TONE = { grass: [0.3, 0.37, 0.15], tundra: [0.42, 0.41, 0.25], rock: [0.45, 0.44, 0.41], scree: [0.5, 0.48, 0.44], forest: [0.25, 0.26, 0.17] };
    for (const l of layers.layers) if (FAR_TONE[l.name]) l.avg = FAR_TONE[l.name];
    this.terrain = new Terrain(this.renderer, this.world, {
      arrays: { albedo, normal, arm }, layerAvg: layers.layers.map(l => lin(l.avg)),
      weatherUniform: this.weatherUniform, range0: this.quality.range0,
    });
    this.scene.add(this.terrain.mesh);
    this.sky = new SkySystem(this.renderer, this.scene);
    if (this.quality.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const sh = this.sky.sun.shadow, R = 160;
      sh.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      Object.assign(sh.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: 5000 });
      sh.bias = -0.0004; sh.normalBias = 0.6;
      this.sky.sun.castShadow = true;
    }
    if (params.has('t')) this.sky.time = +params.get('t');
    loadText('Ready', 1);
  }

  setDebugCamera() {
    const c = (params.get('cam') || '-95,0,255,180,-5').split(',').map(Number);
    const [x, yOff, z, yaw, pitch] = c;
    const ground = this.world.field.inCore(x, z) ? this.world.field.height(x, z) : this.terrain.sampleFar(x, z);
    this.camera.position.set(x, ground + (yOff || 2.2), z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.sky.timeScale = params.has('freeze') ? 0 : 1;
    this.sky.update(dt, this.camera, this.camera.position);
    this.camera.updateMatrixWorld();
    this.terrain.update(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
window.game = game;
try {
  await game.load();
  game.setDebugCamera();
  $('loading').hidden = true;
  const loop = () => { game.frame(); requestAnimationFrame(loop); };
  if (params.has('shots')) { for (let i = 0; i < 3; i++) game.frame(); document.title = 'done'; }
  else loop();
} catch (e) {
  console.error(e);
  loadText('Error: ' + e.message);
  document.title = 'ERR ' + e.message;
}
