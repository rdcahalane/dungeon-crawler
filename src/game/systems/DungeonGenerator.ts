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
  type?: 'normal' | 'vault' | 'trap_corridor' | 'monster_closet' | 'quest_special';
  modifier?: 'blood_rune' | 'healing_font' | 'cursed_crypt' | 'gilded_cache';
  tag?: string;  // quest special room identifier (e.g. 'harem', 'library')
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
  roomIdx?: number;
  elite?: boolean;
}

export interface FloorObjective {
  type: 'CLEAR_DEN' | 'RAID_VAULT' | 'SLAY_CHAMPION' | 'CLAIM_KEY';
  title: string;
  detail: string;
  roomIdx?: number;
  targetCount: number;
  rewardGold: number;
  rewardXP: number;
}

export interface SecretDoor {
  tx: number;
  ty: number;
}

export interface DungeonData {
  tiles: TileValue[][];
  rooms: Room[];
  playerStart: { tx: number; ty: number };
  stairsPos: { tx: number; ty: number };     // stairs DOWN
  stairsUpPos: { tx: number; ty: number };   // stairs UP (back to surface / prev floor)
  enemies: EnemySpawn[];
  items: ItemSpawn[];
  secretDoors: SecretDoor[];
  traps: TrapSpawn[];
  chests: ChestSpawn[];
  questRooms?: { tag: string; roomIdx: number; cx: number; cy: number }[];
  floorObjective?: FloorObjective;
}

/**
 * Persistent state for a single dungeon floor.
 * dungeonData = the base (unmodified) layout generated at creation time.
 * The other arrays track changes made during play sessions.
 */
export interface SerializedFloor {
  dungeonData: DungeonData;          // original tiles — NEVER modified after creation
  deadEnemyIndices: number[];        // which enemy spawns have been killed
  triggeredTrapKeys: string[];       // "tx,ty" — traps already triggered
  openedChestKeys: string[];         // "tx,ty" — chests opened
  pickedItemKeys: string[];          // "tx,ty" — floor items picked up
  revealedDoorKeys: string[];        // "tx,ty" — secret doors permanently revealed
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

export function generateDungeon(floor: number, specialRoomTags?: string[]): DungeonData {
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

  // ── Player, Stairs Up & Stairs Down ──────────────────────────────────────
  const startRoom = rooms[0];
  // Stairs UP: placed at the top-left of room[0], player spawns at center
  const stairsUpPos = { tx: startRoom.x + 1, ty: startRoom.y + 1 };
  tiles[stairsUpPos.ty][stairsUpPos.tx] = TILE.STAIRS_UP;

  // Player spawns in the center of room[0], near the stairs up
  const playerStart = { tx: startRoom.cx, ty: startRoom.cy };

  // Stairs DOWN: last room center
  const lastRoom = rooms[rooms.length - 1];
  const stairsPos = { tx: lastRoom.cx, ty: lastRoom.cy };
  tiles[stairsPos.ty][stairsPos.tx] = TILE.STAIRS;

  // ── Special rooms (floor 3+) ──────────────────────────────────────────────
  const chests: ChestSpawn[] = [];
  let vaultRoomIdx = -1;

  if (floor >= 3 && rooms.length > 4) {
    // Designate one mid-game room as a vault (hidden behind secret door)
    const vaultIdx = rng(2, rooms.length - 2);
    vaultRoomIdx = vaultIdx;
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

  // Give each floor a couple of memorable set-pieces so it stops feeling like
  // one repeated rectangle after another.
  const setPieceCandidates = rooms
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i > 0 && i < rooms.length - 1 && r.type === 'normal');
  if (setPieceCandidates.length > 0) {
    const pick = setPieceCandidates.splice(rng(0, setPieceCandidates.length - 1), 1)[0];
    pick.r.type = 'monster_closet';
  }
  if (setPieceCandidates.length > 0) {
    const pick = setPieceCandidates.splice(rng(0, setPieceCandidates.length - 1), 1)[0];
    pick.r.type = 'trap_corridor';
  }

  // ── Enemies ───────────────────────────────────────────────────────────────
  const enemies: EnemySpawn[] = [];
  const pool = getEnemyPool(floor);

  for (let i = 1; i < rooms.length - 1; i++) {
    const room = rooms[i];
    const count = room.type === 'monster_closet'
      ? rng(3, 4 + Math.floor(floor / 3))
      : rng(1, 2 + Math.floor(floor / 3));
    for (let e = 0; e < count; e++) {
      const ex = rng(room.x + 1, room.x + room.w - 2);
      const ey = rng(room.y + 1, room.y + room.h - 2);
      const type = pool[rng(0, pool.length - 1)];
      // Only place MIMIC in chests, not as random enemies
      const finalType: EnemyTypeKey = type === 'MIMIC' ? pool[rng(0, pool.length - 2)] : type;
      if (ENEMY_TYPES[finalType]) {
        enemies.push({ tx: ex, ty: ey, type: finalType, roomIdx: i });
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

  // ── Quest special rooms ──────────────────────────────────────────────────
  const questRooms: DungeonData['questRooms'] = [];
  if (specialRoomTags && specialRoomTags.length > 0 && rooms.length > 4) {
    // Candidate rooms: mid-dungeon, not first/last, not vault
    const candidates = rooms
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => i > 1 && i < rooms.length - 1 && r.type !== 'vault');

    for (const tag of specialRoomTags) {
      if (candidates.length === 0) break;
      const pick = candidates.splice(rng(0, candidates.length - 1), 1)[0];
      const room = pick.r;
      room.type = 'quest_special';
      room.tag = tag;
      questRooms.push({ tag, roomIdx: pick.i, cx: room.cx, cy: room.cy });

      // Themed content per tag
      if (tag === 'harem') {
        // Decorative NPC items + golden chest
        chests.push({
          tx: rng(room.x + 1, room.x + room.w - 2),
          ty: rng(room.y + 1, room.y + room.h - 2),
          tier: 'golden', isMimic: false,
          trapped: undefined,
        });
      } else if (tag === 'library') {
        // Scroll + stat tome chests
        for (let c = 0; c < 2; c++) {
          chests.push({
            tx: rng(room.x + 1, room.x + room.w - 2),
            ty: rng(room.y + 1, room.y + room.h - 2),
            tier: 'iron', isMimic: false,
            trapped: undefined,
          });
        }
      } else if (tag === 'arena') {
        // Pack with 5-8 tough enemies
        const arenaPool: EnemyTypeKey[] = floor >= 6
          ? ['TROLL', 'DARK_ELF', 'GHOST']
          : ['SKELETON', 'ZOMBIE', 'GIANT_SPIDER'];
        const arenaCount = rng(5, 8);
        for (let e = 0; e < arenaCount; e++) {
          enemies.push({
            tx: rng(room.x + 1, room.x + room.w - 2),
            ty: rng(room.y + 1, room.y + room.h - 2),
            type: arenaPool[rng(0, arenaPool.length - 1)],
            roomIdx: pick.i,
          });
        }
      } else if (tag === 'shrine') {
        // Healing item spawn
        items.push({
          tx: rng(room.x + 1, room.x + room.w - 2),
          ty: rng(room.y + 1, room.y + room.h - 2),
          type: 'HEALTH_POTION',
        });
      } else if (tag === 'dragon_den') {
        // Single powerful enemy + treasure hoard
        enemies.push({
          tx: room.cx, ty: room.cy,
          type: 'TROLL', // toughest standard enemy
          roomIdx: pick.i,
        });
        for (let c = 0; c < 3; c++) {
          chests.push({
            tx: rng(room.x + 1, room.x + room.w - 2),
            ty: rng(room.y + 1, room.y + room.h - 2),
            tier: 'golden', isMimic: false,
            trapped: floor >= 5 ? pickTrapType(floor) : undefined,
          });
        }
      }
    }
  }

  // ── Room modifiers ─────────────────────────────────────────────────────────
  // These are small set pieces that make otherwise-normal rooms feel tactical.
  const modifierDeck: NonNullable<Room['modifier']>[] = ['blood_rune', 'healing_font', 'cursed_crypt', 'gilded_cache'];
  const modifierCandidates = rooms
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i > 0 && i < rooms.length - 1 && (r.type ?? 'normal') === 'normal' && !r.modifier);
  const modifierCount = Math.min(modifierCandidates.length, floor >= 4 ? 3 : 2);
  for (let m = 0; m < modifierCount; m++) {
    const pick = modifierCandidates.splice(rng(0, modifierCandidates.length - 1), 1)[0];
    const mod = modifierDeck.splice(rng(0, modifierDeck.length - 1), 1)[0];
    pick.r.modifier = mod;
  }

  // First contact should be a hook, not a hallway tax: room 1 always offers a
  // visible choice/reward beat with a special mood and at least one build item.
  const firstHookRoom = rooms[1];
  if (firstHookRoom) {
    if (!firstHookRoom.modifier && (firstHookRoom.type ?? 'normal') === 'normal') {
      firstHookRoom.modifier = Math.random() < 0.55 ? 'blood_rune' : 'gilded_cache';
    }
    const ix = firstHookRoom.cx;
    const iy = Math.min(firstHookRoom.y + firstHookRoom.h - 2, firstHookRoom.cy + 1);
    if (!items.some(item => item.tx === ix && item.ty === iy)) {
      items.push({ tx: ix, ty: iy, type: Math.random() < 0.65 ? 'WEAPON' : 'ARMOR' });
    }
    const cx = Math.max(firstHookRoom.x + 1, firstHookRoom.cx - 1);
    const cy = Math.max(firstHookRoom.y + 1, firstHookRoom.cy - 1);
    if (!chests.some(chest => chest.tx === cx && chest.ty === cy)) {
      chests.push({ tx: cx, ty: cy, tier: 'wooden', isMimic: false, trapped: undefined });
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

  for (const room of rooms) {
    if (room.type !== 'trap_corridor') continue;
    const trapCount = rng(2, 4);
    for (let t = 0; t < trapCount; t++) {
      const tx = rng(room.x + 1, room.x + room.w - 2);
      const ty = rng(room.y + 1, room.y + room.h - 2);

      if (tiles[ty][tx] === TILE.FLOOR && !traps.some(tr => tr.tx === tx && tr.ty === ty)) {
        tiles[ty][tx] = TILE.TRAP;
        traps.push({ tx, ty, type: pickTrapType(floor), triggered: false });
      }
    }
  }

  const bossFloor = floor > 1 && floor % 3 === 0;
  if (bossFloor && rooms.length > 2) {
    const bossRoomIdx = rooms.length - 1;
    const bossRoom = rooms[bossRoomIdx];
    bossRoom.type = 'quest_special';
    bossRoom.modifier = bossRoom.modifier ?? 'cursed_crypt';
    const bossType: EnemyTypeKey = floor >= 6 ? 'TROLL' : floor >= 3 ? 'TANK' : 'BASIC';
    enemies.push({ tx: bossRoom.cx, ty: bossRoom.cy, type: bossType, roomIdx: bossRoomIdx, elite: true });
    chests.push({
      tx: Math.max(bossRoom.x + 1, bossRoom.cx - 1),
      ty: Math.min(bossRoom.y + bossRoom.h - 2, bossRoom.cy + 1),
      tier: floor >= 6 ? 'golden' : 'iron',
      isMimic: false,
      trapped: undefined,
    });
  }

  const shrineCandidates = rooms
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i > 1 && i < rooms.length - 1 && r.type !== 'vault');
  if (shrineCandidates.length > 0 && (floor === 1 || Math.random() < 0.55)) {
    const pick = shrineCandidates[rng(0, shrineCandidates.length - 1)];
    pick.r.modifier = pick.r.modifier ?? 'healing_font';
    items.push({ tx: pick.r.cx, ty: pick.r.cy, type: 'CURSED_SHRINE' });
  }

  const denIdx = rooms.findIndex(r => r.type === 'monster_closet');
  const denEnemyCount = denIdx >= 0 ? enemies.filter(e => e.roomIdx === denIdx).length : 0;
  const championCandidates = enemies
    .map((enemy, idx) => ({ enemy, idx }))
    .filter(({ enemy }) => enemy.type !== 'MIMIC');
  const preferredChampion = championCandidates.find(({ enemy }) => enemy.roomIdx === denIdx)
    ?? championCandidates[rng(0, Math.max(0, championCandidates.length - 1))];
  if (preferredChampion) preferredChampion.enemy.elite = true;

  const floorObjective: FloorObjective | undefined = bossFloor
    ? {
        type: 'CLAIM_KEY',
        title: 'Claim the Boss Key',
        detail: 'Defeat the floor guardian to unseal the stairs.',
        roomIdx: rooms.length - 1,
        targetCount: 1,
        rewardGold: 45 + floor * 15,
        rewardXP: 45 + floor * 16,
      }
    : denIdx >= 0 && denEnemyCount > 0
      ? {
        type: 'CLEAR_DEN',
        title: 'Clear the Den',
        detail: 'Wipe out the marked monster den before descending.',
        roomIdx: denIdx,
        targetCount: denEnemyCount,
        rewardGold: 18 + floor * 8,
        rewardXP: 25 + floor * 12,
      }
    : vaultRoomIdx >= 0
      ? {
          type: 'RAID_VAULT',
          title: 'Raid the Vault',
          detail: 'Crack open the vault hoard on this floor.',
          roomIdx: vaultRoomIdx,
          targetCount: Math.max(1, chests.filter(c => {
            const room = rooms[vaultRoomIdx];
            return c.tx >= room.x && c.tx < room.x + room.w && c.ty >= room.y && c.ty < room.y + room.h;
          }).length),
          rewardGold: 30 + floor * 12,
          rewardXP: 20 + floor * 10,
        }
      : preferredChampion
        ? {
            type: 'SLAY_CHAMPION',
            title: 'Slay the Champion',
            detail: 'Hunt the glowing champion before taking the stairs.',
            roomIdx: preferredChampion.enemy.roomIdx,
            targetCount: 1,
            rewardGold: 25 + floor * 10,
            rewardXP: 30 + floor * 12,
          }
        : undefined;

  return { tiles, rooms, playerStart, stairsPos, stairsUpPos, enemies, items, secretDoors, traps, chests, questRooms, floorObjective };
}
