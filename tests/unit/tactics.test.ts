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
    expect(Object.keys(t).filter(k => k !== 'ct-reposition')).toEqual([]);
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
