/**
 * The innkeeper's beds. Phaser-free so the rules are testable.
 *
 *  - A room for the night costs 5 gp: full hit points, drained hit points restored, spell slots restored.
 *  - Sleeping in the common room is free: half the missing hit points and the spell slots (no drain mended).
 */
import { restoreDrain, type HpState } from "../scenes/game/AdndCombat";

export const ROOM_PRICE_GP = 5;

export type InnKind = "room" | "common";

export interface InnResult {
  ok: boolean;
  /** Set when `ok` is false. */
  reason?: "poor";
  /** Gold to take from the purse (0 for the common room). */
  cost: number;
  healed: number;
  drainRestored: number;
  spellsRestored: boolean;
}

/** Anything that can be rested: `Spellbook` satisfies this. */
export interface Restable { rest(): void }

/**
 * Apply an inn rest to `hp` (mutated) and `book`. Does not touch gold: the caller subtracts `cost` when `ok`.
 * `hp.maxHp` is the current (drained) maximum, as in `applyRest`; the caller recomputes derived stats afterward.
 */
export function innRest(kind: InnKind, hp: HpState, book: Restable | null, gold: number): InnResult {
  const none: InnResult = { ok: false, reason: "poor", cost: 0, healed: 0, drainRestored: 0, spellsRestored: false };
  const before = hp.hp;
  if (kind === "room") {
    if (gold < ROOM_PRICE_GP) return none;
    const drainRestored = restoreDrain(hp);
    hp.hp = hp.maxHp;
    if (book) book.rest();
    return { ok: true, cost: ROOM_PRICE_GP, healed: hp.hp - before, drainRestored, spellsRestored: !!book };
  }
  hp.hp = Math.min(hp.maxHp, hp.hp + Math.floor((hp.maxHp - hp.hp) / 2));
  if (book) book.rest();
  return { ok: true, cost: 0, healed: hp.hp - before, drainRestored: 0, spellsRestored: !!book };
}
