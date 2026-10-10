// Builds renderable meshes from the collision world (same geometry => what you see is what collides).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL } from '../../sim/maps/mapgrid';
import { Rng } from '../../sim/rng';
import type { Box, World } from '../../sim/world';
import { THEMES, crateTexture, floorTexture, siteLetterTexture, skyTexture, wallTexture } from './textures';

/** Box geometry with world-space UVs (texture repeats every `uvScale` meters). */
function worldBox(b: { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number }, uvScale: number, skipBottom = true, skipTop = false): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (corners: number[][], n: number[], u: (p: number[]) => number[]) => {
    const base = pos.length / 3;
    for (const c of corners) { pos.push(c[0], c[1], c[2]); nor.push(n[0], n[1], n[2]); const t = u(c); uv.push(t[0] / uvScale, t[1] / uvScale); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const { minx: x0, miny: y0, minz: z0, maxx: x1, maxy: y1, maxz: z1 } = b;
  // +X
  face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], p => [-p[2], p[1]]);
  // -X
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], p => [p[2], p[1]]);
  // +Z
  face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], p => [p[0], p[1]]);
  // -Z
  face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], p => [-p[0], p[1]]);
  if (!skipTop) face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], p => [p[0], -p[2]]);
  if (!skipBottom) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], p => [p[0], p[2]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export interface MapView {
  group: THREE.Group;
  sky: THREE.Mesh;
  water: THREE.Mesh[];
  update(t: number): void;
  dispose(): void;
}

export function buildMapView(world: World, opts: { shadows: boolean; quality: 'low' | 'medium' | 'high' }): MapView {
  const map = world.map;
  const theme = map.def.theme;
  const pal = THEMES[theme];
  const group = new THREE.Group();
  const buckets = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.Material; cast: boolean; receive: boolean }>();
  const mats = new Map<string, THREE.Material>();
  const mat = (key: string, make: () => THREE.Material) => {
    let m = mats.get(key);
    if (!m) { m = make(); mats.set(key, m); }
    return m;
  };
  const std = (tex: THREE.Texture, rough = 0.92, metal = 0, color = '#ffffff') => new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: metal, color });
  const push = (key: string, geo: THREE.BufferGeometry, m: THREE.Material, cast = true, receive = true) => {
    let b = buckets.get(key);
    if (!b) { b = { geos: [], mat: m, cast, receive }; buckets.set(key, b); }
    b.geos.push(geo);
  };

  const rng = new Rng(map.def.id.length * 97);
  for (const b of world.boxes) {
    switch (b.kind) {
      case 'wall': {
        // alternate wall variants in large chunks for visual variety
        const v = ((Math.floor(b.minx / 8) + Math.floor(b.minz / 8)) % 3 === 0) ? 1 : 0;
        push(`wall${v}`, worldBox(b, 4, true, false), mat(`wall${v}`, () => std(wallTexture(theme, v))));
        break;
      }
      case 'floor':
        push(`floor-${b.cellType}`, worldBox(b, 4, true, false), mat(`floor-${b.cellType}`, () => std(floorTexture(theme, b.cellType), b.cellType === '~' ? 0.25 : 0.95, 0)), false, true);
        break;
      case 'crate': case 'tallcrate':
        push('crate', worldBox(b, b.kind === 'crate' ? 1.1 : 1.15, true, false), mat('crate', () => std(crateTexture('wood', theme), 0.85)));
        break;
      case 'train':
        push('train', worldBox(b, 3.4, true, false), mat('train', () => std(crateTexture('train', theme), 0.6, 0.4)));
        break;
      case 'barrel':
        push('barrel', worldBox(b, 1.2, true, false), mat('barrel', () => std(crateTexture('barrel', theme), 0.6, 0.3)));
        break;
      case 'lowwall': case 'pillar':
        push('wall1', worldBox(b, 4, true, false), mat('wall1', () => std(wallTexture(theme, 1))));
        break;
      case 'roof':
        push('roof', worldBox(b, 4, false, false), mat('roof', () => std(wallTexture(theme, 1), 0.95, 0, '#b8b0a8')));
        break;
      case 'wood':
        push('wood', worldBox(b, 2, true, false), mat('wood', () => std(crateTexture('wood', theme), 0.9)));
        break;
      case 'rail':
        push('rail', worldBox(b, 1, true, false), mat('rail', () => new THREE.MeshStandardMaterial({ color: '#5c6670', roughness: 0.4, metalness: 0.8, transparent: true, opacity: 0.85 })), false, false);
        break;
    }
  }
  // Wall-top trims where walls meet open space (cornice detail)
  for (const b of world.boxes) {
    if (b.kind !== 'wall' || b.maxy < 3) continue;
    const t = 0.18;
    const trim = { minx: b.minx - t, miny: b.maxy - 0.35, minz: b.minz - t, maxx: b.maxx + t, maxy: b.maxy, maxz: b.maxz + t };
    push('trim', worldBox(trim, 2, false, false), mat('trim', () => new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.8 })), true, false);
  }

  for (const [, bk] of buckets) {
    const geo = mergeGeometries(bk.geos, false);
    for (const g of bk.geos) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bk.mat);
    mesh.castShadow = bk.cast && opts.shadows;
    mesh.receiveShadow = bk.receive && opts.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  // Bomb site letters painted on the floor and on a nearby wall
  for (const site of map.sites) {
    const tex = siteLetterTexture(site.id);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), m);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(site.center.x, site.center.y + 0.02, site.center.z);
    group.add(plane);
    // nearest wall face
    let best: { p: THREE.Vector3; n: THREE.Vector3 } | null = null, bd = Infinity;
    for (const b of world.boxes) {
      if (b.kind !== 'wall') continue;
      const faces: [number, number, number, number, number][] = [
        [b.maxx + 0.03, (b.minz + b.maxz) / 2, 1, 0, Math.abs(b.maxx - site.center.x)],
        [b.minx - 0.03, (b.minz + b.maxz) / 2, -1, 0, Math.abs(b.minx - site.center.x)],
      ];
      for (const [fx, , nx] of faces) {
        const cz = Math.min(Math.max(site.center.z, b.minz + 1.6), b.maxz - 1.6);
        if (b.maxz - b.minz < 3.4) continue;
        const d = Math.hypot(fx - site.center.x, cz - site.center.z);
        const facing = (site.center.x - fx) * nx > 0;
        if (facing && d < bd && d < 16) { bd = d; best = { p: new THREE.Vector3(fx, site.center.y + 2.4, cz), n: new THREE.Vector3(nx, 0, 0) }; }
      }
    }
    if (best) {
      const wp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), m);
      wp.position.copy(best.p);
      wp.lookAt(best.p.clone().add(best.n));
      group.add(wp);
    }
  }

  // Vegetation and decor
  const bushMat = new THREE.MeshStandardMaterial({ color: '#4a6a32', roughness: 1 });
  const bushGeo = new THREE.IcosahedronGeometry(0.8, 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.6, metalness: 0.5 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe9b0' });
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    const c = map.types[j][i];
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, y = map.floorH[j][i];
    if (c === 'v') {
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(bushGeo, bushMat);
        b.position.set(x + rng.range(-0.6, 0.6), y + 0.4 + rng.range(0, 0.3), z + rng.range(-0.6, 0.6));
        b.scale.setScalar(rng.range(0.5, 0.9));
        b.rotation.set(rng.next(), rng.next(), rng.next());
        b.castShadow = opts.shadows;
        group.add(b);
      }
    }
  }
  // lamps at site corners (emissive bulbs, no real lights for performance)
  for (const site of map.sites) {
    for (const [dx, dz] of [[site.min.x + 0.6, site.min.z + 0.6], [site.max.x - 0.6, site.max.z - 0.6]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3, 6), lampMat);
      pole.position.set(dx, site.center.y + 1.5, dz);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMat);
      bulb.position.set(dx, site.center.y + 3.05, dz);
      group.add(pole, bulb);
    }
  }

  // Water surfaces
  const water: THREE.Mesh[] = [];
  const wtex = floorTexture(theme, '~').clone();
  wtex.needsUpdate = true;
  const wmat = new THREE.MeshStandardMaterial({ map: wtex, color: '#6fb4d0', transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2 });
  for (const b of world.boxes) {
    if (b.kind === 'floor' && b.cellType === '~') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b.maxx - b.minx, b.maxz - b.minz), wmat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((b.minx + b.maxx) / 2, b.maxy + 0.12, (b.minz + b.maxz) / 2);
      group.add(m);
      water.push(m);
    }
  }

  // Sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(theme), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.position.set(world.sizeX / 2, 0, world.sizeZ / 2);
  group.add(sky);

  // Outer ground plane & distant terrain so the map edge doesn't float in the void
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: pal.floor2, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(world.sizeX / 2, -1.01, world.sizeZ / 2);
  group.add(outer);

  return {
    group, sky, water,
    update(t: number) { wtex.offset.set(t * 0.02, t * 0.013); },
    dispose() {
      group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const m of mats.values()) m.dispose();
      wmat.dispose();
    },
  };
}

export type { Box };
