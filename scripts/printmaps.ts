import { MAP_DEFS, TRAINING_MAP, getMap } from '../src/sim/maps/maps';
import { mapToAscii } from '../src/sim/maps/mapgrid';
for (const d of [...MAP_DEFS, TRAINING_MAP]) {
  const m = getMap(d.id);
  console.log(`== ${d.name} (${d.w}x${d.h})`);
  const lines = mapToAscii(m).split('\n');
  lines.forEach((l, j) => console.log(String(j).padStart(2) + ' ' + l + '   ' + m.floorH[j].map(h => h === 0 ? '.' : Math.round(h * 2).toString(36)).join('')));
}
