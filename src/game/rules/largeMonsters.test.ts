import { describe, expect, it } from 'vitest';
import { MONSTERS, LARGE_MONSTER_KEYS } from './bestiary';
import { mulberry32 } from './dice';
import { MELEE_HOLD_PX } from './encounter';
import {
  PLAYER_HALF_PX,
  bodySizePx,
  edgeGapPx,
  hasClearBlock,
  holdDistancePx,
  layoutSeed,
  meleeDistances,
  monsterReachesPlayer,
  planLargeSpawns,
  planLargeSpawnsForLayout,
  playerReachesMonster,
  type LargeSpawnInput,
} from './largeMonsters';

describe('edge-to-edge reach', () => {
  it('measures the gap between two square bodies', () => {
    expect(edgeGapPx(40, 32, 48)).toBe(0);
    expect(edgeGapPx(50, 32, 64)).toBe(2);
    expect(edgeGapPx(20, 32, 32)).toBe(-12);
  });

  it('small monsters keep the legacy numbers exactly', () => {
    for (const size of [16, 20, 22, 24, 28, 30, 36]) {
      for (const range of [16, 20, 24, 26, 28]) {
        const d = meleeDistances(size, range);
        expect(d.approach).toBe(range + 8);
        expect(d.strike).toBe(Math.max(range + 16, MELEE_HOLD_PX + 10));
        expect(d.hold).toBe(MELEE_HOLD_PX);
      }
      expect(playerReachesMonster(48, size, 48)).toBe(true);
      expect(playerReachesMonster(49, size, 48)).toBe(false);
    }
  });

  it('a large monster never stands inside the player sprite', () => {
    for (const k of LARGE_MONSTER_KEYS) {
      const m = MONSTERS[k];
      const d = meleeDistances(m.size, m.attackRange);
      expect(edgeGapPx(d.hold, 32, m.size)).toBeGreaterThanOrEqual(0);
      expect(d.hold).toBe(PLAYER_HALF_PX + m.size / 2);
      expect(d.hold).toBeGreaterThan(MELEE_HOLD_PX);
      expect(d.strike).toBeGreaterThan(d.hold);
      expect(d.approach).toBeGreaterThan(d.hold);
      expect(d.approach).toBeLessThanOrEqual(d.strike);
    }
  });

  it('a bigger body reaches a little further than its listed edge reach', () => {
    const m = MONSTERS.BARROW_GIANT;
    const d = meleeDistances(m.size, m.attackRange);
    expect(edgeGapPx(d.strike, 32, m.size)).toBeGreaterThan(m.attackRange);
    expect(monsterReachesPlayer(d.strike, m.size, m.attackRange)).toBe(true);
    expect(monsterReachesPlayer(d.strike + 1, m.size, m.attackRange)).toBe(false);
  });

  it('the player strikes a big monster from farther centre distance, in proportion to its body', () => {
    expect(playerReachesMonster(56, 48, 48)).toBe(true);
    expect(playerReachesMonster(57, 48, 48)).toBe(false);
    expect(playerReachesMonster(64, 64, 48)).toBe(true);
    expect(playerReachesMonster(65, 64, 48)).toBe(false);
    // and it clears the standoff, so a monster that stopped at its hold distance is always in reach
    for (const size of [48, 64]) expect(playerReachesMonster(holdDistancePx(size), size, 48)).toBe(true);
  });
});

describe('large bodies', () => {
  it('are about 70% of the sprite and cannot fit a one-tile corridor', () => {
    expect(bodySizePx(48)).toBe(34);
    expect(bodySizePx(64)).toBe(45);
    for (const size of [48, 64]) expect(bodySizePx(size)).toBeGreaterThan(32);
  });
});

function open(w: number, h: number): LargeSpawnInput['isOpenFloor'] {
  return (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h;
}

function layout(floor: number): LargeSpawnInput {
  return {
    floor,
    rooms: [
      { x: 1, y: 1, w: 6, h: 6 },
      { x: 12, y: 2, w: 8, h: 8 },
      { x: 24, y: 2, w: 9, h: 9 },
      { x: 36, y: 2, w: 3, h: 3 },
      { x: 40, y: 2, w: 6, h: 6 },
    ],
    isOpenFloor: open(60, 20),
    occupied: [],
    keepAwayFrom: [{ tx: 3, ty: 3 }],
  };
}

describe('large spawn planning', () => {
  it('needs a clear 2x2 block', () => {
    const none = new Set<string>();
    expect(hasClearBlock(2, 2, open(10, 10), none)).toBe(true);
    expect(hasClearBlock(9, 2, open(10, 10), none)).toBe(false);
    expect(hasClearBlock(2, 2, open(10, 10), new Set(['3,3']))).toBe(false);
    expect(hasClearBlock(2, 2, (tx, ty) => !(tx === 3 && ty === 2), none)).toBe(false);
  });

  it('plans nothing on floors with no large monsters', () => {
    for (const f of [1, 2, 13]) {
      for (let seed = 0; seed < 30; seed++) expect(planLargeSpawns(layout(f), mulberry32(seed))).toEqual([]);
    }
  });

  it('plans at most two, each a legal key for the floor on a clear block inside a middle room', () => {
    let some = 0;
    for (let floor = 3; floor <= 12; floor++) {
      for (let seed = 0; seed < 60; seed++) {
        const input = layout(floor);
        const plan = planLargeSpawns(input, mulberry32(seed));
        expect(plan.length).toBeLessThanOrEqual(2);
        some += plan.length;
        for (const p of plan) {
          const m = MONSTERS[p.key];
          expect(floor).toBeGreaterThanOrEqual(m.minFloor);
          expect(floor).toBeLessThanOrEqual(m.maxFloor!);
          expect(p.roomIdx).toBeGreaterThan(0);
          expect(p.roomIdx).toBeLessThan(input.rooms.length - 1);
          const room = input.rooms[p.roomIdx];
          expect(p.tx).toBeGreaterThanOrEqual(room.x + 1);
          expect(p.ty).toBeGreaterThanOrEqual(room.y + 1);
          expect(p.tx + 1).toBeLessThanOrEqual(room.x + room.w - 2);
          expect(p.ty + 1).toBeLessThanOrEqual(room.y + room.h - 2);
          expect(p.x).toBe((p.tx + 1) * 32);
          expect(p.y).toBe((p.ty + 1) * 32);
        }
        if (plan.length === 2) {
          const [a, b] = plan;
          const apart = Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));
          expect(apart).toBeGreaterThanOrEqual(2); // two blocks never overlap
        }
      }
    }
    expect(some).toBeGreaterThan(0);
  });

  it('is rare: most floors get none or one', () => {
    let twos = 0;
    let zeros = 0;
    const n = 400;
    for (let seed = 0; seed < n; seed++) {
      const len = planLargeSpawns(layout(9), mulberry32(seed)).length;
      if (len === 2) twos++;
      if (len === 0) zeros++;
    }
    expect(twos / n).toBeLessThan(0.2);
    expect(zeros / n).toBeGreaterThan(0.25);
  });

  it('skips a room with no clear block rather than squeezing a giant in', () => {
    const input = layout(9);
    const tight: LargeSpawnInput = {
      ...input,
      isOpenFloor: (tx, ty) => tx >= 0 && ty >= 0 && (tx + ty) % 2 === 0, // a checkerboard has no 2x2 block
    };
    for (let seed = 0; seed < 50; seed++) expect(planLargeSpawns(tight, mulberry32(seed))).toEqual([]);
  });

  it('avoids occupied tiles and keeps away from the player start', () => {
    const input = layout(9);
    const occupied = [];
    // fill the two middle rooms that can hold a block: nothing is left to stand on
    for (let ty = 0; ty < 20; ty++) for (let tx = 12; tx < 33; tx++) occupied.push({ tx, ty });
    for (let seed = 0; seed < 50; seed++) expect(planLargeSpawns({ ...input, occupied }, mulberry32(seed))).toEqual([]);
    // the only candidate room is on top of the player
    const near = { ...input, rooms: [input.rooms[0], { x: 4, y: 4, w: 8, h: 8 }, input.rooms[4]], keepAwayFrom: [{ tx: 6, ty: 6 }] };
    for (let seed = 0; seed < 50; seed++) expect(planLargeSpawns(near, mulberry32(seed))).toEqual([]);
  });

  it('is repeatable for a given layout', () => {
    const a = planLargeSpawnsForLayout(layout(8));
    const b = planLargeSpawnsForLayout(layout(8));
    expect(b).toEqual(a);
    expect(layoutSeed(8, layout(8).rooms)).toBe(layoutSeed(8, layout(8).rooms));
    expect(layoutSeed(8, layout(8).rooms)).not.toBe(layoutSeed(9, layout(9).rooms));
  });
});
