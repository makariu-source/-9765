// Player profile, settings and match-result processing (local single-player version).
// Results are applied idempotently by matchId; every rating change is appended to a
// ledger with a reason and never rewritten.
import type { MatchResult, ModeId } from '../sim/modes/mode';
import { hashString } from '../sim/rng';
import { clamp } from '../sim/math';
import { applyChallenges, isoWeek, weeklyChallenges, type ChallengeState } from './challenges';
import { newGlicko, updateGlicko, type Glicko } from './glicko';
import { matchRating, matchReport, type ReportItem } from './performance';
import { applyPro, newProState, type ProDelta, type ProState } from './proleague';
import { RANKS, rankFor, type RankDef, buildRanks, DEFAULT_RANK_THRESHOLDS } from './ranks';

export const PROFILE_VERSION = 1;
export const CALIBRATION_MATCHES = 10;
/** visible points granted at the end of calibration are capped (like most ladders) */
export const CALIBRATION_CAP = 1510;
const SALT = 'sz-local-v1';

export interface RankedTrack {
  mmr: Glicko;
  visible: number;
  calibrationLeft: number;
  wins: number; losses: number; draws: number;
  streak: number;
  lastTarget?: number;
  peakRank: number;
  rankHistory: { time: number; rankId: number; points: number }[];
  cooldownUntil: number;
  abandons: number;
  recentFingerprints: string[];
  recentPerf: number[];
}

export interface StatsBlock {
  matches: number; wins: number; losses: number; draws: number;
  kills: number; deaths: number; assists: number; damage: number; headshots: number;
  shotsFired: number; shotsHit: number; mvps: number; rounds: number; utilityDamage: number;
  enemiesFlashed: number; plants: number; defuses: number; clutches: number; entryKills: number;
  timePlayed: number;
}

export const emptyBlock = (): StatsBlock => ({
  matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0,
  shotsFired: 0, shotsHit: 0, mvps: 0, rounds: 0, utilityDamage: 0, enemiesFlashed: 0, plants: 0, defuses: 0,
  clutches: 0, entryKills: 0, timePlayed: 0,
});

export interface MatchEntry {
  matchId: string; time: number; mode: ModeId; map: string; outcome: 1 | 0.5 | 0; score: [number, number];
  kills: number; deaths: number; assists: number; adr: number; hs: number; rating: number; mvps: number;
  mmrDelta?: number; visibleDelta?: number; eloDelta?: number; placement?: number; vsAI: true; abandoned: boolean;
  flags: string[]; duration: number;
}

export interface LedgerEntry { time: number; matchId: string; system: 'mmr' | 'visible' | 'elo' | 'wingman'; before: number; after: number; reason: string }

export interface TouchButton { x: number; y: number; size: number }

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  volume: { master: number; sfx: number; music: number; ui: number };
  graphics: { quality: 'low' | 'medium' | 'high'; shadows: boolean; renderScale: number; particles: number; showFps: boolean };
  crosshair: { style: 'classic' | 'dot' | 'cross'; color: string; size: number; gap: number; thickness: number; dot: boolean; dynamic: boolean };
  controls: { scheme: 'auto' | 'desktop' | 'touch'; walkToggle: boolean; crouchToggle: boolean; bindings: Record<string, string> };
  touch: { buttons: Record<string, TouchButton>; opacity: number; sensitivity: number; aimAssist: boolean; joystickSize: number };
  viewBob: boolean;
  leftHanded: boolean;
  rankThresholds: number[];
  shortCompetitive: boolean;
}

export const DEFAULT_BINDINGS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ControlLeft', walk: 'ShiftLeft',
  reload: 'KeyR', use: 'KeyE', buy: 'KeyB', scoreboard: 'Tab', grenade: 'KeyG', inspect: 'KeyF', drop: 'KeyQ',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5', lastWeapon: 'KeyX',
};

export const DEFAULT_TOUCH: Record<string, TouchButton> = {
  fire: { x: 0.86, y: 0.62, size: 1.25 }, fireLeft: { x: 0.08, y: 0.62, size: 0.85 }, aim: { x: 0.94, y: 0.42, size: 0.8 },
  jump: { x: 0.93, y: 0.84, size: 0.9 }, crouch: { x: 0.80, y: 0.88, size: 0.85 }, reload: { x: 0.74, y: 0.66, size: 0.75 },
  weapon: { x: 0.65, y: 0.88, size: 0.75 }, grenade: { x: 0.72, y: 0.44, size: 0.75 }, use: { x: 0.62, y: 0.70, size: 0.75 },
  buy: { x: 0.24, y: 0.42, size: 0.7 }, scores: { x: 0.94, y: 0.08, size: 0.65 }, walk: { x: 0.06, y: 0.76, size: 0.7 },
};

export const defaultSettings = (): Settings => ({
  sensitivity: 1.6, invertY: false, fov: 90,
  volume: { master: 0.8, sfx: 0.9, music: 0.5, ui: 0.6 },
  graphics: { quality: 'medium', shadows: true, renderScale: 1, particles: 1, showFps: false },
  crosshair: { style: 'classic', color: '#4dff7a', size: 6, gap: 3, thickness: 2, dot: false, dynamic: true },
  controls: { scheme: 'auto', walkToggle: false, crouchToggle: false, bindings: { ...DEFAULT_BINDINGS } },
  touch: { buttons: JSON.parse(JSON.stringify(DEFAULT_TOUCH)), opacity: 0.55, sensitivity: 1.0, aimAssist: true, joystickSize: 1 },
  viewBob: true, leftHanded: false, rankThresholds: [...DEFAULT_RANK_THRESHOLDS], shortCompetitive: true,
});

export interface Profile {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  xp: number;
  level: number;
  competitive: RankedTrack;
  wingman: RankedTrack;
  pro: ProState;
  stats: { all: StatsBlock; byMode: Record<string, StatsBlock>; byMap: Record<string, StatsBlock>; byWeapon: Record<string, { kills: number; headshots: number }> };
  history: MatchEntry[];
  ledger: LedgerEntry[];
  processed: string[];
  challenges: { week: string; list: ChallengeState[] };
  settings: Settings;
  tampered?: boolean;
  integrity?: string;
}

const newTrack = (): RankedTrack => ({
  mmr: newGlicko(), visible: 0, calibrationLeft: CALIBRATION_MATCHES, wins: 0, losses: 0, draws: 0, streak: 0,
  peakRank: -1, rankHistory: [], cooldownUntil: 0, abandons: 0, recentFingerprints: [], recentPerf: [],
});

export function newProfile(name = 'Игрок', now = Date.now()): Profile {
  return {
    version: PROFILE_VERSION, id: hashString(`${name}-${now}-${Math.random()}`).toString(36), name, createdAt: now,
    xp: 0, level: 1, competitive: newTrack(), wingman: newTrack(), pro: newProState(now),
    stats: { all: emptyBlock(), byMode: {}, byMap: {}, byWeapon: {} },
    history: [], ledger: [], processed: [], challenges: { week: isoWeek(now), list: weeklyChallenges(isoWeek(now)) },
    settings: defaultSettings(),
  };
}

export const xpForLevel = (level: number) => 800 + level * 150;

export function ranksFor(p: Profile): RankDef[] {
  return p.settings.rankThresholds && p.settings.rankThresholds.length === RANKS.length ? buildRanks(p.settings.rankThresholds) : RANKS;
}

// ---------------------------------------------------------------------------
// Result processing

export interface ApplyContext {
  teamAvg: number;
  oppAvg: number;
  fingerprint: string;
  /** rating target used to build this lobby (stored for gradual adaptation) */
  target?: number;
}

export interface MatchSummary {
  duplicate: boolean;
  entry: MatchEntry | null;
  rating: number;
  report: ReportItem[];
  xpGain: number;
  levelBefore: number;
  levelAfter: number;
  mmr?: { before: number; after: number; visibleBefore: number; visibleAfter: number; rankBefore: RankDef | null; rankAfter: RankDef | null; calibrationLeft: number; rankUp: boolean; rankDown: boolean };
  pro?: ProDelta;
  challengesDone: ChallengeState[];
  flags: string[];
}

function addToBlock(b: StatsBlock, r: MatchResult, outcome: number): void {
  const me = r.players.find(p => p.id === r.humanId);
  if (!me) return;
  const s = me.stats;
  b.matches++;
  if (outcome === 1) b.wins++; else if (outcome === 0) b.losses++; else b.draws++;
  b.kills += s.kills; b.deaths += s.deaths; b.assists += s.assists; b.damage += s.damage; b.headshots += s.headshots;
  b.shotsFired += s.shotsFired; b.shotsHit += s.shotsHit; b.mvps += s.mvps; b.rounds += r.roundsPlayed;
  b.utilityDamage += s.utilityDamage; b.enemiesFlashed += s.enemiesFlashed; b.plants += s.plants; b.defuses += s.defuses;
  b.clutches += s.clutches; b.entryKills += s.entryKills; b.timePlayed += r.duration;
}

/** Detect results that must not earn rating (anti-abuse). */
export function integrityFlags(r: MatchResult): string[] {
  const flags: string[] = [];
  const me = r.players.find(p => p.id === r.humanId);
  if (!me) return ['no-player'];
  if (r.abandoned) flags.push('abandoned');
  if (r.afk) flags.push('afk');
  if (me.stats.teamKills >= 3) flags.push('teamkills');
  if (!r.ffa && r.roundsPlayed >= 8 && me.stats.damage / r.roundsPlayed < 4 && me.stats.shotsFired < r.roundsPlayed) flags.push('no-participation');
  // sanity checks against forged results
  if (me.stats.kills > Math.max(60, r.roundsPlayed * 5) || me.stats.headshots > me.stats.kills || me.stats.shotsHit > me.stats.shotsFired + me.stats.kills) flags.push('invalid-stats');
  if (r.scores.some(x => x < 0 || x > 100)) flags.push('invalid-score');
  return flags;
}

export function resultChecksum(r: MatchResult): string {
  const me = r.players.find(p => p.id === r.humanId);
  return hashString(`${r.matchId}|${r.mode}|${r.mapId}|${r.scores.join(':')}|${r.outcome}|${me?.stats.kills}|${me?.stats.deaths}|${SALT}`).toString(36);
}

function applyRanked(track: RankedTrack, p: Profile, r: MatchResult, ctx: ApplyContext, perf: number, flags: string[], system: 'mmr' | 'wingman', ranks: RankDef[]): MatchSummary['mmr'] {
  const before = track.mmr.r;
  const visibleBefore = track.visible;
  const rankBefore = track.calibrationLeft > 0 ? null : rankFor(track.visible, ranks);
  const blocked = flags.some(f => f !== 'abandoned');
  const s = flags.includes('abandoned') || flags.includes('afk') ? 0 : r.outcome;
  // opponent strength adjusted for the strength of our own teammates
  const opp: Glicko = { r: ctx.oppAvg + (track.mmr.r - ctx.teamAvg), rd: 80, vol: 0.06 };
  const next = updateGlicko(track.mmr, opp, s);
  let delta = next.r - track.mmr.r;
  const maxR = Math.max(1, Math.max(...r.scores));
  const margin = Math.abs(r.scores[0] - r.scores[1]) / maxR;
  const mMargin = 0.85 + 0.3 * Math.min(1, margin);
  const mPerf = s === 1 ? clamp(0.85 + (perf - 1) * 0.3, 0.75, 1.2) : s === 0 ? clamp(1.15 - (perf - 1) * 0.3, 0.8, 1.25) : 1;
  const mRepeat = track.recentFingerprints.includes(ctx.fingerprint) ? 0.5 : 1;
  delta *= mMargin * mPerf * mRepeat;
  if (blocked && delta > 0) delta = 0; // suspicious matches never gain rating
  if (flags.includes('abandoned')) delta -= 15;
  track.mmr = { ...next, r: before + delta };
  // visible points
  let vis = track.visible;
  if (track.calibrationLeft > 0) {
    track.calibrationLeft--;
    if (track.calibrationLeft === 0) vis = Math.min(track.mmr.r, CALIBRATION_CAP);
  } else {
    const conv = (track.mmr.r - vis) * 0.12;
    let v = Math.sign(delta) * (12 + Math.abs(delta) * 0.6) + conv;
    if (s === 1) v = Math.max(5, v);
    else if (s === 0) v = Math.min(-5, v);
    else v = conv * 0.5;
    if (blocked && v > 0) v = 0;
    vis = Math.max(0, vis + v);
  }
  track.visible = Math.round(vis);
  // record
  if (s === 1) { track.wins++; track.streak = Math.max(1, track.streak + 1); }
  else if (s === 0) { track.losses++; track.streak = Math.min(-1, track.streak - 1); }
  else { track.draws++; track.streak = 0; }
  track.recentFingerprints = [ctx.fingerprint, ...track.recentFingerprints].slice(0, 5);
  track.recentPerf = [perf, ...track.recentPerf].slice(0, 5);
  if (ctx.target !== undefined) track.lastTarget = ctx.target;
  const reason = flags.length ? `${r.outcome === 1 ? 'Победа' : r.outcome === 0 ? 'Поражение' : 'Ничья'} (${flags.join(', ')})` : r.outcome === 1 ? 'Победа' : r.outcome === 0 ? 'Поражение' : 'Ничья';
  p.ledger.push({ time: Date.now(), matchId: r.matchId, system, before, after: track.mmr.r, reason });
  p.ledger.push({ time: Date.now(), matchId: r.matchId, system: 'visible', before: visibleBefore, after: track.visible, reason });
  if (p.ledger.length > 400) p.ledger.splice(0, p.ledger.length - 400);
  const rankAfter = track.calibrationLeft > 0 ? null : rankFor(track.visible, ranks);
  if (rankAfter && (!rankBefore || rankAfter.id !== rankBefore.id)) {
    track.rankHistory.push({ time: Date.now(), rankId: rankAfter.id, points: track.visible });
    if (track.rankHistory.length > 100) track.rankHistory.shift();
  }
  if (rankAfter) track.peakRank = Math.max(track.peakRank, rankAfter.id);
  return {
    before, after: track.mmr.r, visibleBefore, visibleAfter: track.visible, rankBefore, rankAfter, calibrationLeft: track.calibrationLeft,
    rankUp: !!rankAfter && (!rankBefore || rankAfter.id > rankBefore.id), rankDown: !!rankAfter && !!rankBefore && rankAfter.id < rankBefore.id,
  };
}

export function applyMatchResult(p: Profile, r: MatchResult, ctx: ApplyContext, now = Date.now()): MatchSummary {
  const levelBefore = p.level;
  if (p.processed.includes(r.matchId)) {
    return { duplicate: true, entry: null, rating: 0, report: [], xpGain: 0, levelBefore, levelAfter: p.level, challengesDone: [], flags: ['duplicate'] };
  }
  const me = r.players.find(x => x.id === r.humanId);
  if (!me) return { duplicate: false, entry: null, rating: 0, report: [], xpGain: 0, levelBefore, levelAfter: p.level, challengesDone: [], flags: ['no-player'] };
  const flags = integrityFlags(r);
  p.processed.push(r.matchId);
  if (p.processed.length > 600) p.processed.splice(0, p.processed.length - 600);
  const minutes = r.duration / 60;
  const perf = matchRating(me.stats, r.roundsPlayed, minutes, r.ffa);
  const report = matchReport(me.stats, r.roundsPlayed, minutes, r.ffa);
  const summary: MatchSummary = { duplicate: false, entry: null, rating: perf, report, xpGain: 0, levelBefore, levelAfter: levelBefore, challengesDone: [], flags };
  const invalid = flags.includes('invalid-stats') || flags.includes('invalid-score');

  if (!invalid && r.mode !== 'training' && !r.custom) {
    if (r.mode === 'competitive') {
      summary.mmr = applyRanked(p.competitive, p, r, ctx, perf, flags, 'mmr', ranksFor(p));
      if (r.abandoned) { p.competitive.abandons++; p.competitive.cooldownUntil = now + 5 * 60000 * Math.pow(2, Math.min(4, p.competitive.abandons - 1)); }
    } else if (r.mode === 'wingman') {
      summary.mmr = applyRanked(p.wingman, p, r, ctx, perf, flags, 'wingman', ranksFor(p));
    } else if (r.mode === 'proleague') {
      const blocked = flags.some(f => f !== 'abandoned');
      summary.pro = applyPro(p.pro, {
        matchId: r.matchId, won: r.outcome === 1 && !blocked, draw: r.outcome === 0.5, left: r.abandoned, teamAvg: ctx.teamAvg, oppAvg: ctx.oppAvg,
        map: r.mapId, score: r.scores, kills: me.stats.kills, deaths: me.stats.deaths, rating: perf, time: now,
      });
      if (ctx.target !== undefined) p.pro.lastTarget = ctx.target;
      p.ledger.push({ time: now, matchId: r.matchId, system: 'elo', before: summary.pro.before, after: summary.pro.after, reason: summary.pro.reason });
    }
  }

  // stats (always recorded, separated per mode; every match here is against AI)
  if (!invalid && r.mode !== 'training') {
    addToBlock(p.stats.all, r, r.outcome);
    p.stats.byMode[r.mode] ??= emptyBlock();
    addToBlock(p.stats.byMode[r.mode], r, r.outcome);
    p.stats.byMap[r.mapId] ??= emptyBlock();
    addToBlock(p.stats.byMap[r.mapId], r, r.outcome);
    for (const [w, k] of Object.entries(me.stats.weaponKills)) {
      p.stats.byWeapon[w] ??= { kills: 0, headshots: 0 };
      p.stats.byWeapon[w].kills += k;
    }
  }

  // XP & challenges
  const xp = invalid ? 0 : Math.round(50 + me.stats.kills * 5 + me.stats.mvps * 20 + r.roundsPlayed * 5 + (r.outcome === 1 ? 120 : r.outcome === 0.5 ? 50 : 0) + (r.mode === 'training' ? -40 : 0));
  summary.xpGain = Math.max(0, xp);
  const week = isoWeek(now);
  if (p.challenges.week !== week) p.challenges = { week, list: weeklyChallenges(week) };
  if (!invalid && !flags.includes('abandoned')) {
    summary.challengesDone = applyChallenges(p.challenges.list, r);
    summary.xpGain += summary.challengesDone.reduce((a, c) => a + c.xp, 0);
  }
  p.xp += summary.xpGain;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; }
  summary.levelAfter = p.level;

  const rounds = Math.max(1, r.roundsPlayed);
  const entry: MatchEntry = {
    matchId: r.matchId, time: now, mode: r.mode, map: r.mapId, outcome: r.outcome, score: r.scores,
    kills: me.stats.kills, deaths: me.stats.deaths, assists: me.stats.assists, adr: Math.round(me.stats.damage / rounds),
    hs: me.stats.kills ? Math.round((me.stats.headshots / me.stats.kills) * 100) : 0, rating: perf, mvps: me.stats.mvps,
    mmrDelta: summary.mmr ? Math.round(summary.mmr.after - summary.mmr.before) : undefined,
    visibleDelta: summary.mmr ? summary.mmr.visibleAfter - summary.mmr.visibleBefore : undefined,
    eloDelta: summary.pro?.delta, placement: r.placement, vsAI: true, abandoned: r.abandoned, flags, duration: Math.round(r.duration),
  };
  if (r.mode !== 'training') {
    p.history.unshift(entry);
    if (p.history.length > 100) p.history.length = 100;
  }
  summary.entry = entry;
  return summary;
}

// ---------------------------------------------------------------------------
// Storage (localStorage in the browser; any Storage-like object in tests)

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const STORAGE_KEY = 'strikezone.profile.v1';

function checksum(p: Profile): string {
  const { integrity: _i, tampered: _t, ...rest } = p;
  return hashString(JSON.stringify(rest) + SALT).toString(36);
}

export function saveProfile(p: Profile, kv: KV | null): void {
  if (!kv) return;
  p.integrity = checksum(p);
  try { kv.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
}

/** Merge stored data onto defaults so new fields appear after updates (schema migration). */
function migrate(raw: Partial<Profile>): Profile {
  const base = newProfile(raw.name ?? 'Игрок', raw.createdAt ?? Date.now());
  const p: Profile = { ...base, ...raw } as Profile;
  p.settings = { ...base.settings, ...(raw.settings ?? {}) } as Settings;
  p.settings.volume = { ...base.settings.volume, ...(raw.settings?.volume ?? {}) };
  p.settings.graphics = { ...base.settings.graphics, ...(raw.settings?.graphics ?? {}) };
  p.settings.crosshair = { ...base.settings.crosshair, ...(raw.settings?.crosshair ?? {}) };
  p.settings.controls = { ...base.settings.controls, ...(raw.settings?.controls ?? {}) };
  p.settings.controls.bindings = { ...DEFAULT_BINDINGS, ...(raw.settings?.controls?.bindings ?? {}) };
  p.settings.touch = { ...base.settings.touch, ...(raw.settings?.touch ?? {}) };
  p.settings.touch.buttons = { ...base.settings.touch.buttons, ...(raw.settings?.touch?.buttons ?? {}) };
  p.competitive = { ...base.competitive, ...(raw.competitive ?? {}) };
  p.wingman = { ...base.wingman, ...(raw.wingman ?? {}) };
  p.pro = { ...base.pro, ...(raw.pro ?? {}) };
  p.stats = { ...base.stats, ...(raw.stats ?? {}) };
  p.version = PROFILE_VERSION;
  return p;
}

export function loadProfile(kv: KV | null): Profile {
  if (!kv) return newProfile();
  let txt: string | null = null;
  try { txt = kv.getItem(STORAGE_KEY); } catch { txt = null; }
  if (!txt) return newProfile();
  try {
    const raw = JSON.parse(txt) as Profile;
    const stored = raw.integrity;
    const p = migrate(raw);
    if (stored && stored !== checksum({ ...raw, integrity: undefined } as Profile) && !raw.tampered) p.tampered = true;
    return p;
  } catch {
    return newProfile();
  }
}
