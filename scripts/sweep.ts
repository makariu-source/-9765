// Bot-vs-bot balance sweep: every map at one difficulty, several seeds; one JSON line per round.
// Usage: tsx scripts/sweep.ts <level 1..7> <seeds csv>
import { createMatch } from '../src/match';
import type { LobbyPlayer } from '../src/sim/modes/lobby';
import { MAP_DEFS } from '../src/sim/maps/maps';
import { BombMode } from '../src/sim/modes/bomb';
const lv = Number(process.argv[2]);
const seeds = process.argv[3].split(',').map(Number);
for (const d of MAP_DEFS) for (const seed of seeds) {
  const lobby: LobbyPlayer[] = [];
  for (let i = 0; i < 10; i++) lobby.push({ name: `Bot${i}`, squad: i < 5 ? 0 : 1, isBot: true, level: lv, skill: 1000, model: i % 4 });
  const m = createMatch({ mode: 'competitive', mapId: d.id, seed: seed * 7919 + lv * 131, lobby, short: true });
  const g = m.game; const mode = g.mode as BombMode;
  const brains = m.director.brains;
  let planted = false, firstKill: string | null = null, kT = 0, kCT = 0, site = '', behind = 0;
  let pickups: { why: string; from?: string; to: string }[] = [];
  let roleKills: Record<string, number> = {};
  let before: Record<string, number> = {};
  const snapshot = () => { const t: Record<string, number> = {}; for (const b of brains) for (const [k, v] of Object.entries(b.tactics)) t[`${k}`] = (t[k] ?? 0) + v; return t; };
  g.listeners.push((e: any) => {
    if (e.type === 'round_start') { planted = false; firstKill = null; kT = 0; kCT = 0; site = ''; behind = 0; pickups = []; roleKills = {}; before = snapshot(); }
    if (e.type === 'planted') { planted = true; site = e.site ?? ''; }
    if (e.type === 'pickup') { const b = m.director.bots.find(x => x.actor.id === e.actor); pickups.push({ why: b?.lastPickupWhy || 'other', from: e.from, to: e.weapon }); }
    if (e.type === 'kill') {
      const k = g.actors[e.killer]; const v = g.actors[e.victim];
      if (k && v && k.team !== v.team) {
        if (!firstKill) firstKill = k.team; k.team === 'T' ? kT++ : kCT++;
        const dx = k.pos.x - v.pos.x, dz = k.pos.z - v.pos.z, l = Math.hypot(dx, dz) || 1;
        if ((dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw)) / l < -0.2) behind++;
        const role = brains[k.squad]?.roleOf(k.id) ?? '?'; roleKills[role] = (roleKills[role] ?? 0) + 1;
      }
    }
    if (e.type === 'round_end') {
      const now = snapshot(); const tac: Record<string, number> = {};
      for (const [k, v] of Object.entries(now)) if (v - (before[k] ?? 0) > 0) tac[k] = v - (before[k] ?? 0);
      console.log(JSON.stringify({ map: d.id, lv, seed, round: mode.round, winner: e.winner, reason: e.reason, planted, site, firstKill, kT, kCT, t: Math.round(g.time - mode.liveStart), behind, pickups, tac, roleKills }));
    }
  });
  while (!g.mode.over && g.time < 3600) g.step();
}
