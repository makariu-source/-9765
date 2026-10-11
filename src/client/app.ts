// Application shell: profile, menus, match launching, results, replays.
import * as THREE from 'three';
import { MAP_DEFS, getMap } from '../sim/maps/maps';
import { World } from '../sim/world';
import type { MatchSetup } from '../match';
import { TEAM_SIZE } from '../match';
import type { MatchResult, ModeId } from '../sim/modes/mode';
import type { Replay } from '../sim/replay';
import { Rng } from '../sim/rng';
import { adaptiveTarget, botName, buildLobby, eloToBotLevel, mmrToBotLevel } from '../meta/matchmaking';
import type { LobbyPlayer } from '../sim/modes/lobby';
import { applyMatchResult, loadProfile, newProfile, saveProfile, STORAGE_KEY, xpForLevel, type MatchSummary, type Profile, type KV } from '../meta/profile';
import { platform } from '../platform/platform';
import type { TrainingSettings } from '../sim/modes/training';
import type { ArmsRaceConfig } from '../sim/modes/respawn';
import { sfx } from './audio/sfx';
import { Renderer } from './render/renderer';
import { Session, type SessionOptions } from './session';
import { SpectatorSession } from './spectator';
import { h } from './ui/dom';
import { MainMenu } from './ui/menus';
import { PostMatch } from './ui/postmatch';
import { ReplayViewer } from './ui/replayview';

export interface StartOptions {
  mode: ModeId;
  mapId?: string;
  /** custom matches */
  custom?: { allyLevel: number; enemyLevel: number; teamSize: number; short?: boolean; armsRace?: Partial<ArmsRaceConfig>; ffaCount?: number; timeLimit?: number };
  training?: TrainingSettings;
}

/** Bot-only match to watch. */
export interface SpectateOptions {
  mode: ModeId;
  mapId?: string;
  /** team sizes and difficulty (1..7) of the side that starts as defenders (CT) and attackers (T) */
  ctCount: number; tCount: number; ctLevel: number; tLevel: number;
  short?: boolean;
  /** deathmatch: number of bots and their level */
  ffaCount?: number; ffaLevel?: number;
}

/** when the local save was last written (to pick the newer of local and cloud copies) */
export const SAVED_AT_KEY = 'strikezone.savedAt';

function storage(): KV | null {
  try { const t = '__sz_test'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch { return null; }
}

export class App {
  profile: Profile;
  readonly kv = storage();
  readonly renderer: Renderer;
  readonly ui: HTMLElement;
  private menu: MainMenu;
  private session: Session | null = null;
  private spectator: SpectatorSession | null = null;
  lastSpectate: SpectateOptions | null = null;
  private menuBgRaf = 0;
  private menuBgActive = false;
  lastReplay: Replay | null = null;
  private replayViewer: ReplayViewer | null = null;
  lastStart: StartOptions | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.profile = loadProfile(this.kv);
    this.ui = ui;
    this.renderer = new Renderer(canvas);
    this.applySettings();
    this.menu = new MainMenu(this);
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => { sfx.init(); sfx.applyVolumes(); if (!this.session) sfx.startMusic(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // stop the game and every sound when the player leaves the tab/window, while an ad is on
    // screen, or when the platform asks for it (Yandex Games requirement 1.3)
    const hidden = () => this.setExternalPause('hidden', document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', () => this.setExternalPause('blur', true));
    window.addEventListener('focus', () => this.setExternalPause('blur', false));
    window.addEventListener('pagehide', () => this.save());
    platform().onAd(on => this.setExternalPause('ad', on));
    platform().onPause(on => this.setExternalPause('platform', on));
    // gameplay markup: "playing" only while a match is running and not paused
    setInterval(() => platform().gameplay(!!this.session?.isPlaying()), 500);
  }

  private pauseReasons = new Set<string>();
  setExternalPause(reason: string, on: boolean): void {
    if (on) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason);
    const any = this.pauseReasons.size > 0;
    sfx.setSuspended(any);
    if (this.session) this.session.externalPause = any;
    if (this.spectator) this.spectator.externalPause = any;
  }
  get externallyPaused(): boolean { return this.pauseReasons.size > 0; }

  save(): void {
    saveProfile(this.profile, this.kv);
    if (!this.kv) return;
    try {
      const now = Date.now();
      this.kv.setItem(SAVED_AT_KEY, String(now));
      const txt = this.kv.getItem(STORAGE_KEY);
      if (txt) platform().saveCloud({ profile: txt, savedAt: String(now) });
    } catch { /* storage blocked */ }
  }

  /** Wipe all progress (local and cloud) and start over. */
  resetProgress(): void {
    this.profile = newProfile(this.profile.name);
    this.save();
    if (this.kv) platform().saveCloud({ profile: this.kv.getItem(STORAGE_KEY) ?? '', savedAt: String(Date.now()) }, true);
    this.showMenu('profile');
  }

  /** Bonus XP for watching a rewarded ad after a match (once per match). */
  addBonusXp(xp: number): { levelUp: boolean } {
    const p = this.profile, before = p.level;
    p.xp += Math.max(0, Math.round(xp));
    while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; }
    this.save();
    return { levelUp: p.level > before };
  }

  applySettings(): void {
    const s = this.profile.settings;
    this.renderer.setQuality(s.graphics.quality, s.graphics.shadows, s.graphics.renderScale);
    this.renderer.setBrightness(s.graphics.brightness ?? 1);
    this.renderer.baseFov = s.fov;
    sfx.volumes = { ...s.volume };
    sfx.applyVolumes();
  }

  showMenu(section?: string): void {
    this.closeReplay();
    this.ui.replaceChildren(this.menu.root);
    this.menu.show(section);
    this.startMenuBackground();
    if (sfx.ctx) sfx.startMusic();
  }

  // --- animated 3D background behind the menu
  private startMenuBackground(): void {
    if (this.menuBgActive) return;
    this.menuBgActive = true;
    const def = MAP_DEFS[Math.floor(Math.random() * MAP_DEFS.length)];
    const world = new World(getMap(def.id));
    this.renderer.loadWorld(world);
    const cx = world.sizeX / 2, cz = world.sizeZ / 2;
    let last = performance.now();
    const loop = (t: number) => {
      if (!this.menuBgActive) return;
      this.menuBgRaf = requestAnimationFrame(loop);
      if (t - last < 33) return; // ~30 fps is plenty for a background
      last = t;
      const a = t / 1000 * 0.05;
      const r = Math.max(world.sizeX, world.sizeZ) * 0.55;
      const pos = { x: cx + Math.cos(a) * r, y: 34, z: cz + Math.sin(a) * r };
      const dir = new THREE.Vector3(cx - pos.x, -26, cz - pos.z).normalize();
      const yaw = Math.atan2(-dir.x, -dir.z), pitch = Math.asin(dir.y);
      this.renderer.setView(pos, yaw, pitch, 75, 0.033);
      this.renderer.render(null, t / 1000);
    };
    this.menuBgRaf = requestAnimationFrame(loop);
  }

  private stopMenuBackground(): void {
    this.menuBgActive = false;
    cancelAnimationFrame(this.menuBgRaf);
  }

  /** Remaining cooldown (ms) before ranked queue is allowed. */
  cooldown(mode: ModeId): number {
    const now = Date.now();
    if (mode === 'competitive') return Math.max(0, this.profile.competitive.cooldownUntil - now);
    if (mode === 'proleague') return Math.max(0, this.profile.pro.banUntil - now);
    return 0;
  }

  // ---------------------------------------------------------------------------

  private closeReplay(): void {
    const v = this.replayViewer;
    this.replayViewer = null;
    v?.close();
    const s = this.spectator;
    this.spectator = null;
    s?.dispose();
  }

  /** Watch a match played only by bots. */
  spectate(o: SpectateOptions): void {
    this.closeReplay();
    this.stopMenuBackground();
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const rng = new Rng(seed);
    const mapId = o.mapId ?? rng.pick(MAP_DEFS).id;
    const used = new Set<string>();
    const lobby: LobbyPlayer[] = [];
    const add = (squad: number, level: number) => {
      let name = botName(rng);
      while (used.has(name)) name = botName(rng);
      used.add(name);
      lobby.push({ name, squad, isBot: true, level, skill: 1000, model: rng.int(0, 3), style: rng.int(0, 1e6) });
    };
    if (o.mode === 'deathmatch') for (let i = 0; i < (o.ffaCount ?? 8); i++) add(i, o.ffaLevel ?? 4);
    else {
      for (let i = 0; i < o.ctCount; i++) add(0, o.ctLevel);
      for (let i = 0; i < o.tCount; i++) add(1, o.tLevel);
    }
    const setup: MatchSetup = { mode: o.mode, mapId, seed, lobby, humanStart: 'CT', short: o.mode === 'competitive' ? o.short ?? true : undefined };
    this.lastSpectate = o;
    const titles: Partial<Record<ModeId, string>> = { competitive: 'Наблюдение · соревновательный', casual: 'Наблюдение · обычный', wingman: 'Наблюдение · напарники', tdm: 'Наблюдение · командный бой', deathmatch: 'Наблюдение · бой насмерть' };
    const loading = h('div', { class: 'loading' }, h('div', { class: 'logo' }, h('b', {}, 'STRIKE'), 'ZONE'), h('div', { class: 'sub' }, `Загрузка: ${getMap(mapId).def.name}`), h('div', { class: 'bar' }, h('i', { style: 'width:60%' })));
    this.ui.replaceChildren(loading);
    setTimeout(() => {
      try {
        const s = new SpectatorSession(this.renderer, this.ui, setup, titles[o.mode] ?? 'Наблюдение');
        this.spectator = s;
        s.externalPause = this.externallyPaused;
        s.onExit = () => { this.spectator = null; this.showMenu('spectate'); };
        s.onAgain = () => { this.spectator = null; this.spectate({ ...o }); };
        loading.remove();
        s.start();
      } catch (err) {
        console.error(err);
        this.ui.replaceChildren(h('div', { class: 'menu' }, h('div', { class: 'content' }, h('h1', {}, 'Ошибка запуска'), h('pre', {}, String((err as Error)?.stack ?? err)), h('button', { class: 'btn', onclick: () => this.showMenu() }, 'В меню'))));
      }
    }, 60);
  }

  start(o: StartOptions): void {
    this.closeReplay();
    const p = this.profile;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const rng = new Rng(seed);
    const mapId = o.mode === 'training' ? 'range' : o.mapId ?? rng.pick(MAP_DEFS).id;
    let teamSize = o.custom?.teamSize ?? TEAM_SIZE[o.mode];
    let ratingSystem: SessionOptions['ratingSystem'] = 'none';
    let ranked = false;
    let target: number | undefined;
    let level: number;
    let scale: 'mmr' | 'elo' = 'mmr';
    let rating = p.competitive.mmr.r;
    switch (o.custom ? 'custom' : o.mode) {
      case 'competitive': {
        ranked = true; ratingSystem = 'mmr';
        const t = p.competitive;
        target = adaptiveTarget({ rating: t.mmr.r, streak: t.streak, recentPerf: t.recentPerf, prevTarget: t.lastTarget });
        level = mmrToBotLevel(target);
        break;
      }
      case 'wingman': {
        ranked = true; ratingSystem = 'wingman';
        const t = p.wingman;
        rating = t.mmr.r;
        target = adaptiveTarget({ rating: t.mmr.r, streak: t.streak, recentPerf: t.recentPerf, prevTarget: t.lastTarget });
        level = mmrToBotLevel(target);
        break;
      }
      case 'proleague': {
        ranked = true; ratingSystem = 'elo'; scale = 'elo';
        rating = p.pro.elo;
        // stricter: opponents stay within ±50 ELO of the player, gradual adaptation
        target = adaptiveTarget({ rating: p.pro.elo, streak: p.pro.streak, recentPerf: [], prevTarget: p.pro.lastTarget, maxStep: 40 });
        target = Math.max(p.pro.elo - 50, Math.min(p.pro.elo + 50, target));
        level = eloToBotLevel(target);
        break;
      }
      default:
        level = o.custom ? o.custom.enemyLevel : mmrToBotLevel(p.competitive.mmr.r);
    }
    const ffa = o.mode === 'deathmatch';
    const lob = buildLobby({
      humanName: p.name, humanRating: rating, targetLevel: level, teamSize, seed, scale,
      ffa, ffaCount: o.custom?.ffaCount ?? 8, spread: o.mode === 'proleague' ? 0.2 : 0.35,
    });
    if (o.custom && !ffa) {
      // custom: explicit difficulties
      for (const pl of lob.lobby) if (pl.isBot) pl.level = pl.squad === 0 ? o.custom.allyLevel : o.custom.enemyLevel;
    }
    if (o.mode === 'training') { lob.lobby.length = 1; teamSize = 1; }
    const setup: MatchSetup = {
      mode: o.mode, mapId, seed, lobby: lob.lobby, humanStart: rng.chance(0.5) ? 'T' : 'CT',
      short: o.mode === 'competitive' ? (o.custom?.short ?? p.settings.shortCompetitive) : undefined,
      armsRace: o.custom?.armsRace, training: o.training,
      respawn: o.custom?.timeLimit ? { timeLimit: o.custom.timeLimit } : undefined,
    };
    const titles: Record<ModeId, string> = {
      competitive: 'Соревновательный матч', casual: 'Обычный матч', wingman: 'Напарники', proleague: 'PRO League',
      deathmatch: 'Бой насмерть', tdm: 'Командный бой насмерть', armsrace: 'Гонка вооружений', training: 'Тренировка',
    };
    this.lastStart = o;
    this.launch({ setup, ratingSystem, ranked, ctx: { teamAvg: lob.teamAvg, oppAvg: lob.oppAvg, fingerprint: lob.fingerprint, target }, title: titles[o.mode] });
  }

  private launch(opts: SessionOptions): void {
    this.stopMenuBackground();
    const loading = h('div', { class: 'loading' }, h('div', { class: 'logo' }, h('b', {}, 'STRIKE'), 'ZONE'), h('div', { class: 'sub' }, `Загрузка: ${getMap(opts.setup.mode === 'training' ? 'range' : opts.setup.mapId).def.name}`), h('div', { class: 'bar' }, h('i', { style: 'width:60%' })));
    this.ui.replaceChildren(loading);
    // let the loading screen paint before heavy work
    setTimeout(() => {
      try {
        const s = new Session(this.renderer, this.ui, this.profile.settings, opts);
        this.session = s;
        s.externalPause = this.externallyPaused;
        s.onEnd = (r, replay) => this.finish(s, r, replay);
        s.onQuit = () => { this.session = null; this.save(); this.showMenu(); };
        loading.style.opacity = '0';
        setTimeout(() => loading.remove(), 400);
        s.start();
      } catch (err) {
        console.error(err);
        this.ui.replaceChildren(h('div', { class: 'menu' }, h('div', { class: 'content' }, h('h1', {}, 'Ошибка запуска матча'), h('pre', {}, String((err as Error)?.stack ?? err)), h('button', { class: 'btn', onclick: () => this.showMenu() }, 'В меню'))));
      }
    }, 60);
  }

  private finish(s: Session, r: MatchResult, replay: Replay): void {
    this.session = null;
    this.lastReplay = replay;
    let summary: MatchSummary | null = null;
    if (this.lastStart?.custom) r.custom = true;
    if (r.mode !== 'training') summary = applyMatchResult(this.profile, r, s.opts.ctx);
    this.save();
    const post = new PostMatch(this, r, summary, s.opts);
    this.ui.replaceChildren(post.root);
    if (summary?.mmr?.rankUp || (summary?.pro && summary.pro.levelAfter.level > summary.pro.levelBefore.level)) sfx.jingle('rankup');
    else if (summary && summary.levelAfter > summary.levelBefore) sfx.jingle('levelup');
    else sfx.jingle(r.outcome === 1 ? 'win' : 'lose');
    // full-screen ad at a natural break (the platform decides how often it really shows)
    platform().gameplay(false);
    void platform().interstitial();
  }

  playAgain(): void { if (this.lastStart) this.start({ ...this.lastStart, mapId: this.lastStart.custom ? this.lastStart.mapId : undefined }); }

  watchReplay(): void {
    if (!this.lastReplay) return;
    this.stopMenuBackground();
    this.closeReplay();
    const v = new ReplayViewer(this.renderer, this.lastReplay, () => { this.replayViewer = null; this.showMenu('history'); });
    this.replayViewer = v;
    this.ui.replaceChildren(v.root);
    v.start();
  }
}
