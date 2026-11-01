import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { AtmospherePass, GradePass } from './post.js';
import * as A from './assets.js';
import { Terrain } from './terrain.js';
import { GrassField, treeVariant, plantTrees, instanceScene, mushroomGeometry, windU } from './nature.js';
import { Sky, makeLiquid } from './sky.js';
import { initStructures, glowMat } from './structures.js';
import { Hero, Fairy } from './hero.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { STAGES } from './stages.js';
import { UI } from './ui.js';

const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
document.body.classList.toggle('touch', isTouch);
const store = { get(k, d) { try { const v = localStorage.getItem('aeth2-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('aeth2-' + k, JSON.stringify(v)); } catch (e) { } } };

const PRESETS = {
  high: { pr: 1.75, shadows: 2048, msaa: 4, bloom: true, rays: true, terrainRes: 256, grass: 90000, grassR: 30, grassSegs: 5, density: 1, maxLights: 8 },
  medium: { pr: 1.2, shadows: 1024, msaa: 0, bloom: true, rays: true, terrainRes: 192, grass: 26000, grassR: 24, grassSegs: 4, density: 0.7, maxLights: 4 },
  low: { pr: 1, shadows: 1024, msaa: 0, bloom: false, rays: false, terrainRes: 128, grass: 12000, grassR: 17, grassSegs: 3, density: 0.45, maxLights: 1 },
};
let qName = store.get('q', isTouch ? 'medium' : 'high'); if (!PRESETS[qName]) qName = 'medium';
const Q = PRESETS[qName];

// ---------------------------------------------------------------- renderer & post
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 1400);
let scene = new THREE.Scene();
const size = () => renderer.getDrawingBufferSize(new THREE.Vector2());
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa, depthTexture: new THREE.DepthTexture(1, 1) });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
const atmo = new AtmospherePass(camera, null, Q.rays); composer.addPass(atmo);
const _atmoRender = atmo.render.bind(atmo); atmo.render = (r, w, rb) => { atmo.uniforms.tDepth.value = rb.depthTexture; _atmoRender(r, w, rb); };
let bloom = null; if (Q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 1.6); composer.addPass(bloom); }
const grade = new GradePass(); composer.addPass(grade);
composer.addPass(new OutputPass());
let fxaa = null; if (!Q.msaa) { fxaa = new FXAAPass(); composer.addPass(fxaa); }
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  if (bloom) bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  if (fx) fx.uScale.value = size().y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
addEventListener('resize', onResize);
const pmrem = new THREE.PMREMGenerator(renderer);
canvas0().addEventListener('webglcontextlost', e => { e.preventDefault(); ui.toast('משחזר את הגרפיקה...'); }, false);
canvas0().addEventListener('webglcontextrestored', () => { ui.toast('הגרפיקה שוחזרה'); }, false);
function canvas0() { return renderer.domElement; }

// ---------------------------------------------------------------- globals
const ui = new UI(isTouch);
const sound = new Sound();
let hero, fairy, enemies, fx, L = null, stageIdx = 0;
let state = 'boot', time = 0, last = performance.now(), hitstop = 0, shake = 0, flashV = 0, dmgV = 0;
let camDistS, camYaw = 0, camPitch = 0.28, camDist = isTouch ? 8.5 : 7.8;
const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const sun = new THREE.DirectionalLight(0xffffff, 3), hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
sun.castShadow = true; sun.shadow.mapSize.set(Q.shadows, Q.shadows);
{ const c = sun.shadow.camera; c.left = -42; c.right = 42; c.top = 42; c.bottom = -42; c.near = 1; c.far = 260; }
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
const sunDir = new THREE.Vector3(0, 1, 0), partCol = new THREE.Color();
const run = { kills: 0, combo: 0, maxCombo: 0, comboT: 0, dmgTaken: 0, motes: 0, start: 0, deaths: 0 };

// ---------------------------------------------------------------- input
const keys = {}, inp = { mx: 0, mz: 0, attack: false, magic: false, jump: false, dodge: false, special: false, use: false };
const touch = { joy: null, cam: null, jx: 0, jz: 0, attackHeld: false };
let lockGrace = 0;
const canvas = renderer.domElement;
function safeLock() { if (isTouch) return; lockGrace = performance.now() + 700; try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => { }); } catch (e) { } }
function unlock() { lockGrace = performance.now() + 700; try { document.exitPointerLock?.(); } catch (e) { } }
addEventListener('keydown', e => {
  keys[e.code] = true; if (e.repeat) return;
  sound.init();
  if (state === 'dialog' && ['Space', 'Enter', 'KeyE', 'KeyF'].includes(e.code)) { ui.nextDialog(); e.preventDefault(); return; }
  if (state === 'paused' && e.code === 'Escape') { resume(); return; }
  if (state !== 'play') return;
  if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.dodge = true;
  if (e.code === 'KeyQ') inp.magic = true;
  if (e.code === 'KeyR') inp.special = true;
  if (e.code === 'KeyE' || e.code === 'KeyF') inp.use = true;
  if (e.code === 'KeyJ') inp.attack = true;
  if (e.code === 'Escape' || e.code === 'KeyP') pause();
});
addEventListener('keyup', e => keys[e.code] = false);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (isTouch) return; sound.init();
  if (state === 'dialog') { ui.nextDialog(); return; }
  if (state !== 'play') return;
  if (document.pointerLockElement !== canvas) safeLock();
  if (e.button === 0) inp.attack = true; if (e.button === 2) inp.magic = true; if (e.button === 1) inp.special = true;
});
addEventListener('mousemove', e => { if ((state === 'play' || state === 'dialog') && !isTouch && document.pointerLockElement === canvas) { camYaw -= e.movementX * 0.0024; camPitch += e.movementY * 0.002; } });
addEventListener('wheel', e => { if (state === 'play') camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.008, 4.5, 14); }, { passive: true });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'play' && !isTouch && performance.now() > lockGrace) pause(); });
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return; sound.init();
  if (state === 'dialog') { ui.nextDialog(); return; }
  if (state !== 'play') return;
  if (e.clientX < innerWidth * 0.45 && !touch.joy) { touch.joy = { id: e.pointerId, x: e.clientX, y: e.clientY }; ui.joy(true, e.clientX, e.clientY, 0, 0); }
  else if (!touch.cam) touch.cam = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', e => {
  if (touch.joy && e.pointerId === touch.joy.id) { let dx = e.clientX - touch.joy.x, dy = e.clientY - touch.joy.y; const l = Math.hypot(dx, dy), R = 56; if (l > R) { dx = dx / l * R; dy = dy / l * R; } ui.joy(true, touch.joy.x, touch.joy.y, dx, dy); touch.jx = dx / R; touch.jz = -dy / R; }
  else if (touch.cam && e.pointerId === touch.cam.id) { camYaw -= (e.clientX - touch.cam.x) * 0.006; camPitch += (e.clientY - touch.cam.y) * 0.0045; touch.cam.x = e.clientX; touch.cam.y = e.clientY; }
});
const endPtr = e => { if (touch.joy && e.pointerId === touch.joy.id) { touch.joy = null; touch.jx = touch.jz = 0; ui.joy(false); } if (touch.cam && e.pointerId === touch.cam.id) touch.cam = null; };
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
ui.bindTouch({ attack: d => { inp.attack = d || inp.attack; touch.attackHeld = d; }, magic: () => inp.magic = true, jump: () => inp.jump = true, dodge: () => inp.dodge = true, special: () => inp.special = true, use: () => inp.use = true, pause: () => pause() }, () => state, () => ui.nextDialog());
function readMove() {
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (touch.joy) { mx = touch.jx; mz = touch.jz; }
  inp.mx = mx; inp.mz = mz; if (touch.attackHeld) inp.attack = true;
}

// ---------------------------------------------------------------- level runtime (the "L" API used by stages)
const world = {
  groundAt(x, z, refY = 1e9) { let h = L.terrain.heightAt(x, z); for (const p of L.platforms) { if (p.top > h && p.top <= refY + 0.7) { if (p.r ? (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r : Math.abs(x - p.x) < p.hw && Math.abs(z - p.z) < p.hd) h = p.top; } } return h; },
  resolve(pos, r) {
    const k = Math.floor(pos.x / 8) * 10000 + Math.floor(pos.z / 8), list = L.grid.get(k); if (!list) return;
    for (const c of list) {
      if (c.box) { const lx = pos.x - c.x, lz = pos.z - c.z; if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) { const px = c.hw + r - Math.abs(lx), pz = c.hd + r - Math.abs(lz); if (px < pz) pos.x += Math.sign(lx) * px; else pos.z += Math.sign(lz) * pz; } continue; }
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + r; if (d < m && d > 1e-4) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; }
    }
  },
  inBounds(x, z) { const h = L.terrain.size / 2 - 4; return Math.abs(x) < h && Math.abs(z) < h; },
  liquidAt(x, z, g) { return !!L.def.liquid && g < L.def.liquid.level - 0.55; },
  get killY() { return L.def.killY ?? -30; }, blockLiquid: true,
};
function addToGrid(c, r) { const cs = 8, x0 = Math.floor((c.x - r) / cs), x1 = Math.floor((c.x + r) / cs), z0 = Math.floor((c.z - r) / cs), z1 = Math.floor((c.z + r) / cs); for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 10000 + j; if (!L.grid.has(k)) L.grid.set(k, []); L.grid.get(k).push(c); } }
let rngSeed = 1; const rng = () => { rngSeed = (rngSeed * 16807) % 2147483647; return (rngSeed - 1) / 2147483646; };
const variantCache = new Map();

function makeLevel(def, idx) {
  const lv = {
    def, idx, scene, touch: isTouch, flags: {}, time: 0, platforms: [], grid: new Map(), interacts: [], destructibles: [], emitters: [], anims: [], motesList: [], lightBudget: Q.maxLights,
    get hero() { return hero; }, get fx() { return fx; }, get enemies() { return enemies; },
    h: (x, z) => lv.terrain.heightAt(x, z),
    n: c => Math.max(1, Math.round(c * Q.density)),
    collider(x, z, r) { const c = { x, z, r }; addToGrid(c, r); return c; },
    boxCollider(x, z, hw, hd) { const c = { x, z, hw, hd, box: true }; addToGrid(c, Math.max(hw, hd) * 1.5); return c; },
    platform(x, z, r, top) { lv.platforms.push({ x, z, r, top }); },
    platformBox(x, z, hw, hd, top) { lv.platforms.push({ x, z, hw, hd, top }); },
    scatter(n, fn, minD = 3, sMin = 1, sMax = 1, tilt = false) {
      const out = [], half = lv.terrain.size / 2 - 6; let tries = 0;
      while (out.length < n && tries < n * 40) {
        tries++; const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half, h = lv.terrain.heightAt(x, z);
        const nn = lv.terrain.normalAt(x, z, tmp), sl = 1 - nn.y;
        if (!fn(x, z, h, sl)) continue;
        let bad = false; for (const o of out) if ((o.x - x) ** 2 + (o.z - z) ** 2 < minD * minD) { bad = true; break; } if (bad) continue;
        out.push({ x, y: h, z, s: sMin + rng() * (sMax - sMin), r: rng() * 6.283, rx: tilt ? (rng() - 0.5) * 0.6 : 0, rz: tilt ? (rng() - 0.5) * 0.6 : 0 });
      }
      return out;
    },
    async trees(preset, o, list, extra = {}) {
      if (!list.length) return;
      const key = preset + JSON.stringify(o); if (!variantCache.has(key)) variantCache.set(key, treeVariant(preset, o));
      const v = await variantCache.get(key);
      if (extra.narrow) for (const t of list) t.sv = new THREE.Vector3(t.s * extra.narrow, t.s, t.s * extra.narrow);
      plantTrees(scene, v, list);
      if (v.radius) for (const t of list) lv.collider(t.x, t.z, v.radius * t.s * (extra.narrow || 1));
    },
    async props(path, list, o = {}) {
      if (!list.length) return; const src = await A.prop(path);
      let material = null; if (o.tint) { src.traverse(m => { if (m.isMesh && !material) { material = m.material.clone(); material.color = new THREE.Color(o.tint); } }); }
      instanceScene(scene, src, list, { shadow: o.shadow !== false, material });
      if (o.collide) for (const t of list) lv.collider(t.x, t.z, o.collide * t.s);
    },
    async mushrooms(list, colors) {
      const { cap, stem } = mushroomGeometry();
      const stemMat = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.7, emissive: '#2a2030' });
      colors.forEach((c, ci) => {
        const sub = list.filter((_, i) => i % colors.length === ci); if (!sub.length) return;
        const capMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.1, roughness: 0.35 });
        instanceScene(scene, mkGroup([new THREE.Mesh(stem, stemMat), new THREE.Mesh(cap, capMat)]), sub, {});
        for (const t of sub) if (t.s > 1.8) lv.collider(t.x, t.z, 0.25 * t.s);
      });
    },
    async stoneStatue(model, x, y, z, ry, s) {
      const c = await A.character(model, { stone: true, hide: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', 'Mug'] });
      const g = new THREE.Group(); g.add(c.root); c.root.scale.setScalar(s); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
      const a = c.mixer.clipAction(c.clips['2H_Melee_Idle'] || c.clips.Idle); a.play(); c.mixer.update(0.5); a.paused = true;
      return g;
    },
    motes(list) {
      const geo = new THREE.OctahedronGeometry(0.28, 0), mat = glowMat('#ffd98a', 5);
      for (const p of list) { const m = new THREE.Mesh(geo, mat); m.position.copy(p); m.scale.set(0.8, 1.4, 0.8); scene.add(m); lv.motesList.push({ m, p: p.clone(), got: false }); }
    },
    emitArea(o) { lv.areaEmit = o; },
    emitter(o) { lv.emitters.push(o); },
    anim(f) { lv.anims.push(f); },
    light(color, intensity, dist, pos) { if (lv.lightBudget <= 0) return { intensity: 0, position: new THREE.Vector3() }; lv.lightBudget--; const l = new THREE.PointLight(color, intensity, dist, 1.8); l.position.copy(pos); scene.add(l); return l; },
    spawn(type, x, z, opts = {}) { return enemies.spawn(type, new THREE.Vector3(x, lv.h(x, z), z), opts); },
    say: lines => new Promise(res => { state = 'dialog'; ui.dialog(lines, () => { state = 'play'; safeLock(); res(); }); unlock(); }),
    toast: t => ui.toast(t), popText: (p, t, c, b) => ui.pop(p, t, c, b), sfx: n => sound.play(n), shake: a => shake = Math.max(shake, a), flash: (c, a) => { grade.uniforms.uFlashColor.value.set(c); flashV = a; },
    interact(o) { o.active = true; lv.interacts.push(o); return o; },
    destructible(o) { lv.destructibles.push(o); return o; },
    near: (p, r) => Math.hypot(hero.pos.x - p.x, hero.pos.z - p.z) < r,
    openPortal() { const p = lv.portal; p.open = true; sound.play('portal'); fx.emit(p.pos.clone().setY(p.pos.y + 3), { count: 120, color: '#ffffff', speed: 9, life: 1.2, size: 0.7 }); },
    bossStart(e) { enemies.bossActive = e; lv.boss = e; e.state = 'chase'; ui.boss(e.cfg.name, 1); sound.combat = 1; },
    bossDead: () => lv.boss && !lv.boss.alive,
    ending: () => startEnding(),
  };
  return lv;
}
function mkGroup(children) { const g = new THREE.Group(); for (const c of children) g.add(c); return g; }

// ---------------------------------------------------------------- stage loading
async function loadStage(idx, { menu = false } = {}) {
  state = 'loading'; stageIdx = idx;
  const def = STAGES[idx];
  ui.loading(true, def, menu); if (!menu) ui.menu(false);
  await new Promise(r => setTimeout(r, 60));
  // dispose old
  scene.traverse(o => { if (o.geometry && !o.userData.keep) o.geometry.dispose?.(); });
  scene = new THREE.Scene(); renderPass.scene = scene;
  L = makeLevel(def, idx); rngSeed = 1234 + idx * 77;
  A.setProgressHandler((d, p) => ui.progress(0.15 + 0.75 * d / p));
  ui.progress(0.05);
  const [envTex, noise] = await Promise.all([A.hdr(def.hdr), A.tex('tex/noise.png', { srgb: false }), initStructures()]);
  const env = pmrem.fromEquirectangular(envTex).texture; scene.environment = env; scene.environmentIntensity = def.envInt;
  scene.add(sun, sun.target, hemi);
  sunDir.set(...def.sun.dir).normalize(); sun.color.set(def.sun.color); sun.intensity = def.sun.intensity;
  hemi.color.set(def.hemi.sky); hemi.groundColor.set(def.hemi.ground); hemi.intensity = def.hemi.intensity;
  renderer.toneMappingExposure = def.exposure;
  const F = def.fog, au = atmo.uniforms; au.uFogColor.value.set(F.color); au.uFogDensity.value = F.density; au.uFogBase.value = F.base; au.uFogFalloff.value = F.falloff; au.uScatter.value = F.scatter; au.uRays.value = F.rays; au.uSunColor.value.set(def.sun.color).multiplyScalar(0.9);
  const G = def.grade, gu = grade.uniforms; gu.uTint.value.set(G.tint); gu.uShadowTint.value.set(G.shadow); gu.uSat.value = G.sat; gu.uContrast.value = G.contrast; gu.uVignette.value = G.vignette;
  L.sky = new Sky(scene, def.sky, noise);
  L.terrain = await new Terrain(def.terrain, Q).build(scene);
  ui.progress(0.3);
  L.grass = new GrassField(scene, L.terrain, Q, def.grassColors);
  if (def.liquid) L.liquid = await makeLiquid(scene, L.terrain, def.liquid);
  if (!hero) { hero = await new Hero().init(scene); fairy = new Fairy(scene); }
  scene.add(hero.root, hero.trail, fairy.g);
  hero.root.traverse(o => o.userData.keep = true); fairy.g.traverse(o => o.userData.keep = true);
  if (!fx) { fx = new FX(scene, 1); onResize(); }
  scene.add(fx.points, fx.ambient); fx.scene = scene; fx.rings.length = 0; for (const b of fx.bolts) scene.remove(b.m); fx.bolts.length = 0;
  fx.points.userData.keep = fx.ambient.userData.keep = true;
  if (enemies) enemies.clear();
  enemies = new Enemies(scene, fx, { onDeath, hurtHero, sound: n => sound.play(n), shake: a => shake = Math.max(shake, a), ground: (x, z) => L.h(x, z) });
  await def.build(L);
  ui.progress(0.95);
  // hero placement
  const s = def.start; hero.pos.set(s.x, L.h(s.x, s.z), s.z); hero.facing = s.facing; hero.vel.set(0, 0, 0); hero.revive(); hero.lastSafe.copy(hero.pos);
  camYaw = s.facing; camTarget.copy(hero.pos).add(tmp.set(0, 1.6, 0)); fairy.pos.copy(hero.pos).add(tmp.set(1, 3, 1));
  L.checkpoint = hero.pos.clone();
  sound.setMood(def.mood);
  for (const p of L.motesList) p.m.userData.keep = false;
  renderer.compile(scene, camera);
  await new Promise(r => setTimeout(r, 30));
  ui.loading(false);
  if (menu) { state = 'menu'; hero.char.mixer.stopAllAction(); hero.play('Sit_Floor_Idle', 0); return; }
  run.start = time; run.kills = 0; run.maxCombo = 0; run.dmgTaken = 0; run.motes = 0; run.deaths = 0;
  L.step = -1; ui.hud(true); ui.chapterCard(def);
  state = 'play'; safeLock();
  setTimeout(() => nextStep(), 900);
}
async function nextStep() {
  L.step++; const st = L.def.steps[L.step]; if (!st) return;
  L.checkpoint = hero.pos.clone(); L.stepReady = false;
  ui.objective(st.text, st.progress ? st.progress(L) : '');
  sound.play('ui');
  await st.enter?.(L);
  L.stepReady = true;
}

// ---------------------------------------------------------------- combat glue
function hurtHero(dmg, from) {
  if (!hero.damage(dmg, from)) return;
  run.dmgTaken += dmg; sound.play('hurt'); shake = Math.max(shake, 0.35); dmgV = 1;
  fx.emit(tmp.set(hero.pos.x, hero.pos.y + 1.2, hero.pos.z), { count: 16, color: '#ff4a5a', speed: 4, life: 0.5, size: 0.4 });
  const dx = hero.pos.x - from.x, dz = hero.pos.z - from.z, d = Math.hypot(dx, dz) || 1; hero.pos.x += dx / d * 0.7; hero.pos.z += dz / d * 0.7;
  if (hero.dead) { sound.play('die'); run.deaths++; setTimeout(() => { if (hero.dead) { state = 'dead'; unlock(); ui.death(true); } }, 1800); }
}
function onDeath(e) {
  run.kills++;
  sound.play('die');
  fx.emit(tmp.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), { count: e.cfg.boss ? 220 : 36, color: e.cfg.dark ? '#b05cff' : '#ffe0a0', speed: e.cfg.boss ? 14 : 6, life: 1, size: 0.6, up: 2 });
  const n = e.cfg.boss ? 10 : Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 2) : 0;
  for (let i = 0; i < n; i++) spawnOrb(e.pos, Math.random() < 0.6 ? 'hp' : 'mp');
  if (e.cfg.boss) { enemies.bossActive = null; ui.boss(null); shake = 1; hitstop = 0.35; grade.uniforms.uFlashColor.value.set('#ffffff'); flashV = 0.8; sound.combat = 0; for (const o of enemies.list) if (o.alive && o.opts.summoned) o.die(); }
}
const orbGeo = new THREE.IcosahedronGeometry(0.2, 1);
const orbMat = { hp: glowMat('#5fff8a', 4), mp: glowMat('#5fb0ff', 4) };
const pickups = [];
function spawnOrb(p, type) { const m = new THREE.Mesh(orbGeo, orbMat[type]); m.position.set(p.x, p.y + 1, p.z); scene.add(m); pickups.push({ m, type, v: new THREE.Vector3((Math.random() - 0.5) * 6, 5 + Math.random() * 3, (Math.random() - 0.5) * 6), t: 0, sc: scene }); }
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const o = pickups[i]; if (o.sc !== scene) { pickups.splice(i, 1); continue; } o.t += dt;
    tmp.set(hero.pos.x, hero.pos.y + 1, hero.pos.z).sub(o.m.position); const d = tmp.length();
    if (o.t > 0.6 && d < 7 && !hero.dead) o.v.lerp(tmp.normalize().multiplyScalar(18), Math.min(1, dt * 6));
    else { o.v.y -= 14 * dt; const g = world.groundAt(o.m.position.x, o.m.position.z) + 0.4; if (o.m.position.y < g) { o.m.position.y = g; o.v.set(o.v.x * 0.5, Math.abs(o.v.y) * 0.4, o.v.z * 0.5); } }
    o.m.position.addScaledVector(o.v, dt);
    if (d < 1.1 && o.t > 0.3) { if (o.type === 'hp') { hero.hp = Math.min(hero.maxHp, hero.hp + 15); ui.pop(hero.pos, '+15', '#7aff9a'); } else hero.mp = Math.min(hero.maxMp, hero.mp + 25); fx.emit(o.m.position, { count: 10, color: o.type === 'hp' ? '#5fff8a' : '#5fb0ff', speed: 3, life: 0.5, size: 0.4 }); sound.play('orb'); scene.remove(o.m); pickups.splice(i, 1); }
  }
}
function addCombo() { run.combo++; run.comboT = 3; run.maxCombo = Math.max(run.maxCombo, run.combo); ui.combo(run.combo); }
function heroEvents(ev) {
  for (const e of ev) {
    if (e.type === 'strike') {
      sound.play(e.combo === 3 ? 'special' : 'swing');
      const crit = Math.random() < 0.12, dmg = Math.round(e.dmg * hero.dmgMul * (crit ? 1.75 : 1) * (0.92 + Math.random() * 0.16));
      const hits = enemies.hitArc(hero.pos, hero.facing, e.range, e.arc, dmg, e.kb, e.heavy || e.combo === 3);
      if (e.combo === 3) { fx.ring(hero.pos, { color: '#bfe6ff', r0: 0.5, r1: 4.6, dur: 0.35 }); }
      for (const d of L.destructibles) { if (!d.target.alive) continue; const dd = Math.hypot(d.pos.x - hero.pos.x, d.pos.z - hero.pos.z); if (dd < e.range + d.radius) { d.target.hp -= dmg; d.onHit(); hitstop = 0.05; sound.play('hit'); ui.pop(tmp.copy(d.pos).setY(d.pos.y + 4), '' + dmg, '#e0b0ff'); if (d.target.hp <= 0) d.onDestroy(); } }
      if (hits.length) {
        sound.play(crit ? 'crit' : 'hit'); hitstop = e.heavy || e.combo === 3 ? 0.085 : 0.055; shake = Math.max(shake, e.heavy ? 0.28 : 0.14);
        hero.energy = Math.min(100, hero.energy + hits.length * (e.combo === 3 ? 2 : 9));
        for (const h of hits) { tmp.set(h.pos.x, h.pos.y + h.height * 0.55, h.pos.z); fx.emit(tmp, { count: crit ? 26 : 14, color: crit ? '#ffd27a' : '#e8f4ff', speed: 8, life: 0.35, size: 0.35 }); ui.pop(tmp, '' + dmg, crit ? '#ffd27a' : '#ffffff', crit); addCombo(); }
      }
    } else if (e.type === 'cast') {
      sound.play('magic');
      const tgt = enemies.nearest(hero.pos, 30, hero.facing, 0.3);
      hero.handWorld(tmp); tmp.y = Math.max(tmp.y, hero.pos.y + 1.2);
      const dir = new THREE.Vector3(Math.sin(hero.facing), 0.03, Math.cos(hero.facing));
      if (tgt) dir.set(tgt.pos.x - tmp.x, tgt.pos.y + tgt.height * 0.5 - tmp.y, tgt.pos.z - tmp.z).normalize();
      fx.bolt(tmp, dir, { color: '#9fe0ff', scale: 1.2, speed: 32, life: 1.3, homing: 7, target: tgt, dmg: Math.round(30 * hero.dmgMul) });
    } else if (e.type === 'special') { sound.play('special'); fx.emit(tmp.set(hero.pos.x, hero.pos.y + 1, hero.pos.z), { count: 40, color: '#bfe6ff', speed: 6, life: 0.6, size: 0.5 }); }
    else if (e.type === 'jump') sound.play('jump');
    else if (e.type === 'land') { sound.play('land'); if (e.hard) fx.emit(hero.pos, { count: 12, color: '#d8ccb8', speed: 2.5, life: 0.5, size: 0.5, up: 0.5 }); }
    else if (e.type === 'dodge') { sound.play('dash'); fx.emit(tmp.set(hero.pos.x, hero.pos.y + 0.4, hero.pos.z), { count: 14, color: '#d8ccb8', speed: 2.5, life: 0.5, size: 0.5 }); }
    else if (e.type === 'fall') { hero.pos.copy(hero.lastSafe); hero.vel.set(0, 0, 0); hurtHero(12, hero.pos.clone().add(tmp.set(0.01, 0, 0))); hero.invuln = 1.2; ui.toast('נפלת לתהום – ליאורה החזירה אותך'); }
  }
}
function boltStep(b) {
  const p = b.m.position;
  if (p.y < world.groundAt(p.x, p.z, p.y)) { fx.emit(p, { count: 12, color: b.color, speed: 3, life: 0.4, size: 0.5 }); return true; }
  if (b.hostile) {
    if (hero.dead) return false;
    const dx = hero.pos.x - p.x, dy = hero.pos.y + 1.1 - p.y, dz = hero.pos.z - p.z;
    if (dx * dx + dy * dy + dz * dz < 1.0) { hurtHero(b.dmg, p); fx.emit(p, { count: 16, color: b.color, speed: 4, life: 0.5, size: 0.5 }); return true; }
    return false;
  }
  for (const d of L.destructibles) if (d.target.alive && Math.hypot(d.pos.x - p.x, d.pos.z - p.z) < d.radius + 0.5 && p.y < d.pos.y + d.height) { d.target.hp -= b.dmg; d.onHit(); if (d.target.hp <= 0) d.onDestroy(); fx.emit(p, { count: 20, color: '#9fe0ff', speed: 6, life: 0.5, size: 0.5 }); return true; }
  for (const e of enemies.list) {
    if (!e.alive) continue;
    const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dy = (e.pos.y + e.height * 0.5) - p.y, r = e.radius + 0.6;
    if (dx * dx + dz * dz < r * r && Math.abs(dy) < e.height * 0.6 + 0.6) {
      e.hit(b.dmg, p, 4); ui.pop(tmp.set(e.pos.x, e.pos.y + e.height, e.pos.z), '' + b.dmg, '#9fe8ff'); addCombo();
      for (const o of enemies.list) if (o !== e && o.alive && o.pos.distanceTo(p) < 3) o.hit(Math.round(b.dmg * 0.5), p, 3);
      fx.emit(p, { count: 30, color: '#9fe0ff', speed: 7, life: 0.6, size: 0.6 }); fx.ring(tmp.set(p.x, e.pos.y, p.z), { color: '#9fe0ff', r0: 0.3, r1: 3, dur: 0.35 });
      sound.play('boom'); hitstop = 0.04; hero.energy = Math.min(100, hero.energy + 6);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- per-frame level update
function updateLevel(dt) {
  L.time += dt;
  const st = L.def.steps[L.step];
  if (st && L.stepReady && state === 'play') { if (st.update(L, dt)) { L.stepReady = false; nextStep(); } else if (st.progress) ui.objectiveProgress(st.progress(L)); }
  // interactables
  let best = null, bd = 1e9;
  for (const o of L.interacts) { if (!o.active) continue; const d = Math.hypot(o.pos.x - hero.pos.x, o.pos.z - hero.pos.z); if (d < o.r && d < bd) { bd = d; best = o; } }
  ui.prompt(best ? best.label : null);
  if (best && inp.use) { hero.interact(); if (best.use() !== false) best.active = false; }
  // motes
  for (const m of L.motesList) { if (m.got) continue; m.m.rotation.y += dt * 2; m.m.position.y = m.p.y + Math.sin(L.time * 2 + m.p.x) * 0.2; if (hero.pos.distanceTo(m.m.position) < 1.6) { m.got = true; m.m.visible = false; run.motes++; sound.play('mote'); fx.emit(m.m.position, { count: 24, color: '#ffd98a', speed: 4, life: 0.7, size: 0.4 }); ui.motes(run.motes, L.motesList.length); } }
  // portal
  if (L.portal) { const p = L.portal; p.u.uTime.value = L.time; p.u.uOpen.value += ((p.open ? 1 : 0) - p.u.uOpen.value) * Math.min(1, dt * 1.5); p.light.intensity = p.u.uOpen.value * 40; if (p.open && Math.random() < 0.5) fx.emit(tmp.set(p.pos.x + (Math.random() - 0.5) * 5, p.pos.y + 2.5 + (Math.random() - 0.5) * 5, p.pos.z), { count: 1, color: '#ffffff', speed: 0.6, life: 1.2, size: 0.3 }); if (p.open && L.near(p.pos, 3.2) && state === 'play' && L.step >= L.def.steps.length - 1) stageClear(); }
  // beacons/fires flicker
  for (const e of L.emitters) if (Math.random() < e.rate * dt && Math.abs(e.x - hero.pos.x) < 80 && Math.abs(e.z - hero.pos.z) < 80) fx.emit(e, { count: 1, color: e.color, speed: 0.4, up: e.up, life: e.life, size: e.size, spread: e.spread });
  if (L.areaEmit && Math.random() < dt * 10) { const a = L.areaEmit; for (let i = 0; i < a.count; i++) { const x = hero.pos.x + (Math.random() - 0.5) * 50, z = hero.pos.z + (Math.random() - 0.5) * 50; fx.emit(tmp.set(x, L.h(x, z) + 0.5 + Math.random() * 3, z), { count: 1, color: a.color, speed: 0.3, life: 3, size: 0.3, up: a.rise ? 0.8 : 0.1 }); } }
  for (let i = L.anims.length - 1; i >= 0; i--) if (!L.anims[i](dt)) L.anims.splice(i, 1);
  // compass marker
  ui.compass(camYaw, hero.pos, st && st.marker ? st.marker(L) : null, L.portal && L.portal.open ? L.portal.pos : null);
}

// ---------------------------------------------------------------- camera
function updateCamera(dt) {
  camPitch = THREE.MathUtils.clamp(camPitch, -0.12, 1.2);
  if (isTouch && !touch.cam && hero.speed > 2 && hero.state === 'move') { let d = hero.facing - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 2.2) camYaw += d * Math.min(1, dt * 0.7); }
  const k = 1 - Math.exp(-dt * 12);
  camTarget.x += (hero.pos.x - camTarget.x) * k; camTarget.z += (hero.pos.z - camTarget.z) * k; camTarget.y += (hero.pos.y + 1.75 - camTarget.y) * (1 - Math.exp(-dt * 7));
  let dist = camDist + (enemies.bossActive ? 3.5 : 0); const cp = Math.cos(camPitch);
  const side = 0.55;
  const dx = -Math.sin(camYaw) * cp - Math.cos(camYaw) * side / dist, dz = -Math.cos(camYaw) * cp + Math.sin(camYaw) * side / dist, dy = Math.sin(camPitch);
  // pull the camera in when terrain blocks the view
  let free = dist;
  for (let i = 1; i <= 12; i++) { const f = dist * i / 12, x = camTarget.x + dx * f, z = camTarget.z + dz * f; if (L.h(x, z) + 0.4 > camTarget.y + Math.max(dy, 0.05) * f) { free = Math.max(2.6, f * 0.85); break; } }
  camDistS = camDistS === undefined ? free : (free < camDistS ? free : camDistS + (free - camDistS) * Math.min(1, dt * 3));
  const cx = camTarget.x + dx * camDistS, cz = camTarget.z + dz * camDistS;
  camera.position.set(cx, Math.max(camTarget.y + dy * camDistS, L.h(cx, cz) + 0.7), cz);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; shake = Math.max(0, shake - dt * 2.4); }
  camera.lookAt(camTarget.x + Math.cos(camYaw) * -side * 0.6, camTarget.y, camTarget.z - Math.sin(camYaw) * -side * 0.6);
}
function updateEnv(dt) {
  if (window.__dbgCam) { const d = window.__dbgCam; camera.position.set(...d.p); camera.lookAt(...d.l); }
  windU.value = time;
  L.sky.update(time, camera, sunDir);
  const snap = 84 / Q.shadows, px = Math.round(hero.pos.x / snap) * snap, pz = Math.round(hero.pos.z / snap) * snap;
  sun.target.position.set(px, hero.pos.y, pz); sun.position.set(px + sunDir.x * 120, hero.pos.y + sunDir.y * 120, pz + sunDir.z * 120);
  L.grass.update(hero.pos, sunDir, sun, hemi);
  if (L.liquid) L.liquid.update(time, sunDir, sun);
  atmo.update(sunDir);
  fx.update(dt, time, hero.pos, partCol.set(L.def.particles.color), L.def.particles.rise);
  grade.uniforms.uTime.value = time; flashV = Math.max(0, flashV - dt * 1.6); grade.uniforms.uFlash.value = flashV;
  dmgV = Math.max(0, dmgV - dt * 2); grade.uniforms.uDamage.value = Math.max(dmgV * 0.6, hero.hp / hero.maxHp < 0.25 ? 0.35 + Math.sin(time * 5) * 0.1 : 0);
}

// ---------------------------------------------------------------- flow
function pause() { if (state !== 'play') return; state = 'paused'; ui.pause(true, qName); unlock(); }
function resume() { ui.pause(false); state = 'play'; safeLock(); }
function stageClear() {
  state = 'clear'; hero.cheer(); sound.play('victory'); unlock();
  const t = time - run.start, motes = run.motes, total = L.motesList.length;
  let score = 0; score += t < 360 ? 3 : t < 600 ? 2 : 1; score += run.dmgTaken < 60 ? 3 : run.dmgTaken < 180 ? 2 : 1; score += motes >= total ? 3 : motes >= total / 2 ? 2 : 1; score += run.maxCombo >= 20 ? 1 : 0;
  const rank = score >= 10 ? 'S' : score >= 8 ? 'A' : score >= 6 ? 'B' : 'C';
  const unlocked = Math.max(store.get('unlocked', 0), stageIdx + 1); store.set('unlocked', Math.min(unlocked, STAGES.length - 1));
  const ranks = store.get('ranks', {}); const order = 'CBAS'; if (!ranks[stageIdx] || order.indexOf(rank) > order.indexOf(ranks[stageIdx])) ranks[stageIdx] = rank; store.set('ranks', ranks);
  setTimeout(() => ui.clear({ def: L.def, time: t, kills: run.kills, combo: run.maxCombo, motes, total, dmg: run.dmgTaken, rank, last: stageIdx >= STAGES.length - 1 }), 1400);
}
function startEnding() {
  state = 'ending'; unlock(); ui.hud(false); sound.play('victory');
  const from = { top: L.sky.u.uTop.value.clone(), hor: L.sky.u.uHorizon.value.clone(), fog: atmo.uniforms.uFogColor.value.clone(), sun: sun.color.clone() };
  const to = { top: new THREE.Color('#3c5cc0'), hor: new THREE.Color('#ffc8a0'), fog: new THREE.Color('#e8b8c8'), sun: new THREE.Color('#ffd8b0') };
  let t = 0;
  L.anim(dt => {
    t += dt; const k = THREE.MathUtils.smoothstep(t, 1.5, 7);
    L.sky.u.uTop.value.copy(from.top).lerp(to.top, k); L.sky.u.uHorizon.value.copy(from.hor).lerp(to.hor, k); L.sky.u.uStars.value = 1 - k; L.sky.u.uMoon.value = k < 0.5 ? 1 : 0; L.sky.u.uSunSize.value = k;
    atmo.uniforms.uFogColor.value.copy(from.fog).lerp(to.fog, k); sun.color.copy(from.sun).lerp(to.sun, k); sun.intensity = 1.6 + k * 2; hemi.intensity = 0.75 + k * 0.4;
    sunDir.set(-0.4, 0.45 - k * 0.2, -0.8 + k * 0.4).normalize();
    if (L.liquid) L.liquid.mesh.material.uniforms.uLava.value = 1;
    if (t > 1.5 && t - dt <= 1.5) { flashV = 1.2; grade.uniforms.uFlashColor.value.set('#fff2d0'); fx.ring(hero.pos, { color: '#fff4c0', r0: 2, r1: 200, dur: 4 }); fx.emit(tmp.set(hero.pos.x, hero.pos.y + 4, hero.pos.z), { count: 400, color: '#fff4c0', speed: 25, life: 2.5, size: 1 }); hero.cheer(); }
    if (t > 8.5 && t - dt <= 8.5) { ui.ending(run); store.set('unlocked', STAGES.length - 1); }
    return t < 10;
  });
}
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000) * (window.__ts || 1); last = now;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
  time += dt;
  if (!L || state === 'loading' || state === 'boot') { return; }
  try {
  if (state === 'menu') {
    const a = time * 0.03; const c = STAGES[0].start;
    camera.position.set(hero.pos.x + Math.sin(a + 2.4) * 9, hero.pos.y + 2.4, hero.pos.z + Math.cos(a + 2.4) * 9); camera.lookAt(hero.pos.x, hero.pos.y + 1.4, hero.pos.z);
    hero.mixer.update(dt); fairy.update(dt, hero.pos, hero.facing, fx); updateEnv(dt);
  } else if (state === 'play') {
    readMove();
    const aim = enemies.nearest(hero.pos, 6.5, hero.facing, 0.1);
    const ev = hero.update(dt, inp, camYaw, world, aim);
    heroEvents(ev);
    enemies.update(dt, hero, world, camera);
    fx.updateBolts(dt, boltStep);
    updatePickups(dt); updateLevel(dt);
    inp.attack = inp.magic = inp.jump = inp.dodge = inp.special = inp.use = false;
    fairy.update(dt, hero.pos, hero.facing, fx);
    run.comboT -= dt; if (run.comboT <= 0 && run.combo) { run.combo = 0; ui.combo(0); }
    let combat = 0; for (const e of enemies.list) if (e.alive && e.state !== 'idle' && e.pos.distanceTo(hero.pos) < 30) { combat = 1; break; }
    sound.combat += (combat - sound.combat) * Math.min(1, dt * 0.8);
    updateCamera(dt); updateEnv(dt);
    ui.stats(hero); if (enemies.bossActive) ui.boss(enemies.bossActive.cfg.name, enemies.bossActive.hp / enemies.bossActive.maxHp);
  } else {
    const live = state !== 'paused';
    if (live) { hero.mixer.update(dt); hero.updateTrail(dt); enemies.update(state === 'dialog' ? 0 : dt, hero, world, camera); fairy.update(dt, hero.pos, hero.facing, fx); for (let i = L.anims.length - 1; i >= 0; i--) if (!L.anims[i](dt)) L.anims.splice(i, 1); }
    if (state === 'ending') { const a = time * 0.15; camera.position.set(hero.pos.x + Math.sin(a) * 10, hero.pos.y + 4, hero.pos.z + Math.cos(a) * 10); camera.lookAt(hero.pos.x, hero.pos.y + 1.5, hero.pos.z); }
    else if (live) updateCamera(dt);
    updateEnv(live ? dt : 0);
  }
  } catch (err) { if (!loop.errs) loop.errs = 0; if (loop.errs++ < 3) console.error(err); }
  try { ui.update(dt, camera); composer.render(); } catch (err) { if (!loop.rerr) { loop.rerr = 1; console.error(err); } }
}

// ---------------------------------------------------------------- menu wiring
ui.onMenu({
  async start(idx) { sound.init(); sound.play('ui'); ui.menu(false); if (idx === stageIdx && state === 'menu') { hero.revive(); run.start = time; run.kills = run.maxCombo = run.dmgTaken = run.motes = run.deaths = 0; L.step = -1; ui.hud(true); ui.chapterCard(L.def); state = 'play'; safeLock(); setTimeout(() => nextStep(), 900); } else await loadStage(idx); },
  chapters: () => ({ unlocked: store.get('unlocked', 0), ranks: store.get('ranks', {}), list: STAGES }),
  quality: () => { const order = ['high', 'medium', 'low']; const n = order[(order.indexOf(qName) + 1) % 3]; store.set('q', n); location.reload(); },
  qualityName: () => qName,
  resume, restart: () => { ui.pause(false); loadStage(stageIdx); },
  toMenu: () => location.reload(),
  sound: () => { sound.setEnabled(!sound.enabled); return sound.enabled; },
  respawn() {
    ui.death(false); hero.pos.copy(L.checkpoint); hero.revive(); hero.invuln = 2;
    for (const e of enemies.list) if (e.alive && e.state !== 'idle' && !e.cfg.boss) e.state = 'idle';
    if (L.boss && L.boss.alive) { L.boss.hp = L.boss.maxHp; L.boss.state = 'idle'; L.boss.pos.copy(L.boss.spawnPos); }
    state = 'play'; safeLock();
  },
  next() { ui.clearHide(); if (stageIdx < STAGES.length - 1) loadStage(stageIdx + 1); },
  credits: () => location.reload(),
});

// ---------------------------------------------------------------- boot
(async () => {
  try {
    ui.boot();
    await A.animations();
    await loadStage(0, { menu: true });
    ui.menu(true, store.get('unlocked', 0) > 0);
    requestAnimationFrame(loop);
  } catch (e) { console.error(e); ui.error(e); }
})();
window.__game = { next: () => nextStep(), get state() { return state; }, get hero() { return hero; }, get L() { return L; }, get enemies() { return enemies; }, camera, run, load: loadStage, setYaw: y => camYaw = y };
