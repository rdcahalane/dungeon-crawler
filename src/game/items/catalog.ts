import type { ClassKey, ItemDef, ItemGroup, ItemInstance } from './types';
import { ALL_CLASSES } from './types';

const ALL: ClassKey[] = [...ALL_CLASSES];
const FT: ClassKey[] = ['fighter', 'thief'];
const FC: ClassKey[] = ['fighter', 'cleric'];
const FTC: ClassKey[] = ['fighter', 'thief', 'cleric'];
const FTW: ClassKey[] = ['fighter', 'thief', 'wizard'];
const FIGHTER: ClassKey[] = ['fighter'];
const WIZ: ClassKey[] = ['wizard'];
const CLERIC: ClassKey[] = ['cleric'];

type Part = Partial<ItemDef> & Pick<ItemDef, 'key' | 'name' | 'kind' | 'icon' | 'weight' | 'value'>;
const def = (p: Part): ItemDef => ({ classes: ALL, stackLimit: 1, ...p });

const weapon = (p: Omit<Part, 'kind' | 'icon'> & { icon?: string; damage: string; classes: ClassKey[] }): ItemDef =>
  def({ kind: 'weapon', slot: 'weapon', icon: 'item_sword', ...p });

const armor = (p: Omit<Part, 'kind'> & { slot: ItemDef['slot'] }): ItemDef =>
  def({ kind: 'armor', ...p });

// ── Weapons (first edition spirit; cleric blunt only, wizard dagger/staff/dart, thief light) ──────────────
const WEAPONS: ItemDef[] = [
  weapon({ key: 'dagger', name: 'Dagger', damage: '1d4', weight: 1, value: 2, icon: 'item_dagger', classes: FTW, shop: { minLevel: 1, qty: 3 } }),
  weapon({ key: 'dart', name: 'Dart', damage: '1d3', weight: 0.5, value: 1, icon: 'item_dagger', classes: FTW, ranged: true, stackLimit: 12, dropWeight: 4 }),
  weapon({ key: 'club', name: 'Club', damage: '1d6', weight: 3, value: 1, icon: 'item_mace', classes: FTC, dropWeight: 6, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'short_sword', name: 'Short Sword', damage: '1d6', weight: 3, value: 10, icon: 'item_sword', classes: FT, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'hand_axe', name: 'Hand Axe', damage: '1d6', weight: 3, value: 1, icon: 'item_axe', classes: FT, dropWeight: 8, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'long_sword', name: 'Long Sword', damage: '1d8', weight: 4, value: 15, icon: 'item_sword', classes: FT, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'two_handed_sword', name: 'Two-Handed Sword', damage: '1d10', weight: 15, value: 30, icon: 'item_sword', classes: FIGHTER, twoHanded: true, minFloor: 2, shop: { minLevel: 2, qty: 1 } }),
  weapon({ key: 'battle_axe', name: 'Battle Axe', damage: '1d8', weight: 7, value: 5, icon: 'item_axe', classes: FIGHTER, minFloor: 2, shop: { minLevel: 2, qty: 1 } }),
  weapon({ key: 'mace', name: 'Mace', damage: '1d6', weight: 6, value: 5, icon: 'item_mace', classes: FC, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'war_hammer', name: 'War Hammer', damage: '1d4', weight: 5, value: 2, icon: 'item_mace', classes: FC, shop: { minLevel: 1, qty: 1 } }),
  weapon({ key: 'flail', name: 'Flail', damage: '1d6', weight: 10, value: 3, icon: 'item_mace', classes: FC, minFloor: 2, shop: { minLevel: 2, qty: 1 } }),
  weapon({ key: 'quarterstaff', name: 'Quarterstaff', damage: '1d6', weight: 4, value: 1, icon: 'item_staff', classes: ALL, twoHanded: true, shop: { minLevel: 1, qty: 2 } }),
  weapon({ key: 'spear', name: 'Spear', damage: '1d6', weight: 5, value: 1, icon: 'item_staff', classes: FIGHTER, twoHanded: true, dropWeight: 6 }),
  weapon({ key: 'short_bow', name: 'Short Bow', damage: '1d6', weight: 2, value: 15, icon: 'item_bow', classes: FT, twoHanded: true, ranged: true, shop: { minLevel: 1, qty: 1 } }),
  weapon({ key: 'sling', name: 'Sling', damage: '1d4', weight: 0.5, value: 1, icon: 'item_bow', classes: FTC, ranged: true, shop: { minLevel: 1, qty: 2 } }),
];

// ── Armor (descending AC) ──────────────────────────────────────────────────────────────────────────────
const ARMORS: ItemDef[] = [
  armor({ key: 'leather_armor', name: 'Leather Armor', slot: 'armor', icon: 'item_armor', ac: 8, weight: 15, value: 5, classes: ALL.filter((c) => c !== 'wizard'), shop: { minLevel: 1, qty: 2 } }),
  armor({ key: 'studded_leather', name: 'Studded Leather', slot: 'armor', icon: 'item_armor', ac: 7, weight: 20, value: 15, classes: FTC, minFloor: 2, shop: { minLevel: 2, qty: 1 } }),
  armor({ key: 'scale_mail', name: 'Scale Mail', slot: 'armor', icon: 'item_armor', ac: 6, weight: 40, value: 45, classes: FC, minFloor: 2, shop: { minLevel: 2, qty: 1 } }),
  armor({ key: 'chain_mail', name: 'Chain Mail', slot: 'armor', icon: 'item_armor', ac: 5, weight: 30, value: 75, classes: FC, minFloor: 2, shop: { minLevel: 1, qty: 1 } }),
  armor({ key: 'banded_mail', name: 'Banded Mail', slot: 'armor', icon: 'item_armor', ac: 4, weight: 35, value: 90, classes: FC, minFloor: 4, shop: { minLevel: 4, qty: 1 } }),
  armor({ key: 'plate_mail', name: 'Plate Mail', slot: 'armor', icon: 'item_armor', ac: 3, weight: 45, value: 400, classes: FC, minFloor: 5, shop: { minLevel: 6, qty: 1 } }),
  def({ key: 'shield', name: 'Shield', kind: 'shield', slot: 'offhand', icon: 'item_shield', ac: -1, weight: 10, value: 10, classes: FTC, shop: { minLevel: 1, qty: 2 } }),
  armor({ key: 'helm', name: 'Helm', slot: 'helm', icon: 'item_helm', weight: 5, value: 12, classes: FTC, shop: { minLevel: 2, qty: 1 } }),
  armor({ key: 'cloak', name: 'Cloak', slot: 'cloak', icon: 'item_cloak', weight: 2, value: 5, classes: ALL, shop: { minLevel: 1, qty: 2 } }),
  armor({ key: 'boots', name: 'Boots', slot: 'boots', icon: 'item_boots', weight: 3, value: 8, classes: ALL, shop: { minLevel: 1, qty: 2 } }),
];

// ── Jewelry blanks: worthless until an affix is rolled ──────────────────────────────────────────────────
const JEWELRY: ItemDef[] = [
  def({ key: 'ring', name: 'Ring', kind: 'gear', slot: 'ring', icon: 'item_ring', weight: 0.1, value: 5, description: 'A plain band. Whatever power it holds is not visible to the eye.' }),
  def({ key: 'amulet', name: 'Amulet', kind: 'gear', slot: 'amulet', icon: 'item_amulet', weight: 0.2, value: 8, description: 'A pendant on a cord, worn smooth by other necks.' }),
];

// ── Adventuring gear ───────────────────────────────────────────────────────────────────────────────────
const GEAR: ItemDef[] = [
  def({ key: 'torch', name: 'Torch', kind: 'gear', slot: 'offhand', icon: 'item_torch', weight: 1, value: 1, stackLimit: 8, light: { radius: 4, burnSec: 600 }, tags: ['light'], dropWeight: 14, shop: { minLevel: 1, qty: 12 }, description: 'Burns for ten minutes held in the off hand, then it is ash. Light is a resource.' }),
  def({ key: 'lantern', name: 'Lantern', kind: 'gear', slot: 'offhand', icon: 'item_torch', weight: 2, value: 12, light: { radius: 6, burnSec: 1800, refuelable: true }, tags: ['light'], minFloor: 2, dropWeight: 4, shop: { minLevel: 2, qty: 1 }, description: 'Brighter and steadier than a torch. Refill it from a flask of oil.' }),
  def({ key: 'oil_flask', name: 'Flask of Oil', kind: 'gear', icon: 'item_potion_blue', weight: 1, value: 2, stackLimit: 8, tags: ['lamp_oil'], dropWeight: 8, shop: { minLevel: 2, qty: 6 } }),
  def({ key: 'ten_foot_pole', name: 'Ten-Foot Pole', kind: 'gear', icon: 'item_pole', weight: 7, value: 1, tags: ['probe'], dropWeight: 5, shop: { minLevel: 1, qty: 2 }, description: 'Poke the floor before you trust it.' }),
  def({ key: 'rope', name: 'Rope, 50 ft', kind: 'gear', icon: 'item_rope', weight: 8, value: 1, tags: ['climb'], dropWeight: 6, shop: { minLevel: 1, qty: 2 } }),
  def({ key: 'iron_spikes', name: 'Iron Spikes', kind: 'gear', icon: 'item_spikes', weight: 0.5, value: 1, stackLimit: 12, tags: ['wedge'], dropWeight: 6, shop: { minLevel: 1, qty: 12 }, description: 'Wedge a door open, or shut.' }),
  def({ key: 'thieves_tools', name: "Thieves' Tools", kind: 'gear', icon: 'item_tools', weight: 1, value: 30, classes: ['thief'], tags: ['lockpick'], dropWeight: 3, shop: { minLevel: 1, qty: 1 } }),
  def({ key: 'sack', name: 'Sack of Sand', kind: 'gear', icon: 'item_rope', weight: 10, value: 1, tags: ['pressure_weight'], dropWeight: 4, shop: { minLevel: 1, qty: 3 }, description: 'Dead weight you can set on a pressure plate in place of yourself.' }),
  def({ key: 'mirror', name: 'Steel Mirror', kind: 'gear', icon: 'item_gem', weight: 0.5, value: 10, tags: ['reflect'], minFloor: 2, dropWeight: 3, shop: { minLevel: 2, qty: 1 } }),
  def({ key: 'chalk', name: 'Chalk', kind: 'gear', icon: 'item_spikes', weight: 0.1, value: 1, stackLimit: 10, tags: ['mark'], dropWeight: 6, shop: { minLevel: 1, qty: 10 }, description: 'Mark the way you came, and the doors you have tried.' }),
];

// ── Consumables ────────────────────────────────────────────────────────────────────────────────────────
const sc = (key: string, name: string, spell: string, value: number, classes: ClassKey[], minFloor: number, minLevel: number): ItemDef =>
  def({ key, name, kind: 'consumable', icon: 'item_scroll', weight: 0.1, value, classes, stackLimit: 5, use: { type: 'cast', spell }, minFloor, dropWeight: 4, shop: { minLevel, qty: 2 } });

const CONSUMABLES: ItemDef[] = [
  def({ key: 'healing_potion', name: 'Potion of Healing', kind: 'consumable', icon: 'item_potion_red', weight: 0.5, value: 25, stackLimit: 5, use: { type: 'heal', dice: '1d8', bonus: 1 }, dropWeight: 24, shop: { minLevel: 1, qty: 5 } }),
  def({ key: 'extra_healing_potion', name: 'Potion of Extra Healing', kind: 'consumable', icon: 'item_potion_red', weight: 0.5, value: 100, stackLimit: 5, use: { type: 'heal', dice: '3d8', bonus: 3 }, minFloor: 4, dropWeight: 8, shop: { minLevel: 4, qty: 3 } }),
  def({ key: 'antidote', name: 'Antidote', kind: 'consumable', icon: 'item_potion_blue', weight: 0.5, value: 20, stackLimit: 5, use: { type: 'cure_poison' }, dropWeight: 10, shop: { minLevel: 1, qty: 3 } }),
  def({ key: 'speed_potion', name: 'Potion of Speed', kind: 'consumable', icon: 'item_potion_blue', weight: 0.5, value: 150, stackLimit: 5, use: { type: 'haste', pct: 50, durationSec: 40 }, minFloor: 3, dropWeight: 5 }),
  def({ key: 'scroll_recall', name: 'Scroll of Recall', kind: 'consumable', icon: 'item_scroll', weight: 0.1, value: 60, stackLimit: 5, use: { type: 'recall' }, dropWeight: 8, shop: { minLevel: 1, qty: 3 }, description: 'Returns the reader to the tavern. The way back down is still stairs.' }),
  def({ key: 'scroll_identify', name: 'Scroll of Identify', kind: 'consumable', icon: 'item_scroll', weight: 0.1, value: 40, stackLimit: 5, use: { type: 'identify' }, dropWeight: 12, shop: { minLevel: 1, qty: 4 } }),
  def({ key: 'scroll_remove_curse', name: 'Scroll of Remove Curse', kind: 'consumable', icon: 'item_scroll', weight: 0.1, value: 90, stackLimit: 5, use: { type: 'remove_curse' }, minFloor: 2, dropWeight: 6, shop: { minLevel: 3, qty: 2 } }),
  def({ key: 'scroll_light', name: 'Scroll of Light', kind: 'consumable', icon: 'item_scroll', weight: 0.1, value: 20, stackLimit: 5, use: { type: 'light', radius: 6, durationSec: 300 }, dropWeight: 10, shop: { minLevel: 1, qty: 3 } }),
  def({ key: 'holy_water', name: 'Holy Water', kind: 'consumable', icon: 'item_holy_water', weight: 1, value: 25, stackLimit: 5, use: { type: 'throw', dice: '2d4', vs: 'undead' }, tags: ['undead_bane'], dropWeight: 8, shop: { minLevel: 1, qty: 4 } }),
  def({ key: 'ration', name: 'Iron Rations', kind: 'consumable', icon: 'item_ration', weight: 2, value: 2, stackLimit: 10, use: { type: 'eat' }, dropWeight: 10, shop: { minLevel: 1, qty: 10 } }),
  // Spell scrolls. Spell keys are plain strings; the rules lane owns what they mean.
  sc('scroll_magic_missile', 'Scroll of Magic Missile', 'magic_missile', 50, WIZ, 1, 1),
  sc('scroll_sleep', 'Scroll of Sleep', 'sleep', 60, WIZ, 1, 1),
  sc('scroll_knock', 'Scroll of Knock', 'knock', 55, WIZ, 2, 2),
  sc('scroll_web', 'Scroll of Web', 'web', 90, WIZ, 3, 3),
  sc('scroll_fireball', 'Scroll of Fireball', 'fireball', 200, WIZ, 5, 5),
  sc('scroll_cure_light', 'Scroll of Cure Light Wounds', 'cure_light_wounds', 50, CLERIC, 1, 1),
  sc('scroll_bless', 'Scroll of Bless', 'bless', 45, CLERIC, 1, 1),
  sc('scroll_hold_person', 'Scroll of Hold Person', 'hold_person', 110, CLERIC, 3, 3),
];

// ── Treasure ───────────────────────────────────────────────────────────────────────────────────────────
const tr = (key: string, name: string, value: number, minFloor: number, dropWeight: number, stack = 1): ItemDef =>
  def({ key, name, kind: 'treasure', icon: 'item_gem', weight: stack > 1 ? 0.1 : 2, value, stackLimit: stack, minFloor, dropWeight });

const TREASURE: ItemDef[] = [
  tr('gem_agate', 'Banded Agate', 10, 1, 20, 20),
  tr('gem_garnet', 'Rough Garnet', 50, 2, 12, 20),
  tr('gem_pearl', 'Moon Pearl', 100, 3, 8, 20),
  tr('gem_ruby', 'Cut Ruby', 500, 5, 3, 20),
  tr('gem_black_diamond', 'Black Diamond', 1000, 8, 1, 20),
  tr('art_ewer', 'Silver Ewer', 100, 2, 6),
  tr('art_idol', 'Jade Idol', 250, 3, 5),
  tr('art_reliquary', 'Gilded Reliquary', 600, 5, 3),
  tr('art_mask', 'Funerary Gold Mask', 1200, 8, 1),
];

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────────────
const key = (k: string, name: string, description: string): ItemDef =>
  def({ key: k, name, kind: 'key', icon: 'item_key', weight: 0.1, value: 0, description });

const KEYS: ItemDef[] = [
  key('key_iron', 'Iron Key', 'Heavy and cold. It was made for one lock somewhere on this floor.'),
  key('key_bronze', 'Bronze Key', 'Green at the teeth.'),
  key('key_silver', 'Silver Key', 'Light, and warm to the touch for no reason.'),
  key('key_bone', 'Bone Key', 'Carved from something that once walked.'),
];

export const ITEM_DEFS: readonly ItemDef[] = [
  ...WEAPONS, ...ARMORS, ...JEWELRY, ...GEAR, ...CONSUMABLES, ...TREASURE, ...KEYS,
];

export const CATALOG: Readonly<Record<string, ItemDef>> = Object.fromEntries(ITEM_DEFS.map((d) => [d.key, d]));

export function getDef(defKey: string): ItemDef {
  const d = CATALOG[defKey];
  if (!d) throw new Error(`Unknown item def: ${defKey}`);
  return d;
}

export function hasDef(defKey: string): boolean {
  return defKey in CATALOG;
}

export function defsOfKind(kind: ItemDef['kind']): ItemDef[] {
  return ITEM_DEFS.filter((d) => d.kind === kind);
}

/** Which affix family a base item belongs to, or undefined if it cannot carry affixes. */
export function groupOf(d: ItemDef): ItemGroup | undefined {
  if (d.kind === 'weapon') return 'weapon';
  if (d.kind === 'shield') return 'shield';
  switch (d.slot) {
    case 'armor': return 'body';
    case 'helm': return 'helm';
    case 'cloak': return 'cloak';
    case 'boots': return 'boots';
    case 'ring': return 'ring';
    case 'amulet': return 'amulet';
    default: return undefined;
  }
}

/** True for base items that can roll above common (weapons, worn armor and jewelry). */
export function canBeMagic(d: ItemDef): boolean {
  return groupOf(d) !== undefined;
}

export function isJewelry(d: ItemDef): boolean {
  return d.slot === 'ring' || d.slot === 'amulet';
}

/** Build a plain, identified, common instance of a base item. */
export function instantiate(defKey: string, id: string, over: Partial<ItemInstance> = {}): ItemInstance {
  const d = getDef(defKey);
  const inst: ItemInstance = {
    id,
    defKey,
    rarity: 'common',
    plus: 0,
    affixes: [],
    identified: true,
    cursed: false,
    quantity: 1,
    ...over,
  };
  if (d.light && inst.charges === undefined) inst.charges = d.light.burnSec;
  return inst;
}
