import type { Rng } from './types';

/** Integer in [lo, hi] inclusive. */
export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng.next() * (hi - lo + 1));
}

export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}

export function pickWeighted<T>(rng: Rng, list: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const t of list) total += weight(t);
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  for (const t of list) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return list[list.length - 1];
}

/** Roll `count` dice of `sides`. */
export function dice(rng: Rng, count: number, sides: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) n += int(rng, 1, sides);
  return n;
}

/** Roll a dice string like "2d4", "1d8+1". */
export function rollDiceString(rng: Rng, spec: string): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(spec.trim());
  if (!m) throw new Error(`Bad dice string: ${spec}`);
  return dice(rng, Number(m[1]), Number(m[2])) + (m[3] ? Number(m[3]) : 0);
}

/** Collision-resistant enough for one save file; deterministic for a seeded Rng. */
export function newId(rng: Rng): string {
  const a = Math.floor(rng.next() * 36 ** 5).toString(36).padStart(5, '0');
  const b = Math.floor(rng.next() * 36 ** 5).toString(36).padStart(5, '0');
  return `i${a}${b}`;
}
