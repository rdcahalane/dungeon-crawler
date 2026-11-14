import { describe, expect, it } from "vitest";
import {
  EFFECTS,
  MUSIC,
  MUSIC_BEDS,
  SFX_KEYS,
  bedLength,
  midiToHz,
  noteToMidi,
  parseTrack,
  trackTokens,
} from "./sfxData";
import { Sfx, SFX_KEYS as EXPORTED_KEYS } from "./Sfx";

const REQUIRED = [
  "step", "swing", "hit", "miss", "crit", "hurt", "death", "monster_die", "pickup", "gold", "door", "secret",
  "lever", "plate", "trap_dart", "trap_pit", "trap_gas", "crush", "spell_cast", "spell_fizzle", "heal",
  "level_up", "ui_move", "ui_select", "ui_back", "torch_out", "riddle_right", "riddle_wrong", "boss_roar",
  "game_over", "victory",
];

describe("sfx keys and recipes", () => {
  it("SFX_KEYS contains every required effect", () => {
    for (const k of REQUIRED) expect(SFX_KEYS as readonly string[]).toContain(k);
    expect(EXPORTED_KEYS).toBe(SFX_KEYS);
    expect(new Set(SFX_KEYS).size).toBe(SFX_KEYS.length);
  });

  it("every effect has sane voices", () => {
    for (const k of SFX_KEYS) {
      const voices = EFFECTS[k];
      expect(voices.length, k).toBeGreaterThan(0);
      for (const v of voices) {
        expect(["square", "triangle", "saw", "noise"]).toContain(v.wave);
        expect(v.f0).toBeGreaterThan(0);
        if (v.f1 !== undefined) expect(v.f1).toBeGreaterThan(0);
        expect(v.dur).toBeGreaterThan(0);
        expect(v.dur).toBeLessThan(3);
        expect(v.vol).toBeGreaterThan(0);
        expect(v.vol).toBeLessThanOrEqual(1);
        expect(v.delay ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("uses all three voice types across the set", () => {
    const waves = new Set(SFX_KEYS.flatMap((k) => EFFECTS[k].map((v) => v.wave)));
    expect(waves.has("square")).toBe(true);
    expect(waves.has("triangle")).toBe(true);
    expect(waves.has("noise")).toBe(true);
  });
});

describe("music beds", () => {
  it("has tavern, dungeon and tomb", () => {
    expect([...MUSIC_BEDS].sort()).toEqual(["dungeon", "tavern", "tomb"]);
  });

  it("parses, with equal-length tracks and valid notes", () => {
    for (const bed of MUSIC_BEDS) {
      const def = MUSIC[bed];
      const len = bedLength(def);
      expect(len, bed).toBeGreaterThanOrEqual(32);
      for (const t of def.tracks) {
        expect(trackTokens(t.notes).length, `${bed} track length`).toBe(len);
        const events = parseTrack(t.notes);
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) {
          expect(e.start + e.len).toBeLessThanOrEqual(len);
          if (t.wave !== "noise") expect(e.midi).toBeGreaterThan(0);
        }
      }
    }
  });

  it("converts note names to pitch", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("F#3")).toBe(54);
    expect(noteToMidi("Bb2")).toBe(46);
    expect(noteToMidi("H9")).toBeUndefined();
    expect(midiToHz(69)).toBeCloseTo(440, 5);
    expect(() => parseTrack("C4 zz")).toThrow();
  });
});

describe("Sfx engine without WebAudio", () => {
  it("is a safe no-op when AudioContext is missing", () => {
    expect(Sfx.isSupported()).toBe(false);
    expect(() => {
      Sfx.play("hit");
      Sfx.play("not_a_sound");
      Sfx.music("dungeon");
      Sfx.setVolume(0.3);
      Sfx.setVolume(Number.NaN);
      Sfx.mute(true);
      Sfx.mute(false);
      Sfx.unlock();
      Sfx.music(null);
    }).not.toThrow();
    expect(Sfx.getVolume()).toBe(0);
    Sfx.setVolume(0.5);
    expect(Sfx.getVolume()).toBe(0.5);
  });
});
