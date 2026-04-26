import { ArmorTrait, ChestTier, EquipmentTrait, WeaponTrait } from "../constants";

export interface LootResult {
  gold: number;
  items: LootItem[];
}

export interface LootItem {
  type: string;       // item type key
  label: string;
  bonus?: number;     // e.g. +1/+2/+3 for weapons/armor
  trait?: EquipmentTrait;
  statKey?: string;   // for stat tomes: 'str','dex',etc.
  spellKey?: string;  // for scrolls
  value?: number;     // numeric value (hp heal, xp gain, etc.)
}

function d(sides: number, count = 1): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

const SCROLL_SPELLS = ['MAGIC_MISSILE', 'FIREBALL', 'FROST_BOLT', 'CURE_WOUNDS', 'BLESS'];
const NAMED_WEAPONS = ['Short Sword', 'Long Sword', 'War Axe', 'Mace', 'Dagger', 'Staff'];
const NAMED_ARMORS = ['Leather', 'Chain Mail', 'Scale Mail', 'Plate Armor'];
const WEAPON_TRAITS: Record<string, { trait: WeaponTrait; tag: string }> = {
  'Short Sword': { trait: 'quick', tag: 'Quick' },
  'Long Sword': { trait: 'vampiric', tag: 'Drain' },
  'War Axe': { trait: 'cleaving', tag: 'Cleave' },
  'Mace': { trait: 'vampiric', tag: 'Drain' },
  'Dagger': { trait: 'quick', tag: 'Quick' },
  'Staff': { trait: 'arcane', tag: 'Arcane' },
};
const ARMOR_TRAITS: Record<string, { trait: ArmorTrait; tag: string }> = {
  Leather: { trait: 'light', tag: 'Light' },
  'Chain Mail': { trait: 'reinforced', tag: 'Guard' },
  'Scale Mail': { trait: 'warded', tag: 'Ward' },
  'Plate Armor': { trait: 'reinforced', tag: 'Guard' },
};

export class LootTable {
  static rollLoot(floor: number, tier: ChestTier): LootResult {
    const gold = LootTable.rollGold(floor, tier);
    const items = LootTable.rollItems(floor, tier);
    return { gold, items };
  }

  private static rollGold(floor: number, tier: ChestTier): number {
    switch (tier) {
      case 'wooden': return d(8, 2) + d(4, floor);      // 2-16 + floor scaling
      case 'iron':   return d(12, 3) + d(6, floor);     // 3-36 + floor scaling
      case 'golden': return d(20, 5) + d(10, floor);    // 5-100 + floor scaling
    }
  }

  private static rollItems(floor: number, tier: ChestTier): LootItem[] {
    const items: LootItem[] = [];

    // Base item count by tier
    const count = tier === 'golden' ? d(3) + 1 : tier === 'iron' ? d(2) + 1 : d(2);

    for (let i = 0; i < count; i++) {
      const item = LootTable.rollSingleItem(floor, tier);
      if (item) items.push(item);
    }

    return items;
  }

  private static rollSingleItem(floor: number, tier: ChestTier): LootItem | null {
    const roll = Math.random();

    // Chance table based on tier and floor
    if (tier === 'golden' && floor >= 8 && roll < 0.15) {
      // Stat tome
      const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const statKey = stats[Math.floor(Math.random() * stats.length)];
      return { type: 'STAT_TOME', label: `Tome of ${statKey.toUpperCase()}`, statKey };
    }

    if ((tier === 'iron' || tier === 'golden') && floor >= 4 && roll < 0.25) {
      // Named weapon or armor
      if (Math.random() < 0.5) {
        const bonus = floor >= 7 ? d(3) : floor >= 4 ? d(2) : 1;
        const name = NAMED_WEAPONS[Math.floor(Math.random() * NAMED_WEAPONS.length)];
        const trait = WEAPON_TRAITS[name];
        return { type: 'WEAPON', label: `${name} +${bonus} [${trait.tag}]`, bonus, trait: trait.trait };
      } else {
        const bonus = floor >= 7 ? d(3) : floor >= 4 ? d(2) : 1;
        const name = NAMED_ARMORS[Math.floor(Math.random() * NAMED_ARMORS.length)];
        const trait = ARMOR_TRAITS[name];
        return { type: 'ARMOR', label: `${name} +${bonus} [${trait.tag}]`, bonus, trait: trait.trait };
      }
    }

    if (floor >= 2 && roll < 0.2) {
      // Scroll
      const spellKey = SCROLL_SPELLS[Math.floor(Math.random() * SCROLL_SPELLS.length)];
      return { type: 'SCROLL', label: `Scroll of ${spellKey.replace('_', ' ')}`, spellKey };
    }

    // Common items
    const commonRoll = Math.random();
    if (commonRoll < 0.35) {
      return { type: 'HEALTH_POTION', label: 'Health Potion', value: 30 + floor * 5 };
    } else if (commonRoll < 0.55) {
      return { type: 'XP_ORB', label: 'XP Orb', value: 40 + floor * 10 };
    } else if (commonRoll < 0.70) {
      return { type: 'WEAPON', label: 'Weapon Shard +1 [Quick]', bonus: 1, trait: 'quick' };
    } else if (commonRoll < 0.85) {
      return { type: 'ARMOR', label: 'Armor Shard +1 [Guard]', bonus: 1, trait: 'reinforced' };
    } else {
      // Extra gold
      return null;
    }
  }
}
