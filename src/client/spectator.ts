// Bot-only match the player just watches ("Наблюдение"): live simulation, director / chase /
// first-person / free cameras, speed control, scoreboard, minimap with both teams and
// labels showing what each bot is up to (role and current intent).
import * as THREE from 'three';
import type { Actor } from '../sim/actor';
import { TICK, type Game } from '../sim/game';
import { createMatch, type Match, type MatchSetup } from '../match';
import { DIFFICULTY_NAMES } from '../ai/difficulty';
import { PLAN_NAMES } from '../ai/team';
import { clamp, lerp, vdist, type Vec3 } from '../sim/math';
import type { GameEvent } from '../sim/types';
import { WEAPONS } from '../sim/weapons';
import { sfx } from './audio/sfx';
import { CharacterView } from './render/characters';
import { Effects } from './render/effects';
import { Renderer } from './render/renderer';
import { ViewModel } from './render/viewmodel';
import { fmtTime, h } from './ui/dom';
import { escapeHtml } from './ui/hud';
import { Minimap, type RadarMarker } from './ui/minimap';
import { Scoreboard } from './ui/panels';

type Cam = 'auto' | 'follow' | 'eyes' | 'free';
/** See-through-walls: enemies of the followed bot, everyone, or off. */
type Xray = 'enemies' | 'all' | 'off';
const XRAY_NAMES: Record<Xray, string> = { enemies: 'Сквозь стены: враги', all: 'Сквозь стены: все', off: 'Сквозь стены: выкл' };

/** What a bot is doing, in words (from its team role and current goal). */
const ROLE_NAMES: Record<string, string> = {
  entry: 'первый на вход', support: 'поддержка', lurk: 'лёркер', awp: 'снайпер', anchor: 'держит точку',
  rotator: 'центр', flank: 'обход в тыл', push: 'выход вперёд', roamer: 'роумер',
};
const GOAL_NAMES: Record<string, string> = {
  hunt: 'охота', stage: 'ждёт захода', execute: 'заходит на точку', clear: 'зачищает точку', rotate: 'ротация',
  retake: 'отбивает точку', 'retake-group': 'собирается на ретейк', 'retake-clear': 'прикрывает разминирование',
  'post-plant': 'держит бомбу', flank: 'обходит в тыл', lurk: 'крадётся', 'flank-wait': 'ждёт обхода', push: 'вышел вперёд',
  roam: 'разведка', 'search bomb': 'ищет бомбу', roam_dm: 'бродит',
  save: 'сейвит оружие (прячется)', 'hunt-save': 'ищет сейверов',
  fake: 'фейк: шумит на другой точке', noise: 'ложный шум', bombfake: 'фейк, бомба у другого', doublefake: 'двойной фейк',
  fakeback: 'ложный выход', rotbait: 'давит, ждёт ротацию', draw: 'перетяжка: ждёт', sneak: 'тихо идёт на точку',
  'fake-retreat': 'ложный отход: ждёт на угле', 'ct-fake-util': 'фейковая граната', 'ct-noise': 'ложный шум',
  'ct-fake-rotate': 'ложная ротация',
};

export class SpectatorSession {
  readonly match: Match;
  readonly game: Game;
  private chars = new Map<number, CharacterView>();
  private prev = new Map<number, Vec3>();
  private effects: Effects;
  private vm: ViewModel;
  private minimap: Minimap;
  private scoreboard: Scoreboard;
  private root: HTMLDivElement;
  private top: HTMLDivElement;
  private feed: HTMLDivElement;
  private info: HTMLDivElement;
  private center: HTMLDivElement;
  private labels: HTMLDivElement;
  private labelPool: HTMLDivElement[] = [];
  private camBtns = new Map<Cam, HTMLButtonElement>();
  private botSel: HTMLSelectElement;
  private cam: Cam = 'auto';
  private followId = 0;
  private autoUntil = 0;
  private speed = 1;
  private paused = false;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private ended = false;
  private endAt = 0;
  private sbHeld = false;
  private xray: Xray = 'enemies';
  private xrayBtn: HTMLButtonElement;
  private players: HTMLDivElement;
  private playersOpen = window.innerWidth >= 900;
  private playersAt = 0;
  /** when the viewer last picked a bot by hand (a fallen pick is not skipped automatically) */
  private pickedAt = -1;
  private centerUntil = 0;
  private orbit = { yaw: 0.7, pitch: -0.75, dist: 75, drag: false, lx: 0, ly: 0 };
  private chase = { yaw: 0 };
  /** recent action per actor (shots, kills) for the director camera */
  private action = new Map<number, number>();
  onExit: (() => void) | null = null;
  onAgain: (() => void) | null = null;

  constructor(private renderer: Renderer, private uiRoot: HTMLElement, setup: MatchSetup, private title: string) {
    this.match = createMatch(setup);
    const g = this.game = this.match.game;
    this.renderer.loadWorld(g.world);
    this.effects = new Effects(this.renderer.scene);
    this.vm = new ViewModel(this.renderer.camera.aspect);
    for (const a of g.actors) {
      const cv = new CharacterView(a.team, a.model);
      this.renderer.scene.add(cv.root);
      this.chars.set(a.id, cv);
      this.prev.set(a.id, { ...a.pos });
    }
    this.minimap = new Minimap(g.map, window.innerWidth < 900 ? 120 : 190);
    this.scoreboard = new Scoreboard(g);
    this.top = h('div', { class: 'top' });
    this.feed = h('div', { class: 'feed' });
    this.info = h('div', { class: 'spec-info' });
    this.center = h('div', { class: 'center-msg', style: 'opacity:0' });
    this.labels = h('div', { style: 'position:absolute;inset:0' });
    // clickable list of every player (both teams, alive or dead)
    this.players = h('div', { class: 'spec-players' });
    // pointerdown, not click: the list re-renders a few times a second and a click could be lost
    this.players.addEventListener('pointerdown', e => {
      const row = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
      if (!row) return;
      this.followId = +row.dataset.id!;
      this.pickedAt = this.game.time;
      if (this.cam === 'auto' || this.cam === 'free') this.setCam('follow');
      this.playersAt = 0;
    });
    const hud = h('div', { class: 'hud' }, h('div', { class: 'tl' }, this.minimap.canvas), this.top, this.feed, this.center, this.labels, this.info);
    const btn = (label: string, f: () => void, title = '') => h('button', { class: 'btn ghost', title, onclick: f }, label);
    const camBtn = (c: Cam, label: string) => { const b = btn(label, () => this.setCam(c)); this.camBtns.set(c, b); return b; };
    const pauseBtn = btn('❚❚', () => { this.paused = !this.paused; pauseBtn.textContent = this.paused ? '▶' : '❚❚'; }, 'Пауза (пробел)');
    this.botSel = h('select', { onchange: (e: Event) => { this.followId = +(e.target as HTMLSelectElement).value; this.pickedAt = this.game.time; if (this.cam === 'auto' || this.cam === 'free') this.setCam('follow'); } });
    const sbBtn = btn('Таблица', () => { this.sbHeld = !this.sbHeld; }, 'Tab');
    this.xrayBtn = btn(XRAY_NAMES[this.xray], () => this.cycleXray(), 'X — видеть бойцов сквозь стены');
    const plBtn = btn('Игроки', () => { this.playersOpen = !this.playersOpen; this.playersAt = 0; }, 'P — список всех бойцов');
    const bar = h('div', { class: 'replay-bar spec-bar' },
      pauseBtn,
      h('select', { title: 'Скорость', onchange: (e: Event) => { this.speed = +(e.target as HTMLSelectElement).value; } }, [0.5, 1, 2, 4].map(s => h('option', { value: s, selected: s === 1 }, `×${s}`))),
      camBtn('auto', 'Авто'), camBtn('follow', 'За бойцом'), camBtn('eyes', 'Глаза'), camBtn('free', 'Карта'),
      btn('◀', () => this.cycle(-1), 'Предыдущий боец (←)'), this.botSel, btn('▶', () => this.cycle(1), 'Следующий боец (→)'),
      this.xrayBtn, plBtn, sbBtn,
      h('button', { class: 'btn', onclick: () => this.end(true) }, 'Выход'),
    );
    this.root = h('div', { class: 'spectator', style: 'position:absolute;inset:0' }, hud, this.players, this.scoreboard.root, bar);
    this.renderer.xray = true;
    this.uiRoot.append(this.root);
    this.setCam('auto');
    this.refreshBotList();
    g.listeners.push(e => this.onEvent(e));
    const c = this.renderer.canvas;
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    c.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // --- input ------------------------------------------------------------------

  private onDown = (e: PointerEvent) => { this.orbit.drag = true; this.orbit.lx = e.clientX; this.orbit.ly = e.clientY; };
  private onUp = () => { this.orbit.drag = false; };
  private onMove = (e: PointerEvent) => {
    if (!this.orbit.drag) return;
    const dx = (e.clientX - this.orbit.lx) * 0.005, dy = (e.clientY - this.orbit.ly) * 0.005;
    this.orbit.lx = e.clientX; this.orbit.ly = e.clientY;
    if (this.cam === 'free') { this.orbit.yaw -= dx; this.orbit.pitch = clamp(this.orbit.pitch - dy, -1.5, -0.15); }
    else if (this.cam === 'follow' || this.cam === 'auto') this.chase.yaw -= dx;
  };
  private onWheel = (e: WheelEvent) => { this.orbit.dist = clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 10, 170); };
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') { this.paused = !this.paused; e.preventDefault(); }
    else if (e.code === 'ArrowRight') this.cycle(1);
    else if (e.code === 'ArrowLeft') this.cycle(-1);
    else if (e.code === 'Tab') { this.sbHeld = true; e.preventDefault(); }
    else if (e.code === 'Digit1') this.setCam('auto');
    else if (e.code === 'Digit2') this.setCam('follow');
    else if (e.code === 'Digit3') this.setCam('eyes');
    else if (e.code === 'Digit4') this.setCam('free');
    else if (e.code === 'KeyX') this.cycleXray();
    else if (e.code === 'KeyP') { this.playersOpen = !this.playersOpen; this.playersAt = 0; }
    else if (e.code === 'Escape') this.end(true);
  };
  private onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Tab') this.sbHeld = false; };

  private setCam(c: Cam): void {
    this.cam = c;
    this.chase.yaw = 0;
    this.renderer.setRoofsVisible(c !== 'free');
    for (const [k, b] of this.camBtns) b.classList.toggle('on', k === c);
  }

  private cycleXray(): void {
    const order: Xray[] = ['enemies', 'all', 'off'];
    this.xray = order[(order.indexOf(this.xray) + 1) % order.length];
    this.xrayBtn.textContent = XRAY_NAMES[this.xray];
    this.xrayBtn.classList.toggle('on', this.xray !== 'off');
  }

  /** Put living soldiers that should show through walls on the x-ray layer of their team. */
  private applyXray(view: Actor): void {
    const { CT, T } = Renderer.XRAY_LAYER;
    for (const a of this.game.actors) {
      const show = a.alive && this.xray !== 'off' && (this.xray === 'all' || (this.game.mode.ffa ? a !== view : a.team !== view.team));
      const layer = !show ? 0 : a.team === 'CT' ? CT : T;
      this.chars.get(a.id)!.root.traverse(o => {
        o.layers.disable(CT); o.layers.disable(T);
        if (layer) o.layers.enable(layer);
      });
    }
  }

  private cycle(dir: number): void {
    const pool = this.game.actors.filter(a => a.alive);
    if (!pool.length) return;
    const i = pool.findIndex(a => a.id === this.followId);
    this.followId = pool[(i + dir + pool.length) % pool.length].id;
    if (this.cam === 'auto' || this.cam === 'free') this.setCam('follow');
  }

  private refreshBotList(): void {
    const g = this.game;
    const sorted = g.actors.slice().sort((a, b) => (a.team === b.team ? a.id - b.id : a.team === 'CT' ? -1 : 1));
    this.botSel.replaceChildren(...sorted.map(a => h('option', { value: a.id, selected: a.id === this.followId },
      `${a.team === 'CT' ? 'Спецназ' : 'Атака'} · ${a.name}${a.alive ? '' : ' (погиб)'}`)));
  }

  // --- loop -------------------------------------------------------------------

  start(): void {
    this.running = true;
    this.last = performance.now();
    sfx.stopMusic();
    sfx.startAmbient(this.game.map.def.theme);
    this.message(this.title, `${this.game.map.def.name} · только боты · 1–4 — камеры, ←/→ — бойцы, пробел — пауза`, 4);
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(tms: number): void {
    const g = this.game;
    const dt = Math.min(0.1, (tms - this.last) / 1000);
    this.last = tms;
    const now = tms / 1000;
    if (!this.paused && !this.ended) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 40) {
        for (const a of g.actors) { const p = this.prev.get(a.id)!; p.x = a.pos.x; p.y = a.pos.y; p.z = a.pos.z; }
        g.step(TICK);
        this.acc -= TICK;
        steps++;
      }
      if (steps === 40) this.acc = 0;
    }
    g.drainEvents();
    const alpha = clamp(this.acc / TICK, 0, 1);
    this.pickDirectorTarget(g);
    let view = g.actors[this.followId] ?? g.actors[0];
    const eyes = this.cam === 'eyes' && view.alive;

    // characters
    for (const a of g.actors) {
      const cv = this.chars.get(a.id)!;
      cv.root.visible = (a.alive || g.time - a.deathTime < 10) && !(eyes && a === view);
      if (!cv.root.visible) continue;
      const p = this.interp(a, alpha);
      cv.root.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(a.vel.x, a.vel.z);
      const d = a.activeDef();
      cv.update({
        speed: sp, crouch: a.crouchAmt, airborne: !a.grounded, pitch: a.pitch, yaw: a.alive ? a.yaw : a.deathYaw,
        firingKick: Math.max(0, 1 - (g.time - a.lastShot) / 0.12), reloading: 0, throwing: 0,
        planting: a.planting > 0, defusing: a.defusing > 0, alive: a.alive, deathAge: g.time - a.deathTime,
        weaponId: d.id, weaponClass: d.cls, strafe: 0,
      }, dt);
    }

    // camera
    const vp = this.interp(view, alpha);
    let camPos: Vec3;
    if (eyes) {
      camPos = { x: vp.x, y: vp.y + view.eyeHeight, z: vp.z };
      this.renderer.setView(camPos, view.yaw, view.pitch, 90, dt);
      this.vm.visible = true;
      this.vm.update(view, g.time, dt, 0, 0, false);
    } else if (this.cam === 'free') {
      const cx = g.world.sizeX / 2, cz = g.world.sizeZ / 2;
      const back = new THREE.Vector3(Math.sin(this.orbit.yaw) * Math.cos(this.orbit.pitch), -Math.sin(this.orbit.pitch), Math.cos(this.orbit.yaw) * Math.cos(this.orbit.pitch));
      camPos = { x: cx + back.x * this.orbit.dist, y: back.y * this.orbit.dist, z: cz + back.z * this.orbit.dist };
      this.renderer.setView(camPos, this.orbit.yaw, this.orbit.pitch, 75, dt);
    } else {
      // chase camera behind the bot, kept in front of walls
      const yaw = view.yaw + this.chase.yaw, pitch = -0.32;
      const pivot = new THREE.Vector3(vp.x, vp.y + 1.7, vp.z);
      const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      let d = 5.5;
      const hit = g.world.raycast(pivot, back, d);
      if (hit) d = Math.max(0.6, hit.t - 0.3);
      camPos = { x: pivot.x + back.x * d, y: pivot.y + back.y * d, z: pivot.z + back.z * d };
      this.renderer.setView(camPos, yaw, pitch, 80, dt);
    }
    this.applyXray(view);
    sfx.setListener(camPos, { x: -Math.sin(view.yaw), y: 0, z: -Math.cos(view.yaw) });
    this.effects.sync(g, dt);
    this.renderer.render(eyes ? this.vm : null, now);

    this.updateHud(g, view, now);
    this.scoreboard.show(this.sbHeld || (g.mode.over && !this.ended));
    if (g.mode.over && !this.ended) {
      if (!this.endAt) this.endAt = now + 6;
      else if (now >= this.endAt) this.finish();
    }
  }

  private interp(a: Actor, alpha: number): Vec3 {
    const p = this.prev.get(a.id) ?? a.pos;
    if (vdist(p, a.pos) > 3) return { ...a.pos };
    return { x: lerp(p.x, a.pos.x, alpha), y: lerp(p.y, a.pos.y, alpha), z: lerp(p.z, a.pos.z, alpha) };
  }

  /** Director camera: stay on whoever is in the action, switch at most every few seconds. */
  private pickDirectorTarget(g: Game): void {
    const cur = g.actors[this.followId];
    if (this.cam !== 'auto') {
      const pickedDead = cur && !cur.alive && cur.deathTime < this.pickedAt;
      if (!cur?.alive && !pickedDead && g.time - (cur?.deathTime ?? 0) > 2.5) this.cycle(1);
      return;
    }
    if (cur?.alive && g.time < this.autoUntil) return;
    if (!cur?.alive && cur && g.time - cur.deathTime < 2) return; // let the death play out
    let best: Actor | null = null, bs = -Infinity;
    for (const a of g.actors) {
      if (!a.alive) continue;
      const act = this.action.get(a.id) ?? -99;
      let s = -(g.time - act) * 0.6;
      if (a.hasBomb || a.planting > 0 || a.defusing > 0) s += 3;
      if (a.id === this.followId) s += 1.5; // stickiness
      if (s > bs) { bs = s; best = a; }
    }
    if (best) {
      if (best.id !== this.followId) this.chase.yaw = 0;
      this.followId = best.id;
      this.autoUntil = g.time + 4;
    }
  }

  // --- events & HUD -----------------------------------------------------------

  private onEvent(e: GameEvent): void {
    const g = this.game;
    switch (e.type) {
      case 'shot': {
        this.action.set(e.actor, g.time);
        const def = WEAPONS[e.weapon];
        if (this.speed <= 2) sfx.gunshot(e.weapon, e.origin, vdist(e.origin, g.actors[this.followId]?.pos ?? e.origin));
        if (def && def.cls !== 'knife') {
          const mz = { x: e.origin.x + e.dir.x * 0.7, y: e.origin.y - 0.15 + e.dir.y * 0.7, z: e.origin.z + e.dir.z * 0.7 };
          this.effects.muzzle(mz, def.cls === 'pistol' ? 0.35 : 0.55, true);
          if (def.tracer && Math.random() < 0.6) this.effects.tracer(mz, e.end);
        }
        break;
      }
      case 'impact': this.effects.impact(e.pos, e.normal, e.kind); break;
      case 'hit': {
        const v = g.actors[e.victim], at = g.actors[e.attacker];
        const dx = v.pos.x - (at?.pos.x ?? v.pos.x), dz = v.pos.z - (at?.pos.z ?? v.pos.z), l = Math.hypot(dx, dz) || 1;
        this.effects.bloodHit(e.pos, { x: dx / l, y: 0, z: dz / l }, e.group === 'head');
        break;
      }
      case 'kill': {
        this.action.set(e.killer, g.time + 1);
        const k = g.actors[e.killer], v = g.actors[e.victim];
        const col = (a?: Actor) => (a ? (a.team === 'CT' ? 'k-ct' : 'k-t') : '');
        const wname = WEAPONS[e.weapon]?.name ?? (e.weapon === 'c4' ? 'Взрыв' : e.weapon);
        const tag = k && k !== v ? this.behindTag(k, v) : '';
        const d = h('div', { html: `<span class="${col(k)}">${k ? escapeHtml(k.name) : ''}</span> <span style="opacity:.8">[${escapeHtml(wname)}${e.headshot ? ' ⊕' : ''}${tag}]</span> <span class="${col(v)}">${escapeHtml(v.name)}</span>` });
        this.feed.prepend(d);
        while (this.feed.children.length > 6) this.feed.lastChild?.remove();
        setTimeout(() => d.remove(), 7000);
        this.refreshBotList();
        break;
      }
      case 'pickup': {
        const a = g.actors[e.actor];
        if (e.from && a) this.toast(`${a.name}: ${WEAPONS[e.from]?.name ?? e.from} → ${WEAPONS[e.weapon]?.name ?? e.weapon}`);
        break;
      }
      case 'detonate':
        if (e.grenade === 'he') { this.effects.explosion(e.pos); sfx.explosion(e.pos); }
        else if (e.grenade === 'flash') { this.effects.flashbangBurst(e.pos); sfx.flashbang(e.pos); }
        else if (e.grenade === 'smoke') sfx.smoke(e.pos);
        break;
      case 'planted': this.message('Бомба заложена', `Точка ${e.site}`, 2.5); sfx.beep(e.pos, 0); break;
      case 'bomb_beep': sfx.beep(e.pos, e.urgency); break;
      case 'defused': this.message('Бомба обезврежена', '', 2.5); break;
      case 'bomb_exploded': this.effects.explosion(e.pos, true); sfx.explosion(e.pos, true); break;
      case 'round_start': this.effects.clearRound(); for (const a of g.actors) this.prev.set(a.id, { ...a.pos }); this.recolor(); this.refreshBotList(); break;
      case 'round_end': this.message(e.winner === 'CT' ? 'Спецназ побеждает' : 'Атака побеждает', e.reason, 4); break;
      case 'halftime': this.message('Смена сторон', '', 3); break;
      case 'radio': {
        const a = g.actors[e.actor];
        if (a && /Обхожу|сзади/.test(e.text)) this.toast(`${a.name}: ${e.text}`);
        break;
      }
    }
  }

  /** Kill feed tag when the victim was looking away from the killer. */
  private behindTag(k: Actor, v: Actor): string {
    const dx = k.pos.x - v.pos.x, dz = k.pos.z - v.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const dot = (dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw)) / l;
    return dot < -0.2 ? ' · в спину' : '';
  }

  private recolor(): void {
    // team colors change at halftime
    for (const a of this.game.actors) {
      const cv = this.chars.get(a.id)!;
      if (cv.team !== a.team) {
        cv.dispose();
        const n = new CharacterView(a.team, a.model);
        this.renderer.scene.add(n.root);
        this.chars.set(a.id, n);
      }
    }
  }

  private message(title: string, sub: string, secs: number): void {
    this.center.innerHTML = `${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    this.center.style.opacity = '1';
    this.centerUntil = performance.now() / 1000 + secs;
  }

  private toast(text: string): void {
    const d = h('div', { class: 'spec-toast' }, text);
    this.info.after(d);
    setTimeout(() => d.remove(), 3500);
  }

  private intent(a: Actor): string {
    const bot = this.match.director.bots.find(b => b.actor === a);
    if (!bot || !a.alive) return '';
    const role = bot.brain?.roleOf(a.id);
    const gl = bot.goal as { kind: string; reason?: string };
    let what = gl.reason ? GOAL_NAMES[gl.reason] ?? (gl.reason.startsWith('hold') ? 'держит угол' : '') : '';
    if (gl.kind === 'pickup') what = 'подбирает оружие';
    else if (gl.kind === 'plant') what = 'ставит бомбу';
    else if (gl.kind === 'defuse') what = 'разминирует';
    else if (gl.kind === 'throw') what = 'бросает гранату';
    else if (gl.kind === 'retreat') what = 'отходит';
    return [role ? ROLE_NAMES[role] ?? '' : '', what].filter(Boolean).join(' · ');
  }

  private updateHud(g: Game, view: Actor, now: number): void {
    const hud = g.mode.hud();
    const ctScore = hud.usTeam === 'CT' ? hud.scoreUs : hud.scoreThem, tScore = hud.usTeam === 'CT' ? hud.scoreThem : hud.scoreUs;
    const alive = (t: string) => g.actors.filter(a => a.team === t).map(a => `<i class="${a.alive ? '' : 'dead'}"></i>`).join('');
    const timerCls = hud.phase === 'planted' ? 'timer bomb' : 'timer';
    const ffa = g.mode.ffa;
    this.top.innerHTML = ffa
      ? `<div class="${timerCls}">${fmtTime(hud.timer)}</div>`
      : `<div class="alive" style="color:var(--ct)">${alive('CT')}</div><div class="score ct">${ctScore}</div><div class="${timerCls}">${fmtTime(hud.timer)}</div><div class="score t">${tScore}</div><div class="alive" style="color:var(--t)">${alive('T')}</div>`;
    if (!ffa && g.mode.allowBomb) {
      // what each team is up to this round (spectators only)
      const tb = this.match.director.brains.find(b => b.team === 'T'), cb = this.match.director.brains.find(b => b.team === 'CT');
      const tPlan = tb ? `${PLAN_NAMES[tb.planKind]}${tb.fakeSite && tb.fakeSite !== tb.site ? ` (${tb.fakeSite})` : ''} → ${tb.site}` : '';
      this.top.insertAdjacentHTML('beforeend', `<div class="spec-plan"><span class="k-t">Атака: ${escapeHtml(tPlan)}</span>${cb?.ctSetup ? ` · <span class="k-ct">Спецназ: ${escapeHtml(cb.ctSetup)}</span>` : ''}</div>`);
    }
    if (now > this.centerUntil) this.center.style.opacity = '0';
    // followed bot
    const bot = this.match.director.bots.find(b => b.actor === view);
    const w = view.activeWeapon(), def = view.activeDef();
    const lvl = bot ? DIFFICULTY_NAMES[bot.profile.level - 1] ?? '' : '';
    const camName = { auto: 'авто-камера', follow: 'за бойцом', eyes: 'глазами бойца', free: 'обзор карты' }[this.cam];
    this.info.innerHTML = `<b class="${view.team === 'CT' ? 'k-ct' : 'k-t'}">${escapeHtml(view.name)}</b> · ${view.team === 'CT' ? 'спецназ' : 'атака'} · ${escapeHtml(lvl)}<br>` +
      `❤ ${view.health} · 🛡 ${view.armor} · ${escapeHtml(def.name)}${w && def.mag > 0 ? ` ${w.clip}/${w.reserve}` : ''}${g.mode.allowBomb ? ` · $${view.money}` : ''}<br>` +
      `<span style="color:#cbd5e1">${escapeHtml(this.intent(view) || (view.alive ? '' : 'погиб'))}</span><br><small style="color:#9ca3af">Камера: ${camName}${this.paused ? ' · пауза' : ''}${this.speed !== 1 ? ` · ×${this.speed}` : ''}</small>`;
    this.minimap.draw(this.radar(g, view));
    this.drawLabels(g, view);
    if (now > this.playersAt) { this.playersAt = now + 0.25; this.drawPlayers(g, view); }
    if (this.botSel.value !== String(view.id)) this.botSel.value = String(view.id);
    // keep the info card above the control bar (it wraps on narrow screens)
    this.info.style.bottom = `${(this.root.querySelector('.spec-bar') as HTMLElement).offsetHeight + 10}px`;
  }

  private radar(g: Game, view: Actor): RadarMarker[] {
    const out: RadarMarker[] = [];
    for (const s of g.smokes) out.push({ x: s.pos.x, z: s.pos.z, color: '', kind: 'smoke' });
    for (const f of g.fires) out.push({ x: f.pos.x, z: f.pos.z, color: '', kind: 'fire' });
    for (const a of g.actors) {
      if (!a.alive && g.time - a.deathTime > 6) continue;
      out.push({ x: a.pos.x, z: a.pos.z, yaw: a.alive ? a.yaw : undefined, color: a.team === 'CT' ? '#5aa0ff' : '#f0a83a', self: a === view, dead: !a.alive });
    }
    const b = g.bomb;
    if (g.mode.allowBomb && b.state !== 'none') {
      const p = b.state === 'carried' && g.actors[b.carrier] ? g.actors[b.carrier].pos : b.pos;
      out.push({ x: p.x, z: p.z, color: '#ff4030', kind: 'bomb' });
    }
    return out;
  }

  private drawPlayers(g: Game, view: Actor): void {
    this.players.classList.toggle('hidden', !this.playersOpen);
    if (!this.playersOpen) return;
    const teams = g.mode.ffa ? [g.actors.slice()] : (['CT', 'T'] as const).map(t => g.actors.filter(a => a.team === t));
    this.players.innerHTML = teams.map((list, i) => {
      const head = g.mode.ffa ? 'Все бойцы' : i === 0 ? 'Спецназ' : 'Атака';
      return `<div class="sp-head ${g.mode.ffa ? '' : i === 0 ? 'k-ct' : 'k-t'}">${head}</div>` + list.map(a => {
        const def = a.activeDef();
        const role = this.intent(a).split(' · ')[0];
        return `<div class="sp-row${a.id === view.id ? ' on' : ''}${a.alive ? '' : ' dead'}" data-id="${a.id}">` +
          `<span class="sp-name ${a.team === 'CT' ? 'k-ct' : 'k-t'}">${escapeHtml(a.name)}</span>` +
          `<span class="sp-hp"><i style="width:${a.alive ? a.health : 0}%"></i></span>` +
          `<span class="sp-w">${a.alive ? escapeHtml(def.name) : 'погиб'}${role && a.alive ? ` · ${escapeHtml(role)}` : ''}</span></div>`;
      }).join('');
    }).join('');
  }

  /** Name + intent above every living bot (pooled DOM nodes). */
  private drawLabels(g: Game, view: Actor): void {
    const cam = this.renderer.camera;
    const v = new THREE.Vector3();
    let n = 0;
    const camPos = cam.position;
    for (const a of g.actors) {
      if (!a.alive || (this.cam === 'eyes' && a === view)) continue;
      v.set(a.pos.x, a.pos.y + 2.1, a.pos.z);
      const dist = v.distanceTo(camPos);
      if (dist > 60) continue;
      v.project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      let el = this.labelPool[n];
      if (!el) { el = h('div', { class: 'label3d spec-label' }); this.labelPool.push(el); this.labels.append(el); }
      el.style.display = '';
      el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
      el.style.color = a.team === 'CT' ? 'var(--ct)' : 'var(--t)';
      const intent = this.intent(a);
      el.innerHTML = `${escapeHtml(a.name)}${intent ? `<small>${escapeHtml(intent)}</small>` : ''}`;
      n++;
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }

  // --- end --------------------------------------------------------------------

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const hud = this.game.mode.hud();
    const ctScore = hud.usTeam === 'CT' ? hud.scoreUs : hud.scoreThem, tScore = hud.usTeam === 'CT' ? hud.scoreThem : hud.scoreUs;
    this.scoreboard.show(true);
    const box = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
      h('h2', {}, 'Матч окончен'),
      h('p', { class: 'sub' }, this.game.mode.ffa ? 'Бой насмерть завершён.' : `Итоговый счёт по командам (первый состав): ${ctScore}:${tScore}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { this.dispose(); this.onAgain?.(); } }, 'Ещё матч'),
        h('button', { class: 'btn ghost', onclick: () => { this.dispose(); this.onExit?.(); } }, 'В меню'),
      )));
    this.root.append(box);
  }

  end(_abandoned: boolean): void {
    if (this.ended && !this.running) { this.dispose(); this.onExit?.(); return; }
    this.ended = true;
    this.dispose();
    this.onExit?.();
  }

  private disposed = false;
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const c = this.renderer.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    sfx.stopLoops();
    this.renderer.setRoofsVisible(true);
    this.renderer.xray = false;
    this.root.remove();
    for (const cv of this.chars.values()) cv.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }
}
