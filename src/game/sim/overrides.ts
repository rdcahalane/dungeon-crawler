/**
 * Tuning overrides for the balance simulator. Nothing here touches the real bestiary or drop tables: a proposal is a
 * `SimOverrides` object handed to the sim, so before/after numbers come from the same code with different inputs.
 */
import { MONSTERS, type MonsterDef, type MonsterKey } from '../rules';

export interface DropTuning {
  /** Fraction of a floor's monsters the character kills (default 0.6). */
  killFraction?: number;
  /** Fraction of a floor's chests the character opens (default 0.7). */
  chestFraction?: number;
  /** Extra `rollItem` calls per floor below the current one (a proposed richer floor). */
  extraItemsPerFloor?: number;
  /** Quality bias added to those extra items (and nothing else). */
  extraItemBias?: number;
  /** Cap on potions carried by a `found` character (default 6). */
  potionCap?: number;
  /** Extra healing potions found per floor below the current one. */
  potionsPerFloor?: number;
}

export interface SimOverrides {
  /** Replace fields of a monster's stat block (attacks and special are replaced whole when given). */
  monsters?: Partial<Record<MonsterKey, Partial<MonsterDef>>>;
  /** Replace the random monster pool for a floor. */
  pool?: (floor: number) => readonly MonsterKey[];
  /** Normal rooms hold 1 to 2 + floor(floor / groupDivisor) monsters, the den 3 to 4 + the same (game: 3). */
  groupDivisor?: number;
  /** Multiplier on monster hit points by floor. The game has none, so the default is 1. */
  hpMult?: (floor: number) => number;
  /** Added to every monster hit's damage by floor. The game has none (elites get +1). */
  damageBonus?: (floor: number) => number;
  /** Added to every monster to-hit roll by floor. The game has none (elites get +1). */
  toHitBonus?: (floor: number) => number;
  /** false removes the 6 s paralysis immunity (Player.canBeHeld), to reproduce play before it existed. Default true. */
  holdImmunity?: boolean;
  /** Character level relative to the floor (default 0: level = floor). */
  levelOffset?: number;
  drops?: DropTuning;
}

/** The bestiary entry with any override applied. */
export function monsterDef(key: MonsterKey, overrides?: SimOverrides): MonsterDef {
  const base = MONSTERS[key];
  const o = overrides?.monsters?.[key];
  return o ? { ...base, ...o } : base;
}
