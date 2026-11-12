// Entry point: boot the engine, load assets behind a loading screen, then hand over to the UI.
import './styles.css';
import { buildKestrel } from '@shared/world/maps/kestrel';
import { F_BULLET, makeRayHit } from '@shared/world/World';
import { AudioEngine } from './audio/audio';
import { Assets } from './core/assets';
import { Engine } from './core/engine';
import { Input } from './core/input';
import { Store } from './core/settings';
import { Game } from './game/game';
import { UiApp } from './ui/app';
import { h } from './ui/dom';

async function boot(): Promise<void> {
  const ui = document.getElementById('ui') as HTMLElement;
  const bar = h('i');
  const text = h('div', { class: 'load-text', text: 'INITIALISING' });
  const loading = h('div', { class: 'loading' }, h('div', { class: 'logo' }, h('span', { text: 'OPERATION' }), h('b', { text: 'FRONTLINE' })), h('div', { class: 'load-bar' }, bar), text);
  ui.append(loading);

  const store = new Store();
  const params = new URLSearchParams(location.search);
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') store.settings.quality = q;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = await Engine.create(canvas, store.settings);
  const assets = new Assets(engine);
  assets.onProgress = (f) => { bar.style.width = `${Math.round(f * 100)}%`; text.textContent = `LOADING ASSETS ${Math.round(f * 100)}%`; };
  await assets.loadGameAssets();
  text.textContent = 'BUILDING BATTLEFIELD';
  let envIndex = Number(params.get('env') ?? 0);
  await engine.setEnvironment(envIndex, assets.loadTexture);
  const map = buildKestrel();
  const input = new Input(canvas, store);
  const audio = new AudioEngine();
  const game = new Game(engine, assets, store, input, audio, map);
  const hit = makeRayHit();
  audio.occluded = (x, y, z) => { const c = engine.camera.getPosition(); return map.world.lineBlocked(c.x, c.y, c.z, x, y, z, F_BULLET, hit); };
  const app = new UiApp(ui, store, engine, input, audio, game, map);
  app.onEnvironment = async (i) => { if (i !== envIndex) { envIndex = i; await engine.setEnvironment(i, assets.loadTexture); } };

  let t = 0;
  engine.app.on('update', (dt: number) => {
    engine.tick(dt);
    if (game.active) { game.update(dt); app.update(dt); }
    else {
      // menu backdrop: slow orbit over the map
      t += dt;
      const a = t * 0.04;
      engine.camera.setPosition(Math.sin(a) * 52, 26, Math.cos(a) * 52);
      engine.camera.lookAt(0, 3, 0);
      game.world.update(dt, 0, 0);
      game.effects.update(dt, engine.camera.getPosition());
    }
  });
  window.addEventListener('pointerdown', () => { void audio.resume().then(() => { if (!game.active) audio.music(true); }); }, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) input.releaseAll(); });
  loading.remove();
  const w = window as unknown as Record<string, unknown>;
  w.__engine = engine; w.__game = game; w.__input = input; w.__app = app; w.__ready = true;
  const auto = params.get('auto');
  if (auto === 'training') void app.startTraining({ botDifficulty: 1, friendlyBots: 7, enemyBots: 8, warmup: 1, tickets: 150, vehicles: true });
  else if (auto === 'online') void app.startOnline({ mode: 'quick' });
}

boot().catch((e) => {
  console.error('BOOT FAILED', e);
  (window as unknown as Record<string, unknown>).__error = String(e?.stack ?? e);
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="loading"><div class="logo"><span>OPERATION</span><b>FRONTLINE</b></div><div class="load-text">FAILED TO START — ${String(e?.message ?? e).slice(0, 200)}<br>This game needs a browser with WebGL 2 or WebGPU.</div></div>`;
});
