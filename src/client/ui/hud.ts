// In-game HUD (DOM overlay).
import type { Settings } from '../../meta/profile';
import { fmtTime, h } from './dom';
import type { Minimap } from './minimap';

export interface HudModel {
  health: number; armor: number; helmet: boolean; money: number | null;
  clip: number | null; reserve: number | null; weaponName: string; grenades: { type: string; label: string; active: boolean }[];
  scoreUs: number; scoreThem: number; usTeam: 'T' | 'CT'; timer: number; phase: string; roundText: string;
  aliveUs: boolean[]; aliveThem: boolean[];
  spread: number; scoped: boolean; showCrosshair: boolean;
  progress: { label: string; frac: number } | null;
  hint: string; spectating: string | null;
  armsRace?: string;
  fps?: number;
  labels: { x: number; y: number; text: string }[];
}

export class Hud {
  readonly root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private feed: HTMLDivElement;
  private radioBox: HTMLDivElement;
  private dmg: HTMLDivElement;
  private labels: HTMLDivElement;
  private ch: HTMLDivElement;
  private msgTimer = 0;
  private hitTimer = 0;
  private flashEnd = 0;
  private flashStart = 0;
  private flashStrength = 0;
  private last: Record<string, string> = {};

  constructor(minimap: Minimap, private settings: Settings, vsAI: boolean) {
    const E = (name: string, el: HTMLElement) => { this.el[name] = el; return el; };
    this.feed = h('div', { class: 'feed' });
    this.radioBox = h('div', { class: 'radio' });
    this.dmg = h('div', { class: 'dmgdir' });
    this.labels = h('div', {});
    this.ch = h('div', { class: 'crosshair' });
    this.root = h('div', { class: 'hud' },
      E('vignette', h('div', { class: 'vignette' })),
      this.labels,
      h('div', { class: 'tl' }, minimap.canvas),
      vsAI ? h('div', { class: 'vsai' }, 'Матч против ИИ') : null,
      h('div', { class: 'top' },
        E('aliveUs', h('div', { class: 'alive' })),
        E('scoreUs', h('div', { class: 'score' })),
        E('timer', h('div', { class: 'timer' })),
        E('scoreThem', h('div', { class: 'score' })),
        E('aliveThem', h('div', { class: 'alive' })),
      ),
      E('roundinfo', h('div', { class: 'roundinfo' })),
      this.feed,
      E('arms', h('div', { class: 'armsrace hidden' })),
      E('money', h('div', { class: 'money' })),
      this.radioBox,
      E('bl', h('div', { class: 'bl' },
        E('hp', h('div', { class: 'big' })),
        E('ar', h('div', { class: 'big' })),
      )),
      h('div', { class: 'br' },
        E('ammo', h('div', { class: 'ammo' })),
        E('wname', h('div', { class: 'wname' })),
        E('nades', h('div', { class: 'nades' })),
      ),
      this.ch,
      E('hitmark', h('div', { class: 'hitmark' })),
      this.dmg,
      E('msg', h('div', { class: 'center-msg' })),
      E('progress', h('div', { class: 'progress hidden' }, h('div', {}), h('div', { class: 'bar' }, h('i', {})))),
      E('hint', h('div', { class: 'hint hidden' })),
      E('spec', h('div', { class: 'spec hidden' })),
      E('scope', h('div', { class: 'scope' })),
      E('flash', h('div', { class: 'flash' })),
      E('fps', h('div', { class: 'fps' })),
    );
    this.buildCrosshair();
  }

  buildCrosshair(): void {
    const c = this.settings.crosshair;
    this.ch.style.setProperty('--ch', c.color);
    this.ch.replaceChildren();
    if (c.style === 'dot') { this.ch.append(h('i', { style: `width:${c.thickness + 2}px;height:${c.thickness + 2}px;left:${-(c.thickness + 2) / 2}px;top:${-(c.thickness + 2) / 2}px;border-radius:50%` })); return; }
    for (let k = 0; k < 4; k++) this.ch.append(h('i', { 'data-k': k }));
    if (c.dot) this.ch.append(h('i', { style: `width:${c.thickness}px;height:${c.thickness}px;left:${-c.thickness / 2}px;top:${-c.thickness / 2}px` }));
  }

  private setText(name: string, v: string): void {
    if (this.last[name] === v) return;
    this.last[name] = v;
    this.el[name].textContent = v;
  }
  private setHTML(name: string, v: string): void {
    if (this.last[name] === v) return;
    this.last[name] = v;
    this.el[name].innerHTML = v;
  }

  update(m: HudModel, now: number): void {
    const usCls = m.usTeam === 'CT' ? 'ct' : 't', themCls = m.usTeam === 'CT' ? 't' : 'ct';
    this.el.scoreUs.className = `score ${usCls}`;
    this.el.scoreThem.className = `score ${themCls}`;
    this.setText('scoreUs', String(m.scoreUs));
    this.setText('scoreThem', String(m.scoreThem));
    this.setText('timer', m.phase === 'over' ? '—' : fmtTime(m.timer));
    this.el.timer.className = `timer${m.phase === 'planted' ? ' bomb' : ''}`;
    this.setText('roundinfo', m.roundText);
    const alive = (arr: boolean[], color: string) => arr.map(a => `<i class="${a ? '' : 'dead'}" style="color:${color}"></i>`).join('');
    this.setHTML('aliveUs', alive(m.aliveUs, m.usTeam === 'CT' ? 'var(--ct)' : 'var(--t)'));
    this.setHTML('aliveThem', alive(m.aliveThem, m.usTeam === 'CT' ? 'var(--t)' : 'var(--ct)'));
    this.setHTML('hp', `<span>✚</span>${Math.max(0, Math.round(m.health))}`);
    this.setHTML('ar', `<span>${m.helmet ? '⛑' : '🛡'}</span>${Math.round(m.armor)}<small>${m.helmet ? 'шлем' : ''}</small>`);
    this.el.bl.parentElement!.classList.toggle('lowhp', m.health <= 25);
    this.setText('money', m.money === null ? '' : `$${m.money}`);
    this.setHTML('ammo', m.clip === null ? '' : `${m.clip}<small> / ${m.reserve}</small>`);
    this.setText('wname', m.weaponName);
    this.setHTML('nades', m.grenades.map(g => `<span class="${g.active ? 'on' : ''}">${g.label}</span>`).join(''));
    this.el.arms.classList.toggle('hidden', !m.armsRace);
    if (m.armsRace) this.setHTML('arms', m.armsRace);
    // crosshair
    const c = this.settings.crosshair;
    this.ch.style.display = m.showCrosshair && !m.scoped ? '' : 'none';
    if (c.style !== 'dot') {
      const gap = c.gap + (c.dynamic ? Math.min(40, m.spread * 900) : 0);
      const L = c.size, T = c.thickness;
      const bars = this.ch.querySelectorAll<HTMLElement>('i[data-k]');
      bars.forEach((b, k) => {
        if (k === 0) b.style.cssText = `width:${T}px;height:${L}px;left:${-T / 2}px;top:${-gap - L}px`;
        if (k === 1) b.style.cssText = `width:${T}px;height:${L}px;left:${-T / 2}px;top:${gap}px`;
        if (k === 2) b.style.cssText = `width:${L}px;height:${T}px;left:${-gap - L}px;top:${-T / 2}px`;
        if (k === 3) b.style.cssText = `width:${L}px;height:${T}px;left:${gap}px;top:${-T / 2}px`;
        if (c.style === 'cross' && k === 0) b.style.display = 'none';
      });
    }
    this.el.scope.style.display = m.scoped ? 'block' : 'none';
    // progress
    this.el.progress.classList.toggle('hidden', !m.progress);
    if (m.progress) {
      (this.el.progress.firstChild as HTMLElement).textContent = m.progress.label;
      (this.el.progress.querySelector('i') as HTMLElement).style.width = `${Math.round(m.progress.frac * 100)}%`;
    }
    this.el.hint.classList.toggle('hidden', !m.hint);
    if (m.hint) this.setText('hint', m.hint);
    this.el.spec.classList.toggle('hidden', !m.spectating);
    if (m.spectating) this.setHTML('spec', m.spectating);
    // messages & markers fade
    if (now > this.msgTimer) this.el.msg.style.opacity = '0';
    if (now > this.hitTimer) this.el.hitmark.style.opacity = '0';
    // flash
    if (now < this.flashEnd) {
      const total = this.flashEnd - this.flashStart;
      const left = this.flashEnd - now;
      const op = this.flashStrength * Math.min(1, left / Math.min(1.6, total));
      this.el.flash.style.opacity = String(op);
    } else this.el.flash.style.opacity = '0';
    this.el.vignette.style.boxShadow = `inset 0 0 160px rgba(200,0,0,${m.health < 30 && m.health > 0 ? 0.35 : 0})`;
    this.setText('fps', m.fps ? `${m.fps} FPS` : '');
    // 3D labels
    if (this.labels.childElementCount !== m.labels.length) {
      this.labels.replaceChildren(...m.labels.map(() => h('div', { class: 'label3d' })));
    }
    m.labels.forEach((l, i) => {
      const d = this.labels.children[i] as HTMLElement;
      d.style.left = `${l.x}px`; d.style.top = `${l.y}px`;
      if (d.textContent !== l.text) d.textContent = l.text;
    });
  }

  message(text: string, sub = '', dur = 2.5, now = performance.now() / 1000): void {
    this.el.msg.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.msg.style.opacity = '1';
    this.msgTimer = now + dur;
  }

  hit(kill: boolean, now: number): void {
    this.el.hitmark.className = `hitmark${kill ? ' kill' : ''}`;
    this.el.hitmark.style.opacity = '1';
    this.hitTimer = now + (kill ? 0.35 : 0.15);
  }

  damageFrom(angleRad: number): void {
    const i = h('i', { style: `transform: rotate(${angleRad}rad)` });
    this.dmg.append(i);
    setTimeout(() => { i.style.opacity = '0'; }, 500);
    setTimeout(() => i.remove(), 1200);
  }

  killfeed(html: string, mine: boolean): void {
    const d = h('div', { class: mine ? 'mine' : '', html });
    this.feed.append(d);
    while (this.feed.childElementCount > 6) this.feed.firstChild?.remove();
    setTimeout(() => d.remove(), 7000);
  }

  radio(name: string, text: string, team: 'T' | 'CT'): void {
    const d = h('div', { html: `<span style="color:var(--${team.toLowerCase()})">${escapeHtml(name)}</span>: ${escapeHtml(text)}` });
    this.radioBox.append(d);
    while (this.radioBox.childElementCount > 4) this.radioBox.firstChild?.remove();
    setTimeout(() => d.remove(), 5000);
  }

  flash(strength: number, duration: number, now: number): void {
    this.flashStart = now;
    this.flashEnd = Math.max(this.flashEnd, now + duration);
    this.flashStrength = Math.max(strength, now < this.flashEnd ? this.flashStrength : 0);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
