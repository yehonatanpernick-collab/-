// ============================================================
//  משמר האפר — game logic
// ============================================================
import * as THREE from 'three';
import { renderer, scene, camera, composer, finalPass, G, Q, IS_TOUCH, updateSunScreen, skyMat, canvas } from './engine.js';
import { TexBaker } from './texgen.js';
import { buildKnight } from './knight.js';
import { monsterMaterials, buildSkeleton, buildWraith, buildPriest, buildGolem } from './undead.js';
import { KINGDOMS, buildKingdom, ARENA_R, portalMaterial } from './kingdoms.js';
import { Particles } from './world.js';
import { sampleClip, mixPose, drivePose } from './anim.js';
import { GUARD, locomotion, CLIPS, UNDEAD_IDLE, undeadWalk, undeadAttackPose } from './poses.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (t) => t * t * (3 - 2 * t);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const V = () => new THREE.Vector3();
const tmp = V(), tmp2 = V();
const later = (sec, fn) => S.events.push({ t: S.time + sec, fn });
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ---------------- state ----------------
const S = {
  mode: 'loading', k: 0, wave: 0, wavesPer: 3, souls: 0, kills: 0, time: 0,
  hitstop: 0, shake: 0, slow: 1, slowT: 0, damageFx: 0, healFx: 0, fade: 0, bars: 0,
  combo: 0, comboT: 0, spawnQueue: [], spawnT: 0, waveActive: false, events: [],
  portal: null, boss: null, snapshot: null, best: store.get('ashen2-best', 0), unlocked: store.get('ashen2-unlocked', 0),
  lightning: 0, nextLightning: 15, stepT: 0,
};
const BASE_P = { speed: 5.2, maxHp: 120, maxSt: 100, stRegen: 38, maxFocus: 100, maxFlasks: 3, dmgMul: 1, crit: 0.06, lifesteal: 0, spellMul: 1, spellCost: 35, dodgeMul: 1, burn: 0, spinMul: 1, soulHeal: 0, armor: 0 };
const P = {
  ...BASE_P, pos: V(), vel: V(), face: 0, hp: 120, st: 100, focus: 40, flasks: 3, ghost: 120,
  state: 'idle', t: 0, clip: null, combo: 0, queued: false, hitSet: new Set(), hitTick: 0, invuln: 0, stDelay: 0,
  walkPhase: 0, sprint: false, dodgeDir: V(), charge: 0, heavyHeld: false, heavyT: 0, lock: null, castFired: false, healed: false, lastHurt: 0, blessings: [],
};

// ---------------- boot ----------------
const baker = new TexBaker(renderer, Q.tex);
let knight = null, world = null, fx = null, smoke = null, MM = {};
const enemies = [], projectiles = [], souls = [], decals = [], spikes = [];

async function boot() {
  const steps = ['steel', 'gold', 'leather', 'cloth', 'chain', 'emblem', 'bone', 'rust', 'rock', 'bark', 'ashlar', 'soil', 'moss'];
  const bar = $('loadBar'), txt = $('loadText');
  const lines = ['מחשל את השריון', 'שוזר את הגלימה', 'חוצב את המצבות', 'מעיר את המתים', 'מדליק את הגחלים'];
  for (let i = 0; i < steps.length; i++) {
    baker.bake(steps[i], steps[i] === 'steel' ? { normal: 2.5 } : steps[i] === 'chain' ? { normal: 9, ao: 4 } : {});
    bar.style.transform = `scaleX(${(i + 1) / (steps.length + 3)})`;
    txt.textContent = lines[Math.floor((i / steps.length) * lines.length)];
    await nextFrame();
  }
  fx = new Particles(scene, IS_TOUCH ? 3500 : 6000);
  smoke = new Particles(scene, 900, THREE.NormalBlending);
  knight = buildKnight(baker);
  scene.add(knight.root, knight.cape.mesh);
  bar.style.transform = `scaleX(${(steps.length + 1) / (steps.length + 3)})`; txt.textContent = 'בונה את הממלכה'; await nextFrame();
  await loadKingdom(0, true);
  bar.style.transform = 'scaleX(1)'; await nextFrame();
  renderer.compile(scene, camera);
  S.mode = 'title';
  $('loading').classList.add('gone');
  $('title').classList.add('show');
  refreshTitle();
  requestAnimationFrame(frame);
}

function materialsFor(kid) {
  if (!MM[kid]) {
    const th = { ash: { eye: 0xff3a18 }, frost: { eye: 0x60c8ff, frost: true, boneColor: 0xc8d4dc, spiritGlow: 0x5ab8ff, robeColor: 0x18202e }, ember: { eye: 0xff7a18, char: true, spiritGlow: 0xff6a20, spirit: 0x140804, robeColor: 0x2a0e06 }, void: { eye: 0xb070ff, boneColor: 0x8a8098, spiritGlow: 0x9a50ff, robeColor: 0x140a24, ragColor: 0x1a1024 } }[kid];
    MM[kid] = monsterMaterials(baker, th);
  }
  return MM[kid];
}

async function loadKingdom(k, title = false) {
  if (world) { world.dispose(); world = null; }
  clearField();
  const def = KINGDOMS[k];
  world = buildKingdom(def, baker, G);
  materialsFor(def.id);
  S.k = k; S.wave = 0;
  P.pos.set(0, 0, def.id === 'void' ? 12 : 10);
  P.pos.y = world.heightAt(P.pos.x, P.pos.z);
  P.face = Math.PI; P.vel.set(0, 0, 0);
  camYaw = 0; camPitch = 0.32;
  knight.cape.reset();
  knight.cape.ground = P.pos.y;
  // warm up shader programs for this kingdom's enemies
  if (!title) {
    const warm = ['husk', 'wraith', 'priest', 'brute'].map((t) => makeEnemyRig(t, def.id));
    warm.forEach((r, i) => { r.root.position.set(P.pos.x + i, P.pos.y, P.pos.z - 3); scene.add(r.root); });
    renderer.compile(scene, camera);
    warm.forEach((r) => scene.remove(r.root));
  }
  Audio.ambience(def.id);
  $('kname').textContent = def.name;
  $('knum').textContent = def.numeral;
}

// ---------------- enemy definitions ----------------
const EDEF = {
  husk: { hp: 60, speed: 2.7, radius: 0.45, height: 1.8, dmg: 14, range: 1.9, windup: 0.55, strike: 0.24, recover: 0.55, cd: 1.1, souls: 4, poise: 26, attacks: ['slash', 'overhead'] },
  wraith: { hp: 38, speed: 4.6, radius: 0.45, height: 2.2, dmg: 13, range: 4.6, windup: 0.5, strike: 0.32, recover: 0.75, cd: 1.7, souls: 5, poise: 14, flying: true, attacks: ['lunge'] },
  priest: { hp: 46, speed: 2.3, radius: 0.45, height: 2.0, dmg: 13, range: 16, windup: 0.9, strike: 0.2, recover: 0.6, cd: 2.6, souls: 7, poise: 20, ranged: true, attacks: ['cast'] },
  brute: { hp: 150, speed: 2.1, radius: 0.85, height: 2.6, dmg: 25, range: 2.8, windup: 0.85, strike: 0.3, recover: 0.85, cd: 1.7, souls: 12, poise: 80, attacks: ['overhead', 'slam'] },
};
const BOSS = {
  ash: { name: 'המלך החלול', title: 'אדון העצמות, שומר הקבר', hp: 1500, dmg: 30, radius: 1.25, height: 4.6, speed: 2.7 },
  frost: { name: 'ענק הכפור', title: 'לבה הקפוא של המלכה', hp: 2000, dmg: 32, radius: 1.5, height: 5.0, speed: 2.4 },
  ember: { name: 'שומר הכבשן', title: 'הנפח שמת ולא הפסיק', hp: 2400, dmg: 36, radius: 1.5, height: 5.2, speed: 2.5 },
  void: { name: 'האביר השבור', title: 'מי שהיה פעם אתה', hp: 2800, dmg: 34, radius: 0.9, height: 3.8, speed: 4.2 },
};

function makeEnemyRig(type, kid) {
  const M = materialsFor(kid);
  if (type === 'husk') return buildSkeleton(M, { weapon: Math.random() < 0.6 ? 'sword' : 'axe', armor: Math.random() < 0.55 ? 'rusty' : undefined, ice: kid === 'frost', hood: kid === 'void' && Math.random() < 0.6 });
  if (type === 'wraith') return buildWraith(M);
  if (type === 'priest') return buildPriest(M);
  if (type === 'brute') {
    if (kid === 'ash') return buildSkeleton(M, { weapon: 'axe', armor: 'rusty', scale: 1.45 });
    return buildGolem(M, { mat: kid === 'frost' ? M.ice : kid === 'ember' ? M.bone : M.rock, glow: M.eye, crystals: kid === 'frost' ? M.ice : null, scale: 0.85, seed: Math.random() * 99 });
  }
  if (type === 'boss') {
    if (kid === 'ash') return buildSkeleton(M, { weapon: 'greatsword', armor: 'king', crown: true, cape: true, rags: false, scale: 2.45 });
    if (kid === 'frost') return buildGolem(M, { mat: M.ice, crystals: M.ice, glow: M.eye, scale: 2.1, seed: 4 });
    if (kid === 'ember') return buildGolem(M, { mat: M.bone, glow: M.eye, weapon: 'hammer', scale: 2.2, seed: 9 });
    const dk = buildKnight(baker, 'dark');
    dk.root.scale.setScalar(2.0);
    dk.cape.width *= 2.0; dk.cape.len *= 2.0; dk.cape.colliders.forEach((c) => { c.r *= 2.0; });
    dk.joints.jaw = null;
    return dk;
  }
}

function spawnEnemy(type, x, z) {
  const kid = KINGDOMS[S.k].id;
  const isBoss = type === 'boss';
  const base = isBoss ? BOSS[kid] : EDEF[type];
  const rig = makeEnemyRig(type, kid);
  const kMul = 1 + S.k * 0.4 + (S.wave - 1) * 0.08;
  const e = {
    type, kid, boss: isBoss, rig, def: base, pos: new THREE.Vector3(x, world.heightAt(x, z), z), vel: V(),
    face: Math.atan2(P.pos.x - x, P.pos.z - z), hp: 0, maxHp: 0, state: 'rising', t: 0, atkCd: rand(0.6, 1.6),
    radius: base.radius, height: base.height, flash: 0, poiseDmg: 0, walk: Math.random() * 6, mats: [], hop: 0,
    dmg: base.dmg * (isBoss ? 1 : 1 + S.k * 0.22), speed: base.speed, attack: null, phase2: false, used: {}, move: null, burnT: 0,
  };
  e.hp = e.maxHp = isBoss ? base.hp : base.hp * kMul;
  rig.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
      const c = o.material.clone(); c.onBeforeCompile = o.material.onBeforeCompile; c.customProgramCacheKey = o.material.customProgramCacheKey;
      c.userData.e0 = c.emissive.clone(); c.userData.ei0 = c.emissiveIntensity;
      o.material = c; e.mats.push(c);
    }
  });
  rig.root.position.copy(e.pos);
  rig.root.rotation.y = e.face;
  if (!base.flying && !isBoss) rig.root.position.y -= 2;
  scene.add(rig.root);
  if (rig.cape) { scene.add(rig.cape.mesh); rig.cape.ground = e.pos.y; }
  enemies.push(e);
  // summoning sigil
  const col = base.flying ? [0.3, 1.6, 1.6] : [1.8, 0.2, 0.06];
  const dm = new THREE.Mesh(new THREE.RingGeometry(0.2, 1, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  dm.rotation.x = -Math.PI / 2; dm.position.set(x, e.pos.y + 0.05, z); dm.scale.setScalar(e.radius * 2.4);
  scene.add(dm); decals.push({ mesh: dm, t: 0, life: 1.8, kind: 'sigil' });
  Audio.rise();
  if (isBoss) {
    S.boss = e; e.state = 'intro'; e.t = 0;
    $('bossName').textContent = base.name; $('bossTitle').textContent = base.title;
    $('bossBar').classList.add('show');
    showBanner(base.name, base.title, 3.4, 'boss');
    Audio.bell(); Audio.roar();
    S.shake = 0.9;
  }
  return e;
}

// ---------------- input ----------------
const keys = {};
const mouse = { locked: false, down: false, dragging: false, sx: 0, sy: 0, rDown: 0 };
let camYaw = 0, camPitch = 0.32, camDist = 6.4;
const touch = { mx: 0, my: 0, active: false };

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (S.mode === 'play') {
    if (e.code === 'Space') { e.preventDefault(); tryDodge(); }
    if (e.code === 'KeyQ') tryCast();
    if (e.code === 'KeyE' || e.code === 'KeyR') tryDrink();
    if (e.code === 'KeyJ') tryAttack();
    if (e.code === 'KeyK' || e.code === 'KeyF') heavyDown();
    if (e.code === 'Tab' || e.code === 'KeyL') { e.preventDefault(); toggleLock(); }
    if (e.code === 'Escape' || e.code === 'KeyP') pause(true);
  } else if (S.mode === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) pause(false);
  else if (S.mode === 'title' && e.code === 'Enter') startGame(false);
  else if (S.mode === 'choose' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { const b = document.querySelectorAll('.card')[+e.code.slice(-1) - 1]; b && b.click(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; if ((e.code === 'KeyK' || e.code === 'KeyF') && S.mode === 'play') heavyUp(); });
addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (S.mode !== 'play' || IS_TOUCH) return;
  if (!mouse.locked) { try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch {} }
  if (e.button === 0) { if (mouse.locked) tryAttack(); else { mouse.down = true; mouse.dragging = false; mouse.sx = e.clientX; mouse.sy = e.clientY; } }
  if (e.button === 2) heavyDown();
  if (e.button === 1) { e.preventDefault(); toggleLock(); }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0 && !mouse.locked && mouse.down && !mouse.dragging && S.mode === 'play') tryAttack();
  if (e.button === 0) mouse.down = false;
  if (e.button === 2 && S.mode === 'play') heavyUp();
});
addEventListener('mousemove', (e) => {
  if (S.mode !== 'play') return;
  if (mouse.locked) { if (!P.lock) camYaw -= e.movementX * 0.0024; camPitch = clamp(camPitch + e.movementY * 0.0018, -0.05, 1.0); }
  else if (mouse.down) {
    if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 6) mouse.dragging = true;
    if (mouse.dragging) { if (!P.lock) camYaw -= e.movementX * 0.005; camPitch = clamp(camPitch + e.movementY * 0.003, -0.05, 1.0); }
  }
});
addEventListener('wheel', (e) => { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.5, 3.5, 10); }, { passive: true });
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  mouse.locked = document.pointerLockElement === canvas;
  if (!mouse.locked && wasLocked && S.mode === 'play') pause(true);
  wasLocked = mouse.locked;
});

if (IS_TOUCH) {
  document.body.classList.add('touch');
  const stick = $('stick'), knob = $('knob');
  let stickId = null, camId = null, sc = { x: 0, y: 0 }, last = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier; sc = { x: t.clientX, y: t.clientY };
        stick.classList.add('on'); stick.style.left = sc.x - 60 + 'px'; stick.style.top = sc.y - 60 + 'px'; stick.style.bottom = 'auto'; knob.style.transform = 'translate(0,0)';
      } else if (camId === null) { camId = t.identifier; last = { x: t.clientX, y: t.clientY }; }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sc.x, dy = t.clientY - sc.y; const l = Math.hypot(dx, dy), m = 50;
        if (l > m) { dx *= m / l; dy *= m / l; }
        touch.mx = dx / m; touch.my = dy / m; touch.active = true; knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (t.identifier === camId) {
        if (!P.lock) camYaw -= (t.clientX - last.x) * 0.006;
        camPitch = clamp(camPitch + (t.clientY - last.y) * 0.004, -0.05, 1.0); last = { x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === stickId) { stickId = null; touch.mx = touch.my = 0; touch.active = false; stick.classList.remove('on'); stick.style.left = stick.style.top = stick.style.bottom = ''; knob.style.transform = 'translate(0,0)'; } if (t.identifier === camId) camId = null; } };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  const bind = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (S.mode === 'play') down(); }, { passive: false });
    if (up) el.addEventListener('touchend', (e) => { e.preventDefault(); if (S.mode === 'play') up(); }, { passive: false });
  };
  bind('tAtk', tryAttack); bind('tHeavy', heavyDown, heavyUp); bind('tDodge', tryDodge); bind('tSpell', tryCast); bind('tFlask', tryDrink); bind('tLock', toggleLock);
  $('tPause').addEventListener('touchstart', (e) => { e.preventDefault(); if (S.mode === 'play') pause(true); }, { passive: false });
}

function moveInput() {
  let f = 0, r = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) r += 1;
  if (keys.KeyA || keys.ArrowLeft) r -= 1;
  if (touch.active) { f = -touch.my; r = touch.mx; }
  const v = new THREE.Vector3(-Math.sin(camYaw) * f + Math.cos(camYaw) * r, 0, -Math.cos(camYaw) * f - Math.sin(camYaw) * r);
  const l = v.length(); if (l > 1) v.divideScalar(l);
  return v;
}

// ---------------- player actions ----------------
const canAct = () => S.mode === 'play' && P.hp > 0;
function targetAngle(e) { return Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z); }
function nearestEnemy(maxDist, maxAng = Math.PI) {
  let best = null, bd = maxDist;
  for (const e of enemies) {
    if (e.state === 'dying' || e.state === 'rising') continue;
    const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.radius;
    if (d > bd || Math.abs(angDiff(P.face, targetAngle(e))) > maxAng) continue;
    bd = d; best = e;
  }
  return best;
}
function faceTarget(range = 5.5, ang = 1.6) {
  const mv = moveInput();
  if (mv.lengthSq() > 0.01) P.face = Math.atan2(mv.x, mv.z);
  const t = P.lock && P.lock.state !== 'dying' ? P.lock : nearestEnemy(range, ang);
  if (t) P.face = targetAngle(t);
}
function startClip(name, combo = 0) {
  const c = CLIPS[name];
  P.state = 'attack'; P.t = 0; P.clip = name; P.combo = combo; P.queued = false; P.hitSet.clear(); P.hitTick = 0;
  P.st -= c.stamina * (name === 'spin' ? P.spinMul : 1); P.stDelay = 0.65;
  faceTarget();
  trail.base.length = trail.tip.length = 0;
  if (c.heavy) Audio.heavy(); else setTimeout(Audio.swing, 70);
}
function tryAttack() {
  if (!canAct()) return;
  if (P.state === 'attack') { if (P.t > CLIPS[P.clip].hit[0]) P.queued = true; return; }
  if (P.state === 'dodge' && P.t > 0.3) { P.queued = true; return; }
  if (!['idle', 'run'].includes(P.state) || P.st < 6) return;
  startClip('slash1', 0);
}
function heavyDown() {
  if (!canAct() || !['idle', 'run'].includes(P.state) || P.st < 10) return;
  P.state = 'charge'; P.t = 0; P.charge = 0; P.heavyHeld = true;
}
function heavyUp() {
  if (P.state !== 'charge') return;
  P.heavyHeld = false;
  if (P.charge > 0.45) startClip('spin', 0); else startClip('slash3', 2);
}
function tryDodge() {
  if (!canAct() || P.st < 6) return;
  if (!['idle', 'run', 'attack', 'hurt', 'charge'].includes(P.state)) return;
  if (P.state === 'attack' && P.t < 0.08) return;
  if (P.state === 'hurt' && P.t < 0.16) return;
  P.st -= 22 * P.dodgeMul; P.stDelay = 0.7;
  const mv = moveInput();
  if (mv.lengthSq() < 0.01) mv.set(-Math.sin(P.face), 0, -Math.cos(P.face));
  P.dodgeDir.copy(mv).normalize();
  P.face = Math.atan2(P.dodgeDir.x, P.dodgeDir.z);
  P.state = 'dodge'; P.t = 0; P.queued = false;
  Audio.dodge();
  for (let i = 0; i < 14; i++) smoke.emit(P.pos.x + rand(-0.3, 0.3), P.pos.y + 0.1, P.pos.z + rand(-0.3, 0.3), rand(-1, 1), rand(0.2, 0.8), rand(-1, 1), dustCol(), dustCol(0.4), rand(0.4, 0.8), rand(0.6, 1), -0.3, 2, 1.4);
}
function tryCast() {
  if (!canAct() || !['idle', 'run'].includes(P.state)) return;
  if (P.focus < P.spellCost) { nope('fpBar'); return; }
  P.focus -= P.spellCost;
  P.state = 'cast'; P.t = 0; P.castFired = false;
  faceTarget(25, 1.5);
  if (!P.lock && !nearestEnemy(25, 1.5)) P.face = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
}
function tryDrink() {
  if (!canAct() || !['idle', 'run'].includes(P.state)) return;
  if (P.flasks <= 0) { nope('flaskSlot'); return; }
  if (P.hp >= P.maxHp) return;
  P.flasks--; P.state = 'drink'; P.t = 0; P.healed = false;
  Audio.drink();
}
function toggleLock() {
  if (P.lock) { P.lock = null; return; }
  let best = null, bs = 1e9;
  for (const e of enemies) {
    if (e.state === 'dying') continue;
    const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    if (d > 22) continue;
    const a = Math.abs(angDiff(Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)), targetAngle(e)));
    const score = d + a * 8 - (e.boss ? 6 : 0);
    if (score < bs) { bs = score; best = e; }
  }
  P.lock = best;
}

function damagePlayer(dmg, from, knock = 7) {
  if (P.invuln > 0 || P.hp <= 0 || S.mode !== 'play') return false;
  if (P.state === 'dodge' && P.t > 0.04 && P.t < 0.42 * (P.dodgeMul < 1 ? 1.2 : 1)) { perfectDodge(); return false; }
  dmg *= 1 - P.armor;
  P.hp -= dmg; P.lastHurt = S.time; P.invuln = 0.5;
  S.damageFx = 1; S.shake = Math.max(S.shake, 0.4); S.hitstop = 0.07; S.combo = 0; updateCombo();
  Audio.hurt();
  fx.burst(tmp.copy(P.pos).setY(P.pos.y + 1.2), 26, 5, [1.2, 0.05, 0.05], [0.25, 0, 0], 0.11, 0.6, 9, 0.3, 1);
  if (from) { const d = new THREE.Vector3(P.pos.x - from.x, 0, P.pos.z - from.z).normalize(); P.vel.addScaledVector(d, knock); }
  if (P.hp <= 0) { P.hp = 0; die(); return true; }
  P.state = 'hurt'; P.t = 0; P.clip = 'hurt';
  return true;
}
function perfectDodge() {
  if (S.time - (P.lastPerfect || 0) < 0.6) return;
  P.lastPerfect = S.time;
  S.slow = 0.35; S.slowT = 0.35;
  P.focus = Math.min(P.maxFocus, P.focus + 10);
  fx.burst(tmp.copy(P.pos).setY(P.pos.y + 1), 18, 3, [2, 1.6, 3], [0.3, 0.2, 0.6], 0.1, 0.5, 0, 0.3, 2);
  hint('התחמקות מושלמת', 0.8);
}

// ---------------- combat helpers ----------------
function hitEnemy(e, dmg, from, knock = 4, kind = 'blade') {
  if (e.state === 'dying' || e.state === 'intro') return;
  const crit = Math.random() < P.crit;
  if (crit) dmg *= 1.85;
  dmg = Math.round(dmg);
  e.hp -= dmg; e.flash = 1;
  const c = tmp.copy(e.pos); c.y += e.height * 0.55;
  const spirit = e.type === 'wraith';
  fx.burst(c, crit ? 30 : 16, 6.5, [5, 3.4, 1.8], [1.4, 0.25, 0.04], 0.055, 0.35, 7, 0.2, 2);
  fx.burst(c, 10, 3, spirit ? [0.4, 2.2, 2.0] : [0.9, 0.85, 0.7], spirit ? [0.05, 0.3, 0.3] : [0.2, 0.18, 0.15], 0.07, 0.6, 8, 0.4, 1);
  dmgNumber(c, dmg, crit);
  if (!e.boss) {
    const d = new THREE.Vector3(e.pos.x - from.x, 0, e.pos.z - from.z).normalize();
    e.vel.addScaledVector(d, knock);
    e.poiseDmg += dmg;
    if (e.poiseDmg >= e.def.poise && e.state !== 'rising') { e.state = 'stagger'; e.t = 0; e.poiseDmg = 0; }
  } else {
    e.poiseDmg += dmg;
    if (e.poiseDmg > 260 && e.state === 'chase') { e.state = 'stagger'; e.t = 0; e.poiseDmg = 0; }
  }
  if (kind === 'blade') {
    P.focus = Math.min(P.maxFocus, P.focus + 6);
    if (P.lifesteal) P.hp = Math.min(P.maxHp, P.hp + P.lifesteal);
    if (P.burn) e.burnT = 3;
    S.combo++; S.comboT = 2.6; updateCombo();
  }
  Audio.hit(crit || kind !== 'blade');
  if (e.type === 'brute' || e.boss) Audio.clang();
  S.hitstop = Math.max(S.hitstop, crit ? 0.1 : 0.055);
  S.shake = Math.max(S.shake, e.boss ? 0.22 : 0.15);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.state = 'dying'; e.t = 0;
  S.kills++;
  Audio.death();
  if (P.lock === e) P.lock = null;
  const c = e.pos.clone(); c.y += e.height * 0.5;
  fx.burst(c, e.boss ? 220 : 46, e.boss ? 10 : 4.5, [1.6, 0.9, 3.6], [0.3, 0.05, 0.6], 0.15, 1.3, -1.5, 0.6, 1.5);
  const n = Math.round(e.boss ? 150 : e.def.souls * (1 + S.k * 0.5) * (1 + Math.min(S.combo, 30) * 0.02));
  const orbs = Math.min(n, e.boss ? 60 : 14);
  for (let i = 0; i < orbs; i++) spawnSoul(c, Math.ceil(n / orbs));
  if (e.boss) {
    S.boss = null;
    $('bossBar').classList.remove('show');
    S.shake = 1.4; S.slow = 0.18; S.slowT = 1.6;
    Audio.boom(1); Audio.bell();
    showBanner('הממלכה שוחררה', KINGDOMS[S.k].name + ' — ' + e.def.name + ' נפל', 3.4, 'victory');
    for (const o of enemies) if (o !== e && o.state !== 'dying') killEnemy(o);
    later(2.4, () => openPortal());
  }
}
function spawnSoul(p, value) {
  const m = new THREE.Mesh(soulGeo, soulMat);
  m.position.copy(p);
  scene.add(m);
  souls.push({ mesh: m, vel: new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), t: 0, value });
}
const soulGeo = new THREE.SphereGeometry(0.06, 8, 6);
const soulMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.2, 4.5) });

function arcHit(e, range, arc, dmg) {
  const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
  if (Math.hypot(dx, dz) > range + 0.45) return;
  if (Math.abs(angDiff(e.face, Math.atan2(dx, dz))) > arc) return;
  damagePlayer(dmg, e.pos);
}
function radialHit(p, r, dmg) {
  if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < r) damagePlayer(dmg, p, 9);
}
function front(e, d) { return new THREE.Vector3(e.pos.x + Math.sin(e.face) * d, 0, e.pos.z + Math.cos(e.face) * d); }

const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
const discGeo = new THREE.CircleGeometry(1, 64);
function telegraph(p, r, life, color = [2.4, 0.15, 0.04]) {
  const y = world.heightAt(p.x, p.z) + 0.06;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, y, p.z); ring.scale.setScalar(r);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color[0] * 0.4, color[1] * 0.4, color[2] * 0.4), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, y + 0.01, p.z);
  scene.add(ring, disc);
  decals.push({ mesh: ring, t: 0, life, kind: 'ring' }, { mesh: disc, t: 0, life, kind: 'grow', r });
}
function shockwave(p, r, dmg, style = 'dust') {
  S.shake = Math.max(S.shake, 0.9); Audio.boom();
  const y = world.heightAt(p.x, p.z);
  radialHit(p, r, dmg);
  const hot = KINGDOMS[S.k].id === 'frost' ? [[1.4, 2.4, 3.2], [0.2, 0.4, 0.8]] : KINGDOMS[S.k].id === 'void' ? [[2, 1, 4], [0.4, 0.1, 0.8]] : [[3, 1.1, 0.3], [0.9, 0.08, 0.02]];
  for (let k = 0; k < 90; k++) { const a = Math.random() * Math.PI * 2, s = rand(4, 10); fx.emit(p.x + Math.cos(a) * 0.5, y + 0.2, p.z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, hot[0], hot[1], rand(0.1, 0.25), rand(0.4, 0.8), 6, 2); }
  for (let k = 0; k < 36; k++) { const a = Math.random() * Math.PI * 2, s = rand(1, 4); smoke.emit(p.x + Math.cos(a) * 1.5, y + 0.2, p.z + Math.sin(a) * 1.5, Math.cos(a) * s, rand(0.5, 2), Math.sin(a) * s, dustCol(), dustCol(0.5), rand(0.7, 1.3), rand(1, 1.7), -0.2, 1.5, 2.2); }
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...hot[0]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, y + 0.1, p.z);
  scene.add(ring); decals.push({ mesh: ring, t: 0, life: 0.5, kind: 'wave', r });
}
function explosion(p, r, dmg, col = [3, 1.1, 0.3], col2 = [0.9, 0.08, 0.02], who = 'enemy') {
  Audio.boom(0.45);
  fx.burst(p, 50, 7, col, col2, 0.18, 0.6, 3, 0.4, 2.5);
  fx.burst(p, 14, 2.5, [col[0] * 1.5, col[1] * 1.5, col[2] * 1.5], col2, 0.35, 0.3, 0, 0, 3);
  for (let k = 0; k < 10; k++) smoke.emit(p.x, p.y, p.z, rand(-2, 2), rand(0.5, 2.5), rand(-2, 2), dustCol(), dustCol(0.5), rand(0.6, 1.1), rand(0.8, 1.4), -0.3, 1.5, 2);
  S.shake = Math.max(S.shake, 0.3);
  if (who === 'enemy') radialHit(p, r, dmg);
  else for (const e of enemies) { if (e.state === 'dying') continue; const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.radius; if (d < r) hitEnemy(e, dmg * (1 - (d / r) * 0.4), p, 8, 'spell'); }
}
const spikeGeo = new THREE.ConeGeometry(0.35, 2.2, 6);
spikeGeo.translate(0, 1.1, 0);
function iceSpike(p, dmg) {
  const M = materialsFor('frost');
  const m = new THREE.Mesh(spikeGeo, M.ice);
  const y = world.heightAt(p.x, p.z);
  m.position.set(p.x, y - 2.2, p.z); m.rotation.set(rand(-0.25, 0.25), rand(0, 6), rand(-0.25, 0.25));
  m.scale.setScalar(rand(0.7, 1.3)); m.castShadow = true;
  scene.add(m);
  spikes.push({ m, t: 0, y });
  fx.burst(tmp.set(p.x, y + 0.3, p.z), 10, 3, [1.4, 2.2, 3], [0.2, 0.4, 0.7], 0.08, 0.5, 6, 0.6, 1);
  if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 1.1) damagePlayer(dmg, p, 6);
}
function fireProjectile(o) {
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...o.color) }));
  m.position.copy(o.from);
  m.scale.setScalar(o.size || 1);
  scene.add(m);
  projectiles.push({ mesh: m, vel: o.dir.clone().multiplyScalar(o.speed), speed: o.speed, dmg: o.dmg, owner: o.owner || 'enemy', homing: o.homing || 0, target: o.target || null, life: o.life || 5, color: o.color, grav: o.grav || 0, aoe: o.aoe || 0, kind: o.kind || 'orb' });
}
const projGeo = new THREE.SphereGeometry(0.2, 14, 10);

// ---------------- boss moves ----------------
const MOVES = {
  ash: [
    { id: 'sweep', min: 0, max: 5.4, w: 3, wind: 0.8, act: 0.4, rec: 0.75, pose: 'sweep', hits: [0.12], hit: (e) => { arcHit(e, 5.4, 1.65, e.dmg); sparkArc(e, 4.5); Audio.heavy(); } },
    { id: 'slam', min: 0, max: 4.6, w: 2, wind: 0.95, act: 0.3, rec: 0.9, pose: 'overhead', start: (e) => telegraph(front(e, 2.8), 3.6, 0.95), hits: [0.06], hit: (e) => shockwave(front(e, 2.8), 3.6, e.dmg * 1.1) },
    { id: 'leap', min: 6, max: 20, w: 1.6, wind: 1.0, act: 0.65, rec: 0.95, pose: 'overhead', leap: true, start: (e) => { e.leapTo = P.pos.clone(); telegraph(e.leapTo, 4.4, 1.65); }, land: (e) => shockwave(e.pos, 4.4, e.dmg * 1.2) },
    { id: 'summon', phase2: true, once: true, min: 0, max: 99, w: 99, wind: 0.9, act: 0.3, rec: 1.0, pose: 'cast', hits: [0.05], hit: (e) => summon(e, ['husk', 'husk', 'wraith', 'husk', 'wraith']) },
  ],
  frost: [
    { id: 'pound', min: 0, max: 7, w: 3, wind: 1.0, act: 0.8, rec: 0.9, pose: 'slam', hits: [0.05], hit: (e) => { S.shake = 0.8; Audio.ice(); Audio.boom(0.5); for (let ring = 0; ring < 5; ring++) { const r = 2 + ring * 1.7, n = 6 + ring * 4; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + ring; const p = new THREE.Vector3(e.pos.x + Math.cos(a) * r, 0, e.pos.z + Math.sin(a) * r); S.events.push({ t: S.time + ring * 0.14, fn: () => iceSpike(p, e.dmg * 0.8) }); } } } },
    { id: 'volley', min: 5, max: 22, w: 2.5, wind: 0.8, act: 0.4, rec: 0.7, pose: 'cast', hits: [0.05, 0.25], hit: (e) => { Audio.ice(); const from = e.pos.clone(); from.y += 3.6; for (let i = -3; i <= 3; i++) { const d = new THREE.Vector3(P.pos.x - from.x, P.pos.y + 1 - from.y, P.pos.z - from.z).normalize(); d.applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.14); fireProjectile({ from, dir: d, speed: 15, dmg: e.dmg * 0.55, color: [1.6, 2.6, 3.4], kind: 'shard', size: 0.8 }); } } },
    { id: 'charge', min: 7, max: 22, w: 1.5, wind: 0.75, act: 0.75, rec: 1.0, pose: 'lunge', dash: 15, contact: 1.0 },
    { id: 'nova', phase2: true, min: 0, max: 99, w: 1.2, wind: 1.7, act: 0.3, rec: 1.2, pose: 'slam', start: (e) => telegraph(e.pos, 8.5, 1.7, [0.4, 1.6, 3]), hits: [0.05], hit: (e) => { shockwave(e.pos, 8.5, e.dmg * 1.3); Audio.ice(); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; iceSpike(new THREE.Vector3(e.pos.x + Math.cos(a) * 8, 0, e.pos.z + Math.sin(a) * 8), 0); } } },
  ],
  ember: [
    { id: 'hammer', min: 0, max: 6, w: 3, wind: 1.0, act: 0.7, rec: 0.9, pose: 'overhead', start: (e) => { for (let i = 0; i < 7; i++) telegraph(front(e, 2.5 + i * 1.6), 1.4, 1.0 + i * 0.09); }, hits: [0.05], hit: (e) => { const f = e.face; for (let i = 0; i < 7; i++) { const p = new THREE.Vector3(e.pos.x + Math.sin(f) * (2.5 + i * 1.6), 0, e.pos.z + Math.cos(f) * (2.5 + i * 1.6)); p.y = world.heightAt(p.x, p.z) + 0.3; S.events.push({ t: S.time + i * 0.09, fn: () => explosion(p, 1.5, e.dmg * 0.9) }); } S.shake = 1; } },
    { id: 'erupt', min: 0, max: 16, w: 1.6, wind: 0.6, act: 0.3, rec: 0.6, pose: 'cast', hits: [0.05], hit: (e) => { Audio.fire(); for (let i = 0; i < 6; i++) { const p = new THREE.Vector3(P.pos.x + rand(-4, 4), 0, P.pos.z + rand(-4, 4)); if (i === 0) p.set(P.pos.x, 0, P.pos.z); telegraph(p, 1.9, 1.25); p.y = world.heightAt(p.x, p.z) + 0.3; S.events.push({ t: S.time + 1.25, fn: () => { explosion(p, 1.9, e.dmg * 0.9); for (let k = 0; k < 20; k++) fx.emit(p.x, p.y, p.z, rand(-1, 1), rand(6, 11), rand(-1, 1), [4, 1.4, 0.2], [1, 0.1, 0], 0.2, 1.0, 9, 0.5); } }); } } },
    { id: 'fireballs', min: 6, max: 22, w: 2, wind: 0.8, act: 0.6, rec: 0.7, pose: 'cast', hits: [0.05, 0.25, 0.45], hit: (e) => { Audio.fire(); const from = e.pos.clone(); from.y += 4; const tgt = P.pos.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))); const T = 1.1; const d = tgt.clone().sub(from); const vel = new THREE.Vector3(d.x / T, (d.y + 0.5 * 14 * T * T) / T, d.z / T); fireProjectile({ from, dir: vel.clone().normalize(), speed: vel.length(), dmg: e.dmg * 0.8, color: [5, 1.6, 0.3], grav: 14, aoe: 2.3, kind: 'fireball', size: 1.6 }); telegraph(tgt, 2.3, T); } },
    { id: 'sweep', min: 0, max: 5, w: 2, wind: 0.75, act: 0.4, rec: 0.7, pose: 'sweep', hits: [0.12], hit: (e) => { arcHit(e, 5.2, 1.7, e.dmg); sparkArc(e, 4.5); Audio.heavy(); } },
  ],
  void: [
    { id: 'combo', min: 0, max: 4.6, w: 3, wind: 0.45, act: 1.0, rec: 0.7, pose: 'combo', hits: [0.05, 0.38, 0.72], step: 6, hit: (e, i) => { arcHit(e, 4.6, 1.4, e.dmg * (i === 2 ? 1.3 : 0.8)); sparkArc(e, 4); Audio.swing(); } },
    { id: 'dash', min: 5, max: 18, w: 2, wind: 0.55, act: 0.5, rec: 0.8, pose: 'lunge', dash: 22, contact: 1.2 },
    { id: 'orbs', min: 0, max: 20, w: 1.6, wind: 0.7, act: 0.4, rec: 0.6, pose: 'cast', hits: [0.05], hit: (e) => { Audio.spell(); for (let i = 0; i < 5; i++) { const from = e.pos.clone(); from.y += 3; const a = e.face + (i - 2) * 0.5; fireProjectile({ from, dir: new THREE.Vector3(Math.sin(a), 0.3, Math.cos(a)).normalize(), speed: 6.5, dmg: e.dmg * 0.6, color: [2.2, 0.8, 5], homing: 1.4, life: 6, kind: 'orb', size: 1.2 }); } } },
    { id: 'blink', phase2: true, min: 0, max: 99, w: 2.2, wind: 0.25, act: 0.75, rec: 0.6, pose: 'combo', blink: true, hits: [0.38], hit: (e) => { arcHit(e, 4.6, 1.6, e.dmg * 1.2); sparkArc(e, 4); } },
  ],
};
function sparkArc(e, r) {
  for (let i = 0; i < 26; i++) { const a = e.face + rand(-1.5, 1.5); fx.emit(e.pos.x + Math.sin(a) * r, e.pos.y + 1.2 + rand(0, 1.5), e.pos.z + Math.cos(a) * r, Math.sin(a) * 3, 1, Math.cos(a) * 3, [4, 1.5, 0.4], [0.9, 0.1, 0], 0.12, 0.4, 2, 2); }
}
function summon(e, types) {
  Audio.bell();
  types.forEach((t, k) => {
    const a = (k / types.length) * Math.PI * 2 + rand(-0.3, 0.3);
    const x = e.pos.x + Math.cos(a) * 6, z = e.pos.z + Math.sin(a) * 6;
    if (Math.hypot(x, z) < ARENA_R - 2) S.spawnQueue.push({ type: t, x, z, delay: S.spawnT + k * 0.3 });
  });
}

// ---------------- enemy update ----------------
function updateEnemy(e, dt) {
  const def = e.def;
  e.t += dt; e.atkCd -= dt;
  const toP = new THREE.Vector3(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z);
  const dist = toP.length();
  const want = Math.atan2(toP.x, toP.z);
  let move = 0, turn = e.boss ? 3.2 : 6;
  if (e.flash > 0) {
    e.flash = Math.max(0, e.flash - dt * 7);
    for (const m of e.mats) { m.emissive.setRGB(1, 0.85, 0.7).lerp(m.userData.e0, 1 - e.flash); m.emissiveIntensity = lerp(m.userData.ei0, 2.4, e.flash); }
  }
  if (e.burnT > 0) {
    e.burnT -= dt;
    if (Math.random() < 0.5) fx.emit(e.pos.x + rand(-0.3, 0.3), e.pos.y + rand(0.3, e.height), e.pos.z + rand(-0.3, 0.3), 0, rand(1, 2), 0, [3, 1, 0.2], [0.8, 0.1, 0], 0.12, 0.5, -1, 1);
    e.burnAcc = (e.burnAcc || 0) + dt;
    if (e.burnAcc > 0.5) { e.burnAcc = 0; e.hp -= P.burn; dmgNumber(tmp.copy(e.pos).setY(e.pos.y + e.height), P.burn, false, true); if (e.hp <= 0 && e.state !== 'dying') killEnemy(e); }
  }
  const rig = e.rig;
  let pose = null;
  const base = UNDEAD_IDLE;

  switch (e.state) {
    case 'rising': {
      const rt = def.flying ? 0.9 : 1.3;
      const k = ease(Math.min(1, e.t / rt));
      if (!def.flying) {
        rig.root.position.y = e.pos.y - 2 * (1 - k);
        if (Math.random() < 0.7) smoke.emit(e.pos.x + rand(-0.6, 0.6), e.pos.y + 0.1, e.pos.z + rand(-0.6, 0.6), rand(-1, 1), rand(1, 2.5), rand(-1, 1), dustCol(), dustCol(0.4), rand(0.3, 0.6), 0.9, 4, 1, 0.9);
      } else if (Math.random() < 0.7) fx.emit(e.pos.x + rand(-0.4, 0.4), e.pos.y + rand(0, 2), e.pos.z + rand(-0.4, 0.4), 0, rand(0.5, 1.5), 0, [0.4, 2, 2], [0.05, 0.3, 0.3], 0.1, 0.7, 0, 1);
      pose = mixPose({ ...base, spine: [1.0, 0, 0], shR: [-2.5, 0, 0], shL: [-2.5, 0, 0], hy: -0.3 }, base, k);
      if (e.t > rt) { e.state = 'chase'; e.t = 0; }
      break;
    }
    case 'intro': {
      turn = 2;
      pose = mixPose(base, { ...base, ...{ shR: [-2.8, -0.4, -0.4], shL: [-2.8, 0.4, 0.4], spine: [-0.3, 0, 0], head: [-0.5, 0, 0], jaw: [0.8, 0, 0] } }, Math.sin(Math.min(1, e.t / 2.4) * Math.PI));
      if (e.t > 2.6) { e.state = 'chase'; e.t = 0; e.atkCd = 0.6; }
      break;
    }
    case 'chase': {
      if (e.boss) {
        if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; e.speed *= 1.2; showBanner('', 'זעם ' + def.name + ' מתעורר', 1.8, 'boss'); Audio.roar(); S.shake = 0.8; }
        move = dist > 3.4 ? 1 : 0;
        if (e.atkCd <= 0) {
          const list = MOVES[e.kid].filter((m) => (!m.phase2 || e.phase2) && !(m.once && e.used[m.id]) && dist >= m.min && dist <= m.max);
          if (list.length) {
            let tot = list.reduce((a, m) => a + m.w, 0), r = Math.random() * tot, mv = list[0];
            for (const m of list) { r -= m.w; if (r <= 0) { mv = m; break; } }
            e.move = mv; e.used[mv.id] = true; e.state = 'wind'; e.t = 0; e.hitIdx = 0;
            if (mv.blink) { const behind = new THREE.Vector3(P.pos.x - Math.sin(P.face) * 2.5, 0, P.pos.z - Math.cos(P.face) * 2.5); fx.burst(tmp.copy(e.pos).setY(e.pos.y + 2), 40, 4, [2, 0.8, 4], [0.3, 0, 0.6], 0.2, 0.6, 0, 0.3, 2); e.pos.x = behind.x; e.pos.z = behind.z; e.face = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z); fx.burst(tmp.copy(e.pos).setY(e.pos.y + 2), 40, 4, [2, 0.8, 4], [0.3, 0, 0.6], 0.2, 0.6, 0, 0.3, 2); Audio.spell(); }
            if (mv.start) mv.start(e);
          }
        }
      } else if (def.ranged) {
        if (dist > 12) move = 1; else if (dist < 7) move = -0.8; else move = 0.3 * Math.sin(S.time + e.walk);
        if (e.atkCd <= 0 && dist < def.range) { e.attack = 'cast'; e.state = 'wind'; e.t = 0; Audio.cast(); }
      } else {
        move = dist > def.range * 0.8 ? 1 : 0;
        if (e.atkCd <= 0 && dist < def.range) { e.attack = def.attacks[Math.floor(Math.random() * def.attacks.length)]; e.state = 'wind'; e.t = 0; }
      }
      pose = def.flying ? { ...base, spine: [0.3, 0, 0], shR: [-0.7, -0.2, -0.3], shL: [-0.7, 0.2, 0.3] } : undeadWalk(e.walk, 1, e.type === 'brute' ? 0.35 : 0.25);
      break;
    }
    case 'wind': {
      const wind = e.boss ? e.move.wind : def.windup;
      turn = e.boss ? 2.4 : 4;
      const k = ease(Math.min(1, e.t / wind));
      if (rig.eyes) rig.eyes.scale.setScalar(1 + k * 1.5);
      pose = undeadAttackPose(base, e.boss ? e.move.pose : e.attack, 'wind', k);
      if (e.boss && e.move.pose === 'combo') pose = undeadAttackPose(base, 'slash', 'wind', k);
      if (e.type === 'priest' && rig.weapon?.userData.orb && Math.random() < 0.8) { const op = rig.weapon.userData.orb.getWorldPosition(tmp); fx.emit(op.x + rand(-0.4, 0.4), op.y + rand(-0.4, 0.4), op.z + rand(-0.4, 0.4), 0, 0, 0, eyeCol(e), [0.3, 0, 0], 0.1, 0.25, 0, 0); }
      if (e.t >= wind) {
        e.state = 'strike'; e.t = 0; e.struck = false; e.hitIdx = 0;
        if (e.type === 'wraith' || (e.boss && e.move.dash)) e.lungeDir = toP.clone().normalize();
        if (e.boss && e.move.leap) e.leapFrom = e.pos.clone();
      }
      break;
    }
    case 'strike': {
      if (rig.eyes) rig.eyes.scale.setScalar(2);
      if (e.boss) {
        const mv = e.move;
        const kk = Math.min(1, e.t / Math.min(mv.act, 0.18));
        let kind = mv.pose;
        if (kind === 'combo') { const seg = Math.floor(e.t / (mv.act / 3)); kind = seg % 2 ? 'sweep' : 'slash'; pose = undeadAttackPose(base, kind, 'strike', Math.min(1, (e.t % (mv.act / 3)) / 0.12)); }
        else pose = undeadAttackPose(base, kind, 'strike', kk);
        if (mv.hits) while (e.hitIdx < mv.hits.length && e.t >= mv.hits[e.hitIdx]) { mv.hit(e, e.hitIdx); e.hitIdx++; }
        if (mv.step) { const seg = (e.t % (mv.act / 3)) / (mv.act / 3); if (seg < 0.3) { e.vel.x += Math.sin(e.face) * mv.step * dt * 6; e.vel.z += Math.cos(e.face) * mv.step * dt * 6; } turn = 3; }
        if (mv.dash) {
          e.vel.x = e.lungeDir.x * mv.dash; e.vel.z = e.lungeDir.z * mv.dash;
          if (!e.struck && dist < e.radius + mv.contact) { e.struck = true; damagePlayer(e.dmg, e.pos, 12); }
          if (Math.random() < 0.8) smoke.emit(e.pos.x, e.pos.y + 0.2, e.pos.z, rand(-1, 1), 1, rand(-1, 1), dustCol(), dustCol(0.5), 1, 1, 0, 2, 1.8);
          turn = 0;
        }
        if (mv.leap) {
          const k = Math.min(1, e.t / mv.act);
          e.pos.x = lerp(e.leapFrom.x, e.leapTo.x, k); e.pos.z = lerp(e.leapFrom.z, e.leapTo.z, k);
          e.hop = Math.sin(k * Math.PI) * 6;
          if (k >= 1 && !e.struck) { e.struck = true; e.hop = 0; mv.land(e); }
          turn = 0;
        }
        if (e.t >= mv.act) { e.state = 'recover'; e.t = 0; }
      } else {
        pose = undeadAttackPose(base, e.attack, 'strike', Math.min(1, e.t / 0.14));
        if (e.type === 'wraith') {
          e.vel.addScaledVector(e.lungeDir, 42 * dt);
          if (!e.struck && dist < 1.3) { e.struck = true; damagePlayer(e.dmg, e.pos); }
        } else if (def.ranged) {
          if (!e.struck) {
            e.struck = true;
            const op = rig.weapon?.userData.orb ? rig.weapon.userData.orb.getWorldPosition(V()) : e.pos.clone().setY(e.pos.y + 2);
            const n = S.k >= 2 ? 3 : S.k >= 1 ? 2 : 1;
            for (let k = 0; k < n; k++) {
              const d = new THREE.Vector3(P.pos.x - op.x, P.pos.y + 1.1 - op.y, P.pos.z - op.z).normalize();
              d.applyAxisAngle(new THREE.Vector3(0, 1, 0), (k - (n - 1) / 2) * 0.22);
              fireProjectile({ from: op, dir: d, speed: 9.5, dmg: e.dmg, color: eyeCol(e), homing: 1.1 });
            }
          }
        } else {
          if (e.t < 0.12) e.vel.addScaledVector(toP.clone().normalize(), 16 * dt);
          if (!e.struck && e.t > 0.07) { e.struck = true; arcHit(e, def.range, 1.15, e.dmg); Audio.swing(); if (e.attack === 'slam') shockwave(front(e, 1.5), 2.4, e.dmg * 0.6); }
        }
        if (e.t >= def.strike) { e.state = 'recover'; e.t = 0; }
      }
      break;
    }
    case 'recover': {
      turn = 1.5;
      if (rig.eyes) rig.eyes.scale.setScalar(1);
      const rec = e.boss ? e.move.rec : def.recover;
      pose = undeadAttackPose(base, e.boss ? (e.move.pose === 'combo' ? 'slash' : e.move.pose) : e.attack, 'rec', Math.min(1, e.t / rec));
      if (e.t >= rec) { e.state = 'chase'; e.t = 0; e.atkCd = e.boss ? rand(0.3, 0.9) * (e.phase2 ? 0.6 : 1) + (dist > 9 ? 1.2 : 0) : def.cd * rand(0.8, 1.4); }
      break;
    }
    case 'stagger': {
      turn = 0;
      pose = { ...base, spine: [-0.4, 0, 0.2], head: [-0.4, 0.3, 0], shR: [0.4, 0, -0.4], shL: [0.4, 0, 0.4], hy: -0.06 };
      if (e.t > (e.boss ? 1.2 : 0.5)) { e.state = 'chase'; e.t = 0; e.atkCd = Math.max(e.atkCd, 0.3); }
      break;
    }
    case 'dying': {
      const k = Math.min(1, e.t / 1.4);
      pose = mixPose(base, { ...base, spine: [1.2, 0, 0.3], head: [0.6, 0, 0], thighL: [-1.5, 0, 0], shinL: [2, 0, 0], thighR: [-1.2, 0, 0], shinR: [2, 0, 0], shR: [0.5, 0, -0.6], shL: [0.4, 0, 0.6], hy: -0.55, jaw: [0.9, 0, 0] }, ease(Math.min(1, k * 2)));
      rig.root.position.y = e.pos.y - Math.max(0, k - 0.4) * 2.2 * (e.boss ? 2 : 1);
      if (Math.random() < 0.6) fx.emit(e.pos.x + rand(-0.6, 0.6), e.pos.y + rand(0, e.height), e.pos.z + rand(-0.6, 0.6), 0, rand(0.5, 2), 0, [1.4, 0.8, 3.2], [0.3, 0.05, 0.6], 0.1, 0.9, -1, 1);
      drivePose(rig, pose, dt, 10);
      if (e.t > 1.5) { disposeRig(e); e.dead = true; }
      return;
    }
  }
  if (turn > 0) e.face += clamp(angDiff(e.face, want), -turn * dt, turn * dt);
  const sp = e.speed;
  if (move !== 0) {
    const dir = toP.clone().normalize();
    if (move > 0) steerAround(e, dir, dist);
    // strafe a bit when close to look smarter
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sin(S.time * 0.7 + e.walk) * 0.35);
    e.vel.x = lerp(e.vel.x, (dir.x + side.x) * sp * move, 1 - Math.exp(-6 * dt));
    e.vel.z = lerp(e.vel.z, (dir.z + side.z) * sp * move, 1 - Math.exp(-6 * dt));
  } else if (!(e.boss && e.move?.dash && e.state === 'strike')) e.vel.multiplyScalar(Math.exp(-7 * dt));
  for (const o of enemies) {
    if (o === e || o.state === 'dying') continue;
    const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz), md = e.radius + o.radius;
    if (d < md && d > 0.001) { e.vel.x += (dx / d) * (md - d) * 40 * dt; e.vel.z += (dz / d) * (md - d) * 40 * dt; }
  }
  if (!(e.boss && e.move?.leap && e.state === 'strike')) { e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt; }
  collide(e.pos, e.radius);
  { const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz), md = e.radius + 0.42; if (d < md && d > 0.001) { e.pos.x += (dx / d) * (md - d); e.pos.z += (dz / d) * (md - d); } }
  e.pos.y = world.heightAt(e.pos.x, e.pos.z);
  const spd = Math.hypot(e.vel.x, e.vel.z);
  e.walk += dt * spd * (e.boss ? 1.3 : 3.0) / Math.max(1, rig.root.scale.x * 0.7);
  if (e.state !== 'rising') rig.root.position.set(e.pos.x, e.pos.y + e.hop + (def.flying ? Math.sin(S.time * 2.4 + e.walk) * 0.12 : 0), e.pos.z);
  rig.root.rotation.y = e.face;
  if (def.flying && rig.body) { rig.body.rotation.x = clamp(spd * 0.05, 0, 0.45); if (Math.random() < 0.4) fx.emit(e.pos.x + rand(-0.3, 0.3), e.pos.y + 0.4, e.pos.z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.2, 0.6), rand(-0.3, 0.3), eyeCol(e, 0.5), [0.05, 0.1, 0.15], 0.1, 0.8, 0, 1); }
  if (pose) {
    if (rig.cape && pose === base) pose = GUARD;
    drivePose(rig, pose, dt, e.state === 'strike' ? 30 : 14);
  }
  if (rig.cape) rig.cape.update(dt, G.wind.value);
}
function steerAround(e, dir, dist) {
  // slide around obstacles (pillars, altars, the forge) instead of grinding into them
  for (const c of world.colliders) {
    const dx = c.x - e.pos.x, dz = c.z - e.pos.z, d = Math.hypot(dx, dz);
    const R = c.r + e.radius + 0.4;
    if (d > R + 3 || d > dist) continue;
    const ahead = (dx * dir.x + dz * dir.z) / (d || 1);
    if (ahead < 0.2) continue;
    let px = -dir.z, pz = dir.x;
    if (px * dx + pz * dz > 0) { px = -px; pz = -pz; }
    const w = Math.min(1.5, (1 - Math.max(0, d - R) / 3) * ahead * 2.2);
    dir.x += px * w; dir.z += pz * w;
  }
  dir.normalize();
}
function disposeRig(e) {
  const rig = e.rig;
  scene.remove(rig.root); if (rig.cape) { scene.remove(rig.cape.mesh); rig.cape.geo.dispose(); }
  rig.root.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  for (const m of e.mats) m.dispose();
}
function eyeCol(e, m = 1) { const c = new THREE.Color(e.rig.M?.eye?.color || 0xff4020); return [c.r * m * 0.8, c.g * m * 0.8, c.b * m * 0.8]; }

// ---------------- collision ----------------
function collide(p, r) {
  for (const c of world.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), md = c.r + r;
    if (d < md && d > 0.0001) { p.x += (dx / d) * (md - d); p.z += (dz / d) * (md - d); }
  }
  const d = Math.hypot(p.x, p.z);
  if (d > ARENA_R) { p.x *= ARENA_R / d; p.z *= ARENA_R / d; }
}

// ---------------- waves ----------------
function waveList(k, w) {
  const extra = k;
  const L = [];
  const add = (t, n) => { for (let i = 0; i < n; i++) L.push(t); };
  if (w === 1) { add('husk', 4 + extra); if (k > 0) add('wraith', 1 + Math.floor(k / 2)); }
  else if (w === 2) { add('husk', 3 + extra); add('wraith', 2 + Math.floor(k / 2)); add('priest', 1 + Math.floor(k / 2)); }
  else if (w === 3) { add('husk', 3 + extra); add('brute', 1 + Math.floor(k / 2)); add('priest', 1 + Math.floor((k + 1) / 2)); add('wraith', 2); }
  return L;
}
function startWave() {
  S.wave++;
  updatePips();
  const isBoss = S.wave > S.wavesPer;
  if (isBoss) {
    const a = Math.atan2(P.pos.z, P.pos.x) + Math.PI;
    S.spawnQueue = [{ type: 'boss', x: Math.cos(a) * 15, z: Math.sin(a) * 15, delay: 1.2 }];
    S.bars = 0.001;
  } else {
    const list = waveList(S.k, S.wave);
    S.spawnQueue = list.map((type, i) => {
      let x, z, g = 0;
      do { const a = Math.random() * Math.PI * 2, r = rand(11, ARENA_R - 3); x = Math.cos(a) * r; z = Math.sin(a) * r; g++; }
      while (g < 40 && (Math.hypot(x - P.pos.x, z - P.pos.z) < 9 || world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.2) || world.hazards.some((h) => h.kind === 'lava' && Math.hypot(h.x - x, h.z - z) < h.r + 1)));
      return { type, x, z, delay: i * 0.7 + rand(0, 0.4) };
    });
    showBanner(`גל ${['', 'ראשון', 'שני', 'שלישי'][S.wave]}`, waveFlavor(), 2.4);
  }
  S.spawnT = 0; S.waveActive = true;
  Audio.bell();
}
function waveFlavor() {
  const L = {
    ash: ['המתים מתעוררים מקבריהם', 'רוחות הערפל צדות את החיים', 'כוהני העצם לוחשים את שמך'],
    frost: ['הקרח נסדק תחת רגליך', 'רוחות השלג מייללות', 'הקור מגיע עד העצם'],
    ember: ['האפר נושם', 'הלהבות זוכרות את שמך', 'ההר רועד בזעם'],
    void: ['הצללים לובשים צורה', 'התהום מביטה בך', 'אין דרך חזרה מכאן'],
  }[KINGDOMS[S.k].id];
  return L[(S.wave - 1) % 3];
}
function updateWaves(dt) {
  if (!S.waveActive) return;
  S.spawnT += dt;
  for (let i = S.spawnQueue.length - 1; i >= 0; i--) {
    const q = S.spawnQueue[i];
    if (S.spawnT >= q.delay) { spawnEnemy(q.type, q.x, q.z); S.spawnQueue.splice(i, 1); }
  }
  if (S.spawnQueue.length === 0 && enemies.length === 0 && souls.length === 0 && !S.portal) {
    S.waveActive = false;
    if (S.wave <= S.wavesPer) later(0.9, () => { if (S.mode === 'play') waveCleared(); });
  }
}

// ---------------- blessings ----------------
const BLESSINGS = [
  { id: 'hp', glyph: 'I', name: 'לב של ברזל', desc: '+30 חיים מקסימליים וריפוי מלא', apply: () => { P.maxHp += 30; P.hp = P.maxHp; } },
  { id: 'dmg', glyph: 'II', name: 'להב מושחז', desc: 'נזק הלהב עולה ב-20%', apply: () => { P.dmgMul *= 1.2; } },
  { id: 'st', glyph: 'III', name: 'נשימה שנייה', desc: '+25 סיבולת והתאוששות מהירה יותר', apply: () => { P.maxSt += 25; P.stRegen += 9; } },
  { id: 'flask', glyph: 'IV', name: 'בקבוק אפר', desc: 'שיקוי מרפא נוסף בכל גל', apply: () => { P.maxFlasks++; P.flasks++; } },
  { id: 'spell', glyph: 'V', name: 'אש הנשמה', desc: 'הלחש חזק ב-45% וזול יותר', apply: () => { P.spellMul *= 1.45; P.spellCost = Math.max(18, P.spellCost - 6); } },
  { id: 'dodge', glyph: 'VI', name: 'צעד הצל', desc: 'גלגול זול ב-30%, חלון חסינות ארוך', apply: () => { P.dodgeMul *= 0.7; } },
  { id: 'leech', glyph: 'VII', name: 'צמא דם', desc: 'כל פגיעה מחזירה 2 חיים', apply: () => { P.lifesteal += 2; } },
  { id: 'crit', glyph: 'VIII', name: 'עין הזעם', desc: '+12% סיכוי למכה אנושה', apply: () => { P.crit += 0.12; } },
  { id: 'speed', glyph: 'IX', name: 'רגלי הרוח', desc: 'מהירות תנועה +12%', apply: () => { P.speed *= 1.12; } },
  { id: 'burn', glyph: 'X', name: 'להב בוער', desc: 'מכות מציתות את האויב לשלוש שניות', apply: () => { P.burn += 6; } },
  { id: 'spin', glyph: 'XI', name: 'מערבולת', desc: 'ההתקפה המסתובבת זולה ב-40%', apply: () => { P.spinMul *= 0.6; } },
  { id: 'armor', glyph: 'XII', name: 'שריון האבות', desc: 'נזק נכנס יורד ב-12%', apply: () => { P.armor = Math.min(0.5, P.armor + 0.12); } },
];
function waveCleared() {
  P.flasks = P.maxFlasks;
  P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.15);
  showBanner('הגל נהדף', 'הלהבה עדיין בוערת', 1.8, 'victory');
  later(1.9, () => offerBlessing(() => later(1.2, startWave)));
}
function offerBlessing(then) {
  if (S.mode !== 'play') return;
  S.mode = 'choose';
  document.exitPointerLock?.();
  const picks = [...BLESSINGS].sort(() => Math.random() - 0.5).slice(0, 3);
  const box = $('cards'); box.innerHTML = '';
  picks.forEach((b, i) => {
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = `<span class="c-num">${b.glyph}</span><span class="c-name">${b.name}</span><span class="c-desc">${b.desc}</span><span class="c-key">${i + 1}</span>`;
    el.style.animationDelay = i * 0.09 + 's';
    el.onclick = () => {
      b.apply(); P.blessings.push(b.id); Audio.soul(); Audio.click();
      $('choose').classList.remove('show');
      S.mode = 'play';
      if (!IS_TOUCH) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} }
      then && then();
    };
    box.appendChild(el);
  });
  $('choose').classList.add('show');
}

// ---------------- portal & kingdom transitions ----------------
function openPortal() {
  const p = world.portalPos.clone();
  p.y = world.heightAt(p.x, p.z);
  const g = new THREE.Group();
  const ringM = new THREE.MeshStandardMaterial({ color: 0x3a3438, roughness: 0.8, metalness: 0.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.28, 12, 48), ringM);
  ring.castShadow = true;
  const col = { ash: 0xff6a40, frost: 0x60c0ff, ember: 0xff8030, void: 0xb070ff }[KINGDOMS[S.k].id];
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.85, 64), portalMaterial(G, col));
  const light = new THREE.PointLight(col, 0, 14, 1.6);
  light.position.y = 0;
  g.add(ring, disc, light);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const r = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(4) })); r.position.set(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0.3); g.add(r); }
  g.position.set(p.x, p.y + 2.2, p.z);
  g.rotation.y = Math.atan2(P.pos.x - p.x, P.pos.z - p.z);
  scene.add(g);
  S.portal = { g, disc, light, open: 0, pos: p, col };
  Audio.portal();
  hint(S.k < KINGDOMS.length - 1 ? 'השער לממלכה הבאה נפתח' : 'השער האחרון נפתח', 3);
  // relic reward
  P.hp = P.maxHp; P.flasks = P.maxFlasks;
  S.unlocked = Math.max(S.unlocked, Math.min(S.k + 1, KINGDOMS.length - 1)); store.set('ashen2-unlocked', S.unlocked);
  later(0.9, () => offerBlessing(null));
}
function updatePortal(dt) {
  const pt = S.portal; if (!pt) return;
  pt.open = Math.min(1, pt.open + dt * 0.5);
  pt.disc.material.uniforms.open.value = ease(pt.open);
  pt.light.intensity = 18 * pt.open;
  pt.g.children[0].rotation.z += dt * 0.2;
  if (Math.random() < 0.6) { const a = Math.random() * Math.PI * 2; const c = new THREE.Color(pt.col); fx.emit(pt.g.position.x + Math.cos(a) * 1.9, pt.g.position.y + Math.sin(a) * 1.9, pt.g.position.z, 0, 0.5, 0, [c.r * 3, c.g * 3, c.b * 3], [0.1, 0.05, 0.1], 0.12, 1, -0.5, 1); }
  if (S.mode === 'play' && pt.open > 0.6 && Math.hypot(P.pos.x - pt.pos.x, P.pos.z - pt.pos.z) < 1.6) enterPortal();
}
async function enterPortal() {
  S.mode = 'transition';
  Audio.portal();
  await fadeTo(1, 0.9, 0xffffff);
  if (S.k >= KINGDOMS.length - 1) { victory(); return; }
  scene.remove(S.portal.g); S.portal = null;
  await nextFrame();
  await loadKingdom(S.k + 1);
  S.snapshot = snapshotPlayer();
  await chapterCard(S.k);
  S.mode = 'play';
  await fadeTo(0, 1.0);
  later(1.4, startWave);
}
function snapshotPlayer() { const o = {}; for (const k of Object.keys(BASE_P)) o[k] = P[k]; o.blessings = [...P.blessings]; o.souls = S.souls; return o; }
function fadeTo(v, dur, col = 0x000000) {
  return new Promise((res) => {
    const from = S.fade, t0 = performance.now();
    finalPass.uniforms.fadeCol.value.set(col);
    const step = () => { const k = Math.min(1, (performance.now() - t0) / (dur * 1000)); S.fade = lerp(from, v, ease(k)); if (k < 1) requestAnimationFrame(step); else res(); };
    step();
  });
}
function chapterCard(k) {
  const d = KINGDOMS[k];
  $('chNum').textContent = d.numeral; $('chName').textContent = d.name; $('chSub').textContent = d.sub; $('chLore').textContent = d.lore;
  const el = $('chapter');
  el.classList.add('show');
  Audio.bell();
  return new Promise((res) => {
    let done = false;
    const go = () => { if (done) return; done = true; el.classList.remove('show'); removeEventListener('keydown', go); el.removeEventListener('click', go); setTimeout(res, 500); };
    setTimeout(() => { addEventListener('keydown', go); el.addEventListener('click', go); }, 900);
    setTimeout(go, 5200);
  });
}

// ---------------- game flow ----------------
function clearField() {
  for (const e of enemies) disposeRig(e);
  enemies.length = 0;
  for (const p of projectiles) scene.remove(p.mesh); projectiles.length = 0;
  for (const s of souls) scene.remove(s.mesh); souls.length = 0;
  for (const d of decals) scene.remove(d.mesh); decals.length = 0;
  for (const s of spikes) scene.remove(s.m); spikes.length = 0;
  if (S.portal) { scene.remove(S.portal.g); S.portal = null; }
  S.spawnQueue = []; S.events = []; S.boss = null; S.waveActive = false; P.lock = null;
  $('bossBar').classList.remove('show');
  fx && fx.clear(); smoke && smoke.clear();
}
function resetPlayer(snap) {
  Object.assign(P, BASE_P);
  if (snap) { for (const k of Object.keys(BASE_P)) P[k] = snap[k]; P.blessings = [...snap.blessings]; }
  else P.blessings = [];
  P.hp = P.maxHp; P.st = P.maxSt; P.focus = 40; P.flasks = P.maxFlasks; P.ghost = P.hp;
  P.state = 'idle'; P.t = 0; P.invuln = 0; P.lock = null;
}
async function startGame(cont) {
  Audio.init(); Audio.click();
  $('title').classList.remove('show');
  $('death').classList.remove('show');
  $('victory').classList.remove('show');
  S.mode = 'transition';
  await fadeTo(1, 0.6);
  const k = cont ? S.unlocked : 0;
  resetPlayer(null);
  if (cont && k > 0) { P.maxHp += 20 * k; P.dmgMul *= 1 + 0.15 * k; P.maxFlasks += 1; P.hp = P.maxHp; P.flasks = P.maxFlasks; }
  S.souls = 0; S.kills = 0; S.combo = 0;
  if (k !== S.k || !world) await loadKingdom(k); else { clearField(); P.pos.set(0, world.heightAt(0, 10), 10); P.face = Math.PI; knight.cape.reset(); Audio.ambience(KINGDOMS[k].id); }
  S.snapshot = snapshotPlayer();
  await chapterCard(k);
  $('hud').classList.add('show');
  S.mode = 'play';
  if (!IS_TOUCH) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} }
  await fadeTo(0, 0.9);
  later(1.2, startWave);
}
async function retryKingdom() {
  Audio.click();
  $('death').classList.remove('show');
  S.mode = 'transition';
  await fadeTo(1, 0.5);
  clearField();
  resetPlayer(S.snapshot);
  S.souls = S.snapshot.souls; S.wave = 0; updatePips();
  P.pos.set(0, 0, KINGDOMS[S.k].id === 'void' ? 12 : 10); P.pos.y = world.heightAt(P.pos.x, P.pos.z); P.face = Math.PI; knight.cape.reset();
  knight.rollPivot.rotation.x = 0;
  $('hud').classList.add('show');
  S.mode = 'play';
  if (!IS_TOUCH) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} }
  await fadeTo(0, 0.8);
  later(1.0, startWave);
}
function die() {
  P.state = 'dead'; P.t = 0; P.clip = 'death';
  S.mode = 'dead'; P.lock = null;
  document.exitPointerLock?.();
  Audio.bell();
  S.slow = 0.3; S.slowT = 1.2;
  if (S.souls > S.best) { S.best = S.souls; store.set('ashen2-best', S.best); }
  setTimeout(() => {
    $('dStats').innerHTML = `<div><b>${KINGDOMS[S.k].name}</b> · גל ${Math.min(S.wave, 3)}${S.wave > 3 ? ' · מול ' + BOSS[KINGDOMS[S.k].id].name : ''}</div><div><b>${S.kills}</b> הושבו לקבר · <b>${S.souls}</b> נשמות</div>`;
    $('death').classList.add('show');
    $('hud').classList.remove('show');
  }, 1800);
}
function victory() {
  S.mode = 'victory';
  document.exitPointerLock?.();
  if (S.souls > S.best) { S.best = S.souls; store.set('ashen2-best', S.best); }
  $('vStats').innerHTML = `<b>${S.kills}</b> אויבים · <b>${S.souls}</b> נשמות · ${P.blessings.length} ברכות`;
  $('hud').classList.remove('show');
  $('victory').classList.add('show');
  fadeTo(0.6, 2, 0xffffff);
}
function pause(on) {
  if (on) { S.mode = 'pause'; $('pause').classList.add('show'); document.exitPointerLock?.(); }
  else { S.mode = 'play'; $('pause').classList.remove('show'); if (!IS_TOUCH) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} } }
}
function refreshTitle() {
  $('btnContinue').style.display = S.unlocked > 0 ? '' : 'none';
  if (S.unlocked > 0) $('btnContinue').querySelector('small').textContent = KINGDOMS[S.unlocked].name;
  $('bestLine').textContent = S.best ? `השיא שלך · ${S.best} נשמות` : '';
}
$('btnStart').onclick = () => startGame(false);
$('btnContinue').onclick = () => startGame(true);
$('btnRetry').onclick = retryKingdom;
$('btnRestart').onclick = () => startGame(false);
$('btnResume').onclick = () => pause(false);
$('btnQuit').onclick = async () => { $('pause').classList.remove('show'); $('hud').classList.remove('show'); S.mode = 'transition'; await fadeTo(1, 0.5); await loadKingdom(0, true); S.mode = 'title'; refreshTitle(); $('title').classList.add('show'); fadeTo(0, 0.8); };
$('btnVictory').onclick = async () => { $('victory').classList.remove('show'); S.mode = 'transition'; await fadeTo(1, 0.6, 0x000000); await loadKingdom(0, true); S.mode = 'title'; refreshTitle(); $('title').classList.add('show'); fadeTo(0, 1); };

// ---------------- player update ----------------
function updatePlayer(dt) {
  P.t += dt;
  P.invuln = Math.max(0, P.invuln - dt);
  P.stDelay -= dt;
  if (P.stDelay <= 0 && !['dodge', 'charge'].includes(P.state)) P.st = Math.min(P.maxSt, P.st + P.stRegen * dt * (P.state === 'idle' ? 1.3 : 1));
  const mv = S.mode === 'play' ? moveInput() : new THREE.Vector3();
  P.sprint = (keys.ShiftLeft || keys.ShiftRight) && mv.lengthSq() > 0.01 && P.st > 1 && !P.lock;
  let speed = 0;
  const onIce = world.hazards.some((h) => h.kind === 'ice' && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < h.r);
  const lava = world.hazards.find((h) => h.kind === 'lava' && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < h.r);
  if (lava && P.state !== 'dead' && S.mode === 'play') {
    P.burnAcc = (P.burnAcc || 0) + dt;
    if (Math.random() < 0.6) fx.emit(P.pos.x + rand(-0.3, 0.3), P.pos.y + 0.2, P.pos.z + rand(-0.3, 0.3), 0, rand(1, 3), 0, [4, 1.2, 0.2], [1, 0.1, 0], 0.15, 0.6, -1, 1);
    if (P.burnAcc > 0.4) { P.burnAcc = 0; const inv = P.invuln; P.invuln = 0; const st = P.state; damagePlayer(7 + S.k * 2, null, 0); if (P.state === 'hurt' && st !== 'hurt') { P.state = st === 'dodge' ? 'idle' : st; } P.invuln = inv; hint('לבה! צא מהר', 0.6); }
  }
  let pose = null, rate = 16;
  switch (P.state) {
    case 'idle': case 'run': {
      speed = P.speed * (P.sprint ? 1.55 : 1) * (P.lock ? 0.8 : 1);
      if (P.sprint) { P.st -= 15 * dt; P.stDelay = 0.4; }
      if (mv.lengthSq() > 0.01) {
        P.state = 'run';
        const wantF = P.lock && P.lock.state !== 'dying' ? targetAngle(P.lock) : Math.atan2(mv.x, mv.z);
        P.face += angDiff(P.face, wantF) * (1 - Math.exp(-14 * dt));
      } else {
        P.state = 'idle';
        if (P.lock && P.lock.state !== 'dying') P.face += angDiff(P.face, targetAngle(P.lock)) * (1 - Math.exp(-10 * dt));
      }
      if (P.queued && P.st > 6) { P.queued = false; startClip('slash1', 0); }
      break;
    }
    case 'charge': {
      speed = P.speed * 0.35;
      P.charge += dt; P.st -= 8 * dt; P.stDelay = 0.5;
      if (P.lock && P.lock.state !== 'dying') P.face += angDiff(P.face, targetAngle(P.lock)) * (1 - Math.exp(-10 * dt));
      else if (mv.lengthSq() > 0.01) P.face += angDiff(P.face, Math.atan2(mv.x, mv.z)) * (1 - Math.exp(-10 * dt));
      const tip = knight.markers.tip.getWorldPosition(tmp);
      if (Math.random() < 0.3 + P.charge) fx.emit(tip.x + rand(-0.2, 0.2), tip.y + rand(-0.2, 0.2), tip.z + rand(-0.2, 0.2), rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), [4, 1.6, 0.4], [1, 0.1, 0], 0.08, 0.4, -1, 1);
      pose = mixPose(GUARD, CLIPS.spin.keys[0].p, Math.min(1, P.charge / 0.4));
      if (P.charge > 1.4 || (!P.heavyHeld && P.charge > 0.05) || P.st <= 0) heavyUp();
      break;
    }
    case 'attack': {
      const c = CLIPS[P.clip];
      const [h0, h1] = c.hit;
      pose = sampleClip(c.keys, P.t);
      rate = 999;
      if (P.t < h0 + 0.05) { const push = (c.heavy ? 11 : 8) * dt; P.vel.x += Math.sin(P.face) * push; P.vel.z += Math.cos(P.face) * push; }
      if (P.clip === 'spin') {
        P.spinAngle = (P.spinAngle || 0) + dt * 14 * (P.t < 0.75 ? 1 : 0);
        speed = P.speed * 0.5;
        if (P.t >= h0 && P.t <= h1) { P.hitTick -= dt; if (P.hitTick <= 0) { P.hitTick = 0.15; P.hitSet.clear(); } }
      } else P.spinAngle = 0;
      if (P.t >= h0 && P.t <= h1) {
        for (const e of enemies) {
          if (P.hitSet.has(e) || e.state === 'dying' || e.state === 'intro' || (e.state === 'rising' && e.t < 0.6)) continue;
          const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
          const d = Math.hypot(dx, dz) - e.radius;
          if (d > c.reach) continue;
          if (Math.abs(angDiff(P.face, Math.atan2(dx, dz))) > c.arc && d > 0.6) continue;
          P.hitSet.add(e);
          hitEnemy(e, c.dmg * P.dmgMul * rand(0.92, 1.08), P.pos, c.heavy ? 8 : 4);
        }
        if (P.clip === 'slash3' && P.t - dt < h0 + 0.02 && P.t >= h0 + 0.02) {
          const tip = knight.markers.tip.getWorldPosition(V());
          fx.burst(tip, 34, 5, [4, 1.6, 0.4], [1, 0.1, 0], 0.1, 0.5, 6, 0.6, 2);
          for (let k = 0; k < 16; k++) smoke.emit(tip.x, P.pos.y + 0.1, tip.z, rand(-2, 2), rand(0.3, 1.2), rand(-2, 2), dustCol(), dustCol(0.5), rand(0.5, 0.9), 1.1, -0.2, 2, 1.6);
          S.shake = Math.max(S.shake, 0.35);
        }
      }
      if (P.queued && P.t > h1 && P.combo < 2 && P.clip !== 'spin' && P.st > 4) { startClip(P.combo === 0 ? 'slash2' : 'slash3', P.combo + 1); break; }
      if (P.t >= c.dur) { P.state = 'idle'; P.t = 0; P.spinAngle = 0; }
      break;
    }
    case 'dodge': {
      const dur = CLIPS.roll.dur, k = P.t / dur;
      pose = sampleClip(CLIPS.roll.keys, P.t); rate = 40;
      const sp = lerp(12.5, 3, k);
      P.vel.x = P.dodgeDir.x * sp; P.vel.z = P.dodgeDir.z * sp;
      knight.rollPivot.rotation.x = k < 0.85 ? ease(Math.min(1, k / 0.85)) * Math.PI * 2 : 0;
      if (P.t >= dur) { P.state = 'idle'; P.t = 0; knight.rollPivot.rotation.x = 0; if (P.queued) { P.queued = false; startClip('slash1', 0); } }
      break;
    }
    case 'cast': {
      pose = sampleClip(CLIPS.cast.keys, P.t); rate = 30;
      const hand = knight.joints.wrL.getWorldPosition(V());
      if (P.t < 0.36 && Math.random() < 0.9) fx.emit(hand.x + rand(-0.25, 0.25), hand.y + rand(-0.2, 0.3), hand.z + rand(-0.25, 0.25), 0, 0.8, 0, [1.6, 0.9, 3.6], [0.3, 0.05, 0.6], 0.1, 0.3, 0, 1);
      if (P.t > 0.36 && !P.castFired) {
        P.castFired = true; Audio.spell();
        const tgt = P.lock && P.lock.state !== 'dying' ? P.lock : nearestEnemy(30, 1.5);
        const dir = new THREE.Vector3(Math.sin(P.face), 0, Math.cos(P.face));
        if (tgt) dir.set(tgt.pos.x - hand.x, tgt.pos.y + tgt.height * 0.5 - hand.y, tgt.pos.z - hand.z).normalize();
        fireProjectile({ from: hand, dir, speed: 16, dmg: 56 * P.spellMul, color: [2, 1.1, 5.5], owner: 'player', homing: 5, target: tgt, size: 1.3, aoe: 3.3 });
      }
      if (P.t > CLIPS.cast.dur) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'drink': {
      speed = P.speed * 0.3;
      pose = sampleClip(CLIPS.drink.keys, P.t);
      if (P.t > 0.6 && !P.healed) {
        P.healed = true; P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.45); S.healFx = 1;
        fx.burst(tmp.copy(P.pos).setY(P.pos.y + 1), 46, 2.5, [3, 2.2, 0.8], [0.8, 0.3, 0.05], 0.1, 1.0, -2, 0.5, 1.5);
      }
      if (P.t > CLIPS.drink.dur) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'hurt': {
      pose = sampleClip(CLIPS.hurt.keys, P.t); rate = 30;
      if (P.t > CLIPS.hurt.dur) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'dead': {
      pose = sampleClip(CLIPS.death.keys, P.t); rate = 10;
      knight.rollPivot.rotation.x = lerp(knight.rollPivot.rotation.x, P.t > 0.9 ? 1.25 : 0, 1 - Math.exp(-3 * dt));
      break;
    }
  }
  // movement
  const accel = onIce ? 2.2 : 12, frict = onIce ? 0.8 : 9;
  if (P.state === 'dodge') { /* set */ }
  else if (speed > 0 && mv.lengthSq() > 0.01) {
    P.vel.x = lerp(P.vel.x, mv.x * speed, 1 - Math.exp(-accel * dt));
    P.vel.z = lerp(P.vel.z, mv.z * speed, 1 - Math.exp(-accel * dt));
  } else { P.vel.x *= Math.exp(-frict * dt); P.vel.z *= Math.exp(-frict * dt); }
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
  collide(P.pos, 0.42);
  P.pos.y = world.heightAt(P.pos.x, P.pos.z);
  if (onIce && Math.hypot(P.vel.x, P.vel.z) > 3 && Math.random() < 0.3) fx.emit(P.pos.x, P.pos.y + 0.05, P.pos.z, rand(-0.5, 0.5), 0.3, rand(-0.5, 0.5), [1, 1.3, 1.6], [0.2, 0.3, 0.4], 0.05, 0.4, 1, 1);
  animateKnight(dt, pose, rate);
}

function animateKnight(dt, pose, rate) {
  const K = knight;
  const hv = Math.hypot(P.vel.x, P.vel.z);
  K.root.position.copy(P.pos);
  K.root.rotation.y = P.face + (P.spinAngle || 0);
  if (!pose) {
    const s01 = clamp(hv / 7, 0, 1);
    P.walkPhase += dt * hv * (P.sprint ? 2.6 : 3.1) / 1.6;
    const breath = Math.sin(S.time * 1.8) * 0.02;
    const idle = { ...GUARD, chest: [GUARD.chest[0] + breath, GUARD.chest[1], 0], hy: GUARD.hy + breath * 0.3 };
    pose = hv > 0.4 ? mixPose(idle, locomotion(P.walkPhase, s01, P.sprint), clamp(hv / 1.5, 0, 1)) : idle;
    // footstep sounds
    const st = Math.floor(P.walkPhase / Math.PI);
    if (st !== S.stepT && hv > 1) { S.stepT = st; Audio.step(KINGDOMS[S.k].id === 'frost'); }
  }
  drivePose(K, pose, dt, rate);
  // tassets follow thighs
  K.tassets[0].rotation.x = Math.min(0, K.joints.thighR.rotation.x) * 0.6;
  K.tassets[1].rotation.x = Math.min(0, K.joints.thighL.rotation.x) * 0.6;
  K.tabF.rotation.x = lerp(K.tabF.rotation.x, -Math.min(0, Math.min(K.joints.thighL.rotation.x, K.joints.thighR.rotation.x)) * -0.5 - hv * 0.03, 1 - Math.exp(-10 * dt));
  // lantern swing
  K.lantern.rotation.x = lerp(K.lantern.rotation.x, -P.vel.length() * 0.05 + Math.sin(S.time * 3 + P.walkPhase) * 0.12, 1 - Math.exp(-6 * dt));
  K.lantern.rotation.z = Math.sin(P.walkPhase) * 0.1;
  const fl = 0.85 + 0.15 * Math.sin(S.time * 17) * Math.sin(S.time * 9.3);
  K.lanternLight.intensity = 1.4 * fl;
  K.flame.scale.set(fl, fl * 1.6, fl);
  // plume sway
  K.plume.rotation.x = lerp(K.plume.rotation.x, hv * 0.04 + Math.sin(S.time * 2.1) * 0.05, 1 - Math.exp(-5 * dt));
  K.plume.rotation.y = Math.sin(S.time * 1.7) * 0.08;
  // blade glow
  const glow = P.state === 'attack' ? 1 : P.state === 'charge' ? 0.5 + P.charge : 0;
  K.M.rune.color.setRGB(4, 1.3, 0.35).multiplyScalar(0.55 + glow * 1.3 + Math.sin(S.time * 3) * 0.08);
  K.root.visible = !(P.invuln > 0 && P.state !== 'dodge' && P.state !== 'dead' && Math.floor(S.time * 22) % 2 === 0);
  K.cape.ground = P.pos.y;
  K.cape.update(dt, new THREE.Vector2(G.wind.value.x * 1.5, G.wind.value.y * 1.5));
}

// ---------------- blade trail ----------------
const TRAIL_N = 20;
const trail = { base: [], tip: [], alive: 0 };
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 2 * 3), trailA = new Float32Array(TRAIL_N * 2);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('a', new THREE.BufferAttribute(trailA, 1).setUsage(THREE.DynamicDrawUsage));
{ const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trailMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { col: { value: new THREE.Color(3.2, 1.1, 0.3) } },
  vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 col; varying float vA; void main(){ gl_FragColor = vec4(col*vA, vA); }',
});
const trailMesh = new THREE.Mesh(trailGeo, trailMat);
trailMesh.frustumCulled = false; trailMesh.userData.noAO = true;
scene.add(trailMesh);
function updateTrail(dt) {
  const active = P.state === 'attack' && P.t > CLIPS[P.clip].hit[0] - 0.06 && P.t < CLIPS[P.clip].hit[1] + 0.08;
  if (active) {
    knight.root.updateMatrixWorld(true);
    trail.base.unshift(knight.markers.base.getWorldPosition(V()));
    trail.tip.unshift(knight.markers.tip.getWorldPosition(V()));
    if (trail.base.length > TRAIL_N) { trail.base.pop(); trail.tip.pop(); }
    trail.alive = 1;
    trailMat.uniforms.col.value.setRGB(3.2, 1.1, 0.3).multiplyScalar(CLIPS[P.clip].heavy ? 1.4 : 1);
  } else {
    trail.alive = Math.max(0, trail.alive - dt * 7);
    if (trail.base.length > 1) { trail.base.pop(); trail.tip.pop(); }
  }
  const n = trail.base.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const j = Math.min(i, n - 1);
    const b = n ? trail.base[j] : P.pos, t = n ? trail.tip[j] : P.pos;
    trailPos[i * 6] = b.x; trailPos[i * 6 + 1] = b.y; trailPos[i * 6 + 2] = b.z;
    trailPos[i * 6 + 3] = t.x; trailPos[i * 6 + 4] = t.y; trailPos[i * 6 + 5] = t.z;
    const a = n > 1 ? Math.pow(1 - i / TRAIL_N, 1.6) * trail.alive * 0.85 : 0;
    trailA[i * 2] = a * 0.05; trailA[i * 2 + 1] = a;
  }
  trailGeo.attributes.position.needsUpdate = trailGeo.attributes.a.needsUpdate = true;
}

// ---------------- projectiles / souls / decals / events ----------------
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    const m = p.mesh;
    let tgt = null;
    if (p.owner === 'enemy') tgt = tmp.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
    else if (p.target && !p.target.dead && p.target.state !== 'dying') tgt = tmp.set(p.target.pos.x, p.target.pos.y + p.target.height * 0.5, p.target.pos.z);
    if (tgt && p.homing) { const want = tgt.clone().sub(m.position).normalize().multiplyScalar(p.speed); p.vel.lerp(want, 1 - Math.exp(-p.homing * dt)); p.vel.setLength(p.speed); }
    p.vel.y -= p.grav * dt;
    m.position.addScaledVector(p.vel, dt);
    m.scale.setScalar((p.kind === 'fireball' ? 1.6 : p.owner === 'player' ? 1.3 : 1) * (0.9 + Math.sin(S.time * 30) * 0.1));
    for (let k = 0; k < 2; k++) fx.emit(m.position.x + rand(-0.08, 0.08), m.position.y + rand(-0.08, 0.08), m.position.z + rand(-0.08, 0.08), rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4), p.color, [p.color[0] * 0.15, p.color[1] * 0.08, p.color[2] * 0.15], p.kind === 'fireball' ? 0.3 : 0.16, 0.35, 0, 1);
    let done = p.life <= 0;
    const gy = world.heightAt(m.position.x, m.position.z);
    if (m.position.y < gy + 0.05) done = true;
    if (p.owner === 'enemy') {
      if (m.position.distanceTo(tmp2.set(P.pos.x, P.pos.y + 1.0, P.pos.z)) < 0.75) { damagePlayer(p.dmg, m.position); if (P.state !== 'dodge') done = true; }
      if (done) {
        if (p.aoe) { m.position.y = Math.max(m.position.y, gy + 0.2); explosion(m.position.clone(), p.aoe, p.dmg); }
        else fx.burst(m.position, 20, 4, p.color, [0.3, 0, 0], 0.1, 0.4, 4, 0.3, 2);
      }
    } else {
      for (const e of enemies) {
        if (e.state === 'dying') continue;
        if (Math.hypot(e.pos.x - m.position.x, e.pos.z - m.position.z) < e.radius + 0.4 && Math.abs(e.pos.y + e.height * 0.5 - m.position.y) < e.height * 0.6 + 0.4) { done = true; break; }
      }
      if (done) explosion(m.position.clone(), p.aoe || 3, p.dmg, [1.8, 1.0, 4.5], [0.3, 0.05, 0.6], 'player');
    }
    if (done) { scene.remove(m); m.material.dispose(); projectiles.splice(i, 1); }
  }
}
function updateSouls(dt) {
  const target = tmp2.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
  for (let i = souls.length - 1; i >= 0; i--) {
    const s = souls[i];
    s.t += dt;
    if (s.t < 0.5) { s.vel.multiplyScalar(Math.exp(-4 * dt)); s.vel.y -= 2 * dt; }
    else {
      const want = target.clone().sub(s.mesh.position); const d = want.length();
      want.normalize().multiplyScalar(Math.min(24, 6 + s.t * 10));
      s.vel.lerp(want, 1 - Math.exp(-6 * dt));
      if (d < 0.5 || P.state === 'dead') {
        if (P.state !== 'dead') { S.souls += s.value; Audio.soul(); P.focus = Math.min(P.maxFocus, P.focus + 1.2); }
        scene.remove(s.mesh); souls.splice(i, 1); continue;
      }
    }
    s.mesh.position.addScaledVector(s.vel, dt);
    if (Math.random() < 0.5) fx.emit(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 0, 0.2, 0, [1.4, 0.8, 3.2], [0.3, 0.05, 0.6], 0.09, 0.4, 0, 1);
  }
}
function updateDecals(dt) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i]; d.t += dt;
    const k = d.t / d.life, m = d.mesh.material;
    if (d.kind === 'ring') m.opacity = 0.55 + 0.45 * Math.sin(d.t * 22);
    else if (d.kind === 'grow') { d.mesh.scale.setScalar(d.r * ease(Math.min(1, k))); m.opacity = 0.35; }
    else if (d.kind === 'wave') { d.mesh.scale.setScalar(0.5 + d.r * ease(k)); m.opacity = 1 - k; }
    else { m.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.7; d.mesh.rotation.z += dt * 1.5; }
    if (d.t >= d.life) { scene.remove(d.mesh); m.dispose(); decals.splice(i, 1); }
  }
  for (let i = spikes.length - 1; i >= 0; i--) {
    const s = spikes[i]; s.t += dt;
    const up = s.t < 0.12 ? ease(s.t / 0.12) : s.t < 1.3 ? 1 : 1 - ease((s.t - 1.3) / 0.4);
    s.m.position.y = s.y - 2.2 * (1 - up);
    if (s.t > 1.7) { scene.remove(s.m); spikes.splice(i, 1); }
  }
  for (let i = S.events.length - 1; i >= 0; i--) if (S.time >= S.events[i].t) { const ev = S.events[i]; S.events.splice(i, 1); ev.fn(); }
}

// ---------------- camera ----------------
const camLook = new THREE.Vector3(0, 1.5, 0), camPos = new THREE.Vector3(0, 6, 15);
function updateCamera(dt) {
  if (S.mode === 'title' || S.mode === 'loading') {
    const a = S.time * 0.04;
    const tgt = new THREE.Vector3(Math.sin(a) * 15, 3.6 + Math.sin(S.time * 0.2) * 0.6, Math.cos(a) * 15);
    tgt.y += world ? world.heightAt(tgt.x, tgt.z) : 0;
    camPos.lerp(tgt, 1 - Math.exp(-1.5 * dt));
    camLook.lerp(new THREE.Vector3(0, 2.4, 0), 1 - Math.exp(-2 * dt));
  } else {
    const look = new THREE.Vector3(P.pos.x, P.pos.y + 1.55, P.pos.z);
    if (P.lock && P.lock.state !== 'dying' && P.lock.dead !== true) {
      const ta = Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z);
      camYaw += angDiff(camYaw, ta + Math.PI) * (1 - Math.exp(-5 * dt));
      look.lerp(new THREE.Vector3(P.lock.pos.x, P.lock.pos.y + P.lock.height * 0.45, P.lock.pos.z), 0.3);
    } else if (P.lock) P.lock = null;
    let dist = camDist + (S.boss ? 2.4 : 0);
    if (P.state === 'dead') dist = 4.2;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const want = new THREE.Vector3(look.x + Math.sin(camYaw) * cp * dist, look.y + sp * dist + 0.4, look.z + Math.cos(camYaw) * cp * dist);
    const gy = world.heightAt(want.x, want.z) + 0.5;
    if (want.y < gy) want.y = gy;
    camPos.lerp(want, 1 - Math.exp(-12 * dt));
    camLook.lerp(look, 1 - Math.exp(-16 * dt));
  }
  camera.position.copy(camPos);
  if (S.shake > 0) {
    const s = S.shake * S.shake * 0.3;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    S.shake = Math.max(0, S.shake - dt * 2.4);
  }
  camera.lookAt(camLook);
  const f = S.mode === 'title' ? new THREE.Vector3() : P.pos;
  world.sun.target.position.set(f.x, f.y, f.z);
  world.sun.position.set(f.x, f.y, f.z).addScaledVector(KINGDOMS[S.k].sky.sunDir.clone().normalize(), 80);
  G.player.value.copy(S.mode === 'title' ? camPos : P.pos);
}

// ---------------- environment ----------------
function dustCol(m = 1) {
  const id = KINGDOMS[S.k].id;
  const c = id === 'frost' ? [0.5, 0.55, 0.62] : id === 'ember' ? [0.12, 0.09, 0.08] : id === 'void' ? [0.12, 0.08, 0.18] : [0.14, 0.11, 0.1];
  return [c[0] * m, c[1] * m, c[2] * m];
}
function updateEnv(dt) {
  for (const f of world.flames) {
    if (f.light) { const n = Math.sin(S.time * 11 + f.seed) * 0.5 + Math.sin(S.time * 23.7 + f.seed * 2) * 0.3 + Math.sin(S.time * 5.1 + f.seed) * 0.2; f.light.intensity = f.base * (0.82 + 0.18 * n); }
    if (f.kind === 'volcano') { if (Math.random() < 0.3) smoke.emit(f.pos.x + rand(-8, 8), f.pos.y, f.pos.z, rand(-1, 1), rand(3, 6), rand(-1, 1), [0.08, 0.05, 0.04], [0.03, 0.02, 0.02], rand(12, 24), 6, -0.2, 0.1, 30); continue; }
    if (f.kind === 'lava') { if (Math.random() < 3 * dt) fx.emit(f.pos.x + rand(-f.r, f.r) * 0.7, f.pos.y + 0.1, f.pos.z + rand(-f.r, f.r) * 0.7, rand(-0.5, 0.5), rand(2, 5), rand(-0.5, 0.5), [4, 1.2, 0.2], [1, 0.1, 0], 0.08, 1.2, 4, 0.3); continue; }
    const frost = f.kind === 'fire' && KINGDOMS[S.k].id === 'frost';
    const voidF = KINGDOMS[S.k].id === 'void';
    const cA = frost ? [0.8, 2.0, 3.4] : voidF ? [2.0, 0.8, 4.0] : [2.4, 0.9, 0.22], cB = frost ? [0.1, 0.3, 0.8] : voidF ? [0.4, 0.05, 0.8] : [0.9, 0.08, 0.02];
    const rate = 42 * dt;
    for (let k = 0; k < rate + (Math.random() < rate % 1 ? 1 : 0); k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5; fx.emit(f.pos.x + Math.cos(a) * r, f.pos.y, f.pos.z + Math.sin(a) * r, rand(-0.2, 0.2), rand(1.4, 2.8), rand(-0.2, 0.2), cA, cB, rand(0.14, 0.3), rand(0.4, 0.85), -0.5, 1.2); }
    if (Math.random() < 5 * dt) smoke.emit(f.pos.x, f.pos.y + 1.2, f.pos.z, rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2), [0.06, 0.05, 0.05], [0.02, 0.02, 0.02], rand(0.5, 0.8), rand(1.8, 2.6), -0.1, 0.3, 1.6);
    if (Math.random() < 3 * dt) fx.emit(f.pos.x, f.pos.y + 0.5, f.pos.z, rand(-1, 1), rand(2, 4), rand(-1, 1), [5, 3.4, 1.8], [1.4, 0.25, 0.04], 0.04, rand(1, 1.8), 0.5, 0.5);
  }
  if (world.centerpiece && Math.random() < 0.4) { const c = world.centerpiece.getWorldPosition(tmp); fx.emit(c.x + rand(-0.5, 0.5), c.y + rand(-1, 1), c.z + rand(-0.5, 0.5), 0, rand(0.2, 0.8), 0, KINGDOMS[S.k].id === 'ember' ? [3, 1, 0.2] : [1.6, 0.6, 3.2], [0.2, 0.05, 0.4], 0.07, 1.2, -0.3, 0.5); }
  // heat lightning (ash / void)
  const id = KINGDOMS[S.k].id;
  if (id === 'ash' || id === 'void') {
    S.nextLightning -= dt;
    if (S.nextLightning <= 0) { S.lightning = 1; S.nextLightning = rand(14, 30); Audio.thunder(); }
  }
  if (S.lightning > 0) {
    S.lightning = Math.max(0, S.lightning - dt * 2.5);
    const f = S.lightning * (0.6 + 0.4 * Math.sin(S.lightning * 40));
    skyMat.uniforms.flash.value = f;
    world.hemi.intensity = KINGDOMS[S.k].hemi[2] * (1 + f * 3);
  } else { skyMat.uniforms.flash.value = 0; world.hemi.intensity = KINGDOMS[S.k].hemi[2]; }
}

// ---------------- HUD ----------------
let bannerTimer = null;
function showBanner(title, sub, dur = 2.5, kind = '') {
  const b = $('banner');
  b.className = 'show ' + kind;
  $('bTitle').textContent = title; $('bSub').textContent = sub;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = ''; }, dur * 1000);
}
let hintTimer = null;
function hint(t, dur = 1.5) { const h = $('hint'); h.textContent = t; h.classList.add('show'); clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.remove('show'), dur * 1000); }
function nope(id) { const el = $(id); if (!el) return; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
function updateCombo() { const c = $('combo'); if (S.combo >= 3) { c.querySelector('b').textContent = S.combo; c.classList.add('show'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } else c.classList.remove('show'); }
function updatePips() { const el = $('pips'); el.innerHTML = ''; for (let i = 1; i <= S.wavesPer + 1; i++) { const s = document.createElement('i'); if (i === S.wavesPer + 1) s.className = 'boss'; if (i < S.wave) s.classList.add('done'); if (i === S.wave) s.classList.add('now'); el.appendChild(s); } }
const nums = [];
function dmgNumber(p, v, crit, burn) {
  const el = document.createElement('div');
  el.className = 'dmg' + (crit ? ' crit' : '') + (burn ? ' burn' : '');
  el.textContent = v;
  $('nums').appendChild(el);
  nums.push({ el, p: p.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.2, rand(-0.3, 0.3))), t: 0 });
}
function updateNums(dt) {
  for (let i = nums.length - 1; i >= 0; i--) {
    const d = nums[i]; d.t += dt; d.p.y += dt * 1.1;
    const v = tmp.copy(d.p).project(camera);
    if (d.t > 0.95 || v.z > 1) { d.el.remove(); nums.splice(i, 1); continue; }
    d.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.25 - d.t) * 2.4})`;
    d.el.style.opacity = String(1 - Math.max(0, d.t - 0.55) / 0.4);
  }
}
const hudCache = {};
function setW(id, frac) { const v = Math.round(clamp(frac, 0, 1) * 1000) / 1000; if (hudCache[id] !== v) { hudCache[id] = v; $(id).style.transform = `scaleX(${v})`; } }
function updateHud(dt) {
  setW('hpFill', P.hp / P.maxHp);
  if (P.ghost < P.hp) P.ghost = P.hp; else if (S.time - P.lastHurt > 0.6) P.ghost = Math.max(P.hp, P.ghost - P.maxHp * 0.5 * dt);
  setW('hpGhost', P.ghost / P.maxHp);
  setW('stFill', Math.max(0, P.st) / P.maxSt);
  setW('fpFill', P.focus / P.maxFocus);
  $('hpBar').style.width = Math.min(44, 16 + P.maxHp * 0.1) + 'vw';
  $('stBar').style.width = Math.min(36, 12 + P.maxSt * 0.1) + 'vw';
  $('souls').textContent = S.souls;
  $('flaskN').textContent = P.flasks;
  $('flaskSlot').classList.toggle('empty', P.flasks === 0);
  $('spellSlot').classList.toggle('ready', P.focus >= P.spellCost);
  if (S.combo > 0) { S.comboT -= dt; if (S.comboT <= 0) { S.combo = 0; updateCombo(); } }
  if (S.boss) setW('bossFill', Math.max(0, S.boss.hp) / S.boss.maxHp);
  const ret = $('lockRet');
  if (P.lock && P.lock.state !== 'dying') {
    const v = tmp.set(P.lock.pos.x, P.lock.pos.y + P.lock.height * 0.6, P.lock.pos.z).project(camera);
    ret.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) rotate(45deg)`;
    ret.classList.add('show');
  } else ret.classList.remove('show');
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 0.05) || 0.016;
  last = now;
  update(rdt);
  composer.render();
}
function update(rdt) {
  S.time += rdt;
  G.time.value = S.time;
  if (S.slowT > 0) { S.slowT -= rdt; if (S.slowT <= 0) S.slow = 1; }
  let dt = rdt * (S.slowT > 0 ? S.slow : 1);
  if (S.hitstop > 0) { S.hitstop -= rdt; dt *= 0.06; }
  const live = S.mode === 'play' || S.mode === 'dead' || S.mode === 'victory';
  if (S.mode === 'pause' || S.mode === 'choose' || S.mode === 'transition') dt = 0;
  if (live && dt > 0) {
    updatePlayer(dt);
    for (const e of enemies) updateEnemy(e, dt);
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
    if (S.mode === 'play') updateWaves(dt);
    updateProjectiles(dt); updateSouls(dt); updateDecals(dt); updatePortal(dt);
  } else if (S.mode === 'title') {
    P.pos.set(0, world.heightAt(0, 7.5), 7.5); P.vel.set(0, 0, 0); P.face = Math.PI; P.state = 'idle';
    animateKnight(rdt, null, 16);
  } else if (S.portal) updatePortal(rdt);
  updateTrail(rdt);
  if (S.mode === 'play' || S.mode === 'choose') updateHud(rdt);
  fx.update(dt || (S.mode === 'title' ? rdt : 0));
  smoke.update(dt || (S.mode === 'title' ? rdt : 0));
  updateEnv(S.mode === 'pause' ? 0 : rdt);
  world.update(S.time, rdt);
  updateCamera(rdt);
  updateNums(rdt);
  updateSunScreen();
  S.damageFx = Math.max(0, S.damageFx - rdt * 2.2);
  S.healFx = Math.max(0, S.healFx - rdt * 1.5);
  const u = finalPass.uniforms;
  u.damage.value = S.damageFx; u.heal.value = S.healFx;
  u.lowHp.value = S.mode === 'play' && P.hp / P.maxHp < 0.3 ? 1 - (P.hp / P.maxHp) / 0.3 : 0;
  u.fade.value = Math.max(S.fade, S.mode === 'dead' ? Math.min(0.5, P.t * 0.3) : 0);
  S.bars = S.boss && S.boss.state === 'intro' ? Math.min(0.09, S.bars + rdt * 0.2) : Math.max(0, S.bars - rdt * 0.2);
  u.bars.value = S.bars;
}

window.__game = { S, P, enemies, projectiles, decals, spikes, souls, startWave, startGame, spawnEnemy, killEnemy, damagePlayer, step: (n) => { for (let i = 0; i < n; i++) update(1 / 60); }, KINGDOMS, loadKingdom: (k) => loadKingdom(k), offerBlessing, openPortal };
boot().catch((e) => { console.error(e); $('loadText').textContent = 'שגיאה: ' + e.message; });
