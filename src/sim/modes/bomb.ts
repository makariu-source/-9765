// Bomb defusal: competitive, casual, wingman and PRO League presets.
import type { Actor } from '../actor';
import type { Game } from '../game';
import type { SiteId } from '../maps/mapgrid';
import { WEAPONS, type Team } from '../weapons';
import { addLobby, genMatchId, playerResults, type LobbyPlayer } from './lobby';
import type { GameMode, MatchResult, ModeHud, ModeId, RoundRecord } from './mode';

export interface BombConfig {
  id: ModeId;
  label: string;
  maxRounds: number;
  roundTime: number;
  freezeTime: number;
  buyTime: number;
  postTime: number;
  startMoney: number;
  maxMoney: number;
  ffScale: number;
  overtime: boolean;
  overtimeMoney: number;
  freeArmor: boolean;
  sites?: SiteId[];
  /** squad 0 starting side */
  humanStart: Team;
}

export const BOMB_PRESETS: Record<string, Omit<BombConfig, 'humanStart'>> = {
  competitive: { id: 'competitive', label: 'Соревновательный', maxRounds: 24, roundTime: 115, freezeTime: 12, buyTime: 20, postTime: 5, startMoney: 800, maxMoney: 16000, ffScale: 0.33, overtime: false, overtimeMoney: 12500, freeArmor: false },
  competitiveShort: { id: 'competitive', label: 'Соревновательный (короткий)', maxRounds: 16, roundTime: 115, freezeTime: 12, buyTime: 20, postTime: 5, startMoney: 800, maxMoney: 16000, ffScale: 0.33, overtime: false, overtimeMoney: 12500, freeArmor: false },
  casual: { id: 'casual', label: 'Обычный', maxRounds: 16, roundTime: 120, freezeTime: 6, buyTime: 30, postTime: 4, startMoney: 1000, maxMoney: 10000, ffScale: 0, overtime: false, overtimeMoney: 10000, freeArmor: true },
  wingman: { id: 'wingman', label: 'Напарники 2×2', maxRounds: 16, roundTime: 90, freezeTime: 10, buyTime: 20, postTime: 4, startMoney: 800, maxMoney: 16000, ffScale: 0.33, overtime: false, overtimeMoney: 12500, freeArmor: false, sites: ['A'] },
  proleague: { id: 'proleague', label: 'PRO League', maxRounds: 24, roundTime: 115, freezeTime: 12, buyTime: 20, postTime: 5, startMoney: 800, maxMoney: 16000, ffScale: 0.33, overtime: true, overtimeMoney: 12500, freeArmor: false },
};

export const WIN_ELIM = 3250, WIN_BOMB = 3500, WIN_TIME = 3250;
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];
export const PLANT_TEAM_BONUS = 800, PLANT_BONUS = 300, DEFUSE_BONUS = 300, TEAMKILL_PENALTY = 300;

type Phase = 'freeze' | 'live' | 'post' | 'halftime' | 'over';

export class BombMode implements GameMode {
  readonly id: ModeId;
  readonly label: string;
  readonly ffScale: number;
  readonly ffa = false;
  readonly allowBomb = true;
  over = false;
  g!: Game;
  phase: Phase = 'freeze';
  phaseEnd = 0;
  round = 0;
  /** squad scores */
  scores: [number, number] = [0, 0];
  lossStreak: [number, number] = [0, 0];
  rounds: RoundRecord[] = [];
  roundStart = 0;
  liveStart = 0;
  matchId = '';
  winnerSquad: number | null = null;
  lastRoundEnd: { winner: Team | null; reason: string } | null = null;
  firstKillThisRound = false;
  plantedThisRound = false;
  /** announcement text for HUD */
  message = '';

  constructor(readonly cfg: BombConfig, readonly lobby: LobbyPlayer[]) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.ffScale = cfg.ffScale;
  }

  get allowedSites(): string[] | undefined { return this.cfg.sites; }

  get regulationHalf(): number { return this.cfg.maxRounds / 2; }
  get winTarget(): number { return this.cfg.maxRounds / 2 + 1; }

  teamOfSquad(squad: number): Team {
    const human = this.cfg.humanStart;
    const other: Team = human === 'T' ? 'CT' : 'T';
    const swapped = this.isSwapped();
    const base = squad === 0 ? human : other;
    return swapped ? (base === 'T' ? 'CT' : 'T') : base;
  }

  /** sides swap each half (incl. overtime halves) */
  isSwapped(): boolean {
    const r = this.round; // 1-based current round
    const half = this.regulationHalf;
    if (r <= this.cfg.maxRounds) return r > half;
    const ot = r - this.cfg.maxRounds - 1; // 0-based OT round
    const otHalf = Math.floor(ot / 3);
    // OT: first OT half keeps the side of the second regulation half's opposite (CS: swap at start of OT)
    return otHalf % 2 === 1;
  }

  attach(g: Game): void {
    this.g = g;
    this.matchId = genMatchId(g);
    addLobby(g, this.lobby, s => this.teamOfSquad(s));
    this.startRound();
  }

  canMove(_a: Actor): boolean { return this.phase === 'live' || this.phase === 'post'; }

  canBuy(a: Actor): boolean {
    if (!a.alive) return false;
    if (this.phase === 'freeze') return true;
    return this.phase === 'live' && this.g.time - this.liveStart < this.cfg.buyTime && this.g.buyZoneContains(a);
  }

  private isFirstRoundOfHalf(): boolean {
    const r = this.round;
    const half = this.regulationHalf;
    if (r === 1 || r === half + 1) return true;
    if (r > this.cfg.maxRounds) return (r - this.cfg.maxRounds - 1) % 3 === 0;
    return false;
  }

  startRound(): void {
    const g = this.g;
    this.round++;
    const firstOfHalf = this.isFirstRoundOfHalf();
    g.resetRoundEntities();
    this.firstKillThisRound = false;
    this.plantedThisRound = false;
    this.message = '';
    const inOT = this.round > this.cfg.maxRounds;
    for (const a of g.actors) {
      const team = this.teamOfSquad(a.squad);
      const switched = a.team !== team;
      a.team = team;
      const survived = a.alive && !switched && !firstOfHalf;
      if (firstOfHalf) {
        a.stripAll();
        a.money = inOT ? this.cfg.overtimeMoney : this.cfg.startMoney;
      }
      if (!survived) {
        a.primary = null;
        a.grenades = [];
        a.kit = false;
        if (!a.alive || firstOfHalf) { a.armor = 0; a.helmet = false; }
        a.secondary = null;
      }
      a.hasBomb = false;
      if (!a.secondary) g.giveWeapon(a, team === 'T' ? 'g9' : 'warden', false);
      if (a.melee.def.id !== 'knife') g.giveWeapon(a, 'knife', false);
      if (this.cfg.freeArmor) { a.armor = 100; a.helmet = true; if (team === 'CT') a.kit = true; }
      a.stats.roundsPlayed++;
    }
    // spawns
    for (const team of ['T', 'CT'] as Team[]) {
      const spawns = g.rng.shuffle([...(team === 'T' ? g.map.tSpawns : g.map.ctSpawns)]);
      const members = g.actors.filter(a => a.team === team);
      members.forEach((a, i) => {
        const s = spawns[i % spawns.length];
        const target = team === 'T' ? g.map.ctSpawns[0] : g.map.tSpawns[0];
        const yaw = Math.atan2(-(target.x - s.x), -(target.z - s.z));
        g.spawn(a, s, yaw);
      });
    }
    const ts = g.actors.filter(a => a.team === 'T');
    if (ts.length) {
      const carrier = g.rng.pick(ts);
      g.giveBomb(carrier);
    }
    this.phase = 'freeze';
    this.roundStart = g.time;
    this.phaseEnd = g.time + this.cfg.freezeTime;
    g.emit({ type: 'round_start', round: this.round });
  }

  update(_dt: number): void {
    const g = this.g;
    if (this.over) return;
    switch (this.phase) {
      case 'freeze':
        if (g.time >= this.phaseEnd) {
          this.phase = 'live';
          this.liveStart = g.time;
          this.phaseEnd = g.time + this.cfg.roundTime;
          g.emit({ type: 'round_live' });
        }
        break;
      case 'live': {
        const bomb = g.bomb;
        const tAlive = g.aliveOf('T').length, ctAlive = g.aliveOf('CT').length;
        if (bomb.state === 'planted') {
          if (ctAlive === 0) this.endRound('T', 'Все защитники устранены');
        } else if (bomb.state !== 'exploded' && bomb.state !== 'defused') {
          if (ctAlive === 0 && tAlive > 0) this.endRound('T', 'Все защитники устранены');
          else if (tAlive === 0 && ctAlive > 0) this.endRound('CT', 'Все атакующие устранены');
          else if (tAlive === 0 && ctAlive === 0) this.endRound('CT', 'Все устранены');
          else if (g.time >= this.phaseEnd) this.endRound('CT', 'Время вышло');
        }
        break;
      }
      case 'post':
        if (g.time >= this.phaseEnd) this.afterRound();
        break;
      case 'halftime':
        if (g.time >= this.phaseEnd) this.startRound();
        break;
    }
  }

  onPlant(a: Actor, _site: string): void {
    this.plantedThisRound = true;
    a.money = Math.min(this.cfg.maxMoney, a.money + PLANT_BONUS);
    this.g.emit({ type: 'announce', text: 'Бомба заложена' });
  }

  onDefuse(a: Actor): void {
    a.money = Math.min(this.cfg.maxMoney, a.money + DEFUSE_BONUS);
    this.endRound('CT', 'Бомба обезврежена');
  }

  onExplode(): void { this.endRound('T', 'Цель уничтожена'); }

  onKill(killer: Actor | null, victim: Actor, weapon: string, _hs: boolean): void {
    if (!killer || killer === victim) return;
    if (killer.team === victim.team) {
      killer.money = Math.max(0, killer.money - TEAMKILL_PENALTY);
      return;
    }
    if (this.phase !== 'live' && this.phase !== 'post') return;
    const reward = WEAPONS[weapon]?.killReward ?? 300;
    killer.money = Math.min(this.cfg.maxMoney, killer.money + reward);
    if (!this.firstKillThisRound) { this.firstKillThisRound = true; killer.stats.entryKills++; }
  }

  private endRound(winner: Team, reason: string): void {
    const g = this.g;
    if (this.phase !== 'live') return;
    const winnerSquad = g.actors.find(a => a.team === winner)?.squad ?? (winner === this.teamOfSquad(0) ? 0 : 1);
    const loserSquad = 1 - winnerSquad;
    this.scores[winnerSquad]++;
    // economy
    const bombWin = reason === 'Цель уничтожена' || reason === 'Бомба обезврежена';
    const winMoney = bombWin ? WIN_BOMB : reason === 'Время вышло' ? WIN_TIME : WIN_ELIM;
    this.lossStreak[loserSquad] = Math.min(5, this.lossStreak[loserSquad] + 1);
    this.lossStreak[winnerSquad] = Math.max(0, this.lossStreak[winnerSquad] - 1);
    const lossMoney = LOSS_BONUS[this.lossStreak[loserSquad] - 1];
    for (const a of g.actors) {
      if (a.squad === winnerSquad) a.money += winMoney;
      else {
        let m = lossMoney;
        // attackers who survive a lost-on-time round get nothing
        if (a.team === 'T' && reason === 'Время вышло' && a.alive) m = 0;
        if (a.team === 'T' && this.plantedThisRound) m += PLANT_TEAM_BONUS;
        a.money += m;
      }
      a.money = Math.min(this.cfg.maxMoney, a.money);
    }
    // MVP
    let mvp: Actor | undefined;
    if (reason === 'Цель уничтожена') mvp = g.actors[g.bomb.planter];
    else if (reason === 'Бомба обезврежена') mvp = g.actors[g.bomb.defuser];
    if (!mvp) {
      const ws = g.actors.filter(a => a.team === winner);
      ws.sort((x, y) => y.roundKills - x.roundKills || y.roundDamage - x.roundDamage);
      mvp = ws[0];
    }
    if (mvp) mvp.stats.mvps++;
    // clutch: last alive of the winning team killed 2+ this round
    const winAlive = g.aliveOf(winner);
    if (winAlive.length === 1 && winAlive[0].roundKills >= 2) winAlive[0].stats.clutches++;
    for (const a of g.actors) if (a.roundKills >= 3) a.stats.multiKills++;
    this.rounds.push({ n: this.round, winnerSquad, reason, usTeam: this.teamOfSquad(0), mvp: mvp?.id ?? -1 });
    this.lastRoundEnd = { winner, reason };
    this.message = `${winner === 'T' ? 'Атака' : 'Защита'} побеждает — ${reason}`;
    g.emit({ type: 'round_end', winner, reason, mvp: mvp?.id ?? -1 });
    this.phase = 'post';
    this.phaseEnd = g.time + this.cfg.postTime;
  }

  private afterRound(): void {
    const g = this.g;
    const [a, b] = this.scores;
    const reg = this.cfg.maxRounds;
    const played = this.round;
    let done = false;
    if (played <= reg) {
      if (a >= this.winTarget || b >= this.winTarget) done = true;
      else if (played === reg) {
        if (a === b && this.cfg.overtime) done = false;
        else done = true;
      }
    } else {
      // overtime: blocks of 6, first to 4 within the block
      const otIndex = Math.floor((played - reg - 1) / 6);
      const base = reg / 2 + otIndex * 3;
      if (a >= base + 4 || b >= base + 4) done = true;
      else if ((played - reg) % 6 === 0 && a !== b) done = true;
    }
    if (done) {
      this.over = true;
      this.phase = 'over';
      this.winnerSquad = a > b ? 0 : b > a ? 1 : null;
      const winnerTeam = this.winnerSquad === null ? null : this.teamOfSquad(this.winnerSquad);
      g.emit({ type: 'match_end', winner: winnerTeam });
      return;
    }
    const nextIsHalf = played === this.regulationHalf || (played >= reg && (played - reg) % 3 === 0);
    if (nextIsHalf) {
      this.phase = 'halftime';
      this.phaseEnd = g.time + 6;
      this.message = 'Смена сторон';
      g.emit({ type: 'halftime' });
      // kill everyone visually idle during halftime
      for (const x of g.actors) x.alive = false;
    } else this.startRound();
  }

  hud(): ModeHud {
    const g = this.g;
    const usTeam = this.teamOfSquad(0);
    let timer = Math.max(0, this.phaseEnd - g.time);
    let phase: string = this.phase;
    if (this.phase === 'live' && g.bomb.state === 'planted') { timer = Math.max(0, g.bomb.explodeAt - g.time); phase = 'planted'; }
    return {
      phase, timer, scoreUs: this.scores[0], scoreThem: this.scores[1], usTeam, label: this.label,
      message: this.message, roundNumber: this.round, maxRounds: this.cfg.maxRounds,
    };
  }

  result(abandoned: boolean): MatchResult {
    const g = this.g;
    const human = g.human();
    const outcome: 0 | 0.5 | 1 = abandoned ? 0 : this.winnerSquad === null ? 0.5 : this.winnerSquad === 0 ? 1 : 0;
    const all = g.actors.slice().sort((x, y) => y.stats.mvps - x.stats.mvps || y.stats.kills - x.stats.kills);
    return {
      matchId: this.matchId, mode: this.id, mapId: g.map.def.id, startedAt: g.startedAt, duration: g.time,
      scores: [...this.scores] as [number, number], outcome, winnerSquad: abandoned ? 1 : this.winnerSquad,
      players: playerResults(g), humanId: human?.id ?? -1, rounds: this.rounds.slice(), abandoned,
      afk: false, ffa: false, vsBots: true, mvpId: all[0]?.id ?? -1, roundsPlayed: this.rounds.length,
    };
  }
}
