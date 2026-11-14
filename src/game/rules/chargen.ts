/**
 * Character generation: six scores rolled 4d6 drop the lowest, in the classic order, with one swap allowed per roll.
 * Pure TS (no Phaser), every roll takes an `Rng` so a seed replays.
 */
import type { ClassKey } from '../constants';
import {
  ABILITY_KEYS,
  abilityModifiers,
  conHpBonus,
  intelligenceEffect,
  rollAbilityScore,
  strengthMods,
  type AbilityKey,
  type AbilityScores,
} from './abilities';
import { CLASS_RULES } from './classes';
import type { Rng } from './dice';

/** The order the dice are rolled in: STR INT WIS DEX CON CHA. */
export const CHARGEN_ORDER: readonly AbilityKey[] = ['str', 'int', 'wis', 'dex', 'con', 'cha'];

/** A prime requisite of this score or better earns the experience bonus. */
export const PRIME_BONUS_MIN_SCORE = 16;
export const PRIME_BONUS = 0.1;

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'STR', int: 'INT', wis: 'WIS', dex: 'DEX', con: 'CON', cha: 'CHA',
};

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: 'Strength', int: 'Intelligence', wis: 'Wisdom', dex: 'Dexterity', con: 'Constitution', cha: 'Charisma',
};

/** Roll the six scores, 4d6 dropping the lowest die each, in `CHARGEN_ORDER`. */
export function rollScores(rng: Rng): AbilityScores {
  const out = {} as AbilityScores;
  for (const key of CHARGEN_ORDER) out[key] = rollAbilityScore(rng);
  return out;
}

/** A copy of `scores` with two abilities exchanged. The same key twice changes nothing. */
export function swapScores(scores: AbilityScores, a: AbilityKey, b: AbilityKey): AbilityScores {
  const out = { ...scores };
  out[a] = scores[b];
  out[b] = scores[a];
  return out;
}

/** 0.10 when the class's prime requisite is 16 or more, else 0. */
export function primeRequisiteBonus(classKey: ClassKey, scores: AbilityScores): number {
  return scores[CLASS_RULES[classKey].prime] >= PRIME_BONUS_MIN_SCORE ? PRIME_BONUS : 0;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export interface ScoreReport {
  key: AbilityKey;
  label: string;
  score: number;
  /** Short modifier text for the sheet, upper-case friendly: "HIT +1 DMG +2". */
  mods: string;
  /** True when the score gives something (any modifier, good or bad, is not zero). */
  notable: boolean;
  /** Tone for colouring: 1 helps, -1 hurts, 0 does nothing. */
  tone: 1 | 0 | -1;
}

/** What one score does for this class, from the tables in `abilities.ts`. */
export function reportScore(key: AbilityKey, scores: AbilityScores, classKey: ClassKey): ScoreReport {
  const score = scores[key];
  const m = abilityModifiers(scores, classKey);
  let mods = 'NO EFFECT';
  let net = 0;
  switch (key) {
    case 'str': {
      const s = strengthMods(score);
      mods = `HIT ${signed(s.toHit)} DMG ${signed(s.damage)}`;
      net = s.toHit + s.damage;
      break;
    }
    case 'dex':
      // acAdj is descending: negative is better, so the tone flips.
      mods = `MISSILE ${signed(m.missile)} AC ${signed(m.acAdj)}`;
      net = m.missile - m.acAdj;
      break;
    case 'con':
      mods = `HP ${signed(conHpBonus(score, classKey))} A LEVEL`;
      net = m.hpPerLevel;
      break;
    case 'int': {
      const e = intelligenceEffect(score);
      mods = `LEARN ${e.learnChance}%`;
      net = e.learnChance - 55;
      break;
    }
    case 'wis': {
      const extra = m.bonusSlots.reduce((a, b) => a + b, 0);
      mods = `SAVE ${signed(m.wisSaveAdj)}${classKey === 'cleric' && extra > 0 ? ` +${extra} SPELLS` : ''}`;
      net = m.wisSaveAdj + extra;
      break;
    }
    case 'cha':
      mods = `REACTION ${signed(m.reaction)}`;
      net = m.reaction;
      break;
  }
  const tone: 1 | 0 | -1 = net > 0 ? 1 : net < 0 ? -1 : 0;
  return { key, label: ABILITY_LABELS[key], score, mods, notable: tone !== 0, tone };
}

/** All six reports in sheet order (STR INT WIS DEX CON CHA). */
export function reportScores(scores: AbilityScores, classKey: ClassKey): ScoreReport[] {
  return CHARGEN_ORDER.map((k) => reportScore(k, scores, classKey));
}

/** The sheet line for the experience bonus: "+10% XP" or an empty string. */
export function xpBonusLabel(classKey: ClassKey, scores: AbilityScores): string {
  const b = primeRequisiteBonus(classKey, scores);
  return b > 0 ? `+${Math.round(b * 100)}% XP` : '';
}

/**
 * The state behind the character-select ability screen: the current roll, how many times the player has rolled,
 * and whether this roll's one swap has been spent. Rolling again hands back a fresh swap.
 */
export class ChargenSession {
  scores: AbilityScores;
  /** How many times the dice have been rolled (the first roll counts). */
  rolls = 0;
  /** The one swap allowed on this roll has been used. */
  swapped = false;

  constructor(private rng: Rng) {
    this.scores = rollScores(rng);
    this.rolls = 1;
  }

  reroll(): AbilityScores {
    this.scores = rollScores(this.rng);
    this.rolls++;
    this.swapped = false;
    return this.scores;
  }

  /** Exchange two abilities. Returns false (and changes nothing) when the swap is spent or the keys are equal. */
  swap(a: AbilityKey, b: AbilityKey): boolean {
    if (this.swapped || a === b) return false;
    if (!ABILITY_KEYS.includes(a) || !ABILITY_KEYS.includes(b)) return false;
    this.scores = swapScores(this.scores, a, b);
    this.swapped = true;
    return true;
  }
}
