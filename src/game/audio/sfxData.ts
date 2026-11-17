/**
 * Data for the synth: sound effect recipes and music bed note sequences.
 * Pure data and parsing; no WebAudio and no Phaser, so tests can import it.
 */

import { BED_NAMES, MUSIC, type MusicBed } from "./musicData";

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
  "splash",
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

/** Every music bed name (the gallery builds one button per entry). */
export const MUSIC_BEDS = BED_NAMES;
export { MUSIC };
export type { MusicBed };
export type { BedDef, SectionDef, TrackDef } from "./musicData";

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
  step: [nz("lowpass", 420, 160, 0.06, 0.1), tri(95, 60, 0.05, 0.08)],
  // a slap of water, then the wash running off it
  splash: [nz("bandpass", 1800, 500, 0.16, 0.16), nz("lowpass", 900, 200, 0.22, 0.1)],
  swing: [nz("bandpass", 700, 2600, 0.16, 0.13)],
  hit: [nz("lowpass", 2000, 260, 0.13, 0.26), tri(190, 60, 0.11, 0.24)],
  miss: [nz("highpass", 3200, 5200, 0.08, 0.06), tri(640, 300, 0.09, 0.06)],
  crit: [
    nz("lowpass", 3000, 200, 0.16, 0.32),
    sq(160, 50, 0.14, 0.2),
    tri(880, 1760, 0.09, 0.14, 0.02),
    tri(1320, undefined, 0.14, 0.12, 0.09),
  ],
  hurt: [tri(300, 90, 0.24, 0.26), sq(300, 90, 0.18, 0.06), nz("lowpass", 1400, 200, 0.16, 0.18)],
  death: [
    sq(440, 55, 0.85, 0.3),
    tri(220, 40, 1.0, 0.3),
    nz("lowpass", 900, 100, 0.75, 0.22, 0.05),
  ],
  monster_die: [sq(280, 50, 0.38, 0.16), nz("lowpass", 1600, 140, 0.32, 0.26), tri(140, 40, 0.4, 0.2)],
  pickup: [tri(660, undefined, 0.07, 0.16), tri(990, undefined, 0.12, 0.16, 0.06)],
  gold: [tri(1320, undefined, 0.05, 0.12), tri(1760, undefined, 0.09, 0.1, 0.05), sq(1760, undefined, 0.05, 0.03, 0.05)],
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
  spell_fizzle: [sq(520, 110, 0.26, 0.11), nz("highpass", 3000, 1000, 0.2, 0.12)],
  heal: arp([523, 659, 784, 1047, 1319], 0.08, 0.2, "triangle"),
  level_up: [
    ...arp([523, 659, 784, 1047], 0.1, 0.18),
    sq(1319, undefined, 0.35, 0.18, 0.4),
    tri(262, undefined, 0.7, 0.25, 0.4),
  ],
  ui_move: [tri(880, undefined, 0.035, 0.06)],
  ui_select: [tri(660, 990, 0.09, 0.12)],
  ui_back: [tri(520, 330, 0.09, 0.1)],
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
  /** MIDI note, or -1 hat, -2 kick, -3 snare for noise tracks. */
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
    if (tok === "x" || tok === "k" || tok === "s") {
      out.push({ start: i, len: 1, midi: tok === "x" ? -1 : tok === "k" ? -2 : -3 });
      return;
    }
    const midi = noteToMidi(tok);
    if (midi === undefined) throw new Error(`bad note token "${tok}"`);
    out.push({ start: i, len: 1, midi });
  });
  return out;
}

