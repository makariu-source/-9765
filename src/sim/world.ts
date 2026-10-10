// Static collision world built from a compiled map grid.
import { CELL, type CompiledMap, isWalkableType, ROOF_CLEARANCE } from './maps/mapgrid';
import type { Vec3 } from './math';

export type BoxKind =
  | 'floor' | 'wall' | 'crate' | 'tallcrate' | 'lowwall' | 'pillar' | 'wood'
  | 'rail' | 'roof' | 'barrel' | 'train';

export interface Box {
  id: number;
  minx: number; miny: number; minz: number;
  maxx: number; maxy: number; maxz: number;
  kind: BoxKind;
  /** Penetration resistance multiplier; Infinity = impenetrable. */
  resist: number;
  /** Bullets/vision pass through (railings). Still blocks movement and grenades. */
  seeThrough: boolean;
  /** cell type and grid origin, for rendering detail */
  cellType: string;
}

export interface RayHit {
  t: number;
  box: Box;
  nx: number; ny: number; nz: number;
}

export interface RaySpan { tIn: number; tOut: number; box: Box; nx: number; ny: number; nz: number }

const BROAD = 4; // broadphase cell size (m)

export class World {
  readonly boxes: Box[] = [];
  readonly wallTop: number;
  private grid: Box[][] = [];
  private gw = 0; private gh = 0;
  private stamp = 0;
  private stamps: Uint32Array = new Uint32Array(0);
  readonly sizeX: number; readonly sizeZ: number;

  constructor(readonly map: CompiledMap) {
    this.sizeX = map.w * CELL; this.sizeZ = map.h * CELL;
    let maxFloor = 0;
    for (const r of map.floorH) for (const h of r) maxFloor = Math.max(maxFloor, h);
    this.wallTop = Math.max(map.wallTop, maxFloor + 4.5);
    this.build();
    this.buildGrid();
  }

  private add(b: Omit<Box, 'id'>): void {
    this.boxes.push({ ...b, id: this.boxes.length });
  }

  private build(): void {
    const m = this.map;
    const W = m.w, H = m.h;
    const type = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? '#' : m.types[j][i] === ' ' ? '#' : m.types[j][i]);
    const fh = (i: number, j: number) => m.floorH[j][i];

    // Greedy rectangle merge for cells sharing a key.
    const merge = (keyOf: (i: number, j: number) => string | null, emit: (x: number, y: number, w: number, h: number, key: string) => void) => {
      const used: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        if (used[j][i]) continue;
        const k = keyOf(i, j);
        if (k === null) continue;
        let w = 1;
        while (i + w < W && !used[j][i + w] && keyOf(i + w, j) === k) w++;
        let h = 1;
        outer: while (j + h < H) {
          for (let x = i; x < i + w; x++) if (used[j + h][x] || keyOf(x, j + h) !== k) break outer;
          h++;
        }
        for (let y = j; y < j + h; y++) for (let x = i; x < i + w; x++) used[y][x] = true;
        emit(i, j, w, h, k);
      }
    };

    const top = this.wallTop;
    // Walls
    merge((i, j) => (type(i, j) === '#' ? '#' : null), (x, y, w, h) => {
      this.add({ minx: x * CELL, miny: -1, minz: y * CELL, maxx: (x + w) * CELL, maxy: top, maxz: (y + h) * CELL, kind: 'wall', resist: Infinity, seeThrough: false, cellType: '#' });
    });
    // Floors (everything not a wall), keyed by height + surface type group
    const surf = (c: string) => (c === 'A' || c === 'B' ? 'S' : c === '~' ? '~' : c === 'k' || c === 'v' ? 'k' : c === 't' || c === 'c' ? 'P' : '.');
    merge((i, j) => (type(i, j) === '#' ? null : `${fh(i, j)}|${surf(type(i, j))}`), (x, y, w, h, k) => {
      const hgt = parseFloat(k);
      this.add({ minx: x * CELL, miny: -1, minz: y * CELL, maxx: (x + w) * CELL, maxy: hgt, maxz: (y + h) * CELL, kind: 'floor', resist: Infinity, seeThrough: false, cellType: k.split('|')[1] });
    });
    // Merged objects
    const mergedKinds: Record<string, { kind: BoxKind; h: number; inset: number; resist: number }> = {
      x: { kind: 'crate', h: 1.1, inset: 0.12, resist: 2.2 },
      X: { kind: 'tallcrate', h: 2.3, inset: 0.12, resist: 2.2 },
      o: { kind: 'lowwall', h: 1.1, inset: 0, resist: Infinity },
      H: { kind: 'train', h: 3.4, inset: 0.25, resist: 6 },
    };
    merge((i, j) => (mergedKinds[type(i, j)] ? `${type(i, j)}|${fh(i, j)}` : null), (x, y, w, h, k) => {
      const [c, hs] = k.split('|');
      const d = mergedKinds[c];
      const base = parseFloat(hs);
      this.add({
        minx: x * CELL + d.inset, miny: base, minz: y * CELL + d.inset,
        maxx: (x + w) * CELL - d.inset, maxy: base + d.h, maxz: (y + h) * CELL - d.inset,
        kind: d.kind, resist: d.resist, seeThrough: false, cellType: c,
      });
    });
    // Roofs over covered cells
    merge((i, j) => (type(i, j) === 'D' ? `D|${fh(i, j)}` : null), (x, y, w, h, k) => {
      const base = parseFloat(k.split('|')[1]) + ROOF_CLEARANCE;
      this.add({ minx: x * CELL, miny: base, minz: y * CELL, maxx: (x + w) * CELL, maxy: Math.max(top, base + 1), maxz: (y + h) * CELL, kind: 'roof', resist: Infinity, seeThrough: false, cellType: 'D' });
    });
    // Per-cell objects
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = type(i, j);
      const x0 = i * CELL, z0 = j * CELL, base = fh(i, j);
      const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      if (c === 'p') {
        this.add({ minx: cx - 0.5, miny: base, minz: cz - 0.5, maxx: cx + 0.5, maxy: top, maxz: cz + 0.5, kind: 'pillar', resist: Infinity, seeThrough: false, cellType: c });
      } else if (c === 'r') {
        this.add({ minx: cx - 0.4, miny: base, minz: cz - 0.4, maxx: cx + 0.4, maxy: base + 1.2, maxz: cz + 0.4, kind: 'barrel', resist: 3, seeThrough: false, cellType: c });
      } else if (c === 'w' || c === 'g') {
        const solid = (q: string) => q === '#' || q === 'w' || q === 'g' || q === 'p';
        const alongX = solid(type(i - 1, j)) || solid(type(i + 1, j)) || !(solid(type(i, j - 1)) || solid(type(i, j + 1)));
        const t = c === 'w' ? 0.12 : 0.06;
        const hgt = c === 'w' ? Math.min(top, base + 3.4) : base + 1.0;
        if (alongX) this.add({ minx: x0, miny: base, minz: cz - t, maxx: x0 + CELL, maxy: hgt, maxz: cz + t, kind: c === 'w' ? 'wood' : 'rail', resist: c === 'w' ? 1 : 0.5, seeThrough: c === 'g', cellType: c });
        else this.add({ minx: cx - t, miny: base, minz: z0, maxx: cx + t, maxy: hgt, maxz: z0 + CELL, kind: c === 'w' ? 'wood' : 'rail', resist: c === 'w' ? 1 : 0.5, seeThrough: c === 'g', cellType: c });
      }
    }
  }

  private buildGrid(): void {
    this.gw = Math.ceil(this.sizeX / BROAD) + 1;
    this.gh = Math.ceil(this.sizeZ / BROAD) + 1;
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    for (const b of this.boxes) {
      const i0 = Math.max(0, Math.floor(b.minx / BROAD)), i1 = Math.min(this.gw - 1, Math.floor(b.maxx / BROAD));
      const j0 = Math.max(0, Math.floor(b.minz / BROAD)), j1 = Math.min(this.gh - 1, Math.floor(b.maxz / BROAD));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * this.gw + i].push(b);
    }
    this.stamps = new Uint32Array(this.boxes.length);
  }

  /** Boxes overlapping the XZ range (deduplicated). */
  query(minx: number, minz: number, maxx: number, maxz: number, out: Box[] = []): Box[] {
    out.length = 0;
    const st = ++this.stamp;
    const i0 = Math.max(0, Math.floor(minx / BROAD)), i1 = Math.min(this.gw - 1, Math.floor(maxx / BROAD));
    const j0 = Math.max(0, Math.floor(minz / BROAD)), j1 = Math.min(this.gh - 1, Math.floor(maxz / BROAD));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (const b of this.grid[j * this.gw + i]) {
        if (this.stamps[b.id] === st) continue;
        this.stamps[b.id] = st;
        out.push(b);
      }
    }
    return out;
  }

  /** Ray/box slab test. Returns entry & exit distances or null. */
  static slab(o: Vec3, d: Vec3, b: Box): { tIn: number; tOut: number; nx: number; ny: number; nz: number } | null {
    let tmin = -Infinity, tmax = Infinity;
    let nx = 0, ny = 0, nz = 0;
    const axes: [number, number, number, number, 0 | 1 | 2][] = [
      [o.x, d.x, b.minx, b.maxx, 0], [o.y, d.y, b.miny, b.maxy, 1], [o.z, d.z, b.minz, b.maxz, 2],
    ];
    for (const [oo, dd, lo, hi, ax] of axes) {
      if (Math.abs(dd) < 1e-12) {
        if (oo < lo || oo > hi) return null;
        continue;
      }
      let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
      let sgn = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sgn = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = ax === 0 ? sgn : 0; ny = ax === 1 ? sgn : 0; nz = ax === 2 ? sgn : 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return { tIn: tmin, tOut: tmax, nx, ny, nz };
  }

  private rayCandidates(o: Vec3, d: Vec3, maxDist: number, out: Box[]): Box[] {
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    // Walk broadphase cells along the ray with a simple DDA.
    out.length = 0;
    const st = ++this.stamp;
    let i = Math.floor(o.x / BROAD), j = Math.floor(o.z / BROAD);
    const ie = Math.floor(ex / BROAD), je = Math.floor(ez / BROAD);
    const stepI = d.x > 0 ? 1 : -1, stepJ = d.z > 0 ? 1 : -1;
    const tDx = Math.abs(d.x) > 1e-12 ? Math.abs(BROAD / d.x) : Infinity;
    const tDz = Math.abs(d.z) > 1e-12 ? Math.abs(BROAD / d.z) : Infinity;
    let tMx = Math.abs(d.x) > 1e-12 ? ((d.x > 0 ? (i + 1) * BROAD - o.x : o.x - i * BROAD) / Math.abs(d.x)) : Infinity;
    let tMz = Math.abs(d.z) > 1e-12 ? ((d.z > 0 ? (j + 1) * BROAD - o.z : o.z - j * BROAD) / Math.abs(d.z)) : Infinity;
    for (let guard = 0; guard < 512; guard++) {
      if (i >= 0 && j >= 0 && i < this.gw && j < this.gh) {
        for (const b of this.grid[j * this.gw + i]) {
          if (this.stamps[b.id] === st) continue;
          this.stamps[b.id] = st;
          out.push(b);
        }
      }
      if (i === ie && j === je) break;
      if (tMx < tMz) { if (tMx > maxDist) break; tMx += tDx; i += stepI; }
      else { if (tMz > maxDist) break; tMz += tDz; j += stepJ; }
    }
    return out;
  }

  private tmpBoxes: Box[] = [];

  /** Nearest solid hit along a normalized ray. */
  raycast(o: Vec3, d: Vec3, maxDist: number, opts: { bullets?: boolean } = {}): RayHit | null {
    const cands = this.rayCandidates(o, d, maxDist, this.tmpBoxes);
    let best: RayHit | null = null;
    for (const b of cands) {
      if (opts.bullets && b.seeThrough) continue;
      const s = World.slab(o, d, b);
      if (!s) continue;
      const t = s.tIn < 0 ? 0 : s.tIn;
      if (t > maxDist) continue;
      if (!best || t < best.t) best = { t, box: b, nx: s.nx, ny: s.ny, nz: s.nz };
    }
    return best;
  }

  /** All boxes the ray passes through (sorted), for bullet penetration. */
  raySpans(o: Vec3, d: Vec3, maxDist: number): RaySpan[] {
    const cands = this.rayCandidates(o, d, maxDist, this.tmpBoxes);
    const out: RaySpan[] = [];
    for (const b of cands) {
      if (b.seeThrough) continue;
      const s = World.slab(o, d, b);
      if (!s) continue;
      const tIn = Math.max(0, s.tIn);
      if (tIn > maxDist) continue;
      out.push({ tIn, tOut: s.tOut, box: b, nx: s.nx, ny: s.ny, nz: s.nz });
    }
    out.sort((a, b) => a.tIn - b.tIn);
    return out;
  }

  /** Clear line between two points for vision (railings don't block). */
  lineClear(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    return this.raycast(a, d, len - 0.02, { bullets: true }) === null;
  }

  private tmpQ: Box[] = [];
  /** Does an actor AABB at feet position overlap solid geometry? */
  overlaps(x: number, y: number, z: number, half: number, height: number): Box | null {
    const bs = this.query(x - half, z - half, x + half, z + half, this.tmpQ);
    for (const b of bs) {
      if (x + half > b.minx && x - half < b.maxx && z + half > b.minz && z - half < b.maxz && y + height > b.miny && y < b.maxy) return b;
    }
    return null;
  }

  /** Walkable floor height at a world XZ (from the grid). */
  floorAt(x: number, z: number): number {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (i < 0 || j < 0 || i >= this.map.w || j >= this.map.h) return 0;
    return this.map.floorH[j][i];
  }

  isWalkableAt(x: number, z: number): boolean {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (i < 0 || j < 0 || i >= this.map.w || j >= this.map.h) return false;
    return isWalkableType(this.map.types[j][i]);
  }
}

export const STEP_UP = 0.55;

export interface MoveBody {
  pos: Vec3; vel: Vec3; half: number; height: number; grounded: boolean;
}

/**
 * Axis-separated collide-and-slide with automatic step-up for stairs/ramps.
 * Returns true if the body was blocked horizontally.
 */
export function moveBody(world: World, b: MoveBody, dt: number): boolean {
  let blocked = false;
  const p = b.pos;
  const tmp: Box[] = [];
  const overlapping = (x: number, y: number, z: number): Box[] => {
    const res: Box[] = [];
    world.query(x - b.half, z - b.half, x + b.half, z + b.half, tmp);
    for (const bx of tmp) {
      if (x + b.half > bx.minx && x - b.half < bx.maxx && z + b.half > bx.minz && z - b.half < bx.maxz && y + b.height > bx.miny + 1e-4 && y < bx.maxy - 1e-4) res.push(bx);
    }
    return res;
  };
  const horiz = (axis: 'x' | 'z', delta: number) => {
    if (delta === 0) return;
    p[axis] += delta;
    for (let iter = 0; iter < 4; iter++) {
      const hits = overlapping(p.x, p.y, p.z);
      if (!hits.length) return;
      // Step-up: all blocking boxes low enough and room above.
      const maxTop = Math.max(...hits.map(h => h.maxy));
      if ((b.grounded || b.vel.y <= 0.5) && maxTop - p.y <= STEP_UP && maxTop - p.y > 0 && !world.overlaps(p.x, maxTop + 1e-3, p.z, b.half, b.height)) {
        p.y = maxTop + 1e-4;
        b.grounded = true;
        return;
      }
      const h = hits[0];
      if (axis === 'x') p.x = delta > 0 ? h.minx - b.half - 1e-4 : h.maxx + b.half + 1e-4;
      else p.z = delta > 0 ? h.minz - b.half - 1e-4 : h.maxz + b.half + 1e-4;
      b.vel[axis] = 0;
      blocked = true;
    }
  };
  // Sub-step large horizontal motion to avoid tunnelling thin walls.
  const dx = b.vel.x * dt, dz = b.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.1));
  for (let s = 0; s < steps; s++) {
    horiz('x', b.vel.x * dt / steps);
    horiz('z', b.vel.z * dt / steps);
  }
  // Vertical
  const dy = b.vel.y * dt;
  const wasGrounded = b.grounded;
  b.grounded = false;
  p.y += dy;
  const vh = overlapping(p.x, p.y, p.z);
  if (vh.length) {
    if (dy <= 0) {
      p.y = Math.max(...vh.map(h => h.maxy)) + 1e-4;
      b.grounded = true;
      b.vel.y = 0;
    } else {
      p.y = Math.min(...vh.map(h => h.miny)) - b.height - 1e-4;
      b.vel.y = 0;
    }
  } else if (wasGrounded && b.vel.y <= 0) {
    // Ground probe: stay snapped when walking down small steps.
    const below = overlapping(p.x, p.y - 0.06, p.z);
    if (below.length) { p.y = Math.max(...below.map(h => h.maxy)) + 1e-4; b.grounded = true; b.vel.y = 0; }
  }
  return blocked;
}
