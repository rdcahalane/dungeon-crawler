import type { ChestTier } from "../constants";
import { mathRng } from "../rules";
import { rollDrop, type Drop } from "../items";

/** What a chest holds: gold and real item instances from the items module. */
export type LootResult = Drop;

/** Chest loot now flows through `items/rollDrop`; this stays as the one place the chest asks for it. */
export class LootTable {
  static rollLoot(floor: number, tier: ChestTier): LootResult {
    return rollDrop({ type: 'chest', tier }, floor, mathRng);
  }
}
