import { expected, newGlicko, updateGlicko } from '../../src/meta/glicko';
import { DEFAULT_PRO_LEVELS, RANKS, buildRanks, proLevelFor, rankFor, rankProgress } from '../../src/meta/ranks';
import { applyPro, expectedScore, newProState, leaderboard, PRO_LEAVE_PENALTY } from '../../src/meta/proleague';
import { adaptiveTarget, buildLobby, eloToBotLevel, mmrToBotLevel } from '../../src/meta/matchmaking';
import { applyMatchResult, integrityFlags, loadProfile, newProfile, resultChecksum, saveProfile, type KV } from '../../src/meta/profile';
import { emptyStats } from '../../src/sim/types';
import type { MatchResult } from '../../src/sim/modes/mode';

function fakeResult(over: Partial<MatchResult> = {}, statsOver: Partial<ReturnType<typeof emptyStats>> = {}): MatchResult {
  const stats = { ...emptyStats(), kills: 18, deaths: 12, assists: 4, damage: 1800, headshots: 8, shotsFired: 300, shotsHit: 90, mvps: 3, roundsPlayed: 20, ...statsOver };
  return {
    matchId: `m-${Math.random()}`, mode: 'competitive', mapId: 'sandstorm', startedAt: 0, duration: 1800, scores: [13, 7], outcome: 1,
    winnerSquad: 0, players: [{ id: 0, name: 'Me', squad: 0, isBot: false, botLevel: 0, skillRating: 1000, stats }],
    humanId: 0, rounds: [], abandoned: false, afk: false, ffa: false, vsBots: true, mvpId: 0, roundsPlayed: 20, ...over,
  };
}

const memKV = (): KV & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
};

describe('Glicko-2 MMR', () => {
  it('winning raises and losing lowers rating; expected score is symmetric', () => {
    const p = newGlicko(), o = newGlicko();
    expect(expected(p, o)).toBeCloseTo(0.5);
    expect(updateGlicko(p, o, 1).r).toBeGreaterThan(p.r);
    expect(updateGlicko(p, o, 0).r).toBeLessThan(p.r);
    expect(updateGlicko(p, o, 1).rd).toBeLessThan(p.rd);
  });
  it('beating a stronger opponent gives more than beating a weaker one', () => {
    const p = { r: 1000, rd: 100, vol: 0.06 };
    const strong = { r: 1300, rd: 80, vol: 0.06 }, weak = { r: 700, rd: 80, vol: 0.06 };
    expect(updateGlicko(p, strong, 1).r - p.r).toBeGreaterThan(updateGlicko(p, weak, 1).r - p.r);
  });
  it('new players (high RD) move faster than established ones', () => {
    const fresh = newGlicko(), old = { r: 1000, rd: 50, vol: 0.06 };
    const o = { r: 1000, rd: 80, vol: 0.06 };
    expect(updateGlicko(fresh, o, 1).r - fresh.r).toBeGreaterThan(updateGlicko(old, o, 1).r - old.r);
  });
});

describe('ranks', () => {
  it('maps points to ranks with progress and a reachable top rank', () => {
    expect(rankFor(0).name).toBe('Новичок I');
    expect(rankFor(1000).name).toBe('Серебро I');
    expect(rankFor(99999).name).toBe('Легенда');
    const top = RANKS[RANKS.length - 1];
    expect(isFinite(top.min)).toBe(true);
    const pr = rankProgress(1030);
    expect(pr.rank.name).toBe('Серебро I');
    expect(pr.frac).toBeCloseTo(0.5);
  });
  it('custom thresholds are respected', () => {
    const r = buildRanks(RANKS.map((_, i) => i * 100));
    expect(rankFor(250, r).id).toBe(2);
  });
  it('PRO League levels follow ELO ranges', () => {
    expect(proLevelFor(400).level).toBe(1);
    expect(proLevelFor(1000).level).toBe(4);
    expect(proLevelFor(1600).level).toBe(8);
    expect(proLevelFor(2500).level).toBe(10);
    expect(DEFAULT_PRO_LEVELS).toHaveLength(10);
  });
});

describe('PRO League ELO', () => {
  it('outcome decides the sign; calibration uses larger K; leaving is penalised', () => {
    const st = newProState(Date.UTC(2026, 9, 10));
    const base = { won: true, draw: false, left: false, teamAvg: 1000, oppAvg: 1000, map: 'sandstorm', score: [13, 9] as [number, number], kills: 20, deaths: 10, rating: 1.2, time: Date.UTC(2026, 9, 10) };
    const d1 = applyPro(st, { ...base, matchId: 'a' });
    expect(d1.delta).toBe(25); // K=50 * 0.5
    expect(st.calibrationLeft).toBe(4);
    const d2 = applyPro(st, { ...base, matchId: 'b', won: false, kills: 40 });
    expect(d2.delta).toBeLessThan(0); // high K/D cannot turn a loss into a gain
    const before = st.elo;
    const d3 = applyPro(st, { ...base, matchId: 'c', won: false, left: true });
    expect(st.elo).toBeLessThan(before - PRO_LEAVE_PENALTY);
    expect(st.banUntil).toBeGreaterThan(base.time);
    expect(d3.reason).toContain('Выход');
  });
  it('expected score uses team averages', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.85);
  });
  it('leaderboard marks AI participants and hides uncalibrated players', () => {
    const st = newProState();
    const lb = leaderboard(st, 'Me');
    expect(lb.every(r => r.isAI)).toBe(true);
    st.calibrationLeft = 0;
    expect(leaderboard(st, 'Me').some(r => r.isYou && !r.isAI)).toBe(true);
  });
});

describe('matchmaking', () => {
  it('higher rating -> stronger bots, monotonic', () => {
    let prev = 0;
    for (const r of [400, 700, 1000, 1300, 1700, 2100]) { const l = mmrToBotLevel(r); expect(l).toBeGreaterThanOrEqual(prev); prev = l; }
    expect(eloToBotLevel(500)).toBeLessThan(3.3);
    expect(eloToBotLevel(1200)).toBeGreaterThan(3.7);
    expect(eloToBotLevel(1600)).toBeGreaterThan(5.5);
    expect(eloToBotLevel(2200)).toBeGreaterThan(6.5);
  });
  it('adaptive target moves gradually and reacts to streaks', () => {
    expect(adaptiveTarget({ rating: 1000, streak: 4, recentPerf: [], prevTarget: 1000 })).toBe(1045);
    expect(adaptiveTarget({ rating: 1000, streak: -4, recentPerf: [], prevTarget: 1000 })).toBe(955);
    expect(adaptiveTarget({ rating: 1400, streak: 0, recentPerf: [], prevTarget: 1000 })).toBe(1050); // capped step
  });
  it('lobbies label bots and balance team averages', () => {
    const r = buildLobby({ humanName: 'Me', humanRating: 1000, targetLevel: 3.5, teamSize: 5, seed: 1, scale: 'mmr' });
    expect(r.lobby).toHaveLength(10);
    expect(r.lobby.filter(p => p.isBot).every(p => p.name.startsWith('BOT '))).toBe(true);
    expect(Math.abs(r.teamAvg - r.oppAvg)).toBeLessThan(120);
    const opp = r.lobby.filter(p => p.squad === 1);
    const meanLevel = opp.reduce((a, p) => a + p.level, 0) / opp.length;
    expect(meanLevel).toBeCloseTo(3.5, 1);
  });
});

describe('profile & anti-abuse', () => {
  const ctx = { teamAvg: 1000, oppAvg: 1000, fingerprint: 'x' };
  it('applies a result once (idempotent by matchId)', () => {
    const p = newProfile('Me');
    const r = fakeResult();
    const a = applyMatchResult(p, r, ctx);
    expect(a.duplicate).toBe(false);
    const b = applyMatchResult(p, r, ctx);
    expect(b.duplicate).toBe(true);
    expect(p.history).toHaveLength(1);
    expect(p.stats.all.matches).toBe(1);
  });
  it('calibration hides rank for 10 matches, then reveals capped visible points', () => {
    const p = newProfile('Me');
    for (let i = 0; i < 9; i++) applyMatchResult(p, fakeResult(), ctx);
    expect(p.competitive.calibrationLeft).toBe(1);
    expect(p.competitive.visible).toBe(0);
    const s = applyMatchResult(p, fakeResult(), ctx);
    expect(p.competitive.calibrationLeft).toBe(0);
    expect(s.mmr!.rankAfter).not.toBeNull();
    expect(p.competitive.visible).toBeLessThanOrEqual(1510);
  });
  it('losses never increase rating even with great stats; wins never decrease it', () => {
    const p = newProfile('Me');
    p.competitive.calibrationLeft = 0; p.competitive.visible = 1000;
    const before = p.competitive.mmr.r, vBefore = p.competitive.visible;
    applyMatchResult(p, fakeResult({ outcome: 0, scores: [11, 13] }, { kills: 40, deaths: 5, damage: 4000 }), ctx);
    expect(p.competitive.mmr.r).toBeLessThan(before);
    expect(p.competitive.visible).toBeLessThan(vBefore);
    const b2 = p.competitive.mmr.r, v2 = p.competitive.visible;
    applyMatchResult(p, fakeResult({ outcome: 1 }, { kills: 2, headshots: 1, deaths: 20, damage: 300 }), ctx);
    expect(p.competitive.mmr.r).toBeGreaterThan(b2);
    expect(p.competitive.visible).toBeGreaterThan(v2);
  });
  it('AFK / forged results never gain rating; ledger keeps reasons', () => {
    const p = newProfile('Me');
    const before = p.competitive.mmr.r;
    applyMatchResult(p, fakeResult({ afk: true }), ctx);
    expect(p.competitive.mmr.r).toBeLessThanOrEqual(before);
    expect(p.ledger.some(l => l.reason.includes('afk'))).toBe(true);
    const forged = fakeResult({}, { kills: 999, headshots: 999 });
    expect(integrityFlags(forged)).toContain('invalid-stats');
    const s = applyMatchResult(p, forged, ctx);
    expect(s.xpGain).toBe(0);
  });
  it('repeat rosters earn reduced rating', () => {
    const p1 = newProfile('A'), p2 = newProfile('B');
    applyMatchResult(p1, fakeResult(), { ...ctx, fingerprint: 'same' });
    applyMatchResult(p2, fakeResult(), { ...ctx, fingerprint: 'first' });
    const g1 = applyMatchResult(p1, fakeResult(), { ...ctx, fingerprint: 'same' });
    const g2 = applyMatchResult(p2, fakeResult(), { ...ctx, fingerprint: 'other' });
    expect(g1.mmr!.after - g1.mmr!.before).toBeLessThan(g2.mmr!.after - g2.mmr!.before);
  });
  it('abandoning competitive counts as loss and sets a cooldown', () => {
    const p = newProfile('Me');
    applyMatchResult(p, fakeResult({ abandoned: true, outcome: 0 }), ctx);
    expect(p.competitive.losses).toBe(1);
    expect(p.competitive.cooldownUntil).toBeGreaterThan(Date.now());
  });
  it('MMR and PRO League ELO are independent', () => {
    const p = newProfile('Me');
    const mmr0 = p.competitive.mmr.r, elo0 = p.pro.elo;
    applyMatchResult(p, fakeResult({ mode: 'proleague' }), ctx);
    expect(p.pro.elo).toBeGreaterThan(elo0);
    expect(p.competitive.mmr.r).toBe(mmr0);
    applyMatchResult(p, fakeResult({ mode: 'competitive', outcome: 0 }), ctx);
    expect(p.pro.elo).toBeGreaterThan(elo0);
  });
  it('casual and deathmatch do not change ratings', () => {
    const p = newProfile('Me');
    const mmr0 = p.competitive.mmr.r, elo0 = p.pro.elo;
    applyMatchResult(p, fakeResult({ mode: 'casual' }), ctx);
    applyMatchResult(p, fakeResult({ mode: 'deathmatch', ffa: true, placement: 1 }), ctx);
    expect(p.competitive.mmr.r).toBe(mmr0);
    expect(p.pro.elo).toBe(elo0);
    expect(p.stats.byMode.casual.matches).toBe(1);
  });
  it('persists and detects tampering', () => {
    const kv = memKV();
    const p = newProfile('Me');
    applyMatchResult(p, fakeResult(), ctx);
    saveProfile(p, kv);
    const loaded = loadProfile(kv);
    expect(loaded.history).toHaveLength(1);
    expect(loaded.tampered).toBeFalsy();
    const raw = JSON.parse(kv.data['strikezone.profile.v1']);
    raw.pro.elo = 3000;
    kv.data['strikezone.profile.v1'] = JSON.stringify(raw);
    expect(loadProfile(kv).tampered).toBe(true);
  });
  it('result checksum changes when the score is forged', () => {
    const r = fakeResult();
    const c = resultChecksum(r);
    expect(resultChecksum({ ...r, scores: [13, 0] })).not.toBe(c);
  });
});
