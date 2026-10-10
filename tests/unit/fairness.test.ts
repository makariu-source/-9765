// Bots must not have hidden advantages: no wallhack, no seeing through smoke, blind when
// flashed, limited field of view, human-plausible reaction/turn limits, same weapons.
import { createMatch } from '../../src/match';
import type { LobbyPlayer } from '../../src/sim/modes/lobby';
import { BombMode } from '../../src/sim/modes/bomb';
import { FAIRNESS_LIMITS, profileFor } from '../../src/ai/difficulty';
import { Perception } from '../../src/ai/perception';
import { emptyInput } from '../../src/sim/types';
import type { Game } from '../../src/sim/game';

function duelSetup(level = 7) {
  const lobby: LobbyPlayer[] = [
    { name: 'Human', squad: 0, isBot: false, level: 0, skill: 0, model: 0 },
    { name: 'BOT X', squad: 1, isBot: true, level, skill: 0, model: 0 },
  ];
  const m = createMatch({ mode: 'competitive', mapId: 'range', seed: 9, lobby, humanStart: 'T' });
  const g = m.game;
  const mode = g.mode as BombMode;
  while (mode.phase !== 'live') g.step();
  const human = g.actors[0], bot = g.actors[1];
  // human controller: stand still, do nothing
  g.controllers.set(human.id, { think: () => emptyInput(human.yaw, 0) });
  return { m, g, human, bot, botCtl: m.director.bots[0] };
}

function freeze(g: Game, id: number) { g.controllers.set(id, { think: (_g, a) => emptyInput(a.yaw, a.pitch) }); }

describe('bot fairness', () => {
  it('cannot see an enemy behind a wall', () => {
    const { g, human, bot } = duelSetup();
    // recoil wall on the range is at cells x 32..36, row 4 (z 8..10)
    human.pos = { x: 69, y: 0.02, z: 6 };
    bot.pos = { x: 69, y: 0.02, z: 14 };
    bot.yaw = 0; // facing -Z, toward the wall and the human behind it
    const p = new Perception(bot, profileFor(7));
    for (let i = 0; i < 200; i++) { p.update(g); g.time += 1 / 64; }
    expect(p.visible.has(human.id)).toBe(false);
    expect(p.acquired(g)).not.toContain(human.id);
  });

  it('sees an enemy in the open only after its reaction time', () => {
    const { g, human, bot } = duelSetup();
    human.pos = { x: 40, y: 0.02, z: 20 };
    bot.pos = { x: 40, y: 0.02, z: 40 };
    bot.yaw = 0;
    const prof = profileFor(7);
    const p = new Perception(bot, prof);
    p.update(g);
    expect(p.visible.has(human.id)).toBe(true);
    expect(p.acquired(g)).not.toContain(human.id);
    const t0 = g.time;
    while (g.time - t0 < prof.reaction + 0.02) { g.time += 1 / 64; p.update(g); }
    expect(p.acquired(g)).toContain(human.id);
  });

  it('does not see enemies behind its back (field of view)', () => {
    const { g, human, bot } = duelSetup();
    human.pos = { x: 40, y: 0.02, z: 20 };
    bot.pos = { x: 40, y: 0.02, z: 40 };
    bot.yaw = Math.PI; // facing +Z, away from the human
    const p = new Perception(bot, profileFor(7));
    p.update(g);
    expect(p.visible.has(human.id)).toBe(false);
  });

  it('smoke blocks vision', () => {
    const { g, human, bot } = duelSetup();
    human.pos = { x: 40, y: 0.02, z: 20 };
    bot.pos = { x: 40, y: 0.02, z: 40 };
    bot.yaw = 0;
    g.smokes.push({ id: 999, pos: { x: 40, y: 1.2, z: 30 }, born: g.time - 3, radius: 3.6, owner: human.id });
    const p = new Perception(bot, profileFor(7));
    p.update(g);
    expect(p.visible.has(human.id)).toBe(false);
  });

  it('a flashed bot is blind', () => {
    const { g, human, bot } = duelSetup();
    human.pos = { x: 40, y: 0.02, z: 20 };
    bot.pos = { x: 40, y: 0.02, z: 40 };
    bot.yaw = 0;
    bot.flashEnd = g.time + 3; bot.flashStrength = 1;
    const p = new Perception(bot, profileFor(7));
    p.update(g);
    expect(p.visible.has(human.id)).toBe(false);
  });

  it('a silent hidden enemy never appears in bot memory', () => {
    const { g, human, bot, botCtl } = duelSetup();
    freeze(g, human.id);
    human.pos = { x: 69, y: 0.02, z: 6 };   // behind the recoil wall
    human.crouchAmt = 1;
    bot.pos = { x: 69, y: 0.02, z: 20 };
    for (let i = 0; i < 64 * 20; i++) g.step();
    expect(botCtl.perception.memory.has(human.id)).toBe(false);
    expect(human.alive).toBe(true);
  });

  it('difficulty profiles respect human-plausible limits at every level', () => {
    for (let l = 1; l <= 7; l += 0.5) {
      const p = profileFor(l);
      expect(p.reaction).toBeGreaterThanOrEqual(FAIRNESS_LIMITS.minReaction);
      expect(p.turnRate).toBeLessThanOrEqual(FAIRNESS_LIMITS.maxTurnRate);
      expect(p.aimError).toBeGreaterThanOrEqual(FAIRNESS_LIMITS.minAimError);
    }
  });

  it('higher difficulty never changes damage, health or ammo', () => {
    const { g, bot } = duelSetup(7);
    expect(bot.health).toBe(100);
    const w = bot.activeWeapon()!;
    const ref = { ...w.def };
    for (let i = 0; i < 64 * 3; i++) g.step();
    expect(w.def.damage).toBe(ref.damage);
    expect(w.clip).toBeLessThanOrEqual(w.def.mag);
  });
});
