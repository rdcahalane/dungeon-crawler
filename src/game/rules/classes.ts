/**
 * Character classes, first-edition style: THAC0, five saving throws, hit dice,
 * experience, titles, spell slots and thief skills, levels 1 to 12.
 *
 * Experience thresholds are the classic tables scaled by `XP_GAME_SCALE` so a
 * real-time game does not need two hundred goblins for level two. The raw
 * tables are exported as `XP_TABLE_RAW`.
 */
import type { ClassKey } from '../constants';
import type { AbilityKey } from './abilities';
import { roll, type Rng } from './dice';

export type { ClassKey };

export const CLASS_KEYS: readonly ClassKey[] = ['fighter', 'thief', 'wizard', 'cleric'];
export const MAX_LEVEL = 12;

export type SaveCategory = 'death' | 'petrify' | 'wands' | 'breath' | 'spells';
export const SAVE_CATEGORIES: readonly SaveCategory[] = ['death', 'petrify', 'wands', 'breath', 'spells'];

export type ThiefSkill =
  | 'findTraps'
  | 'removeTraps'
  | 'openLocks'
  | 'hearNoise'
  | 'moveSilently'
  | 'hideInShadows';
export const THIEF_SKILLS: readonly ThiefSkill[] = [
  'findTraps',
  'removeTraps',
  'openLocks',
  'hearNoise',
  'moveSilently',
  'hideInShadows',
];

export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';
export type WeaponKind =
  | 'dagger'
  | 'sword'
  | 'axe'
  | 'mace'
  | 'club'
  | 'hammer'
  | 'flail'
  | 'staff'
  | 'spear'
  | 'bow'
  | 'crossbow'
  | 'sling';

const ALL_WEAPONS: readonly WeaponKind[] = [
  'dagger', 'sword', 'axe', 'mace', 'club', 'hammer', 'flail', 'staff', 'spear', 'bow', 'crossbow', 'sling',
];

export interface ClassRules {
  key: ClassKey;
  name: string;
  hitDie: number;
  /** Last level that rolls a full hit die. Beyond it hit points are a flat number. */
  nameLevel: number;
  hpAfterNameLevel: number;
  prime: AbilityKey;
  armor: readonly ArmorCategory[];
  weapons: readonly WeaponKind[];
  /** Which spell list the class uses, if any. */
  casting: 'wizard' | 'cleric' | null;
}

export const CLASS_RULES: Record<ClassKey, ClassRules> = {
  fighter: {
    key: 'fighter', name: 'Fighter', hitDie: 10, nameLevel: 9, hpAfterNameLevel: 3, prime: 'str',
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ALL_WEAPONS, casting: null,
  },
  thief: {
    key: 'thief', name: 'Thief', hitDie: 6, nameLevel: 10, hpAfterNameLevel: 2, prime: 'dex',
    armor: ['light'], weapons: ['dagger', 'sword', 'club', 'sling', 'crossbow'], casting: null,
  },
  wizard: {
    key: 'wizard', name: 'Wizard', hitDie: 4, nameLevel: 11, hpAfterNameLevel: 1, prime: 'int',
    armor: [], weapons: ['dagger', 'staff', 'sling'], casting: 'wizard',
  },
  cleric: {
    key: 'cleric', name: 'Cleric', hitDie: 8, nameLevel: 9, hpAfterNameLevel: 2, prime: 'wis',
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['mace', 'club', 'hammer', 'flail', 'staff', 'sling'],
    casting: 'cleric',
  },
};

function lvl(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}

/** Expand `[fromLevel, value]` bands into a 12-entry array (index = level - 1). */
function bands(spec: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    let value = spec[0][1];
    for (const [from, v] of spec) if (level >= from) value = v;
    out.push(value);
  }
  return out;
}

// ── THAC0 ───────────────────────────────────────────────────────────────────

const THAC0_TABLE: Record<ClassKey, number[]> = {
  fighter: bands([[1, 20], [2, 19], [3, 18], [4, 17], [5, 16], [6, 15], [7, 14], [8, 13], [9, 12], [10, 11], [11, 10], [12, 9]]),
  cleric: bands([[1, 20], [4, 18], [7, 16], [10, 14]]),
  thief: bands([[1, 20], [5, 18], [9, 16]]),
  wizard: bands([[1, 20], [6, 19], [11, 18]]),
};

export function thac0For(classKey: ClassKey, level: number): number {
  return THAC0_TABLE[classKey][lvl(level) - 1];
}

// ── Saving throws ───────────────────────────────────────────────────────────

/** Rows are level bands; columns are death, petrify, wands, breath, spells. */
type SaveRow = readonly [number, number, number, number, number];

function saveBands(spec: ReadonlyArray<readonly [number, SaveRow]>): SaveRow[] {
  const out: SaveRow[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    let row = spec[0][1];
    for (const [from, r] of spec) if (level >= from) row = r;
    out.push(row);
  }
  return out;
}

const SAVE_TABLE: Record<ClassKey, SaveRow[]> = {
  fighter: saveBands([
    [1, [14, 15, 16, 17, 17]],
    [3, [13, 14, 15, 16, 16]],
    [5, [11, 12, 13, 13, 14]],
    [7, [10, 11, 12, 12, 13]],
    [9, [8, 9, 10, 9, 11]],
    [11, [7, 8, 9, 8, 10]],
  ]),
  cleric: saveBands([
    [1, [10, 13, 14, 16, 15]],
    [4, [9, 12, 13, 15, 14]],
    [7, [7, 10, 11, 13, 12]],
    [10, [6, 9, 10, 12, 11]],
  ]),
  thief: saveBands([
    [1, [13, 12, 14, 16, 15]],
    [5, [12, 11, 12, 15, 13]],
    [9, [11, 10, 10, 14, 11]],
  ]),
  wizard: saveBands([
    [1, [14, 13, 11, 15, 12]],
    [6, [13, 11, 9, 13, 10]],
    [11, [11, 9, 7, 11, 8]],
  ]),
};

const SAVE_INDEX: Record<SaveCategory, number> = { death: 0, petrify: 1, wands: 2, breath: 3, spells: 4 };

/** d20 must roll this or higher to save. */
export function saveTarget(classKey: ClassKey, level: number, category: SaveCategory): number {
  return SAVE_TABLE[classKey][lvl(level) - 1][SAVE_INDEX[category]];
}

// ── Hit points ──────────────────────────────────────────────────────────────

export function hitDie(classKey: ClassKey): number {
  return CLASS_RULES[classKey].hitDie;
}

/**
 * Hit points gained on reaching `level`. Level 1 is the maximum of the die.
 * Beyond the name level the gain is flat and ignores Constitution.
 * Always at least 1.
 */
export function hpGainForLevel(classKey: ClassKey, level: number, rng: Rng, conBonus = 0): number {
  const rules = CLASS_RULES[classKey];
  const l = Math.max(1, Math.floor(level));
  if (l === 1) return Math.max(1, rules.hitDie + conBonus);
  if (l <= rules.nameLevel) return Math.max(1, roll(rng, 1, rules.hitDie) + conBonus);
  return rules.hpAfterNameLevel;
}

// ── Experience ──────────────────────────────────────────────────────────────

/** Classic first-edition experience to reach levels 1..12. */
export const XP_TABLE_RAW: Record<ClassKey, number[]> = {
  fighter: [0, 2000, 4000, 8000, 18000, 35000, 70000, 125000, 250000, 500000, 750000, 1000000],
  cleric: [0, 1500, 3000, 6000, 13000, 27500, 55000, 110000, 225000, 450000, 675000, 900000],
  thief: [0, 1250, 2500, 5000, 10000, 20000, 42500, 70000, 110000, 160000, 220000, 440000],
  wizard: [0, 2500, 5000, 10000, 22500, 40000, 60000, 90000, 135000, 250000, 375000, 750000],
};

/** Raw table times this gives game-scale XP (fighter level 2 at 100). */
export const XP_GAME_SCALE = 0.05;

/** Game-scale XP needed to reach `level` (level 1 needs 0). */
export function xpForLevel(classKey: ClassKey, level: number): number {
  return Math.round(XP_TABLE_RAW[classKey][lvl(level) - 1] * XP_GAME_SCALE);
}

/** Level (1..12) for a game-scale XP total. */
export function levelForXp(classKey: ClassKey, xp: number): number {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (xp >= xpForLevel(classKey, l)) level = l;
  }
  return level;
}

// ── Titles ──────────────────────────────────────────────────────────────────

const TITLES: Record<ClassKey, string[]> = {
  fighter: ['Recruit', 'Veteran', 'Warrior', 'Swordsman', 'Hero', 'Swashbuckler', 'Myrmidon', 'Champion', 'Warlord', 'Lord', 'Banneret', 'High Lord'],
  thief: ['Cutpurse', 'Footpad', 'Robber', 'Burglar', 'Filcher', 'Sharper', 'Magsman', 'Thief', 'Master Thief', 'Crowned Thief', 'Guildmaster', 'Night King'],
  wizard: ['Apprentice', 'Conjurer', 'Magician', 'Enchanter', 'Warlock', 'Sorcerer', 'Necromancer', 'Wizard', 'Arch-Mage', 'Mage Lord', 'Sage', 'Grand Magus'],
  cleric: ['Acolyte', 'Adept', 'Deacon', 'Priest', 'Curate', 'Vicar', 'Canon', 'Lama', 'Patriarch', 'High Priest', 'Bishop', 'Divine Hand'],
};

export function titleFor(classKey: ClassKey, level: number): string {
  return TITLES[classKey][lvl(level) - 1];
}

// ── Spell slots ─────────────────────────────────────────────────────────────

/** Slots per spell level 1..4 for wizard levels 1..12 (spell levels above 4 are not in this game). */
const WIZARD_SLOTS: number[][] = [
  [1, 0, 0, 0], [2, 0, 0, 0], [2, 1, 0, 0], [3, 2, 0, 0], [4, 2, 1, 0], [4, 2, 2, 0],
  [4, 3, 2, 1], [4, 3, 3, 2], [4, 3, 3, 2], [4, 4, 3, 2], [4, 4, 4, 3], [4, 4, 4, 4],
];

const CLERIC_SLOTS: number[][] = [
  [1, 0, 0, 0], [2, 0, 0, 0], [2, 1, 0, 0], [3, 2, 0, 0], [3, 3, 1, 0], [3, 3, 2, 0],
  [3, 3, 2, 1], [3, 3, 3, 2], [4, 4, 3, 2], [4, 4, 3, 3], [5, 4, 4, 3], [6, 5, 5, 3],
];

/** Slots per spell level; index 0 is first-level spells. Length 4. Non-casters get zeros. */
export function spellSlots(classKey: ClassKey, level: number): number[] {
  const l = lvl(level) - 1;
  if (classKey === 'wizard') return [...WIZARD_SLOTS[l]];
  if (classKey === 'cleric') return [...CLERIC_SLOTS[l]];
  return [0, 0, 0, 0];
}

// ── Thief skills and the flat chances everyone else gets ────────────────────

/** Percent chance for non-thieves to find a secret door or hear a noise (one in six). */
export const FLAT_SKILL_CHANCE = 17;

const THIEF_TABLE: Record<ThiefSkill, number[]> = {
  findTraps: [25, 29, 33, 37, 42, 47, 52, 57, 62, 67, 72, 77],
  removeTraps: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75],
  openLocks: [26, 31, 36, 42, 48, 54, 60, 66, 72, 78, 83, 88],
  hearNoise: [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70],
  moveSilently: [15, 21, 27, 33, 40, 47, 55, 62, 70, 78, 86, 94],
  hideInShadows: [10, 15, 20, 25, 31, 37, 43, 49, 56, 63, 70, 77],
};

/**
 * Percent chance (0..100) to succeed at a skill. Non-thieves get a flat low
 * chance at `findTraps` and `hearNoise` and nothing at the rest.
 */
export function thiefSkill(classKey: ClassKey, level: number, skill: ThiefSkill): number {
  if (classKey === 'thief') return THIEF_TABLE[skill][lvl(level) - 1];
  return skill === 'findTraps' || skill === 'hearNoise' ? FLAT_SKILL_CHANCE : 0;
}

/** Chance to find a secret door or hidden mechanism when searching a tile. */
export function searchChance(classKey: ClassKey, level: number): number {
  return thiefSkill(classKey, level, 'findTraps');
}

/** Chance to hear something behind a door. */
export function hearNoiseChance(classKey: ClassKey, level: number): number {
  return thiefSkill(classKey, level, 'hearNoise');
}

// ── Equipment restrictions ──────────────────────────────────────────────────

export function canUseArmor(classKey: ClassKey, category: ArmorCategory): boolean {
  return CLASS_RULES[classKey].armor.includes(category);
}

export function canUseWeapon(classKey: ClassKey, kind: WeaponKind): boolean {
  return CLASS_RULES[classKey].weapons.includes(kind);
}
