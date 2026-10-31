
// =====================================================================
// Game state
// =====================================================================
const keys = {};
let state = 'title', time = 0, gameTime = 0, litCount = 0, won = false, winT = 0;
let yaw = 0, pitch = 0.28, camDist = 6.2, shake = 0, flash = 0, hurtFlash = 0, hitStop = 0;
let spawnTimer = 8, holdT = 0, lightningT = 7, chapterT = 0, kingActive = false, hpTrail = 100;
const clock = new THREE.Clock();
const swordTrail = new Trail(16, [0.9, 1.25, 1.4]);
const king = new King();
const soulWisps = [];
const tmpA = new V3(), tmpB = new V3();

// =====================================================================
// HUD helpers
// =====================================================================
const candleEls = [];
for (let i = 0; i < SHRINE_COUNT; i++) {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 20 40'); s.setAttribute('class', 'candle');
  s.innerHTML = '<path class="flame" d="M10 3 C 14 9, 13.5 14, 10 17 C 6.5 14, 6 9, 10 3Z"/><line class="wick" x1="10" y1="15" x2="10" y2="19"/><path class="wax" d="M6.5 19 L13.5 19 L13.8 38 L6.2 38 Z M6.5 19 C 7 22, 6 23, 6.6 25"/>';
  $('candles').appendChild(s); candleEls.push(s);
}
function chapter(kicker, main, sub = '', t = 4.5) { $('chKicker').textContent = kicker; $('chMain').textContent = main; $('chSub').textContent = sub; $('chapter').classList.add('on'); chapterT = t; }
function questText() {
  if (won) return 'הכתר נשבר';
  if (litCount < SHRINE_COUNT) return `הצת את להבות הנשמה <b>${litCount} / ${SHRINE_COUNT}</b>`;
  return kingActive ? '<b>הפל את מלך האפר</b>' : '<b>שוב אל כס המלך</b>';
}
const HOLD = IS_TOUCH ? 'החזק את <span class="seal-key">✦</span>' : 'החזק <span class="seal-key">E</span>';
const ORD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳'];

// =====================================================================
// Input
// =====================================================================
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (state !== 'play') return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { tryRoll(); e.preventDefault(); }
  if (e.code === 'KeyJ' || e.code === 'KeyK') tryAttack();
});
addEventListener('keyup', e => { keys[e.code] = false; });
const canvas = renderer.domElement;
let dragging = false;
function lockPointer() { try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
canvas.addEventListener('mousedown', e => {
  if (state !== 'play' || IS_TOUCH) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  dragging = true; if (e.button === 0) tryAttack(); if (e.button === 2) tryRoll();
});
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => {
  if (state !== 'play' || IS_TOUCH) return;
  if (document.pointerLockElement === canvas || dragging) { yaw -= e.movementX * 0.0024; pitch = clamp(pitch + e.movementY * 0.002, -0.1, 1.0); }
});
addEventListener('wheel', e => { camDist = clamp(camDist + e.deltaY * 0.004, 3.8, 10); });
addEventListener('contextmenu', e => e.preventDefault());

// touch
const joy = { x: 0, y: 0, id: null, cx: 0, cy: 0 };
let camTouch = null;
const stickBase = $('stickBase'), knob = $('stickKnob');
function stickHome() { stickBase.style.left = '40px'; stickBase.style.top = ''; stickBase.style.bottom = '40px'; }
addEventListener('touchstart', e => {
  if (state !== 'play') return;
  for (const t of e.changedTouches) {
    if (t.target && t.target.closest && t.target.closest('.tb')) continue;
    if (t.clientX < innerWidth * 0.42 && joy.id === null) {
      joy.id = t.identifier; joy.cx = t.clientX; joy.cy = t.clientY;
      stickBase.style.left = (t.clientX - 66) + 'px'; stickBase.style.top = (t.clientY - 66) + 'px'; stickBase.style.bottom = 'auto';
    } else if (camTouch === null) camTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
  e.preventDefault();
}, { passive: false });
addEventListener('touchmove', e => {
  if (state !== 'play') return; e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      let dx = t.clientX - joy.cx, dy = t.clientY - joy.cy; const d = Math.hypot(dx, dy), m = 55;
      if (d > m) { dx *= m / d; dy *= m / d; } joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (camTouch && t.identifier === camTouch.id) {
      yaw -= (t.clientX - camTouch.x) * 0.0065; pitch = clamp(pitch + (t.clientY - camTouch.y) * 0.0045, -0.1, 1.0); camTouch.x = t.clientX; camTouch.y = t.clientY;
    }
  }
}, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; stickHome(); } if (camTouch && t.identifier === camTouch.id) camTouch = null; } };
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
const touchBtn = (id, down, up) => {
  const el = $(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (state === 'play') down(); }, { passive: false });
  el.addEventListener('touchend', e => { e.preventDefault(); up && up(); }); el.addEventListener('touchcancel', () => up && up());
};
touchBtn('tbAtk', () => tryAttack()); touchBtn('tbDash', () => tryRoll()); touchBtn('tbUse', () => { keys.KeyE = true; }, () => { keys.KeyE = false; });

function camForward() { return new V3(-Math.sin(yaw), 0, -Math.cos(yaw)); }
function moveInput() {
  const f = camForward(), r = new V3(-f.z, 0, f.x), m = new V3();
  if (keys.KeyW || keys.ArrowUp) m.add(f); if (keys.KeyS || keys.ArrowDown) m.sub(f);
  if (keys.KeyD || keys.ArrowRight) m.add(r); if (keys.KeyA || keys.ArrowLeft) m.sub(r);
  if (Math.hypot(joy.x, joy.y) > 0.15) { m.addScaledVector(f, -joy.y); m.addScaledVector(r, joy.x); }
  return m;
}

// =====================================================================
// Combat
// =====================================================================
function tryAttack() {
  if (state !== 'play' || won || player.hp <= 0 || player.rollT >= 0) return;
  if (player.atkT >= 0) { if (player.atkT > 0.28 && player.combo < 2) player.queued = true; return; }
  if (player.st < 8) return;
  startSwing(player.comboReset > 0 && player.combo < 2 ? player.combo + 1 : 0);
}
function startSwing(i) {
  player.combo = i; player.atkT = 0; player.hitDone = false; player.queued = false; player.comboReset = 0;
  player.st -= i === 2 ? 18 : 11; player.stDelay = 0.7; AudioFX.swing(i === 2);
  // soft lock-on: turn toward the nearest foe in front of the camera / stick
  const pref = joy.id !== null || moveInput().lengthSq() > 0.01 ? moveInput().normalize() : (IS_TOUCH ? new V3(Math.sin(player.facing), 0, Math.cos(player.facing)) : camForward());
  let best = null, bs = -1;
  for (const e of enemies) {
    if (e.dead || e.invuln) continue;
    tmpA.subVectors(e.pos, P.position).setY(0); const d = tmpA.length(); if (d > 6 + e.radius) continue;
    const sc = tmpA.normalize().dot(pref) * 2 - d / 6; if (sc > bs && tmpA.dot(pref) > -0.2) { bs = sc; best = e; }
  }
  if (best) player.facing = Math.atan2(best.pos.x - P.position.x, best.pos.z - P.position.z);
  else player.facing = Math.atan2(pref.x, pref.z);
}
function doHit(S) {
  const fwd = new V3(Math.sin(player.facing), 0, Math.cos(player.facing)); let any = false;
  for (const e of [...enemies]) {
    if (e.dead) continue;
    tmpA.subVectors(e.pos, P.position).setY(0); const d = tmpA.length(); const dir = tmpA.clone().normalize();
    if (d - e.radius < S.reach && dir.dot(fwd) > S.arc) {
      if (!e.hit(S.dmg, dir)) continue;
      any = true;
      const hp = e.pos.clone().add(new V3(0, e === king ? 2.6 : 1.2, 0)).addScaledVector(dir, -e.radius * 0.6);
      for (let i = 0; i < 18; i++) fx.spawn(hp.x, hp.y, hp.z, R(-3, 3) - dir.x * 3, R(0, 3.5), R(-3, 3) - dir.z * 3, R(0.2, 0.45), R(0.05, 0.1), [3, 2.6, 2], [0.8, 0.3, 0.1], { g: 9 });
      for (let i = 0; i < 10; i++) fxDark.spawn(hp.x, hp.y, hp.z, R(-1.5, 1.5) + dir.x * 2, R(0, 2), R(-1.5, 1.5) + dir.z * 2, R(0.5, 1), R(0.15, 0.3), [0.25, 0.04, 0.03], [0.08, 0.02, 0.02], { g: 4, s1: 0.5, a: 0.8 });
    }
  }
  if (any) { AudioFX.hit(S.dmg > 1); hitStop = S.dmg > 1 ? 0.09 : 0.055; shake = Math.max(shake, S.dmg > 1 ? 0.3 : 0.16); }
}
function tryRoll() {
  if (state !== 'play' || won || player.hp <= 0 || player.rollT >= 0 || player.st < 18) return;
  player.atkT = -1; player.queued = false; player.combo = 0;
  const m = moveInput(); if (m.lengthSq() < 0.01) m.set(Math.sin(player.facing), 0, Math.cos(player.facing));
  player.rollDir.copy(m.normalize()); player.facing = Math.atan2(m.x, m.z); player.rollT = 0;
  player.st -= 24; player.stDelay = 0.8; AudioFX.roll();
}
function damagePlayer(n, from) {
  if (state !== 'play' || won || player.hp <= 0) return;
  if (player.rollT > 0.04 && player.rollT < 0.78) return;   // i-frames
  player.hp = Math.max(0, player.hp - n); player.lastHurt = time; hurtFlash = 1; shake = Math.max(shake, 0.4); player.flinch = 1; AudioFX.hurt();
  player.atkT = -1; player.queued = false;
  if (from) { tmpA.subVectors(P.position, from).setY(0).normalize(); player.vel.addScaledVector(tmpA, 8); }
  for (let i = 0; i < 16; i++) fxDark.spawn(P.position.x, P.position.y + 1.3, P.position.z, R(-2, 2), R(0, 3), R(-2, 2), R(0.5, 1), R(0.12, 0.25), [0.35, 0.03, 0.02], [0.1, 0, 0], { g: 6, a: 0.9 });
  if (player.hp <= 0) playerDied();
}
function playerDied() {
  AudioFX.bossMusic(false); document.exitPointerLock?.();
  setTimeout(() => {
    state = 'dead'; $('hud').classList.remove('on'); $('touch').classList.remove('on');
    $('deadStats').textContent = `להבות שהוצתו ${litCount} מתוך ${SHRINE_COUNT}  ·  מתים שהושבו לעפר ${player.kills}`;
    $('deadScreen').classList.remove('hidden');
  }, 2600);
}
function onEnemyKilled(e, pos) {
  player.kills++;
  const n = e === king ? 30 : 6;
  for (let i = 0; i < n; i++) soulWisps.push({ p: pos.clone().add(new V3(R(-.4, .4), R(0, .6), R(-.4, .4))), v: new V3(R(-4, 4), R(2, 6), R(-4, 4)), t: 0 });
  player.souls += e === king ? 10 : 1;
  if (e === king) { chapter('', 'מלך האפר כורע', '', 4); AudioFX.bossMusic(false); }
}
function onBossShattered(pos) { winGame(); }

// =====================================================================
// Shrines & progression
// =====================================================================
function ignite(s) {
  s.lit = true; s.lightTarget = 45; s.light.color.set(0x7ad2ea); s.light.distance = 26; s.runeMat.color.setRGB(0.5, 2.0, 3.0);
  s.beam.material.uniforms.uColor.value.setRGB(0.35, 1.0, 1.4); s.beam.material.uniforms.uOpacity.value = 0.6;
  s.flame.palette = FIRE_SOUL; s.flame.rate = 70; s.flame.scale = 1.2; s.flame.spread = 0.4;
  candleEls[litCount].classList.add('lit'); litCount++;
  AudioFX.ignite(); shake = 0.25; flash = 0.35;
  for (let i = 0; i < 120; i++) { const a = rand() * TAU; fx.spawn(s.bowl.x, s.bowl.y + 0.3, s.bowl.z, Math.cos(a) * R(2, 7), R(0, 5), Math.sin(a) * R(2, 7), R(0.8, 1.6), R(0.15, 0.4), FIRE_SOUL[0], FIRE_SOUL[1], { g: 1, drag: 1.5 }); }
  if (litCount < SHRINE_COUNT) {
    chapter(`להבה ${ORD[litCount - 1]}`, 'להבת הנשמה הוצתה', 'האדמה סביב המקדש נסדקת…');
    setTimeout(() => { for (let i = 0; i < 2; i++) { const a = rand() * TAU; spawnAt(s.pos.x + Math.cos(a) * 7, s.pos.z + Math.sin(a) * 7, 'hollow'); } if (litCount > 1) { const a = rand() * TAU; spawnAt(s.pos.x + Math.cos(a) * 14, s.pos.z + Math.sin(a) * 14, 'wraith'); } }, 1200);
  } else chapter('חמש להבות', 'הכס רועד', 'שוב אל חצר המלך — הוא מחכה לך', 6);
}
function spawnAt(x, z, kind) {
  const r = Math.hypot(x, z); if (r > WORLD_R - 2) { x *= (WORLD_R - 2) / r; z *= (WORLD_R - 2) / r; }
  for (const c of colliders) if (Math.hypot(c.x - x, c.z - z) < c.r + 0.6) { x += (x - c.x) * 0.5 + 1; z += (z - c.z) * 0.5; }
  return kind === 'wraith' ? new Wraith(x, z) : new Hollow(x, z, true);
}
function winGame() {
  won = true; winT = 0; AudioFX.win(); flash = 1.2; shake = 0.5;
  for (const e of [...enemies]) if (!e.dead) e.die(new V3(0, 0, 1));
  for (let i = 0; i < 400; i++) { const a = rand() * TAU, r = R(0, 2); fx.spawn(king.pos.x + Math.cos(a) * r, 2, king.pos.z + Math.sin(a) * r, Math.cos(a) * R(2, 12), R(1, 12), Math.sin(a) * R(2, 12), R(1.5, 3.5), R(0.15, 0.5), FIRE_SOUL[0], FIRE_SOUL[1], { g: 1.2, drag: 0.9 }); }
  chapter('', 'הכתר נשבר', 'הירח מחוויר', 5);
  setTimeout(() => {
    state = 'win'; document.exitPointerLock?.(); $('hud').classList.remove('on'); $('touch').classList.remove('on');
    const mm = Math.floor(gameTime / 60), sc = Math.floor(gameTime % 60).toString().padStart(2, '0');
    $('winStats').textContent = `זמן ${mm}:${sc}  ·  מתים שהושבו לעפר ${player.kills}  ·  נשמות ${player.souls}`;
    $('winScreen').classList.remove('hidden');
  }, 6500);
}

// =====================================================================
// Player update
// =====================================================================
function playerGround() {
  let gy = groundAt(P.position.x, P.position.z);
  for (const s of shrines) { const d = Math.hypot(P.position.x - s.pos.x, P.position.z - s.pos.z); if (d < 3.9) gy = Math.max(gy, s.pos.y + 0.3); if (d < 2.5) gy = Math.max(gy, s.pos.y + 0.72); }
  return gy;
}
function updatePlayer(dt) {
  player.flinch = Math.max(0, player.flinch - dt * 3);
  if (player.hp <= 0) { animateKnight(dt, time, 0); return; }
  player.stDelay -= dt; if (player.stDelay <= 0) player.st = Math.min(100, player.st + 38 * dt);
  const active = state === 'play' && !won;
  const mv = active ? moveInput() : new V3(); if (mv.length() > 1) mv.normalize();
  const desired = mv.multiplyScalar(player.atkT >= 0 ? 1.0 : 6.0);
  if (player.rollT >= 0) {
    player.rollT += dt / 0.55;
    desired.copy(player.rollDir).multiplyScalar(3 + 9 * Math.max(0, 1 - player.rollT));
    if (rand() < 0.5) fxDark.spawn(P.position.x, P.position.y + 0.1, P.position.z, R(-.5, .5), R(0.2, 0.8), R(-.5, .5), R(0.6, 1), R(0.2, 0.4), [0.16, 0.14, 0.12], [0.07, 0.06, 0.05], { s1: 0.9, a: 0.6 });
    if (player.rollT >= 1) player.rollT = -1;
  }
  const rate = player.rollT >= 0 ? 30 : 12;
  player.vel.x = damp(player.vel.x, desired.x, rate, dt); player.vel.z = damp(player.vel.z, desired.z, rate, dt);
  P.position.x += player.vel.x * dt; P.position.z += player.vel.z * dt;
  for (const e of enemies) { if (e.dead) continue; const dx = P.position.x - e.pos.x, dz = P.position.z - e.pos.z, d = Math.hypot(dx, dz), m = e.radius + 0.38; if (d < m && d > 1e-3) { P.position.x = e.pos.x + dx / d * m; P.position.z = e.pos.z + dz / d * m; } }
  resolveCollisions(P.position, 0.42);
  P.position.y = damp(P.position.y, playerGround(), 20, dt);
  const hs = Math.hypot(player.vel.x, player.vel.z);
  if (hs > 0.5 && player.atkT < 0 && player.rollT < 0) player.facing = Math.atan2(player.vel.x, player.vel.z);
  P.rotation.y += angDiff(P.rotation.y, player.facing) * (1 - Math.exp(-(player.atkT >= 0 ? 22 : 13) * dt));
  // attacks
  if (player.atkT >= 0) {
    const S = SWINGS[player.combo], prev = player.atkT; player.atkT += dt / S.dur;
    if (player.atkT > 0.22 && player.atkT < 0.5) { P.position.x += Math.sin(player.facing) * 2.2 * dt; P.position.z += Math.cos(player.facing) * 2.2 * dt; }
    if (prev < 0.4 && player.atkT >= 0.4) doHit(S);
    if (player.atkT > 0.2 && player.atkT < 0.62) swordTrail.push(KP.base.getWorldPosition(tmpA), KP.tip.getWorldPosition(tmpB));
    if (player.queued && player.atkT >= 0.6 && player.st > 6) startSwing(player.combo + 1);
    else if (player.atkT >= 1) { player.atkT = -1; player.comboReset = 0.35; }
  } else if (player.comboReset > 0) { player.comboReset -= dt; if (player.comboReset <= 0) player.combo = 0; }
  // footsteps
  player.walkPhase += hs * dt * 1.5; player.stepAcc += hs * dt;
  if (player.stepAcc > 1.9 && player.rollT < 0) { player.stepAcc = 0; AudioFX.step(); fxDark.spawn(P.position.x, P.position.y + 0.05, P.position.z, R(-.3, .3), R(0.1, 0.4), R(-.3, .3), 0.8, 0.25, [0.14, 0.12, 0.1], [0.06, 0.05, 0.05], { s1: 0.7, a: 0.4 }); }
  if (time - player.lastHurt > 6 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 3 * dt);
  animateKnight(dt, time, player.rollT >= 0 ? 0 : Math.min(hs / 6, 1));
}

// =====================================================================
// Enemies: population
// =====================================================================
function populate() {
  const spots = [[-30, 45], [40, 40], [-60, -10], [20, -55], [-35, -50], [65, 15], [-15, 70], [55, -45]];
  spots.forEach(([x, z], i) => { if (i % 3 === 2) new Wraith(x, z); else { const h = new Hollow(x, z, false); } });
}
function updateSpawns(dt) {
  if (state !== 'play' || won || kingActive) return;
  spawnTimer -= dt; if (spawnTimer > 0) return;
  spawnTimer = Math.max(5, 11 - litCount * 1.2);
  const n = enemies.filter(e => e !== king && !e.dead).length; if (n >= 3 + litCount) return;
  for (let k = 0; k < 20; k++) {
    const a = rand() * TAU, r = R(16, 26), x = P.position.x + Math.cos(a) * r, z = P.position.z + Math.sin(a) * r;
    if (Math.hypot(x, z) < WORLD_R - 3 && Math.hypot(x, z) > 17 && Math.hypot(x - POND.x, z - POND.z) > POND_R + 2) { spawnAt(x, z, rand() < 0.68 ? 'hollow' : 'wraith'); break; }
  }
}

// =====================================================================
// World update
// =====================================================================
function updateWorld(dt) {
  windU.value = time;
  for (const f of flames) { f.update(dt); if (f.light) f.light.intensity = f.base * (0.85 + Math.sin(time * 11 + f.pos.x) * 0.08 + Math.sin(time * 27 + f.pos.z) * 0.07); }
  for (const s of shrines) {
    s.light.intensity = damp(s.light.intensity, s.lightTarget * (s.lit ? 0.9 + Math.sin(time * 7 + s.pos.x) * 0.1 : 0.7 + Math.sin(time * 2 + s.pos.z) * 0.3), 2, dt);
    s.beam.material.uniforms.uTime.value = time;
  }
  updateCandles(time);
  for (const b of bats) {
    const a = time * b.sp + b.ph, cx = P.position.x * 0.7 + b.ox, cz = P.position.z * 0.7 + b.oz;
    const x = cx + Math.cos(a) * b.r, z = cz + Math.sin(a) * b.r, y = b.h + Math.sin(time * 0.8 + b.ph) * 2.5, a2 = a + Math.sign(b.sp) * 0.05;
    b.g.position.set(x, y, z); b.g.lookAt(cx + Math.cos(a2) * b.r, y, cz + Math.sin(a2) * b.r);
    const f = Math.sin(time * 15 + b.ph) * 0.8; b.wL.rotation.z = f; b.wR.rotation.z = -f;
  }
  for (const c of cages) { c.pivot.rotation.z = Math.sin(time * 0.7 + c.ph) * 0.07; c.pivot.rotation.x = Math.sin(time * 0.5 + c.ph * 2) * 0.05; }
  rippleN.offset.x += dt * 0.012; rippleN.offset.y += dt * 0.007;
  for (const m of mists) { m.position.addScaledVector(m.userData.v, dt); if (Math.hypot(m.position.x, m.position.z) > 110) m.userData.v.negate(); }
  // ash drifting down, embers rising, will-o'-wisps in the graveyard
  const c = camera.position;
  for (let k = 0; k < 2; k++) fxDark.spawn(c.x + R(-24, 24), c.y + R(1, 12), c.z + R(-24, 24), R(-.3, .3), R(-0.7, -0.3), R(-.3, .3), R(5, 9), R(0.04, 0.08), [0.55, 0.52, 0.5], [0.3, 0.29, 0.28], { turb: 0.5, s1: 0.04, a: 0.85 });
  if (rand() < 0.4) fx.spawn(c.x + R(-25, 25), c.y + R(-2, 5), c.z + R(-25, 25), R(-.3, .3), R(0.1, 0.5), R(-.3, .3), R(4, 7), R(0.05, 0.1), [2.6, 0.7, 0.15], [0.7, 0.08, 0.01], { turb: 0.6 });
  if (rand() < dt * 5) fx.spawn(GRAVEYARD.x + R(-12, 12), heightAt(GRAVEYARD.x, GRAVEYARD.z) + R(0.4, 2), GRAVEYARD.z + R(-12, 12), R(-.3, .3), R(-.1, .2), R(-.3, .3), R(3, 6), R(0.1, 0.18), [0.5, 1.5, 1.6], [0.04, 0.2, 0.25], { turb: 1.2 });
  // soul wisps home in on the knight
  for (let i = soulWisps.length - 1; i >= 0; i--) {
    const s = soulWisps[i]; s.t += dt;
    tmpA.copy(P.position).setY(P.position.y + 1.3).sub(s.p); const d = tmpA.length();
    s.v.lerp(tmpA.normalize().multiplyScalar(14), 1 - Math.exp(-3 * dt * (1 + s.t * 2))); s.p.addScaledVector(s.v, dt);
    fx.spawn(s.p.x, s.p.y, s.p.z, 0, 0, 0, 0.35, 0.22, FIRE_SOUL[0], FIRE_SOUL[1]);
    if (d < 0.6 || s.t > 4) { soulWisps.splice(i, 1); if (player.hp > 0) player.hp = Math.min(player.maxHp, player.hp + 1.5); }
  }
  // storm
  lightningT -= dt;
  if (lightningT <= 0) { lightningT = R(10, 24); flash = R(0.6, 1.1); setTimeout(() => { flash = Math.max(flash, 0.8); }, 120); setTimeout(() => AudioFX.thunder(R(0.5, 1)), R(600, 1900)); }
  flash = Math.max(0, flash - dt * 2.8); skyMat.uniforms.uFlash.value = flash; hemi.intensity = 0.5 + flash * 2.2;
  // the throne wakes when the knight returns
  if (litCount >= SHRINE_COUNT && !kingActive && state === 'play' && Math.hypot(P.position.x, P.position.z) < 17) {
    kingActive = true; king.wake(); AudioFX.bossMusic(true); $('bossBar').classList.add('on');
    chapter('', 'מלך האפר', 'ואלדרן, אשר לא ימות', 5);
    for (const e of enemies) if (e !== king && !e.dead) e.die(new V3(0, 0, 1));
  }
  if (won) { winT += dt; skyMat.uniforms.uCurse.value = Math.max(0, 1 - winT / 5); moonLight.color.lerp(new THREE.Color(0xc8d4ff), dt * 0.3); gradePass.uniforms.uSat.value = Math.min(1.35, 1 + winT * 0.08); inkPass.uniforms.uRayCol.value.lerp(new THREE.Color(0.7, 0.8, 1), dt * 0.4); }
}

// =====================================================================
// Camera
// =====================================================================
const camTarget = new V3();
function updateCamera(dt) {
  if (state === 'title') {
    const a = Math.sin(time * 0.05) * 0.22;
    camera.position.set(4.2 + Math.sin(a) * 6, 2.3 + Math.sin(time * 0.17) * 0.25, 16 + Math.cos(a) * 2);
    camera.lookAt(-1.5, 3.6, -4);
    return;
  }
  const bossD = kingActive && !king.dead ? 1.6 : 0;
  const tgt = tmpA.set(P.position.x, P.position.y + 1.55 + bossD * 0.3, P.position.z);
  const right = new V3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(IS_TOUCH ? 0.2 : 0.5);
  tgt.add(right);
  camTarget.lerp(tgt, 1 - Math.exp(-14 * dt));
  const dist = (won ? camDist * 1.6 : camDist) + bossD;
  const off = new V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
  const want = camTarget.clone().add(off);
  want.y = Math.max(want.y, groundAt(want.x, want.z) + 0.5);
  camera.position.lerp(want, 1 - Math.exp(-12 * dt));
  if (shake > 0) { camera.position.x += R(-1, 1) * shake * 0.3; camera.position.y += R(-1, 1) * shake * 0.3; shake = Math.max(0, shake - dt * 1.5); }
  camera.lookAt(camTarget);
}

// =====================================================================
// HUD
// =====================================================================
function setBar(rect, k) { rect.setAttribute('x', (300 * (1 - k)).toFixed(1)); rect.setAttribute('width', (300 * k).toFixed(1)); }
function updateHUD(dt) {
  const k = player.hp / player.maxHp; hpTrail = damp(hpTrail, player.hp, 2.5, dt); hpTrail = Math.max(hpTrail, player.hp);
  setBar($('hpRect'), k); setBar($('hpTrailRect'), hpTrail / player.maxHp); setBar($('stRect'), player.st / 100);
  $('hpText').textContent = Math.ceil(player.hp);
  setBar($('bossRect'), Math.max(0, king.hp / king.maxHp));
  if (king.dead) $('bossBar').classList.remove('on');
  hurtFlash = Math.max(0, hurtFlash - dt * 1.8); $('hurt').style.opacity = Math.max(hurtFlash, state === 'play' ? clamp((0.35 - k) * 2.2, 0, 0.8) * (0.75 + Math.sin(time * 5) * 0.25) : 0);
  gradePass.uniforms.uHurt.value = hurtFlash;
  const qt = questText(); if ($('questText').innerHTML !== qt) $('questText').innerHTML = qt;
  if (chapterT > 0) { chapterT -= dt; if (chapterT <= 0) $('chapter').classList.remove('on'); }
  // interaction
  let target = null;
  if (state === 'play' && !won && player.hp > 0) for (const s of shrines) if (!s.lit && Math.hypot(P.position.x - s.pos.x, P.position.z - s.pos.z) < 4.8) target = s;
  $('tbUse').classList.toggle('ready', !!target);
  const hl = $('holdLine').querySelector('path');
  if (target) {
    const txt = `${HOLD} כדי להצית את הלהבה`; $('prompt').classList.add('on'); if ($('promptText').innerHTML !== txt) $('promptText').innerHTML = txt;
    if (keys.KeyE) { holdT += dt; if (rand() < 0.6) fx.spawn(P.position.x + R(-.3, .3), P.position.y + 1.1, P.position.z + R(-.3, .3), (target.bowl.x - P.position.x) * 1.2, R(0.5, 1.5), (target.bowl.z - P.position.z) * 1.2, 0.8, 0.14, FIRE_SOUL[0], FIRE_SOUL[1]); }
    else holdT = Math.max(0, holdT - dt * 2);
    hl.style.strokeDashoffset = 240 * (1 - Math.min(holdT / 1.6, 1));
    if (holdT >= 1.6) { holdT = 0; ignite(target); }
  } else { $('prompt').classList.remove('on'); holdT = 0; }
}

// =====================================================================
// Main loop
// =====================================================================
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 1 / 20);
  if (hitStop > 0) { hitStop -= dt; dt *= 0.1; }
  time += dt; if (state === 'play' && !won) gameTime += dt;
  updatePlayer(dt);
  Cape.step(dt, time);
  for (const e of [...enemies]) e.update(dt, time);
  updateSpawns(dt);
  updateDebris(dt); swordTrail.update(dt);
  updateWorld(dt);
  updateCamera(dt);
  updateHUD(dt);
  fx.update(dt, time); fxDark.update(dt, time);
  moonLight.position.copy(P.position).addScaledVector(moonDir, 140); moonLight.target.position.copy(P.position);
  sky.position.copy(camera.position);
  skyMat.uniforms.uTime.value = time; gradePass.uniforms.uTime.value = time;
  renderFrame();
}

// =====================================================================
// Boot
// =====================================================================
onResize(); addEventListener('resize', onResize);
populate();
P.position.set(1.2, PLAZA_TOP, 8.6); P.rotation.y = player.facing = Math.PI;
let frames = 0;
(function boot() { frame(); })();
requestAnimationFrame(() => requestAnimationFrame(() => $('loading').classList.add('done')));

$('startBtn').addEventListener('click', () => {
  AudioFX.init();
  $('titleScreen').classList.add('hidden'); $('hud').classList.add('on'); $('touch').classList.add('on');
  if (IS_TOUCH) { try { const fs = document.documentElement.requestFullscreen?.(); if (fs && fs.catch) fs.catch(() => {}); } catch (e) {} }
  else lockPointer();
  P.position.set(0, PLAZA_TOP, 8); player.facing = Math.PI; P.rotation.y = Math.PI;
  yaw = 0; pitch = 0.22; camTarget.set(0, 2, 8); camera.position.set(0, 3.5, 15);
  state = 'play'; spawnTimer = 10;
  setTimeout(() => chapter('פרק ראשון', 'חצר המלך ואלדרן', 'חמש להבות כבו. מצא את המקדשים לאורך הדרכים', 5.5), 700);
});
window.__game = { player, shrines, enemies, king, ignite, Cape, KP, get state() { return state; }, setView(y, p, d) { yaw = y; pitch = p; camDist = d; } };
