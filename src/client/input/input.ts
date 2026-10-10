// Unified input: keyboard + mouse (pointer lock) and touch controls feed the same state.
import { DEG, clamp } from '../../sim/math';

export type HoldAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'walk' | 'use' | 'scoreboard' | 'fire' | 'fire2';
export type EdgeAction = 'reload' | 'buy' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'grenade' | 'inspect' | 'drop' | 'lastWeapon' | 'pause' | 'nextWeapon' | 'prevWeapon' | 'spectateNext';

const HOLDS: HoldAction[] = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'walk', 'use', 'scoreboard'];

export class Input {
  private held = new Set<HoldAction>();
  private edges: EdgeAction[] = [];
  private codeToAction = new Map<string, string>();
  yaw = 0;
  pitch = 0;
  sensitivity = 1.6;
  invertY = false;
  /** analog movement from the touch joystick (-1..1) */
  touchMove = { x: 0, y: 0 };
  frameDX = 0;
  frameDY = 0;
  locked = false;
  enabled = true;
  crouchToggle = false;
  walkToggle = false;
  private toggled = new Set<HoldAction>();
  /** view-angle zoom factor for scoped sensitivity */
  zoomSens = 1;
  onPauseRequest: ((reason: 'unlock' | 'key') => void) | null = null;
  /** set before an intentional pointer unlock (e.g. opening the buy menu) */
  expectUnlock = false;
  private el: HTMLElement | null = null;
  private listeners: [EventTarget, string, EventListener][] = [];

  setBindings(b: Record<string, string>): void {
    this.codeToAction.clear();
    for (const [action, code] of Object.entries(b)) this.codeToAction.set(code, action);
    this.codeToAction.set('Escape', 'pause');
    // common alternates
    if (!this.codeToAction.has('ControlRight')) this.codeToAction.set('ControlRight', 'crouch');
    if (!this.codeToAction.has('ShiftRight')) this.codeToAction.set('ShiftRight', 'walk');
  }

  attach(el: HTMLElement): void {
    this.el = el;
    const on = (t: EventTarget, ev: string, f: EventListener, opts?: AddEventListenerOptions) => { t.addEventListener(ev, f, opts); this.listeners.push([t, ev, f]); };
    on(window, 'keydown', e => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', e => this.onKey(e as KeyboardEvent, false));
    on(el, 'mousedown', e => this.onMouse(e as MouseEvent, true));
    on(window, 'mouseup', e => this.onMouse(e as MouseEvent, false));
    on(window, 'mousemove', e => {
      if (!this.locked || !this.enabled) return;
      const me = e as MouseEvent;
      this.look(me.movementX, me.movementY);
    });
    on(el, 'wheel', e => { if (!this.locked) return; this.edges.push((e as WheelEvent).deltaY > 0 ? 'nextWeapon' : 'prevWeapon'); }, { passive: true });
    on(el, 'contextmenu', e => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      if (was && !this.locked) {
        this.held.clear();
        if (!this.expectUnlock) this.onPauseRequest?.('unlock');
      }
      this.expectUnlock = false;
    });
    on(window, 'blur', () => this.held.clear());
  }

  detach(): void {
    for (const [t, ev, f] of this.listeners) t.removeEventListener(ev, f);
    this.listeners = [];
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock(); }
  }

  requestLock(): void {
    if (!this.el || this.locked) return;
    try { const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => undefined); } catch { /* not allowed */ }
  }

  look(dx: number, dy: number, scale = 1): void {
    const k = this.sensitivity * 0.1 * DEG * this.zoomSens * scale;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -89 * DEG, 89 * DEG);
    this.frameDX += dx; this.frameDY += dy;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const action = this.codeToAction.get(e.code);
    if (!action) return;
    if (!this.enabled && action !== 'pause' && action !== 'scoreboard' && action !== 'buy') return;
    if (['Tab', 'Space'].includes(e.code) || (e.code.startsWith('Digit') && this.locked) || e.code === 'ControlLeft') e.preventDefault();
    if ((HOLDS as string[]).includes(action)) {
      const a = action as HoldAction;
      if ((a === 'crouch' && this.crouchToggle) || (a === 'walk' && this.walkToggle)) {
        if (down && !e.repeat) { if (this.toggled.has(a)) this.toggled.delete(a); else this.toggled.add(a); }
        return;
      }
      if (down) this.held.add(a); else this.held.delete(a);
    } else if (down && !e.repeat) {
      if (action === 'pause') { this.onPauseRequest?.('key'); return; }
      this.edges.push(action as EdgeAction);
    }
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    if (down && !this.locked) { this.requestLock(); return; }
    if (!this.locked && down) return;
    const a: HoldAction | null = e.button === 0 ? 'fire' : e.button === 2 ? 'fire2' : null;
    if (!a) return;
    if (down) this.held.add(a); else this.held.delete(a);
  }

  hold(a: HoldAction, on: boolean): void { if (on) this.held.add(a); else this.held.delete(a); }
  trigger(a: EdgeAction): void { this.edges.push(a); }
  isHeld(a: HoldAction): boolean { return this.held.has(a) || this.toggled.has(a); }
  consumeEdges(): EdgeAction[] { const e = this.edges; this.edges = []; return e; }
  consumeFrameDelta(): { dx: number; dy: number } { const r = { dx: this.frameDX, dy: this.frameDY }; this.frameDX = this.frameDY = 0; return r; }
  clear(): void { this.held.clear(); this.edges = []; this.touchMove = { x: 0, y: 0 }; this.toggled.clear(); }

  moveAxes(): { forward: number; right: number } {
    let f = (this.isHeld('forward') ? 1 : 0) - (this.isHeld('back') ? 1 : 0);
    let r = (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0);
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) { f = -this.touchMove.y; r = this.touchMove.x; }
    return { forward: f, right: r };
  }
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia?.('(pointer: coarse)').matches;
}
