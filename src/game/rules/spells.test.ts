import { describe, expect, it } from 'vitest';
import { mulberry32 } from './dice';
import {
  SPELL_DEFS,
  SPELL_KEYS,
  Spellbook,
  WIZARD_DART,
  damageDice,
  getSpell,
  isCaster,
  missileCount,
  spellsFor,
  type SpellEffect,
} from './spells';

describe('spell definitions', () => {
  it('has the classic generic names and every field filled', () => {
    for (const name of ['magic_missile', 'sleep', 'light', 'web', 'fireball', 'cure_light_wounds', 'bless', 'hold_person', 'find_traps', 'knock', 'detect_magic']) {
      expect(getSpell(name), name).toBeDefined();
    }
    for (const key of SPELL_KEYS) {
      const s = SPELL_DEFS[key];
      expect(s.key).toBe(key);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(10);
      expect(['self', 'touch', 'near', 'far']).toContain(s.range);
      expect([1, 2, 3, 4]).toContain(s.level);
      expect(['wizard', 'cleric']).toContain(s.classKey);
      expect(s.effect.kind).toBeTruthy();
    }
  });

  it('each class has 6..10 spells covering several spell levels', () => {
    for (const c of ['wizard', 'cleric'] as const) {
      const all = spellsFor(c);
      expect(all.length).toBeGreaterThanOrEqual(6);
      expect(all.length).toBeLessThanOrEqual(10);
      expect(new Set(all.map((s) => s.level)).size).toBeGreaterThanOrEqual(3);
      expect(spellsFor(c, 1).length).toBeGreaterThanOrEqual(3);
    }
    expect(spellsFor('fighter')).toEqual([]);
  });

  it('keys are unique', () => {
    expect(new Set(SPELL_KEYS).size).toBe(SPELL_KEYS.length);
  });

  it('missiles and fireball scale with level', () => {
    const mm = SPELL_DEFS.magic_missile.effect as Extract<SpellEffect, { kind: 'missiles' }>;
    expect(missileCount(mm, 1)).toBe(1);
    expect(missileCount(mm, 3)).toBe(2);
    expect(missileCount(mm, 9)).toBe(5);
    const fb = SPELL_DEFS.fireball.effect as Extract<SpellEffect, { kind: 'damage' }>;
    expect(damageDice(fb, 5)).toEqual([5, 6]);
    expect(damageDice(fb, 12)).toEqual([10, 6]);
    expect(damageDice(fb, 0)).toEqual([1, 6]);
    const is = SPELL_DEFS.ice_storm.effect as Extract<SpellEffect, { kind: 'damage' }>;
    expect(damageDice(is, 12)).toEqual([3, 10]);
  });

  it('the wizard dart is weak', () => {
    expect(WIZARD_DART.dice[0] * WIZARD_DART.dice[1]).toBeLessThanOrEqual(3);
  });
});

describe('Spellbook slots and casting', () => {
  it('memorize respects slot counts by spell level', () => {
    const b = Spellbook.create('wizard', 3); // [2,1,0,0]
    expect(b.slots()).toEqual([2, 1, 0, 0]);
    expect(b.memorize('magic_missile')).toBe(true);
    expect(b.memorize('magic_missile')).toBe(true);
    expect(b.memorize('sleep')).toBe(false); // first-level slots full
    expect(b.freeSlots(1)).toBe(0);
    expect(b.memorize('fireball')).toBe(false); // level 3, no slots
  });

  it('wizard must know a spell; learning opens it up', () => {
    const b = Spellbook.create('wizard', 3);
    expect(b.memorize('web')).toBe(false);
    expect(b.knows('web')).toBe(false);
    expect(b.learn('web')).toBe(true);
    expect(b.memorize('web')).toBe(true);
    expect(b.learn('cure_light_wounds')).toBe(false); // wrong class
    expect(b.memorize('cure_light_wounds')).toBe(false);
  });

  it('cast consumes a slot and rest restores it', () => {
    const b = Spellbook.create('wizard', 1);
    expect(b.cast('magic_missile')).toBe(false); // nothing memorized
    b.memorize('magic_missile');
    expect(b.canCast('magic_missile')).toBe(true);
    expect(b.remaining('magic_missile')).toBe(1);
    expect(b.cast('magic_missile')).toBe(true);
    expect(b.remaining('magic_missile')).toBe(0);
    expect(b.cast('magic_missile')).toBe(false);
    // the slot stays occupied by the spent spell until rest
    expect(b.memorize('sleep')).toBe(false);
    b.rest();
    expect(b.remaining('magic_missile')).toBe(1);
    expect(b.cast('magic_missile')).toBe(true);
  });

  it('duplicate memorizations are cast one at a time', () => {
    const b = Spellbook.create('wizard', 2);
    b.memorize('sleep');
    b.memorize('sleep');
    expect(b.remaining('sleep')).toBe(2);
    b.cast('sleep');
    expect(b.remaining('sleep')).toBe(1);
    expect(b.available()).toEqual([{ key: 'sleep', remaining: 1 }]);
    expect(b.prepared()).toEqual([{ key: 'sleep', total: 2, remaining: 1 }]);
    b.cast('sleep');
    expect(b.available()).toEqual([]);
  });

  it('unmemorize frees a slot only for an uncast copy', () => {
    const b = Spellbook.create('wizard', 1);
    b.memorize('light');
    b.cast('light');
    expect(b.unmemorize('light')).toBe(false);
    b.rest();
    expect(b.unmemorize('light')).toBe(true);
    expect(b.freeSlots(1)).toBe(1);
  });

  it('cleric knows the whole list up to the levels it has slots for, with Wisdom bonus slots', () => {
    const b = Spellbook.create('cleric', 3, { bonusSlots: [2, 0, 0, 0] }); // base [2,1,0,0]
    expect(b.slots()).toEqual([4, 1, 0, 0]);
    expect(b.knows('cure_light_wounds')).toBe(true);
    expect(b.knows('hold_person')).toBe(true);
    expect(b.knows('cure_serious_wounds')).toBe(false); // level 4, no slots
    expect(b.memorize('cure_light_wounds')).toBe(true);
    expect(b.memorize('cure_light_wounds')).toBe(true);
    expect(b.memorize('bless')).toBe(true);
    expect(b.memorize('bless')).toBe(true);
    expect(b.memorize('bless')).toBe(false);
    expect(b.memorize('hold_person')).toBe(true);
    expect(b.memorize('find_traps')).toBe(false);
  });

  it('fillDefault fills every slot it can', () => {
    const b = Spellbook.create('cleric', 5); // [3,3,1,0]
    const n = b.fillDefault();
    expect(n).toBe(7);
    for (let lv = 1; lv <= 4; lv++) expect(b.freeSlots(lv)).toBe(0);
    const w = Spellbook.create('wizard', 1);
    expect(w.fillDefault()).toBe(1);
  });

  it('non-casters have no slots and cannot memorize', () => {
    const b = Spellbook.create('fighter', 12);
    expect(b.slots()).toEqual([0, 0, 0, 0]);
    expect(b.memorize('magic_missile')).toBe(false);
    expect(isCaster('fighter')).toBe(false);
    expect(isCaster('cleric')).toBe(true);
  });
});

describe('Spellbook serialization and levelling', () => {
  it('round-trips through JSON with state intact', () => {
    const b = Spellbook.create('wizard', 5);
    b.memorize('magic_missile');
    b.memorize('sleep');
    b.learn('web');
    b.memorize('web');
    b.cast('sleep');
    const json = JSON.parse(JSON.stringify(b.serialize()));
    const c = Spellbook.deserialize(json);
    expect(c.serialize()).toEqual(b.serialize());
    expect(c.remaining('sleep')).toBe(0);
    expect(c.remaining('magic_missile')).toBe(1);
    c.rest();
    expect(c.remaining('sleep')).toBe(1);
    expect(b.remaining('sleep')).toBe(0); // independent copies
  });

  it('serialize returns copies and deserialize rejects junk', () => {
    const b = Spellbook.create('wizard', 1);
    const s = b.serialize();
    s.memorized.push('sleep');
    expect(b.remaining('sleep')).toBe(0);
    expect(() => Spellbook.deserialize({ v: 2 } as never)).toThrow();
  });

  it('deserialize trims memorized spells that exceed the slots', () => {
    const c = Spellbook.deserialize({
      v: 1, classKey: 'wizard', level: 1, bonusSlots: [0, 0, 0, 0],
      known: ['magic_missile', 'sleep'],
      memorized: ['magic_missile', 'sleep', 'sleep'], spent: ['sleep'],
    });
    expect(c.prepared().reduce((a, p) => a + p.total, 0)).toBe(1);
  });

  it('level up grants slots; level down trims', () => {
    const b = Spellbook.create('wizard', 1);
    b.memorize('magic_missile');
    b.setLevel(4); // [3,2,0,0]
    expect(b.freeSlots(1)).toBe(2);
    b.memorize('sleep');
    b.memorize('light');
    b.setLevel(1);
    expect(b.prepared().reduce((a, p) => a + p.total, 0)).toBe(1);
  });

  it('tryLearn uses the Intelligence chance and is seeded', () => {
    const lowInt = Spellbook.create('wizard', 5);
    expect(lowInt.tryLearn('fireball', 3, mulberry32(1))).toBe(false); // spell level above INT limit
    let learned = 0;
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const b = Spellbook.create('wizard', 5);
      if (b.tryLearn('web', 15, rng)) learned++;
    }
    expect(learned / 400).toBeGreaterThan(0.55);
    expect(learned / 400).toBeLessThan(0.75);
  });
});
