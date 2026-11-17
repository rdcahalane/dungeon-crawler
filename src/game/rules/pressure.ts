/**
 * Difficulty pressure on top of the first-edition numbers. Pure, no Phaser; the game and the balance sim both use it.
 *
 * Why (2026-11-17): the balance sim had fighters and clerics clearing 8 fights in a row, no rest, 88 to 100% of the
 * time on floors 1 to 5, and in play a level 2 fighter on floor 1 was barely scratched. Low hit-dice monsters need a 16
 * or better to hit armour class 4, so most swings missed. Floors 1 to 5 now get one more monster per room and +2 on
 * every monster hit; a hero above the floor's level also faces +1 to hit and +1 damage. A new level 1 hero on floor 1
 * gets the to-hit bump only, so a fresh wizard is not swarmed.
 */

/** The last floor the early-floor pressure applies to. */
export const EARLY_PRESSURE_LAST_FLOOR = 5;
export const EARLY_TO_HIT_BONUS = 2;

const early = (floor: number): boolean => floor >= 1 && floor <= EARLY_PRESSURE_LAST_FLOOR;

/** Extra monsters in every room (both ends of the generator's range) for this floor and hero level. */
export function extraMonstersPerRoom(floor: number, level: number): number {
  if (!early(floor)) return 0;
  if (floor === 1 && level <= 1) return 0;
  return 1;
}

/** Added to every monster attack against the hero: to hit and damage. */
export function monsterPressure(floor: number, level: number): { toHit: number; damage: number } {
  const over = level > floor ? 1 : 0;
  return { toHit: (early(floor) ? EARLY_TO_HIT_BONUS : 0) + over, damage: over };
}
