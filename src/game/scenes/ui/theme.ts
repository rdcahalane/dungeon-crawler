/** Atari-skin helpers for the HUD: palette colours, retro text, chunky boxes. */
import * as Phaser from "phaser";
import { paletteHex } from "../../gfx/palette";
import { retroText } from "../../gfx/font";

const P = (ch: string, fallback: number): number => paletteHex(ch) ?? fallback;

export const UI = {
  black: P("0", 0x000000), ink: P("1", 0x12101a), dusk: P("2", 0x2a2536), slate: P("3", 0x4a4560),
  grey: P("4", 0x7d7890), silver: P("5", 0xb8b4c8), white: P("6", 0xf4f0f8),
  blood: P("7", 0x8a1a20), red: P("8", 0xd8382c), orange: P("9", 0xee7a24),
  gold: P("a", 0xf4c42c), cream: P("b", 0xfff08c), green: P("g", 0x30903c), lime: P("h", 0x90d44c),
  blue: P("j", 0x2a5cd0), sky: P("k", 0x4cacf4), ice: P("l", 0x94e8f4), violet: P("n", 0x8c3cc8),
  teal: P("p", 0x1c6c70),
} as const;

export const SCREEN_W = 960;
export const SCREEN_H = 640;

/** Body text is 16px (a 12px-wide glyph) everywhere in the HUD; 8px text was too small to read. */
export const TEXT = 16;
/** Pixel width of one glyph at the body size. */
export const GLYPH_W = 12;
/** Line pitch for stacked 16px text. */
export const LINE = 18;

/** The bitmap font covers ASCII 32 to 126 only. Anything else becomes `?`. */
export function ascii(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    out += c >= 32 && c <= 126 ? ch : c === 0x2212 || c === 0x2013 || c === 0x2014 ? "-" : c === 10 ? "\n" : "?";
  }
  return out;
}

export interface LabelOpts {
  size?: number;
  color?: number;
  ox?: number;
  oy?: number;
  depth?: number;
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, o: LabelOpts = {}): Phaser.GameObjects.BitmapText {
  const t = retroText(scene, Math.round(x), Math.round(y), ascii(text), {
    size: o.size ?? TEXT, color: o.color ?? UI.silver, originX: o.ox ?? 0, originY: o.oy ?? 0,
  });
  if (o.depth !== undefined) t.setDepth(o.depth);
  return t;
}

/** setText only when the string changed (bitmap text rebuilds its glyph list on every call). */
export function setLabel(t: Phaser.GameObjects.BitmapText, text: string, color?: number): void {
  const s = ascii(text);
  if (t.text !== s) t.setText(s);
  if (color !== undefined && t.tintTopLeft !== color) t.setTint(color);
}

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Wrap on spaces to `cols` characters a line. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of ascii(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > cols) { out.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** A flat box with a 2px border and a 1px inner highlight. No gradients, no alpha edges. */
export function drawBox(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  fill: number = UI.ink, border: number = UI.slate, highlight: number | null = UI.dusk,
): void {
  g.fillStyle(border, 1).fillRect(x, y, w, h);
  g.fillStyle(fill, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
  if (highlight !== null) g.fillStyle(highlight, 1).fillRect(x + 2, y + 2, w - 4, 1).fillRect(x + 2, y + 2, 1, h - 4);
}

export function pointIn(r: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

/** Draw an item icon (32x32 texture) at a slot, or a flat placeholder square when the texture is missing. */
export function iconAt(
  scene: Phaser.Scene, key: string | undefined, cx: number, cy: number, size = 32,
): Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle {
  if (key && scene.textures.exists(key)) {
    return scene.add.image(Math.round(cx), Math.round(cy), key).setDisplaySize(size, size);
  }
  return scene.add.rectangle(Math.round(cx), Math.round(cy), size - 8, size - 8, UI.grey).setStrokeStyle(2, UI.slate);
}
