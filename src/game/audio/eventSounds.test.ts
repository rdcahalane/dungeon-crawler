import { describe, expect, it } from "vitest";
import { SFX_KEYS } from "./sfxData";
import { GAME_EVENT_NAMES } from "../GameEvents";
import {
  EVENT_SFX,
  MECH_SFX_ALIASES,
  TRAP_FALLBACK,
  TRAP_SFX,
  allMappedSfxKeys,
  bedForFloor,
  hitSfx,
  mechSfx,
  trapSfx,
} from "./eventSounds";
import { MUSIC_BEDS } from "./sfxData";

const KEYS = SFX_KEYS as readonly string[];

describe("event to sound map", () => {
  it("only references keys in SFX_KEYS", () => {
    for (const k of allMappedSfxKeys()) expect(KEYS, `${k} is not an SFX key`).toContain(k);
    for (const [ev, k] of Object.entries(EVENT_SFX)) expect(KEYS, `${ev} -> ${k}`).toContain(k);
    for (const [t, k] of Object.entries(TRAP_SFX)) expect(KEYS, `${t} -> ${k}`).toContain(k);
    for (const [a, k] of Object.entries(MECH_SFX_ALIASES)) expect(KEYS, `${a} -> ${k}`).toContain(k);
    expect(KEYS).toContain(TRAP_FALLBACK);
  });

  it("maps real bus events, and the spec'd ones are all covered", () => {
    const known = new Set<string>([...GAME_EVENT_NAMES, "torch_out", "mech_sfx"]);
    for (const ev of Object.keys(EVENT_SFX)) expect(known.has(ev), `${ev} is not a bus event`).toBe(true);
    for (const ev of [
      "player_swing", "player_miss", "player_hurt", "enemy_death", "item_pickup", "gold", "chest_open",
      "door_secret_found", "spell_cast", "spell_fizzle", "heal", "level_up", "ui_open", "ui_close", "torch_out",
    ]) {
      expect(EVENT_SFX[ev], ev).toBeDefined();
    }
  });

  it("resolves hits, traps and mechanism names", () => {
    expect(hitSfx(false)).toBe("hit");
    expect(hitSfx(true)).toBe("crit");
    expect(trapSfx("dart")).toBe("trap_dart");
    expect(trapSfx("PIT")).toBe("trap_pit");
    expect(trapSfx("gas")).toBe("trap_gas");
    expect(trapSfx("crush")).toBe("crush");
    expect(trapSfx("mystery")).toBe("trap_dart");
    expect(mechSfx("lever")).toBe("lever");
    expect(mechSfx("riddle_wrong")).toBe("riddle_wrong");
    expect(mechSfx("portcullis")).toBe("door");
    expect(mechSfx("no_such_sound")).toBeNull();
  });

  it("picks the dungeon bed above floor 13 and the tomb from 13", () => {
    expect(bedForFloor(1)).toBe("dungeon");
    expect(bedForFloor(12)).toBe("dungeon");
    expect(bedForFloor(13)).toBe("tomb");
    expect(MUSIC_BEDS).toContain(bedForFloor(1));
    expect(MUSIC_BEDS).toContain(bedForFloor(14));
  });
});
