/**
 * One press of E must do one thing. A chest and a tomb mechanism can both be in reach; the nearer one wins and the
 * other stands down. Phaser-free so the rule is testable; `LootController` and `MechanismController` both ask it, with
 * the same two numbers, so they always agree.
 */
export type InteractWinner = "chest" | "mech" | "none";

/**
 * @param chestDist pixels to the nearest chest within reach, or `Infinity` when none is.
 * @param mechDist pixels to the nearest usable mechanism in reach, or `Infinity` when none is.
 * A tie goes to the chest (it is the one drawn on top).
 */
export function resolveInteract(chestDist: number, mechDist: number): InteractWinner {
  const chest = Number.isFinite(chestDist);
  const mech = Number.isFinite(mechDist);
  if (!chest && !mech) return "none";
  if (chest && !mech) return "chest";
  if (mech && !chest) return "mech";
  return chestDist <= mechDist ? "chest" : "mech";
}
