import { MAP_DEFS, getMap } from '../src/sim/maps/maps';
import { NavGrid, analyzeMap } from '../src/sim/nav';
import { World } from '../src/sim/world';
const id = process.argv[2];
for (const d of MAP_DEFS.filter(x => !id || x.id === id)) {
  const m = getMap(d.id); const nav = new NavGrid(m); const a = analyzeMap(nav, new World(m));
  const g = m.types.map(r => r.slice());
  for (const r of a.routes) { for (const c of r.cells.slice(-8)) if (g[c.j][c.i] === '.' ) g[c.j][c.i] = '·'; g[r.entry.j][r.entry.i] = 'E'; g[r.stage.j][r.stage.i] = 'S'; }
  for (const h of a.holds) g[h.cell.j][h.cell.i] = 'H';
  console.log('==', d.id, a.routes.map(r => `${r.site}:${r.name}`).join(', '));
  g.forEach((r, j) => console.log(String(j).padStart(2), r.join('')));
}
