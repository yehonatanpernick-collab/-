import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as TR from './terrain.js';
import { Vehicle, GRAVITY, CFG } from './physics.js';
import * as W from './world.js';
import { loadCar, syncCar } from './car.js';
import { loadMaverick } from './car3.js';
import { loadRig, RIG_SPECS } from './rigs.js';
import { Particles, Skids } from './fx.js';
import { GameAudio } from './audio.js';
import { Input, ACTIONS, keyLabel } from './input.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('dunedrift.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dunedrift.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtTime = (s) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
};

// ---------------------------------------------------------------- renderer
let quality = store.get('quality', matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 3000);
scene.fog = new THREE.Fog(0xcdc3b1, 320, 1900);

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(-140));
W.buildSky(scene, renderer, sunDir);
scene.environmentIntensity = 0.45;
const sun = new THREE.DirectionalLight(0xffdcb4, 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 320;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xc4d8ff, 0x9a7650, 0.42));

// colour grade: gentle filmic contrast, warm highlights, slight vignette (works in linear HDR)
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.1);                    // saturation
      c.rgb *= mix(vec3(0.97, 0.99, 1.04), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l)); // cool shadows, warm lights
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};
let composer = null, bloom = null;
let terrainMesh = null;
function applyQuality() {
  const hi = quality === 'high';
  const dpr = Math.min(devicePixelRatio, hi ? 1.5 : 1.0);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  const ms = hi ? 4096 : 1536;
  sun.shadow.mapSize.set(ms, ms);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (terrainMesh) terrainMesh.castShadow = hi;
  if (hi) {
    const rt = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(dpr);
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.6, 0.95);
    composer.addPass(bloom);
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
  } else composer = null;
  const qb = $('#q-btn'); if (qb) qb.textContent = hi ? 'גבוהה' : 'חסכונית';
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- world
const loadBar = $('#load-bar');
const setLoad = (p, msg) => { loadBar.style.width = (p * 100).toFixed(0) + '%'; if (msg) $('#load-msg').textContent = msg; };
setLoad(0.05, 'בונים את המדבר…');
await new Promise(r => setTimeout(r, 30));
TR.initWorld();
const T = W.makeTextures();
terrainMesh = W.buildTerrain(T);
scene.add(terrainMesh);
scene.add(W.buildArena(T));
scene.add(W.buildRamps(T));
scene.add(W.buildTracks(T));
scene.add(W.buildDriftLot());
const water = W.buildWater(T); scene.add(water);
const sceneryGroup = W.buildScenery(); scene.add(sceneryGroup);
const vegetation = W.buildVegetation(T); scene.add(vegetation);
const trampGroup = W.buildTrampolines(); scene.add(trampGroup);
const turnGroup = W.buildTurntables(); scene.add(turnGroup);
const clouds = W.buildClouds(sunDir); scene.add(clouds);
const props = W.propLayout(); scene.add(W.buildPropMeshes(props));
setLoad(0.25, 'מביאים את הבאגי…');

const particles = new Particles(scene, T.soft, 5000);
particles.mat.uniforms.fogColor.value.copy(scene.fog.color);
particles.mat.uniforms.fogNear.value = scene.fog.near;
particles.mat.uniforms.fogFar.value = scene.fog.far;
const skids = new Skids(scene, 7000);

// ---------------------------------------------------------------- car
let car;
try {
  car = await loadCar(window.DUNE_MODEL_URL || 'assets/rzr.glb', p => setLoad(0.25 + p * 0.7));
} catch (e) {
  $('#load-msg').textContent = 'שגיאה בטעינת הדגם: ' + e.message;
  throw e;
}
const CARS = [
  { id: 'rzr', name: 'Polaris RZR', sub: 'הבאגי הקלאסי: יציב ומאוזן', tune: { engine: 1, maxSpeed: 1 } },
  { id: 'maverick', name: 'Can-Am Maverick', sub: 'חזק, רחב ומהיר', tune: { engine: 1.12, maxSpeed: 1.07 }, load: () => loadMaverick(window.DUNE_MAV_URL || 'assets/maverick.glb') },
  { id: 'jeep', name: "ג'יפ רוביקון", sub: 'שטח קלאסי, אחיזה מצוינת', load: () => loadRig({ ...RIG_SPECS.jeep, url: window.DUNE_JEEP_URL || RIG_SPECS.jeep.url }) },
  { id: 'bike', name: 'אופנוע שטח', sub: 'קל, זריז ונוטה בסיבובים', load: () => loadRig({ ...RIG_SPECS.bike, url: window.DUNE_BIKE_URL || RIG_SPECS.bike.url }) },
  { id: 'quad', name: 'טרקטורון קטן', sub: 'קטן וחמוד, כיף בדריפטים', load: () => loadRig({ ...RIG_SPECS.quad, url: window.DUNE_QUAD_URL || RIG_SPECS.quad.url }) },
  { id: 'monster', name: 'מונסטר טראק', sub: 'גלגלי ענק, עובר על הכל', load: () => loadRig({ ...RIG_SPECS.monster, url: window.DUNE_MONSTER_URL || RIG_SPECS.monster.url }) },
];
const cars = { rzr: car };
car.spec = { wheelR: 0.375, halfTrack: 0.70, halfBase: 1.14 }; car.paintable = true;
const BASE = { engine: CFG.engine, maxSpeed: CFG.maxSpeed, boostSpeed: CFG.boostSpeed };
let carId = 'rzr', wantCar = 'rzr';
scene.add(car.root);
let veh;                                   // created below
async function selectCar(id) {
  const def = CARS.find(c => c.id === id); if (!def) return;
  wantCar = id; store.set('car', id);
  markCars();
  if (!cars[id]) {
    markCars(id);
    try {
      const c = await def.load();
      if (!c.spec) c.spec = { wheelR: 0.375, halfTrack: 0.70, halfBase: 1.14 };
      if (c.paintable === undefined) c.paintable = true;
      cars[id] = c; scene.add(c.root);
    } catch (e) { console.warn('car load failed', id, e); wantCar = carId; markCars(); return; }
  }
  if (wantCar !== id) return;                       // user picked another one meanwhile
  carId = id; car = cars[id];
  for (const k in cars) cars[k].root.visible = k === id;
  const t = def.tune || car.spec.tune || { engine: 1, maxSpeed: 1 };
  Object.assign(CFG, { engine: BASE.engine * (t.engine || 1), maxSpeed: BASE.maxSpeed * (t.maxSpeed || 1), boostSpeed: BASE.boostSpeed * (t.maxSpeed || 1) });
  if (veh) veh.applySpec(car.spec);
  const pc = store.get('paint_' + id, null); if (pc && car.paintable) car.setPaint(pc);
  markCars(); if (markPaint) markPaint();
}
function markCars(loading) {
  document.querySelectorAll('[data-car]').forEach(b => {
    b.classList.toggle('sel', b.dataset.car === wantCar);
    b.classList.toggle('loading', b.dataset.car === loading);
  });
}
function buildCarCards() {
  const html = CARS.map(c => `<button class="mode-card car-card" data-car="${c.id}"><b>${c.name}</b><span>${c.sub}</span></button>`).join('');
  document.querySelectorAll('.car-grid').forEach(g => {
    g.innerHTML = html;
    g.addEventListener('click', (e) => { const b = e.target.closest('[data-car]'); if (b) selectCar(b.dataset.car); });
  });
}
const PAINTS = [
  { c: '#c8102e', n: 'אדום' }, { c: '#f2a900', n: 'צהוב' }, { c: '#1e6fd9', n: 'כחול' },
  { c: '#2a2a2e', n: 'שחור' }, { c: '#f2f2f2', n: 'לבן' }, { c: '#2bb34a', n: 'ירוק' },
];
let paint = null;
let markPaint = null;
veh = new Vehicle();
veh.reset(TR.SPAWN.x, TR.SPAWN.z, TR.SPAWN.yaw);
buildCarCards();
setLoad(1, 'מוכן!');
selectCar(store.get('car', 'rzr'));

const audio = new GameAudio();
audio.muted = store.get('muted', false);
const input = new Input(store.get('keys', null));
input.bindTouch($('#touch'));

// ---------------------------------------------------------------- game state
const G = {
  state: 'menu',
  score: 0,
  best: store.get('best', 0),
  chain: { pts: 0, time: 0, idle: 0, active: false, mult: 1 },
  nitro: 1,
  air: { t: 0, pitch: 0, yaw: 0, roll: 0, vy: 0 },
  mode: store.get('mode', 'normal'),
  wheelie: { kind: 0, t: 0 },
  knocked: 0,
  camMode: 0,
  flipT: 0,
  shake: 0,
  speedKmh: 0,
};

// ---------------------------------------------------------------- HUD helpers
const popups = $('#popups');
function popup(text, cls = '', sub = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
  popups.appendChild(el);
  while (popups.children.length > 5) popups.firstChild.remove();
  setTimeout(() => el.remove(), 1900);
}
let toastTimer = 0;
function toast(html) {
  const t = $('#toast');
  t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function addScore(p) {
  G.score += p;
  if (G.score > G.best) { G.best = G.score; store.set('best', Math.round(G.best)); }
}

// ---------------------------------------------------------------- chain / tricks
function chainAdd(p) {
  const c = G.chain;
  if (!c.active) { c.active = true; c.time = 0; c.pts = 0; c.mult = 1; }
  c.pts += p; c.idle = 0;
}
function bankChain() {
  const c = G.chain;
  if (!c.active) return;
  const total = c.pts * c.mult;
  if (total > 50) {
    addScore(total);
    popup('+' + fmt(total), 'bank', c.mult > 1 ? `x${c.mult} קומבו` : '');
    audio.bank();
    G.nitro = Math.min(1, G.nitro + Math.min(0.3, total / 20000));
  }
  c.active = false; c.pts = 0; c.time = 0; c.mult = 1;
}
function loseChain(reason) {
  if (G.chain.active && G.chain.pts > 100) popup(reason, 'bad', 'הניקוד בשרשרת אבד');
  G.chain.active = false; G.chain.pts = 0; G.chain.time = 0; G.chain.mult = 1;
}

const _qi = new THREE.Quaternion(), _wl = new THREE.Vector3();
function airTrack(dt) {
  const A = G.air;
  if (veh.grounded === 0) {
    if (A.t === 0) { A.pitch = A.yaw = A.roll = 0; A.x0 = veh.pos.x; A.z0 = veh.pos.z; A.y0 = veh.pos.y; A.maxY = veh.pos.y; }
    A.t += dt;
    if (veh.pos.y > A.maxY) A.maxY = veh.pos.y;
    _qi.copy(veh.q).invert();
    _wl.copy(veh.w).applyQuaternion(_qi);
    A.pitch += _wl.x * dt; A.yaw += _wl.y * dt; A.roll += _wl.z * dt;
    A.vy = veh.vel.y;
    return;
  }
  if (A.t > 0) {
    const t = A.t; A.t = 0;
    const TWO = Math.PI * 2;
    const flips = Math.floor((Math.abs(A.pitch) + 0.9) / TWO);
    const spins = Math.floor((Math.abs(A.yaw) + 0.9) / TWO);
    const rolls = Math.floor((Math.abs(A.roll) + 0.9) / TWO);
    const impactV = -A.vy;
    const dist = Math.hypot(veh.pos.x - A.x0, veh.pos.z - A.z0);
    const height = Math.max(0, A.maxY - Math.max(A.y0, veh.pos.y));
    if (impactV > 5) {
      audio.thump(Math.min(1.2, impactV / 14));
      G.shake = Math.max(G.shake, Math.min(0.8, impactV / 22));
      burst(veh.pos.x, veh.pos.y - 0.4, veh.pos.z, 28, [0.85, 0.72, 0.55]);
    }
    if (t < 0.45 && !flips && !spins && !rolls) return;
    if (veh.up.y < 0.45) { loseChain('נחיתה הפוכה!'); audio.crash(0.8); return; }
    let pts = 0;
    const names = [];
    if (t > 0.7) { const p = Math.round(t * 260); pts += p; }
    if (flips) {
      const back = A.pitch < 0;
      names.push((back ? 'סלטה אחורית' : 'סלטה קדמית') + (flips > 1 ? ` x${flips}` : ''));
      pts += 1500 * flips;
    }
    if (spins) { names.push(`${spins * 360}°`); pts += 800 * spins; }
    if (rolls) { names.push('גלגול חבית' + (rolls > 1 ? ` x${rolls}` : '')); pts += 1200 * rolls; }
    if (dist > 30) pts += Math.round((dist - 30) * 8);          // distance bonus
    if (height > 5) pts += Math.round((height - 5) * 70);      // height bonus
    if (pts === 0) return;
    const clean = veh.up.y > 0.93 && Math.abs(veh.slipAngle) < 0.35;
    if (clean && (names.length || t > 1.2)) { pts += 250; }
    chainAdd(pts);
    G.nitro = Math.min(1, G.nitro + t * 0.08);
    const head = names.length ? names.join(' + ') : (dist > 100 || t > 3.2 ? 'קפיצת ענק!' : t > 2 ? 'אוויר ענק!' : 'קפיצה!');
    popup(head, names.length ? 'trick' : 'air', `${t.toFixed(1)} שנ' · ${Math.round(dist)} מ' · גובה ${Math.round(height)} מ' · +${fmt(pts)}${clean ? ' · נקי' : ''}`);
    if (names.length) audio.trick();
  }
}

// ---------------------------------------------------------------- particles helpers
function burst(x, y, z, n, c, spd = 4) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random());
    particles.emit(x, y, z, Math.cos(a) * s, Math.random() * 2.5, Math.sin(a) * s, c[0], c[1], c[2], 1.2 + Math.random(), 1.4 + Math.random(), { grow: 2.2, alpha: 0.5 });
  }
}
function sparkle(x, y, z) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
    particles.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 1, 0.85, 0.3, 0.35, 0.7, { grow: -0.3, grav: -9, alpha: 1, drag: 1 });
  }
}

const emitAcc = [0, 0, 0, 0, 0, 0, 0, 0];
const _side = new THREE.Vector3();
function wheelFx(dt, inp) {
  const sp = veh.speed;
  _side.copy(veh.left);
  for (let i = 0; i < 4; i++) {
    const wh = veh.wheels[i];
    if (!wh.contact) { skids.break(i); continue; }
    const p = wh.point;
    const surf = wh.surface === 'terrain' ? TR.surfaceAt(p.x, p.z) : 'ramp';
    const slide = Math.max(wh.slipLat, wh.slipLong, (!wh.front && inp.handbrake && Math.abs(wh.vLong) > 2) ? 0.8 : 0, veh.drifting && !wh.front ? 0.8 : 0);
    const spf = Math.min(1, Math.abs(wh.vLong) / 25);
    const wet = p.y < TR.waterAt(p.x, p.z) + 0.05;
    let rate = 0, col, size = 0.9, life = 1.6, grow = 2.4, alpha = 0.45, up = 1.2;
    if (wet) {
      rate = sp > 2 ? 30 + sp * 3 : 0; col = [0.85, 0.93, 1.0]; size = 0.5; life = 0.9; grow = 1.2; alpha = 0.7; up = 3.5;
    } else if (surf === 'sand' || surf === 'dirt') {
      rate = slide * 55 + spf * (wh.front ? 5 : 14);
      col = surf === 'sand' ? [0.86, 0.72, 0.53] : [0.72, 0.56, 0.4];
    } else if (surf === 'asphalt' || surf === 'ramp') {
      rate = slide > 0.2 ? slide * 50 : 0; col = [0.82, 0.82, 0.84]; size = 1.1; life = 2.4; grow = 3.2; alpha = 0.32; up = 0.8;
    }
    emitAcc[i] += rate * dt;
    while (emitAcc[i] >= 1) {
      emitAcc[i] -= 1;
      const j = () => (Math.random() - 0.5);
      particles.emit(p.x + j() * 0.4, p.y + 0.15, p.z + j() * 0.4,
        -veh.vel.x * 0.12 + j() * 2.5, up * (0.5 + Math.random()) + (wet ? 1.5 : 0), -veh.vel.z * 0.12 + j() * 2.5,
        col[0] * (0.92 + Math.random() * 0.1), col[1] * (0.92 + Math.random() * 0.1), col[2] * (0.92 + Math.random() * 0.1),
        size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6), { grow, alpha, grav: wet ? -9 : -0.3 });
    }
    // tracks
    if (wet) { skids.break(i); continue; }
    if (surf === 'sand' || surf === 'dirt') {
      skids.add(i, p, _side, 0.14, [0.42, 0.31, 0.2, 0.22 + slide * 0.3]);
    } else if (slide > 0.3) {
      skids.add(i, p, _side, 0.13, [0.03, 0.03, 0.03, Math.min(0.75, 0.25 + slide * 0.6)]);
    } else skids.break(i);
  }
}

// ---------------------------------------------------------------- props
const _rel = new THREE.Vector3(), _pv = new THREE.Vector3();
const gq = { n: { x: 0, y: 1, z: 0 } };
function updateProps(dt) {
  _qi.copy(veh.q).invert();
  for (const p of props) {
    // collide with the buggy
    _rel.copy(p.pos).y += p.h * 0.5;
    _rel.sub(veh.pos);
    if (_rel.lengthSq() < 9) {
      _rel.applyQuaternion(_qi);
      if (Math.abs(_rel.x) < 0.85 + p.r && Math.abs(_rel.z) < 1.5 + p.r && _rel.y > -0.9 && _rel.y < 1.5) {
        const sp = veh.speed;
        if (sp > 1.5 && (p.sleep || p.vel.lengthSq() < sp * sp * 0.5)) {
          _pv.copy(p.pos).sub(veh.pos); _pv.y = 0; _pv.normalize();
          p.vel.copy(veh.vel).multiplyScalar(1.15).addScaledVector(_pv, 2 + sp * 0.15);
          p.vel.y = 2.5 + sp * 0.18 + Math.random() * 2;
          p.w.set((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp);
          p.sleep = false; p.lie = null; p.awayT = 0;
          veh.vel.multiplyScalar(1 - 0.006 * p.mass);
          if (!p.knocked) {
            p.knocked = true; G.knocked++;
            addScore(50); chainAdd(80);
            audio.pop();
          }
        }
      }
    }
    if (p.sleep) continue;
    p.vel.y -= GRAVITY * dt;
    p.pos.addScaledVector(p.vel, dt);
    const dq = new THREE.Quaternion(p.w.x * dt * 0.5, p.w.y * dt * 0.5, p.w.z * dt * 0.5, 0).multiply(p.q);
    p.q.x += dq.x; p.q.y += dq.y; p.q.z += dq.z; p.q.w += dq.w; p.q.normalize();
    const gy = TR.groundQuery(p.pos.x, p.pos.z, p.pos.y + 0.6, gq);
    if (p.pos.y < gy) {
      p.pos.y = gy;
      if (p.vel.y < 0) p.vel.y *= -0.3;
      p.vel.x *= 0.75; p.vel.z *= 0.75; p.w.multiplyScalar(0.7);
      if (p.vel.lengthSq() < 0.6) {
        p.sleep = true; p.vel.set(0, 0, 0);
        // settle lying on its side
        const yaw = Math.random() * Math.PI * 2;
        p.q.setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'));
        p.pos.y = gy + p.r * 0.85;
      }
    }
  }
}
function propsVisual(dt) {
  for (const p of props) {
    if (p.knocked && p.sleep) {
      p.awayT = (p.awayT || 0) + (p.pos.distanceTo(veh.pos) > 120 ? dt : 0);
      if (p.awayT > 20) { p.pos.copy(p.home); p.q.identity(); p.knocked = false; p.awayT = 0; }
    }
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.copy(p.q);
  }
}

// ---------------------------------------------------------------- race tracks: lap timing
G.lap = { track: null, last: -1, running: false, t: 0, count: 0, sectors: 0 };
G.lapBest = store.get('lapBest', {});
function lapCheck(dt) {
  const L = G.lap;
  if (L.running) L.t += dt;
  const q = TR.trackNearest(veh.pos.x, veh.pos.z);
  if (!q.track || q.d > q.track.hw + 6) {
    if (L.track && q.d > 60) { L.track = null; L.running = false; }
    return;
  }
  const tr = q.track, i = q.i, n = tr.n;
  if (tr.road) { L.track = null; L.running = false; return; }
  if (L.track !== tr) { L.track = tr; L.last = i; L.running = false; L.count = 0; L.sectors = 0; return; }
  const prev = L.last;
  L.last = i;
  const fwd = (i - prev + n) % n;
  if (fwd === 0 || fwd > 20) return;                    // standing still or going backwards
  for (let g = 1; g < tr.gates.length; g++) {
    const gi = tr.gates[g];
    if ((gi - prev + n) % n > 0 && (gi - prev + n) % n <= fwd) L.sectors |= 1 << g;
  }
  const crossedStart = prev > i;                          // index wrapped around: start line
  if (!crossedStart) return;
  if (L.running && L.sectors === 0b110) {
    const time = L.t;
    const best = G.lapBest[tr.id];
    const rec = best == null || time < best;
    if (rec) { G.lapBest[tr.id] = time; store.set('lapBest', G.lapBest); }
    popup(`הקפה ${fmtTime(time)}`, 'trial', rec ? 'שיא הקפה חדש! 🏁' : `השיא: ${fmtTime(best)}`);
    addScore(Math.max(500, Math.round(15000 - time * 80)));
    audio.finish();
    L.count++;
  } else if (!L.running) {
    popup(tr.name, 'trial', 'ההקפה התחילה · עבור את קו הזינוק שוב לסיום');
    audio.checkpoint();
  }
  L.running = true; L.t = 0; L.sectors = 0;
}

// ---------------------------------------------------------------- areas
let zoneNow = null, zoneT = 0;
function zoneCheck(dt) {
  zoneT -= dt;
  if (zoneT > 0) return;
  zoneT = 0.4;
  const z = TR.ZONES.find(z => z.inside(veh.pos.x, veh.pos.z)) || null;
  if (z && z !== zoneNow) showZone(z);
  zoneNow = z;
}
function showZone(z) {
  const el = $('#zone');
  el.innerHTML = `<b>${z.name}</b><span>${z.sub}</span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function teleport(z) {
  veh.reset(z.x, z.z, z.yaw);
  for (let i = 0; i < 4; i++) skids.break(i);
  cam.dir.set(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  cam.pos.copy(veh.pos).addScaledVector(cam.dir, -6.6).y += 2.3;
  G.lap.track = null; G.lap.running = false;
  G.chain.active = false; G.chain.pts = 0;
  zoneNow = null; zoneT = 0;
}
function buildTravel() {
  $('#travel').innerHTML = TR.ZONES.map((z, i) => `<button class="btn travel" data-i="${i}"><b>${z.name}</b><span>${z.sub}</span></button>`).join('');
  $('#travel').addEventListener('click', (e) => {
    const b = e.target.closest('.travel'); if (!b) return;
    teleport(TR.ZONES[+b.dataset.i]);
    pause(false);
  });
}

// ---------------------------------------------------------------- reset
function resetCar(toSpawn = false) {
  if (toSpawn) veh.reset(TR.SPAWN.x, TR.SPAWN.z, TR.SPAWN.yaw);
  else {
    const f = veh.fwd.clone(); f.y = 0;
    const yaw = f.lengthSq() > 0.01 ? Math.atan2(f.x, f.z) : 0;
    veh.reset(veh.pos.x, veh.pos.z, yaw);
  }
  for (let i = 0; i < 4; i++) skids.break(i);
  cam.dir.copy(veh.fwd).setY(0).normalize();
  cam.pos.copy(veh.pos).addScaledVector(cam.dir, -6.6).y += 2.3;
  G.flipT = 0;
  G.air.t = 0;
  loseChain('איפוס');
}

// ---------------------------------------------------------------- camera
const cam = { pos: new THREE.Vector3(0, 6, 110), dir: new THREE.Vector3(0, 0, -1), look: new THREE.Vector3(), fov: 62, orbit: 0 };
const CAMS = [{ d: 6.6, h: 2.25, l: 1.05 }, { d: 10.5, h: 3.8, l: 1.3 }, null];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function updateCamera(dt) {
  if (G.photo) {                                  // free camera used for screenshots
    camera.position.copy(G.photo.pos); camera.lookAt(G.photo.look);
    camera.fov = G.photo.fov || 55; camera.updateProjectionMatrix(); return;
  }
  if (G.state === 'menu') {
    cam.orbit += dt * 0.18;
    const r = 7.5;
    _v.set(veh.pos.x + Math.sin(cam.orbit) * r, veh.pos.y + 1.6, veh.pos.z + Math.cos(cam.orbit) * r);
    camera.position.copy(_v);
    camera.lookAt(veh.pos.x, veh.pos.y + 0.2, veh.pos.z);
    camera.fov = 50; camera.updateProjectionMatrix();
    cam.pos.copy(_v);
    return;
  }
  const sp = veh.speed;
  if (G.camMode === 2) {
    _v.set(0.33, 1.42 - 0.55, -0.15).applyQuaternion(veh.q).add(veh.pos);
    camera.position.copy(_v);
    _v2.set(0, 0.9 - 0.55, 12).applyQuaternion(veh.q).add(veh.pos);
    camera.up.copy(veh.up);
    camera.lookAt(_v2);
    camera.up.set(0, 1, 0);
    cam.pos.copy(_v);
  } else {
    const C = CAMS[G.camMode];
    // teleported (reset): snap behind the buggy
    if (cam.pos.distanceToSquared(veh.pos) > 40 * 40) {
      cam.dir.copy(veh.fwd).setY(0).normalize();
      cam.pos.copy(veh.pos).addScaledVector(cam.dir, -C.d).y += C.h;
    }
    // desired heading: blend of car heading and travel direction
    _v.copy(veh.fwd); _v.y = 0;
    if (_v.lengthSq() < 0.05) _v.copy(cam.dir); _v.normalize();
    _v2.copy(veh.vel); _v2.y = 0;
    if (veh.grounded >= 2) {
      if (_v2.lengthSq() > 16 && veh.forwardSpeed > 2) _v.lerp(_v2.normalize(), 0.42).normalize();
    } else {
      _v.copy(_v2.lengthSq() > 9 ? _v2.normalize() : cam.dir);
    }
    cam.dir.lerp(_v, 1 - Math.exp(-dt * (veh.grounded ? 4.2 : 1.5))).normalize();
    const d = C.d + Math.min(sp, 45) * 0.045;
    _v.copy(veh.pos).addScaledVector(cam.dir, -d);
    _v.y = veh.pos.y + C.h + Math.min(sp, 40) * 0.012;
    const k = 1 - Math.exp(-dt * 9);
    cam.pos.x += (_v.x - cam.pos.x) * k;
    cam.pos.z += (_v.z - cam.pos.z) * k;
    cam.pos.y += (_v.y - cam.pos.y) * (1 - Math.exp(-dt * (veh.grounded ? 6 : 3.5)));
    const gy = Math.max(TR.groundQuery(cam.pos.x, cam.pos.z, cam.pos.y + 0.5, gq), TR.waterAt(cam.pos.x, cam.pos.z)) + 0.9;
    if (cam.pos.y < gy) cam.pos.y = gy;
    camera.position.copy(cam.pos);
    if (G.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * G.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * G.shake * 0.6;
    }
    cam.look.copy(veh.pos).addScaledVector(cam.dir, 2.5);
    cam.look.y += C.l;
    camera.lookAt(cam.look);
  }
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const fovT = 62 + Math.min(sp * 3.6, 170) * 0.1 + (veh.boostActive ? 9 : 0);
  cam.fov += (fovT - cam.fov) * (1 - Math.exp(-dt * 3));
  camera.fov = G.camMode === 2 ? cam.fov + 6 : cam.fov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- HUD drawing
const gauge = $('#gauge'), gctx = gauge.getContext('2d');
const mapC = $('#minimap'), mctx = mapC.getContext('2d');
const mapBg = document.createElement('canvas');
function sizeCanvases() {
  const dpr = Math.min(devicePixelRatio, 2);
  for (const c of [gauge, mapC]) {
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  }
  drawMapBg();
}
const MB = 1024 / TR.WORLD;          // minimap background: px per metre
let mapBgDone = false;
function drawMapBg() {
  if (mapBgDone) return;
  mapBgDone = true;
  const w = 1024, h = 1024;
  mapBg.width = w; mapBg.height = h;
  const c = mapBg.getContext('2d');
  const S = MB;
  const P = (x, z) => [(x + TR.HALF) * S, (z + TR.HALF) * S];
  const img = c.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = i / S - TR.HALF, z = j / S - TR.HALF;
    const hh = TR.terrainHeight(x, z);
    const hx = TR.terrainHeight(x + 3, z) - hh;
    const sh = Math.max(-1, Math.min(1, hx * 0.35));
    let r = 196, g = 160, b = 112;
    if (hh > 14) { r = 150; g = 112; b = 82; }
    if (hh < TR.WATER_LEVEL && Math.hypot(x - TR.LAKE.x, z - TR.LAKE.z) < TR.LAKE.r) { r = 50; g = 140; b = 160; }
    const k = (i + j * w) * 4;
    img.data[k] = r + sh * 40; img.data[k + 1] = g + sh * 36; img.data[k + 2] = b + sh * 30; img.data[k + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  c.fillStyle = 'rgba(60,60,64,0.9)';
  c.beginPath(); c.arc(...P(TR.ARENA.x, TR.ARENA.z), TR.ARENA.r * S, 0, Math.PI * 2); c.fill();
  const rect = (R, col) => { c.fillStyle = col; c.fillRect(...P(R.x0, R.z0), (R.x1 - R.x0) * S, (R.z1 - R.z0) * S); };
  rect(TR.PARK, 'rgba(150,110,75,0.75)');
  rect(TR.STUNT, 'rgba(150,110,75,0.75)');
  rect(TR.MEGA, 'rgba(150,110,75,0.75)');
  rect(TR.NSTUNT, 'rgba(150,110,75,0.75)');
  rect(TR.SPECIAL, 'rgba(150,110,75,0.75)');
  c.fillStyle = '#ffd23a'; for (const t of TR.trampolines) { c.beginPath(); c.arc(...P(t.x, t.z), Math.max(2, t.r * S * 1.3), 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#d62a1e'; for (const t of TR.turntables) { c.beginPath(); c.arc(...P(t.x, t.z), Math.max(2, t.r * S), 0, Math.PI * 2); c.fill(); }
  c.fillStyle = 'rgba(60,30,25,0.95)'; c.fillRect(...P(TR.CANYON.x0 - 10, TR.CANYON.cz - 20), (TR.CANYON.x1 - TR.CANYON.x0 + 20) * S, 40 * S);
  rect(TR.DRIFTLOT, 'rgba(60,60,64,0.9)');
  c.fillStyle = 'rgba(230,230,225,0.85)';
  c.beginPath(); c.arc(...P(TR.BOWL.x, TR.BOWL.z), TR.BOWL.r * S, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(225,225,220,0.85)';
  c.fillRect(...P(TR.HALFPIPE.x - TR.HALFPIPE.w, TR.HALFPIPE.z0), TR.HALFPIPE.w * 2 * S, (TR.HALFPIPE.z1 - TR.HALFPIPE.z0) * S);
  c.fillStyle = '#ff7a2a';
  for (const col of TR.colliders) c.fillRect(...P(col.minX, col.minZ), Math.max(1, (col.maxX - col.minX) * S), Math.max(1, (col.maxZ - col.minZ) * S));
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,240,210,0.55)'; c.lineWidth = Math.max(1.5, 6 * S);
  c.beginPath();
  TR.ROUTE.forEach((p, i) => i ? c.lineTo(...P(p.x, p.z)) : c.moveTo(...P(p.x, p.z)));
  c.closePath(); c.stroke();
  for (const r of TR.ROADS) { c.beginPath(); r.forEach((p, i) => i ? c.lineTo(...P(p[0], p[1])) : c.moveTo(...P(p[0], p[1]))); c.stroke(); }
  for (const tr of TR.TRACKS) {
    c.strokeStyle = tr.surface === 'asphalt' ? '#2b2b30' : '#7a5232';
    c.lineWidth = tr.hw * 2 * S;
    c.beginPath(); tr.pts.forEach((p, i) => i ? c.lineTo(...P(p.x, p.z)) : c.moveTo(...P(p.x, p.z))); c.closePath(); c.stroke();
  }
}
function drawMap(t) {
  const w = mapC.width, h = mapC.height;
  mctx.clearRect(0, 0, w, h);
  mctx.save();
  mctx.beginPath(); mctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); mctx.clip();
  // centred on the buggy, heading-up, ~230 m radius
  const ppm = (w / 2) / 230;
  const k = ppm / MB;
  const yaw = Math.atan2(cam.dir.x, cam.dir.z);
  mctx.translate(w / 2, h / 2);
  mctx.rotate(yaw + Math.PI);
  mctx.scale(k, k);
  mctx.translate(-(veh.pos.x + TR.HALF) * MB, -(veh.pos.z + TR.HALF) * MB);
  mctx.drawImage(mapBg, 0, 0);
  const P = (x, z) => [(x + TR.HALF) * MB, (z + TR.HALF) * MB];
  mctx.restore();
  // buggy marker (always centre, pointing up relative to camera)
  mctx.save();
  mctx.translate(w / 2, h / 2);
  const carYaw = Math.atan2(veh.fwd.x, veh.fwd.z);
  mctx.rotate(-(carYaw - yaw));
  const u = w / 170;
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5 * u;
  mctx.beginPath(); mctx.moveTo(0, -8 * u); mctx.lineTo(5.5 * u, 6 * u); mctx.lineTo(0, 3 * u); mctx.lineTo(-5.5 * u, 6 * u); mctx.closePath();
  mctx.fill(); mctx.stroke();
  mctx.restore();
  // ring
  mctx.strokeStyle = 'rgba(255,255,255,0.35)'; mctx.lineWidth = 2 * u;
  mctx.beginPath(); mctx.arc(w / 2, h / 2, w / 2 - 1.5 * u, 0, Math.PI * 2); mctx.stroke();
  // north marker
  mctx.save(); mctx.translate(w / 2, h / 2); mctx.rotate(yaw + Math.PI);
  mctx.fillStyle = '#ff5a3c'; mctx.font = `800 ${11 * u}px Rubik, sans-serif`; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  mctx.fillText('N', 0, -(w / 2 - 11 * u));
  mctx.restore();
}
function drawGauge() {
  const w = gauge.width, h = gauge.height, u = w / 200;
  const c = gctx;
  c.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 + 8 * u, R = 80 * u;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const kmh = Math.abs(G.speedKmh);
  const f = Math.min(1, kmh / 180);
  c.lineCap = 'round';
  // track
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 10 * u;
  c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
  // ticks
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2 * u;
  for (let i = 0; i <= 9; i++) {
    const a = a0 + (a1 - a0) * i / 9;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 16 * u), cy + Math.sin(a) * (R - 16 * u));
    c.lineTo(cx + Math.cos(a) * (R - 22 * u), cy + Math.sin(a) * (R - 22 * u)); c.stroke();
  }
  // speed arc
  const grd = c.createLinearGradient(cx - R, 0, cx + R, 0);
  grd.addColorStop(0, '#ffd23a'); grd.addColorStop(0.6, '#ff8a1f'); grd.addColorStop(1, '#ff2d55');
  c.strokeStyle = grd; c.lineWidth = 10 * u;
  if (f > 0.002) { c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * f); c.stroke(); }
  // nitro arc (inner)
  c.strokeStyle = 'rgba(40,240,255,0.15)'; c.lineWidth = 6 * u;
  c.beginPath(); c.arc(cx, cy, R - 32 * u, a0, a1); c.stroke();
  c.strokeStyle = veh.boostActive ? '#bff8ff' : '#28f0ff'; c.shadowColor = '#28f0ff'; c.shadowBlur = veh.boostActive ? 14 * u : 6 * u;
  if (G.nitro > 0.002) { c.beginPath(); c.arc(cx, cy, R - 32 * u, a0, a0 + (a1 - a0) * G.nitro); c.stroke(); }
  c.shadowBlur = 0;
  // number
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 ${46 * u}px Rubik, sans-serif`;
  c.fillText(Math.round(kmh), cx, cy - 4 * u);
  c.font = `600 ${12 * u}px Rubik, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillText('קמ"ש', cx, cy + 26 * u);
  c.font = `800 ${16 * u}px Rubik, sans-serif`; c.fillStyle = '#ffd23a';
  c.fillText(veh.gear || '1', cx, cy + 58 * u);
  c.font = `600 ${10 * u}px Rubik, sans-serif`; c.fillStyle = '#28f0ff';
  c.fillText('NITRO', cx, cy - 40 * u);
}

const hud = {
  score: $('#score'), best: $('#best'), trial: $('#trial'), trialT: $('#trial-t'), trialSub: $('#trial-sub'),
  chain: $('#chain'), chainPts: $('#chain-pts'), chainMult: $('#chain-mult'), chainBar: $('#chain-bar'),
  hint: $('#hint'), speedfx: $('#speedfx'), chainLbl: $('#chain .lbl'), mode: $('#mode-badge'),
};
function updateHud(t) {
  hud.score.textContent = fmt(G.score);
  hud.best.textContent = fmt(G.best);
  const lp = G.lap;
  if (lp.track && lp.running) {
    hud.trial.classList.add('on');
    hud.trialT.textContent = fmtTime(lp.t);
    const best = G.lapBest[lp.track.id];
    hud.trialSub.textContent = `${lp.track.name} · הקפה ${lp.count + 1}${best != null ? ' · שיא ' + fmtTime(best) : ''}`;
  } else hud.trial.classList.remove('on');
  const c = G.chain;
  if (c.active && c.pts > 0) {
    hud.chain.classList.add('on');
    hud.chainPts.textContent = fmt(c.pts);
    hud.chainMult.textContent = 'x' + c.mult;
    hud.chainBar.style.transform = `scaleX(${Math.max(0, 1 - c.idle / 1.6)})`;
    hud.chain.classList.toggle('drifting', veh.drifting);
    hud.chainLbl.textContent = G.wheelie.kind ? (G.wheelie.kind > 0 ? 'WHEELIE' : 'STOPPIE') : (G.inDriftZone && veh.drifting ? 'DRIFT ZONE ×2' : 'COMBO');
  } else hud.chain.classList.remove('on');
  let hint = '';
  if (G.flipT > 0.6) hint = `הבאגי הפוך — לחץ ${keyLabel(input.bind.reset)}`;
  hud.hint.textContent = hint;
  hud.hint.classList.toggle('on', !!hint);
  hud.speedfx.style.opacity = veh.boostActive ? 0.35 : 0;
  drawGauge();
  drawMap(t);
}

// ---------------------------------------------------------------- driving mode
const MODE_NAMES = { normal: 'נסיעה רגילה', drift: 'מצב דריפט' };
function setMode(m, announce = false) {
  G.mode = m; veh.mode = m; store.set('mode', m);
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === m));
  hud.mode.textContent = MODE_NAMES[m];
  hud.mode.classList.toggle('drift', m === 'drift');
  if (announce) popup(MODE_NAMES[m], m === 'drift' ? 'trick' : 'air', m === 'drift' ? 'החלקות ארוכות: גז + היגוי מלא או בלם יד' : 'אחיזה ויציבות');
}

// ---------------------------------------------------------------- settings (keys, mode, graphics, sound)
function renderKeys() {
  $('#keys').innerHTML = ACTIONS.map(a => `
    <div class="keyrow"><span>${a.name}</span>
      <button class="keybtn" data-act="${a.id}" aria-label="שינוי מקש עבור ${a.name}">${keyLabel(input.bind[a.id])}</button></div>`).join('');
}
$('#keys').addEventListener('click', (e) => {
  const b = e.target.closest('.keybtn'); if (!b) return;
  document.querySelectorAll('.keybtn.wait').forEach(x => x.classList.remove('wait'));
  b.classList.add('wait'); b.textContent = 'לחץ על מקש…';
  input.capture = (code) => {
    if (code !== 'Escape' || b.dataset.act === 'pause') input.setKey(b.dataset.act, code);
    store.set('keys', input.bind);
    renderKeys(); renderHelp();
  };
});
$('#keys-reset').addEventListener('click', () => { input.resetKeys(); store.set('keys', input.bind); renderKeys(); renderHelp(); });
function renderHelp() {
  const k = (a) => `<kbd>${keyLabel(input.bind[a])}</kbd>`;
  $('#help').innerHTML = `
    <span>${k('throttle')} ${k('brake')}</span><span>גז / ברקס ורוורס</span>
    <span>${k('left')} ${k('right')}</span><span>היגוי</span>
    <span>${k('handbrake')}</span><span>בלם יד — פותח דריפט</span>
    <span>${k('boost')}</span><span>ניטרו</span>
    <span>${k('leanBack')} ${k('leanFwd')}</span><span>הטייה: ווילי / ווילי קדמי, ובאוויר סלטות</span>
    <span>${k('rollLeft')} ${k('rollRight')}</span><span>גלגול באוויר</span>
    <span>${k('mode')}</span><span>מעבר בין נסיעה רגילה למצב דריפט</span>
    <span>${k('reset')} ${k('camera')} ${k('pause')}</span><span>איפוס · מצלמה · תפריט</span>`;
  $('.keys-help').textContent = `${keyLabel(input.bind.mode)} מצב נהיגה · ${keyLabel(input.bind.leanBack)}/${keyLabel(input.bind.leanFwd)} הטייה · ${keyLabel(input.bind.handbrake)} דריפט · ${keyLabel(input.bind.pause)} הגדרות`;
}
function openSettings(on) {
  $('#settings').classList.toggle('hidden', !on);
  if (on) renderKeys();
  else { input.capture = null; }
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('.open-settings').forEach(b => b.addEventListener('click', () => openSettings(true)));
$('#settings-close').addEventListener('click', () => openSettings(false));

// ---------------------------------------------------------------- menus
function buildMenu() {
  const sw = $('#swatches');
  sw.innerHTML = PAINTS.map(p => `<button class="sw" style="--c:${p.c}" data-c="${p.c}" aria-label="${p.n}" title="${p.n}"></button>`).join('');
  const mark = markPaint = () => { sw.hidden = sw.previousElementSibling.hidden = !car.paintable; paint = store.get('paint_' + carId, null); sw.querySelectorAll('.sw').forEach(b => b.classList.toggle('sel', b.dataset.c === paint)); };
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('.sw'); if (!b) return;
    car.setPaint(b.dataset.c); store.set('paint_' + carId, b.dataset.c); mark();
  });
  mark();
  if (G.best > 0) $('#menu-best').textContent = `שיא ניקוד: ${fmt(G.best)}`;
}
function startGame() {
  audio.start();
  audio.setMuted(audio.muted);
  $('#menu').classList.add('hidden');
  openSettings(false);
  $('#hud').classList.remove('hidden');
  document.body.classList.add('playing');
  if (matchMedia('(pointer: coarse)').matches) $('#touch').classList.remove('hidden');
  G.state = 'play';
  cam.pos.copy(camera.position);
  sizeCanvases();
}
function pause(on) {
  if (G.state === 'menu') return;
  G.state = on ? 'pause' : 'play';
  $('#pause').classList.toggle('hidden', !on);
  if (!on) openSettings(false);
}
$('#play-btn').addEventListener('click', startGame);
$('#resume-btn').addEventListener('click', () => pause(false));
$('#reset-btn').addEventListener('click', () => { resetCar(true); pause(false); });
$('#pause-btn').addEventListener('click', () => pause(G.state !== 'pause'));
$('#q-btn').addEventListener('click', () => { quality = quality === 'high' ? 'low' : 'high'; store.set('quality', quality); applyQuality(); });
const muteLabel = () => { $('#mute-btn').textContent = audio.muted ? 'כבוי' : 'פועל'; };
$('#mute-btn').addEventListener('click', () => { audio.setMuted(!audio.muted); store.set('muted', audio.muted); muteLabel(); });
muteLabel();
$('#touch-cam')?.addEventListener('click', () => { G.camMode = (G.camMode + 1) % 3; });
$('#touch-reset')?.addEventListener('click', () => resetCar());
$('#touch-mode')?.addEventListener('click', () => setMode(G.mode === 'drift' ? 'normal' : 'drift', true));
addEventListener('keydown', (e) => { if (e.code === 'Enter' && G.state === 'menu' && !input.capture && $('#settings').classList.contains('hidden')) startGame(); });

// ---------------------------------------------------------------- cacti: soft, never stop you
const smashed = new Map();   // index -> time it respawns
function smashCacti() {
  const list = sceneryGroup.userData.cacti;
  if (!list) return;
  const now = clock.elapsedTime;
  for (const [i, t] of smashed) if (now > t && Math.hypot(list[i].x - veh.pos.x, list[i].z - veh.pos.z) > 60) { smashed.delete(i); sceneryGroup.userData.setCactus(i, true); }
  if (veh.speed < 2) return;
  for (let i = 0; i < list.length; i++) {
    const c = list[i], dx = c.x - veh.pos.x, dz = c.z - veh.pos.z;
    if (dx * dx + dz * dz > 6.5 || smashed.has(i) || Math.abs(c.y - veh.pos.y) > 3) continue;
    smashed.set(i, now + 25);
    sceneryGroup.userData.setCactus(i, false);
    veh.vel.multiplyScalar(0.985);
    for (let k = 0; k < 14; k++) particles.emit(c.x, c.y + 1 + Math.random() * 2, c.z, (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6, 0.25, 0.55, 0.2, 0.5, 0.9, { grow: 0.4, grav: -9, alpha: 0.9, drag: 0.6 });
    audio.pop();
  }
}

// ---------------------------------------------------------------- performance: automatic resolution scaling
let perfScale = 1, perfAcc = 0, perfFrames = 0, perfLowSince = 0, fpsShown = 60;
function perfTick(rawDt) {
  perfAcc += rawDt; perfFrames++;
  if (perfAcc < 1.0) return;
  const fps = perfFrames / perfAcc;
  perfAcc = 0; perfFrames = 0; fpsShown = fps;
  const el = document.getElementById('fps'); if (el) el.textContent = Math.round(fps) + ' FPS';
  if (G.state === 'menu' || G.perfLock) return;
  const base = Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1.0);
  let next = perfScale;
  if (fps < 40 && perfScale > 0.5) next = Math.max(0.5, perfScale - 0.15);
  else if (fps > 58 && perfScale < 1) next = Math.min(1, perfScale + 0.05);
  if (next !== perfScale) {
    perfScale = next;
    renderer.setPixelRatio(base * perfScale);
    renderer.setSize(innerWidth, innerHeight);
    composer?.setPixelRatio(base * perfScale); composer?.setSize(innerWidth, innerHeight);
  }
  // still slow at the lowest resolution: drop to the light graphics preset automatically
  if (fps < 28 && perfScale <= 0.5 && quality === 'high') {
    perfLowSince++;
    if (perfLowSince >= 3) { quality = 'low'; store.set('quality', quality); applyQuality(); perfScale = 1; perfLowSince = 0; popup('עברתי לגרפיקה חסכונית', 'air', 'כדי לשמור על חלקות'); }
  } else perfLowSince = 0;
}

// ---------------------------------------------------------------- stunt pads: trampolines, banks, turntables, splashes
let tailT = 0;
function stuntPads(dt) {
  // trampolines
  for (const p of TR.trampolines) {
    p.cool = Math.max(0, (p.cool || 0) - dt);
    const d = Math.hypot(veh.pos.x - p.x, veh.pos.z - p.z);
    if (d < p.r && p.cool === 0 && veh.grounded >= 2 && veh.vel.y < p.power * 0.6) {
      veh.vel.y = p.power + Math.min(4, veh.speed * 0.08);
      p.cool = 0.6; p.squash = 1;
      audio.boing(p.power / 40);
      G.shake = Math.max(G.shake, 0.35);
      for (let k = 0; k < 16; k++) particles.emit(p.x + (Math.random() - 0.5) * p.r, veh.pos.y - 0.5, p.z + (Math.random() - 0.5) * p.r, (Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4, 1, 0.85, 0.3, 0.4, 0.7, { grow: 0.3, grav: -6, alpha: 0.9, drag: 1 });
      popup('מקפצה!', 'boost', `${Math.round(p.power * p.power / 26)} מ' גובה`);
    }
  }
  // banked surfaces: riding the slope earns points, steeper is worth more
  const tilt = veh.up.y;
  if (veh.grounded >= 2 && tilt < 0.9 && tilt > 0.3 && veh.speed > 10) {
    tailT += dt;
    chainAdd(dt * 260 * (1.1 - tilt) * 6);
    G.bankRide = (G.bankRide || 0) + dt;
  } else if (G.bankRide) {
    if (G.bankRide > 1.5) popup('נסיעה על הקיר', 'trick', `${G.bankRide.toFixed(1)} שניות`);
    G.bankRide = 0;
  }
  // rotating platform: spinning with it scores
  const onTT = TR.turntables.some(t => Math.hypot(veh.pos.x - t.x, veh.pos.z - t.z) < t.r) && veh.grounded >= 2;
  if (onTT) { chainAdd(dt * (80 + Math.abs(veh.w.y) * 90)); G.ttTime = (G.ttTime || 0) + dt; }
  else if (G.ttTime) { if (G.ttTime > 2) popup('קרוסלה!', 'trick', `${G.ttTime.toFixed(1)} שניות`); G.ttTime = 0; }
  // water entry
  const wet = veh.inWater > 0.35;
  if (wet && !G.wasWet && G.prevVy < -5) {
    const drop = Math.max(0, (G.air.maxY || veh.pos.y) - TR.WATER_LEVEL);
    audio.splash(Math.min(1.3, -G.prevVy / 18));
    for (let k = 0; k < 60; k++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 7; particles.emit(veh.pos.x, TR.WATER_LEVEL + 0.2, veh.pos.z, Math.cos(a) * s, 4 + Math.random() * 9 * Math.min(1, -G.prevVy / 14), Math.sin(a) * s, 0.9, 0.96, 1, 0.9, 1.4, { grow: 1.5, grav: -12, alpha: 0.75, drag: 0.7 }); }
    G.shake = Math.max(G.shake, 0.6);
    if (drop > 8) { const pts = Math.round(drop * 90); addScore(pts); popup('צלילה!', 'trick', `${Math.round(drop)} מ' · +${fmt(pts)}`); }
  }
  G.wasWet = wet; G.prevVy = veh.vel.y;
}

// ---------------------------------------------------------------- wheelies
function wheelieTrack(dt) {
  const W = G.wheelie;
  const kind = veh.speed > 2 ? veh.wheelie : 0;
  if (kind && kind === W.kind) {
    W.t += dt;
    if (W.t > 0.6) { chainAdd(dt * (kind > 0 ? 260 : 340) * (1 + veh.speed / 20)); G.nitro = Math.min(1, G.nitro + dt * 0.04); }
    return;
  }
  if (W.kind && W.t > 1.0) {
    popup(W.kind > 0 ? 'ווילי!' : 'ווילי קדמי!', 'trick', `${W.t.toFixed(1)} שניות`);
    audio.trick();
  }
  W.kind = kind; W.t = 0;
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let acc = 0;
const DT = 1 / 120;
const idleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, roll: 0, lean: 0 };

function keys() {
  if (input.capture) return;
  if (input.hit('pause') || input.pressed.has('KeyP')) {
    if (!$('#settings').classList.contains('hidden')) openSettings(false);
    else pause(G.state === 'play');
  }
  if (G.state !== 'play') return;
  if (input.hit('reset')) resetCar();
  if (input.hit('camera')) G.camMode = (G.camMode + 1) % 3;
  if (input.hit('mode')) setMode(G.mode === 'drift' ? 'normal' : 'drift', true);
  if (input.pressed.has('KeyM')) { audio.setMuted(!audio.muted); store.set('muted', audio.muted); muteLabel(); }
}

function frame() {
  requestAnimationFrame(frame);
  G.frames = (G.frames || 0) + 1;
  const rawDt = clock.getDelta();
  const dt = Math.min(0.1, rawDt);
  const t = clock.elapsedTime;
  perfTick(rawDt);
  const inp = input.update(dt);
  keys();

  if (G.state === 'play' || G.state === 'menu') {
    const pin = G.state === 'play' ? { ...inp } : idleInput;
    pin.boost = pin.boost && G.nitro > 0.01;
    veh.boostFuel = G.nitro;
    acc += Math.min(0.25, rawDt);          // physics keeps real-time speed even at ~5 fps
    let steps = 0;
    while (acc >= DT && steps < 32) {
      veh.step(DT, pin);
      updateProps(DT);
      acc -= DT; steps++;
    }
    if (steps >= 32) acc = 0;

    if (G.state === 'play') {
      if (veh.boostActive) G.nitro = Math.max(0, G.nitro - dt * 0.28);
      else G.nitro = Math.min(1, G.nitro + dt * 0.035);        // slowly refills by itself
      G.speedKmh = Math.hypot(veh.vel.x, veh.vel.z) * 3.6;     // true ground speed (not just along the nose)
      // drift chain
      const c = G.chain;
      const sp = veh.speed;
      const driftingNow = veh.drifting && veh.grounded >= 2 && sp > 6 && Math.abs(veh.slipAngle) > 0.17;
      if (driftingNow) {
        G.inDriftZone = TR.driftZone(veh.pos.x, veh.pos.z);
        chainAdd(dt * Math.abs(veh.slipAngle) * 57.3 * sp * 0.55 * (G.inDriftZone ? 2 : 1));
        c.time += dt;
        c.mult = 1 + Math.min(4, Math.floor(c.time / 2.2));
        G.nitro = Math.min(1, G.nitro + dt * 0.05);
      } else if (c.active && veh.grounded > 0 && !G.wheelie.kind) {
        c.idle += dt;
        if (c.idle > 1.6) bankChain();
      }
      airTrack(dt);
      wheelieTrack(dt);
      // crashes
      if (veh.wallHit > 7.5) {
        loseChain('בום!');
        audio.crash(Math.min(1.2, veh.wallHit / 14));
        G.shake = Math.max(G.shake, Math.min(1, veh.wallHit / 14));
        burst(veh.pos.x, veh.pos.y, veh.pos.z, 20, [0.8, 0.7, 0.55], 5);
      } else if (veh.impact > 9 && veh.grounded === 0) {
        audio.thump(0.6);
      }
      veh.wallHit = 0; veh.impact = 0;
      // upside down
      if (veh.up.y < 0.3 && veh.speed < 3) {
        G.flipT += dt;
        if (G.flipT > 3) resetCar();
      } else G.flipT = 0;
      if (veh.pos.y < TR.terrainHeight(veh.pos.x, veh.pos.z) - 4) resetCar();
      lapCheck(dt);
      zoneCheck(dt);
      smashCacti();
      stuntPads(dt);
      wheelFx(dt, inp);
      if (veh.inWater > 0.2 && veh.speed > 4 && Math.random() < 0.6) {
        burst(veh.pos.x, TR.WATER_LEVEL + 0.1, veh.pos.z, 3, [0.9, 0.95, 1], 3);
      }
      if (veh.boostActive) {
        for (const f of car.flames) {
          const p = f.getWorldPosition(_v);
          particles.emit(p.x, p.y, p.z, -veh.vel.x * 0.1, 0.3, -veh.vel.z * 0.1, 0.55, 0.85, 1, 0.5, 0.35, { grow: 1, alpha: 0.5, grav: 0 });
        }
      }
    }
  }

  // visuals
  syncCar(car, veh, t);
  propsVisual(dt);
  particles.update(G.state === 'pause' ? 0 : dt);
  skids.update();
  water.userData.tick(t);
  trampGroup.userData.tick(G.state === 'pause' ? 0 : dt);
  turnGroup.userData.tick(G.state === 'pause' ? 0 : dt);
  updateCamera(dt);
  vegetation.userData.update(camera.position, t);
  clouds.userData.tick(t, camera.position);

  // shadow camera follows the buggy (snapped to texels to avoid shimmering)
  const texel = 120 / sun.shadow.mapSize.x;
  const fx = Math.round(veh.pos.x / texel) * texel, fz = Math.round(veh.pos.z / texel) * texel;
  sun.position.set(fx + sunDir.x * 150, veh.pos.y + sunDir.y * 150, fz + sunDir.z * 150);
  sun.target.position.set(fx, veh.pos.y, fz);
  sun.target.updateMatrixWorld();

  if (G.state !== 'menu') updateHud(t);
  audio.update({
    rpm: veh.rpm, throttle: G.state === 'play' ? inp.throttle : 0, speed: veh.speed,
    screech: Math.max(...veh.wheels.map(w => w.contact ? Math.max(w.slipLat, w.slipLong * 0.6, veh.drifting && !w.front ? 0.7 : 0) : 0)),
    slide: veh.drifting ? 1 : 0,
    asphalt: veh.wheels.some(w => w.contact && (w.surface !== 'terrain' || TR.surfaceAt(w.point.x, w.point.z) === 'asphalt')),
    grounded: veh.grounded > 0 ? 1 : 0, boost: veh.boostActive, paused: G.state !== 'play',
  });

  if (composer) composer.render(); else renderer.render(scene, camera);
  input.endFrame();
}

applyQuality();
buildMenu();
buildTravel();
setMode(G.mode);
renderHelp();
$('#loading').classList.remove('show');
$('#menu').classList.remove('hidden');
addEventListener('resize', () => { if (G.state !== 'menu') sizeCanvases(); });
window.__game = { selectCar, get car() { return car; }, get carId() { return carId; }, veh, G, camera, scene, renderer, startGame, TR, lapCheck, input, setMode, THREE };
frame();
