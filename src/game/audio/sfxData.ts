/**
 * Data for the synth: sound effect recipes and music bed note sequences.
 * Pure data and parsing; no WebAudio and no Phaser, so tests can import it.
 */

export type Wave = "square" | "triangle" | "saw" | "noise";
export type NoiseFilter = "lowpass" | "highpass" | "bandpass";

/** One voice inside an effect. Times are seconds relative to the effect start. */
export interface Voice {
  wave: Wave;
  /** Start and end pitch (Hz) for tones; start/end filter cutoff (Hz) for noise. */
  f0: number;
  f1?: number;
  dur: number;
  /** Peak gain, 0..1. */
  vol: number;
  delay?: number;
  filter?: NoiseFilter;
  /** Hold the level instead of decaying (music drones). */
  sustain?: boolean;
}

export const SFX_KEYS = [
  "step",
  "swing",
  "hit",
  "miss",
  "crit",
  "hurt",
  "death",
  "monster_die",
  "pickup",
  "gold",
  "door",
  "secret",
  "lever",
  "plate",
  "trap_dart",
  "trap_pit",
  "trap_gas",
  "crush",
  "spell_cast",
  "spell_fizzle",
  "heal",
  "level_up",
  "ui_move",
  "ui_select",
  "ui_back",
  "torch_out",
  "riddle_right",
  "riddle_wrong",
  "boss_roar",
  "game_over",
  "victory",
] as const;

export type SfxKey = (typeof SFX_KEYS)[number];

export const MUSIC_BEDS = ["tavern", "dungeon", "tomb"] as const;
export type MusicBed = (typeof MUSIC_BEDS)[number];

const sq = (f0: number, f1: number | undefined, dur: number, vol: number, delay = 0): Voice => ({
  wave: "square",
  f0,
  f1,
  dur,
  vol,
  delay,
});
const tri = (f0: number, f1: number | undefined, dur: number, vol: number, delay = 0): Voice => ({
  wave: "triangle",
  f0,
  f1,
  dur,
  vol,
  delay,
});
const nz = (filter: NoiseFilter, f0: number, f1: number | undefined, dur: number, vol: number, delay = 0): Voice => ({
  wave: "noise",
  f0,
  f1,
  dur,
  vol,
  delay,
  filter,
});

/** Arpeggio of equal short notes. */
const arp = (notes: number[], step: number, vol: number, wave: "square" | "triangle" = "square", delay = 0): Voice[] =>
  notes.map((f, i) => ({ wave, f0: f, dur: step * 1.4, vol, delay: delay + i * step }));

export const EFFECTS: Record<SfxKey, Voice[]> = {
  step: [nz("lowpass", 420, 160, 0.06, 0.16), tri(95, 60, 0.05, 0.12)],
  swing: [nz("bandpass", 700, 2600, 0.16, 0.22)],
  hit: [nz("lowpass", 2000, 260, 0.13, 0.38), sq(190, 60, 0.11, 0.26)],
  miss: [nz("highpass", 3200, 5200, 0.08, 0.1), tri(640, 300, 0.09, 0.1)],
  crit: [
    nz("lowpass", 3000, 200, 0.16, 0.42),
    sq(160, 50, 0.14, 0.3),
    sq(880, 1760, 0.09, 0.2, 0.02),
    sq(1320, undefined, 0.14, 0.18, 0.09),
  ],
  hurt: [sq(320, 90, 0.26, 0.3), nz("lowpass", 1400, 200, 0.16, 0.25)],
  death: [
    sq(440, 55, 0.85, 0.3),
    tri(220, 40, 1.0, 0.3),
    nz("lowpass", 900, 100, 0.75, 0.22, 0.05),
  ],
  monster_die: [sq(280, 50, 0.38, 0.26), nz("lowpass", 1600, 140, 0.32, 0.26), tri(140, 40, 0.4, 0.2)],
  pickup: [sq(660, undefined, 0.07, 0.2), sq(990, undefined, 0.1, 0.2, 0.06)],
  gold: [sq(1320, undefined, 0.05, 0.15), sq(1760, undefined, 0.09, 0.15, 0.05), tri(1760, undefined, 0.12, 0.15, 0.05)],
  door: [tri(95, 60, 0.4, 0.3), nz("lowpass", 500, 160, 0.34, 0.2), sq(120, 85, 0.3, 0.07, 0.05)],
  secret: arp([392, 466, 587, 784, 932], 0.09, 0.2, "triangle"),
  lever: [nz("bandpass", 1800, 900, 0.04, 0.3), sq(150, 70, 0.1, 0.25), sq(110, 55, 0.12, 0.28, 0.13)],
  plate: [tri(120, 55, 0.18, 0.35), nz("bandpass", 1500, 700, 0.04, 0.25)],
  trap_dart: [nz("highpass", 4200, 1600, 0.1, 0.2), sq(1300, 320, 0.12, 0.18), tri(110, 60, 0.1, 0.3, 0.1)],
  trap_pit: [tri(680, 55, 0.85, 0.3), nz("lowpass", 1400, 100, 0.3, 0.4, 0.8), sq(80, 40, 0.25, 0.3, 0.8)],
  trap_gas: [nz("bandpass", 2200, 700, 1.2, 0.24), sq(180, 150, 1.0, 0.05), nz("highpass", 3500, 2500, 0.9, 0.1, 0.1)],
  crush: [
    nz("lowpass", 700, 80, 0.65, 0.42),
    sq(70, 38, 0.55, 0.32),
    tri(60, 35, 0.4, 0.3, 0.2),
    nz("lowpass", 500, 90, 0.2, 0.35, 0.45),
  ],
  spell_cast: [sq(300, 1200, 0.3, 0.16), tri(600, 2400, 0.28, 0.14, 0.05), nz("highpass", 4000, 6000, 0.2, 0.05)],
  spell_fizzle: [sq(520, 110, 0.26, 0.16), nz("highpass", 3000, 1000, 0.2, 0.12)],
  heal: arp([523, 659, 784, 1047, 1319], 0.08, 0.2, "triangle"),
  level_up: [
    ...arp([523, 659, 784, 1047], 0.1, 0.18),
    sq(1319, undefined, 0.35, 0.18, 0.4),
    tri(262, undefined, 0.7, 0.25, 0.4),
  ],
  ui_move: [sq(880, undefined, 0.035, 0.1)],
  ui_select: [sq(660, 990, 0.09, 0.14)],
  ui_back: [sq(520, 330, 0.09, 0.12)],
  torch_out: [nz("lowpass", 1400, 180, 0.55, 0.22), tri(220, 110, 0.3, 0.1)],
  riddle_right: [
    ...arp([523, 659, 784], 0.1, 0.17),
    tri(1047, undefined, 0.4, 0.18, 0.3),
    sq(784, undefined, 0.4, 0.08, 0.3),
  ],
  riddle_wrong: [sq(196, undefined, 0.2, 0.18), sq(147, 120, 0.4, 0.18, 0.2), nz("lowpass", 600, 200, 0.5, 0.08)],
  boss_roar: [
    nz("lowpass", 520, 140, 1.3, 0.4),
    sq(72, 44, 1.2, 0.3),
    tri(55, 38, 1.3, 0.3),
    sq(110, 65, 0.9, 0.12, 0.1),
  ],
  game_over: [
    ...arp([392, 330, 262, 196], 0.26, 0.2),
    tri(98, 65, 1.3, 0.3),
    nz("lowpass", 700, 90, 0.9, 0.1, 0.2),
  ],
  victory: [
    ...arp([523, 659, 784, 1047, 784, 1047, 1319], 0.13, 0.17),
    sq(1568, undefined, 0.6, 0.17, 0.95),
    tri(262, undefined, 0.5, 0.25),
    tri(392, undefined, 0.8, 0.25, 0.9),
  ],
};

// ── music beds ──────────────────────────────────────────────────────────────

export interface MusicTrack {
  wave: "square" | "triangle" | "noise";
  vol: number;
  /**
   * Space-separated steps. Note names like C4, F#3, Bb2; "." rest; "-" sustain
   * the previous note; "x" is a noise tick (noise tracks only).
   */
  notes: string;
}

export interface MusicBedDef {
  bpm: number;
  /** Steps per beat (2 = eighth notes). */
  stepsPerBeat: number;
  tracks: MusicTrack[];
}

export const MUSIC: Record<MusicBed, MusicBedDef> = {
  // A jaunty eight-bar jig in C, then a turn through F and G.
  tavern: {
    bpm: 128,
    stepsPerBeat: 2,
    tracks: [
      {
        wave: "square",
        vol: 0.07,
        notes:
          "C5 E5 G5 E5 C5 . D5 E5  F5 A5 G5 F5 E5 . D5 .  G5 E5 C5 E5 G5 . A5 G5  F5 D5 B4 D5 C5 - - . " +
          "E5 G5 C6 G5 E5 . F5 G5  A5 C6 B5 A5 G5 . F5 .  E5 C5 D5 E5 F5 E5 D5 B4  C5 - - . C5 - - .",
      },
      {
        wave: "triangle",
        vol: 0.16,
        notes:
          "C3 . G3 . C3 . G3 .  F3 . C4 . F3 . C4 .  C3 . G3 . C3 . E3 .  G2 . D3 . G2 . D3 . " +
          "C3 . G3 . C3 . G3 .  F3 . C4 . F3 . C4 .  A2 . E3 . G2 . D3 .  C3 . G3 . C3 - - .",
      },
      {
        wave: "noise",
        vol: 0.05,
        notes:
          "x . . . x . . .  x . . . x . . .  x . . . x . . .  x . . . x . x . " +
          "x . . . x . . .  x . . . x . . .  x . . . x . . .  x . . . x . x .",
      },
    ],
  },
  // Slow minor drone with a sparse theme and the odd drip.
  dungeon: {
    bpm: 66,
    stepsPerBeat: 2,
    tracks: [
      {
        wave: "square",
        vol: 0.045,
        notes:
          "A3 - - - . . E4 -  . . D4 - . . . .  C4 - - - B3 - . .  A3 - - - - - . . " +
          "A3 - - - . . F4 -  . . E4 - . . . .  D4 - - - C4 - . .  B3 - - - - - . .",
      },
      {
        wave: "triangle",
        vol: 0.18,
        notes:
          "A1 - - - - - - -  - - - - - - - -  F1 - - - - - - -  E1 - - - - - - - " +
          "A1 - - - - - - -  - - - - - - - -  D1 - - - - - - -  E1 - - - - - - -",
      },
      {
        wave: "triangle",
        vol: 0.025,
        notes:
          ". . . . . . . .  . . A5 . . . . .  . . . . . . . .  . . . . . E5 . . " +
          ". . . . . . . .  . . . . D5 . . .  . . . . . . . .  . . . . . . C5 .",
      },
    ],
  },
  // Slower, Phrygian, with a pulsing fifth: the tomb proper.
  tomb: {
    bpm: 52,
    stepsPerBeat: 2,
    tracks: [
      {
        wave: "square",
        vol: 0.04,
        notes:
          "E3 F3 E3 . . . B3 -  . . C4 B3 . . . .  A3 - G3 - F3 - E3 -  . . . . . . . . " +
          "E3 F3 E3 . . . B3 -  . . C4 D4 . . . .  E4 - D4 - C4 - B3 -  - - - - . . . .",
      },
      {
        wave: "triangle",
        vol: 0.17,
        notes:
          "E2 - - - B2 - - -  E2 - - - B2 - - -  C2 - - - G2 - - -  B1 - - - F#2 - - - " +
          "E2 - - - B2 - - -  E2 - - - B2 - - -  A1 - - - E2 - - -  B1 - - - B2 - - -",
      },
      {
        wave: "noise",
        vol: 0.04,
        notes:
          "x . . . . . . .  . . . . . . . .  . . . . . . . .  . . . . . . . . " +
          "x . . . . . . .  . . . . . . . .  . . . . x . . .  . . . . . . . .",
      },
    ],
  },
};

// ── parsing ────────────────────────────────────────────────────────────────

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI note number for a name like C4, F#3, Bb2. Returns undefined if invalid. */
export function noteToMidi(name: string): number | undefined {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return undefined;
  let n = SEMI[m[1]];
  if (m[2] === "#") n += 1;
  if (m[2] === "b") n -= 1;
  return n + (parseInt(m[3], 10) + 1) * 12;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface NoteEvent {
  /** Step index the note starts on. */
  start: number;
  /** Length in steps (sustains extend it). */
  len: number;
  /** MIDI note, or -1 for a noise tick. */
  midi: number;
}

/** Split a track string into tokens. */
export function trackTokens(notes: string): string[] {
  return notes.trim().split(/\s+/).filter(Boolean);
}

/** Turn a track string into note events. Throws on an unknown token. */
export function parseTrack(notes: string): NoteEvent[] {
  const out: NoteEvent[] = [];
  const toks = trackTokens(notes);
  toks.forEach((tok, i) => {
    if (tok === ".") return;
    if (tok === "-") {
      const last = out[out.length - 1];
      if (last && last.start + last.len === i) last.len += 1;
      return;
    }
    if (tok === "x") {
      out.push({ start: i, len: 1, midi: -1 });
      return;
    }
    const midi = noteToMidi(tok);
    if (midi === undefined) throw new Error(`bad note token "${tok}"`);
    out.push({ start: i, len: 1, midi });
  });
  return out;
}

/** Number of steps in a bed (all tracks must agree). */
export function bedLength(bed: MusicBedDef): number {
  return trackTokens(bed.tracks[0].notes).length;
}
