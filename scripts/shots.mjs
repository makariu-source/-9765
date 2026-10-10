// Quick visual check screenshots (dev tool).
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('dist'); const out = path.resolve('tests/e2e/out'); fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => { let p = new URL(req.url, 'http://x').pathname; if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForSelector('.nav');
const snap = async n => { await page.screenshot({ path: path.join(out, n + '.png'), timeout: 90000 }); console.log('shot', n); };
for (const map of ['sandstorm', 'reactor']) {
  await page.evaluate(m => window.__app.start({ mode: 'casual', mapId: m }), map);
  await page.waitForSelector('.hud', { timeout: 60000 });
  await page.waitForTimeout(3000);
  // turn toward the nearest teammate so the character models are in view
  await page.evaluate(() => {
    const s = window.__app.session; const g = s.game; const h = g.human();
    const mate = g.actors.filter(a => a !== h && a.team === h.team).sort((a, b) => Math.hypot(a.pos.x - h.pos.x, a.pos.z - h.pos.z) - Math.hypot(b.pos.x - h.pos.x, b.pos.z - h.pos.z))[0];
    s.input.yaw = Math.atan2(-(mate.pos.x - h.pos.x), -(mate.pos.z - h.pos.z)); s.input.pitch = -0.08;
  });
  await page.waitForTimeout(2500);
  await snap(`v11-${map}`);
  await page.evaluate(() => window.__app.session.end(true));
  await page.waitForTimeout(800);
}
await page.evaluate(() => window.__app.showMenu('collection'));
await page.waitForTimeout(2500);
await snap('v11-collection');
await page.evaluate(() => window.__app.showMenu('settings'));
await page.waitForTimeout(500);
await page.getByText('Редактор сенсорных кнопок').first().click();
await page.waitForTimeout(800);
await snap('v11-touch-editor');
await browser.close(); server.close();
