// Match recorder for the "watch match" replay viewer. Samples actor state at a fixed rate
// and keeps notable events; memory-bounded.
import type { Game } from './game';
import type { GameEvent } from './types';

export const REPLAY_FIELDS = 11; // x y z yaw pitch crouch alive health teamIsCT weaponIdx speed
const BOMB_STATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'] as const;

export interface ReplayActor { id: number; name: string; model: number; isBot: boolean; squad: number }
export interface ReplayFrame { t: number; data: Float32Array; bomb: [number, number, number, number]; round: number; score: [number, number] }
export interface Replay {
  mapId: string;
  mode: string;
  actors: ReplayActor[];
  weapons: string[];
  frames: ReplayFrame[];
  events: { t: number; e: GameEvent }[];
  duration: number;
  humanId: number;
}

const KEEP = new Set(['kill', 'detonate', 'planted', 'defused', 'bomb_exploded', 'round_end', 'round_start', 'shot']);

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private events: { t: number; e: GameEvent }[] = [];
  private weapons: string[] = [];
  private weaponIdx = new Map<string, number>();
  private next = 0;
  private shotThrottle = new Map<number, number>();

  constructor(private g: Game, private hz = 12, private maxFrames = 12 * 60 * 45) {
    g.onTick.push(() => this.sample());
    g.listeners.push(e => this.onEvent(e));
  }

  private wIdx(id: string): number {
    let i = this.weaponIdx.get(id);
    if (i === undefined) { i = this.weapons.length; this.weapons.push(id); this.weaponIdx.set(id, i); }
    return i;
  }

  private onEvent(e: GameEvent): void {
    if (!KEEP.has(e.type)) return;
    if (e.type === 'shot') {
      // keep at most ~8 tracers per second per shooter
      const last = this.shotThrottle.get(e.actor) ?? -1;
      if (this.g.time - last < 0.12) return;
      this.shotThrottle.set(e.actor, this.g.time);
    }
    if (this.events.length < 60000) this.events.push({ t: this.g.time, e });
  }

  private sample(): void {
    const g = this.g;
    if (g.time < this.next || this.frames.length >= this.maxFrames) return;
    this.next = g.time + 1 / this.hz;
    const n = g.actors.length;
    const d = new Float32Array(n * REPLAY_FIELDS);
    for (let i = 0; i < n; i++) {
      const a = g.actors[i];
      const o = i * REPLAY_FIELDS;
      d[o] = a.pos.x; d[o + 1] = a.pos.y; d[o + 2] = a.pos.z; d[o + 3] = a.yaw; d[o + 4] = a.pitch;
      d[o + 5] = a.crouchAmt; d[o + 6] = a.alive ? 1 : 0; d[o + 7] = a.health; d[o + 8] = a.team === 'CT' ? 1 : 0;
      d[o + 9] = this.wIdx(a.activeDef().id); d[o + 10] = Math.hypot(a.vel.x, a.vel.z);
    }
    const m = g.mode as unknown as { round?: number; scores?: [number, number] };
    this.frames.push({
      t: g.time, data: d, bomb: [BOMB_STATES.indexOf(g.bomb.state), g.bomb.pos.x, g.bomb.pos.y, g.bomb.pos.z],
      round: m.round ?? 0, score: m.scores ? [...m.scores] as [number, number] : [0, 0],
    });
  }

  finish(): Replay {
    const g = this.g;
    return {
      mapId: g.map.def.id, mode: g.mode.id,
      actors: g.actors.map(a => ({ id: a.id, name: a.name, model: a.model, isBot: a.isBot, squad: a.squad })),
      weapons: this.weapons.slice(), frames: this.frames, events: this.events, duration: g.time, humanId: g.humanId,
    };
  }
}

export function bombStateName(i: number): typeof BOMB_STATES[number] { return BOMB_STATES[i] ?? 'none'; }

/** Binary search the frame at or before t. */
export function frameAt(r: Replay, t: number): number {
  let lo = 0, hi = r.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.frames[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
