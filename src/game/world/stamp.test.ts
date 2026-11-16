import { afterEach, describe, expect, it, vi } from 'vitest';
import { TILE, type TileValue } from '../constants';
import { generateDungeon, type DungeonData } from '../systems/DungeonGenerator';
import { tileKindOf } from './builder';
import { createMechState } from './mechanisms';
import { buildTombFloor, stampVaults } from './stamp';
import { seeded } from './testkit';
import { TOMB } from './tomb';
import { VAULT_BY_ID } from './vaults';

const PASSABLE = new Set<TileValue>([TILE.FLOOR, TILE.STAIRS, TILE.STAIRS_UP, TILE.TRAP, TILE.SECRET_DOOR]);

function connected(d: DungeonData, from: { tx: number; ty: number }, to: { tx: number; ty: number }): boolean {
  const h = d.tiles.length;
  const w = d.tiles[0].length;
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.tx < 0 || p.ty < 0 || p.tx >= w || p.ty >= h) continue;
    const k = p.ty * w + p.tx;
    if (seen.has(k) || !PASSABLE.has(d.tiles[p.ty][p.tx])) continue;
    seen.add(k);
    stack.push({ tx: p.tx + 1, ty: p.ty }, { tx: p.tx - 1, ty: p.ty }, { tx: p.tx, ty: p.ty + 1 }, { tx: p.tx, ty: p.ty - 1 });
  }
  return seen.has(to.ty * w + to.tx);
}

afterEach(() => vi.restoreAllMocks());

describe('stampVaults', () => {
  it('on 200 generated dungeons across floors 1-12 never overwrites start or stairs, and keeps stairs reachable', () => {
    let withVault = 0;
    const seenVaults = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const floor = 1 + (i % 12);
      const rng = seeded(1000 + i);
      vi.spyOn(Math, 'random').mockImplementation(() => rng.next());
      const d = generateDungeon(floor);
      vi.restoreAllMocks();

      expect(d.tiles[d.stairsPos.ty][d.stairsPos.tx]).toBe(TILE.STAIRS);
      expect(d.tiles[d.stairsUpPos.ty][d.stairsUpPos.tx]).toBe(TILE.STAIRS_UP);
      expect(d.tiles[d.playerStart.ty][d.playerStart.tx]).toBe(TILE.FLOOR);
      expect(connected(d, d.playerStart, d.stairsPos), `floor ${floor} seed ${i}`).toBe(true);
      if (d.vaultIds && d.vaultIds.length > 0) {
        withVault++;
        expect(d.vaultIds.length).toBeLessThanOrEqual(3);
        for (const id of d.vaultIds) {
          const v = VAULT_BY_ID[id];
          seenVaults.add(id);
          expect(floor >= v.minFloor && floor <= v.maxFloor).toBe(true);
        }
        expect(new Set(d.vaultIds).size).toBe(d.vaultIds.length);
        // mechanisms are unique and load into an engine
        expect(() => createMechState(d.mechanisms ?? [])).not.toThrow();
      }
    }
    expect(withVault).toBeGreaterThanOrEqual(150);
    expect(seenVaults.size).toBeGreaterThanOrEqual(10);
  });

  it('only ever changes wall tiles, writes the vault map where it says, and joins its entrance to the level', () => {
    for (let i = 0; i < 60; i++) {
      const floor = 1 + (i % 12);
      const rng = seeded(5000 + i);
      vi.spyOn(Math, 'random').mockImplementation(() => rng.next());
      const base = generateDungeon(floor);
      vi.restoreAllMocks();
      const before = base.tiles.map((r) => r.slice());
      const idsBefore = [...(base.vaultIds ?? [])];
      const placed = stampVaults(base, floor, seeded(77 + i));
      for (let y = 0; y < before.length; y++) {
        for (let x = 0; x < before[0].length; x++) {
          if (before[y][x] !== TILE.WALL) expect(base.tiles[y][x]).toBe(before[y][x]);
        }
      }
      expect(base.vaultIds).toEqual([...idsBefore, ...placed]);
      for (const id of placed) {
        const v = VAULT_BY_ID[id];
        const specs = base.mechanisms!.filter((m) => v.mechanisms.some((vm) => vm.id === m.id));
        expect(specs.length).toBe(v.mechanisms.length);
        const dx = specs[0].tx - v.mechanisms[0].tx;
        const dy = specs[0].ty - v.mechanisms[0].ty;
        for (let y = 0; y < v.height; y++) {
          for (let x = 0; x < v.width; x++) {
            const want = tileKindOf(v.rows[y][x]) === 'floor' ? TILE.FLOOR : TILE.WALL;
            expect(base.tiles[y + dy][x + dx]).toBe(want);
          }
        }
        // every stamped entrance is reachable from the player start
        const reachable = v.entrances.some((e) => connected(base, base.playerStart, { tx: e.x + dx, ty: e.y + dy }));
        expect(reachable, `${id} floor ${floor}`).toBe(true);
        // chests arrived in the vault
        for (const c of v.chests) {
          expect(base.chests.some((k) => k.tx === c.tx + dx && k.ty === c.ty + dy && k.tier === v.lootTier)).toBe(true);
        }
      }
    }
  });

  it('is deterministic for a given rng', () => {
    const mk = () => {
      const rng = seeded(31337);
      vi.spyOn(Math, 'random').mockImplementation(() => rng.next());
      const d = generateDungeon(6);
      vi.restoreAllMocks();
      return d;
    };
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe('buildTombFloor', () => {
  it('produces a valid 64x48 DungeonData with the boss marker and mechanisms', () => {
    const d = buildTombFloor();
    expect(d.tiles).toHaveLength(48);
    for (const r of d.tiles) expect(r).toHaveLength(64);
    expect(d.tiles[d.stairsUpPos.ty][d.stairsUpPos.tx]).toBe(TILE.STAIRS_UP);
    expect(d.tiles[d.stairsPos.ty][d.stairsPos.tx]).toBe(TILE.STAIRS);
    expect(d.tiles[d.playerStart.ty][d.playerStart.tx]).toBe(TILE.FLOOR);
    expect(d.spawnMarkers).toEqual([{ tx: TOMB.bossSpawn.tx, ty: TOMB.bossSpawn.ty, monster: 'HOLLOW_KING' }]);
    expect(d.mechanisms!.length).toBe(TOMB.mechanisms.length);
    expect(d.inscriptions!.length).toBeGreaterThan(5);
    expect(d.vaultIds).toEqual([TOMB.id]);
    for (const e of d.enemies) expect(d.tiles[e.ty][e.tx]).toBe(TILE.FLOOR);
    for (const c of d.chests) expect(d.tiles[c.ty][c.tx]).toBe(TILE.FLOOR);
    expect(() => createMechState(d.mechanisms!)).not.toThrow();
  });
});
