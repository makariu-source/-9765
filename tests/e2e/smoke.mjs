// Browser smoke test: serves dist/, opens the game in Chromium, checks menus, starts matches,
// drives the player with keyboard/mouse, and saves screenshots to tests/e2e/out/.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const out = path.resolve('tests/e2e/out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 90000 }); console.log('screenshot', name); };
const step = async (label, fn) => { try { await fn(); console.log('ok   ', label); } catch (e) { errors.push(`${label}: ${e.message}`); console.log('FAIL ', label, e.message); } };

await page.goto(url);
await page.waitForSelector('.nav', { timeout: 20000 });
// software-rendered headless Chromium is slow: keep graphics light for the test
await page.evaluate(() => { const a = window.__app; a.profile.settings.graphics.quality = 'low'; a.profile.settings.graphics.shadows = false; a.profile.settings.graphics.renderScale = 0.6; a.applySettings(); });
await page.waitForTimeout(1500);
await shot('01-menu');

for (const [sec, name] of [['competitive', '02-competitive'], ['proleague', '03-proleague'], ['settings', '04-settings'], ['collection', '05-collection'], ['stats', '06-stats'], ['custom', '07-custom']]) {
  await step(`menu ${sec}`, async () => {
    await page.evaluate(s => window.__app.showMenu(s), sec);
    await page.waitForTimeout(700);
    await shot(name);
  });
}

const playMatch = async (mode, mapId, secs, tag) => {
  await page.evaluate(([m, map]) => window.__app.start({ mode: m, mapId: map }), [mode, mapId]);
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot(`${tag}-start`);
  // drive: move forward, look around, shoot
  await page.mouse.click(640, 360);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(secs * 1000);
  await shot(`${tag}-mid`);
  const state = await page.evaluate(() => {
    const s = window.__app.session;
    if (!s) return null;
    const g = s.game;
    return { time: g.time, actors: g.actors.length, alive: g.actors.filter(a => a.alive).length, hud: g.mode.hud(), kills: g.actors.reduce((a, x) => a + x.stats.kills, 0) };
  });
  console.log(tag, JSON.stringify(state));
  if (!state || state.time < 0.5) throw new Error(`simulation did not advance: ${JSON.stringify(state)}`);
};

await step('casual match', () => playMatch('casual', 'sandstorm', 8, '10-casual'));
await step('scoreboard', async () => { await page.keyboard.down('Tab'); await page.waitForTimeout(300); await shot('11-scoreboard'); await page.keyboard.up('Tab'); });
await step('buy menu', async () => {
  await page.evaluate(() => { const s = window.__app.session; s.game.time; });
  await page.keyboard.press('KeyB'); await page.waitForTimeout(300); await shot('12-buy'); await page.keyboard.press('KeyB');
});
await step('leave match', async () => {
  await page.evaluate(() => window.__app.session.end(true));
  await page.waitForTimeout(1500);
  await shot('13-after-leave');
});
await step('deathmatch', () => playMatch('deathmatch', 'oasis', 6, '20-dm'));
await step('dm end', async () => { await page.evaluate(() => window.__app.session.end(false)); await page.waitForTimeout(1500); await shot('21-dm-post'); });
await step('replay', async () => { await page.evaluate(() => window.__app.watchReplay()); await page.waitForTimeout(2500); await shot('22-replay'); });
await step('training', async () => {
  await page.evaluate(() => window.__app.start({ mode: 'training', training: { scenario: 'moving', distance: 20, speed: 3, axis: 'x', count: 4, armor: false } }));
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('30-training');
  await page.evaluate(() => window.__app.session.end(true));
  await page.waitForTimeout(800);
});
await step('arms race', () => playMatch('armsrace', 'villa', 6, '40-armsrace'));
await step('arms race leave', async () => { await page.evaluate(() => window.__app.session.end(true)); await page.waitForTimeout(800); });

// v1.1.1 regression: soldier models must stand at their simulated height on every map
// (raised floors like Reactor at 3 m used to hide everyone under the floor)
for (const mapId of ['sandstorm', 'oasis', 'villa', 'reactor', 'ruins', 'canal', 'skyline', 'depot', 'pharaoh']) {
  await step(`models on floor: ${mapId}`, async () => {
    await page.evaluate(m => window.__app.start({ mode: 'competitive', mapId: m }), mapId);
    await page.waitForSelector('.hud', { timeout: 30000 });
    await page.waitForTimeout(1000);
    const worst = await page.evaluate(() => new Promise(done => {
      const s = window.__app.session; let w = 0, n = 0;
      const tick = () => {
        for (const a of s.game.actors) { const cv = s.chars.get(a.id); if (a.alive && cv.root.visible) w = Math.max(w, Math.abs(cv.root.position.y - a.pos.y)); }
        if (++n < 30) requestAnimationFrame(tick); else done(w);
      };
      tick();
    }));
    await page.evaluate(() => window.__app.session.end(true));
    await page.waitForTimeout(500);
    if (worst > 0.3) throw new Error(`character models are ${worst.toFixed(2)} m off their floor`);
  });
}

// mobile viewport with touch controls
const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
mobile.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
await step('mobile', async () => {
  await mobile.goto(url, { timeout: 90000 });
  await mobile.waitForSelector('.nav', { timeout: 20000 });
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: path.join(out, '50-mobile-menu.png') });
  await mobile.evaluate(() => { window.__app.profile.settings.controls.scheme = 'touch'; window.__app.profile.settings.graphics.quality = 'low'; window.__app.applySettings(); window.__app.start({ mode: 'casual', mapId: 'depot' }); });
  await mobile.waitForSelector('.touch .tbtn', { timeout: 30000 });
  await mobile.waitForTimeout(3000);
  await mobile.screenshot({ path: path.join(out, '51-mobile-match.png') });
});

await browser.close();
server.close();
console.log(errors.length ? `\nERRORS (${errors.length}):\n` + errors.join('\n') : '\nNo errors.');
process.exit(errors.length ? 1 : 0);
