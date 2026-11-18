import * as THREE from 'three';
import { $, CFG, clamp, damp, rnd, pick, IS_TOUCH, HEADLESS, sound, store } from './core.js';
import { renderer, scene, camera, Q, qualityName, canvas, loadGLTF, loadTex, progress, loadMoods, setMood, updateSky, setupPost, renderFrame, resize, setMoodTimes, sky, ASSET_BASE } from './render.js';
import * as W from './world.js';
import { initPhysics, buildStatic, world, events, R } from './physics.js';
import { lib, Human, ANIMS, MODELS, PLAYER_MODEL, updateFrustum } from './characters.js';
import { loadCar, CARS, NIGHT, initVehicleFX } from './vehicles.js';
import * as FX from './fx.js';
import { clock, humans, vehicles, pickups, player, cam, wanted, mission, flags, input, stats, interp } from './state.js';
import * as AI from './ai.js';
import { updateHUD, drawMinimap, buildMapBase, toast, gps } from './hud.js';
import { MISSIONS, missionTick, updatePickups, setupPickups, setPickupGun, updateRacer, computeGPS, save, startMission, closeMissionCard } from './missions.js';
import { initPlayer, updatePlayer, updateCamera, setupInput, setupTouch, lockPointer, markSegs, setMoodHooks, setNightSource, enterCar, exitCar, nearestEnterable } from './player.js';

const TEXSETS = ['road', 'walk', 'conc', 'brick', 'brick2', 'plaster', 'plaster2', 'sand', 'grass', 'wood', 'dirt', 'metal'];
const G = { T: {}, M: {}, ready: false };
let bootErr = false;
progress.onChange = f => { if (bootErr) return; const p = Math.round(f * 100); $('loading').textContent = `LOADING · ${p}%`; $('loadBar').firstChild.style.width = p + '%'; };

async function loadAll() {
  const texP = Promise.all(TEXSETS.map(async k => {
    const [c, n, r] = await Promise.all([loadTex(`tex/${k}_c.webp`), loadTex(`tex/${k}_n.webp`, { srgb: false }), loadTex(`tex/${k}_r.webp`, { srgb: false })]);
    G.T[k] = { c, n, r };
  }));
  const modelP = Promise.all([
    loadGLTF('props/tree.glb').then(g => G.M.tree = g),
    loadGLTF('props/pistol.glb').then(g => G.M.pistol = g),
    loadTex('tex/waternormals.jpg', { srgb: false }).then(t => G.M.waterN = t),
  ]);
  const animP = lib.loadAnims(Object.keys(ANIMS));
  const charP = Promise.all([lib.loadModel(PLAYER_MODEL, true), ...Object.keys(MODELS).map(n => lib.loadModel(n))]);
  const carP = Promise.all(Object.keys(CARS).map(loadCar));
  await Promise.all([texP, modelP, animP, charP, carP, loadMoods(), initPhysics()]);
}
function prepGun(g) {
  const root = g.scene.clone(true); const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const L = Math.max(size.x, size.y, size.z), s = 0.24 / L; root.scale.setScalar(s);
  // longest axis -> +z (barrel forward)
  if (size.x === L) root.rotation.y = -Math.PI / 2; else if (size.y === L) root.rotation.x = Math.PI / 2;
  const holder = new THREE.Group(); holder.add(root); holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root), c = b2.getCenter(new THREE.Vector3()); root.position.sub(c);
  holder.traverse(o => { if (o.isMesh) { o.castShadow = true; for (const m of [].concat(o.material)) { m.envMapIntensity = 1.2; } } });
  return holder;
}

/* =====================================================================
   VEHICLE & PEOPLE POPULATION
   ===================================================================== */
const PARKED_TYPES = ['bavaria', 'bavaria', 'volt', 'volt', 'volt', 'bavaria', 'aurora', 'ferrari'];
function parkedTypeFor(s) { if (s.type === 'police') return ['volt', { variant: 'police' }]; if (s.type === 'van') return ['volt', { color: s.color }]; if (s.type === 'sedan') return ['bavaria', { color: s.color }]; return [pick(PARKED_TYPES), {}]; }
let manageT = 0;
function manage(dt) {
  manageT -= dt; if (manageT > 0) return; manageT = 0.4;
  const px = player.x, pz = player.z;
  let tc = 0;
  for (const v of vehicles.slice()) {
    const d = Math.hypot(v.x - px, v.z - pz);
    if (v === player.car || v.mission) continue;
    if (v.mode === 'traffic') { tc++; if (d > 235) AI.removeVehicle(v); }
    else if (v.mode === 'wreck' && (d > 240 || (v.dead && v.deadT > 90 && !AI.inView(v.x, 1, v.z, 4)))) AI.removeVehicle(v);
    else if (v.mode === 'police' && v.ai && v.ai.leaving && d > 150 && !AI.inView(v.x, 1, v.z, 4)) AI.removeVehicle(v);
    else if (v.mode === 'policeStop' && wanted.level === 0 && d > 120) AI.removeVehicle(v);
    else if ((v.mode === 'parked' && !v.spot && d > 300) || v.y < -12) AI.removeVehicle(v);
  }
  for (let k = 0; k < 2 && tc < Q.traffic; k++, tc++) AI.spawnTrafficCar(player);
  for (const s of W.parkedSpots) {
    const d = Math.hypot(s.x - px, s.z - pz);
    if (s.v && (s.v.removed || s.v.mode !== 'parked' || Math.hypot(s.v.x - s.x, s.v.z - s.z) > 3)) { if (s.v && !s.v.removed) s.v.spot = null; s.v = null; s.cool = 120; }
    s.cool = Math.max(0, (s.cool || 0) - 0.4);
    if (s.use === undefined) s.use = Math.random() < 0.45 || !!s.type;
    if (s.use && !s.v && s.cool <= 0 && d < 140 && d > 25) { const [type, opts] = parkedTypeFor(s); s.v = AI.spawnVehicle(type, s.x, s.z, s.h, opts); if (s.v) { s.v.spot = s; s.v.mode = 'parked'; s.v.hand = true; } }
    else if (s.v && d > 220 && s.v.mode === 'parked') { AI.removeVehicle(s.v); s.v = null; }
  }
  let pc = 0;
  for (const h of humans.slice()) {
    if (h === player.h || h.mission) continue;
    const d = Math.hypot(h.x - px, h.z - pz);
    if (h.kind === 'ped') { if (h.alive) pc++; if (d > 150 || (!h.alive && h.deadT > 40 && !AI.inView(h.x, 1, h.z, 2)) || (!h.alive && d > 90)) AI.removeHuman(h); }
    else if (h.kind === 'cop' && ((h.ai.leaving && d > 60) || (!h.alive && d > 80) || (h.ai.leaving && !AI.inView(h.x, 1, h.z, 2) && d > 25))) AI.removeHuman(h);
    else if (h.kind === 'gang' && (d > 150 || (!h.alive && d > 80))) AI.removeHuman(h);
  }
  for (let k = 0; k < 3 && pc < Q.peds; k++, pc++) AI.spawnPed(player);
}

/* =====================================================================
   SIMULATION STEP (fixed 60 Hz)
   ===================================================================== */
function step(dt) {
  clock.t += dt; clock.frame++;
  for (const v of vehicles) v.savePrev();
  for (const h of humans) { h.pX = h.x; h.pY = h.y; h.pZ = h.z; h.pYaw = h.yaw; }
  if (flags.running) updatePlayer(dt);
  for (const v of vehicles) {
    if (v.removed) continue;
    v.camDist = Math.hypot(v.x - camera.position.x, v.z - camera.position.z);
    if (v.mode === 'traffic') { AI.updateTraffic(v, dt); continue; }
    if (v.mode === 'police' || v.mode === 'policeStop') AI.updatePoliceCar(v, dt);
    else if (v.mode === 'racer') updateRacer(v, dt);
    else if (v.mode !== 'player') { v.throttle = 0; v.brake = 0; v.hand = true; v.steer = damp(v.steer, 0, 3, dt); }
    if (v.body && v.dynamic && !(v.mode === 'parked' && v.body.isSleeping())) v.drive(dt);
  }
  AI.preStepTrafficHits();
  world.step(events);
  AI.handleContacts(events);
  for (const v of vehicles) { if (v.removed) continue; if (v.dynamic) v.readBack(dt); AI.vehicleStatus(v, dt); }
  for (const h of humans) {
    if (h === player.h || h.removed) continue;
    if (h.kind === 'ped') AI.updatePed(h, dt); else if (h.kind === 'cop') AI.updateCop(h, dt); else if (h.kind === 'gang') AI.updateGang(h, dt);
    if (!h.alive) h.deadT = (h.deadT || 0) + dt;
    if (h.state !== 'air') h.y = damp(h.y, W.groundHeight(h.x, h.z), 20, dt);
  }
  AI.humanCarCollisions();
  if (flags.running) { AI.updateWanted(dt); missionTick(dt); updatePickups(dt); }
  for (let i = AI.geysers.length - 1; i >= 0; i--) { const g = AI.geysers[i]; g.t -= dt; if (Math.hypot(g.x - camera.position.x, g.z - camera.position.z) < 120) FX.fx_water(g.x, W.CURB, g.z); if (g.t <= 0) AI.geysers.splice(i, 1); }
  let sir = 0; for (const v of vehicles) if (v.siren && !v.removed) sir = Math.max(sir, 1 - v.camDist / 140);
  if (!flags.paused) sound.setSiren(sir);
  manage(dt);
  input.pressed.clear(); input.touch.jumpTap = false; input.touch.weapTap = false;
}

/* =====================================================================
   RENDER
   ===================================================================== */
const _focus = new THREE.Vector3();
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 60;
function render(rdt) {
  const adt0 = rdt * flags.timeScale;
  for (const h of humans) h.update(adt0, clock.frame);
  for (const v of vehicles) v.sync(rdt);
  const fc = window.game && window.game.free;
  if (fc) { camera.position.set(fc.p[0], fc.p[1], fc.p[2]); camera.lookAt(fc.l[0], fc.l[1], fc.l[2]); if (fc.fov && camera.fov !== fc.fov) { camera.fov = fc.fov; camera.updateProjectionMatrix(); } } else updateCamera(rdt);
  camera.updateMatrixWorld(); updateFrustum();
  _focus.set(player.x, 0, player.z);
  updateSky(flags.running ? rdt : rdt * 0.5, flags.running ? _focus : camera.position);
  NIGHT.v = W.lampsOn(sky.night);
  W.updateWorld(rdt, sky.night, clock.t);
  const adt = adt0;
  FX.updateFX(adt);
  if (flags.running) {
    updateHUD(rdt);
    gps.t -= rdt; if (gps.t <= 0) { gps.t = 0.5; computeGPS(); }
    drawMinimap();
  }
  renderFrame();
  frames++; fpsT += rdt; if (fpsT > 2) { fps = frames / fpsT; frames = 0; fpsT = 0; if (flags.running && fps < 24 && renderer.getPixelRatio() > 0.7 && !HEADLESS) { renderer.setPixelRatio(renderer.getPixelRatio() * 0.85); onResize(); } }
}
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!flags.paused && !flags.modal) { acc += rdt * flags.timeScale; let n = 0; while (acc >= CFG.step && n < 4) { step(CFG.step); acc -= CFG.step; n++; } if (n === 4) acc = 0; interp.a = clamp(acc / CFG.step, 0, 1); }
  else { input.pressed.clear(); interp.a = 1; }
  render(flags.paused ? 0 : rdt);
}
function onResize() {
  resize();
  const mm = $('minimap'), r = mm.getBoundingClientRect(); const px = Math.round(Math.max(150, r.width) * Math.min(2, window.devicePixelRatio || 1)); if (mm.width !== px) { mm.width = mm.height = px; }
}
window.addEventListener('resize', onResize);

/* =====================================================================
   BOOT
   ===================================================================== */
function startGame() {
  if (flags.running) return;
  sound.init(); sound.loadSamples(ASSET_BASE + 'sfx/');
  flags.running = true; $('menu').hidden = true; $('hud').classList.add('on');
  if (IS_TOUCH) setupTouch();
  cam.yaw = player.h.yaw; cam.pitch = 0.22; lockPointer(); canvas.focus(); onResize();
  if (flags.firstRun) setTimeout(() => toast(IS_TOUCH ? 'ג׳ויסטיק משמאל לתנועה · גרור כדי להסתובב' : 'לחץ על המסך כדי לשלוט במצלמה עם העכבר', 4500), 600);
  setTimeout(() => toast('הסימון הכתום <b>1</b> במפה הוא המשימה הראשונה שלך', 5000), flags.firstRun ? 5400 : 600);
}
const moodGet = () => sky.auto ? 'auto' : (sky.next || sky.cur);
const moodSet = m => { if (m === 'auto') { sky.auto = true; sky.timer = 0; } else { sky.auto = false; setMood(m, 3); } store.set('sb2-mood', m); };
async function boot() {
  try {
    if (IS_TOUCH) document.body.classList.add('touch-ui');
    await loadAll();
    W.buildWorld(G.T, G.M); buildStatic();
    FX.initFX(); initVehicleFX(); setupPost(); setMoodTimes(CFG.moodSeconds); buildMapBase();
    const gun = prepGun(G.M.pistol); AI.setGunModel(gun); setPickupGun(gun);
    const m0 = store.get('sb2-mood', 'auto'); if (m0 !== 'auto') { sky.auto = false; setMood(m0, 0); } else setMood('day', 0);
    setMoodHooks(moodGet, moodSet); setNightSource(() => sky.night);
    const sv = store.get('sb2-save', null);
    if (sv) { player.money = sv.money || 0; mission.idx = sv.idx || 0; player.owned = sv.owned || player.owned; player.ammo = sv.ammo || player.ammo; player.mag = sv.mag || player.mag; Object.assign(stats, sv.stats || {}); flags.firstRun = false; $('newBtn').hidden = false; }
    initPlayer();
    setupPickups(); setupInput();
    // populate around the player
    updateCamera(0); camera.updateMatrixWorld(); updateFrustum();
    for (let k = 0; k < 40; k++) { manageT = 0; manage(0.4); }
    for (let k = 0; k < 90; k++) step(CFG.step);
    onResize(); markSegs();
    $('loading').hidden = true; $('loadWrap') && ($('loadWrap').hidden = true);
    const pb = $('playBtn'); pb.disabled = false; pb.textContent = sv ? 'המשך לשחק' : 'התחל לשחק';
    pb.addEventListener('click', startGame);
    $('newBtn').addEventListener('click', () => { store.del('sb2-save'); location.reload(); });
    setInterval(() => { if (flags.running) save(); }, 30000);
    G.ready = true; window.__boot = true;
    requestAnimationFrame(frame);
  } catch (e) { console.error(e); bootErr = true; $('loading').textContent = 'ERROR: ' + e.message; window.__bootErr = String(e && e.stack || e); }
}

/* debug / test hooks */
window.game = {
  get state() { return { running: flags.running, paused: flags.paused, modal: flags.modal, money: player.money, hp: player.hp, heat: wanted.level, inCar: !!player.car, carSpeed: player.car ? player.car.speedAbs : 0, x: player.x, z: player.z, y: player.h ? player.h.y : 0, mission: mission.active ? mission.active.title : null, missionIdx: mission.idx, vehicles: vehicles.length, humans: humans.length, fps, mood: moodGet() }; },
  press(code, ms = 120) { input.keys[code] = true; input.pressed.add(code); setTimeout(() => { input.keys[code] = false; }, ms); },
  hold(code, on) { input.keys[code] = on; if (on) input.pressed.add(code); },
  mouse(btn, on) { input.mouse[btn] = on; },
  step(n = 1) { for (let i = 0; i < n; i++) step(CFG.step); interp.a = 1; render(CFG.step); },
  render() { render(1 / 60); },
  start: startGame, mood: moodSet,
  teleport(x, z, h) { if (player.car) player.car.place(x, z, h ?? player.car.h); else { const y = W.groundHeight(x, z); player.h.setPosition(x, y, z); player.collider.setTranslation({ x, y: y + 0.86, z }); if (h !== undefined) { player.h.yaw = h; cam.yaw = h; } } player.x = x; player.z = z; },
  enterNearest() { const v = nearestEnterable(); if (v) enterCar(v); return !!v; }, exitCar, enter: enterCar, nearestEnterable,
  spawnCar(type, opts) { const h = player.h.yaw, x = player.x + Math.sin(h) * 6, z = player.z + Math.cos(h) * 6; const v = AI.spawnVehicle(type, x, z, h, opts || {}); if (v) v.mode = 'parked'; return v; },
  W, AI, player, cam, wanted, mission, vehicles, humans, sky, MISSIONS, startMission, closeMissionCard, renderer, scene, camera, lib,
};
window.THREE = THREE;
boot();
