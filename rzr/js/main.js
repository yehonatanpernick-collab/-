// Alpine RZR Wilderness — bootstrap and main loop.
import * as THREE from 'three';
import { loadWorld } from './world/loader.js';
import { WorldCollision } from './world/collision.js';
import { installAtmosphere, ATMO } from './render/atmosphere.js';
import { Terrain, loadArrayTexture } from './render/terrain.js';
import { SkySystem } from './render/sky.js';
import { TerrainShadow } from './render/terrainShadow.js';
import { Roads } from './render/roads.js';
import { Water } from './render/water.js';
import { VehiclePhysics } from './vehicle/physics.js';
import { VehicleModel } from './vehicle/model.js';
import { DriveCamera } from './camera.js';
import { Input } from './input.js';
import { store } from './util.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const loadText = (t, f) => { $('load-text').textContent = t; if (f !== undefined) $('load-fill').style.width = `${Math.round(f * 100)}%`; };

export const QUALITY = {
  low: { pixelRatio: 0.75, range0: 44, shadows: false, shadowSize: 1024, post: false, grass: 0.35, trees: 0.55, treeDist: 900 },
  medium: { pixelRatio: 1, reflections: 0.35, range0: 52, shadows: true, shadowSize: 1024, msaa: 0, bloom: false, grass: 0.6, trees: 0.8, treeDist: 1300 },
  high: { pixelRatio: Math.min(1.5, devicePixelRatio), ao: 'half', reflections: 0.5, range0: 58, shadows: true, shadowSize: 2048, grass: 1, trees: 1, treeDist: 1700 },
  ultra: { pixelRatio: Math.min(2, devicePixelRatio), ao: 'full', reflections: 0.6, range0: 68, shadows: true, shadowSize: 4096, grass: 1.4, trees: 1.25, treeDist: 2200 },
};

const DT = 1 / 200;

class Game {
  constructor() {
    this.params = params;
    this.qualityName = params.get('q') || store.get('rzr.quality', 'high');
    this.quality = { ...(QUALITY[this.qualityName] || QUALITY.high) };
    if (params.has('noao')) this.quality.ao = false;
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.AgXToneMapping;   // filmic, keeps saturated sunlit colour and soft highlight roll-off
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    installAtmosphere();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaabbcc, 0.0001);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 60000);
    this.weatherUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
    this.input = new Input();
    this.headlights = false;
    this.acc = 0;
    this.simTime = 0;
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3(); this.renderQuat = new THREE.Quaternion();
    this.systems = [];
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async load() {
    let bytes = 0;
    const totalGuess = 9.2e6;
    loadText('Loading terrain data…', 0.02);
    const worldP = loadWorld('assets/world/', (b) => { bytes += b; loadText(`Loading terrain data… ${(bytes / 1048576).toFixed(1)} MB`, 0.04 + 0.4 * Math.min(1, bytes / totalGuess)); });
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const layersP = fetch('assets/textures/terrain_layers.json').then(r => r.json());
    const arraysP = Promise.all([
      loadArrayTexture('assets/textures/terrain_albedo.jpg', 8, true, Math.min(8, aniso)),
      loadArrayTexture('assets/textures/terrain_normal.jpg', 8, false, Math.min(8, aniso)),
      loadArrayTexture('assets/textures/terrain_arm.jpg', 8, false, Math.min(8, aniso)),
    ]);
    this.world = await worldP;
    this.collision = new WorldCollision(this.world);
    loadText('Building terrain…', 0.5);
    const [albedo, normal, arm] = await arraysP;
    const layers = await layersP;
    const lin = (c) => c.map(v => Math.pow(v, 2.2));
    const FAR_TONE = { grass: [0.3, 0.37, 0.15], tundra: [0.42, 0.41, 0.25], rock: [0.45, 0.44, 0.41], scree: [0.5, 0.48, 0.44], forest: [0.25, 0.26, 0.17] };
    for (const l of layers.layers) if (FAR_TONE[l.name]) l.avg = FAR_TONE[l.name];
    this.terrain = new Terrain(this.renderer, this.world, {
      arrays: { albedo, normal, arm }, layerAvg: layers.layers.map(l => lin(l.avg)),
      weatherUniform: this.weatherUniform, range0: this.quality.range0,
    });
    this.scene.add(this.terrain.mesh);
    this.sky = new SkySystem(this.renderer, this.scene);
    this.terrShadow = new TerrainShadow(this.renderer, this.terrain);
    if (this.quality.post !== false) {
      try { const { Post } = await import('./render/post.js'); this.post = new Post(this.renderer, this.scene, this.camera, this.quality); }
      catch (e) { console.warn('post-processing unavailable', e); }
    }
    this.sky.time = params.has('t') ? +params.get('t') : 10.2;
    if (params.has('freeze')) this.sky.timeScale = 0;
    if (this.quality.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const sh = this.sky.sun.shadow, R = 90;
      sh.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      Object.assign(sh.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: 5000 });
      sh.bias = -0.0003; sh.normalBias = 0.5;
      this.sky.sun.castShadow = true;
    }
    loadText('Laying roads and rivers…', 0.6);
    this.roads = new Roads(this.world, this.collision, this.renderer, this.weatherUniform);
    this.scene.add(this.roads.group);
    this.water = new Water(this.world, this.terrain, this.scene);
    if (this.quality.reflections) this.water.enableReflections(this.renderer, this.quality.reflections);

    loadText('Preparing the RZR…', 0.7);
    await this.loadVehicle(params.get('vehicle') || store.get('rzr.vehicle', 'a'));
    this.phys = new VehiclePhysics(this.collision);
    this.driveCam = new DriveCamera(this.camera, this.collision);
    const sp = this.world.meta.spawn;
    this.phys.reset(sp.x, sp.z, sp.heading);
    this.syncRender(1);

    // optional systems: a failure in one never blocks driving
    loadText('Growing forests…', 0.8);
    for (const [name, path] of [['vegetation', './render/vegetation.js'], ['flowers', './render/flowers.js'], ['structures', './render/structures.js'], ['effects', './render/effects.js'], ['weather', './weather.js'], ['stunts', './stunts.js'], ['wildlife', './render/wildlife.js'], ['hud', './hud.js'], ['audio', './audio.js']]) {
      try {
        const mod = await import(path);
        const sys = await mod.create(this, (t) => loadText(t));
        if (sys) { this[name] = sys; this.systems.push(sys); }
      } catch (e) { console.warn(`[${name}] unavailable:`, e); }
    }
    loadText('Ready', 1);
  }

  async loadVehicle(variant) {
    const old = this.model;
    const m = await new VehicleModel().load(variant, this.renderer);
    if (old) this.scene.remove(old.root);
    this.model = m;
    this.scene.add(m.root);
    this.vehicleVariant = variant;
  }

  resetVehicle(x, z, heading) {
    const p = this.phys;
    if (x === undefined) {
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
      p.reset(p.pos.x, p.pos.z, Math.atan2(f.x, f.z));
    } else {
      if (this.vegetation) [x, z] = this.vegetation.clearSpot(x, z);
      p.reset(x, z, heading);
      this.vegetation?._rebuildColliders(p.pos);
    }
    this.syncRender(1);
    this.driveCam.initialized = false;
  }

  syncRender(alpha) {
    if (alpha >= 1) { this.prevPos.copy(this.phys.pos); this.prevQuat.copy(this.phys.quat); }
    this.renderPos.lerpVectors(this.prevPos, this.phys.pos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.phys.quat, alpha);
  }

  handleKeys() {
    const I = this.input;
    if (I.wasPressed('KeyC')) this.driveCam.cycle();
    if (I.wasPressed('KeyR')) this.resetVehicle();
    if (I.wasPressed('KeyQ')) { this.phys.awd = !this.phys.awd; this.hud?.toast(this.phys.awd ? 'AWD engaged' : '2WD — rear, locked diff'); }
    if (I.wasPressed('KeyL')) this.headlights = !this.headlights;
    if (I.keys.has('KeyT')) this.sky.time = (this.sky.time - 0.02 + 24) % 24;
    if (I.keys.has('KeyY')) this.sky.time = (this.sky.time + 0.02) % 24;
    if (I.wasPressed('KeyG')) this.weather?.cycle();
    if (I.wasPressed('KeyH')) $('help').hidden = !$('help').hidden;
    if (I.wasPressed('KeyO')) $('settings').hidden = !$('settings').hidden;
    if (I.wasPressed('KeyM')) this.hud?.toggleMap();
    for (let d = 1; d <= 9; d++) if (I.wasPressed('Digit' + d)) this.teleportPOI(d - 1);
  }

  pois() {
    const n = this.world.meta.nodes, sp = this.world.meta.spawn, dr = this.world.meta.drift;
    return [
      ['Alpendorf village', sp.x, sp.z, sp.heading],
      ['Turquoise Lake', ...n.lakeWest, Math.PI / 2], ['Drift track', dr.x, dr.z - 95, Math.PI / 2],
      ['Ice Pass', ...n.icePass, 0], ['Dark Forest Valley', ...n.forestMid, Math.PI], ['Rock Garden', ...n.rockGarden, Math.PI],
      ['Hidden Tarn', ...n.tarn, 0], ['Stone Gorge', ...n.gorge, Math.PI * 0.75], ['Silberfall', ...n.silberfall, -Math.PI / 2],
    ];
  }

  teleportPOI(i) {
    const p = this.pois()[i]; if (!p) return;
    this.resetVehicle(p[1], p[2], p[3]);
    this.hud?.toast(p[0]);
  }

  step() {
    Object.assign(this.phys.input, this.input.state);
    if (this.stunts && !this.stunts.canBoost) this.phys.input.boost = 0;
    if (this.autopilot) this.autopilot(this.phys, this.simTime);
    this.prevPos.copy(this.phys.pos); this.prevQuat.copy(this.phys.quat);
    this.phys.step(DT);
    this.simTime += DT;
    // soft world boundary at the foot of the encircling ranges
    const p = this.phys.pos, lim = 3950;
    if (Math.abs(p.x) > lim) this.phys.vel.x -= Math.sign(p.x) * (Math.abs(p.x) - lim) * 0.05;
    if (Math.abs(p.z) > lim) this.phys.vel.z -= Math.sign(p.z) * (Math.abs(p.z) - lim) * 0.05;
    if (!Number.isFinite(p.y) || p.y < -100) this.teleportPOI(0);
    // flipped over and stopped: put the car back on its wheels after a moment
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(this.phys.quat).y;
    if (upY < 0.25 && this.phys.vel.length() < 3) {
      this.flipT = (this.flipT || 0) + DT;
      if (this.flipT > 2.5) { this.flipT = 0; this.hud?.toast('Back on the wheels'); this.resetVehicle(); }
    } else this.flipT = 0;
  }

  frame(dtReal) {
    const dt = Math.min(0.1, dtReal);
    this.input.update(dt);
    this.handleKeys();
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 40) { this.step(); this.acc -= DT; n++; }
    if (n >= 40) this.acc = 0;
    this.syncRender(this.acc / DT);
    this.model.update(this.phys, this.renderPos, this.renderQuat, dt, this.headlights || this.sky.night > 0.6);
    this.camView = this.camView || { forwardSpeed: () => this.phys.forwardSpeed() };
    Object.assign(this.camView, { pos: this.renderPos, quat: this.renderQuat, vel: this.phys.vel, wheels: this.phys.wheels, impacts: this.phys.impacts, angVel: this.phys.angVel, boost: this.phys.input.boost && this.phys.input.throttle > 0.1 });
    this.driveCam.update(dt, this.camView, this.model, this.input);
    const st = this.sky.update(dt, this.camera, this.renderPos);
    this.sky.night = st.night;
    this.terrShadow.update(this.sky.lightDir);
    ATMO.misc.x += dt;
    this.camera.updateMatrixWorld();
    this.terrain.update(this.camera);
    this.water.update(dt, this.scene);
    for (const s of this.systems) s.update?.(dt, this);
    this.water.renderReflection(this);
    this.post?.setSun?.(this.sky.sunDir, this.sky.sunColor, st.dayK, this.sky.weather.cover);
    if (this.post) this.post.render(); else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }
}

const game = new Game();
window.game = game;
try {
  await game.load();
  if (params.has('pos')) {
    const [x, z, h] = params.get('pos').split(',').map(Number);
    game.resetVehicle(x, z, (h || 0) * Math.PI / 180);
  }
  const begin = () => {
    $('loading').hidden = true; $('hud').hidden = false;
    document.body.classList.add('playing');
    game.audio?.start?.();
    let last = performance.now();
    const loop = (t) => { game.frame((t - last) / 1000); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    if (params.has('bench')) import('./bench.js').then(m => m.startBenchmark(game, (r) => game.hud?.toast(`Benchmark: ${r.avgFps} fps avg · ${r.low1Fps} fps 1% low`, `${r.quality} · ${r.gpu}`, 15000)));
  };
  if (params.has('shots')) {
    // headless QA: optional scripted drive, then render a few frames and signal completion
    $('loading').hidden = true; $('hud').hidden = false;
    const drive = params.get('drive');
    if (drive) {
      const [thr, steer, secs] = drive.split(',').map(Number);
      game.autopilot = (ph) => { ph.input.throttle = thr; ph.input.steer = steer; };
      for (let i = 0; i < secs * 200; i++) game.step();
      game.syncRender(1);
    }
    if (params.has('cam')) game.driveCam.mode = +params.get('cam');
    for (let i = 0; i < 6; i++) game.frame(1 / 30);
    if (params.has('fly')) {
      // QA free camera: fly=x,heightAboveGround,z,yawDeg,pitchDeg
      const [x, hy, z, yaw, pitch] = params.get('fly').split(',').map(Number);
      game.driveCam.update = () => {};
      const g = game.world.field.inCore(x, z) ? game.world.field.height(x, z) : game.terrain.sampleFar(x, z);
      game.camera.position.set(x, g + hy, z);
      game.camera.rotation.order = 'YXZ';
      game.camera.rotation.set(pitch * Math.PI / 180, yaw * Math.PI / 180, 0);
      for (let i = 0; i < 4; i++) game.frame(1 / 30);
    }
    window.__out = { pos: game.phys.pos.toArray().map(v => +v.toFixed(2)), kmh: +(game.phys.vel.length() * 3.6).toFixed(1), nodes: game.terrain.stats.nodes, calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles, wheels: game.phys.wheels.map(w => w.surface), systems: game.systems.length };
    document.title = 'done';
  } else {
    $('load-text').textContent = 'Ready';
    $('start').hidden = false;
    $('start').onclick = begin;
    addEventListener('keydown', (e) => { if (e.code === 'Enter' && !$('loading').hidden) begin(); });
  }
} catch (e) {
  console.error(e);
  loadText('Error: ' + e.message);
  document.title = 'ERR ' + e.message;
}
