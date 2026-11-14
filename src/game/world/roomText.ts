/**
 * Read-aloud room text, in the manner of the boxed text old printed adventures gave the referee to read out.
 * Pure data and selection, no Phaser import. The narrator (`scenes/game/NarratorController.ts`) shows it in a
 * parchment box and speaks it with the browser's built-in speech voice.
 *
 * Contract shared by three lanes (2026-11-14):
 * - The writing lane fills `FLOOR_INTROS`, `VAULT_TEXT`, `TOMB_TEXT`, `ROOM_POOLS` and `BOSS_TEXT` in this file.
 * - The riddle lane adds its new vaults' text in `roomTextRiddles.ts` (`RIDDLE_VAULT_TEXT`), merged below.
 * - The narrator lane only calls the functions at the bottom of this file and never edits the data.
 *
 * Writing rules: second person, present tense, what the character sees, hears and smells on walking in. One to
 * three short sentences (about 25 to 60 words), never a full paragraph. Every set piece's text carries at least one
 * honest hint at its trap or puzzle (a stain, a draft, a sound, a worn path, something out of place) without giving
 * the solution. Original prose only: nothing from any published module, novel or game.
 */
import { RIDDLE_VAULT_TEXT } from "./roomTextRiddles";

export interface RoomText {
  /** Short heading shown on the box, e.g. "The Weighing Hall". Optional for ordinary rooms. */
  title?: string;
  /** The read-aloud text. */
  read: string;
}

/** What kind of ordinary (non-vault) room the player walked into. */
export type RoomKind =
  | "normal" | "trap_corridor" | "monster_closet" | "vault" | "quest_special"
  | "healing_font" | "cursed_crypt" | "gilded_cache" | "stairs_down" | "stairs_up";

/** Floor themes from `getFloorThemeIdx`: 0 upper halls (1-3), 1 flooded or earthen (4-6), 2 old crypts (7-9), 3 deep (10-12). */
export type ThemeIdx = 0 | 1 | 2 | 3;

/** Spoken when the character first arrives on a floor (1 to 13). */
export const FLOOR_INTROS: Record<number, RoomText> = {};

/** Keyed by vault id from `vaults.ts`. Spoken on first entering the vault's area. */
export const VAULT_TEXT: Record<string, RoomText> = {};

/** Keyed by tomb chamber id (`chamber_1` to `chamber_12`, see `tomb.ts`). */
export const TOMB_TEXT: Record<string, RoomText> = {};

/** Spoken when the Hollow King first notices the player. */
export const BOSS_TEXT: RoomText | undefined = undefined;

/** Pools of ordinary room text: for each theme and kind, several variants. */
export const ROOM_POOLS: Partial<Record<ThemeIdx, Partial<Record<RoomKind, RoomText[]>>>> = {};

// ── Lookup (used by the narrator) ────────────────────────────────────────────────

export function floorIntro(floor: number): RoomText | undefined {
  return FLOOR_INTROS[floor];
}

/** Text for a vault or tomb chamber area id, if any was written. */
export function textForArea(areaId: string): RoomText | undefined {
  return VAULT_TEXT[areaId] ?? RIDDLE_VAULT_TEXT[areaId] ?? TOMB_TEXT[areaId];
}

/**
 * Text for an ordinary room. Deterministic for a given seed (use the floor number and room index), so a room reads
 * the same each visit. Returns undefined when the pool is empty.
 */
export function textForRoom(theme: ThemeIdx, kind: RoomKind, seed: number): RoomText | undefined {
  const pool = ROOM_POOLS[theme]?.[kind] ?? ROOM_POOLS[theme]?.normal;
  if (!pool || pool.length === 0) return undefined;
  const i = Math.abs(Math.imul(seed | 0, 2654435761) | 0) % pool.length;
  return pool[i];
}

export function bossText(): RoomText | undefined {
  return BOSS_TEXT;
}
