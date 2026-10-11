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
  // optional ablations for experiments: ABLATE=nopickup,holds4,notactics
  const ab = process.env.ABLATE ?? '';
  if (ab.includes('nopickup')) for (const b of m.director.bots) (b as unknown as { pickupGoal: () => null }).pickupGoal = () => null;
  if (ab.includes('holds4')) g.analysis.holds = ['A', 'B'].flatMap(s => g.analysis.holds.filter(h => h.site === s).slice(0, 4));
  if (ab.includes('notactics')) for (const b of m.director.brains) (b as unknown as { specialChance: () => number }).specialChance = () => 0;
  const brains = m.director.brains;
  let planted = false, firstKill: string | null = null, kT = 0, kCT = 0, site = '', behind = 0;
  let pickups: { why: string; from?: string; to: string }[] = [];
  let roleKills: Record<string, number> = {};
  let before: Record<string, number> = {};
  // problem detectors: bots that make no progress toward their goal (not fighting), bots
  // outside the map or with broken positions
  let stuck: string[] = [], broken = 0;
  const hist = new Map<number, { x: number; z: number; t: number; flagged: boolean }>();
  g.onTick.push(() => {
    if (g.tick % 16) return;
    for (const b of m.director.bots) {
      const a = b.actor;
      if (!a.alive) { hist.delete(a.id); continue; }
      if (!Number.isFinite(a.pos.x + a.pos.y + a.pos.z) || a.pos.y < -2 || !g.nav.isWalk(Math.floor(a.pos.x / 2), Math.floor(a.pos.z / 2)) && a.grounded) broken++;
      const gl = b.goal as { kind: string; pos?: { x: number; z: number }; reason?: string };
      const far = gl.pos && Math.hypot(gl.pos.x - a.pos.x, gl.pos.z - a.pos.z) > 2.5;
      const busy = g.time - a.lastShot < 2 || (b as unknown as { targetId: number }).targetId >= 0 || a.planting > 0 || a.defusing > 0 || !g.mode.canMove(a);
      const h = hist.get(a.id);
      if (!far || busy || !h || Math.hypot(a.pos.x - h.x, a.pos.z - h.z) > 1.5) { hist.set(a.id, { x: a.pos.x, z: a.pos.z, t: g.time, flagged: false }); continue; }
      if (g.time - h.t > 4 && !h.flagged) { h.flagged = true; stuck.push(`${Math.floor(a.pos.x / 2)},${Math.floor(a.pos.z / 2)} ${a.team} ${gl.kind}/${gl.reason ?? ''}`); }
    }
  });
  const snapshot = () => { const t: Record<string, number> = {}; for (const b of brains) for (const [k, v] of Object.entries(b.tactics)) t[`${k}`] = (t[k] ?? 0) + v; return t; };
  g.listeners.push((e: any) => {
    // (tactics are planned inside round_start by the bot director, so the tactic counter is
    // diffed from one round_end to the next)
    if (e.type === 'round_start') { stuck = []; broken = 0; planted = false; firstKill = null; kT = 0; kCT = 0; site = ''; behind = 0; pickups = []; roleKills = {}; }
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
      before = now;
      // savers who were still alive when the round ended (weapons kept)
      const saved = m.director.bots.filter(b => b.saving && b.actor.alive).map(b => b.actor.team);
      const savers = m.director.bots.filter(b => b.saving).length;
      console.log(JSON.stringify({ map: d.id, lv, seed, round: mode.round, winner: e.winner, reason: e.reason, planted, site, firstKill, kT, kCT, t: Math.round(g.time - mode.liveStart), behind, pickups, tac, roleKills, savers, saved, stuck, broken }));
    }
  });
  while (!g.mode.over && g.time < 3600) g.step();
}
