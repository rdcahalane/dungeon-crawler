/**
 * Music beds as data. Every bed is a set of named sections (A, B, a quiet break, a turnaround) plus an
 * `order` in which they are played, so one trip through the order runs 90 seconds or more before it can
 * repeat exactly. `musicPlan.ts` turns a bed and a seed into the actual sequence of sections with per-play
 * variation; `Sfx.ts` plays it. Pure data: no WebAudio and no Phaser.
 *
 * All melodies here are original. Notation: space-separated steps in a track string; `|` marks a bar line
 * and is ignored when playing (tests check every bar holds exactly `stepsPerBar` steps). Note names like
 * C5, F#3, Bb2; "." rest; "-" sustain the previous note. Noise tracks: "x" hat, "k" kick, "s" snare.
 * Bell tracks use note names; the bell rings on its own and ignores sustains.
 */

export const BED_NAMES = [
  "title",
  "tavern",
  "dungeon",
  "dungeon_mid",
  "dungeon_deep",
  "tomb",
  "boss",
  "combat",
] as const;
export type MusicBed = (typeof BED_NAMES)[number];

export type TrackWave = "square" | "triangle" | "noise" | "bell";
/** What variation may do to a track: lead gets octave shifts, bass an alternate pattern, drum a fill. */
export type TrackRole = "lead" | "harm" | "bass" | "drum" | "bell";

export interface TrackDef {
  id: string;
  wave: TrackWave;
  vol: number;
  role: TrackRole;
}

export interface SectionDef {
  /** Track id to bar-lined note string. A track left out is silent for the section. */
  tracks: Record<string, string>;
  /** Optional alternate strings (usually the bass) used the second time the section is heard. */
  alt?: Record<string, string>;
}

export interface BedDef {
  /** Time signature, e.g. [6, 8]. */
  meter: [number, number];
  /** Tempo in quarter notes per minute. */
  bpm: number;
  /** Steps per quarter note (2 = eighth-note steps, 4 = sixteenths). */
  stepsPerBeat: number;
  /** Steps in one bar; must equal beats * stepsPerBeat * 4 / meter[1]. */
  stepsPerBar: number;
  tracks: TrackDef[];
  sections: Record<string, SectionDef>;
  /** Section ids in the order one pass plays them. */
  order: string[];
  /** Sections variation may drop (never the first or last of the order). */
  skippable?: string[];
  /** Sections variation may play twice in a row. */
  repeatable?: string[];
  /** Loudness trim for the whole bed (default 1). Sparse percussive beds measure quieter than drones. */
  level?: number;
  /** Chance a section is heard with its lead an octave away (default 0.2). */
  octaveChance?: number;
  /** Chance a section ends on a drum fill (default 0.3). */
  fillChance?: number;
}

// ── notation helpers ─────────────────────────────────────────────────────────

const bars = (...b: string[]): string => b.join(" | ");
const rep = (b: string, n: number): string => bars(...Array<string>(n).fill(b));
const rest = (steps: number): string => Array<string>(steps).fill(".").join(" ");
/** n silent bars. */
const sil = (n: number, steps = 8): string => rep(rest(steps), n);
/** One long note per bar, from a space-separated list of note names. */
const hold = (notes: string, steps = 8): string =>
  bars(...notes.split(" ").map((n) => `${n} ${Array<string>(steps - 1).fill("-").join(" ")}`));
/** A note held for a whole bar, then silence-padded to `steps`. */
const held = (n: string, sustain: number, steps: number): string =>
  `${n} ${Array<string>(sustain).fill("-").join(" ")} ${rest(steps - 1 - sustain)}`;

type Chord = Record<string, string>;
const tmpl = (t: string, m: Chord): string =>
  t
    .split(" ")
    .map((x) => m[x] ?? x)
    .join(" ");
/** One bar per chord name, the template filled from the chord table. */
const perChord = (chords: string, table: Record<string, Chord>, t: string): string =>
  bars(...chords.split(" ").map((c) => tmpl(t, table[c] ?? {})));

// ── title: E minor, 4/4, a rising theme ──────────────────────────────────────

const TITLE_CH: Record<string, Chord> = {
  Em: { r: "E2", f: "B2", o: "E3", a: "B3", b: "E4", c: "G4" },
  C: { r: "C2", f: "G2", o: "C3", a: "G3", b: "C4", c: "E4" },
  D: { r: "D2", f: "A2", o: "D3", a: "A3", b: "D4", c: "F#4" },
  G: { r: "G2", f: "D3", o: "G3", a: "B3", b: "D4", c: "G4" },
  B7: { r: "B1", f: "F#2", o: "B2", a: "F#3", b: "B3", c: "D#4" },
  Am: { r: "A1", f: "E2", o: "A2", a: "E3", b: "A3", c: "C4" },
};
const T_BASS = "r . r . f . r .";
const T_BASS_ALT = "r . f . o . f .";
const T_ARP = "a . b . c . b .";
const T_DRUM = "k . x . s . x .";

const titleSection = (chords: string, lead: string, drums = true): SectionDef => ({
  tracks: {
    lead,
    harm: perChord(chords, TITLE_CH, T_ARP),
    bass: perChord(chords, TITLE_CH, T_BASS),
    drum: drums ? rep(T_DRUM, chords.split(" ").length) : sil(chords.split(" ").length),
  },
  alt: { bass: perChord(chords, TITLE_CH, T_BASS_ALT) },
});

const TITLE: BedDef = {
  meter: [4, 4],
  bpm: 100,
  stepsPerBeat: 2,
  stepsPerBar: 8,
  tracks: [
    { id: "lead", wave: "square", vol: 0.065, role: "lead" },
    { id: "harm", wave: "square", vol: 0.03, role: "harm" },
    { id: "bass", wave: "triangle", vol: 0.16, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.05, role: "drum" },
  ],
  sections: {
    A: titleSection(
      "Em Em C D Em G C B7",
      bars(
        "E4 - B4 - E5 - D5 B4",
        "G4 - A4 B4 - - . .",
        "C5 - B4 - G4 - E4 G4",
        "A4 - F#4 - D4 - . .",
        "E4 - B4 - E5 - F#5 G5",
        "B5 - A5 - G5 - D5 -",
        "E5 - D5 C5 B4 - G4 -",
        "D#5 - F#5 - B4 - . .",
      ),
    ),
    B: titleSection(
      "G D Em C G D C D",
      bars(
        "D5 - G5 - B5 - A5 G5",
        "F#5 - A5 - D6 - . .",
        "E5 - G5 - B5 - G5 -",
        "G5 - E5 - C5 - . .",
        "D5 - G5 B5 D6 - B5 -",
        "A5 - F#5 A5 D5 - . .",
        "E5 G5 C6 - B5 A5 G5 -",
        "A5 - F#5 - A5 - . .",
      ),
    ),
    C: {
      tracks: {
        lead: bars("B4 - - - - - E5 -", rest(8), "A4 - - - C5 - - -", "D#5 - - - - - . ."),
        harm: perChord("Em C Am B7", TITLE_CH, "a . . . c . . ."),
        bass: perChord("Em C Am B7", TITLE_CH, "r - - - - - - -"),
        drum: sil(4),
      },
    },
    D: titleSection(
      "Am C D B7",
      bars("A4 - C5 - E5 - A5 -", "G5 - E5 - C5 - G4 -", "F#5 - A5 - D6 - F#5 A5", "B5 - - - - - . ."),
    ),
  },
  order: ["A", "B", "A", "C", "B", "D"],
  skippable: ["C"],
  repeatable: ["B"],
};

// ── tavern: G major, a lilting 6/8 jig ───────────────────────────────────────

const TAV_CH: Record<string, Chord> = {
  G: { r: "G2", f: "D3", a: "B3", b: "D4" },
  D: { r: "D2", f: "A2", a: "A3", b: "D4" },
  C: { r: "C2", f: "G2", a: "E4", b: "G4" },
  Em: { r: "E2", f: "B2", a: "G3", b: "B3" },
  Am: { r: "A1", f: "E2", a: "C4", b: "E4" },
};
const V_BASS = "r . . f . .";
const V_BASS_ALT = "r . f r . f";
const V_HARM = ". a b . a b";
const V_DRUM = "k . x s . x";

const tavSection = (chords: string, lead: string, quiet = false): SectionDef => {
  const n = chords.split(" ").length;
  return {
    tracks: {
      lead,
      harm: perChord(chords, TAV_CH, quiet ? ". . . . a b" : V_HARM),
      bass: perChord(chords, TAV_CH, quiet ? "r . . . . ." : V_BASS),
      drum: quiet ? sil(n, 6) : rep(V_DRUM, n),
    },
    alt: quiet ? undefined : { bass: perChord(chords, TAV_CH, V_BASS_ALT) },
  };
};

const TAV_A_HEAD = [
  "G4 B4 D5 G5 - D5",
  "B5 - G5 D5 - B4",
  "A4 D5 F#5 A5 - F#5",
  "D6 - A5 F#5 - D5",
];

const TAVERN: BedDef = {
  // Measured 2026-11-14: peaks about 6 dB under the dungeon beds before this trim.
  level: 1.7,
  meter: [6, 8],
  bpm: 150,
  stepsPerBeat: 2,
  stepsPerBar: 6,
  tracks: [
    { id: "lead", wave: "square", vol: 0.07, role: "lead" },
    { id: "harm", wave: "square", vol: 0.035, role: "harm" },
    { id: "bass", wave: "triangle", vol: 0.16, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.05, role: "drum" },
  ],
  sections: {
    A: tavSection(
      "G G D D G C D G",
      bars(
        ...TAV_A_HEAD,
        "G4 B4 D5 G5 - D5",
        "E5 G5 C6 B5 - G5",
        "F#5 A5 D6 C6 A5 F#5",
        "G5 - - D5 - -",
      ),
    ),
    A2: tavSection(
      "G G D D G Em D G",
      bars(
        ...TAV_A_HEAD,
        "B4 D5 G5 B5 - G5",
        "E5 G5 B5 A5 - G5",
        "A5 - F#5 D5 - A4",
        "G4 - - - - -",
      ),
    ),
    B: tavSection(
      "Em Em C G Am Em D G",
      bars(
        "E5 - B4 E5 - B4",
        "G5 - E5 B5 - G5",
        "G5 - E5 C5 - E5",
        "D5 - B4 G4 - B4",
        "A4 C5 E5 A5 - E5",
        "G5 F#5 E5 B4 - G4",
        "A4 D5 F#5 A5 F#5 D5",
        "B4 - G4 - - -",
      ),
    ),
    C: tavSection(
      "G Em C D G Em Am D",
      bars(
        "D5 - - B4 - -",
        "E5 - - G5 - -",
        "G5 - - E5 - -",
        "F#5 - - A5 - -",
        "D5 - - B4 - -",
        "B4 - - G4 - -",
        "C5 - E5 - - -",
        "F#4 . A4 . D5 .",
      ),
      true,
    ),
    D: tavSection(
      "C D G Em C D D D",
      bars(
        "C5 E5 G5 C6 - G5",
        "D5 F#5 A5 D6 - A5",
        "B4 D5 G5 B5 - G5",
        "E5 G5 B5 E6 - B5",
        "E5 G5 C6 E6 - C6",
        "A5 F#5 D5 A4 - D5",
        "F#5 A5 D6 C6 B5 A5",
        "D6 - - A5 - -",
      ),
    ),
  },
  order: ["A", "A2", "B", "A", "C", "B", "D", "A2", "B", "D"],
  skippable: ["D"],
  repeatable: ["B"],
};

// ── dungeon, floors 1 to 4: D Dorian, sparse and curious ─────────────────────

const UP_TRACKS: TrackDef[] = [
  { id: "lead", wave: "square", vol: 0.045, role: "lead" },
  { id: "bass", wave: "triangle", vol: 0.18, role: "bass" },
  { id: "plink", wave: "triangle", vol: 0.03, role: "harm" },
  { id: "drip", wave: "noise", vol: 0.04, role: "drum" },
];
const drips = (...b: string[]): string => bars(...b);

const DUNGEON: BedDef = {
  meter: [4, 4],
  bpm: 72,
  stepsPerBeat: 2,
  stepsPerBar: 8,
  tracks: UP_TRACKS,
  sections: {
    A: {
      tracks: {
        lead: bars(
          "D4 - . . A4 - . .",
          "G4 - F4 . E4 - . .",
          "D4 - . . B4 - . .",
          "A4 - - - . . . .",
          "D4 - F4 - A4 - C5 -",
          "B4 - . . G4 - . .",
          "E4 - F4 - E4 - D4 -",
          "D4 - - - - - . .",
        ),
        bass: hold("D2 D2 G2 A1 D2 G2 A1 D2"),
        plink: bars(
          ". . . . . . A5 .",
          ". . E6 . . . . .",
          ". . . . D6 . . .",
          "F5 . . . . . . .",
          ". . . A5 . . . .",
          ". . . . . E6 . .",
          "G5 . . . . . . .",
          rest(8),
        ),
        drip: drips(rest(8), rest(8), ". . . . . x . .", rest(8), rest(8), rest(8), ". x . . . . . .", rest(8)),
      },
    },
    B: {
      tracks: {
        lead: bars(
          "A4 - C5 - E5 - . .",
          "D5 - . . C5 - . .",
          "B4 - . . . . A4 .",
          "G#4 - - - . . . .",
          "A4 - C5 - E5 - A5 -",
          "G5 - E5 - D5 - . .",
          "C5 - B4 - A4 - G#4 -",
          "A4 - - - - - . .",
        ),
        bass: hold("A1 A1 D2 E2 A1 A1 E2 A1"),
        plink: bars(
          ". . . . E6 . . .",
          "A5 . . . . . . .",
          ". . . . . . C6 .",
          ". E6 . . . . . .",
          rest(8),
          "A5 . . . . . . .",
          ". . . . G#5 . . .",
          rest(8),
        ),
        drip: drips(rest(8), ". . . . . . x .", rest(8), rest(8), ". x . . . . . .", rest(8), rest(8), rest(8)),
      },
    },
    C: {
      tracks: {
        lead: bars(rest(8), "E4 - - - - - - -", rest(8), rest(8)),
        bass: hold("D2 D2 D2 D2"),
        plink: bars(rest(8), ". . . . . . D6 .", rest(8), "A5 . . . . . . ."),
        drip: drips(". . . x . . . .", rest(8), rest(8), ". . . . . . x ."),
      },
    },
    D: {
      tracks: {
        lead: bars("A4 - G4 - F4 - E4 -", "D4 - E4 - F4 - A4 -", "C5 - B4 - A4 - G4 -", "A4 - - - - - . ."),
        bass: hold("G2 D2 A1 A1"),
        plink: bars(rest(8), ". . . . . . F5 .", rest(8), rest(8)),
        drip: sil(4),
      },
    },
  },
  order: ["A", "B", "C", "A", "D"],
  skippable: ["C"],
  repeatable: ["B"],
  octaveChance: 0.25,
  fillChance: 0,
};

// ── dungeon, floors 5 to 8: E Phrygian, tense, a slow heartbeat ──────────────

const MID_CH: Record<string, Chord> = {
  E: { r: "E2", f: "B2", a: "E3", b: "B3" },
  C: { r: "C2", f: "G2", a: "C3", b: "G3" },
  F: { r: "F2", f: "C3", a: "F3", b: "C4" },
  A: { r: "A1", f: "E2", a: "A2", b: "E3" },
  B: { r: "B1", f: "F#2", a: "B2", b: "F3" },
};
const M_BASS = "r - . r - . . .";
const M_BASS_ALT = "r - . r - . f .";
const M_STAB = "a . . b . . a .";

const midSection = (chords: string, lead: string, drum: string): SectionDef => ({
  tracks: {
    lead,
    stab: perChord(chords, MID_CH, M_STAB),
    bass: perChord(chords, MID_CH, M_BASS),
    drum,
  },
  alt: { bass: perChord(chords, MID_CH, M_BASS_ALT) },
});

const DUNGEON_MID: BedDef = {
  meter: [4, 4],
  bpm: 58,
  stepsPerBeat: 2,
  stepsPerBar: 8,
  tracks: [
    { id: "lead", wave: "square", vol: 0.05, role: "lead" },
    { id: "stab", wave: "square", vol: 0.028, role: "harm" },
    { id: "bass", wave: "triangle", vol: 0.2, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.045, role: "drum" },
  ],
  sections: {
    A: midSection(
      "E E C F E E A E",
      bars(
        "E4 - - F4 - E4 . .",
        "B4 - - - A4 - . .",
        "G4 - F4 - E4 - . .",
        "F4 - - - . . . .",
        "E4 - - F4 - E4 . .",
        "C5 - - - B4 - . .",
        "A4 - G4 - F4 - E4 -",
        "E4 - - - - - . .",
      ),
      rep("k . . . x . . .", 8),
    ),
    B: midSection(
      "E E C F E F B E",
      bars(
        "B4 - - C5 - B4 . .",
        "G4 - - - F#4 - . .",
        "E4 - G4 - B4 - D5 -",
        "C5 - - - B4 - . .",
        "B4 - - C5 - D5 - E5",
        "F5 - - E5 - D5 - C5",
        "B4 - A4 - G4 - F4 -",
        "E4 - - - - - . .",
      ),
      rep("k . . . x . x .", 8),
    ),
    C: {
      tracks: {
        lead: bars(rest(8), "B3 - - - - - . .", rest(8), "F4 - - - E4 - - -"),
        bass: hold("E2 E2 E2 E2"),
        drum: sil(4),
      },
    },
    D: midSection(
      "A F C B",
      bars("E5 - D5 - C5 - B4 -", "A4 - G4 - F4 - E4 -", "F4 - G4 - A4 - B4 -", "B4 - - - - - . ."),
      rep("k . x . k . x x", 4),
    ),
  },
  order: ["A", "B", "C", "A", "D"],
  skippable: ["C"],
  repeatable: ["B"],
  octaveChance: 0.2,
  fillChance: 0.2,
};

// ── dungeon, floors 9 to 12: low drones, very sparse, unsettling intervals ──

const DUNGEON_DEEP: BedDef = {
  meter: [4, 4],
  bpm: 48,
  stepsPerBeat: 2,
  stepsPerBar: 8,
  tracks: [
    { id: "drone", wave: "triangle", vol: 0.2, role: "bass" },
    { id: "tritone", wave: "square", vol: 0.025, role: "harm" },
    { id: "lead", wave: "square", vol: 0.03, role: "lead" },
    { id: "tick", wave: "noise", vol: 0.03, role: "drum" },
  ],
  sections: {
    A: {
      tracks: {
        drone: hold("C2 C2 Db2 Db2 C2 C2"),
        tritone: bars(
          rest(8),
          ". . . . F#3 - - -",
          rest(8),
          ". . . . G3 - - -",
          rest(8),
          ". . . . F#3 - - -",
        ),
        lead: bars(
          ". . . . . . G5 .",
          ". . E5 . . . . .",
          "Db5 - . . . . . .",
          ". . . . . F#5 . .",
          "C5 . . . . . . .",
          ". . . . B4 - . .",
        ),
        tick: bars(rest(8), rest(8), ". . . . . x . .", rest(8), rest(8), rest(8)),
      },
    },
    B: {
      tracks: {
        drone: hold("Eb2 Eb2 A1 A1 Eb2 Eb2"),
        tritone: bars(
          ". . . . A3 - - -",
          rest(8),
          ". . . . Eb3 - - -",
          rest(8),
          ". . . . A3 - - -",
          rest(8),
        ),
        lead: bars(
          "Bb4 . . . E5 . . .",
          rest(8),
          ". . G5 . . . . .",
          "Db5 . . . . . A4 .",
          ". . . . E5 - . .",
          "Bb4 - - - . . . .",
        ),
        tick: bars(rest(8), ". . x . . . . .", rest(8), rest(8), ". . . . . . . x", rest(8)),
      },
    },
    C: {
      tracks: {
        drone: hold("C2 C2 C2 C2"),
        tritone: bars(rest(8), rest(8), "F#3 - - - - - - -", rest(8)),
        lead: bars(rest(8), rest(8), rest(8), "Db4 - - - - - - -"),
        tick: bars(rest(8), ". . . . . . x .", rest(8), rest(8)),
      },
    },
    D: {
      tracks: {
        drone: hold("C2 B1 Bb1 A1"),
        tritone: sil(4),
        lead: bars("G5 . . . . . . .", "F#5 . . . . . . .", "F5 . . . . . . .", "E5 - - - - - . ."),
        tick: sil(4),
      },
    },
  },
  order: ["A", "B", "C", "D", "A"],
  octaveChance: 0.2,
  fillChance: 0,
};

// ── tomb, floor 13: a slow processional with a tolling bell ──────────────────

const TOMB: BedDef = {
  meter: [4, 4],
  bpm: 46,
  stepsPerBeat: 2,
  stepsPerBar: 8,
  tracks: [
    { id: "lead", wave: "square", vol: 0.04, role: "lead" },
    { id: "harm", wave: "square", vol: 0.022, role: "harm" },
    { id: "bass", wave: "triangle", vol: 0.18, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.05, role: "drum" },
    { id: "bell", wave: "bell", vol: 0.075, role: "bell" },
  ],
  sections: {
    A: {
      tracks: {
        lead: bars(
          "E4 - - - B4 - - -",
          "C5 - B4 - A4 - G4 -",
          "F4 - - - E4 - - -",
          "E4 - F4 - G4 - A4 -",
          "B4 - - - C5 - B4 -",
          "A4 - G4 - F4 - E4 -",
        ),
        harm: hold("B3 B3 G3 C4 B3 F#3"),
        bass: hold("E2 E2 C2 F2 E2 B1"),
        drum: rep("k . . . k . . .", 6),
        bell: bars(
          "E3 . . . . . . .",
          rest(8),
          "E3 . . . . . . .",
          rest(8),
          "E3 . . . . . . .",
          ". . . . B2 . . .",
        ),
      },
      alt: { bass: bars("E2 . . . B2 . . .", "E2 - - - - - - -", "C2 - - - G2 - - -", "F2 - - - C3 - - -", "E2 . . . B2 . . .", "B1 - - - - - - -") },
    },
    B: {
      tracks: {
        lead: bars(
          "G4 - - - B4 - - -",
          "E5 - D5 - C5 - B4 -",
          "C5 - - - A4 - - -",
          "B4 - A4 - G4 - F4 -",
          "E4 - - - F4 - G4 -",
          "E4 - - - - - . .",
        ),
        harm: hold("B3 B3 G3 E3 C4 B3"),
        bass: hold("E2 E2 C2 A1 F2 E2"),
        drum: rep("k . . . k . . .", 6),
        bell: bars(
          "E3 . . . . . . .",
          rest(8),
          "E3 . . . . . . .",
          rest(8),
          "F3 . . . . . . .",
          rest(8),
        ),
      },
    },
    C: {
      tracks: {
        lead: bars(rest(8), ". . . . B3 - - -", rest(8), "F4 - - - E4 - - -"),
        bass: hold("E2 E2 E2 E2"),
        bell: bars("E3 . . . . . . .", rest(8), "B2 . . . . . . .", "E3 . . . . . . ."),
      },
    },
    D: {
      tracks: {
        lead: bars("B4 - A4 - G4 - F4 -", "E4 - G4 - B4 - E5 -", "F5 - E5 - D5 - C5 -", "B4 - - - - - . ."),
        harm: hold("E4 B3 C4 F#3"),
        bass: hold("A2 E2 F2 B1"),
        drum: rep("k . . . k . . .", 4),
        bell: bars("A2 . . . . . . .", rest(8), "F3 . . . . . . .", rest(8)),
      },
    },
  },
  order: ["A", "B", "C", "A", "D"],
  skippable: ["C"],
  octaveChance: 0.15,
  fillChance: 0.15,
};

// ── boss, the Hollow King: D harmonic minor, galloping sixteenths ────────────

const BOSS_CH: Record<string, Chord> = {
  Dm: { r: "D2", f: "A2", o: "D3", a: "D4", b: "F4", c: "A4" },
  Bb: { r: "Bb1", f: "F2", o: "Bb2", a: "Bb3", b: "D4", c: "F4" },
  A: { r: "A1", f: "E2", o: "A2", a: "A3", b: "C#4", c: "E4" },
  Gm: { r: "G2", f: "D3", o: "G3", a: "G3", b: "Bb3", c: "D4" },
};
const B_BASS = "r . r r . r . r r . r r . f . f";
const B_BASS_ALT = "r . r o . r . f r . r o . f . o";
const B_ARP = "a b c b a b c b a b c b a b c b";
const B_DRUM = "k . x . s . x . k . k . s . x x";

const bossSection = (chords: string, lead: string): SectionDef => ({
  tracks: {
    lead,
    harm: perChord(chords, BOSS_CH, B_ARP),
    bass: perChord(chords, BOSS_CH, B_BASS),
    drum: rep(B_DRUM, chords.split(" ").length),
  },
  alt: { bass: perChord(chords, BOSS_CH, B_BASS_ALT) },
});

const BOSS: BedDef = {
  // Measured 2026-11-14: peaks about 6 dB under the dungeon beds before this trim.
  level: 1.9,
  meter: [4, 4],
  bpm: 132,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  tracks: [
    { id: "lead", wave: "square", vol: 0.055, role: "lead" },
    { id: "harm", wave: "square", vol: 0.026, role: "harm" },
    { id: "bass", wave: "triangle", vol: 0.17, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.055, role: "drum" },
  ],
  sections: {
    A: bossSection(
      "Dm Dm Bb A Dm Gm A Dm",
      bars(
        "D5 . . . F5 . . . A5 . . . D6 . . .",
        "C#6 . . . A5 . . . F5 . . . E5 . D5 .",
        "Bb4 . . . D5 . . . F5 . . . D5 . Bb4 .",
        "A4 . C#5 . E5 . A5 . . . . . . . . .",
        "D5 . F5 . A5 . D6 . F6 . . . D6 . . .",
        "G5 . Bb5 . D6 . Bb5 . G5 . . . . . . .",
        "E5 . G5 . A5 . C#6 . E6 . . . C#6 . A5 .",
        "D6 . . . A5 . . . D5 . . . . . . .",
      ),
    ),
    B: bossSection(
      "Dm Dm Gm Gm Bb A Dm A",
      bars(
        "D5 . D5 F5 . D5 . C#5 D5 . F5 . A5 . G5 .",
        "D5 . D5 F5 . D5 . C#5 D5 . F5 . A5 . C6 .",
        "G5 . G5 Bb5 . G5 . F#5 G5 . Bb5 . D6 . C6 .",
        "G5 . G5 Bb5 . G5 . F#5 G5 . Bb5 . D6 . F6 .",
        "Bb5 . . . A5 . . . G5 . . . F5 . . .",
        "E5 . . . F5 . . . E5 . . . C#5 . . .",
        "D5 . F5 . A5 . F5 . D5 . . . . . . .",
        "A4 . C#5 . E5 . A5 . . . . . . . . .",
      ),
    ),
    C: {
      tracks: {
        lead: bars(held("A4", 11, 16), held("Bb4", 11, 16), held("G4", 11, 16), held("A4", 11, 16)),
        bass: perChord("Dm Bb Gm A", BOSS_CH, "r . . . . . . . r . . . . . . ."),
        drum: rep("k . . . k . . . k . . . k . . .", 4),
      },
    },
    D: bossSection(
      "Dm Gm A A",
      bars(
        "D5 . F5 . A5 . D6 . F6 . D6 . A5 . F5 .",
        "G5 . Bb5 . D6 . Bb5 . G5 . D5 . Bb4 . G4 .",
        "E5 . A5 . C#6 . E6 . A5 . E5 . C#5 . A4 .",
        "A5 A5 . A5 A5 . A5 A5 A5 A5 A5 A5 . . . .",
      ),
    ),
  },
  order: ["A", "B", "A", "C", "B", "D", "A", "B"],
  skippable: ["C"],
  octaveChance: 0.2,
  fillChance: 0.5,
};

// ── combat layer: a short tense bed that sits on top of the floor bed ────────

const CMB_CH: Record<string, Chord> = {
  E: { r: "E2", f: "Bb2" },
  Bb: { r: "Bb1", f: "E2" },
  F: { r: "F2", f: "B2" },
};
const C_BASS = "r . r r . r . r r . r r . f . f";
const C_DRUM = "k . x x s . x x k . x x s . x s";

const COMBAT: BedDef = {
  meter: [4, 4],
  bpm: 150,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  tracks: [
    { id: "stab", wave: "square", vol: 0.04, role: "lead" },
    { id: "bass", wave: "triangle", vol: 0.14, role: "bass" },
    { id: "drum", wave: "noise", vol: 0.05, role: "drum" },
  ],
  sections: {
    A: {
      tracks: {
        stab: bars(
          "E4 . . . . . Bb4 . . . . . E4 . . .",
          "E4 . . . . . F4 . . . . . E4 . . .",
          "Bb3 . . . . . E4 . . . . . Bb3 . . .",
          "E4 . E4 . E4 . . . Bb4 . Bb4 . Bb4 . . .",
        ),
        bass: perChord("E E Bb E", CMB_CH, C_BASS),
        drum: rep(C_DRUM, 4),
      },
    },
    B: {
      tracks: {
        stab: bars(
          "E5 . Bb4 . E5 . Bb4 . E5 . Bb4 . E5 . F5 .",
          "E5 . Bb4 . E5 . Bb4 . E5 . Bb4 . E5 . Bb4 .",
          "F5 . B4 . F5 . B4 . F5 . B4 . F5 . E5 .",
          "E5 . . . Bb4 . . . E5 . E5 . E5 . . .",
        ),
        bass: perChord("E E F E", CMB_CH, C_BASS),
        drum: rep(C_DRUM, 4),
      },
    },
  },
  order: ["A", "A", "B", "A", "B", "B"],
  octaveChance: 0.1,
  fillChance: 0.4,
};

export const MUSIC: Record<MusicBed, BedDef> = {
  title: TITLE,
  tavern: TAVERN,
  dungeon: DUNGEON,
  dungeon_mid: DUNGEON_MID,
  dungeon_deep: DUNGEON_DEEP,
  tomb: TOMB,
  boss: BOSS,
  combat: COMBAT,
};

/** Music bed for a dungeon floor: three depth bands, then the tomb from floor 13. */
export function bedForFloorNumber(floor: number): MusicBed {
  if (!Number.isFinite(floor) || floor <= 4) return "dungeon";
  if (floor <= 8) return "dungeon_mid";
  if (floor <= 12) return "dungeon_deep";
  return "tomb";
}
