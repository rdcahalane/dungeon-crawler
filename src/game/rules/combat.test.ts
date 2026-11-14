import { describe, expect, it } from 'vitest';
import {
  armorClass,
  attackRoll,
  backstabMultiplier,
  damageRoll,
  hitChance,
  initiative,
  monsterSave,
  savingThrow,
  turnTarget,
  turnUndead,
} from './combat';
import { mulberry32, type Rng } from './dice';

/** An Rng whose d20 comes out as `face` (1..20). */
function fixedD20(face: number): Rng {
  return { next: () => (face - 0.5) / 20 };
}

describe('attackRoll', () => {
  it('natural 20 always hits, even against impossible armor', () => {
    const r = attackRoll({ thac0: 20, targetAc: -10, toHitBonus: 0 }, fixedD20(20));
    expect(r.natural).toBe(20);
    expect(r.hit && r.critical && !r.fumble).toBe(true);
    expect(r.needed).toBe(30);
  });

  it('natural 1 always misses, even when only a 1 would be needed', () => {
    const r = attackRoll({ thac0: 5, targetAc: 10, toHitBonus: 5 }, fixedD20(1));
    expect(r.natural).toBe(1);
    expect(r.hit).toBe(false);
    expect(r.fumble).toBe(true);
    expect(r.needed).toBe(-10);
  });

  it('needed = thac0 - ac - bonus and the boundary hits', () => {
    const input = { thac0: 18, targetAc: 5, toHitBonus: 2 };
    expect(attackRoll(input, fixedD20(11)).needed).toBe(11);
    expect(attackRoll(input, fixedD20(11)).hit).toBe(true);
    expect(attackRoll(input, fixedD20(10)).hit).toBe(false);
  });

  it('bonus defaults to zero and a seeded run is reproducible', () => {
    expect(attackRoll({ thac0: 20, targetAc: 10 }, fixedD20(10)).needed).toBe(10);
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      expect(attackRoll({ thac0: 19, targetAc: 4 }, a)).toEqual(attackRoll({ thac0: 19, targetAc: 4 }, b));
    }
  });

  it('empirical hit rate tracks hitChance', () => {
    const rng = mulberry32(77);
    const input = { thac0: 20, targetAc: 5, toHitBonus: 0 }; // needs 15: 6/20
    let hits = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (attackRoll(input, rng).hit) hits++;
    expect(hits / n).toBeGreaterThan(hitChance(input) - 0.04);
    expect(hits / n).toBeLessThan(hitChance(input) + 0.04);
    expect(hitChance(input)).toBeCloseTo(0.3);
    expect(hitChance({ thac0: 20, targetAc: -20 })).toBeCloseTo(0.05);
  });
});

describe('damageRoll', () => {
  it('stays within bounds, accepts strings and tuples, minimum 1', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      const v = damageRoll('1d8', 2, rng);
      expect(v >= 3 && v <= 10).toBe(true);
      const t = damageRoll([2, 4], 0, rng);
      expect(t >= 2 && t <= 8).toBe(true);
      expect(damageRoll('1d4', -9, rng)).toBe(1);
    }
  });

  it('critical rolls double dice and counts the bonus once', () => {
    const rng = mulberry32(31);
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const v = damageRoll('1d6', 3, rng, { critical: true });
      expect(v >= 5 && v <= 15).toBe(true);
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(9);
  });
});

describe('saving throws', () => {
  it('success is natural + modifier >= target', () => {
    // fighter L1 death = 14
    expect(savingThrow({ classKey: 'fighter', level: 1, category: 'death' }, fixedD20(14))).toEqual({
      success: true, natural: 14, target: 14,
    });
    expect(savingThrow({ classKey: 'fighter', level: 1, category: 'death' }, fixedD20(13)).success).toBe(false);
    expect(savingThrow({ classKey: 'fighter', level: 1, category: 'death', modifier: 1 }, fixedD20(13)).success).toBe(true);
  });

  it('target comes from the class table and improves with level', () => {
    const lo = savingThrow({ classKey: 'wizard', level: 1, category: 'wands' }, fixedD20(5));
    const hi = savingThrow({ classKey: 'wizard', level: 12, category: 'wands' }, fixedD20(5));
    expect(hi.target).toBeLessThan(lo.target);
  });

  it('monster saves as a fighter of its hit dice, fractional HD floors to 1', () => {
    const half = monsterSave(0.5, 'death', fixedD20(10));
    expect(half.target).toBe(14);
    const big = monsterSave(12, 'death', fixedD20(10));
    expect(big.target).toBe(7);
    expect(big.success).toBe(true);
    expect(monsterSave(40, 'spells', fixedD20(1)).target).toBeGreaterThanOrEqual(2);
  });
});

describe('turn undead', () => {
  it('table: equal-level turns on 10, low cleric versus tough undead has no chance', () => {
    expect(turnTarget(1, 1)).toBe(10);
    expect(turnTarget(2, 1)).toBe(7);
    expect(turnTarget(3, 1)).toBe(4);
    expect(turnTarget(4, 1)).toBe('T');
    expect(turnTarget(6, 1)).toBe('D');
    expect(turnTarget(1, 4)).toBe(19);
    expect(turnTarget(1, 5)).toBe(20);
    expect(turnTarget(1, 8)).toBeNull();
  });

  it('is monotonic: a higher cleric level never makes it harder, higher HD never easier', () => {
    const rank = (c: ReturnType<typeof turnTarget>): number =>
      c === null ? 100 : c === 'T' ? -1 : c === 'D' ? -2 : c;
    for (let hd = 1; hd <= 12; hd++) {
      for (let lv = 2; lv <= 12; lv++) {
        expect(rank(turnTarget(lv, hd))).toBeLessThanOrEqual(rank(turnTarget(lv - 1, hd)));
      }
    }
    for (let lv = 1; lv <= 12; lv++) {
      for (let hd = 2; hd <= 12; hd++) {
        expect(rank(turnTarget(lv, hd))).toBeGreaterThanOrEqual(rank(turnTarget(lv, hd - 1)));
      }
    }
  });

  it('outcomes follow the table', () => {
    expect(turnUndead(6, 1, fixedD20(1))).toBe('destroyed');
    expect(turnUndead(4, 1, fixedD20(1))).toBe('turned');
    expect(turnUndead(1, 1, fixedD20(10))).toBe('turned');
    expect(turnUndead(1, 1, fixedD20(9))).toBe('no_effect');
    expect(turnUndead(1, 9, fixedD20(20))).toBe('no_effect');
  });

  it('fractional undead HD rounds up to a tier', () => {
    expect(turnTarget(1, 0.5)).toBe(10);
    expect(turnTarget(1, 1.5)).toBe(13);
  });
});

describe('armor class and initiative', () => {
  it('composes descending AC', () => {
    expect(armorClass()).toBe(10);
    expect(armorClass({ base: 10, armor: 5, shield: 1 })).toBe(4);
    expect(armorClass({ base: 10, armor: 5, shield: 1, dexAdj: -2, magic: 1 })).toBe(1);
    expect(armorClass({ base: 10, dexAdj: 4 })).toBe(10); // clamped at 10
    expect(armorClass({ armor: 7, shield: 1, dexAdj: -4, magic: 10 })).toBe(-10);
  });

  it('initiative is d6 plus modifier', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      const v = initiative(rng, 2);
      expect(v >= 3 && v <= 8).toBe(true);
    }
  });
});

describe('backstab', () => {
  it('steps up with level bands', () => {
    expect(backstabMultiplier(1)).toBe(2);
    expect(backstabMultiplier(4)).toBe(2);
    expect(backstabMultiplier(5)).toBe(3);
    expect(backstabMultiplier(9)).toBe(4);
    expect(backstabMultiplier(12)).toBe(4);
    for (let l = 2; l <= 12; l++) expect(backstabMultiplier(l)).toBeGreaterThanOrEqual(backstabMultiplier(l - 1));
  });
});
