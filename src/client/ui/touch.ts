// Touch controls: floating move joystick (left), look area (right), configurable buttons.
// Supports simultaneous move + look + fire (multi-touch), and an in-place layout editor.
import type { Settings, TouchButton } from '../../meta/profile';
import type { EdgeAction, HoldAction, Input } from '../input/input';
import { h } from './dom';

const LABELS: Record<string, string> = {
  fire: 'ОГОНЬ', fireLeft: 'ОГОНЬ', aim: 'ПРИЦЕЛ', jump: 'ПРЫЖОК', crouch: 'ПРИСЕД', reload: 'R', weapon: 'ОРУЖ.',
  grenade: 'ГРАН.', use: 'E', buy: '$', scores: 'TAB', walk: 'ШАГ',
};
type Kind = { hold?: HoldAction; edge?: EdgeAction; toggle?: HoldAction };
const KIND: Record<string, Kind> = {
  fire: { hold: 'fire' }, fireLeft: { hold: 'fire' }, aim: { hold: 'fire2' }, jump: { hold: 'jump' }, crouch: { toggle: 'crouch' },
  reload: { edge: 'reload' }, weapon: { edge: 'nextWeapon' }, grenade: { edge: 'grenade' }, use: { hold: 'use' },
  buy: { edge: 'buy' }, scores: { hold: 'scoreboard' }, walk: { toggle: 'walk' },
};

export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLElement;
  private moveId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  private buttons = new Map<string, HTMLDivElement>();
  private toggles = new Set<string>();
  editing = false;
  private dragging: { id: string; touch: number } | null = null;
  onEditDone: (() => void) | null = null;

  constructor(private input: Input, private settings: Settings) {
    const moveZone = h('div', { class: 'zone', style: 'left:0;top:18%;width:42%;height:82%' });
    const lookZone = h('div', { class: 'zone', style: 'left:42%;top:0;width:58%;height:100%' });
    this.stick = h('div', { class: 'stick hidden' }, h('i', {}));
    this.knob = this.stick.firstChild as HTMLElement;
    this.root = h('div', { class: 'touch' }, moveZone, lookZone, this.stick);
    for (const id of Object.keys(LABELS)) {
      const b = h('div', { class: `tbtn${id.startsWith('fire') ? ' fire' : ''}` }, LABELS[id]);
      this.buttons.set(id, b);
      this.root.append(b);
      b.addEventListener('touchstart', e => this.onButton(e, id, true), { passive: false });
      b.addEventListener('touchend', e => this.onButton(e, id, false), { passive: false });
      b.addEventListener('touchcancel', e => this.onButton(e, id, false), { passive: false });
      b.addEventListener('touchmove', e => this.onButtonMove(e, id), { passive: false });
    }
    moveZone.addEventListener('touchstart', e => this.onMoveStart(e), { passive: false });
    lookZone.addEventListener('touchstart', e => this.onLookStart(e), { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    this.layout();
  }

  layout(): void {
    const t = this.settings.touch;
    this.root.style.opacity = String(this.editing ? 1 : t.opacity + 0.2);
    for (const [id, el] of this.buttons) {
      const b: TouchButton = t.buttons[id] ?? { x: 0.5, y: 0.5, size: 1 };
      const px = 64 * b.size;
      el.style.left = `${b.x * 100}%`;
      el.style.top = `${b.y * 100}%`;
      el.style.width = el.style.height = `${px}px`;
      el.style.margin = `${-px / 2}px 0 0 ${-px / 2}px`;
      el.style.opacity = String(t.opacity + 0.25);
    }
    const s = 140 * t.joystickSize;
    this.stick.style.width = this.stick.style.height = `${s}px`;
    this.stick.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`;
  }

  setEditing(on: boolean): void {
    this.editing = on;
    this.root.classList.toggle('edit', on);
    this.layout();
  }

  private onButton(e: TouchEvent, id: string, down: boolean): void {
    e.preventDefault(); e.stopPropagation();
    const touch = e.changedTouches[0];
    if (this.editing) {
      if (down) this.dragging = { id, touch: touch.identifier };
      else { this.dragging = null; this.onEditDone?.(); }
      return;
    }
    const k = KIND[id];
    const el = this.buttons.get(id)!;
    if (k.hold) { this.input.hold(k.hold, down); el.classList.toggle('on', down); }
    if (k.edge && down) this.input.trigger(k.edge);
    if (k.toggle && down) {
      const on = !this.toggles.has(id);
      if (on) this.toggles.add(id); else this.toggles.delete(id);
      this.input.hold(k.toggle, on);
      el.classList.toggle('on', on);
    }
    // the fire button also aims: dragging on it rotates the view
    if (id.startsWith('fire')) {
      if (down) this.lookIds.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      else this.lookIds.delete(touch.identifier);
    }
  }

  private onButtonMove(e: TouchEvent, id: string): void {
    if (!this.editing || !this.dragging || this.dragging.id !== id) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.dragging.touch) continue;
      const b = this.settings.touch.buttons[id];
      b.x = Math.min(0.98, Math.max(0.02, t.clientX / window.innerWidth));
      b.y = Math.min(0.98, Math.max(0.02, t.clientY / window.innerHeight));
      this.layout();
    }
  }

  private onMoveStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.editing) return;
    const t = e.changedTouches[0];
    if (this.moveId !== null) return;
    this.moveId = t.identifier;
    this.moveOrigin = { x: t.clientX, y: t.clientY };
    this.stick.classList.remove('hidden');
    this.stick.style.left = `${t.clientX}px`;
    this.stick.style.top = `${t.clientY}px`;
    this.knob.style.transform = 'translate(0,0)';
  }

  private onLookStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.editing) return;
    for (const t of Array.from(e.changedTouches)) this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
  }

  private onTouchMove = (e: TouchEvent): void => {
    if (this.editing) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        const r = 60 * this.settings.touch.joystickSize;
        let dx = t.clientX - this.moveOrigin.x, dy = t.clientY - this.moveOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > r) { dx *= r / d; dy *= r / d; }
        this.knob.style.transform = `translate(${dx}px,${dy}px)`;
        const nx = dx / r, ny = dy / r;
        // walk when the stick is barely pushed
        this.input.touchMove = { x: Math.abs(nx) < 0.15 ? 0 : nx, y: Math.abs(ny) < 0.15 ? 0 : ny };
        e.preventDefault();
      }
      const prev = this.lookIds.get(t.identifier);
      if (prev) {
        const k = this.settings.touch.sensitivity * 1.9;
        this.input.look((t.clientX - prev.x) * k, (t.clientY - prev.y) * k);
        this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
        e.preventDefault();
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveId) {
        this.moveId = null;
        this.input.touchMove = { x: 0, y: 0 };
        this.stick.classList.add('hidden');
      }
      this.lookIds.delete(t.identifier);
    }
  };

  reset(): void {
    this.toggles.clear();
    for (const el of this.buttons.values()) el.classList.remove('on');
  }

  dispose(): void {
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    this.root.remove();
  }
}
