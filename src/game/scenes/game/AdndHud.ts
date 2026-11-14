import type { PlayerStats } from "../../entities/Player";
import type { Inventory, } from "../../items";
import { getDef } from "../../items";
import type { SaveCategory, Spellbook } from "../../rules";
import { spellSlotViews, type SpellSlotView } from "./AdndCombat";

/**
 * The first-edition fields added to the `hud:update` payload. All optional for the HUD: an untouched HUD ignores
 * them, the UI lane reads them.
 */
export interface HudExtras {
  /** Every memorized spell: name, spell level, copies left and copies memorized. Empty for non-casters. */
  spellSlots: SpellSlotView[];
  /** Player THAC0. */
  thac0: number;
  /** Armor class, descending (10 unarmored, lower is better). */
  ac: number;
  /** d20 targets for the five saves (lower is easier). */
  saves: Record<SaveCategory, number>;
  /** Seconds of burn left in the held light; 0 when none is lit. */
  torchSeconds: number;
  /** Level title such as "Veteran". */
  title: string;
  /** Gold carried. */
  gold: number;
}

export function buildHudExtras(
  stats: PlayerStats, inventory: Inventory, spellbook: Spellbook | null,
): HudExtras {
  const off = inventory.equipment.offhand;
  const light = off && getDef(off.defKey).light ? Math.max(0, Math.ceil(off.charges ?? 0)) : 0;
  return {
    spellSlots: spellSlotViews(spellbook),
    thac0: stats.thac0 ?? 20,
    ac: stats.ac ?? 10,
    saves: stats.saves ?? { death: 20, petrify: 20, wands: 20, breath: 20, spells: 20 },
    torchSeconds: light,
    title: stats.title ?? '',
    gold: stats.gold,
  };
}
