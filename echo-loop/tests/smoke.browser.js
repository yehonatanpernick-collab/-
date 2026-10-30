// Browser smoke test: opens the game, plays through one full loop and checks that an
// echo appears, with no page errors. Run: node tests/smoke.browser.js [screenshotDir]
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const shotDir = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'title.png') });
  await page.click('#btn-start');

  // circle around the arena with the keyboard for ~11.5 s
  const dirs = [['d', 's'], ['s', 'a'], ['a', 'w'], ['w', 'd']];
  for (let i = 0; i < 23; i++) {
    const [k1, k2] = dirs[i % 4];
    await page.keyboard.down(k1); await page.keyboard.down(k2);
    await page.waitForTimeout(500);
    await page.keyboard.up(k1); await page.keyboard.up(k2);
    if (i === 8 && shotDir) await page.screenshot({ path: path.join(shotDir, 'play.png') });
  }

  const s = await page.evaluate(() => ({
    state: window.__echoLoop.state,
    loop: window.__echoLoop.game.loop,
    echoes: window.__echoLoop.game.echoes.length,
    kills: window.__echoLoop.game.stats.kills,
    hud: document.getElementById('hud-echoes').textContent,
  }));
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'loop2.png') });
  await browser.close();

  console.log(JSON.stringify(s));
  const ok = errors.length === 0 && (s.state === 'over' || s.echoes >= 1) && s.kills > 0;
  if (errors.length) console.error('page errors:', errors);
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  process.exit(ok ? 0 : 1);
})();
