// End-to-end browser test against the production build:
//   node tests/e2e/run.mjs            (needs `npm run build` first and a Playwright Chromium)
// Boots the real server, opens the built client, plays offline training and an online match
// using the touch input path, and fails on console errors. Screenshots go to tests/e2e/out/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './launch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 2580;
const server = spawn(process.execPath, ['server/dist/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('E2E FAILED:', msg); server.kill(); process.exit(1); };
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch { /* starting */ } await sleep(250); }

const browser = await launch();
const errors = [];
async function play(label, viewport, start) {
  const page = await browser.newPage({ viewport, hasTouch: label === 'mobile', isMobile: label === 'mobile' });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] ${String(e).slice(0, 300)}`));
  await page.goto(`http://localhost:${PORT}/?quality=low`);
  await page.waitForFunction('window.__ready || window.__error', null, { timeout: 180000 });
  if (await page.evaluate('window.__error')) fail(await page.evaluate('window.__error'));
  await sleep(label === 'online' ? 30000 : 12000); // let shaders compile (slow on software renderers)
  await page.screenshot({ path: join(out, `${label}-menu.png`), timeout: 120000 });
  const res = await page.evaluate(`(async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    ${start}
    for (let i = 0; i < 200 && __game.view.phase !== 'live'; i++) await w(250);
    __game.deploy(-1);
    for (let i = 0; i < 80 && !__game.view.alive; i++) await w(250);
    const v = __game.view, s0 = { x: v.state.x, z: v.state.z, ammo: v.state.ammo0 };
    __input.touchMove(0, 1); __input.touchHold('fire', true);
    await w(5000);
    __input.touchMove(0, 0); __input.touchHold('fire', false);
    await w(600);
    return { kind: __game.session.kind, alive: v.alive, moved: Math.hypot(v.state.x - s0.x, v.state.z - s0.z), fired: s0.ammo - v.state.ammo0 + (v.state.reloadT > 0 ? 30 : 0), players: v.players.length, fps: v.fps };
  })()`);
  await page.screenshot({ path: join(out, `${label}-game.png`), timeout: 120000 });
  console.log(label, JSON.stringify(res));
  if (!res.alive && res.moved < 1) fail(`${label}: player did not deploy / move`);
  if (res.moved < 1) fail(`${label}: no movement`);
  if (res.fired < 1) fail(`${label}: weapon did not fire`);
  if (res.players < 2) fail(`${label}: no other soldiers`);
  await page.close();
}
try {
  await play('training', { width: 1280, height: 720 }, "await __app.startTraining({ botDifficulty: 0, friendlyBots: 7, enemyBots: 8, warmup: 1, vehicles: true });");
  await play('online', { width: 1280, height: 720 }, "await __app.startOnline({ mode: 'quick' });");
  await play('mobile', { width: 844, height: 390 }, "await __app.startTraining({ botDifficulty: 0, friendlyBots: 3, enemyBots: 4, warmup: 1 });");
} catch (e) { fail(String(e)); }
await browser.close();
server.kill();
if (errors.length) { console.error(errors.join('\n')); fail(`${errors.length} console errors`); }
console.log('E2E OK');
