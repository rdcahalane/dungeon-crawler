/**
 * Best-effort guard: every texture key the game code names must exist in
 * RETRO_TEXTURE_KEYS, because PreloadScene no longer draws anything else.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { RETRO_TEXTURE_KEYS, THEME_COUNT } from "./keys";

const GAME_DIR = resolve(__dirname, "..");
const KEYS = new Set(RETRO_TEXTURE_KEYS);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Template keys the code builds at runtime, and every value they can take. */
const DYNAMIC: Record<string, string[]> = {
  "floor_": Array.from({ length: THEME_COUNT }, (_, i) => `floor_${i}`),
  "wall_": Array.from({ length: THEME_COUNT }, (_, i) => `wall_${i}`),
  "player_": ["fighter", "thief", "wizard", "cleric"].map((c) => `player_${c}`),
  // LootController: item_${spawn.type.toLowerCase()} for the legacy floor item types
  "item_": ["health_potion", "weapon", "armor", "xp_orb", "gold", "scroll", "stat_tome"].map((t) => `item_${t}`),
};

const CALL_PATTERNS: RegExp[] = [
  /(?:add\.(?:sprite|image|tileSprite)|physics\.add\.(?:sprite|image))\(\s*[^,]+,\s*[^,]+,\s*(["'`])([^"'`]+)\1/g,
  /setTexture\(\s*(["'`])([^"'`]+)\1/g,
  /\b(?:textureKey|texture|iconKey|icon):\s*(["'`])([^"'`]+)\1/g,
  // mechanism views name their texture with a bare literal
  /(["'])(mech_(?!sfx)[a-z0-9_]+)\1/g,
];

interface Found {
  key: string;
  file: string;
}

function collect(): Found[] {
  const found: Found[] = [];
  for (const file of walk(GAME_DIR)) {
    const rel = relative(GAME_DIR, file);
    // The retro set itself and the gallery enumerate keys on purpose.
    if (rel.startsWith("gfx/")) continue;
    const src = readFileSync(file, "utf8");
    for (const re of CALL_PATTERNS) {
      for (const m of src.matchAll(re)) {
        // Skip glyph-style values such as relic icon letters ("P"); real keys are lower snake case.
        if (/^[a-z][a-z0-9_${}.()]*$/.test(m[2])) found.push({ key: m[2], file: rel });
      }
    }
  }
  return found;
}

describe("texture key coverage", () => {
  const found = collect();

  it("finds a meaningful number of texture usages", () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it("every literal texture key used in src/game is in RETRO_TEXTURE_KEYS", () => {
    const missing = found
      .filter((f) => !f.key.includes("${"))
      .filter((f) => !KEYS.has(f.key))
      .map((f) => `${f.key} (${f.file})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("every template texture key expands only to keys in RETRO_TEXTURE_KEYS", () => {
    const templates = found.filter((f) => f.key.includes("${"));
    for (const t of templates) {
      const prefix = t.key.slice(0, t.key.indexOf("${"));
      const expansions = DYNAMIC[prefix];
      expect(expansions, `unlisted dynamic texture key ${t.key} in ${t.file}: add it to DYNAMIC`).toBeDefined();
    }
    for (const expansions of Object.values(DYNAMIC)) {
      for (const k of expansions) expect(KEYS.has(k), `${k} missing from RETRO_TEXTURE_KEYS`).toBe(true);
    }
  });

  it("bestiary and constants enemy textures are all drawn", () => {
    const enemies = found.filter((f) => f.key.startsWith("enemy"));
    expect(enemies.length).toBeGreaterThan(10);
    for (const e of enemies) expect(KEYS.has(e.key), `${e.key} (${e.file})`).toBe(true);
  });
});
