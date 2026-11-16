/**
 * Combat resolution: to-hit, damage, saving throws, turning undead, initiative,
 * armor class and the thief's backstab. Descending armor class throughout:
 * lower is better, and AC 10 is a person in their shirt.
 */
import type { ClassKey } from '../constants';
import { saveTarget, type SaveCategory } from './classes';
import { d20, roll, parseDice, type DiceSpec, type Rng } from './dice';

// ── To-hit ──────────────────────────────────────────────────────────────────

export interface AttackInput {
  thac0: number;
  /** Target armor class, descending (lower is harder to hit). */
  targetAc: number;
  /** Strength, magic, bless and so on. Positive helps the attacker. */
  toHitBonus?: number;
}

export interface AttackResult {
  hit: boolean;
  /** The d20 as rolled. */
  natural: number;
  /** The d20 result needed to hit (may be below 1 or above 20). */
  needed: number;
  /** Natural 20. */
  critical: boolean;
  /** Natural 1. */
  fumble: boolean;
}

/** d20 >= thac0 - targetAc - bonus hits; natural 20 always hits, natural 1 always misses. */
export function attackRoll(input: AttackInput, rng: Rng): AttackResult {
  const natural = d20(rng);
  const needed = input.thac0 - input.targetAc - (input.toHitBonus ?? 0);
  const critical = natural === 20;
  const fumble = natural === 1;
  const hit = critical ? true : fumble ? false : natural >= needed;
  return { hit, natural, needed, critical, fumble };
}

/** Chance (0..1) that `attackRoll` hits, for tooltips and AI decisions. */
export function hitChance(input: AttackInput): number {
  const needed = input.thac0 - input.targetAc - (input.toHitBonus ?? 0);
  const clamped = Math.max(2, Math.min(20, needed));
  return (21 - clamped) / 20;
}

// ── Damage ──────────────────────────────────────────────────────────────────

/** Accepted wherever a damage expression is wanted. */
export type DiceInput = string | DiceSpec | readonly [count: number, sides: number];

function toSpec(dice: DiceInput): DiceSpec {
  if (typeof dice === 'string') return parseDice(dice);
  if (Array.isArray(dice)) return { count: dice[0], sides: dice[1], bonus: 0 };
  return dice as DiceSpec;
}

/**
 * Damage for a hit. A critical rolls the dice twice (the bonus counts once).
 * A hit always does at least 1 point.
 */
export function damageRoll(
  dice: DiceInput,
  bonus: number,
  rng: Rng,
  opts: { critical?: boolean } = {},
): number {
  const s = toSpec(dice);
  const count = opts.critical ? s.count * 2 : s.count;
  return Math.max(1, roll(rng, count, s.sides, s.bonus + bonus));
}

// ── Saving throws ───────────────────────────────────────────────────────────

export interface SaveResult {
  success: boolean;
  natural: number;
  target: number;
}

export interface SaveInput {
  classKey: ClassKey;
  level: number;
  category: SaveCategory;
  /** Positive helps the save (bless, magic items, wisdom against mental effects). */
  modifier?: number;
}

/** d20 + modifier >= table target saves. There is no automatic success or failure. */
export function savingThrow(input: SaveInput, rng: Rng): SaveResult {
  const target = saveTarget(input.classKey, input.level, input.category);
  const natural = d20(rng);
  return { success: natural + (input.modifier ?? 0) >= target, natural, target };
}

/** Monsters save as a fighter of their hit-dice level. */
export function monsterSave(hd: number, category: SaveCategory, rng: Rng, modifier = 0): SaveResult {
  return savingThrow(
    { classKey: 'fighter', level: Math.max(1, Math.floor(hd)), category, modifier },
    rng,
  );
}

// ── Turning undead ──────────────────────────────────────────────────────────

export type TurnOutcome = 'no_effect' | 'turned' | 'destroyed';
/** A number is the d20 roll needed, 'T' turns automatically, 'D' destroys automatically, null is no chance. */
export type TurnCell = number | 'T' | 'D' | null;

/**
 * The table, by (cleric level - undead hit dice). Each step up the ladder is
 * one row of the classic chart: 20, 19, 16, 13, 10, 7, 4, then T, T, D.
 */
export function turnTarget(clericLevel: number, undeadHd: number): TurnCell {
  const tier = Math.max(1, Math.ceil(undeadHd));
  const level = Math.max(1, Math.floor(clericLevel));
  const d = level - tier;
  if (d <= -5) return null;
  if (d === -4) return 20;
  if (d === -3) return 19;
  if (d === -2) return 16;
  if (d === -1) return 13;
  if (d === 0) return 10;
  if (d === 1) return 7;
  if (d === 2) return 4;
  if (d <= 4) return 'T';
  return 'D';
}

export function turnUndead(clericLevel: number, undeadHd: number, rng: Rng): TurnOutcome {
  const cell = turnTarget(clericLevel, undeadHd);
  if (cell === null) return 'no_effect';
  if (cell === 'D') return 'destroyed';
  if (cell === 'T') return 'turned';
  return d20(rng) >= cell ? 'turned' : 'no_effect';
}

// ── Initiative ──────────────────────────────────────────────────────────────

/** d6 plus modifier; higher acts first. Roll once per side per exchange. */
export function initiative(rng: Rng, modifier = 0): number {
  return roll(rng, 1, 6, modifier);
}

// ── Armor class ─────────────────────────────────────────────────────────────

export interface ArmorClassInput {
  /** Unarmored AC, normally 10. */
  base?: number;
  /** Points of protection from body armor (leather 2, chain 5, plate 7). */
  armor?: number;
  /** Points from a shield (usually 1). */
  shield?: number;
  /** Dexterity adjustment from `dexterityMods().acAdj`; negative is better. */
  dexAdj?: number;
  /** Magical bonuses (+1 armor, rings, cloaks) as positive points. */
  magic?: number;
}

/** Descending AC, clamped to -10..10. */
export function armorClass(input: ArmorClassInput = {}): number {
  const ac =
    (input.base ?? 10) -
    (input.armor ?? 0) -
    (input.shield ?? 0) +
    (input.dexAdj ?? 0) -
    (input.magic ?? 0);
  return Math.max(-10, Math.min(10, ac));
}

// ── Backstab ────────────────────────────────────────────────────────────────

/** Damage multiplier for a thief striking an unaware target from behind. */
export function backstabMultiplier(level: number): number {
  const l = Math.max(1, Math.floor(level));
  if (l <= 4) return 2;
  if (l <= 8) return 3;
  if (l <= 12) return 4;
  return 5;
}
