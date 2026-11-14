// Stamping vaults into generated floors, and building the fixed final floor.
// Pure TypeScript; the only randomness is the Rng handed in.

import { MAP_HEIGHT, MAP_WIDTH, TILE, type TileValue } from '../constants';
import type { DungeonData, Room } from '../systems/DungeonGenerator';
import { tileKindOf } from './builder';
import { translateSpec } from './mechanisms';
import { TOMB, CELL } from './tomb';
import type { InscriptionSpawn, MechanismSpec, Rng, VaultDef } from './types';
import { vaultsForFloor } from './vaults';

const MAX_CORRIDOR = 10;

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIRS = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
} as const;

function inscriptionsOf(specs: MechanismSpec[]): InscriptionSpawn[] {
  return specs
    .filter((s) => s.kind === 'inscription' && s.clue)
    .map((s) => ({ id: s.id, tx: s.tx, ty: s.ty, text: s.clue as string, look: s.params.look ?? 'inscription' }));
}

/** Prefix-sum table of "not solid wall (or protected)" so a rectangle test is O(1). */
function buildBlockedSums(tiles: TileValue[][], protectedTiles: Set<number>): number[][] {
  const sums: number[][] = Array.from({ length: MAP_HEIGHT + 1 }, () => Array(MAP_WIDTH + 1).fill(0));
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const blocked = tiles[y][x] !== TILE.WALL || protectedTiles.has(y * MAP_WIDTH + x) ? 1 : 0;
      sums[y + 1][x + 1] = sums[y][x + 1] + sums[y + 1][x] - sums[y][x] + blocked;
    }
  }
  return sums;
}

function rectBlocked(sums: number[][], x0: number, y0: number, x1: number, y1: number): number {
  return sums[y1 + 1][x1 + 1] - sums[y0][x1 + 1] - sums[y1 + 1][x0] + sums[y0][x0];
}

const WALKABLE = new Set<TileValue>([TILE.FLOOR, TILE.STAIRS, TILE.STAIRS_UP, TILE.TRAP, TILE.SECRET_DOOR]);

/** Every tile the player can walk to from the start, as y * MAP_WIDTH + x keys. */
function reachableFromStart(d: DungeonData): Set<number> {
  const seen = new Set<number>();
  const stack = [d.playerStart.ty * MAP_WIDTH + d.playerStart.tx];
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const x = k % MAP_WIDTH;
    const y = (k - x) / MAP_WIDTH;
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT || seen.has(k) || !WALKABLE.has(d.tiles[y][x])) continue;
    seen.add(k);
    stack.push(k + 1, k - 1, k + MAP_WIDTH, k - MAP_WIDTH);
  }
  return seen;
}

interface Placement {
  ox: number;
  oy: number;
  corridor: { x: number; y: number }[];
}

function findPlacement(
  d: DungeonData, v: VaultDef, protectedTiles: Set<number>, rng: Rng,
): Placement | null {
  const sums = buildBlockedSums(d.tiles, protectedTiles);
  // a corridor must join floor the player can actually reach, not a sealed pocket of the generated level
  const reach = reachableFromStart(d);
  const spots: { ox: number; oy: number }[] = [];
  for (let oy = 2; oy + v.height <= MAP_HEIGHT - 2; oy++) {
    for (let ox = 2; ox + v.width <= MAP_WIDTH - 2; ox++) {
      // the vault plus a one-tile margin must be solid rock
      if (rectBlocked(sums, ox - 1, oy - 1, ox + v.width, oy + v.height) === 0) spots.push({ ox, oy });
    }
  }
  for (const { ox, oy } of shuffle(spots, rng)) {
    for (const e of shuffle(v.entrances, rng)) {
      const dir = DIRS[e.dir];
      let x = ox + e.x + dir.dx;
      let y = oy + e.y + dir.dy;
      const path: { x: number; y: number }[] = [];
      for (let step = 0; step < MAX_CORRIDOR; step++) {
        if (x < 1 || y < 1 || x > MAP_WIDTH - 2 || y > MAP_HEIGHT - 2) break;
        if (protectedTiles.has(y * MAP_WIDTH + x)) break;
        const t = d.tiles[y][x];
        if (t === TILE.FLOOR) {
          if (path.length > 0 && reach.has(y * MAP_WIDTH + x)) return { ox, oy, corridor: path };
          break;
        }
        if (t !== TILE.WALL) break;
        path.push({ x, y });
        x += dir.dx;
        y += dir.dy;
      }
    }
  }
  return null;
}

function stamp(d: DungeonData, v: VaultDef, p: Placement, protectedTiles: Set<number>): void {
  for (let y = 0; y < v.height; y++) {
    for (let x = 0; x < v.width; x++) {
      d.tiles[p.oy + y][p.ox + x] = tileKindOf(v.rows[y][x]) === 'floor' ? TILE.FLOOR : TILE.WALL;
    }
  }
  for (const c of p.corridor) d.tiles[c.y][c.x] = TILE.FLOOR;
  for (let y = p.oy - 1; y <= p.oy + v.height; y++) {
    for (let x = p.ox - 1; x <= p.ox + v.width; x++) protectedTiles.add(y * MAP_WIDTH + x);
  }
  for (const c of p.corridor) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) protectedTiles.add((c.y + dy) * MAP_WIDTH + c.x + dx);
  }
  const specs = v.mechanisms.map((s) => translateSpec(s, p.ox, p.oy));
  d.mechanisms = [...(d.mechanisms ?? []), ...specs];
  d.inscriptions = [...(d.inscriptions ?? []), ...inscriptionsOf(specs)];
  d.vaultIds = [...(d.vaultIds ?? []), v.id];
  for (const c of v.chests) d.chests.push({ tx: c.tx + p.ox, ty: c.ty + p.oy, tier: v.lootTier, isMimic: false });
  if (v.spawns.length > 0) {
    d.spawnMarkers = [
      ...(d.spawnMarkers ?? []),
      ...v.spawns.map((s) => ({ tx: s.tx + p.ox, ty: s.ty + p.oy, monster: s.monster })),
    ];
  }
}

/**
 * Picks one to three floor-appropriate vaults, digs each into solid rock beside the existing layout, joins its
 * entrance to a room or corridor with a straight passage, and appends mechanisms, inscriptions and vault ids to the
 * dungeon. Only WALL tiles are ever overwritten, so the start, stairs and every existing room are untouched.
 * Returns the ids of the vaults placed.
 */
export function stampVaults(d: DungeonData, floor: number, rng: Rng): string[] {
  const already = new Set(d.vaultIds ?? []);
  const pool = vaultsForFloor(floor).filter((v) => !already.has(v.id));
  if (pool.length === 0) return [];
  const most = 1 + Math.min(2, Math.floor(floor / 4));
  const want = 1 + Math.floor(rng.next() * most);
  const protectedTiles = new Set<number>();
  const placed: string[] = [];
  for (const v of shuffle(pool, rng)) {
    if (placed.length >= want) break;
    const p = findPlacement(d, v, protectedTiles, rng);
    if (!p) continue;
    stamp(d, v, p, protectedTiles);
    placed.push(v.id);
  }
  return placed;
}

/** The fixed final level as a normal DungeonData. */
export function buildTombFloor(): DungeonData {
  const tiles: TileValue[][] = TOMB.rows.map((row) =>
    Array.from(row, (ch) => (tileKindOf(ch) === 'floor' ? TILE.FLOOR : TILE.WALL)),
  );
  tiles[TOMB.stairsUpPos.ty][TOMB.stairsUpPos.tx] = TILE.STAIRS_UP;
  tiles[TOMB.stairsPos.ty][TOMB.stairsPos.tx] = TILE.STAIRS;

  const rooms: Room[] = TOMB.setPieces.map((sp, i) => {
    const x = sp.cell[0] * CELL + 1;
    const y = sp.cell[1] * CELL + 1;
    return {
      x, y, w: CELL - 2, h: CELL - 2, cx: x + 7, cy: y + 7,
      type: i === TOMB.setPieces.length - 1 ? 'quest_special' : 'trap_corridor',
      tag: sp.id,
    } as Room;
  });

  return {
    tiles,
    rooms,
    playerStart: { ...TOMB.playerStart },
    stairsPos: { ...TOMB.stairsPos },
    stairsUpPos: { ...TOMB.stairsUpPos },
    enemies: TOMB.guards.map((g) => ({ tx: g.tx, ty: g.ty, type: g.type })),
    items: [],
    secretDoors: [],
    traps: [],
    chests: TOMB.chests.map((c) => ({ tx: c.tx, ty: c.ty, tier: c.tier, isMimic: c.isMimic })),
    floorObjective: {
      type: 'SLAY_CHAMPION',
      title: 'Slay the Hollow King',
      detail: 'Seat the three pieces of the key, open his door, and put him back to rest.',
      roomIdx: rooms.length - 1,
      targetCount: 1,
      rewardGold: 500,
      rewardXP: 800,
    },
    mechanisms: TOMB.mechanisms.map((s) => translateSpec(s, 0, 0)),
    inscriptions: inscriptionsOf(TOMB.mechanisms),
    vaultIds: [TOMB.id],
    spawnMarkers: [{ tx: TOMB.bossSpawn.tx, ty: TOMB.bossSpawn.ty, monster: 'HOLLOW_KING' }],
  };
}
