/**
 * Large monsters: body size, edge-to-edge reach, standoff distance and where they may be placed. Pure TypeScript,
 * no Phaser, so the numbers are testable.
 *
 * Small monsters (under 48 pixels) keep the exact legacy behaviour: the helpers return the old centre-distance
 * numbers for them. Large ones are measured edge to edge, because a 64 pixel body's centre is far from where you
 * can actually hit it.
 */
import { LARGE_MONSTER_SIZE, MONSTERS, largeMonstersForFloor, type LargeMonsterKey } from './bestiary';
import { MELEE_HOLD_PX } from './encounter';
import { mulberry32, type Rng } from './dice';

const TILE = 32;
/** Half the player sprite (one 32 pixel tile). */
export const PLAYER_HALF_PX = 16;
/** A big monster's longer arms: extra pixels of strike reach beyond its listed edge reach. */
export const LONG_ARMS_PX = 6;
/** Share of the sprite a large monster's physics body covers, so it does not snag on corridor corners. */
export const LARGE_BODY_FRACTION = 0.7;

export function isLargeSize(size: number): boolean {
  return size >= LARGE_MONSTER_SIZE;
}

/**
 * Physics body edge length in world pixels. Below 48 this is the legacy `size - 12` (never under 14) before the
 * sprite's own scale factor; Enemy keeps applying that factor for the small ones.
 */
export function bodySizePx(size: number): number {
  return isLargeSize(size) ? Math.round(size * LARGE_BODY_FRACTION) : Math.max(14, size - 12);
}

/** Straight-line gap between the edges of two square bodies whose centres are `dist` apart (negative: overlapping). */
export function edgeGapPx(dist: number, sizeA: number, sizeB: number): number {
  return dist - sizeA / 2 - sizeB / 2;
}

/** Centre-to-centre standoff a melee monster keeps from the player: its edge just clears the player sprite. */
export function holdDistancePx(size: number): number {
  return isLargeSize(size) ? PLAYER_HALF_PX + size / 2 : MELEE_HOLD_PX;
}

export interface MeleeDistances {
  /** Keep walking toward the player while farther than this (centre to centre). */
  approach: number;
  /** May swing when no farther than this (centre to centre). */
  strike: number;
  /** Eases back out when closer than this. */
  hold: number;
}

/**
 * Centre-to-centre distances for a melee monster. For large monsters `attackRange` is the edge-to-edge reach.
 * For small ones these are the old formulas: approach `attackRange + 8`, strike `max(attackRange + 16, 32)`.
 */
export function meleeDistances(size: number, attackRange: number): MeleeDistances {
  const hold = holdDistancePx(size);
  if (!isLargeSize(size)) {
    return { approach: attackRange + 8, strike: Math.max(attackRange + TILE / 2, MELEE_HOLD_PX + 10), hold };
  }
  const strike = hold + attackRange + LONG_ARMS_PX;
  return { approach: Math.max(hold + 2, strike - 8), strike, hold };
}

/** Can a monster swing at a player `dist` away (centre to centre)? */
export function monsterReachesPlayer(dist: number, size: number, attackRange: number): boolean {
  return dist <= meleeDistances(size, attackRange).strike;
}

/**
 * The player's fallback reach (when nothing is in the swing box): `reach` pixels from the player's centre, extended
 * by however much a large monster's body sticks out past a one-tile body. Under 48 pixels it is the plain
 * centre-distance test it always was.
 */
export function playerReachesMonster(dist: number, size: number, reach: number): boolean {
  return dist - (isLargeSize(size) ? (size - TILE) / 2 : 0) <= reach;
}

// ── Where a large monster may stand ─────────────────────────────────────────

export interface PlanRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  type?: string;
}

export interface Tile {
  tx: number;
  ty: number;
}

export interface LargeSpawnInput {
  floor: number;
  /** Rooms in generator order; the first holds the stairs up and the last the stairs down, so they are skipped. */
  rooms: readonly PlanRoom[];
  /** Plain open floor the monster may stand on (not wall, trap, stairs, door or mechanism). */
  isOpenFloor: (tx: number, ty: number) => boolean;
  /** Tiles that already hold something (enemies, items, chests, traps, inscriptions). */
  occupied: readonly Tile[];
  /** Points to keep well away from (the player's start). */
  keepAwayFrom: readonly Tile[];
}

export interface LargeSpawn {
  key: LargeMonsterKey;
  /** Top-left tile of the clear 2x2 block it stands on. */
  tx: number;
  ty: number;
  /** World position of its centre: the middle of that block. */
  x: number;
  y: number;
  roomIdx: number;
}

/** Spawn chance per floor: none 40%, one 50%, two 10%. */
export function largeCountRoll(rng: Rng): number {
  const r = rng.next();
  return r < 0.4 ? 0 : r < 0.9 ? 1 : 2;
}

/** Weighted pick by `rarity` (default 1). */
export function pickLargeByRarity(keys: readonly LargeMonsterKey[], rng: Rng): LargeMonsterKey | null {
  if (keys.length === 0) return null;
  const weights = keys.map((k) => MONSTERS[k].rarity ?? 1);
  let r = rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r < 0) return keys[i];
  }
  return keys[keys.length - 1];
}

/** True when a 2x2 block of open floor starts at (tx, ty) and none of it is occupied. */
export function hasClearBlock(
  tx: number, ty: number, isOpenFloor: (tx: number, ty: number) => boolean, occupied: ReadonlySet<string>,
): boolean {
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (!isOpenFloor(tx + dx, ty + dy) || occupied.has(`${tx + dx},${ty + dy}`)) return false;
    }
  }
  return true;
}

const KEEP_AWAY_TILES = 7;

/**
 * Choose up to two large monsters for a floor and a clear 2x2 block for each. A monster whose room has no such
 * block is skipped, never squeezed in. Pure: pass a seeded Rng for a repeatable result.
 */
export function planLargeSpawns(input: LargeSpawnInput, rng: Rng): LargeSpawn[] {
  const keys = largeMonstersForFloor(input.floor);
  if (keys.length === 0 || input.rooms.length < 3) return [];
  const want = largeCountRoll(rng);
  if (want === 0) return [];

  const occupied = new Set(input.occupied.map((t) => `${t.tx},${t.ty}`));
  const rooms = input.rooms
    .map((room, roomIdx) => ({ room, roomIdx }))
    .filter(({ room, roomIdx }) =>
      roomIdx > 0 && roomIdx < input.rooms.length - 1 && (room.type === undefined || room.type === 'normal'));

  const out: LargeSpawn[] = [];
  const usedRooms = new Set<number>();
  for (let n = 0; n < want; n++) {
    const key = pickLargeByRarity(keys, rng);
    if (!key) break;
    // Shuffle the candidate rooms (rooms already holding a giant come last), take the first with a clear block.
    const order = rooms
      .map((r) => ({ r, k: rng.next() + (usedRooms.has(r.roomIdx) ? 10 : 0) }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.r);
    let placed = false;
    for (const { room, roomIdx } of order) {
      const anchors: Tile[] = [];
      for (let ty = room.y + 1; ty <= room.y + room.h - 3; ty++) {
        for (let tx = room.x + 1; tx <= room.x + room.w - 3; tx++) {
          if (!hasClearBlock(tx, ty, input.isOpenFloor, occupied)) continue;
          const far = input.keepAwayFrom.every(
            (p) => Math.max(Math.abs(p.tx - tx), Math.abs(p.ty - ty)) >= KEEP_AWAY_TILES,
          );
          if (far) anchors.push({ tx, ty });
        }
      }
      if (anchors.length === 0) continue;
      const a = anchors[Math.floor(rng.next() * anchors.length)];
      out.push({ key, tx: a.tx, ty: a.ty, x: (a.tx + 1) * TILE, y: (a.ty + 1) * TILE, roomIdx });
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) occupied.add(`${a.tx + dx},${a.ty + dy}`);
      usedRooms.add(roomIdx);
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return out;
}

/** A stable seed from a floor number and its layout, so a revisited floor plans the same giants. */
export function layoutSeed(floor: number, rooms: readonly PlanRoom[]): number {
  let h = 2166136261 ^ (floor * 2654435761);
  for (const r of rooms) {
    h = Math.imul(h ^ (r.x * 73 + r.y * 151 + r.w * 31 + r.h * 17), 16777619);
  }
  return h >>> 0;
}

export function planLargeSpawnsForLayout(input: LargeSpawnInput): LargeSpawn[] {
  return planLargeSpawns(input, mulberry32(layoutSeed(input.floor, input.rooms)));
}
