import { MAP_DEFS, TRAINING_MAP, getMap } from '../../src/sim/maps/maps';
import { World } from '../../src/sim/world';
import { NavGrid, analyzeMap } from '../../src/sim/nav';

describe('maps', () => {
  for (const def of MAP_DEFS) {
    describe(def.name, () => {
      const m = getMap(def.id);
      const world = new World(m);
      const nav = new NavGrid(m);

      it('has spawns for both teams and two bomb sites', () => {
        expect(m.tSpawns.length).toBeGreaterThanOrEqual(5);
        expect(m.ctSpawns.length).toBeGreaterThanOrEqual(5);
        expect(m.sites.map(s => s.id).sort()).toEqual(['A', 'B']);
      });

      it('both sites are reachable from both spawns (and back)', () => {
        for (const spawn of [m.tSpawns[0], m.ctSpawns[0]]) {
          for (const site of m.sites) {
            expect(nav.findPath(spawn, site.center), `${def.id} spawn->${site.id}`).not.toBeNull();
            expect(nav.findPath(site.center, spawn), `${def.id} ${site.id}->spawn`).not.toBeNull();
          }
        }
      });

      it('every walkable cell can reach T spawn and CT spawn (no traps)', () => {
        const toT = nav.distanceField([nav.cellOf(m.tSpawns[0])], true);
        const toCT = nav.distanceField([nav.cellOf(m.ctSpawns[0])], true);
        const traps: string[] = [];
        for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
          if (!nav.isWalk(i, j)) continue;
          const k = nav.idx(i, j);
          if (!isFinite(toT[k]) || !isFinite(toCT[k])) traps.push(`${i},${j}`);
        }
        expect(traps, `unreachable cells on ${def.id}`).toEqual([]);
      });

      it('has multiple attack routes and defender hold spots', () => {
        const a = analyzeMap(nav, world);
        expect(a.routes.length).toBeGreaterThanOrEqual(3);
        for (const s of ['A', 'B']) {
          expect(a.routes.some(r => r.site === s)).toBe(true);
          expect(a.holds.some(h => h.site === s)).toBe(true);
          expect(a.plantSpots[s].length).toBeGreaterThan(0);
        }
      });

      it('no line of sight between the two spawn areas', () => {
        const area = (sp: { x: number; z: number }[]) => {
          const set = new Map<string, { x: number; y: number; z: number }>();
          for (const s of sp) {
            const c = nav.cellOf(s);
            for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
              if (nav.isWalk(c.i + di, c.j + dj)) set.set(`${c.i + di},${c.j + dj}`, nav.center(c.i + di, c.j + dj));
            }
          }
          return [...set.values()];
        };
        let visible = 0;
        for (const a of area(m.tSpawns)) for (const b of area(m.ctSpawns)) {
          if (world.lineClear({ x: a.x, y: a.y + 1.64, z: a.z }, { x: b.x, y: b.y + 1.64, z: b.z })) visible++;
        }
        expect(visible).toBe(0);
      });

      it('spawns are not inside geometry', () => {
        for (const s of [...m.tSpawns, ...m.ctSpawns]) {
          expect(world.overlaps(s.x, s.y + 0.01, s.z, 0.35, 1.8)).toBeNull();
        }
      });
    });
  }

  it('training range compiles', () => {
    const m = getMap(TRAINING_MAP.id);
    expect(m.tSpawns.length).toBeGreaterThan(0);
    expect(new World(m).boxes.length).toBeGreaterThan(5);
  });
});
