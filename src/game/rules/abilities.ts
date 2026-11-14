/**
 * Ability scores, first-edition style. Scores run 3 to 18; the tables are kept
 * small on purpose (three to five numbers per ability that the game can use).
 */
import type { ClassKey } from '../constants';
import { roll, type Rng } from './dice';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITY_KEYS: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export type AbilityScores = Record<AbilityKey, number>;

function clampScore(score: number): number {
  return Math.max(3, Math.min(18, Math.round(score)));
}

/** 4d6, drop the lowest die. */
export function rollAbilityScore(rng: Rng): number {
  const dice = [roll(rng, 1, 6), roll(rng, 1, 6), roll(rng, 1, 6), roll(rng, 1, 6)];
  dice.sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

export function rollAbilities(rng: Rng): AbilityScores {
  return {
    str: rollAbilityScore(rng),
    dex: rollAbilityScore(rng),
    con: rollAbilityScore(rng),
    int: rollAbilityScore(rng),
    wis: rollAbilityScore(rng),
    cha: rollAbilityScore(rng),
  };
}

// ── Strength ────────────────────────────────────────────────────────────────

export interface StrengthMods {
  toHit: number;
  damage: number;
}

export function strengthMods(str: number): StrengthMods {
  const s = clampScore(str);
  if (s <= 3) return { toHit: -3, damage: -1 };
  if (s <= 5) return { toHit: -2, damage: -1 };
  if (s <= 7) return { toHit: -1, damage: 0 };
  if (s <= 15) return { toHit: 0, damage: 0 };
  if (s === 16) return { toHit: 0, damage: 1 };
  if (s === 17) return { toHit: 1, damage: 1 };
  return { toHit: 1, damage: 2 };
}

// ── Dexterity ───────────────────────────────────────────────────────────────

export interface DexterityMods {
  /** Bonus to missile and spell-dart attack rolls. */
  missile: number;
  /**
   * Armor class adjustment on the descending scale: negative is better.
   * Feed this straight into `armorClass({ dexAdj })`.
   */
  acAdj: number;
}

export function dexterityMods(dex: number): DexterityMods {
  const d = clampScore(dex);
  if (d === 3) return { missile: -3, acAdj: 4 };
  if (d === 4) return { missile: -2, acAdj: 3 };
  if (d === 5) return { missile: -1, acAdj: 2 };
  if (d === 6) return { missile: 0, acAdj: 1 };
  if (d <= 14) return { missile: 0, acAdj: 0 };
  if (d === 15) return { missile: 0, acAdj: -1 };
  if (d === 16) return { missile: 1, acAdj: -2 };
  if (d === 17) return { missile: 2, acAdj: -3 };
  return { missile: 2, acAdj: -4 };
}

// ── Constitution ────────────────────────────────────────────────────────────

/** Hit points added to each hit die. Only fighters profit above +2. */
export function conHpBonus(con: number, classKey: ClassKey): number {
  const c = clampScore(con);
  if (c === 3) return -2;
  if (c <= 6) return -1;
  if (c <= 14) return 0;
  if (c === 15) return 1;
  if (c === 16) return 2;
  if (c === 17) return classKey === 'fighter' ? 3 : 2;
  return classKey === 'fighter' ? 4 : 2;
}

// ── Intelligence ────────────────────────────────────────────────────────────

export interface IntelligenceEffect {
  /** Percent chance a wizard learns a spell found in a book or scroll. */
  learnChance: number;
  /** Highest spell level the character may ever learn (first edition numbers). */
  maxSpellLevel: number;
  extraLanguages: number;
}

export function intelligenceEffect(int: number): IntelligenceEffect {
  const i = clampScore(int);
  if (i <= 8) return { learnChance: 20, maxSpellLevel: 3, extraLanguages: 0 };
  if (i === 9) return { learnChance: 35, maxSpellLevel: 4, extraLanguages: 1 };
  if (i <= 11) return { learnChance: 45, maxSpellLevel: 5, extraLanguages: i - 8 };
  if (i <= 13) return { learnChance: 55, maxSpellLevel: 6, extraLanguages: i - 8 };
  if (i <= 15) return { learnChance: 65, maxSpellLevel: 7, extraLanguages: i - 8 };
  if (i === 16) return { learnChance: 70, maxSpellLevel: 8, extraLanguages: 6 };
  if (i === 17) return { learnChance: 75, maxSpellLevel: 8, extraLanguages: 7 };
  return { learnChance: 85, maxSpellLevel: 9, extraLanguages: 8 };
}

// ── Wisdom ──────────────────────────────────────────────────────────────────

/** Saving-throw adjustment against mental effects (hold, charm, fear). */
export function wisdomSaveAdj(wis: number): number {
  const w = clampScore(wis);
  if (w === 3) return -3;
  if (w === 4) return -2;
  if (w <= 7) return -1;
  if (w <= 14) return 0;
  if (w === 15) return 1;
  if (w === 16) return 2;
  if (w === 17) return 3;
  return 4;
}

/**
 * Extra cleric spell slots from Wisdom, indexed by spell level minus one
 * (length 4). Cumulative, so WIS 14 gives two bonus first-level slots.
 */
export function wisdomBonusSlots(wis: number): number[] {
  const w = clampScore(wis);
  if (w <= 12) return [0, 0, 0, 0];
  if (w === 13) return [1, 0, 0, 0];
  if (w === 14) return [2, 0, 0, 0];
  if (w === 15) return [2, 1, 0, 0];
  if (w === 16) return [2, 2, 0, 0];
  if (w === 17) return [2, 2, 1, 0];
  return [2, 2, 1, 1];
}

// ── Charisma ────────────────────────────────────────────────────────────────

/** Reaction adjustment for merchants and talking carved faces. */
export function charismaReaction(cha: number): number {
  const c = clampScore(cha);
  if (c <= 4) return -2;
  if (c <= 7) return -1;
  if (c <= 12) return 0;
  if (c <= 15) return 1;
  if (c <= 17) return 2;
  return 3;
}

// ── Aggregates ──────────────────────────────────────────────────────────────

export interface AbilityModifiers {
  toHit: number;
  damage: number;
  missile: number;
  acAdj: number;
  hpPerLevel: number;
  wisSaveAdj: number;
  bonusSlots: number[];
  learnChance: number;
  reaction: number;
}

/** Everything the game needs from the six scores in one call. */
export function abilityModifiers(scores: AbilityScores, classKey: ClassKey): AbilityModifiers {
  const str = strengthMods(scores.str);
  const dex = dexterityMods(scores.dex);
  return {
    toHit: str.toHit,
    damage: str.damage,
    missile: dex.missile,
    acAdj: dex.acAdj,
    hpPerLevel: conHpBonus(scores.con, classKey),
    wisSaveAdj: wisdomSaveAdj(scores.wis),
    bonusSlots: classKey === 'cleric' ? wisdomBonusSlots(scores.wis) : [0, 0, 0, 0],
    learnChance: intelligenceEffect(scores.int).learnChance,
    reaction: charismaReaction(scores.cha),
  };
}

const PRIME: Record<ClassKey, AbilityKey> = {
  fighter: 'str',
  thief: 'dex',
  wizard: 'int',
  cleric: 'wis',
};

export function primeRequisite(classKey: ClassKey): AbilityKey {
  return PRIME[classKey];
}

/** +10 percent experience when the prime requisite is 16 or better. */
export function xpBonusPercent(classKey: ClassKey, scores: AbilityScores): number {
  return scores[PRIME[classKey]] >= 16 ? 10 : 0;
}
