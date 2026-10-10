// Weekly challenges: deterministic per ISO week, progress from real match results.
import type { MatchResult } from '../sim/modes/mode';
import { Rng, hashString } from '../sim/rng';
import { WEAPONS } from '../sim/weapons';

export interface ChallengeState { id: string; text: string; goal: number; progress: number; xp: number; done: boolean; kind: string; param?: string }

export function isoWeek(time: number): string {
  const d = new Date(time);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MAP_NAMES: Record<string, string> = { sandstorm: 'Sandstorm', oasis: 'Oasis', villa: 'Villa', reactor: 'Reactor', ruins: 'Ruins', canal: 'Canal', skyline: 'Skyline', depot: 'Depot', pharaoh: 'Pharaoh' };

export function weeklyChallenges(week: string): ChallengeState[] {
  const rng = new Rng(hashString(`weekly-${week}`));
  const map = rng.pick(Object.keys(MAP_NAMES));
  const cls = rng.pick(['rifle', 'pistol', 'smg', 'sniper']);
  const clsName: Record<string, string> = { rifle: 'винтовок', pistol: 'пистолетов', smg: 'пистолетов-пулемётов', sniper: 'снайперских винтовок' };
  const pool: ChallengeState[] = [
    { id: 'wins', kind: 'wins', text: 'Выиграйте 3 командных матча', goal: 3, progress: 0, xp: 600, done: false },
    { id: 'hs', kind: 'headshots', text: 'Сделайте 40 убийств в голову', goal: 40, progress: 0, xp: 500, done: false },
    { id: 'map', kind: 'mapwin', param: map, text: `Выиграйте матч на карте ${MAP_NAMES[map]}`, goal: 1, progress: 0, xp: 400, done: false },
    { id: 'mvp', kind: 'mvps', text: 'Получите 8 MVP', goal: 8, progress: 0, xp: 450, done: false },
    { id: 'util', kind: 'utility', text: 'Нанесите 300 урона гранатами', goal: 300, progress: 0, xp: 400, done: false },
    { id: 'cls', kind: 'classkills', param: cls, text: `Сделайте 30 убийств с помощью ${clsName[cls]}`, goal: 30, progress: 0, xp: 450, done: false },
    { id: 'ar', kind: 'armsrace', text: 'Займите 1-е место в «Гонке вооружений»', goal: 1, progress: 0, xp: 500, done: false },
    { id: 'plant', kind: 'objective', text: 'Установите или обезвредьте бомбу 5 раз', goal: 5, progress: 0, xp: 400, done: false },
  ];
  return rng.shuffle(pool).slice(0, 4);
}

export function applyChallenges(list: ChallengeState[], r: MatchResult): ChallengeState[] {
  const me = r.players.find(p => p.id === r.humanId);
  if (!me || r.abandoned) return [];
  const completed: ChallengeState[] = [];
  const s = me.stats;
  for (const c of list) {
    if (c.done) continue;
    let add = 0;
    switch (c.kind) {
      case 'wins': add = !r.ffa && r.outcome === 1 ? 1 : 0; break;
      case 'headshots': add = s.headshots; break;
      case 'mapwin': add = r.mapId === c.param && r.outcome === 1 && !r.ffa ? 1 : 0; break;
      case 'mvps': add = s.mvps; break;
      case 'utility': add = s.utilityDamage; break;
      case 'classkills': add = Object.entries(s.weaponKills).filter(([w]) => WEAPONS[w]?.cls === c.param).reduce((a, [, n]) => a + n, 0); break;
      case 'armsrace': add = r.mode === 'armsrace' && r.placement === 1 ? 1 : 0; break;
      case 'objective': add = s.plants + s.defuses; break;
    }
    c.progress = Math.min(c.goal, c.progress + add);
    if (c.progress >= c.goal) { c.done = true; completed.push(c); }
  }
  return completed;
}
