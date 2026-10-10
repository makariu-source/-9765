import { createMatch } from '../../src/match';
import type { LobbyPlayer } from '../../src/sim/modes/lobby';
import { BombMode, LOSS_BONUS } from '../../src/sim/modes/bomb';
import { ArmsRaceMode, DeathmatchMode } from '../../src/sim/modes/respawn';
import { TrainingMode } from '../../src/sim/modes/training';
import { emptyInput, type InputCmd } from '../../src/sim/types';
import { buy, checkBuy } from '../../src/sim/buy';
import { predictThrow, smokeBlocks } from '../../src/sim/grenades';
import { PLANT_TIME, TICK, type Game } from '../../src/sim/game';
import type { Actor } from '../../src/sim/actor';
import { WEAPONS } from '../../src/sim/weapons';
import { getMap } from '../../src/sim/maps/maps';

const lobbyOf = (n: number, level = 4, human = true): LobbyPlayer[] =>
  Array.from({ length: n * 2 }, (_, i) => ({ name: i === 0 && human ? 'Human' : `BOT ${i}`, squad: i < n ? 0 : 1, isBot: !(i === 0 && human), level, skill: 1000, model: i % 4 }));

/** Replace an actor's controller with a scripted input function. */
function script(g: Game, a: Actor, f: (t: number) => Partial<InputCmd>): void {
  g.controllers.set(a.id, { think: (_g, act) => ({ ...emptyInput(act.yaw, act.pitch), ...f(g.time) }) });
}
const run = (g: Game, seconds: number) => { for (let i = 0; i < seconds / TICK; i++) g.step(); };

function liveBomb(mapId = 'sandstorm', n = 1, start: 'T' | 'CT' = 'CT') {
  const m = createMatch({ mode: 'competitive', mapId, seed: 3, lobby: lobbyOf(n), humanStart: start });
  const g = m.game;
  const mode = g.mode as BombMode;
  for (const a of g.actors) script(g, a, () => ({}));
  while (mode.phase !== 'live') g.step();
  return { m, g, mode };
}

describe('movement & collision', () => {
  it('walks, is blocked by walls and never ends inside geometry', () => {
    const { g } = liveBomb();
    const a = g.actors[0];
    const yaw = a.yaw;
    script(g, a, () => ({ forward: 1, yaw }));
    const start = { ...a.pos };
    run(g, 1);
    expect(Math.hypot(a.pos.x - start.x, a.pos.z - start.z)).toBeGreaterThan(3);
    run(g, 20); // run into whatever is ahead
    expect(g.world.overlaps(a.pos.x, a.pos.y + 0.02, a.pos.z, 0.3, a.height)).toBeNull();
  });

  it('jumps and lands; crouch lowers the eye; walking is slower than running', () => {
    const { g } = liveBomb();
    const a = g.actors[0];
    script(g, a, t => ({ jump: t < g.time + 0.02 }));
    let maxY = a.pos.y;
    script(g, a, () => ({ jump: true }));
    for (let i = 0; i < 40; i++) { g.step(); maxY = Math.max(maxY, a.pos.y); }
    expect(maxY - 0).toBeGreaterThan(0.9);
    script(g, a, () => ({ crouch: true }));
    run(g, 1);
    expect(a.eyeHeight).toBeLessThan(1.2);
    const speedWith = (walk: boolean) => {
      script(g, a, () => ({ forward: 1, walk, yaw: a.yaw }));
      run(g, 0.6);
      return Math.hypot(a.vel.x, a.vel.z);
    };
    script(g, a, () => ({}));
    run(g, 0.5);
    const walk = speedWith(true);
    script(g, a, () => ({}));
    run(g, 0.5);
    const runS = speedWith(false);
    expect(walk).toBeLessThan(runS * 0.7);
  });
});

describe('weapons & damage', () => {
  it('headshots deal more damage than body shots; helmet reduces headshot damage', () => {
    const m = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' });
    const g = m.game;
    const [a, b] = g.actors;
    const hitAt = (y: number, helmet: boolean) => {
      b.health = 100; b.armor = helmet ? 100 : 0; b.helmet = helmet; b.alive = true;
      b.pos = { x: 40, y: 0.02, z: 30 }; b.crouchAmt = 0;
      const o = { x: 40, y: y, z: 45 };
      g.fireBullet(a, o, { x: 0, y: 0, z: -1 }, WEAPONS.ak);
      return 100 - b.health;
    };
    const head = hitAt(1.66, false), chest = hitAt(1.25, false), legs = hitAt(0.4, false);
    expect(head).toBe(100); // capped by remaining health: lethal
    expect(chest).toBeLessThan(50);
    expect(legs).toBeLessThan(chest);
    const headHelmet = hitAt(1.66, true);
    expect(headHelmet).toBeGreaterThanOrEqual(100); // AK one-taps a helmet at short range
    const chestArmor = hitAt(1.25, true);
    expect(chestArmor).toBeLessThan(chest); // armor absorbs part of body damage
  });

  it('damage falls off with distance', () => {
    const m = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' });
    const g = m.game;
    const [a, b] = g.actors;
    const at = (d: number) => { b.health = 100; b.armor = 0; b.alive = true; b.pos = { x: 40, y: 0.02, z: 10 }; g.fireBullet(a, { x: 40, y: 1.25, z: 10 + d }, { x: 0, y: 0, z: -1 }, WEAPONS.g9); return 100 - b.health; };
    expect(at(5)).toBeGreaterThan(at(40));
  });

  it('thin wood is penetrable, concrete walls are not', () => {
    const g = createMatch({ mode: 'casual', mapId: 'skyline', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' }).game;
    const wood = g.world.boxes.find(b => b.kind === 'wood')!;
    const wall = g.world.boxes.find(b => b.kind === 'wall' && b.maxx - b.minx < 30 && b.maxz - b.minz > 2)!;
    const thru = (b: typeof wood) => {
      const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2, y = b.miny + 1.2;
      const alongX = b.maxx - b.minx > b.maxz - b.minz;
      const o = alongX ? { x: cx, y, z: b.minz - 1 } : { x: b.minx - 1, y, z: cz };
      const d = alongX ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
      const spans = g.world.raySpans(o, d, 5);
      const s = spans[0];
      return (s.tOut - s.tIn) * s.box.resist;
    };
    expect(thru(wood)).toBeLessThan(WEAPONS.ak.penetration);
    expect(thru(wall)).toBe(Infinity);
  });

  it('reload takes the weapon reload time and refills from reserve', () => {
    const { g } = liveBomb();
    const a = g.actors[0];
    g.giveWeapon(a, 'ak');
    a.deployEnd = 0;
    const w = a.primary!;
    w.clip = 5;
    let pressed = false;
    script(g, a, () => { const r = !pressed; pressed = true; return { reload: r }; });
    run(g, WEAPONS.ak.reloadTime * 0.8);
    expect(w.clip).toBe(5);
    run(g, WEAPONS.ak.reloadTime * 0.4);
    expect(w.clip).toBe(30);
    expect(w.reserve).toBe(90 - 25);
  });

  it('automatic fire respects the rate of fire and consumes ammo', () => {
    const { g } = liveBomb();
    const a = g.actors[0];
    g.giveWeapon(a, 'ak');
    a.deployEnd = 0;
    script(g, a, () => ({ fire: true, pitch: 0.3 }));
    run(g, 1.0);
    const fired = 30 - a.primary!.clip;
    expect(fired).toBeGreaterThanOrEqual(9);
    expect(fired).toBeLessThanOrEqual(11);
  });

  it('recoil kicks bullets upward during a spray', () => {
    const { g } = liveBomb();
    const a = g.actors[0];
    g.giveWeapon(a, 'ak');
    a.deployEnd = 0;
    const ys: number[] = [];
    g.listeners.push(e => { if (e.type === 'shot' && e.actor === a.id) ys.push(e.dir.y); });
    script(g, a, () => ({ fire: true, pitch: 0 }));
    run(g, 1.2);
    expect(ys.length).toBeGreaterThan(8);
    expect(ys.slice(-3).reduce((s, v) => s + v, 0) / 3).toBeGreaterThan(ys[0] + 0.05);
  });
});

describe('grenades', () => {
  it('HE damages nearby players but not through walls', () => {
    const m = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' });
    const g = m.game;
    const [a, b] = g.actors;
    for (const x of g.actors) script(g, x, () => ({}));
    const mode = g.mode as BombMode;
    while (mode.phase !== 'live') g.step();
    b.pos = { x: 40, y: 0.02, z: 30 }; b.armor = 0;
    g.projectiles.push({ id: 999, type: 'he', owner: a.id, team: a.team, pos: { x: 41, y: 0.2, z: 31 }, vel: { x: 0, y: 0, z: 0 }, born: g.time - 1.5, stillTime: 1, bounces: 0, done: false, rot: 0 });
    run(g, 0.2);
    expect(b.health).toBeLessThan(60);
  });

  it('smoke blocks line of sight and dissipates', () => {
    const g = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' }).game;
    g.smokes.push({ id: 1, pos: { x: 40, y: 1.2, z: 30 }, born: g.time - 2, radius: 3.6, owner: 0 });
    expect(smokeBlocks(g.smokes, g.time, { x: 40, y: 1.6, z: 40 }, { x: 40, y: 1.6, z: 20 })).toBe(true);
    expect(smokeBlocks(g.smokes, g.time, { x: 50, y: 1.6, z: 40 }, { x: 50, y: 1.6, z: 20 })).toBe(false);
    run(g, 20);
    expect(g.smokes.length).toBe(0);
  });

  it('flashbang blinds players looking at it', () => {
    const m = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' });
    const g = m.game;
    for (const x of g.actors) script(g, x, (_t) => ({ yaw: 0, pitch: 0 }));
    const mode = g.mode as BombMode;
    while (mode.phase !== 'live') g.step();
    const [a, b] = g.actors;
    b.pos = { x: 40, y: 0.02, z: 40 }; b.yaw = 0; // facing -Z toward the flash
    a.pos = { x: 60, y: 0.02, z: 40 };
    g.projectiles.push({ id: 5, type: 'flash', owner: a.id, team: a.team, pos: { x: 40, y: 1.6, z: 32 }, vel: { x: 0, y: 0, z: 0 }, born: g.time - 1.6, stillTime: 1, bounces: 0, done: false, rot: 0 });
    run(g, 0.1);
    expect(b.flashEnd - g.time).toBeGreaterThan(2);
  });

  it('molotov creates a burning area that damages and is avoided by navigation', () => {
    const m = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' });
    const g = m.game;
    for (const x of g.actors) script(g, x, () => ({}));
    const mode = g.mode as BombMode;
    while (mode.phase !== 'live') g.step();
    const b = g.actors[1];
    b.pos = { x: 40, y: 0.02, z: 30 };
    g.projectiles.push({ id: 7, type: 'molotov', owner: g.actors[0].id, team: 'X', pos: { x: 40, y: 0.6, z: 30 }, vel: { x: 0, y: -3, z: 0 }, born: g.time, stillTime: 0, bounces: 0, done: false, rot: 0 });
    run(g, 1.5);
    expect(g.fires.length).toBe(1);
    expect(b.health).toBeLessThan(100);
    const c = g.nav.cellOf({ x: 40, z: 30 });
    expect(g.nav.extraCost[g.nav.idx(c.i, c.j)]).toBeGreaterThan(0);
  });

  it('trajectory prediction matches the simulated flight', () => {
    const g = createMatch({ mode: 'casual', mapId: 'range', seed: 1, lobby: lobbyOf(1), humanStart: 'CT' }).game;
    const land = predictThrow(g, { x: 40, y: 1.6, z: 50 }, { x: 0, y: 5, z: -12 });
    expect(land.z).toBeLessThan(50);
    expect(land.y).toBeLessThan(0.5);
  });
});

describe('bomb & economy', () => {
  it('a T on a site plants in 3.2 s, the bomb explodes after the timer and T win', () => {
    const { g, mode } = liveBomb('sandstorm', 1, 'T');
    const t = g.actors.find(a => a.team === 'T')!;
    const ct = g.actors.find(a => a.team === 'CT')!;
    if (!t.hasBomb) g.giveBomb(t);
    const site = g.map.sites[0];
    const cell = g.analysis.plantSpots[site.id][0];
    t.pos = { ...g.nav.center(cell.i, cell.j) }; t.pos.y += 0.02;
    ct.pos = { ...g.map.ctSpawns[0] };
    script(g, t, () => ({ select: 'bomb', fire: true }));
    run(g, 0.9 + PLANT_TIME);
    expect(g.bomb.state).toBe('planted');
    script(g, t, () => ({}));
    t.pos = { ...g.map.tSpawns[0] };
    run(g, 41);
    expect(['exploded']).toContain(g.bomb.state);
    expect(mode.lastRoundEnd?.winner).toBe('T');
  });

  it('a CT defuses a planted bomb (faster with a kit)', () => {
    const { g, mode } = liveBomb('sandstorm', 1, 'T');
    const t = g.actors.find(a => a.team === 'T')!;
    const ct = g.actors.find(a => a.team === 'CT')!;
    if (!t.hasBomb) g.giveBomb(t);
    const cell = g.analysis.plantSpots.A[0];
    t.pos = { ...g.nav.center(cell.i, cell.j) }; t.pos.y += 0.02;
    script(g, t, () => ({ select: 'bomb', fire: true }));
    run(g, 0.9 + PLANT_TIME);
    expect(g.bomb.state).toBe('planted');
    script(g, t, () => ({}));
    t.pos = { ...g.map.tSpawns[0] };
    ct.kit = true;
    ct.pos = { x: g.bomb.pos.x + 0.5, y: g.bomb.pos.y + 0.02, z: g.bomb.pos.z };
    script(g, ct, () => ({ use: true }));
    run(g, 5.3);
    expect(g.bomb.state).toBe('defused');
    expect(mode.lastRoundEnd?.winner).toBe('CT');
  });

  it('buying deducts money, respects side restrictions and limits', () => {
    const { g } = liveBomb('sandstorm', 1, 'T');
    const t = g.actors.find(a => a.team === 'T')!;
    t.pos = { ...g.map.tSpawns[0] };
    t.money = 5000;
    expect(checkBuy(g, t, 'm4').ok).toBe(false);
    expect(buy(g, t, 'ak').ok).toBe(true);
    expect(t.money).toBe(2300);
    expect(buy(g, t, 'flash').ok).toBe(true);
    expect(buy(g, t, 'flash').ok).toBe(true);
    expect(buy(g, t, 'flash').ok).toBe(false);
    t.money = 100;
    expect(buy(g, t, 'armorhelmet').ok).toBe(false);
  });

  it('loss bonus grows with consecutive losses', () => {
    expect(LOSS_BONUS[0]).toBeLessThan(LOSS_BONUS[4]);
  });
});

describe('modes', () => {
  it('arms race promotes on kills and ends with a knife kill', () => {
    const m = createMatch({ mode: 'armsrace', mapId: 'range', seed: 2, lobby: lobbyOf(1) });
    const g = m.game;
    const mode = g.mode as ArmsRaceMode;
    for (const x of g.actors) script(g, x, () => ({}));
    const [a, b] = g.actors;
    b.spawnProtectUntil = 0;
    const before = a.armsLevel;
    g.applyDamage(b, a, 500, 'chest', a.activeDef().id);
    g.step();
    expect(a.armsLevel).toBe(before + 1);
    expect(a.activeDef().id).toBe(mode.weaponFor(a.armsLevel));
    a.armsLevel = mode.finalLevel;
    run(g, 2);
    b.spawnProtectUntil = 0;
    g.applyDamage(b, a, 500, 'chest', 'goldknife');
    g.step();
    expect(mode.over).toBe(true);
    expect(mode.result(false).placement).toBe(1);
  });

  it('deathmatch respawns players and scores kills', () => {
    const m = createMatch({ mode: 'deathmatch', mapId: 'oasis', seed: 2, lobby: lobbyOf(2) });
    const g = m.game;
    const [a, b] = g.actors;
    run(g, 2);
    b.spawnProtectUntil = 0;
    g.applyDamage(b, a, 500, 'head', 'ak');
    g.step();
    expect(b.alive).toBe(false);
    expect(a.dmScore).toBeGreaterThanOrEqual(10);
    run(g, 2.5);
    expect(b.alive).toBe(true);
    expect((g.mode as DeathmatchMode).ffa).toBe(true);
  });

  it('training: targets can be shot and accuracy is tracked', () => {
    const m = createMatch({ mode: 'training', mapId: 'range', seed: 2, lobby: [{ name: 'Human', squad: 0, isBot: false, level: 0, skill: 0, model: 0 }] });
    const g = m.game;
    const tm = g.mode as TrainingMode;
    const h = g.human()!;
    const t = g.targets[0];
    const dx = t.pos.x - h.pos.x, dz = t.pos.z - h.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(t.pos.y + 1.3 - (h.pos.y + h.eyeHeight), Math.hypot(dx, dz));
    h.deployEnd = 0;
    script(g, h, () => ({ yaw, pitch, fire: true }));
    run(g, 1.5);
    expect(h.stats.shotsFired).toBeGreaterThan(3);
    expect(h.stats.shotsHit).toBeGreaterThan(0);
    expect(tm.hud().scoreThem).toBeGreaterThan(0);
  });
});

describe('full headless matches', () => {
  it('a complete bot-vs-bot competitive match finishes with a valid result', () => {
    const m = createMatch({ mode: 'competitive', mapId: 'depot', seed: 77, lobby: lobbyOf(5, 4, false), short: true });
    const g = m.game;
    const mode = g.mode as BombMode;
    let guard = 0;
    while (!mode.over && guard++ < 64 * 60 * 40) g.step();
    expect(mode.over).toBe(true);
    const r = mode.result(false);
    // first to 9 in MR8, or a legitimate 8:8 draw
    expect(Math.max(...r.scores) >= 9 || (r.scores[0] === 8 && r.scores[1] === 8)).toBe(true);
    expect(r.rounds.length).toBe(r.scores[0] + r.scores[1]);
    const kills = g.actors.reduce((s, a) => s + a.stats.kills, 0);
    expect(kills).toBeGreaterThan(20);
    // money never exceeds cap, health never negative
    for (const a of g.actors) { expect(a.money).toBeLessThanOrEqual(16000); expect(a.health).toBeGreaterThanOrEqual(0); }
  });

  it('wingman uses only site A and finishes', () => {
    const m = createMatch({ mode: 'wingman', mapId: 'canal', seed: 5, lobby: lobbyOf(2, 4, false) });
    const g = m.game;
    let plantedB = false;
    g.listeners.push(e => { if (e.type === 'planted' && e.site !== 'A') plantedB = true; });
    let guard = 0;
    while (!g.mode.over && guard++ < 64 * 60 * 30) g.step();
    expect(g.mode.over).toBe(true);
    expect(plantedB).toBe(false);
  });

  it('every map runs a few rounds without errors and bots get kills', () => {
    for (const id of ['sandstorm', 'oasis', 'villa', 'reactor', 'ruins', 'canal', 'skyline', 'depot', 'pharaoh']) {
      const m = createMatch({ mode: 'casual', mapId: id, seed: 11, lobby: lobbyOf(5, 5, false) });
      const g = m.game;
      run(g, 150);
      const kills = g.actors.reduce((s, a) => s + a.stats.kills, 0);
      expect(kills, id).toBeGreaterThan(3);
      expect(getMap(id).def.name.length).toBeGreaterThan(0);
    }
  });
});
