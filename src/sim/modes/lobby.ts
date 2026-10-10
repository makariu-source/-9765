import type { Actor } from '../actor';
import type { Game } from '../game';
import type { ActorStats } from '../types';
import type { PlayerResult } from './mode';

export interface LobbyPlayer {
  name: string;
  squad: number;
  isBot: boolean;
  /** bot difficulty 1..7 */
  level: number;
  /** numeric skill rating the matchmaker assigned (MMR or ELO scale) */
  skill: number;
  model: number;
  /** optional per-bot style seed (aggressive/passive etc.) */
  style?: number;
}

export function playerResults(g: Game): PlayerResult[] {
  return g.actors.map(a => ({
    id: a.id, name: a.name, squad: a.squad, isBot: a.isBot, botLevel: a.botLevel, skillRating: a.skillRating,
    stats: cloneStats(a.stats), armsLevel: a.armsLevel, dmScore: a.dmScore,
  }));
}

export function cloneStats(s: ActorStats): ActorStats {
  return { ...s, weaponKills: { ...s.weaponKills } };
}

export function addLobby(g: Game, lobby: LobbyPlayer[], teamOf: (squad: number) => 'T' | 'CT'): Actor[] {
  return lobby.map(p => {
    const a = g.addActor(p.name, teamOf(p.squad), p.isBot, p.model);
    a.squad = p.squad;
    a.botLevel = p.isBot ? p.level : 0;
    a.skillRating = p.skill;
    if (!p.isBot && g.humanId < 0) g.humanId = a.id;
    return a;
  });
}

export function genMatchId(g: Game): string {
  return `${g.map.def.id}-${g.startedAt.toString(36)}-${Math.floor(g.rng.next() * 1e9).toString(36)}`;
}
