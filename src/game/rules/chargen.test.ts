import { describe, expect, it } from 'vitest';
import { ABILITY_KEYS, xpBonusPercent, type AbilityScores } from './abilities';
import {
  CHARGEN_ORDER, ChargenSession, primeRequisiteBonus, reportScore, reportScores, rollScores, swapScores,
  xpBonusLabel,
} from './chargen';
import { mulberry32, type Rng } from './dice';

/** An Rng that deals the listed die faces in order (1 to 6), then repeats the last. */
function dealing(faces: number[]): Rng {
  let i = 0;
  return { next: () => (faces[Math.min(i++, faces.length - 1)] - 1) / 6 + 0.01 };
}

const flat = (n: number): AbilityScores => ({ str: n, int: n, wis: n, dex: n, con: n, cha: n });

describe('rollScores', () => {
  it('drops the lowest of four dice, in STR INT WIS DEX CON CHA order', () => {
    // 1,6,6,6 -> 18   1,1,1,1 -> 3   3,3,2,6 -> 12   5,4,4,1 -> 13   6,6,6,6 -> 18   2,5,2,3 -> 10
    const rng = dealing([1, 6, 6, 6, 1, 1, 1, 1, 3, 3, 2, 6, 5, 4, 4, 1, 6, 6, 6, 6, 2, 5, 2, 3]);
    expect(CHARGEN_ORDER).toEqual(['str', 'int', 'wis', 'dex', 'con', 'cha']);
    expect(rollScores(rng)).toEqual({ str: 18, int: 3, wis: 12, dex: 13, con: 18, cha: 10 });
  });

  it('is repeatable from a seed and stays inside 3 to 18', () => {
    const a = rollScores(mulberry32(1234));
    const b = rollScores(mulberry32(1234));
    expect(a).toEqual(b);
    for (let seed = 1; seed <= 200; seed++) {
      const s = rollScores(mulberry32(seed));
      for (const k of ABILITY_KEYS) {
        expect(s[k]).toBeGreaterThanOrEqual(3);
        expect(s[k]).toBeLessThanOrEqual(18);
      }
    }
  });

  it('averages above 3d6 (drop-lowest pushes the mean to about 12.2)', () => {
    const rng = mulberry32(99);
    let sum = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) sum += rollScores(rng).str;
    expect(sum / n).toBeGreaterThan(11.7);
    expect(sum / n).toBeLessThan(12.7);
  });
});

describe('swapScores', () => {
  it('exchanges two abilities and leaves the rest', () => {
    const s: AbilityScores = { str: 15, int: 6, wis: 9, dex: 12, con: 14, cha: 8 };
    expect(swapScores(s, 'int', 'str')).toEqual({ str: 6, int: 15, wis: 9, dex: 12, con: 14, cha: 8 });
    expect(s.str).toBe(15); // the original is untouched
  });

  it('swapping a key with itself changes nothing', () => {
    const s = flat(10);
    expect(swapScores(s, 'dex', 'dex')).toEqual(s);
  });
});

describe('ChargenSession', () => {
  it('counts rolls and allows one swap per roll', () => {
    const session = new ChargenSession(mulberry32(7));
    expect(session.rolls).toBe(1);
    const first = { ...session.scores };

    expect(session.swap('int', 'str')).toBe(true);
    expect(session.scores.str).toBe(first.int);
    expect(session.scores.int).toBe(first.str);
    expect(session.swapped).toBe(true);

    // The second swap is refused and nothing moves.
    const after = { ...session.scores };
    expect(session.swap('wis', 'dex')).toBe(false);
    expect(session.scores).toEqual(after);

    // Rolling again counts and hands the swap back.
    session.reroll();
    expect(session.rolls).toBe(2);
    expect(session.swapped).toBe(false);
    expect(session.swap('wis', 'dex')).toBe(true);
  });

  it('refuses to swap an ability with itself without spending the swap', () => {
    const session = new ChargenSession(mulberry32(3));
    expect(session.swap('str', 'str')).toBe(false);
    expect(session.swapped).toBe(false);
  });
});

describe('primeRequisiteBonus', () => {
  it('is 0.10 at 16 or more in the class prime requisite, else 0', () => {
    expect(primeRequisiteBonus('fighter', { ...flat(10), str: 16 })).toBeCloseTo(0.1);
    expect(primeRequisiteBonus('fighter', { ...flat(10), str: 18 })).toBeCloseTo(0.1);
    expect(primeRequisiteBonus('fighter', { ...flat(10), str: 15 })).toBe(0);
    expect(primeRequisiteBonus('wizard', { ...flat(10), int: 16 })).toBeCloseTo(0.1);
    expect(primeRequisiteBonus('thief', { ...flat(10), dex: 17 })).toBeCloseTo(0.1);
    expect(primeRequisiteBonus('cleric', { ...flat(10), wis: 16 })).toBeCloseTo(0.1);
  });

  it('only looks at the class prime: a strong other score earns nothing', () => {
    expect(primeRequisiteBonus('wizard', { ...flat(8), str: 18, int: 12 })).toBe(0);
  });

  it('agrees with the percentage Player.gainXP applies', () => {
    for (const cls of ['fighter', 'thief', 'wizard', 'cleric'] as const) {
      for (const n of [10, 15, 16, 18]) {
        const prime = { fighter: 'str', thief: 'dex', wizard: 'int', cleric: 'wis' }[cls] as keyof AbilityScores;
        const s = { ...flat(10), [prime]: n } as AbilityScores;
        expect(Math.round(primeRequisiteBonus(cls, s) * 100)).toBe(xpBonusPercent(cls, s));
      }
    }
  });

  it('labels the sheet line', () => {
    expect(xpBonusLabel('fighter', { ...flat(10), str: 17 })).toBe('+10% XP');
    expect(xpBonusLabel('fighter', flat(10))).toBe('');
  });
});

describe('reportScore', () => {
  it('reports strength, dexterity, constitution and the rest from the tables', () => {
    const s: AbilityScores = { str: 18, int: 16, wis: 16, dex: 17, con: 17, cha: 13 };
    expect(reportScore('str', s, 'fighter').mods).toBe('HIT +1 DMG +2');
    expect(reportScore('dex', s, 'thief').mods).toBe('MISSILE +2 AC -3');
    expect(reportScore('con', s, 'fighter').mods).toBe('HP +3 A LEVEL');
    expect(reportScore('con', s, 'wizard').mods).toBe('HP +2 A LEVEL');
    expect(reportScore('int', s, 'wizard').mods).toBe('LEARN 70%');
    expect(reportScore('wis', s, 'cleric').mods).toBe('SAVE +2 +4 SPELLS');
    expect(reportScore('wis', s, 'fighter').mods).toBe('SAVE +2');
    expect(reportScore('cha', s, 'fighter').mods).toBe('REACTION +1');
  });

  it('marks helpful, harmful and flat scores', () => {
    expect(reportScore('str', flat(18), 'fighter').tone).toBe(1);
    expect(reportScore('str', flat(5), 'fighter').tone).toBe(-1);
    expect(reportScore('str', flat(10), 'fighter').tone).toBe(0);
    // Descending AC: a negative adjustment is the good one.
    expect(reportScore('dex', flat(17), 'thief').tone).toBe(1);
    expect(reportScore('dex', flat(4), 'thief').tone).toBe(-1);
  });

  it('gives six reports in sheet order', () => {
    const reports = reportScores(flat(12), 'fighter');
    expect(reports.map((r) => r.label)).toEqual(['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHA']);
  });
});
