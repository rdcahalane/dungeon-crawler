import { describe, expect, it } from 'vitest';
import { mulberry32, type Rng } from './dice';
import { MONSTERS, MONSTER_KEYS } from './bestiary';
import { charismaReaction } from './abilities';
import {
  ALLY_DEATH_RADIUS_PX, FLEE_MAX_MS, FLEE_MIN_MS, MAX_RETREATS, WANDER_CAP_PER_FLOOR, WANDER_MAX_TILES,
  WANDER_MIN_FLOOR_AGE_MS, WANDER_MIN_TILES, chooseWanderSpawn, findPath, fleeDurationMs, isIntelligent, lineOfSight,
  monsterReaction, moraleCheck, neverChecksMorale, reactionBand, reactionRoll, retreatOutcome, surpriseRoll,
  walkDistances, wanderBlockedReason, wanderCheck,
} from './encounter';

/** An Rng that returns the given floats in order, then repeats the last. */
function fixed(...values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)] };
}
/** Float that makes one die of `sides` show `face`. */
const face = (face: number, sides = 6) => (face - 1) / sides + 0.001;

describe('moraleCheck', () => {
  it('passes on a roll equal to morale and fails above it', () => {
    // 3 + 4 = 7
    expect(moraleCheck(7, fixed(face(3), face(4))).passed).toBe(true);
    expect(moraleCheck(6, fixed(face(3), face(4))).passed).toBe(false);
    expect(moraleCheck(7, fixed(face(3), face(4))).roll).toBe(7);
  });

  it('applies the modifier to the morale score', () => {
    const rng = () => fixed(face(4), face(4)); // 8
    expect(moraleCheck(7, rng()).passed).toBe(false);
    expect(moraleCheck(7, rng(), 1).passed).toBe(true);
    expect(moraleCheck(7, rng(), -1).target).toBe(6);
  });

  it('morale 12 only ever fails with a negative modifier', () => {
    const boxcars = fixed(face(6), face(6));
    expect(moraleCheck(12, boxcars).passed).toBe(true);
    expect(moraleCheck(12, fixed(face(6), face(6)), -1).passed).toBe(false);
  });

  it('fail rate over many seeded rolls matches 2d6', () => {
    const rng = mulberry32(1234);
    let fails = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) if (!moraleCheck(7, rng).passed) fails++;
    // P(2d6 > 7) = 15/36 = 41.7%
    expect(fails / n).toBeGreaterThan(0.38);
    expect(fails / n).toBeLessThan(0.45);
  });

  it('is deterministic for a seed', () => {
    const a = Array.from({ length: 8 }, () => 0).map(() => 0);
    const r1 = mulberry32(99);
    const r2 = mulberry32(99);
    for (let i = 0; i < a.length; i++) expect(moraleCheck(7, r1).roll).toBe(moraleCheck(7, r2).roll);
  });
});

describe('who checks morale', () => {
  it('undead, oozes, mimics, the boss and summoned things never check', () => {
    for (const key of ['SKELETON', 'ZOMBIE', 'GHOUL', 'WIGHT', 'WRAITH', 'GHOST', 'BONE_KNIGHT', 'OOZE', 'MIMIC', 'HOLLOW_KING'] as const) {
      expect(neverChecksMorale(MONSTERS[key])).toBe(true);
    }
    expect(neverChecksMorale(MONSTERS.BASIC, { summoned: true })).toBe(true);
  });

  it('flesh and blood monsters do check', () => {
    for (const key of ['BASIC', 'FAST', 'TANK', 'GIANT_RAT', 'GIANT_SPIDER', 'TROLL', 'DARK_ELF', 'GARGOYLE', 'CULTIST', 'GIANT_BAT'] as const) {
      expect(neverChecksMorale(MONSTERS[key])).toBe(false);
    }
  });

  it('every undead and boss in the bestiary is fearless', () => {
    for (const key of MONSTER_KEYS) {
      const def = MONSTERS[key];
      if (def.undead || def.boss) expect(neverChecksMorale(def)).toBe(true);
    }
  });

  it('six tiles is the ally-death radius', () => {
    expect(ALLY_DEATH_RADIUS_PX).toBe(192);
  });
});

describe('flight and recovery', () => {
  it('flees for 4 to 6 seconds', () => {
    expect(fleeDurationMs(fixed(0))).toBe(FLEE_MIN_MS);
    expect(fleeDurationMs(fixed(0.999999))).toBe(FLEE_MAX_MS);
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const ms = fleeDurationMs(rng);
      expect(ms).toBeGreaterThanOrEqual(4000);
      expect(ms).toBeLessThanOrEqual(6000);
    }
  });

  it('a steady monster returns, a shaky one keeps its distance', () => {
    expect(retreatOutcome(7, fixed(face(2), face(2)), 0)).toEqual({ outcome: 'return', roll: 4 });
    expect(retreatOutcome(7, fixed(face(6), face(6)), 0)).toEqual({ outcome: 'keep_distance', roll: 12 });
  });

  it('each retreat steadies it, and the last stops rolling', () => {
    // roll 8 vs morale 7: fails with no retreats behind it, passes after one (7 + 1).
    expect(retreatOutcome(7, fixed(face(4), face(4)), 0).outcome).toBe('keep_distance');
    expect(retreatOutcome(7, fixed(face(4), face(4)), 1).outcome).toBe('return');
    const spent = retreatOutcome(2, fixed(face(6), face(6)), MAX_RETREATS);
    expect(spent).toEqual({ outcome: 'return', roll: null });
  });
});

describe('reaction', () => {
  it('bands: 2 to 5 hostile, 6 to 8 wary, 9 or more afraid', () => {
    for (let t = -2; t <= 5; t++) expect(reactionBand(t)).toBe('hostile');
    for (let t = 6; t <= 8; t++) expect(reactionBand(t)).toBe('wary');
    for (let t = 9; t <= 15; t++) expect(reactionBand(t)).toBe('afraid');
  });

  it('adds the Charisma adjustment to 2d6', () => {
    const r = reactionRoll(fixed(face(3), face(2)), 0); // 5
    expect(r).toEqual({ roll: 5, total: 5, reaction: 'hostile' });
    expect(reactionRoll(fixed(face(3), face(2)), 1).reaction).toBe('wary'); // 6
    expect(reactionRoll(fixed(face(3), face(2)), -2).total).toBe(3);
    expect(reactionRoll(fixed(face(5), face(3)), charismaReaction(18)).reaction).toBe('afraid'); // 8 + 3
  });

  it('high Charisma shifts the odds toward wary and afraid', () => {
    const count = (adj: number) => {
      const rng = mulberry32(2024);
      const c = { hostile: 0, wary: 0, afraid: 0 };
      for (let i = 0; i < 6000; i++) c[reactionRoll(rng, adj).reaction]++;
      return c;
    };
    const low = count(-2);
    const high = count(3);
    expect(high.hostile).toBeLessThan(low.hostile);
    expect(high.afraid).toBeGreaterThan(low.afraid);
    // With no adjustment: P(hostile) = 10/36, P(afraid) = 10/36.
    const mid = count(0);
    expect(mid.hostile / 6000).toBeGreaterThan(0.24);
    expect(mid.hostile / 6000).toBeLessThan(0.32);
  });

  it('goblins, kobolds, orcs, dark elves and cultists are intelligent; the rest are not', () => {
    for (const k of ['BASIC', 'FAST', 'TANK', 'DARK_ELF', 'CULTIST'] as const) expect(isIntelligent(MONSTERS[k])).toBe(true);
    for (const k of ['GIANT_RAT', 'GIANT_BAT', 'GIANT_SPIDER', 'TROLL', 'GARGOYLE', 'OOZE', 'MIMIC', 'SKELETON', 'GHOST', 'HOLLOW_KING'] as const) {
      expect(isIntelligent(MONSTERS[k])).toBe(false);
    }
  });

  it('animals, vermin and undead are always hostile and do not consume the dice', () => {
    const rng = fixed(face(6), face(6)); // would be afraid
    expect(monsterReaction(MONSTERS.GIANT_RAT, rng, 3)).toBe('hostile');
    expect(monsterReaction(MONSTERS.SKELETON, rng, 3)).toBe('hostile');
    expect(monsterReaction(MONSTERS.BASIC, fixed(face(6), face(6)), 0)).toBe('afraid');
    expect(monsterReaction(MONSTERS.BASIC, fixed(face(6), face(6)), 0, { summoned: true })).toBe('hostile');
  });
});

describe('surprise', () => {
  it('is 2 in 6: faces 1 and 2 surprise, 3 to 6 do not', () => {
    expect(surpriseRoll(fixed(face(1)))).toBe(true);
    expect(surpriseRoll(fixed(face(2)))).toBe(true);
    for (let f = 3; f <= 6; f++) expect(surpriseRoll(fixed(face(f)))).toBe(false);
  });

  it('happens about a third of the time over many seeded rolls', () => {
    const rng = mulberry32(777);
    let n = 0;
    for (let i = 0; i < 6000; i++) if (surpriseRoll(rng)) n++;
    expect(n / 6000).toBeGreaterThan(0.31);
    expect(n / 6000).toBeLessThan(0.355);
  });
});

describe('wandering monsters', () => {
  it('rolls 1 in 6, or 2 in 6 after noise', () => {
    expect(wanderCheck(fixed(face(1)), false)).toBe(true);
    expect(wanderCheck(fixed(face(2)), false)).toBe(false);
    expect(wanderCheck(fixed(face(2)), true)).toBe(true);
    expect(wanderCheck(fixed(face(3)), true)).toBe(false);
  });

  it('noise doubles the odds over many seeded turns', () => {
    const quiet = mulberry32(31);
    const loud = mulberry32(31);
    let q = 0;
    let l = 0;
    for (let i = 0; i < 6000; i++) {
      if (wanderCheck(quiet, false)) q++;
      if (wanderCheck(loud, true)) l++;
    }
    expect(q / 6000).toBeGreaterThan(0.15);
    expect(q / 6000).toBeLessThan(0.185);
    expect(l / 6000).toBeGreaterThan(0.31);
    expect(l / 6000).toBeLessThan(0.355);
  });

  const open = { floor: 3, inTombFirstChamber: false, floorAgeMs: 30_000, restDialogOpen: false, spawnedThisVisit: 0 };
  it('is allowed in the ordinary case', () => {
    expect(wanderBlockedReason(open)).toBeNull();
  });
  it('is blocked in the tavern, the tomb first chamber, a rest dialog, a fresh floor and at the cap', () => {
    expect(wanderBlockedReason({ ...open, floor: 0 })).toBe('tavern');
    expect(wanderBlockedReason({ ...open, inTombFirstChamber: true })).toBe('tomb first chamber');
    expect(wanderBlockedReason({ ...open, restDialogOpen: true })).toBe('rest dialog');
    expect(wanderBlockedReason({ ...open, floorAgeMs: WANDER_MIN_FLOOR_AGE_MS - 1 })).toBe('floor just loaded');
    expect(wanderBlockedReason({ ...open, floorAgeMs: WANDER_MIN_FLOOR_AGE_MS })).toBeNull();
    expect(wanderBlockedReason({ ...open, spawnedThisVisit: WANDER_CAP_PER_FLOOR })).toBe('cap reached');
    expect(wanderBlockedReason({ ...open, spawnedThisVisit: WANDER_CAP_PER_FLOOR - 1 })).toBeNull();
  });
});

describe('sight and spawn placement', () => {
  /** A 40x9 hall: walls on rows 0 and 8, a wall column at x=20 with a gap on row 4. */
  const W = 40;
  const H = 9;
  const wall = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H || y === 0 || y === H - 1 || (x === 20 && y !== 4);
  const walkable = (x: number, y: number) => !wall(x, y);

  it('line of sight is blocked by walls and open across floor', () => {
    expect(lineOfSight(wall, { tx: 2, ty: 4 }, { tx: 15, ty: 4 })).toBe(true);
    expect(lineOfSight(wall, { tx: 2, ty: 2 }, { tx: 30, ty: 2 })).toBe(false);
    expect(lineOfSight(wall, { tx: 5, ty: 4 }, { tx: 5, ty: 4 })).toBe(true);
    // The end tiles never block, even when the target stands in a doorway of wall.
    expect(lineOfSight(wall, { tx: 18, ty: 2 }, { tx: 20, ty: 2 })).toBe(true);
  });

  it('walk distances respect walls and the step limit', () => {
    const d = walkDistances(walkable, { tx: 18, ty: 2 }, 6);
    expect(d.get('18,2')).toBe(0);
    expect(d.get('19,2')).toBe(1);
    expect(d.has('20,2')).toBe(false);
    // Through the gap at (20,4): 2 down + 2 across = 4 steps to (20,4).
    expect(d.get('20,4')).toBe(4);
    expect(d.has('30,4')).toBe(false);
  });

  it('finds a path through the gap and none through a sealed wall', () => {
    const path = findPath(walkable, { tx: 18, ty: 2 }, { tx: 22, ty: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ tx: 18, ty: 2 });
    expect(path![path!.length - 1]).toEqual({ tx: 22, ty: 2 });
    expect(path!.some((t) => t.tx === 20 && t.ty === 4)).toBe(true);
    for (const t of path!) expect(walkable(t.tx, t.ty)).toBe(true);
    // Each step is one tile.
    for (let i = 1; i < path!.length; i++) {
      expect(Math.abs(path![i].tx - path![i - 1].tx) + Math.abs(path![i].ty - path![i - 1].ty)).toBe(1);
    }
    const sealed = (x: number, y: number) => walkable(x, y) && !(x === 20 && y === 4);
    expect(findPath(sealed, { tx: 18, ty: 2 }, { tx: 22, ty: 2 })).toBeNull();
    expect(findPath(walkable, { tx: 3, ty: 3 }, { tx: 3, ty: 3 })).toEqual([{ tx: 3, ty: 3 }]);
  });

  it('chooses a reachable, unseen tile 12 to 18 tiles away', () => {
    const player = { tx: 5, ty: 2 };
    for (let seed = 1; seed <= 20; seed++) {
      const spot = chooseWanderSpawn(mulberry32(seed), player, walkable, wall);
      expect(spot).not.toBeNull();
      if (!spot) continue;
      const d = Math.hypot(spot.tx - player.tx, spot.ty - player.ty);
      expect(d).toBeGreaterThanOrEqual(WANDER_MIN_TILES);
      expect(d).toBeLessThanOrEqual(WANDER_MAX_TILES);
      expect(walkable(spot.tx, spot.ty)).toBe(true);
      expect(lineOfSight(wall, player, spot)).toBe(false);
    }
  });

  it('is repeatable for a seed and gives up when nothing qualifies', () => {
    const a = chooseWanderSpawn(mulberry32(8), { tx: 5, ty: 2 }, walkable, wall);
    const b = chooseWanderSpawn(mulberry32(8), { tx: 5, ty: 2 }, walkable, wall);
    expect(a).toEqual(b);
    // A closed cell: nothing 12 tiles away.
    const cell = (x: number, y: number) => !(x >= 0 && x < 5 && y >= 0 && y < 5);
    expect(chooseWanderSpawn(mulberry32(1), { tx: 2, ty: 2 }, (x, y) => !cell(x, y), cell)).toBeNull();
  });
});
