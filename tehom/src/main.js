import * as THREE from 'three';
import { createRenderer, buildSky, buildStar, buildBodies, updateBodies, buildBelt, paintOwner } from './world.js';
import { FX } from './fx.js';
import { IconLayer, shipAssets, renderPortraits, flickerPlumes } from './ships.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { UI, EMBLEM } from './ui.js';
import { Audio } from './audio.js';
import { DIFFICULTY, FACTIONS } from './data.js';
import { Q, TOUCH } from './quality.js';

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

// ------------------------------------------------------------ order lines + send arc
const MAXL = 1200;
const lineGeo = new THREE.BufferGeometry();
const linePos = new Float32Array(MAXL * 6);
lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: FACTIONS.player.color.clone().multiplyScalar(0.45), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
lines.frustumCulled = false;
scene.add(lines);
const ARC_N = 48;
const arcGeo = new THREE.BufferGeometry().setFromPoints(new Array(ARC_N).fill(0).map(() => new THREE.Vector3()));
const arc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: FACTIONS.player.color.clone().multiplyScalar(2.2), dashSize: 3, gapSize: 2.2, transparent: true, depthTest: false }));
arc.frustumCulled = false; arc.visible = false; arc.renderOrder = 30;
scene.add(arc);

// ------------------------------------------------------------ app state
const rig = {
  target: new THREE.Vector3(-60, 0, 0), yaw: 0.6, pitch: 0.32, dist: 760,
  g: { target: new THREE.Vector3(-60, 0, 0), yaw: 0.6, pitch: 0.32, dist: 760 },
  follow: null,
};
const app = {
  scene, camera, bodies, fx, audio, rig,
  game: null, ai: [], ui: null,
  sel: { body: null, ships: new Set() },
  speed: 1, paused: false, demo: true, diff: DIFFICULTY[1],
  portraits: {}, sendHover: null,
};
window.__tehom = app;

function resetBodies() {
  for (const b of bodies) {
    b.owner = b.home || 'neutral'; b.control = 100; b.capBy = null;
    b.structures = { yard: b.home ? 1 : 0, mine: 0, battery: b.home ? 1 : 0 };
    b.building = null; b.queue = []; b.native = b.garrison || (b.home ? 0 : 1);
    b.contested = false; b.count = { player: 0, enemy: 0 }; b.alarmT = -99;
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
    if (type === 'flare') { flareFlash = 1; fx.shake = Math.min(1.5, fx.shake + 0.8); audio.boom(4, 200); }
    if (app.demo) return;
    if (type === 'log') app.ui.say(data.text, { kind: data.kind });
    if (type === 'attacked') app.ui.say(`${data.name} תחת התקפה.`, { kind: 'bad', acts: [{ label: 'קפוץ לשם', fn: () => focusBody(data) }] });
    if (type === 'flare-warn') app.ui.say('הגחלת עומדת להתפרץ. כל ספינה קרובה למרכז תיפגע — הרחיקו ציים.', { kind: 'bad', from: 'מצפה כוכבים' });
    if (type === 'flare') app.ui.say('התפרצות. גל החום עובר במסלולים הפנימיים.', { kind: 'bad', from: 'מצפה כוכבים', ttl: 6 });
    if (type === 'owner' && data.owner === 'player') app.ui.flag('captured');
    if (type === 'end') endGame(data);
    if (type === 'dead') app.sel.ships.delete(data);
  });
  if (!app.ui) app.ui = new UI(app);
  return game;
}
let flareFlash = 0;

// ------------------------------------------------------------ camera rig
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
  if (fx.shake > 0.01) camera.position.add(_shake.randomDirection().multiplyScalar(fx.shake * 0.8));
  camera.lookAt(rig.target);
}
const _shake = new THREE.Vector3();
function flyTo(pos, dist, follow = null) { rig.g.target.copy(pos); if (dist) rig.g.dist = dist; rig.follow = follow; }
function focusBody(b) { flyTo(b.pos, Math.max(b.r * 10, 90), b); }
app.flyTo = flyTo;
app.panTo = (x, z) => { rig.follow = null; rig.g.target.set(x, 0, z); };

// ------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _p = new THREE.Vector3();
function screenOf(v) { _p.copy(v).project(camera); return { x: (_p.x + 1) / 2 * innerWidth, y: (1 - _p.y) / 2 * innerHeight, z: _p.z }; }
const pickSlack = TOUCH ? 30 : 16;
function pickBody(x, y) {
  let best = null, bd = Infinity;
  const k = (innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const b of bodies) {
    const s = screenOf(b.pos);
    if (s.z > 1) continue;
    const rp = b.r * k / camera.position.distanceTo(b.pos);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < Math.max(rp + 8, pickSlack) && d - rp < bd) { bd = d - rp; best = b; }
  }
  return best;
}
function pickShip(x, y) {
  let best = null, bd = TOUCH ? 22 : 12;
  for (const s of app.game.ships) {
    if (s.faction !== 'player') continue;
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
const shipsAt = (b) => app.game.ships.filter((s) => s.faction === 'player' && s.pos.distanceTo(b.pos) < b.captureR + 6);

// ------------------------------------------------------------ selection & commands
function setSel(list, add) {
  const sel = app.sel;
  if (!add) { sel.ships.forEach((s) => (s.selected = false)); sel.ships.clear(); }
  for (const s of list) { sel.ships.add(s); s.selected = true; }
}
function selectBody(b, add) {
  app.sel.body = b;
  const here = b ? shipsAt(b) : [];
  // a world with none of our ships keeps the current fleet selected, so it can be sent there
  if (here.length || add || !app.sel.ships.size) setSel(here, add);
  if (b && b.home === 'player') app.ui.flag('selectHome');
  audio.ui('tick');
}
app.deselect = () => { setSel([], false); app.sel.body = null; audio.ui('tick'); };
app.filterSelection = (cls) => {
  for (const s of [...app.sel.ships]) if (s.cls !== cls) { s.selected = false; app.sel.ships.delete(s); }
  audio.ui('tick');
};
app.queueShip = (cls) => {
  const b = app.sel.body;
  if (!b || b.owner !== 'player' || !b.structures.yard) { audio.ui('deny'); return; }
  if (app.game.queueShip(b, cls, 'player')) { audio.ui('confirm'); app.ui.flag('queued'); app.ui.flashShip(cls); }
  else { audio.ui('deny'); app.ui.deny(); }
};
function send(ships, b) {
  ships = ships.filter((s) => !s.dead);
  if (!ships.length || !b) return false;
  app.game.order(ships, { type: 'body', body: b });
  fx.shocks.add(b.pos, b.captureR * 0.9, FACTIONS.player.color.clone().multiplyScalar(0.35), 0.7);
  audio.ui('confirm');
  app.ui.flag('ordered');
  return true;
}
app.dispatchTo = (b) => { send([...app.sel.ships].filter((s) => s.host !== b), b); };
function command(x, y) {
  const ships = [...app.sel.ships].filter((s) => !s.dead);
  if (!ships.length) return;
  const b = pickBody(x, y);
  if (b) { send(ships, b); return; }
  const avgY = ships.reduce((a, s) => a + s.pos.y, 0) / ships.length;
  const p = groundAt(x, y, avgY);
  if (!p || p.length() > 1400) return;
  app.game.order(ships, { type: 'point', point: p });
  fx.shocks.add(p, 10, FACTIONS.player.color.clone().multiplyScalar(0.35), 0.6);
  audio.ui('confirm');
  app.ui.flag('ordered');
}

// ------------------------------------------------------------ input: mouse + touch through pointer events
const boxEl = $('#box');
const tagEl = $('#sendtag');
const ptrs = new Map();
let act = null;       // the gesture in progress
let gesture = null;   // two-finger state
let lastTap = { t: 0, x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.start();
  if (app.demo) return;
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    // two fingers: pinch to zoom, twist to rotate, slide together to tilt
    endSend(false);
    act = null; boxEl.style.display = 'none';
    const [a, b] = [...ptrs.values()];
    gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2, mx: (a.x + b.x) / 2, dist: rig.g.dist, yaw: rig.g.yaw, pitch: rig.g.pitch };
    return;
  }
  if (ptrs.size > 2) return;
  const touch = e.pointerType !== 'mouse';
  const btn = touch ? 0 : e.button;
  const b = btn === 0 ? pickBody(e.clientX, e.clientY) : null;
  let from = null;
  if (b && (shipsAt(b).length || (app.sel.body === b && app.sel.ships.size))) from = b;
  act = {
    x: e.clientX, y: e.clientY, btn, touch, moved: false, from, shift: e.shiftKey,
    yaw: rig.g.yaw, pitch: rig.g.pitch, lx: e.clientX, ly: e.clientY,
    kind: btn === 2 ? 'rotate' : btn === 1 ? 'pan' : from ? 'send' : touch ? 'pan' : 'box',
  };
});
canvas.addEventListener('pointermove', (e) => {
  if (app.demo) return;
  const P = ptrs.get(e.pointerId);
  if (P) { P.x = e.clientX; P.y = e.clientY; }
  if (gesture && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    rig.g.dist = THREE.MathUtils.clamp(gesture.dist * gesture.d / Math.max(d, 10), 22, 1500);
    rig.g.yaw = gesture.yaw + (ang - gesture.ang);
    rig.g.pitch = THREE.MathUtils.clamp(gesture.pitch + ((a.y + b.y) / 2 - gesture.my) * 0.004, 0.06, 1.48);
    return;
  }
  if (!act) {
    if (e.pointerType === 'mouse') canvas.style.cursor = pickBody(e.clientX, e.clientY) ? 'pointer' : 'default';
    return;
  }
  const dx = e.clientX - act.x, dy = e.clientY - act.y;
  if (!act.moved && Math.hypot(dx, dy) > (act.touch ? 10 : 5)) act.moved = true;
  const mx = e.clientX - act.lx, my = e.clientY - act.ly;
  act.lx = e.clientX; act.ly = e.clientY;
  if (!act.moved) return;
  if (act.kind === 'rotate') {
    rig.g.yaw = act.yaw - dx * 0.0055;
    rig.g.pitch = THREE.MathUtils.clamp(act.pitch + dy * 0.0045, 0.06, 1.48);
  } else if (act.kind === 'pan') {
    pan(-mx, -my, act.touch ? 1.15 : 1);
  } else if (act.kind === 'box') {
    const x0 = Math.min(act.x, e.clientX), y0 = Math.min(act.y, e.clientY);
    Object.assign(boxEl.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
  } else if (act.kind === 'send') {
    updateSend(e.clientX, e.clientY);
  }
});
function up(e) {
  ptrs.delete(e.pointerId);
  if (gesture) { if (ptrs.size < 2) gesture = null; act = null; return; }
  if (!act || app.demo) { act = null; return; }
  const a = act; act = null;
  boxEl.style.display = 'none';
  if (a.kind === 'send' && a.moved) { endSend(true, e.clientX, e.clientY, a); return; }
  if (a.moved) {
    if (a.kind === 'box') {
      const x0 = Math.min(a.x, e.clientX), x1 = Math.max(a.x, e.clientX), y0 = Math.min(a.y, e.clientY), y1 = Math.max(a.y, e.clientY);
      const list = app.game.ships.filter((s) => {
        if (s.faction !== 'player') return false;
        const p = screenOf(s.pos);
        return p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      });
      if (!a.shift) app.sel.body = null;
      setSel(list, a.shift);
      if (list.length) audio.ui('tick');
    }
    return;
  }
  // a tap / click
  if (a.btn === 2) { command(e.clientX, e.clientY); return; }
  if (a.btn !== 0) return;
  const now = performance.now();
  const dbl = now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  const b = pickBody(e.clientX, e.clientY);
  if (dbl && b) { focusBody(b); return; }
  const s = pickShip(e.clientX, e.clientY);
  if (b && (!s || camera.position.distanceTo(b.pos) > 160)) selectBody(b, a.shift);
  else if (s) { app.sel.body = null; setSel([s], a.shift); audio.ui('tick'); }
  else if (!a.shift) { setSel([], false); app.sel.body = null; }
}
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);

function sendShips(from) {
  const sel = [...app.sel.ships].filter((s) => !s.dead);
  if (app.sel.body === from && sel.length) return sel;
  const here = shipsAt(from);
  const chosen = here.filter((s) => s.selected);
  return chosen.length ? chosen : here;
}
function updateSend(x, y) {
  const from = act.from;
  const ships = sendShips(from);
  const to = pickBody(x, y);
  app.sendHover = to && to !== from ? to : null;
  const end = app.sendHover ? app.sendHover.pos : (groundAt(x, y, from.pos.y) || from.pos);
  const mid = _p.copy(from.pos).add(end).multiplyScalar(0.5);
  mid.y += from.pos.distanceTo(end) * 0.22;
  const pts = arcGeo.attributes.position;
  for (let i = 0; i < ARC_N; i++) {
    const t = i / (ARC_N - 1), u = 1 - t;
    pts.setXYZ(i, u * u * from.pos.x + 2 * u * t * mid.x + t * t * end.x, u * u * from.pos.y + 2 * u * t * mid.y + t * t * end.y, u * u * from.pos.z + 2 * u * t * mid.z + t * t * end.z);
  }
  pts.needsUpdate = true;
  arc.computeLineDistances();
  arc.visible = true;
  tagEl.classList.remove('off');
  tagEl.classList.toggle('miss', !app.sendHover);
  tagEl.textContent = app.sendHover ? `${ships.length} ← ${app.sendHover.name}` : `${ships.length} ספינות · גררו אל עולם`;
  tagEl.style.left = x + 'px'; tagEl.style.top = y + 'px';
}
function endSend(commit, x, y, a) {
  arc.visible = false; tagEl.classList.add('off');
  const to = app.sendHover; app.sendHover = null;
  if (!commit || !a) return;
  if (to && to !== a.from) {
    const ships = sendShips(a.from);
    if (send(ships, to)) { setSel(ships, false); app.sel.body = to; }
  }
}

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
  const fw = _fw.set(-Math.sin(rig.g.yaw), 0, -Math.cos(rig.g.yaw));
  const rt = _rt.set(Math.cos(rig.g.yaw), 0, -Math.sin(rig.g.yaw));
  rig.g.target.addScaledVector(rt, dx * s).addScaledVector(fw, -dy * s);
  if (rig.g.target.length() > 900) rig.g.target.setLength(900);
}
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3();

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
  if (e.code === 'KeyM') $('#mute').classList.toggle('muted', audio.toggle());
  if (e.code === 'Escape') app.deselect();
  if (e.code === 'KeyF') {
    const list = [...app.sel.ships];
    if (list.length) { const c = list.reduce((v, s) => v.add(s.pos), new THREE.Vector3()).multiplyScalar(1 / list.length); flyTo(c, 140); }
    else if (app.sel.body) focusBody(app.sel.body);
  }
  if (e.code === 'KeyH') { const h = bodies.find((b) => b.home === 'player'); flyTo(h.pos, 260, h); }
  if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.sel.body = null; setSel(app.game.ships.filter((s) => s.faction === 'player'), false); }
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
$('#keys').innerHTML = (TOUCH ? [
  ['נגיעה', 'בחירת עולם והצי שבמסלולו'], ['גרירה מעולם לעולם', 'שיגור הצי'], ['גרירה בחלל', 'הזזת המפה'],
  ['צביטה · סיבוב בשתי אצבעות', 'זום · סיבוב המצלמה'], ['שתי אצבעות למעלה/למטה', 'הטיית המצלמה'], ['נגיעה כפולה', 'מעקב אחרי עולם'],
] : [
  ['קליק', 'בחירת עולם והצי שבמסלולו'], ['גרירה מעולם לעולם', 'שיגור מהיר'], ['קליק ימני', 'שיגור הנבחרים ליעד'],
  ['גרירה ימנית · גלגלת', 'סיבוב · זום'], ['WASD · גרירה', 'הזזה · בחירה במלבן'], ['Z X C', 'צרעה · חנית · מצודה'],
  ['רווח · 1 2 3', 'עצירה · מהירות'], ['F · H', 'מיקוד · חזרה לבית'],
]).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');

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
  rig.g.pitch = 0.45;
  flyTo(home.pos, TOUCH ? 340 : 300, null);
  setSpeed(1);
  try { if (TOUCH && document.documentElement.requestFullscreen && innerWidth < 900) document.documentElement.requestFullscreen().catch(() => {}); } catch (err) { /* optional */ }
  app.ui.say('המערכה החלה. אופל מתבצר מעבר לגחלת, על אוֹפֶל.', { ttl: 7 });
  setTimeout(() => app.ui.startTutorial(), 1200);
});
$('#again').addEventListener('click', () => location.reload());

function endGame(result) {
  const g = app.game;
  const win = result === 'win';
  const el = $('#end');
  el.classList.remove('off'); el.classList.toggle('win', win);
  $('#end-emblem').innerHTML = EMBLEM[win ? 'player' : 'enemy'];
  $('#end-emblem').style.color = win ? 'var(--p)' : 'var(--e)';
  $('#end-kicker').innerHTML = `<span class="num">${String(Math.floor(g.time / 60)).padStart(2, '0')}:${String(Math.floor(g.time % 60)).padStart(2, '0')}</span><span>סוף המערכה · ${app.diff.name}</span>`;
  $('#end-title').textContent = win ? 'ניצחון' : 'תבוסה';
  $('#end-text').textContent = win ? 'אחרון העולמות של אופל נפל. הגחלת שוב שקטה — לעת עתה.' : 'העולם האחרון של המשמרת נפל. מה שנשאר מהצי נסוג אל החושך.';
  const P = g.factions.player;
  $('#end-stats').innerHTML = [[P.built, 'ספינות נבנו'], [P.killed, 'ספינות אויב הושמדו'], [P.lost, 'ספינות אבדו'], [`${g.bodyOf('player').length}/${bodies.length}`, 'עולמות בשליטה']]
    .map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
  $('#hud').classList.add('off'); $('#labels').classList.add('off');
  document.body.classList.remove('sheet', 'fleetbar');
  rig.follow = null; rig.g.target.set(0, 0, 0); rig.g.dist = 820; rig.g.pitch = 0.4;
}

// ------------------------------------------------------------ loop
newGame(DIFFICULTY[1], true);
rig.g.yaw = rig.yaw = 0.6;
if (TOUCH && innerWidth < 760) { rig.g.target.set(0, 0, 60); rig.target.copy(rig.g.target); rig.g.dist = rig.dist = 980; rig.g.pitch = rig.pitch = 0.62; }

// portraits are rendered once the first frame is on screen
requestAnimationFrame(() => setTimeout(() => {
  app.portraits = renderPortraits('player');
  if (app.ui) { app.ui.dzKey = ''; app.ui.fleetKey = ''; }
}, 60));

let lastT = performance.now(), real = 0, viewOff = 0;
// frame-time governor
let gAcc = 0, gN = 0, gCool = 3;
function governor(rdt) {
  gAcc += rdt; gN++; gCool -= rdt;
  if (gAcc < 2) return;
  const avg = gAcc / gN; gAcc = 0; gN = 0;
  if (gCool > 0 || Q.tier === 0) return;
  let pr = R.pixelRatio;
  if (avg > 1 / 40 && pr > 0.7) pr = Math.max(0.7, pr - 0.2);
  else if (avg < 1 / 57 && pr < Math.min(Q.maxPR, devicePixelRatio || 1)) pr = Math.min(Q.maxPR, pr + 0.1);
  else return;
  R.setPixelRatio(pr); icons.setPR(pr); gCool = 4;
}

const _db = new THREE.Vector2(), _sun = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const rdt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
  real += rdt;
  governor(rdt);
  const g = app.game;
  const dt = app.paused ? 0 : rdt * (app.demo ? 1.6 : app.speed);
  const steps = Math.max(1, Math.ceil(dt / 0.034));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    updateBodies(bodies, h, g.time);
    if (h > 0) { g.update(h); for (const a of app.ai) a.update(h); }
  }
  if (app.demo) {
    rig.g.yaw += rdt * 0.022;
    if (g.over || g.time > 420) newGame(DIFFICULTY[1], true);
  } else {
    const ks = rdt * 900;
    let px = 0, py = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) px -= ks;
    if (keys.has('KeyD') || keys.has('ArrowRight')) px += ks;
    if (keys.has('KeyW') || keys.has('ArrowUp')) py -= ks;
    if (keys.has('KeyS') || keys.has('ArrowDown')) py += ks;
    if ((px || py) && !(keys.has('ControlLeft') || keys.has('MetaLeft'))) pan(px, py, 1);
  }
  flareFlash = Math.max(0, flareFlash - rdt * 0.6);
  star.update(g.time + 30, camera, flareFlash);
  belt.update(rdt, g.time + 100);
  updateCamera(rdt);
  // keep the selected world visible above the phone's bottom sheet
  const sheet = document.body.classList.contains('sheet') && innerWidth < 760 ? $('#dossier').offsetHeight : 0;
  viewOff += (Math.max(0, sheet - 115) * 0.5 - viewOff) * (1 - Math.exp(-rdt * 8));
  if (viewOff > 0.5) camera.setViewOffset(innerWidth, innerHeight, 0, viewOff, innerWidth, innerHeight);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  sky.update(real, camera.position);
  const s = renderer.getDrawingBufferSize(_db);
  fx.update(dt, g.time, s.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), camera);
  flickerPlumes(real);
  icons.update(g.ships);
  drawOrders();
  if (!app.demo) app.ui.update(rdt);
  // anamorphic streak follows the star on screen
  _sun.set(0, 0, 0).project(camera);
  const on = _sun.z < 1 ? THREE.MathUtils.smoothstep(1.3 - Math.max(Math.abs(_sun.x), Math.abs(_sun.y)), 0, 0.4) : 0;
  const far = THREE.MathUtils.smoothstep(camera.position.length(), 120, 600);
  grade.uniforms.uSun.value.set((_sun.x + 1) / 2, (_sun.y + 1) / 2, on * (0.35 + 0.65 * far) + flareFlash * 1.5);
  grade.uniforms.uFlash.value = flareFlash * 0.8;
  grade.uniforms.uTime.value = real;
  composer.render();
}
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
