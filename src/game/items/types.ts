/**
 * Item system types. Pure data, no Phaser, no DOM.
 *
 * AC convention is first-edition DESCENDING: lower is better. Unarmored is 10, leather 8, chain 5, plate 3,
 * a shield is -1 (it improves AC by one). Magic armor improves AC by its plus, i.e. `acMagic` is NEGATIVE
 * for good items. Final player AC = armorAc + shield + acMagic.
 */

/** Float in [0,1). Structurally identical to the Rng in `src/game/rules`. */
export interface Rng {
  next(): number;
}

/** Same five categories as the rules lane. Declared locally so items stay standalone. */
export type SaveCategory = 'death' | 'petrify' | 'wands' | 'breath' | 'spells';

/** Same four classes as `constants.ts`. */
export type ClassKey = 'fighter' | 'thief' | 'wizard' | 'cleric';

export const ALL_CLASSES: readonly ClassKey[] = ['fighter', 'thief', 'wizard', 'cleric'];
export const SAVE_CATEGORIES: readonly SaveCategory[] = ['death', 'petrify', 'wands', 'breath', 'spells'];

export type Rarity = 'common' | 'magic' | 'rare' | 'unique';

export type EquipSlot =
  | 'weapon' | 'offhand' | 'armor' | 'helm' | 'cloak' | 'boots' | 'ring1' | 'ring2' | 'amulet';

export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon', 'offhand', 'armor', 'helm', 'cloak', 'boots', 'ring1', 'ring2', 'amulet',
];

/** The slot family a base item fits. `ring` fits ring1 or ring2. */
export type DefSlot = 'weapon' | 'offhand' | 'armor' | 'helm' | 'cloak' | 'boots' | 'ring' | 'amulet';

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'gear' | 'consumable' | 'treasure' | 'key';

export type FoeTag = 'undead' | 'giants' | 'spiders' | 'beasts' | 'demons';

/** What using a consumable does. The scene applies it; the inventory only consumes the item. */
export type UseEffect =
  | { type: 'heal'; dice: string; bonus?: number }
  | { type: 'cure_poison' }
  | { type: 'haste'; pct: number; durationSec: number }
  | { type: 'recall' }
  | { type: 'identify' }
  | { type: 'remove_curse' }
  | { type: 'light'; radius: number; durationSec: number }
  | { type: 'cast'; spell: string }
  | { type: 'throw'; dice: string; vs?: FoeTag }
  | { type: 'eat' };

export interface LightSource {
  /** Sight radius in tiles while lit and held in the offhand. */
  radius: number;
  /** Seconds of burn time a fresh one holds. */
  burnSec: number;
  /** Burnt-out torches vanish; a lantern keeps its body and can be refuelled. */
  refuelable?: boolean;
}

export interface ItemDef {
  key: string;
  name: string;
  kind: ItemKind;
  /** Texture key from the contract's `item_*` list. */
  icon: string;
  slot?: DefSlot;
  /** Damage dice for weapons, e.g. "1d8". */
  damage?: string;
  twoHanded?: boolean;
  ranged?: boolean;
  /** Armor class value (descending). Body armor 8..3, shield -1, other worn pieces omit it. */
  ac?: number;
  /** Pounds. */
  weight: number;
  /** Base value in gp. */
  value: number;
  classes: ClassKey[];
  stackLimit: number;
  use?: UseEffect;
  light?: LightSource;
  /** Hooks for the tomb engine and scenes: 'probe', 'pressure_weight', 'lockpick', 'climb', 'wedge' and so on. */
  tags?: string[];
  /** Earliest floor on which random drops can produce it. Default 1. */
  minFloor?: number;
  /** Relative drop weight within its kind. Default 10. */
  dropWeight?: number;
  /** Sold at the tavern from this character level on, with this many in stock. */
  shop?: { minLevel: number; qty: number };
  description?: string;
}

export type AffixEffect =
  | { type: 'toHit'; amount: number }
  | { type: 'damage'; amount: number }
  /** Improves AC by `amount` (negative amount worsens it). */
  | { type: 'ac'; amount: number }
  | { type: 'save'; category: SaveCategory | 'all'; amount: number }
  | { type: 'maxHp'; amount: number }
  | { type: 'speed'; pct: number }
  | { type: 'light'; radius: number }
  | { type: 'lifeOnHit'; amount: number }
  | { type: 'thorns'; amount: number }
  | { type: 'resistPoison' }
  | { type: 'findTraps'; pct: number }
  | { type: 'extraSlot'; level: number; count: number }
  | { type: 'slay'; foe: FoeTag; bonus: number };

export interface Affix {
  key: string;
  label: string;
  position: 'prefix' | 'suffix' | 'unique' | 'curse';
  effect: AffixEffect;
}

export interface ItemInstance {
  id: string;
  defKey: string;
  rarity: Rarity;
  /** Magic bonus on weapons, armor and shields. Negative on cursed gear. */
  plus: number;
  affixes: Affix[];
  identified: boolean;
  cursed: boolean;
  /** Burn seconds left for light sources; undefined otherwise. */
  charges?: number;
  quantity: number;
  /** Rare or unique name. */
  customName?: string;
  uniqueKey?: string;
}

export type ItemGroup = 'weapon' | 'body' | 'shield' | 'helm' | 'cloak' | 'boots' | 'ring' | 'amulet';
