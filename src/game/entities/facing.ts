/**
 * Which way the character faces, from the way it is moving. Phaser-free so it can be tested.
 *
 * The old rule took the sign of each velocity axis, so a click-to-move step of (0.99, 0.02), a hair off east, faced
 * south-east and the ten-foot pole probed the wrong diagonal. Now the direction snaps to the nearest of eight
 * octants: a minor axis counts only when it is at least tan(22.5 deg) of the major one.
 */
const DIAGONAL = Math.SQRT2 - 1;
/** Speeds under this (pixels a second) are drift, not a walk. */
const MIN_SPEED = 1;

export interface Facing {
  x: number;
  y: number;
}

/** The new facing for a velocity, or `prev` when the body is not really moving. Never (0, 0). */
export function facingFromVelocity(vx: number, vy: number, prev: Facing): Facing {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  const major = Math.max(ax, ay);
  if (!(major >= MIN_SPEED)) return nonZero(prev);
  return {
    x: ax >= major * DIAGONAL ? Math.sign(vx) : 0,
    y: ay >= major * DIAGONAL ? Math.sign(vy) : 0,
  };
}

function nonZero(f: Facing): Facing {
  return f.x === 0 && f.y === 0 ? { x: 0, y: 1 } : f;
}

const NAMES: Record<string, string> = {
  "0,-1": "north", "1,-1": "north-east", "1,0": "east", "1,1": "south-east",
  "0,1": "south", "-1,1": "south-west", "-1,0": "west", "-1,-1": "north-west",
};

/** "east", "north-west"... for a unit step; south when the step is (0, 0). */
export function directionName(step: Facing): string {
  return NAMES[`${Math.sign(step.x)},${Math.sign(step.y)}`] ?? "south";
}
