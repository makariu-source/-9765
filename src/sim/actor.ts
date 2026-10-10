import { dirFromAngles, v3, type Vec3 } from './math';
import { emptyInput, emptyStats, type ActorStats, type HitGroup, type InputCmd } from './types';
import { WEAPONS, type GrenadeType, type Slot, type Team, type WeaponDef } from './weapons';

export interface WeaponInst { def: WeaponDef; clip: number; reserve: number }

export const newWeapon = (id: string): WeaponInst => {
  const def = WEAPONS[id];
  if (!def) throw new Error(`Unknown weapon ${id}`);
  return { def, clip: def.mag, reserve: def.reserve };
};

export const STAND_H = 1.8;
export const CROUCH_H = 1.25;
export const HALF_W = 0.34;

export class Actor {
  pos: Vec3 = v3();
  vel: Vec3 = v3();
  yaw = 0;
  pitch = 0;
  crouchAmt = 0;
  grounded = true;
  alive = false;
  health = 100;
  armor = 0;
  helmet = false;
  kit = false;
  money = 800;
  primary: WeaponInst | null = null;
  secondary: WeaponInst | null = null;
  melee: WeaponInst = newWeapon('knife');
  grenades: GrenadeType[] = [];
  hasBomb = false;
  active: Slot = 'secondary';
  activeGrenade: GrenadeType | null = null;
  prevSlot: Slot = 'melee';

  // weapon timing
  nextFire = 0;
  reloadEnd = 0;
  deployEnd = 0;
  spray = 0;
  lastShot = -10;
  spreadAccum = 0;
  scopeLevel = 0;
  triggerHeld = false;
  fire2Held = false;
  useHeld = false;
  inspectUntil = 0;
  throwStart = 0;      // grenade pin pulled
  throwRelease = 0;    // when the throw animation releases the grenade
  throwStrong = true;

  planting = 0;
  defusing = 0;
  flashEnd = 0;
  flashStrength = 0;
  flashedBy = -1;
  spawnProtectUntil = 0;
  respawnAt = 0;
  lastLand = 0;
  stepAccum = 0;
  airTime = 0;
  deathTime = 0;
  deathYaw = 0;
  killedBy = -1;

  /** attacker id -> damage this life (for assists) */
  damageTakenFrom = new Map<number, number>();
  stats: ActorStats = emptyStats();
  roundKills = 0;
  roundDamage = 0;
  armsLevel = 0;
  input: InputCmd = emptyInput();
  lastInputChange = 0;
  connected = true;
  /** stable team identity across halftime side swaps (0 = human's squad) */
  squad = 0;
  /** bot difficulty level 1..7 (0 for humans) and skill rating shown in lobbies */
  botLevel = 0;
  skillRating = 0;
  dmScore = 0;
  jumpHeld = false;
  rezoomAt = 0;
  /** scope level to restore after a sniper bolt cycle */
  fireAccum = 0;
  firedScoped = false;
  lastFireTick = 0;

  constructor(
    readonly id: number,
    public name: string,
    public team: Team,
    readonly isBot: boolean,
    /** visual model variant */
    public model = 0,
  ) {}

  get height(): number { return STAND_H + (CROUCH_H - STAND_H) * this.crouchAmt; }
  get eyeHeight(): number { return this.height - 0.16; }
  eye(): Vec3 { return { x: this.pos.x, y: this.pos.y + this.eyeHeight, z: this.pos.z }; }
  viewDir(): Vec3 { return dirFromAngles(this.yaw, this.pitch); }

  activeWeapon(): WeaponInst | null {
    switch (this.active) {
      case 'primary': return this.primary;
      case 'secondary': return this.secondary;
      case 'melee': return this.melee;
      case 'grenade': return this.activeGrenade ? { def: WEAPONS[this.activeGrenade], clip: 1, reserve: 0 } : null;
      case 'bomb': return this.hasBomb ? { def: WEAPONS.c4, clip: 0, reserve: 0 } : null;
    }
  }

  activeDef(): WeaponDef { return this.activeWeapon()?.def ?? this.melee.def; }

  isReloading(now: number): boolean { return this.reloadEnd > now; }

  /** Hitbox geometry at current pose. */
  hitboxes(): { group: HitGroup; kind: 'sphere' | 'cyl'; cx: number; cy: number; cz: number; r: number; y0: number; y1: number }[] {
    const s = this.height / STAND_H;
    const p = this.pos;
    // head offset slightly forward of the body axis
    const fx = -Math.sin(this.yaw) * 0.05, fz = -Math.cos(this.yaw) * 0.05;
    const headY = p.y + this.height - 0.14;
    return [
      { group: 'head', kind: 'sphere', cx: p.x + fx, cy: headY, cz: p.z + fz, r: 0.14, y0: 0, y1: 0 },
      { group: 'chest', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.25, y0: p.y + 0.98 * s, y1: headY - 0.14 },
      { group: 'stomach', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.22, y0: p.y + 0.72 * s, y1: p.y + 0.98 * s },
      { group: 'legs', kind: 'cyl', cx: p.x, cy: 0, cz: p.z, r: 0.2, y0: p.y, y1: p.y + 0.72 * s },
    ];
  }

  /** Points used for visibility checks (head, chest, knees). */
  visPoints(): Vec3[] {
    const p = this.pos, h = this.height;
    return [
      { x: p.x, y: p.y + h - 0.12, z: p.z },
      { x: p.x, y: p.y + h * 0.65, z: p.z },
      { x: p.x, y: p.y + 0.4, z: p.z },
    ];
  }

  grenadeCount(): number { return this.grenades.length; }

  resetForRound(): void {
    this.health = 100;
    this.alive = true;
    this.vel = v3();
    this.crouchAmt = 0;
    this.planting = 0;
    this.defusing = 0;
    this.flashEnd = 0;
    this.reloadEnd = 0;
    this.spray = 0;
    this.spreadAccum = 0;
    this.scopeLevel = 0;
    this.throwStart = 0;
    this.throwRelease = 0;
    this.damageTakenFrom.clear();
    this.roundKills = 0;
    this.roundDamage = 0;
    this.killedBy = -1;
  }

  stripAll(): void {
    this.primary = null;
    this.secondary = null;
    this.grenades = [];
    this.hasBomb = false;
    this.armor = 0;
    this.helmet = false;
    this.kit = false;
  }
}
