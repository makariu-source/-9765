// A running match on the client: sim loop + rendering + input + HUD.
import * as THREE from 'three';
import type { Actor } from '../sim/actor';
import { TICK, recoilOffset, type Controller, type Game } from '../sim/game';
import { createMatch, type Match, type MatchSetup } from '../match';
import { DEG, anglesFromDir, clamp, dirFromAngles, lerp, vdist, wrapAngle, type Vec3 } from '../sim/math';
import type { MatchResult } from '../sim/modes/mode';
import { ReplayRecorder, type Replay } from '../sim/replay';
import { emptyInput, type GameEvent, type InputCmd } from '../sim/types';
import { WEAPONS, type GrenadeType } from '../sim/weapons';
import { calloutAt } from '../sim/maps/mapgrid';
import type { ArmsRaceMode } from '../sim/modes/respawn';
import type { BombMode } from '../sim/modes/bomb';
import type { TrainingMode, TrainingSettings } from '../sim/modes/training';
import type { ApplyContext, Settings } from '../meta/profile';
import { sfx } from './audio/sfx';
import { Input, isTouchDevice } from './input/input';
import { CharacterView } from './render/characters';
import { Effects } from './render/effects';
import type { Renderer } from './render/renderer';
import { ViewModel } from './render/viewmodel';
import { h } from './ui/dom';
import { Hud, escapeHtml, type HudModel } from './ui/hud';
import { Minimap, type RadarMarker } from './ui/minimap';
import { BuyMenu, Scoreboard } from './ui/panels';
import { TouchControls } from './ui/touch';

export interface SessionOptions {
  setup: MatchSetup;
  ratingSystem: 'mmr' | 'wingman' | 'elo' | 'none';
  ctx: ApplyContext;
  title: string;
  ranked: boolean;
}

const NADE_SHORT: Record<string, string> = { he: 'HE', flash: 'FL', smoke: 'SM', molotov: 'MO', decoy: 'DC' };

export class Session {
  readonly match: Match;
  readonly game: Game;
  readonly input = new Input();
  private hud: Hud;
  private minimap: Minimap;
  private buyMenu: BuyMenu;
  private scoreboard: Scoreboard;
  private touch: TouchControls | null = null;
  private vm: ViewModel;
  private effects: Effects;
  private chars = new Map<number, CharacterView>();
  private prev = new Map<number, Vec3>();
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;
  paused = false;
  private pending: Partial<InputCmd> = {};
  private cmd: InputCmd = emptyInput();
  private spectateId = -1;
  private recorder: ReplayRecorder;
  private endAt = 0;
  private ended = false;
  private fpsAcc = { n: 0, t: 0, fps: 0 };
  private overlay: HTMLDivElement;
  private layer: HTMLDivElement;
  private afk = false;
  private bombKnownSpot: Vec3 | null = null;
  onEnd: ((r: MatchResult, replay: Replay) => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(private renderer: Renderer, private uiRoot: HTMLElement, private settings: Settings, readonly opts: SessionOptions) {
    this.match = createMatch(opts.setup);
    this.game = this.match.game;
    const g = this.game;
    this.recorder = new ReplayRecorder(g);
    const human = g.human()!;
    this.input.yaw = human.yaw;
    this.input.pitch = 0;
    const controller: Controller = { think: () => this.takeCmd() };
    g.controllers.set(human.id, controller);
    // rendering
    this.renderer.loadWorld(g.world);
    this.effects = new Effects(this.renderer.scene);
    this.effects.particleScale = settings.graphics.particles;
    this.vm = new ViewModel(this.renderer.camera.aspect);
    for (const a of g.actors) {
      const cv = new CharacterView(a.team, a.model);
      this.renderer.scene.add(cv.root);
      this.chars.set(a.id, cv);
      this.prev.set(a.id, { ...a.pos });
    }
    // UI
    this.minimap = new Minimap(g.map, window.innerWidth < 900 ? 130 : 200);
    this.hud = new Hud(this.minimap, settings, true);
    this.buyMenu = new BuyMenu(g, () => this.game.human()!, (item, ok, reason) => { if (ok) sfx.ui_click(); else if (reason) this.hud.message('', reason, 1.2); void item; });
    this.scoreboard = new Scoreboard(g);
    this.overlay = h('div', { class: 'menu overlay hidden' });
    this.layer = h('div', { style: 'position:absolute;inset:0' }, this.hud.root, this.scoreboard.root, this.buyMenu.root, this.overlay);
    this.uiRoot.append(this.layer);
    const touchScheme = settings.controls.scheme === 'touch' || (settings.controls.scheme === 'auto' && isTouchDevice());
    if (touchScheme) {
      this.touch = new TouchControls(this.input, settings);
      this.hud.root.classList.add('touchmode');
      this.layer.insertBefore(this.touch.root, this.scoreboard.root);
    }
    this.input.sensitivity = settings.sensitivity;
    this.input.invertY = settings.invertY;
    this.input.crouchToggle = settings.controls.crouchToggle;
    this.input.walkToggle = settings.controls.walkToggle;
    this.input.setBindings(settings.controls.bindings);
    this.input.attach(this.renderer.canvas);
    this.input.onPauseRequest = reason => {
      if (this.ended) return;
      if (reason === 'unlock') { if (!this.buyMenu.open && !this.paused) this.setPaused(true); return; }
      if (this.buyMenu.open) { this.buyMenu.toggle(false); if (!this.touch) this.input.requestLock(); return; }
      this.setPaused(!this.paused);
      if (!this.paused && !this.touch) this.input.requestLock();
    };
    g.listeners.push(e => { if (e.type === 'round_start') this.onRoundStart(); });
  }

  start(): void {
    this.running = true;
    this.lastFrame = performance.now();
    sfx.stopMusic();
    sfx.jingle('start');
    sfx.startAmbient(this.game.map.def.theme);
    this.hud.message(this.opts.title, this.game.mode.id === 'training' ? `${this.game.map.def.name} · B — магазин оружия, Esc — смена сценария` : `${this.game.map.def.name} · соперники и союзники — боты (ИИ)`, 3.5);
    if (!this.touch) this.input.requestLock();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private takeCmd(): InputCmd {
    const c = { ...this.cmd, ...this.pending };
    this.pending = {};
    return c;
  }

  setPaused(on: boolean): void {
    this.paused = on;
    this.overlay.classList.toggle('hidden', !on);
    this.input.enabled = !on;
    if (on) {
      this.input.clear();
      this.input.releaseLock();
      const ranked = this.opts.ranked;
      this.overlay.replaceChildren(h('div', { class: 'content', style: 'max-width:520px;margin:auto' },
        h('h1', {}, 'Пауза'),
        h('p', { class: 'sub' }, ranked ? 'Рейтинговый матч не останавливается — боты продолжают играть.' : 'Игра приостановлена.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.setPaused(false); if (!this.touch) this.input.requestLock(); } }, 'Продолжить'),
          h('button', { class: 'btn ghost', onclick: () => this.confirmLeave() }, 'Покинуть матч'),
        ),
        h('h2', {}, 'Быстрые настройки'),
        h('div', { class: 'form' },
          h('label', {}, 'Чувствительность'),
          h('input', { type: 'range', min: 0.2, max: 6, step: 0.05, value: this.settings.sensitivity, oninput: (e: Event) => { this.settings.sensitivity = +(e.target as HTMLInputElement).value; this.input.sensitivity = this.settings.sensitivity; } }),
          h('label', {}, 'Громкость'),
          h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: this.settings.volume.master, oninput: (e: Event) => { this.settings.volume.master = +(e.target as HTMLInputElement).value; sfx.volumes.master = this.settings.volume.master; sfx.applyVolumes(); } }),
        ),
        this.touch ? h('button', { class: 'btn ghost', style: 'margin-top:14px', onclick: () => this.editTouch() }, 'Настроить сенсорные кнопки') : null,
        this.trainingPanel(),
      ));
    }
  }

  /** Training: switch scenario/parameters without leaving the range. */
  private trainingPanel(): HTMLElement | null {
    if (this.game.mode.id !== 'training') return null;
    const tm = this.game.mode as TrainingMode;
    const st = { ...tm.settings };
    const scen: [TrainingSettings['scenario'], string][] = [['static', 'Стрельбище'], ['moving', 'Движущиеся'], ['reaction', 'Реакция'], ['recoil', 'Отдача'], ['grenades', 'Гранаты']];
    const h0 = this.game.human()!;
    const rt = tm.avgReaction();
    return h('div', {},
      h('h2', {}, 'Тренировка'),
      h('p', { class: 'sub' }, `Выстрелов ${h0.stats.shotsFired} · попаданий ${h0.stats.shotsHit} · точность ${h0.stats.shotsFired ? Math.round(h0.stats.shotsHit / h0.stats.shotsFired * 100) : 0}% · в голову ${h0.stats.headshots}${rt ? ` · реакция ${Math.round(rt * 1000)} мс` : ''}`),
      h('div', { class: 'form' },
        h('label', {}, 'Сценарий'),
        h('select', { onchange: (e: Event) => { st.scenario = (e.target as HTMLSelectElement).value as TrainingSettings['scenario']; } }, scen.map(([v, n]) => h('option', { value: v, selected: st.scenario === v }, n))),
        h('label', {}, 'Дистанция, м'), h('input', { type: 'number', min: 5, max: 48, value: st.distance, onchange: (e: Event) => { st.distance = +(e.target as HTMLInputElement).value; } }),
        h('label', {}, 'Скорость целей, м/с'), h('input', { type: 'number', min: 0.5, max: 7, step: 0.5, value: st.speed, onchange: (e: Event) => { st.speed = +(e.target as HTMLInputElement).value; } }),
        h('label', {}, 'Направление'), h('select', { onchange: (e: Event) => { st.axis = (e.target as HTMLSelectElement).value as 'x' | 'z'; } }, h('option', { value: 'x', selected: st.axis === 'x' }, 'Влево-вправо'), h('option', { value: 'z', selected: st.axis === 'z' }, 'Вперёд-назад')),
      ),
      h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => { tm.applySettings(st); h0.stats.shotsFired = 0; h0.stats.shotsHit = 0; h0.stats.headshots = 0; h0.stats.kills = 0; this.setPaused(false); if (!this.touch) this.input.requestLock(); } }, 'Применить'),
    );
  }

  private editTouch(): void {
    if (!this.touch) return;
    this.overlay.classList.add('hidden');
    this.touch.setEditing(true);
    const done = h('button', { class: 'btn', style: 'position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:60', onclick: () => { this.touch!.setEditing(false); done.remove(); this.overlay.classList.remove('hidden'); } }, 'Готово — перетаскивайте кнопки');
    this.layer.append(done);
  }

  private confirmLeave(): void {
    const ranked = this.opts.ranked;
    const m = h('div', { class: 'modal-back' }, h('div', { class: 'modal' },
      h('h2', {}, 'Покинуть матч?'),
      h('p', { class: 'sub' }, ranked
        ? (this.opts.ratingSystem === 'elo' ? 'Выход из матча PRO League засчитывается как поражение со штрафом ELO и временным запретом поиска.' : 'Выход засчитывается как поражение, а поиск рейтинговых матчей будет временно недоступен.')
        : 'Матч будет прерван. Рейтинг не изменится.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn danger', onclick: () => { m.remove(); this.end(true); } }, 'Покинуть'),
        h('button', { class: 'btn ghost', onclick: () => m.remove() }, 'Отмена'),
      )));
    this.layer.append(m);
  }

  private onRoundStart(): void {
    this.effects.clearRound();
    this.touch?.reset();
    this.spectateId = -1;
    this.bombKnownSpot = null;
    const g = this.game;
    const human = g.human()!;
    this.input.yaw = human.yaw;
    this.input.pitch = 0;
    for (const a of g.actors) this.prev.set(a.id, { ...a.pos });
    const m = g.mode as BombMode;
    if (m.round) this.hud.message(`Раунд ${m.round}`, human.team === 'CT' ? 'Вы в защите' : 'Вы в атаке', 2.5);
    // team colors may change after halftime
    for (const a of g.actors) {
      const cv = this.chars.get(a.id)!;
      if (cv.team !== a.team) {
        cv.dispose();
        const n = new CharacterView(a.team, a.model);
        this.renderer.scene.add(n.root);
        this.chars.set(a.id, n);
      }
    }
  }

  // ---------------------------------------------------------------------------

  private frame(tms: number): void {
    const g = this.game;
    const dt = Math.min(0.1, (tms - this.lastFrame) / 1000);
    this.lastFrame = tms;
    const now = tms / 1000;
    const human = g.human()!;
    this.processEdges(human);
    this.applyAimAssist(human, dt);
    this.buildCmd(human);

    const simPaused = this.paused && !this.opts.ranked;
    if (!simPaused && !this.ended) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 8) {
        for (const a of g.actors) { const p = this.prev.get(a.id)!; p.x = a.pos.x; p.y = a.pos.y; p.z = a.pos.z; }
        g.step(TICK);
        this.acc -= TICK;
        steps++;
      }
      if (steps === 8) this.acc = 0;
    }
    const alpha = clamp(this.acc / TICK, 0, 1);
    this.handleEvents(g.drainEvents(), human, now);

    // AFK detection (input unchanged for 90 s during a live phase)
    if (human.alive && g.mode.canMove(human) && g.time - human.lastInputChange > 90 && !this.paused) this.afk = true;

    // camera
    let viewActor = human;
    if (!human.alive) {
      if (this.spectateId < 0 || !g.actors[this.spectateId]?.alive) this.pickSpectate(human);
      if (this.spectateId >= 0 && g.time - human.deathTime > 1.2) viewActor = g.actors[this.spectateId];
    }
    const ip = this.interp(viewActor, alpha);
    let yaw = viewActor === human ? this.input.yaw : viewActor.yaw;
    let pitch = viewActor === human ? this.input.pitch : viewActor.pitch;
    const def = viewActor.activeDef();
    const punch = recoilOffset(def, viewActor.spray);
    yaw += punch.yaw * 0.5; pitch += punch.pitch * 0.5;
    let eyeY = ip.y + viewActor.eyeHeight;
    if (!viewActor.alive) {
      // death cam: sink and tilt
      const age = g.time - viewActor.deathTime;
      eyeY = ip.y + lerp(viewActor.eyeHeight, 0.4, clamp(age / 0.7, 0, 1));
      pitch = lerp(pitch, -0.5, clamp(age / 0.7, 0, 1));
    }
    let fov = this.settings.fov;
    if (def.scope && viewActor.scopeLevel > 0) fov = def.scope[viewActor.scopeLevel];
    this.input.zoomSens = viewActor === human && def.scope && human.scopeLevel > 0 ? def.scope[human.scopeLevel] / this.settings.fov : 1;
    this.renderer.setView({ x: ip.x, y: eyeY, z: ip.z }, yaw, pitch, fov, dt);
    sfx.setListener({ x: ip.x, y: eyeY, z: ip.z }, dirFromAngles(yaw, pitch));

    // characters
    for (const a of g.actors) {
      const cv = this.chars.get(a.id)!;
      const firstPerson = a === viewActor && a.alive;
      cv.root.visible = !firstPerson && (a.alive || g.time - a.deathTime < 12) && a.connected;
      if (!cv.root.visible) continue;
      const p = this.interp(a, alpha);
      cv.root.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(a.vel.x, a.vel.z);
      const fwdx = -Math.sin(a.yaw), fwdz = -Math.cos(a.yaw);
      const strafe = sp > 0.1 ? (a.vel.x * fwdz - a.vel.z * fwdx) / sp : 0;
      const d = a.activeDef();
      cv.update({
        speed: sp, crouch: a.crouchAmt, airborne: !a.grounded, pitch: a.pitch, yaw: a.alive ? a.yaw : a.deathYaw,
        firingKick: Math.max(0, 1 - (g.time - a.lastShot) / 0.12), reloading: a.reloadEnd > g.time ? 1 - (a.reloadEnd - g.time) / Math.max(0.3, d.reloadTime) : 0,
        throwing: a.throwStart > 0 ? clamp((g.time - a.throwStart) / 0.5, 0, 0.99) : 0, planting: a.planting > 0, defusing: a.defusing > 0,
        alive: a.alive, deathAge: g.time - a.deathTime, weaponId: d.id, weaponClass: d.cls, strafe,
      }, dt);
    }
    // viewmodel
    const md = this.input.consumeFrameDelta();
    this.vm.visible = true;
    this.vm.update(viewActor, g.time, dt, viewActor === human ? md.dx : 0, viewActor === human ? md.dy : 0, this.settings.viewBob);
    this.effects.sync(g, dt);
    this.renderer.render(this.vm, now);

    // HUD
    this.fpsAcc.n++; this.fpsAcc.t += dt;
    if (this.fpsAcc.t > 0.5) { this.fpsAcc.fps = Math.round(this.fpsAcc.n / this.fpsAcc.t); this.fpsAcc.n = 0; this.fpsAcc.t = 0; }
    this.hud.update(this.hudModel(human, viewActor), now);
    this.minimap.draw(this.radar(human, viewActor));
    this.scoreboard.show(this.input.isHeld('scoreboard') || (g.mode.over && !this.ended));
    if (this.buyMenu.open && !g.mode.canBuy(human)) this.buyMenu.toggle(false);

    // match end
    if (g.mode.over && !this.ended) {
      if (!this.endAt) { this.endAt = now + 5; }
      else if (now >= this.endAt) this.end(false);
    }
  }

  private interp(a: Actor, alpha: number): Vec3 {
    const p = this.prev.get(a.id) ?? a.pos;
    // avoid smearing across teleports (spawns)
    if (vdist(p, a.pos) > 3) return { ...a.pos };
    return { x: lerp(p.x, a.pos.x, alpha), y: lerp(p.y, a.pos.y, alpha), z: lerp(p.z, a.pos.z, alpha) };
  }

  private processEdges(human: Actor): void {
    for (const e of this.input.consumeEdges()) {
      switch (e) {
        case 'slot1': this.pending.select = 'primary'; break;
        case 'slot2': this.pending.select = 'secondary'; break;
        case 'slot3': this.pending.select = 'melee'; break;
        case 'slot4': case 'grenade': this.pending.select = 'grenade'; break;
        case 'slot5': this.pending.select = 'bomb'; break;
        case 'reload': this.pending.reload = true; break;
        case 'inspect': this.pending.inspect = true; break;
        case 'drop': this.pending.drop = true; break;
        case 'lastWeapon': this.pending.lastWeapon = true; break;
        case 'nextWeapon': case 'prevWeapon': {
          const order: ('primary' | 'secondary' | 'melee' | 'grenade' | 'bomb')[] = ['primary', 'secondary', 'melee', 'grenade', 'bomb'];
          const have = order.filter(s => (s === 'primary' && human.primary) || (s === 'secondary' && human.secondary) || s === 'melee' || (s === 'grenade' && human.grenades.length) || (s === 'bomb' && human.hasBomb));
          const i = have.indexOf(human.active);
          const n = have[(i + (e === 'nextWeapon' ? 1 : have.length - 1)) % have.length];
          this.pending.select = n;
          break;
        }
        case 'buy':
          if (this.game.mode.canBuy(human)) {
            this.buyMenu.toggle();
            if (this.buyMenu.open) this.input.releaseLock();
            if (!this.buyMenu.open && !this.touch) this.input.requestLock();
          } else this.hud.message('', 'Покупка сейчас недоступна', 1.2);
          break;
        case 'spectateNext': this.pickSpectate(human, true); break;
      }
    }
  }

  private buildCmd(human: Actor): void {
    const mv = this.input.moveAxes();
    const blocked = this.buyMenu.open || this.paused;
    const c = this.cmd;
    c.forward = blocked ? 0 : mv.forward;
    c.right = blocked ? 0 : mv.right;
    c.yaw = this.input.yaw;
    c.pitch = this.input.pitch;
    c.jump = !blocked && this.input.isHeld('jump');
    c.crouch = !blocked && this.input.isHeld('crouch');
    c.walk = !blocked && this.input.isHeld('walk');
    c.fire = !blocked && this.input.isHeld('fire');
    c.fire2 = !blocked && this.input.isHeld('fire2');
    c.use = !blocked && this.input.isHeld('use');
    c.select = null; c.reload = false; c.inspect = false; c.drop = false; c.lastWeapon = false;
    // when dead, clicking cycles spectated player
    if (!human.alive && this.input.isHeld('fire') && !this.lastClick) { this.pickSpectate(human, true); }
    this.lastClick = !human.alive && this.input.isHeld('fire');
  }
  private lastClick = false;

  /** Touch-only aim assist in casual modes: slows the view over an enemy and pulls gently. */
  private applyAimAssist(human: Actor, dt: number): void {
    if (!this.touch || !this.settings.touch.aimAssist || this.opts.ranked || !human.alive) return;
    const g = this.game;
    const eye = human.eye();
    let best: { dy: number; dp: number; d: number } | null = null;
    for (const o of g.actors) {
      if (!o.alive || o === human || (!g.mode.ffa && o.team === human.team)) continue;
      const tp = o.visPoints()[1];
      const ang = anglesFromDir({ x: tp.x - eye.x, y: tp.y - eye.y, z: tp.z - eye.z });
      const dy = wrapAngle(ang.yaw - this.input.yaw), dp = ang.pitch - this.input.pitch;
      const d = Math.hypot(dy, dp);
      if (d > 5 * DEG || !g.world.lineClear(eye, tp)) continue;
      if (!best || d < best.d) best = { dy, dp, d };
    }
    if (best) {
      const pull = Math.min(best.d, 2.5 * DEG * dt) / best.d;
      this.input.yaw += best.dy * pull;
      this.input.pitch += best.dp * pull;
    }
  }

  private pickSpectate(human: Actor, next = false): void {
    const g = this.game;
    const pool = g.actors.filter(a => a.alive && a !== human && (g.mode.ffa ? false : a.team === human.team));
    if (!pool.length) {
      // FFA / everyone dead: watch the killer
      const k = g.actors[human.killedBy];
      this.spectateId = k && k.alive ? k.id : -1;
      return;
    }
    const i = pool.findIndex(a => a.id === this.spectateId);
    this.spectateId = pool[next ? (i + 1) % pool.length : Math.max(0, i)].id;
  }

  // ---------------------------------------------------------------------------

  private handleEvents(events: GameEvent[], human: Actor, now: number): void {
    const g = this.game;
    const listenerPos = human.alive ? human.eye() : (g.actors[this.spectateId]?.eye() ?? human.eye());
    const isLocal = (id: number) => id === human.id && human.alive;
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const a = g.actors[e.actor];
          const def = WEAPONS[e.weapon];
          if (isLocal(e.actor)) {
            this.vm.onShot(!!human.input.fire2 && !human.input.fire);
            sfx.gunshot(e.weapon, null);
            if (def.cls !== 'knife' && def.tracer && Math.random() < 0.5) {
              const m = this.vm.muzzleWorld(new THREE.Vector3());
              if (m) {
                // viewmodel space -> world (approximate)
                const cam = this.renderer.camera;
                const local = m.clone();
                const wpos = cam.localToWorld(local);
                this.effects.tracer(wpos, e.end);
              }
            }
          } else {
            sfx.gunshot(e.weapon, e.origin, vdist(e.origin, listenerPos));
            if (def.cls !== 'knife') {
              const right = { x: Math.cos(a.yaw) * 0.18, z: -Math.sin(a.yaw) * 0.18 };
              const mz = { x: e.origin.x + right.x + e.dir.x * 0.7, y: e.origin.y - 0.15 + e.dir.y * 0.7, z: e.origin.z + right.z + e.dir.z * 0.7 };
              this.effects.muzzle(mz, def.cls === 'pistol' ? 0.35 : 0.55, vdist(mz, listenerPos) < 40);
              if (def.tracer && Math.random() < 0.6) this.effects.tracer(mz, e.end);
            }
          }
          break;
        }
        case 'impact': this.effects.impact(e.pos, e.normal, e.kind); break;
        case 'hit': {
          const v = g.actors[e.victim];
          const dir = { x: v.pos.x - (g.actors[e.attacker]?.pos.x ?? v.pos.x), y: 0, z: v.pos.z - (g.actors[e.attacker]?.pos.z ?? v.pos.z) };
          const l = Math.hypot(dir.x, dir.z) || 1;
          this.effects.bloodHit(e.pos, { x: dir.x / l, y: 0, z: dir.z / l }, e.group === 'head');
          if (e.attacker === human.id) { this.hud.hit(false, now); sfx.hitmarker(); }
          if (e.victim === human.id || (e.attacker === human.id)) sfx.hitFlesh(e.victim === human.id ? null : e.pos, e.group === 'head', e.armorHit && v.helmet, e.victim === human.id);
          if (e.victim === human.id && e.attacker >= 0) {
            const at = g.actors[e.attacker];
            const ang = Math.atan2(-(at.pos.x - human.pos.x), -(at.pos.z - human.pos.z));
            this.hud.damageFrom(-(wrapAngle(ang - this.input.yaw)));
          }
          break;
        }
        case 'kill': {
          const k = g.actors[e.killer], v = g.actors[e.victim];
          const col = (a?: Actor) => (a ? (a.team === 'CT' ? 'k-ct' : 'k-t') : '');
          const icons = `${e.headshot ? ' ⊕' : ''}${e.wallbang ? ' ⫴' : ''}${e.noscope ? ' ◌' : ''}${e.throughSmoke ? ' ☁' : ''}${e.flashAssist ? ' ✺' : ''}`;
          const ass = e.assister >= 0 ? ` + ${escapeHtml(g.actors[e.assister].name)}` : '';
          const wname = WEAPONS[e.weapon]?.name ?? (e.weapon === 'c4' ? 'Взрыв' : e.weapon === 'fall' ? 'Падение' : e.weapon);
          this.hud.killfeed(`<span class="${col(k)}">${k ? escapeHtml(k.name) : ''}</span>${ass} <span style="opacity:.8">[${escapeHtml(wname)}${icons}]</span> <span class="${col(v)}">${escapeHtml(v.name)}</span>`, e.killer === human.id || e.victim === human.id);
          if (e.killer === human.id && e.victim !== human.id) { this.hud.hit(true, now); sfx.killConfirm(e.headshot); }
          if (e.victim === human.id) {
            this.hud.message('Вы погибли', k && k !== human ? `${k.name} · ${wname}${e.headshot ? ' · в голову' : ''}` : '', 3);
            this.pickSpectate(human);
          }
          break;
        }
        case 'reload': sfx.reload(e.weapon, isLocal(e.actor) ? null : g.actors[e.actor].pos); break;
        case 'dryfire': if (isLocal(e.actor)) sfx.dry(); break;
        case 'footstep': if (!isLocal(e.actor)) sfx.footstep(e.pos, e.loud); else if (e.loud) sfx.footstep(null, true); break;
        case 'land': if (e.speed > 4) sfx.land(isLocal(e.actor) ? null : g.actors[e.actor].pos); break;
        case 'switch': if (isLocal(e.actor)) sfx.switchWeapon(); break;
        case 'throw': if (e.id >= 0) sfx.bounce(isLocal(e.actor) ? null : g.actors[e.actor].pos); break;
        case 'bounce': sfx.bounce(e.pos); break;
        case 'detonate': {
          const d = vdist(e.pos, listenerPos);
          if (e.grenade === 'he') { this.effects.explosion(e.pos); sfx.explosion(e.pos); this.renderer.addShake(clamp(1 - d / 20, 0, 0.8)); }
          else if (e.grenade === 'flash') { this.effects.flashbangBurst(e.pos); sfx.flashbang(e.pos); }
          else if (e.grenade === 'smoke') sfx.smoke(e.pos);
          else if (e.grenade === 'molotov') { sfx.glass(e.pos); sfx.fireLoop(e.id, e.pos, true); setTimeout(() => sfx.fireLoop(e.id, null, false), 7000); }
          break;
        }
        case 'flashed':
          if (e.actor === human.id) { this.hud.flash(e.strength, e.duration, now); sfx.ringing(e.strength, e.duration); }
          break;
        case 'decoy_shot': sfx.gunshot(e.weapon, e.pos, vdist(e.pos, listenerPos)); break;
        case 'plant_start': sfx.keypad(g.actors[e.actor].pos); break;
        case 'planted': this.hud.message('Бомба заложена', `Точка ${e.site}`, 2.5); sfx.beep(e.pos, 0); if (human.team === 'T') this.bombKnownSpot = e.pos; break;
        case 'defuse_start': sfx.defuseKit(g.actors[e.actor].pos); break;
        case 'defused': this.hud.message('Бомба обезврежена', '', 2.5); break;
        case 'bomb_beep': sfx.beep(e.pos, e.urgency); break;
        case 'bomb_exploded': this.effects.explosion(e.pos, true); sfx.explosion(e.pos, true); this.renderer.addShake(clamp(1 - vdist(e.pos, listenerPos) / 40, 0.2, 1)); break;
        case 'round_live': this.hud.message('Вперёд!', '', 1.2); break;
        case 'round_end': {
          const win = e.winner === human.team;
          const mvp = g.actors[e.mvp];
          this.hud.message(win ? 'Раунд выигран' : 'Раунд проигран', `${e.reason}${mvp ? ` · MVP: ${mvp.name}` : ''}`, 4);
          sfx.jingle(win ? 'win' : 'lose');
          if (mvp?.id === human.id) setTimeout(() => sfx.jingle('mvp'), 600);
          if (this.buyMenu.open) this.buyMenu.toggle(false);
          break;
        }
        case 'halftime': this.hud.message('Смена сторон', 'Деньги и оружие сброшены', 4); break;
        case 'match_end': this.hud.message('Матч окончен', '', 5); break;
        case 'level_up': if (e.actor === human.id) { this.hud.message(`Уровень ${e.level + 1}`, WEAPONS[e.weapon]?.name ?? '', 1.5); sfx.jingle('levelup'); } break;
        case 'announce': if (!e.team || e.team === human.team) this.hud.message('', e.text, 2); break;
        case 'radio': { const a = g.actors[e.actor]; if (a && (g.mode.ffa ? false : a.team === human.team)) this.hud.radio(a.name, e.text, a.team); break; }
        case 'pickup': if (isLocal(e.actor)) sfx.switchWeapon(); break;
        case 'bomb_pickup': if (e.actor === human.id) this.hud.message('', 'Вы подобрали бомбу (5)', 2); break;
        case 'target_hit': this.hud.hit(false, now); sfx.hitmarker(); break;
      }
    }
  }

  private hudModel(human: Actor, view: Actor): HudModel {
    const g = this.game;
    const hud = g.mode.hud();
    const a = view;
    const w = a.activeWeapon();
    const def = a.activeDef();
    const usTeam = human.team;
    const us = g.actors.filter(x => (g.mode.ffa ? x === human : x.team === usTeam));
    const them = g.actors.filter(x => (g.mode.ffa ? x !== human : x.team !== usTeam));
    let progress: HudModel['progress'] = null;
    if (a.planting > 0) progress = { label: 'Установка бомбы…', frac: a.planting / 3.2 };
    if (a.defusing > 0) progress = { label: a.kit ? 'Разминирование (набор)…' : 'Разминирование…', frac: a.defusing / (a.kit ? 5 : 10) };
    let hint = '';
    if (human.alive) {
      if (g.mode.canBuy(human) && !this.buyMenu.open && g.mode.allowBomb) hint = this.touch ? 'Нажмите $ — магазин' : 'B — магазин';
      if (human.hasBomb && g.mode.allowBomb) {
        const s = calloutAt(g.map, human.pos.x, human.pos.z);
        if (s.startsWith('Точка')) hint = human.active === 'bomb' ? 'Удерживайте ЛКМ — установка бомбы' : '5 — достать бомбу';
      }
      if (human.team === 'CT' && g.bomb.state === 'planted' && vdist(human.pos, g.bomb.pos) < 2.2 && human.defusing === 0) hint = 'Удерживайте E — разминировать';
      const drop = g.drops.find(d => vdist(d.pos, human.pos) < 1.6);
      if (drop && !hint) hint = `E — подобрать ${drop.weapon.def.name}`;
    }
    let spectating: string | null = null;
    if (!human.alive) {
      const v = g.actors[this.spectateId];
      const respawn = human.respawnAt > g.time ? ` · возрождение через ${Math.ceil(human.respawnAt - g.time)} с` : '';
      spectating = v && view !== human ? `Наблюдение: <b>${escapeHtml(v.name)}</b>${v.isBot ? ' <span class="badge-bot">ИИ</span>' : ''} · ЛКМ — следующий${respawn}` : `Вы погибли${respawn}`;
    }
    const phaseName: Record<string, string> = { freeze: 'Закупка', live: 'Раунд', planted: 'Бомба заложена', post: 'Конец раунда', halftime: 'Смена сторон', over: 'Матч окончен' };
    let roundText = `${hud.label}${hud.roundNumber ? ` · раунд ${hud.roundNumber}/${hud.maxRounds}` : ''} · ${phaseName[hud.phase] ?? ''}`;
    if (g.mode.id === 'deathmatch') roundText = `${hud.label} · ваши очки ${hud.scoreUs} · лидер ${hud.scoreThem}`;
    if (g.mode.id === 'training') roundText = `Тренировка · точность ${hud.scoreThem}% · поражено ${hud.scoreUs}${hud.message ? ' · ' + hud.message : ''}`;
    let arms: string | undefined;
    if (g.mode.id === 'armsrace') {
      const ar = g.mode as ArmsRaceMode;
      const top = g.actors.slice().sort((x, y) => y.armsLevel - x.armsLevel).slice(0, 4);
      arms = `<b>Гонка вооружений</b><br>Ваш уровень: ${human.armsLevel + 1}/${ar.finalLevel + 1} — ${escapeHtml(WEAPONS[ar.weaponFor(human.armsLevel)]?.name ?? '')}<br>Далее: ${escapeHtml(WEAPONS[ar.weaponFor(human.armsLevel + 1)]?.name ?? 'победа')}<br>` +
        top.map(t => `${escapeHtml(t.name)}: ${t.armsLevel + 1}`).join('<br>');
    }
    // teammate labels
    const labels: HudModel['labels'] = [];
    if (!g.mode.ffa) {
      const cam = this.renderer.camera;
      const v = new THREE.Vector3();
      for (const t of g.actors) {
        if (t === view || !t.alive || t.team !== usTeam) continue;
        v.set(t.pos.x, t.pos.y + 2.05, t.pos.z).project(cam);
        if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
        labels.push({ x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, text: t.name });
      }
    }
    return {
      health: a.health, armor: a.armor, helmet: a.helmet, money: g.mode.allowBomb ? human.money : null,
      clip: w && def.mag > 0 ? w.clip : null, reserve: w && def.mag > 0 ? (def.infiniteAmmo ? 999 : w.reserve) : null,
      weaponName: def.name,
      grenades: [...new Set(a.grenades)].map(gt => ({ type: gt as string, label: `${NADE_SHORT[gt]}${a.grenades.filter(x => x === gt).length > 1 ? '×2' : ''}`, active: a.active === 'grenade' && a.activeGrenade === gt })).concat(a.hasBomb ? [{ type: 'c4', label: 'C4', active: a.active === 'bomb' }] : []),
      scoreUs: hud.scoreUs, scoreThem: hud.scoreThem, usTeam, timer: hud.timer, phase: hud.phase, roundText,
      aliveUs: us.map(x => x.alive), aliveThem: them.map(x => x.alive),
      spread: g.spreadFor(a, def), scoped: !!def.scope && a.scopeLevel > 0, showCrosshair: a.alive && def.cls !== 'sniper',
      progress, hint, spectating, armsRace: arms, fps: this.settings.graphics.showFps ? this.fpsAcc.fps : undefined, labels,
    };
  }

  private radar(human: Actor, view: Actor): RadarMarker[] {
    const g = this.game;
    const out: RadarMarker[] = [];
    for (const s of g.smokes) out.push({ x: s.pos.x, z: s.pos.z, color: '', kind: 'smoke' });
    for (const f of g.fires) out.push({ x: f.pos.x, z: f.pos.z, color: '', kind: 'fire' });
    // enemies spotted by us or by a teammate bot (team radar)
    const spotted = new Set<number>();
    const eye = human.eye();
    for (const o of g.actors) {
      if (!o.alive || o === human || (!g.mode.ffa && o.team === human.team)) continue;
      if (human.alive && g.world.lineClear(eye, o.visPoints()[1]) && g.isLookingAt(human, o.visPoints()[1], 60)) spotted.add(o.id);
    }
    if (!g.mode.ffa) for (const b of this.match.director.bots) if (b.actor.alive && b.actor.team === human.team) for (const id of b.perception.visible) spotted.add(id);
    for (const a of g.actors) {
      const mine = g.mode.ffa ? a === human : a.team === human.team;
      if (!mine && !spotted.has(a.id)) continue;
      if (!a.alive && (g.time - a.deathTime > 6 || !mine)) continue;
      out.push({ x: a.pos.x, z: a.pos.z, yaw: a.alive ? a.yaw : undefined, color: a.team === 'CT' ? '#5aa0ff' : '#f0a83a', self: a === view, dead: !a.alive });
    }
    const b = g.bomb;
    if (g.mode.allowBomb) {
      if (human.team === 'T') {
        if (b.state === 'dropped' || b.state === 'planted') out.push({ x: b.pos.x, z: b.pos.z, color: '#ff4030', kind: 'bomb' });
        else if (b.state === 'carried' && g.actors[b.carrier]) out.push({ x: g.actors[b.carrier].pos.x, z: g.actors[b.carrier].pos.z, color: '#ff4030', kind: 'bomb' });
      } else if (b.state === 'planted') {
        const brain = this.match.director.brains[human.squad];
        const seen = human.alive && vdist(human.pos, b.pos) < 30 && g.world.lineClear(eye, { x: b.pos.x, y: b.pos.y + 0.3, z: b.pos.z });
        if (seen) this.bombKnownSpot = b.pos;
        if (this.bombKnownSpot || brain?.bombSiteKnown) out.push({ x: b.pos.x, z: b.pos.z, color: '#ff4030', kind: 'bomb' });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  end(abandoned: boolean): void {
    if (this.ended) return;
    this.ended = true;
    const result = this.game.mode.result(abandoned);
    result.afk = this.afk;
    const replay = this.recorder.finish();
    this.dispose();
    if (abandoned && this.opts.ratingSystem === 'none' && this.onQuit) { this.onQuit(); return; }
    this.onEnd?.(result, replay);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    sfx.stopLoops();
    this.touch?.dispose();
    this.layer.remove();
    for (const cv of this.chars.values()) cv.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }
}

export type { GrenadeType };
