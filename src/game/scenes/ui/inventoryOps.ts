/**
 * Runs an inventory action: checks it on a copy first (so the player sees the inventory's own failure
 * reason), then calls the scene context's method when it has one, otherwise changes the inventory
 * directly. Phaser-free.
 */
import type { Inventory } from "../../items";
import { rollDiceString } from "../../items";
import { applyAction, checkAction, type ActionCheck, type InvAction } from "./inventoryModel";

/** Optional scene hooks, mirroring the optional methods on `GameContext`. */
export interface OpsHooks {
  useBelt?(index: number): void;
  dropItem?(itemId: string): void;
  equipItem?(itemId: string): void;
  unequipSlot?(slot: string): void;
}

export interface OpsHost {
  inventory: Inventory;
  hooks: OpsHooks;
  /** Recompute derived stats after a direct change (`player.recomputeDerived`). */
  recompute(): void;
  /** Push stats to the HUD (`ctx.emitHUD`). */
  refreshHud(): void;
  say(msg: string): void;
  /** Apply healing for the direct-use fallback. */
  heal?(amount: number): void;
  /** Rolls for the direct-use fallback; defaults to Math.random. */
  rng?: { next(): number };
}

/** Returns the dry-run verdict; on failure it has already told the player why. */
export function runAction(host: OpsHost, a: InvAction): ActionCheck {
  const check = checkAction(host.inventory, a);
  if (!check.ok) {
    host.say(check.message);
    return check;
  }
  const h = host.hooks;
  if (a.type === 'equip' && h.equipItem) { h.equipItem(a.itemId); return check; }
  if (a.type === 'unequip' && h.unequipSlot) { h.unequipSlot(a.slot); return check; }
  if (a.type === 'useBelt' && h.useBelt) { h.useBelt(a.index); return check; }
  if (a.type === 'drop' && h.dropItem) { h.dropItem(a.itemId); return check; }

  const r = applyAction(host.inventory, a);
  if (!r.ok) {
    host.say(r.message);
    return r;
  }
  let msg = r.message;
  if (r.heal && host.heal) {
    const n = Math.max(1, rollDiceString(host.rng ?? { next: Math.random }, r.heal.dice) + r.heal.bonus);
    host.heal(n);
    msg = `You drink the ${r.name ?? 'potion'} and recover ${n} HP.`;
  }
  host.recompute();
  host.refreshHud();
  host.say(msg);
  return check;
}
