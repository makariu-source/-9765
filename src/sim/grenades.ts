// Grenade projectiles and area effects (smoke, fire, decoys).
import type { Actor } from './actor';
import type { Game } from './game';
import { clamp, dirFromAngles, raySphere, vdist, vdot, vlen, type Vec3 } from './math';
import type { GrenadeType } from './weapons';
import { CELL } from './maps/mapgrid';

export const GRENADE_GRAVITY = 9.0;
export const THROW_SPEED = 16.5;
export const LOB_SPEED = 7.5;
export const FUSE: Record<GrenadeType, number> = { he: 1.6, flash: 1.6, smoke: 1.2, molotov: 2.0, decoy: 1.2 };
export const SMOKE_DURATION = 18;
export const SMOKE_RADIUS = 3.6;
export const FIRE_DURATION = 7;
export const FIRE_RADIUS = 3.0;
export const FIRE_DPS = 32;
export const HE_DAMAGE = 98;
export const HE_RADIUS = 9.5;
export const FLASH_RANGE = 32;
export const DECOY_DURATION = 14;

export interface Projectile {
  id: number;
  type: GrenadeType;
  owner: number;
  team: string;
  pos: Vec3;
  vel: Vec3;
  born: number;
  stillTime: number;
  bounces: number;
  done: boolean;
  /** trail for rendering */
  rot: number;
}

export interface SmokeCloud { id: number; pos: Vec3; born: number; radius: number; owner: number }
export interface FireZone { id: number; pos: Vec3; born: number; radius: number; owner: number; team: string; cells: number[] }
export interface DecoyEmitter { id: number; pos: Vec3; born: number; next: number; weapon: string; owner: number }

export function throwVelocity(a: Actor, strong: boolean): { pos: Vec3; vel: Vec3 } {
  const dir = dirFromAngles(a.yaw, a.pitch + (strong ? 0.07 : 0.12));
  const eye = a.eye();
  const speed = strong ? THROW_SPEED : LOB_SPEED;
  return {
    pos: { x: eye.x + dir.x * 0.3, y: eye.y - 0.1 + dir.y * 0.3, z: eye.z + dir.z * 0.3 },
    vel: { x: dir.x * speed + a.vel.x * 0.9, y: dir.y * speed + a.vel.y * 0.5, z: dir.z * speed + a.vel.z * 0.9 },
  };
}

/**
 * Integrate one projectile step with bounces. Pure function of world geometry so the
 * same code also predicts trajectories (training preview, bot throw planning).
 */
export function stepProjectile(game: Pick<Game, 'world'>, p: { pos: Vec3; vel: Vec3; stillTime: number; bounces: number }, dt: number, onBounce?: (pos: Vec3, n: Vec3, speed: number) => void): void {
  p.vel.y -= GRENADE_GRAVITY * dt;
  let remaining = dt;
  for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
    const sp = vlen(p.vel);
    if (sp < 1e-4) break;
    const d = { x: p.vel.x / sp, y: p.vel.y / sp, z: p.vel.z / sp };
    const dist = sp * remaining;
    const hit = game.world.raycast(p.pos, d, dist + 0.06);
    if (!hit || hit.t > dist + 0.05) {
      p.pos.x += p.vel.x * remaining; p.pos.y += p.vel.y * remaining; p.pos.z += p.vel.z * remaining;
      break;
    }
    const tt = Math.max(0, hit.t - 0.05);
    p.pos.x += d.x * tt; p.pos.y += d.y * tt; p.pos.z += d.z * tt;
    remaining -= tt / sp;
    const n = { x: hit.nx, y: hit.ny, z: hit.nz };
    const vn = vdot(p.vel, n);
    // reflect with restitution; tangential friction
    const e = 0.42;
    p.vel.x -= (1 + e) * vn * n.x; p.vel.y -= (1 + e) * vn * n.y; p.vel.z -= (1 + e) * vn * n.z;
    const fr = n.y > 0.7 ? 0.72 : 0.85;
    p.vel.x *= fr; p.vel.z *= fr; if (n.y < 0.7) p.vel.y *= fr;
    if (n.y > 0.7 && Math.abs(p.vel.y) < 1.2) p.vel.y = 0;
    p.bounces++;
    onBounce?.(p.pos, n, Math.abs(vn));
  }
  const speed = vlen(p.vel);
  if (speed < 0.4) p.stillTime += dt; else p.stillTime = 0;
  if (speed < 0.25) { p.vel.x = 0; p.vel.z = 0; }
}

/** Predict landing point for a throw (used by bots and the training trajectory preview). */
export function predictThrow(game: Pick<Game, 'world'>, pos: Vec3, vel: Vec3, maxTime = 4, out?: Vec3[]): Vec3 {
  const p = { pos: { ...pos }, vel: { ...vel }, stillTime: 0, bounces: 0 };
  const dt = 1 / 64;
  for (let t = 0; t < maxTime - 1e-6; t += dt) {
    stepProjectile(game, p, dt);
    if (out && Math.round(t * 64) % 2 === 0) out.push({ ...p.pos });
    if (p.stillTime > 0.15) break;
  }
  return p.pos;
}

/** Ray blocked by any active smoke? */
export function smokeBlocks(smokes: SmokeCloud[], now: number, a: Vec3, b: Vec3): boolean {
  const len = vdist(a, b);
  if (len < 1e-3) return false;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
  for (const s of smokes) {
    const r = smokeRadius(s, now);
    if (r < 0.8) continue;
    const t = raySphere(a, d, s.pos, r * 0.9);
    if (t >= 0 && t <= len) return true;
    // start inside smoke
    if (vdist(a, s.pos) < r * 0.9) return true;
  }
  return false;
}

export function smokeRadius(s: SmokeCloud, now: number): number {
  const age = now - s.born;
  if (age < 0) return 0;
  const grow = clamp(age / 1.2, 0, 1);
  const fade = age > SMOKE_DURATION - 2 ? clamp((SMOKE_DURATION - age) / 2, 0, 1) : 1;
  return SMOKE_RADIUS * Math.sqrt(grow) * (0.4 + 0.6 * fade);
}

export function fireCells(game: Game, pos: Vec3, radius: number): number[] {
  const nav = game.nav;
  const out: number[] = [];
  const r = Math.ceil(radius / CELL) + 1;
  const c = nav.cellOf(pos);
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = c.i + di, j = c.j + dj;
    if (!nav.isWalk(i, j)) continue;
    const cc = nav.center(i, j);
    if (Math.hypot(cc.x - pos.x, cc.z - pos.z) <= radius + 1 && Math.abs(cc.y - pos.y) < 1.5) out.push(nav.idx(i, j));
  }
  return out;
}
