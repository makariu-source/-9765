// Respawn modes: Deathmatch (FFA), Team Deathmatch, Arms Race.
import type { Actor } from '../actor';
import type { Game } from '../game';
import type { Vec3 } from '../math';
import { ARMS_RACE_DEFAULT, PISTOLS, RIFLES, SMGS, SNIPERS, WEAPONS, type Team } from '../weapons';
import { addLobby, genMatchId, playerResults, type LobbyPlayer } from './lobby';
import type { GameMode, MatchResult, ModeHud, ModeId } from './mode';

export interface RespawnConfig {
  timeLimit: number;
  respawnDelay: number;
  protect: number;
  killLimit: number;
}

abstract class RespawnMode implements GameMode {
  abstract readonly id: ModeId;
  abstract readonly label: string;
  readonly allowBomb = false;
  abstract readonly ffa: boolean;
  readonly ffScale: number = 0;
  over = false;
  g!: Game;
  endTime = 0;
  matchId = '';
  winnerSquad: number | null = null;
  winnerId = -1;
  protected spawnCells: Vec3[] = [];
  message = '';

  constructor(readonly cfg: RespawnConfig, readonly lobby: LobbyPlayer[]) {}

  protected abstract teamFor(p: LobbyPlayer, index: number): Team;
  protected abstract loadout(a: Actor): void;

  attach(g: Game): void {
    this.g = g;
    this.matchId = genMatchId(g);
    let i = 0;
    addLobby(g, this.lobby, () => 'T').forEach(a => { a.team = this.teamFor(this.lobby[i], i); i++; });
    for (let j = 0; j < g.map.h; j++) for (let x = 0; x < g.map.w; x++) {
      if (!g.nav.isWalk(x, j)) continue;
      const k = g.nav.idx(x, j);
      // skip cramped cells and cells inside sites' crate clutter
      if (g.nav.coverScore[k] > 5) continue;
      this.spawnCells.push(g.nav.center(x, j));
    }
    this.endTime = g.time + this.cfg.timeLimit;
    for (const a of g.actors) this.respawn(a);
  }

  pickSpawn(a: Actor): Vec3 {
    const g = this.g;
    let best: Vec3 = this.spawnCells[0];
    let bestScore = -Infinity;
    const enemies = g.actors.filter(e => e.alive && e !== a && (this.ffa || e.team !== a.team));
    const mates = g.actors.filter(e => e.alive && e !== a && !this.ffa && e.team === a.team);
    for (let s = 0; s < 48; s++) {
      const c = g.rng.pick(this.spawnCells);
      let minD = 60, visible = false;
      const eye = { x: c.x, y: c.y + 1.6, z: c.z };
      for (const e of enemies) {
        const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
        minD = Math.min(minD, d);
        if (d < 45 && g.world.lineClear(eye, e.eye())) visible = true;
      }
      let score = Math.min(minD, 28) - (visible ? 100 : 0) + g.rng.next() * 3;
      for (const m of mates) if (Math.hypot(m.pos.x - c.x, m.pos.z - c.z) < 1.5) score -= 50;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  respawn(a: Actor): void {
    const g = this.g;
    const p = this.pickSpawn(a);
    a.stripAll();
    a.armor = 100; a.helmet = true;
    g.spawn(a, p, g.rng.range(-Math.PI, Math.PI));
    this.loadout(a);
    a.spawnProtectUntil = g.time + this.cfg.protect;
    a.respawnAt = 0;
  }

  update(_dt: number): void {
    const g = this.g;
    if (this.over) return;
    for (const a of g.actors) {
      if (!a.alive && a.respawnAt > 0 && g.time >= a.respawnAt && a.connected) this.respawn(a);
    }
    if (g.time >= this.endTime) this.finish();
  }

  onKill(killer: Actor | null, victim: Actor, weapon: string, headshot: boolean): void {
    victim.respawnAt = this.g.time + this.cfg.respawnDelay;
    if (this.over) return;
    this.scoreKill(killer, victim, weapon, headshot);
  }

  protected abstract scoreKill(killer: Actor | null, victim: Actor, weapon: string, headshot: boolean): void;
  protected abstract finish(): void;

  canMove(): boolean { return !this.over; }
  canBuy(a: Actor): boolean { return a.alive && !this.over; }

  protected ranked(): Actor[] {
    return this.g.actors.slice().sort((x, y) => y.dmScore - x.dmScore || y.stats.kills - x.stats.kills || x.stats.deaths - y.stats.deaths);
  }

  hud(): ModeHud {
    const g = this.g;
    const h = g.human();
    const r = this.ranked();
    const me = h ? h.dmScore : 0;
    const top = r[0]?.id === h?.id ? (r[1]?.dmScore ?? 0) : (r[0]?.dmScore ?? 0);
    return { phase: this.over ? 'over' : 'live', timer: Math.max(0, this.endTime - g.time), scoreUs: me, scoreThem: top, usTeam: h?.team ?? 'T', label: this.label, message: this.message };
  }

  result(abandoned: boolean): MatchResult {
    const g = this.g;
    const h = g.human();
    const r = this.ranked();
    const placement = h ? r.findIndex(a => a.id === h.id) + 1 : 0;
    return {
      matchId: this.matchId, mode: this.id, mapId: g.map.def.id, startedAt: g.startedAt, duration: g.time,
      scores: [h?.dmScore ?? 0, r[0]?.id === h?.id ? (r[1]?.dmScore ?? 0) : (r[0]?.dmScore ?? 0)],
      outcome: abandoned ? 0 : placement === 1 ? 1 : 0, winnerSquad: abandoned ? null : (r[0]?.squad ?? null),
      players: playerResults(g), humanId: h?.id ?? -1, rounds: [], abandoned, afk: false, ffa: true, placement,
      vsBots: true, mvpId: r[0]?.id ?? -1, roundsPlayed: 0,
    };
  }
}

// ---------------------------------------------------------------------------

export class DeathmatchMode extends RespawnMode {
  readonly id = 'deathmatch' as const;
  readonly label = 'Бой насмерть';
  readonly ffa = true;
  readonly freeBuy = true;
  /** chosen weapons per actor */
  choice = new Map<number, { primary: string; secondary: string }>();

  protected teamFor(_p: LobbyPlayer, i: number): Team { return i % 2 === 0 ? 'T' : 'CT'; }

  setLoadout(a: Actor, primary: string, secondary: string): void {
    this.choice.set(a.id, { primary, secondary });
  }

  protected loadout(a: Actor): void {
    const g = this.g;
    let c = this.choice.get(a.id);
    if (!c) {
      const prim = a.isBot ? g.rng.pick([...RIFLES, ...RIFLES, ...SMGS, ...SNIPERS]) : 'ak';
      c = { primary: prim, secondary: g.rng.pick(PISTOLS) };
      this.choice.set(a.id, c);
    }
    g.giveWeapon(a, c.secondary, false);
    g.giveWeapon(a, c.primary, false);
    g.selectBest(a);
  }

  protected scoreKill(killer: Actor | null, victim: Actor, _w: string, headshot: boolean): void {
    if (!killer || killer === victim) { victim.dmScore = Math.max(0, victim.dmScore - 5); return; }
    killer.dmScore += 10 + (headshot ? 5 : 0);
    // refill ammo on kill
    for (const w of [killer.primary, killer.secondary]) if (w) { w.clip = w.def.mag; }
    if (this.cfg.killLimit > 0 && killer.stats.kills >= this.cfg.killLimit) this.finish();
  }

  protected finish(): void {
    this.over = true;
    const r = this.ranked();
    this.winnerId = r[0]?.id ?? -1;
    this.message = `Победитель: ${r[0]?.name ?? '-'}`;
    this.g.emit({ type: 'match_end', winner: null });
  }
}

// ---------------------------------------------------------------------------

export class TdmMode extends RespawnMode {
  readonly id = 'tdm' as const;
  readonly label = 'Командный бой насмерть';
  readonly ffa = false;
  readonly freeBuy = true;
  teamKills: [number, number] = [0, 0];

  protected teamFor(p: LobbyPlayer): Team { return p.squad === 0 ? 'CT' : 'T'; }

  protected loadout(a: Actor): void {
    const g = this.g;
    g.giveWeapon(a, a.team === 'T' ? 'g9' : 'warden', false);
    g.giveWeapon(a, a.team === 'T' ? 'ak' : 'm4', false);
    g.giveWeapon(a, 'he', false);
    g.selectBest(a);
  }

  protected scoreKill(killer: Actor | null, victim: Actor): void {
    if (!killer || killer === victim || killer.team === victim.team) return;
    killer.dmScore += 10;
    this.teamKills[killer.squad]++;
    if (this.teamKills[killer.squad] >= this.cfg.killLimit) this.finish();
  }

  protected finish(): void {
    this.over = true;
    const [a, b] = this.teamKills;
    this.winnerSquad = a > b ? 0 : b > a ? 1 : null;
    this.g.emit({ type: 'match_end', winner: this.winnerSquad === null ? null : this.winnerSquad === 0 ? 'CT' : 'T' });
  }

  override hud(): ModeHud {
    const h = this.g.human();
    return { phase: this.over ? 'over' : 'live', timer: Math.max(0, this.endTime - this.g.time), scoreUs: this.teamKills[0], scoreThem: this.teamKills[1], usTeam: h?.team ?? 'CT', label: this.label, message: this.message };
  }

  override result(abandoned: boolean): MatchResult {
    const r = super.result(abandoned);
    return { ...r, ffa: false, scores: [...this.teamKills] as [number, number], winnerSquad: abandoned ? 1 : this.winnerSquad, outcome: abandoned ? 0 : this.winnerSquad === null ? 0.5 : this.winnerSquad === 0 ? 1 : 0, placement: undefined };
  }
}

// ---------------------------------------------------------------------------

export interface ArmsRaceConfig extends RespawnConfig {
  ladder: string[];
  killsPerLevel: number;
  knifeDemotes: boolean;
}

export class ArmsRaceMode extends RespawnMode {
  readonly id = 'armsrace' as const;
  readonly label = 'Гонка вооружений';
  readonly ffa = false;
  private levelKills = new Map<number, number>();

  constructor(readonly acfg: ArmsRaceConfig, lobby: LobbyPlayer[]) {
    super(acfg, lobby);
    if (!acfg.ladder.length || WEAPONS[acfg.ladder[acfg.ladder.length - 1]]?.cls !== 'knife') acfg.ladder = [...acfg.ladder, 'goldknife'];
  }

  protected teamFor(p: LobbyPlayer): Team { return p.squad === 0 ? 'CT' : 'T'; }

  weaponFor(level: number): string { return this.acfg.ladder[Math.min(level, this.acfg.ladder.length - 1)]; }
  get finalLevel(): number { return this.acfg.ladder.length - 1; }

  protected loadout(a: Actor): void {
    const g = this.g;
    const id = this.weaponFor(a.armsLevel);
    const def = WEAPONS[id];
    a.primary = null; a.secondary = null;
    g.giveWeapon(a, 'knife', false);
    if (def.slot === 'melee') { g.giveWeapon(a, id, false); g.select(a, 'melee', true); }
    else { g.giveWeapon(a, id, false); g.select(a, def.slot, true); }
  }

  protected scoreKill(killer: Actor | null, victim: Actor, weapon: string): void {
    if (!killer || killer === victim || killer.team === victim.team) return;
    const isKnife = WEAPONS[weapon]?.cls === 'knife';
    if (isKnife && this.acfg.knifeDemotes && victim.armsLevel > 0 && victim.armsLevel < this.finalLevel) {
      victim.armsLevel--;
      this.g.emit({ type: 'announce', text: `${victim.name} понижен ножом до уровня ${victim.armsLevel + 1}` });
    }
    if (killer.armsLevel === this.finalLevel) {
      if (isKnife) {
        this.winnerId = killer.id;
        this.finish();
      }
      return;
    }
    const n = (this.levelKills.get(killer.id) ?? 0) + 1;
    if (n >= this.acfg.killsPerLevel) {
      this.levelKills.set(killer.id, 0);
      killer.armsLevel++;
      killer.dmScore = killer.armsLevel;
      this.loadout(killer);
      this.g.emit({ type: 'level_up', actor: killer.id, level: killer.armsLevel, weapon: this.weaponFor(killer.armsLevel) });
    } else this.levelKills.set(killer.id, n);
  }

  protected override ranked(): Actor[] {
    return this.g.actors.slice().sort((x, y) => y.armsLevel - x.armsLevel || y.stats.kills - x.stats.kills);
  }

  protected finish(): void {
    this.over = true;
    const r = this.ranked();
    if (this.winnerId < 0) this.winnerId = r[0]?.id ?? -1;
    const w = this.g.actors[this.winnerId];
    this.winnerSquad = w ? w.squad : null;
    this.message = `Победитель гонки: ${w?.name ?? '-'}`;
    this.g.emit({ type: 'match_end', winner: w?.team ?? null });
  }

  override hud(): ModeHud {
    const h = this.g.human();
    const r = this.ranked();
    const leader = r[0];
    return {
      phase: this.over ? 'over' : 'live', timer: Math.max(0, this.endTime - this.g.time),
      scoreUs: (h?.armsLevel ?? 0) + 1, scoreThem: (leader?.armsLevel ?? 0) + 1, usTeam: h?.team ?? 'CT', label: this.label,
      message: this.message,
    };
  }

  override result(abandoned: boolean): MatchResult {
    const r = super.result(abandoned);
    const h = this.g.human();
    const placement = h ? this.ranked().findIndex(a => a.id === h.id) + 1 : 0;
    return { ...r, ffa: true, placement, outcome: abandoned ? 0 : this.winnerId === h?.id ? 1 : 0, winnerSquad: this.winnerSquad };
  }
}

export const DEFAULT_RESPAWN: RespawnConfig = { timeLimit: 480, respawnDelay: 1.6, protect: 1.5, killLimit: 0 };
export const defaultArmsRace = (): ArmsRaceConfig => ({ timeLimit: 720, respawnDelay: 1.2, protect: 1.2, killLimit: 0, ladder: [...ARMS_RACE_DEFAULT], killsPerLevel: 1, knifeDemotes: true });

