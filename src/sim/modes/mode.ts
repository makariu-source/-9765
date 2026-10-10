import type { Actor } from '../actor';
import type { Game } from '../game';
import type { ActorStats } from '../types';
import type { Team } from '../weapons';

export type ModeId = 'competitive' | 'casual' | 'wingman' | 'proleague' | 'deathmatch' | 'tdm' | 'armsrace' | 'training';

export interface ModeHud {
  phase: string;
  timer: number;
  /** scores from the human squad's perspective */
  scoreUs: number;
  scoreThem: number;
  usTeam: Team;
  label: string;
  message?: string;
  roundNumber?: number;
  maxRounds?: number;
}

export interface RoundRecord { n: number; winnerSquad: number | null; reason: string; usTeam: Team; mvp: number }

export interface PlayerResult {
  id: number; name: string; squad: number; isBot: boolean; botLevel: number; skillRating: number;
  stats: ActorStats; armsLevel?: number; dmScore?: number;
}

export interface MatchResult {
  matchId: string;
  mode: ModeId;
  mapId: string;
  startedAt: number;
  duration: number;
  /** squad scores: index 0 = human's squad */
  scores: [number, number];
  /** 1 win, 0.5 draw, 0 loss for the human (team modes); FFA uses placement */
  outcome: 1 | 0.5 | 0;
  winnerSquad: number | null;
  players: PlayerResult[];
  humanId: number;
  rounds: RoundRecord[];
  abandoned: boolean;
  afk: boolean;
  ffa: boolean;
  placement?: number;
  vsBots: true;
  mvpId: number;
  /** total rounds played (bomb modes) */
  roundsPlayed: number;
  /** custom match: never affects ratings */
  custom?: boolean;
}

export interface GameMode {
  readonly id: ModeId;
  readonly label: string;
  /** friendly fire damage scale for bullets (0 = disabled) */
  readonly ffScale: number;
  readonly ffa: boolean;
  readonly allowBomb: boolean;
  over: boolean;
  attach(g: Game): void;
  update(dt: number): void;
  onKill(killer: Actor | null, victim: Actor, weapon: string, headshot: boolean): void;
  onPlant?(a: Actor, site: string): void;
  onDefuse?(a: Actor): void;
  onExplode?(): void;
  canMove(a: Actor): boolean;
  canBuy(a: Actor): boolean;
  /** restrict planting to these sites (wingman) */
  readonly allowedSites?: string[];
  /** infinite money / instant buys (DM) */
  freeBuy?: boolean;
  hud(): ModeHud;
  result(abandoned: boolean): MatchResult;
}
