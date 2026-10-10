// Builds a Game + mode + bot director from a lobby. Used by the client and headless tests.
import { BotDirector } from './ai/team';
import { Game } from './sim/game';
import { BOMB_PRESETS, BombMode } from './sim/modes/bomb';
import type { LobbyPlayer } from './sim/modes/lobby';
import type { GameMode, ModeId } from './sim/modes/mode';
import { ArmsRaceMode, DEFAULT_RESPAWN, DeathmatchMode, TdmMode, defaultArmsRace, type ArmsRaceConfig, type RespawnConfig } from './sim/modes/respawn';
import { DEFAULT_TRAINING, TrainingMode, type TrainingSettings } from './sim/modes/training';
import type { Team } from './sim/weapons';

export interface MatchSetup {
  mode: ModeId;
  mapId: string;
  seed: number;
  lobby: LobbyPlayer[];
  humanStart?: Team;
  /** competitive: MR8 instead of MR12 */
  short?: boolean;
  respawn?: Partial<RespawnConfig>;
  armsRace?: Partial<ArmsRaceConfig>;
  training?: TrainingSettings;
}

export interface Match { game: Game; director: BotDirector; setup: MatchSetup }

export function buildMode(s: MatchSetup): GameMode {
  switch (s.mode) {
    case 'competitive': case 'casual': case 'wingman': case 'proleague': {
      const key = s.mode === 'competitive' && s.short ? 'competitiveShort' : s.mode;
      return new BombMode({ ...BOMB_PRESETS[key], humanStart: s.humanStart ?? 'CT' }, s.lobby);
    }
    case 'deathmatch': return new DeathmatchMode({ ...DEFAULT_RESPAWN, ...s.respawn }, s.lobby);
    case 'tdm': return new TdmMode({ ...DEFAULT_RESPAWN, killLimit: 60, timeLimit: 600, ...s.respawn }, s.lobby);
    case 'armsrace': return new ArmsRaceMode({ ...defaultArmsRace(), ...s.armsRace }, s.lobby);
    case 'training': return new TrainingMode(s.training ?? DEFAULT_TRAINING, s.lobby);
  }
}

export function createMatch(s: MatchSetup): Match {
  const mode = buildMode(s);
  const game = new Game({ mapId: s.mode === 'training' ? 'range' : s.mapId, seed: s.seed, mode });
  const director = new BotDirector(game, s.lobby, s.seed);
  return { game, director, setup: s };
}

export const TEAM_SIZE: Record<ModeId, number> = {
  competitive: 5, casual: 5, proleague: 5, wingman: 2, deathmatch: 8, tdm: 5, armsrace: 5, training: 1,
};
