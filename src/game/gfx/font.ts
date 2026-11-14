/**
 * Generated 5x7 pixel font registered as the Phaser bitmap font `retro`.
 * Glyph data lives in fontGlyphs.ts. Sizes are multiples of 8 (8, 16, 24...)
 * so every glyph pixel lands on whole screen pixels.
 */
import * as Phaser from "phaser";
import { CELL_H, CELL_W, CHARS_PER_ROW, FONT_CHARS, fontAtlasPixels, fontAtlasSize } from "./fontGlyphs";

export const RETRO_FONT_KEY = "retro";
const ATLAS_KEY = "retro_font_atlas";

/** Create the atlas texture and the `retro` bitmap font on the scene (idempotent). */
export function registerRetroFont(scene: Phaser.Scene): boolean {
  if (scene.cache.bitmapFont.exists(RETRO_FONT_KEY)) return true;
  const { w, h } = fontAtlasSize();
  if (!scene.textures.exists(ATLAS_KEY)) {
    const tex = scene.textures.createCanvas(ATLAS_KEY, w, h);
    if (!tex) return false;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    for (const [x, y] of fontAtlasPixels()) ctx.fillRect(x, y, 1, 1);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: ATLAS_KEY,
    width: CELL_W,
    height: CELL_H,
    chars: FONT_CHARS,
    charsPerRow: CHARS_PER_ROW,
    "offset.x": 0,
    "offset.y": 0,
    "spacing.x": 0,
    "spacing.y": 0,
    lineSpacing: 0,
  });
  scene.cache.bitmapFont.add(RETRO_FONT_KEY, entry);
  return true;
}

export interface RetroTextOptions {
  /** Glyph cell height in pixels; multiples of 8 stay crisp. Default 16. */
  size?: number;
  /** Tint as 0xRRGGBB or "#rrggbb". Default white. */
  color?: number | string;
  /** Origin x/y (0..1). Default top-left. */
  originX?: number;
  originY?: number;
}

function toTint(color: number | string | undefined): number {
  if (typeof color === "number") return color;
  if (typeof color === "string") {
    const n = parseInt(color.replace("#", ""), 16);
    if (!Number.isNaN(n)) return n;
  }
  return 0xffffff;
}

/** Add text in the retro font. Registers the font on first use. */
export function retroText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: RetroTextOptions = {},
): Phaser.GameObjects.BitmapText {
  registerRetroFont(scene);
  const size = opts.size ?? 16;
  // RetroFont reports its size as the cell width, so scale = fontSize / CELL_W.
  const fontSize = (size / CELL_H) * CELL_W;
  const bt = scene.add.bitmapText(x, y, RETRO_FONT_KEY, text, fontSize);
  bt.setTint(toTint(opts.color));
  bt.setOrigin(opts.originX ?? 0, opts.originY ?? 0);
  return bt;
}
