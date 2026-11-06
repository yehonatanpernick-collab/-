// Scripted play-test: node tools/play.mjs "<query>" <outPrefix> "<script>"
// script: comma-separated steps: hold:KeyW:3000 | press:KeyF | wait:2000 | shot:name | eval:js
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { chromium } = require('/opt/node-tools/node_modules/playwright/index.js');
const [q, out, script = '', W = '1280', H = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1, hasTouch: q.includes('touch') });
const errs = new Set();
page.on('pageerror', (e) => errs.add('[pageerror] ' + e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/toNonIndexed|adapters|WebGPU is not available|PCFSoft|GPU stall|Automatic fallback/.test(t)) errs.add(`[${m.type()}] ${t.slice(0, 300)}`); } });
const t0 = Date.now();
await page.goto(`http://localhost:5173/${q}`);
await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 400000 });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(0), 's', await page.evaluate(() => window.__err || ''));
for (const step of script.split(',').filter(Boolean)) {
  const [cmd, a, b] = step.split(':');
  if (cmd === 'hold') { await page.keyboard.down(a); await page.waitForTimeout(+b); await page.keyboard.up(a); }
  else if (cmd === 'down') await page.keyboard.down(a);
  else if (cmd === 'up') await page.keyboard.up(a);
  else if (cmd === 'press') await page.keyboard.press(a);
  else if (cmd === 'wait') await page.waitForTimeout(+a);
  else if (cmd === 'shot') await page.screenshot({ path: `${out}-${a}.png` });
  else if (cmd === 'eval') console.log(a, '=>', await page.evaluate(decodeURIComponent(b)));
}
console.log([...errs].slice(0, 25).join('\n'));
await browser.close();
