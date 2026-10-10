// Small dependency-free vector math used by the simulation (no Three.js in sim code,
// so whole matches can run headless in Node tests).

export interface Vec3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vset = (o: Vec3, x: number, y: number, z: number): Vec3 => { o.x = x; o.y = y; o.z = z; return o; };
export const vcopy = (o: Vec3, a: Vec3): Vec3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vaddScaled = (o: Vec3, a: Vec3, s: number): Vec3 => { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; };
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vlen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const vlen2d = (a: Vec3): number => Math.hypot(a.x, a.z);
export const vdist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdist2d = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const vnorm = (a: Vec3): Vec3 => { const l = vlen(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const DEG = Math.PI / 180;

/** Wrap angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Direction from yaw/pitch. Convention: yaw=0 looks toward -Z, yaw grows counter-clockwise
 * (turning left); pitch>0 looks up. Matches Three.js camera rotation order 'YXZ'.
 */
export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function anglesFromDir(d: Vec3): { yaw: number; pitch: number } {
  const h = Math.hypot(d.x, d.z);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, h) };
}

/** Angle between two directions in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = vdot(a, b) / ((vlen(a) * vlen(b)) || 1);
  return Math.acos(clamp(d, -1, 1));
}

/** Rotate direction by small yaw/pitch offsets (radians). */
export function perturbDir(d: Vec3, dyaw: number, dpitch: number): Vec3 {
  const a = anglesFromDir(d);
  return dirFromAngles(a.yaw + dyaw, clamp(a.pitch + dpitch, -1.55, 1.55));
}

/** Ray vs sphere; returns distance along normalized ray or -1. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 ? t : -1;
}

/** Ray vs vertical (Y-axis) cylinder segment. Returns distance or -1. */
export function rayCylinderY(o: Vec3, d: Vec3, cx: number, cz: number, r: number, y0: number, y1: number): number {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let best = -1;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) { best = t; break; }
      }
    }
  }
  // caps
  if (Math.abs(d.y) > 1e-9) {
    for (const yc of [y0, y1]) {
      const t = (yc - o.y) / d.y;
      if (t < 0) continue;
      const px = o.x + d.x * t - cx, pz = o.z + d.z * t - cz;
      if (px * px + pz * pz <= r * r && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

/** Segment (p0->p1) closest distance to point. */
export function segPointDist(p0: Vec3, p1: Vec3, c: Vec3): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p0.x + dx * t - c.x, p0.y + dy * t - c.y, p0.z + dz * t - c.z);
}
