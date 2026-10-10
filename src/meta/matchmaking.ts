// Adaptive lobby generation. All lobbies are filled with bots, clearly labelled as AI.
// Bot strength comes only from difficulty profile (decision quality), never stat boosts.
import type { LobbyPlayer } from '../sim/modes/lobby';
import { Rng } from '../sim/rng';
import { clamp, lerp } from '../sim/math';

const MMR_ANCHORS: [number, number][] = [[500, 1], [750, 2], [950, 3], [1150, 4], [1350, 5], [1600, 6], [1900, 7]];

/** Hidden MMR (Glicko scale) -> fractional bot difficulty level 1..7. */
export function mmrToBotLevel(mmr: number): number {
  if (mmr <= MMR_ANCHORS[0][0]) return 1;
  for (let i = 1; i < MMR_ANCHORS.length; i++) {
    const [r1, l1] = MMR_ANCHORS[i];
    const [r0, l0] = MMR_ANCHORS[i - 1];
    if (mmr <= r1) return l0 + ((mmr - r0) / (r1 - r0)) * (l1 - l0);
  }
  return 7;
}

export function botLevelToMmr(level: number): number {
  const l = clamp(level, 1, 7);
  for (let i = 1; i < MMR_ANCHORS.length; i++) {
    const [r1, l1] = MMR_ANCHORS[i];
    const [r0, l0] = MMR_ANCHORS[i - 1];
    if (l <= l1) return r0 + ((l - l0) / (l1 - l0)) * (r1 - r0);
  }
  return 1900;
}

/**
 * PRO League ELO -> bot level. Levels 1–3: basic bots, 4–6: experienced, 7–8: elite,
 * 9–10: the most advanced tactical bots (higher coordination/adaptation/utility — still
 * the same ballistics, vision and economy as everyone else).
 */
export function eloToBotLevel(elo: number): number {
  const pts: [number, number][] = [[100, 1.8], [900, 3.2], [901, 3.8], [1350, 5.0], [1351, 5.6], [1750, 6.3], [1751, 6.6], [2400, 7]];
  if (elo <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (elo <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (elo - pts[i - 1][0]) / Math.max(1, pts[i][0] - pts[i - 1][0]));
  }
  return 7;
}

export interface AdaptiveInput {
  rating: number;
  /** positive = win streak, negative = loss streak */
  streak: number;
  /** recent performance ratings (1.0 = average) */
  recentPerf: number[];
  /** previous target, for gradual changes */
  prevTarget?: number;
  maxStep?: number;
}

/**
 * Target opponent strength: player's rating, nudged by streaks and recent form, and moved
 * gradually from the previous target. Never guarantees a result: it only picks opponents.
 */
export function adaptiveTarget(inp: AdaptiveInput): number {
  const s = inp.streak;
  const streakAdj = s >= 2 ? Math.min(75, (s - 1) * 15) : s <= -2 ? Math.max(-75, (s + 1) * 15) : 0;
  const perf = inp.recentPerf.length ? inp.recentPerf.reduce((a, b) => a + b, 0) / inp.recentPerf.length : 1;
  const perfAdj = clamp((perf - 1) * 60, -40, 40);
  const raw = inp.rating + streakAdj + perfAdj;
  if (inp.prevTarget === undefined) return raw;
  const step = inp.maxStep ?? 50;
  return inp.prevTarget + clamp(raw - inp.prevTarget, -step, step);
}

const SYL_A = ['Vor', 'Kal', 'Mir', 'Zan', 'Tor', 'Lek', 'Rav', 'Bran', 'Dez', 'Fyn', 'Gor', 'Hal', 'Ivo', 'Jax', 'Kor', 'Lun', 'Mak', 'Nox', 'Orn', 'Pax', 'Quin', 'Ros', 'Syl', 'Tak', 'Ulf', 'Vex', 'Wex', 'Yar', 'Zed'];
const SYL_B = ['in', 'ek', 'os', 'ar', 'ius', 'en', 'ov', 'ix', 'el', 'an', 'or', 'ash', 'um', 'ey', 'ko'];

export function botName(rng: Rng): string {
  return `BOT ${rng.pick(SYL_A)}${rng.pick(SYL_B)}`;
}

export interface LobbyRequest {
  humanName: string;
  /** rating used for team balance (MMR or ELO scale) */
  humanRating: number;
  /** target bot level (fractional) for opponents */
  targetLevel: number;
  teamSize: number;
  seed: number;
  /** rating scale for display of bot skill numbers */
  scale: 'mmr' | 'elo';
  /** max spread of individual bot levels around the target */
  spread?: number;
  /** FFA: everyone vs everyone (squad = index) */
  ffa?: boolean;
  /** player count for FFA */
  ffaCount?: number;
}

export interface LobbyResult {
  lobby: LobbyPlayer[];
  teamAvg: number;
  oppAvg: number;
  fingerprint: string;
}

/** Build a balanced lobby: opponents around the target; allies chosen so team averages match. */
export function buildLobby(req: LobbyRequest): LobbyResult {
  const rng = new Rng(req.seed);
  const spread = req.spread ?? 0.35;
  const toRating = (level: number) => req.scale === 'mmr' ? botLevelToMmr(level) : levelToElo(level);
  const human: LobbyPlayer = { name: req.humanName, squad: 0, isBot: false, level: 0, skill: Math.round(req.humanRating), model: 0 };
  const used = new Set<string>([req.humanName]);
  const mk = (squad: number, level: number): LobbyPlayer => {
    let name = botName(rng);
    while (used.has(name)) name = botName(rng);
    used.add(name);
    const lv = clamp(level, 1, 7);
    const skill = Math.round(toRating(lv) + rng.range(-25, 25));
    return { name, squad, isBot: true, level: Math.round(lv * 100) / 100, skill, model: rng.int(0, 3), style: rng.int(0, 1e6) };
  };
  const lobby: LobbyPlayer[] = [human];
  if (req.ffa) {
    const n = (req.ffaCount ?? 8) - 1;
    for (let i = 0; i < n; i++) lobby.push({ ...mk(i + 1, req.targetLevel + rng.range(-spread, spread)) });
    const avg = lobby.filter(p => p.isBot).reduce((s, p) => s + p.skill, 0) / Math.max(1, n);
    return { lobby, teamAvg: req.humanRating, oppAvg: avg, fingerprint: fingerprint(lobby) };
  }
  // opponents: levels with mean exactly target
  const opp: number[] = [];
  for (let i = 0; i < req.teamSize; i++) opp.push(req.targetLevel + rng.range(-spread, spread));
  const mean = opp.reduce((a, b) => a + b, 0) / opp.length;
  for (let i = 0; i < opp.length; i++) opp[i] += req.targetLevel - mean;
  // allies: comparable skill; team average (human counted by rating) equals opponents
  const humanLevel = req.scale === 'mmr' ? mmrLevelFromRating(req.humanRating) : eloLevelFromRating(req.humanRating);
  const nAllies = req.teamSize - 1;
  const allyMean = nAllies > 0 ? clamp((req.targetLevel * req.teamSize - humanLevel) / nAllies, req.targetLevel - 0.6, req.targetLevel + 0.6) : 0;
  for (let i = 0; i < nAllies; i++) lobby.push(mk(0, allyMean + rng.range(-spread * 0.7, spread * 0.7)));
  for (const l of opp) lobby.push(mk(1, l));
  const team = lobby.filter(p => p.squad === 0), them = lobby.filter(p => p.squad === 1);
  const avg = (ps: LobbyPlayer[]) => ps.reduce((s, p) => s + p.skill, 0) / Math.max(1, ps.length);
  return { lobby, teamAvg: avg(team), oppAvg: avg(them), fingerprint: fingerprint(lobby) };
}

function mmrLevelFromRating(r: number): number { return mmrToBotLevel(r); }
function eloLevelFromRating(r: number): number { return eloToBotLevel(r); }

export function levelToElo(level: number): number {
  // inverse of eloToBotLevel (monotonic search)
  let lo = 100, hi = 2600;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (eloToBotLevel(mid) < level) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export function fingerprint(lobby: LobbyPlayer[]): string {
  return lobby.filter(p => p.isBot).map(p => `${p.name}:${Math.round(p.level * 10)}`).sort().join('|');
}
