import { createMatch } from '../src/match';
import type { LobbyPlayer } from '../src/sim/modes/lobby';
import { BombMode } from '../src/sim/modes/bomb';
const mapId = process.argv[2] ?? 'sandstorm';
const lvA = Number(process.argv[3] ?? 4), lvB = Number(process.argv[4] ?? 4);
const lobby: LobbyPlayer[] = [];
for (let i = 0; i < 10; i++) lobby.push({ name: `Bot${i}`, squad: i < 5 ? 0 : 1, isBot: true, level: i < 5 ? lvA : lvB, skill: 1000, model: i % 4 });
const m = createMatch({ mode: 'competitive', mapId, seed: Number(process.argv[5] ?? 7), lobby, short: true });
const g = m.game;
const t0 = Date.now();
const mode = g.mode as BombMode;
const reasons: Record<string, number> = {};
let kills = 0, nades: Record<string, number> = {}, plants = 0, defuses = 0, radios = 0;
g.listeners.push(e => {
  if (e.type === 'round_end') { reasons[e.reason] = (reasons[e.reason] ?? 0) + 1; console.log(`R${mode.round} ${e.winner} ${e.reason} t=${(g.time - mode.liveStart).toFixed(0)}s score ${mode.scores}`); }
  if (e.type === 'kill') kills++;
  if (e.type === 'detonate') nades[e.grenade] = (nades[e.grenade] ?? 0) + 1;
  if (e.type === 'planted') plants++;
  if (e.type === 'defused') defuses++;
  if (e.type === 'radio') radios++;
});
while (!g.mode.over && g.time < 3600) g.step();
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's real,', g.time.toFixed(0), 's game');
console.log({ scores: mode.scores, reasons, kills, nades, plants, defuses, radios });
for (const a of g.actors) console.log(a.name, a.team, 'K', a.stats.kills, 'D', a.stats.deaths, 'A', a.stats.assists, 'ADR', (a.stats.damage / Math.max(1, mode.rounds.length)).toFixed(0), 'HS%', a.stats.kills ? Math.round(a.stats.headshots / a.stats.kills * 100) : 0, 'acc', a.stats.shotsFired ? Math.round(a.stats.shotsHit / a.stats.shotsFired * 100) : 0, '$', a.money);
