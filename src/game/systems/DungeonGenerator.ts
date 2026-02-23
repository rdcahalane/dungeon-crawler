import {
  TILE, TileValue, MAP_WIDTH, MAP_HEIGHT,
  ENEMY_TYPES, EnemyTypeKey,
  FLOOR_ENEMY_POOLS, FLOOR_10_PLUS_POOL,
  TRAP_TYPES, TrapTypeKey, TrapSpawn, ChestSpawn, ChestTier,
} from "../constants";

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  type?: 'normal' | 'vault' | 'trap_corridor' | 'monster_closet';
}

export interface ItemSpawn {
  tx: number;
  ty: number;
  type: string;
}

export interface EnemySpawn {
  tx: number;
  ty: number;
  type: EnemyTypeKey;
}

export interface SecretDoor {
  tx: number;
  ty: number;
}

export interface DungeonData {
  tiles: TileValue[][];
  rooms: Room[];
  playerStart: { tx: number; ty: number };
  stairsPos: { tx: number; ty: number };
  enemies: EnemySpawn[];
  items: ItemSpawn[];
  secretDoors: SecretDoor[];
  traps: TrapSpawn[];
  chests: ChestSpawn[];
}

function rng(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function overlaps(a: Room, b: Room, padding = 2): boolean {
  return (
    a.x - padding < b.x + b.w + padding &&
    a.x + a.w + padding > b.x - padding &&
    a.y - padding < b.y + b.h + padding &&
    a.y + a.h + padding > b.y - padding
  );
}

function carveH(tiles: TileValue[][], y: number, x1: number, x2: number, width = 1) {
  const [xa, xb] = x1 < x2 ? [x1, x2] : [x2, x1];
  const half = Math.floor(width / 2);
  for (let dy = -half; dy < width - half; dy++) {
    const row = y + dy;
    if (row < 1 || row >= MAP_HEIGHT - 1) continue;
    for (let x = xa; x <= xb; x++) tiles[row][x] = TILE.FLOOR;
  }
}

function carveV(tiles: TileValue[][], x: number, y1: number, y2: number, width = 1) {
  const [ya, yb] = y1 < y2 ? [y1, y2] : [y2, y1];
  const half = Math.floor(width / 2);
  for (let dx = -half; dx < width - half; dx++) {
    const col = x + dx;
    if (col < 1 || col >= MAP_WIDTH - 1) continue;
    for (let y = ya; y <= yb; y++) tiles[y][col] = TILE.FLOOR;
  }
}

function dist(a: Room, b: Room): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

function getEnemyPool(floor: number): EnemyTypeKey[] {
  if (floor >= 10) return FLOOR_10_PLUS_POOL;
  const idx = Math.min(floor, FLOOR_ENEMY_POOLS.length - 1);
  return FLOOR_ENEMY_POOLS[idx] ?? FLOOR_ENEMY_POOLS[1];
}

function pickChestTier(floor: number): ChestTier {
  if (floor >= 7 && Math.random() < 0.25) return 'golden';
  if (floor >= 4 && Math.random() < 0.4) return 'iron';
  return 'wooden';
}

function pickTrapType(floor: number): TrapTypeKey {
  const keys = Object.keys(TRAP_TYPES) as TrapTypeKey[];
  if (floor < 3) {
    // Early floors: only dart and alarm
    return (Math.random() < 0.6) ? 'DART' : 'ALARM';
  }
  if (floor < 6) {
    // Mid: dart, poison, pit, alarm
    const pool: TrapTypeKey[] = ['DART', 'POISON_NEEDLE', 'PIT', 'ALARM'];
    return pool[rng(0, pool.length - 1)];
  }
  return keys[rng(0, keys.length - 1)];
}

export function generateDungeon(floor: number): DungeonData {
  const w = MAP_WIDTH;
  const h = MAP_HEIGHT;

  // Init all walls
  const tiles: TileValue[][] = Array.from({ length: h }, () => Array(w).fill(TILE.WALL));

  // Generate rooms
  const numRooms = Math.min(8 + floor, 18);
  const rooms: Room[] = [];
  let attempts = 0;

  while (rooms.length < numRooms && attempts < 200) {
    attempts++;
    const rw = rng(5, 12);
    const rh = rng(4, 9);
    const rx = rng(1, w - rw - 2);
    const ry = rng(1, h - rh - 2);
    const room: Room = {
      x: rx, y: ry, w: rw, h: rh,
      cx: rx + Math.floor(rw / 2),
      cy: ry + Math.floor(rh / 2),
      type: 'normal',
    };

    if (!rooms.some((r) => overlaps(r, room, 3))) {
      rooms.push(room);
      for (let dy = 0; dy < rh; dy++)
        for (let dx = 0; dx < rw; dx++)
          tiles[ry + dy][rx + dx] = TILE.FLOOR;
    }
  }

  // Connect rooms
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let bestDist = Infinity;
    let from = -1;
    let to = -1;

    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue;
        const d = dist(rooms[i], rooms[j]);
        if (d < bestDist) { bestDist = d; from = i; to = j; }
      }
    }

    if (from === -1) break;
    connected.add(to);

    const a = rooms[from];
    const b = rooms[to];
    const cw = rng(2, 4);
    if (Math.random() < 0.5) {
      carveH(tiles, a.cy, a.cx, b.cx, cw);
      carveV(tiles, b.cx, a.cy, b.cy, cw);
    } else {
      carveV(tiles, a.cx, a.cy, b.cy, cw);
      carveH(tiles, b.cy, a.cx, b.cx, cw);
    }
  }

  // ── Secret doors ──────────────────────────────────────────────────────────
  const secretDoors: SecretDoor[] = [];

  if (floor >= 2) {
    // Find pairs of near-adjacent rooms and add a secret door between them
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const dx = Math.abs(a.cx - b.cx);
        const dy = Math.abs(a.cy - b.cy);

        // Near-adjacent: close but not connected by existing corridor
        if (dx < 15 && dy < 15 && dx + dy > 5) {
          if (Math.random() < 0.25) {
            // Find a wall tile between them
            const midX = Math.floor((a.cx + b.cx) / 2);
            const midY = Math.floor((a.cy + b.cy) / 2);
            if (tiles[midY][midX] === TILE.WALL) {
              tiles[midY][midX] = TILE.SECRET_DOOR;
              secretDoors.push({ tx: midX, ty: midY });
              if (secretDoors.length >= 2) break;
            }
          }
        }
      }
      if (secretDoors.length >= 2) break;
    }
  }

  // ── Player & Stairs ───────────────────────────────────────────────────────
  const startRoom = rooms[0];
  const playerStart = { tx: startRoom.cx, ty: startRoom.cy };

  const lastRoom = rooms[rooms.length - 1];
  const stairsPos = { tx: lastRoom.cx, ty: lastRoom.cy };
  tiles[stairsPos.ty][stairsPos.tx] = TILE.STAIRS;

  // ── Special rooms (floor 3+) ──────────────────────────────────────────────
  const chests: ChestSpawn[] = [];

  if (floor >= 3 && rooms.length > 4) {
    // Designate one mid-game room as a vault (hidden behind secret door)
    const vaultIdx = rng(2, rooms.length - 2);
    rooms[vaultIdx].type = 'vault';
    // Place 2-3 chests in the vault
    const vaultRoom = rooms[vaultIdx];
    const vaultChestCount = rng(2, 3);
    for (let c = 0; c < vaultChestCount; c++) {
      const cx = rng(vaultRoom.x + 1, vaultRoom.x + vaultRoom.w - 2);
      const cy = rng(vaultRoom.y + 1, vaultRoom.y + vaultRoom.h - 2);
      const isMimic = floor >= 5 && Math.random() < 0.2;
      chests.push({
        tx: cx, ty: cy,
        tier: pickChestTier(floor + 1), // vault chests are better tier
        isMimic,
        trapped: (!isMimic && floor >= 3 && Math.random() < 0.3) ? pickTrapType(floor) : undefined,
      });
    }
  }

  // ── Traps ─────────────────────────────────────────────────────────────────
  const traps: TrapSpawn[] = [];
  const maxTraps = Math.min(2 + (floor - 1), 12);

  for (let t = 0; t < maxTraps; t++) {
    // Place in a random non-start, non-last room corridor or room
    const roomIdx = rng(1, rooms.length - 2);
    const room = rooms[roomIdx];
    const tx = rng(room.x + 1, room.x + room.w - 2);
    const ty = rng(room.y + 1, room.y + room.h - 2);

    // Don't stack traps
    if (tiles[ty][tx] === TILE.FLOOR && !traps.some(tr => tr.tx === tx && tr.ty === ty)) {
      tiles[ty][tx] = TILE.TRAP;
      traps.push({ tx, ty, type: pickTrapType(floor), triggered: false });
    }
  }

  // ── Enemies ───────────────────────────────────────────────────────────────
  const enemies: EnemySpawn[] = [];
  const pool = getEnemyPool(floor);

  for (let i = 1; i < rooms.length - 1; i++) {
    const room = rooms[i];
    const count = rng(1, 2 + Math.floor(floor / 3));
    for (let e = 0; e < count; e++) {
      const ex = rng(room.x + 1, room.x + room.w - 2);
      const ey = rng(room.y + 1, room.y + room.h - 2);
      const type = pool[rng(0, pool.length - 1)];
      // Only place MIMIC in chests, not as random enemies
      const finalType: EnemyTypeKey = type === 'MIMIC' ? pool[rng(0, pool.length - 2)] : type;
      if (ENEMY_TYPES[finalType]) {
        enemies.push({ tx: ex, ty: ey, type: finalType });
      }
    }
  }

  // ── Items & chests ────────────────────────────────────────────────────────
  const items: ItemSpawn[] = [];
  const itemTypes = ['HEALTH_POTION', 'WEAPON', 'ARMOR', 'XP_ORB'];

  for (let i = 1; i < rooms.length; i++) {
    if (rooms[i].type === 'vault') continue; // vault room uses chests
    if (Math.random() < 0.5) {
      const room = rooms[i];
      const ix = rng(room.x + 1, room.x + room.w - 2);
      const iy = rng(room.y + 1, room.y + room.h - 2);
      items.push({ tx: ix, ty: iy, type: itemTypes[rng(0, itemTypes.length - 1)] });
    }

    // Regular chest spawning
    if (Math.random() < 0.35) {
      const room = rooms[i];
      const cx = rng(room.x + 1, room.x + room.w - 2);
      const cy = rng(room.y + 1, room.y + room.h - 2);
      const isMimic = floor >= 6 && Math.random() < 0.15;
      chests.push({
        tx: cx, ty: cy,
        tier: pickChestTier(floor),
        isMimic,
        trapped: (!isMimic && floor >= 2 && Math.random() < 0.25) ? pickTrapType(floor) : undefined,
      });
    }
  }

  return { tiles, rooms, playerStart, stairsPos, enemies, items, secretDoors, traps, chests };
}
