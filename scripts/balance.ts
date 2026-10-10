import { createMatch } from '../src/match';
import type { LobbyPlayer } from '../src/sim/modes/lobby';
import { MAP_DEFS } from '../src/sim/maps/maps';
const lv = Number(process.argv[2] ?? 5);
const seeds = (process.argv[3] ?? '21').split(',').map(Number);
let TT = 0, CC = 0;
const t0 = Date.now();
const only = process.argv[4]?.split(',');
for (const d of MAP_DEFS.filter(x => !only || only.includes(x.id))) for (const seed of seeds) {
  const lobby: LobbyPlayer[] = [];
  for (let i = 0; i < 10; i++) lobby.push({ name: `Bot${i}`, squad: i < 5 ? 0 : 1, isBot: true, level: lv, skill: 1000, model: i % 4 });
  const m = createMatch({ mode: 'competitive', mapId: d.id, seed, lobby, short: true });
  const g = m.game; let t = 0, c = 0, plants = 0, expl = 0, def = 0;
  g.listeners.push(e => { if (e.type === 'round_end') e.winner === 'T' ? t++ : c++; if (e.type === 'planted') plants++; if (e.type === 'bomb_exploded') expl++; if (e.type === 'defused') def++; });
  while (!g.mode.over && g.time < 3600) g.step();
  TT += t; CC += c;
  console.log(d.id.padEnd(10), 'seed', seed, 'T', t, 'CT', c, 'plants', plants, 'expl', expl, 'defuse', def);
}
console.log('total T', TT, 'CT', CC, 'T%', Math.round(TT / (TT + CC) * 100), 'time', ((Date.now() - t0) / 1000).toFixed(0) + 's');
