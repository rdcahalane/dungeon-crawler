import { describe, expect, it } from 'vitest';
import { getDef } from '../items';
import { mulberry32, type Rng } from './dice';
import {
  FLEE_MS, HIRELINGS, TORCH_RADIUS, canHire, firstName, hasKind, hireCost, hirelingLightRadius, hurtHireling,
  makeHireling, moraleCheck, namesFor, pickName, playerIsLow, restParty, sanitizeParty, shouldCheckMorale,
  splitGold, type HirelingState,
} from './hirelings';

/** An Rng that deals the listed die faces (1 to 6) in order, then repeats the last. */
function dealing(faces: number[]): Rng {
  let i = 0;
  return { next: () => (faces[Math.min(i++, faces.length - 1)] - 1) / 6 + 0.01 };
}

const torch = (hp = 3): HirelingState => ({ id: 'torchbearer', kind: 'torchbearer', name: 'Odo the linkboy', hp, maxHp: 3 });
const man = (hp = 8, maxHp = 8): HirelingState => ({ id: 'man_at_arms', kind: 'man_at_arms', name: 'Garrick the steady', hp, maxHp });

describe('stat blocks', () => {
  it('match the design', () => {
    const t = HIRELINGS.torchbearer;
    expect(t.upfrontGp).toBe(5);
    expect(t.hpFixed).toBe(3);
    expect(t.fights).toBe(false);
    expect(t.keepsShare).toBe(false);
    expect(t.onMoraleFail).toBe('lost');

    const m = HIRELINGS.man_at_arms;
    expect(m.upfrontGp).toBe(20);
    expect(m.hpDie).toBe(8);
    expect(m.ac).toBe(6);
    expect(m.thac0).toBe(20);
    expect(m.damage).toEqual({ count: 1, sides: 6 });
    expect(m.morale).toBe(7);
    expect(m.fights).toBe(true);
    expect(m.keepsShare).toBe(true);
  });

  it("the torchbearer's light is a lit torch's radius", () => {
    expect(TORCH_RADIUS).toBe(getDef('torch').light?.radius);
    expect(HIRELINGS.torchbearer.lightRadius).toBe(TORCH_RADIUS);
  });

  it('rolls hit points: 3 flat for the torchbearer, a d8 for the man-at-arms', () => {
    expect(makeHireling('torchbearer', mulberry32(1)).maxHp).toBe(3);
    expect(makeHireling('man_at_arms', { next: () => 0.99 }).maxHp).toBe(8);
    expect(makeHireling('man_at_arms', { next: () => 0 }).maxHp).toBe(1);
    for (let seed = 1; seed <= 100; seed++) {
      const h = makeHireling('man_at_arms', mulberry32(seed));
      expect(h.maxHp).toBeGreaterThanOrEqual(1);
      expect(h.maxHp).toBeLessThanOrEqual(8);
      expect(h.hp).toBe(h.maxHp);
    }
  });
});

describe('names', () => {
  it('has a small list per kind and a short first name for the label', () => {
    for (const kind of ['torchbearer', 'man_at_arms'] as const) {
      const names = namesFor(kind);
      expect(names.length).toBeGreaterThanOrEqual(6);
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) expect(firstName(n).length).toBeLessThanOrEqual(8);
    }
    expect(firstName('Odo the linkboy')).toBe('Odo');
  });

  it('avoids taken names while any are left', () => {
    const taken = namesFor('torchbearer').slice(1);
    for (let seed = 1; seed <= 20; seed++) {
      expect(pickName('torchbearer', mulberry32(seed), taken)).toBe(namesFor('torchbearer')[0]);
    }
  });
});

describe('wages and hiring', () => {
  it('costs 5 and 20 gp up front', () => {
    expect(hireCost('torchbearer')).toBe(5);
    expect(hireCost('man_at_arms')).toBe(20);
  });

  it('refuses without the gold, and refuses a second of the same kind', () => {
    expect(canHire([], 'torchbearer', 4)).toMatchObject({ ok: false, reason: 'poor' });
    expect(canHire([], 'torchbearer', 5).ok).toBe(true);
    expect(canHire([], 'man_at_arms', 19)).toMatchObject({ ok: false, reason: 'poor' });
    expect(canHire([], 'man_at_arms', 20).ok).toBe(true);
    expect(canHire([torch()], 'torchbearer', 500)).toMatchObject({ ok: false, reason: 'have_one' });
    // One of each is fine.
    expect(canHire([torch()], 'man_at_arms', 20).ok).toBe(true);
    expect(hasKind([torch()], 'man_at_arms')).toBe(false);
  });
});

describe('the man-at-arms share of gold', () => {
  it('keeps a third, rounded down, while he lives', () => {
    expect(splitGold([man()], 30)).toMatchObject({ share: 10, yours: 20 });
    expect(splitGold([man()], 10)).toMatchObject({ share: 3, yours: 7 });
    expect(splitGold([man()], 100).by?.kind).toBe('man_at_arms');
  });

  it('takes nothing from a pile too small to split, and nothing when he is dead or absent', () => {
    expect(splitGold([man()], 2)).toEqual({ share: 0, yours: 2 });
    expect(splitGold([man(0)], 30)).toEqual({ share: 0, yours: 30 });
    expect(splitGold([], 30)).toEqual({ share: 0, yours: 30 });
    expect(splitGold(undefined, 30)).toEqual({ share: 0, yours: 30 });
    expect(splitGold([man()], 0)).toEqual({ share: 0, yours: 0 });
  });

  it('the torchbearer asks for no share', () => {
    expect(splitGold([torch()], 30)).toEqual({ share: 0, yours: 30 });
  });

  it('always adds back up to the amount found', () => {
    for (let n = 0; n <= 200; n++) {
      const s = splitGold([man()], n);
      expect(s.share + s.yours).toBe(n);
    }
  });
});

describe('light', () => {
  it('a living torchbearer lights the way; a dead one does not', () => {
    expect(hirelingLightRadius([torch()])).toBe(TORCH_RADIUS);
    expect(hirelingLightRadius([torch(0)])).toBe(0);
    expect(hirelingLightRadius([man()])).toBe(0);
    expect(hirelingLightRadius(undefined)).toBe(0);
  });
});

describe('morale', () => {
  it('2d6 against 7 for the man-at-arms: 7 holds, 8 breaks', () => {
    // 4+3 = 7 holds
    expect(moraleCheck('man_at_arms', dealing([4, 3]))).toMatchObject({ rolled: 7, target: 7, passed: true });
    // 4+4 = 8 breaks and he flees
    expect(moraleCheck('man_at_arms', dealing([4, 4]))).toMatchObject({ rolled: 8, passed: false, failure: 'flees' });
    // box cars
    expect(moraleCheck('man_at_arms', dealing([6, 6])).passed).toBe(false);
    // snake eyes
    expect(moraleCheck('man_at_arms', dealing([1, 1])).passed).toBe(true);
  });

  it('the torchbearer who breaks is lost for good', () => {
    const r = moraleCheck('torchbearer', dealing([6, 6]));
    expect(r.passed).toBe(false);
    expect(r.failure).toBe('lost');
    expect(moraleCheck('torchbearer', dealing([3, 3])).passed).toBe(true); // 6 holds
    expect(moraleCheck('torchbearer', dealing([4, 3])).passed).toBe(false); // 7 breaks (target 6)
  });

  it('over many rolls the man-at-arms holds about 58 percent of the time', () => {
    const rng = mulberry32(42);
    let held = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (moraleCheck('man_at_arms', rng).passed) held++;
    expect(held / n).toBeGreaterThan(0.53);
    expect(held / n).toBeLessThan(0.63);
  });

  it('a man-at-arms checks the first time he is under half hit points, only once', () => {
    const m = man(5, 8);
    expect(shouldCheckMorale(m, 'hurt')).toBe(false); // 5 of 8 is over half
    m.hp = 4;
    expect(shouldCheckMorale(m, 'hurt')).toBe(false); // exactly half is not under
    m.hp = 3;
    expect(shouldCheckMorale(m, 'hurt')).toBe(true);
    m.hurtChecked = true;
    expect(shouldCheckMorale(m, 'hurt')).toBe(false);
  });

  it('the torchbearer checks the first time he is hurt at all', () => {
    const t = torch(3);
    expect(shouldCheckMorale(t, 'hurt')).toBe(false);
    t.hp = 2;
    expect(shouldCheckMorale(t, 'hurt')).toBe(true);
    t.hurtChecked = true;
    expect(shouldCheckMorale(t, 'hurt')).toBe(false);
  });

  it('a fighter checks when the player falls under a quarter; the torchbearer does not', () => {
    expect(shouldCheckMorale(man(), 'player_low')).toBe(true);
    expect(shouldCheckMorale(torch(), 'player_low')).toBe(false);
    expect(shouldCheckMorale(man(0), 'player_low')).toBe(false);
  });

  it('knows under a quarter from a quarter', () => {
    expect(playerIsLow(9, 40)).toBe(true);
    expect(playerIsLow(10, 40)).toBe(false);
    expect(playerIsLow(0, 40)).toBe(false);
    expect(playerIsLow(1, 0)).toBe(false);
  });

  it('a runaway is gone ten seconds', () => {
    expect(FLEE_MS).toBe(10000);
  });
});

describe('damage and rest', () => {
  it('hurts down to zero and says when he dies', () => {
    const m = man(5, 8);
    expect(hurtHireling(m, 3)).toBe(false);
    expect(m.hp).toBe(2);
    expect(hurtHireling(m, 9)).toBe(true);
    expect(m.hp).toBe(0);
  });

  it('a room mends all; the common room mends half the missing points', () => {
    const a = [man(2, 8), torch(1)];
    expect(restParty(a, 'common')).toBe(3 + 1); // half of 6, half of 2
    expect(a[0].hp).toBe(5);
    expect(a[1].hp).toBe(2);
    expect(restParty(a, 'room')).toBe(3 + 1);
    expect(a[0].hp).toBe(8);
    expect(a[1].hp).toBe(3);
    expect(restParty(a, 'room')).toBe(0);
  });

  it('the common room always gives at least one point to a hurt man', () => {
    const a = [torch(2)];
    expect(restParty(a, 'common')).toBe(1);
    expect(a[0].hp).toBe(3);
  });

  it('the dead stay dead', () => {
    const a = [man(0, 8)];
    expect(restParty(a, 'room')).toBe(0);
    expect(a[0].hp).toBe(0);
  });
});

describe('sanitizeParty (old and damaged saves)', () => {
  it('turns nothing into an empty party', () => {
    expect(sanitizeParty(undefined)).toEqual([]);
    expect(sanitizeParty(null)).toEqual([]);
    expect(sanitizeParty('x')).toEqual([]);
    expect(sanitizeParty([null, 3, {}])).toEqual([]);
  });

  it('drops the dead, the unknown and duplicates, and clamps hit points', () => {
    const party = sanitizeParty([
      { kind: 'torchbearer', name: 'Wim the wick', hp: 9, maxHp: 3 },
      { kind: 'torchbearer', name: 'Second', hp: 3, maxHp: 3 },
      { kind: 'man_at_arms', name: 'Dead Man', hp: 0, maxHp: 8 },
      { kind: 'wizard', name: 'Nope', hp: 5, maxHp: 5 },
    ]);
    expect(party).toHaveLength(1);
    expect(party[0]).toMatchObject({ kind: 'torchbearer', name: 'Wim the wick', hp: 3, maxHp: 3, id: 'torchbearer' });
  });

  it('keeps a good party as it is', () => {
    const m = { ...man(5, 8), hurtChecked: true };
    expect(sanitizeParty([m])).toEqual([m]);
  });
});
