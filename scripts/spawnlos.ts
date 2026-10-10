import { MAP_DEFS, getMap } from '../src/sim/maps/maps';
import { World } from '../src/sim/world';
import { NavGrid } from '../src/sim/nav';
for (const d of MAP_DEFS) {
  const m = getMap(d.id); const w = new World(m); const nav = new NavGrid(m);
  // spawn areas: walkable cells within 3 cells of spawn cells
  const area = (sp: {x:number;z:number}[]) => {
    const set = new Map<string, {x:number;y:number;z:number}>();
    for (const s of sp) { const c = nav.cellOf(s); for (let dj=-3;dj<=3;dj++) for (let di=-3;di<=3;di++) { const i=c.i+di,j=c.j+dj; if (nav.isWalk(i,j)) set.set(i+','+j, nav.center(i,j)); } }
    return [...set.values()];
  };
  const T = area(m.tSpawns), C = area(m.ctSpawns);
  const bad: string[] = [];
  for (const a of T) for (const b of C) {
    if (w.lineClear({x:a.x,y:a.y+1.64,z:a.z},{x:b.x,y:b.y+1.64,z:b.z})) bad.push(`T(${a.x/2-0.5},${a.z/2-0.5})->CT(${b.x/2-0.5},${b.z/2-0.5})`);
  }
  console.log(d.id, bad.length, bad.slice(0, 6).join(' '));
}
