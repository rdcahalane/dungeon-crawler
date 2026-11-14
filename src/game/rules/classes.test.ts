import { describe, expect, it } from 'vitest';
import {
  CLASS_KEYS,
  CLASS_RULES,
  FLAT_SKILL_CHANCE,
  MAX_LEVEL,
  SAVE_CATEGORIES,
  THIEF_SKILLS,
  canUseArmor,
  canUseWeapon,
  hpGainForLevel,
  levelForXp,
  saveTarget,
  searchChance,
  spellSlots,
  thac0For,
  thiefSkill,
  titleFor,
  xpForLevel,
} from './classes';
import { mulberry32 } from './dice';

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

describe('THAC0', () => {
  it('never rises with level', () => {
    for (const c of CLASS_KEYS) {
      for (const l of LEVELS.slice(1)) expect(thac0For(c, l)).toBeLessThanOrEqual(thac0For(c, l - 1));
    }
  });

  it('fighter improves fastest and wizard slowest', () => {
    for (const l of LEVELS) {
      expect(thac0For('fighter', l)).toBeLessThanOrEqual(thac0For('cleric', l));
      expect(thac0For('fighter', l)).toBeLessThanOrEqual(thac0For('thief', l));
      expect(thac0For('wizard', l)).toBeGreaterThanOrEqual(thac0For('cleric', l));
      expect(thac0For('wizard', l)).toBeGreaterThanOrEqual(thac0For('thief', l));
    }
    expect(thac0For('fighter', 1)).toBe(20);
    expect(thac0For('fighter', 12)).toBe(9);
    expect(thac0For('wizard', 12)).toBe(18);
  });

  it('clamps out-of-range levels', () => {
    expect(thac0For('fighter', 0)).toBe(thac0For('fighter', 1));
    expect(thac0For('fighter', 99)).toBe(thac0For('fighter', 12));
  });
});

describe('saving throws', () => {
  it('targets sit within 2..20 and never rise with level', () => {
    for (const c of CLASS_KEYS) {
      for (const cat of SAVE_CATEGORIES) {
        for (const l of LEVELS) {
          const t = saveTarget(c, l, cat);
          expect(t).toBeGreaterThanOrEqual(2);
          expect(t).toBeLessThanOrEqual(20);
          if (l > 1) expect(t).toBeLessThanOrEqual(saveTarget(c, l - 1, cat));
        }
      }
    }
  });

  it('improves in bands, not every level', () => {
    expect(saveTarget('fighter', 1, 'death')).toBe(saveTarget('fighter', 2, 'death'));
    expect(saveTarget('fighter', 3, 'death')).toBeLessThan(saveTarget('fighter', 2, 'death'));
  });

  it('class strengths: wizard best at wands, cleric best at death', () => {
    expect(saveTarget('wizard', 1, 'wands')).toBeLessThan(saveTarget('fighter', 1, 'wands'));
    expect(saveTarget('cleric', 1, 'death')).toBeLessThan(saveTarget('fighter', 1, 'death'));
  });
});

describe('hit points', () => {
  it('level 1 is a full die, name-level rolls the die, later is flat', () => {
    const rng = mulberry32(10);
    expect(hpGainForLevel('fighter', 1, rng, 2)).toBe(12);
    for (let i = 0; i < 100; i++) {
      const v = hpGainForLevel('wizard', 3, rng);
      expect(v >= 1 && v <= 4).toBe(true);
    }
    expect(hpGainForLevel('fighter', 10, rng, 4)).toBe(CLASS_RULES.fighter.hpAfterNameLevel);
    expect(hpGainForLevel('wizard', 2, rng, -5)).toBeGreaterThanOrEqual(1);
  });
});

describe('experience', () => {
  it('thresholds start at zero and strictly increase', () => {
    for (const c of CLASS_KEYS) {
      expect(xpForLevel(c, 1)).toBe(0);
      for (const l of LEVELS.slice(1)) expect(xpForLevel(c, l)).toBeGreaterThan(xpForLevel(c, l - 1));
    }
  });

  it('levelForXp inverts xpForLevel and caps at 12', () => {
    for (const c of CLASS_KEYS) {
      for (const l of LEVELS) {
        expect(levelForXp(c, xpForLevel(c, l))).toBe(l);
        if (l > 1) expect(levelForXp(c, xpForLevel(c, l) - 1)).toBe(l - 1);
      }
      expect(levelForXp(c, 1e12)).toBe(12);
      expect(levelForXp(c, -5)).toBe(1);
    }
    expect(xpForLevel('fighter', 2)).toBe(100);
  });

  it('thieves level faster than wizards early on', () => {
    expect(xpForLevel('thief', 2)).toBeLessThan(xpForLevel('wizard', 2));
  });
});

describe('titles', () => {
  it('has a distinct title for every level', () => {
    for (const c of CLASS_KEYS) {
      const titles = LEVELS.map((l) => titleFor(c, l));
      expect(new Set(titles).size).toBe(12);
      titles.forEach((t) => expect(t.length).toBeGreaterThan(0));
    }
  });
});

describe('spell slots', () => {
  it('only wizards and clerics have slots', () => {
    expect(spellSlots('fighter', 12)).toEqual([0, 0, 0, 0]);
    expect(spellSlots('thief', 12)).toEqual([0, 0, 0, 0]);
    expect(spellSlots('wizard', 1)).toEqual([1, 0, 0, 0]);
    expect(spellSlots('cleric', 12)).toEqual([6, 5, 5, 3]);
  });

  it('slots never shrink with level and the total grows', () => {
    for (const c of ['wizard', 'cleric'] as const) {
      for (const l of LEVELS.slice(1)) {
        const prev = spellSlots(c, l - 1);
        const cur = spellSlots(c, l);
        cur.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(prev[i]));
        expect(cur.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(prev.reduce((a, b) => a + b, 0));
      }
    }
  });

  it('returns a copy, not the internal table', () => {
    const a = spellSlots('wizard', 5);
    a[0] = 99;
    expect(spellSlots('wizard', 5)[0]).toBe(4);
  });
});

describe('thief skills', () => {
  it('rise monotonically and stay within 1..100', () => {
    for (const s of THIEF_SKILLS) {
      for (const l of LEVELS) {
        const v = thiefSkill('thief', l, s);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(100);
        if (l > 1) expect(v).toBeGreaterThanOrEqual(thiefSkill('thief', l - 1, s));
      }
    }
  });

  it('non-thieves get a flat low chance at search and hear noise only', () => {
    for (const c of ['fighter', 'wizard', 'cleric'] as const) {
      for (const l of [1, 6, 12]) {
        expect(thiefSkill(c, l, 'findTraps')).toBe(FLAT_SKILL_CHANCE);
        expect(thiefSkill(c, l, 'hearNoise')).toBe(FLAT_SKILL_CHANCE);
        expect(thiefSkill(c, l, 'openLocks')).toBe(0);
        expect(thiefSkill(c, l, 'removeTraps')).toBe(0);
      }
    }
    expect(searchChance('thief', 1)).toBeGreaterThan(searchChance('fighter', 1));
  });
});

describe('restrictions', () => {
  it('matches the classic split', () => {
    expect(canUseArmor('wizard', 'light')).toBe(false);
    expect(canUseArmor('thief', 'light')).toBe(true);
    expect(canUseArmor('thief', 'heavy')).toBe(false);
    expect(canUseArmor('fighter', 'shield')).toBe(true);
    expect(canUseWeapon('cleric', 'sword')).toBe(false);
    expect(canUseWeapon('cleric', 'mace')).toBe(true);
    expect(canUseWeapon('wizard', 'staff')).toBe(true);
    expect(canUseWeapon('wizard', 'axe')).toBe(false);
    expect(canUseWeapon('fighter', 'bow')).toBe(true);
  });
});
