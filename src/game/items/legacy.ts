import { instantiate } from './catalog';
import { Inventory, starterKit } from './inventory';
import type { Affix, ClassKey, ItemInstance } from './types';

/** Structural match for the old `InventoryItem` in QuestSystem.ts. */
export interface LegacyItem {
  id: string;
  type: string;
  label: string;
  bonus?: number;
  equipped?: boolean;
  floorFound?: number;
  timestamp?: number;
}

/** The slice of old player/save state this conversion can use. All optional. */
export interface LegacyStats {
  classKey?: string;
  gold?: number;
  /** Count of health potions the old build kept as a bare number. */
  healthPotions?: number;
  potions?: number;
  weaponBonus?: number;
  armorBonus?: number;
}

export interface LegacyResult {
  inventory: Inventory;
  /** Things that could not be carried over, with a reason. */
  skipped: string[];
}

const CLASSES: ClassKey[] = ['fighter', 'thief', 'wizard', 'cleric'];

const WEAPON_NAMES: Record<string, string> = {
  'short sword': 'short_sword', 'long sword': 'long_sword', 'war axe': 'battle_axe', mace: 'mace',
  dagger: 'dagger', staff: 'quarterstaff', 'weapon shard': 'short_sword',
};
const ARMOR_NAMES: Record<string, string> = {
  leather: 'leather_armor', 'chain mail': 'chain_mail', 'scale mail': 'scale_mail', 'plate armor': 'plate_mail',
  'armor shard': 'leather_armor',
};
const SPELL_SCROLLS: Record<string, string> = {
  MAGIC_MISSILE: 'scroll_magic_missile', FIREBALL: 'scroll_fireball', FROST_BOLT: 'scroll_sleep',
  CURE_WOUNDS: 'scroll_cure_light', BLESS: 'scroll_bless',
};

const TRAIT_AFFIX: Record<string, Affix> = {
  quick: { key: 'legacy_quick', label: 'Fleet', position: 'prefix', effect: { type: 'speed', pct: 8 } },
  drain: { key: 'legacy_drain', label: 'Hungering', position: 'prefix', effect: { type: 'lifeOnHit', amount: 1 } },
  cleave: { key: 'legacy_cleave', label: 'Honed', position: 'prefix', effect: { type: 'damage', amount: 1 } },
  arcane: { key: 'legacy_arcane', label: 'Keen', position: 'prefix', effect: { type: 'toHit', amount: 1 } },
  guard: { key: 'legacy_guard', label: 'Sturdy', position: 'prefix', effect: { type: 'ac', amount: 1 } },
  light: { key: 'legacy_light', label: 'Fleet', position: 'prefix', effect: { type: 'speed', pct: 5 } },
  ward: { key: 'legacy_ward', label: '', position: 'suffix', effect: { type: 'save', category: 'spells', amount: 1 } },
};

function parseLabel(label: string): { name: string; plus: number | undefined; tag: string | undefined } {
  const tag = /\[([^\]]+)\]/.exec(label)?.[1]?.trim().toLowerCase();
  const plusM = /([+-]\d+)/.exec(label);
  const name = label.replace(/\[[^\]]*\]/g, '').replace(/[+-]\d+/g, '').trim().toLowerCase();
  return { name, plus: plusM ? Number(plusM[1]) : undefined, tag };
}

const clampPlus = (n: number): number => Math.max(0, Math.min(3, Math.floor(n)));

/**
 * Best-effort conversion of the old save. Starts from the class starter kit, layers legacy gear on top,
 * and reports what it could not carry (stat tomes, quest items, a full pack).
 */
export function fromLegacyInventory(items: LegacyItem[], stats: LegacyStats = {}): LegacyResult {
  const classKey: ClassKey = CLASSES.includes(stats.classKey as ClassKey) ? (stats.classKey as ClassKey) : 'fighter';
  const inv = starterKit(classKey);
  const skipped: string[] = [];
  if (Number.isFinite(stats.gold)) inv.gold = Math.max(0, Math.floor(stats.gold as number));
  let sawWeapon = false;
  let sawArmor = false;
  let n = 0;
  const nextId = (defKey: string): string => `legacy-${defKey}-${n++}`;

  const give = (it: ItemInstance, wantEquip: boolean, label: string): void => {
    const added = inv.add(it);
    if (!added.ok) { skipped.push(`${label}: ${added.message}`); return; }
    if (wantEquip) {
      const found = inv.pack.find((p) => p && p.defKey === it.defKey && p.id === it.id);
      if (found) inv.equip(found.id);
    }
  };

  for (const li of items ?? []) {
    const type = String(li.type ?? '').toUpperCase();
    const { name, plus, tag } = parseLabel(String(li.label ?? ''));
    const bonus = clampPlus(li.bonus ?? plus ?? 0);
    const trait = tag ? TRAIT_AFFIX[tag.split(/\s+/)[0]] : undefined;

    if (type === 'WEAPON' || type === 'ARMOR') {
      const table = type === 'WEAPON' ? WEAPON_NAMES : ARMOR_NAMES;
      const defKey = table[name];
      if (!defKey) { skipped.push(`${li.label}: unknown ${type.toLowerCase()}`); continue; }
      if (type === 'WEAPON') sawWeapon = true; else sawArmor = true;
      const it = instantiate(defKey, nextId(defKey), {
        rarity: bonus > 0 || trait ? 'magic' : 'common',
        plus: bonus,
        affixes: trait ? [{ ...trait, effect: { ...trait.effect } }] : [],
      });
      give(it, !!li.equipped, li.label);
    } else if (type === 'SCROLL') {
      const key = /scroll of ([a-z_ ]+)/i.exec(li.label ?? '')?.[1]?.trim().replace(/\s+/g, '_').toUpperCase();
      const defKey = key ? SPELL_SCROLLS[key] : undefined;
      if (!defKey) { skipped.push(`${li.label}: unknown spell`); continue; }
      give(instantiate(defKey, nextId(defKey)), false, li.label);
    } else if (type === 'CONSUMABLE' || type === 'HEALTH_POTION') {
      if (/health potion|potion/i.test(li.label ?? '')) give(instantiate('healing_potion', nextId('healing_potion')), false, li.label);
      else skipped.push(`${li.label}: unknown consumable`);
    } else {
      skipped.push(`${li.label ?? li.id}: ${type.toLowerCase() || 'item'} has no equivalent`);
    }
  }

  // Bare potion counts from the old stat block.
  const potions = Math.max(0, Math.floor(stats.healthPotions ?? stats.potions ?? 0));
  if (potions > 0) {
    const it = instantiate('healing_potion', nextId('healing_potion'));
    it.quantity = Math.min(5, potions);
    give(it, false, 'potions');
    if (potions > 5) {
      const rest = instantiate('healing_potion', nextId('healing_potion'));
      rest.quantity = Math.min(5, potions - 5);
      give(rest, false, 'potions');
    }
  }

  // No old weapon or armor item marked equipped? Fold the bare bonus into the starter gear.
  const w = inv.equipment.weapon;
  if (w && !sawWeapon && (stats.weaponBonus ?? 0) > 0) {
    w.plus = clampPlus(stats.weaponBonus!);
    if (w.plus > 0) { w.rarity = 'magic'; w.identified = true; }
  }
  const a = inv.equipment.armor;
  if (a && !sawArmor && (stats.armorBonus ?? 0) > 0) {
    a.plus = clampPlus(stats.armorBonus!);
    if (a.plus > 0) { a.rarity = 'magic'; a.identified = true; }
  }
  return { inventory: inv, skipped };
}
