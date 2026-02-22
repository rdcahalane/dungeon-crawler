export const TILE_SIZE = 32;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;

export const TILE = {
  WALL: 0,
  FLOOR: 1,
  STAIRS: 2,
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
} as const;

export const PLAYER_STATS = {
  BASE_HP: 100,
  BASE_ATTACK: 15,
  BASE_DEFENSE: 3,
  BASE_SPEED: 180,
  ATTACK_RANGE: 48,
  ATTACK_COOLDOWN: 400, // ms
  XP_PER_LEVEL: 100,
} as const;

export const ENEMY_TYPES = {
  BASIC: {
    key: "basic",
    color: COLORS.ENEMY_BASIC,
    hp: 30,
    attack: 8,
    defense: 0,
    speed: 80,
    xp: 15,
    size: 22,
    aggroRange: 160,
    attackRange: 20,
    attackCooldown: 1000,
  },
  FAST: {
    key: "fast",
    color: COLORS.ENEMY_FAST,
    hp: 18,
    attack: 6,
    defense: 0,
    speed: 140,
    xp: 20,
    size: 16,
    aggroRange: 200,
    attackRange: 16,
    attackCooldown: 600,
  },
  TANK: {
    key: "tank",
    color: COLORS.ENEMY_TANK,
    hp: 80,
    attack: 14,
    defense: 4,
    speed: 50,
    xp: 35,
    size: 28,
    aggroRange: 120,
    attackRange: 24,
    attackCooldown: 1500,
  },
} as const;

export type EnemyTypeKey = keyof typeof ENEMY_TYPES;

export const ITEM_TYPES = {
  HEALTH_POTION: { key: "health_potion", color: COLORS.HEALTH_POTION, label: "Health Potion" },
  WEAPON: { key: "weapon", color: COLORS.WEAPON, label: "Weapon Upgrade" },
  ARMOR: { key: "armor", color: COLORS.ARMOR, label: "Armor Shard" },
  XP_ORB: { key: "xp_orb", color: COLORS.XP_ORB, label: "XP Orb" },
} as const;

export type ItemTypeKey = keyof typeof ITEM_TYPES;
