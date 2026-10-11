// Grid navigation for bots, derived from the same compiled map grid as collisions.
import { CELL, type CompiledMap, isWalkableType, ROOF_CLEARANCE, type SiteId } from './maps/mapgrid';
import type { Vec3 } from './math';
import type { World } from './world';

export const NAV_STEP_UP = 0.55;
export const NAV_DROP = 3.6;
/** Standing body height plus a small margin: a step needs this much headroom. */
export const NAV_HEADROOM = 1.85;

export interface NavPoint { i: number; j: number }

class MinHeap {
  private a: number[] = []; private p: number[] = [];
  get size() { return this.a.length; }
  push(v: number, pr: number) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [a[i], a[par]] = [a[par], a[i]]; [p[i], p[par]] = [p[par], p[i]];
      i = par;
    }
  }
  pop(): number {
    const a = this.a, p = this.p;
    const top = a[0];
    const lv = a.pop()!, lp = p.pop()!;
    if (a.length) {
      a[0] = lv; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
  readonly w: number; readonly h: number;
  readonly walk: Uint8Array;
  readonly height: Float32Array;
  /** Roof height over each cell (Infinity when open to the sky). */
  readonly ceil: Float32Array;
  /** Dynamic extra cost per cell (fires, danger). Reset by owners. */
  readonly extraCost: Float32Array;
  /** Cells adjacent to a non-walkable cell (cover proxies). */
  readonly coverScore: Uint8Array;

  constructor(readonly map: CompiledMap) {
    this.w = map.w; this.h = map.h;
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.ceil = new Float32Array(n);
    this.extraCost = new Float32Array(n);
    this.coverScore = new Uint8Array(n);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i;
      this.walk[k] = isWalkableType(map.types[j][i]) ? 1 : 0;
      this.height[k] = map.floorH[j][i];
      this.ceil[k] = map.types[j][i] === 'D' ? map.floorH[j][i] + ROOF_CLEARANCE : Infinity;
    }
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      if (!this.walk[j * this.w + i]) continue;
      let c = 0;
      for (const [di, dj] of DIRS) if (!this.isWalk(i + di, j + dj)) c++;
      this.coverScore[j * this.w + i] = c;
    }
  }

  idx(i: number, j: number) { return j * this.w + i; }
  isWalk(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 1; }
  cellOf(p: { x: number; z: number }): NavPoint { return { i: Math.floor(p.x / CELL), j: Math.floor(p.z / CELL) }; }
  center(i: number, j: number): Vec3 { return { x: (i + 0.5) * CELL, y: this.height[j * this.w + i], z: (j + 0.5) * CELL }; }

  /** Can an agent move directly from cell a to adjacent cell b? */
  canStep(ai: number, aj: number, bi: number, bj: number): boolean {
    if (!this.isWalk(bi, bj) || !this.isWalk(ai, aj)) return false;
    const ha = this.height[aj * this.w + ai], hb = this.height[bj * this.w + bi];
    const dh = hb - ha;
    if (dh > NAV_STEP_UP || -dh > NAV_DROP) return false;
    // headroom: a standing body coming off the higher floor must fit under both roofs
    // (e.g. dropping from a raised room onto a ramp whose low roof blocks the way)
    if (Math.max(ha, hb) + NAV_HEADROOM > Math.min(this.ceil[aj * this.w + ai], this.ceil[bj * this.w + bi])) return false;
    if (ai !== bi && aj !== bj) {
      // diagonals: both orthogonal neighbours must be passable too
      if (!this.canStep(ai, aj, bi, aj) || !this.canStep(ai, aj, ai, bj)) return false;
      if (!this.canStep(bi, aj, bi, bj) || !this.canStep(ai, bj, bi, bj)) return false;
    }
    return true;
  }

  /** Nearest walkable cell to a point (spiral search). */
  nearestWalkable(p: { x: number; z: number }): NavPoint | null {
    const c = this.cellOf(p);
    if (this.isWalk(c.i, c.j)) return c;
    for (let r = 1; r < 8; r++) {
      let best: NavPoint | null = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = c.i + di, j = c.j + dj;
        if (!this.isWalk(i, j)) continue;
        const cc = this.center(i, j);
        const d = Math.hypot(cc.x - p.x, cc.z - p.z);
        if (d < bd) { bd = d; best = { i, j }; }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * A* path. `penalty` adds per-cell cost (used for alternative-route generation
   * and danger avoidance).
   */
  findPath(from: { x: number; z: number }, to: { x: number; z: number }, penalty?: Float32Array): NavPoint[] | null {
    const s = this.nearestWalkable(from), g = this.nearestWalkable(to);
    if (!s || !g) return null;
    return this.findPathCells(s, g, penalty);
  }

  findPathCells(s: NavPoint, g: NavPoint, penalty?: Float32Array): NavPoint[] | null {
    const n = this.w * this.h;
    const gScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const sk = this.idx(s.i, s.j), gk = this.idx(g.i, g.j);
    gScore[sk] = 0;
    const hfn = (i: number, j: number) => {
      const dx = Math.abs(i - g.i), dy = Math.abs(j - g.j);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    heap.push(sk, hfn(s.i, s.j));
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      if (k === gk) break;
      closed[k] = 1;
      const i = k % this.w, j = (k / this.w) | 0;
      for (const [di, dj, cost] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (!this.canStep(i, j, ni, nj)) continue;
        const nk = this.idx(ni, nj);
        if (closed[nk]) continue;
        const c = gScore[k] + cost + this.extraCost[nk] + (penalty ? penalty[nk] : 0) + (this.coverScore[nk] > 3 ? 0.15 : 0);
        if (c < gScore[nk]) {
          gScore[nk] = c;
          came[nk] = k;
          heap.push(nk, c + hfn(ni, nj));
        }
      }
    }
    if (came[gk] === -1 && gk !== sk) return null;
    const path: NavPoint[] = [];
    let k = gk;
    while (k !== -1) { path.push({ i: k % this.w, j: (k / this.w) | 0 }); if (k === sk) break; k = came[k]; }
    path.reverse();
    return path;
  }

  /** Dijkstra distance field (in cells) from a set of sources. */
  distanceField(sources: NavPoint[], reverse = false): Float32Array {
    const n = this.w * this.h;
    const d = new Float32Array(n).fill(Infinity);
    const heap = new MinHeap();
    for (const s of sources) { const k = this.idx(s.i, s.j); d[k] = 0; heap.push(k, 0); }
    while (heap.size) {
      const k = heap.pop();
      const i = k % this.w, j = (k / this.w) | 0;
      for (const [di, dj, cost] of DIRS) {
        const ni = i + di, nj = j + dj;
        // reverse=true: distance TO the sources (edges traversed backwards)
        if (reverse ? !this.canStep(ni, nj, i, j) : !this.canStep(i, j, ni, nj)) continue;
        const nk = this.idx(ni, nj);
        const c = d[k] + cost;
        if (c < d[nk]) { d[nk] = c; heap.push(nk, c); }
      }
    }
    return d;
  }

  /** Straight walk check between two world points for path smoothing (agent radius aware). */
  directWalkable(a: Vec3, b: Vec3, radius = 0.4): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const nx = -dz / len, nz = dx / len;
    for (const off of [-radius, 0, radius]) {
      let prev = this.cellOf({ x: a.x + nx * off, z: a.z + nz * off });
      if (!this.isWalk(prev.i, prev.j)) return false;
      const steps = Math.ceil(len / 0.25);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const c = this.cellOf({ x: a.x + dx * t + nx * off, z: a.z + dz * t + nz * off });
        if (c.i !== prev.i || c.j !== prev.j) {
          if (!this.canStep(prev.i, prev.j, c.i, c.j)) return false;
          prev = c;
        }
      }
    }
    return true;
  }

  /** Convert cell path to smoothed waypoints in world space. */
  smooth(path: NavPoint[], start: Vec3): Vec3[] {
    const pts = path.map(p => this.center(p.i, p.j));
    if (!pts.length) return [];
    const out: Vec3[] = [];
    let cur = start;
    let idx = 0;
    while (idx < pts.length - 1) {
      let far = idx + 1;
      for (let k = pts.length - 1; k > idx + 1; k--) {
        if (this.directWalkable(cur, pts[k])) { far = k; break; }
      }
      out.push(pts[far]);
      cur = pts[far];
      idx = far;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }

  cellDistance(a: NavPoint, b: NavPoint): number { return Math.hypot(a.i - b.i, a.j - b.j); }
}

// ---------------------------------------------------------------------------
// Tactical analysis: computed once per map, used by bot team strategy.

export interface Route { site: SiteId; cells: NavPoint[]; entry: NavPoint; choke: NavPoint; name: string; /** waiting cell out of sight of the site */ stage: NavPoint }
export interface HoldSpot { cell: NavPoint; look: Vec3; site: SiteId | 'mid'; score: number; looks?: Vec3[] }

export interface MapAnalysis {
  routes: Route[];
  holds: HoldSpot[];
  siteCells: Record<string, NavPoint[]>;
  /** Plant spots per site (cells with cover inside the site). */
  plantSpots: Record<string, NavPoint[]>;
  distFromT: Float32Array;
  distFromCT: Float32Array;
}

export function analyzeMap(nav: NavGrid, world: World): MapAnalysis {
  const m = nav.map;
  const tCells = m.tSpawns.map(s => nav.cellOf(s));
  const ctCells = m.ctSpawns.map(s => nav.cellOf(s));
  const distFromT = nav.distanceField(tCells.length ? tCells : [{ i: 1, j: 1 }]);
  const distFromCT = nav.distanceField(ctCells.length ? ctCells : [{ i: 1, j: 1 }]);
  const routes: Route[] = [];
  const holds: HoldSpot[] = [];
  const siteCells: Record<string, NavPoint[]> = {};
  const plantSpots: Record<string, NavPoint[]> = {};
  if (!tCells.length || !ctCells.length) return { routes, holds, siteCells, plantSpots, distFromT, distFromCT };
  const tStart = nav.center(tCells[Math.floor(tCells.length / 2)].i, tCells[Math.floor(tCells.length / 2)].j);

  for (const site of m.sites) {
    const cells = site.cells.map(([i, j]) => ({ i, j })).filter(c => nav.isWalk(c.i, c.j));
    siteCells[site.id] = cells;
    plantSpots[site.id] = cells.filter(c => nav.coverScore[nav.idx(c.i, c.j)] >= 1);
    if (!plantSpots[site.id].length) plantSpots[site.id] = cells;
    const inSite = new Set(cells.map(c => nav.idx(c.i, c.j)));
    // Alternative routes via iterative penalties
    const penalty = new Float32Array(nav.w * nav.h);
    const found: NavPoint[][] = [];
    for (let attempt = 0; attempt < 7 && found.length < 3; attempt++) {
      const path = nav.findPath(tStart, site.center, penalty);
      if (!path) break;
      // cut path at first site cell
      let cut = path.findIndex(p => inSite.has(nav.idx(p.i, p.j)));
      if (cut < 0) cut = path.length - 1;
      const pre = path.slice(0, cut + 1);
      const overlapWith = (q: NavPoint[]) => {
        const s = new Set(q.map(p => nav.idx(p.i, p.j)));
        const last = pre.slice(Math.floor(pre.length * 0.4));
        return last.filter(p => s.has(nav.idx(p.i, p.j))).length / Math.max(1, last.length);
      };
      // attack lanes must not run through the defenders' spawn
      const viaCtSpawn = pre.some(p => ctCells.some(c => Math.abs(c.i - p.i) <= 4 && Math.abs(c.j - p.j) <= 4));
      if (!viaCtSpawn && found.every(f => overlapWith(f) < 0.5)) found.push(pre);
      for (const p of pre.slice(2)) {
        penalty[nav.idx(p.i, p.j)] += 12;
        for (const [di, dj] of DIRS) {
          const ni = p.i + di, nj = p.j + dj;
          if (nav.isWalk(ni, nj)) penalty[nav.idx(ni, nj)] += 6;
        }
      }
    }
    for (const pre of found) {
      const entry = pre[pre.length - 1];
      const choke = pre[Math.max(0, pre.length - 5)];
      // staging: the closest cell to the entry that cannot see into the site
      const targets: Vec3[] = cells.filter((_, k) => k % 3 === 0).map(c => { const p = nav.center(c.i, c.j); return { x: p.x, y: p.y + 1.5, z: p.z }; });
      let stage = pre[Math.max(0, pre.length - 10)];
      for (let k = pre.length - 4; k >= 0; k--) {
        const c = nav.center(pre[k].i, pre[k].j);
        const eye = { x: c.x, y: c.y + 1.64, z: c.z };
        if (!targets.some(t => world.lineClear(eye, t))) { stage = pre[k]; break; }
      }
      const name = m.def.callouts?.find(c => {
        const mid = pre[Math.max(0, pre.length - 8)];
        return mid.i >= c.x && mid.i < c.x + c.w && mid.j >= c.y && mid.j < c.y + c.h;
      })?.name ?? `Путь к ${site.id}`;
      routes.push({ site: site.id, cells: pre, entry, choke, name, stage });
    }

    // Hold spots for defenders: near the site, with cover, seeing route entries.
    const entries = routes.filter(r => r.site === site.id).map(r => nav.center(r.choke.i, r.choke.j));
    const cand: HoldSpot[] = [];
    const minI = Math.floor(site.min.x / CELL) - 4, maxI = Math.ceil(site.max.x / CELL) + 4;
    const minJ = Math.floor(site.min.z / CELL) - 4, maxJ = Math.ceil(site.max.z / CELL) + 4;
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
      if (!nav.isWalk(i, j)) continue;
      const k = nav.idx(i, j);
      if (distFromCT[k] > distFromT[k] * 1.1) continue; // keep defenders on their side
      const c = nav.center(i, j);
      const eye = { x: c.x, y: c.y + 1.6, z: c.z };
      let seen = 0, distScore = 0;
      let look = { x: site.center.x, y: c.y + 1.6, z: site.center.z };
      const looks: Vec3[] = [];
      let nearest = Infinity;
      for (const e of entries) {
        const ep = { x: e.x, y: e.y + 1.4, z: e.z };
        const d = Math.hypot(ep.x - c.x, ep.z - c.z);
        if (d < 5) continue;
        if (world.lineClear(eye, ep)) {
          seen++; distScore += d > 8 && d < 28 ? 1.2 : d < 40 ? 0.2 : -0.8; looks.push(ep);
          if (d < nearest) { nearest = d; look = ep; } // primary angle: the closest entry (least reaction time)
        }
      }
      if (!seen) continue;
      const score = seen * 2 + distScore + nav.coverScore[k] * 0.4;
      cand.push({ cell: { i, j }, look, site: site.id, score, looks });
    }
    cand.sort((a, b) => b.score - a.score);
    const chosen: HoldSpot[] = [];
    for (const c of cand) {
      if (chosen.every(o => nav.cellDistance(o.cell, c.cell) >= 3)) chosen.push(c);
      if (chosen.length >= 7) break; // the best spots first; extra ones give bots variety
    }
    if (!chosen.length && cells.length) {
      const c = cells[0];
      chosen.push({ cell: c, look: { x: site.center.x, y: 1.6, z: site.center.z }, site: site.id, score: 0 });
    }
    holds.push(...chosen);
  }
  return { routes, holds, siteCells, plantSpots, distFromT, distFromCT };
}

const analysisCache = new Map<string, MapAnalysis>();
export function getAnalysis(nav: NavGrid, world: World): MapAnalysis {
  let a = analysisCache.get(nav.map.def.id);
  if (!a) { a = analyzeMap(nav, world); analysisCache.set(nav.map.def.id, a); }
  return a;
}
