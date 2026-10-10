import type { Vec3 } from './math';
import type { GrenadeType, Slot, Team } from './weapons';

/** Per-tick intent. Players and bots both drive actors exclusively through this. */
export interface InputCmd {
  forward: number; // -1..1
  right: number;   // -1..1
  yaw: number;     // absolute view angles (radians)
  pitch: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  fire: boolean;
  fire2: boolean;
  reload: boolean;
  use: boolean;
  inspect: boolean;
  /** select slot or specific grenade */
  select?: Slot | GrenadeType | null;
  /** cycle to last weapon */
  lastWeapon?: boolean;
  drop?: boolean;
}

export const emptyInput = (yaw = 0, pitch = 0): InputCmd => ({
  forward: 0, right: 0, yaw, pitch, jump: false, crouch: false, walk: false, fire: false, fire2: false,
  reload: false, use: false, inspect: false, select: null,
});

export type HitGroup = 'head' | 'chest' | 'stomach' | 'legs';

export type GameEvent =
  | { type: 'shot'; actor: number; weapon: string; origin: Vec3; dir: Vec3; end: Vec3; silenced?: boolean }
  | { type: 'impact'; pos: Vec3; normal: Vec3; kind: string }
  | { type: 'hit'; attacker: number; victim: number; damage: number; group: HitGroup; pos: Vec3; armorHit: boolean }
  | { type: 'kill'; killer: number; victim: number; weapon: string; headshot: boolean; wallbang: boolean; assister: number; flashAssist: boolean; noscope: boolean; throughSmoke: boolean }
  | { type: 'reload'; actor: number; weapon: string }
  | { type: 'dryfire'; actor: number }
  | { type: 'footstep'; actor: number; pos: Vec3; loud: boolean }
  | { type: 'jump'; actor: number }
  | { type: 'land'; actor: number; speed: number }
  | { type: 'switch'; actor: number; weapon: string }
  | { type: 'inspect'; actor: number }
  | { type: 'throw'; actor: number; grenade: GrenadeType; id: number }
  | { type: 'bounce'; id: number; pos: Vec3 }
  | { type: 'detonate'; id: number; grenade: GrenadeType; pos: Vec3; owner: number }
  | { type: 'flashed'; actor: number; strength: number; duration: number; by: number }
  | { type: 'decoy_shot'; pos: Vec3; weapon: string }
  | { type: 'fire_damage'; actor: number }
  | { type: 'plant_start'; actor: number }
  | { type: 'planted'; actor: number; site: string; pos: Vec3 }
  | { type: 'defuse_start'; actor: number; kit: boolean }
  | { type: 'defused'; actor: number }
  | { type: 'bomb_beep'; pos: Vec3; urgency: number }
  | { type: 'bomb_exploded'; pos: Vec3 }
  | { type: 'bomb_dropped'; pos: Vec3 }
  | { type: 'bomb_pickup'; actor: number }
  | { type: 'pickup'; actor: number; weapon: string }
  | { type: 'buy'; actor: number; item: string }
  | { type: 'spawn'; actor: number }
  | { type: 'round_start'; round: number }
  | { type: 'round_live' }
  | { type: 'round_end'; winner: Team | null; reason: string; mvp: number }
  | { type: 'halftime' }
  | { type: 'match_end'; winner: Team | null }
  | { type: 'level_up'; actor: number; level: number; weapon: string }
  | { type: 'announce'; text: string; team?: Team }
  | { type: 'target_hit'; target: number; damage: number; group: HitGroup; distance: number }
  | { type: 'radio'; actor: number; text: string };

export interface SoundCue {
  pos: Vec3;
  radius: number;
  kind: 'shot' | 'step' | 'reload' | 'land' | 'bomb' | 'grenade' | 'defuse' | 'plant' | 'decoy' | 'hurt';
  actor: number;
  team: Team | null;
  time: number;
}

export interface ActorStats {
  kills: number; deaths: number; assists: number; damage: number; headshots: number;
  shotsFired: number; shotsHit: number; mvps: number; utilityDamage: number; enemiesFlashed: number;
  plants: number; defuses: number; teamKills: number; teamDamage: number; score: number;
  roundsPlayed: number; entryKills: number; clutches: number; multiKills: number;
  weaponKills: Record<string, number>;
}

export const emptyStats = (): ActorStats => ({
  kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0, shotsFired: 0, shotsHit: 0, mvps: 0,
  utilityDamage: 0, enemiesFlashed: 0, plants: 0, defuses: 0, teamKills: 0, teamDamage: 0, score: 0,
  roundsPlayed: 0, entryKills: 0, clutches: 0, multiKills: 0, weaponKills: {},
});
