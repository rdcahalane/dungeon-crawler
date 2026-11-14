/**
 * The final fight: the Hollow King alone in his chamber (tomb.ts has no guards there; his help is summoned), with
 * his summons and phases from the bestiary, against a level 10 to 12 character, with or without a man-at-arms.
 */
import type { ClassKey } from '../constants';
import { mulberry32 } from '../rules';
import { betweenFights, preBuff, simulateFight, type Hero } from './fight';
import { starterKit } from '../items';
import { makeBook, DEFAULT_SCORES, buildHero, summarizeHero, type GearTier, type LoadoutSummary } from './loadout';
import type { SimOverrides } from './overrides';

export const TOMB_FLOOR = 13;
export const BOSS_MAX_MS = 300_000;

export interface BossConfig {
  classKey: ClassKey;
  level: number;
  tier: GearTier;
  hireling?: boolean;
  runs?: number;
  seed?: number;
  loadouts?: number;
  overrides?: SimOverrides;
}

export interface BossStats {
  classKey: ClassKey;
  level: number;
  tier: GearTier;
  hireling: boolean;
  runs: number;
  win: number;
  died: number;
  /** Could not hurt the king at all (no magic weapon). */
  stuck: number;
  medianSec: number;
  medianWinSec: number;
  potionsMean: number;
  loadout: LoadoutSummary;
}

const med = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
};

export function runBoss(cfg: BossConfig): BossStats {
  const runs = cfg.runs ?? 400;
  const seed = cfg.seed ?? 1;
  const loadouts = cfg.loadouts ?? 100;
  let win = 0, died = 0, stuck = 0, potions = 0;
  const secs: number[] = [];
  const winSecs: number[] = [];
  let loadout: LoadoutSummary | undefined;
  for (let r = 0; r < runs; r++) {
    const variant = cfg.tier === 'found' ? r % loadouts : r;
    const hero = buildHero({ classKey: cfg.classKey, level: cfg.level, floor: TOMB_FLOOR, tier: cfg.tier, seed: seed * 7919 + variant, overrides: cfg.overrides });
    if (!loadout) loadout = summarizeHero(hero);
    const rng = mulberry32((seed * 1000003 + r * 7919 + cfg.level * 31) >>> 0);
    preBuff(hero);
    betweenFights(hero, rng);
    const res = simulateFight(hero, { monsters: [{ key: 'HOLLOW_KING' }], floor: TOMB_FLOOR, overrides: cfg.overrides, hireling: cfg.hireling, maxMs: BOSS_MAX_MS }, rng);
    secs.push(res.durationMs / 1000);
    potions += res.potionsUsed;
    if (res.outcome === 'won') { win++; winSecs.push(res.durationMs / 1000); }
    else if (res.outcome === 'died') died++;
    else stuck++;
  }
  return {
    classKey: cfg.classKey, level: cfg.level, tier: cfg.tier, hireling: !!cfg.hireling, runs,
    win: win / runs, died: died / runs, stuck: stuck / runs, medianSec: med(secs), medianWinSec: med(winSecs),
    potionsMean: potions / runs, loadout: loadout!,
  };
}

/**
 * The browser-play character the boss was first measured against: a level 10 fighter, +2 long sword, chain mail and no
 * shield (AC 5), 52 hit points, three healing potions. Used to check that the sim agrees the fight is deadly there.
 */
export function sampleFighter(): Hero {
  const inv = starterKit('fighter');
  const w = inv.equipment.weapon;
  if (w) w.plus = 2;
  delete inv.equipment.offhand;
  const scores = DEFAULT_SCORES.fighter;
  return {
    classKey: 'fighter', level: 10, scores, inventory: inv, hp: 52, maxHp: 52, drained: 0,
    potions: { healing: 3, extra: 0 }, book: makeBook('fighter', 10, scores, inv), blessToHit: 0, buffAc: 0, potionsUsed: 0,
  };
}

export function runSampleBoss(runs = 400, overrides?: SimOverrides, seed = 1): { win: number; medianSec: number } {
  let win = 0;
  const secs: number[] = [];
  for (let r = 0; r < runs; r++) {
    const hero = sampleFighter();
    const rng = mulberry32((seed * 1000003 + r * 7919) >>> 0);
    const res = simulateFight(hero, { monsters: [{ key: 'HOLLOW_KING' }], floor: TOMB_FLOOR, overrides, maxMs: BOSS_MAX_MS }, rng);
    secs.push(res.durationMs / 1000);
    if (res.outcome === 'won') win++;
  }
  return { win: win / runs, medianSec: med(secs) };
}
