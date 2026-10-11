// Store materials for the game page: gameplay screenshots (1280x720), icon (512x512), cover (800x470).
// Usage: npm run build && node scripts/store-assets.mjs
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('dist'); const out = path.resolve('store'); fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { let p = new URL(req.url, 'http://x').pathname; if (p === '/') p = '/index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForSelector('.nav');
await page.evaluate(() => { const a = window.__app; a.profile.name = 'Игрок'; a.profile.nameSet = true; a.profile.settings.graphics.quality = 'high'; a.profile.settings.graphics.shadows = true; a.profile.settings.graphics.renderScale = 1; a.applySettings(); a.save(); document.querySelectorAll('.modal-back').forEach(m => m.remove()); a.showMenu('home'); });
const snap = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(out, name), timeout: 120000 }); console.log('saved', name); };
await snap('screenshot-1-menu.png');

// gameplay: a few seconds into a round, camera toward the action
const play = async (mapId, name, setup) => {
  await page.evaluate(m => window.__app.start({ mode: 'casual', mapId: m }), mapId);
  await page.waitForSelector('.hud', { timeout: 60000 });
  await page.evaluate(() => { const g = window.__app.session.game; const h = g.human(); for (let i = 0; i < 64 * 9; i++) { g.step(); h.health = 100; } });
  await page.evaluate(setup);
  await snap(name, 2500);
  await page.evaluate(() => window.__app.session.end(true));
  await page.waitForSelector('.nav');
};
const faceEnemy = () => {
  const s = window.__app.session; const g = s.game; const h = g.human();
  const e = g.actors.filter(a => a.team !== h.team && a.alive).sort((a, b) => Math.hypot(a.pos.x - h.pos.x, a.pos.z - h.pos.z) - Math.hypot(b.pos.x - h.pos.x, b.pos.z - h.pos.z))[0];
  const yaw = s.input.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (e) { e.pos.x = h.pos.x + fx * 9 + fz * 1.5; e.pos.z = h.pos.z + fz * 9 - fx * 1.5; e.pos.y = h.pos.y; e.yaw = yaw + Math.PI; }
  s.input.pitch = -0.04;
};
await play('sandstorm', 'screenshot-2-sandstorm.png', faceEnemy);
await play('villa', 'screenshot-3-villa.png', faceEnemy);
await play('oasis', 'screenshot-4-oasis.png', () => {
  const s = window.__app.session; const h = s.game.human();
  s.game.mode.hud && 0; h.money = 9000; s.input.pitch = -0.05;
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
});
// spectator overview
await page.evaluate(() => window.__app.spectate({ mode: 'competitive', mapId: 'reactor', ctCount: 5, tCount: 5, ctLevel: 6, tLevel: 6, short: true }));
await page.waitForSelector('.spectator', { timeout: 60000 });
await page.evaluate(() => { const s = window.__app.spectator; const g = s.game; for (let i = 0; i < 64 * 22; i++) g.step(); });
await page.keyboard.press('Digit2');
await snap('screenshot-5-spectator.png', 3000);
await page.keyboard.press('Escape');
await page.waitForSelector('.nav');
await page.evaluate(() => window.__app.showMenu('collection'));
await snap('screenshot-6-weapons.png', 2500);

// icon & cover: drawn from SVG (no third-party art)
const art = (w, h, big) => `<!doctype html><html><body style="margin:0;background:#0b0e13">
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a3b55"/><stop offset="1" stop-color="#0b0e13"/></radialGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f08a2a"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<g transform="translate(${w / 2},${big ? h * 0.42 : h * 0.46})" stroke="#5aa0ff" stroke-width="${big ? 10 : 6}" fill="none" stroke-linecap="round">
<circle r="${big ? 120 : 90}" stroke-opacity=".9"/><line x1="0" y1="-${big ? 165 : 125}" x2="0" y2="-${big ? 60 : 45}"/><line x1="0" y1="${big ? 60 : 45}" x2="0" y2="${big ? 165 : 125}"/>
<line x1="-${big ? 165 : 125}" y1="0" x2="-${big ? 60 : 45}" y2="0"/><line x1="${big ? 60 : 45}" y1="0" x2="${big ? 165 : 125}" y2="0"/><circle r="${big ? 10 : 8}" fill="#ff5a3a" stroke="none"/></g>
<text x="50%" y="${big ? h * 0.86 : h * 0.86}" text-anchor="middle" font-family="Rajdhani, Arial Black, sans-serif" font-weight="900" font-size="${big ? 62 : 64}" fill="url(#t)" letter-spacing="${big ? 2 : 6}">STRIKE ZONE</text>
${big ? '' : `<text x="50%" y="${h * 0.95}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#cbd5e1">тактический шутер · 9 карт · умные боты</text>`}
</svg></body></html>`;
const p2 = await browser.newPage({ viewport: { width: 512, height: 512 } });
await p2.setContent(art(512, 512, true)); await p2.screenshot({ path: path.join(out, 'icon-512.png') }); console.log('saved icon-512.png');
await p2.setViewportSize({ width: 800, height: 470 });
await p2.setContent(art(800, 470, false)); await p2.screenshot({ path: path.join(out, 'cover-800x470.png') }); console.log('saved cover-800x470.png');
await browser.close(); server.close();
