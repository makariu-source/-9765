// Authoritative game simulation. Rendering, audio and UI only read from it.
import { Actor, CROUCH_H, HALF_W, STAND_H, newWeapon, type WeaponInst } from './actor';
import {
  DECOY_DURATION, FIRE_DPS, FIRE_DURATION, FIRE_RADIUS, FLASH_RANGE, FUSE, HE_DAMAGE, HE_RADIUS,
  SMOKE_DURATION, SMOKE_RADIUS, fireCells, smokeBlocks, smokeRadius, stepProjectile, throwVelocity,
  type DecoyEmitter, type FireZone, type Projectile, type SmokeCloud,
} from './grenades';
import { getMap } from './maps/maps';
import { siteAt, type CompiledMap } from './maps/mapgrid';
import { DEG, clamp, dirFromAngles, perturbDir, rayCylinderY, raySphere, vdist, vdist2d, vdot, vlen2d, wrapAngle, type Vec3 } from './math';
import type { GameMode } from './modes/mode';
import { NavGrid, getAnalysis, type MapAnalysis } from './nav';
import { Rng, hashString } from './rng';
import { emptyInput, type GameEvent, type HitGroup, type InputCmd, type SoundCue } from './types';
import { GRENADE_LIMIT, GRENADE_TYPES, MAX_GRENADES, WEAPONS, fireInterval, type GrenadeType, type Slot, type Team, type WeaponDef } from './weapons';
import { World, moveBody } from './world';

export const TICK = 1 / 64;
export const GRAVITY = 20.3;
export const JUMP_SPEED = 7.4;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 10;
export const DEFUSE_TIME_KIT = 5;
export const BOMB_TIMER = 40;
export const BOMB_DAMAGE = 500;
export const BOMB_RADIUS = 22;

export interface Controller {
  /** Produce this tick's input for the actor. */
  think(game: Game, actor: Actor, dt: number): InputCmd;
}

export interface DroppedWeapon { id: number; weapon: WeaponInst; pos: Vec3; vel: Vec3; born: number; stillTime: number; bounces: number }

export type BombState = 'none' | 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
export interface Bomb {
  state: BombState;
  carrier: number;
  pos: Vec3;
  site: string;
  plantedAt: number;
  explodeAt: number;
  defuser: number;
  nextBeep: number;
  planter: number;
}

export interface TrainingTarget {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  alive: boolean;
  health: number;
  respawnAt: number;
  kind: 'dummy' | 'moving' | 'popup';
  minX: number; maxX: number;
  axis: 'x' | 'z';
  spawnedAt: number;
  armor: boolean;
}

export interface GameOptions {
  mapId: string;
  seed: number;
  mode: GameMode;
}

export function recoilOffset(def: WeaponDef, n: number): { pitch: number; yaw: number } {
  if (n <= 0.001) return { pitch: 0, yaw: 0 };
  const k = Math.min(n, 8) + Math.max(0, Math.min(n, 16) - 8) * 0.55 + Math.max(0, n - 16) * 0.18;
  const ph = (hashString(def.id) % 628) / 100;
  const yaw = def.recoilSide * Math.pow(n, 0.85) * Math.sin(n * 0.42 + ph) * Math.min(1, n / 4);
  return { pitch: def.recoilUp * k, yaw };
}

export class Game {
  readonly map: CompiledMap;
  readonly world: World;
  readonly nav: NavGrid;
  readonly analysis: MapAnalysis;
  readonly rng: Rng;
  readonly mode: GameMode;
  actors: Actor[] = [];
  controllers = new Map<number, Controller>();
  projectiles: Projectile[] = [];
  smokes: SmokeCloud[] = [];
  fires: FireZone[] = [];
  decoys: DecoyEmitter[] = [];
  drops: DroppedWeapon[] = [];
  targets: TrainingTarget[] = [];
  bomb: Bomb = { state: 'none', carrier: -1, pos: { x: 0, y: 0, z: 0 }, site: '', plantedAt: 0, explodeAt: 0, defuser: -1, nextBeep: 0, planter: -1 };
  events: GameEvent[] = [];
  sounds: SoundCue[] = [];
  time = 0;
  tick = 0;
  humanId = -1;
  startedAt = Date.now();
  private nextId = 1;
  private fireAcc = new Map<number, number>();
  /** called after every tick (replay recorder, stats) */
  onTick: ((g: Game) => void)[] = [];
  /** deaths are resolved at the end of a tick so simultaneous shots trade fairly */
  private pendingKills: { victim: Actor; killer: Actor | null; weapon: string; headshot: boolean; wallbang: boolean; flags: { wallbang: boolean; throughSmoke: boolean } }[] = [];
  /** counted per bullet for wallbang / smoke kill flags */
  private lastBulletFlags = { wallbang: false, throughSmoke: false };

  constructor(opts: GameOptions) {
    this.map = getMap(opts.mapId);
    this.world = new World(this.map);
    this.nav = new NavGrid(this.map);
    this.analysis = getAnalysis(this.nav, this.world);
    this.rng = new Rng(opts.seed);
    this.mode = opts.mode;
    this.mode.attach(this);
  }

  newId(): number { return this.nextId++; }

  addActor(name: string, team: Team, isBot: boolean, model = 0): Actor {
    const a = new Actor(this.actors.length, name, team, isBot, model);
    this.actors.push(a);
    return a;
  }

  actor(id: number): Actor | undefined { return this.actors[id]; }
  human(): Actor | undefined { return this.humanId >= 0 ? this.actors[this.humanId] : undefined; }

  /** synchronous event subscribers (bot director, replay recorder) */
  listeners: ((e: GameEvent) => void)[] = [];
  emit(e: GameEvent): void {
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }

  sound(kind: SoundCue['kind'], pos: Vec3, radius: number, actor: number): void {
    const a = this.actors[actor];
    this.sounds.push({ kind, pos: { ...pos }, radius, actor, team: a ? a.team : null, time: this.time });
  }

  // -------------------------------------------------------------------------
  // Spawning & inventory

  spawn(a: Actor, pos: Vec3, yaw: number): void {
    a.resetForRound();
    a.pos = { x: pos.x, y: pos.y + 0.02, z: pos.z };
    a.yaw = yaw;
    a.pitch = 0;
    a.input = emptyInput(yaw, 0);
    a.grounded = true;
    a.deployEnd = this.time + 0.3;
    this.selectBest(a);
    this.emit({ type: 'spawn', actor: a.id });
  }

  giveWeapon(a: Actor, id: string, autoSelect = true): void {
    const def = WEAPONS[id];
    if (!def) return;
    if (def.slot === 'primary') {
      if (a.primary) this.dropWeapon(a, a.primary);
      a.primary = newWeapon(id);
      if (autoSelect) this.select(a, 'primary', true);
    } else if (def.slot === 'secondary') {
      if (a.secondary) this.dropWeapon(a, a.secondary);
      a.secondary = newWeapon(id);
      if (autoSelect && !a.primary) this.select(a, 'secondary', true);
    } else if (def.slot === 'melee') {
      a.melee = newWeapon(id);
      if (autoSelect) this.select(a, 'melee', true);
    } else if (def.slot === 'grenade') {
      const g = id as GrenadeType;
      if (a.grenades.length < MAX_GRENADES && a.grenades.filter(x => x === g).length < GRENADE_LIMIT[g]) a.grenades.push(g);
    } else if (def.slot === 'bomb') {
      a.hasBomb = true;
    }
  }

  canHoldGrenade(a: Actor, g: GrenadeType): boolean {
    return a.grenades.length < MAX_GRENADES && a.grenades.filter(x => x === g).length < GRENADE_LIMIT[g];
  }

  selectBest(a: Actor): void {
    if (a.primary) this.select(a, 'primary', true);
    else if (a.secondary) this.select(a, 'secondary', true);
    else this.select(a, 'melee', true);
  }

  select(a: Actor, slot: Slot | GrenadeType, force = false): void {
    let target: Slot;
    let gren: GrenadeType | null = null;
    if ((GRENADE_TYPES as string[]).includes(slot)) {
      if (!a.grenades.includes(slot as GrenadeType)) return;
      target = 'grenade'; gren = slot as GrenadeType;
    } else target = slot as Slot;
    if (target === 'primary' && !a.primary) return;
    if (target === 'secondary' && !a.secondary) return;
    if (target === 'bomb' && !a.hasBomb) return;
    if (target === 'grenade') {
      if (!a.grenades.length) return;
      if (!gren) {
        // cycle through distinct grenade types
        const types = [...new Set(a.grenades)];
        const cur = a.active === 'grenade' && a.activeGrenade ? types.indexOf(a.activeGrenade) : -1;
        gren = types[(cur + 1) % types.length];
      }
    }
    if (!force && a.active === target && (target !== 'grenade' || a.activeGrenade === gren)) return;
    if (a.throwStart > 0 && a.throwRelease === 0 && !force) return; // pin pulled
    if (a.active !== target) a.prevSlot = a.active;
    a.active = target;
    a.activeGrenade = gren;
    a.reloadEnd = 0;
    a.scopeLevel = 0;
    a.throwStart = 0; a.throwRelease = 0;
    a.planting = 0;
    a.inspectUntil = 0;
    const def = a.activeDef();
    a.deployEnd = this.time + def.deployTime;
    a.spray = 0;
    this.emit({ type: 'switch', actor: a.id, weapon: def.id });
  }

  dropWeapon(a: Actor, w: WeaponInst): void {
    const dir = dirFromAngles(a.yaw, 0.3);
    const eye = a.eye();
    this.drops.push({
      id: this.newId(), weapon: w, pos: { x: eye.x + dir.x * 0.4, y: eye.y - 0.3, z: eye.z + dir.z * 0.4 },
      vel: { x: dir.x * 3 + a.vel.x, y: 2, z: dir.z * 3 + a.vel.z }, born: this.time, stillTime: 0, bounces: 0,
    });
    if (this.drops.length > 40) this.drops.shift();
  }

  dropActive(a: Actor): void {
    if (a.active === 'primary' && a.primary) { this.dropWeapon(a, a.primary); a.primary = null; this.selectBest(a); }
    else if (a.active === 'secondary' && a.secondary) { this.dropWeapon(a, a.secondary); a.secondary = null; this.selectBest(a); }
    else if (a.active === 'bomb' && a.hasBomb) { this.dropBomb(a); this.selectBest(a); }
  }

  dropBomb(a: Actor): void {
    if (!a.hasBomb) return;
    a.hasBomb = false;
    this.bomb.state = 'dropped';
    this.bomb.carrier = -1;
    this.bomb.pos = { x: a.pos.x, y: this.world.floorAt(a.pos.x, a.pos.z), z: a.pos.z };
    a.planting = 0;
    this.emit({ type: 'bomb_dropped', pos: { ...this.bomb.pos } });
  }

  giveBomb(a: Actor): void {
    a.hasBomb = true;
    this.bomb.state = 'carried';
    this.bomb.carrier = a.id;
  }

  resetRoundEntities(): void {
    this.projectiles = [];
    this.smokes = [];
    this.fires = [];
    this.decoys = [];
    this.drops = [];
    this.nav.extraCost.fill(0);
    this.bomb = { state: 'none', carrier: -1, pos: { x: 0, y: 0, z: 0 }, site: '', plantedAt: 0, explodeAt: 0, defuser: -1, nextBeep: 0, planter: -1 };
  }

  // -------------------------------------------------------------------------
  // Main tick

  step(dt = TICK): void {
    this.time += dt;
    this.tick++;
    // drop old sound cues
    if (this.sounds.length) this.sounds = this.sounds.filter(s => this.time - s.time < 1.5);

    for (const a of this.actors) {
      if (!a.alive) continue;
      const c = this.controllers.get(a.id);
      if (c) {
        const cmd = c.think(this, a, dt);
        if (a.id === this.humanId && (cmd.forward !== a.input.forward || cmd.right !== a.input.right || cmd.fire || Math.abs(cmd.yaw - a.input.yaw) > 1e-4)) a.lastInputChange = this.time;
        a.input = cmd;
      }
    }
    for (const a of this.actors) if (a.alive) this.updateActor(a, dt);
    this.resolveKills();
    this.separateActors();
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.resolveKills();
    this.updateDrops(dt);
    if (this.mode.allowBomb) this.updateBomb(dt);
    this.resolveKills();
    this.updateTargets(dt);
    this.mode.update(dt);
    for (const f of this.onTick) f(this);
    // headless runs never drain; keep the buffer bounded
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 2000);
  }

  private updateActor(a: Actor, dt: number): void {
    const cmd = a.input;
    const canMove = this.mode.canMove(a);
    a.yaw = wrapAngle(cmd.yaw);
    a.pitch = clamp(cmd.pitch, -89 * DEG, 89 * DEG);
    this.updateMovement(a, cmd, dt, canMove);
    this.updateWeapon(a, cmd, dt, canMove);
  }

  private updateMovement(a: Actor, cmd: InputCmd, dt: number, canMove: boolean): void {
    // Crouch with ceiling check when standing up
    const wantCrouch = cmd.crouch;
    const prevH = a.height;
    if (wantCrouch) a.crouchAmt = Math.min(1, a.crouchAmt + dt / 0.18);
    else if (a.crouchAmt > 0) {
      const next = Math.max(0, a.crouchAmt - dt / 0.18);
      const h = STAND_H + (CROUCH_H - STAND_H) * next;
      if (!this.world.overlaps(a.pos.x, a.pos.y + 0.01, a.pos.z, HALF_W - 0.02, h)) a.crouchAmt = next;
    }
    if (!a.grounded) {
      // crouching mid-air tucks legs up (crouch-jump)
      const dh = prevH - a.height;
      if (dh > 0 && !this.world.overlaps(a.pos.x, a.pos.y + dh, a.pos.z, HALF_W, a.height)) a.pos.y += dh;
    }

    const def = a.activeDef();
    const busy = a.planting > 0 || a.defusing > 0;
    let maxSpeed = def.scope && a.scopeLevel > 0 && def.scopedSpeed ? def.scopedSpeed : def.speed;
    if (a.crouchAmt > 0.5) maxSpeed *= 0.34;
    else if (cmd.walk) maxSpeed *= 0.52;

    let fx = 0, fz = 0;
    if (canMove && !busy) {
      const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      fx = -sy * cmd.forward + cy * cmd.right;
      fz = -cy * cmd.forward - sy * cmd.right;
      const l = Math.hypot(fx, fz);
      if (l > 1) { fx /= l; fz /= l; }
    }
    const wishLen = Math.hypot(fx, fz);
    const wdx = wishLen > 0 ? fx / wishLen : 0, wdz = wishLen > 0 ? fz / wishLen : 0;
    const wishSpeed = maxSpeed * Math.min(1, wishLen);
    const accelerate = (ws: number, accel: number, cap: number) => {
      const cur = a.vel.x * wdx + a.vel.z * wdz;
      const add = Math.min(ws, cap) - cur;
      if (add <= 0) return;
      const as = Math.min(accel * dt * ws, add);
      a.vel.x += wdx * as; a.vel.z += wdz * as;
    };

    if (a.grounded) {
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp > 0) {
        const control = Math.max(sp, 2.0);
        const ns = Math.max(0, sp - control * 5.2 * dt);
        a.vel.x *= ns / sp; a.vel.z *= ns / sp;
      }
      if (wishLen > 0) accelerate(wishSpeed, 5.5, wishSpeed);
      // clamp to max (e.g. after switching to heavier weapon)
      const sp2 = Math.hypot(a.vel.x, a.vel.z);
      if (sp2 > maxSpeed * 1.02) { a.vel.x *= maxSpeed / sp2; a.vel.z *= maxSpeed / sp2; }
      if (cmd.jump && !a.jumpHeld && canMove && !busy && !this.world.overlaps(a.pos.x, a.pos.y + 0.3, a.pos.z, HALF_W - 0.02, a.height)) {
        a.vel.y = JUMP_SPEED;
        a.grounded = false;
        this.emit({ type: 'jump', actor: a.id });
      } else {
        a.vel.y = -2;
      }
    } else {
      if (wishLen > 0) accelerate(wishSpeed, 12, 0.76);
      a.vel.y -= GRAVITY * dt;
      a.airTime += dt;
    }
    a.jumpHeld = cmd.jump;

    const wasGrounded = a.grounded;
    const fallSpeed = -a.vel.y;
    const body = { pos: a.pos, vel: a.vel, half: HALF_W, height: a.height, grounded: a.grounded };
    moveBody(this.world, body, dt);
    a.grounded = body.grounded || (a.vel.y <= 0 && this.groundProbe(a));
    if (a.grounded && a.vel.y < 0) a.vel.y = 0;
    if (!wasGrounded && a.grounded) {
      this.emit({ type: 'land', actor: a.id, speed: fallSpeed });
      if (fallSpeed > 4) this.sound('land', a.pos, 12, a.id);
      if (fallSpeed > 13.5) {
        const dmg = Math.round((fallSpeed - 13.5) * 11);
        this.applyDamage(a, null, dmg, 'legs', 'fall', { ignoreArmor: true });
      }
      a.airTime = 0;
    }
    // Footsteps
    const sp = vlen2d(a.vel);
    if (a.grounded && sp > def.speed * 0.6 && a.crouchAmt < 0.5 && !cmd.walk) {
      a.stepAccum += sp * dt;
      if (a.stepAccum > 1.9) {
        a.stepAccum = 0;
        this.emit({ type: 'footstep', actor: a.id, pos: { ...a.pos }, loud: true });
        this.sound('step', a.pos, 15, a.id);
      }
    } else if (a.grounded && sp > 0.5) {
      a.stepAccum += sp * dt;
      if (a.stepAccum > 1.9) { a.stepAccum = 0; this.emit({ type: 'footstep', actor: a.id, pos: { ...a.pos }, loud: false }); }
    }
    // Fell out of the world (safety)
    if (a.pos.y < -20) this.applyDamage(a, null, 1000, 'chest', 'world', { ignoreArmor: true });
  }

  private groundProbe(a: Actor): boolean {
    return this.world.overlaps(a.pos.x, a.pos.y - 0.05, a.pos.z, HALF_W - 0.01, 0.04) !== null;
  }

  private separateActors(): void {
    const as = this.actors;
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < as.length; j++) {
        const b = as[j];
        if (!b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = HALF_W * 2 * 0.9;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          this.tryShift(a, -nx * push, -nz * push);
          this.tryShift(b, nx * push, nz * push);
        } else if (d <= 1e-4) {
          this.tryShift(b, 0.05, 0.05);
        }
      }
    }
  }

  private tryShift(a: Actor, dx: number, dz: number): void {
    if (!this.world.overlaps(a.pos.x + dx, a.pos.y + 0.01, a.pos.z + dz, HALF_W, a.height)) { a.pos.x += dx; a.pos.z += dz; }
  }

  // -------------------------------------------------------------------------
  // Weapons

  spreadFor(a: Actor, def: WeaponDef): number {
    const scoped = !!def.scope && a.scopeLevel > 0;
    let base = scoped ? def.scopedSpread ?? def.spreadStand : def.spreadStand + (def.spreadCrouch - def.spreadStand) * a.crouchAmt;
    const sp = vlen2d(a.vel);
    const maxS = def.speed;
    const moveFrac = clamp((sp - maxS * 0.34) / (maxS * 0.66), 0, 1);
    base += def.spreadMove * moveFrac;
    if (!a.grounded) base += def.spreadJump;
    return base + a.spreadAccum;
  }

  private updateWeapon(a: Actor, cmd: InputCmd, dt: number, canMove: boolean): void {
    const now = this.time;
    if (cmd.select) this.select(a, cmd.select);
    if (cmd.lastWeapon) this.select(a, a.prevSlot);
    if (cmd.drop && canMove) this.dropActive(a);

    const w = a.activeWeapon();
    const def = a.activeDef();
    // decay spread and spray
    a.spreadAccum *= Math.exp(-dt / Math.max(0.05, def.spreadRecover));
    if (now - a.lastShot > fireInterval(def) * 1.3) a.spray = Math.max(0, a.spray - dt * Math.max(a.spray, 4) / Math.max(0.1, def.recoilReset));

    // reload progress
    if (a.reloadEnd > 0 && now >= a.reloadEnd && w) {
      if (def.cls === 'shotgun') {
        if (w.clip < def.mag && w.reserve > 0) { w.clip++; w.reserve--; }
        a.reloadEnd = w.clip < def.mag && w.reserve > 0 ? now + 0.5 : 0;
      } else {
        const need = def.mag - w.clip;
        const take = def.infiniteAmmo ? need : Math.min(need, w.reserve);
        w.clip += take;
        if (!def.infiniteAmmo) w.reserve -= take;
        a.reloadEnd = 0;
      }
    }
    if (a.rezoomAt > 0 && now >= a.rezoomAt) { a.scopeLevel = Math.max(1, a.fireAccum); a.rezoomAt = 0; }

    // grenade release
    if (a.throwRelease > 0 && now >= a.throwRelease) {
      this.releaseGrenade(a);
    }

    if (!canMove && !this.mode.canBuy(a)) { a.triggerHeld = cmd.fire; a.fire2Held = cmd.fire2; return; }
    const deployed = now >= a.deployEnd;

    if (cmd.inspect && deployed && a.reloadEnd === 0 && now > a.inspectUntil) {
      a.inspectUntil = now + 2.2;
      this.emit({ type: 'inspect', actor: a.id });
    }

    if (cmd.reload && w && def.mag > 0 && w.clip < def.mag && (w.reserve > 0 || def.infiniteAmmo) && a.reloadEnd === 0 && deployed) {
      this.startReload(a, w);
    }

    if (!canMove) { a.triggerHeld = cmd.fire; a.fire2Held = cmd.fire2; return; }

    switch (def.cls) {
      case 'grenade': {
        if (deployed && a.throwStart === 0 && (cmd.fire || cmd.fire2)) {
          a.throwStart = now;
          a.throwStrong = cmd.fire;
        }
        if (a.throwStart > 0 && a.throwRelease === 0 && !cmd.fire && !cmd.fire2 && now - a.throwStart > 0.2) {
          a.throwRelease = now + 0.1;
          this.emit({ type: 'throw', actor: a.id, grenade: a.activeGrenade!, id: -1 });
        }
        break;
      }
      case 'bomb':
        break; // planting handled in updateBomb
      case 'knife': {
        if (deployed && now >= a.nextFire && (cmd.fire || cmd.fire2)) this.knifeAttack(a, def, cmd.fire2 && !cmd.fire);
        break;
      }
      default: {
        if (cmd.fire2 && !a.fire2Held && def.scope && deployed && a.reloadEnd === 0) {
          a.scopeLevel = (a.scopeLevel + 1) % def.scope.length;
          a.rezoomAt = 0;
        }
        if (cmd.fire && w && (def.auto || !a.triggerHeld)) this.tryFire(a, w);
      }
    }
    a.triggerHeld = cmd.fire;
    a.fire2Held = cmd.fire2;
  }

  startReload(a: Actor, w: WeaponInst): void {
    const def = w.def;
    a.reloadEnd = this.time + (def.cls === 'shotgun' ? 0.55 : def.reloadTime);
    a.scopeLevel = 0;
    a.rezoomAt = 0;
    a.inspectUntil = 0;
    this.emit({ type: 'reload', actor: a.id, weapon: def.id });
    this.sound('reload', a.pos, 7, a.id);
  }

  private tryFire(a: Actor, w: WeaponInst): void {
    const now = this.time;
    const def = w.def;
    if (now < a.deployEnd || now < a.nextFire) return;
    if (a.reloadEnd > 0) {
      if (def.cls === 'shotgun' && w.clip > 0) a.reloadEnd = 0; // interrupt shell reload
      else return;
    }
    if (w.clip <= 0) {
      if (!a.triggerHeld) this.emit({ type: 'dryfire', actor: a.id });
      if (w.reserve > 0 || def.infiniteAmmo) this.startReload(a, w);
      a.nextFire = now + 0.25;
      return;
    }
    a.spawnProtectUntil = 0;
    a.firedScoped = !!def.scope && a.scopeLevel > 0;
    const spread = this.spreadFor(a, def);
    const rec = recoilOffset(def, a.spray);
    const baseDir = dirFromAngles(a.yaw + rec.yaw, clamp(a.pitch + rec.pitch, -1.55, 1.55));
    const pellets = def.pellets ?? 1;
    const eye = a.eye();
    let anyHit = false;
    let firstEnd: Vec3 | null = null;
    for (let p = 0; p < pellets; p++) {
      const r = spread * Math.sqrt(this.rng.next());
      const th = this.rng.next() * Math.PI * 2;
      const dir = perturbDir(baseDir, Math.cos(th) * r, Math.sin(th) * r);
      const res = this.fireBullet(a, eye, dir, def);
      anyHit = anyHit || res.hit;
      if (!firstEnd) firstEnd = res.end;
      if (p === 0 || p === pellets - 1) this.emit({ type: 'shot', actor: a.id, weapon: def.id, origin: eye, dir, end: res.end });
    }
    a.stats.shotsFired++;
    if (anyHit) a.stats.shotsHit++;
    w.clip--;
    a.spray += 1;
    a.spreadAccum += def.spreadFire;
    a.lastShot = now;
    a.nextFire = now + fireInterval(def);
    a.inspectUntil = 0;
    if (def.cls === 'sniper' && a.scopeLevel > 0) {
      const lvl = a.scopeLevel;
      a.scopeLevel = 0;
      if (w.clip > 0) a.rezoomAt = now + fireInterval(def) * 0.9;
      a.fireAccum = lvl;
    }
    this.sound('shot', eye, def.cls === 'pistol' ? 38 : 50, a.id);
    if (w.clip === 0 && (w.reserve > 0 || def.infiniteAmmo)) {
      // auto reload after the last bullet like most shooters
      a.nextFire = Math.max(a.nextFire, now + 0.1);
    }
  }

  /** Trace a bullet with penetration; applies damage. */
  fireBullet(shooter: Actor | null, origin: Vec3, dir: Vec3, def: WeaponDef, dmgScale = 1): { hit: boolean; end: Vec3 } {
    const range = def.range;
    const spans = this.world.raySpans(origin, dir, range);
    // actor hit candidates
    type AH = { t: number; target: Actor | TrainingTarget; group: HitGroup; isTarget: boolean };
    const ahits: AH[] = [];
    for (const v of this.actors) {
      if (!v.alive || v === shooter) continue;
      const h = this.traceHitboxes(v.hitboxes(), origin, dir, range);
      if (h) ahits.push({ t: h.t, target: v, group: h.group, isTarget: false });
    }
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const h = this.traceHitboxes(targetHitboxes(tg), origin, dir, range);
      if (h) ahits.push({ t: h.t, target: tg, group: h.group, isTarget: true });
    }
    ahits.sort((x, y) => x.t - y.t);
    let power = def.penetration;
    let dmgFactor = 1;
    let wallbang = false;
    let si = 0;
    let end: Vec3 = { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range };
    let hitSomething = false;
    const at = (t: number): Vec3 => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
    let ai = 0;
    for (;;) {
      const nextWall = si < spans.length ? spans[si] : null;
      const nextActor = ai < ahits.length ? ahits[ai] : null;
      if (nextActor && (!nextWall || nextActor.t < nextWall.tIn)) {
        const dist = nextActor.t;
        const dmg = def.damage * Math.pow(def.rangeMod, dist / 10) * dmgFactor * dmgScale;
        const pos = at(dist);
        if (nextActor.isTarget) {
          this.damageTarget(nextActor.target as TrainingTarget, shooter, dmg, nextActor.group, def, dist);
        } else {
          const victim = nextActor.target as Actor;
          this.lastBulletFlags = { wallbang, throughSmoke: shooter ? smokeBlocks(this.smokes, this.time, origin, pos) : false };
          this.applyDamage(victim, shooter, dmg, nextActor.group, def.id, { armorPen: def.armorPen, headMult: def.headMult, wallbang });
          this.emit({ type: 'hit', attacker: shooter?.id ?? -1, victim: victim.id, damage: Math.round(dmg), group: nextActor.group, pos, armorHit: victim.armor > 0 });
        }
        hitSomething = true;
        end = pos;
        // bullets lose a lot of energy through bodies; stop unless sniper
        if (def.cls !== 'sniper') break;
        dmgFactor *= 0.6;
        ai++;
        continue;
      }
      if (!nextWall) break;
      const thick = Math.max(0.02, nextWall.tOut - nextWall.tIn);
      const cost = thick * nextWall.box.resist;
      const entry = at(nextWall.tIn);
      this.emit({ type: 'impact', pos: entry, normal: { x: nextWall.nx, y: nextWall.ny, z: nextWall.nz }, kind: nextWall.box.kind });
      if (cost <= power && isFinite(cost)) {
        power -= cost;
        dmgFactor *= Math.max(0.15, 0.85 * (1 - cost / (def.penetration * 1.6)));
        wallbang = true;
        const exit = at(nextWall.tOut);
        this.emit({ type: 'impact', pos: exit, normal: { x: -nextWall.nx, y: -nextWall.ny, z: -nextWall.nz }, kind: nextWall.box.kind });
        // skip any spans that start inside this one
        si++;
        while (si < spans.length && spans[si].tIn < nextWall.tOut) si++;
        continue;
      }
      end = entry;
      break;
    }
    return { hit: hitSomething, end };
  }

  traceHitboxes(boxes: ReturnType<Actor['hitboxes']>, o: Vec3, d: Vec3, range: number): { t: number; group: HitGroup } | null {
    let best: { t: number; group: HitGroup } | null = null;
    for (const hb of boxes) {
      const t = hb.kind === 'sphere'
        ? raySphere(o, d, { x: hb.cx, y: hb.cy, z: hb.cz }, hb.r)
        : rayCylinderY(o, d, hb.cx, hb.cz, hb.r, hb.y0, hb.y1);
      if (t >= 0 && t <= range && (!best || t < best.t)) best = { t, group: hb.group };
    }
    return best;
  }

  private knifeAttack(a: Actor, def: WeaponDef, heavy: boolean): void {
    a.nextFire = this.time + (heavy ? 1.0 : 0.4);
    a.spawnProtectUntil = 0;
    const eye = a.eye();
    let best: { t: number; v: Actor; group: HitGroup } | null = null;
    // small cone of rays for forgiving melee
    for (const [dy, dp] of [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.1], [0, -0.12]]) {
      const dir = dirFromAngles(a.yaw + dy, a.pitch + dp);
      for (const v of this.actors) {
        if (!v.alive || v === a) continue;
        const h = this.traceHitboxes(v.hitboxes(), eye, dir, def.range);
        if (h && (!best || h.t < best.t)) {
          const wallHit = this.world.raycast(eye, dir, h.t, { bullets: true });
          if (!wallHit) best = { t: h.t, v, group: h.group };
        }
      }
      for (const tg of this.targets) {
        if (!tg.alive) continue;
        const h = this.traceHitboxes(targetHitboxes(tg), eye, dir, def.range);
        if (h) { this.damageTarget(tg, a, heavy ? def.heavyDamage ?? def.damage : def.damage, 'chest', def, h.t); return; }
      }
    }
    this.emit({ type: 'shot', actor: a.id, weapon: def.id, origin: eye, dir: a.viewDir(), end: eye });
    if (!best) {
      const hit = this.world.raycast(eye, a.viewDir(), def.range, { bullets: true });
      if (hit) this.emit({ type: 'impact', pos: { x: eye.x + a.viewDir().x * hit.t, y: eye.y + a.viewDir().y * hit.t, z: eye.z + a.viewDir().z * hit.t }, normal: { x: hit.nx, y: hit.ny, z: hit.nz }, kind: 'knife' });
      return;
    }
    // backstab: attacker behind victim
    const toA = { x: a.pos.x - best.v.pos.x, y: 0, z: a.pos.z - best.v.pos.z };
    const vf = dirFromAngles(best.v.yaw, 0);
    const behind = vdot({ x: toA.x, y: 0, z: toA.z }, { x: vf.x, y: 0, z: vf.z }) < -0.3 * Math.hypot(toA.x, toA.z);
    let dmg = heavy ? def.heavyDamage ?? def.damage : def.damage;
    if (behind) dmg = heavy ? 180 : 90;
    this.applyDamage(best.v, a, dmg, best.group === 'head' ? 'chest' : best.group, def.id, { armorPen: def.armorPen, headMult: 1 });
    this.emit({ type: 'hit', attacker: a.id, victim: best.v.id, damage: dmg, group: best.group, pos: best.v.eye(), armorHit: best.v.armor > 0 });
    a.stats.shotsHit++;
  }

  applyDamage(
    victim: Actor, attacker: Actor | null, raw: number, group: HitGroup, weapon: string,
    opts: { armorPen?: number; headMult?: number; ignoreArmor?: boolean; wallbang?: boolean; grenade?: boolean } = {},
  ): void {
    if (!victim.alive || victim.health <= 0) return;
    if (victim.spawnProtectUntil > this.time && attacker && attacker !== victim) return;
    const sameTeam = !!attacker && attacker !== victim && !this.mode.ffa && attacker.team === victim.team;
    if (sameTeam) {
      const scale = opts.grenade ? Math.min(1, this.mode.ffScale * 1.5) : this.mode.ffScale;
      if (scale <= 0) return;
      raw *= scale;
    }
    const mult = group === 'head' ? opts.headMult ?? 4 : group === 'stomach' ? 1.25 : group === 'legs' ? 0.75 : 1;
    let dmg = raw * mult;
    const armored = !opts.ignoreArmor && victim.armor > 0 && group !== 'legs' && (group !== 'head' || victim.helmet);
    if (armored) {
      const pen = opts.armorPen ?? 0.5;
      let health = dmg * pen;
      let armorDmg = (dmg - health) * 0.5;
      if (armorDmg > victim.armor) {
        health += (armorDmg - victim.armor) * 2;
        armorDmg = victim.armor;
      }
      victim.armor = Math.max(0, Math.round(victim.armor - armorDmg));
      dmg = health;
    }
    dmg = Math.max(1, Math.round(dmg));
    const dealt = Math.min(dmg, victim.health);
    victim.health -= dmg;
    if (attacker && attacker !== victim) {
      if (sameTeam) attacker.stats.teamDamage += dealt;
      else {
        attacker.stats.damage += dealt;
        attacker.roundDamage += dealt;
        if (opts.grenade) attacker.stats.utilityDamage += dealt;
      }
      victim.damageTakenFrom.set(attacker.id, (victim.damageTakenFrom.get(attacker.id) ?? 0) + dealt);
    }
    // being shot slows you down (tagging)
    if (attacker && !opts.grenade) { victim.vel.x *= 0.45; victim.vel.z *= 0.45; }
    this.sound('hurt', victim.pos, 10, victim.id);
    if (victim.health <= 0) {
      victim.health = 0;
      if (!this.pendingKills.some(p => p.victim === victim)) {
        this.pendingKills.push({ victim, killer: attacker, weapon, headshot: group === 'head' && !opts.grenade, wallbang: !!opts.wallbang, flags: { ...this.lastBulletFlags } });
      }
    }
  }

  private resolveKills(): void {
    if (!this.pendingKills.length) return;
    const list = this.pendingKills;
    this.pendingKills = [];
    for (const k of list) {
      if (!k.victim.alive) continue;
      this.lastBulletFlags = k.flags;
      this.kill(k.victim, k.killer, k.weapon, k.headshot, k.wallbang);
    }
  }

  kill(victim: Actor, killer: Actor | null, weapon: string, headshot: boolean, wallbang: boolean): void {
    victim.alive = false;
    victim.deathTime = this.time;
    victim.deathYaw = victim.yaw;
    victim.killedBy = killer?.id ?? -1;
    victim.stats.deaths++;
    victim.planting = 0;
    victim.defusing = 0;
    let assister = -1, flashAssist = false;
    const sameTeam = !!killer && killer !== victim && !this.mode.ffa && killer.team === victim.team;
    if (killer && killer !== victim) {
      if (sameTeam) {
        killer.stats.teamKills++;
        killer.stats.kills = Math.max(0, killer.stats.kills - 1);
      } else {
        killer.stats.kills++;
        killer.roundKills++;
        if (headshot) killer.stats.headshots++;
        killer.stats.weaponKills[weapon] = (killer.stats.weaponKills[weapon] ?? 0) + 1;
      }
    }
    for (const [aid, dmg] of victim.damageTakenFrom) {
      if (killer && aid === killer.id) continue;
      const ass = this.actors[aid];
      if (!ass || (!this.mode.ffa && ass.team === victim.team)) continue;
      if (dmg >= 41) { assister = aid; break; }
    }
    if (assister < 0 && victim.flashEnd > this.time && victim.flashedBy >= 0 && victim.flashedBy !== killer?.id) {
      const f = this.actors[victim.flashedBy];
      if (f && (this.mode.ffa || f.team !== victim.team)) { assister = f.id; flashAssist = true; }
    }
    if (assister >= 0) this.actors[assister].stats.assists++;
    // drop loot
    if (victim.primary) this.dropWeapon(victim, victim.primary);
    else if (victim.secondary) this.dropWeapon(victim, victim.secondary);
    victim.primary = null;
    victim.secondary = null;
    victim.grenades = [];
    if (victim.hasBomb) this.dropBomb(victim);
    const noscope = !!killer && WEAPONS[weapon]?.cls === 'sniper' && !killer.firedScoped;
    this.emit({
      type: 'kill', killer: killer?.id ?? -1, victim: victim.id, weapon, headshot, wallbang, assister, flashAssist,
      noscope, throughSmoke: this.lastBulletFlags.throughSmoke,
    });
    this.lastBulletFlags = { wallbang: false, throughSmoke: false };
    this.mode.onKill(killer, victim, weapon, headshot);
  }

  // -------------------------------------------------------------------------
  // Grenades

  private releaseGrenade(a: Actor): void {
    const g = a.activeGrenade;
    a.throwRelease = 0;
    a.throwStart = 0;
    if (!g) return;
    const idx = a.grenades.indexOf(g);
    if (idx < 0) return;
    a.grenades.splice(idx, 1);
    const tv = throwVelocity(a, a.throwStrong);
    const id = this.newId();
    this.projectiles.push({ id, type: g, owner: a.id, team: a.team, pos: tv.pos, vel: tv.vel, born: this.time, stillTime: 0, bounces: 0, done: false, rot: 0 });
    this.emit({ type: 'throw', actor: a.id, grenade: g, id });
    this.sound('grenade', a.pos, 10, a.id);
    // switch back
    if (a.grenades.includes(g)) { a.deployEnd = this.time + 0.5; }
    else if (a.prevSlot !== 'grenade') this.select(a, a.prevSlot, true);
    else this.selectBest(a);
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.done) continue;
      let landedOnGround = false;
      stepProjectile(this, p, dt, (pos, n, speed) => {
        if (speed > 1.5) {
          this.emit({ type: 'bounce', id: p.id, pos: { ...pos } });
          this.sound('grenade', pos, 12, p.owner);
        }
        if (n.y > 0.7) landedOnGround = true;
      });
      p.rot += dt * 10;
      const age = this.time - p.born;
      let det = false;
      switch (p.type) {
        case 'he': case 'flash': det = age >= FUSE[p.type]; break;
        case 'smoke': case 'decoy': det = age >= FUSE[p.type] && p.stillTime > 0.1; break;
        case 'molotov': det = landedOnGround || age >= FUSE.molotov; break;
      }
      if (age > 12) det = true;
      if (det) { p.done = true; this.detonate(p); }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);
  }

  private detonate(p: Projectile): void {
    const owner = this.actors[p.owner];
    this.emit({ type: 'detonate', id: p.id, grenade: p.type, pos: { ...p.pos }, owner: p.owner });
    switch (p.type) {
      case 'he': {
        this.sound('shot', p.pos, 60, p.owner);
        const center = { x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z };
        const sigma = HE_RADIUS / 3;
        for (const v of this.actors) {
          if (!v.alive) continue;
          const pts = [v.visPoints()[1], v.visPoints()[0]];
          const d = vdist(center, pts[0]);
          if (d > HE_RADIUS) continue;
          if (!pts.some(pt => this.world.lineClear(center, pt))) continue;
          const dmg = HE_DAMAGE * Math.exp(-(d * d) / (2 * sigma * sigma));
          if (dmg < 1) continue;
          this.applyDamage(v, owner ?? null, dmg, 'chest', 'he', { armorPen: 0.57, grenade: true });
        }
        for (const t of this.targets) if (t.alive && vdist(center, t.pos) < HE_RADIUS * 0.6) this.damageTarget(t, owner ?? null, 40, 'chest', WEAPONS.he, vdist(center, t.pos));
        break;
      }
      case 'flash': {
        this.sound('shot', p.pos, 40, p.owner);
        for (const v of this.actors) {
          if (!v.alive) continue;
          const eye = v.eye();
          const d = vdist(eye, p.pos);
          if (d > FLASH_RANGE) continue;
          if (!this.world.lineClear(p.pos, eye)) continue;
          if (smokeBlocks(this.smokes, this.time, p.pos, eye)) continue;
          const to = { x: (p.pos.x - eye.x) / d, y: (p.pos.y - eye.y) / d, z: (p.pos.z - eye.z) / d };
          const dot = vdot(v.viewDir(), to);
          const angleF = dot > 0.6 ? 1 : dot > 0 ? 0.35 + dot : dot > -0.5 ? 0.25 : 0.1;
          const distF = 1 - Math.pow(d / FLASH_RANGE, 2) * 0.85;
          const strength = clamp(angleF * distF, 0, 1);
          const duration = 4.9 * strength;
          if (duration < 0.25) continue;
          if (this.time + duration > v.flashEnd) {
            v.flashEnd = this.time + duration;
            v.flashStrength = strength;
            v.flashedBy = p.owner;
          }
          this.emit({ type: 'flashed', actor: v.id, strength, duration, by: p.owner });
          if (owner && v.team !== owner.team && duration > 1.2) owner.stats.enemiesFlashed++;
        }
        break;
      }
      case 'smoke': {
        const pos = { x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z };
        this.smokes.push({ id: p.id, pos, born: this.time, radius: SMOKE_RADIUS, owner: p.owner });
        // extinguish fires
        this.fires = this.fires.filter(f => vdist2d(f.pos, pos) > SMOKE_RADIUS + f.radius * 0.5);
        this.sound('grenade', p.pos, 20, p.owner);
        break;
      }
      case 'molotov': {
        const down = this.world.raycast(p.pos, { x: 0, y: -1, z: 0 }, 3);
        if (!down) break; // burst in the air
        const pos = { x: p.pos.x, y: p.pos.y - down.t, z: p.pos.z };
        if (this.smokes.some(s => vdist2d(s.pos, pos) < smokeRadius(s, this.time) + 0.5)) break; // fizzles in smoke
        this.fires.push({ id: p.id, pos, born: this.time, radius: FIRE_RADIUS, owner: p.owner, team: p.team, cells: fireCells(this, pos, FIRE_RADIUS) });
        this.sound('grenade', pos, 25, p.owner);
        break;
      }
      case 'decoy': {
        const ow = this.actors[p.owner];
        const wid = ow?.primary?.def.id ?? ow?.secondary?.def.id ?? 'g9';
        this.decoys.push({ id: p.id, pos: { ...p.pos }, born: this.time, next: this.time + 0.3, weapon: wid, owner: p.owner });
        break;
      }
    }
  }

  private updateEffects(dt: number): void {
    const now = this.time;
    this.smokes = this.smokes.filter(s => now - s.born < SMOKE_DURATION);
    // fires
    this.nav.extraCost.fill(0);
    this.fires = this.fires.filter(f => now - f.born < FIRE_DURATION);
    for (const f of this.fires) {
      for (const c of f.cells) this.nav.extraCost[c] = 60;
      for (const v of this.actors) {
        if (!v.alive) continue;
        if (vdist2d(v.pos, f.pos) > f.radius || Math.abs(v.pos.y - f.pos.y) > 1.2) continue;
        const acc = (this.fireAcc.get(v.id) ?? 0) + FIRE_DPS * dt;
        if (acc >= 8) {
          this.fireAcc.set(v.id, acc - 8);
          this.applyDamage(v, this.actors[f.owner] ?? null, 8, 'chest', 'molotov', { ignoreArmor: true, grenade: true });
          this.emit({ type: 'fire_damage', actor: v.id });
        } else this.fireAcc.set(v.id, acc);
      }
    }
    // decoys
    for (const d of this.decoys) {
      if (now >= d.next && now - d.born < DECOY_DURATION) {
        this.emit({ type: 'decoy_shot', pos: { ...d.pos }, weapon: d.weapon });
        // indistinguishable from gunfire for listeners
        this.sounds.push({ kind: 'shot', pos: { x: d.pos.x, y: d.pos.y + 1.4, z: d.pos.z }, radius: 45, actor: d.owner, team: this.actors[d.owner]?.team ?? null, time: now });
        d.next = now + (this.rng.chance(0.3) ? this.rng.range(0.9, 2.2) : fireInterval(WEAPONS[d.weapon]) * this.rng.range(1, 1.6));
      }
    }
    const ended = this.decoys.filter(d => now - d.born >= DECOY_DURATION);
    for (const d of ended) {
      this.emit({ type: 'detonate', id: d.id, grenade: 'he', pos: d.pos, owner: d.owner });
      for (const v of this.actors) if (v.alive && vdist(v.pos, d.pos) < 1.5) this.applyDamage(v, this.actors[d.owner] ?? null, 5, 'chest', 'decoy', { grenade: true });
    }
    this.decoys = this.decoys.filter(d => now - d.born < DECOY_DURATION);
  }

  private updateDrops(dt: number): void {
    for (const d of this.drops) {
      if (d.stillTime < 0.5) stepProjectile(this, d, dt);
    }
    // pickups
    for (const a of this.actors) {
      if (!a.alive) continue;
      const usePressed = a.input.use && !a.useHeld;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        if (this.time - d.born < 0.6) continue;
        const dist = vdist2d(a.pos, d.pos);
        if (dist > 1.6 || Math.abs(a.pos.y - d.pos.y) > 1.6) continue;
        const slot = d.weapon.def.slot;
        if (this.mode.id === 'armsrace') continue;
        const empty = (slot === 'primary' && !a.primary) || (slot === 'secondary' && !a.secondary);
        if ((empty && dist < 1.0) || (usePressed && this.isLookingAt(a, d.pos, 30))) {
          if (slot === 'primary') { if (a.primary) this.dropWeapon(a, a.primary); a.primary = d.weapon; this.select(a, 'primary', true); }
          else if (slot === 'secondary') { if (a.secondary) this.dropWeapon(a, a.secondary); a.secondary = d.weapon; if (!a.primary || usePressed) this.select(a, 'secondary', true); }
          this.drops.splice(i, 1);
          this.emit({ type: 'pickup', actor: a.id, weapon: d.weapon.def.id });
          break;
        }
      }
      a.useHeld = a.input.use;
    }
  }

  isLookingAt(a: Actor, p: Vec3, maxDeg: number): boolean {
    const eye = a.eye();
    const d = vdist(eye, p) || 1;
    const to = { x: (p.x - eye.x) / d, y: (p.y - eye.y) / d, z: (p.z - eye.z) / d };
    return vdot(a.viewDir(), to) > Math.cos(maxDeg * DEG);
  }

  // -------------------------------------------------------------------------
  // Bomb

  private updateBomb(dt: number): void {
    const b = this.bomb;
    const now = this.time;
    if (b.state === 'carried') {
      const c = this.actors[b.carrier];
      if (!c || !c.alive || !c.hasBomb) return;
      let site = siteAt(this.map, c.pos.x, c.pos.z);
      if (site && this.mode.allowedSites && !this.mode.allowedSites.includes(site)) site = null;
      const wants = c.active === 'bomb' && (c.input.fire || c.input.use) && this.mode.canMove(c);
      if (wants && site && c.grounded) {
        if (c.planting === 0) { this.emit({ type: 'plant_start', actor: c.id }); this.sound('plant', c.pos, 14, c.id); }
        c.planting += dt;
        c.vel.x = 0; c.vel.z = 0;
        if (c.planting >= PLANT_TIME) {
          c.planting = 0;
          c.hasBomb = false;
          b.state = 'planted';
          b.carrier = -1;
          b.planter = c.id;
          b.pos = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
          b.site = site;
          b.plantedAt = now;
          b.explodeAt = now + BOMB_TIMER;
          b.nextBeep = now + 1;
          c.stats.plants++;
          this.emit({ type: 'planted', actor: c.id, site, pos: { ...b.pos } });
          this.sound('bomb', b.pos, 30, c.id);
          this.selectBest(c);
          this.mode.onPlant?.(c, site);
        }
      } else c.planting = 0;
    } else if (b.state === 'dropped') {
      for (const a of this.actors) {
        if (!a.alive || a.team !== 'T') continue;
        if (vdist2d(a.pos, b.pos) < 1.1 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
          this.giveBomb(a);
          this.emit({ type: 'bomb_pickup', actor: a.id });
          break;
        }
      }
    } else if (b.state === 'planted') {
      const left = b.explodeAt - now;
      if (now >= b.nextBeep) {
        const urgency = 1 - clamp(left / BOMB_TIMER, 0, 1);
        this.emit({ type: 'bomb_beep', pos: { ...b.pos }, urgency });
        this.sound('bomb', b.pos, 22, -1);
        b.nextBeep = now + clamp(left / 20, 0.12, 1);
      }
      // defusing
      let defuser: Actor | null = null;
      for (const a of this.actors) {
        if (!a.alive || a.team !== 'CT') continue;
        const near = vdist2d(a.pos, b.pos) < 1.7 && Math.abs(a.pos.y - b.pos.y) < 1.4;
        if (near && a.input.use && a.grounded) { defuser = a; break; }
      }
      for (const a of this.actors) if (a !== defuser) a.defusing = 0;
      if (defuser) {
        if (defuser.defusing === 0) { this.emit({ type: 'defuse_start', actor: defuser.id, kit: defuser.kit }); this.sound('defuse', b.pos, 14, defuser.id); }
        defuser.defusing += dt;
        b.defuser = defuser.id;
        defuser.vel.x = 0; defuser.vel.z = 0;
        if (defuser.defusing >= (defuser.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME)) {
          defuser.defusing = 0;
          b.state = 'defused';
          defuser.stats.defuses++;
          this.emit({ type: 'defused', actor: defuser.id });
          this.mode.onDefuse?.(defuser);
          return;
        }
      } else b.defuser = -1;
      if (now >= b.explodeAt) {
        b.state = 'exploded';
        this.emit({ type: 'bomb_exploded', pos: { ...b.pos } });
        this.sound('shot', b.pos, 120, -1);
        const sigma = BOMB_RADIUS / 3;
        for (const v of this.actors) {
          if (!v.alive) continue;
          const d = vdist(v.pos, b.pos);
          if (d > BOMB_RADIUS * 1.2) continue;
          const dmg = BOMB_DAMAGE * Math.exp(-(d * d) / (2 * sigma * sigma));
          if (dmg >= 1) this.applyDamage(v, null, dmg, 'chest', 'c4', { armorPen: 0.5, grenade: true });
        }
        this.mode.onExplode?.();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Training targets

  addTarget(kind: TrainingTarget['kind'], pos: Vec3, opts: { speed?: number; range?: number; armor?: boolean; axis?: 'x' | 'z' } = {}): TrainingTarget {
    const axis = opts.axis ?? 'x';
    const sp = opts.speed ?? 0;
    const t: TrainingTarget = {
      id: this.newId(), pos: { ...pos }, vel: { x: axis === 'x' ? sp : 0, y: 0, z: axis === 'z' ? sp : 0 }, yaw: 0, alive: true, health: 100,
      respawnAt: 0, kind, minX: pos[axis] - (opts.range ?? 0), maxX: pos[axis] + (opts.range ?? 0), axis, spawnedAt: this.time, armor: !!opts.armor,
    };
    this.targets.push(t);
    return t;
  }

  private damageTarget(t: TrainingTarget, shooter: Actor | null, dmg: number, group: HitGroup, def: WeaponDef, dist: number): void {
    const mult = group === 'head' ? def.headMult : group === 'stomach' ? 1.25 : group === 'legs' ? 0.75 : 1;
    let d = dmg * mult;
    if (t.armor && group !== 'legs') d *= def.armorPen;
    d = Math.round(d);
    t.health -= d;
    if (shooter) shooter.stats.damage += d;
    this.emit({ type: 'target_hit', target: t.id, damage: d, group, distance: dist });
    if (t.health <= 0) {
      t.alive = false;
      t.respawnAt = this.time + (t.kind === 'popup' ? 0.8 : 1.5);
      if (shooter) { shooter.stats.kills++; if (group === 'head') shooter.stats.headshots++; }
    }
  }

  private updateTargets(dt: number): void {
    for (const t of this.targets) {
      if (!t.alive) {
        if (this.time >= t.respawnAt) { t.alive = true; t.health = 100; t.spawnedAt = this.time; }
        continue;
      }
      if (t.kind === 'moving') {
        const ax = t.axis;
        t.pos[ax] += t.vel[ax] * dt;
        if (t.pos[ax] > t.maxX) { t.pos[ax] = t.maxX; t.vel[ax] = -Math.abs(t.vel[ax]); }
        if (t.pos[ax] < t.minX) { t.pos[ax] = t.minX; t.vel[ax] = Math.abs(t.vel[ax]); }
      }
    }
  }

  aliveOf(team: Team): Actor[] { return this.actors.filter(a => a.alive && a.team === team); }

  buyZoneContains(a: Actor): boolean {
    const spawns = a.team === 'T' ? this.map.tSpawns : this.map.ctSpawns;
    let cx = 0, cz = 0;
    for (const s of spawns) { cx += s.x; cz += s.z; }
    cx /= spawns.length || 1; cz /= spawns.length || 1;
    let r = 0;
    for (const s of spawns) r = Math.max(r, Math.hypot(s.x - cx, s.z - cz));
    return Math.hypot(a.pos.x - cx, a.pos.z - cz) < r + 9;
  }
}

export function targetHitboxes(t: TrainingTarget): ReturnType<Actor['hitboxes']> {
  const p = t.pos;
  const headY = p.y + STAND_H - 0.14;
  return [
    { group: 'head', kind: 'sphere', cx: p.x, cy: headY, cz: p.z, r: 0.14, y0: 0, y1: 0 },
    { group: 'chest', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.25, y0: p.y + 0.98, y1: headY - 0.14 },
    { group: 'stomach', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.22, y0: p.y + 0.72, y1: p.y + 0.98 },
    { group: 'legs', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.2, y0: p.y, y1: p.y + 0.72 },
  ];
}
