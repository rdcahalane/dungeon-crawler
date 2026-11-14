/**
 * Item key names differ between modules. The world module (vaults, tomb) says `iron_key`; the items
 * catalog says `key_iron`. This is the single place that translates between them.
 *
 * World keys with NO item def of their own before this change: `key_crown`, `key_seal`, `key_tooth`
 * (the three tomb key parts, `KEY_PARTS` in `world/tomb.ts`). They now exist in `items/catalog.ts`
 * as kind `key`, and map to themselves here.
 */

/** world key -> items catalog def key. */
export const ITEM_KEY_ALIASES: Readonly<Record<string, string>> = {
  iron_key: 'key_iron',
  bronze_key: 'key_bronze',
  silver_key: 'key_silver',
  bone_key: 'key_bone',
  // Tomb key parts: same name on both sides.
  key_crown: 'key_crown',
  key_seal: 'key_seal',
  key_tooth: 'key_tooth',
};

/** Keys the world module expects that had no item def before the catalog was extended. */
export const WORLD_KEYS_WITHOUT_ITEM_DEF: readonly string[] = ['key_crown', 'key_seal', 'key_tooth'];

const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(ITEM_KEY_ALIASES).map(([world, def]) => [def, world]),
);

/** Items catalog def key (`key_iron`) -> the name the world module uses (`iron_key`). Unknown keys pass through. */
export function worldItemKey(defKey: string): string {
  return REVERSE[defKey] ?? defKey;
}

/** World module key (`iron_key`) -> items catalog def key (`key_iron`). Unknown keys pass through. */
export function itemDefKey(worldKey: string): string {
  return ITEM_KEY_ALIASES[worldKey] ?? worldKey;
}
