// Grenade throw planning by simulating real projectile physics (no special powers:
// the bot searches throw angles whose simulated result is close to the target).
import type { Game } from '../sim/game';
import { FUSE, LOB_SPEED, THROW_SPEED, predictThrow } from '../sim/grenades';
import { dirFromAngles, type Vec3 } from '../sim/math';
import type { GrenadeType } from '../sim/weapons';

export interface ThrowPlan { yaw: number; pitch: number; strong: boolean; land: Vec3; error: number }

const cache = new Map<string, ThrowPlan | null>();

/**
 * View angles needed so a grenade thrown from `eye` lands (smoke/molotov/decoy) or
 * detonates (HE/flash, on fuse) near `target`. Mirrors throwVelocity().
 */
export function planThrow(g: Game, eye: Vec3, target: Vec3, tolerance = 2.5, type: GrenadeType = 'smoke'): ThrowPlan | null {
  const airburst = type === 'he' || type === 'flash';
  const key = `${g.map.def.id}|${type}|${Math.round(eye.x * 2)}|${Math.round(eye.y * 2)}|${Math.round(eye.z * 2)}|${Math.round(target.x)}|${Math.round(target.z)}`;
  if (cache.has(key)) return cache.get(key)!;
  const baseYaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  const aim = airburst ? { x: target.x, y: target.y + 1.5, z: target.z } : target;
  let best: ThrowPlan | null = null;
  const yawOffsets = [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4];
  outer: for (const dyaw of yawOffsets) {
    for (const strong of [true, false]) {
      const speed = strong ? THROW_SPEED : LOB_SPEED;
      const pitchAdd = strong ? 0.07 : 0.12;
      for (let deg = -15; deg <= 70; deg += 5) {
        const yaw = baseYaw + dyaw;
        const pitch = (deg * Math.PI) / 180;
        const dir = dirFromAngles(yaw, pitch + pitchAdd);
        const pos = { x: eye.x + dir.x * 0.3, y: eye.y - 0.1 + dir.y * 0.3, z: eye.z + dir.z * 0.3 };
        const vel = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
        const land = predictThrow(g, pos, vel, airburst ? FUSE[type] : 3.5);
        let err = Math.hypot(land.x - aim.x, land.z - aim.z) + Math.abs(land.y - aim.y) * 0.5;
        // an air-burst must also see the target area to be useful
        if (airburst && !g.world.lineClear(land, aim)) err += 6;
        if (!best || err < best.error) best = { yaw, pitch, strong, land, error: err };
        if (err < tolerance * 0.4) break outer;
      }
    }
    if ((best as ThrowPlan | null) && (best as unknown as ThrowPlan).error <= tolerance) break;
  }
  const res = best && best.error <= tolerance ? best : null;
  cache.set(key, res);
  if (cache.size > 4000) cache.clear();
  return res;
}
