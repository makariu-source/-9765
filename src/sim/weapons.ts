// Weapon definitions. Identical numbers apply to players and bots.
export type WeaponClass = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'lmg' | 'knife' | 'grenade' | 'bomb' | 'training';
export type Slot = 'primary' | 'secondary' | 'melee' | 'grenade' | 'bomb';
export type GrenadeType = 'he' | 'flash' | 'smoke' | 'molotov' | 'decoy';
export type Team = 'T' | 'CT';

export interface WeaponDef {
  id: string;
  name: string;
  /** what it resembles, shown in the collection screen */
  style: string;
  cls: WeaponClass;
  slot: Slot;
  team?: Team;
  price: number;
  killReward: number;
  damage: number;
  /** fraction of damage that reaches health when the hit area is armored */
  armorPen: number;
  headMult: number;
  /** damage multiplier per 10 m travelled */
  rangeMod: number;
  rpm: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reloadTime: number;
  deployTime: number;
  /** max ground speed with weapon (m/s) */
  speed: number;
  /** angular spread radius (radians) */
  spreadStand: number;
  spreadCrouch: number;
  /** added at full running speed */
  spreadMove: number;
  spreadJump: number;
  /** added per shot, decays with spreadRecover (seconds to recover ~63%) */
  spreadFire: number;
  spreadRecover: number;
  /** recoil (radians): vertical kick per shot and horizontal sway amplitude */
  recoilUp: number;
  recoilSide: number;
  /** seconds until spray pattern resets */
  recoilReset: number;
  pellets?: number;
  /** wall penetration power (meters of wood-equivalent) */
  penetration: number;
  range: number;
  /** scope FOV levels (degrees); first is unscoped default view */
  scope?: number[];
  scopedSpread?: number;
  scopedSpeed?: number;
  tracer?: boolean;
  /** knife heavy attack damage */
  heavyDamage?: number;
  infiniteAmmo?: boolean;
}

const d = (w: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'style' | 'cls' | 'slot'>): WeaponDef => ({
  price: 0, killReward: 300, damage: 30, armorPen: 0.6, headMult: 4, rangeMod: 0.9, rpm: 400, auto: false,
  mag: 20, reserve: 100, reloadTime: 2.2, deployTime: 1.0, speed: 6.1, spreadStand: 0.006, spreadCrouch: 0.0045,
  spreadMove: 0.035, spreadJump: 0.15, spreadFire: 0.012, spreadRecover: 0.3, recoilUp: 0.012, recoilSide: 0.004,
  recoilReset: 0.45, penetration: 0.3, range: 120, tracer: true, ...w,
});

export const WEAPONS: Record<string, WeaponDef> = {};
const reg = (w: WeaponDef) => { WEAPONS[w.id] = w; return w; };

// --- Pistols
reg(d({ id: 'g9', name: 'G9 Striker', style: 'Glock-подобный', cls: 'pistol', slot: 'secondary', team: 'T', price: 200, damage: 30, armorPen: 0.47, rangeMod: 0.85, rpm: 400, mag: 20, reserve: 120, reloadTime: 2.2, speed: 6.1, spreadStand: 0.009, spreadMove: 0.03, spreadFire: 0.011, recoilUp: 0.011 }));
reg(d({ id: 'warden', name: 'Warden-S', style: 'USP-подобный', cls: 'pistol', slot: 'secondary', team: 'CT', price: 200, damage: 35, armorPen: 0.505, rangeMod: 0.89, rpm: 352, mag: 12, reserve: 24, reloadTime: 2.2, speed: 6.1, spreadStand: 0.0062, spreadMove: 0.03, spreadFire: 0.014, recoilUp: 0.014 }));
reg(d({ id: 'p250', name: 'P-250 Tactical', style: 'P250-подобный', cls: 'pistol', slot: 'secondary', price: 300, damage: 38, armorPen: 0.64, rangeMod: 0.85, rpm: 400, mag: 13, reserve: 26, reloadTime: 2.2, spreadStand: 0.0075, spreadFire: 0.016, recoilUp: 0.016 }));
reg(d({ id: 'deagle', name: 'Hand Cannon .50', style: 'Desert Eagle-подобный', cls: 'pistol', slot: 'secondary', price: 700, damage: 53, armorPen: 0.93, rangeMod: 0.81, rpm: 267, mag: 7, reserve: 35, reloadTime: 2.2, speed: 5.84, spreadStand: 0.004, spreadMove: 0.06, spreadFire: 0.04, spreadRecover: 0.42, recoilUp: 0.04, recoilSide: 0.01, recoilReset: 0.6, penetration: 0.45 }));
reg(d({ id: 'trainer', name: 'Тренировочный TX-1', style: 'Учебное оружие', cls: 'training', slot: 'secondary', price: 0, damage: 25, armorPen: 0.5, rpm: 450, mag: 30, reserve: 999, spreadStand: 0.002, spreadFire: 0.004, recoilUp: 0.005, recoilSide: 0.001, infiniteAmmo: true }));

// --- SMGs
reg(d({ id: 'mk5', name: 'MK5 Compact', style: 'MP5-подобный', cls: 'smg', slot: 'primary', price: 1500, killReward: 600, damage: 27, armorPen: 0.625, rangeMod: 0.85, rpm: 750, auto: true, mag: 30, reserve: 120, reloadTime: 2.6, speed: 6.1, spreadStand: 0.007, spreadCrouch: 0.0055, spreadMove: 0.028, spreadFire: 0.0055, recoilUp: 0.0075, recoilSide: 0.004, penetration: 0.3 }));
reg(d({ id: 'macx', name: 'Mac-X', style: 'MAC-10-подобный', cls: 'smg', slot: 'primary', team: 'T', price: 1050, killReward: 600, damage: 29, armorPen: 0.575, rangeMod: 0.8, rpm: 800, auto: true, mag: 30, reserve: 100, reloadTime: 2.6, speed: 6.1, spreadStand: 0.009, spreadMove: 0.03, spreadFire: 0.007, recoilUp: 0.008, recoilSide: 0.006 }));
reg(d({ id: 'px90', name: 'PX-90', style: 'P90-подобный', cls: 'smg', slot: 'primary', price: 2350, killReward: 300, damage: 26, armorPen: 0.69, rangeMod: 0.86, rpm: 857, auto: true, mag: 50, reserve: 100, reloadTime: 3.3, speed: 5.84, spreadStand: 0.0075, spreadMove: 0.03, spreadFire: 0.0045, recoilUp: 0.0062, recoilSide: 0.0035 }));

// --- Rifles
reg(d({ id: 'ak', name: 'AK-R Volkov', style: 'AK-подобная', cls: 'rifle', slot: 'primary', team: 'T', price: 2700, damage: 36, armorPen: 0.775, rangeMod: 0.98, rpm: 600, auto: true, mag: 30, reserve: 90, reloadTime: 2.5, speed: 5.46, spreadStand: 0.0032, spreadCrouch: 0.0024, spreadMove: 0.13, spreadJump: 0.3, spreadFire: 0.0075, spreadRecover: 0.35, recoilUp: 0.0125, recoilSide: 0.006, penetration: 0.55 }));
reg(d({ id: 'm4', name: 'M4-A Sentinel', style: 'M4-подобная', cls: 'rifle', slot: 'primary', team: 'CT', price: 2900, damage: 34, armorPen: 0.775, rangeMod: 0.985, rpm: 666, auto: true, mag: 30, reserve: 90, reloadTime: 3.1, speed: 5.71, spreadStand: 0.0023, spreadCrouch: 0.0017, spreadMove: 0.12, spreadJump: 0.3, spreadFire: 0.0065, spreadRecover: 0.33, recoilUp: 0.0105, recoilSide: 0.005, penetration: 0.5 }));
reg(d({ id: 'galeon', name: 'Galeon AR', style: 'Galil-подобная', cls: 'rifle', slot: 'primary', team: 'T', price: 1800, damage: 30, armorPen: 0.775, rangeMod: 0.98, rpm: 666, auto: true, mag: 35, reserve: 90, reloadTime: 3.0, speed: 5.84, spreadStand: 0.0045, spreadMove: 0.11, spreadJump: 0.28, spreadFire: 0.0075, recoilUp: 0.0105, recoilSide: 0.006, penetration: 0.5 }));
reg(d({ id: 'famine', name: 'Famine F1', style: 'FAMAS-подобная', cls: 'rifle', slot: 'primary', team: 'CT', price: 2050, damage: 30, armorPen: 0.7, rangeMod: 0.96, rpm: 666, auto: true, mag: 25, reserve: 90, reloadTime: 3.3, speed: 5.84, spreadStand: 0.0042, spreadMove: 0.11, spreadJump: 0.28, spreadFire: 0.007, recoilUp: 0.01, recoilSide: 0.0055, penetration: 0.5 }));

// --- Snipers
reg(d({ id: 'awm', name: 'AW-Magnum', style: 'AWP-подобная', cls: 'sniper', slot: 'primary', price: 4750, killReward: 100, damage: 115, armorPen: 0.975, headMult: 4, rangeMod: 0.99, rpm: 41, mag: 5, reserve: 30, reloadTime: 3.7, deployTime: 1.2, speed: 5.08, spreadStand: 0.075, spreadCrouch: 0.065, spreadMove: 0.25, spreadJump: 0.4, spreadFire: 0.05, spreadRecover: 0.9, recoilUp: 0.04, recoilSide: 0.004, recoilReset: 1.4, penetration: 0.9, range: 250, scope: [90, 40, 10], scopedSpread: 0.0004, scopedSpeed: 2.54 }));
reg(d({ id: 'hawk', name: 'SSG Hawk', style: 'Scout-подобная', cls: 'sniper', slot: 'primary', price: 1700, killReward: 300, damage: 88, armorPen: 0.85, rangeMod: 0.98, rpm: 48, mag: 10, reserve: 90, reloadTime: 3.7, deployTime: 1.0, speed: 6.35, spreadStand: 0.045, spreadCrouch: 0.04, spreadMove: 0.18, spreadJump: 0.05, spreadFire: 0.04, spreadRecover: 0.7, recoilUp: 0.03, recoilSide: 0.003, recoilReset: 1.2, penetration: 0.7, range: 220, scope: [90, 40, 15], scopedSpread: 0.0015, scopedSpeed: 5.5 }));

// --- Heavy
reg(d({ id: 'hailstorm', name: 'Hailstorm MG', style: 'Пулемёт', cls: 'lmg', slot: 'primary', price: 5200, killReward: 300, damage: 32, armorPen: 0.8, rangeMod: 0.97, rpm: 750, auto: true, mag: 100, reserve: 200, reloadTime: 5.7, speed: 4.95, spreadStand: 0.009, spreadCrouch: 0.006, spreadMove: 0.15, spreadFire: 0.006, recoilUp: 0.009, recoilSide: 0.007, recoilReset: 0.6, penetration: 0.55 }));
reg(d({ id: 'nova', name: 'Nova Pump', style: 'Помповый дробовик', cls: 'shotgun', slot: 'primary', price: 1050, killReward: 900, damage: 26, armorPen: 0.5, headMult: 4, rangeMod: 0.7, rpm: 68, mag: 8, reserve: 32, reloadTime: 3.0, speed: 5.84, spreadStand: 0.065, spreadCrouch: 0.06, spreadMove: 0.06, spreadFire: 0.02, recoilUp: 0.035, recoilSide: 0.01, recoilReset: 0.8, pellets: 9, penetration: 0.2, range: 40 }));
reg(d({ id: 'xmauto', name: 'XM Auto', style: 'Полуавтоматический дробовик', cls: 'shotgun', slot: 'primary', price: 2000, killReward: 900, damage: 20, armorPen: 0.8, rangeMod: 0.7, rpm: 171, mag: 7, reserve: 32, reloadTime: 3.0, speed: 5.84, spreadStand: 0.06, spreadMove: 0.06, spreadFire: 0.02, recoilUp: 0.03, recoilSide: 0.01, pellets: 6, penetration: 0.2, range: 40 }));

// --- Melee
reg(d({ id: 'knife', name: 'Боевой нож', style: 'Нож', cls: 'knife', slot: 'melee', price: 0, killReward: 1500, damage: 40, heavyDamage: 65, armorPen: 0.85, headMult: 1, rangeMod: 1, rpm: 120, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.6, speed: 6.35, spreadStand: 0, spreadMove: 0, spreadJump: 0, spreadFire: 0, recoilUp: 0, recoilSide: 0, range: 1.8, tracer: false }));
reg(d({ id: 'goldknife', name: 'Золотой нож', style: 'Нож (финал гонки)', cls: 'knife', slot: 'melee', price: 0, killReward: 0, damage: 40, heavyDamage: 65, armorPen: 0.85, headMult: 1, rangeMod: 1, rpm: 120, mag: 0, reserve: 0, reloadTime: 0, deployTime: 0.6, speed: 6.35, spreadStand: 0, spreadMove: 0, spreadJump: 0, spreadFire: 0, recoilUp: 0, recoilSide: 0, range: 1.8, tracer: false }));

// --- Grenades (thrown, see grenades.ts)
reg(d({ id: 'he', name: 'Осколочная граната', style: 'HE', cls: 'grenade', slot: 'grenade', price: 300, damage: 98, deployTime: 0.6, mag: 1, reserve: 0, speed: 6.1, tracer: false }));
reg(d({ id: 'flash', name: 'Светошумовая граната', style: 'Flashbang', cls: 'grenade', slot: 'grenade', price: 200, damage: 0, deployTime: 0.6, mag: 1, reserve: 0, speed: 6.1, tracer: false }));
reg(d({ id: 'smoke', name: 'Дымовая граната', style: 'Smoke', cls: 'grenade', slot: 'grenade', price: 300, damage: 0, deployTime: 0.6, mag: 1, reserve: 0, speed: 6.1, tracer: false }));
reg(d({ id: 'molotov', name: 'Зажигательная смесь', style: 'Molotov / Incendiary', cls: 'grenade', slot: 'grenade', price: 400, damage: 0, deployTime: 0.6, mag: 1, reserve: 0, speed: 6.1, tracer: false }));
reg(d({ id: 'decoy', name: 'Граната-приманка', style: 'Decoy', cls: 'grenade', slot: 'grenade', price: 50, damage: 0, deployTime: 0.6, mag: 1, reserve: 0, speed: 6.1, tracer: false }));
reg(d({ id: 'c4', name: 'Бомба C4', style: 'Взрывчатка', cls: 'bomb', slot: 'bomb', price: 0, damage: 0, deployTime: 0.8, mag: 0, reserve: 0, speed: 6.1, tracer: false }));

export const GRENADE_TYPES: GrenadeType[] = ['he', 'flash', 'smoke', 'molotov', 'decoy'];
export const GRENADE_LIMIT: Record<GrenadeType, number> = { he: 1, flash: 2, smoke: 1, molotov: 1, decoy: 1 };
export const MAX_GRENADES = 4;
/** CT incendiary costs more, same behaviour */
export const grenadePrice = (g: GrenadeType, team: Team) => (g === 'molotov' && team === 'CT' ? 600 : WEAPONS[g].price);

export const PISTOLS = ['g9', 'warden', 'p250', 'deagle'];
export const SMGS = ['macx', 'mk5', 'px90'];
export const RIFLES = ['galeon', 'famine', 'ak', 'm4'];
export const SNIPERS = ['hawk', 'awm'];
export const HEAVY = ['nova', 'xmauto', 'hailstorm'];

export const ARMOR_PRICE = 650;
export const ARMOR_HELMET_PRICE = 1000;
export const HELMET_UPGRADE_PRICE = 350;
export const KIT_PRICE = 400;

export function canBuyWeapon(id: string, team: Team): boolean {
  const w = WEAPONS[id];
  return !!w && w.price > 0 && (!w.team || w.team === team);
}

export const fireInterval = (w: WeaponDef) => 60 / w.rpm;

/** Default arms race ladder (customisable in custom matches). */
export const ARMS_RACE_DEFAULT = ['m4', 'ak', 'famine', 'galeon', 'px90', 'mk5', 'macx', 'awm', 'hawk', 'hailstorm', 'xmauto', 'nova', 'deagle', 'p250', 'warden', 'g9', 'goldknife'];
