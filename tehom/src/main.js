import * as THREE from 'three';
import { createRenderer, buildSky, buildStar, buildBodies, updateBodies, buildBelt, paintOwner } from './world.js';
import { FX } from './fx.js';
import { IconLayer, shipAssets } from './ships.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { DIFFICULTY, SHIPS, FACTIONS } from './data.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const R = createRenderer(canvas);
const { renderer, scene, camera, composer, grade } = R;
const sky = buildSky(renderer, scene);
const star = buildStar(scene);
const bodies = buildBodies(scene);
const belt = buildBelt(scene);
const fx = new FX(scene);
const icons = new IconLayer(scene, R.pixelRatio);
const audio = new Audio();
for (const c of ['corvette', 'frigate', 'dreadnought']) for (const f of ['player', 'enemy']) shipAssets(c, f);

// ------------------------------------------------------------ order lines
const MAXL = 1200;
const lineGeo = new THREE.BufferGeometry();
const linePos = new Float32Array(MAXL * 6);
lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: FACTIONS.player.color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
lines.frustumCulled = false;
scene.add(lines);

// ------------------------------------------------------------ app state
const app = {
  scene, camera, bodies, fx, audio,
  game: null, ai: [], ui: null,
  sel: { body: null, ships: new Set() },
  speed: 1, paused: false, demo: true, diff: DIFFICULTY[1],
};
window.__tehom = app;
app.flyTo = (...a) => flyTo(...a);

function resetBodies() {
  for (const b of bodies) {
    b.owner = b.home || 'neutral'; b.control = 100; b.capBy = null;
    b.structures = { yard: b.home ? 1 : 0, mine: 0, battery: b.home ? 1 : 0 };
    b.building = null; b.queue = []; b.native = b.garrison || (b.home ? 0 : 1);
    b.contested = false; b.count = { player: 0, enemy: 0 };
    paintOwner(b);
  }
}

function newGame(diff, demo) {
  if (app.game) for (const s of app.game.ships) s.remove(scene);
  resetBodies();
  app.demo = demo;
  app.diff = diff;
  const game = new Game({ scene, fx, bodies, audio, camera, difficulty: diff });
  app.game = game;
  for (const f of ['player', 'enemy']) {
    const home = bodies.find((b) => b.home === f);
    game.spawn('corvette', f, home, 6);
    game.spawn('frigate', f, home, 2);
  }
  app.ai = [new AI(game, 'enemy', diff)];
  if (demo) app.ai.push(new AI(game, 'player', DIFFICULTY[1]));
  app.sel.body = null; app.sel.ships.clear();
  game.on((type, data) => {
    if (app.demo) return;
    if (type === 'log') app.ui.log(data.text, data.kind);
    if (type === 'owner' && data.owner === 'player') app.ui.flag('captured');
    if (type === 'end') endGame(data);
    if (type === 'dead') app.sel.ships.delete(data);
  });
  if (!app.ui) app.ui = new UI(app);
  return game;
}

// ------------------------------------------------------------ camera rig
const rig = {
  target: new THREE.Vector3(), yaw: 0.6, pitch: 0.55, dist: 900,
  g: { target: new THREE.Vector3(), yaw: 0.6, pitch: 0.55, dist: 900 },
  follow: null,
};
function updateCamera(dt) {
  const g = rig.g;
  if (rig.follow) g.target.copy(rig.follow.pos);
  const k1 = 1 - Math.exp(-dt * (rig.follow ? 10 : 6)), k2 = 1 - Math.exp(-dt * 8);
  rig.target.lerp(g.target, k1);
  rig.yaw += (g.yaw - rig.yaw) * k2;
  rig.pitch += (g.pitch - rig.pitch) * k2;
  rig.dist += (g.dist - rig.dist) * k2;
  const cp = Math.cos(rig.pitch);
  camera.position.set(Math.sin(rig.yaw) * cp, Math.sin(rig.pitch), Math.cos(rig.yaw) * cp).multiplyScalar(rig.dist).add(rig.target);
  if (fx.shake > 0.01) camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(fx.shake * 0.8));
  camera.lookAt(rig.target);
}
function flyTo(pos, dist, follow = null) {
  rig.g.target.copy(pos); if (dist) rig.g.dist = dist; rig.follow = follow;
}

// ------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _p = new THREE.Vector3();
function screenOf(v) {
  _p.copy(v).project(camera);
  return { x: (_p.x + 1) / 2 * innerWidth, y: (1 - _p.y) / 2 * innerHeight, z: _p.z };
}
function pickBody(x, y) {
  let best = null, bd = Infinity;
  const k = (innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const b of bodies) {
    const s = screenOf(b.pos);
    if (s.z > 1) continue;
    const rp = b.r * k / camera.position.distanceTo(b.pos);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < Math.max(rp + 6, 16) && d < bd) { bd = d; best = b; }
  }
  return best;
}
function pickShip(x, y, faction = 'player') {
  let best = null, bd = 12;
  for (const s of app.game.ships) {
    if (s.faction !== faction) continue;
    const p = screenOf(s.pos);
    if (p.z > 1) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function groundAt(x, y, h = 0) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const t = (h - ray.ray.origin.y) / ray.ray.direction.y;
  if (!isFinite(t) || t < 0) return null;
  return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
}

// ------------------------------------------------------------ selection & commands
function selectBody(b, add) {
  const sel = app.sel;
  if (!add) sel.ships.forEach((s) => (s.selected = false)), sel.ships.clear();
  sel.body = b;
  if (b) {
    for (const s of app.game.ships) {
      if (s.faction === 'player' && s.pos.distanceTo(b.pos) < b.captureR + 6) { sel.ships.add(s); s.selected = true; }
    }
    if (b.home === 'player') app.ui.flag('selectHome');
  }
  audio.ui('tick');
}
function selectShips(list, add) {
  const sel = app.sel;
  if (!add) { sel.ships.forEach((s) => (s.selected = false)); sel.ships.clear(); }
  for (const s of list) { sel.ships.add(s); s.selected = true; }
  if (list.length) audio.ui('tick');
}
app.filterSelection = (cls) => {
  for (const s of [...app.sel.ships]) if (s.cls !== cls) { s.selected = false; app.sel.ships.delete(s); }
  audio.ui('tick');
};
app.queueShip = (cls) => {
  const b = app.sel.body;
  if (!b || b.owner !== 'player' || !b.structures.yard) { audio.ui('deny'); return; }
  if (app.game.queueShip(b, cls, 'player')) { audio.ui('confirm'); app.ui.flag('queued'); app.ui.flashShip(cls); }
  else audio.ui('deny');
};
function command(x, y) {
  const ships = [...app.sel.ships].filter((s) => !s.dead);
  if (!ships.length) return;
  const b = pickBody(x, y);
  if (b) {
    app.game.order(ships, { type: 'body', body: b });
    fx.shocks.add(b.pos, b.captureR * 0.9, FACTIONS.player.color.clone().multiplyScalar(0.35), 0.7);
  } else {
    const avgY = ships.reduce((a, s) => a + s.pos.y, 0) / ships.length;
    const p = groundAt(x, y, avgY);
    if (!p || p.length() > 1400) return;
    app.game.order(ships, { type: 'point', point: p });
    fx.shocks.add(p, 10, FACTIONS.player.color.clone().multiplyScalar(0.35), 0.6);
  }
  audio.ui('confirm');
  app.ui.flag('ordered');
}

// ------------------------------------------------------------ input
const boxEl = $('#box');
let down = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.start();
  if (app.demo) return;
  canvas.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY, b: e.button, moved: false, yaw: rig.g.yaw, pitch: rig.g.pitch, shift: e.shiftKey, t: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (app.demo) return;
  if (!down) {
    canvas.style.cursor = pickBody(e.clientX, e.clientY) ? 'pointer' : 'default';
    return;
  }
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (Math.hypot(dx, dy) > 5) down.moved = true;
  if (down.b === 2 && down.moved) {
    rig.g.yaw = down.yaw - dx * 0.0055;
    rig.g.pitch = THREE.MathUtils.clamp(down.pitch + dy * 0.0045, 0.06, 1.48);
  } else if (down.b === 1) {
    pan(-e.movementX, -e.movementY, 1);
  } else if (down.b === 0 && down.moved) {
    const x0 = Math.min(down.x, e.clientX), y0 = Math.min(down.y, e.clientY);
    Object.assign(boxEl.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || app.demo) { down = null; return; }
  const d = down; down = null;
  boxEl.style.display = 'none';
  if (d.b === 0) {
    if (!d.moved) {
      const s = pickShip(e.clientX, e.clientY);
      const b = pickBody(e.clientX, e.clientY);
      if (b && (!s || camera.position.distanceTo(b.pos) > 160)) selectBody(b, e.shiftKey);
      else if (s) { app.sel.body = null; selectShips([s], e.shiftKey); }
      else if (!e.shiftKey) { selectShips([], false); app.sel.body = null; }
    } else {
      const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
      const list = app.game.ships.filter((s) => {
        if (s.faction !== 'player') return false;
        const p = screenOf(s.pos);
        return p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      });
      if (!e.shiftKey) app.sel.body = null;
      selectShips(list, e.shiftKey);
    }
  } else if (d.b === 2 && !d.moved) command(e.clientX, e.clientY);
});
canvas.addEventListener('dblclick', (e) => {
  if (app.demo) return;
  const b = pickBody(e.clientX, e.clientY);
  if (b) flyTo(b.pos, Math.max(b.r * 9, 70), b);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (app.demo) return;
  const old = rig.g.dist;
  rig.g.dist = THREE.MathUtils.clamp(old * Math.exp(e.deltaY * 0.0011), 22, 1500);
  if (rig.g.dist < old && !rig.follow) {
    const p = groundAt(e.clientX, e.clientY, rig.g.target.y);
    if (p) rig.g.target.lerp(p, (1 - rig.g.dist / old) * 0.9);
  }
}, { passive: false });

function pan(dx, dy, scale) {
  rig.follow = null;
  const s = rig.g.dist * 0.0016 * scale;
  const fw = new THREE.Vector3(-Math.sin(rig.g.yaw), 0, -Math.cos(rig.g.yaw));
  const rt = new THREE.Vector3(Math.cos(rig.g.yaw), 0, -Math.sin(rig.g.yaw));
  rig.g.target.addScaledVector(rt, dx * s).addScaledVector(fw, -dy * s);
  if (rig.g.target.length() > 900) rig.g.target.setLength(900);
}
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (app.demo) return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); setSpeed(app.paused ? app.speed : 0); }
  if (e.code === 'Digit1') setSpeed(1);
  if (e.code === 'Digit2') setSpeed(2);
  if (e.code === 'Digit3') setSpeed(3);
  if (e.code === 'KeyZ') app.queueShip('corvette');
  if (e.code === 'KeyX') app.queueShip('frigate');
  if (e.code === 'KeyC') app.queueShip('dreadnought');
  if (e.code === 'KeyM') { $('#mute').classList.toggle('muted', audio.toggle()); }
  if (e.code === 'Escape') { selectShips([], false); app.sel.body = null; }
  if (e.code === 'KeyF') {
    const list = [...app.sel.ships];
    if (list.length) { const c = list.reduce((v, s) => v.add(s.pos), new THREE.Vector3()).multiplyScalar(1 / list.length); flyTo(c, 140); }
    else if (app.sel.body) flyTo(app.sel.body.pos, Math.max(app.sel.body.r * 9, 70), app.sel.body);
  }
  if (e.code === 'KeyH') { const h = bodies.find((b) => b.home === 'player'); flyTo(h.pos, 260, h); }
  if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.sel.body = null; selectShips(app.game.ships.filter((s) => s.faction === 'player'), false); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function setSpeed(s) {
  if (s === 0) app.paused = true; else { app.paused = false; app.speed = s; }
  document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.s === (app.paused ? 0 : app.speed)));
  $('#pausestamp').classList.toggle('off', !app.paused);
  audio.ui('tick');
}
document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
$('#mute').addEventListener('click', () => $('#mute').classList.toggle('muted', audio.toggle()));

// ------------------------------------------------------------ intro / end
const diffEl = $('#diff');
diffEl.innerHTML = DIFFICULTY.map((d, i) => `<button data-i="${i}" class="${i === 1 ? 'on' : ''}"><span class="num">0${i + 1}</span><b>${d.name}</b><span>${d.note}</span></button>`).join('');
let chosen = DIFFICULTY[1];
diffEl.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  chosen = DIFFICULTY[+b.dataset.i];
  diffEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  audio.start(); audio.ui('tick');
});
$('#start').addEventListener('click', () => {
  audio.start(); audio.ui('confirm');
  $('#intro').classList.add('leaving');
  setTimeout(() => $('#intro').classList.add('off'), 1100);
  newGame(chosen, false);
  $('#hud').classList.remove('off');
  $('#labels').classList.remove('off');
  const home = bodies.find((b) => b.home === 'player');
  rig.g.yaw = Math.atan2(home.pos.x, home.pos.z) + 1.3;
  rig.g.pitch = 0.42;
  flyTo(home.pos, 300, null);
  setTimeout(() => { rig.follow = null; }, 10);
  setSpeed(1);
  app.ui.startHints();
  app.ui.log('המערכה החלה. אופל מתבצר מעבר לגחלת.', '');
});
$('#again').addEventListener('click', () => location.reload());

function endGame(result) {
  const g = app.game;
  const win = result === 'win';
  const el = $('#end');
  el.classList.remove('off'); el.classList.toggle('win', win);
  $('#end-kicker').innerHTML = `<span class="num">${String(Math.floor(g.time / 60)).padStart(2, '0')}:${String(Math.floor(g.time % 60)).padStart(2, '0')}</span> סוף המערכה · ${app.diff.name}`;
  $('#end-title').textContent = win ? 'ניצחון' : 'תבוסה';
  $('#end-text').textContent = win ? 'אחרון העולמות של אופל נפל. הגחלת שוב שקטה — לעת עתה.' : 'העולם האחרון של המשמרת נפל. מה שנשאר מהצי נסוג אל החושך.';
  const P = g.factions.player, E = g.factions.enemy;
  $('#end-stats').innerHTML = [
    ['ספינות שנבנו', P.built], ['ספינות אויב שהושמדו', P.killed], ['ספינות שאבדו', P.lost],
    ['עולמות בשליטה', `${g.bodyOf('player').length}/${bodies.length}`],
  ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`).join('');
  $('#hud').classList.add('off');
  rig.follow = null; rig.g.target.set(0, 0, 0); rig.g.dist = 820; rig.g.pitch = 0.4;
}

// ------------------------------------------------------------ loop
newGame(DIFFICULTY[1], true);
rig.g.dist = rig.dist = 760; rig.g.pitch = rig.pitch = 0.32;
rig.g.target.set(-60, 0, 0); rig.target.copy(rig.g.target);

let lastT = performance.now();
let real = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const rdt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
  real += rdt;
  const g = app.game;
  let dt = app.paused ? 0 : rdt * (app.demo ? 1.6 : app.speed);
  // sub-step for stability at high speed
  const steps = Math.max(1, Math.ceil(dt / 0.034));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    updateBodies(bodies, h, g.time);
    if (h > 0) { g.update(h); for (const a of app.ai) a.update(h); }
  }
  if (app.demo) {
    rig.g.yaw += rdt * 0.022;
    if (g.over || g.time > 420) { newGame(DIFFICULTY[1], true); }
  } else {
    // keyboard pan
    const ks = rdt * 900;
    let px = 0, py = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) px -= ks;
    if (keys.has('KeyD') || keys.has('ArrowRight')) px += ks;
    if (keys.has('KeyW') || keys.has('ArrowUp')) py -= ks;
    if (keys.has('KeyS') || keys.has('ArrowDown')) py += ks;
    if ((px || py) && !(keys.has('ControlLeft') || keys.has('MetaLeft'))) pan(px, py, 1);
  }
  star.update(g.time + 30, camera);
  belt.update(rdt, g.time + 100);
  updateCamera(rdt);
  sky.update(real, camera.position);
  const s = renderer.getDrawingBufferSize(_db);
  fx.update(dt, g.time, s.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  icons.update(g.ships);
  drawOrders();
  if (!app.demo) app.ui.update(rdt);
  else app.ui.update(0);
  grade.uniforms.uTime.value = real;
  composer.render();
}
const _db = new THREE.Vector2();
function drawOrders() {
  let n = 0;
  for (const s of app.sel.ships) {
    if (s.dead || !s.order || n >= MAXL) continue;
    const to = s.order.type === 'body' ? s.order.body.pos : s.order.point;
    linePos.set([s.pos.x, s.pos.y, s.pos.z, to.x, to.y, to.z], n * 6); n++;
  }
  lineGeo.setDrawRange(0, n * 2);
  lineGeo.attributes.position.needsUpdate = true;
}
frame();
