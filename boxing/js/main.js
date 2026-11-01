import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildArena, RING } from './arena.js';
import { loadFighterAssets, buildFighter } from './fighterModel.js';
import { Fighter } from './fighter.js';
import { AIController, AI_LEVELS } from './ai.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ roster
const ROSTER = [
  {
    name: 'ARIEL BEN-DAVID', nick: '"THE LION"', flag: 'ISR', record: '24-1-0', ko: 18, age: 28, height: '1.87 m', weight: '77.5 kg', reach: '1.91 m', stance: 'ORTHODOX',
    power: 0.96, speed: 1.06, chin: 1.0, ratings: { POWER: 4, SPEED: 5, CHIN: 4, KICKS: 4 },
    look: { body: 'a', tint: [1, 1, 1], shorts: 0xa8101c, trim: 0xf3f1ea, glove: 0xc0101e, gloveTrim: 0xf3f1ea, boots: 0x111111, bootTrim: 0xe6e6e6, mustache: true },
  },
  {
    name: 'MARCUS REID', nick: '"THE TANK"', flag: 'USA', record: '31-3-1', ko: 25, age: 31, height: '1.87 m', weight: '84.0 kg', reach: '1.95 m', stance: 'ORTHODOX',
    power: 1.08, speed: 0.95, chin: 0.94, ratings: { POWER: 5, SPEED: 3, CHIN: 5, KICKS: 3 },
    look: { body: 'b', tint: [0.6, 0.45, 0.36], shorts: 0x13224a, trim: 0xd9a520, glove: 0x151515, gloveTrim: 0xd9a520, boots: 0xf0f0f0, bootTrim: 0x13224a, mustache: false },
  },
];
const ROUND_OPTS = [{ r: 3, t: 90, label: '3 × 1:30' }, { r: 5, t: 90, label: '5 × 1:30' }, { r: 3, t: 180, label: '3 × 3:00' }, { r: 1, t: 120, label: '1 × 2:00' }];
const settings = Object.assign({ fighter: 0, diff: 1, rounds: 0, sound: true, cam: 'side' }, JSON.parse(localStorage.getItem('ironcanvas') || '{}'));
const save = () => localStorage.setItem('ironcanvas', JSON.stringify(settings));

// ------------------------------------------------------------------ renderer
const TESTQ = new URLSearchParams(location.search).has('lowq');
const isMobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);
const quality = isMobile
  ? { pr: Math.min(devicePixelRatio, 1.3), shadow: 1024, crowdRows: 5, samples: 2 }
  : { pr: Math.min(devicePixelRatio, 1.6), shadow: 2048, crowdRows: 9, samples: 4 };
if (TESTQ) Object.assign(quality, { pr: 0.6, samples: 0, crowdRows: 4, shadow: 1024 });
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(quality.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 120);
camera.position.set(0, 3, 8);

// Phones (and GPUs without float render targets) draw straight to the screen:
// the post-processing chain renders black on many iPhones.
const hasFloatRT = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
const DIRECT = (isMobile || !hasFloatRT || new URLSearchParams(location.search).has('direct')) && !new URLSearchParams(location.search).has('fx');
if (DIRECT) renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const rt = new THREE.WebGLRenderTarget(DIRECT ? 1 : innerWidth * quality.pr, DIRECT ? 1 : innerHeight * quality.pr, { type: THREE.HalfFloatType, samples: DIRECT ? 0 : quality.samples });
const composer = new EffectComposer(renderer, rt);
if (!DIRECT) composer.setPixelRatio(quality.pr);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(DIRECT ? new THREE.Vector2(2, 2) : new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.5, 1.6);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.85 }, uCA: { value: 0.0 }, uDesat: { value: 0 }, uRed: { value: 0 }, uWarm: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uCA, uDesat, uRed, uWarm; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * (0.0025 + uCA) * r * 2.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col *= vec3(1.0 + uWarm, 1.0, 1.0 - uWarm);
      col = mix(col, col * col * 1.6, 0.12); // a touch of contrast
      col *= mix(1.0, smoothstep(0.9, 0.2, r), uVig);
      col = mix(col, col * vec3(1.4, 0.35, 0.3), uRed * smoothstep(0.25, 0.75, r));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); if (!DIRECT) composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ particles
class Particles {
  constructor(scene, n = 700) {
    this.n = n; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('life', new THREE.BufferAttribute(this.life, 1)); g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float life; attribute float size; varying float vL; void main(){ vL = life; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * 300.0 / -mv.z * step(0.001, life); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.15, d) * clamp(vL * 2.5, 0.0, 1.0) * 0.85; gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * 1.6, a); }`,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; scene.add(this.pts);
    this.i = 0;
  }
  burst(p, dir, count, speed) {
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.pos[i * 3] = p.x + rnd(-0.04, 0.04); this.pos[i * 3 + 1] = p.y + rnd(-0.04, 0.04); this.pos[i * 3 + 2] = p.z + rnd(-0.04, 0.04);
      const s = speed * rnd(0.3, 1.2);
      this.vel[i * 3] = dir.x * s + rnd(-1, 1) * speed * 0.45; this.vel[i * 3 + 1] = dir.y * s + rnd(-0.2, 1.2) * speed * 0.4; this.vel[i * 3 + 2] = dir.z * s + rnd(-1, 1) * speed * 0.45;
      this.life[i] = rnd(0.35, 0.8); this.size[i] = rnd(0.008, 0.022);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.005) { this.pos[i * 3 + 1] = 0.005; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 2] *= 0.3; this.vel[i * 3 + 1] = 0; }
    }
    const g = this.pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.life.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}
// impact flash sprite
const flashMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,220,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })() });
const impact = new THREE.Sprite(flashMat); impact.visible = false; scene.add(impact);
let impactT = 0;

// ------------------------------------------------------------------ globals
const input = new Input();
const hud = new HUD();
const audio = new Audio();
let arena, particles, fighters = [], player, enemy, ai;

// ------------------------------------------------------------------ boot
async function boot() {
  const setP = (p, t) => { $('loadFill').style.width = (p * 100) + '%'; if (t) $('loadTxt').textContent = t; };
  setP(0.05, 'LOADING ARENA');
  await document.fonts.ready.catch(() => {});
  arena = buildArena(scene, renderer, quality);
  particles = new Particles(scene);
  setP(0.2, 'LOADING FIGHTERS');
  const assets = await loadFighterAssets((p) => setP(0.2 + p * 0.65));
  setP(0.9, 'WARMING UP');
  fighters = ROSTER.map((r) => {
    const model = buildFighter(assets, r.look);
    scene.add(model.root);
    const f = new Fighter(model, r);
    f.power = r.power; f.speed = r.speed; f.chin = r.chin;
    return f;
  });
  assignSides();
  fighters[0].place(-1.1, 0, Math.PI / 2); fighters[1].place(1.1, 0, -Math.PI / 2);
  // compile shaders up front to avoid hitches
  renderer.compile(scene, camera);
  setP(1, 'READY');
  setTimeout(() => { $('loading').classList.remove('show'); toMenu(); }, 250);
  requestAnimationFrame(loop);
}

function assignSides() {
  player = fighters[settings.fighter]; enemy = fighters[1 - settings.fighter];
  player.isPlayer = true; enemy.isPlayer = false;
  ai = new AIController(enemy, player, settings.diff);
  hud.setNames(player.info, enemy.info);
}

// ------------------------------------------------------------------ game state
const G = {
  state: 'loading', t: 0, round: 1, clock: 90, timeScale: 1, hitStop: 0, shake: 0, excite: 0.2,
  fighting: false, kd: null, cards: [], flash: 0, slowT: 0, introT: 0, betweenT: 0, combo: [0, 0], comboT: [0, 0],
  camMode: settings.cam, camPos: new V3(0, 3, 8), camLook: new V3(0, 1, 0), koCam: 0, roundStats: [],
};
input.camMode = G.camMode;

const game = {
  get fighting() { return G.fighting; },
  sfx(n, v) { audio.play(n, v); },
  onSwing(f, m) { if (G.state !== 'menu') audio.play('whoosh', m.kind === 'kick' ? 0.8 : 0.45); },
  resolveHit(att, def, m) { resolveHit(att, def, m); },
  onDown(f) { if (G.kd && G.kd.f === f) { G.kd.counting = true; G.kd.t = 0; G.kd.n = 0; audio.play('thud', 1); shake(0.05); } },
  onUp(f) { if (G.kd && G.kd.f === f) resumeAfterKD(); },
};

function side(f) { return f === player ? 0 : 1; }

function resolveHit(att, def, m) {
  if (!G.fighting || def.down) return;
  const dx = def.pos.x - att.pos.x, dz = def.pos.z - att.pos.z, dist = Math.hypot(dx, dz);
  const fwd = new V3(Math.sin(att.yaw), 0, Math.cos(att.yaw));
  const dirW = new V3(dx / dist, 0, dz / dist);
  const facing = fwd.dot(dirW);
  if (dist > m.reach + 0.03 || facing < 0.72) { // whiff
    if (att === player) ai.onPlayerWhiff();
    return;
  }
  // evasion
  if (def.isEvading && m.target === 'head' && (m.kind === 'punch' || m.id === 'highkick')) {
    hud.pop(side(def), 'SLIPPED', 'dim');
    if (def === enemy) ai.onDefended(m);
    audio.play('whoosh', 0.6);
    return;
  }
  const defFacing = new V3(Math.sin(def.yaw), 0, Math.cos(def.yaw)).dot(dirW) < -0.5;
  // block
  let blockF = 0;
  if (def.blockW > 0.55 && defFacing && m.target !== 'leg') {
    if (m.target === 'head') blockF = def.bodyW > 0.5 ? 0.55 : 1;
    else blockF = def.bodyW > 0.5 ? 1 : (m.kind === 'kick' ? 0.75 : 0.5);
  }
  const counter = def.state === 'attack' && def.vulnerablePhase;
  let dmg = 0.42 * m.dmg * (att.power || 1) * (0.6 + 0.4 * att.stamina / 100) * (def.chin || 1) * rnd(0.9, 1.1);
  if (att === enemy) dmg *= ai.L.dmg;
  if (counter) dmg *= 1.45;
  const dirC = def.worldToChar(new V3(dirW.x + def.pos.x, 0, dirW.z + def.pos.z), new V3()); // into def char space
  // contact point
  const cp = new V3();
  if (m.target === 'head') def.headPos(cp); else if (m.target === 'body') def.bodyPos(cp); else { def.bonePos('LeftLeg', cp); cp.y = 0.55; }
  cp.addScaledVector(dirW, -0.1);

  if (blockF >= 1 || (blockF > 0 && Math.random() < blockF)) {
    def.health = Math.max(1, def.health - dmg * 0.1);
    def.stamina = Math.max(0, def.stamina - dmg * 1.4);
    def.pushBack(dirW, 0.5 + m.power * 0.5);
    def.sp.cp.kick(1.5 * m.power); def.sp.hz.kick(-0.2 * m.power);
    audio.play('block', 0.6 + m.power * 0.4);
    hud.pop(side(def), 'BLOCKED', 'dim');
    if (def === enemy) ai.onDefended(m);
    G.hitStop = Math.max(G.hitStop, 0.03); shake(0.012);
    particles.burst(cp, dirW, 4, 1.0);
    if (def.stamina <= 0) { def.state = 'hit'; def.stateT = 0; def.stunT = 0.6; def.stamina = 15; hud.pop(side(def), 'GUARD BROKEN', 'red'); }
    return;
  }
  // ---- clean hit
  def.health -= dmg; def.maxHealth = Math.max(5, def.maxHealth - dmg * 0.45); def.lastHitT = 0;
  if (m.target === 'body') def.stamina = Math.max(0, def.stamina - (m.stamDmg ? m.stamDmg * 0.5 : dmg) * 2.0);
  if (m.target === 'leg') { def.legDmg = Math.min(0.85, def.legDmg + 0.07); def.stamina = Math.max(0, def.stamina - 4); }
  def.takeHit(m, dirC, dmg, game);
  // interrupt
  if (def.state === 'attack') { if (def.move.kind === 'kick') def.feet[def.move.leg].lock = false; def.move = null; }
  if (def.state !== 'rocked' || dmg > 8) {
    def.state = 'hit'; def.stateT = 0; def.stunT = 0.14 + dmg * 0.035;
  }
  const heavy = dmg >= 7 || m.id === 'highkick';
  if ((heavy && def.health < 40 && Math.random() < 0.6) || (def.health < 25 && dmg > 4 && Math.random() < 0.35)) {
    def.state = 'rocked'; def.stateT = 0; def.stunT = 0.9 + Math.random() * 0.7;
    hud.pop(side(att), 'HURT HIM!', 'red');
    audio.ooh(1); G.excite = Math.min(1, G.excite + 0.35);
  }
  def.pushBack(dirW, 0.6 + m.power * 0.9 + (m.push || 0) * 2.2);
  // stats
  att.stats.landed++; att.stats.roundLanded++; att.stats.dmgDealt += dmg; att.stats.roundDmg += dmg;
  if (m.base !== 'jab') att.stats.power++;
  // combo tracking
  const s = side(att);
  G.combo[s] = G.comboT[s] > 0 ? G.combo[s] + 1 : 1; G.comboT[s] = 1.1;
  if (G.combo[s] >= 2) hud.pop(s, `${G.combo[s]} HIT COMBO`, 'gold');
  if (counter) hud.pop(s, 'COUNTER!', 'red');
  if (m.id === 'highkick') hud.pop(s, 'HEAD KICK!', 'gold');
  // fx
  const pw = clamp(dmg / 6, 0.3, 1.8);
  G.hitStop = Math.max(G.hitStop, 0.035 + 0.045 * pw);
  shake(0.012 + 0.03 * pw);
  particles.burst(cp, dirW, 10 + (pw * 22 | 0), 1.4 + pw * 1.6);
  impact.position.copy(cp); impact.visible = true; impactT = 0.12; impact.scale.setScalar(0.25 + 0.3 * pw);
  if (m.kind === 'kick') audio.play('kick', 0.7 + pw * 0.4);
  else if (m.target === 'body') audio.play('body', 0.7 + pw * 0.3);
  else audio.play(heavy ? 'heavy' : 'hit', 0.6 + pw * 0.4);
  if (dmg > 4.5) { audio.ooh(0.5 + pw * 0.3); G.excite = Math.min(1, G.excite + 0.12 * pw); }
  grade.uniforms.uCA.value = Math.max(grade.uniforms.uCA.value, 0.004 * pw);
  if (def === player) G.flash = Math.max(G.flash, 0.06 * pw);
  // knockdown?
  const kdChance = def.health <= 0 || (m.id === 'highkick' && def.health < 20 && Math.random() < 0.5) || (counter && dmg > 6.5 && def.health < 15);
  if (kdChance) knockdown(def, att, m);
}

function shake(v) { G.shake = Math.max(G.shake, v); }

// ------------------------------------------------------------------ knockdowns
function knockdown(def, att, m) {
  def.health = Math.max(0, def.health);
  def.state = 'falling'; def.stateT = 0; def.fall = 0; def.fallDir = m.target === 'body' || m.target === 'leg' ? 1 : -1;
  def.move = null; def.feet.L.lock = def.feet.R.lock = false; def.queued = null;
  def.knockdowns++; att.stats.kd++;
  G.kd = { f: def, att, counting: false, n: 0, t: 0, need: 14 + def.knockdowns * 7, final: def.knockdowns >= 3, aiUpAt: 0 };
  // will the AI beat the count?
  if (def === enemy) {
    const lvl = settings.diff;
    const stayDown = def.knockdowns >= 3 || Math.random() < 0.08 + def.knockdowns * 0.18 - lvl * 0.06;
    G.kd.aiUpAt = stayDown ? 99 : Math.floor(rnd(3, 6 + def.knockdowns * 2));
  }
  G.fighting = false;
  G.state = 'kd';
  G.slowT = 1.3; G.koCam = 2.4;
  input.mash = 0;
  hud.callout(G.kd.final ? 'T.K.O.' : 'KNOCKDOWN', 'red', '', 1.6);
  audio.roar(1, 3.5); G.excite = 1;
  $('flash').style.transition = 'none'; $('flash').style.opacity = 0.35; requestAnimationFrame(() => { $('flash').style.transition = 'opacity 0.5s'; $('flash').style.opacity = 0; });
}

function updateKD(dt) {
  const kd = G.kd, f = kd.f;
  // attacker to the neutral corner
  const att = kd.att;
  const nc = f.pos.x * -1 > 0 ? new V3(2.2, 0, -2.2) : new V3(-2.2, 0, 2.2);
  const to = new V3(nc.x - att.pos.x, 0, nc.z - att.pos.z);
  att.intent.block = false; att.intent.body = false;
  if (to.length() > 0.3) {
    const fwd = new V3(f.pos.x - att.pos.x, 0, f.pos.z - att.pos.z).normalize();
    const right = new V3(-fwd.z, 0, fwd.x);
    to.normalize(); att.intent.my = to.dot(fwd) * 0.7; att.intent.mx = to.dot(right) * 0.7;
  } else { att.intent.my = 0; att.intent.mx = 0; }
  if (!kd.counting) return;
  kd.t += dt;
  const n = Math.min(10, Math.floor(kd.t / 1.0) + 1);
  if (n !== kd.n) { kd.n = n; audio.play('clap', 0.8); }
  if (kd.final) {
    hud.count(n, false);
    if (kd.t > 2.2) endFight(kd.att, 'T.K.O.');
    return;
  }
  const isP = f === player;
  const fill = isP ? input.mash / kd.need : 0;
  hud.count(n, isP, fill);
  if (isP && input.mash >= kd.need && f.state === 'down' && n >= 2) { f.state = 'getup'; f.stateT = 0; }
  if (!isP && n >= kd.aiUpAt && f.state === 'down') { f.state = 'getup'; f.stateT = 0; }
  if (kd.t >= 10.0 && f.state === 'down') { hud.count(10, false); endFight(kd.att, 'K.O.'); }
}

function resumeAfterKD() {
  const f = G.kd.f;
  f.health = Math.max(f.health, 42 - f.knockdowns * 10); f.maxHealth = Math.max(f.health, f.maxHealth * 0.85);
  f.stamina = Math.max(f.stamina, 55);
  hud.count(null);
  G.kd = null;
  G.state = 'pre'; G.preT = 0.9;
  hud.callout('FIGHT!', 'gold', '', 0.7);
  audio.play('bell', 1);
}

// ------------------------------------------------------------------ rounds
function newFight() {
  for (const f of fighters) { f.reset(); f.pivot.rotation.set(0, 0, 0); }
  assignSides();
  G.round = 1; G.cards = []; G.roundStats = []; G.result = null;
  G.excite = 0.3; G.combo = [0, 0];
  startIntro();
}
function placeForRound() {
  player.place(-1.25, 0, Math.PI / 2); enemy.place(1.25, 0, -Math.PI / 2);
  for (const f of fighters) { f.state = 'idle'; f.move = null; f.victory = false; f.fall = 0; f.dejected = false; }
}
function startIntro() {
  placeForRound();
  G.state = 'intro'; G.introT = 0; G.fighting = false;
  hud.show(false);
  showScreen('intro');
  const a = player.info, b = enemy.info;
  const row = (k, x, y) => `<div class="tot-row"><div class="a">${x}</div><div class="k">${k}</div><div class="b">${y}</div></div>`;
  $('tot').innerHTML = `<div class="tot-title">TALE OF THE TAPE</div>
    <div class="tot-head"><div class="fn l">${a.name}<small>${a.nick} · ${a.flag}</small></div><div class="vs">VS</div><div class="fn r">${b.name}<small>${b.nick} · ${b.flag}</small></div></div>
    ${row('RECORD', a.record, b.record)}${row('KO', a.ko, b.ko)}${row('AGE', a.age, b.age)}${row('HEIGHT', a.height, b.height)}${row('WEIGHT', a.weight, b.weight)}${row('REACH', a.reach, b.reach)}`;
  const tot = $('tot'); tot.style.animation = 'none'; void tot.offsetWidth; tot.style.animation = '';
  audio.setExcitement(0.6); audio.roar(0.6, 4);
}
function startRound() {
  hideScreens();
  placeForRound();
  for (const f of fighters) { f.stats.roundDmg = 0; f.stats.roundLanded = 0; f.stats.roundKD = f.knockdowns; }
  G.clock = ROUND_OPTS[settings.rounds].t;
  G.state = 'pre'; G.preT = 2.2; G.fighting = false;
  hud.show(true); hud.hint(true); setTimeout(() => hud.hint(false), 9000);
  hud.callout(`ROUND ${G.round}`, '', ROUND_OPTS[settings.rounds].r === G.round ? 'FINAL ROUND' : '', 1.3, true);
  setTimeout(() => { if (G.state === 'pre') { hud.callout('FIGHT!', 'gold', '', 0.7); audio.play('bell', 1); } }, 1400);
}
function endRound() {
  G.fighting = false; G.state = 'between'; G.betweenT = 8;
  audio.play('bell', 3);
  // score the round (10-point must)
  const dA = player.stats.roundDmg, dB = enemy.stats.roundDmg;
  const kdA = player.knockdowns - (player.stats.roundKD || 0), kdB = enemy.knockdowns - (enemy.stats.roundKD || 0);
  const judges = [0, 1, 2].map(() => {
    const a = dA * rnd(0.85, 1.15) + player.stats.roundLanded * 0.4, b = dB * rnd(0.85, 1.15) + enemy.stats.roundLanded * 0.4;
    let sa = 10, sb = 10;
    if (Math.abs(a - b) > 3) { if (a > b) sb -= 1; else sa -= 1; }
    sa -= kdA; sb -= kdB;
    if (sa === sb && a !== b && Math.abs(a - b) > 1) { if (a > b) sb--; else sa--; }
    return [Math.max(7, sa), Math.max(7, sb)];
  });
  G.cards.push(judges);
  const total = ROUND_OPTS[settings.rounds].r;
  const st = (f) => f.stats;
  const tr = (k, a, b, fmt = (x) => x) => `<tr><td class="${a > b ? 'win' : ''}">${fmt(a)}</td><td class="k">${k}</td><td class="${b > a ? 'win' : ''}">${fmt(b)}</td></tr>`;
  const acc = (s) => s.thrown ? Math.round(100 * s.landed / s.thrown) : 0;
  $('betweenPanel').innerHTML = `<h2 class="ph"><span>END OF ROUND ${G.round}</span><small>${G.round < total ? 'סוף סיבוב' : 'סוף הקרב'}</small></h2>
    <table class="stats"><tr><th class="a">${player.info.name}</th><th></th><th class="b">${enemy.info.name}</th></tr>
    ${tr('STRIKES LANDED', st(player).landed, st(enemy).landed)}${tr('STRIKES THROWN', st(player).thrown, st(enemy).thrown)}
    ${tr('ACCURACY', acc(st(player)), acc(st(enemy)), x => x + '%')}${tr('POWER SHOTS', st(player).power, st(enemy).power)}
    ${tr('KNOCKDOWNS', st(player).kd, st(enemy).kd)}${tr('HEALTH', Math.round(player.health), Math.round(enemy.health))}</table>
    <div class="next" dir="rtl"><span>${G.round < total ? 'הסיבוב הבא מתחיל בעוד' : 'הכרעת השופטים בעוד'} <b id="betweenN">8</b></span><span><kbd>Enter</kbd> המשך</span></div>`;
  showScreen('between'); hud.show(false);
}
function nextRound() {
  const total = ROUND_OPTS[settings.rounds].r;
  if (G.round >= total) { decision(); return; }
  G.round++;
  for (const f of fighters) { f.maxHealth = Math.min(100, f.maxHealth + 12); f.health = Math.min(f.maxHealth, f.health + (f.maxHealth - f.health) * 0.6); f.stamina = 100; f.legDmg *= 0.6; f.sweat = Math.min(0.8, f.sweat + 0.1); }
  startRound();
}
function decision() {
  const sums = [0, 1, 2].map(j => G.cards.reduce((acc, r) => [acc[0] + r[j][0], acc[1] + r[j][1]], [0, 0]));
  const votes = sums.map(s => s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1);
  const pa = votes.filter(v => v === 0).length, pb = votes.filter(v => v === 1).length;
  let winner = null, method;
  if (pa > pb) { winner = player; method = pa === 3 ? 'UNANIMOUS DECISION' : pb === 1 ? 'SPLIT DECISION' : 'MAJORITY DECISION'; }
  else if (pb > pa) { winner = enemy; method = pb === 3 ? 'UNANIMOUS DECISION' : pa === 1 ? 'SPLIT DECISION' : 'MAJORITY DECISION'; }
  else method = 'DRAW';
  endFight(winner, method, sums);
}
function endFight(winner, method, sums) {
  G.fighting = false; G.state = 'result'; G.resultT = 0;
  hud.count(null);
  audio.play('bell', 3); audio.roar(1, 5); G.excite = 1;
  const loser = winner === player ? enemy : player;
  if (winner) { winner.victory = true; winner.stateT = 0; winner.state = 'idle'; if (!loser.down) loser.dejected = true; }
  const timeStr = (() => { const t = ROUND_OPTS[settings.rounds].t - Math.max(0, G.clock); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; })();
  const methodLine = sums ? method : `${method} · ROUND ${G.round} · ${timeStr}`;
  const youWon = winner === player;
  const heb = !winner ? 'תיקו! קרב צמוד עד הסוף.' : youWon ? 'ניצחת! אלוף.' : 'הפסדת הפעם. קום ותנסה שוב.';
  const cards = sums ? `<div class="cards">${sums.map((s, i) => `<div><small>JUDGE ${String.fromCharCode(65 + i)}</small>${s[0]} – ${s[1]}</div>`).join('')}</div>` : '';
  setTimeout(() => {
    if (G.state !== 'result') return;
    $('resultPanel').innerHTML = `<div class="lbl">${winner ? 'WINNER' : 'RESULT'}</div>
      <div class="big">${winner ? winner.info.name : 'DRAW'}</div>
      <div class="method">${methodLine}</div>
      <div class="heb" dir="rtl">${heb}</div>${cards}
      <div class="btn-row" dir="rtl"><button class="btn on" data-res="rematch">קרב חוזר</button><button class="btn alt" data-res="menu">תפריט ראשי</button></div>`;
    showScreen('result'); hud.show(false);
    resultSel = 0;
    $('resultPanel').querySelectorAll('[data-res]').forEach((b, i) => b.addEventListener('click', () => { resultSel = i; resultAction(); }));
  }, winner && !sums ? 3200 : 1800);
  hud.callout(sums ? 'DECISION' : method, sums ? 'gold' : 'red', '', 2.2);
}
let resultSel = 0;
function resultAction() {
  audio.play('uiok');
  if (resultSel === 0) newFight(); else toMenu();
}

// ------------------------------------------------------------------ screens / menu
function hideScreens() { document.querySelectorAll('.screen').forEach(s => s.classList.remove('show')); }
function showScreen(id) { hideScreens(); $(id).classList.add('show'); }
let menuSel = 0, pauseSel = 0, controlsFrom = 'menu';
function toMenu() {
  G.state = 'menu'; G.fighting = false; hud.show(false); hud.count(null); hud.clearCallout();
  for (const f of fighters) { f.reset(); }
  assignSides();
  fighters[0].place(-1.0, 0, Math.PI / 2); fighters[1].place(1.0, 0, -Math.PI / 2);
  showScreen('menu'); refreshMenu();
  audio.setExcitement(0.25);
}
function refreshMenu() {
  const items = [...document.querySelectorAll('#menuList li')];
  items.forEach((li, i) => li.classList.toggle('on', i === menuSel));
  $('mFighter').textContent = ROSTER[settings.fighter].name;
  $('mDiff').textContent = AI_LEVELS[settings.diff].name;
  $('mRounds').textContent = ROUND_OPTS[settings.rounds].label;
  $('mSound').textContent = settings.sound ? 'ON' : 'OFF';
  const r = ROSTER[settings.fighter];
  const rate = (n) => `<span class="rating">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</span>`;
  $('tape').innerHTML = `<div class="tt-h">YOUR FIGHTER</div>
    <div class="tt-name">${r.name}<span class="tt-flag">${r.flag}</span></div><div class="tt-nick">${r.nick} · ${r.record} (${r.ko} KO) · ${r.weight}</div>
    <div class="tt-rates">${Object.entries(r.ratings).map(([k, v]) => `<div><small>${k}</small>${rate(v)}</div>`).join('')}</div>`;
}
function menuAction(act, dir = 0) {
  const step = dir || 1;
  if (act === 'fight') { audio.play('uiok'); newFight(); return; }
  if (act === 'fighter') { settings.fighter = (settings.fighter + 1) % ROSTER.length; assignSides(); }
  if (act === 'diff') settings.diff = (settings.diff + step + AI_LEVELS.length) % AI_LEVELS.length;
  if (act === 'rounds') settings.rounds = (settings.rounds + step + ROUND_OPTS.length) % ROUND_OPTS.length;
  if (act === 'sound') { settings.sound = !settings.sound; audio.enabled = settings.sound; if (audio.master) audio.master.gain.value = settings.sound ? 0.9 : 0; }
  if (act === 'controls') { controlsFrom = 'menu'; showScreen('controls'); G.state = 'controls'; }
  audio.play('ui'); save(); refreshMenu();
}
document.querySelectorAll('#menuList li').forEach((li, i) => {
  li.addEventListener('mouseenter', () => { menuSel = i; refreshMenu(); });
  li.addEventListener('click', () => { audio.init(); menuSel = i; menuAction(li.dataset.act); });
});
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => backFromControls()));
function backFromControls() { if (controlsFrom === 'pause') { G.state = 'paused'; showScreen('pause'); } else toMenu(); }
document.querySelectorAll('#pauseList li').forEach((li, i) => {
  li.addEventListener('mouseenter', () => { pauseSel = i; refreshPause(); });
  li.addEventListener('click', () => { pauseSel = i; pauseAction(); });
});
function refreshPause() { document.querySelectorAll('#pauseList li').forEach((li, i) => li.classList.toggle('on', i === pauseSel)); }
function pause() { G.prevState = G.state; G.state = 'paused'; pauseSel = 0; refreshPause(); showScreen('pause'); }
function pauseAction() {
  const act = document.querySelectorAll('#pauseList li')[pauseSel].dataset.act;
  audio.play('uiok');
  if (act === 'resume') { hideScreens(); G.state = G.prevState; }
  if (act === 'restart') newFight();
  if (act === 'controls') { controlsFrom = 'pause'; showScreen('controls'); G.state = 'controls'; }
  if (act === 'menu') toMenu();
}
window.addEventListener('pointerdown', () => audio.init(), { once: false });
$('intro').addEventListener('click', () => { if (G.state === 'intro') G.introT = 99; });
$('between').addEventListener('click', () => { if (G.state === 'between') G.betweenT = 0; });
window.addEventListener('keydown', () => audio.init());

function handleUI() {
  const ev = input.takeEvents();
  for (const e of ev) {
    const ok = e === 'Enter' || e === 'NumpadEnter' || e === 'GPA';
    if (G.state === 'menu') {
      const items = [...document.querySelectorAll('#menuList li')];
      if (e === 'ArrowUp' || e === 'KeyW') { menuSel = (menuSel + items.length - 1) % items.length; audio.play('ui'); refreshMenu(); }
      if (e === 'ArrowDown' || e === 'KeyS') { menuSel = (menuSel + 1) % items.length; audio.play('ui'); refreshMenu(); }
      const act = items[menuSel].dataset.act;
      if ((e === 'ArrowLeft' || e === 'ArrowRight') && act !== 'fight' && act !== 'controls') menuAction(act, e === 'ArrowLeft' ? -1 : 1);
      if (ok || e === 'Space') menuAction(act);
    } else if (G.state === 'controls') {
      if (ok || e === 'Escape' || e === 'GPB' || e === 'Backspace') backFromControls();
    } else if (G.state === 'paused') {
      const n = document.querySelectorAll('#pauseList li').length;
      if (e === 'ArrowUp' || e === 'KeyW') { pauseSel = (pauseSel + n - 1) % n; refreshPause(); audio.play('ui'); }
      if (e === 'ArrowDown' || e === 'KeyS') { pauseSel = (pauseSel + 1) % n; refreshPause(); audio.play('ui'); }
      if (ok) pauseAction();
      if (e === 'Escape' || e === 'GPB') { hideScreens(); G.state = G.prevState; }
    } else if (G.state === 'intro') {
      if (ok || e === 'Space' || e === 'Escape') { G.introT = 99; }
    } else if (G.state === 'between') {
      if (ok) G.betweenT = 0;
    } else if (G.state === 'result') {
      if (e === 'ArrowLeft' || e === 'ArrowRight' || e === 'ArrowUp' || e === 'ArrowDown') {
        resultSel = 1 - resultSel; audio.play('ui');
        $('resultPanel').querySelectorAll('[data-res]').forEach((b, i) => { b.classList.toggle('on', i === resultSel); b.classList.toggle('alt', i !== resultSel); });
      }
      if (ok && $('result').classList.contains('show')) resultAction();
    } else if (G.state === 'fight' || G.state === 'pre' || G.state === 'kd') {
      if (e === 'Escape') pause();
      if (e === 'KeyC') { G.camMode = G.camMode === 'side' ? 'close' : 'side'; input.camMode = G.camMode; settings.cam = G.camMode; save(); }
      if (e === 'KeyM') menuAction('sound');
    }
  }
}

// ------------------------------------------------------------------ camera director
const _a = new V3(), _b = new V3(), _c = new V3();
const _occT = [new V3(), new V3(), new V3(), new V3(), new V3()];
function updateCamera(dt, t) {
  let pos = _a, look = _b, fov = 38;
  const p1 = player.pos, p2 = enemy.pos;
  const mid = _c.copy(p1).add(p2).multiplyScalar(0.5);
  if (G.state === 'menu' || G.state === 'controls' || G.state === 'loading') {
    const a = 0.32 + Math.sin(t * 0.09) * 0.26;
    pos.set(Math.sin(a) * 5.0, 1.55 + Math.sin(t * 0.13) * 0.12, Math.cos(a) * 5.0);
    look.set(0, 1.2, 0); fov = 34;
    // keep the composition on the left half (menu on the right)
    const right = new V3().subVectors(look, pos).cross(new V3(0, 1, 0)).normalize();
    look.addScaledVector(right, 1.05); look.y = 1.05;
  } else if (G.state === 'intro') {
    const k = clamp(G.introT / 7, 0, 1);
    const a = -1.2 + k * 1.9;
    const r = 7.5 - k * 3.2;
    pos.set(Math.sin(a) * r, 3.8 - k * 2.2, Math.cos(a) * r);
    look.set(mid.x, 1.25, mid.z); fov = 34;
  } else if (G.state === 'result') {
    const w = player.victory ? player : enemy.victory ? enemy : null;
    const c = w ? w.pos : mid;
    const a = t * 0.18;
    pos.set(c.x + Math.sin(a) * 3.0, 1.6, c.z + Math.cos(a) * 3.0);
    look.set(c.x, 1.35, c.z); fov = 34;
  } else if (G.state === 'between') {
    pos.set(0, 4.5, 7.5); look.set(0, 0.8, 0); fov = 36;
  } else {
    const axis = new V3().subVectors(p2, p1); axis.y = 0;
    const sep = axis.length(); axis.normalize();
    const f = new V3(axis.z, 0, -axis.x);
    if (G.camMode === 'side') {
      const d = clamp(2.3 + sep * 1.05, 3.1, 5.4);
      pos.copy(mid).addScaledVector(f, -d).addScaledVector(axis, -d * 0.2); pos.y = 1.62;
      look.set(mid.x, 1.18, mid.z).addScaledVector(axis, 0.0);
      fov = 40;
    } else {
      pos.copy(p1).addScaledVector(axis, -1.35).addScaledVector(f, -0.5); pos.y = 1.78;
      look.copy(p2).addScaledVector(f, 0.15); look.y = 1.3;
      fov = 52;
    }
    // KO cam
    if (G.koCam > 0 && G.kd) {
      const df = G.kd.f;
      const k = Math.min(1, G.koCam / 0.5);
      const kp = new V3().copy(df.pos).addScaledVector(f, -2.3).addScaledVector(axis, 0.5); kp.y = 0.75;
      pos.lerp(kp, k); look.lerp(new V3(df.pos.x, 0.65, df.pos.z), k); fov = 40 - 6 * k;
    }
  }
  // keep the camera out of the ring posts / inside the arena
  const k = 1 - Math.exp(-(G.state === 'fight' || G.state === 'pre' ? 5 : 2.2) * dt);
  G.camPos.lerp(pos, k); G.camLook.lerp(look, Math.min(1, k * 1.4));
  // never let the camera end up inside the stands, the barrier walls or a corner post
  const cp = G.camPos, LIM = 5.5;
  cp.x = clamp(cp.x, -LIM, LIM); cp.z = clamp(cp.z, -LIM, LIM); cp.y = Math.max(cp.y, 0.35);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const dx = cp.x - sx * 3.16, dz = cp.z - sz * 3.16, d = Math.hypot(dx, dz);
    if (d < 0.75 && cp.y < 1.9) { const k = 0.75 / (d || 0.001); cp.x = sx * 3.16 + dx * k; cp.z = sz * 3.16 + dz * k; }
  }
  // never inside a fighter
  for (const f of fighters) {
    const dx = cp.x - f.pos.x, dz = cp.z - f.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.55 && cp.y < 2.1) { const k = 0.55 / (d || 0.001); cp.x = f.pos.x + dx * k; cp.z = f.pos.z + dz * k; }
  }
  camera.position.copy(cp); camera.lookAt(G.camLook);
  // hide any arena object that blocks the view of the fighters
  _occT[0].copy(G.camLook); player.headPos(_occT[1]); enemy.headPos(_occT[2]); player.bodyPos(_occT[3]); enemy.bodyPos(_occT[4]);
  arena.clearView(camera.position, _occT);
  if (G.shake > 0.0005) {
    camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake; camera.position.z += (Math.random() - 0.5) * G.shake;
    camera.rotateZ((Math.random() - 0.5) * G.shake * 0.6);
    G.shake *= Math.exp(-dt * 9);
  }
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  arena.fadeRopes(camera.position, G.state === 'menu' ? 1 : dt);
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), T = 0;
let paused = false;
function loop(now) {
  requestAnimationFrame(loop);
  const dtR = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.state === 'loading' || paused) return;
  tick(dtR, true);
}
function tick(dtR, render) {
  T += dtR;
  handleUI();
  // time scaling
  let ts = 1;
  if (G.slowT > 0) { G.slowT -= dtR; ts = 0.28; }
  if (G.state === 'paused' || (G.state === 'controls' && controlsFrom === 'pause')) ts = 0;
  let dt = dtR * ts;
  if (G.hitStop > 0) { G.hitStop -= dtR; dt *= 0.05; }

  if (G.state === 'menu' || G.state === 'controls' && controlsFrom === 'menu') {
    // shadow boxing in the menu
    for (const f of fighters) {
      const it = f.intent; it.mx = 0; it.my = (f.dist > 2.3 ? 0.3 : f.dist < 1.9 ? -0.3 : 0); it.block = false;
      if (f.state === 'idle' && Math.random() < dt * 0.9) it.attack = ['jab', 'cross', 'hook', 'jab', 'uppercut', 'lowkick', 'teep'][(Math.random() * 7) | 0];
      if (Math.random() < dt * 0.3) it.slip = true;
    }
    stepFighters(dt);
  } else if (G.state === 'intro') {
    G.introT += dtR;
    for (const f of fighters) { f.intent.mx = 0; f.intent.my = 0; }
    stepFighters(dt);
    if (G.introT > 7.5) startRound();
  } else if (G.state === 'pre') {
    G.preT -= dtR;
    for (const f of fighters) { f.intent.mx = 0; f.intent.my = 0; f.intent.block = false; }
    stepFighters(dt);
    if (G.preT <= 0) { G.state = 'fight'; G.fighting = true; }
  } else if (G.state === 'fight') {
    if (G.autoPlayer) { (G.autoAI ||= new AIController(player, enemy, 2)).update(dt, game); } else input.fill(player.intent);
    if (!G.aiOff) ai.update(dt, game); else { enemy.intent.mx = enemy.intent.my = 0; enemy.intent.block = !!G.aiBlock; }
    stepFighters(dt);
    G.clock -= dt;
    for (let s = 0; s < 2; s++) if (G.comboT[s] > 0) G.comboT[s] -= dt;
    if (G.clock <= 0 && G.state === 'fight') endRound();
    // tension -> crowd
    const close = Math.max(0, 1 - Math.min(player.health, enemy.health) / 100);
    G.excite = Math.max(0.25 + close * 0.45, G.excite - dtR * 0.12);
  } else if (G.state === 'kd') {
    if (G.koCam > 0) G.koCam -= dtR;
    if (G.kd && G.kd.f === player) { if (G.autoPlayer) input.mash += 0.2; else input.fill(player.intent); }
    input.pressed.length = 0;
    stepFighters(dt);
    if (G.kd) updateKD(dtR);
    G.excite = Math.max(0.7, G.excite - dtR * 0.05);
  } else if (G.state === 'between') {
    G.betweenT -= dtR;
    const n = $('betweenN'); if (n) n.textContent = Math.max(0, Math.ceil(G.betweenT));
    for (const f of fighters) { f.intent.mx = 0; f.intent.my = 0; }
    stepFighters(dt);
    if (G.betweenT <= 0) nextRound();
    G.excite = Math.max(0.3, G.excite - dtR * 0.2);
  } else if (G.state === 'result') {
    for (const f of fighters) { f.intent.mx = 0; f.intent.my = 0; f.intent.block = false; f.intent.attack = null; }
    stepFighters(dt);
    G.excite = Math.max(0.5, G.excite - dtR * 0.05);
  } else if (G.state === 'paused' || G.state === 'controls') {
    // frozen
  }
  if (G.state !== 'fight') input.clearFrame();

  // fx
  particles.update(dt);
  if (impactT > 0) { impactT -= dtR; impact.material.opacity = Math.max(0, impactT / 0.12); impact.scale.multiplyScalar(1 + dtR * 6); } else impact.visible = false;
  grade.uniforms.uCA.value *= Math.exp(-dtR * 6);
  const lowHp = G.state === 'fight' ? clamp((30 - player.health) / 30, 0, 1) : 0;
  grade.uniforms.uRed.value += ((lowHp * (0.55 + 0.25 * Math.sin(T * 6))) - grade.uniforms.uRed.value) * Math.min(1, dtR * 4);
  grade.uniforms.uDesat.value += ((G.state === 'kd' && G.kd && G.kd.f === player ? 0.6 : G.slowT > 0 ? 0.35 : 0) - grade.uniforms.uDesat.value) * Math.min(1, dtR * 3);
  if (G.flash > 0) { $('flash').style.opacity = G.flash; G.flash = Math.max(0, G.flash - dtR * 0.6); if (G.flash === 0) $('flash').style.opacity = 0; }
  arena.setExcitement(G.excite); audio.setExcitement(G.excite);
  arena.update(dtR, T);
  updateCamera(dtR, T);
  if (hud.el.classList.contains('show')) hud.update(dtR, player, enemy, G.round, G.clock);
  if (render) { if (DIRECT) renderer.render(scene, camera); else composer.render(dtR); }
}

function stepFighters(dt) {
  if (dt <= 0) return;
  const [a, b] = fighters;
  a.think(dt, b, game); b.think(dt, a, game);
  a.update(dt, b, game); b.update(dt, a, game);
  // separation
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 0.001;
  const minD = (a.down || b.down) ? 0.9 : 0.7;
  if (d < minD) {
    const push = (minD - d) / 2, nx = dx / d, nz = dz / d;
    if (!a.down) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
    if (!b.down) { b.pos.x += nx * push; b.pos.z += nz * push; }
  }
  // ring bounds + rope bounce
  const lim = RING.half - 0.36;
  for (const f of fighters) {
    let hit = false;
    for (const k of ['x', 'z']) {
      if (f.pos[k] > lim) { f.pos[k] = lim; hit = f.vel[k] > 0.4; if (f.vel[k] > 0) f.vel[k] *= -0.3; }
      if (f.pos[k] < -lim) { f.pos[k] = -lim; hit = f.vel[k] < -0.4; if (f.vel[k] < 0) f.vel[k] *= -0.3; }
    }
    if (hit) arena.ropeImpulse(new V3(f.pos.x * 1.1, 1, f.pos.z * 1.1), 0.25);
  }
}

boot().catch((e) => { console.error(e); $('loadTxt').textContent = 'ERROR: ' + e.message; });
window.__G = G;
// test hooks: advance the simulation without rendering
window.__sim = (sec, keys) => { paused = true; const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (keys && keys[i]) for (const k of keys[i]) { if (k.startsWith('+')) input.down.add(k.slice(1)); else if (k.startsWith('-')) input.down.delete(k.slice(1)); else { input.events.push(k); const A = { KeyJ: 'jab', KeyK: 'cross', KeyL: 'hook', KeyI: 'uppercut', KeyU: 'lowkick', KeyO: 'bodykick', KeyP: 'highkick', KeyH: 'teep' }; if (A[k]) input.pressed.push(A[k]); } } tick(1 / 60, false); } if (DIRECT) renderer.render(scene, camera); else composer.render(0.016); };
window.__resume = () => { paused = false; last = performance.now(); }; window.__game = { get player() { return player; }, get enemy() { return enemy; }, newFight, startRound, G };
