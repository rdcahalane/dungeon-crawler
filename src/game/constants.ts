export const TILE_SIZE = 32;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;
export const FOG_RADIUS = 5; // tiles

export const TILE = {
  WALL: 0,
  FLOOR: 1,
  STAIRS: 2,
  SECRET_DOOR: 3, // renders as wall, passable when found
  TRAP: 4,        // renders as floor, triggers on step
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
    startingEquipment: 'Long Sword (+3 ATK), Chain Mail (+4 AC)',
    classAbility: 'Cleave — on kill, instantly attack an adjacent enemy',
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
    startingEquipment: 'Dagger (+1 ATK), Leather Armor (+2 AC)',
    classAbility: 'Sneak Attack — +1d6/2 levels when attacking from outside aggro range',
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
    startingEquipment: 'Staff (+2 ATK), Robe (+0 AC), Spellbook',
    classAbility: 'Arcane Recovery — mana regen 2/sec when not hit for 5s',
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
    startingEquipment: 'Mace (+2 ATK), Scale Mail (+3 AC), Holy Symbol',
    classAbility: 'Turn Undead — T key forces undead within 200px to flee',
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

export interface EnemyTypeDef {
  key: string;
  color: number;
  hp: number;
  attack: number;
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
  ignoresArmor?: boolean; // bypasses player defense
  immunePoison?: boolean;
  textureKey?: string;  // overrides default 'enemy' texture
}

export type EnemyTypeKey =
  | 'BASIC' | 'FAST' | 'TANK'
  | 'SKELETON' | 'ZOMBIE' | 'GIANT_RAT' | 'GIANT_SPIDER'
  | 'TROLL' | 'DARK_ELF' | 'GHOST' | 'MIMIC';

export const ENEMY_TYPES: Record<EnemyTypeKey, EnemyTypeDef> = {
  BASIC: {
    key: 'basic', color: COLORS.ENEMY_BASIC,
    hp: 30, attack: 8, defense: 0, speed: 80, xp: 15, size: 22,
    aggroRange: 160, attackRange: 20, attackCooldown: 1000,
  },
  FAST: {
    key: 'fast', color: COLORS.ENEMY_FAST,
    hp: 18, attack: 6, defense: 0, speed: 140, xp: 20, size: 16,
    aggroRange: 200, attackRange: 16, attackCooldown: 600,
  },
  TANK: {
    key: 'tank', color: COLORS.ENEMY_TANK,
    hp: 80, attack: 14, defense: 4, speed: 50, xp: 35, size: 28,
    aggroRange: 120, attackRange: 24, attackCooldown: 1500,
  },
  SKELETON: {
    key: 'skeleton', color: COLORS.ENEMY_SKELETON,
    hp: 25, attack: 10, defense: 2, speed: 70, xp: 20, size: 22,
    aggroRange: 200, attackRange: 20, attackCooldown: 900,
    isUndead: true, fleeOnTurnUndead: true, immunePoison: true,
  },
  ZOMBIE: {
    key: 'zombie', color: COLORS.ENEMY_ZOMBIE,
    hp: 60, attack: 14, defense: 2, speed: 40, xp: 25, size: 26,
    aggroRange: 150, attackRange: 22, attackCooldown: 1800,
    isUndead: true, fleeOnTurnUndead: true, immunePoison: true,
  },
  GIANT_RAT: {
    key: 'giant_rat', color: COLORS.ENEMY_GIANT_RAT,
    hp: 12, attack: 5, defense: 0, speed: 150, xp: 10, size: 16,
    aggroRange: 180, attackRange: 16, attackCooldown: 500,
  },
  GIANT_SPIDER: {
    key: 'giant_spider', color: COLORS.ENEMY_GIANT_SPIDER,
    hp: 20, attack: 7, defense: 1, speed: 100, xp: 18, size: 20,
    aggroRange: 170, attackRange: 18, attackCooldown: 700,
    poisonDmg: 3, poisonDuration: 5000,
  },
  TROLL: {
    key: 'troll', color: COLORS.ENEMY_TROLL,
    hp: 100, attack: 18, defense: 5, speed: 60, xp: 50, size: 30,
    aggroRange: 130, attackRange: 26, attackCooldown: 1200,
    regenRate: 2,
  },
  DARK_ELF: {
    key: 'dark_elf', color: COLORS.ENEMY_DARK_ELF,
    hp: 30, attack: 12, defense: 2, speed: 90, xp: 30, size: 22,
    aggroRange: 220, attackRange: 180, attackCooldown: 1500,
    isRanged: true,
  },
  GHOST: {
    key: 'ghost', color: COLORS.ENEMY_GHOST,
    hp: 25, attack: 15, defense: 0, speed: 80, xp: 40, size: 24,
    aggroRange: 160, attackRange: 20, attackCooldown: 1000,
    isUndead: true, fleeOnTurnUndead: true, ignoresArmor: true,
    immunePoison: true,
  },
  MIMIC: {
    key: 'mimic', color: COLORS.ENEMY_MIMIC,
    hp: 70, attack: 20, defense: 3, speed: 60, xp: 45, size: 28,
    aggroRange: 80, attackRange: 24, attackCooldown: 900,
    isMimic: true,
  },
};

// Floor-based enemy pools
export const FLOOR_ENEMY_POOLS: EnemyTypeKey[][] = [
  [],                                                               // idx 0 unused
  ['BASIC', 'GIANT_RAT', 'GIANT_SPIDER'],                          // floor 1-3
  ['BASIC', 'GIANT_RAT', 'GIANT_SPIDER'],
  ['BASIC', 'GIANT_RAT', 'GIANT_SPIDER'],
  ['FAST', 'SKELETON', 'DARK_ELF', 'BASIC'],                       // floor 4-6
  ['FAST', 'SKELETON', 'DARK_ELF', 'BASIC'],
  ['FAST', 'SKELETON', 'DARK_ELF', 'TANK'],
  ['ZOMBIE', 'GHOST', 'SKELETON', 'TANK'],                         // floor 7-9
  ['ZOMBIE', 'GHOST', 'SKELETON', 'DARK_ELF'],
  ['ZOMBIE', 'GHOST', 'SKELETON', 'TROLL'],
];
// Floor 10+: trolls, mimics, ghosts
export const FLOOR_10_PLUS_POOL: EnemyTypeKey[] = ['TROLL', 'MIMIC', 'GHOST', 'DARK_ELF'];

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

export type StatusEffectKey = 'POISONED' | 'SLOWED' | 'BLESSED' | 'SHIELDED';

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
