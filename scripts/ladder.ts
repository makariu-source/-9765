// Difficulty ladder: team of level A vs team of level B, swapping sides, several maps.
import { createMatch } from '../src/match';
import type { LobbyPlayer } from '../src/sim/modes/lobby';
import { BombMode } from '../src/sim/modes/bomb';
const pairs: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [1, 4], [3, 7]];
const maps = ['sandstorm', 'depot', 'oasis'];
for (const [a, b] of pairs) {
  let ra = 0, rb = 0, ka = 0, kb = 0;
  for (const map of maps) {
    const lobby: LobbyPlayer[] = [];
    for (let i = 0; i < 10; i++) lobby.push({ name: `B${i}`, squad: i < 5 ? 0 : 1, isBot: true, level: i < 5 ? a : b, skill: 0, model: 0 });
    const m = createMatch({ mode: 'competitive', mapId: map, seed: 100 + a * 10 + b, lobby, short: true });
    const g = m.game; const mode = g.mode as BombMode;
    while (!mode.over && g.time < 3000) g.step();
    ra += mode.scores[0]; rb += mode.scores[1];
    for (const x of g.actors) { if (x.squad === 0) ka += x.stats.kills; else kb += x.stats.kills; }
  }
  console.log(`L${a} vs L${b}: rounds ${ra}-${rb} (${Math.round(rb / (ra + rb) * 100)}% for L${b}), kills ${ka}-${kb}`);
}
