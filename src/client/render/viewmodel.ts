// First-person arms & weapon, rendered in a separate pass so it never clips into walls.
import * as THREE from 'three';
import type { Actor } from '../../sim/actor';
import { clamp, lerp } from '../../sim/math';
import { WEAPONS } from '../../sim/weapons';
import { softSprite } from './textures';
import { weaponModel } from './weaponmodels';

const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t: number) => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private holder = new THREE.Group();
  private weapon: THREE.Group | null = null;
  private weaponId = '';
  private mag: THREE.Object3D | null = null;
  private magHome = new THREE.Vector3();
  private slide: THREE.Object3D | null = null;
  private slideHome = new THREE.Vector3();
  private muzzle: THREE.Object3D | null = null;
  private leftAnchor: THREE.Object3D | null = null;
  private rArm: THREE.Mesh;
  private lArm: THREE.Mesh;
  private rHand: THREE.Mesh;
  private lHand: THREE.Mesh;
  private flash: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private kick = 0;
  private kickRot = 0;
  private flashTime = 0;
  private swayX = 0; private swayY = 0;
  private bobT = 0;
  private slashT = -1;
  private slashHeavy = false;
  private deployStart = 0;
  private lastTeam = '';
  visible = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.rig.add(this.holder);
    const amb = new THREE.HemisphereLight('#fff8ee', '#7a7068', 2.4);
    const dir = new THREE.DirectionalLight('#ffffff', 2.2);
    dir.position.set(0.4, 1, 0.3);
    this.scene.add(amb, dir);
    const sleeve = new THREE.MeshStandardMaterial({ color: '#4a4a3a', roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.85 });
    const armGeo = new THREE.CylinderGeometry(0.035, 0.045, 1, 10);
    armGeo.translate(0, 0.5, 0);
    armGeo.rotateX(Math.PI / 2); // length along +Z, so lookAt aims it
    this.rArm = new THREE.Mesh(armGeo, sleeve);
    this.lArm = new THREE.Mesh(armGeo, sleeve.clone());
    this.rHand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), glove);
    this.lHand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), glove);
    this.rHand.scale.set(1, 0.8, 1.3);
    this.lHand.scale.set(1, 0.8, 1.3);
    this.rig.add(this.rArm, this.lArm, this.rHand, this.lHand);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite('#ffd27a', 'flash'), color: '#ffcc66', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.22, 0.22, 1);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight('#ffb050', 0, 3);
    this.rig.add(this.flashLight);
    this.rig.position.set(0.17, -0.19, -0.34);
  }

  setAspect(a: number): void { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  private setTeamColors(team: string): void {
    if (team === this.lastTeam) return;
    this.lastTeam = team;
    const col = team === 'CT' ? '#2f6fd6' : '#c8813a';
    (this.rArm.material as THREE.MeshStandardMaterial).color.set(col);
    (this.lArm.material as THREE.MeshStandardMaterial).color.set(col);
  }

  private setWeapon(id: string, now: number): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) this.holder.remove(this.weapon);
    this.weapon = id ? weaponModel(id) : null;
    this.mag = this.slide = this.muzzle = this.leftAnchor = null;
    if (this.weapon) {
      this.holder.add(this.weapon);
      this.mag = this.weapon.getObjectByName('mag') ?? null;
      this.slide = this.weapon.getObjectByName('slide') ?? null;
      this.muzzle = this.weapon.getObjectByName('muzzle') ?? null;
      this.leftAnchor = this.weapon.getObjectByName('lefthand') ?? null;
      if (this.mag) this.magHome.copy(this.mag.position);
      if (this.slide) this.slideHome.copy(this.slide.position);
      if (this.muzzle) { this.muzzle.add(this.flash); this.muzzle.add(this.flashLight); }
      this.weapon.traverse(o => { o.renderOrder = 1; });
    }
    this.deployStart = now;
  }

  /** Called on our own shot event. */
  onShot(heavy: boolean): void {
    const def = WEAPONS[this.weaponId];
    if (def?.cls === 'knife') { this.slashT = 0; this.slashHeavy = heavy; return; }
    const strength = def ? clamp(def.recoilUp * 6 + (def.cls === 'sniper' ? 0.6 : 0) + (def.cls === 'shotgun' ? 0.5 : 0), 0.15, 1) : 0.3;
    this.kick = Math.min(1.4, this.kick + strength);
    this.kickRot = Math.min(1.4, this.kickRot + strength);
    this.flashTime = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
  }

  update(a: Actor, now: number, dt: number, mouseDX: number, mouseDY: number, bobEnabled: boolean): void {
    this.setTeamColors(a.team);
    const def = a.activeDef();
    const scoped = !!def.scope && a.scopeLevel > 0;
    this.rig.visible = this.visible && a.alive && !scoped;
    this.setWeapon(a.alive ? def.id : '', now);
    if (!this.weapon) return;
    // --- base pose per class
    let base = new THREE.Vector3(0.17, -0.19, -0.34);
    let baseRot = new THREE.Euler(0, 0, 0);
    if (def.cls === 'pistol' || def.cls === 'training') base = new THREE.Vector3(0.13, -0.17, -0.36);
    if (def.cls === 'knife') { base = new THREE.Vector3(0.2, -0.2, -0.3); baseRot = new THREE.Euler(0.2, 0.3, -0.3); }
    if (def.cls === 'grenade') { base = new THREE.Vector3(0.18, -0.2, -0.3); }
    if (def.cls === 'bomb') { base = new THREE.Vector3(0.06, -0.24, -0.36); baseRot = new THREE.Euler(0.5, 0, 0); }
    if (def.cls === 'sniper') base = new THREE.Vector3(0.16, -0.2, -0.32);
    const pos = base.clone();
    const rot = new THREE.Vector3(baseRot.x, baseRot.y, baseRot.z);

    // --- draw animation
    const dTime = Math.max(0.15, def.deployTime);
    const dp = (now - this.deployStart) / dTime;
    if (dp < 1) { const e = easeOut(dp); pos.y -= (1 - e) * 0.25; rot.x -= (1 - e) * 0.9; rot.z += (1 - e) * 0.4; }

    // --- sway & bob
    this.swayX = lerp(this.swayX, clamp(-mouseDX * 0.0006, -0.04, 0.04), Math.min(1, dt * 10));
    this.swayY = lerp(this.swayY, clamp(mouseDY * 0.0006, -0.04, 0.04), Math.min(1, dt * 10));
    pos.x += this.swayX; pos.y += this.swayY;
    rot.y += this.swayX * 1.5;
    const speed = Math.hypot(a.vel.x, a.vel.z);
    if (bobEnabled && a.grounded) this.bobT += dt * speed * 1.6;
    const bobAmt = clamp(speed / 6, 0, 1) * (bobEnabled ? 1 : 0);
    pos.x += Math.sin(this.bobT) * 0.012 * bobAmt;
    pos.y += -Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt + Math.sin(now * 1.6) * 0.002;
    if (!a.grounded) pos.y += 0.02;
    if (a.crouchAmt > 0.5) pos.y += 0.01;

    // --- recoil kick
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    pos.z += this.kick * 0.05;
    rot.x += this.kickRot * 0.12;
    if (this.slide) this.slide.position.z = this.slideHome.z + (this.kick > 0.4 ? 0.03 : 0);

    // --- reload with magazine swap
    if (this.mag) this.mag.position.copy(this.magHome), this.mag.visible = true;
    if (a.reloadEnd > now && def.mag > 0) {
      const total = def.cls === 'shotgun' ? 0.55 : def.reloadTime;
      const p = 1 - (a.reloadEnd - now) / total;
      // tilt the weapon
      const tilt = Math.sin(clamp(p, 0, 1) * Math.PI);
      rot.z += tilt * 0.6; rot.x += tilt * 0.15; pos.y -= tilt * 0.03;
      if (this.mag && def.cls !== 'shotgun') {
        if (p < 0.3) this.mag.position.y = this.magHome.y - easeInOut(p / 0.3) * 0.25;
        else if (p < 0.45) { this.mag.visible = false; }
        else if (p < 0.8) this.mag.position.y = this.magHome.y - (1 - easeInOut((p - 0.45) / 0.35)) * 0.25;
      }
      if (this.slide && p > 0.85) this.slide.position.z = this.slideHome.z + Math.sin((p - 0.85) / 0.15 * Math.PI) * 0.04;
    }

    // --- inspect
    if (a.inspectUntil > now) {
      const p = 1 - (a.inspectUntil - now) / 2.2;
      const k = Math.sin(clamp(p, 0, 1) * Math.PI);
      rot.y += k * 1.1; rot.z += k * 0.5; pos.x -= k * 0.06; pos.y += k * 0.03;
    }

    // --- grenade pin pull & throw
    if (def.cls === 'grenade') {
      if (a.throwStart > 0 && a.throwRelease === 0) {
        const p = clamp((now - a.throwStart) / 0.25, 0, 1);
        pos.y += p * 0.08; pos.z += p * 0.12; rot.x -= p * 0.6;
      } else if (a.throwRelease > 0) {
        const p = 1 - clamp((a.throwRelease - now) / 0.1, 0, 1);
        pos.z -= p * 0.3; rot.x += p * 0.9;
      }
    }
    // --- knife slash
    if (this.slashT >= 0) {
      this.slashT += dt / (this.slashHeavy ? 0.45 : 0.28);
      const s = Math.sin(clamp(this.slashT, 0, 1) * Math.PI);
      if (this.slashHeavy) { rot.x -= s * 1.2; pos.z -= s * 0.12; }
      else { rot.y += s * 1.3; rot.z -= s * 0.6; pos.x -= s * 0.12; }
      if (this.slashT >= 1) this.slashT = -1;
    }
    // --- planting / defusing: typing on the C4
    if (a.planting > 0 && def.cls === 'bomb') { pos.y -= 0.04; rot.x += 0.2 + Math.sin(now * 25) * 0.02; }
    if (a.defusing > 0) { pos.y -= 0.3; }

    this.holder.position.copy(pos).sub(base);
    this.rig.position.copy(base);
    this.holder.rotation.set(rot.x, rot.y, rot.z);

    // --- arms: from shoulders below the screen to the hands
    this.rig.updateMatrixWorld(true);
    const rGrip = new THREE.Vector3(0, -0.04, 0.03);
    this.holder.localToWorld(rGrip); this.rig.worldToLocal(rGrip);
    const lGrip = new THREE.Vector3();
    if (this.leftAnchor && def.cls !== 'knife' && def.cls !== 'grenade') {
      this.leftAnchor.getWorldPosition(lGrip); this.rig.worldToLocal(lGrip);
      lGrip.y -= 0.02;
    } else lGrip.set(-0.22, -0.25, 0.05);
    if (a.reloadEnd > now && this.mag && this.mag.visible && def.mag > 0) {
      const mp = new THREE.Vector3(); this.mag.getWorldPosition(mp); this.rig.worldToLocal(mp); lGrip.lerp(mp, 0.85);
    }
    this.placeArm(this.rArm, this.rHand, new THREE.Vector3(0.22, -0.5, 0.35), rGrip);
    this.placeArm(this.lArm, this.lHand, new THREE.Vector3(-0.32, -0.5, 0.3), lGrip);
    // --- muzzle flash
    this.flashTime -= dt;
    const fl = this.flashTime > 0 && def.cls !== 'knife';
    this.flash.visible = fl;
    this.flashLight.intensity = fl ? 6 : 0;
  }

  private placeArm(arm: THREE.Mesh, hand: THREE.Mesh, shoulder: THREE.Vector3, target: THREE.Vector3): void {
    arm.position.copy(shoulder);
    arm.lookAt(this.rig.localToWorld(target.clone()));
    arm.scale.set(1, 1, shoulder.distanceTo(target));
    hand.position.copy(target);
    hand.quaternion.copy(arm.quaternion);
  }

  /** World position of the muzzle (for tracers starting at the gun). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.muzzle || !this.rig.visible) return null;
    this.muzzle.getWorldPosition(out);
    return out;
  }
}
