// Map authoring DSL + compiler.
//
// Maps are painted on a cell grid (CELL meters per cell). Each cell has a type character
// and a floor elevation (in 0.5 m steps). The compiled grid is the single source of truth
// for collision boxes, navigation, the minimap and the renderer.
//
// Cell types:
//  '#' wall            '.' floor            'A' / 'B' bombsite floor
//  't' T spawn floor    'c' CT spawn floor  'D' covered floor (roof / door lintel above)
//  'x' low crate 1.1m   'X' tall crate 2.3m 'o' low wall 1.1m (shoot over)
//  'p' pillar           'w' thin wooden wall (penetrable)
//  'g' railing (blocks movement, not bullets/vision)
//  'r' barrel           '~' water/channel floor  'v' bush (decor)  'k' dirt floor
//  'H' train car / container 3.4m
//  ' ' void (outside the map, treated as wall)

export const CELL = 2;
export const STEP = 0.5; // elevation unit (m)

export type ThemeId =
  | 'desert' | 'mediterranean' | 'italian' | 'industrial' | 'jungle'
  | 'urban' | 'construction' | 'rail' | 'egypt' | 'range';

export type SiteId = 'A' | 'B';

export interface Callout { name: string; x: number; y: number; w: number; h: number }

export interface MapDef {
  id: string;
  name: string;
  inspiredBy: string;
  description: string;
  theme: ThemeId;
  w: number;
  h: number;
  wallHeight: number;
  paint: (p: Painter) => void;
  callouts?: Callout[];
  /** Map used only for training (no bomb sites required). */
  training?: boolean;
}

export const WALKABLE = new Set(['.', 'A', 'B', 't', 'c', 'D', '~', 'v', 'k']);
export const isWalkableType = (c: string): boolean => WALKABLE.has(c);

export class Painter {
  readonly types: string[][];
  readonly elev: number[][];
  constructor(readonly w: number, readonly h: number) {
    this.types = Array.from({ length: h }, () => Array(w).fill('#'));
    this.elev = Array.from({ length: h }, () => Array(w).fill(0));
  }
  private each(x: number, y: number, w: number, h: number, f: (i: number, j: number) => void): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      f(i, j);
    }
    return this;
  }
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    return this.each(x, y, w, h, (i, j) => { this.types[j][i] = ch; });
  }
  floor(x: number, y: number, w: number, h: number, level?: number): this {
    this.rect(x, y, w, h, '.');
    if (level !== undefined) this.level(x, y, w, h, level);
    return this;
  }
  wall(x: number, y: number, w: number, h: number): this { return this.rect(x, y, w, h, '#'); }
  level(x: number, y: number, w: number, h: number, level: number): this {
    return this.each(x, y, w, h, (i, j) => { this.elev[j][i] = level; });
  }
  /** Linear ramp/stairs along +x from level a (at x) to level b (at x+w-1). */
  rampX(x: number, y: number, w: number, h: number, a: number, b: number): this {
    return this.each(x, y, w, h, (i, j) => {
      const t = w > 1 ? (i - x) / (w - 1) : 1;
      this.elev[j][i] = Math.round(a + (b - a) * t);
    });
  }
  /** Linear ramp/stairs along +y (south) from level a to level b. */
  rampY(x: number, y: number, w: number, h: number, a: number, b: number): this {
    return this.each(x, y, w, h, (i, j) => {
      const t = h > 1 ? (j - y) / (h - 1) : 1;
      this.elev[j][i] = Math.round(a + (b - a) * t);
    });
  }
  /** Set type only where currently walkable (keeps elevation). */
  over(x: number, y: number, w: number, h: number, ch: string): this {
    return this.each(x, y, w, h, (i, j) => { if (isWalkableType(this.types[j][i])) this.types[j][i] = ch; });
  }
  set(x: number, y: number, ch: string): this { return this.rect(x, y, 1, 1, ch); }
  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return ' ';
    return this.types[y][x];
  }
}

export interface Site { id: SiteId; cells: [number, number][]; center: { x: number; y: number; z: number }; min: { x: number; z: number }; max: { x: number; z: number } }

export interface CompiledMap {
  def: MapDef;
  w: number;
  h: number;
  types: string[][];
  /** floor height in meters per cell */
  floorH: number[][];
  sites: Site[];
  tSpawns: { x: number; y: number; z: number }[];
  ctSpawns: { x: number; y: number; z: number }[];
  wallTop: number;
}

export function compileMap(def: MapDef): CompiledMap {
  const p = new Painter(def.w, def.h);
  def.paint(p);
  // force border walls
  for (let i = 0; i < def.w; i++) { p.types[0][i] = '#'; p.types[def.h - 1][i] = '#'; }
  for (let j = 0; j < def.h; j++) { p.types[j][0] = '#'; p.types[j][def.w - 1] = '#'; }
  const floorH = p.elev.map(r => r.map(e => e * STEP));
  const sites: Site[] = [];
  for (const id of ['A', 'B'] as SiteId[]) {
    const cells: [number, number][] = [];
    for (let j = 0; j < def.h; j++) for (let i = 0; i < def.w; i++) if (p.types[j][i] === id) cells.push([i, j]);
    if (!cells.length) continue;
    let sx = 0, sz = 0, minx = 1e9, minz = 1e9, maxx = -1e9, maxz = -1e9;
    for (const [i, j] of cells) {
      sx += i; sz += j;
      minx = Math.min(minx, i); minz = Math.min(minz, j); maxx = Math.max(maxx, i); maxz = Math.max(maxz, j);
    }
    sites.push({
      id, cells,
      center: siteCenter(cells, floorH, sx / cells.length, sz / cells.length),
      min: { x: minx * CELL, z: minz * CELL }, max: { x: (maxx + 1) * CELL, z: (maxz + 1) * CELL },
    });
  }
  const tSpawns: CompiledMap['tSpawns'] = [], ctSpawns: CompiledMap['ctSpawns'] = [];
  for (let j = 0; j < def.h; j++) for (let i = 0; i < def.w; i++) {
    const c = p.types[j][i];
    const pos = { x: (i + 0.5) * CELL, y: floorH[j][i], z: (j + 0.5) * CELL };
    if (c === 't') tSpawns.push(pos);
    if (c === 'c') ctSpawns.push(pos);
  }
  return { def, w: def.w, h: def.h, types: p.types, floorH, sites, tSpawns, ctSpawns, wallTop: def.wallHeight };
}

function siteCenter(cells: [number, number][], floorH: number[][], mx: number, mz: number): { x: number; y: number; z: number } {
  // nearest actual site cell to the centroid (centroid may land on a crate)
  let best = cells[0], bd = Infinity;
  for (const c of cells) {
    const d = (c[0] - mx) ** 2 + (c[1] - mz) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return { x: (best[0] + 0.5) * CELL, y: floorH[best[1]][best[0]], z: (best[1] + 0.5) * CELL };
}

export function mapToAscii(m: CompiledMap): string {
  return m.types.map(r => r.join('')).join('\n');
}

export function cellAt(m: CompiledMap, x: number, z: number): { i: number; j: number } {
  return { i: Math.floor(x / CELL), j: Math.floor(z / CELL) };
}

export function siteAt(m: CompiledMap, x: number, z: number): SiteId | null {
  const { i, j } = cellAt(m, x, z);
  if (i < 0 || j < 0 || i >= m.w || j >= m.h) return null;
  const t = m.types[j][i];
  return t === 'A' || t === 'B' ? t : null;
}

export function calloutAt(m: CompiledMap, x: number, z: number): string {
  const { i, j } = cellAt(m, x, z);
  const s = siteAt(m, x, z);
  if (s) return `Точка ${s}`;
  for (const c of m.def.callouts ?? []) {
    if (i >= c.x && i < c.x + c.w && j >= c.y && j < c.y + c.h) return c.name;
  }
  return '';
}
