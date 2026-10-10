// PRO League: an independent ELO ladder with its own calibration, levels, seasons,
// leaderboard (AI participants, clearly marked), leave penalties and stricter matchmaking.
import { Rng, hashString } from '../sim/rng';
import { clamp } from '../sim/math';
import { DEFAULT_PRO_LEVELS, proLevelFor, type LevelDef } from './ranks';
import { botName } from './matchmaking';

export const PRO_START_ELO = 1000;
export const PRO_CALIBRATION = 5;
export const PRO_K_CALIBRATION = 50;
export const PRO_K = 32;
export const PRO_LEAVE_PENALTY = 50;
export const SEASON_LENGTH_DAYS = 56;
const SEASON_EPOCH = Date.UTC(2026, 0, 5);

export interface ProMatchEntry { matchId: string; time: number; map: string; won: boolean; score: [number, number]; eloBefore: number; eloAfter: number; kills: number; deaths: number; rating: number; season: number; left: boolean }

export interface AiParticipant { id: string; name: string; elo: number; matches: number; wins: number; kd: number; hs: number; favMap: string; isAI: true }

export interface SeasonStats { season: number; matches: number; wins: number; peakElo: number; kills: number; deaths: number; startElo: number }

export interface ProState {
  elo: number;
  matches: number;
  wins: number;
  losses: number;
  calibrationLeft: number;
  peakElo: number;
  history: ProMatchEntry[];
  season: number;
  seasons: SeasonStats[];
  leaves: number;
  banUntil: number;
  league: AiParticipant[];
  leagueSeason: number;
  levels: LevelDef[];
  lastTarget?: number;
  streak: number;
}

export function seasonOf(time: number): number {
  return Math.max(1, Math.floor((time - SEASON_EPOCH) / (SEASON_LENGTH_DAYS * 86400000)) + 1);
}

export function seasonEnds(season: number): number {
  return SEASON_EPOCH + season * SEASON_LENGTH_DAYS * 86400000;
}

export function newProState(now = Date.now()): ProState {
  const season = seasonOf(now);
  return {
    elo: PRO_START_ELO, matches: 0, wins: 0, losses: 0, calibrationLeft: PRO_CALIBRATION, peakElo: PRO_START_ELO,
    history: [], season, seasons: [{ season, matches: 0, wins: 0, peakElo: PRO_START_ELO, kills: 0, deaths: 0, startElo: PRO_START_ELO }],
    leaves: 0, banUntil: 0, league: generateLeague(season), leagueSeason: season, levels: DEFAULT_PRO_LEVELS, streak: 0,
  };
}

const MAPS = ['sandstorm', 'oasis', 'villa', 'reactor', 'ruins', 'canal', 'skyline', 'depot', 'pharaoh'];

export function generateLeague(season: number, n = 60): AiParticipant[] {
  const rng = new Rng(hashString(`pro-season-${season}`));
  const out: AiParticipant[] = [];
  for (let i = 0; i < n; i++) {
    const elo = Math.round(clamp(1150 + rng.gauss() * 380, 150, 3100));
    const matches = rng.int(15, 400);
    const wr = clamp(0.5 + (elo - 1150) / 4000 + rng.gauss() * 0.03, 0.3, 0.75);
    out.push({
      id: `ai-${season}-${i}`, name: botName(rng), elo, matches, wins: Math.round(matches * wr),
      kd: Math.round(clamp(1 + (elo - 1150) / 1500 + rng.gauss() * 0.1, 0.5, 2.2) * 100) / 100,
      hs: Math.round(clamp(42 + (elo - 1150) / 60 + rng.gauss() * 5, 20, 70)), favMap: rng.pick(MAPS), isAI: true,
    });
  }
  return out;
}

/** AI participants keep playing between the human's matches (deterministic drift). */
export function driftLeague(st: ProState, matchSeed: number): void {
  const rng = new Rng(matchSeed ^ 0xa5a5a5);
  for (const p of st.league) {
    const games = rng.int(0, 2);
    for (let g = 0; g < games; g++) {
      const win = rng.chance(clamp(0.5 + (1150 - p.elo) / 3000, 0.35, 0.65));
      p.elo = Math.max(100, p.elo + (win ? 1 : -1) * rng.int(18, 30));
      p.matches++; if (win) p.wins++;
    }
  }
}

export function expectedScore(teamAvg: number, oppAvg: number): number {
  return 1 / (1 + Math.pow(10, (oppAvg - teamAvg) / 400));
}

export interface ProDelta { before: number; after: number; delta: number; levelBefore: LevelDef; levelAfter: LevelDef; reason: string }

/**
 * Apply a PRO League match. Outcome-only ELO (like the original ladder): every player of the
 * winning team gains, every player of the losing team loses. Leaving adds a fixed penalty.
 */
export function applyPro(st: ProState, p: { matchId: string; won: boolean; draw: boolean; left: boolean; teamAvg: number; oppAvg: number; map: string; score: [number, number]; kills: number; deaths: number; rating: number; time: number }): ProDelta {
  const before = st.elo;
  const levelBefore = proLevelFor(before, st.levels);
  // season rollover
  const season = seasonOf(p.time);
  if (season !== st.season) {
    st.season = season;
    st.seasons.push({ season, matches: 0, wins: 0, peakElo: st.elo, kills: 0, deaths: 0, startElo: st.elo });
  }
  if (st.leagueSeason !== season) { st.league = generateLeague(season); st.leagueSeason = season; }
  const K = st.calibrationLeft > 0 ? PRO_K_CALIBRATION : PRO_K;
  const E = expectedScore(p.teamAvg, p.oppAvg);
  const S = p.left ? 0 : p.draw ? 0.5 : p.won ? 1 : 0;
  let delta = Math.round(K * (S - E));
  if (!p.draw) {
    if (S === 1) delta = Math.max(5, delta);
    else delta = Math.min(-5, delta);
  }
  let reason = p.won ? 'Победа' : p.draw ? 'Ничья' : 'Поражение';
  if (p.left) {
    delta -= PRO_LEAVE_PENALTY;
    st.leaves++;
    // escalating queue ban: 15 min, 30, 60...
    st.banUntil = p.time + 15 * 60000 * Math.pow(2, Math.min(4, st.leaves - 1));
    reason = 'Выход из матча (штраф)';
  }
  st.elo = Math.max(100, st.elo + delta);
  st.matches++;
  if (p.won && !p.left) { st.wins++; st.streak = Math.max(1, st.streak + 1); }
  else if (!p.draw) { st.losses++; st.streak = Math.min(-1, st.streak - 1); }
  if (st.calibrationLeft > 0) st.calibrationLeft--;
  st.peakElo = Math.max(st.peakElo, st.elo);
  const ss = st.seasons[st.seasons.length - 1];
  ss.matches++; if (p.won) ss.wins++; ss.kills += p.kills; ss.deaths += p.deaths; ss.peakElo = Math.max(ss.peakElo, st.elo);
  st.history.unshift({ matchId: p.matchId, time: p.time, map: p.map, won: p.won, score: p.score, eloBefore: before, eloAfter: st.elo, kills: p.kills, deaths: p.deaths, rating: p.rating, season, left: p.left });
  if (st.history.length > 100) st.history.length = 100;
  driftLeague(st, hashString(p.matchId));
  return { before, after: st.elo, delta: st.elo - before, levelBefore, levelAfter: proLevelFor(st.elo, st.levels), reason };
}

export function leaderboard(st: ProState, humanName: string): { name: string; elo: number; isAI: boolean; isYou: boolean; level: number; matches: number; winrate: number; id: string }[] {
  const rows = st.league.map(p => ({ name: p.name, elo: p.elo, isAI: true, isYou: false, level: proLevelFor(p.elo, st.levels).level, matches: p.matches, winrate: p.matches ? p.wins / p.matches : 0, id: p.id }));
  if (st.calibrationLeft === 0) rows.push({ name: humanName, elo: st.elo, isAI: false, isYou: true, level: proLevelFor(st.elo, st.levels).level, matches: st.matches, winrate: st.matches ? st.wins / st.matches : 0, id: 'you' });
  rows.sort((a, b) => b.elo - a.elo);
  return rows;
}

/** Stricter matchmaking: search window starts at ±50 ELO and widens slowly. */
export function searchWindow(secondsInQueue: number): number {
  return Math.min(200, 50 + Math.floor(secondsInQueue / 5) * 25);
}
