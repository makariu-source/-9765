// "Saving" (keeping an expensive loadout for the next round) and hunting savers.
// Everything here uses only fair information: public alive counts, the bot's own memory and
// the team's call-outs; hiding spots come from the map layout, not from enemy positions.
import type { Actor } from '../sim/actor';
import type { Game } from '../sim/game';
import { vdist, vdist2d, type Vec3 } from '../sim/math';

export interface HideSpot { pos: Vec3; look: Vec3 }

const spotCache = new WeakMap<Game, HideSpot[]>();

/**
 * Corners away from the bomb sites where a lone player could wait out a round:
 * cells with walls on several sides, spread over the map.
 */
export function hidingSpots(g: Game): HideSpot[] {
  const cached = spotCache.get(g);
  if (cached) return cached;
  const nav = g.nav;
  const out: HideSpot[] = [];
  const cand: { i: number; j: number; s: number }[] = [];
  for (let j = 1; j < nav.h - 1; j++) for (let i = 1; i < nav.w - 1; i++) {
    if (!nav.isWalk(i, j)) continue;
    const cover = nav.coverScore[nav.idx(i, j)];
    if (cover < 4) continue;
    const p = nav.center(i, j);
    if (g.map.sites.some(s => vdist2d(p, s.center) < 14)) continue;
    cand.push({ i, j, s: cover });
  }
  cand.sort((a, b) => b.s - a.s);
  for (const c of cand) {
    const p = g.nav.center(c.i, c.j);
    if (out.some(o => vdist2d(o.pos, p) < 10)) continue;
    // look toward the most open direction (where someone would come from)
    let best = 0, look = { x: p.x + 1, y: p.y + 1.5, z: p.z };
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const d = { x: Math.sin(ang), y: 0, z: Math.cos(ang) };
      const hit = g.world.raycast({ x: p.x, y: p.y + 1.5, z: p.z }, d, 30);
      const t = hit ? hit.t : 30;
      if (t > best) { best = t; look = { x: p.x + d.x * Math.min(t, 12), y: p.y + 1.5, z: p.z + d.z * Math.min(t, 12) }; }
    }
    out.push({ pos: p, look });
    if (out.length >= 24) break;
  }
  spotCache.set(g, out);
  return out;
}

/** Money worth of what the bot carries that a save would keep. */
export function loadoutValue(a: Actor): number {
  let v = a.primary ? a.primary.def.price : 0;
  if (!a.primary && a.secondary) v += a.secondary.def.price * 0.5;
  v += a.armor > 0 ? (a.helmet ? 1000 : 650) * (a.armor / 100) : 0;
  return v;
}

/** Best hiding spot: far from every enemy we know of, not too far to reach. */
export function pickHideSpot(g: Game, a: Actor, threats: Vec3[], avoid: Vec3 | null): HideSpot | null {
  let best: HideSpot | null = null, bs = -Infinity;
  for (const s of hidingSpots(g)) {
    const dEnemy = threats.length ? Math.min(...threats.map(t => vdist(t, s.pos))) : 40;
    if (dEnemy < 18) continue;
    if (avoid && vdist2d(avoid, s.pos) < 30) continue; // e.g. outside the bomb blast
    const dSelf = vdist2d(a.pos, s.pos);
    // the way there must not run past a known enemy
    const mid = { x: (a.pos.x + s.pos.x) / 2, y: a.pos.y, z: (a.pos.z + s.pos.z) / 2 };
    if (threats.some(t => vdist2d(t, mid) < 10)) continue;
    const sc = Math.min(dEnemy, 40) - dSelf * 0.35;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}
