/**
 * Dice and random numbers. Everything in the rules core takes an `Rng`, so a
 * seeded run is reproducible and tests are deterministic.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
}

/** Small fast seedable generator (mulberry32). Same seed, same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Non-deterministic Rng for live play. Use `mulberry32` anywhere you need replay. */
export const mathRng: Rng = { next: () => Math.random() };

/** Roll `count` dice of `sides` faces and add `bonus`. */
export function roll(rng: Rng, count: number, sides: number, bonus = 0): number {
  let total = bonus;
  if (sides < 1) return total;
  for (let i = 0; i < count; i++) {
    total += 1 + Math.floor(rng.next() * sides);
  }
  return total;
}

export function d20(rng: Rng): number {
  return roll(rng, 1, 20);
}

export function d100(rng: Rng): number {
  return roll(rng, 1, 100);
}

export interface DiceSpec {
  count: number;
  sides: number;
  bonus: number;
}

const DICE_RE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/** Parse "2d6+1", "d8", "1d4-1" or a plain integer such as "3". Throws on junk. */
export function parseDice(text: string): DiceSpec {
  const plain = /^\s*([+-]?\d+)\s*$/.exec(text);
  if (plain) return { count: 0, sides: 0, bonus: parseInt(plain[1], 10) };
  const m = DICE_RE.exec(text);
  if (!m) throw new Error(`Bad dice expression: "${text}"`);
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  let bonus = 0;
  if (m[3]) bonus = (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10);
  return { count, sides, bonus };
}

/** Roll a spec or a dice string. */
export function rollDice(rng: Rng, dice: string | DiceSpec): number {
  const s = typeof dice === 'string' ? parseDice(dice) : dice;
  return roll(rng, s.count, s.sides, s.bonus);
}

/** Average result of a dice expression (for balancing and tooltips). */
export function diceAverage(dice: string | DiceSpec): number {
  const s = typeof dice === 'string' ? parseDice(dice) : dice;
  return s.count * (s.sides + 1) / 2 + s.bonus;
}

/** Pick a random element. Throws on an empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick() from an empty array');
  return arr[Math.floor(rng.next() * arr.length)];
}
