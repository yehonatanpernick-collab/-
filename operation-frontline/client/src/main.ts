import './styles.css';
import { buildKestrel } from '@shared/world/maps/kestrel';
import * as pc from 'playcanvas';
import { Assets } from './core/assets';
import { Engine } from './core/engine';
import { Store } from './core/settings';
import { WorldView } from './render/world';

async function boot(): Promise<void> {
  const store = new Store();
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') store.settings.quality = q;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = await Engine.create(canvas, store.settings);
  const assets = new Assets(engine);
  await assets.loadGameAssets();
  const params = new URLSearchParams(location.search);
  await engine.setEnvironment(Number(params.get('env') ?? 0), assets.loadTexture);
  const map = buildKestrel();
  const world = new WorldView(engine, assets, map);
  const cam = (params.get('cam') ?? '-30,14,30,-35,-20').split(',').map(Number);
  engine.camera.setPosition(cam[0], cam[1], cam[2]);
  engine.camera.setEulerAngles(cam[4] ?? -20, cam[3] ?? 0, 0);
  engine.app.on('update', (dt: number) => { engine.tick(dt); world.update(dt, cam[0], cam[2]); });
  (window as unknown as Record<string, unknown>).__engine = engine;
  (window as unknown as Record<string, unknown>).__world = world;
  (window as unknown as Record<string, unknown>).__ready = true;
  (window as unknown as Record<string, unknown>).__info = { webgpu: engine.isWebGPU, tris: world.triangles };
  (window as unknown as Record<string, unknown>).pc = pc;
}
boot().catch((e) => { console.error('BOOT FAILED', e); (window as unknown as Record<string, unknown>).__error = String(e?.stack ?? e); });
