// Procedural weapon models. Forward is -Z, origin at the firing hand's grip.
// Named children: 'mag' (reload animation), 'slide' (pistol slide / bolt), 'muzzle' (flash anchor),
// 'lefthand' (support-hand anchor).
import * as THREE from 'three';
import { WEAPONS } from '../../sim/weapons';

const M = {
  dark: new THREE.MeshStandardMaterial({ color: '#25272a', roughness: 0.45, metalness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: '#4c5157', roughness: 0.35, metalness: 0.85 }),
  poly: new THREE.MeshStandardMaterial({ color: '#33352f', roughness: 0.8 }),
  tan: new THREE.MeshStandardMaterial({ color: '#8b7b58', roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7b4823', roughness: 0.65 }),
  gold: new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.25, metalness: 1 }),
  blade: new THREE.MeshStandardMaterial({ color: '#b9c0c7', roughness: 0.2, metalness: 1 }),
  lens: new THREE.MeshStandardMaterial({ color: '#203a5a', roughness: 0.1, metalness: 0.6, emissive: '#0a1a30' }),
  olive: new THREE.MeshStandardMaterial({ color: '#4b5a32', roughness: 0.7 }),
  grey: new THREE.MeshStandardMaterial({ color: '#7d8389', roughness: 0.5, metalness: 0.5 }),
  green: new THREE.MeshStandardMaterial({ color: '#3c7a3c', roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#5a8a4a', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8 }),
  cloth: new THREE.MeshStandardMaterial({ color: '#d8c8a0', roughness: 1 }),
  red: new THREE.MeshStandardMaterial({ color: '#c0302a', roughness: 0.6, emissive: '#400000' }),
  c4: new THREE.MeshStandardMaterial({ color: '#b5a274', roughness: 0.8 }),
  orange: new THREE.MeshStandardMaterial({ color: '#c8641e', roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: '#d8d8d0', roughness: 0.6 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  m.castShadow = true;
  return m;
}
function cyl(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, axis: 'z' | 'y' = 'z', seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function anchor(name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

interface RifleSpec {
  recv: number; barrel: number; stock: number; mag: number; curve: number; furn: THREE.Material; body: THREE.Material;
  scope?: boolean; handguard?: number; drum?: boolean; bullpup?: boolean; thick?: number;
}

function rifle(s: RifleSpec): THREE.Group {
  const g = new THREE.Group();
  const t = s.thick ?? 1;
  const recvZ = s.bullpup ? 0.05 : -0.05;
  g.add(box(0.05 * t, 0.075 * t, s.recv, s.body, 0, 0.035, recvZ - s.recv / 2 + 0.08));
  const hg = s.handguard ?? s.barrel * 0.55;
  const front = recvZ - s.recv + 0.08;
  g.add(box(0.055 * t, 0.06 * t, hg, s.furn, 0, 0.03, front - hg / 2));
  g.add(cyl(0.011, s.barrel, M.dark, 0, 0.045, front - s.barrel / 2));
  g.add(anchor('muzzle', 0, 0.045, front - s.barrel));
  // grip
  const grip = box(0.035, 0.1, 0.045, s.furn, 0, -0.04, 0.03);
  grip.rotation.x = 0.25;
  g.add(grip);
  // stock
  if (!s.bullpup) {
    const st = box(0.045 * t, 0.07, s.stock, s.furn, 0, 0.0, 0.08 + s.stock / 2);
    g.add(st);
    g.add(box(0.05, 0.1, 0.03, s.furn, 0, -0.015, 0.08 + s.stock));
  } else {
    g.add(box(0.05, 0.09, 0.22, s.body, 0, 0.01, 0.2));
  }
  // magazine
  const magGroup = new THREE.Group();
  magGroup.name = 'mag';
  const magZ = s.bullpup ? 0.14 : -0.06;
  if (s.drum) {
    magGroup.add(cyl(0.07, 0.05, s.body, 0, -0.08, 0, 'y', 16));
  } else {
    const mg = box(0.03, s.mag, 0.05, M.dark, 0, -s.mag / 2, 0);
    mg.rotation.x = -s.curve;
    magGroup.add(mg);
  }
  magGroup.position.set(0, 0.0, magZ);
  g.add(magGroup);
  g.add(anchor('lefthand', 0, 0.0, front - hg * 0.4));
  // bolt
  g.add(box(0.012, 0.015, 0.04, M.metal, 0.03, 0.05, recvZ - 0.06, 'slide'));
  if (s.scope) {
    g.add(cyl(0.022, 0.24, M.dark, 0, 0.11, recvZ - s.recv * 0.45));
    g.add(cyl(0.028, 0.03, M.dark, 0, 0.11, recvZ - s.recv * 0.45 - 0.13));
    g.add(cyl(0.028, 0.03, M.dark, 0, 0.11, recvZ - s.recv * 0.45 + 0.11));
    const lens = cyl(0.02, 0.005, M.lens, 0, 0.11, recvZ - s.recv * 0.45 - 0.145);
    g.add(lens);
    g.add(box(0.012, 0.04, 0.012, M.dark, 0, 0.08, recvZ - s.recv * 0.45 - 0.06));
    g.add(box(0.012, 0.04, 0.012, M.dark, 0, 0.08, recvZ - s.recv * 0.45 + 0.06));
  } else {
    // iron sights
    g.add(box(0.008, 0.03, 0.008, M.dark, 0, 0.085, front - hg + 0.02));
    g.add(box(0.02, 0.02, 0.015, M.dark, 0, 0.08, recvZ + 0.02));
  }
  return g;
}

function pistol(len: number, h: number, body: THREE.Material, slideMat: THREE.Material, big = false): THREE.Group {
  const g = new THREE.Group();
  const slide = box(0.03 * (big ? 1.3 : 1), 0.035 * (big ? 1.2 : 1), len, slideMat, 0, 0.045, -len / 2 + 0.03, 'slide');
  g.add(slide);
  g.add(box(0.028, 0.025, len * 0.85, body, 0, 0.017, -len * 0.42 + 0.03));
  const grip = box(0.03, h, 0.045, body, 0, -h / 2 + 0.01, 0.02);
  grip.rotation.x = 0.22;
  g.add(grip);
  const mag = new THREE.Group();
  mag.name = 'mag';
  mag.add(box(0.022, h * 0.9, 0.035, M.dark, 0, -h / 2, 0));
  mag.position.set(0, 0, 0.025);
  mag.rotation.x = 0.22;
  g.add(mag);
  g.add(box(0.008, 0.012, 0.008, M.dark, 0, 0.068, -len + 0.04));
  g.add(anchor('muzzle', 0, 0.045, -len + 0.02));
  g.add(anchor('lefthand', 0, -0.02, 0.0));
  return g;
}

function knife(gold: boolean): THREE.Group {
  const g = new THREE.Group();
  const blade = box(0.006, 0.035, 0.18, gold ? M.gold : M.blade, 0, 0.01, -0.12);
  blade.scale.set(1, 1, 1);
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 4), gold ? M.gold : M.blade);
  tip.rotation.x = -Math.PI / 2;
  tip.scale.set(0.3, 1, 1);
  tip.position.set(0, 0.01, -0.235);
  g.add(tip);
  g.add(box(0.03, 0.05, 0.012, M.dark, 0, 0.005, -0.025));
  g.add(cyl(0.016, 0.11, gold ? M.gold : M.poly, 0, 0.0, 0.035));
  g.add(anchor('muzzle', 0, 0.01, -0.25));
  g.add(anchor('lefthand', 0, 0, 0));
  return g;
}

function grenade(type: string): THREE.Group {
  const g = new THREE.Group();
  switch (type) {
    case 'he': {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), M.olive);
      s.scale.set(1, 1.15, 1);
      g.add(s);
      g.add(box(0.012, 0.05, 0.02, M.grey, 0.02, 0.04, 0));
      g.add(cyl(0.012, 0.02, M.grey, 0, 0.045, 0, 'y'));
      break;
    }
    case 'flash':
      g.add(cyl(0.022, 0.1, M.grey, 0, 0, 0, 'y'));
      g.add(cyl(0.023, 0.012, M.white, 0, 0.02, 0, 'y'));
      g.add(box(0.01, 0.06, 0.02, M.metal, 0.024, 0.02, 0));
      break;
    case 'smoke':
      g.add(cyl(0.025, 0.11, M.grey, 0, 0, 0, 'y'));
      g.add(cyl(0.026, 0.02, M.green, 0, 0.02, 0, 'y'));
      g.add(box(0.01, 0.06, 0.02, M.metal, 0.026, 0.02, 0));
      break;
    case 'molotov':
      g.add(cyl(0.032, 0.1, M.glass, 0, 0, 0, 'y'));
      g.add(cyl(0.012, 0.06, M.glass, 0, 0.075, 0, 'y'));
      g.add(cyl(0.014, 0.05, M.cloth, 0, 0.12, 0, 'y'));
      break;
    case 'decoy':
      g.add(cyl(0.02, 0.09, M.orange, 0, 0, 0, 'y'));
      g.add(box(0.01, 0.05, 0.02, M.metal, 0.02, 0.02, 0));
      break;
  }
  g.add(anchor('muzzle', 0, 0, 0));
  g.add(anchor('lefthand', 0, 0, 0));
  return g;
}

function bomb(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.18, 0.06, 0.12, M.c4, 0, 0, 0));
  for (let i = 0; i < 3; i++) g.add(cyl(0.022, 0.18, M.tan, 0, -0.035, -0.04 + i * 0.04, 'z'));
  g.children.slice(-3).forEach(c => (c.rotation.z = Math.PI / 2));
  g.add(box(0.07, 0.012, 0.05, M.dark, 0.02, 0.035, 0));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), M.red);
  led.name = 'led';
  led.position.set(-0.05, 0.035, 0.03);
  g.add(led);
  g.add(anchor('muzzle', 0, 0, -0.06));
  g.add(anchor('lefthand', 0, 0, 0));
  return g;
}

const cache = new Map<string, THREE.Group>();

/** A fresh (cloned) model for a weapon id. */
export function weaponModel(id: string): THREE.Group {
  let proto = cache.get(id);
  if (!proto) {
    proto = build(id);
    cache.set(id, proto);
  }
  return proto.clone(true);
}

function build(id: string): THREE.Group {
  const def = WEAPONS[id];
  switch (id) {
    case 'ak': return rifle({ recv: 0.42, barrel: 0.42, stock: 0.26, mag: 0.2, curve: 0.35, furn: M.wood, body: M.dark });
    case 'm4': return rifle({ recv: 0.4, barrel: 0.4, stock: 0.24, mag: 0.17, curve: 0.12, furn: M.poly, body: M.dark, handguard: 0.26 });
    case 'galeon': return rifle({ recv: 0.42, barrel: 0.4, stock: 0.25, mag: 0.19, curve: 0.25, furn: M.poly, body: M.metal });
    case 'famine': return rifle({ recv: 0.5, barrel: 0.3, stock: 0, mag: 0.15, curve: 0.08, furn: M.poly, body: M.grey, bullpup: true });
    case 'awm': return rifle({ recv: 0.5, barrel: 0.58, stock: 0.3, mag: 0.08, curve: 0, furn: M.olive, body: M.dark, scope: true, handguard: 0.3, thick: 1.2 });
    case 'hawk': return rifle({ recv: 0.42, barrel: 0.52, stock: 0.26, mag: 0.08, curve: 0, furn: M.tan, body: M.dark, scope: true, handguard: 0.24 });
    case 'hailstorm': return rifle({ recv: 0.5, barrel: 0.48, stock: 0.26, mag: 0.1, curve: 0, furn: M.poly, body: M.dark, drum: true, thick: 1.4 });
    case 'nova': return rifle({ recv: 0.36, barrel: 0.5, stock: 0.26, mag: 0.0, curve: 0, furn: M.wood, body: M.dark, handguard: 0.22, thick: 1.1 });
    case 'xmauto': return rifle({ recv: 0.4, barrel: 0.46, stock: 0.26, mag: 0.0, curve: 0, furn: M.poly, body: M.dark, handguard: 0.24, thick: 1.15 });
    case 'mk5': return rifle({ recv: 0.3, barrel: 0.2, stock: 0.18, mag: 0.16, curve: 0.18, furn: M.poly, body: M.dark, handguard: 0.14 });
    case 'macx': return rifle({ recv: 0.22, barrel: 0.1, stock: 0.0, mag: 0.18, curve: 0, furn: M.poly, body: M.dark, handguard: 0.06 });
    case 'px90': return rifle({ recv: 0.42, barrel: 0.12, stock: 0, mag: 0, curve: 0, furn: M.poly, body: M.tan, bullpup: true, thick: 1.3 });
    case 'g9': return pistol(0.17, 0.11, M.poly, M.dark);
    case 'warden': return pistol(0.2, 0.11, M.dark, M.dark);
    case 'p250': return pistol(0.17, 0.11, M.poly, M.metal);
    case 'deagle': return pistol(0.24, 0.13, M.metal, M.metal, true);
    case 'trainer': return pistol(0.18, 0.11, M.orange, M.dark);
    case 'knife': return knife(false);
    case 'goldknife': return knife(true);
    case 'c4': return bomb();
    default:
      if (def?.cls === 'grenade') return grenade(id);
      return rifle({ recv: 0.4, barrel: 0.4, stock: 0.24, mag: 0.17, curve: 0.1, furn: M.poly, body: M.dark });
  }
}

export const weaponMaterials = M;
