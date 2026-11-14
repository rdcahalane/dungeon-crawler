import { ITEM_DEFS, instantiate } from './catalog';
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

/**
 * Tavern stock for a character level. Staples always; heavier armor and better kit unlock by level;
 * a few identified magic items from level 3. Never sells cursed goods.
 */
export function shopStock(level: number, rng: Rng): ShopEntry[] {
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
