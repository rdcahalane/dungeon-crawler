import { MONSTERS, monstersForFloor, hasSpecial } from "./rules/bestiary";
import { diceAverage } from "./rules/dice";

export const TILE_SIZE = 32;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;
export const FOG_RADIUS = 5; // tiles
/** The fixed final level, "The Tomb of the Hollow King". Taking its stairs down wins the game. */
export const TOMB_FLOOR = 13;

export const TILE = {
  WALL: 0,
  FLOOR: 1,
  STAIRS: 2,      // stairs DOWN (next floor)
  SECRET_DOOR: 3, // renders as wall, passable when found
  TRAP: 4,        // renders as floor, triggers on step
  STAIRS_UP: 5,   // stairs UP (previous floor / tavern)
} as const;

export type TileValue = (typeof TILE)[keyof typeof TILE];

export const COLORS = {
  WALL: 0x1a1a2e,
  WALL_EDGE: 0x16213e,
  FLOOR: 0x2d2d2d,
  FLOOR_ALT: 0x333333,
  STAIRS: 0xffd700,
  PLAYER: 0x4fc3f7,
  PLAYER_ATTACK: 0xffffff,
  ENEMY_BASIC: 0xe53935,
  ENEMY_FAST: 0xff6f00,
  ENEMY_TANK: 0x7b1fa2,
  HEALTH_POTION: 0x66bb6a,
  WEAPON: 0xffa726,
  ARMOR: 0x78909c,
  XP_ORB: 0xab47bc,
  HP_BAR_BG: 0x333333,
  HP_BAR: 0x4caf50,
  HP_BAR_LOW: 0xf44336,
  XP_BAR: 0x7e57c2,
  UI_BG: 0x121212,
  TEXT: 0xffffff,
  DAMAGE_TEXT: 0xff5252,
  HEAL_TEXT: 0x69f0ae,
  XP_TEXT: 0xab47bc,
  MANA_BAR: 0x1976d2,
  GOLD_TEXT: 0xffd700,
  // New enemy colors
  ENEMY_SKELETON: 0xe0e0e0,
  ENEMY_ZOMBIE: 0x558b2f,
  ENEMY_GIANT_RAT: 0x8d6e63,
  ENEMY_GIANT_SPIDER: 0x212121,
  ENEMY_TROLL: 0x2e7d32,
  ENEMY_DARK_ELF: 0x6a1b9a,
  ENEMY_GHOST: 0x80cbc4,
  ENEMY_MIMIC: 0xffd700,
  // Trap/chest
  TRAP_GLOW: 0xff1744,
  SECRET_GLOW: 0x448aff,
  CHEST_WOODEN: 0x795548,
  CHEST_IRON: 0x607d8b,
  CHEST_GOLDEN: 0xf9a825,
} as const;

// ── Legacy stats (kept for non-class fallback) ──────────────────────────────

export const PLAYER_STATS = {
  BASE_HP: 100,
  BASE_ATTACK: 15,
  BASE_DEFENSE: 3,
  BASE_SPEED: 180,
  ATTACK_RANGE: 48,
  ATTACK_COOLDOWN: 400,
  XP_PER_LEVEL: 100,
} as const;

export type WeaponTrait = 'cleaving' | 'quick' | 'vampiric' | 'arcane';
export type ArmorTrait = 'light' | 'reinforced' | 'warded';
export type EquipmentTrait = WeaponTrait | ArmorTrait;

// ── Character Classes ───────────────────────────────────────────────────────

export type ClassKey = 'fighter' | 'thief' | 'wizard' | 'cleric';

export interface ClassDef {
  key: ClassKey;
  name: string;
  hitDie: number;           // d4/d6/d8/d10
  babFormula: 'full' | 'threequarters' | 'half';
  fortGood: boolean;
  refGood: boolean;
  willGood: boolean;
  primaryStats: string[];
  startingEquipment: string;
  classAbility: string;
  classAbilityKey: string;
  startingMana: number;
  manaPerLevel: number;
  baseHp: number;           // HP at level 1 before CON mod
  baseAttackBonus: number;  // weapon bonus from starting gear
  baseArmorBonus: number;   // AC from starting armor
  spellKeys: SpellKey[];    // Q/W/E/R
  color: number;
}

export const CHARACTER_CLASSES: Record<ClassKey, ClassDef> = {
  fighter: {
    key: 'fighter',
    name: 'Fighter',
    hitDie: 10,
    babFormula: 'full',
    fortGood: true,
    refGood: false,
    willGood: false,
    primaryStats: ['str', 'con'],
    startingEquipment: 'Long Sword, Chain Mail, Shield, torches',
    classAbility: 'Cleave: on a kill, swing again at a neighbour. Hit dice d10.',
    classAbilityKey: 'cleave',
    startingMana: 0,
    manaPerLevel: 0,
    baseHp: 80,
    baseAttackBonus: 3,
    baseArmorBonus: 4,
    spellKeys: [],
    color: 0xb71c1c,
  },
  thief: {
    key: 'thief',
    name: 'Thief',
    hitDie: 6,
    babFormula: 'threequarters',
    fortGood: false,
    refGood: true,
    willGood: false,
    primaryStats: ['dex', 'int'],
    startingEquipment: 'Short Sword, Leather Armor, thieves\' tools, rope',
    classAbility: 'Backstab: double damage on a foe that has not noticed you.',
    classAbilityKey: 'sneak_attack',
    startingMana: 0,
    manaPerLevel: 0,
    baseHp: 55,
    baseAttackBonus: 1,
    baseArmorBonus: 2,
    spellKeys: [],
    color: 0x37474f,
  },
  wizard: {
    key: 'wizard',
    name: 'Wizard',
    hitDie: 4,
    babFormula: 'half',
    fortGood: false,
    refGood: false,
    willGood: true,
    primaryStats: ['int', 'dex'],
    startingEquipment: 'Dagger, Cloak, Spellbook, torches',
    classAbility: 'Memorized spells (rest to recover) and an endless Magic Dart.',
    classAbilityKey: 'arcane_recovery',
    startingMana: 40,
    manaPerLevel: 10,
    baseHp: 30,
    baseAttackBonus: 2,
    baseArmorBonus: 0,
    spellKeys: ['MAGIC_MISSILE', 'FIREBALL', 'FROST_BOLT', 'BLINK'],
    color: 0x1565c0,
  },
  cleric: {
    key: 'cleric',
    name: 'Cleric',
    hitDie: 8,
    babFormula: 'threequarters',
    fortGood: true,
    refGood: false,
    willGood: true,
    primaryStats: ['wis', 'con'],
    startingEquipment: 'Mace, Chain Mail, Shield, holy water',
    classAbility: 'Turn Undead (T) by the cleric table. Prays for spells.',
    classAbilityKey: 'turn_undead',
    startingMana: 30,
    manaPerLevel: 8,
    baseHp: 65,
    baseAttackBonus: 2,
    baseArmorBonus: 3,
    spellKeys: ['CURE_WOUNDS', 'BLESS', 'TURN_UNDEAD', 'DIVINE_SHIELD'],
    color: 0xf9a825,
  },
};

// ── Enemy Types ─────────────────────────────────────────────────────────────
//
// The numbers that matter (hit dice, AC, THAC0, attacks, XP, specials) live in `rules/bestiary.ts`. This table is
// derived from it and keeps only what presentation and the legacy code paths still read (colour, size, aggro).

export interface EnemyTypeDef {
  key: string;
  color: number;
  /** Average hit points (first-edition scale). Informational; `Enemy` rolls its own. */
  hp: number;
  /** Average damage of the first attack. Informational. */
  attack: number;
  /** Descending armor class. */
  defense: number;
  speed: number;
  xp: number;
  size: number;
  aggroRange: number;
  attackRange: number;
  attackCooldown: number;
  isUndead?: boolean;
  fleeOnTurnUndead?: boolean;
  regenRate?: number;   // hp/sec
  poisonDmg?: number;   // dps when poison triggers
  poisonDuration?: number; // ms
  isRanged?: boolean;   // attacks from range, keeps distance
  isMimic?: boolean;    // disguised as chest, reveals at aggro range
  ignoresArmor?: boolean; // bypasses player armor
  immunePoison?: boolean;
  textureKey?: string;  // overrides default 'enemy' texture
}

export type EnemyTypeKey =
  | 'BASIC' | 'FAST' | 'TANK'
  | 'SKELETON' | 'ZOMBIE' | 'GIANT_RAT' | 'GIANT_SPIDER'
  | 'TROLL' | 'DARK_ELF' | 'GHOST' | 'MIMIC'
  | 'GHOUL' | 'WIGHT' | 'WRAITH' | 'GARGOYLE' | 'OOZE' | 'CULTIST' | 'BONE_KNIGHT' | 'GIANT_BAT' | 'HOLLOW_KING';

const ENEMY_COLORS: Record<EnemyTypeKey, number> = {
  BASIC: COLORS.ENEMY_BASIC, FAST: COLORS.ENEMY_FAST, TANK: COLORS.ENEMY_TANK,
  SKELETON: COLORS.ENEMY_SKELETON, ZOMBIE: COLORS.ENEMY_ZOMBIE, GIANT_RAT: COLORS.ENEMY_GIANT_RAT,
  GIANT_SPIDER: COLORS.ENEMY_GIANT_SPIDER, TROLL: COLORS.ENEMY_TROLL, DARK_ELF: COLORS.ENEMY_DARK_ELF,
  GHOST: COLORS.ENEMY_GHOST, MIMIC: COLORS.ENEMY_MIMIC,
  GHOUL: 0x8bc34a, WIGHT: 0x9fa8da, WRAITH: 0xb39ddb, GARGOYLE: 0x90a4ae, OOZE: 0x76ff03,
  CULTIST: 0xd84315, BONE_KNIGHT: 0xcfd8dc, GIANT_BAT: 0x6d4c41, HOLLOW_KING: 0xffd54f,
};

function deriveEnemyType(key: EnemyTypeKey): EnemyTypeDef {
  const m = MONSTERS[key];
  const first = m.attacks[0];
  const regen = hasSpecial(m, 'regen');
  const poison = hasSpecial(m, 'poison');
  const incorporeal = hasSpecial(m, 'incorporeal');
  return {
    key: key.toLowerCase(),
    color: ENEMY_COLORS[key],
    hp: Math.round(diceAverage(m.hpDice)),
    attack: Math.round(first ? diceAverage(first.dice) : 1),
    defense: m.ac,
    speed: m.speed,
    xp: m.xp,
    size: m.size,
    aggroRange: m.aggroRange,
    attackRange: m.attackRange,
    attackCooldown: m.attackCooldownMs,
    isUndead: m.undead,
    fleeOnTurnUndead: m.undead && !hasSpecial(m, 'unturnable'),
    regenRate: regen?.hpPerSec,
    poisonDmg: poison?.dps,
    poisonDuration: poison?.durationMs,
    isRanged: !!hasSpecial(m, 'ranged'),
    isMimic: !!hasSpecial(m, 'mimic'),
    ignoresArmor: incorporeal?.ignoresArmor,
    immunePoison: m.undead,
    textureKey: m.textureKey,
  };
}

export const ENEMY_TYPES = Object.fromEntries(
  (Object.keys(MONSTERS) as EnemyTypeKey[]).map((k) => [k, deriveEnemyType(k)]),
) as Record<EnemyTypeKey, EnemyTypeDef>;

/**
 * Monsters that can be placed at random on `floor`: the bestiary's floor window, minus mimics (they come from
 * chests) and, on floor 1, anything above one hit die. From floor 7 the one-hit-die fodder drops out.
 */
export function enemyPoolForFloor(floor: number): EnemyTypeKey[] {
  const pool = monstersForFloor(floor).filter((k) => {
    if (k === 'MIMIC') return false;
    const hd = MONSTERS[k].hd;
    if (floor <= 1) return hd <= 1;
    if (floor >= 7) return hd > 1;
    return true;
  });
  return pool.length > 0 ? pool : ['BASIC'];
}

// Floor-based enemy pools (index = floor; idx 0 unused), now derived from the bestiary windows.
export const FLOOR_ENEMY_POOLS: EnemyTypeKey[][] = [[], ...Array.from({ length: 9 }, (_, i) => enemyPoolForFloor(i + 1))];
// Floors 10 to 12 (the tomb on 13 is fixed).
export const FLOOR_10_PLUS_POOL: EnemyTypeKey[] = enemyPoolForFloor(11);

// ── Spells ──────────────────────────────────────────────────────────────────

export type SpellKey =
  | 'MAGIC_MISSILE' | 'FIREBALL' | 'FROST_BOLT' | 'BLINK'
  | 'CURE_WOUNDS' | 'BLESS' | 'TURN_UNDEAD' | 'DIVINE_SHIELD';

export interface SpellDef {
  key: SpellKey;
  name: string;
  manaCost: number;
  cooldown: number;  // ms
  classKey: ClassKey;
  hotkey: 'Q' | 'W' | 'E' | 'R';
  description: string;
  color: number;
}

export const SPELLS: Record<SpellKey, SpellDef> = {
  MAGIC_MISSILE: {
    key: 'MAGIC_MISSILE', name: 'Magic Missile', manaCost: 10, cooldown: 500,
    classKey: 'wizard', hotkey: 'Q',
    description: 'Deals 3d6 damage to nearest enemy (auto-hits)',
    color: 0xffffff,
  },
  FIREBALL: {
    key: 'FIREBALL', name: 'Fireball', manaCost: 25, cooldown: 2000,
    classKey: 'wizard', hotkey: 'W',
    description: 'AoE explosion at cursor — 3d6+5 damage in 100px radius',
    color: 0xff6f00,
  },
  FROST_BOLT: {
    key: 'FROST_BOLT', name: 'Frost Bolt', manaCost: 15, cooldown: 1000,
    classKey: 'wizard', hotkey: 'E',
    description: 'Projectile: 2d6+3 damage + slows target for 4s',
    color: 0x80d8ff,
  },
  BLINK: {
    key: 'BLINK', name: 'Blink', manaCost: 20, cooldown: 1500,
    classKey: 'wizard', hotkey: 'R',
    description: 'Teleport to cursor position (must be floor tile)',
    color: 0xce93d8,
  },
  CURE_WOUNDS: {
    key: 'CURE_WOUNDS', name: 'Cure Wounds', manaCost: 10, cooldown: 1000,
    classKey: 'cleric', hotkey: 'Q',
    description: 'Heals 3d6 + level HP',
    color: 0x69f0ae,
  },
  BLESS: {
    key: 'BLESS', name: 'Bless', manaCost: 15, cooldown: 3000,
    classKey: 'cleric', hotkey: 'W',
    description: '+2 attack and saves for 30s',
    color: 0xffd700,
  },
  TURN_UNDEAD: {
    key: 'TURN_UNDEAD', name: 'Turn Undead', manaCost: 10, cooldown: 2000,
    classKey: 'cleric', hotkey: 'E',
    description: 'Forces all undead within 200px to flee for 10s',
    color: 0xfff9c4,
  },
  DIVINE_SHIELD: {
    key: 'DIVINE_SHIELD', name: 'Divine Shield', manaCost: 20, cooldown: 5000,
    classKey: 'cleric', hotkey: 'R',
    description: '+10 defense for 30s',
    color: 0x7e57c2,
  },
};

// ── Trap Types ──────────────────────────────────────────────────────────────

export type TrapTypeKey = 'DART' | 'POISON_NEEDLE' | 'PIT' | 'FIRE_GLYPH' | 'ALARM';

export interface TrapDef {
  key: TrapTypeKey;
  saveStat: 'reflex' | 'fort' | 'none';
  dc: number;
  damage: number[];  // [sides, count] for XdY, e.g. [6, 1] = 1d6
  effect?: 'POISONED' | 'SLOWED' | 'ALARMED';
  effectDuration?: number;
  description: string;
  color: number;
}

export const TRAP_TYPES: Record<TrapTypeKey, TrapDef> = {
  DART: {
    key: 'DART', saveStat: 'reflex', dc: 13, damage: [6, 1],
    description: 'A hidden dart fires!', color: 0xffa726,
  },
  POISON_NEEDLE: {
    key: 'POISON_NEEDLE', saveStat: 'fort', dc: 14, damage: [0, 0],
    effect: 'POISONED', effectDuration: 8000,
    description: 'A poisoned needle pricks you!', color: 0x4caf50,
  },
  PIT: {
    key: 'PIT', saveStat: 'reflex', dc: 12, damage: [6, 2],
    description: 'The floor gives way!', color: 0x795548,
  },
  FIRE_GLYPH: {
    key: 'FIRE_GLYPH', saveStat: 'reflex', dc: 15, damage: [6, 3],
    description: 'Fire erupts from the floor!', color: 0xff1744,
  },
  ALARM: {
    key: 'ALARM', saveStat: 'none', dc: 0, damage: [0, 0],
    effect: 'ALARMED',
    description: 'An alarm rings! Nearby enemies are alerted!', color: 0xffeb3b,
  },
};

// ── Status Effects ───────────────────────────────────────────────────────────

export type StatusEffectKey = 'POISONED' | 'SLOWED' | 'BLESSED' | 'SHIELDED' | 'RUSHED' | 'HELD';

export interface StatusEffectDef {
  key: StatusEffectKey;
  label: string;
  color: number;
  icon: string;
}

export const STATUS_EFFECT_DEFS: Record<StatusEffectKey, StatusEffectDef> = {
  POISONED: { key: 'POISONED', label: 'Poisoned', color: 0x4caf50, icon: 'P' },
  SLOWED: { key: 'SLOWED', label: 'Slowed', color: 0x0288d1, icon: 'S' },
  BLESSED: { key: 'BLESSED', label: 'Blessed', color: 0xffd700, icon: 'B' },
  SHIELDED: { key: 'SHIELDED', label: 'Shielded', color: 0x7e57c2, icon: 'Sh' },
  RUSHED: { key: 'RUSHED', label: 'Rushed', color: 0xffd166, icon: 'R' },
  HELD: { key: 'HELD', label: 'Held', color: 0xb0bec5, icon: 'H' },
};

export interface StatusEffect {
  key: StatusEffectKey;
  duration: number;  // ms remaining
  value?: number;    // magnitude (e.g. poison dmg/sec)
}

// ── Items ────────────────────────────────────────────────────────────────────

export const ITEM_TYPES = {
  HEALTH_POTION: { key: 'health_potion', color: COLORS.HEALTH_POTION, label: 'Health Potion' },
  WEAPON: { key: 'weapon', color: COLORS.WEAPON, label: 'Weapon Upgrade' },
  ARMOR: { key: 'armor', color: COLORS.ARMOR, label: 'Armor Shard' },
  XP_ORB: { key: 'xp_orb', color: COLORS.XP_ORB, label: 'XP Orb' },
  GOLD: { key: 'gold', color: COLORS.GOLD_TEXT, label: 'Gold' },
  SCROLL: { key: 'scroll', color: 0xffe082, label: 'Scroll' },
  STAT_TOME: { key: 'stat_tome', color: 0xf48fb1, label: 'Stat Tome' },
} as const;

export type ItemTypeKey = keyof typeof ITEM_TYPES;

// ── Chest Tiers ───────────────────────────────────────────────────────────────

export type ChestTier = 'wooden' | 'iron' | 'golden';
export type ChestState = 'locked' | 'trapped' | 'open';

export interface ChestSpawn {
  tx: number;
  ty: number;
  tier: ChestTier;
  isMimic?: boolean;
  trapped?: TrapTypeKey;
}

export interface TrapSpawn {
  tx: number;
  ty: number;
  type: TrapTypeKey;
  triggered: boolean;
}

// ── Floor Themes ─────────────────────────────────────────────────────────────

export interface FloorTheme {
  name: string;
  desc: string;   // atmospheric flavour text
  floorBase: number;
  floorGrout: number;
  floorStones: [number, number, number, number];
  wallBase: number;
  wallFace: number;
  wallHi: number;
  wallLo: number;
  fogColor: number;  // tint applied to torch glow
}

export const FLOOR_THEMES: FloorTheme[] = [
  // Theme 0: Wet Cave (floors 1-3)
  {
    name: 'Wet Cave',
    desc: 'Water drips echo through slick stone passages.',
    floorBase: 0x111820, floorGrout: 0x0b1018,
    floorStones: [0x1e2a3a, 0x192434, 0x1b2838, 0x1f2d3f],
    wallBase: 0x0b1018, wallFace: 0x26374e, wallHi: 0x344e6a, wallLo: 0x121e2c,
    fogColor: 0x2244aa,
  },
  // Theme 1: Dry Cave (floors 4-6)
  {
    name: 'Dry Cave',
    desc: 'Ancient dust and stale heat fill the air.',
    floorBase: 0x1c1510, floorGrout: 0x120e08,
    floorStones: [0x2e2820, 0x28221a, 0x2a241c, 0x2c2618],
    wallBase: 0x110d08, wallFace: 0x4e3f30, wallHi: 0x6a5642, wallLo: 0x2e2216,
    fogColor: 0xff8c00,
  },
  // Theme 2: Dungeon (floors 7-9)
  {
    name: 'Dungeon',
    desc: 'Manmade walls of cold dressed stone surround you.',
    floorBase: 0x131320, floorGrout: 0x0c0c16,
    floorStones: [0x28283e, 0x23233a, 0x25253e, 0x27273c],
    wallBase: 0x0a0a16, wallFace: 0x35354e, wallHi: 0x48486e, wallLo: 0x1c1c2e,
    fogColor: 0xcc4400,
  },
  // Theme 3: Deep Dungeon (floors 10+)
  {
    name: 'Deep Dungeon',
    desc: 'Ancient magic crackles through the abyssal dark.',
    floorBase: 0x0e0a16, floorGrout: 0x07050c,
    floorStones: [0x1e1428, 0x1a1222, 0x1c1426, 0x201628],
    wallBase: 0x080510, wallFace: 0x2a1a40, wallHi: 0x3e2858, wallLo: 0x160e24,
    fogColor: 0x9900cc,
  },
];

export function getFloorThemeIdx(floor: number): number {
  if (floor <= 3) return 0;
  if (floor <= 6) return 1;
  if (floor <= 9) return 2;
  return 3;
}

// ── Tavern ────────────────────────────────────────────────────────────────────

export const TAVERN_W = 30;  // tiles
export const TAVERN_H = 18;

// ── Ability Score Helpers ─────────────────────────────────────────────────────

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function goodSave(level: number, mod: number): number {
  return 2 + Math.floor(level / 2) + mod;
}

export function poorSave(level: number, mod: number): number {
  return Math.floor(level / 3) + mod;
}

export function calcBAB(level: number, formula: 'full' | 'threequarters' | 'half'): number {
  switch (formula) {
    case 'full': return level;
    case 'threequarters': return Math.floor(level * 3 / 4);
    case 'half': return Math.floor(level / 2);
  }
}
