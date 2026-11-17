/**
 * Floor layout styles, so a floor is not always rectangles joined by straight halls.
 * Pure TypeScript (no Phaser); the only randomness is the `rand` handed in.
 *
 * - halls:   the original dressed-stone rooms and straight corridors.
 * - caverns: natural caves. Each room becomes a lumpy blob, rooms are joined by winding
 *            tunnels, and a few stalagmites stand in the open.
 * - ruins:   a fallen keep. Rectangular rooms whose walls have crumbled open in places,
 *            broken colonnades down the larger halls, and rubble on the floor.
 *
 * Rooms keep their bounding boxes (`Room.x/y/w/h`) and their centres are always floor, so
 * everything that reasons about rooms (objectives, events, the narrator, vault stamping)
 * keeps working. Anything placed inside a room should use `floorSpot`, since a cave blob
 * does not fill its box.
 */
import { MAP_HEIGHT, MAP_WIDTH, TILE, type TileValue } from "../constants";

export type FloorLayout = "halls" | "caverns" | "ruins";

export const LAYOUT_NAMES: Record<FloorLayout, string> = {
  halls: "Dressed halls",
  caverns: "Natural caverns",
  ruins: "Fallen ruins",
};

/** The slice of a room this module needs. */
export interface RoomBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

type Rand = () => number;
type Grid = TileValue[][];

const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < MAP_WIDTH - 1 && y < MAP_HEIGHT - 1;

/**
 * Pick a style for a generated floor. Floor 1 is always the halls (the first room has to read
 * clearly). The upper floors (the wet and dry caves) lean to caverns, the stone floors lean to
 * halls and ruins, and every style can turn up anywhere after that.
 */
export function pickLayout(floor: number, rand: Rand): FloorLayout {
  if (floor <= 1) return "halls";
  const weights: [FloorLayout, number][] =
    floor <= 3 ? [["caverns", 5], ["ruins", 2], ["halls", 3]]
    : floor <= 6 ? [["caverns", 4], ["ruins", 4], ["halls", 2]]
    : floor <= 9 ? [["caverns", 2], ["ruins", 4], ["halls", 4]]
    : [["caverns", 3], ["ruins", 3], ["halls", 4]];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [layout, w] of weights) {
    if ((r -= w) < 0) return layout;
  }
  return "halls";
}

function floorNeighbours(tiles: Grid, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && tiles[y + dy]?.[x + dx] !== undefined && tiles[y + dy][x + dx] !== TILE.WALL) n++;
    }
  }
  return n;
}

/**
 * A wall tile standing on its own in the open (a stalagmite, a column, a block of rubble).
 * Seven open neighbours, not six: a one-tile wall between two passages has six, and drawing
 * that as a row of stalagmites looked like a fence.
 */
export function isFreeStanding(tiles: Grid, x: number, y: number): boolean {
  return tiles[y]?.[x] === TILE.WALL && floorNeighbours(tiles, x, y) >= 7;
}

/**
 * Put a single blocking tile only where all eight neighbours are open floor: a lone block
 * surrounded by floor can never cut a path, so connectivity is untouched.
 */
function placeBlock(tiles: Grid, x: number, y: number, keep: Set<number>): boolean {
  if (!inside(x, y) || tiles[y][x] !== TILE.FLOOR || keep.has(y * MAP_WIDTH + x)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tiles[y + dy][x + dx] !== TILE.FLOOR) return false;
    }
  }
  tiles[y][x] = TILE.WALL;
  return true;
}

/** Room centres and their four neighbours, which content is placed on and nothing may fill. */
function centreKeep(rooms: readonly RoomBox[]): Set<number> {
  const keep = new Set<number>();
  for (const r of rooms) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) keep.add((r.cy + dy) * MAP_WIDTH + r.cx + dx);
  }
  return keep;
}

// ── caverns ────────────────────────────────────────────────────────────────

function carveBlob(tiles: Grid, r: RoomBox, rand: Rand) {
  const rx = r.w / 2 + 0.6;
  const ry = r.h / 2 + 0.6;
  const ox = r.x + (r.w - 1) / 2;
  const oy = r.y + (r.h - 1) / 2;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!inside(x, y)) continue;
      const d = ((x - ox) / rx) ** 2 + ((y - oy) / ry) ** 2;
      if (d + (rand() - 0.5) * 0.55 < 1) tiles[y][x] = TILE.FLOOR;
    }
  }
  tiles[r.cy][r.cx] = TILE.FLOOR;
}

/** A tunnel that wanders but always arrives: most steps go toward the target. */
function carveTunnel(tiles: Grid, a: RoomBox, b: RoomBox, rand: Rand, keep: Set<number>) {
  let x = a.cx;
  let y = a.cy;
  const wide = rand() < 0.45;
  const mark = (px: number, py: number) => {
    if (!inside(px, py)) return;
    tiles[py][px] = TILE.FLOOR;
    keep.add(py * MAP_WIDTH + px);
  };
  const cap = (Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)) * 4 + 200;
  for (let step = 0; step < cap && (x !== b.cx || y !== b.cy); step++) {
    mark(x, y);
    if (wide || rand() < 0.2) mark(x + (rand() < 0.5 ? 1 : 0), y + (rand() < 0.5 ? 1 : 0));
    const dx = Math.sign(b.cx - x);
    const dy = Math.sign(b.cy - y);
    if (rand() < 0.72) {
      // toward the target, on the axis with more distance left (or either when level)
      const horiz = dx !== 0 && (dy === 0 || (Math.abs(b.cx - x) > Math.abs(b.cy - y) ? rand() < 0.8 : rand() < 0.3));
      if (horiz) x += dx;
      else y += dy;
    } else {
      const dir = Math.floor(rand() * 4);
      const nx = x + [1, -1, 0, 0][dir];
      const ny = y + [0, 0, 1, -1][dir];
      if (inside(nx, ny)) {
        x = nx;
        y = ny;
      }
    }
  }
  // If the cap ran out, finish in a straight line so the rooms are always joined.
  while (x !== b.cx) { mark(x, y); x += Math.sign(b.cx - x); }
  while (y !== b.cy) { mark(x, y); y += Math.sign(b.cy - y); }
  mark(x, y);
}

/**
 * Turn an all-wall grid into caverns: blobs for rooms, wandering tunnels for each link,
 * one smoothing pass, then stalagmites. Unreachable pockets are filled back in.
 */
export function carveCaverns(tiles: Grid, rooms: readonly RoomBox[], links: readonly [number, number][], rand: Rand) {
  for (const r of rooms) carveBlob(tiles, r, rand);
  const keep = centreKeep(rooms);
  for (const [i, j] of links) carveTunnel(tiles, rooms[i], rooms[j], rand, keep);

  // Smooth: open up nooks walled in on most sides, close one-tile spurs (never on a tunnel).
  for (let pass = 0; pass < 2; pass++) {
    const next = tiles.map((row) => row.slice());
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
      for (let x = 1; x < MAP_WIDTH - 1; x++) {
        const n = floorNeighbours(tiles, x, y);
        if (tiles[y][x] === TILE.WALL && n >= 6) next[y][x] = TILE.FLOOR;
        else if (tiles[y][x] === TILE.FLOOR && n <= 1 && !keep.has(y * MAP_WIDTH + x)) next[y][x] = TILE.WALL;
      }
    }
    for (let y = 0; y < MAP_HEIGHT; y++) tiles[y] = next[y];
  }

  // Stalagmites in the open parts of the caves.
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (rand() < 0.035) placeBlock(tiles, x, y, keep);
      }
    }
  }

  fillUnreachable(tiles, rooms[0]);
}

// ── ruins ──────────────────────────────────────────────────────────────────

/**
 * Weather an already-carved halls floor into ruins: knock gaps in room walls, stand broken
 * colonnades in the larger halls and scatter rubble. Every block added obeys `placeBlock`,
 * and gaps only ever open floor, so the floor stays connected.
 */
export function ruinate(tiles: Grid, rooms: readonly RoomBox[], rand: Rand) {
  const keep = centreKeep(rooms);
  for (const r of rooms) {
    // Crumbled walls: gaps in the ring around the room, sometimes spilling a tile further out.
    if (rand() < 0.7) {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          const ring = y === r.y - 1 || y === r.y + r.h || x === r.x - 1 || x === r.x + r.w;
          if (!ring || !inside(x, y) || tiles[y][x] !== TILE.WALL) continue;
          if (rand() < 0.16) {
            tiles[y][x] = TILE.FLOOR;
            const ox = x < r.x ? -1 : x >= r.x + r.w ? 1 : 0;
            const oy = y < r.y ? -1 : y >= r.y + r.h ? 1 : 0;
            if (rand() < 0.35 && inside(x + ox, y + oy)) tiles[y + oy][x + ox] = TILE.FLOOR;
          }
        }
      }
    }
    // A colonnade down the long sides of a big hall, some columns long fallen.
    if (r.w >= 8 && r.h >= 6 && rand() < 0.6) {
      for (let x = r.x + 2; x <= r.x + r.w - 3; x += 3) {
        for (const y of [r.y + 1, r.y + r.h - 2]) {
          if (rand() < 0.75) placeBlock(tiles, x, y, keep);
        }
      }
    }
    // Rubble.
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (rand() < 0.03) placeBlock(tiles, x, y, keep);
      }
    }
  }
}

// ── shared ─────────────────────────────────────────────────────────────────

/** Fill every floor tile the start room cannot reach, so nothing is placed in a sealed pocket. */
export function fillUnreachable(tiles: Grid, start: RoomBox) {
  const seen = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  const stack = [start.cy * MAP_WIDTH + start.cx];
  while (stack.length) {
    const k = stack.pop() as number;
    const x = k % MAP_WIDTH;
    const y = (k - x) / MAP_WIDTH;
    if (seen[k] || tiles[y]?.[x] === undefined || tiles[y][x] === TILE.WALL) continue;
    seen[k] = 1;
    stack.push(k + 1, k - 1, k + MAP_WIDTH, k - MAP_WIDTH);
  }
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (!seen[y * MAP_WIDTH + x] && tiles[y][x] === TILE.FLOOR) tiles[y][x] = TILE.WALL;
    }
  }
}

/**
 * A random open floor tile in a room's interior (the same box the halls always used:
 * one tile in from each edge). Falls back to the nearest floor to the centre.
 */
export function floorSpot(tiles: Grid, r: RoomBox, rand: Rand): { tx: number; ty: number } {
  const open: { tx: number; ty: number }[] = [];
  for (let ty = r.y + 1; ty <= r.y + r.h - 2; ty++) {
    for (let tx = r.x + 1; tx <= r.x + r.w - 2; tx++) {
      if (tiles[ty]?.[tx] === TILE.FLOOR) open.push({ tx, ty });
    }
  }
  if (open.length > 0) return open[Math.floor(rand() * open.length)];
  return nearestFloor(tiles, r.cx, r.cy);
}

/** The floor tile closest to (tx, ty), searching outward ring by ring. */
export function nearestFloor(tiles: Grid, tx: number, ty: number): { tx: number; ty: number } {
  for (let rad = 0; rad < Math.max(MAP_WIDTH, MAP_HEIGHT); rad++) {
    for (let y = ty - rad; y <= ty + rad; y++) {
      for (let x = tx - rad; x <= tx + rad; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== rad) continue;
        if (tiles[y]?.[x] === TILE.FLOOR) return { tx: x, ty: y };
      }
    }
  }
  return { tx, ty };
}
