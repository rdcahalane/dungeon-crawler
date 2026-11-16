/**
 * Save storage that works signed out.
 *
 * Every call tries the server API first (`/api/save`, `/api/saves`, `/api/load`). If the API answers 401,
 * answers "offline" (no auth secret configured), answers anything not ok, or `fetch` throws, the call falls
 * back to `localStorage` under the key prefix `dc-save-` (one key per slot). Safe when `localStorage` is
 * missing or throws (private mode, quota, SSR): the call just reports failure.
 *
 * Pure TS, no Phaser. `createSaveStore(deps)` takes injectable `fetch` and storage for tests; the exported
 * `saveGame`, `loadGame`, `listSaves` use the browser globals.
 */
import { isNativeApp } from "../native";
import { CHARACTER_CLASSES } from "../constants";
import type { PlayerStats } from "../entities/Player";

export const LOCAL_SAVE_PREFIX = "dc-save-";
export const SAVE_SLOTS = 5;

export interface SaveMeta {
  slot: number;
  name: string;
  level: number;
  floor: number;
  updatedAt: string;
}

export interface LoadedSave {
  slot: number;
  data: PlayerStats;
  source: "api" | "local";
}

export interface SaveListing {
  /** Fixed 5-slot array, null for an empty slot (same shape as `/api/saves`). */
  saves: (SaveMeta | null)[];
  /** True when the list came from the server account. */
  loggedIn: boolean;
  source: "api" | "local";
  /** True when the server reported 401 specifically. */
  unauthorized: boolean;
  /** True when the server could not be reached or errored (not just signed out). */
  offline: boolean;
}

export interface SaveResult {
  ok: boolean;
  where: "api" | "local" | "none";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface SaveStoreDeps {
  fetch?: FetchLike | null;
  /** Pass `null` to simulate no storage at all. Omit to use `globalThis.localStorage`. */
  storage?: StorageLike | null;
  now?: () => number;
}

interface LocalRecord {
  slot: number;
  name: string;
  level: number;
  floor: number;
  playtime: number;
  updatedAt: string;
  data: PlayerStats;
}

export function saveName(stats: PlayerStats): string {
  const cls = CHARACTER_CLASSES[stats.classKey];
  return stats.name || `${cls.name} Lv ${stats.level}`;
}

function resolveStorage(deps: SaveStoreDeps): StorageLike | null {
  if (deps.storage !== undefined) return deps.storage;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null; // accessing localStorage can throw (blocked site data)
  }
}

function resolveFetch(deps: SaveStoreDeps): FetchLike | null {
  if (deps.fetch !== undefined) return deps.fetch;
  if (isNativeApp()) return null; // the app-store build has no server: device saves only
  const f = (globalThis as { fetch?: unknown }).fetch;
  return typeof f === "function" ? (f as FetchLike).bind(globalThis) as FetchLike : null;
}

export function createSaveStore(deps: SaveStoreDeps = {}) {
  const keyFor = (slot: number) => `${LOCAL_SAVE_PREFIX}${slot}`;
  const nowIso = () => new Date((deps.now ?? Date.now)()).toISOString();

  function readLocal(slot: number): LocalRecord | null {
    const storage = resolveStorage(deps);
    if (!storage) return null;
    try {
      const raw = storage.getItem(keyFor(slot));
      if (!raw) return null;
      const rec = JSON.parse(raw) as LocalRecord;
      if (!rec || typeof rec !== "object" || !rec.data) return null;
      return rec;
    } catch {
      return null;
    }
  }

  function writeLocal(slot: number, stats: PlayerStats, playtime: number): boolean {
    const storage = resolveStorage(deps);
    if (!storage) return false;
    try {
      const rec: LocalRecord = {
        slot,
        name: saveName(stats),
        level: stats.level,
        floor: stats.floor,
        playtime,
        updatedAt: nowIso(),
        data: stats,
      };
      storage.setItem(keyFor(slot), JSON.stringify(rec));
      return true;
    } catch {
      return false; // quota exceeded, blocked, or unserializable
    }
  }

  function listLocal(): (SaveMeta | null)[] {
    const out: (SaveMeta | null)[] = Array(SAVE_SLOTS).fill(null);
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const rec = readLocal(slot);
      if (rec) out[slot - 1] = { slot, name: rec.name, level: rec.level, floor: rec.floor, updatedAt: rec.updatedAt };
    }
    return out;
  }

  /** Saves to the server if possible, else to this device. */
  async function saveGame(slot: number, stats: PlayerStats, playtime = 0): Promise<SaveResult> {
    const f = resolveFetch(deps);
    if (f) {
      try {
        const res = await f("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slot,
            name: saveName(stats),
            data: stats,
            level: stats.level,
            floor: stats.floor,
            playtime,
          }),
        });
        let body: { ok?: boolean; offline?: boolean } | null = null;
        try { body = (await res.json()) as { ok?: boolean; offline?: boolean }; } catch { /* no body */ }
        // The route answers 202 {ok:false, offline:true} when no auth secret is configured.
        if (res.ok && res.status !== 202 && body?.ok !== false && !body?.offline) return { ok: true, where: "api" };
      } catch {
        // fall through to local
      }
    }
    return writeLocal(slot, stats, playtime) ? { ok: true, where: "local" } : { ok: false, where: "none" };
  }

  /** Loads one slot. Server first; this device when the server cannot answer. Null when the slot is empty. */
  async function loadGame(slot: number): Promise<LoadedSave | null> {
    const f = resolveFetch(deps);
    if (f) {
      try {
        const res = await f(`/api/load?slot=${slot}`);
        if (res.ok) {
          const body = (await res.json()) as { save?: { data?: unknown } | null; offline?: boolean };
          if (!body.offline) {
            if (body.save?.data) return { slot, data: body.save.data as PlayerStats, source: "api" };
            return null; // signed in and the slot is empty
          }
        }
      } catch {
        // fall through to local
      }
    }
    const rec = readLocal(slot);
    return rec ? { slot, data: rec.data, source: "local" } : null;
  }

  /** Slot metadata for the menus. */
  async function listSaves(): Promise<SaveListing> {
    const f = resolveFetch(deps);
    let unauthorized = false;
    let offline = false;
    if (f) {
      try {
        const res = await f("/api/saves");
        if (res.status === 401) {
          unauthorized = true;
        } else if (res.ok) {
          const body = (await res.json()) as { saves?: (SaveMeta | null)[]; offline?: boolean };
          if (!body.offline) {
            return {
              saves: body.saves && body.saves.length > 0 ? body.saves : Array(SAVE_SLOTS).fill(null),
              loggedIn: true, source: "api", unauthorized: false, offline: false,
            };
          }
          offline = true;
        } else {
          offline = true;
        }
      } catch {
        offline = true;
      }
    } else {
      offline = true;
    }
    return { saves: listLocal(), loggedIn: false, source: "local", unauthorized, offline };
  }

  return { saveGame, loadGame, listSaves };
}

const defaultStore = createSaveStore();

export const saveGame = (slot: number, stats: PlayerStats, playtime = 0) => defaultStore.saveGame(slot, stats, playtime);
export const loadGame = (slot: number) => defaultStore.loadGame(slot);
export const listSaves = () => defaultStore.listSaves();
