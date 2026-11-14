/**
 * Ground items in the floor save. Phaser-free: the loot controller hands over what lies on the floor, this packs it
 * into `SerializedFloor.groundItems` and back.
 *
 * Mechanism state: the engine serializes its own pressure-plate counters, so a restored item that sits on a plate is
 * already counted. Restoring therefore does NOT emit `item_dropped` again (that would count it twice). Items the
 * player dropped keep a `dropped` flag so picking one up later still sends `item_picked` and lets the plate rise.
 */
import { hasDef, type ItemInstance } from "../../items";

export interface SavedGroundItem {
  item: ItemInstance;
  tx: number;
  ty: number;
  /** Put down by the player (so lifting it again releases a pressure plate). */
  dropped?: boolean;
}

/** What the loot controller knows about one lying thing. */
export interface GroundLike {
  item?: ItemInstance;
  x: number;
  y: number;
  /** Generator spawns are re-rolled from the dungeon data on every visit, so they are not saved. */
  spawnKey?: string;
  dropped?: boolean;
}

/** Items lying on the floor, as plain JSON. Gold, shrines and generator spawns are not included. */
export function packGroundItems(entries: readonly GroundLike[], tileSize: number): SavedGroundItem[] {
  const out: SavedGroundItem[] = [];
  for (const g of entries) {
    if (!g.item || g.spawnKey) continue;
    const s: SavedGroundItem = {
      item: JSON.parse(JSON.stringify(g.item)) as ItemInstance,
      tx: Math.floor(g.x / tileSize),
      ty: Math.floor(g.y / tileSize),
    };
    if (g.dropped) s.dropped = true;
    out.push(s);
  }
  return out;
}

/** Validate a saved list: unknown items (a renamed def in an old save) and bad coordinates are skipped. */
export function unpackGroundItems(saved: readonly SavedGroundItem[] | undefined): SavedGroundItem[] {
  const out: SavedGroundItem[] = [];
  for (const s of saved ?? []) {
    if (!s || !s.item || !hasDef(s.item.defKey)) continue;
    if (!Number.isInteger(s.tx) || !Number.isInteger(s.ty)) continue;
    if (!Number.isFinite(s.item.quantity) || s.item.quantity < 1) continue;
    out.push({ item: s.item, tx: s.tx, ty: s.ty, ...(s.dropped ? { dropped: true } : {}) });
  }
  return out;
}
