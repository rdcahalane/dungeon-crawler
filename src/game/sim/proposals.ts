/**
 * Candidate tuning changes, tested by handing them to the sim as overrides. Nothing here edits the bestiary.
 * `scripts/sim-balance.ts --compare <name>` prints before and after; the numbers are quoted in docs/balance-report.md.
 */
import { enemyPoolForFloor } from '../constants';
import { MONSTERS, type MonsterDef, type MonsterSpecial } from '../rules';
import type { SimOverrides } from './overrides';

/** The king's stat block with changes: `special` entries of a kind are replaced by the given ones. */
function king(patch: Partial<MonsterDef>, specials: MonsterSpecial[] = []): SimOverrides {
  const kinds = new Set(specials.map((s) => s.kind));
  const base = (MONSTERS.HOLLOW_KING.special ?? []).filter((s) => !kinds.has(s.kind));
  return { monsters: { HOLLOW_KING: { ...patch, special: [...base, ...specials] } } };
}

const phases = (ghouls: number, wraith: number, mult = 0.7) => ({
  kind: 'phases' as const,
  phases: [
    { hpBelowPct: 66, label: 'The Gathering Dark', summon: 'GHOUL' as const, summonCount: ghouls },
    { hpBelowPct: 33, label: 'The Burning Crown', speedMult: 1.4, cooldownMult: mult, summon: 'WRAITH' as const, summonCount: wraith },
  ],
});

export const PROPOSALS: Record<string, SimOverrides> = {
  // Floors 3 to 5, class-neutral levers (tested, mostly rejected).
  groups2: { groupDivisor: 2 },
  dmg35: { damageBonus: (f) => (f >= 3 && f <= 5 ? 1 : 0) },
  hpup: { hpMult: (f) => (f >= 3 && f <= 5 ? 1.5 : 1) },
  tough35: { hpMult: (f) => (f >= 3 && f <= 5 ? 2 : 1), damageBonus: (f) => (f >= 3 && f <= 5 ? 1 : 0) },
  // Gargoyles (they need a +1 weapon) from floor 7, or 8; richer drops.
  garg7: { pool: (f) => enemyPoolForFloor(f >= 10 ? 11 : f).filter((k) => k !== 'GARGOYLE' || f >= 7) },
  garg8: { pool: (f) => enemyPoolForFloor(f >= 10 ? 11 : f).filter((k) => k !== 'GARGOYLE' || f >= 8) },
  weapons: { drops: { extraItemsPerFloor: 3, extraItemBias: 2 } },
  // The Hollow King. The game's numbers: 12d8, crown touch 1d10+2 / 1400 ms, summon every 12 s (4 alive), 2 ghouls + 1 wraith.
  kingHp: king({ hpDice: '12d8+36' }),
  kingFast: king({ attackCooldownMs: 1100 }),
  kingAdds: king({}, [{ kind: 'summon', monster: 'SKELETON', everyMs: 6000, maxAlive: 6 }]),
  kingMix: king({ hpDice: '12d8+30', attackCooldownMs: 1200 }, [
    { kind: 'summon', monster: 'SKELETON', everyMs: 8000, maxAlive: 5 }, phases(3, 1, 0.7),
  ]),
  // Recommended: about 170 more hit points, crown touch 2d6+3 every 1.1 s, paralysis 2 s, a skeleton every 6 s (6 alive),
  // three ghouls at 66% and two wraiths at 33%.
  kingFinal: king({ hpDice: '12d8+170', attacks: [{ name: 'Crown touch', dice: '2d6', bonus: 3 }], attackCooldownMs: 1100 }, [
    { kind: 'paralysis', save: 'death', durationMs: 2000 },
    { kind: 'summon', monster: 'SKELETON', everyMs: 6000, maxAlive: 6 }, phases(3, 2, 0.7),
  ]),
  // Between the light and the recommended king (2026-11-14): more hit points and adds, the touch and hold as they are.
  kingMid: king({ hpDice: '12d8+90', attacks: [{ name: 'Crown touch', dice: '1d10', bonus: 3 }], attackCooldownMs: 1200 }, [
    { kind: 'summon', monster: 'SKELETON', everyMs: 8000, maxAlive: 5 }, phases(2, 1, 0.75),
  ]),
  kingMid2: king({ hpDice: '12d8+120', attacks: [{ name: 'Crown touch', dice: '1d10', bonus: 3 }], attackCooldownMs: 1200 }, [
    { kind: 'summon', monster: 'SKELETON', everyMs: 7000, maxAlive: 5 }, phases(3, 1, 0.7),
  ]),
  kingHarder: king({ hpDice: '12d8+48', attackCooldownMs: 1100 }, [
    { kind: 'summon', monster: 'SKELETON', everyMs: 6000, maxAlive: 6 }, phases(3, 2, 0.6),
  ]),
};
