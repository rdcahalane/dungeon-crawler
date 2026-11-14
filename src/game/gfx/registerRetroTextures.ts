/**
 * Draws every ASCII sprite map to a Phaser canvas texture (nearest neighbour,
 * integer scale). Same keys and pixel sizes as PreloadScene, plus the new
 * mech_*, item_* and enemy_* keys, so swapping it in later is drop-in.
 */
import * as Phaser from "phaser";
import { paletteCss } from "./palette";
import { SPRITES } from "./sprites";
import { RETRO_TEXTURE_KEYS } from "./keys";

export { LEGACY_TEXTURE_KEYS, LEGACY_TEXTURE_SIZES, RETRO_TEXTURE_KEYS } from "./keys";

export interface RegisterRetroOptions {
  /** Replace textures that already exist (default false: existing keys are left alone). */
  overwrite?: boolean;
}

/** Draw one sprite definition to a canvas texture. Returns true if a texture was created. */
export function drawRetroTexture(scene: Phaser.Scene, key: string, overwrite = false): boolean {
  const def = SPRITES[key];
  if (!def) return false;
  const tm = scene.textures;
  if (tm.exists(key)) {
    if (!overwrite) return false;
    tm.remove(key);
  }
  const W = def.w * def.scale;
  const H = def.h * def.scale;
  const tex = tm.createCanvas(key, W, H);
  if (!tex) return false;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  for (let y = 0; y < def.rows.length; y++) {
    const row = def.rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      ctx.globalAlpha = def.alpha?.[ch] ?? 1;
      ctx.fillStyle = paletteCss(ch);
      ctx.fillRect(x * def.scale, y * def.scale, def.scale, def.scale);
    }
  }
  ctx.globalAlpha = 1;
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return true;
}

/** Register every retro texture on the scene's texture manager. Returns the keys it created. */
export function registerRetroTextures(scene: Phaser.Scene, opts: RegisterRetroOptions = {}): string[] {
  const created: string[] = [];
  for (const key of RETRO_TEXTURE_KEYS) {
    if (drawRetroTexture(scene, key, opts.overwrite === true)) created.push(key);
  }
  return created;
}
