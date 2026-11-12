// Debug helper: loads a URL in headless Chromium and saves a screenshot.
// Usage: node tests/e2e/shot.mjs <url> <out.png> [waitMs] [width] [height]
import { launch } from './launch.mjs';
const [url, out, wait = '4000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 600)}`));
await page.goto(url, { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready || window.__error', null, { timeout: 90000 }); } catch { logs.push('TIMEOUT waiting for __ready'); }
await page.waitForTimeout(+wait);
const info = await page.evaluate('({ ready: window.__ready, error: window.__error, info: window.__info })');
console.log(JSON.stringify(info));
console.log(logs.slice(0, 25).join('\n'));
const fps = await page.evaluate('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) r((n / 2).toFixed(1)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })');
console.log('fps', fps);
await page.screenshot({ path: out, timeout: 120000 });
await browser.close();
