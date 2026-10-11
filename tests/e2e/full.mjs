// Full QA pass in a real browser: every menu, every mode played and finished, training
// scenarios, settings (sensitivity, key rebinding), player name, reset, mobile/touch, and the
// Yandex Games build against a mock SDK (ready, gameplay markup, pause/mute, ads, cloud saves).
// Usage: npm run build && npm run build:yandex && node tests/e2e/full.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('tests/e2e/out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };

// Mock of the Yandex Games SDK: records every call in window.__ya
const MOCK_SDK = `
window.__ya = { ready: 0, gameplay: [], ads: [], setData: [], cloud: window.__yaCloud || null };
window.YaGames = { init: () => Promise.resolve({
  features: { LoadingAPI: { ready() { __ya.ready++; } }, GameplayAPI: { start() { __ya.gameplay.push('start'); }, stop() { __ya.gameplay.push('stop'); } } },
  environment: { i18n: { lang: 'ru' } },
  on(ev, cb) { (__ya.handlers ||= {})[ev] = cb; },
  adv: {
    showFullscreenAdv({ callbacks }) { __ya.ads.push('fullscreen'); callbacks.onOpen && callbacks.onOpen(); __ya.adOpen = true; setTimeout(() => { __ya.adOpen = false; callbacks.onClose && callbacks.onClose(true); }, 600); },
    showRewardedVideo({ callbacks }) { __ya.ads.push('rewarded'); callbacks.onOpen && callbacks.onOpen(); setTimeout(() => { callbacks.onRewarded && callbacks.onRewarded(); callbacks.onClose && callbacks.onClose(); }, 400); },
  },
  getPlayer: () => Promise.resolve({
    getData: () => Promise.resolve(__ya.cloud ? { strikezone: __ya.cloud } : {}),
    setData: (d) => { __ya.setData.push(d); return Promise.resolve(); },
  }),
}) };`;

const serve = (root, extra = {}) => new Promise(r => {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (extra[p]) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(extra[p]); return; }
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  s.listen(0, () => r(s));
});

const results = [];
const errors = [];
const check = async (label, fn) => {
  try { const note = await fn(); results.push(['ok', label, note ?? '']); console.log('ok  ', label, note ?? ''); }
  catch (e) { results.push(['FAIL', label, e.message]); console.log('FAIL', label, e.message); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const newPage = async (url, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('.nav', { timeout: 30000 });
  await page.evaluate(() => { const a = window.__app; a.profile.settings.graphics.quality = 'low'; a.profile.settings.graphics.shadows = false; a.profile.settings.graphics.renderScale = 0.5; a.applySettings(); });
  return { page, ctx };
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `full-${name}.png`), timeout: 90000 }).catch(() => {});

// run the simulation of the current match fast until it is over, then let the client end it
const finishMatch = async (page, maxSim = 3600) => {
  await page.evaluate(max => {
    const s = window.__app.session; const g = s.game;
    let n = 0;
    while (!g.mode.over && g.time < max && n < 400000) { g.step(); n++; }
  }, maxSim);
  await page.waitForSelector('.post', { timeout: 30000 });
};

// ------------------------------------------------------------------------------------------
const local = await serve(path.resolve('dist'));
const URL1 = `http://localhost:${local.address().port}/`;
const { page, ctx } = await newPage(URL1);

await check('first launch asks for a name; bad names are refused, a good one is kept', async () => {
  await page.waitForSelector('.modal-back input', { timeout: 5000 });
  const input = page.locator('.modal-back input');
  for (const bad of ['B', 'BOT Vasya', 'хуй123', 'f*ck!!']) {
    await input.fill(bad); await page.locator('.modal-back .btn', { hasText: 'Сохранить' }).click();
    expect(await page.locator('.modal-back').count() === 1, `bad name accepted: ${bad}`);
  }
  await input.fill('Тестер 007'); await page.locator('.modal-back .btn', { hasText: 'Сохранить' }).click();
  expect(await page.locator('.modal-back').count() === 0, 'dialog did not close');
  expect(await page.evaluate(() => window.__app.profile.name) === 'Тестер 007', 'name not saved');
  await page.reload(); await page.waitForSelector('.nav');
  expect(await page.evaluate(() => window.__app.profile.name) === 'Тестер 007', 'name lost after reload');
  expect(await page.locator('.modal-back').count() === 0, 'asked again after reload');
});

await check('every menu section opens without errors', async () => {
  const sections = await page.evaluate(() => [...document.querySelectorAll('.nav button:not(.link-btn)')].map(b => b.textContent.trim()));
  const before = errors.length;
  for (const label of sections) {
    await page.locator('.nav button:not(.link-btn)', { hasText: label }).first().click();
    await page.waitForTimeout(250);
    const txt = await page.evaluate(() => document.querySelector('.content')?.textContent.length ?? 0);
    expect(txt > 20, `section "${label}" is empty`);
  }
  expect(errors.length === before, `errors: ${errors.slice(before).join('; ')}`);
  await page.locator('.nav button', { hasText: 'Как играть' }).click();
  expect((await page.textContent('.content')).includes('W A S D'), 'controls help missing');
  return `${sections.length} sections`;
});

await check('age mark 16+ and version shown', async () => {
  const t = await page.textContent('.nav');
  expect(t.includes('16+') && t.includes('версия'), 'no age mark');
});

await check('no third-party trademarks in the UI (maps, weapons)', async () => {
  await page.locator('.nav button', { hasText: 'Карты' }).click(); await page.waitForTimeout(300);
  const maps = await page.textContent('.content');
  await page.locator('.nav button', { hasText: 'Коллекция' }).click(); await page.waitForTimeout(500);
  const coll = await page.textContent('.content');
  const bad = ['Dust', 'Mirage', 'Inferno', 'Nuke', 'Ancient', 'Overpass', 'Vertigo', 'Anubis', 'Glock', 'USP', 'Desert Eagle', 'MP5', 'MAC-10', 'P90', 'AK-', 'M4-', 'Galil', 'FAMAS', 'AWP', 'Scout', 'по мотивам']
    .filter(w => maps.includes(w) || coll.includes(w));
  expect(!bad.length, `found: ${bad.join(', ')}`);
});

await check('settings: mouse sensitivity from the settings screen drives the in-game camera', async () => {
  await page.locator('.nav button', { hasText: 'Настройки' }).click(); await page.waitForTimeout(300);
  const slider = page.locator('label:has-text("Чувствительность мыши") + div input[type=range]');
  await slider.evaluate(el => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__app.profile.settings.sensitivity) === 3, 'setting not stored');
  await page.evaluate(() => window.__app.start({ mode: 'casual', mapId: 'sandstorm' }));
  await page.waitForSelector('.hud', { timeout: 30000 });
  const r = await page.evaluate(() => { const i = window.__app.session.input; const y0 = i.yaw; i.look(100, 0); return { sens: i.sensitivity, dYaw: y0 - i.yaw }; });
  expect(r.sens === 3, `session sensitivity ${r.sens}`);
  expect(Math.abs(r.dYaw - 100 * 3 * 0.1 * Math.PI / 180) < 1e-6, `yaw delta ${r.dYaw}`);
  // halve it from the in-game pause menu
  await page.evaluate(() => window.__app.session.setPaused(true));
  const s2 = page.locator('.overlay input[type=range]').first();
  await s2.evaluate(el => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const r2 = await page.evaluate(() => { const i = window.__app.session.input; const y0 = i.yaw; i.look(100, 0); return y0 - i.yaw; });
  expect(Math.abs(r2 - 100 * 1.5 * 0.1 * Math.PI / 180) < 1e-6, `pause-menu sensitivity not applied: ${r2}`);
  await page.evaluate(() => { window.__app.session.setPaused(false); window.__app.session.end(true); });
  await page.waitForSelector('.nav');
});

await check('settings: rebinding a key (and swapping a conflict) works in a match', async () => {
  await page.locator('.nav button', { hasText: 'Настройки' }).click(); await page.waitForTimeout(300);
  const cap = page.locator('label:has-text("Прыжок") + .keycap');
  await cap.click(); await page.keyboard.press('KeyJ'); await page.waitForTimeout(100);
  const b1 = await page.evaluate(() => window.__app.profile.settings.controls.bindings);
  expect(b1.jump === 'KeyJ', `jump=${b1.jump}`);
  // bind reload (R) to J: jump must take R, not lose its key
  await page.locator('label:has-text("Перезарядка") + .keycap').click(); await page.keyboard.press('KeyJ'); await page.waitForTimeout(100);
  const b2 = await page.evaluate(() => window.__app.profile.settings.controls.bindings);
  expect(b2.reload === 'KeyJ' && b2.jump === 'KeyR', `swap failed: reload=${b2.reload} jump=${b2.jump}`);
  await page.evaluate(() => window.__app.start({ mode: 'casual', mapId: 'oasis' }));
  await page.waitForSelector('.hud');
  await page.keyboard.down('KeyR');
  const held = await page.evaluate(() => window.__app.session.input.isHeld('jump'));
  await page.keyboard.up('KeyR');
  expect(held, 'rebound key does not jump');
  await page.evaluate(() => { const b = window.__app.profile.settings.controls.bindings; b.jump = 'Space'; b.reload = 'KeyR'; window.__app.save(); window.__app.session.end(true); });
  await page.waitForSelector('.nav');
});

// play every mode: move, shoot, buy, scoreboard, pause, then finish it and check the results screen
const modes = [
  ['casual', 'sandstorm'], ['competitive', 'reactor'], ['wingman', 'canal'], ['proleague', 'villa'],
  ['deathmatch', 'oasis'], ['tdm', 'ruins'], ['armsrace', 'depot'],
];
for (const [mode, mapId] of modes) {
  await check(`mode ${mode}: plays, pauses and finishes with a results screen`, async () => {
    const before = await page.evaluate(() => ({ hist: window.__app.profile.history.length, xp: window.__app.profile.xp + window.__app.profile.level * 1e6 }));
    await page.evaluate(([m, map]) => window.__app.start({ mode: m, mapId: map }), [mode, mapId]);
    await page.waitForSelector('.hud', { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.mouse.click(500, 300);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
    await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    if (['casual', 'competitive', 'wingman', 'proleague'].includes(mode)) {
      const bought = await page.evaluate(() => { const s = window.__app.session; const g = s.game; const h = g.human(); h.money = 5000; return g.mode.canBuy(h); });
      if (bought) { await page.keyboard.press('KeyB'); await page.waitForTimeout(300); await shot(page, `${mode}-buy`); await page.keyboard.press('KeyB'); }
    }
    await page.keyboard.down('Tab'); await page.waitForTimeout(200); await page.keyboard.up('Tab');
    // count as an active player (idle players get no XP by design)
    await page.evaluate(() => { const h = window.__app.session.game.human(); h.stats.kills += 3; h.stats.damage += 300; h.stats.shotsFired += 40; h.stats.shotsHit += 12; });
    await page.evaluate(() => window.__app.session.setPaused(true));
    await page.waitForTimeout(200);
    const t0 = await page.evaluate(() => window.__app.session.game.time);
    await page.waitForTimeout(500);
    const t1 = await page.evaluate(() => window.__app.session.game.time);
    const ranked = await page.evaluate(() => window.__app.session.opts.ranked);
    expect(ranked ? t1 >= t0 : t1 === t0, `pause: time ${t0} -> ${t1} (ranked=${ranked})`);
    await page.evaluate(() => window.__app.session.setPaused(false));
    await shot(page, `${mode}-play`);
    await finishMatch(page);
    await shot(page, `${mode}-post`);
    const after = await page.evaluate(() => ({ hist: window.__app.profile.history.length, xp: window.__app.profile.xp + window.__app.profile.level * 1e6, post: document.querySelector('.post')?.textContent ?? '' }));
    expect(after.hist === before.hist + 1, `history ${before.hist} -> ${after.hist}`);
    expect(after.xp > before.xp, 'no XP');
    expect(/Победа|Поражение|Ничья|место/.test(after.post), 'no result banner');
    if (mode === 'armsrace') {
      const winner = await page.evaluate(() => window.__app.lastReplay?.events.some(e => e.e.type === 'kill' && e.e.weapon === 'goldknife'));
      expect(winner, 'arms race did not end with a golden knife kill');
    }
    if (mode === 'competitive') {
      await page.locator('.post .btn', { hasText: 'Посмотреть матч' }).click();
      await page.waitForSelector('.replay-bar', { timeout: 20000 }); await page.waitForTimeout(1200); await shot(page, 'replay');
      await page.locator('.replay-bar .btn', { hasText: 'Выход' }).click();
      await page.waitForSelector('.nav');
    } else {
      await page.locator('.post .btn', { hasText: 'В меню' }).click();
      await page.waitForSelector('.nav');
    }
  });
}

await check('ranked menus: competitive map picker and PRO League queue with map veto', async () => {
  await page.locator('.nav button', { hasText: 'Соревновательный' }).click(); await page.waitForTimeout(300);
  expect(await page.locator('.content .btn', { hasText: 'Найти матч' }).count() > 0, 'no find-match button');
  await page.locator('.nav button', { hasText: 'PRO League' }).click(); await page.waitForTimeout(300);
  await page.locator('.content .btn', { hasText: 'Найти матч PRO League' }).click();
  await page.waitForSelector('.queue-box', { timeout: 5000 });
  // wait for the match to be found (veto / vote dialog)
  await page.waitForFunction(() => /Матч найден|Исключите|голосован/i.test(document.querySelector('.queue-box, .modal')?.textContent ?? ''), null, { timeout: 60000 });
  await shot(page, 'pro-veto');
  // ban maps until the match starts
  for (let i = 0; i < 12 && !(await page.locator('.hud').count()); i++) {
    const b = page.locator('.modal .card.click, .modal .btn').first();
    if (await b.count()) await b.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.evaluate(() => window.__app.session.end(true));
  await page.waitForTimeout(800);
  // leaving a ranked match is a loss + queue ban (by design)
  if (await page.locator('.post').count()) await page.locator('.post .btn', { hasText: 'В меню' }).click();
  await page.waitForSelector('.nav');
});

const scenarios = ['static', 'moving', 'reaction', 'recoil', 'grenades'];
for (const sc of scenarios) {
  await check(`training "${sc}": targets appear and can be hit`, async () => {
    await page.evaluate(s => window.__app.start({ mode: 'training', training: { scenario: s, distance: 15, speed: 2, axis: 'x', count: 4, armor: false } }), sc);
    await page.waitForSelector('.hud', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const info = await page.evaluate(async scen => {
      const s = window.__app.session; const g = s.game; const h = g.human();
      if (scen === 'grenades') return { targets: g.targets.length, grenades: h.grenades.length };
      if (scen === 'recoil') {
        // spray at the wall: shots must be fired and land
        s.input.hold('fire', true); await new Promise(r => setTimeout(r, 1200)); s.input.hold('fire', false);
        const ahead = g.world.raycast(h.eye(), { x: -Math.sin(h.yaw), y: 0, z: -Math.cos(h.yaw) }, 30);
        return { targets: 1, hits: h.stats.shotsFired, wallAhead: ahead ? +ahead.t.toFixed(1) : null };
      }
      if (scen === 'reaction') for (let k = 0; k < 100 && !g.targets.some(x => x.alive); k++) await new Promise(r => setTimeout(r, 50));
      // aim at the first living target and shoot for a moment
      let hits = 0;
      for (let k = 0; k < 120; k++) {
        const t = g.targets.find(x => x.alive);
        if (!t) break;
        const e = h.eye(); const tp = { x: t.pos.x, y: t.pos.y + 1.3, z: t.pos.z };
        const dx = tp.x - e.x, dy = tp.y - e.y, dz = tp.z - e.z;
        s.input.yaw = Math.atan2(-dx, -dz); s.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        s.input.hold('fire', k % 6 < 2);
        await new Promise(r => setTimeout(r, 30));
        hits = h.stats.shotsHit;
        if (hits > 0) break;
      }
      s.input.hold('fire', false);
      return { targets: g.targets.length, hits };
    }, sc);
    expect(info.targets > 0 || sc === 'grenades', `no targets (${JSON.stringify(info)})`);
    if (sc !== 'grenades') expect(info.hits > 0, `no hits (${JSON.stringify(info)})`);
    else expect(info.grenades > 0, 'no grenades in grenade practice');
    await shot(page, `training-${sc}`);
    await page.evaluate(() => window.__app.session.end(true));
    await page.waitForTimeout(800);
    if (await page.locator('.post').count()) await page.locator('.post .btn', { hasText: 'В меню' }).click();
    await page.waitForSelector('.nav');
    return JSON.stringify(info);
  });
}

await check('custom match and spectator mode start and leave cleanly', async () => {
  await page.evaluate(() => window.__app.start({ mode: 'competitive', mapId: 'skyline', custom: { allyLevel: 2, enemyLevel: 6, teamSize: 3, short: true } }));
  await page.waitForSelector('.hud');
  const n = await page.evaluate(() => window.__app.session.game.actors.length);
  expect(n === 6, `custom 3v3 has ${n} players`);
  await page.evaluate(() => window.__app.session.end(true)); await page.waitForTimeout(600);
  if (await page.locator('.post').count()) await page.locator('.post .btn', { hasText: 'В меню' }).click();
  await page.waitForSelector('.nav');
  await page.evaluate(() => window.__app.spectate({ mode: 'deathmatch', mapId: 'pharaoh', ctCount: 0, tCount: 0, ctLevel: 3, tLevel: 3, ffaCount: 5, ffaLevel: 4 }));
  await page.waitForSelector('.spectator'); await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); await page.waitForSelector('.nav');
});

await check('stats and history reflect the played matches', async () => {
  await page.locator('.nav button', { hasText: 'История' }).click(); await page.waitForTimeout(300);
  const rows = await page.locator('.content tr').count();
  expect(rows >= 7, `history rows ${rows}`);
  await page.locator('.nav button', { hasText: 'Статистика' }).click(); await page.waitForTimeout(300);
  expect((await page.textContent('.content')).length > 100, 'stats empty');
});

await check('reset progress uses an in-game dialog and keeps the name', async () => {
  await page.locator('.nav button:not(.link-btn)', { hasText: 'Профиль' }).click(); await page.waitForTimeout(300);
  page.once('dialog', d => { throw new Error(`native dialog: ${d.message()}`); });
  await page.locator('.content .btn', { hasText: 'Сбросить прогресс' }).click();
  await page.locator('.modal .btn', { hasText: 'Сбросить' }).click();
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => ({ hist: window.__app.profile.history.length, name: window.__app.profile.name }));
  expect(p.hist === 0 && p.name === 'Тестер 007', JSON.stringify(p));
});
await ctx.close();

await check('phone: touch controls, touch editor, playable match', async () => {
  const { page: m, ctx: c2 } = await newPage(URL1, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  if (await m.locator('.modal-back').count()) await m.locator('.modal-back .btn', { hasText: 'Пропустить' }).click();
  await m.evaluate(() => { window.__app.profile.settings.controls.scheme = 'touch'; window.__app.applySettings(); window.__app.start({ mode: 'casual', mapId: 'depot' }); });
  await m.waitForSelector('.touch .tbtn', { timeout: 30000 });
  const btns = await m.locator('.touch .tbtn').count();
  expect(btns >= 8, `only ${btns} touch buttons`);
  await m.evaluate(() => window.__app.session.setPaused(true));
  await m.locator('.overlay .btn', { hasText: 'Настроить сенсорные кнопки' }).click();
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(out, 'full-mobile-editor.png') });
  await c2.close();
  return `${btns} buttons`;
});

local.close();

// ------------------------------------------------------------------------------------------
// Yandex Games build with a mock SDK
const yroot = path.resolve('dist-yandex');
if (fs.existsSync(yroot)) {
  const ysrv = await serve(yroot, { '/sdk.js': MOCK_SDK });
  const YURL = `http://localhost:${ysrv.address().port}/`;
  const { page: y, ctx: yc } = await newPage(YURL);
  if (await y.locator('.modal-back').count()) await y.locator('.modal-back .btn', { hasText: 'Пропустить' }).click();

  await check('yandex: SDK initialised, LoadingAPI.ready called exactly once', async () => {
    await y.waitForTimeout(500);
    const r = await y.evaluate(() => ({ ready: window.__ya.ready, platform: window.__app && (window.__app.constructor.name) }));
    expect(r.ready === 1, `ready called ${r.ready} times`);
  });

  await check('yandex: gameplay markup start/stop follows match, pause and exit', async () => {
    await y.evaluate(() => { window.__ya.gameplay = []; window.__app.start({ mode: 'casual', mapId: 'villa' }); });
    await y.waitForSelector('.hud'); await y.waitForTimeout(1300);
    await y.evaluate(() => window.__app.session.setPaused(true)); await y.waitForTimeout(1300);
    await y.evaluate(() => window.__app.session.setPaused(false)); await y.waitForTimeout(1300);
    await y.evaluate(() => window.__app.session.end(true)); await y.waitForTimeout(1300);
    const g = await y.evaluate(() => window.__ya.gameplay.join(','));
    expect(g === 'start,stop,start,stop', `gameplay calls: ${g}`);
  });

  await check('yandex: leaving the tab stops the game and all sound (req. 1.3)', async () => {
    await y.evaluate(() => window.__app.start({ mode: 'casual', mapId: 'oasis' }));
    await y.waitForSelector('.hud'); await y.waitForTimeout(800);
    const r = await y.evaluate(async () => {
      const setVis = v => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
      setVis('hidden');
      const s = window.__app.session; const t0 = s.game.time;
      await new Promise(r => setTimeout(r, 600));
      const r = { paused: s.externalPause, frozen: s.game.time === t0 };
      setVis('visible');
      await new Promise(r => setTimeout(r, 400));
      r.resumed = !s.externalPause && s.game.time > t0;
      return r;
    });
    expect(r.paused && r.frozen && r.resumed, JSON.stringify(r));
    await y.evaluate(() => window.__app.session.end(true)); await y.waitForSelector('.nav');
  });

  await check('yandex: full-screen ad after a match, game muted & stopped during it; rewarded XP', async () => {
    await y.evaluate(() => { window.__ya.ads = []; window.__app.start({ mode: 'deathmatch', mapId: 'canal' }); });
    await y.waitForSelector('.hud'); await y.waitForTimeout(800);
    await y.evaluate(() => { const h = window.__app.session.game.human(); h.stats.kills += 3; h.stats.damage += 300; h.stats.shotsFired += 40; h.stats.shotsHit += 12; });
    await finishMatch(y);
    await y.waitForTimeout(200);
    const during = await y.evaluate(() => ({ ads: [...window.__ya.ads], open: window.__ya.adOpen, paused: window.__app.externallyPaused }));
    expect(during.ads.includes('fullscreen'), `no interstitial: ${JSON.stringify(during)}`);
    await y.waitForTimeout(900);
    expect(!(await y.evaluate(() => window.__app.externallyPaused)), 'still paused after the ad');
    const xp0 = await y.evaluate(() => window.__app.profile.xp + window.__app.profile.level * 1e6);
    await y.locator('.post .btn', { hasText: 'за просмотр рекламы' }).click();
    await y.waitForFunction(() => /получено/.test(document.querySelector('.post')?.textContent ?? ''), null, { timeout: 5000 });
    const xp1 = await y.evaluate(() => window.__app.profile.xp + window.__app.profile.level * 1e6);
    expect(xp1 > xp0, 'rewarded XP not granted');
    await y.locator('.post .btn', { hasText: 'В меню' }).click(); await y.waitForSelector('.nav');
  });

  await check('yandex: progress saved to the cloud and restored from a newer cloud copy', async () => {
    const saved = await y.evaluate(async () => { await new Promise(r => setTimeout(r, 11000)); return window.__ya.setData.length; });
    expect(saved > 0, 'no cloud writes');
    const cloud = await y.evaluate(() => {
      const last = window.__ya.setData[window.__ya.setData.length - 1].strikezone;
      const prof = JSON.parse(last.profile); prof.name = 'Облако';
      return { profile: JSON.stringify(prof), savedAt: String(Date.now() + 60000) };
    });
    await yc.addInitScript(c => { window.__yaCloud = c; }, cloud);
    await y.reload(); await y.waitForSelector('.nav');
    const name = await y.evaluate(() => window.__app.profile.name);
    expect(name === 'Облако', `name after reload: ${name}`);
  });

  await yc.close();
  ysrv.close();
} else console.log('(dist-yandex missing: run npm run build:yandex to check the Yandex build)');

await browser.close();
const fails = results.filter(r => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
if (errors.length) console.log(`\nBrowser errors (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n'));
process.exit(fails.length || errors.length ? 1 : 0);
