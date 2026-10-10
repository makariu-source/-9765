// Visible competitive ranks (on visible rank points) and PRO League levels (on ELO).
export interface RankDef { id: number; name: string; min: number; color: string; tier: string; shape: 'chevron' | 'shield' | 'star' | 'crown' | 'gem' }

const tiers: [string, string, RankDef['shape']][] = [
  ['Новичок', '#8a8f98', 'chevron'], ['Бронза', '#b0703c', 'chevron'], ['Серебро', '#c0c8d4', 'shield'],
  ['Золото', '#e8b93c', 'shield'], ['Платина', '#4fd1c5', 'star'], ['Алмаз', '#63a4ff', 'gem'],
];
const roman = ['I', 'II', 'III'];

/** Default thresholds. They are fixed numbers (not percentiles) so the top rank is always reachable. */
export const DEFAULT_RANK_THRESHOLDS = [
  0, 600, 700, 800, 870, 940, 1000, 1060, 1120, 1180, 1240, 1300, 1370, 1440, 1510, 1590, 1670, 1750,
  1850, 1975, 2100, 2250,
];

export function buildRanks(thresholds = DEFAULT_RANK_THRESHOLDS): RankDef[] {
  const out: RankDef[] = [];
  let id = 0;
  for (const [tname, color, shape] of tiers) {
    for (const r of roman) { out.push({ id, name: `${tname} ${r}`, min: thresholds[id], color, tier: tname, shape }); id++; }
  }
  out.push({ id: id, name: 'Мастер', min: thresholds[id], color: '#b36bff', tier: 'Мастер', shape: 'crown' }); id++;
  out.push({ id: id, name: 'Великий мастер', min: thresholds[id], color: '#ff6b9a', tier: 'Великий мастер', shape: 'crown' }); id++;
  out.push({ id: id, name: 'Элитный мастер', min: thresholds[id], color: '#ff4d4d', tier: 'Элитный мастер', shape: 'crown' }); id++;
  out.push({ id: id, name: 'Легенда', min: thresholds[id], color: '#ffd700', tier: 'Легенда', shape: 'crown' });
  return out;
}

export const RANKS = buildRanks();

export function rankFor(points: number, ranks = RANKS): RankDef {
  let r = ranks[0];
  for (const x of ranks) if (points >= x.min) r = x;
  return r;
}

export function rankProgress(points: number, ranks = RANKS): { rank: RankDef; next: RankDef | null; frac: number } {
  const rank = rankFor(points, ranks);
  const next = ranks[rank.id + 1] ?? null;
  const frac = next ? Math.max(0, Math.min(1, (points - rank.min) / (next.min - rank.min))) : 1;
  return { rank, next, frac };
}

// --- PRO League levels -------------------------------------------------------

export interface LevelDef { level: number; name: string; min: number; max: number; color: string }

export const DEFAULT_PRO_LEVELS: LevelDef[] = [
  { level: 1, name: 'Начинающий', min: 0, max: 500, color: '#e6e6e6' },
  { level: 2, name: 'Базовый', min: 501, max: 750, color: '#1ce400' },
  { level: 3, name: 'Развивающийся', min: 751, max: 900, color: '#1ce400' },
  { level: 4, name: 'Уверенный', min: 901, max: 1050, color: '#ffc800' },
  { level: 5, name: 'Продвинутый', min: 1051, max: 1200, color: '#ffc800' },
  { level: 6, name: 'Опытный', min: 1201, max: 1350, color: '#ffc800' },
  { level: 7, name: 'Мастер', min: 1351, max: 1530, color: '#ffc800' },
  { level: 8, name: 'Элитный', min: 1531, max: 1750, color: '#ff6309' },
  { level: 9, name: 'Выдающийся', min: 1751, max: 2000, color: '#ff6309' },
  { level: 10, name: 'Высший уровень', min: 2001, max: Infinity, color: '#fe1f00' },
];

export function proLevelFor(elo: number, levels = DEFAULT_PRO_LEVELS): LevelDef {
  for (const l of levels) if (elo <= l.max) return l;
  return levels[levels.length - 1];
}

export function proLevelProgress(elo: number, levels = DEFAULT_PRO_LEVELS): { level: LevelDef; frac: number; toNext: number } {
  const level = proLevelFor(elo, levels);
  if (!isFinite(level.max)) return { level, frac: 1, toNext: 0 };
  return { level, frac: Math.max(0, Math.min(1, (elo - level.min) / (level.max - level.min))), toNext: level.max + 1 - elo };
}

/** SVG emblem for a rank (generated, original artwork). */
export function rankEmblemSvg(r: RankDef, size = 64): string {
  const c = r.color;
  const sub = r.id < 18 ? (r.id % 3) + 1 : 0;
  const pips = Array.from({ length: sub }, (_, i) => `<circle cx="${22 + i * 10}" cy="54" r="3" fill="${c}"/>`).join('');
  let body = '';
  switch (r.shape) {
    case 'chevron': body = `<path d="M12 18 L32 30 L52 18 L52 28 L32 42 L12 28 Z" fill="${c}" opacity=".95"/><path d="M12 30 L32 44 L52 30 L52 36 L32 50 L12 36Z" fill="${c}" opacity=".55"/>`; break;
    case 'shield': body = `<path d="M32 6 L54 14 L52 34 Q48 46 32 54 Q16 46 12 34 L10 14 Z" fill="${c}" opacity=".9"/><path d="M32 14 L44 19 L43 32 Q40 40 32 45 Q24 40 21 32 L20 19 Z" fill="#0b0f16" opacity=".35"/>`; break;
    case 'star': body = `<path d="M32 6 L39 24 L58 25 L43 37 L48 56 L32 45 L16 56 L21 37 L6 25 L25 24 Z" fill="${c}"/>`; break;
    case 'gem': body = `<path d="M18 10 L46 10 L58 26 L32 58 L6 26 Z" fill="${c}"/><path d="M18 10 L32 26 L46 10 M6 26 L58 26 M32 26 L32 58" stroke="#0b0f16" stroke-opacity=".35" stroke-width="2" fill="none"/>`; break;
    case 'crown': body = `<path d="M8 46 L12 16 L24 30 L32 10 L40 30 L52 16 L56 46 Z" fill="${c}"/><rect x="8" y="46" width="48" height="8" rx="2" fill="${c}" opacity=".7"/>`; break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${r.name}">${body}${pips}</svg>`;
}

export function proLevelBadgeSvg(l: LevelDef, size = 40): string {
  const frac = (l.level / 10) * 2 * Math.PI;
  const x = 20 + 16 * Math.sin(frac), y = 20 - 16 * Math.cos(frac);
  const large = l.level > 5 ? 1 : 0;
  const arc = l.level === 10 ? `<circle cx="20" cy="20" r="16" fill="none" stroke="${l.color}" stroke-width="3"/>` : `<path d="M20 4 A16 16 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}" fill="none" stroke="${l.color}" stroke-width="3" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="Level ${l.level}"><circle cx="20" cy="20" r="18" fill="#12161f"/><circle cx="20" cy="20" r="16" fill="none" stroke="#2a3140" stroke-width="3"/>${arc}<text x="20" y="25" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="14" fill="${l.color}">${l.level}</text></svg>`;
}
