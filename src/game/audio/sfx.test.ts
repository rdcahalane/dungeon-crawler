import { describe, expect, it } from "vitest";
import {
  EFFECTS,
  MUSIC,
  MUSIC_BEDS,
  SFX_KEYS,
  midiToHz,
  noteToMidi,
  parseTrack,
} from "./sfxData";
import { Sfx, SFX_KEYS as EXPORTED_KEYS } from "./Sfx";
import { BedPlanner, barLengths, flatTokens, loopSeconds, parseSectionTrack, planOrder, sectionSteps } from "./musicPlan";

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
  it("has every bed the game asks for", () => {
    expect([...MUSIC_BEDS].sort()).toEqual(
      ["boss", "combat", "dungeon", "dungeon_deep", "dungeon_mid", "tavern", "title", "tomb"].sort(),
    );
    for (const bed of MUSIC_BEDS) expect(MUSIC[bed], bed).toBeDefined();
  });

  it("parses, with every bar the length of its time signature", () => {
    for (const bed of MUSIC_BEDS) {
      const def = MUSIC[bed];
      const [num, den] = def.meter;
      expect(def.stepsPerBar, `${bed} stepsPerBar`).toBe((num * def.stepsPerBeat * 4) / den);
      const ids = new Set(def.tracks.map((t) => t.id));
      expect(ids.size, `${bed} track ids`).toBe(def.tracks.length);
      expect(def.order.length).toBeGreaterThan(3);
      for (const id of def.order) expect(def.sections[id], `${bed} order names ${id}`).toBeDefined();
      for (const [sid, sec] of Object.entries(def.sections)) {
        const where = `${bed}/${sid}`;
        const lens = new Set<number>();
        for (const src of [sec.tracks, sec.alt ?? {}]) {
          for (const [tid, notes] of Object.entries(src)) {
            expect(ids.has(tid), `${where} unknown track ${tid}`).toBe(true);
            const bars = barLengths(notes);
            bars.forEach((n, i) => expect(n, `${where}/${tid} bar ${i + 1}`).toBe(def.stepsPerBar));
            lens.add(bars.length);
            const track = def.tracks.find((t) => t.id === tid);
            const events = parseSectionTrack(notes);
            const total = flatTokens(notes).length;
            for (const e of events) {
              expect(e.start + e.len).toBeLessThanOrEqual(total);
              if (track?.wave === "noise") expect(e.midi).toBeLessThan(0);
              else expect(e.midi).toBeGreaterThan(0);
            }
          }
        }
        expect(lens.size, `${where} tracks disagree on bars`).toBe(1);
        expect(sectionSteps(def, sec)).toBe([...lens][0] * def.stepsPerBar);
      }
    }
  });

  it("every bed has an A, B, a break and a turnaround of its own", () => {
    for (const bed of MUSIC_BEDS) {
      if (bed === "combat") continue;
      expect(Object.keys(MUSIC[bed].sections).length, bed).toBeGreaterThanOrEqual(4);
    }
  });

  it("long beds run at least 90 seconds before repeating exactly", () => {
    for (const bed of ["title", "tavern", "dungeon", "dungeon_mid", "dungeon_deep", "tomb", "boss"] as const) {
      expect(loopSeconds(MUSIC[bed]), bed).toBeGreaterThanOrEqual(90);
    }
    expect(loopSeconds(MUSIC.combat)).toBeGreaterThanOrEqual(30);
  });

  it("the tavern is a 6/8 jig and a dungeon pulse slows with depth", () => {
    expect(MUSIC.tavern.meter).toEqual([6, 8]);
    expect(MUSIC.dungeon.bpm).toBeGreaterThan(MUSIC.dungeon_mid.bpm);
    expect(MUSIC.dungeon_mid.bpm).toBeGreaterThan(MUSIC.dungeon_deep.bpm);
  });

  it("the tomb has a bell track", () => {
    expect(MUSIC.tomb.tracks.some((t) => t.wave === "bell")).toBe(true);
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
      Sfx.combat(true);
      Sfx.combatPulse();
      Sfx.combat(false);
      Sfx.boss(true);
      Sfx.boss(false);
      Sfx.setMusicSeed(7);
      Sfx.music("tomb");
      Sfx.music(null);
    }).not.toThrow();
    expect(Sfx.getVolume()).toBe(0);
    Sfx.setVolume(0.5);
    expect(Sfx.getVolume()).toBe(0.5);
  });
});

describe("music variation", () => {
  it("plays the same section order for the same seed and a different one for another", () => {
    for (const bed of MUSIC_BEDS) {
      const def = MUSIC[bed];
      expect(planOrder(def, 1234, 40), bed).toEqual(planOrder(def, 1234, 40));
    }
    const def = MUSIC.dungeon;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) seen.add(planOrder(def, seed, 12).join(""));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("plays only written sections, starting with the first of the order", () => {
    for (const bed of MUSIC_BEDS) {
      const def = MUSIC[bed];
      const got = planOrder(def, 99, def.order.length * 3);
      // every written section shows up, and nothing outside the sections does
      for (const id of got) expect(def.sections[id]).toBeDefined();
      expect(new Set(got).size, bed).toBe(new Set(def.order).size);
      expect(got[0]).toBe(def.order[0]);
    }
  });

  it("per-play variation is deterministic and actually varies", () => {
    const def = MUSIC.tavern;
    const dump = (seed: number) => {
      const p = new BedPlanner(def, seed);
      return Array.from({ length: 30 }, () => {
        const s = p.next();
        return `${s.section}:${s.leadShift}:${s.altBass}:${s.fill}`;
      });
    };
    expect(dump(5)).toEqual(dump(5));
    const all = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) dump(seed).forEach((x) => all.add(x));
    expect([...all].some((x) => x.split(":")[1] !== "0")).toBe(true);
    expect([...all].some((x) => x.split(":")[2] === "true")).toBe(true);
    expect([...all].some((x) => x.split(":")[3] === "true")).toBe(true);
  });

  it("the second hearing of a section gets the alternate bass, shifted leads stay in range", () => {
    const def = MUSIC.title;
    const p = new BedPlanner(def, 3);
    const firstA = p.next();
    expect(firstA.section).toBe("A");
    expect(firstA.altBass).toBe(false);
    const segs = [firstA, ...Array.from({ length: 10 }, () => p.next())];
    const secondA = segs.filter((s) => s.section === "A")[1];
    expect(secondA.altBass).toBe(true);
    for (const s of segs) {
      for (const e of s.events[0].values()) {
        if (e.midi > 0) {
          expect(e.midi).toBeGreaterThanOrEqual(36);
          expect(e.midi).toBeLessThanOrEqual(96);
        }
      }
    }
  });
});
