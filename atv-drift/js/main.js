import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as TR from './terrain.js';
import { Vehicle, GRAVITY } from './physics.js';
import * as W from './world.js';
import { loadCar, syncCar } from './car.js';
import { Particles, Skids } from './fx.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';

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
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 3000);
scene.fog = new THREE.Fog(0xc8c4ba, 280, 1500);

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(-140));
W.buildSky(scene, renderer, sunDir);
scene.environmentIntensity = 0.45;
const sun = new THREE.DirectionalLight(0xffe2c0, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x8a6a48, 0.38));

let composer = null, bloom = null;
function applyQuality() {
  const dpr = Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1.0);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (quality === 'high') {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(dpr);
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } else composer = null;
  $('#q-btn').textContent = quality === 'high' ? 'גרפיקה: גבוהה' : 'גרפיקה: חסכונית';
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
scene.add(W.buildTerrain(T));
scene.add(W.buildArena(T));
scene.add(W.buildRamps(T));
const water = W.buildWater(T); scene.add(water);
scene.add(W.buildScenery());
const { group: cpGroup, cps } = W.buildCheckpoints(); scene.add(cpGroup);
scene.add(W.buildStartGate(cps[0]));
const coinPts = W.coinPositions();
const coins = W.buildCoins(coinPts); scene.add(coins);
const pads = W.buildBoostPads(T); scene.add(pads);
const props = W.propLayout(); scene.add(W.buildPropMeshes(props));
setLoad(0.25, 'מביאים את הבאגי…');

const particles = new Particles(scene, T.soft, 5000);
particles.mat.uniforms.fogColor.value.copy(scene.fog.color);
particles.mat.uniforms.fogNear.value = scene.fog.near;
particles.mat.uniforms.fogFar.value = scene.fog.far;
const skids = new Skids(scene, 7000);

// checkpoint arrow
const arrow = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.9); s.lineTo(0.62, 0); s.lineTo(0.24, 0); s.lineTo(0.24, -0.7); s.lineTo(-0.24, -0.7); s.lineTo(-0.24, 0); s.lineTo(-0.62, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  g.translate(0, 0, -0.09); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xff9a00, emissiveIntensity: 1.2, roughness: 0.4 }));
  m.visible = false;
  scene.add(m);
  return m;
})();

// ---------------------------------------------------------------- car
let car;
try {
  car = await loadCar(window.DUNE_MODEL_URL || 'assets/rzr.glb', p => setLoad(0.25 + p * 0.7));
} catch (e) {
  $('#load-msg').textContent = 'שגיאה בטעינת הדגם: ' + e.message;
  throw e;
}
scene.add(car.root);
const PAINTS = [
  { c: '#c8102e', n: 'אדום' }, { c: '#f2a900', n: 'צהוב' }, { c: '#1e6fd9', n: 'כחול' },
  { c: '#2a2a2e', n: 'שחור' }, { c: '#f2f2f2', n: 'לבן' }, { c: '#2bb34a', n: 'ירוק' },
];
let paint = store.get('paint', null);
if (paint) car.setPaint(paint);
const veh = new Vehicle();
veh.reset(TR.SPAWN.x, TR.SPAWN.z, TR.SPAWN.yaw);
setLoad(1, 'מוכן!');

const audio = new GameAudio();
audio.muted = store.get('muted', false);
const input = new Input();
input.bindTouch($('#touch'));

// ---------------------------------------------------------------- game state
const ACH = [
  { id: 'drift5k', name: 'מלך הדריפט', desc: 'שרשרת דריפט של 5,000 נקודות' },
  { id: 'air25', name: 'טייס', desc: '2.5 שניות באוויר בקפיצה אחת' },
  { id: 'backflip', name: 'סלטה אחורית', desc: 'לנחות אחרי סלטה אחורית' },
  { id: 'spin', name: 'סביבון', desc: 'סיבוב 360° באוויר' },
  { id: 'coins25', name: 'אספן', desc: 'לאסוף 25 מטבעות' },
  { id: 'trial', name: 'מקצה זמן', desc: 'לסיים את מסלול השערים' },
  { id: 'speed', name: 'טיל', desc: 'להגיע ל-140 קמ"ש' },
  { id: 'cones', name: 'באולינג', desc: 'להפיל 15 קונוסים וחביות' },
];
const G = {
  state: 'menu',
  score: 0,
  best: store.get('best', 0),
  chain: { pts: 0, time: 0, idle: 0, active: false, mult: 1 },
  nitro: 1,
  coins: 0, taken: new Array(coinPts.length).fill(false),
  trial: { active: false, next: 0, t: 0, best: store.get('bestTime', null) },
  air: { t: 0, pitch: 0, yaw: 0, roll: 0, vy: 0 },
  ach: store.get('ach', {}),
  knocked: 0,
  camMode: 0,
  flipT: 0,
  padCool: 0,
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
function unlock(id) {
  if (G.ach[id]) return;
  G.ach[id] = true; store.set('ach', G.ach);
  const a = ACH.find(a => a.id === id);
  toast(`<i>🏆</i><div><small>הישג חדש</small><b>${a.name}</b><span>${a.desc}</span></div>`);
  audio.achievement();
  renderAch();
}
function renderAch() {
  const done = ACH.filter(a => G.ach[a.id]).length;
  $('#ach-count').textContent = `${done}/${ACH.length}`;
  $('#ach-list').innerHTML = ACH.map(a => `<li class="${G.ach[a.id] ? 'done' : ''}"><i>${G.ach[a.id] ? '✔' : '○'}</i><div><b>${a.name}</b><span>${a.desc}</span></div></li>`).join('');
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
    if (total >= 5000) unlock('drift5k');
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
    if (A.t === 0) { A.pitch = A.yaw = A.roll = 0; }
    A.t += dt;
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
      if (back) unlock('backflip');
    }
    if (spins) { names.push(`${spins * 360}°`); pts += 800 * spins; unlock('spin'); }
    if (rolls) { names.push('גלגול חבית' + (rolls > 1 ? ` x${rolls}` : '')); pts += 1200 * rolls; }
    if (pts === 0) return;
    const clean = veh.up.y > 0.93 && Math.abs(veh.slipAngle) < 0.35;
    if (clean && (names.length || t > 1.2)) { pts += 250; }
    chainAdd(pts);
    G.nitro = Math.min(1, G.nitro + t * 0.08);
    const head = names.length ? names.join(' + ') : (t > 2 ? 'אוויר ענק!' : 'קפיצה!');
    popup(head, names.length ? 'trick' : 'air', `${t.toFixed(1)} שנ' באוויר · +${fmt(pts)}${clean ? ' · נחיתה נקייה' : ''}`);
    if (names.length) audio.trick();
    if (t >= 2.5) unlock('air25');
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
    const wet = p.y < TR.WATER_LEVEL + 0.05;
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
            if (G.knocked >= 15) unlock('cones');
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

// ---------------------------------------------------------------- coins
const _m4 = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cp = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
function updateCoins(t) {
  for (let i = 0; i < coinPts.length; i++) {
    const c = coinPts[i];
    if (!G.taken[i] && G.state === 'play') {
      const dx = c.x - veh.pos.x, dy = c.y - veh.pos.y, dz = c.z - veh.pos.z;
      if (dx * dx + dy * dy + dz * dz < 2.7 * 2.7) {
        G.taken[i] = true; G.coins++;
        addScore(100);
        G.nitro = Math.min(1, G.nitro + 0.06);
        sparkle(c.x, c.y, c.z);
        audio.coin();
        popup('+100', 'coin');
        if (G.coins >= 25) unlock('coins25');
        if (G.coins === coinPts.length) toast('<i>💰</i><div><small>כל הכבוד</small><b>אספת את כל המטבעות!</b></div>');
      }
    }
    _cq.setFromAxisAngle(Y, t * 2.4 + i);
    _cs.setScalar(G.taken[i] ? 0 : 1);
    _cp.set(c.x, c.y + Math.sin(t * 2 + i) * 0.18, c.z);
    coins.setMatrixAt(i, _m4.compose(_cp, _cq, _cs));
  }
  coins.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- time trial
let prevSide = new Map();
function cpSide(cp) { return (veh.pos.x - cp.x) * cp.nx + (veh.pos.z - cp.z) * cp.nz; }
function cpCheck() {
  const tr = G.trial;
  const target = tr.active ? cps[tr.next] : cps[0];
  const s = cpSide(target);
  const ps = prevSide.get(target);
  prevSide.set(target, s);
  if (ps == null || Math.sign(ps) === Math.sign(s) || Math.abs(ps - s) > 8) return;
  // crossed the plane: within the ring?
  const lx = (veh.pos.x - target.x) * target.nz - (veh.pos.z - target.z) * target.nx;
  const ly = veh.pos.y - target.y;
  if (Math.hypot(lx, ly) > target.r + 0.9) return;
  if (!tr.active) {
    tr.active = true; tr.next = 1; tr.t = 0; tr.splits = [];
    popup('מקצה זמן!', 'trial', 'עבור בכל השערים לפי הסדר · T לביטול');
    audio.checkpoint();
    return;
  }
  if (tr.next === 0) {
    // finish
    const time = tr.t;
    tr.active = false;
    const rec = tr.best == null || time < tr.best;
    if (rec) { tr.best = time; store.set('bestTime', time); }
    popup(`סיום! ${fmtTime(time)}`, 'trial', rec ? 'שיא חדש! 🏁' : `השיא שלך: ${fmtTime(tr.best)}`);
    addScore(Math.max(1000, Math.round(20000 - time * 120)));
    audio.finish();
    unlock('trial');
    return;
  }
  audio.checkpoint();
  popup(`שער ${tr.next}/${cps.length - 1}`, 'cp', fmtTime(tr.t));
  tr.next = (tr.next + 1) % cps.length;
}
function updateCheckpointVisuals(t) {
  const tr = G.trial;
  for (const c of cps) c.group.visible = false;
  const show = (c, main) => {
    c.group.visible = true;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    c.mat.emissive.set(main ? (c === cps[0] ? 0x30ff7a : 0xffb020) : 0x8899aa);
    c.mat.emissiveIntensity = main ? 1.6 + pulse * 1.4 : 0.6;
    c.mat.opacity = main ? 0.95 : 0.45;
    c.film.material.opacity = main ? 0.06 + pulse * 0.06 : 0.02;
    c.ring.rotation.z = t * (main ? 0.8 : 0.3);
  };
  if (!tr.active) { show(cps[0], true); arrow.visible = false; return; }
  show(cps[tr.next], true);
  if (tr.next !== 0) show(cps[(tr.next + 1) % cps.length], false);
  const c = cps[tr.next];
  arrow.visible = G.camMode !== 2;
  arrow.position.copy(veh.pos).y += 2.7;
  arrow.rotation.set(0, Math.atan2(c.x - veh.pos.x, c.z - veh.pos.z) + Math.PI, 0);
  arrow.rotateX(Math.sin(t * 4) * 0.08);
}

// ---------------------------------------------------------------- boost pads
function padCheck(dt) {
  G.padCool -= dt;
  if (G.padCool > 0 || veh.grounded < 2) return;
  for (const b of TR.boostPads) {
    const dx = veh.pos.x - b.x, dz = veh.pos.z - b.z;
    const u = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
    const w = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
    if (Math.abs(u) < 4.5 && Math.abs(w) < 3) {
      const dir = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
      const along = veh.vel.dot(dir);
      veh.vel.addScaledVector(dir, Math.max(0, 40 - along));
      G.nitro = Math.min(1, G.nitro + 0.2);
      G.padCool = 1.2;
      G.boostFlash = 0.9;
      popup('טורבו!', 'boost');
      audio.boostSfx();
      return;
    }
  }
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
    const gy = Math.max(TR.groundQuery(cam.pos.x, cam.pos.z, cam.pos.y + 0.5, gq), TR.WATER_LEVEL) + 0.9;
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
  const fovT = 62 + Math.min(sp * 3.6, 170) * 0.1 + (veh.boostActive ? 9 : 0) + (G.boostFlash || 0) * 6;
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
function drawMapBg() {
  const w = mapC.width, h = mapC.height;
  mapBg.width = w; mapBg.height = h;
  const c = mapBg.getContext('2d');
  const S = w / TR.WORLD;
  const P = (x, z) => [(x + TR.HALF) * S, (z + TR.HALF) * S];
  // terrain shading from the height grid
  const img = c.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = i / S - TR.HALF, z = j / S - TR.HALF;
    const hh = TR.terrainHeight(x, z);
    const hx = TR.terrainHeight(x + 3, z) - hh;
    const sh = Math.max(-1, Math.min(1, hx * 0.35));
    let r = 196, g = 160, b = 112;
    if (hh > 12) { r = 150; g = 112; b = 82; }
    if (hh < TR.WATER_LEVEL && Math.hypot(x - TR.LAKE.x, z - TR.LAKE.z) < TR.LAKE.r) { r = 50; g = 140; b = 160; }
    const k = (i + j * w) * 4;
    img.data[k] = r + sh * 40; img.data[k + 1] = g + sh * 36; img.data[k + 2] = b + sh * 30; img.data[k + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // arena / park
  c.fillStyle = 'rgba(60,60,64,0.9)';
  c.beginPath(); c.arc(...P(TR.ARENA.x, TR.ARENA.z), TR.ARENA.r * S, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(150,110,75,0.75)';
  c.fillRect(...P(TR.PARK.x0, TR.PARK.z0), (TR.PARK.x1 - TR.PARK.x0) * S, (TR.PARK.z1 - TR.PARK.z0) * S);
  c.fillStyle = 'rgba(230,230,225,0.85)';
  c.beginPath(); c.arc(...P(TR.BOWL.x, TR.BOWL.z), TR.BOWL.r * S, 0, Math.PI * 2); c.fill();
  // ramps
  c.fillStyle = '#ff7a2a';
  for (const col of TR.colliders) c.fillRect(...P(col.minX, col.minZ), Math.max(1, (col.maxX - col.minX) * S), Math.max(1, (col.maxZ - col.minZ) * S));
  // road
  c.strokeStyle = 'rgba(255,240,210,0.55)'; c.lineWidth = Math.max(1.5, 4 * S); c.lineJoin = 'round';
  c.beginPath();
  TR.ROUTE.forEach((p, i) => i ? c.lineTo(...P(p.x, p.z)) : c.moveTo(...P(p.x, p.z)));
  c.closePath(); c.stroke();
}
function drawMap(t) {
  const w = mapC.width, h = mapC.height;
  mctx.clearRect(0, 0, w, h);
  mctx.save();
  mctx.beginPath(); mctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); mctx.clip();
  // zoomed, centred on the buggy, heading-up
  const zoom = 2.1;
  const S = w / TR.WORLD * zoom;
  const yaw = Math.atan2(cam.dir.x, cam.dir.z);
  mctx.translate(w / 2, h / 2);
  mctx.rotate(yaw + Math.PI);
  mctx.scale(zoom, zoom);
  const s0 = w / TR.WORLD;
  mctx.translate(-(veh.pos.x + TR.HALF) * s0, -(veh.pos.z + TR.HALF) * s0);
  mctx.drawImage(mapBg, 0, 0);
  const P = (x, z) => [(x + TR.HALF) * s0, (z + TR.HALF) * s0];
  mctx.fillStyle = '#ffd23a';
  for (let i = 0; i < coinPts.length; i++) {
    if (G.taken[i]) continue;
    mctx.beginPath(); mctx.arc(...P(coinPts[i].x, coinPts[i].z), 2.2 / zoom * (w / 170), 0, Math.PI * 2); mctx.fill();
  }
  const tgt = G.trial.active ? cps[G.trial.next] : cps[0];
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  mctx.strokeStyle = G.trial.active ? '#ffb020' : '#30ff7a'; mctx.lineWidth = 2.5 / zoom * (w / 170);
  mctx.beginPath(); mctx.arc(...P(tgt.x, tgt.z), (5 + pulse * 3) / zoom * (w / 170), 0, Math.PI * 2); mctx.stroke();
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
  score: $('#score'), best: $('#best'), coins: $('#coins'), trial: $('#trial'), trialT: $('#trial-t'), trialSub: $('#trial-sub'),
  chain: $('#chain'), chainPts: $('#chain-pts'), chainMult: $('#chain-mult'), chainBar: $('#chain-bar'),
  hint: $('#hint'), speedfx: $('#speedfx'),
};
function updateHud(t) {
  hud.score.textContent = fmt(G.score);
  hud.best.textContent = fmt(G.best);
  hud.coins.textContent = `${G.coins}/${coinPts.length}`;
  const tr = G.trial;
  if (tr.active) {
    hud.trial.classList.add('on');
    hud.trialT.textContent = fmtTime(tr.t);
    hud.trialSub.textContent = `שער ${tr.next === 0 ? 'סיום' : tr.next + '/' + (cps.length - 1)}${tr.best != null ? ' · שיא ' + fmtTime(tr.best) : ''}`;
  } else hud.trial.classList.remove('on');
  const c = G.chain;
  if (c.active && c.pts > 0) {
    hud.chain.classList.add('on');
    hud.chainPts.textContent = fmt(c.pts);
    hud.chainMult.textContent = 'x' + c.mult;
    hud.chainBar.style.transform = `scaleX(${Math.max(0, 1 - c.idle / 1.6)})`;
    hud.chain.classList.toggle('drifting', veh.drifting);
  } else hud.chain.classList.remove('on');
  let hint = '';
  if (G.flipT > 0.6) hint = 'הבאגי הפוך — לחץ R';
  else if (!tr.active && G.state === 'play' && t - startedAt < 9) hint = 'סע דרך השער הירוק כדי להתחיל מקצה זמן';
  hud.hint.textContent = hint;
  hud.hint.classList.toggle('on', !!hint);
  hud.speedfx.style.opacity = veh.boostActive ? 0.5 : (G.boostFlash || 0) * 0.6;
  drawGauge();
  drawMap(t);
}

// ---------------------------------------------------------------- menus
let startedAt = 0;
function buildMenu() {
  const sw = $('#swatches');
  sw.innerHTML = PAINTS.map(p => `<button class="sw" style="--c:${p.c}" data-c="${p.c}" aria-label="${p.n}" title="${p.n}"></button>`).join('');
  const mark = () => sw.querySelectorAll('.sw').forEach(b => b.classList.toggle('sel', b.dataset.c === paint));
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('.sw'); if (!b) return;
    paint = b.dataset.c; car.setPaint(paint); store.set('paint', paint); mark();
  });
  if (!paint) paint = null;
  mark();
  if (G.trial.best != null) $('#menu-best').textContent = `שיא מקצה זמן: ${fmtTime(G.trial.best)} · שיא ניקוד: ${fmt(G.best)}`;
  else if (G.best > 0) $('#menu-best').textContent = `שיא ניקוד: ${fmt(G.best)}`;
}
function startGame() {
  audio.start();
  audio.setMuted(audio.muted);
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  document.body.classList.add('playing');
  if (matchMedia('(pointer: coarse)').matches) $('#touch').classList.remove('hidden');
  G.state = 'play';
  startedAt = clock.elapsedTime;
  cam.pos.copy(camera.position);
  sizeCanvases();
}
function pause(on) {
  if (G.state === 'menu') return;
  G.state = on ? 'pause' : 'play';
  $('#pause').classList.toggle('hidden', !on);
  renderAch();
}
$('#play-btn').addEventListener('click', startGame);
$('#resume-btn').addEventListener('click', () => pause(false));
$('#reset-btn').addEventListener('click', () => { resetCar(true); G.trial.active = false; pause(false); });
$('#pause-btn').addEventListener('click', () => pause(G.state !== 'pause'));
$('#q-btn').addEventListener('click', () => { quality = quality === 'high' ? 'low' : 'high'; store.set('quality', quality); applyQuality(); });
$('#mute-btn').addEventListener('click', () => { audio.setMuted(!audio.muted); store.set('muted', audio.muted); $('#mute-btn').textContent = audio.muted ? 'צליל: כבוי' : 'צליל: פועל'; });
$('#mute-btn').textContent = audio.muted ? 'צליל: כבוי' : 'צליל: פועל';
$('#touch-cam')?.addEventListener('click', () => { G.camMode = (G.camMode + 1) % 3; });
$('#touch-reset')?.addEventListener('click', () => resetCar());
addEventListener('keydown', (e) => { if (e.code === 'Enter' && G.state === 'menu' && !$('#loading').classList.contains('show')) startGame(); });

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let acc = 0;
const DT = 1 / 120;
const idleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, roll: 0 };

function keys() {
  if (input.wasPressed('Escape') || input.wasPressed('KeyP')) pause(G.state === 'play');
  if (G.state !== 'play') return;
  if (input.wasPressed('KeyR')) resetCar();
  if (input.wasPressed('KeyC')) G.camMode = (G.camMode + 1) % 3;
  if (input.wasPressed('KeyM')) { audio.setMuted(!audio.muted); store.set('muted', audio.muted); }
  if (input.wasPressed('KeyT') && G.trial.active) { G.trial.active = false; popup('המקצה בוטל', 'bad'); }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;
  const inp = input.update(dt);
  keys();

  if (G.state === 'play' || G.state === 'menu') {
    const pin = G.state === 'play' ? { ...inp } : idleInput;
    pin.boost = pin.boost && G.nitro > 0.01;
    veh.boostFuel = G.nitro;
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 12) {
      veh.step(DT, pin);
      updateProps(DT);
      acc -= DT; steps++;
    }
    if (steps >= 12) acc = 0;

    if (G.state === 'play') {
      if (veh.boostActive) G.nitro = Math.max(0, G.nitro - dt * 0.3);
      G.boostFlash = Math.max(0, (G.boostFlash || 0) - dt * 1.5);
      G.speedKmh = veh.forwardSpeed * 3.6;
      if (G.speedKmh >= 140) unlock('speed');
      // drift chain
      const c = G.chain;
      const sp = veh.speed;
      const driftingNow = veh.drifting && veh.grounded >= 2 && sp > 6 && Math.abs(veh.slipAngle) > 0.17;
      if (driftingNow) {
        chainAdd(dt * Math.abs(veh.slipAngle) * 57.3 * sp * 0.55);
        c.time += dt;
        c.mult = 1 + Math.min(4, Math.floor(c.time / 2.2));
        G.nitro = Math.min(1, G.nitro + dt * 0.05);
      } else if (c.active && veh.grounded > 0) {
        c.idle += dt;
        if (c.idle > 1.6) bankChain();
      }
      airTrack(dt);
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
      cpCheck();
      if (G.trial.active) {
        G.trial.t += dt;
        if (G.trial.t > 600) G.trial.active = false;
      }
      padCheck(dt);
      wheelFx(dt, inp);
      if (veh.inWater > 0.2 && veh.speed > 4 && Math.random() < 0.6) {
        burst(veh.pos.x, TR.WATER_LEVEL + 0.1, veh.pos.z, 3, [0.9, 0.95, 1], 3);
      }
      // nitro trail
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
  updateCoins(t);
  updateCheckpointVisuals(t);
  particles.update(G.state === 'pause' ? 0 : dt);
  skids.update();
  water.userData.tick(t);
  pads.userData.tick(t);
  updateCamera(dt);

  // shadow camera follows the buggy (snapped to texels to avoid shimmering)
  const texel = 90 / sun.shadow.mapSize.x;
  const fx = Math.round(veh.pos.x / texel) * texel, fz = Math.round(veh.pos.z / texel) * texel;
  sun.position.set(fx + sunDir.x * 120, veh.pos.y + sunDir.y * 120, fz + sunDir.z * 120);
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
renderAch();
$('#loading').classList.remove('show');
$('#menu').classList.remove('hidden');
addEventListener('resize', () => { if (G.state !== 'menu') sizeCanvases(); });
window.__game = { veh, G, cps, camera, scene, renderer, startGame, TR };
frame();
