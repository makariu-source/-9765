// Visual effects with object pooling (no per-shot allocations of GPU resources).
import * as THREE from 'three';
import type { Game } from '../../sim/game';
import { smokeRadius, FIRE_DURATION, SMOKE_DURATION } from '../../sim/grenades';
import type { Vec3 } from '../../sim/math';
import { Rng } from '../../sim/rng';
import { decalTexture, smokePuff, softSprite } from './textures';
import { weaponModel } from './weaponmodels';

const MAX_PARTICLES = 900;

class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private next = 0;
  constructor(size: number, additive: boolean) {
    this.pos = new Float32Array(MAX_PARTICLES * 3).fill(-9999);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, map: softSprite('#ffffff', 'p'), blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  emit(p: Vec3, v: Vec3, color: THREE.Color, life: number, gravity = 9): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life; this.gravity[i] = gravity;
  }
  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] *= 0.995 + f * 0.005; this.col[i * 3 + 1] *= 0.99 + f * 0.01; this.col[i * 3 + 2] *= 0.99 + f * 0.01;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

interface Tracer { line: THREE.Line; t: number; from: THREE.Vector3; to: THREE.Vector3 }
interface Flash { sprite: THREE.Sprite; t: number; dur: number; scale: number }
interface LightPulse { light: THREE.PointLight; t: number; dur: number; peak: number }

export class Effects {
  readonly group = new THREE.Group();
  private sparks = new ParticleSystem(0.07, true);
  private dust = new ParticleSystem(0.25, false);
  private blood = new ParticleSystem(0.1, false);
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private decals: THREE.InstancedMesh;
  private decalIdx = 0;
  private flashes: Flash[] = [];
  private flashIdx = 0;
  private lights: LightPulse[] = [];
  private lightIdx = 0;
  private smokes = new Map<number, { g: THREE.Group; puffs: { s: THREE.Sprite; off: THREE.Vector3; spin: number }[]; born: number }>();
  private fires = new Map<number, { g: THREE.Group; flames: { s: THREE.Sprite; off: THREE.Vector3; ph: number }[]; born: number; light: THREE.PointLight }>();
  private projectiles = new Map<number, THREE.Group>();
  private drops = new Map<number, THREE.Group>();
  private bombModel: THREE.Group | null = null;
  private bombGlow: THREE.Sprite;
  private targets = new Map<number, THREE.Group>();
  private rng = new Rng(4242);
  private tmp = new THREE.Matrix4();
  particleScale = 1;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.sparks.points, this.dust.points, this.blood.points);
    const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.tracers.push({ line, t: 1, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    const dm = new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), dm, 220);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite('#ffd27a', 'flash'), color: '#ffcf70', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ sprite: s, t: 1, dur: 0.05, scale: 0.5 });
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb050', 0, 10);
      this.group.add(l);
      this.lights.push({ light: l, t: 1, dur: 0.05, peak: 0 });
    }
    this.bombGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite('#ff2a1a', 'led'), color: '#ff3020', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.bombGlow.scale.set(0.25, 0.25, 1);
  }

  tracer(from: Vec3, to: Vec3): void {
    const tr = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    tr.from.set(from.x, from.y, from.z);
    tr.to.set(to.x, to.y, to.z);
    tr.t = 0;
    tr.line.visible = true;
  }

  muzzle(p: Vec3, scale = 0.45, withLight = true): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.sprite.position.set(p.x, p.y, p.z);
    f.sprite.visible = true;
    f.t = 0; f.dur = 0.05; f.scale = scale;
    f.sprite.material.rotation = this.rng.next() * 6.28;
    if (withLight) this.light(p, 4, 0.06, '#ffb050');
  }

  light(p: Vec3, peak: number, dur: number, color: string): void {
    const L = this.lights[this.lightIdx];
    this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    L.light.position.set(p.x, p.y, p.z);
    L.light.color.set(color);
    L.t = 0; L.dur = dur; L.peak = peak;
    L.light.distance = peak > 10 ? 25 : 10;
  }

  impact(p: Vec3, n: Vec3, kind: string): void {
    // decal oriented to the surface
    if (kind !== 'rail') {
      const i = this.decalIdx;
      this.decalIdx = (this.decalIdx + 1) % 220;
      const pos = new THREE.Vector3(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
      const s = 0.8 + this.rng.next() * 0.5;
      this.tmp.compose(pos, q, new THREE.Vector3(s, s, s));
      this.decals.setMatrixAt(i, this.tmp);
      this.decals.count = Math.max(this.decals.count, i + 1);
      this.decals.instanceMatrix.needsUpdate = true;
    }
    const metal = kind === 'train' || kind === 'barrel' || kind === 'rail';
    const nSp = Math.round((metal ? 10 : 5) * this.particleScale);
    const c = new THREE.Color(metal ? '#ffd080' : '#ffb060');
    for (let k = 0; k < nSp; k++) {
      this.sparks.emit(p, { x: n.x * 3 + this.rng.range(-2.5, 2.5), y: n.y * 3 + this.rng.range(0, 3), z: n.z * 3 + this.rng.range(-2.5, 2.5) }, c, this.rng.range(0.15, 0.35), 12);
    }
    const dc = new THREE.Color(kind === 'crate' || kind === 'wood' || kind === 'tallcrate' ? '#7a5a3a' : '#a89a88');
    for (let k = 0; k < Math.round(4 * this.particleScale); k++) {
      this.dust.emit(p, { x: n.x * 1.2 + this.rng.range(-0.6, 0.6), y: n.y * 1.2 + this.rng.range(0.2, 1.2), z: n.z * 1.2 + this.rng.range(-0.6, 0.6) }, dc, this.rng.range(0.4, 0.9), 2);
    }
  }

  bloodHit(p: Vec3, dir: Vec3, head: boolean): void {
    const c = new THREE.Color(head ? '#9a1010' : '#7a0c0c');
    for (let k = 0; k < Math.round((head ? 16 : 9) * this.particleScale); k++) {
      this.blood.emit(p, { x: dir.x * 2 + this.rng.range(-1.2, 1.2), y: this.rng.range(-0.5, 1.5), z: dir.z * 2 + this.rng.range(-1.2, 1.2) }, c, this.rng.range(0.25, 0.6), 9);
    }
  }

  explosion(p: Vec3, big = false): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.sprite.position.set(p.x, p.y + 0.6, p.z);
    f.sprite.visible = true;
    f.t = 0; f.dur = big ? 0.6 : 0.35; f.scale = big ? 14 : 5;
    this.light({ x: p.x, y: p.y + 1, z: p.z }, big ? 60 : 30, big ? 0.6 : 0.35, '#ffa040');
    const fire = new THREE.Color('#ffa040'), smoke = new THREE.Color('#5a5550');
    for (let k = 0; k < Math.round((big ? 140 : 60) * this.particleScale); k++) {
      const sp = big ? 14 : 8;
      this.sparks.emit({ x: p.x, y: p.y + 0.3, z: p.z }, { x: this.rng.range(-sp, sp), y: this.rng.range(1, sp), z: this.rng.range(-sp, sp) }, fire, this.rng.range(0.3, 0.9), 9);
    }
    for (let k = 0; k < Math.round((big ? 60 : 25) * this.particleScale); k++) {
      this.dust.emit({ x: p.x, y: p.y + 0.5, z: p.z }, { x: this.rng.range(-3, 3), y: this.rng.range(0.5, 4), z: this.rng.range(-3, 3) }, smoke, this.rng.range(1, 2.5), -0.3);
    }
  }

  flashbangBurst(p: Vec3): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.sprite.position.set(p.x, p.y, p.z);
    f.sprite.visible = true;
    f.t = 0; f.dur = 0.25; f.scale = 6;
    this.light(p, 80, 0.25, '#ffffff');
  }

  /** Sync persistent world entities with the simulation. */
  sync(g: Game, dt: number): void {
    const now = g.time;
    // smokes
    const liveSmokes = new Set<number>();
    for (const s of g.smokes) {
      liveSmokes.add(s.id);
      let e = this.smokes.get(s.id);
      if (!e) {
        const grp = new THREE.Group();
        const puffs: { s: THREE.Sprite; off: THREE.Vector3; spin: number }[] = [];
        const mat = new THREE.SpriteMaterial({ map: smokePuff(), color: '#c9c9c4', transparent: true, depthWrite: false, opacity: 0.95, fog: true });
        const count = Math.round(34 * Math.max(0.5, this.particleScale));
        for (let i = 0; i < count; i++) {
          const sp = new THREE.Sprite(mat);
          const u = this.rng.next(), v = this.rng.next();
          const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
          const r = Math.cbrt(this.rng.next()) * 0.85;
          const off = new THREE.Vector3(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r * 0.65, Math.sin(ph) * Math.sin(th) * r);
          sp.material = mat;
          grp.add(sp);
          puffs.push({ s: sp, off, spin: this.rng.range(-0.3, 0.3) });
        }
        grp.position.set(s.pos.x, s.pos.y, s.pos.z);
        this.group.add(grp);
        e = { g: grp, puffs, born: s.born };
        this.smokes.set(s.id, e);
      }
      const R = smokeRadius(s, now);
      const age = now - s.born;
      const op = age > SMOKE_DURATION - 2 ? Math.max(0, (SMOKE_DURATION - age) / 2) : 1;
      for (const p of e.puffs) {
        p.s.position.copy(p.off).multiplyScalar(R);
        p.s.position.y += Math.sin(now * 0.3 + p.spin * 10) * 0.08;
        p.s.scale.setScalar(R * 1.05 + 0.4);
        p.s.material.rotation += p.spin * dt;
      }
      (e.puffs[0].s.material as THREE.SpriteMaterial).opacity = 0.95 * op;
    }
    for (const [id, e] of this.smokes) if (!liveSmokes.has(id)) { this.group.remove(e.g); (e.puffs[0].s.material as THREE.SpriteMaterial).dispose(); this.smokes.delete(id); }

    // fires
    const liveFires = new Set<number>();
    for (const f of g.fires) {
      liveFires.add(f.id);
      let e = this.fires.get(f.id);
      if (!e) {
        const grp = new THREE.Group();
        const flames: { s: THREE.Sprite; off: THREE.Vector3; ph: number }[] = [];
        const mat = new THREE.SpriteMaterial({ map: softSprite('#ff8a20', 'fire'), color: '#ff9a30', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < Math.round(30 * Math.max(0.5, this.particleScale)); i++) {
          const sp = new THREE.Sprite(mat);
          const a = this.rng.next() * Math.PI * 2, r = Math.sqrt(this.rng.next()) * f.radius;
          grp.add(sp);
          flames.push({ s: sp, off: new THREE.Vector3(Math.cos(a) * r, 0.3, Math.sin(a) * r), ph: this.rng.next() * 10 });
        }
        const light = new THREE.PointLight('#ff7a20', 6, 9);
        light.position.y = 0.8;
        grp.add(light);
        grp.position.set(f.pos.x, f.pos.y, f.pos.z);
        this.group.add(grp);
        e = { g: grp, flames, born: f.born, light };
        this.fires.set(f.id, e);
      }
      const age = now - f.born;
      const k = age < 0.4 ? age / 0.4 : age > FIRE_DURATION - 1 ? Math.max(0, FIRE_DURATION - age) : 1;
      for (const fl of e.flames) {
        const fl1 = 0.6 + 0.4 * Math.sin(now * 12 + fl.ph);
        fl.s.position.set(fl.off.x, fl.off.y + fl1 * 0.3, fl.off.z);
        fl.s.scale.set(0.9 * k * fl1, 1.4 * k * fl1, 1);
      }
      e.light.intensity = 5 * k * (0.8 + 0.2 * Math.sin(now * 20));
      if (this.rng.chance(0.3 * this.particleScale)) this.dust.emit({ x: f.pos.x + this.rng.range(-1, 1), y: f.pos.y + 1, z: f.pos.z + this.rng.range(-1, 1) }, { x: 0, y: 1.2, z: 0 }, new THREE.Color('#3a3530'), 1.5, -0.4);
    }
    for (const [id, e] of this.fires) if (!liveFires.has(id)) { this.group.remove(e.g); this.fires.delete(id); }

    // projectiles
    const liveP = new Set<number>();
    for (const p of g.projectiles) {
      liveP.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) { m = weaponModel(p.type); m.scale.setScalar(1.4); this.group.add(m); this.projectiles.set(p.id, m); }
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.rotation.set(p.rot, p.rot * 0.7, 0);
      if (p.type === 'molotov' && this.rng.chance(0.5)) this.sparks.emit(p.pos, { x: 0, y: 0.5, z: 0 }, new THREE.Color('#ff8a20'), 0.2, 0);
    }
    for (const [id, m] of this.projectiles) if (!liveP.has(id)) { this.group.remove(m); this.projectiles.delete(id); }

    // dropped weapons
    const liveD = new Set<number>();
    for (const d of g.drops) {
      liveD.add(d.id);
      let m = this.drops.get(d.id);
      if (!m) { m = weaponModel(d.weapon.def.id); m.scale.setScalar(1.2); m.rotation.set(0, this.rng.next() * 6.28, Math.PI / 2); this.group.add(m); this.drops.set(d.id, m); }
      m.position.set(d.pos.x, d.pos.y + 0.06, d.pos.z);
    }
    for (const [id, m] of this.drops) if (!liveD.has(id)) { this.group.remove(m); this.drops.delete(id); }

    // bomb
    const b = g.bomb;
    const showBomb = b.state === 'dropped' || b.state === 'planted' || b.state === 'defused' || b.state === 'exploded';
    if (showBomb && b.state !== 'exploded') {
      if (!this.bombModel) { this.bombModel = weaponModel('c4'); this.bombModel.scale.setScalar(1.6); this.bombModel.add(this.bombGlow); this.bombGlow.position.set(-0.05, 0.06, 0.03); this.group.add(this.bombModel); }
      this.bombModel.position.set(b.pos.x, b.pos.y + 0.05, b.pos.z);
      const blink = b.state === 'planted' ? (Math.sin(now * (6 + (now - b.plantedAt) * 0.6)) > 0.3) : false;
      this.bombGlow.visible = blink;
    } else if (this.bombModel) { this.group.remove(this.bombModel); this.bombModel = null; }

    // training targets
    const liveT = new Set<number>();
    for (const t of g.targets) {
      liveT.add(t.id);
      let m = this.targets.get(t.id);
      if (!m) { m = dummyModel(t.kind); this.group.add(m); this.targets.set(t.id, m); }
      m.visible = t.alive;
      m.position.set(t.pos.x, t.pos.y, t.pos.z);
      if (t.kind === 'popup') { const k = Math.min(1, (now - t.spawnedAt) / 0.15); m.scale.set(1, k, 1); }
    }
    for (const [id, m] of this.targets) if (!liveT.has(id)) { this.group.remove(m); this.targets.delete(id); }

    this.update(dt);
  }

  private update(dt: number): void {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.blood.update(dt);
    for (const tr of this.tracers) {
      if (tr.t >= 1) continue;
      tr.t += dt / 0.07;
      if (tr.t >= 1) { tr.line.visible = false; continue; }
      const a = tr.from.clone().lerp(tr.to, Math.max(0, tr.t - 0.35));
      const b = tr.from.clone().lerp(tr.to, Math.min(1, tr.t + 0.15));
      const pos = tr.line.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k <= 0) { f.sprite.visible = false; continue; }
      f.sprite.scale.setScalar(f.scale * (0.6 + 0.4 * k));
      f.sprite.material.opacity = k;
    }
    for (const L of this.lights) {
      if (L.t >= L.dur) { L.light.intensity = 0; continue; }
      L.t += dt;
      L.light.intensity = L.peak * Math.max(0, 1 - L.t / L.dur);
    }
  }

  clearRound(): void {
    this.decals.count = 0;
    this.decalIdx = 0;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}

function dummyModel(kind: string): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: kind === 'popup' ? '#c0503a' : kind === 'moving' ? '#c0a03a' : '#a07a4a', roughness: 0.9 });
  const ring = new THREE.MeshStandardMaterial({ color: '#f0f0e8', roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); };
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.72, 10), wood, 0, 0.36, 0);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.26, 10), wood, 0, 0.85, 0);
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 10), wood, 0, 1.23, 0);
  add(new THREE.SphereGeometry(0.14, 12, 10), wood, 0, 1.66, 0);
  add(new THREE.TorusGeometry(0.12, 0.02, 6, 16), ring, 0, 1.25, -0.25);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6), ring, 0, 0.02, 0);
  return g;
}
