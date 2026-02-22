import { TILE, TileValue, MAP_WIDTH, MAP_HEIGHT, ENEMY_TYPES, EnemyTypeKey } from "../constants";

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
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

export interface DungeonData {
  tiles: TileValue[][];
  rooms: Room[];
  playerStart: { tx: number; ty: number };
  stairsPos: { tx: number; ty: number };
  enemies: EnemySpawn[];
  items: ItemSpawn[];
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

// width is the number of tiles perpendicular to travel direction.
// The corridor is centred on the spine (y or x), so odd widths are symmetric
// and even widths lean one tile towards the positive axis.

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

export function generateDungeon(floor: number): DungeonData {
  const w = MAP_WIDTH;
  const h = MAP_HEIGHT;

  // Init all walls
  const tiles: TileValue[][] = Array.from({ length: h }, () =>
    Array(w).fill(TILE.WALL)
  );

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
    const room: Room = { x: rx, y: ry, w: rw, h: rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2) };

    if (!rooms.some((r) => overlaps(r, room, 3))) {
      rooms.push(room);
      // Carve floor
      for (let dy = 0; dy < rh; dy++)
        for (let dx = 0; dx < rw; dx++)
          tiles[ry + dy][rx + dx] = TILE.FLOOR;
    }
  }

  // Connect rooms: each room connects to its nearest unconnected neighbour
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
    // Variable-width L-shaped corridor: 2–4 tiles wide
    const cw = rng(2, 4);
    if (Math.random() < 0.5) {
      carveH(tiles, a.cy, a.cx, b.cx, cw);
      carveV(tiles, b.cx, a.cy, b.cy, cw);
    } else {
      carveV(tiles, a.cx, a.cy, b.cy, cw);
      carveH(tiles, b.cy, a.cx, b.cx, cw);
    }
  }

  // Player starts in room 0
  const startRoom = rooms[0];
  const playerStart = { tx: startRoom.cx, ty: startRoom.cy };

  // Stairs in last room
  const lastRoom = rooms[rooms.length - 1];
  const stairsPos = { tx: lastRoom.cx, ty: lastRoom.cy };
  tiles[stairsPos.ty][stairsPos.tx] = TILE.STAIRS;

  // Enemies — scale with floor
  const enemies: EnemySpawn[] = [];
  const typeKeys = Object.keys(ENEMY_TYPES) as EnemyTypeKey[];

  for (let i = 1; i < rooms.length - 1; i++) {
    const room = rooms[i];
    const count = rng(1, 2 + Math.floor(floor / 3));
    for (let e = 0; e < count; e++) {
      const ex = rng(room.x + 1, room.x + room.w - 2);
      const ey = rng(room.y + 1, room.y + room.h - 2);
      // Higher floors unlock more enemy types
      const availableTypes = typeKeys.slice(0, Math.min(typeKeys.length, 1 + Math.floor(floor / 3)));
      const type = availableTypes[rng(0, availableTypes.length - 1)];
      enemies.push({ tx: ex, ty: ey, type });
    }
  }

  // Items — scatter across rooms
  const items: ItemSpawn[] = [];
  const itemTypes = ["HEALTH_POTION", "WEAPON", "ARMOR", "XP_ORB"];

  for (let i = 1; i < rooms.length; i++) {
    if (Math.random() < 0.6) {
      const room = rooms[i];
      const ix = rng(room.x + 1, room.x + room.w - 2);
      const iy = rng(room.y + 1, room.y + room.h - 2);
      items.push({ tx: ix, ty: iy, type: itemTypes[rng(0, itemTypes.length - 1)] });
    }
  }

  return { tiles, rooms, playerStart, stairsPos, enemies, items };
}
