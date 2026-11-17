/**
 * A delve: a character fights a run of encounters on one floor with no rest, only potions and class healing.
 * Encounters are drawn the way DungeonGenerator.ts fills rooms (line numbers in comments).
 */
import { extraMonstersPerRoom } from '../rules/pressure';
import type { ClassKey } from '../constants';
import { FLOOR_10_PLUS_POOL, FLOOR_ENEMY_POOLS } from '../constants';
import { mulberry32, type MonsterKey, type Rng } from '../rules';
import { betweenFights, preBuff, simulateFight, type MobSpec } from './fight';
import { buildHero, summarizeHero, type GearTier, type LoadoutSummary } from './loadout';
import type { SimOverrides } from './overrides';

export interface DelveConfig {
  classKey: ClassKey;
  floor: number;
  tier: GearTier;
  runs?: number;
  seed?: number;
  /** Encounters per run (default 8). */
  encounters?: number;
  /** Distinct gear rolls the runs cycle through for `found` (default 100). */
  loadouts?: number;
  overrides?: SimOverrides;
}

export interface DelveStats {
  classKey: ClassKey;
  floor: number;
  level: number;
  tier: GearTier;
  runs: number;
  clear4: number;
  clear8: number;
  /** Share of runs that ended because nothing left could be hurt (a monster needing a magic weapon). */
  stuck: number;
  /** Median hit points and share of maximum left after the fourth fight, among runs that got there alive. */
  medianHp4: number;
  medianHpPct4: number;
  /** Mean potions drunk in the first four fights. */
  potions4: number;
  /** Hit points lost to each monster over all runs. */
  damageBy: Partial<Record<MonsterKey, number>>;
  top: Array<{ key: MonsterKey; share: number }>;
  medianFightSec: number;
  loadout: LoadoutSummary;
}

/** Source: DungeonGenerator.getEnemyPool. */
export function poolFor(floor: number, overrides?: SimOverrides): readonly MonsterKey[] {
  if (overrides?.pool) return overrides.pool(floor);
  if (floor >= 10) return FLOOR_10_PLUS_POOL;
  return FLOOR_ENEMY_POOLS[Math.min(floor, FLOOR_ENEMY_POOLS.length - 1)] ?? FLOOR_ENEMY_POOLS[1];
}

const rint = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng.next() * (hi - lo + 1));

/**
 * One room's monsters. A floor has `min(8 + floor, 18) - 2` monster rooms; one is the den (3 to 4 + floor/3 monsters,
 * the first of them the champion, an elite), the rest hold 1 to 2 + floor/3 (DungeonGenerator.ts, "Enemies").
 */
export function drawEncounter(floor: number, rng: Rng, overrides?: SimOverrides, level = floor): MobSpec[] {
  const div = overrides?.groupDivisor ?? 3;
  const inner = Math.max(1, Math.min(8 + floor, 18) - 2);
  const den = rng.next() < 1 / inner;
  const extra = extraMonstersPerRoom(floor, level) + (overrides?.groupExtra?.(floor) ?? 0);
  const count = extra + (den ? rint(rng, 3, 4 + Math.floor(floor / div)) : rint(rng, 1, 2 + Math.floor(floor / div)));
  const pool = poolFor(floor, overrides);
  const out: MobSpec[] = [];
  for (let i = 0; i < count; i++) out.push({ key: pool[Math.floor(rng.next() * pool.length)], elite: den && i === 0 });
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

export function runDelve(cfg: DelveConfig): DelveStats {
  const runs = cfg.runs ?? 400;
  const K = cfg.encounters ?? 8;
  const seed = cfg.seed ?? 1;
  const loadouts = cfg.loadouts ?? 100;
  const level = Math.max(1, Math.min(12, cfg.floor + (cfg.overrides?.levelOffset ?? 0)));
  let clear4 = 0;
  let clear8 = 0;
  let stuck = 0;
  const hp4: number[] = [];
  const hpPct4: number[] = [];
  let potions4 = 0;
  const damageBy: Partial<Record<MonsterKey, number>> = {};
  const fightSecs: number[] = [];
  let loadout: LoadoutSummary | undefined;

  for (let r = 0; r < runs; r++) {
    const variant = cfg.tier === 'found' ? r % loadouts : r;
    const hero = buildHero({ classKey: cfg.classKey, level, floor: cfg.floor, tier: cfg.tier, seed: seed * 7919 + variant, overrides: cfg.overrides });
    if (!loadout) loadout = summarizeHero(hero);
    const rng = mulberry32((seed * 1000003 + r * 7919 + cfg.floor * 131 + cfg.classKey.length) >>> 0);
    preBuff(hero);
    let cleared = 0;
    let potionsAt4 = 0;
    for (let e = 0; e < K; e++) {
      const res = simulateFight(hero, { monsters: drawEncounter(cfg.floor, rng, cfg.overrides, level), floor: cfg.floor, overrides: cfg.overrides }, rng);
      fightSecs.push(res.durationMs / 1000);
      for (const [k, v] of Object.entries(res.damageBy)) damageBy[k as MonsterKey] = (damageBy[k as MonsterKey] ?? 0) + (v ?? 0);
      if (res.outcome !== 'won') { if (res.outcome === 'stuck') stuck++; break; }
      cleared++;
      betweenFights(hero, rng);
      if (cleared === 4) {
        hp4.push(hero.hp);
        hpPct4.push(hero.hp / hero.maxHp);
        potionsAt4 = hero.potionsUsed;
      }
    }
    if (cleared >= 4) clear4++;
    if (cleared >= K) clear8++;
    potions4 += cleared >= 4 ? potionsAt4 : hero.potionsUsed;
  }
  const total = Object.values(damageBy).reduce((a, b) => a + (b ?? 0), 0);
  const top = (Object.entries(damageBy) as Array<[MonsterKey, number]>)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, v]) => ({ key, share: total > 0 ? v / total : 0 }));
  return {
    classKey: cfg.classKey, floor: cfg.floor, level, tier: cfg.tier, runs,
    clear4: clear4 / runs, clear8: clear8 / runs, stuck: stuck / runs,
    medianHp4: median(hp4), medianHpPct4: median(hpPct4), potions4: potions4 / runs,
    damageBy, top, medianFightSec: median(fightSecs), loadout: loadout!,
  };
}
