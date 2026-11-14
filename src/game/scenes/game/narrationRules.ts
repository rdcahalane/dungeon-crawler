/**
 * Pure rules for the narrator: which rooms get read aloud, what kind a room is, and the queue that keeps two quick
 * triggers from talking over each other. No Phaser import, so it is unit-tested.
 */
import type { RoomKind } from "../../world/roomText";

/** How a narration is dressed: ordinary rooms plain, the rest with a gold border and a heading line. */
export type NarrationKind = "room" | "floor" | "area" | "tomb" | "boss";

/** Smaller number plays first. */
const PRIORITY: Record<NarrationKind, number> = { boss: 0, floor: 1, tomb: 1, area: 2, room: 3 };

/** Deterministic 32-bit mix so a room reads, or stays quiet, the same every visit. */
export function mix(seed: number): number {
  return Math.abs(Math.imul(seed | 0, 2246822519) ^ Math.imul((seed | 0) + 374761393, 3266489917)) >>> 0;
}

/**
 * Narrate this ordinary room? The first one narrated on a floor, any room with a non-normal kind, and otherwise
 * about one in three (decided by the seed).
 */
export function shouldNarrateRoom(kind: RoomKind, seed: number, firstOfFloor: boolean): boolean {
  if (firstOfFloor) return true;
  if (kind !== "normal") return true;
  return mix(seed) % 3 === 0;
}

/** The slice of a generated room the kind depends on. */
export interface RoomLike {
  x: number; y: number; w: number; h: number;
  type?: string;
  modifier?: string;
}

const MODIFIER_KINDS: ReadonlySet<string> = new Set(["healing_font", "cursed_crypt", "gilded_cache"]);
const TYPE_KINDS: ReadonlySet<string> = new Set(["trap_corridor", "monster_closet", "vault", "quest_special", "normal"]);

const inRoom = (r: RoomLike, p: { tx: number; ty: number }): boolean =>
  p.tx >= r.x && p.tx < r.x + r.w && p.ty >= r.y && p.ty < r.y + r.h;

/** Kind of an ordinary room: a listed modifier, else the stairs it holds, else its type, else normal. */
export function roomKind(
  room: RoomLike,
  stairsDown?: { tx: number; ty: number },
  stairsUp?: { tx: number; ty: number },
): RoomKind {
  if (room.modifier && MODIFIER_KINDS.has(room.modifier)) return room.modifier as RoomKind;
  if (stairsDown && inRoom(room, stairsDown)) return "stairs_down";
  if (stairsUp && inRoom(room, stairsUp)) return "stairs_up";
  if (room.type && TYPE_KINDS.has(room.type)) return room.type as RoomKind;
  return "normal";
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface NarrationItem {
  /** Dedupe key for the floor visit, e.g. "floor", "area:sw_gas", "room:3", "boss". */
  key: string;
  kind: NarrationKind;
  title?: string;
  text: string;
  /** For `room` items: the room index, so the item can go stale. */
  roomIdx?: number;
  queuedAt: number;
}

export interface QueueState {
  /** Index of the room the player is in now (null in a corridor). */
  roomIdx: number | null;
  /** A monster is within about six tiles. */
  monsterNear: boolean;
  now: number;
}

/** How long a vault's text waits for a monster to go away before it is shown anyway. */
export const AREA_WAIT_MS = 8000;
const MAX_PENDING = 5;

/**
 * Never narrates the same key twice per floor visit (`seen` covers items already shown or dropped for good, and
 * anything pushed). Plays boss, floor and tomb text before vaults before ordinary rooms, one at a time.
 * Ordinary-room text goes stale (dropped) when the player has left the room.
 * Vault text waits for the monster to go, up to `AREA_WAIT_MS`. Floor, tomb and boss text always show.
 */
export class NarrationQueue {
  private seen = new Set<string>();
  private items: NarrationItem[] = [];

  /** Queue an item. Returns false when its key was already narrated or queued this visit. */
  push(item: NarrationItem): boolean {
    if (this.seen.has(item.key)) return false;
    this.seen.add(item.key);
    this.items.push(item);
    // Keep the queue short: drop the oldest ordinary rooms first.
    while (this.items.length > MAX_PENDING) {
      const i = this.items.findIndex((it) => it.kind === "room");
      this.items.splice(i < 0 ? 0 : i, 1);
    }
    return true;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  pending(): number {
    return this.items.length;
  }

  /** Take the next item to show now, dropping stale ones; null if nothing is ready. */
  take(state: QueueState): NarrationItem | null {
    // Ordinary-room text is dropped only once the player has left the room. It used to be dropped whenever a monster
    // was within six tiles too, which in play meant almost never (a cursed crypt raises its champion as you walk in).
    this.items = this.items.filter((it) => !(it.kind === "room" && it.roomIdx !== state.roomIdx));
    const order = this.items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => PRIORITY[a.it.kind] - PRIORITY[b.it.kind] || a.it.queuedAt - b.it.queuedAt || a.i - b.i);
    for (const { it } of order) {
      if (it.kind === "area" && state.monsterNear && state.now - it.queuedAt < AREA_WAIT_MS) continue;
      this.items.splice(this.items.indexOf(it), 1);
      return it;
    }
    return null;
  }

  clear(): void {
    this.items = [];
    this.seen.clear();
  }
}

/** How long the box stays up when no voice is reading it: about 4 seconds plus 60ms per character. */
export function silentHoldMs(text: string): number {
  return 4000 + 60 * text.length;
}

/** The longest the box waits for a voice that never reports it has finished. */
export function voiceCapMs(text: string): number {
  return 6000 + 130 * text.length;
}
