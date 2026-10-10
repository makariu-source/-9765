// Match replay viewer ("Посмотреть матч").
import * as THREE from 'three';
import { getMap } from '../../sim/maps/maps';
import { World } from '../../sim/world';
import { REPLAY_FIELDS, bombStateName, frameAt, type Replay } from '../../sim/replay';
import { FIRE_DURATION, SMOKE_DURATION } from '../../sim/grenades';
import { WEAPONS } from '../../sim/weapons';
import type { Game } from '../../sim/game';
import { clamp, lerp, wrapAngle } from '../../sim/math';
import { CharacterView } from '../render/characters';
import { Effects } from '../render/effects';
import type { Renderer } from '../render/renderer';
import { fmtTime, h } from './dom';
import { escapeHtml } from './hud';

export class ReplayViewer {
  readonly root: HTMLDivElement;
  private chars = new Map<number, CharacterView>();
  private effects: Effects;
  private t = 0;
  private speed = 1;
  private playing = true;
  private cam: 'follow' | 'eyes' | 'free' = 'follow';
  private followId: number;
  private raf = 0;
  private last = 0;
  private slider: HTMLInputElement;
  private timeLbl: HTMLSpanElement;
  private info: HTMLDivElement;
  private feed: HTMLDivElement;
  private orbit = { yaw: 0.6, pitch: -0.7, dist: 70, drag: false, lx: 0, ly: 0 };
  private lastEventIdx = 0;
  private world: World;

  constructor(private renderer: Renderer, private r: Replay, private onExit: () => void) {
    this.followId = r.humanId >= 0 ? r.humanId : 0;
    this.world = new World(getMap(r.mapId));
    this.renderer.loadWorld(this.world);
    this.effects = new Effects(this.renderer.scene);
    for (const a of r.actors) {
      const team = r.frames[0] && r.frames[0].data[a.id * REPLAY_FIELDS + 8] === 1 ? 'CT' : 'T';
      const cv = new CharacterView(team, a.model);
      this.renderer.scene.add(cv.root);
      this.chars.set(a.id, cv);
    }
    this.slider = h('input', { type: 'range', min: 0, max: r.duration, step: 0.1, value: 0, oninput: () => { this.t = +this.slider.value; this.lastEventIdx = 0; } });
    this.timeLbl = h('span', {}, '0:00');
    this.info = h('div', { style: 'position:absolute;top:12px;left:12px;background:rgba(0,0,0,.5);padding:8px 12px;border-radius:8px;font-weight:700' });
    this.feed = h('div', { class: 'hud', style: 'pointer-events:none' }, h('div', { class: 'feed' }));
    const sel = h('select', { onchange: (e: Event) => { this.followId = +(e.target as HTMLSelectElement).value; } },
      r.actors.map(a => h('option', { value: a.id, selected: a.id === this.followId }, `${a.name}${a.isBot ? ' (ИИ)' : ''}`)));
    const btn = (label: string, f: () => void) => h('button', { class: 'btn ghost', style: 'padding:6px 12px;font-size:15px', onclick: f }, label);
    const playBtn = btn('❚❚', () => { this.playing = !this.playing; playBtn.textContent = this.playing ? '❚❚' : '▶'; });
    this.root = h('div', { style: 'position:absolute;inset:0' }, this.feed, this.info,
      h('div', { class: 'replay-bar' },
        playBtn, this.slider, this.timeLbl,
        h('select', { onchange: (e: Event) => { this.speed = +(e.target as HTMLSelectElement).value; } }, [0.25, 0.5, 1, 2, 4].map(s => h('option', { value: s, selected: s === 1 }, `×${s}`))),
        sel,
        btn('Камера: следить', () => { this.cam = 'follow'; }), btn('Глаза', () => { this.cam = 'eyes'; }), btn('Свободная', () => { this.cam = 'free'; }),
        h('button', { class: 'btn', style: 'padding:6px 14px;font-size:15px', onclick: () => this.exit() }, 'Выход'),
      ));
    const canvas = this.renderer.canvas;
    canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onDown = (e: MouseEvent) => { this.orbit.drag = true; this.orbit.lx = e.clientX; this.orbit.ly = e.clientY; };
  private onUp = () => { this.orbit.drag = false; };
  private onMove = (e: MouseEvent) => {
    if (!this.orbit.drag) return;
    this.orbit.yaw -= (e.clientX - this.orbit.lx) * 0.005;
    this.orbit.pitch = clamp(this.orbit.pitch - (e.clientY - this.orbit.ly) * 0.005, -1.5, -0.1);
    this.orbit.lx = e.clientX; this.orbit.ly = e.clientY;
  };
  private onWheel = (e: WheelEvent) => { this.orbit.dist = clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 8, 160); };

  start(): void {
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt, t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number, now: number): void {
    const r = this.r;
    if (!r.frames.length) return;
    if (this.playing) this.t = Math.min(r.duration, this.t + dt * this.speed);
    this.slider.value = String(this.t);
    this.timeLbl.textContent = `${fmtTime(this.t)} / ${fmtTime(r.duration)}`;
    const i = frameAt(r, this.t);
    const f0 = r.frames[i], f1 = r.frames[Math.min(r.frames.length - 1, i + 1)];
    const k = f1.t > f0.t ? clamp((this.t - f0.t) / (f1.t - f0.t), 0, 1) : 0;
    let followPos = new THREE.Vector3(), followYaw = 0, followPitch = 0, followEye = 1.64;
    for (const a of r.actors) {
      const o = a.id * REPLAY_FIELDS;
      const d0 = f0.data, d1 = f1.data;
      const alive = d0[o + 6] === 1;
      const x = lerp(d0[o], d1[o], k), y = lerp(d0[o + 1], d1[o + 1], k), z = lerp(d0[o + 2], d1[o + 2], k);
      const yaw = d0[o + 3] + wrapAngle(d1[o + 3] - d0[o + 3]) * k;
      const team = d0[o + 8] === 1 ? 'CT' : 'T';
      let cv = this.chars.get(a.id)!;
      if (cv.team !== team) { cv.dispose(); cv = new CharacterView(team, a.model); this.renderer.scene.add(cv.root); this.chars.set(a.id, cv); }
      const wid = r.weapons[d0[o + 9]] ?? 'knife';
      // find death time for the fall animation
      let deathAge = 0;
      if (!alive) { let j = i; while (j > 0 && r.frames[j - 1].data[o + 6] === 0) j--; deathAge = this.t - r.frames[j].t; }
      cv.root.visible = (alive || deathAge < 8) && !(this.cam === 'eyes' && a.id === this.followId && alive);
      cv.root.position.set(x, y, z);
      cv.update({ speed: d0[o + 10], crouch: d0[o + 5], airborne: false, pitch: d0[o + 4], yaw, firingKick: 0, reloading: 0, throwing: 0, planting: false, defusing: false, alive, deathAge, weaponId: wid, weaponClass: WEAPONS[wid]?.cls ?? 'rifle', strafe: 0 }, dt);
      if (a.id === this.followId) { followPos.set(x, y, z); followYaw = yaw; followPitch = d0[o + 4]; followEye = 1.8 - d0[o + 5] * 0.55 - 0.16; }
    }
    // reconstruct grenades and bomb
    const smokes = [], fires = [];
    let idx = 0;
    for (const ev of r.events) {
      if (ev.t > this.t) break;
      idx++;
      const e = ev.e;
      if (e.type === 'detonate' && e.grenade === 'smoke' && this.t - ev.t < SMOKE_DURATION) smokes.push({ id: e.id, pos: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z }, born: ev.t, radius: 3.6, owner: e.owner });
      if (e.type === 'detonate' && e.grenade === 'molotov' && this.t - ev.t < FIRE_DURATION) fires.push({ id: e.id, pos: e.pos, born: ev.t, radius: 3, owner: e.owner, team: 'T', cells: [] });
    }
    // fresh events: tracers, explosions, kill feed
    if (idx < this.lastEventIdx) this.lastEventIdx = idx;
    for (let j = this.lastEventIdx; j < idx; j++) {
      const { e } = r.events[j];
      if (e.type === 'shot' && WEAPONS[e.weapon]?.tracer) this.effects.tracer({ x: e.origin.x, y: e.origin.y - 0.15, z: e.origin.z }, e.end);
      if (e.type === 'detonate' && e.grenade === 'he') this.effects.explosion(e.pos);
      if (e.type === 'detonate' && e.grenade === 'flash') this.effects.flashbangBurst(e.pos);
      if (e.type === 'bomb_exploded') this.effects.explosion(e.pos, true);
      if (e.type === 'kill') {
        const kn = r.actors[e.killer]?.name ?? '', vn = r.actors[e.victim]?.name ?? '';
        const d = h('div', { html: `${escapeHtml(kn)} [${escapeHtml(WEAPONS[e.weapon]?.name ?? e.weapon)}${e.headshot ? ' ⊕' : ''}] ${escapeHtml(vn)}` });
        this.feed.firstChild!.appendChild(d);
        setTimeout(() => d.remove(), 5000);
      }
    }
    this.lastEventIdx = idx;
    const bs = bombStateName(f0.bomb[0]);
    const plantedEv = [...r.events].reverse().find(ev => ev.t <= this.t && ev.e.type === 'planted');
    const pseudo = {
      time: this.t, smokes, fires, projectiles: [], drops: [], targets: [],
      bomb: { state: bs, pos: { x: f0.bomb[1], y: f0.bomb[2], z: f0.bomb[3] }, plantedAt: plantedEv?.t ?? 0 },
    } as unknown as Game;
    this.effects.sync(pseudo, dt);
    // camera
    if (this.cam === 'eyes') {
      this.renderer.setView({ x: followPos.x, y: followPos.y + followEye, z: followPos.z }, followYaw, followPitch, 90, dt);
    } else {
      const center = this.cam === 'follow' ? followPos : new THREE.Vector3(getMap(r.mapId).w, 0, getMap(r.mapId).h);
      const dist = this.cam === 'follow' ? Math.min(this.orbit.dist, 9) : this.orbit.dist;
      const yaw = this.cam === 'follow' ? followYaw + Math.PI * 0.0 : this.orbit.yaw;
      const pitch = this.cam === 'follow' ? -0.35 : this.orbit.pitch;
      const dirBack = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const pivot = center.clone().add(new THREE.Vector3(0, this.cam === 'follow' ? 1.6 : 0, 0));
      let d = dist;
      if (this.cam === 'follow') {
        // keep the chase camera in front of walls
        const hit = this.world.raycast(pivot, dirBack, dist);
        if (hit) d = Math.max(0.6, hit.t - 0.3);
      }
      const pos = pivot.clone().add(dirBack.multiplyScalar(d));
      this.renderer.setView(pos, yaw, pitch, 80, dt);
    }
    const followName = r.actors[this.followId]?.name ?? '';
    this.info.innerHTML = `Повтор матча · раунд ${f0.round || '—'} · счёт ${f0.score[0]}:${f0.score[1]}<br><span style="font-weight:500">Наблюдение: ${escapeHtml(followName)} · ЛКМ+мышь — вращение (свободная камера), колесо — зум</span>`;
    this.renderer.render(null, now);
  }

  private exit(): void {
    this.close();
    this.onExit();
  }

  /** Stop and release everything (also used when the app navigates away). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    const canvas = this.renderer.canvas;
    canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('mousemove', this.onMove);
    canvas.removeEventListener('wheel', this.onWheel);
    for (const cv of this.chars.values()) cv.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }
  private closed = false;
}
