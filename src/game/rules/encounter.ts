/**
 * Encounter rules, first-edition style: morale, monster reaction, surprise and wandering monsters.
 *
 * Pure TypeScript (no Phaser). The game is real-time, so these are the dice rolled underneath: the scene
 * code (`CombatController`, `Enemy`, `WanderController`) decides when to ask and what to draw.
 * Everything takes an `Rng`, so a seeded run is reproducible and the tests are exact.
 */
import { roll, type Rng } from './dice';
import type { MonsterDef, MonsterKey } from './bestiary';

// ── Numbers ─────────────────────────────────────────────────────────────────

/** Fleeing monsters run for this long, picked per flight (milliseconds). */
export const FLEE_MIN_MS = 4000;
export const FLEE_MAX_MS = 6000;
/** A monster that rallies but is still shaky keeps its distance for this long. */
export const KEEP_DISTANCE_MS = 6000;
/** After this many retreats a monster stops checking and fights on (so nothing runs around forever). */
export const MAX_RETREATS = 2;
/** Allies this close (pixels, about six tiles) and in sight check morale when a comrade dies. */
export const ALLY_DEATH_RADIUS_PX = 6 * 32;

/** Wary monsters turn hostile after this long with you in sight, or when you come this close. */
export const WARY_PATIENCE_MS = 8000;
export const WARY_PROXIMITY_PX = 2 * 32;
/** Afraid monsters back away from you inside this distance, and run when you close to `AFRAID_RUN_PX`. */
export const AFRAID_BACKOFF_PX = 4 * 32;
export const AFRAID_RUN_PX = 2 * 32;

/** Surprise: 2 in 6 on first contact, the monster stands flat for this long and takes +2 to be hit. */
export const SURPRISE_IN_6 = 2;
export const SURPRISE_MS = 1200;
export const SURPRISE_TO_HIT_BONUS = 2;

/** Melee monsters hold this centre-to-centre distance (pixels) so they stand beside the player, not inside it. */
export const MELEE_HOLD_PX = 22;

/** A game turn is one minute of dungeon time. */
export const GAME_TURN_MS = 60_000;
export const WANDER_BASE_IN_6 = 1;
export const WANDER_NOISY_IN_6 = 2;
/** No wandering monster before this much time on the floor. */
export const WANDER_MIN_FLOOR_AGE_MS = 20_000;
export const WANDER_CAP_PER_FLOOR = 4;
export const WANDER_MIN_TILES = 12;
export const WANDER_MAX_TILES = 18;

// ── Who checks, who talks ───────────────────────────────────────────────────

/**
 * Monsters with no fear to lose besides the undead, oozes and the boss (those are caught by their stat
 * block). Mimics are here too: a chest does not run.
 */
export const FEARLESS_KEYS: ReadonlySet<MonsterKey> = new Set<MonsterKey>([
  'SKELETON', 'ZOMBIE', 'GHOUL', 'WIGHT', 'WRAITH', 'GHOST', 'BONE_KNIGHT', 'HOLLOW_KING', 'OOZE', 'MIMIC',
  'OSSUARY_HULK',
]);

/**
 * Creatures that can weigh an intruder and answer with more than teeth: the goblin, kobold, orc, dark elf and
 * cultist, plus ogres and barrow giants (slow, but they can be bargained with). Animals, vermin, trolls, gargoyles and the undead are always hostile.
 */
export const INTELLIGENT_KEYS: ReadonlySet<MonsterKey> = new Set<MonsterKey>([
  'BASIC', 'FAST', 'TANK', 'DARK_ELF', 'CULTIST', 'OGRE', 'BARROW_GIANT',
]);

/** True when this monster never makes a morale check (undead, oozes, mimics, the boss, summoned things, morale 12). */
export function neverChecksMorale(def: MonsterDef, opts: { summoned?: boolean } = {}): boolean {
  if (opts.summoned) return true;
  if (def.undead || def.boss) return true;
  if (FEARLESS_KEYS.has(def.key)) return true;
  return def.morale >= 12;
}

export function isIntelligent(def: MonsterDef): boolean {
  return !def.undead && !def.boss && INTELLIGENT_KEYS.has(def.key);
}

// ── Morale ──────────────────────────────────────────────────────────────────

export interface MoraleResult {
  roll: number;
  /** Morale score the roll was held against, after the modifier. */
  target: number;
  passed: boolean;
}

/**
 * Roll 2d6 against a morale score (2 to 12 scale). A roll above the score fails and the monster flees.
 * A positive `modifier` steadies the monster, a negative one rattles it.
 */
export function moraleCheck(morale: number, rng: Rng, modifier = 0): MoraleResult {
  const target = morale + modifier;
  const r = roll(rng, 2, 6);
  return { roll: r, target, passed: r <= target };
}

/** Milliseconds a fleeing monster runs, between `FLEE_MIN_MS` and `FLEE_MAX_MS` inclusive. */
export function fleeDurationMs(rng: Rng): number {
  return FLEE_MIN_MS + Math.floor(rng.next() * (FLEE_MAX_MS - FLEE_MIN_MS + 1));
}

export type RetreatOutcome = 'return' | 'keep_distance';

/**
 * What a monster does when a flight (or a spell of keeping its distance) runs out: roll again. Passing means it
 * returns to the fight; failing means it hangs back. Each earlier retreat steadies it by one, and after
 * `MAX_RETREATS` it simply returns without rolling.
 */
export function retreatOutcome(
  morale: number,
  rng: Rng,
  retreats: number,
): { outcome: RetreatOutcome; roll: number | null } {
  if (retreats >= MAX_RETREATS) return { outcome: 'return', roll: null };
  const r = moraleCheck(morale, rng, retreats);
  return { outcome: r.passed ? 'return' : 'keep_distance', roll: r.roll };
}

// ── Reaction ────────────────────────────────────────────────────────────────

export type Reaction = 'hostile' | 'wary' | 'afraid';

/** 2d6 plus the Charisma adjustment: 2 to 5 hostile, 6 to 8 wary, 9 or more afraid. */
export function reactionBand(total: number): Reaction {
  if (total <= 5) return 'hostile';
  if (total <= 8) return 'wary';
  return 'afraid';
}

export interface ReactionResult {
  roll: number;
  total: number;
  reaction: Reaction;
}

/** Roll a reaction. `chaAdj` comes from `charismaReaction(cha)` in `abilities.ts`. */
export function reactionRoll(rng: Rng, chaAdj = 0): ReactionResult {
  const r = roll(rng, 2, 6);
  const total = r + chaAdj;
  return { roll: r, total, reaction: reactionBand(total) };
}

/** A monster's reaction the first time it notices the player: only the intelligent roll, everything else is hostile. */
export function monsterReaction(def: MonsterDef, rng: Rng, chaAdj = 0, opts: { summoned?: boolean } = {}): Reaction {
  if (opts.summoned || !isIntelligent(def)) return 'hostile';
  return reactionRoll(rng, chaAdj).reaction;
}

// ── Surprise ────────────────────────────────────────────────────────────────

/** First contact: 2 in 6 the monster is caught flat. */
export function surpriseRoll(rng: Rng): boolean {
  return roll(rng, 1, 6) <= SURPRISE_IN_6;
}

// ── Wandering monsters ──────────────────────────────────────────────────────

/** At each game turn: 1 in 6, or 2 in 6 if there was noise this turn. */
export function wanderCheck(rng: Rng, noisy: boolean): boolean {
  return roll(rng, 1, 6) <= (noisy ? WANDER_NOISY_IN_6 : WANDER_BASE_IN_6);
}

export interface WanderGate {
  /** Floor number; 0 or less is the tavern. */
  floor: number;
  /** The player stands in the first chamber of the tomb floor. */
  inTombFirstChamber: boolean;
  floorAgeMs: number;
  restDialogOpen: boolean;
  spawnedThisVisit: number;
}

/** Why no wanderer may arrive right now, or `null` if one may. */
export function wanderBlockedReason(g: WanderGate): string | null {
  if (g.floor <= 0) return 'tavern';
  if (g.inTombFirstChamber) return 'tomb first chamber';
  if (g.restDialogOpen) return 'rest dialog';
  if (g.floorAgeMs < WANDER_MIN_FLOOR_AGE_MS) return 'floor just loaded';
  if (g.spawnedThisVisit >= WANDER_CAP_PER_FLOOR) return 'cap reached';
  return null;
}

export interface Tile {
  tx: number;
  ty: number;
}

/**
 * Breadth-first walking distances (in steps, four directions) from a start tile, out to `maxSteps`.
 * Keys are `"tx,ty"`. Used to find tiles the player could really be reached from.
 */
export function walkDistances(
  isWalkable: (tx: number, ty: number) => boolean,
  start: Tile,
  maxSteps: number,
): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(`${start.tx},${start.ty}`, 0);
  let frontier: Tile[] = [start];
  for (let step = 1; step <= maxSteps && frontier.length > 0; step++) {
    const next: Tile[] = [];
    for (const t of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = t.tx + dx;
        const ny = t.ty + dy;
        const key = `${nx},${ny}`;
        if (dist.has(key) || !isWalkable(nx, ny)) continue;
        dist.set(key, step);
        next.push({ tx: nx, ty: ny });
      }
    }
    frontier = next;
  }
  return dist;
}

/** Straight-line sight over tiles (Bresenham). The end tiles themselves never block. */
export function lineOfSight(
  isOpaque: (tx: number, ty: number) => boolean,
  from: Tile,
  to: Tile,
): boolean {
  let x = from.tx;
  let y = from.ty;
  const dx = Math.abs(to.tx - x);
  const dy = Math.abs(to.ty - y);
  const sx = x < to.tx ? 1 : -1;
  const sy = y < to.ty ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 4096; guard++) {
    if (x === to.tx && y === to.ty) return true;
    if (!(x === from.tx && y === from.ty) && isOpaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return false;
}

/**
 * Pick where a wanderer appears: a tile 12 to 18 tiles from the player (straight-line), reachable on foot, and
 * out of the player's sight. Returns null when no tile qualifies.
 */
export function chooseWanderSpawn(
  rng: Rng,
  player: Tile,
  isWalkable: (tx: number, ty: number) => boolean,
  isOpaque: (tx: number, ty: number) => boolean,
): Tile | null {
  // 28 steps is enough to wind around a wall or two and still arrive soon.
  const reach = walkDistances(isWalkable, player, 28);
  const candidates: Tile[] = [];
  for (const key of reach.keys()) {
    const [tx, ty] = key.split(',').map(Number);
    const d = Math.hypot(tx - player.tx, ty - player.ty);
    if (d < WANDER_MIN_TILES || d > WANDER_MAX_TILES) continue;
    if (lineOfSight(isOpaque, player, { tx, ty })) continue;
    candidates.push({ tx, ty });
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng.next() * candidates.length)];
}

/**
 * A shortest walking route (four directions, breadth-first) from `start` to `goal`, both included, or null when
 * there is none within `maxNodes` visited tiles. Used by wandering monsters to find their way to the player.
 */
export function findPath(
  isWalkable: (tx: number, ty: number) => boolean,
  start: Tile,
  goal: Tile,
  maxNodes = 4000,
): Tile[] | null {
  const key = (t: Tile) => `${t.tx},${t.ty}`;
  const prev = new Map<string, string | null>();
  prev.set(key(start), null);
  let frontier: Tile[] = [start];
  let visited = 1;
  while (frontier.length > 0 && visited < maxNodes) {
    const next: Tile[] = [];
    for (const t of frontier) {
      if (t.tx === goal.tx && t.ty === goal.ty) {
        const out: Tile[] = [];
        let k: string | null = key(t);
        while (k) {
          const [tx, ty] = k.split(',').map(Number);
          out.push({ tx, ty });
          k = prev.get(k) ?? null;
        }
        return out.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { tx: t.tx + dx, ty: t.ty + dy };
        const nk = key(n);
        if (prev.has(nk)) continue;
        // The goal itself may stand on a tile the walkability test rejects (a mechanism): never refuse it.
        if (!isWalkable(n.tx, n.ty) && !(n.tx === goal.tx && n.ty === goal.ty)) continue;
        prev.set(nk, key(t));
        visited++;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
