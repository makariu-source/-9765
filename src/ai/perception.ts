// Bot perception: the ONLY way a bot learns about enemies.
// Vision requires field of view + unobstructed line of sight (walls and smoke block),
// is disabled by flashbangs, and target acquisition takes `reaction` seconds.
// Hearing gives noisy positions. No other enemy information is exposed to the brain.
import type { Actor } from '../sim/actor';
import type { Game } from '../sim/game';
import { smokeBlocks } from '../sim/grenades';
import { DEG, vdist, vdot, type Vec3 } from '../sim/math';
import type { BotProfile } from './difficulty';

export interface Memory {
  id: number;
  pos: Vec3;
  vel: Vec3;
  time: number;
  /** true if last update came from vision */
  seen: boolean;
  /** rough uncertainty radius (m) */
  error: number;
}

export interface Sighting { id: number; pos: Vec3; time: number }

export const MAX_VIEW = 90;

export class Perception {
  memory = new Map<number, Memory>();
  visibleSince = new Map<number, number>();
  visible = new Set<number>();
  private lastSoundTime = 0;
  /** positions where we heard gunfire recently (for HE/investigation) */
  heardShots: { pos: Vec3; time: number }[] = [];

  constructor(readonly self: Actor, public profile: BotProfile) {}

  isEnemy(g: Game, other: Actor): boolean {
    return other !== this.self && (g.mode.ffa || other.team !== this.self.team);
  }

  /** Can the bot currently see `target` (FOV + LOS + smoke + flash)? */
  canSee(g: Game, target: Actor): boolean {
    const me = this.self;
    if (me.flashEnd > g.time && me.flashStrength * Math.min(1, (me.flashEnd - g.time) / 1.2) > 0.35) return false;
    const eye = me.eye();
    const pts = target.visPoints();
    const d = vdist(eye, pts[1]);
    if (d > MAX_VIEW) return false;
    const view = me.viewDir();
    const to = { x: (pts[1].x - eye.x) / d, y: (pts[1].y - eye.y) / d, z: (pts[1].z - eye.z) / d };
    // close range peripheral awareness, otherwise FOV cone
    const halfFov = (d < 3 ? 150 : this.profile.fov / 2) * DEG;
    if (vdot(view, to) < Math.cos(halfFov)) return false;
    for (const p of pts) {
      if (g.world.lineClear(eye, p) && !smokeBlocks(g.smokes, g.time, eye, p)) return true;
    }
    return false;
  }

  update(g: Game): void {
    const now = g.time;
    const me = this.self;
    this.visible.clear();
    for (const o of g.actors) {
      if (!o.alive || !this.isEnemy(g, o)) { this.visibleSince.delete(o.id); if (!o.alive) this.memory.delete(o.id); continue; }
      if (this.canSee(g, o)) {
        this.visible.add(o.id);
        if (!this.visibleSince.has(o.id)) {
          // a target re-appearing where we expected it is reacted to faster
          const m = this.memory.get(o.id);
          const expected = m && m.seen && now - m.time < 1.0 && vdist(m.pos, o.pos) < 3;
          this.visibleSince.set(o.id, expected ? now - this.profile.reaction * 0.5 : now);
        }
        this.memory.set(o.id, { id: o.id, pos: { ...o.pos }, vel: { ...o.vel }, time: now, seen: true, error: 0 });
      } else this.visibleSince.delete(o.id);
    }
    // Hearing
    for (const s of g.sounds) {
      if (s.time <= this.lastSoundTime) continue;
      if (s.actor === me.id) continue;
      const src = g.actors[s.actor];
      if (src && !this.isEnemy(g, src)) continue;
      if (s.kind === 'hurt') continue;
      const d = vdist(me.pos, s.pos);
      const occluded = !g.world.lineClear(me.eye(), { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
      const radius = s.radius * (occluded ? 0.65 : 1);
      if (d > radius) continue;
      if (s.kind === 'shot') this.heardShots.push({ pos: { ...s.pos }, time: now });
      if (s.actor < 0) continue; // bomb beeps are handled by team knowledge
      const prev = this.memory.get(s.actor);
      if (prev && prev.seen && now - prev.time < 0.5) continue; // vision is better
      const err = d * (1 - this.profile.hearing) * 0.35 + (occluded ? 1.5 : 0.5);
      const jitter = (k: number) => (Math.sin(now * 13.37 + s.actor * 7 + k) * err);
      this.memory.set(s.actor, {
        id: s.actor, pos: { x: s.pos.x + jitter(1), y: s.pos.y, z: s.pos.z + jitter(2) }, vel: { x: 0, y: 0, z: 0 },
        time: now, seen: false, error: err,
      });
    }
    if (g.sounds.length) this.lastSoundTime = g.sounds[g.sounds.length - 1].time;
    this.heardShots = this.heardShots.filter(h => now - h.time < 4);
    // forget stale memories
    for (const [id, m] of this.memory) if (now - m.time > 14) this.memory.delete(id);
  }

  /** Targets visible long enough to react to. */
  acquired(g: Game): number[] {
    const out: number[] = [];
    const react = this.profile.reaction * (this.self.flashEnd > g.time ? 1.6 : 1);
    for (const id of this.visible) {
      const since = this.visibleSince.get(id) ?? g.time;
      if (g.time - since >= react) out.push(id);
    }
    return out;
  }

  freshest(maxAge: number, g: Game): Memory | null {
    let best: Memory | null = null;
    for (const m of this.memory.values()) {
      if (g.time - m.time > maxAge) continue;
      if (!best || m.time > best.time) best = m;
    }
    return best;
  }

  nearestMemory(g: Game, maxAge: number): Memory | null {
    let best: Memory | null = null, bd = Infinity;
    for (const m of this.memory.values()) {
      if (g.time - m.time > maxAge) continue;
      const d = vdist(m.pos, this.self.pos);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  reset(): void {
    this.memory.clear();
    this.visibleSince.clear();
    this.visible.clear();
    this.heardShots = [];
  }
}
