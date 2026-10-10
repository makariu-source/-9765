// Articulated low-poly soldier models with procedural animation.
// Local space: facing -Z, feet at y=0, right hand on +X.
import * as THREE from 'three';
import { clamp, lerp } from '../../sim/math';
import type { Team, WeaponClass } from '../../sim/weapons';
import { weaponModel } from './weaponmodels';

interface Palette { top: string; pants: string; vest: string; head: 'helmet' | 'cap' | 'balaclava' | 'beanie' | 'bandana'; skin: string; accent: string; gloves: string; boots: string; pack: boolean; goggles: boolean }

// Three-color schemes per variant (top / pants / vest) plus a bright team accent
// (armbands, patch, helmet stripe) so teams read at a glance.
const T_PALETTES: Palette[] = [
  { top: '#c8813a', pants: '#6b4a2b', vest: '#4f5e33', head: 'balaclava', skin: '#d6a882', accent: '#ff5a2a', gloves: '#3a2c20', boots: '#3a2a1c', pack: false, goggles: false },
  { top: '#dcb468', pants: '#8a3e2e', vest: '#5f5a38', head: 'cap', skin: '#c48d64', accent: '#ff8a1a', gloves: '#4a3828', boots: '#3c2c1e', pack: true, goggles: false },
  { top: '#8fa03c', pants: '#5c4832', vest: '#c08c32', head: 'bandana', skin: '#e0b894', accent: '#e8402e', gloves: '#3a3a22', boots: '#34301e', pack: false, goggles: true },
  { top: '#b24a32', pants: '#45403a', vest: '#cfa468', head: 'beanie', skin: '#ae7c5c', accent: '#ffc030', gloves: '#2a2622', boots: '#2a2420', pack: true, goggles: false },
];
const CT_PALETTES: Palette[] = [
  { top: '#2f6fd6', pants: '#2c4468', vest: '#a2b0c0', head: 'helmet', skin: '#e0b496', accent: '#5fd8ff', gloves: '#1e2632', boots: '#1a1e26', pack: true, goggles: true },
  { top: '#4aa6ee', pants: '#3c4a5a', vest: '#21428a', head: 'helmet', skin: '#c8987a', accent: '#ffffff', gloves: '#26303a', boots: '#1c2028', pack: false, goggles: false },
  { top: '#e6edf5', pants: '#2c5cae', vest: '#3e4e60', head: 'cap', skin: '#d8a888', accent: '#38c4ff', gloves: '#202834', boots: '#181c22', pack: true, goggles: false },
  { top: '#2f9a96', pants: '#2a3e5e', vest: '#cdd5de', head: 'helmet', skin: '#a07a60', accent: '#4a96ff', gloves: '#22282a', boots: '#1a1e1c', pack: false, goggles: true },
];

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}`;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); matCache.set(k, m); }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function capsule(r: number, len: number): THREE.BufferGeometry {
  const k = `cap${r}-${len}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 3, 8); geoCache.set(k, g); }
  return g;
}
function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const k = `box${w}-${h}-${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function limb(r: number, len: number, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(capsule(r, len - r * 2 > 0 ? len - r * 2 : 0.01), m, 0, -len / 2, 0));
  return g;
}

export interface CharacterState {
  speed: number; crouch: number; airborne: boolean; pitch: number; yaw: number;
  firingKick: number; reloading: number; throwing: number; planting: boolean; defusing: boolean;
  alive: boolean; deathAge: number; weaponId: string; weaponClass: WeaponClass;
  /** sideways component of velocity relative to facing (-1..1) */
  strafe: number;
}

export class CharacterView {
  readonly root = new THREE.Group();
  private pelvis = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private lUpper: THREE.Group; private lFore: THREE.Group;
  private rUpper: THREE.Group; private rFore: THREE.Group;
  private lThigh: THREE.Group; private lShin: THREE.Group;
  private rThigh: THREE.Group; private rShin: THREE.Group;
  private weaponMount = new THREE.Group();
  private weapon: THREE.Group | null = null;
  private weaponId = '';
  private phase = 0;
  private deathDir = 1;
  private deathSide = 0;
  private wasAlive = true;
  readonly team: Team;

  constructor(team: Team, variant: number) {
    this.team = team;
    const pal = (team === 'T' ? T_PALETTES : CT_PALETTES)[variant % 4];
    const top = mat(pal.top), pants = mat(pal.pants), vest = mat(pal.vest, 0.9), skin = mat(pal.skin, 0.7);
    const gloves = mat(pal.gloves), boots = mat(pal.boots), accent = mat(pal.accent, 0.6);

    this.root.add(this.pelvis);
    this.pelvis.position.y = 0.95;
    this.pelvis.add(mesh(boxGeo(0.32, 0.16, 0.2), pants, 0, 0, 0));
    this.pelvis.add(mesh(boxGeo(0.34, 0.05, 0.22), mat('#2a2622'), 0, 0.07, 0)); // belt
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.add(mesh(boxGeo(0.3, 0.2, 0.19), top, 0, 0.1, 0));
    this.spine.add(this.chest);
    this.chest.position.y = 0.2;
    this.chest.add(mesh(boxGeo(0.4, 0.3, 0.22), top, 0, 0.12, 0));
    this.chest.add(mesh(boxGeo(0.36, 0.28, 0.27), vest, 0, 0.1, 0.0)); // plate carrier
    this.chest.add(mesh(boxGeo(0.08, 0.08, 0.03), accent, 0.1, 0.16, -0.14)); // patch
    for (let i = 0; i < 3; i++) this.chest.add(mesh(boxGeo(0.07, 0.09, 0.05), vest, -0.1 + i * 0.1, 0.0, -0.15)); // pouches
    if (pal.pack) this.chest.add(mesh(boxGeo(0.3, 0.34, 0.14), mat(pal.vest, 0.95), 0, 0.08, 0.19));
    // neck & head
    this.chest.add(this.head);
    this.head.position.y = 0.32;
    this.head.add(mesh(capsule(0.05, 0.05), skin, 0, 0.02, 0));
    const skull = mesh(new THREE.SphereGeometry(0.115, 12, 10), pal.head === 'balaclava' ? mat('#1e1e1e', 0.95) : skin, 0, 0.14, -0.01);
    skull.scale.set(0.92, 1.05, 1);
    this.head.add(skull);
    // face
    if (pal.head !== 'balaclava') {
      for (const ex of [-0.04, 0.04]) this.head.add(mesh(new THREE.SphereGeometry(0.012, 6, 4), mat('#1a1a1a'), ex, 0.16, -0.11));
      this.head.add(mesh(boxGeo(0.03, 0.03, 0.03), skin, 0, 0.12, -0.12)); // nose
    } else {
      this.head.add(mesh(boxGeo(0.12, 0.035, 0.02), skin, 0, 0.16, -0.105)); // eye slit
      for (const ex of [-0.035, 0.035]) this.head.add(mesh(new THREE.SphereGeometry(0.011, 6, 4), mat('#151515'), ex, 0.16, -0.112));
    }
    switch (pal.head) {
      case 'helmet': {
        const h = mesh(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(pal.vest, 0.6, 0.2), 0, 0.15, 0);
        this.head.add(h);
        this.head.add(mesh(boxGeo(0.29, 0.025, 0.3), mat(pal.vest, 0.6, 0.2), 0, 0.15, 0));
        this.head.add(mesh(boxGeo(0.04, 0.03, 0.27), accent, 0, 0.27, 0)); // helmet stripe
        break;
      }
      case 'cap':
        this.head.add(mesh(new THREE.SphereGeometry(0.122, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), mat(pal.accent === '#a83a20' ? '#2e2a24' : '#24303e'), 0, 0.16, 0));
        this.head.add(mesh(boxGeo(0.18, 0.015, 0.12), mat('#24282e'), 0, 0.2, -0.13));
        break;
      case 'beanie':
        this.head.add(mesh(new THREE.SphereGeometry(0.124, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mat('#3a2a22', 1), 0, 0.165, 0));
        break;
      case 'bandana':
        this.head.add(mesh(boxGeo(0.2, 0.06, 0.2), accent, 0, 0.1, -0.02));
        break;
    }
    if (pal.goggles) this.head.add(mesh(boxGeo(0.2, 0.05, 0.04), mat('#203040', 0.2, 0.5), 0, 0.17, -0.11));

    // arms (shoulder pivots)
    this.rUpper = limb(0.055, 0.3, top); this.rUpper.position.set(0.25, 0.22, 0);
    this.rFore = limb(0.048, 0.28, top); this.rFore.position.y = -0.3;
    this.rFore.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), gloves, 0, -0.3, 0));
    this.rUpper.add(this.rFore);
    this.lUpper = limb(0.055, 0.3, top); this.lUpper.position.set(-0.25, 0.22, 0);
    this.lFore = limb(0.048, 0.28, top); this.lFore.position.y = -0.3;
    this.lFore.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), gloves, 0, -0.3, 0));
    this.lUpper.add(this.lFore);
    // team armbands
    this.rUpper.add(mesh(boxGeo(0.125, 0.06, 0.125), accent, 0, -0.07, 0));
    this.lUpper.add(mesh(boxGeo(0.125, 0.06, 0.125), accent, 0, -0.07, 0));
    this.chest.add(this.rUpper, this.lUpper);
    // legs (hip pivots)
    this.rThigh = limb(0.075, 0.46, pants); this.rThigh.position.set(0.1, -0.05, 0);
    this.rShin = limb(0.065, 0.44, pants); this.rShin.position.y = -0.46;
    this.rShin.add(mesh(boxGeo(0.11, 0.08, 0.22), boots, 0, -0.44, -0.04));
    this.rShin.add(mesh(boxGeo(0.12, 0.1, 0.06), mat(pal.vest), 0, -0.02, -0.06)); // knee pad
    this.rThigh.add(this.rShin);
    this.lThigh = limb(0.075, 0.46, pants); this.lThigh.position.set(-0.1, -0.05, 0);
    this.lShin = limb(0.065, 0.44, pants); this.lShin.position.y = -0.46;
    this.lShin.add(mesh(boxGeo(0.11, 0.08, 0.22), boots, 0, -0.44, -0.04));
    this.lShin.add(mesh(boxGeo(0.12, 0.1, 0.06), mat(pal.vest), 0, -0.02, -0.06));
    this.lThigh.add(this.lShin);
    this.pelvis.add(this.rThigh, this.lThigh);

    this.chest.add(this.weaponMount);
    this.root.traverse(o => { o.matrixAutoUpdate = true; });
  }

  setWeapon(id: string): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) this.weaponMount.remove(this.weapon);
    this.weapon = id ? weaponModel(id) : null;
    if (this.weapon) {
      this.weapon.traverse(o => { (o as THREE.Mesh).castShadow = true; });
      this.weaponMount.add(this.weapon);
    }
  }

  update(s: CharacterState, dt: number): void {
    this.root.rotation.set(0, s.yaw, 0);
    this.setWeapon(s.alive ? s.weaponId : '');
    if (!s.alive) { this.animateDeath(s); return; }
    this.root.position.y = 0;
    // undo the death pose: a respawned soldier must stand upright again
    this.pelvis.rotation.set(0, 0, 0);
    this.wasAlive = true;
    const cls = s.weaponClass;
    // --- legs
    const sp = s.speed;
    this.phase += sp * dt * 4.4;
    const amp = clamp(sp / 6, 0, 1) * (0.75 - s.crouch * 0.4);
    const sw = Math.sin(this.phase) * amp;
    const crouch = s.crouch;
    let lTh = sw + crouch * 1.25, rTh = -sw + crouch * 1.25;
    let lSh = -Math.max(0, Math.sin(this.phase + Math.PI / 2)) * amp * 1.3 - crouch * 2.1;
    let rSh = -Math.max(0, Math.sin(this.phase - Math.PI / 2)) * amp * 1.3 - crouch * 2.1;
    if (s.airborne) { lTh = 0.7; rTh = 0.35; lSh = -1.1; rSh = -0.6; }
    this.lThigh.rotation.set(lTh, 0, -s.strafe * amp * 0.25);
    this.rThigh.rotation.set(rTh, 0, -s.strafe * amp * 0.25);
    this.lShin.rotation.x = lSh;
    this.rShin.rotation.x = rSh;
    this.pelvis.position.y = 0.95 - crouch * 0.43 + Math.abs(Math.sin(this.phase)) * 0.035 * amp - (s.airborne ? 0.05 : 0);
    // --- torso & aim
    const kick = s.firingKick;
    this.spine.rotation.x = -crouch * 0.18 + s.pitch * 0.35;
    this.chest.rotation.x = s.pitch * 0.4 + kick * 0.08;
    this.head.rotation.x = s.pitch * 0.25;
    this.spine.rotation.y = Math.sin(this.phase) * amp * 0.12;
    // --- arms by weapon class
    let rU = [0.45, 0, -0.15], rF = [1.35, 0, 0], lU = [0.95, 0, 0.5], lF = [0.75, 0, 0];
    let mount = [0.12, 0.06, -0.3];
    if (cls === 'pistol' || cls === 'training') { rU = [1.35, 0, -0.1]; rF = [0.25, 0, 0]; lU = [1.3, 0, 0.45]; lF = [0.3, 0, 0]; mount = [0.08, 0.2, -0.52]; }
    else if (cls === 'knife') { rU = [0.9, 0, -0.3]; rF = [0.8, 0, 0]; lU = [0.3, 0, 0.15]; lF = [0.4, 0, 0]; mount = [0.22, 0.05, -0.4]; }
    else if (cls === 'grenade') { rU = [0.9, 0, -0.25]; rF = [1.1, 0, 0]; lU = [0.5, 0, 0.2]; lF = [0.5, 0, 0]; mount = [0.2, 0.15, -0.35]; }
    else if (cls === 'bomb') { rU = [0.8, 0, -0.2]; rF = [0.9, 0, 0]; lU = [0.8, 0, 0.2]; lF = [0.9, 0, 0]; mount = [0.05, -0.05, -0.38]; }
    // reload: support hand drops to the magazine and back
    if (s.reloading > 0) {
      const r = Math.sin(Math.min(1, s.reloading) * Math.PI);
      lU = [lerp(lU[0], 0.4, r), 0, lerp(lU[2], 0.2, r)];
      lF = [lerp(lF[0], 1.1, r), 0, 0];
      mount = [mount[0], mount[1] - r * 0.05, mount[2] + r * 0.05];
    }
    // throw: wind up then release
    if (s.throwing > 0) {
      const t = s.throwing;
      const back = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
      rU = [lerp(0.9, -1.4, back), 0, -0.5];
      rF = [lerp(1.1, 1.6, back), 0, 0];
      mount = [0.25, 0.35 + back * 0.2, -0.1 + back * 0.4];
    }
    if (s.planting || s.defusing) { rU = [0.7, 0, -0.15]; rF = [0.6, 0, 0]; lU = [0.7, 0, 0.15]; lF = [0.6, 0, 0]; mount = [0.05, -0.25, -0.42]; }
    this.rUpper.rotation.set(rU[0] - kick * 0.05, rU[1], rU[2]);
    this.rFore.rotation.set(rF[0], rF[1], rF[2]);
    this.lUpper.rotation.set(lU[0], lU[1], lU[2]);
    this.lFore.rotation.set(lF[0], lF[1], lF[2]);
    this.weaponMount.position.set(mount[0], mount[1], mount[2] + kick * 0.04);
    this.weaponMount.rotation.set(-0.02, 0, 0);
    this.weaponMount.visible = !(s.planting || s.defusing) || cls === 'bomb';
  }

  private animateDeath(s: CharacterState): void {
    const t = clamp(s.deathAge / 0.65, 0, 1);
    // choose the fall direction once, at the moment of death (robust to low frame rates)
    if (this.wasAlive) { this.deathDir = Math.random() < 0.5 ? 1 : -1; this.deathSide = (Math.random() - 0.5) * 0.6; this.wasAlive = false; }
    const fall = t * t; // accelerate like gravity
    // knees buckle first, then the body tips over
    this.pelvis.position.y = lerp(0.95, 0.18, fall);
    this.pelvis.rotation.set(this.deathDir * fall * 1.45, 0, this.deathSide * fall);
    this.spine.rotation.x = this.deathDir * fall * 0.2;
    this.chest.rotation.x = 0;
    this.head.rotation.x = this.deathDir * fall * 0.4;
    this.lThigh.rotation.x = lerp(0, -this.deathDir * 0.3 + 0.4, fall);
    this.rThigh.rotation.x = lerp(0, 0.2, fall);
    this.lShin.rotation.x = lerp(0, -0.6, fall);
    this.rShin.rotation.x = lerp(0, -0.2, fall);
    this.rUpper.rotation.set(lerp(1, 2.6 * this.deathDir, fall), 0, -0.6 * fall);
    this.lUpper.rotation.set(lerp(1.2, 2.4 * this.deathDir, fall), 0, 0.7 * fall);
    this.rFore.rotation.x = lerp(0.9, 0.2, fall);
    this.lFore.rotation.x = lerp(0.4, 0.3, fall);
    this.weaponMount.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
