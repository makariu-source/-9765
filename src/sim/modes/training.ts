// Training range: static dummies, moving targets, reaction test, recoil wall, grenade practice.
import type { Actor } from '../actor';
import type { Game } from '../game';
import { addLobby, genMatchId, playerResults, type LobbyPlayer } from './lobby';
import type { GameMode, MatchResult, ModeHud } from './mode';

export type TrainingScenario = 'static' | 'moving' | 'reaction' | 'recoil' | 'grenades';

export interface TrainingSettings {
  scenario: TrainingScenario;
  distance: number;   // meters
  speed: number;      // m/s for moving targets
  axis: 'x' | 'z';    // movement direction
  count: number;
  armor: boolean;
}

export const DEFAULT_TRAINING: TrainingSettings = { scenario: 'static', distance: 20, speed: 3, axis: 'x', count: 5, armor: false };

export class TrainingMode implements GameMode {
  readonly id = 'training' as const;
  readonly label = 'Тренировка';
  readonly ffScale = 0;
  readonly ffa = false;
  readonly allowBomb = false;
  readonly freeBuy = true;
  over = false;
  g!: Game;
  matchId = '';
  reactionTimes: number[] = [];
  private popupDue = 0;
  startTime = 0;

  constructor(public settings: TrainingSettings, readonly lobby: LobbyPlayer[]) {}

  attach(g: Game): void {
    this.g = g;
    this.matchId = genMatchId(g);
    addLobby(g, this.lobby, () => 'CT');
    const h = g.human()!;
    const s = g.map.tSpawns[Math.floor(g.map.tSpawns.length / 2)];
    g.spawn(h, s, 0);
    h.armor = 100; h.helmet = true;
    g.giveWeapon(h, 'ak', false);
    g.giveWeapon(h, 'deagle', false);
    g.selectBest(h);
    this.startTime = g.time;
    this.applySettings(this.settings);
  }

  /** Rebuild targets for the current scenario. */
  applySettings(s: TrainingSettings): void {
    this.settings = { ...s };
    const g = this.g;
    g.targets = [];
    const h = g.human();
    const sp = g.map.tSpawns[Math.floor(g.map.tSpawns.length / 2)];
    const baseZ = sp.z - Math.max(4, Math.min(48, s.distance));
    const cx = sp.x;
    switch (s.scenario) {
      case 'static':
        for (let i = 0; i < s.count; i++) g.addTarget('dummy', { x: cx + (i - (s.count - 1) / 2) * 2.4, y: 0, z: baseZ }, { armor: s.armor });
        break;
      case 'moving':
        for (let i = 0; i < Math.max(1, Math.min(4, s.count)); i++) {
          g.addTarget('moving', { x: cx + (i - 1.5) * 3, y: 0, z: baseZ - i * 3 }, { speed: s.speed * (i % 2 ? -1 : 1), range: s.axis === 'x' ? 7 : 4, axis: s.axis, armor: s.armor });
        }
        break;
      case 'reaction':
        this.popupDue = g.time + 1.5;
        break;
      case 'recoil':
        // stand facing the recoil wall
        if (h) { h.pos = { x: 69, y: 0.02, z: 30 }; h.yaw = 0; h.input.yaw = 0; }
        break;
      case 'grenades':
        if (h) for (const gt of ['he', 'flash', 'smoke', 'molotov'] as const) g.giveWeapon(h, gt, false);
        break;
    }
    this.reactionTimes = [];
  }

  update(_dt: number): void {
    const g = this.g;
    const h = g.human();
    if (!h) return;
    // infinite ammo reserve & grenades
    for (const w of [h.primary, h.secondary]) if (w && w.reserve < w.def.mag) w.reserve = w.def.reserve;
    if (this.settings.scenario === 'grenades') for (const gt of ['he', 'flash', 'smoke', 'molotov'] as const) if (!h.grenades.includes(gt) && h.throwStart === 0) g.giveWeapon(h, gt, false);
    if (h.health < 100 && h.alive) h.health = 100;
    if (!h.alive) { const s = g.map.tSpawns[0]; g.spawn(h, s, 0); }
    if (this.settings.scenario === 'reaction') {
      const alive = g.targets.filter(t => t.alive);
      // record reaction time when the popup died
      for (const t of g.targets) {
        if (!t.alive && t.respawnAt > 0) {
          this.reactionTimes.push(t.respawnAt - 0.8 - t.spawnedAt);
          if (this.reactionTimes.length > 30) this.reactionTimes.shift();
          t.respawnAt = Infinity; // handled by us
          this.popupDue = g.time + g.rng.range(0.8, 2.2);
        }
      }
      g.targets = g.targets.filter(t => t.alive || t.respawnAt !== Infinity);
      if (!alive.length && g.time >= this.popupDue && this.popupDue > 0) {
        const sp = g.map.tSpawns[Math.floor(g.map.tSpawns.length / 2)];
        const d = g.rng.range(8, Math.max(10, this.settings.distance));
        g.addTarget('popup', { x: sp.x + g.rng.range(-14, 14), y: 0, z: sp.z - d }, { armor: this.settings.armor });
        this.popupDue = 0;
      }
    }
  }

  onKill(): void {}
  canMove(): boolean { return true; }
  canBuy(a: Actor): boolean { return a.alive; }

  avgReaction(): number {
    return this.reactionTimes.length ? this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length : 0;
  }

  hud(): ModeHud {
    const h = this.g.human();
    const acc = h && h.stats.shotsFired ? Math.round((h.stats.shotsHit / h.stats.shotsFired) * 100) : 0;
    const rt = this.avgReaction();
    return {
      phase: 'live', timer: this.g.time - this.startTime, scoreUs: h?.stats.kills ?? 0, scoreThem: acc, usTeam: 'CT', label: this.label,
      message: this.settings.scenario === 'reaction' && rt ? `Средняя реакция: ${Math.round(rt * 1000)} мс` : '',
    };
  }

  result(abandoned: boolean): MatchResult {
    const g = this.g;
    return {
      matchId: this.matchId, mode: 'training', mapId: g.map.def.id, startedAt: g.startedAt, duration: g.time, scores: [0, 0],
      outcome: 0.5, winnerSquad: null, players: playerResults(g), humanId: g.humanId, rounds: [], abandoned, afk: false,
      ffa: true, vsBots: true, mvpId: g.humanId, roundsPlayed: 0,
    };
  }
}
