/**
 * The bestiary: one stat block per monster, in first-edition terms (hit dice,
 * descending AC, THAC0 from hit dice, damage dice per attack) plus the
 * real-time numbers the game needs (speed, ranges, cooldown).
 *
 * Hit points here are true first-edition scale (a goblin has about 4). The
 * integrator decides whether the player's hit points live on the same scale.
 * `xp` is game scale, comparable to `XP_GAME_SCALE`d class thresholds.
 *
 * Folklore creatures only. Nothing here is lifted from a published module.
 */
import type { EnemyTypeKey } from '../constants';
import type { SaveCategory } from './classes';
import { rollDice, type Rng } from './dice';

export type NewMonsterKey =
  | 'GHOUL'
  | 'WIGHT'
  | 'WRAITH'
  | 'GARGOYLE'
  | 'OOZE'
  | 'CULTIST'
  | 'BONE_KNIGHT'
  | 'GIANT_BAT'
  | 'HOLLOW_KING';

/** Large monsters: 24x24 or 32x32 sprites drawn at 48 or 64 pixels. They are placed by the large-spawn planner. */
export type LargeMonsterKey =
  | 'OGRE'
  | 'CAVE_BEAR'
  | 'GIANT_SCORPION'
  | 'BARROW_GIANT'
  | 'OSSUARY_HULK'
  | 'CAVE_WYRM';

export type MonsterKey = EnemyTypeKey | NewMonsterKey | LargeMonsterKey;

export interface MonsterAttack {
  name: string;
  /** Damage dice, for example "1d6". */
  dice: string;
  /** To-hit bonus on top of the monster's THAC0. */
  bonus?: number;
}

export interface BossPhase {
  /** Phase begins when hit points fall below this percent of maximum. */
  hpBelowPct: number;
  label: string;
  speedMult?: number;
  cooldownMult?: number;
  /** Monster to summon as the phase begins. */
  summon?: MonsterKey;
  summonCount?: number;
  message?: string;
}

export type MonsterSpecial =
  | { kind: 'poison'; save: SaveCategory; dps: number; durationMs: number }
  | { kind: 'paralysis'; save: SaveCategory; durationMs: number }
  /** Level drain, modeled as permanent maximum hit points lost until restored. */
  | { kind: 'drain'; maxHpPerHit: number; save?: SaveCategory }
  | { kind: 'regen'; hpPerSec: number; /** fire or acid stops it */ stoppedBy?: 'fire' | 'acid' }
  | { kind: 'ranged'; rangePx: number; projectile: string; keepsDistance?: boolean }
  | { kind: 'immune_normal_weapons'; minPlus: number; silverWorks?: boolean }
  | { kind: 'mimic'; revealRangePx: number }
  | { kind: 'incorporeal'; ignoresArmor: boolean }
  | { kind: 'summon'; monster: MonsterKey; everyMs: number; maxAlive: number }
  | { kind: 'corrode'; target: 'weapon' | 'armor'; chancePct: number }
  | { kind: 'caster'; spells: string[]; cooldownMs: number }
  | { kind: 'erratic' }
  | { kind: 'unturnable' }
  | { kind: 'phases'; phases: BossPhase[] };

export interface MonsterDef {
  key: MonsterKey;
  name: string;
  /** Hit dice; fractions are allowed for the small fry. */
  hd: number;
  hpDice: string;
  /** Descending armor class. */
  ac: number;
  thac0: number;
  attacks: MonsterAttack[];
  /** Pixels per second, on the same scale as the original ENEMY_TYPES. */
  speed: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  /** Game-scale experience. */
  xp: number;
  undead?: boolean;
  boss?: boolean;
  special?: MonsterSpecial[];
  /** 2..12; a morale check on 2d6 above this and the monster flees. 12 never flees. */
  morale: number;
  minFloor: number;
  maxFloor?: number;
  textureKey: string;
  /**
   * Display size in pixels, as in the original ENEMY_TYPES. 48 and 64 are the large monsters (24x24 and 32x32
   * sprites at 2x). For those, `attackRange` is the edge-to-edge reach in pixels, not a centre distance.
   */
  size: number;
  /** Spawn weight among its peers, default 1. Large monsters are rare: a floor gets at most one or two. */
  rarity?: number;
}

/** On-screen size from which a monster counts as large (a 24x24 sprite at 2x). */
export const LARGE_MONSTER_SIZE = 48;

export function isLargeMonster(def: Pick<MonsterDef, 'size'>): boolean {
  return def.size >= LARGE_MONSTER_SIZE;
}

/** Monster THAC0 from hit dice: 20 below one HD, then one better per HD, floor of 1. */
export function thac0ForHd(hd: number): number {
  if (hd < 1) return 20;
  return Math.max(1, 20 - Math.floor(hd));
}

type Raw = Omit<MonsterDef, 'thac0'>;

function monster(raw: Raw): MonsterDef {
  return { ...raw, thac0: thac0ForHd(raw.hd) };
}

export const MONSTERS: Record<MonsterKey, MonsterDef> = {
  // ── The original eleven, keys kept ────────────────────────────────────────
  BASIC: monster({
    key: 'BASIC', name: 'Goblin', hd: 1, hpDice: '1d8', ac: 6,
    attacks: [{ name: 'Rusty blade', dice: '1d6' }],
    speed: 80, aggroRange: 160, attackRange: 20, attackCooldownMs: 1300,
    xp: 15, morale: 7, minFloor: 1, maxFloor: 9, textureKey: 'enemy_basic', size: 22,
  }),
  FAST: monster({
    key: 'FAST', name: 'Kobold', hd: 1, hpDice: '1d4', ac: 7,
    attacks: [{ name: 'Short sword', dice: '1d4' }],
    speed: 140, aggroRange: 200, attackRange: 16, attackCooldownMs: 600,
    xp: 20, morale: 6, minFloor: 3, textureKey: 'enemy_fast', size: 16,
  }),
  TANK: monster({
    key: 'TANK', name: 'Orc Brute', hd: 3, hpDice: '3d8', ac: 5,
    attacks: [{ name: 'Great axe', dice: '1d10', bonus: 1 }],
    speed: 50, aggroRange: 120, attackRange: 24, attackCooldownMs: 1500,
    xp: 45, morale: 9, minFloor: 6, textureKey: 'enemy_tank', size: 28,
  }),
  SKELETON: monster({
    key: 'SKELETON', name: 'Skeleton', hd: 1, hpDice: '1d8', ac: 7,
    attacks: [{ name: 'Rusted sword', dice: '1d6' }],
    speed: 70, aggroRange: 200, attackRange: 20, attackCooldownMs: 900,
    xp: 20, undead: true, morale: 12, minFloor: 4,
    textureKey: 'enemy_skeleton', size: 22,
  }),
  ZOMBIE: monster({
    key: 'ZOMBIE', name: 'Zombie', hd: 2, hpDice: '2d8', ac: 8,
    attacks: [{ name: 'Clubbing fist', dice: '1d8' }],
    speed: 40, aggroRange: 150, attackRange: 22, attackCooldownMs: 1800,
    xp: 28, undead: true, morale: 12, minFloor: 7, textureKey: 'enemy_zombie', size: 26,
  }),
  GIANT_RAT: monster({
    key: 'GIANT_RAT', name: 'Giant Rat', hd: 0.5, hpDice: '1d4', ac: 7,
    attacks: [{ name: 'Bite', dice: '1d3' }],
    speed: 150, aggroRange: 180, attackRange: 16, attackCooldownMs: 900,
    xp: 8, morale: 5, minFloor: 1, maxFloor: 6, textureKey: 'enemy_giant_rat', size: 16,
  }),
  GIANT_SPIDER: monster({
    key: 'GIANT_SPIDER', name: 'Giant Spider', hd: 2, hpDice: '2d8', ac: 6,
    attacks: [{ name: 'Venomous bite', dice: '1d6' }],
    speed: 100, aggroRange: 170, attackRange: 18, attackCooldownMs: 1200,
    xp: 30, morale: 8, minFloor: 2,
    special: [{ kind: 'poison', save: 'death', dps: 1, durationMs: 3000 }],
    textureKey: 'enemy_giant_spider', size: 20,
  }),
  TROLL: monster({
    key: 'TROLL', name: 'Troll', hd: 6, hpDice: '6d8+6', ac: 4,
    attacks: [
      { name: 'Claw', dice: '1d4+1' },
      { name: 'Claw', dice: '1d4+1' },
      { name: 'Bite', dice: '1d8' },
    ],
    speed: 60, aggroRange: 130, attackRange: 26, attackCooldownMs: 1200,
    xp: 90, morale: 10, minFloor: 9,
    special: [{ kind: 'regen', hpPerSec: 1, stoppedBy: 'fire' }],
    textureKey: 'enemy_troll', size: 30,
  }),
  DARK_ELF: monster({
    key: 'DARK_ELF', name: 'Dark Elf', hd: 2, hpDice: '2d8', ac: 5,
    attacks: [{ name: 'Short bow', dice: '1d6' }],
    speed: 90, aggroRange: 220, attackRange: 180, attackCooldownMs: 1500,
    xp: 35, morale: 9, minFloor: 4,
    special: [{ kind: 'ranged', rangePx: 180, projectile: 'arrow', keepsDistance: true }],
    textureKey: 'enemy_dark_elf', size: 22,
  }),
  GHOST: monster({
    key: 'GHOST', name: 'Ghost', hd: 3, hpDice: '3d8', ac: 6,
    attacks: [{ name: 'Chilling touch', dice: '1d6' }],
    speed: 80, aggroRange: 160, attackRange: 20, attackCooldownMs: 1000,
    xp: 60, undead: true, morale: 12, minFloor: 7,
    special: [{ kind: 'incorporeal', ignoresArmor: true }],
    textureKey: 'enemy_ghost', size: 24,
  }),
  MIMIC: monster({
    key: 'MIMIC', name: 'Mimic', hd: 7, hpDice: '7d8', ac: 6,
    attacks: [{ name: 'Crushing slam', dice: '3d4' }],
    speed: 60, aggroRange: 80, attackRange: 24, attackCooldownMs: 900,
    xp: 110, morale: 12, minFloor: 10,
    special: [{ kind: 'mimic', revealRangePx: 80 }],
    textureKey: 'enemy_mimic', size: 28,
  }),

  // ── New folklore monsters ─────────────────────────────────────────────────
  GHOUL: monster({
    key: 'GHOUL', name: 'Ghoul', hd: 2, hpDice: '2d8', ac: 6,
    attacks: [
      { name: 'Claw', dice: '1d3' },
      { name: 'Claw', dice: '1d3' },
      { name: 'Bite', dice: '1d6' },
    ],
    speed: 90, aggroRange: 170, attackRange: 20, attackCooldownMs: 800,
    xp: 45, undead: true, morale: 12, minFloor: 5,
    special: [{ kind: 'paralysis', save: 'death', durationMs: 2500 }],
    textureKey: 'enemy_ghoul', size: 22,
  }),
  WIGHT: monster({
    key: 'WIGHT', name: 'Wight', hd: 3, hpDice: '3d8', ac: 5,
    attacks: [{ name: 'Grave touch', dice: '1d4' }],
    speed: 70, aggroRange: 190, attackRange: 20, attackCooldownMs: 1100,
    xp: 95, undead: true, morale: 12, minFloor: 8,
    special: [
      { kind: 'drain', maxHpPerHit: 3 },
      { kind: 'immune_normal_weapons', minPlus: 1, silverWorks: true },
    ],
    textureKey: 'enemy_wight', size: 24,
  }),
  WRAITH: monster({
    key: 'WRAITH', name: 'Wraith', hd: 4, hpDice: '4d8', ac: 4,
    attacks: [{ name: 'Withering touch', dice: '1d6' }],
    speed: 100, aggroRange: 200, attackRange: 20, attackCooldownMs: 1000,
    xp: 140, undead: true, morale: 12, minFloor: 9,
    special: [
      { kind: 'drain', maxHpPerHit: 4 },
      { kind: 'incorporeal', ignoresArmor: false },
      { kind: 'immune_normal_weapons', minPlus: 1, silverWorks: true },
    ],
    textureKey: 'enemy_wraith', size: 24,
  }),
  GARGOYLE: monster({
    key: 'GARGOYLE', name: 'Gargoyle', hd: 4, hpDice: '4d8', ac: 5,
    attacks: [
      { name: 'Claw', dice: '1d3' },
      { name: 'Claw', dice: '1d3' },
      { name: 'Bite', dice: '1d4' },
      { name: 'Horn', dice: '1d6' },
    ],
    speed: 75, aggroRange: 150, attackRange: 22, attackCooldownMs: 1100,
    xp: 150, morale: 11, minFloor: 6,
    special: [{ kind: 'immune_normal_weapons', minPlus: 1 }],
    textureKey: 'enemy_gargoyle', size: 28,
  }),
  OOZE: monster({
    key: 'OOZE', name: 'Corrosive Ooze', hd: 3, hpDice: '3d8', ac: 8,
    attacks: [{ name: 'Acid touch', dice: '2d6' }],
    speed: 25, aggroRange: 100, attackRange: 22, attackCooldownMs: 1500,
    xp: 70, morale: 12, minFloor: 4,
    special: [
      { kind: 'corrode', target: 'weapon', chancePct: 35 },
      { kind: 'corrode', target: 'armor', chancePct: 25 },
    ],
    textureKey: 'enemy_ooze', size: 24,
  }),
  CULTIST: monster({
    key: 'CULTIST', name: 'Cultist', hd: 2, hpDice: '2d8', ac: 8,
    attacks: [{ name: 'Hex bolt', dice: '1d6' }],
    speed: 85, aggroRange: 220, attackRange: 190, attackCooldownMs: 1600,
    xp: 55, morale: 8, minFloor: 5,
    special: [
      { kind: 'ranged', rangePx: 190, projectile: 'hex_bolt', keepsDistance: true },
      { kind: 'caster', spells: ['magic_missile', 'hold_person'], cooldownMs: 6000 },
    ],
    textureKey: 'enemy_cultist', size: 22,
  }),
  BONE_KNIGHT: monster({
    key: 'BONE_KNIGHT', name: 'Bone Knight', hd: 3, hpDice: '3d8', ac: 3,
    attacks: [{ name: 'Notched longsword', dice: '1d8', bonus: 1 }],
    speed: 65, aggroRange: 190, attackRange: 24, attackCooldownMs: 1000,
    xp: 85, undead: true, morale: 12, minFloor: 7,
    textureKey: 'enemy_bone_knight', size: 26,
  }),
  GIANT_BAT: monster({
    key: 'GIANT_BAT', name: 'Giant Bat', hd: 1, hpDice: '1d8', ac: 8,
    attacks: [{ name: 'Bite', dice: '1d4' }],
    speed: 170, aggroRange: 220, attackRange: 16, attackCooldownMs: 1000,
    xp: 18, morale: 7, minFloor: 1,
    special: [{ kind: 'erratic' }],
    textureKey: 'enemy_giant_bat', size: 16,
  }),
  HOLLOW_KING: monster({
    key: 'HOLLOW_KING', name: 'Hollow King', hd: 12, hpDice: '12d8', ac: 0,
    attacks: [
      { name: 'Crown touch', dice: '1d10', bonus: 2 },
    ],
    speed: 55, aggroRange: 320, attackRange: 28, attackCooldownMs: 1400,
    xp: 2500, undead: true, boss: true, morale: 12, minFloor: 12,
    special: [
      { kind: 'paralysis', save: 'death', durationMs: 3000 },
      { kind: 'immune_normal_weapons', minPlus: 1 },
      { kind: 'unturnable' },
      { kind: 'caster', spells: ['magic_missile', 'hold_person', 'fireball'], cooldownMs: 5000 },
      { kind: 'summon', monster: 'SKELETON', everyMs: 12000, maxAlive: 4 },
      {
        kind: 'phases',
        phases: [
          { hpBelowPct: 66, label: 'The Gathering Dark', summon: 'GHOUL', summonCount: 2, message: 'The crown hums and the dead rise to serve.' },
          { hpBelowPct: 33, label: 'The Burning Crown', speedMult: 1.4, cooldownMult: 0.7, summon: 'WRAITH', summonCount: 1, message: 'The Hollow King burns from within and the tomb shudders.' },
        ],
      },
    ],
    textureKey: 'enemy_hollow_king', size: 36,
  }),

  // ── Large monsters (48 and 64 pixels). Slow, heavy swings, rare. ───────────
  OGRE: monster({
    key: 'OGRE', name: 'Ogre', hd: 4, hpDice: '4d8+1', ac: 5,
    attacks: [{ name: 'Knotted club', dice: '1d10+1' }],
    speed: 55, aggroRange: 150, attackRange: 12, attackCooldownMs: 1700,
    xp: 75, morale: 10, minFloor: 4, maxFloor: 9,
    textureKey: 'enemy_ogre', size: 48, rarity: 1,
  }),
  CAVE_BEAR: monster({
    key: 'CAVE_BEAR', name: 'Cave Bear', hd: 5, hpDice: '5d8', ac: 6,
    attacks: [
      { name: 'Claw', dice: '1d6' },
      { name: 'Claw', dice: '1d6' },
      { name: 'Bite', dice: '1d8' },
    ],
    speed: 70, aggroRange: 140, attackRange: 12, attackCooldownMs: 1500,
    xp: 85, morale: 9, minFloor: 3, maxFloor: 8,
    textureKey: 'enemy_cave_bear', size: 48, rarity: 1,
  }),
  GIANT_SCORPION: monster({
    key: 'GIANT_SCORPION', name: 'Giant Scorpion', hd: 5, hpDice: '5d8', ac: 3,
    attacks: [
      { name: 'Pincer', dice: '1d10' },
      { name: 'Pincer', dice: '1d10' },
      { name: 'Sting', dice: '1d4' },
    ],
    speed: 75, aggroRange: 130, attackRange: 14, attackCooldownMs: 1600,
    xp: 105, morale: 9, minFloor: 5, maxFloor: 10,
    special: [{ kind: 'poison', save: 'death', dps: 2, durationMs: 4000 }],
    textureKey: 'enemy_giant_scorpion', size: 48, rarity: 1,
  }),
  BARROW_GIANT: monster({
    key: 'BARROW_GIANT', name: 'Barrow Giant', hd: 8, hpDice: '8d8', ac: 4,
    attacks: [{ name: 'Tree-trunk club', dice: '2d8' }],
    speed: 45, aggroRange: 170, attackRange: 16, attackCooldownMs: 2100,
    xp: 140, morale: 9, minFloor: 8, maxFloor: 12,
    textureKey: 'enemy_barrow_giant', size: 64, rarity: 0.6,
  }),
  OSSUARY_HULK: monster({
    key: 'OSSUARY_HULK', name: 'Ossuary Hulk', hd: 9, hpDice: '9d8', ac: 3,
    attacks: [
      { name: 'Bone fist', dice: '2d6' },
      { name: 'Bone fist', dice: '2d6' },
    ],
    speed: 40, aggroRange: 180, attackRange: 16, attackCooldownMs: 1900,
    xp: 190, undead: true, morale: 12, minFloor: 9, maxFloor: 12,
    textureKey: 'enemy_ossuary_hulk', size: 64, rarity: 0.5,
  }),
  CAVE_WYRM: monster({
    key: 'CAVE_WYRM', name: 'Cave Wyrm', hd: 10, hpDice: '10d8', ac: 2,
    attacks: [
      { name: 'Bite', dice: '2d8', bonus: 1 },
      { name: 'Claw', dice: '1d6' },
      { name: 'Tail sweep', dice: '1d10' },
    ],
    speed: 60, aggroRange: 200, attackRange: 18, attackCooldownMs: 2200,
    xp: 270, morale: 10, minFloor: 10, maxFloor: 12,
    special: [{ kind: 'caster', spells: ['fire_breath'], cooldownMs: 7000 }],
    textureKey: 'enemy_cave_wyrm', size: 64, rarity: 0.4,
  }),
};

export const MONSTER_KEYS = Object.keys(MONSTERS) as MonsterKey[];

export const NEW_MONSTER_KEYS: readonly NewMonsterKey[] = [
  'GHOUL', 'WIGHT', 'WRAITH', 'GARGOYLE', 'OOZE', 'CULTIST', 'BONE_KNIGHT', 'GIANT_BAT', 'HOLLOW_KING',
];

export const LARGE_MONSTER_KEYS: readonly LargeMonsterKey[] = [
  'OGRE', 'CAVE_BEAR', 'GIANT_SCORPION', 'BARROW_GIANT', 'OSSUARY_HULK', 'CAVE_WYRM',
];

/** Large monsters that may stand on `floor` (they are placed by the large-spawn planner, never scattered at random). */
export function largeMonstersForFloor(floor: number): LargeMonsterKey[] {
  return LARGE_MONSTER_KEYS.filter((k) => {
    const m = MONSTERS[k];
    return floor >= m.minFloor && (m.maxFloor === undefined || floor <= m.maxFloor);
  });
}

/** Texture keys A2 must provide for the new monsters. */
export const NEW_MONSTER_TEXTURE_KEYS: readonly string[] = NEW_MONSTER_KEYS.map((k) => MONSTERS[k].textureKey);

export function getMonster(key: MonsterKey): MonsterDef {
  return MONSTERS[key];
}

/** Regular (non-boss) monsters that may spawn on `floor`. */
export function monstersForFloor(floor: number): MonsterKey[] {
  return MONSTER_KEYS.filter((k) => {
    const m = MONSTERS[k];
    return !m.boss && floor >= m.minFloor && (m.maxFloor === undefined || floor <= m.maxFloor);
  });
}

export function rollMonsterHp(def: MonsterDef, rng: Rng): number {
  return Math.max(1, rollDice(rng, def.hpDice));
}

export function hasSpecial<K extends MonsterSpecial['kind']>(
  def: MonsterDef,
  kind: K,
): Extract<MonsterSpecial, { kind: K }> | undefined {
  return def.special?.find((s) => s.kind === kind) as Extract<MonsterSpecial, { kind: K }> | undefined;
}

/** Can this weapon hurt the monster at all? */
export function canHarm(def: MonsterDef, weapon: { plus: number; silver?: boolean }): boolean {
  const imm = hasSpecial(def, 'immune_normal_weapons');
  if (!imm) return true;
  if (weapon.plus >= imm.minPlus) return true;
  return !!(imm.silverWorks && weapon.silver);
}

/** Undead can be turned unless marked `unturnable`. */
export function isTurnable(def: MonsterDef): boolean {
  return !!def.undead && !hasSpecial(def, 'unturnable');
}
