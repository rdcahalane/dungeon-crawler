/**
 * Every retro sprite as an ASCII pixel map. Phaser-free.
 *
 * Standard sprites are 16x16 logical pixels drawn 2x (32x32). Large monsters are 24x24 or 32x32, also drawn 2x.
 * The 16x16 spell glows use an 8x8 grid drawn 2x; the fog brush (320) and torch glow (256) use
 * stepped, dithered grids drawn at 8x. Creatures also get `<key>_f2`.
 */
import { colorsUsed, walkFrame, type Rows, type SpriteDef } from "./spriteTools";
import { WORLD_MAPS } from "./spritesWorld";
import { ACTOR_MAPS } from "./spritesActors";
import { LARGE_MAPS } from "./spritesLarge";
import { GLOW_MAPS, ITEM_MAPS } from "./spritesItems";
import { CREATURE_KEYS, LARGE_ENEMY_KEYS } from "./keys";

export type { SpriteDef } from "./spriteTools";

/** Sprites allowed more than four colours (player classes and the final boss). */
export const SIX_COLOR_KEYS: readonly string[] = [
  "player",
  "player_fighter",
  "player_thief",
  "player_wizard",
  "player_cleric",
  "enemy_hollow_king",
  // Large monsters have room for a sixth colour (outline, two body tones, an accent, eyes, a prop).
  ...LARGE_ENEMY_KEYS,
];

const SPELL_KEYS = ["spell_missile", "spell_fireball", "spell_frost", "spell_blink", "spell_heal"];

/** Walk-frame style per creature; default is a lifted left foot. */
const BOB_KEYS = new Set(["player_wizard", "enemy_ghost", "enemy_wraith", "enemy_cultist", "enemy_ooze", "enemy_ossuary_hulk"]);

function def(key: string, rows: Rows, w = 16, h = 16, scale = 2, alpha?: Record<string, number>): SpriteDef {
  return {
    key,
    w,
    h,
    scale,
    rows,
    alpha,
    maxColors: SIX_COLOR_KEYS.includes(key.replace(/_f2$/, "")) ? 6 : 4,
  };
}

function build(): Record<string, SpriteDef> {
  const out: Record<string, SpriteDef> = {};
  const maps: Record<string, Rows> = { ...WORLD_MAPS, ...ACTOR_MAPS, ...ITEM_MAPS };
  for (const [key, rows] of Object.entries(maps)) {
    if (key.endsWith("_f2")) continue;
    if (SPELL_KEYS.includes(key)) {
      out[key] = def(key, rows, 8, 8, 2);
    } else {
      out[key] = def(key, rows);
    }
  }
  // Large monsters carry their own grid size (24x24 or 32x32), still drawn 2x.
  for (const [key, rows] of Object.entries(LARGE_MAPS)) {
    if (key.endsWith("_f2")) continue;
    out[key] = def(key, rows, rows[0].length, rows.length, 2);
  }
  for (const [key, g] of Object.entries(GLOW_MAPS)) {
    out[key] = def(key, g.rows, g.w, g.h, g.scale, g.alpha);
  }
  for (const key of CREATURE_KEYS) {
    const base = out[key];
    if (!base) continue;
    const explicit = (ACTOR_MAPS as Record<string, Rows | undefined>)[`${key}_f2`];
    const large = base.h > 16;
    const legRows = base.h >= 32 ? 6 : 5;
    const rows = explicit ?? walkFrame(base.rows, BOB_KEYS.has(key) ? "bob" : "legs", large ? legRows : 4);
    out[`${key}_f2`] = large ? def(`${key}_f2`, rows, base.w, base.h, base.scale) : def(`${key}_f2`, rows);
  }
  return out;
}

/** All sprite definitions by texture key. */
export const SPRITES: Readonly<Record<string, SpriteDef>> = build();

export const SPRITE_KEYS: readonly string[] = Object.keys(SPRITES);

export { colorsUsed };
