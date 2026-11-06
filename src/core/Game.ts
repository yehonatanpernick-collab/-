import * as THREE from 'three/webgpu';
import { Renderer } from './Renderer';
import { Physics } from './Physics';
import { Input } from './Input';
import { U } from './Uniforms';
import { lookAtAbs } from './lookAtAbs';
import { AdaptiveResolution, PRESETS, detectQuality, isTouchDevice, type QualityLevel } from './Quality';
import { WorldData } from '../data/WorldData';
import { formatLatLon, headingDeg, lonLatToWorld } from '../data/GeographicConfig';
import { RoadGraph } from '../ai/RoadGraph';
import { WorldStreamer } from '../world/WorldStreamer';
import { LandmarkSystem } from '../world/Landmarks';
import { buildBackdrop } from '../world/Backdrop';
import { Environment, TIME_PRESETS, type Weather } from '../env/Environment';
import { Vehicle, STATE_LABEL } from '../vehicle/Vehicle';
import { CameraRig, CAM_LABEL } from '../camera/CameraRig';
import { TrafficManager } from '../ai/TrafficManager';
import { PedestrianManager } from '../ai/PedestrianManager';
import { AudioEngine } from '../audio/AudioEngine';
import { Navigation } from '../gameplay/Navigation';
import { Challenges } from '../gameplay/Challenges';
import { MapRenderer } from '../ui/MapRenderer';
import { FullMap, HUD, Menu, MobileControls, type Settings } from '../ui/UI';

/** Top-level game: owns every system and runs the frame loop. */
export class Game {
  renderer = new Renderer();
  physics = new Physics();
  world = new WorldData('./data/');
  scene = new THREE.Scene();
  /** floating origin: everything lives in worldRoot (absolute coordinates); worldRoot is shifted by -origin */
  worldRoot = new THREE.Group();
  origin = new THREE.Vector3();
  input!: Input;
  graph!: RoadGraph;
  streamer!: WorldStreamer;
  landmarks!: LandmarkSystem;
  env!: Environment;
  vehicle!: Vehicle;
  cam!: CameraRig;
  traffic!: TrafficManager;
  peds!: PedestrianManager;
  audio = new AudioEngine();
  nav!: Navigation;
  challenges!: Challenges;
  map!: MapRenderer;
  hud!: HUD; menu!: Menu; fullMap!: FullMap; touch!: MobileControls;
  settings: Settings;
  adaptive = new AdaptiveResolution();
  private last = performance.now();
  private fps = 60; private frameMs = 16;
  private paused = true;
  private started = false;
  private minimapTimer = 0;
  private dashTimer = 0;
  private showStats = false;
  private quality: QualityLevel;
  private lastHood = '';
  private frames = 0;
  private maxDt = 0.05;
  /** debug/beauty-shot camera: ?view=x,y,z,tx,ty,tz (world metres) */
  debugView: [THREE.Vector3, THREE.Vector3] | null = null;

  constructor() {
    const params = new URLSearchParams(location.search);
    this.quality = detectQuality();
    let saved: Partial<Settings> = {};
    try { saved = JSON.parse(localStorage.getItem('skydrive.settings') || '{}'); } catch { /* storage unavailable */ }
    this.settings = { quality: this.quality, resScale: 1, volume: 0.8, sensitivity: 1, camDist: 1, showFps: params.has('stats'), time: 17.8, weather: 'clear', touch: isTouchDevice(), ...saved };
    if (params.get('quality')) this.settings.quality = params.get('quality') as QualityLevel;
    this.quality = this.settings.quality;
    this.showStats = this.settings.showFps;
  }

  get q() { return PRESETS[this.quality]; }

  async boot(): Promise<void> {
    const sources = 'Geography: © OpenStreetMap contributors via Overture Maps Foundation (ODbL) · Elevation: USGS 3DEP via AWS Terrain Tiles · Vehicle base model: Khronos “Car Concept” (CC-BY 4.0) · Characters: Adobe Mixamo';
    this.menu = new Menu(this.settings, sources);
    const prog = (p: number, l: string) => this.menu.progress(p, l);
    const params = new URLSearchParams(location.search);
    prog(0.01, 'Initialising renderer');
    await this.renderer.init(document.getElementById('app')!, params.has('webgl'));
    console.info(`[Skydrive] renderer backend: ${this.renderer.backend}`);
    await this.physics.init();
    if (params.get('maxdt')) { this.maxDt = +params.get('maxdt')!; this.physics.maxFrame = this.maxDt; this.physics.maxSub = Math.ceil(this.maxDt * 60) + 1; }
    await this.world.load(prog);
    prog(0.48, 'Building street graph');
    this.graph = new RoadGraph(this.world.roads, this.world);
    this.input = new Input(this.renderer.renderer.domElement);
    this.input.sensitivity = this.settings.sensitivity;
    this.scene.add(this.worldRoot);
    this.cam = new CameraRig(this.physics, this.world, innerWidth / innerHeight);
    this.cam.zoom = this.settings.camDist;
    this.worldRoot.add(this.cam.camera);

    prog(0.52, 'Starting world streaming workers');
    this.streamer = new WorldStreamer(this.world, this.physics, this.q);
    this.worldRoot.add(this.streamer.root);
    await this.streamer.init(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)));

    prog(0.58, 'Raising landmarks');
    this.landmarks = new LandmarkSystem(this.world, this.graph, this.physics);
    this.landmarks.build();
    this.worldRoot.add(this.landmarks.group);

    prog(0.6, 'Bay Area terrain');
    const backdrop = await buildBackdrop(this.world, this.quality === 'low' ? 360 : this.quality === 'medium' ? 240 : 120);
    if (backdrop) this.worldRoot.add(backdrop);
    prog(0.62, 'Atmosphere & water');
    const waterTex = await new THREE.TextureLoader().loadAsync('./assets/textures/waternormals.jpg');
    this.env = new Environment(this.scene, this.worldRoot, this.renderer.renderer, this.world, waterTex, this.q.rainDrops);
    this.env.hour = this.settings.time;
    this.env.setWeather(this.settings.weather as Weather, true);
    this.env.shadowRange = this.q.shadowRange;
    this.env.sun.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
    if (params.get('h')) this.env.hour = +params.get('h')!;
    if (params.get('w')) this.env.setWeather(params.get('w') as Weather, true);

    prog(0.66, 'Preparing the Skydrive');
    this.vehicle = new Vehicle(this.physics, this.world, this.graph, (x, z) => this.streamer.hasCollider(x, z));
    await this.vehicle.init('./assets/models/skydrive-car.glb');
    this.worldRoot.add(this.vehicle.model.root);
    this.vehicle.onStateChange = (s) => this.onVehicleState(s);
    this.vehicle.onImpact = (k) => { this.audio.impact(k); this.cam.addShake(k * 1.5); const p = this.vehicle.position; this.traffic.impactNear(p.x, p.z); };

    prog(0.72, 'Populating streets');
    this.traffic = new TrafficManager(this.graph, this.physics);
    this.traffic.maxAgents = this.q.maxTraffic;
    this.traffic.onHonk = (x, y, z) => { const p = this.vehicle.position; this.audio.horn(Math.hypot(x - p.x, y - p.y, z - p.z)); };
    this.worldRoot.add(this.traffic.group);
    this.streamer.furniture.setSignalColorFn((_i, x, z, rot, out) => this.traffic.signalColorAt(x, z, rot, out));
    this.peds = new PedestrianManager(this.world.peds, this.world, this.graph, this.traffic.signals);
    this.peds.maxPeds = this.q.maxPeds;
    this.peds.timeFn = () => this.traffic.time;
    this.worldRoot.add(this.peds.group);
    try { await this.peds.load(['./assets/models/pedestrian.glb', './assets/models/pedestrian-b.glb']); }
    catch (e) { console.warn('pedestrian assets failed', e); }

    prog(0.76, 'Mapping the city');
    this.nav = new Navigation(this.graph);
    this.challenges = new Challenges(this.world, this.landmarks, this.nav);
    this.challenges.build();
    this.worldRoot.add(this.challenges.group);
    this.map = new MapRenderer(this.world, this.graph, 2560);
    this.hud = new HUD();
    this.fullMap = new FullMap(this.map, this.world.meta.landmarks);
    this.touch = new MobileControls(this.input);
    this.wireUI();

    // spawn: top of Russian Hill on Hyde St, facing the bay and Alcatraz
    const sp = params.get('spawn');
    const spawn = sp ? sp.split(',').map(Number) : null;
    const start = spawn ? { x: spawn[0], z: spawn[1] } : lonLatToWorld(-122.41895, 37.80080);
    const near = this.graph.nearest(start.x, start.z, 200, (e) => e.cls <= 5 && (!!spawn || /Hyde/.test(e.name)));
    let heading = Math.PI; // north
    let sx = start.x, sz = start.z;
    if (near && !spawn) {
      const e = this.graph.edges[near.edge];
      const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
      this.graph.sample(e, near.s, o);
      heading = Math.atan2(o.tx, o.tz);
      if (o.tz > 0) heading += Math.PI; // face north
      const lane = e.oneway ? 0 : e.w / 4;
      // right-hand lane: right vector of heading (sin h, cos h) is (-cos h, sin h)
      sx = o.x - Math.cos(heading) * lane; sz = o.z + Math.sin(heading) * lane;
    }
    prog(0.8, 'Streaming terrain, streets and buildings');
    await this.streamer.preload(new THREE.Vector3(sx, 0, sz), (f) => prog(0.8 + f * 0.18, 'Streaming terrain, streets and buildings'));
    this.vehicle.spawn(sx, sz, heading);
    this.rebaseOrigin(new THREE.Vector3(sx, 0, sz), true);

    this.renderer.buildPipeline(this.scene, this.cam.camera, this.q);
    this.renderer.applyQuality(this.q, this.settings.resScale);
    this.menu.challenges = this.challenges.list;
    prog(1, 'Ready');
    this.menu.showMain();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.renderer.setAnimationLoop(() => this.frame());
    (window as unknown as { game: Game }).game = this;
    const vw = params.get('view');
    if (vw) { const n = vw.split(',').map(Number); this.debugView = [new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3(n[3], n[4], n[5])]; }
    if (params.has('autostart')) this.startGame();
  }

  private wireUI(): void {
    this.menu.onStart = () => this.startGame();
    this.menu.onSettings = (s) => this.applySettings(s);
    this.menu.onChallenge = (id) => { this.challenges.start(id); this.startGame(); };
    this.challenges.onEvent = (a, b) => { this.hud.toast(a, b); this.audio.chime(null, [784, 1175]); this.hud.flash(); };
    this.input.on('transform', () => this.transform());
    this.input.on('camera', () => { const m = this.cam.cycle(); this.hud.toast('Camera', CAM_LABEL[m], 1200); });
    this.input.on('reset', () => { if (!this.paused) { this.vehicle.resetToRoad(); this.hud.toast('Vehicle reset', 'Placed on the nearest street', 1500); } });
    this.input.on('map', () => this.toggleMap());
    this.input.on('pause', () => { if (this.fullMap.open) this.toggleMap(false); else if (this.started) this.togglePause(); });
    this.input.on('lights', () => { this.showStats = !this.showStats; });
    this.input.on('time', () => {
      const i = TIME_PRESETS.findIndex((t) => Math.abs(t.h - this.env.hour) < 0.3);
      const n = TIME_PRESETS[(i + 1) % TIME_PRESETS.length];
      this.env.hour = n.h; this.settings.time = n.h; this.hud.toast('Time of day', n.name, 1400);
    });
    this.input.on('weather', () => { const w = this.env.cycleWeather(); this.settings.weather = w; this.hud.toast('Weather', w[0].toUpperCase() + w.slice(1), 1400); });
    this.input.on('cinematic', () => this.flyover());
    this.fullMap.onWaypoint = (x, z) => { const p = this.vehicle.position; this.nav.plan(p.x, p.z, x, z); this.hud.toast('GPS route set', this.world.nearestHood(x, z), 1500); this.fullMap.state.route = this.nav.route; this.fullMap.state.target = this.nav.target; this.fullMap.draw(); };
    this.fullMap.onClear = () => { this.nav.clear(); this.fullMap.state.route = []; this.fullMap.state.target = null; this.fullMap.draw(); };
    this.fullMap.onLandmark = (id) => { const l = this.world.meta.landmarks.find((m) => m.id === id)!; this.fullMap.onWaypoint!(l.x, l.z); };
    this.touch.onTransform = () => this.transform();
    this.touch.onCamera = () => { const m = this.cam.cycle(); this.hud.toast('Camera', CAM_LABEL[m], 1200); };
    this.touch.onMap = () => this.toggleMap();
    this.touch.onPause = () => this.togglePause();
    window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && this.menu.visible && !this.started) this.startGame(); });
    // mouse look: drag to orbit (pointer lock optional on double-click)
    this.renderer.renderer.domElement.addEventListener('dblclick', () => { if (!this.settings.touch) this.renderer.renderer.domElement.requestPointerLock?.(); });
    // touch camera orbit with a single finger on empty screen space
    let tp: { id: number; x: number; y: number } | null = null;
    const cv = this.renderer.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') tp = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointermove', (e) => { if (tp && e.pointerId === tp.id) { this.cam.orbit((e.clientX - tp.x) * 1.5, (e.clientY - tp.y) * 1.5, 0); tp.x = e.clientX; tp.y = e.clientY; } });
    cv.addEventListener('pointerup', () => { tp = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started && !this.paused) this.togglePause(); });
  }

  private applySettings(s: Partial<Settings>): void {
    try { localStorage.setItem('skydrive.settings', JSON.stringify(this.settings)); } catch { /* */ }
    if (s.quality && s.quality !== this.quality) {
      this.quality = s.quality;
      this.streamer.setQuality(this.q);
      this.traffic.maxAgents = this.q.maxTraffic; this.peds.maxPeds = this.q.maxPeds;
      this.env.shadowRange = this.q.shadowRange;
      this.renderer.buildPipeline(this.scene, this.cam.camera, this.q);
      this.renderer.applyQuality(this.q, this.settings.resScale);
    }
    if (s.resScale !== undefined) { this.adaptive.max = s.resScale; this.adaptive.scale = s.resScale; this.renderer.applyQuality(this.q, s.resScale); }
    if (s.volume !== undefined) this.audio.setVolume(s.volume);
    if (s.sensitivity !== undefined) this.input.sensitivity = s.sensitivity;
    if (s.camDist !== undefined) this.cam.zoom = s.camDist;
    if (s.time !== undefined) this.env.hour = s.time;
    if (s.weather) this.env.setWeather(s.weather as Weather);
    if (s.touch !== undefined && this.started) this.touch.show(s.touch);
    if (s.showFps !== undefined) this.showStats = s.showFps;
  }

  startGame(): void {
    this.audio.start(); this.audio.setVolume(this.settings.volume);
    this.menu.hide(); this.menu.inGame = true;
    this.hud.show(true);
    this.touch.show(this.settings.touch);
    this.hud.setTouch(this.settings.touch);
    this.paused = false;
    this.input.enabled = true;
    if (!this.started) {
      this.started = true;
      this.hud.toast('Welcome to San Francisco', `${this.world.nearestHood(this.vehicle.position.x, this.vehicle.position.z)} · press F to fly`, 4000);
    }
  }

  togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) { this.menu.showMain(); this.input.enabled = false; this.audio.ctx?.suspend(); }
    else this.startGame();
  }

  private toggleMap(v?: boolean): void {
    const p = this.vehicle.position;
    const f = this.vehicle.model.root.getWorldDirection(new THREE.Vector3());
    this.fullMap.state = { player: { x: p.x, z: p.z, heading: Math.atan2(f.x, -f.z) }, route: this.nav.route, target: this.nav.target, cp: this.challenges.next };
    this.fullMap.toggle(v);
  }

  private transform(): void {
    if (this.paused) return;
    const ok = this.vehicle.toggleTransform();
    if (!ok) this.hud.toast('Transformation unavailable', this.vehicle.state === 'driving' ? 'Slow below 160 km/h' : 'Sequence in progress', 1400);
  }

  private onVehicleState(s: string): void {
    if (s === 'transformingToFlight') { this.audio.transform(true); this.hud.flash(); }
    if (s === 'transformingToDriving') this.audio.transform(false);
    if (s === 'flight') this.hud.toast('Flight mode', 'E/Q climb · descend   ·   F to land', 2200);
    if (s === 'driving' && this.started) this.hud.toast('Drive mode', 'Wheels down', 1400);
    if (s === 'emergency') this.hud.toast('Emergency stabilisation', 'Attitude recovery engaged', 1600);
    if (s === 'preparingLanding') this.hud.toast('Auto-landing', 'Descending to ground', 1800);
    this.touch.setFlight(s !== 'driving');
  }

  private flyover(): void {
    if (this.cam.flyover) { this.cam.flyover = null; return; }
    const W = (lon: number, lat: number, y: number) => { const p = lonLatToWorld(lon, lat); return new THREE.Vector3(p.x, y, p.z); };
    const p = this.vehicle.position;
    const pts = [p.clone().add(new THREE.Vector3(0, 40, 0)), W(-122.4230, 37.8200, 160), W(-122.4700, 37.8130, 120), W(-122.4790, 37.8190, 100), W(-122.4740, 37.8300, 260),
      W(-122.4230, 37.8290, 140), W(-122.4058, 37.8040, 150), W(-122.4010, 37.7962, 260), W(-122.3950, 37.7905, 360), W(-122.3800, 37.7960, 160), W(-122.3700, 37.8050, 120)];
    this.cam.startFlyover(pts, 48);
    this.hud.toast('Landmark flyover', 'Press V to exit', 2000);
  }

  private rebaseOrigin(p: THREE.Vector3, force = false): void {
    const dx = p.x - this.origin.x, dz = p.z - this.origin.z;
    if (!force && Math.hypot(dx, dz) < 1500) return;
    this.origin.set(Math.round(p.x / 500) * 500, 0, Math.round(p.z / 500) * 500);
    this.worldRoot.position.set(-this.origin.x, 0, -this.origin.z);
    this.worldRoot.updateMatrixWorld(true);
    U.origin.value.copy(this.origin);
  }

  private onResize(): void {
    this.cam.camera.aspect = innerWidth / innerHeight;
    this.cam.camera.updateProjectionMatrix();
    this.renderer.applyQuality(this.q, this.adaptive.scale);
    this.fullMap?.draw();
  }

  private frame(): void {
    const now = performance.now();
    const dtRaw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(dtRaw, this.maxDt);
    this.frameMs += (dtRaw * 1000 - this.frameMs) * 0.05;
    this.fps = 1000 / this.frameMs;
    U.time.value += dt;
    const v = this.vehicle;
    const flying = v.fold > 0.5;
    let alpha = 1;
    if (!this.paused) {
      const ctrl = this.input.read(dt, flying);
      alpha = this.physics.step(dt, (h) => v.step(h, ctrl), () => v.postStep());
      const m = this.input.consumeMouse();
      this.cam.orbit(m.dx, m.dy, m.wheel);
      v.updateVisual(alpha, dt);
      const vp = v.position, vel = v.velocity;
      const player = { x: vp.x, y: vp.y, z: vp.z, vx: vel.x, vz: vel.z, speed: vel.length() };
      this.traffic.update(dt, player, flying);
      this.peds.update(dt, player, flying);
      this.challenges.update(dt, vp, flying, this.cam.camera.position);
      if (this.nav.route.length) this.nav.progress(vp.x, vp.z);
      this.audio.update({
        speed: vel.length(), throttle: ctrl.throttle, slip: v.slip, hover: v.hover, thrust: v.thrustLevel, flying: v.fold > 0.5,
        cockpit: this.cam.mode === 'cockpit', altitude: v.agl, city: this.world.surfaceAt(vp.x, vp.z) === 0 ? 1 : 0.4,
        coast: this.coastProximity(vp.x, vp.z), rain: U.rain.value, boost: ctrl.boost,
      });
      this.streamer.furniture.updateSignals();
    } else {
      v.updateVisual(1, 0);
    }
    this.cam.update(dt, v);
    if (this.debugView) { this.cam.camera.position.copy(this.debugView[0]); this.cam.camera.up.set(0, 1, 0); lookAtAbs(this.cam.camera, this.debugView[1]); this.cam.camera.fov = 55; this.cam.camera.updateProjectionMatrix(); }
    const camAbs = this.cam.camera.position;
    const focus = this.cam.flyover || this.debugView ? camAbs : v.renderPosition;
    this.streamer.update(focus, this.cam.flyover ? new THREE.Vector3() : v.velocity, flying || !!this.cam.flyover, now / 1000);
    this.rebaseOrigin(camAbs);
    this.env.update(dt, camAbs, v.renderPosition, this.origin);
    this.updateHUD(dt);
    // adaptive resolution
    if (this.adaptive.update(dtRaw * 1000)) this.renderer.applyQuality(this.q, this.adaptive.scale);
    this.renderer.render(this.scene, this.cam.camera);
    if (this.started && ++this.frames === 30) (window as unknown as { __ready: boolean }).__ready = true;
  }

  private coastProximity(x: number, z: number): number {
    let water = 0;
    for (const [dx, dz] of [[120, 0], [-120, 0], [0, 120], [0, -120]]) if (this.world.heightAt(x + dx, z + dz) < 0) water++;
    return water / 4;
  }

  private updateHUD(dt: number): void {
    if (!this.started) return;
    const v = this.vehicle;
    const p = v.renderPosition;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(v.renderQuaternion);
    const hdg = headingDeg(f.x, f.z);
    const vel = v.velocity;
    const sp = v.fold > 0.5 ? vel.length() : Math.abs(v.speed);
    const hood = this.world.nearestHood(p.x, p.z);
    if (hood !== this.lastHood) { if (this.lastHood) this.hud.toast(hood, 'San Francisco', 1800); this.lastHood = hood; }
    const ch = this.challenges.active;
    let arrow: number | null = null;
    const tgt = this.challenges.next ?? (this.nav.target ? new THREE.Vector3(this.nav.target.x, p.y, this.nav.target.z) : null);
    if (tgt) {
      const camF = this.cam.camera.getWorldDirection(new THREE.Vector3());
      const bearing = Math.atan2(tgt.x - p.x, -(tgt.z - p.z));
      const camB = Math.atan2(camF.x, -camF.z);
      arrow = bearing - camB;
    }
    const stats = this.showStats ? [
      `${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms  ${this.renderer.backend}`,
      `res ${(this.adaptive.scale * 100).toFixed(0)}%  quality ${this.quality}`,
      `draw calls ${this.renderer.renderer.info.render.calls}  tris ${(this.renderer.renderer.info.render.triangles / 1e6).toFixed(2)}M`,
      `tiles ${this.streamer.stats.loaded} (+${this.streamer.stats.pending})  geo ${this.streamer.stats.memMB.toFixed(0)} MB`,
      `colliders ${this.streamer.stats.colliders}  traffic ${this.traffic.agents.length}  peds ${this.peds.count}`,
      `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}  origin ${this.origin.x}, ${this.origin.z}`,
      `state ${v.state}  fold ${v.fold.toFixed(2)}  grounded ${v.grounded}`,
    ].join('\n') : null;
    this.hud.update({
      speedKmh: sp * 3.6, mode: STATE_LABEL[v.state], modeClass: v.state === 'driving' ? '' : v.state === 'flight' ? 'fly' : 'tr',
      battery: v.battery, alt: p.y, agl: Math.max(0, v.agl), vs: vel.y, heading: hdg, hood, gps: formatLatLon(p.x, p.z), flying: v.fold > 0.5,
      gear: v.state !== 'driving' ? 'AIR' : v.speed < -0.5 ? 'R' : sp < 0.3 ? 'P' : 'D',
      challenge: ch ? { name: ch.name, idx: this.challenges.idx, total: ch.points.length, time: this.challenges.timer, dist: tgt ? tgt.distanceTo(p) : 0 } : null,
      arrowAngle: arrow, stats, navDist: this.nav.route.length ? this.nav.progress(p.x, p.z) : null,
    });
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 1 / 20;
      const zoom = v.fold > 0.5 ? Math.max(0.35, 1.6 - v.agl / 400) : 1.9 - Math.min(Math.abs(v.speed), 40) / 40 * 0.6;
      this.hud.drawMinimap(this.map, { x: p.x, z: p.z, heading: (hdg * Math.PI) / 180 }, this.nav.route, this.nav.target, this.challenges.next, zoom);
    }
    this.dashTimer -= dt;
    if (this.dashTimer <= 0 && this.cam.mode === 'cockpit') {
      this.dashTimer = 0.1;
      v.model.drawDash(sp * 3.6, STATE_LABEL[v.state], v.battery, p.y, v.state === 'flight' ? 'HOVER OK' : v.state === 'driving' ? 'AWD · READY' : 'TRANSFORMING', hdg);
    }
  }
}
