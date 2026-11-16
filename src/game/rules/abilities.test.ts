import { describe, expect, it } from 'vitest';
import {
  abilityModifiers,
  charismaReaction,
  conHpBonus,
  dexterityMods,
  intelligenceEffect,
  primeRequisite,
  rollAbilities,
  rollAbilityScore,
  strengthMods,
  wisdomBonusSlots,
  wisdomSaveAdj,
  xpBonusPercent,
} from './abilities';
import { mulberry32 } from './dice';

const SCORES = Array.from({ length: 16 }, (_, i) => i + 3);

describe('rolling', () => {
  it('4d6 drop lowest lands in 3..18 and is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 300; i++) {
      const v = rollAbilityScore(a);
      expect(v >= 3 && v <= 18).toBe(true);
      expect(rollAbilityScore(b)).toBe(v);
    }
  });

  it('rollAbilities fills all six and skews above 3d6 on average', () => {
    const rng = mulberry32(2024);
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const s = rollAbilities(rng);
      expect(Object.keys(s).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
      sum += s.str;
    }
    expect(sum / n).toBeGreaterThan(11.5);
  });
});

describe('score tables are monotonic', () => {
  it('strength to-hit and damage never fall as STR rises', () => {
    for (let s = 4; s <= 18; s++) {
      expect(strengthMods(s).toHit).toBeGreaterThanOrEqual(strengthMods(s - 1).toHit);
      expect(strengthMods(s).damage).toBeGreaterThanOrEqual(strengthMods(s - 1).damage);
    }
    expect(strengthMods(18)).toEqual({ toHit: 1, damage: 2 });
    expect(strengthMods(10)).toEqual({ toHit: 0, damage: 0 });
  });

  it('dexterity: missile rises and AC adjustment falls (better) as DEX rises', () => {
    for (let d = 4; d <= 18; d++) {
      expect(dexterityMods(d).missile).toBeGreaterThanOrEqual(dexterityMods(d - 1).missile);
      expect(dexterityMods(d).acAdj).toBeLessThanOrEqual(dexterityMods(d - 1).acAdj);
    }
    expect(dexterityMods(18).acAdj).toBe(-4);
    expect(dexterityMods(3).acAdj).toBe(4);
  });

  it('constitution hp bonus is monotonic and fighters get extra at 17+', () => {
    for (let c = 4; c <= 18; c++) {
      expect(conHpBonus(c, 'cleric')).toBeGreaterThanOrEqual(conHpBonus(c - 1, 'cleric'));
      expect(conHpBonus(c, 'fighter')).toBeGreaterThanOrEqual(conHpBonus(c - 1, 'fighter'));
    }
    expect(conHpBonus(18, 'fighter')).toBe(4);
    expect(conHpBonus(18, 'wizard')).toBe(2);
  });

  it('INT, WIS and CHA effects never get worse with higher scores', () => {
    for (let i = 4; i <= 18; i++) {
      expect(intelligenceEffect(i).learnChance).toBeGreaterThanOrEqual(intelligenceEffect(i - 1).learnChance);
      expect(intelligenceEffect(i).maxSpellLevel).toBeGreaterThanOrEqual(intelligenceEffect(i - 1).maxSpellLevel);
      expect(wisdomSaveAdj(i)).toBeGreaterThanOrEqual(wisdomSaveAdj(i - 1));
      expect(charismaReaction(i)).toBeGreaterThanOrEqual(charismaReaction(i - 1));
      const a = wisdomBonusSlots(i);
      const b = wisdomBonusSlots(i - 1);
      a.forEach((v, idx) => expect(v).toBeGreaterThanOrEqual(b[idx]));
    }
  });

  it('out-of-range scores clamp instead of throwing', () => {
    for (const s of [-5, 0, 2, 19, 25]) {
      expect(() => strengthMods(s)).not.toThrow();
      expect(() => dexterityMods(s)).not.toThrow();
      expect(() => conHpBonus(s, 'fighter')).not.toThrow();
    }
    expect(SCORES.length).toBe(16);
  });
});

describe('aggregates', () => {
  it('abilityModifiers bundles the tables', () => {
    const m = abilityModifiers({ str: 18, dex: 16, con: 17, int: 9, wis: 15, cha: 12 }, 'cleric');
    expect(m).toMatchObject({ toHit: 1, damage: 2, missile: 1, acAdj: -2, hpPerLevel: 2, wisSaveAdj: 1 });
    expect(m.bonusSlots).toEqual([2, 1, 0, 0]);
    const f = abilityModifiers({ str: 10, dex: 10, con: 17, int: 10, wis: 18, cha: 10 }, 'fighter');
    expect(f.bonusSlots).toEqual([0, 0, 0, 0]);
    expect(f.hpPerLevel).toBe(3);
  });

  it('prime requisite bonus applies at 16+', () => {
    const base = { str: 15, dex: 15, con: 10, int: 15, wis: 15, cha: 10 };
    expect(primeRequisite('wizard')).toBe('int');
    expect(xpBonusPercent('fighter', base)).toBe(0);
    expect(xpBonusPercent('fighter', { ...base, str: 16 })).toBe(10);
    expect(xpBonusPercent('thief', { ...base, dex: 17 })).toBe(10);
  });
});
