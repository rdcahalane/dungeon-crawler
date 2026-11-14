/**
 * The Hall of the Fallen, and the bones a dead character leaves behind.
 *
 * Kept on this device in `localStorage` (one key, versioned). Pure TS with an injectable storage so it is
 * testable and safe when storage is missing, full or holds junk: every read tolerates bad data and every
 * write reports failure instead of throwing.
 *
 * Shape on disk: `{ v: 1, fallen: FallenRecord[] (newest first, at most 20), bones: Bones | null }`.
 * One set of bones at a time: a new death replaces the old pile.
 */

export const GRAVEYARD_KEY = "dc-graveyard";
export const GRAVEYARD_VERSION = 1;
export const GRAVEYARD_MAX = 20;

export interface FallenRecord {
  name: string;
  /** Class key ("fighter") */
  classKey: string;
  /** Level title ("Footpad") */
  title: string;
  level: number;
  /** Dungeon level the character died on. */
  floor: number;
  /** What killed them, as a noun phrase: "a giant spider", "poison", "a fall". Empty when unknown. */
  cause: string;
  /** Gold carried at the moment of death. */
  gold: number;
  kills: number;
  /** ISO date string. */
  date: string;
}

export interface Bones {
  floor: number;
  tx: number;
  ty: number;
  gold: number;
  name: string;
  date: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface GraveyardDeps {
  /** Pass `null` to simulate no storage at all. Omit to use `globalThis.localStorage`. */
  storage?: StorageLike | null;
  now?: () => number;
}

interface Stored {
  v: number;
  fallen: FallenRecord[];
  bones: Bones | null;
}

const num = (x: unknown, fallback = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
const str = (x: unknown, fallback = ""): string => (typeof x === "string" ? x : fallback);

function cleanFallen(x: unknown): FallenRecord | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const name = str(r.name).trim();
  if (!name) return null;
  return {
    name: name.slice(0, 40),
    classKey: str(r.classKey, "fighter"),
    title: str(r.title),
    level: Math.max(1, Math.floor(num(r.level, 1))),
    floor: Math.max(0, Math.floor(num(r.floor, 1))),
    cause: str(r.cause).slice(0, 80),
    gold: Math.max(0, Math.floor(num(r.gold))),
    kills: Math.max(0, Math.floor(num(r.kills))),
    date: str(r.date),
  };
}

function cleanBones(x: unknown): Bones | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.floor !== "number" || typeof r.tx !== "number" || typeof r.ty !== "number") return null;
  if (![r.floor, r.tx, r.ty].every((n) => Number.isFinite(n as number))) return null;
  return {
    floor: Math.floor(r.floor),
    tx: Math.floor(r.tx),
    ty: Math.floor(r.ty),
    gold: Math.max(0, Math.floor(num(r.gold))),
    name: str(r.name, "A nameless delver").slice(0, 40),
    date: str(r.date),
  };
}

function resolveStorage(deps: GraveyardDeps): StorageLike | null {
  if (deps.storage !== undefined) return deps.storage;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null; // touching localStorage can throw when site data is blocked
  }
}

export function createGraveyard(deps: GraveyardDeps = {}) {
  const nowIso = () => new Date((deps.now ?? Date.now)()).toISOString();

  function read(): Stored {
    const empty: Stored = { v: GRAVEYARD_VERSION, fallen: [], bones: null };
    const storage = resolveStorage(deps);
    if (!storage) return empty;
    try {
      const raw = storage.getItem(GRAVEYARD_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<Stored> | null;
      if (!parsed || typeof parsed !== "object" || parsed.v !== GRAVEYARD_VERSION) return empty;
      const fallen = Array.isArray(parsed.fallen)
        ? parsed.fallen.map(cleanFallen).filter((r): r is FallenRecord => r !== null).slice(0, GRAVEYARD_MAX)
        : [];
      return { v: GRAVEYARD_VERSION, fallen, bones: cleanBones(parsed.bones) };
    } catch {
      return empty;
    }
  }

  function write(s: Stored): boolean {
    const storage = resolveStorage(deps);
    if (!storage) return false;
    try {
      storage.setItem(GRAVEYARD_KEY, JSON.stringify(s));
      return true;
    } catch {
      return false; // quota, blocked, or unserializable
    }
  }

  return {
    /** The fallen, newest first. */
    list(): FallenRecord[] {
      return read().fallen;
    },

    /** Add a death. Keeps the newest 20. Returns the stored record (date filled in when absent). */
    add(rec: Omit<FallenRecord, "date"> & { date?: string }): FallenRecord | null {
      const clean = cleanFallen({ ...rec, date: rec.date ?? nowIso() });
      if (!clean) return null;
      const s = read();
      s.fallen = [clean, ...s.fallen].slice(0, GRAVEYARD_MAX);
      write(s);
      return clean;
    },

    /** The bones waiting on this dungeon level, if any. */
    bonesOn(floor: number): Bones | null {
      const b = read().bones;
      return b && b.floor === floor ? b : null;
    },

    /** Leave bones. Replaces any earlier pile (one set at a time). */
    leaveBones(b: Omit<Bones, "date"> & { date?: string }): Bones | null {
      const clean = cleanBones({ ...b, date: b.date ?? nowIso() });
      if (!clean) return null;
      const s = read();
      s.bones = clean;
      write(s);
      return clean;
    },

    /** Take the bones on this level: removes the record and returns it. Null when there are none here. */
    takeBones(floor: number): Bones | null {
      const s = read();
      if (!s.bones || s.bones.floor !== floor) return null;
      const taken = s.bones;
      s.bones = null;
      write(s);
      return taken;
    },

    /** Wipe everything (tests, a future "clear the hall" button). */
    clear(): void {
      write({ v: GRAVEYARD_VERSION, fallen: [], bones: null });
    },
  };
}

/** The shared instance, backed by the browser's localStorage. */
export const graveyard = createGraveyard();

// -- words -------------------------------------------------------------------

/** Things that kill you that take no article. */
const MASS_CAUSES = /^(poison|poison gas|gas|fire|flame|flames|acid|starvation|thirst|drowning|cold|lightning|bad luck|his own curiosity|her own curiosity|their own curiosity)$/i;

/**
 * "giant spider" -> "a giant spider"; "owl" -> "an owl"; "poison" and "a fall" are left alone.
 * Empty in, empty out.
 */
export function causePhrase(raw: string | undefined | null): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (!t) return "";
  if (MASS_CAUSES.test(t)) return t.toLowerCase();
  if (/^(a|an|the|his|her|its|their|some|my|your)\s/i.test(t)) return t;
  const lower = t.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
}

const TRAP_CAUSES: Record<string, string> = {
  dart: "a dart trap",
  poison_needle: "a poisoned needle",
  pit: "a pit trap",
  fire_glyph: "a fire glyph",
  alarm: "a trap",
};

/** Cause text for a trap type from the legacy floor traps ("PIT" -> "a pit trap"). Unknown types read as "a trap". */
export function trapCause(type: string): string {
  const t = type.trim().toLowerCase();
  if (t.startsWith("mech_")) return "a tomb mechanism";
  return TRAP_CAUSES[t] ?? "a trap";
}

/**
 * The line on the death screen:
 * "TESTER THE FOOTPAD, SLAIN BY A GIANT SPIDER ON LEVEL 2 WITH 114 GOLD PIECES".
 * Upper case because the bitmap font is.
 */
export function epitaphFor(rec: Pick<FallenRecord, "name" | "title" | "floor" | "cause" | "gold">): string {
  const who = rec.title ? `${rec.name} the ${rec.title}` : rec.name;
  const cause = causePhrase(rec.cause);
  const how = cause ? `slain by ${cause}` : "dead of causes unknown";
  const gold = Math.max(0, Math.floor(rec.gold));
  const purse = gold === 0 ? "with nothing to show for it" : `with ${gold} gold ${gold === 1 ? "piece" : "pieces"}`;
  return `${who}, ${how} on level ${rec.floor} ${purse}`.toUpperCase();
}
