import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, REALMS, SECTOR } from './world.js';
import { Hero, Fairy } from './hero.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
document.body.classList.toggle('touch', isTouch);

const PRESETS = {
  high: { pr: 2, shadows: 2048, bloom: true, msaa: 4, grass: 20000, terrainSeg: 220, props: 1 },
  medium: { pr: 1.5, shadows: 1024, bloom: true, msaa: 0, grass: 9000, terrainSeg: 170, props: 0.8 },
  low: { pr: 1, shadows: 0, bloom: false, msaa: 0, grass: 3000, terrainSeg: 110, props: 0.55 },
};
const Q_NAMES = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
let qName = localStorage.getItem('aeth-q'); if (!PRESETS[qName]) qName = isTouch ? 'medium' : 'high';
const Q = PRESETS[qName];

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !!Q.shadows; renderer.shadowMap.type = THREE.PCFShadowMap;
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 1500);
let composer, bloom;
if (Q.bloom) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
const pointScale = () => renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  if (fx) fx.uScale.value = pointScale();
}
addEventListener('resize', onResize);

// ---------- globals ----------
let world, hero, fairy, enemies, fx; const sound = new Sound();
let state = 'loading', time = 0, last = performance.now(), hitstop = 0, shake = 0;
let camYaw = 0, camPitch = 0.32, camDist = isTouch ? 10.5 : 9.5;
const camTarget = new THREE.Vector3();
const game = { talked: false, collected: [false, false, false, false, false], kills: 0, start: 0, bossDown: false, won: false, curRealm: -1, msgCD: 0, deathT: 0, cine: 0 };
const pickups = [];
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

// ---------- boot ----------
function setLoad(p, txt) { $('loadbar').style.width = (p * 100) + '%'; if (txt) $('loadtxt').textContent = txt; }
async function boot() {
  const tick = () => new Promise(r => setTimeout(r, 30));
  setLoad(0.1, 'מעצב את פני האדמה...'); await tick();
  world = new World(scene, renderer, Q);
  setLoad(0.7, 'מזמן יצורים קסומים...'); await tick();
  fx = new FX(scene, pointScale());
  hero = new Hero(scene);
  fairy = new Fairy(scene);
  enemies = new Enemies(scene, fx, {
    onDeath, hurtHero, sound: n => sound.play(n), shake: a => shake = Math.max(shake, a), arena: world.arena,
  });
  spawnEnemies();
  respawnHero();
  setLoad(1, 'מוכן!'); await tick();
  onResize();
  // warm up shaders
  renderer.compile(scene, camera);
  $('loading').classList.add('hide');
  state = 'title';
  $('title').classList.remove('hide');
  $('qbtn').textContent = 'איכות גרפיקה: ' + Q_NAMES[qName];
  requestAnimationFrame(loop);
}

function spawnEnemies() {
  const sh = i => world.shards[i - 1].pos;
  enemies.camp('imp', 1, sh(1), 7, world, 5, 13);
  enemies.camp('sentinel', 2, sh(2), 4, world, 10, 16);
  enemies.camp('stalker', 3, sh(3), 5, world, 5, 12);
  // wanderers
  const W = (type, realm, r, n, spread) => { for (let i = 0; i < n; i++) { const a = SECTOR[realm] + (Math.random() - 0.5) * spread, rr = r + (Math.random() - 0.5) * 30; const p = new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr); p.y = world.groundAt(p.x, p.z); if (p.y > 1) enemies.spawn(type, realm, p); } };
  W('imp', 1, 100, 6, 0.9); W('sentinel', 2, 110, 3, 0.9); W('imp', 2, 95, 3, 0.6); W('stalker', 3, 105, 5, 0.9); W('wraith', 4, 105, 8, 1.0);
  const b = enemies.spawn('boss', 4, world.arena.clone()); b.camp = 4; enemies.boss = b;
}
function respawnHero() {
  hero.pos.set(0, 0, 7); hero.pos.y = world.groundAt(0, 7); hero.facing = 0; hero.vel.set(0, 0, 0);
  hero.hp = hero.maxHp; hero.mp = hero.maxMp; hero.dead = false; hero.body.rotation.set(0, 0, 0); hero.body.position.y = 0;
  camYaw = 0; camTarget.set(hero.pos.x, hero.pos.y + 1.6, hero.pos.z);
  fairy.pos.set(0, hero.pos.y + 3, 7);
}

// ---------- input ----------
const keys = {};
const inp = { mx: 0, mz: 0, attack: false, magic: false, jump: false, dash: false };
const touch = { joy: null, cam: null, jx: 0, jz: 0, attackHeld: false };
addEventListener('keydown', e => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (state === 'dialog' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { nextDialog(); e.preventDefault(); return; }
  if (state !== 'play') { if (e.code === 'Escape' && state === 'paused') resume(); return; }
  if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.dash = true;
  if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'KeyF') inp.magic = true;
  if (e.code === 'KeyJ') inp.attack = true;
  if (e.code === 'Escape' || e.code === 'KeyP') pause();
});
addEventListener('keyup', e => keys[e.code] = false);
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (isTouch) return;
  sound.init();
  if (state === 'dialog') { nextDialog(); return; }
  if (state !== 'play') return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); }
  if (e.button === 0) inp.attack = true;
  if (e.button === 2) inp.magic = true;
});
addEventListener('mousemove', e => {
  if (state !== 'play' || isTouch) return;
  if (document.pointerLockElement === canvas) { camYaw -= e.movementX * 0.0026; camPitch += e.movementY * 0.0022; }
});
addEventListener('wheel', e => { if (state === 'play') camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 5, 16); }, { passive: true });
let lockGrace = 0;
const lock = () => { lockGrace = performance.now() + 800; lock(); };
const unlock = () => { lockGrace = performance.now() + 800; unlock(); };
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'play' && !isTouch && performance.now() > lockGrace) pause(); });

// touch / pointer controls
const joyEl = $('joy'), knob = $('knob');
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  sound.init();
  if (state === 'dialog') { nextDialog(); return; }
  if (state !== 'play') return;
  if (e.clientX < innerWidth * 0.45 && !touch.joy) {
    touch.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
    joyEl.style.left = (e.clientX - 60) + 'px'; joyEl.style.top = (e.clientY - 60) + 'px'; joyEl.classList.add('on');
    knob.style.transform = 'translate(0px,0px)';
  } else if (!touch.cam) touch.cam = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', e => {
  if (touch.joy && e.pointerId === touch.joy.id) {
    let dx = e.clientX - touch.joy.x, dy = e.clientY - touch.joy.y; const l = Math.hypot(dx, dy), R = 55;
    if (l > R) { dx = dx / l * R; dy = dy / l * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    touch.jx = dx / R; touch.jz = -dy / R;
  } else if (touch.cam && e.pointerId === touch.cam.id) {
    camYaw -= (e.clientX - touch.cam.x) * 0.0065; camPitch += (e.clientY - touch.cam.y) * 0.005;
    touch.cam.x = e.clientX; touch.cam.y = e.clientY;
  }
});
const endPtr = e => {
  if (touch.joy && e.pointerId === touch.joy.id) { touch.joy = null; touch.jx = touch.jz = 0; joyEl.classList.remove('on'); }
  if (touch.cam && e.pointerId === touch.cam.id) touch.cam = null;
};
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
function bindBtn(id, down, up) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); sound.init(); el.classList.add('press'); if (state === 'dialog') { nextDialog(); return; } if (state === 'play') down(); });
  const u = e => { el.classList.remove('press'); up && up(); };
  el.addEventListener('pointerup', u); el.addEventListener('pointerleave', u); el.addEventListener('pointercancel', u);
}
bindBtn('b-attack', () => { inp.attack = true; touch.attackHeld = true; }, () => touch.attackHeld = false);
bindBtn('b-magic', () => inp.magic = true);
bindBtn('b-jump', () => inp.jump = true);
bindBtn('b-dash', () => inp.dash = true);
$('b-pause').addEventListener('click', e => { e.stopPropagation(); if (state === 'play') pause(); });

function readMove() {
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (touch.joy) { mx = touch.jx; mz = touch.jz; }
  inp.mx = mx; inp.mz = mz;
  if (touch.attackHeld) inp.attack = true;
}

// ---------- UI: title/pause ----------
$('startbtn').addEventListener('click', () => {
  sound.init(); sound.play('ui');
  $('title').classList.add('hide'); $('hud').classList.remove('hide');
  game.start = time;
  lock();
  state = 'play';
  if (!game.talked) setTimeout(() => startDialog(introLines(), () => { game.talked = true; }), 600);
  try { if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { }); screen.orientation?.lock?.('landscape').catch(() => { }); } catch (e) { }
});
const cycleQ = () => { const order = ['high', 'medium', 'low']; const n = order[(order.indexOf(qName) + 1) % 3]; localStorage.setItem('aeth-q', n); location.reload(); };
$('qbtn').addEventListener('click', cycleQ); $('p-q').addEventListener('click', cycleQ);
function pause() { if (state !== 'play') return; state = 'paused'; $('pause').classList.remove('hide'); $('p-q').textContent = 'איכות: ' + Q_NAMES[qName]; }
function resume() { $('pause').classList.add('hide'); state = 'play'; lock(); }
$('p-resume').addEventListener('click', resume);
$('p-sound').addEventListener('click', () => { sound.setEnabled(!sound.enabled); $('p-sound').textContent = 'צליל: ' + (sound.enabled ? 'פועל' : 'כבוי'); });
$('p-restart').addEventListener('click', () => location.reload());
$('respawn').addEventListener('click', () => {
  $('death').classList.add('hide'); respawnHero();
  for (const e of enemies.list) if (e.alive && e.state !== 'idle') { e.state = 'return'; }
  if (enemies.boss && enemies.boss.alive) { enemies.boss.hp = enemies.boss.maxHp; enemies.bossActive = false; $('bossbar').classList.add('hide'); }
  state = 'play'; lock();
});
$('v-continue').addEventListener('click', () => { $('victory').classList.add('hide'); state = 'play'; lock(); });

// ---------- dialog ----------
let dlgQueue = [], dlgDone = null;
function startDialog(lines, done) { dlgQueue = lines.slice(); dlgDone = done; state = 'dialog'; unlock(); $('dialog').classList.remove('hide'); nextDialog(true); }
function nextDialog(first) {
  if (!first) sound.play('ui');
  const l = dlgQueue.shift();
  if (!l) { $('dialog').classList.add('hide'); state = 'play'; lock(); const d = dlgDone; dlgDone = null; d && d(); return; }
  $('dlg-name').textContent = l[0]; $('dlg-text').textContent = l[1];
  $('dialog').className = 'panel ' + (l[2] || '');
}
const LIORA = 'ליאורה, פיית האור';
function introLines() {
  return [
    [LIORA, 'ברוך בואך, גיבור! סוף-סוף התעוררת. אני ליאורה, ואני אלווה אותך במסע.'],
    [LIORA, 'לב האֶתֶר – הקריסטל ששמר על חמש הממלכות בהרמוניה – התנפץ. המלך החלול שואב את האופל שלו ובולע את העולם.'],
    [LIORA, 'רסיסי הלב פוזרו: ביער המכושף, במקדש הטיטאנים ובפסגות הבדולח. הרסיס האחרון בידי המלך החלול, בממלכת הצללים.'],
    [LIORA, 'עקוב אחרי עמודי האור בשמיים – הם מסמנים את הרסיסים. כל רסיס מוגן בכישוף שנשבר רק כשהשומרים שלו מובסים.'],
    [LIORA, isTouch ? 'הג׳ויסטיק משמאל מזיז אותך, גרירה מימין מסובבת את המצלמה. הכפתורים: ⚔ התקפה (החזק לקומבו), ✦ קסם, ⤒ קפיצה, » התחמקות.'
      : 'WASD לתנועה, עכבר למצלמה. קליק שמאלי – התקפת חרב (לחץ ברצף לקומבו), קליק ימני / Q – כדור קסם, רווח – קפיצה, Shift – התחמקות.'],
    [LIORA, 'כדורי אור ירוקים מרפאים, כחולים ממלאים מאנה. בהצלחה – האור תלוי בך! ✨'],
  ];
}
const SHARD_LINES = {
  1: [[LIORA, 'רסיס האגדות! האגדות הישנות מתעוררות שוב. אני מרגישה שהכוח שלך גובר.']],
  2: [[LIORA, 'רסיס המיתוסים, מבורך בכוח הטיטאנים הקדומים! החרב שלך חזקה מתמיד.']],
  3: [[LIORA, 'רסיס ההרפתקאות זוהר בבדולח טהור! עוד מעט נוכל לפרוץ אל הצללים.']],
  4: [[LIORA, 'הרסיס האחרון! עכשיו – מהר אל המזבח שבמרכז אחו השמש כדי לאחות את הלב!']],
};

// ---------- combat ----------
function hurtHero(dmg, from) {
  if (hero.damage(dmg)) {
    sound.play('hurt'); shake = Math.max(shake, 0.35);
    fx.emit(tmpV.set(hero.pos.x, hero.pos.y + 1.2, hero.pos.z), { count: 14, color: '#ff4a5a', speed: 4, life: 0.5, size: 0.4 });
    const dx = hero.pos.x - from.x, dz = hero.pos.z - from.z, d = Math.hypot(dx, dz) || 1; hero.pos.x += dx / d * 0.8; hero.pos.z += dz / d * 0.8;
    $('vignette').classList.remove('flash'); void $('vignette').offsetWidth; $('vignette').classList.add('flash');
    if (hero.dead) { sound.play('die'); game.deathT = 1.6; }
  }
}
function onDeath(e) {
  game.kills++;
  sound.play('die');
  fx.emit(tmpV.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), { count: e.type === 'boss' ? 200 : 40, color: e.type === 'boss' ? '#b05cff' : REALMS[e.realm].color, speed: e.type === 'boss' ? 14 : 6, life: 1, size: 0.6, up: 2 });
  const n = e.type === 'boss' ? 10 : 1 + Math.floor(Math.random() * 2.5);
  for (let i = 0; i < n; i++) spawnOrb(e.pos, Math.random() < 0.55 ? 'hp' : 'mp');
  if (e.type === 'boss') {
    game.bossDown = true; enemies.bossActive = false; $('bossbar').classList.add('hide'); shake = 1;
    const s = world.shards[3]; s.group.visible = true; s.guarded = false;
    s.pos.set(world.arena.x, world.arena.y + 1, world.arena.z);
    for (const w of enemies.list) if (w.alive && w.type === 'wraith' && Math.hypot(w.pos.x - world.arena.x, w.pos.z - world.arena.z) < 30) w.hit(999, w.pos);
    setTimeout(() => startDialog([[LIORA, 'הוא נפל! המלך החלול הובס! קח את הרסיס האחרון – הוא מרחף במרכז הזירה.']]), 1500);
  }
}
const orbGeo = new THREE.IcosahedronGeometry(0.22, 1);
const orbMat = { hp: new THREE.MeshStandardMaterial({ color: '#5fff8a', emissive: '#5fff8a', emissiveIntensity: 3 }), mp: new THREE.MeshStandardMaterial({ color: '#5fb0ff', emissive: '#5fb0ff', emissiveIntensity: 3 }) };
function spawnOrb(p, type) {
  const m = new THREE.Mesh(orbGeo, orbMat[type]); m.position.set(p.x, p.y + 1, p.z); scene.add(m);
  pickups.push({ m, type, v: new THREE.Vector3((Math.random() - 0.5) * 6, 5 + Math.random() * 3, (Math.random() - 0.5) * 6), t: 0 });
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const o = pickups[i]; o.t += dt;
    tmpV.set(hero.pos.x, hero.pos.y + 1, hero.pos.z).sub(o.m.position); const d = tmpV.length();
    if (o.t > 0.6 && d < 7 && !hero.dead) { o.v.lerp(tmpV.normalize().multiplyScalar(18), Math.min(1, dt * 6)); }
    else { o.v.y -= 14 * dt; const g = world.groundAt(o.m.position.x, o.m.position.z) + 0.5; if (o.m.position.y < g) { o.m.position.y = g; o.v.set(o.v.x * 0.5, Math.abs(o.v.y) * 0.4, o.v.z * 0.5); } }
    o.m.position.addScaledVector(o.v, dt); o.m.rotation.y += dt * 3;
    if (d < 1.1 && o.t > 0.3) {
      if (o.type === 'hp') { hero.hp = Math.min(hero.maxHp, hero.hp + 14); popText(hero.pos, '+14', '#5fff8a'); } else hero.mp = Math.min(hero.maxMp, hero.mp + 22);
      fx.emit(o.m.position, { count: 10, color: o.type === 'hp' ? '#5fff8a' : '#5fb0ff', speed: 3, life: 0.5, size: 0.4 });
      sound.play('orb'); scene.remove(o.m); pickups.splice(i, 1);
    } else if (o.t > 30) { scene.remove(o.m); pickups.splice(i, 1); }
  }
}
function heroEvents(ev) {
  for (const e of ev) {
    if (e.type === 'strike') {
      sound.play('swing');
      const dmgs = [20, 22, 38], ranges = [3.0, 3.0, 3.4], cosH = [0.3, 0.3, 0.05];
      const crit = Math.random() < 0.12, dmg = Math.round(dmgs[e.combo] * hero.dmgMul * (crit ? 1.8 : 1) * (0.9 + Math.random() * 0.2));
      const hits = enemies.hitArc(hero.pos, hero.facing, ranges[e.combo], cosH[e.combo], dmg, e.combo === 2 ? 11 : 6);
      hero.tipWorld(tmpV2);
      if (e.combo === 2) { fx.ring(hero.pos, { color: '#8fe6ff', r0: 0.5, r1: 3.6, dur: 0.35, opacity: 0.8 }); }
      if (hits.length) {
        sound.play(crit ? 'crit' : 'hit'); hitstop = e.combo === 2 ? 0.09 : 0.055; shake = Math.max(shake, e.combo === 2 ? 0.3 : 0.15);
        for (const h of hits) {
          tmpV.set(h.pos.x, h.pos.y + h.height * 0.6, h.pos.z);
          fx.emit(tmpV, { count: crit ? 26 : 16, color: crit ? '#ffd27a' : '#bff2ff', speed: 7, life: 0.45, size: 0.45 });
          popText(tmpV, (crit ? '✦' : '') + dmg, crit ? '#ffd27a' : '#ffffff', crit);
        }
      }
    } else if (e.type === 'cast') {
      sound.play('magic');
      const tgt = enemies.nearest(hero.pos, 26, hero.facing, 0.3);
      hero.handWorld(tmpV);
      const dir = new THREE.Vector3(Math.sin(hero.facing), 0.02, Math.cos(hero.facing));
      if (tgt) dir.set(tgt.pos.x - tmpV.x, tgt.pos.y + tgt.height * 0.5 - tmpV.y, tgt.pos.z - tmpV.z).normalize();
      fx.bolt(tmpV, dir, { color: '#7fdcff', scale: 1.2, speed: 30, life: 1.4, homing: 7, target: tgt, dmg: Math.round(34 * hero.dmgMul) });
      fx.emit(tmpV, { count: 14, color: '#bff2ff', speed: 3, life: 0.4, size: 0.4 });
    } else if (e.type === 'jump') sound.play('jump');
    else if (e.type === 'land') { sound.play('land'); fx.emit(hero.pos, { count: 10, color: '#e8e0c8', speed: 2.5, life: 0.5, size: 0.5, up: 0.5 }); }
    else if (e.type === 'dash') { sound.play('dash'); fx.emit(tmpV.set(hero.pos.x, hero.pos.y + 1, hero.pos.z), { count: 20, color: '#8fe6ff', speed: 3, life: 0.4, size: 0.5 }); }
    else if (e.type === 'barrier' && game.msgCD <= 0) { toast('מחסום הצללים חוסם את הדרך – אסוף קודם שלושה רסיסים.'); sound.play('barrier'); game.msgCD = 3; }
  }
}
function boltStep(b) {
  const p = b.m.position;
  if (p.y < world.groundAt(p.x, p.z)) { fx.emit(p, { count: 12, color: b.color, speed: 3, life: 0.4, size: 0.5 }); return true; }
  if (b.hostile) {
    if (hero.dead) return false;
    const dx = hero.pos.x - p.x, dy = hero.pos.y + 1.1 - p.y, dz = hero.pos.z - p.z;
    if (dx * dx + dy * dy + dz * dz < 1.1) { hurtHero(b.dmg, p); fx.emit(p, { count: 16, color: b.color, speed: 4, life: 0.5, size: 0.5 }); return true; }
    return false;
  }
  for (const e of enemies.list) {
    if (!e.alive) continue;
    const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dy = (e.pos.y + e.height * 0.5) - p.y, r = e.radius + 0.6;
    if (dx * dx + dz * dz < r * r && Math.abs(dy) < e.height * 0.6 + 0.6) {
      e.hit(b.dmg, p, 4); popText(tmpV.set(e.pos.x, e.pos.y + e.height, e.pos.z), '' + b.dmg, '#9fe8ff');
      for (const o of enemies.list) if (o !== e && o.alive && o.pos.distanceTo(p) < 3) o.hit(Math.round(b.dmg * 0.5), p, 3);
      fx.emit(p, { count: 30, color: '#7fdcff', speed: 7, life: 0.6, size: 0.6 }); fx.ring(tmpV.set(p.x, e.pos.y, p.z), { color: '#7fdcff', r0: 0.3, r1: 3, dur: 0.35 });
      sound.play('boom'); hitstop = 0.04;
      return true;
    }
  }
  return false;
}

// ---------- floating text / toast ----------
const pops = [];
function popText(p, txt, color, big) {
  const el = document.createElement('div'); el.className = 'pop' + (big ? ' big' : ''); el.textContent = txt; el.style.color = color; $('pops').appendChild(el);
  pops.push({ el, p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.4, p.z), t: 0 });
}
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const o = pops[i]; o.t += dt; o.p.y += dt * 1.6;
    tmpV.copy(o.p).project(camera);
    if (o.t > 0.9 || tmpV.z > 1) { o.el.remove(); pops.splice(i, 1); continue; }
    o.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * innerWidth}px, ${(-tmpV.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - o.t) * 2})`;
    o.el.style.opacity = Math.min(1, (0.9 - o.t) * 4);
  }
}
let toastT;
function toast(msg, dur = 3200) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), dur); }
function banner(i) {
  const el = $('banner'); $('ban-tag').textContent = REALMS[i].tag; $('ban-name').textContent = REALMS[i].name; el.style.setProperty('--c', REALMS[i].color);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// ---------- objectives ----------
function objective() {
  if (!game.talked) return { text: 'הקשב לליאורה', pos: world.altar };
  const c = game.collected;
  if (c[1] && c[2] && c[3] && c[4]) return game.won ? { text: 'העולם ניצל! חקור בחופשיות', pos: null } : { text: 'חזור אל מזבח האתר כדי לאחות את הלב', pos: world.altar };
  if (c[1] && c[2] && c[3]) return game.bossDown ? { text: 'אסוף את הרסיס האחרון', pos: world.shards[3].pos } : { text: 'הבס את המלך החלול בממלכת הצללים', pos: world.arena };
  let best = null, bd = 1e9;
  for (let i = 1; i <= 3; i++) if (!c[i]) { const d = world.shards[i - 1].pos.distanceTo(hero.pos); if (d < bd) { bd = d; best = i; } }
  const names = { 1: 'מצא את רסיס האגדות ביער המכושף', 2: 'מצא את רסיס המיתוסים במקדש הטיטאנים', 3: 'מצא את רסיס ההרפתקאות בפסגות הבדולח' };
  return { text: names[best], pos: world.shards[best - 1].pos };
}
function updateShards(dt) {
  for (const s of world.shards) {
    if (s.collected) continue;
    if (s.realm <= 3 && s.guarded && enemies.campAlive(s.realm) === 0) {
      s.guarded = false; toast('✦ המגן של הרסיס נשבר! ✦'); sound.play('barrier');
      fx.ring(s.group.position, { color: s.color, r0: 1, r1: 10, dur: 0.8 }); fx.emit(s.group.position, { count: 50, color: s.color, speed: 8, life: 0.8, size: 0.6 });
    }
    if (!s.group.visible) continue;
    const dx = hero.pos.x - s.group.position.x, dz = hero.pos.z - s.group.position.z, dy = hero.pos.y - s.pos.y;
    if (dx * dx + dz * dz < 2.8 * 2.8 && Math.abs(dy) < 4.5 && !hero.dead) {
      if (s.guarded) { if (game.msgCD <= 0) { toast(`המגן פעיל – הבס את השומרים (${enemies.campAlive(s.realm)} נותרו)`); game.msgCD = 3; } }
      else collectShard(s);
    }
  }
}
function collectShard(s) {
  s.collected = true; s.group.visible = false; game.collected[s.realm] = true;
  world.heartPieces[s.realm - 1].visible = true;
  hero.maxHp += 20; hero.hp = hero.maxHp; hero.mp = hero.maxMp; hero.dmgMul += 0.15;
  sound.play('shard'); shake = 0.3;
  fx.emit(s.group.position, { count: 120, color: s.color, speed: 10, life: 1.2, size: 0.7, up: 2 }); fx.ring(hero.pos, { color: s.color, r0: 1, r1: 14, dur: 1 });
  popText(hero.pos, '+20 ❤  +15% ⚔', s.color, true);
  $('sh' + s.realm).classList.add('on');
  const lines = SHARD_LINES[s.realm].slice();
  if (game.collected[1] && game.collected[2] && game.collected[3] && !world.barrierOpen) {
    world.barrierOpen = true;
    lines.push([LIORA, 'שלושה רסיסים! שמעת את זה? מחסום הצללים נסדק! הדרך אל המלך החלול פתוחה... היזהר, גיבור.']);
  }
  setTimeout(() => startDialog(lines), 700);
}
function checkBossAndAltar(dt) {
  if (world.barrierOpen && !game.bossDown && !enemies.bossActive && !hero.dead) {
    if (Math.hypot(hero.pos.x - world.arena.x, hero.pos.z - world.arena.z) < 22) {
      enemies.bossActive = true; $('bossbar').classList.remove('hide');
      sound.play('roar'); shake = 0.6;
      startDialog([['המלך החלול', 'עוד ניצוץ קטן שבא לכבות... האופל כבר בלע אלף גיבורים לפנייך. אתה תהיה הבא!', 'dark'], [LIORA, 'אל תפחד! התחמק מההתקפות שלו ותקוף כשהוא חשוף!']]);
    }
  }
  const c = game.collected;
  if (c[1] && c[2] && c[3] && c[4] && !game.won && hero.pos.distanceTo(world.altar) < 10) startVictory();
}
function startVictory() {
  game.won = true; state = 'cine'; game.cine = 0; unlock();
  sound.play('victory'); $('hud').classList.add('hide');
}
function updateCine(dt) {
  game.cine += dt; const t = game.cine;
  const a = t * 0.35; camera.position.set(Math.sin(a) * 22, world.altar.y + 9 + t * 0.6, Math.cos(a) * 22); camera.lookAt(0, world.altar.y + 4.5, 0);
  world.heartPieces.forEach((p, i) => { const k = Math.min(1, Math.max(0, (t - 0.5 - i * 0.4) / 1.5)); p.position.multiplyScalar(1 - k); });
  if (t > 2.5 && t - dt <= 2.5) { fx.ring(world.altar, { color: '#fff4c0', r0: 2, r1: 260, dur: 4, opacity: 1 }); fx.emit(world.heart.position, { count: 300, color: '#fff4c0', speed: 22, life: 2, size: 1 }); shake = 0.8; world.heartCore.scale.setScalar(2); }
  if (t > 2.5) world.healed = Math.min(1, world.healed + dt * 0.3);
  if (bloom) bloom.strength = 0.55 + Math.max(0, 1.5 - Math.abs(t - 2.8)) * 1.2;
  if (t > 7) {
    state = 'victory'; $('victory').classList.remove('hide'); $('hud').classList.remove('hide');
    const sec = Math.floor(time - game.start); $('v-stats').textContent = `זמן מסע: ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}  •  יצורים שהובסו: ${game.kills}`;
    if (bloom) bloom.strength = 0.55;
  }
}

// ---------- HUD ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
function drawMinimap() {
  const S = mm.width, R = world.minimapR, src = world.minimap, view = 95;
  mctx.clearRect(0, 0, S, S);
  mctx.save(); mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = '#123'; mctx.fillRect(0, 0, S, S);
  const toImg = v => (v / R * 0.5 + 0.5) * src.width, scale = src.width / (2 * R);
  const sw = view * 2 * scale;
  mctx.drawImage(src, toImg(hero.pos.x) - sw / 2, toImg(hero.pos.z) - sw / 2, sw, sw, 0, 0, S, S);
  const toMap = (x, z) => [S / 2 + (x - hero.pos.x) / view * S / 2, S / 2 + (z - hero.pos.z) / view * S / 2];
  const dot = (x, z, r, c, clampEdge) => { let [px, py] = toMap(x, z); const dx = px - S / 2, dy = py - S / 2, l = Math.hypot(dx, dy); if (l > S / 2 - 8) { if (!clampEdge) return; px = S / 2 + dx / l * (S / 2 - 8); py = S / 2 + dy / l * (S / 2 - 8); } mctx.fillStyle = c; mctx.beginPath(); mctx.arc(px, py, r, 0, Math.PI * 2); mctx.fill(); };
  for (const e of enemies.list) if (e.alive && e.type !== 'boss') dot(e.pos.x, e.pos.z, 2.2, '#ff4a5a');
  dot(0, 0, 5, '#ffe7a0', true);
  for (const s of world.shards) if (!s.collected && s.group.visible) { dot(s.group.position.x, s.group.position.z, 5.5, '#000', true); dot(s.group.position.x, s.group.position.z, 4, s.color, true); }
  if (enemies.boss?.alive) dot(enemies.boss.pos.x, enemies.boss.pos.z, 5, '#b05cff', true);
  mctx.restore();
  // player arrow
  mctx.save(); mctx.translate(S / 2, S / 2); mctx.rotate(Math.PI - hero.facing);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(5.5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5.5, 6); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}
let hudT = 0;
function updateHUD(dt) {
  $('hpfill').style.width = (hero.hp / hero.maxHp * 100) + '%';
  $('mpfill').style.width = (hero.mp / hero.maxMp * 100) + '%';
  $('hptxt').textContent = Math.ceil(hero.hp) + ' / ' + hero.maxHp;
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.1; drawMinimap();
    const o = objective(); $('objtxt').textContent = o.text;
    if (o.pos) {
      const ta = Math.atan2(o.pos.x - camera.position.x, o.pos.z - camera.position.z), rel = ta - camYaw;
      $('objarrow').style.transform = `rotate(${-rel}rad)`; $('objarrow').style.opacity = 1;
      $('objdist').textContent = Math.round(Math.hypot(o.pos.x - hero.pos.x, o.pos.z - hero.pos.z)) + ' מ׳';
    } else { $('objarrow').style.opacity = 0; $('objdist').textContent = ''; }
  }
  if (enemies.bossActive && enemies.boss) $('bossfill').style.width = (enemies.boss.hp / enemies.boss.maxHp * 100) + '%';
  $('b-magic').classList.toggle('dim', hero.mp < 20);
}

// ---------- camera ----------
function updateCamera(dt) {
  camPitch = THREE.MathUtils.clamp(camPitch, -0.25, 1.15);
  if (isTouch && !touch.cam && hero.speed > 1 && hero.attackT < 0) {
    // gentle auto-follow behind hero when moving
    let d = hero.facing - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 2.4) camYaw += d * Math.min(1, dt * 0.9);
  }
  const k = 1 - Math.exp(-dt * 10);
  camTarget.x += (hero.pos.x - camTarget.x) * k; camTarget.z += (hero.pos.z - camTarget.z) * k;
  camTarget.y += (hero.pos.y + 1.7 - camTarget.y) * (1 - Math.exp(-dt * 6));
  const bossNear = enemies.bossActive ? 3 : 0;
  const dist = camDist + bossNear, cp = Math.cos(camPitch);
  let cx = camTarget.x - Math.sin(camYaw) * cp * dist, cz = camTarget.z - Math.cos(camYaw) * cp * dist, cy = camTarget.y + Math.sin(camPitch) * dist;
  // terrain avoidance along the line
  for (let i = 1; i <= 4; i++) { const f = i / 4; const x = camTarget.x + (cx - camTarget.x) * f, z = camTarget.z + (cz - camTarget.z) * f; const g = world.groundAt(x, z) + 0.8; const yy = camTarget.y + (cy - camTarget.y) * f; if (yy < g) cy += (g - yy) / f; }
  cy = Math.max(cy, world.groundAt(cx, cz) + 0.8, 0.6);
  camera.position.set(cx, cy, cz);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.6; camera.position.y += (Math.random() - 0.5) * shake * 0.6; shake = Math.max(0, shake - dt * 2.2); }
  camera.lookAt(camTarget.x, camTarget.y, camTarget.z);
}

// ---------- main loop ----------
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.1; }
  time += dt;
  game.msgCD -= dt;
  if (state === 'title' || state === 'loading') {
    const a = time * 0.05;
    camera.position.set(Math.sin(a) * 34, 15 + Math.sin(time * 0.2) * 2, Math.cos(a) * 34); camera.lookAt(0, 6, 0);
    world.update(dt, time, camera, camera.position);
    fx.update(dt, time, camera.position, world.blend.part, 0);
    hero.animate(dt, 0); fairy.update(dt, hero.pos, hero.facing, fx);
  } else if (state === 'play') {
    readMove();
    const aim = enemies.nearest(hero.pos, 6, hero.facing, 0.1);
    const ev = hero.update(dt, inp, camYaw, world, aim);
    inp.attack = inp.magic = inp.jump = inp.dash = false;
    heroEvents(ev);
    enemies.update(dt, hero, world, camera);
    fx.updateBolts(dt, boltStep);
    updatePickups(dt); updateShards(dt); checkBossAndAltar(dt);
    fairy.update(dt, hero.pos, hero.facing, fx);
    world.update(dt, time, camera, hero.pos);
    const dom = world.dominant();
    if (dom !== game.curRealm && world.cur[dom] > 0.55) { game.curRealm = dom; banner(dom); sound.setMood(dom); }
    let combat = 0; for (const e of enemies.list) if (e.alive && e.state !== 'idle' && e.state !== 'return' && e.pos.distanceTo(hero.pos) < 30) { combat = 1; break; }
    sound.combat += (combat - sound.combat) * Math.min(1, dt * 0.8);
    fx.update(dt, time, hero.pos, world.blend.part, world.cur[4] * (1 - world.healed) * 0.8);
    for (const em of world.emitters) if (Math.random() < em.rate * dt && Math.abs(em.x - hero.pos.x) < 90 && Math.abs(em.z - hero.pos.z) < 90) fx.emit(em, { count: 1, color: em.color, speed: 0.4, up: em.up, life: em.life, size: em.size, spread: em.spread });
    updateCamera(dt); updateHUD(dt); updatePops(dt);
    if (hero.dead) { game.deathT -= dt; if (game.deathT <= 0 && state === 'play') { state = 'dead'; unlock(); $('death').classList.remove('hide'); } }
  } else if (state === 'cine') {
    updateCine(dt); world.update(dt, time, camera, hero.pos); fx.update(dt, time, hero.pos, world.blend.part, 0);
    hero.animate(dt, 0); fairy.update(dt, hero.pos, hero.facing, fx); updatePops(dt);
  } else {
    // paused / dialog / dead / victory: keep world alive visually
    world.update(dt * (state === 'paused' ? 0 : 1), time, camera, hero.pos);
    if (state !== 'paused') { fx.update(dt, time, hero.pos, world.blend.part, 0); hero.animate(dt, 0); fairy.update(dt, hero.pos, hero.facing, fx); enemies.update(dt * (state === 'dialog' ? 0 : 1), hero, world, camera); updateCamera(dt); updatePops(dt); }
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
}

boot().catch(err => { console.error(err); $('loadtxt').textContent = 'שגיאה בטעינה: ' + err.message; });
window.__game = { camera, get fx() { return fx; }, setYaw: y => camYaw = y, get state() { return state; }, get hero() { return hero; }, get world() { return world; }, get enemies() { return enemies; }, game };
