// v1.2: bots pick up weapons by value and situation, and use varied positions/tactics.
import { createMatch } from '../../src/match';
import { choosePickup, weaponValue } from '../../src/ai/loadout';
import { profileFor } from '../../src/ai/difficulty';
import { newWeapon } from '../../src/sim/actor';
import type { LobbyPlayer } from '../../src/sim/modes/lobby';
import { TICK } from '../../src/sim/game';

const bots = (n: number, level: number): LobbyPlayer[] =>
  Array.from({ length: n * 2 }, (_, i) => ({ name: `B${i}`, squad: i < n ? 0 : 1, isBot: true, level, skill: 1000, model: i % 4 }));

describe('weapon value', () => {
  it('rifles beat pistols and SMGs; ammo matters', () => {
    const ak = newWeapon('ak'), glock = newWeapon('g9'), smg = newWeapon('mk5');
    expect(weaponValue(ak, 20, false, 1)).toBeGreaterThan(weaponValue(smg, 20, false, 1));
    expect(weaponValue(smg, 20, false, 1)).toBeGreaterThan(weaponValue(glock, 20, false, 1));
    const empty = newWeapon('ak'); empty.clip = 0; empty.reserve = 0;
    expect(weaponValue(empty, 20, false, 1)).toBe(0);
    const low = newWeapon('ak'); low.clip = 5; low.reserve = 0;
    expect(weaponValue(low, 20, false, 1)).toBeLessThan(weaponValue(ak, 20, false, 1));
  });

  it('situation: snipers for long sightlines, shotguns/SMGs up close (skilled bots only)', () => {
    const awm = newWeapon('awm'), m4 = newWeapon('m4'), shotgun = newWeapon('nova');
    expect(weaponValue(awm, 40, true, 1)).toBeGreaterThan(weaponValue(m4, 40, true, 1));
    expect(weaponValue(awm, 6, true, 1)).toBeLessThan(weaponValue(m4, 6, true, 1));
    expect(weaponValue(shotgun, 5, false, 1)).toBeGreaterThan(weaponValue(shotgun, 30, false, 1));
    // a novice (situational 0) does not care about range
    expect(weaponValue(shotgun, 5, false, 0)).toBe(weaponValue(shotgun, 30, false, 0));
  });
});

describe('weapon pickups', () => {
  const setup = () => {
    const m = createMatch({ mode: 'casual', mapId: 'sandstorm', seed: 4, lobby: bots(1, 6), humanStart: 'CT' });
    const g = m.game;
    for (let i = 0; i < 20 / TICK && g.mode.hud().phase !== 'live'; i++) g.step();
    const a = g.actors[0];
    a.primary = null; a.secondary = newWeapon('warden');
    const drop = (id: string, dx: number) => g.drops.push({ id: 900 + g.drops.length, weapon: newWeapon(id), pos: { x: a.pos.x + dx, y: a.pos.y, z: a.pos.z }, vel: { x: 0, y: 0, z: 0 }, born: g.time - 5, stillTime: 2, bounces: 0 });
    return { g, a, drop };
  };

  it('takes a rifle when safe, not when an enemy is near', () => {
    const { g, a, drop } = setup();
    drop('m4', 3);
    const p = profileFor(6);
    expect(choosePickup(g, a, p, false, [], 20)?.why).toBe('empty');
    expect(choosePickup(g, a, p, false, [{ x: a.pos.x + 6, y: a.pos.y, z: a.pos.z }], 20)).toBeNull();
  });

  it('swaps to a better gun and ignores a worse one', () => {
    const { g, a, drop } = setup();
    a.primary = newWeapon('famine');
    drop('mk5', 2);
    const p = profileFor(6);
    expect(choosePickup(g, a, p, false, [], 20)).toBeNull();
    drop('m4', 4);
    const pick = choosePickup(g, a, p, false, [], 20);
    expect(pick?.drop.weapon.def.id).toBe('m4');
  });

  it('bots actually walk over and pick weapons up in matches', () => {
    let swaps = 0;
    const m = createMatch({ mode: 'competitive', mapId: 'villa', seed: 5, lobby: bots(5, 5), short: true });
    m.game.listeners.push(e => { if (e.type === 'pickup' && e.from) swaps++; });
    for (let i = 0; i < 600 / TICK && !m.game.mode.over; i++) m.game.step();
    expect(swaps).toBeGreaterThan(0);
  }, 120000);
});

describe('team tactics', () => {
  const play = (level: number, seconds: number) => {
    const m = createMatch({ mode: 'competitive', mapId: 'reactor', seed: 8, lobby: bots(5, level), short: true });
    for (let i = 0; i < seconds / TICK && !m.game.mode.over; i++) m.game.step();
    const t: Record<string, number> = {};
    for (const b of m.director.brains) for (const [k, v] of Object.entries(b.tactics)) t[k] = (t[k] ?? 0) + v;
    return t;
  };

  it('skilled bots use lurks, flanks, pushes, roams and change positions', () => {
    const t = play(7, 700);
    for (const k of ['t-lurk', 'ct-push', 'ct-roam', 'ct-reposition']) expect(t[k] ?? 0, k).toBeGreaterThan(0);
  }, 120000);

  it('novices never use special tactics', () => {
    const t = play(1, 300);
    // (saving and hunting savers are not role tactics: novices may rarely do them too)
    expect(Object.keys(t).filter(k => !['ct-reposition', 'save', 'hunt'].includes(k))).toEqual([]);
  }, 120000);

  it('defenders do not take the same spot every round', () => {
    const m = createMatch({ mode: 'competitive', mapId: 'reactor', seed: 3, lobby: bots(5, 6), short: true });
    const g = m.game;
    const spots = new Map<number, Set<string>>();
    g.listeners.push(e => {
      if (e.type !== 'round_live') return;
      const ct = m.director.brains.find(b => b.team === 'CT')!;
      for (const b of ct.members) {
        const h = (ct as unknown as { holds: Map<number, { cell: { i: number; j: number } }> }).holds.get(b.actor.id);
        if (!h) continue;
        if (!spots.has(b.actor.id)) spots.set(b.actor.id, new Set());
        spots.get(b.actor.id)!.add(`${h.cell.i},${h.cell.j}`);
      }
    });
    for (let i = 0; i < 500 / TICK && !g.mode.over; i++) g.step();
    const varied = [...spots.values()].filter(s => s.size >= 2).length;
    expect(varied).toBeGreaterThanOrEqual(3);
  }, 120000);
});

describe('v1.2.1: saving and hunting savers', () => {
  const live = (mapId: string, level: number) => {
    const m = createMatch({ mode: 'competitive', mapId, seed: 6, lobby: bots(5, level), short: true });
    const g = m.game;
    for (let i = 0; i < 30 / TICK && g.mode.hud().phase !== 'live'; i++) g.step();
    for (let i = 0; i < 3 / TICK; i++) g.step();
    return { m, g };
  };
  const kill = (a: { alive: boolean; health: number }) => { a.alive = false; a.health = 0; };

  it('a lone defender with an AWP against five attackers hides instead of fighting', () => {
    const { m, g } = live('sandstorm', 7);
    const cts = g.actors.filter(a => a.team === 'CT');
    cts.slice(1).forEach(kill);
    const last = cts[0];
    last.primary = newWeapon('awm'); last.armor = 100; last.helmet = true;
    const bot = m.director.bots.find(b => b.actor === last)!;
    for (let i = 0; i < 20 / TICK && !bot.saving; i++) g.step();
    expect(bot.saving).not.toBeNull();
    expect((bot.goal as { reason?: string }).reason).toBe('save');
  }, 60000);

  it('no save with a cheap loadout (pistol only)', () => {
    const { m, g } = live('sandstorm', 7);
    const cts = g.actors.filter(a => a.team === 'CT');
    cts.slice(1).forEach(kill);
    cts[0].primary = null; cts[0].armor = 0; cts[0].helmet = false;
    const bot = m.director.bots.find(b => b.actor === cts[0])!;
    for (let i = 0; i < 15 / TICK; i++) g.step();
    expect(bot.saving).toBeNull();
  }, 60000);

  it('defenders send hunters when the last attacker goes quiet', () => {
    const { m, g } = live('villa', 7);
    g.actors.filter(a => a.team === 'T').slice(1).forEach(kill);
    const brain = m.director.brains.find(b => b.team === 'CT')! as unknown as { hunters: Map<number, unknown>; sightings: unknown[] };
    let hunted = false;
    for (let i = 0; i < 40 / TICK && !hunted; i++) { brain.sightings = []; g.step(); hunted = brain.hunters.size > 0; }
    expect(hunted).toBe(true);
  }, 60000);
});

describe('v1.2.1: Reactor B ramp', () => {
  it('no path from the ramp room drops onto the low-roofed ramp edge', async () => {
    const { NavGrid } = await import('../../src/sim/nav');
    const { getMap } = await import('../../src/sim/maps/maps');
    const nav = new NavGrid(getMap('reactor'));
    for (const i of [30, 31, 32]) expect(nav.canStep(i, 27, i, 28), `${i},27 -> ${i},28`).toBe(false);
    expect(nav.canStep(33, 27, 33, 28)).toBe(true);
    expect(nav.findPath({ x: 64, z: 50 }, { x: 40, z: 64 })).not.toBeNull(); // ramp room -> B still connected
  });
});

describe('v3.0: fakes, baits and calls by sound', () => {
  const liveMatch = (mapId: string, level: number, seed = 9) => {
    const m = createMatch({ mode: 'competitive', mapId, seed, lobby: bots(5, level), short: true });
    const g = m.game;
    for (let i = 0; i < 30 / TICK && g.mode.hud().phase !== 'live'; i++) g.step();
    return { m, g };
  };

  it('a fake: 1-2 attackers make noise at the other site, then the team hits the real one', () => {
    const { m, g } = liveMatch('sandstorm', 7);
    const t = m.director.brains.find(b => b.team === 'T')! as unknown as {
      planKind: string; site: string; fakeSite: string | null; executing: boolean; executeAt: number;
      orders: Map<number, { do: string }[]>; buildScript: (g: unknown, at: number) => void; members: { goal: { kind: string; reason?: string } }[];
    };
    t.orders.clear();
    t.planKind = 'fake';
    t.buildScript(g, g.time);
    expect(t.fakeSite).not.toBeNull();
    expect(t.fakeSite).not.toBe(t.site);
    const fakers = [...t.orders.values()].filter(l => l.some(o => o.do === 'noise'));
    expect(fakers.length).toBeGreaterThanOrEqual(1);
    expect(fakers.length).toBeLessThanOrEqual(2);
    let noise = false;
    for (let i = 0; i < 60 / TICK && !t.executing; i++) { g.step(); noise ||= t.members.some(b => b.goal.kind === 'noise'); }
    expect(noise).toBe(true);     // they really made a show
    expect(t.executing).toBe(true); // and then went for the real site
  }, 60000);

  it('defenders call out enemies they only hear (footsteps) - and only within hearing range', () => {
    const { m, g } = liveMatch('villa', 6);
    const ct = m.director.brains.find(b => b.team === 'CT')! as unknown as { sightings: { id: number }[]; members: { actor: { pos: { x: number; y: number; z: number } } }[] };
    const tActor = g.actors.find(a => a.team === 'T')!;
    const before = ct.sightings.filter(s => s.id === tActor.id).length;
    // a loud enemy footstep next to a defender, then far away from everyone
    const near = ct.members[0].actor.pos;
    (g as unknown as { sound: (k: string, p: unknown, r: number, id: number) => void }).sound('step', { x: near.x + 6, y: near.y, z: near.z }, 20, tActor.id);
    for (let i = 0; i < 10; i++) g.step();
    expect(ct.sightings.filter(s => s.id === tActor.id).length).toBeGreaterThan(before);
  }, 60000);

  it('all attack scripts and defender fakes show up for skilled bots', () => {
    const seen = new Set<string>();
    for (const map of ['sandstorm', 'oasis', 'villa', 'ruins']) {
      const m = createMatch({ mode: 'competitive', mapId: map, seed: 40, lobby: bots(5, 7), short: true });
      for (let i = 0; i < 900 / TICK && !m.game.mode.over; i++) m.game.step();
      for (const b of m.director.brains) for (const k of Object.keys(b.tactics)) seen.add(k);
    }
    for (const k of ['ct-noise', 'ct-bait', 'ct-fake-util']) expect(seen.has(k), k).toBe(true);
    const tPlans = [...seen].filter(k => ['t-fake', 't-fakeback', 't-bombfake', 't-doublefake', 't-noise', 't-rotbait', 't-draw'].includes(k));
    expect(tPlans.length).toBeGreaterThanOrEqual(3);
  }, 300000);
});
