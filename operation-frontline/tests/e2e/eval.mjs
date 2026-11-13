// Debug helper: node tests/e2e/eval.mjs <url> "<js expression>" [waitMs] [screenshot.png]
import { launch } from './launch.mjs';
const [url, expr, wait = '2000', shot] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction('window.__ready || window.__error', null, { timeout: 120000 });
await page.waitForTimeout(+wait);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
if (shot) { await page.waitForTimeout(1500); await page.screenshot({ path: shot, timeout: 120000 }); }
await browser.close();
