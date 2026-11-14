import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Grid } from './grid.js';
import { CarAudio } from './audio.js';
import { Input } from './input.js';
import { buildCarModel, CarPhysics, PAINTS, SMOKES } from './car.js';
import { Effects } from './fx.js';
import { World, TIMES, makeGate, Cones } from './world.js';

const $ = s => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ------------------------------------------------------------------ persistence
const store = {
  get(k, d) { try { const v = localStorage.getItem('driftcity.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('driftcity.' + k, JSON.stringify(v)); } catch { } },
};
const settings = Object.assign({
  quality: isTouch ? 'medium' : 'high', assist: '0.65', cam: '0', steer: 'buttons', autogas: '0', vol: 0.8, fps: '0',
  time: 'sunset', dir: 0, paint: 'orange', smoke: 'white', map: 'cornerstone', car: 'csl',
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
const records = store.get('records', {});

// ------------------------------------------------------------------ renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3500);

const QUALITY = {
  low: { pr: 0.9, shadow: 0, bloom: false, msaa: 0, smoke: 0.45, post: false },
  medium: { pr: 1.35, shadow: 1024, bloom: true, msaa: 0, smoke: 0.75, post: true },
  high: { pr: 2, shadow: 2048, bloom: true, msaa: 4, smoke: 1, post: true },
  ultra: { pr: 2.5, shadow: 4096, bloom: true, msaa: 4, smoke: 1.2, post: true },
};
let Q = QUALITY[settings.quality];
let dynScale = 1;
let composer, bloomPass, gradePass;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, vignette: { value: 0.35 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount, vignette, time; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r = length(d);
      vec2 off = d * amount * 0.012 * r;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      // radial speed blur
      if (amount > 0.05) { vec3 acc = c; for (int i=1;i<5;i++){ acc += texture2D(tDiffuse, vUv - d * float(i) * 0.006 * amount * r).rgb; } c = mix(c, acc/5.0, smoothstep(0.15, 0.6, r)); }
      c *= 1.0 - vignette * smoothstep(0.35, 0.85, r);
      c += (h(vUv*1000.0 + time) - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

function setupPipeline() {
  Q = QUALITY[settings.quality];
  const pr = Math.min(devicePixelRatio || 1, Q.pr) * dynScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = Q.shadow > 0;
  world && world.setShadowQuality(Q.shadow);
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
  composer = null;
  if (Q.post) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.85);
    bloomPass.enabled = Q.bloom;
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    applyBloom();
  }
  // re-compile materials that depend on shadow settings
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  onResize();
}
function applyBloom() { if (bloomPass && world && world.T) { const [s, r, t] = world.T.bloom; bloomPass.strength = s; bloomPass.radius = r; bloomPass.threshold = t; } }
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  camera.aspect = w / h;
  baseFov = w / h < 1.2 ? 62 * Math.min(1.6, Math.pow(1.2 / (w / h), 0.6)) : 62;
  camera.updateProjectionMatrix();
}
let baseFov = 62;
addEventListener('resize', onResize);

// ------------------------------------------------------------------ globals
// ---- content tables: add a map or a car here (and its assets) to extend the game
const MAPS = {
  cornerstone: { id: 'cornerstone', name: 'קורנרסטון', glb: 'city', gridMod: '../assets/grid.js', route: 'route.json', fill: 'fill.json', ramp: 'ramp.json', mini: 'minimap.png', scale: 100, cps: 8, rec: '', km: '3.3', info: 'רציף, גשר לא גמור ורמפת קפיצה' },
  chicago: { id: 'chicago', name: 'שיקגו', glb: 'chi', gridMod: '../assets/grid_chi.js', route: 'route_chi.json', fill: 'fill_chi.json', ramp: null, mini: 'minimap_chi.png', scale: 0.4, cps: 7, rec: 'chi_', km: '3.0', info: 'שדרות רחבות ועיקולים ארוכים' },
};
const CARS = {
  csl: { id: 'csl', name: 'BMW 3.0 CSL', glb: 'car', info: 'קלה וזריזה', spec: { mass: 1180, torque: 780 } },
  m5: { id: 'm5', name: 'BMW M5 E28', glb: 'm5', info: 'כבדה, חזקה ויציבה', spec: { mass: 1390, torque: 900, tune: { gripF: 1.98, gripR: 1.74 } } },
};
let mapId = null, NCP = 8, gltfLoader = null, glbSuffix = '';
const carGltf = {};
const grid = new Grid();
const audio = new CarAudio(); audio.setVolume(settings.vol);
const input = new Input(); input.autoGas = settings.autogas === '1';
let world, car, phys, fx, cones, route, routeFwd, routeRev, gates = [];
const loadMgr = { car: 0, city: 0 };

function setLoad(p, text) { $('#loadBar').style.width = (p * 100).toFixed(1) + '%'; if (text) $('#loadText').textContent = text; }
// Hosts that cannot serve .glb get the model as a base64 string module (<name>.glb.js); fetched with progress, parsed in memory.
async function loadEmbedded(loader, url, key) {
  const r = await fetch(url + '.js');
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const total = +r.headers.get('content-length') || (key === 'city' ? 7.9e6 : 3e6);
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; loadMgr[key] = Math.min(0.99, got / total); setLoad(loadMgr.car * 0.25 + loadMgr.city * 0.65); }
  const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  const b64 = text.slice(text.indexOf('"') + 1, text.lastIndexOf('"'));
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Promise((res, rej) => loader.parse(bytes.buffer, '', res, rej));
}
function loadModel(name, key) { return loadGLB(gltfLoader, `assets/${name}${glbSuffix}.glb`, key); }
function loadGLB(loader, url, key) {
  if (window.DRIFT_EMBED) return loadEmbedded(loader, url, key);
  return new Promise((res, rej) => loader.load(url, res, e => {
    if (e.total) loadMgr[key] = e.loaded / e.total; else loadMgr[key] = Math.min(0.95, e.loaded / (key === 'city' ? 1.07e7 : 4e6));
    setLoad(loadMgr.car * 0.25 + loadMgr.city * 0.65);
  }, rej));
}

async function loadMap(id) {
  const M = MAPS[id];
  const [cityG, routeData, fill, ramp, gridB64] = await Promise.all([
    loadModel(M.glb, 'city'),
    fetch('assets/' + M.route).then(r => r.json()),
    fetch('assets/' + M.fill).then(r => r.json()),
    M.ramp ? fetch('assets/' + M.ramp).then(r => r.json()) : Promise.resolve(null),
    import(M.gridMod).then(mod => mod.default),
  ]);
  await grid.load(gridB64);
  setLoad(0.93, 'בונה את העיר…');
  await new Promise(r => setTimeout(r, 30));
  if (mapId) { world.clearMap(); }
  routeFwd = routeData; routeRev = routeData.slice().reverse();
  world.setupCity(cityG, M.scale);
  world.buildSurroundings(fill, routeFwd);
  if (ramp) world.buildRamp(ramp);
  world.setShadowQuality(Q.shadow);
  mapId = id; NCP = M.cps;
  minimapImg.src = 'assets/' + M.mini;
  if (world.T) world.setTime(settings.time);
}

function disposeCar(c) { c.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
async function loadCar(id) {
  const C = CARS[id];
  if (!carGltf[id]) carGltf[id] = await loadModel(C.glb, 'car');
  const model = await buildCarModel(carGltf[id]);
  if (car) { scene.remove(car.root); disposeCar(car); }
  car = model; scene.add(car.root);
  if (phys) { phys.setCar(car.info, C.spec); } else phys = new CarPhysics(car.info, grid, C.spec);
  phys.assist = +settings.assist;
  setupCarLights();
  if (fx) { applyGarage(); applyCarLights(); }
}

async function boot() {
  gltfLoader = new GLTFLoader();
  // compressed models need a WebAssembly decoder; if the host blocks WebAssembly, use the plain versions
  try { if (/[?&]plain/.test(location.search)) throw 0; await Promise.race([MeshoptDecoder.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]); gltfLoader.setMeshoptDecoder(MeshoptDecoder); }
  catch { glbSuffix = '_q'; }
  if (!MAPS[settings.map]) settings.map = 'cornerstone';
  if (!CARS[settings.car]) settings.car = 'csl';
  world = new World(scene, renderer);
  setupPipeline();
  await Promise.all([loadMap(settings.map), loadCar(settings.car)]);
  fx = new Effects(scene);
  cones = new Cones(scene, grid);
  applyGarage();
  setTime(settings.time);

  setLoad(0.97, 'מכין שיידרים…');
  prepareRoute();
  placeShowroom();
  updateCarVisual(0);
  camera.position.set(phys.pos.x + 6, phys.pos.y + 2, phys.pos.z + 6); camera.lookAt(phys.pos);
  try { await renderer.compileAsync(scene, camera); } catch { }
  setLoad(1, '');
  input.bindTouch($('#touch'));
  input.bindSlider($('#tSteer'));
  input.onAction = onAction;
  showMenu();
  $('#loading').classList.add('hidden');
  last = performance.now();
  requestAnimationFrame(loop);
}

async function switchMap(id) {
  if (id === mapId || state === 'loading') return;
  settings.map = id; saveSettings();
  state = 'loading';
  $('#menu').classList.add('hidden'); $('#loading').classList.remove('hidden');
  loadMgr.car = 1; loadMgr.city = 0; setLoad(0.05, 'טוען מפה…');
  try {
    await loadMap(id);
    fx.clear(); setTime(settings.time);
    prepareRoute(); placeShowroom();
  } catch (e) { console.error(e); $('#loadErr').textContent = 'שגיאה בטעינת המפה: ' + (e && e.message || e); await new Promise(r => setTimeout(r, 2500)); $('#loadErr').textContent = ''; }
  $('#loading').classList.add('hidden');
  showMenu();
}
async function switchCar(id) {
  if (!CARS[id] || id === settings.car && car) return;
  settings.car = id; saveSettings();
  try { await loadCar(id); } catch (e) { console.error(e); }
  renderCarChips();
}

// ------------------------------------------------------------------ car lights
let headL, headR, glowTex, tailGlows = [], headGlows = [];
function setupCarLights() {
  const i = car.info; tailGlows = []; headGlows = [];
  for (const [p, name] of [[i.headL, 'L'], [i.headR, 'R']]) {
    const s = new THREE.SpotLight(0xfff1dc, 0, 110, 0.55, 0.5, 1.15);
    s.position.copy(p); s.position.y += 0.1;
    s.target.position.set(p.x * 1.2, -0.6, p.z + 18);
    car.body.add(s, s.target);
    if (name === 'L') headL = s; else headR = s;
  }
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  for (const p of [i.tailL, i.tailR]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2010, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(p); s.position.z -= 0.08; s.scale.setScalar(0.6); car.body.add(s); tailGlows.push(s);
  }
  for (const p of [i.headL, i.headR]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4e0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.material.opacity = 0.55; s.position.copy(p); s.position.z += 0.1; s.scale.setScalar(0.55); car.body.add(s); headGlows.push(s);
  }
}

function applyCarLights() {
  const night = world.T && world.T.night;
  headL.intensity = headR.intensity = night ? 420 : 0;
  car.lights.head && (car.lights.head.emissiveIntensity = night ? 4 : 0.2);
  headGlows.forEach(s => s.visible = !!night);
}
function setTime(key) {
  settings.time = key; saveSettings();
  world.setTime(key);
  const night = world.T.night;
  applyCarLights();
  fx.setFog(scene.fog); fx.setLight(new THREE.Color(world.T.smokeLight).multiplyScalar(night ? 0.55 : 1));
  applyBloom();
  renderTimeChips();
}

function applyGarage() {
  const p = PAINTS.find(p => p.id === settings.paint) || PAINTS[0];
  car.paint.color.setHex(p.color);
  car.paint.metalness = p.id === 'white' ? 0.25 : p.id === 'black' ? 0.6 : 0.55;
  const s = SMOKES.find(s => s.id === settings.smoke) || SMOKES[0];
  fx.smokeColor.setHex(s.color);
}

// ------------------------------------------------------------------ route / gates / cones
let cpIdx = [];
function prepareRoute() {
  route = settings.dir ? routeRev : routeFwd;
  for (const g of gates) scene.remove(g);
  gates = [];
  cpIdx = [];
  const n = route.length;
  for (let i = 1; i <= NCP; i++) cpIdx.push(i === NCP ? n - 8 : Math.round(i * (n - 8) / NCP));
  const mk = (idx, finish, start) => {
    const [x, z, y, rd] = route[idx]; const [x2, z2] = route[Math.min(n - 1, idx + 1)];
    const w = Math.max(9, rd * 2 + 1.4);
    const g = makeGate(w, finish, start);
    g.position.set(x, y, z); g.rotation.y = Math.atan2(x2 - x, z2 - z);
    g.userData.idx = idx;
    scene.add(g); gates.push(g); return g;
  };
  mk(12, false, true);
  cpIdx.forEach((idx, k) => mk(idx, k === NCP - 1, false));
  // progress ticks
  const pr = $('#prog'); pr.querySelectorAll('b').forEach(b => b.remove());
  cpIdx.forEach(i => { const b = document.createElement('b'); b.style.left = (i / (n - 1) * 100) + '%'; pr.appendChild(b); });
  // cones at the apex of the sharpest corners
  const list = [];
  let lastC = -100;
  const dir = i => { const a = route[Math.max(0, i)], b = route[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const turn = new Array(n).fill(0);
  for (let i = 8; i < n - 8; i++) { const a = dir(i - 7), b = dir(i + 6); turn[i] = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); }
  for (let i = 20; i < n - 20; i++) {
    const t = turn[i];
    if (Math.abs(t) < 0.42 || i - lastC < 35) continue;
    let isMax = true; for (let j = i - 6; j <= i + 6; j++) if (Math.abs(turn[j]) > Math.abs(t)) isMax = false;
    if (!isMax) continue;
    lastC = i;
    const inner = t < 0 ? 1 : -1; // left turn -> left side (dz,-dx)
    for (let j = -4; j <= 4; j += 2) {
      const k = i + j, [x, z, , rd] = route[k], [dx, dz] = dir(k);
      const off = Math.max(1.5, rd - 1.6);
      const cx = x + dz * inner * off, cz = z - dx * inner * off;
      if (grid.sdf(cx, cz) > 0.8) list.push([cx, cz]);
    }
  }
  cones.place(list);
}

function routeHeadingAt(i) {
  const n = route.length, a = route[Math.max(0, Math.min(n - 2, i))], b = route[Math.max(1, Math.min(n - 1, i + 3))];
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}
function placeCarAtStart() {
  const [x, z] = route[4];
  phys.place(x, z, routeHeadingAt(4));
  progIdx = 4;
}
function placeShowroom() {
  const i = 31, [x, z] = routeFwd[i], [x2, z2] = routeFwd[i + 3];
  phys.place(x, z, Math.atan2(x2 - x, z2 - z) + 0.5);
  tailGlows.forEach(s => s.material.opacity = 0);
}
function nearestRoute(x, z, from, to) {
  let best = from, bd = 1e18;
  for (let i = Math.max(0, from); i < Math.min(route.length, to); i++) { const d = (route[i][0] - x) ** 2 + (route[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return [best, Math.sqrt(bd)];
}

// ------------------------------------------------------------------ game state
let state = 'loading', mode = 'free';
let progIdx = 0, nextCp = 0, timeLeft = 0, elapsed = 0, countdown = 0;
let score = 0, combo = 0, mult = 1, chainT = 0, driftT = 0, multT = 0, bestCombo = 0, maxAngle = 0, comboActive = false, nearT = 0, conesHit = 0;
let wrongT = 0, camMode = +settings.cam, shake = 0;

function resetRun() {
  prepareRoute();
  placeCarAtStart();
  fx.clear(); cones.reset();
  score = 0; combo = 0; mult = 1; chainT = 0; driftT = 0; bestCombo = 0; maxAngle = 0; comboActive = false; conesHit = 0;
  nextCp = 0; elapsed = 0; timeLeft = 55;
  phys.nitro = 1; phys.gear = 1;
  gates.forEach((g, k) => g.visible = mode === 'run' || k === 0);
  $('#timerPill').classList.toggle('hidden', mode !== 'run');
  $('#cpPill').classList.toggle('hidden', mode !== 'run');
  $('#prog').classList.toggle('hidden', mode !== 'run');
  updateHud(true);
  snapCamera();
}

function startGame(m) {
  mode = m;
  audio.init();
  if (isTouch) { try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => { }); } catch { } }
  hideAll(); $('#hud').classList.remove('hidden');
  if (isTouch) { $('#touch').classList.remove('hidden'); document.body.classList.add('playing'); }
  resetRun();
  state = 'countdown'; countdown = 3.6; phys.frozen = true;
  lastCount = 4;
}

function hideAll() { for (const s of ['#menu', '#pause', '#results', '#settingsModal', '#garageModal', '#helpModal', '#hud', '#touch']) $(s).classList.add('hidden'); document.body.classList.remove('playing'); }

function showMenu() {
  state = 'menu'; hideAll(); $('#menu').classList.remove('hidden');
  phys.frozen = true; mode = 'free';
  prepareRoute(); placeShowroom(); fx.clear(); cones.reset();
  gates.forEach((g, k) => g.visible = k === 0);
  renderRecords(); renderMapChips();
  menuAng = 0;
}

function pause() { if (state !== 'play' && state !== 'countdown') return; prevState = state; state = 'paused'; $('#pause').classList.remove('hidden'); $('#touch').classList.add('hidden'); }
function resume() { $('#pause').classList.add('hidden'); if (isTouch) $('#touch').classList.remove('hidden'); state = prevState || 'play'; last = performance.now(); }
let prevState = 'play';

function finish(reason) {
  bankCombo();
  state = 'results'; phys.frozen = true;
  const bonus = reason === 'finish' ? Math.round(timeLeft * 250) : 0;
  const total = score + bonus;
  const key = MAPS[mapId].rec + mode + (mode === 'run' ? (settings.dir ? '_rev' : '_fwd') : '');
  const rec = records[key] || 0;
  const isRec = total > rec;
  if (isRec) { records[key] = total; store.set('records', records); }
  $('#resTitle').textContent = reason === 'finish' ? 'סיימת את המסלול! 🏁' : reason === 'time' ? 'נגמר הזמן ⏱' : 'סיכום';
  const row = (k, v) => `<div class="row"><span>${k}</span><b class="num">${v}</b></div>`;
  $('#resBody').innerHTML =
    row('נקודות דריפט', fmt(score)) + (bonus ? row('בונוס זמן', '+' + fmt(bonus)) : '') +
    `<div class="row"><span style="font-size:20px;font-weight:900">סה״כ</span><b class="num" style="font-size:30px;color:var(--gold)">${fmt(total)}</b></div>` +
    row('הקומבו הכי גדול', fmt(bestCombo)) + row('זווית מקסימלית', Math.round(maxAngle) + '°') + row('קונוסים', conesHit) + row('זמן', fmtTime(elapsed)) +
    (isRec ? `<div style="text-align:center;margin-top:10px;font-weight:900;color:var(--good);font-size:20px">🏆 שיא חדש!</div>` : `<div style="text-align:center;margin-top:8px;color:var(--muted)">שיא: ${fmt(rec)}</div>`);
  $('#results').classList.remove('hidden'); $('#touch').classList.add('hidden');
  document.body.classList.remove('playing');
}

function onAction(a) {
  if (a === 'pause') { if (state === 'paused') resume(); else pause(); }
  else if (a === 'camera') { camMode = (camMode + 1) % 4; settings.cam = String(camMode); saveSettings(); popup(['מצלמת מרדף', 'מצלמה רחוקה', 'מכסה מנוע', 'מבט נהג'][camMode], '#fff'); }
  else if (a === 'reset' && state === 'play') respawn();
  else if (a === 'mute') { audio.setMuted(!audio.muted); popup(audio.muted ? 'שמע כבוי' : 'שמע פועל', '#fff'); }
}

function respawn() {
  const [i] = nearestRoute(phys.pos.x, phys.pos.z, progIdx - 40, progIdx + 60);
  const [x, z] = route[i];
  phys.place(x, z, routeHeadingAt(i));
  failCombo('חזרה לכביש');
  snapCamera();
}

// ------------------------------------------------------------------ scoring
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtTime = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
function popup(text, color = '#fff', size) {
  const d = document.createElement('div'); d.className = 'pop'; d.textContent = text; d.style.color = color;
  if (size) d.style.fontSize = size;
  const n = $('#popups').children.length; d.style.top = (38 + n * 5) + '%';
  $('#popups').appendChild(d); setTimeout(() => d.remove(), 1400);
}
function banner(text, color) { const b = $('#banner'); b.textContent = text; b.style.color = color || '#fff'; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function bankCombo() {
  if (!comboActive) return;
  const pts = Math.round(combo * mult);
  if (pts > 50) {
    score += pts; bestCombo = Math.max(bestCombo, pts);
    const label = pts > 40000 ? 'אגדי!' : pts > 20000 ? 'מטורף!' : pts > 8000 ? 'מעולה!' : pts > 3000 ? 'יפה!' : '';
    popup(`${label} +${fmt(pts)}`, pts > 20000 ? '#ffc23d' : '#4dff9a');
    if (pts > 8000) audio.chime();
  }
  comboActive = false; combo = 0; mult = 1; multT = 0;
}
function failCombo(text) {
  if (comboActive && combo > 100) {
    popup(`${text}! −${fmt(combo * mult)}`, '#ff5c5c');
    const c = $('#combo'); c.classList.add('fail'); setTimeout(() => c.classList.remove('fail'), 600);
  }
  comboActive = false; combo = 0; mult = 1; multT = 0; chainT = 0;
}

function updateScoring(dt) {
  const ang = Math.abs(phys.driftAngle);
  const sp = phys.speed;
  const drifting = !phys.air && sp > 7 && ang > 11 && ang < 115 && !phys.reverse;
  if (drifting) {
    driftT += dt; chainT = 1.8;
    if (!comboActive) { comboActive = true; combo = 0; mult = 1; multT = 0; }
    const a = Math.min(ang, 75);
    combo += a * sp * 1.45 * dt;
    multT += dt;
    if (multT > 2.6 && mult < 8) { mult++; multT = 0; audio.beep(660 + mult * 80, 0.08, 0.12); }
    maxAngle = Math.max(maxAngle, ang);
    phys.nitro = Math.min(1, phys.nitro + dt * 0.06 * (1 + mult * 0.15));
    // close call
    const cl = phys.rearClearance();
    nearT -= dt;
    if (cl < 0.9 && cl > -0.05 && nearT <= 0) { nearT = 1.2; combo += 600; multT += 0.8; popup('קרוב לקיר! +600', '#38d6ff'); }
  } else if (comboActive) {
    chainT -= dt;
    if (chainT <= 0) bankCombo();
  }
}

// ------------------------------------------------------------------ HUD
const minimapImg = new Image();
const mm = $('#minimap'), mmx = mm.getContext('2d');
const sp = $('#speedo'), spx = sp.getContext('2d');
let hudT = 0;
function updateHud(force) {
  $('#score').textContent = fmt(score);
  if (mode === 'run') {
    $('#timer').textContent = fmtTime(timeLeft);
    $('#timerPill').classList.toggle('low', timeLeft < 10);
    $('#cp').textContent = `${nextCp}/${NCP}`;
    $('#prog i').style.width = (progIdx / (route.length - 1) * 100) + '%';
  }
  const c = $('#combo');
  c.classList.toggle('on', comboActive);
  if (comboActive) {
    c.querySelector('.pts').textContent = fmt(combo);
    c.querySelector('.mult').textContent = 'x' + mult;
    c.querySelector('.chain i').style.width = (Math.max(0, chainT) / 1.8 * 100) + '%';
    c.querySelector('.ang').textContent = Math.round(Math.abs(phys.driftAngle)) + '°';
  }
  $('#tNitro').style.setProperty('--n', (phys.nitro * 100) + '%');
  drawSpeedo();
  drawMinimap();
}
function drawSpeedo() {
  const W = 420, c = spx;
  c.clearRect(0, 0, W, W);
  const cx = W / 2, cy = W / 2, R = 170;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  c.lineCap = 'round';
  c.beginPath(); c.arc(cx, cy, R + 16, 0, Math.PI * 2); c.fillStyle = 'rgba(8,10,15,0.55)'; c.fill();
  c.lineWidth = 16; c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
  const red = 7000 / 8000; c.strokeStyle = 'rgba(255,60,80,0.55)'; c.beginPath(); c.arc(cx, cy, R, a0 + (a1 - a0) * red, a1); c.stroke();
  const t = Math.min(1, phys.rpm / 8000);
  const grad = c.createLinearGradient(0, W, W, 0); grad.addColorStop(0, '#38d6ff'); grad.addColorStop(0.7, '#ffc23d'); grad.addColorStop(1, '#ff3d6e');
  c.strokeStyle = grad; c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * t); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '600 20px Rubik'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; c.fillText(i, cx + Math.cos(a) * (R - 34), cy + Math.sin(a) * (R - 34)); }
  c.fillStyle = '#fff'; c.font = '86px "Russo One"'; c.fillText(Math.round(phys.speed * 3.6), cx, cy + 4);
  c.font = '500 20px Rubik'; c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText('KM/H', cx, cy + 58);
  c.font = '40px "Russo One"'; c.fillStyle = phys.limiter ? '#ff3d6e' : '#ffc23d'; c.fillText(phys.reverse ? 'R' : phys.gear, cx, cy - 72);
  // nitro bar
  c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.arc(cx, cy, R - 62, Math.PI * 0.82, Math.PI * 0.18, true); c.stroke();
  c.strokeStyle = phys.nitroOn ? '#9fd6ff' : '#3f8cff'; c.beginPath(); c.arc(cx, cy, R - 62, Math.PI * 0.82, Math.PI * 0.82 - (Math.PI * 0.64) * phys.nitro, true); c.stroke();
  c.font = '600 16px Rubik'; c.fillStyle = 'rgba(160,200,255,0.8)'; c.fillText('N₂O', cx, cy + 100);
}
function drawMinimap() {
  const W = 340, c = mmx; c.clearRect(0, 0, W, W);
  c.save();
  c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); c.fillStyle = 'rgba(8,10,15,0.7)'; c.fill(); c.clip();
  const f = phys.forward;
  c.translate(W / 2, W / 2 + 40);
  c.rotate(-Math.PI / 2 - Math.atan2(f.z, f.x));
  const s = 0.75; c.scale(s, s);
  c.translate(-phys.pos.x, -phys.pos.z);
  if (minimapImg.complete && minimapImg.naturalWidth) c.drawImage(minimapImg, grid.X0, grid.Z0, minimapImg.naturalWidth * 2, minimapImg.naturalHeight * 2);
  if (mode === 'run') {
    for (let k = nextCp; k < cpIdx.length; k++) {
      const [x, z] = route[cpIdx[k]];
      c.beginPath(); c.arc(x, z, k === nextCp ? 14 : 9, 0, Math.PI * 2);
      c.fillStyle = k === cpIdx.length - 1 ? '#ff3d6e' : k === nextCp ? '#38d6ff' : 'rgba(56,214,255,0.5)'; c.fill();
    }
  }
  c.restore();
  // car arrow
  c.save(); c.translate(W / 2, W / 2 + 40);
  c.beginPath(); c.moveTo(0, -18); c.lineTo(12, 14); c.lineTo(0, 7); c.lineTo(-12, 14); c.closePath();
  c.fillStyle = '#ffc23d'; c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 8; c.fill(); c.restore();
}

// ------------------------------------------------------------------ car visuals / fx
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
let smokeAcc = [0, 0, 0, 0], backfireT = 0;
function updateCarVisual(dt) {
  const r = car.root;
  r.position.copy(phys.pos);
  r.rotation.set(-phys.pitch, phys.heading, phys.roll, 'YXZ');
  car.body.rotation.set(phys.visPitch, 0, -phys.visRoll);
  car.body.position.y = phys.air ? 0.05 : Math.sin(performance.now() * 0.05) * 0.003 * Math.min(1, phys.rpm / 5000);
  car.wheels.forEach((w, i) => {
    const wi = (w.front ? 0 : 2) + (w.left ? 0 : 1);
    if (w.front) w.pivot.rotation.y = phys.steerAngle;
    w.spin.rotation.x = phys.wheelRot[wi];
    w.pivot.position.y = w.base.y + (phys.air ? -0.08 : 0);
  });
  car.contact.visible = !phys.air;
  car.contact.material.opacity = phys.air ? 0 : 0.85;
}

function updateCarFx(dt, inp) {
  const night = world.T.night;
  const brake = !phys.reverse ? inp.brake > 0.1 : inp.throttle > 0.1;
  if (car.lights.tail) car.lights.tail.emissiveIntensity = brake ? 6 : (night ? 1.6 : 0.25);
  if (car.lights.reverse) car.lights.reverse.emissiveIntensity = phys.reverse ? 3 : 0;
  tailGlows.forEach(s => { s.material.opacity = brake ? 0.85 : night ? 0.35 : 0; s.scale.setScalar(brake ? 0.5 : 0.32); });

  // tyre smoke & skids
  const ch = Math.cos(phys.heading), sh = Math.sin(phys.heading);
  const rx = -ch, rz = sh;
  const info = car.info;
  const rearAmt = phys.air ? 0 : THREE.MathUtils.clamp((phys.rearSlip - 0.14) * 2.4, 0, 1) * Math.min(1, (phys.speed + phys.spinRatio * 10) / 4);
  const frontAmt = phys.air ? 0 : THREE.MathUtils.clamp((phys.frontSlip - 0.22) * 2.2, 0, 1) * Math.min(1, phys.speed / 6);
  const wheelsW = [[info.axleF, info.track / 2, frontAmt], [info.axleF, -info.track / 2, frontAmt], [info.axleR, info.track / 2, rearAmt], [info.axleR, -info.track / 2, rearAmt]];
  wheelsW.forEach(([lz, lx, amt], i) => {
    const x = phys.pos.x + sh * lz + ch * lx, z = phys.pos.z + ch * lz - sh * lx;
    const y = grid.height(x, z) + 0.025;
    fx.skids.add(i, x, y, z, rx, rz, amt * 0.75);
    if (i >= 2 && amt > 0.05) {
      smokeAcc[i] += dt * 46 * amt * Q.smoke;
      while (smokeAcc[i] > 1) { smokeAcc[i]--; fx.tyreSmoke(x, y, z, phys.vel.x, phys.vel.y, amt, 0.8 + amt * 0.5); }
    }
  });
  // exhaust: nitro & backfire flames
  const ex = info.exhaust;
  _v.set(ex.x, ex.y + 0.02, ex.z - 0.1); car.body.localToWorld(_v);
  const bx = -sh, bz = -ch;
  if (phys.nitroOn) fx.flame(_v.x, _v.y, _v.z, bx, bz, true);
  backfireT -= dt;
  if (backfireT > 0) fx.flame(_v.x, _v.y, _v.z, bx, bz, false);
  // throttle lift at high rpm -> random pops
  if (inp.throttle < 0.1 && phys.rpm > 5200 && Math.random() < dt * 2.5) { backfireT = 0.12; audio.backfire(); }
}

// ------------------------------------------------------------------ camera
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, 1);
let menuAng = 0;
function snapCamera() {
  const f = phys.forward;
  camDir.set(f.x, 0, f.z);
  camPos.set(phys.pos.x - f.x * 4.2, phys.pos.y + 1.5, phys.pos.z - f.z * 4.2);
  camera.position.copy(camPos);
}
function updateCamera(dt) {
  const f = phys.forward, spd = phys.speed;
  const fwd = _v.set(f.x, 0, f.z);
  if (state === 'menu' || state === 'results' && false) {
    menuAng += dt * 0.12;
    const r = 6.4;
    camera.position.set(phys.pos.x + Math.sin(menuAng + phys.heading + 0.7) * r, phys.pos.y + 1.55 + Math.sin(menuAng * 0.7) * 0.3, phys.pos.z + Math.cos(menuAng + phys.heading + 0.7) * r);
    // keep camera out of walls
    if (grid.sdf(camera.position.x, camera.position.z) < 0.5) { camera.position.lerp(_v2.copy(phys.pos).setY(camera.position.y), 0.4); }
    camera.lookAt(phys.pos.x, phys.pos.y + 0.7, phys.pos.z);
    camera.fov = baseFov - 8;
    const w = innerWidth, h = innerHeight;
    if (w / h > 1.1) camera.setViewOffset(w, h, w * 0.2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  if (camMode >= 2) {
    const local = camMode === 2 ? _v2.set(0, 1.22, 0.15) : _v2.set(0.36, 1.1, -0.28);
    car.body.localToWorld(local);
    camera.position.copy(local);
    const ahead = camMode === 2 ? _v.set(0, 1.0, 12) : _v.set(0.36, 1.0, 10);
    car.body.localToWorld(ahead);
    camera.up.set(0, 1, 0);
    camera.lookAt(ahead);
    camera.near = 0.05;
    camera.fov = baseFov + 6 + Math.min(14, spd * 0.22) + (phys.nitroOn ? 6 : 0);
    camera.updateProjectionMatrix();
    camPos.copy(camera.position);
    return;
  }
  camera.near = 0.1;
  const dist = camMode === 0 ? 4.1 : 6.2, height = camMode === 0 ? 1.4 : 2.3;
  // look direction blends between heading and velocity, so drifts show the car's angle
  let target = fwd.clone();
  if (spd > 3 && !phys.reverse) {
    const vd = _v2.set(phys.vel.x, 0, phys.vel.y).normalize();
    if (vd.dot(fwd) > -0.2) target.lerp(vd, 0.55).normalize();
  }
  const k = 1 - Math.exp(-dt * 4.2);
  camDir.lerp(target, k).normalize();
  const extra = Math.min(1.0, spd * 0.018);
  const desired = _v2.set(phys.pos.x - camDir.x * (dist + extra), phys.pos.y + height + extra * 0.25, phys.pos.z - camDir.z * (dist + extra));
  // camera collision with walls via SDF
  const ox = phys.pos.x, oz = phys.pos.z;
  let tMax = 1;
  for (let t = 0.2; t <= 1.0001; t += 0.1) { const x = ox + (desired.x - ox) * t, z = oz + (desired.z - oz) * t; if (grid.sdf(x, z) < 0.35) { tMax = Math.max(0.25, t - 0.1); break; } }
  desired.x = ox + (desired.x - ox) * tMax; desired.z = oz + (desired.z - oz) * tMax;
  desired.y = Math.max(desired.y, grid.height(desired.x, desired.z) + 0.6);
  if (camPos.distanceToSquared(desired) > 900) camPos.copy(desired);
  camPos.lerp(desired, 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 2.5); }
  if (phys.nitroOn) { camera.position.x += (Math.random() - 0.5) * 0.03; camera.position.y += (Math.random() - 0.5) * 0.03; }
  camLook.set(phys.pos.x + camDir.x * 3.2, phys.pos.y + 0.95, phys.pos.z + camDir.z * 3.2);
  camera.lookAt(camLook);
  const fov = baseFov + Math.min(16, spd * 0.28) + (phys.nitroOn ? 7 : 0);
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3));
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ loop
let last = 0, acc = 0, lastCount = 4, fpsAcc = 0, fpsN = 0, dynT = 0, dynAcc = 0, dynN = 0;
const STEP = 1 / 240;
const FIXED_DT = +(new URLSearchParams(location.search).get("fixeddt") || 0);
const idleInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0, nitro: 0 };
function loop(now) {
  requestAnimationFrame(loop);
  let dt = FIXED_DT || Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'paused') { render(dt); return; }
  input.speed = phys ? phys.speed : 0;
  input.update(dt);
  const playing = state === 'play';
  const inp = playing ? input : (state === 'countdown' ? { ...idleInput, throttle: input.throttle } : idleInput);

  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown - 0.6);
    if (n !== lastCount && n >= 0) {
      lastCount = n;
      if (n > 0) { banner(String(n), '#fff'); audio.beep(660, 0.18, 0.25); }
      else { banner('GO!', '#4dff9a'); audio.beep(1320, 0.35, 0.3); state = 'play'; phys.frozen = false; }
    }
  }

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 20) { phys.step(STEP, inp); acc -= STEP; steps++; if (playing || state === 'countdown') handleEvents(); }
  if (!playing && state !== 'countdown') phys.events.length = 0;

  if (playing) {
    elapsed += dt;
    updateScoring(dt);
    const hits = cones.collide(phys, car.info);
    if (hits) {
      conesHit += hits; audio.cone();
      if (comboActive) { combo += 350 * hits; popup(`קונוס! +${350 * hits}`, '#ff9a3c'); } else popup('קונוס!', '#ff9a3c');
    }
    // progress & checkpoints
    const [pi, pd] = nearestRoute(phys.pos.x, phys.pos.z, progIdx - 12, progIdx + 40);
    if (pd < 40) progIdx = Math.max(progIdx - 3, pi);
    if (mode === 'run') {
      timeLeft -= dt;
      if (nextCp < cpIdx.length && progIdx >= cpIdx[nextCp]) {
        nextCp++;
        if (nextCp === cpIdx.length) { finish('finish'); }
        else { timeLeft += 26; banner('+26s', '#38d6ff'); audio.chime(); gates[nextCp].userData.neon.emissive.setHex(0x40ff90); }
      }
      if (timeLeft <= 0 && state === 'play') { timeLeft = 0; finish('time'); }
      // wrong way
      const hd = routeHeadingAt(progIdx); const f = phys.forward;
      const dot = f.x * Math.sin(hd) + f.z * Math.cos(hd);
      wrongT = dot < -0.4 && phys.speed > 4 && !comboActive ? wrongT + dt : 0;
    } else wrongT = 0;
    $('#warn').classList.toggle('on', wrongT > 1.5);
    // stuck inside a wall -> auto reset
    if (grid.sdf(phys.pos.x, phys.pos.z) < -1.2) respawn();
  }

  cones.update(dt);
  updateCarVisual(dt);
  if (playing || state === 'countdown') updateCarFx(dt, inp);
  fx.update(dt);
  world.update(dt, phys.pos);
  updateCamera(dt);
  // flash gates
  for (const g of gates) if (g.visible) g.userData.neon.emissiveIntensity = 2.6 + Math.sin(now * 0.006) * 0.8;
  audio.update({ rpm: phys.rpm, throttle: inp.throttle * (phys.reverse ? 0 : 1) + (phys.reverse ? inp.brake : 0), slip: Math.max(0, (phys.rearSlip - 0.15) * 2) * Math.min(1, phys.speed / 5), speed: phys.speed, active: state === 'play' || state === 'countdown', limiter: phys.limiter });

  hudT -= dt;
  if ((playing || state === 'countdown') && hudT <= 0) { hudT = 1 / 30; updateHud(); }
  if (gradePass) { gradePass.uniforms.amount.value = THREE.MathUtils.lerp(gradePass.uniforms.amount.value, (phys.nitroOn ? 1 : 0) + Math.max(0, phys.speed - 30) / 40, 0.08); gradePass.uniforms.time.value = now * 0.001 % 100; }

  render(dt);

  // fps + dynamic resolution
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { if (settings.fps === '1') $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + (renderer.getPixelRatio()).toFixed(2) + 'x'; fpsAcc = 0; fpsN = 0; }
  dynAcc += dt; dynN++; dynT += dt;
  if (dynT > 2.5 && state === 'play') {
    const avg = dynAcc / dynN;
    let ns = dynScale;
    if (avg > 1 / 45 && dynScale > 0.55) ns = Math.max(0.55, dynScale * 0.85);
    else if (avg < 1 / 58 && dynScale < 1) ns = Math.min(1, dynScale * 1.08);
    if (Math.abs(ns - dynScale) > 0.01) { dynScale = ns; const pr = Math.min(devicePixelRatio || 1, Q.pr) * dynScale; renderer.setPixelRatio(pr); if (composer) composer.setPixelRatio(pr); onResize(); }
    dynT = 0; dynAcc = 0; dynN = 0;
  }
}

function handleEvents() {
  for (const e of phys.events) {
    if (e === 'shift') audio.shift();
    else if (e === 'backfire') { backfireT = 0.15; audio.backfire(); }
    else if (e.hit) {
      const s = Math.min(1, e.hit / 14);
      audio.impact(s); shake = Math.max(shake, 0.12 + s * 0.4);
      fx.sparks(e.at.x, phys.pos.y, e.at.z, e.at.nx, e.at.nz, phys.vel.x, phys.vel.y, 10 + Math.round(s * 20));
      if (e.hit > 3.2) failCombo('התנגשות');
      if (navigator.vibrate && isTouch) navigator.vibrate(Math.round(20 + s * 60));
    } else if (e.scrape) {
      if (Math.random() < 0.5) fx.sparks(e.at.x, phys.pos.y, e.at.z, e.at.nx, e.at.nz, phys.vel.x, phys.vel.y, 3);
    } else if (e.land) { shake = Math.max(shake, Math.min(0.4, e.land * 0.05)); audio.impact(Math.min(0.6, e.land / 15)); }
  }
  phys.events.length = 0;
}

function render() {
  if (composer) composer.render(); else renderer.render(scene, camera);
}

// ------------------------------------------------------------------ menus
function renderMapChips() {
  const el = $('#mapChips'); el.innerHTML = '';
  for (const M of Object.values(MAPS)) {
    const b = document.createElement('button'); b.className = 'chip' + (mapId === M.id ? ' on' : ''); b.textContent = M.name;
    b.onclick = () => switchMap(M.id); el.appendChild(b);
  }
}
function renderCarChips() {
  const el = $('#carChips'); if (!el) return; el.innerHTML = '';
  for (const C of Object.values(CARS)) {
    const b = document.createElement('button'); b.className = 'chip' + (settings.car === C.id ? ' on' : ''); b.innerHTML = `${C.name}<small> · ${C.info}</small>`;
    b.onclick = () => switchCar(C.id); el.appendChild(b);
  }
}
function renderTimeChips() {
  const el = $('#timeChips'); el.innerHTML = '';
  for (const [k, t] of Object.entries(TIMES)) {
    const b = document.createElement('button'); b.className = 'chip' + (settings.time === k ? ' on' : ''); b.textContent = t.name;
    b.onclick = () => setTime(k); el.appendChild(b);
  }
  document.querySelectorAll('#dirChips .chip').forEach(b => b.classList.toggle('on', +b.dataset.dir === +settings.dir));
}
function renderRecords() {
  const r = records, p = MAPS[mapId].rec;
  $('#records').innerHTML = `🏆 שיאים · ${MAPS[mapId].name}<br>ריצת דריפט: <b class="num">${fmt(r[p + 'run_fwd'] || 0)}</b> · הפוך: <b class="num">${fmt(r[p + 'run_rev'] || 0)}</b><br>נסיעה חופשית: <b class="num">${fmt(r[p + 'free'] || 0)}</b>`;
  $('#runSub').textContent = `${MAPS[mapId].km} ק״מ · נגד השעון · צבור נקודות`;
}
document.querySelectorAll('#dirChips .chip').forEach(b => b.onclick = () => {
  settings.dir = +b.dataset.dir; saveSettings(); renderTimeChips();
  prepareRoute(); placeShowroom(); cones.reset(); gates.forEach((g, k) => g.visible = k === 0);
});

function openSettings() {
  const m = $('#settingsModal'); m.classList.remove('hidden');
  m.querySelectorAll('.seg').forEach(seg => {
    const key = seg.dataset.set;
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', String(settings[key]) === b.dataset.v);
      b.onclick = async () => {
        settings[key] = b.dataset.v; saveSettings();
        if (key === 'quality') { dynScale = 1; setupPipeline(); }
        if (key === 'assist') phys.assist = +b.dataset.v;
        if (key === 'cam') camMode = +b.dataset.v;
        if (key === 'steer') { const ok = await input.enableTilt(b.dataset.v === 'tilt'); if (!ok && b.dataset.v === 'tilt') { settings.steer = 'buttons'; } toggleSteerButtons(); }
        if (key === 'autogas') input.autoGas = b.dataset.v === '1';
        if (key === 'fps') $('#fps').classList.toggle('hidden', b.dataset.v !== '1');
        openSettings();
      };
    });
  });
  const v = $('#vol'); v.value = settings.vol; v.oninput = () => { settings.vol = +v.value; audio.setVolume(settings.vol); saveSettings(); };
}
function toggleSteerButtons() { $('#tSteer').classList.toggle('hidden', settings.steer === 'tilt'); }

function openGarage() {
  $('#menu').classList.add('hidden');
  const m = $('#garageModal'); m.classList.remove('hidden');
  const mk = (el, list, key) => {
    el.innerHTML = '';
    for (const p of list) {
      const b = document.createElement('button'); b.className = 'sw' + (settings[key] === p.id ? ' on' : '');
      b.style.background = '#' + p.color.toString(16).padStart(6, '0'); b.title = p.name;
      b.onclick = () => { settings[key] = p.id; saveSettings(); applyGarage(); mk(el, list, key); if (key === 'smoke') smokeDemo = 1.5; };
      el.appendChild(b);
    }
  };
  mk($('#paintSw'), PAINTS, 'paint'); mk($('#smokeSw'), SMOKES, 'smoke'); renderCarChips();
}
let smokeDemo = 0;
setInterval(() => {
  if (smokeDemo > 0 && state === 'menu') {
    smokeDemo -= 0.05;
    const ch = Math.cos(phys.heading), sh = Math.sin(phys.heading);
    for (const s of [1, -1]) { const lz = car.info.axleR, lx = s * car.info.track / 2; fx.tyreSmoke(phys.pos.x + sh * lz + ch * lx, phys.pos.y, phys.pos.z + ch * lz - sh * lx, 0, 0, 0.8, 0.8); }
  }
  if (state === 'menu') fx.update(0.05);
}, 50);

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  audio.init();
  if (a === 'run') startGame('run');
  else if (a === 'free') startGame('free');
  else if (a === 'garage') openGarage();
  else if (a === 'settings') openSettings();
  else if (a === 'help') $('#helpModal').classList.remove('hidden');
  else if (a === 'closeHelp') $('#helpModal').classList.add('hidden');
  else if (a === 'closeSettings') $('#settingsModal').classList.add('hidden');
  else if (a === 'closeGarage') { $('#garageModal').classList.add('hidden'); $('#menu').classList.remove('hidden'); }
  else if (a === 'resume') resume();
  else if (a === 'restart') { hideAll(); startGame(mode); }
  else if (a === 'menu') showMenu();
});
$('#bPause').onclick = () => pause();
$('#bCam').onclick = () => onAction('camera');
$('#bReset').onclick = () => onAction('reset');
$('#rotateSkip').onclick = () => { $('#rotate').style.display = 'none'; document.body.classList.remove('playing'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); audio.ctx?.suspend(); } else audio.ctx?.resume(); });
if (settings.fps === '1') $('#fps').classList.remove('hidden');
toggleSteerButtons();
if (settings.steer === 'tilt') input.tilt = true;

boot().catch(e => {
  console.error(e);
  $('#loadErr').textContent = 'שגיאה בטעינה: ' + (e && e.message || e);
});
window.__game = { camera, teleport(i, v = 20) { const [x, z] = route[i]; phys.place(x, z, routeHeadingAt(i)); const h = phys.heading; phys.vel.set(Math.sin(h) * v, Math.cos(h) * v); phys.gear = v > 25 ? 3 : 2; progIdx = i; snapCamera(); }, get phys() { return phys; }, get state() { return state; }, get countdown() { return countdown; }, get car() { return car; }, input, startGame, settings, setTime, get route() { return route; } };
