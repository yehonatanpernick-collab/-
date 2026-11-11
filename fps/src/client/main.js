// Boot: settings -> renderer -> procedural assets -> world -> menu. Starts offline matches
// (in-page authoritative Sim + AI) or joins a dedicated server over WebSocket.
import { Gfx } from './gfx.js';
import { generateTexturesAsync, spriteTextures, macroTexture } from './textures.js';
import { generateWorld } from '../shared/world.js';
import { WorldView } from './worldview.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { UI, loadSettings, saveSettings } from './ui.js';
import { LocalNet, WSNet } from './net.js';

const SEED = 1337;
const settings = loadSettings();
const audio = new AudioEngine();
audio.volume = settings.volume;
let game = null, net = null, gfx = null, env = null;

const ui = new UI(settings, {
  audio,
  play: () => startLocal(),
  online: () => startOnline(),
  spawn: (at, cls) => { if (game) game.requestSpawn(at, cls); },
  quality: (q) => { if (gfx) { gfx.setQuality(q); } ui.menuMsg('Some quality changes (grass, terrain detail) apply on reload.'); },
  renderScale: (v) => { if (gfx) { gfx.renderScale = v; gfx.resize(); } },
  volume: (v) => audio.setVolume(v),
  resume: () => { if (game && !game.input.isTouch) game.input.lock(); },
  redeploy: () => { if (game) { game.net.send({ t: 'suicide' }); } },
  quit: () => quitToMenu(),
});

async function boot() {
  const canvas = document.getElementById('c');
  ui.loading(0.02, 'Initializing renderer');
  gfx = new Gfx(canvas, settings.quality);
  gfx.renderScale = settings.renderScale;
  gfx.resize();
  const Q = gfx.Q;
  await frame();
  ui.loading(0.05, 'Generating materials');
  const tex = await generateTexturesAsync(Q.tex, Math.min(Q.aniso, gfx.renderer.capabilities.getMaxAnisotropy()), (p, n) => ui.loading(0.05 + p * 0.45, 'Generating materials · ' + n));
  const sprites = spriteTextures();
  const macro = macroTexture(256);
  ui.loading(0.52, 'Building terrain & town');
  await frame();
  const W = generateWorld(SEED);
  W.boxes.forEach((b) => { b.initActive = b.active; });
  ui.loading(0.66, 'Raising buildings');
  await frame();
  const wv = new WorldView(gfx, W, tex, macro, sprites);
  ui.loading(0.82, 'Lighting the battlefield');
  await frame();
  gfx.buildEnvironment();
  const effects = new Effects(gfx, W, sprites, tex, Q);
  const hud = new Hud(W);
  hud.show(false);
  const input = new Input(canvas);
  input.showTouch(false);
  input.onUnlock = () => { if (game && (game.mode === 'play' || game.mode === 'tank') && !input.isTouch) ui.showPause(); };
  env = { gfx, W, wv, effects, hud, input, ui, settings, sprites, macro, tex, audio };
  ui.loading(0.95, 'Compiling shaders');
  await frame();
  // warm-up render to compile shaders
  gfx.camera.position.set(0, 60, 200); gfx.camera.lookAt(0, 0, 0);
  gfx.renderer.compile(gfx.scene, gfx.camera);
  gfx.render(0.016);
  ui.loading(1, 'Ready');
  await frame();
  ui.hideLoading();
  ui.showMenu(true);
  probeServer();
  last = performance.now();
  requestAnimationFrame(loop);
  addEventListener('pointerdown', () => audio.init(), { once: true });
  addEventListener('keydown', () => audio.init(), { once: true });
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function serverUrl() {
  if (settings.server) { const s = settings.server.trim(); return s.startsWith('ws') ? s : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${s.replace(/^https?:\/\//, '')}/ws`; }
  if (location.protocol === 'file:' || !location.host) return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
async function probeServer() {
  const url = serverUrl();
  const sub = document.getElementById('mOnlineSub');
  if (!url) { sub.textContent = 'Run `node server.js` and open its address'; return; }
  try {
    const r = await fetch((url.replace(/^ws/, 'http').replace(/\/ws$/, '')) + '/api/status', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); sub.textContent = `${j.name} · ${j.humans} online · ${j.players}/${j.max} soldiers`; return; }
  } catch (e) { /* no server */ }
  sub.textContent = 'No server here · run `node server.js` to host one';
}

function makeGame() {
  if (game) return game;
  game = new Game(env);
  window.IH = { game, env, net };
  return game;
}
async function startLocal() {
  ui.menuMsg('Starting match…');
  audio.init();
  const { Sim } = await import('../shared/sim.js');
  const sim = new Sim({ seed: SEED, bots: settings.bots, skill: settings.skill });
  for (let i = 0; i < 40; i++) sim.tick(); // let bots deploy & spread out
  net = new LocalNet(sim);
  makeGame();
  game.connect(net);
  ui.showMenu(false); ui.menuMsg('');
}
async function startOnline() {
  const url = serverUrl();
  if (!url) { ui.menuMsg('Multiplayer needs the dedicated server: run <code>node server.js</code> in the fps folder and open the address it prints. Set a custom server in SETTINGS.'); return; }
  ui.menuMsg('Connecting to ' + url + ' …');
  audio.init();
  const n = new WSNet(url);
  try { await n.connect(); } catch (e) { ui.menuMsg('Could not connect to ' + url + ' (' + e.message + ').'); return; }
  net = n;
  makeGame();
  n.onClose = () => { quitToMenu(); ui.menuMsg('Disconnected from server.'); };
  game.connect(net);
  ui.showMenu(false); ui.menuMsg('');
}
function quitToMenu() {
  if (net) { net.close(); net = null; }
  if (game) {
    // tear down entity views
    for (const rp of game.rps.values()) if (rp.soldier) gfx.scene.remove(rp.soldier.root);
    for (const rv of game.vehs.values()) if (rv.view) gfx.scene.remove(rv.view.root);
    for (const pj of game.projs.values()) gfx.scene.remove(pj.mesh);
    for (const v of game.entViews.values()) gfx.scene.remove(v);
    for (const l of game.tankLoops.values()) l.stop();
    if (game.engineLoop) game.engineLoop.stop();
    if (game.me.vm) gfx.vmScene.remove(game.me.vm.root);
    const W = env.W;
    for (const b of W.boxes) b.active = b.initActive;
    for (const P of W.panels) { P.alive = true; P.hp = P.maxHp; }
    for (const B of W.buildings) B.collapsed = false;
    env.wv.collapsing = []; env.wv.syncAll(); env.effects.clearDecals();
    game = null;
  }
  env.input.unlock(); env.input.showTouch(false);
  env.hud.show(false);
  ui.closeDeploy(); ui.hideEnd(); ui.hidePause();
  ui.showMenu(true);
  saveSettings(settings);
}

let last = 0, menuT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  let dt = (t - last) / 1000; last = t;
  if (!(dt > 0)) dt = 0.016;
  dt = Math.min(dt, 0.05);
  if (net) net.tick(dt);
  if (game) {
    game.update(dt);
  } else {
    menuT += dt * 0.04;
    const cam = gfx.camera;
    cam.position.set(Math.sin(menuT) * 230, 70 + Math.sin(menuT * 1.7) * 12, Math.cos(menuT) * 230);
    cam.lookAt(0, 18, 0); cam.fov = 55; cam.updateProjectionMatrix();
    env.wv.update(dt, cam.position);
    env.effects.update(dt, cam);
    gfx.updateShadow(cam.position.clone().multiplyScalar(0.6));
    audio.updateAmbience(dt, 0.5);
  }
  gfx.render(dt);
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.querySelector('.ltxt').textContent = 'Failed to start: ' + e.message + ' (WebGL2 required)';
});
