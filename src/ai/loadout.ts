// Bot weapon pickups: how good is a weapon for the fight we expect, and is it worth
// (and safe enough) to walk over and swap for it?
import type { Actor, WeaponInst } from '../sim/actor';
import type { DroppedWeapon, Game } from '../sim/game';
import { CELL } from '../sim/maps/mapgrid';
import { vdist, vdist2d, type Vec3 } from '../sim/math';
import type { WeaponDef } from '../sim/weapons';
import type { BotProfile } from './difficulty';

// ---------------------------------------------------------------------------
// Sightlines: how far one can typically see from a cell (lazy, cached per map)

const sightCache = new WeakMap<Game, Float32Array>();
const SIGHT_DIRS = 16;
const SIGHT_MAX = 60;

/** Typical engagement distance at a point: mean of the longer half of 16 horizontal sightlines. */
export function sightline(g: Game, p: Vec3): number {
  let cache = sightCache.get(g);
  if (!cache) { cache = new Float32Array(g.nav.w * g.nav.h).fill(-1); sightCache.set(g, cache); }
  const c = g.nav.cellOf(p);
  if (!g.nav.isWalk(c.i, c.j)) return 15;
  const k = g.nav.idx(c.i, c.j);
  if (cache[k] >= 0) return cache[k];
  const o = { x: (c.i + 0.5) * CELL, y: g.nav.height[k] + 1.6, z: (c.j + 0.5) * CELL };
  const ds: number[] = [];
  for (let i = 0; i < SIGHT_DIRS; i++) {
    const a = (i / SIGHT_DIRS) * Math.PI * 2;
    const hit = g.world.raycast(o, { x: Math.sin(a), y: 0, z: Math.cos(a) }, SIGHT_MAX);
    ds.push(hit ? hit.t : SIGHT_MAX);
  }
  ds.sort((x, y) => y - x);
  const top = ds.slice(0, SIGHT_DIRS / 2);
  cache[k] = top.reduce((s, x) => s + x, 0) / top.length;
  return cache[k];
}

// ---------------------------------------------------------------------------
// Weapon value

function baseValue(def: WeaponDef, awper: boolean): number {
  switch (def.cls) {
    case 'pistol': return def.id === 'deagle' ? 3 : def.price >= 300 ? 2.3 : 1.8;
    case 'smg': return 3.6 + def.price / 2500;
    case 'shotgun': return 3.6;
    case 'lmg': return 4.8;
    case 'rifle': return def.price >= 2500 ? 6.5 : 5.4;
    case 'sniper': return def.id === 'awm' ? (awper ? 7.4 : 5.8) : 4.6;
    default: return 0;
  }
}

/** Range fit: bonus/penalty for the expected fight distance (metres). */
function rangeFit(def: WeaponDef, dist: number): number {
  switch (def.cls) {
    case 'shotgun': return dist < 8 ? 1.6 : dist > 14 ? -2.6 : 0;
    case 'smg': return dist < 10 ? 0.8 : dist > 22 ? -1.3 : 0;
    case 'pistol': return dist > 20 ? (def.id === 'deagle' ? -0.2 : -0.7) : 0;
    case 'sniper': return dist > 22 ? 1.3 : dist < 10 ? -2.6 : 0;
    case 'rifle': return dist > 30 ? 0.3 : 0;
    case 'lmg': return dist < 15 ? 0.3 : 0;
    default: return 0;
  }
}

/**
 * Value of a weapon for this bot (0 = useless). `situational` (0..1) scales how much the
 * expected fight distance matters: novices only see "big gun good".
 */
export function weaponValue(w: WeaponInst | null, dist: number, awper: boolean, situational: number): number {
  if (!w) return 0;
  const def = w.def;
  const total = w.clip + w.reserve;
  if (def.mag > 0 && total <= 0) return 0;
  let v = baseValue(def, awper) + rangeFit(def, dist) * situational;
  if (def.mag > 0) {
    const frac = total / Math.max(1, def.mag + def.reserve);
    v -= total < def.mag * 0.5 ? 3 : (1 - frac) * 1.5;
  }
  return Math.max(0, v);
}

// ---------------------------------------------------------------------------
// Pickup decision

export interface PickupPlan { drop: DroppedWeapon; why: 'empty' | 'upgrade' | 'situational' | 'ammo'; gain: number }

const claims = new WeakMap<Game, Map<number, { bot: number; until: number }>>();

function claimMap(g: Game): Map<number, { bot: number; until: number }> {
  let m = claims.get(g);
  if (!m) { m = new Map(); claims.set(g, m); }
  return m;
}

/** Reserve a drop so two teammates do not run for the same gun. */
export function claimDrop(g: Game, dropId: number, botId: number, seconds: number): void {
  claimMap(g).set(dropId, { bot: botId, until: g.time + seconds });
}

/**
 * Best weapon on the ground worth taking right now, or null.
 * `threats` are remembered enemy positions (seen/heard recently); `fightDist` is the
 * distance we expect to fight at (sightlines where we are going).
 */
export function choosePickup(g: Game, a: Actor, profile: BotProfile, awper: boolean, threats: Vec3[], fightDist: number): PickupPlan | null {
  if (!g.drops.length || g.mode.id === 'armsrace') return null;
  // situational judgement and search radius grow with skill
  const situational = Math.min(1, Math.max(0, (profile.anticipation + profile.adaptation) / 1.4));
  const radius = 7 + profile.coordination * 11;
  const cm = claimMap(g);
  let best: PickupPlan | null = null;
  for (const d of g.drops) {
    if (d.stillTime < 0.3 && g.time - d.born < 1.2) continue; // still flying
    const slot = d.weapon.def.slot;
    if (slot !== 'primary' && slot !== 'secondary') continue;
    const dist = vdist2d(d.pos, a.pos);
    if (dist > radius || Math.abs(d.pos.y - a.pos.y) > 3) continue;
    // fair play: only guns the bot can see (or that lie right next to it)
    if (dist > 6 && !g.world.lineClear(a.eye(), { x: d.pos.x, y: d.pos.y + 0.2, z: d.pos.z })) continue;
    const cl = cm.get(d.id);
    if (cl && cl.bot !== a.id && cl.until > g.time) continue;
    // safety: no known enemy near the gun or near us
    if (threats.some(t => vdist(t, d.pos) < 16 || vdist(t, a.pos) < 14)) continue;
    const mine = slot === 'primary' ? a.primary : a.secondary;
    const fight = Math.max(fightDist, 4);
    const cur = weaponValue(mine, fight, awper, situational);
    const cand = weaponValue(d.weapon, fight, awper, situational);
    let why: PickupPlan['why'];
    if (!mine) {
      // pistol slot only matters when we have no primary
      if (slot === 'secondary' && a.primary) continue;
      why = 'empty';
    } else {
      // novices only swap for an obviously bigger gun; skilled bots also by situation
      const margin = profile.level <= 2 ? 2.5 : 0.9;
      if (cand < cur + margin) continue;
      if (slot === 'secondary' && a.primary && cur > 0) continue;
      const plainGain = weaponValue(d.weapon, fight, awper, 0) - weaponValue(mine, fight, awper, 0);
      why = d.weapon.def.id === mine.def.id ? 'ammo' : plainGain >= margin ? 'upgrade' : 'situational';
    }
    // closer guns are worth more: walking costs time
    const gain = cand - cur - dist * 0.08;
    if (!best || gain > best.gain) best = { drop: d, why, gain };
  }
  return best;
}
