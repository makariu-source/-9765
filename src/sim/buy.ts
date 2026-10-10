// Single buy implementation for players and bots (same prices, limits and zones).
import type { Actor } from './actor';
import type { Game } from './game';
import {
  ARMOR_HELMET_PRICE, ARMOR_PRICE, GRENADE_TYPES, HELMET_UPGRADE_PRICE, KIT_PRICE, WEAPONS,
  canBuyWeapon, grenadePrice, type GrenadeType,
} from './weapons';

export type BuyItem = string | 'armor' | 'armorhelmet' | 'kit';

export interface BuyCheck { ok: boolean; price: number; reason?: string }

export function itemPrice(a: Actor, item: BuyItem): number {
  if (item === 'armor') return ARMOR_PRICE;
  if (item === 'armorhelmet') return a.armor >= 100 && !a.helmet ? HELMET_UPGRADE_PRICE : ARMOR_HELMET_PRICE;
  if (item === 'kit') return KIT_PRICE;
  if ((GRENADE_TYPES as string[]).includes(item)) return grenadePrice(item as GrenadeType, a.team);
  return WEAPONS[item]?.price ?? 0;
}

export function checkBuy(g: Game, a: Actor, item: BuyItem): BuyCheck {
  const free = !!g.mode.freeBuy;
  const price = free ? 0 : itemPrice(a, item);
  if (!g.mode.canBuy(a)) return { ok: false, price, reason: 'Покупка недоступна' };
  if (!free && a.money < price) return { ok: false, price, reason: 'Недостаточно денег' };
  if (item === 'armor') {
    if (a.armor >= 100) return { ok: false, price, reason: 'Броня уже есть' };
    return { ok: true, price };
  }
  if (item === 'armorhelmet') {
    if (a.armor >= 100 && a.helmet) return { ok: false, price, reason: 'Броня и шлем уже есть' };
    return { ok: true, price };
  }
  if (item === 'kit') {
    if (a.team !== 'CT' || !g.mode.allowBomb) return { ok: false, price, reason: 'Только для защиты' };
    if (a.kit) return { ok: false, price, reason: 'Набор уже есть' };
    return { ok: true, price };
  }
  const def = WEAPONS[item];
  if (!def) return { ok: false, price, reason: 'Неизвестный предмет' };
  if (def.slot === 'grenade') {
    if (!g.canHoldGrenade(a, item as GrenadeType)) return { ok: false, price, reason: 'Лимит гранат' };
    return { ok: true, price };
  }
  if (!free && !canBuyWeapon(item, a.team)) return { ok: false, price, reason: 'Недоступно для вашей стороны' };
  if (def.slot === 'primary' && a.primary?.def.id === item) return { ok: false, price, reason: 'Уже в руках' };
  if (def.slot === 'secondary' && a.secondary?.def.id === item) return { ok: false, price, reason: 'Уже в руках' };
  return { ok: true, price };
}

export function buy(g: Game, a: Actor, item: BuyItem): BuyCheck {
  const c = checkBuy(g, a, item);
  if (!c.ok) return c;
  a.money -= c.price;
  if (item === 'armor') a.armor = 100;
  else if (item === 'armorhelmet') { a.armor = 100; a.helmet = true; }
  else if (item === 'kit') a.kit = true;
  else g.giveWeapon(a, item, true);
  g.emit({ type: 'buy', actor: a.id, item });
  return c;
}
