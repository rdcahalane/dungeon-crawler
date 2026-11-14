import { ITEM_DEFS, getDef, instantiate } from './catalog';
import { buyValue, rollItem, sellValue } from './generate';
import type { Inventory, Result } from './inventory';
import { chance, int, newId, pick } from './rngutil';
import type { ItemInstance, Rng } from './types';

export interface ShopEntry {
  /** The stock. `item.quantity` is how many are for sale. */
  item: ItemInstance;
  /** Price per unit in gp. */
  unitPrice: number;
}

/** Adventuring staples the tavern always has on the shelf, at any level and for any class. */
export const STAPLE_KEYS: readonly string[] = [
  'torch', 'ten_foot_pole', 'rope', 'iron_spikes', 'sack', 'holy_water', 'ration',
  'thieves_tools', 'healing_potion', 'scroll_recall',
];

/**
 * Tavern stock for a character level. Staples always; heavier armor and better kit unlock by level;
 * a few identified magic items from level 3. Never sells cursed goods.
 */
/** The weapon each class starts with, offered at +1 from level 3 (see `shopStock`). */
const CLASS_WEAPON: Record<string, string> = { fighter: 'long_sword', thief: 'short_sword', cleric: 'mace', wizard: 'dagger' };

export function shopStock(level: number, rng: Rng, classKey?: string): ShopEntry[] {
  const lv = Math.max(1, Math.floor(level));
  const out: ShopEntry[] = [];
  const push = (item: ItemInstance): void => { out.push({ item, unitPrice: buyValue(item) }); };

  for (const d of ITEM_DEFS) {
    if (!d.shop || d.shop.minLevel > lv) continue;
    const item = instantiate(d.key, newId(rng));
    item.quantity = Math.min(d.stackLimit, d.stackLimit > 1 ? Math.max(1, d.shop.qty + int(rng, -1, 1)) : 1);
    push(item);
    // Single-copy gear can have a second on the shelf.
    if (d.stackLimit === 1 && d.shop.qty > 1 && chance(rng, 0.5)) push(instantiate(d.key, newId(rng)));
  }

  // The staples are guaranteed, whatever the catalog's own shop level says.
  for (const key of STAPLE_KEYS) {
    if (out.some((e) => e.item.defKey === key)) continue;
    const d = getDef(key);
    const item = instantiate(key, newId(rng));
    item.quantity = Math.min(d.stackLimit, Math.max(1, d.shop?.qty ?? 3));
    push(item);
  }

  // From level 3 a +1 version of the class's own weapon is always on the shelf. Gargoyles (floor 6), wights and
  // wraiths cannot be hurt without one; the balance sim showed most deep-floor deaths were characters left with
  // nothing that could hurt what was in front of them (docs/balance-report.md, 2026-11-14).
  const weaponKey = classKey ? CLASS_WEAPON[classKey] : undefined;
  if (lv >= 3 && weaponKey) {
    const w = instantiate(weaponKey, newId(rng));
    w.rarity = 'magic';
    w.plus = 1;
    w.identified = true;
    push(w);
  }

  const magicCount = lv < 3 ? 0 : Math.min(4, 1 + Math.floor((lv - 3) / 3));
  for (let i = 0; i < magicCount; i++) {
    const kind = pick(rng, ['weapon', 'armor', 'shield', 'gear'] as const);
    push(rollItem({ floor: Math.max(1, Math.ceil(lv / 2)), rarityBias: 1, kind, minRarity: 'magic', noCurse: true, identified: true }, rng));
  }
  return out;
}

/** Buy `qty` of an entry into the pack. Atomic: gold and stock change only on success. */
export function buy(inv: Inventory, entry: ShopEntry, qty = 1): Result<{ spent: number }> {
  if (!Number.isInteger(qty) || qty < 1 || qty > entry.item.quantity) {
    return { ok: false, reason: 'invalid_quantity', message: 'Not that many for sale.' };
  }
  const cost = entry.unitPrice * qty;
  if (inv.gold < cost) return { ok: false, reason: 'not_enough', message: 'You cannot afford that.' };
  const bought: ItemInstance = JSON.parse(JSON.stringify(entry.item)) as ItemInstance;
  bought.quantity = qty;
  bought.id = `${entry.item.id}.b${entry.item.quantity}`;
  const r = inv.add(bought);
  if (!r.ok) return r;
  inv.gold -= cost;
  entry.item.quantity -= qty;
  return { ok: true, spent: cost };
}

/** Sell `qty` (default all) of a held item for `sellValue` each. Equipped cursed items cannot be sold. */
export function sell(inv: Inventory, itemId: string, qty?: number): Result<{ earned: number }> {
  const f = inv.find(itemId);
  if (!f) return { ok: false, reason: 'no_such_item', message: 'No such item.' };
  const n = qty ?? f.item.quantity;
  const price = sellValue(f.item);
  const r = inv.remove(itemId, n);
  if (!r.ok) return r;
  inv.gold += price * n;
  return { ok: true, earned: price * n };
}

/** The gold the player actually spends: `PlayerStats.gold`. The inventory's own `gold` is a mirror of it. */
export interface Purse { gold: number }

/**
 * Buy against the player's purse. `purse.gold` is the single source of truth: it is copied to the inventory for the
 * transaction and the result copied back, so the two can never drift apart.
 */
export function buyWithPurse(inv: Inventory, purse: Purse, entry: ShopEntry, qty = 1): Result<{ spent: number }> {
  inv.gold = purse.gold;
  const r = buy(inv, entry, qty);
  purse.gold = inv.gold;
  return r;
}

/** Sell against the player's purse (same rule as `buyWithPurse`). */
export function sellWithPurse(inv: Inventory, purse: Purse, itemId: string, qty?: number): Result<{ earned: number }> {
  inv.gold = purse.gold;
  const r = sell(inv, itemId, qty);
  purse.gold = inv.gold;
  return r;
}

export interface SellLine {
  item: ItemInstance;
  /** gp each. */
  unitPrice: number;
}

/** What the SELL tab lists: the pack, minus anything the merchant would pay nothing for (keys and the like). */
export function sellList(inv: Inventory): SellLine[] {
  const out: SellLine[] = [];
  for (const it of inv.pack) {
    if (!it) continue;
    const unitPrice = sellValue(it);
    if (unitPrice > 0) out.push({ item: it, unitPrice });
  }
  return out;
}
