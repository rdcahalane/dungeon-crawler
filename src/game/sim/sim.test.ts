import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rules';
import { PLAYER_HIT_GRACE_MS } from '../scenes/game/AdndCombat';
import { drawEncounter, runDelve } from './delve';
import { simulateFight, type Hero } from './fight';
import { buildHero } from './loadout';
import { runBoss, runSampleBoss } from './boss';

const hero = (cls: 'fighter' | 'cleric' | 'wizard' | 'thief', level: number, floor: number, seed: number, tier: 'starter' | 'found' | 'good' = 'starter'): Hero =>
  buildHero({ classKey: cls, level, floor, tier, seed });

describe('simulateFight', () => {
  it('is deterministic for a seed', () => {
    const run = (): unknown => {
      const h = hero('cleric', 5, 5, 3);
      return { r: simulateFight(h, { monsters: [{ key: 'GHOUL' }, { key: 'SKELETON' }, { key: 'BASIC' }], floor: 5 }, mulberry32(42)), hp: h.hp };
    };
    expect(run()).toEqual(run());
  });

  it('a level-1 fighter beats one giant rat nearly always', () => {
    let wins = 0;
    for (let s = 0; s < 300; s++) {
      if (simulateFight(hero('fighter', 1, 1, s), { monsters: [{ key: 'GIANT_RAT' }], floor: 1 }, mulberry32(s + 1000)).outcome === 'won') wins++;
    }
    expect(wins / 300).toBeGreaterThan(0.97);
  });

  it('the hit-grace window caps incoming hits', () => {
    for (let s = 0; s < 20; s++) {
      const h = hero('thief', 1, 1, s);
      h.hp = h.maxHp = 400;
      h.potions = { healing: 0, extra: 0 };
      h.inventory.equipment = {}; // unarmed and unarmored: plenty of hits to count
      const rats = Array.from({ length: 6 }, () => ({ key: 'ZOMBIE' as const })); // fearless: no morale flights
      const res = simulateFight(h, { monsters: rats, floor: 7 }, mulberry32(s), { trace: true });
      const hits = (res.trace ?? []).filter((e) => e.cause !== 'poison');
      expect(hits.length).toBeGreaterThan(2);
      for (let i = 1; i < hits.length; i++) expect(hits[i].t - hits[i - 1].t).toBeGreaterThanOrEqual(PLAYER_HIT_GRACE_MS);
    }
  });

  it('counts the potions drunk', () => {
    const h = hero('wizard', 1, 3, 1);
    h.hp = h.maxHp = 12;
    h.potions = { healing: 4, extra: 0 };
    const res = simulateFight(h, { monsters: [{ key: 'BASIC' }, { key: 'BASIC' }, { key: 'FAST' }], floor: 3 }, mulberry32(9));
    expect(res.potionsUsed).toBeGreaterThan(0);
    expect(h.potions.healing).toBe(4 - res.potionsUsed);
    expect(h.potionsUsed).toBe(res.potionsUsed);
  });

  it('a mundane weapon cannot hurt a gargoyle', () => {
    const h = hero('fighter', 7, 7, 1);
    const res = simulateFight(h, { monsters: [{ key: 'GARGOYLE' }], floor: 7 }, mulberry32(1));
    expect(res.outcome).not.toBe('won');
  });
});

describe('delve and boss', () => {
  it('draws encounters from the floor pool', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50; i++) expect(drawEncounter(1, rng).length).toBeGreaterThan(0);
  });

  it('reports clear rates between 0 and 1, and found gear beats starter on floor 7', () => {
    const a = runDelve({ classKey: 'fighter', floor: 7, tier: 'starter', runs: 60 });
    const b = runDelve({ classKey: 'fighter', floor: 7, tier: 'found', runs: 60 });
    expect(a.clear4).toBeGreaterThanOrEqual(0);
    expect(b.clear4).toBeLessThanOrEqual(1);
    expect(b.clear4).toBeGreaterThan(a.clear4);
  });

  it('the Hollow King is far deadlier without the paralysis immunity window', () => {
    const withImm = runSampleBoss(60, undefined, 3);
    const without = runSampleBoss(60, { holdImmunity: false }, 3);
    expect(without.win).toBeLessThan(withImm.win);
    expect(runBoss({ classKey: 'cleric', level: 11, tier: 'found', runs: 10 }).runs).toBe(10);
  });
});
