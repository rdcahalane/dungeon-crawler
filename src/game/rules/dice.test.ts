import { describe, expect, it } from 'vitest';
import { d100, d20, diceAverage, mathRng, mulberry32, parseDice, pick, roll, rollDice } from './dice';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds and stays in [0,1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toBe(b.next());
    const r = mulberry32(99);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('roll', () => {
  it('stays within bounds and hits both ends of a d6', () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = roll(rng, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('adds the bonus and sums multiple dice', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const v = roll(rng, 3, 6, 2);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('d20 and d100 are in range', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const a = d20(rng);
      const b = d100(rng);
      expect(a >= 1 && a <= 20).toBe(true);
      expect(b >= 1 && b <= 100).toBe(true);
    }
  });

  it('mathRng produces floats in [0,1)', () => {
    const v = mathRng.next();
    expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('parseDice', () => {
  it('parses common forms', () => {
    expect(parseDice('2d6+1')).toEqual({ count: 2, sides: 6, bonus: 1 });
    expect(parseDice('d8')).toEqual({ count: 1, sides: 8, bonus: 0 });
    expect(parseDice('1d4-1')).toEqual({ count: 1, sides: 4, bonus: -1 });
    expect(parseDice(' 3D10 + 5 ')).toEqual({ count: 3, sides: 10, bonus: 5 });
    expect(parseDice('4')).toEqual({ count: 0, sides: 0, bonus: 4 });
  });

  it('rejects junk', () => {
    expect(() => parseDice('banana')).toThrow();
    expect(() => parseDice('2d')).toThrow();
  });

  it('rollDice and diceAverage agree with the spec', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = rollDice(rng, '2d6+1');
      expect(v >= 3 && v <= 13).toBe(true);
    }
    expect(diceAverage('2d6+1')).toBe(8);
  });
});

describe('pick', () => {
  it('returns members and is seeded', () => {
    const arr = ['a', 'b', 'c'];
    const a = mulberry32(8);
    const b = mulberry32(8);
    for (let i = 0; i < 20; i++) {
      const x = pick(a, arr);
      expect(arr).toContain(x);
      expect(pick(b, arr)).toBe(x);
    }
  });

  it('throws on empty', () => {
    expect(() => pick(mulberry32(1), [])).toThrow();
  });
});
