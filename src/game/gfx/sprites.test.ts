import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PALETTE, PALETTE_CHARS, isPaletteChar } from "./palette";
import { SIX_COLOR_KEYS, SPRITES } from "./sprites";
import {
  CREATURE_KEYS,
  ITEM_KEYS,
  LEGACY_TEXTURE_KEYS,
  LEGACY_TEXTURE_SIZES,
  MECH_KEYS,
  NEW_ENEMY_KEYS,
  RETRO_TEXTURE_KEYS,
  THEME_COUNT,
} from "./keys";
import { colorsUsed } from "./spriteTools";
import { FLOOR_THEMES } from "../constants";

const entries = Object.entries(SPRITES);

describe("palette", () => {
  it("has at most 32 unique colours and single-char keys", () => {
    expect(PALETTE_CHARS.length).toBeLessThanOrEqual(32);
    const hexes = new Set(PALETTE_CHARS.map((c) => PALETTE[c].hex));
    expect(hexes.size).toBe(PALETTE_CHARS.length);
    for (const c of PALETTE_CHARS) expect(c).toHaveLength(1);
    expect(isPaletteChar(".")).toBe(false);
  });
});

describe("sprite maps", () => {
  it("are rectangular and match their declared grid", () => {
    for (const [key, s] of entries) {
      expect(s.rows.length, `${key} height`).toBe(s.h);
      for (const r of s.rows) expect(r.length, `${key} width`).toBe(s.w);
    }
  });

  it("use only palette characters and '.'", () => {
    for (const [key, s] of entries) {
      for (const r of s.rows) {
        for (const c of r) expect(c === "." || isPaletteChar(c), `${key} has bad char ${c}`).toBe(true);
      }
    }
  });

  it("stay inside their colour budget (4; 6 for player classes and the final boss)", () => {
    for (const [key, s] of entries) {
      const n = colorsUsed(s.rows).length;
      expect(n, `${key} uses ${n} colours`).toBeGreaterThanOrEqual(1);
      expect(n, `${key} uses ${n} colours`).toBeLessThanOrEqual(s.maxColors);
      const base = key.replace(/_f2$/, "");
      expect(s.maxColors).toBe(SIX_COLOR_KEYS.includes(base) ? 6 : 4);
    }
  });

  it("only the player classes and hollow king may exceed four colours", () => {
    for (const [key, s] of entries) {
      if (colorsUsed(s.rows).length > 4) expect(SIX_COLOR_KEYS).toContain(key.replace(/_f2$/, ""));
    }
  });

  it("are not blank", () => {
    for (const [key, s] of entries) {
      expect(s.rows.some((r) => /[^.]/.test(r)), `${key} is empty`).toBe(true);
    }
  });
});

describe("texture coverage", () => {
  it("defines every legacy, mech, item and new enemy key", () => {
    for (const k of [...LEGACY_TEXTURE_KEYS, ...MECH_KEYS, ...ITEM_KEYS, ...NEW_ENEMY_KEYS]) {
      expect(SPRITES[k], `missing sprite ${k}`).toBeDefined();
    }
  });

  it("has a sprite for every registered key and no stray sprites", () => {
    expect(new Set(Object.keys(SPRITES))).toEqual(new Set(RETRO_TEXTURE_KEYS));
  });

  it("matches the legacy pixel sizes exactly", () => {
    for (const k of LEGACY_TEXTURE_KEYS) {
      const s = SPRITES[k];
      const want = LEGACY_TEXTURE_SIZES[k];
      expect(s.w * s.scale, `${k} width`).toBe(want.w);
      expect(s.h * s.scale, `${k} height`).toBe(want.h);
    }
  });

  it("uses 16x16 grids at 2x for 32px tile textures", () => {
    for (const k of [...MECH_KEYS, ...ITEM_KEYS, ...NEW_ENEMY_KEYS]) {
      expect([SPRITES[k].w, SPRITES[k].h, SPRITES[k].scale]).toEqual([16, 16, 2]);
    }
  });

  it("legacy list equals what PreloadScene.ts actually generates", () => {
    const src = readFileSync(resolve(__dirname, "../scenes/PreloadScene.ts"), "utf8");
    const found = new Set<string>();
    for (const m of src.matchAll(/generateTexture\(\s*"([a-z0-9_]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/makeChest\([^)]*"([a-z0-9_]+)"\)/g)) found.add(m[1]);
    expect(src).toContain("floor_${idx}");
    expect(src).toContain("wall_${idx}");
    for (let i = 0; i < THEME_COUNT; i++) {
      found.add(`floor_${i}`);
      found.add(`wall_${i}`);
    }
    expect(FLOOR_THEMES.length).toBe(THEME_COUNT);
    expect(new Set(LEGACY_TEXTURE_KEYS)).toEqual(found);
  });

  it("gives every creature a distinct second walk frame", () => {
    for (const k of CREATURE_KEYS) {
      const a = SPRITES[k];
      const b = SPRITES[`${k}_f2`];
      expect(b, `${k}_f2 missing`).toBeDefined();
      expect(b.rows.join("|"), `${k}_f2 identical to ${k}`).not.toBe(a.rows.join("|"));
    }
  });

  it("themed floor and wall tiles differ per theme", () => {
    const floors = new Set<string>();
    const walls = new Set<string>();
    for (let i = 0; i < THEME_COUNT; i++) {
      floors.add(SPRITES[`floor_${i}`].rows.join(""));
      walls.add(SPRITES[`wall_${i}`].rows.join(""));
    }
    // dungeon theme (2) intentionally reuses the classic palette; the other three are unique
    expect(floors.size).toBeGreaterThanOrEqual(THEME_COUNT - 1);
    expect(walls.size).toBeGreaterThanOrEqual(THEME_COUNT - 1);
  });

  it("includes all contract keys by name", () => {
    const need = [
      "mech_plate", "mech_plate_down", "mech_lever_off", "mech_lever_on", "mech_pit_open", "mech_pit_spikes",
      "mech_portcullis", "mech_dart_hole", "mech_gas_vent", "mech_rune_a", "mech_rune_b", "mech_rune_c",
      "mech_rune_d", "mech_rune_e", "mech_rune_f", "mech_statue", "mech_face", "mech_inscription",
      "mech_false_door", "mech_door", "mech_door_open", "mech_teleporter", "mech_lure", "mech_scorch",
      "mech_stain", "mech_bones",
      "item_sword", "item_axe", "item_mace", "item_dagger", "item_staff", "item_bow", "item_shield",
      "item_armor", "item_helm", "item_cloak", "item_boots", "item_ring", "item_amulet", "item_potion_red",
      "item_potion_blue", "item_scroll", "item_torch", "item_pole", "item_rope", "item_spikes",
      "item_holy_water", "item_tools", "item_ration", "item_gem", "item_key",
      "enemy_ghoul", "enemy_wight", "enemy_wraith", "enemy_gargoyle", "enemy_ooze", "enemy_cultist",
      "enemy_bone_knight", "enemy_giant_bat", "enemy_hollow_king",
    ];
    for (const k of need) expect(SPRITES[k], k).toBeDefined();
  });
});
