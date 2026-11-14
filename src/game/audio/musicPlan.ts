/**
 * Turns a bed definition and a seed into an endless sequence of section instances, each with its own
 * variation: a lead an octave away now and then, a different bass line the second time a section is
 * heard, a drum fill on the last bar, and sections skipped or repeated between passes. Pure and
 * deterministic for a given seed, so tests can pin it down. No WebAudio.
 */
import { parseTrack, trackTokens, type NoteEvent } from "./sfxData";
import { type BedDef, type SectionDef, type TrackDef } from "./musicData";

/** Small fast seeded generator (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tokens of a bar-lined track string, bar lines removed. */
export function flatTokens(notes: string): string[] {
  return trackTokens(notes.replace(/\|/g, " "));
}

/** Tokens per bar of a bar-lined track string. */
export function barLengths(notes: string): number[] {
  return notes.split("|").map((b) => trackTokens(b).length);
}

export function parseSectionTrack(notes: string): NoteEvent[] {
  return parseTrack(notes.replace(/\|/g, " "));
}

/** Steps in a section (every track must agree; tests check). */
export function sectionSteps(def: BedDef, section: SectionDef): number {
  const first = def.tracks.find((t) => section.tracks[t.id] !== undefined);
  return first ? flatTokens(section.tracks[first.id]).length : 0;
}

/** Steps in one pass through the bed's nominal order. */
export function loopSteps(def: BedDef): number {
  return def.order.reduce((n, id) => n + sectionSteps(def, def.sections[id]), 0);
}

/** Seconds in one step. */
export function stepSeconds(def: BedDef): number {
  return 60 / def.bpm / def.stepsPerBeat;
}

/** Seconds one nominal pass through the order lasts before anything repeats exactly. */
export function loopSeconds(def: BedDef): number {
  return loopSteps(def) * stepSeconds(def);
}

export interface Segment {
  section: string;
  steps: number;
  /** Per track (same order as `def.tracks`), note events keyed by step. */
  events: Array<Map<number, NoteEvent>>;
  /** Semitones the lead was moved, 0 when not. */
  leadShift: number;
  /** True when the bass is the alternate pattern. */
  altBass: boolean;
  /** True when the last bar carries a drum fill. */
  fill: boolean;
}

interface Compiled {
  steps: number;
  main: Array<NoteEvent[] | null>;
  alt: Array<NoteEvent[] | null>;
}

const LEAD_MIN = 48;
const LEAD_MAX = 93;

export class BedPlanner {
  private readonly rng: () => number;
  private queue: string[] = [];
  private readonly seen = new Map<string, number>();
  private readonly cache = new Map<string, Compiled>();

  constructor(
    readonly def: BedDef,
    seed: number,
  ) {
    this.rng = mulberry32(seed);
  }

  /** The next section instance to play. */
  next(): Segment {
    if (this.queue.length === 0) this.refill();
    const id = this.queue.shift() as string;
    const occurrence = this.seen.get(id) ?? 0;
    this.seen.set(id, occurrence + 1);
    return this.build(id, occurrence);
  }

  private refill(): void {
    const { order, skippable, repeatable } = this.def;
    order.forEach((id, i) => {
      if (skippable?.includes(id) && i > 0 && i < order.length - 1 && this.rng() < 0.3) return;
      this.queue.push(id);
      if (repeatable?.includes(id) && this.rng() < 0.25) this.queue.push(id);
    });
  }

  private compile(id: string): Compiled {
    let c = this.cache.get(id);
    if (c) return c;
    const sec = this.def.sections[id];
    const pick = (src?: Record<string, string>) =>
      this.def.tracks.map((t) => {
        const s = src?.[t.id];
        return s === undefined ? null : parseSectionTrack(s);
      });
    c = { steps: sectionSteps(this.def, sec), main: pick(sec.tracks), alt: pick(sec.alt) };
    this.cache.set(id, c);
    return c;
  }

  private build(id: string, occurrence: number): Segment {
    const c = this.compile(id);
    const def = this.def;
    // fixed number of draws per segment keeps the stream deterministic whatever the bed
    const shiftGate = this.rng();
    const shiftDir = this.rng();
    const fillGate = this.rng();
    const wantShift = shiftGate < (def.octaveChance ?? 0.2) ? (shiftDir < 0.75 ? 12 : -12) : 0;
    const wantFill = fillGate < (def.fillChance ?? 0.3);
    const useAlt = occurrence % 2 === 1;

    let leadShift = 0;
    let altBass = false;
    let fill = false;
    const events = def.tracks.map((t: TrackDef, i) => {
      let evs = c.main[i];
      if (t.role === "bass" && useAlt) {
        const altEvs = c.alt[i];
        evs = altEvs ?? (evs ? liftEveryOther(evs) : evs);
        if (evs) altBass = true;
      }
      if (!evs) return new Map<number, NoteEvent>();
      if (t.role === "lead" && wantShift !== 0) {
        const moved = shiftEvents(evs, wantShift);
        if (moved) {
          evs = moved;
          leadShift = wantShift;
        }
      }
      const m = new Map<number, NoteEvent>();
      for (const e of evs) m.set(e.start, e);
      if (t.role === "drum" && wantFill) {
        const n = Math.min(4, Math.floor(def.stepsPerBar / 2));
        for (let s = c.steps - n; s < c.steps; s++) m.set(s, { start: s, len: 1, midi: -3 });
        fill = true;
      }
      return m;
    });
    return { section: id, steps: c.steps, events, leadShift, altBass, fill };
  }
}

function shiftEvents(evs: NoteEvent[], semis: number): NoteEvent[] | null {
  const pitched = evs.filter((e) => e.midi > 0);
  if (pitched.length === 0) return null;
  const lo = Math.min(...pitched.map((e) => e.midi)) + semis;
  const hi = Math.max(...pitched.map((e) => e.midi)) + semis;
  if (lo < LEAD_MIN || hi > LEAD_MAX) return null;
  return evs.map((e) => (e.midi > 0 ? { ...e, midi: e.midi + semis } : e));
}

/** A cheap second bass line: every other note an octave up. */
function liftEveryOther(evs: NoteEvent[]): NoteEvent[] {
  return evs.map((e, i) => (i % 2 === 1 && e.midi > 0 ? { ...e, midi: e.midi + 12 } : e));
}

/** The first `count` section ids a seed plays (for tests and tooling). */
export function planOrder(def: BedDef, seed: number, count: number): string[] {
  const p = new BedPlanner(def, seed);
  return Array.from({ length: count }, () => p.next().section);
}
