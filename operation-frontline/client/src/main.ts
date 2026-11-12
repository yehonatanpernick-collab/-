import './styles.css';
import { buildKestrel } from '@shared/world/maps/kestrel';
import * as pc from 'playcanvas';
import { AudioEngine } from './audio/audio';
import { Assets } from './core/assets';
import { Engine } from './core/engine';
import { Input } from './core/input';
import { Store } from './core/settings';
import { Game } from './game/game';
import { LocalSession } from './net/session';

async function boot(): Promise<void> {
  const store = new Store();
  const params = new URLSearchParams(location.search);
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') store.settings.quality = q;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = await Engine.create(canvas, store.settings);
  const assets = new Assets(engine);
  await assets.loadGameAssets();
  await engine.setEnvironment(Number(params.get('env') ?? 0), assets.loadTexture);
  const map = buildKestrel();
  const input = new Input(canvas, store);
  const audio = new AudioEngine();
  const game = new Game(engine, assets, store, input, audio, map);
  const session = new LocalSession({ warmup: 1, botDifficulty: 1, seed: 3 }, map, 'Tester', store.loadout, 10);
  game.start(session);
  let deployed = false;
  engine.app.on('update', (dt: number) => {
    engine.tick(dt);
    game.update(dt);
    if (!game.view.alive && game.view.phase === 'live' && !deployed) { game.deploy(-1); deployed = true; }
    if (game.view.alive) deployed = false;
  });
  const w = window as unknown as Record<string, unknown>;
  w.__engine = engine; w.__game = game; w.__input = input; w.pc = pc; w.__ready = true;
}
boot().catch((e) => { console.error('BOOT FAILED', e); (window as unknown as Record<string, unknown>).__error = String(e?.stack ?? e); });
