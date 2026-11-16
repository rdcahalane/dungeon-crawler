/**
 * One shared 32-colour palette with an Atari 8-bit feel: strong saturated hues
 * plus a dark ramp. Sprite maps reference colours by a single character.
 * '.' is transparent. '0'..'9' and 'a'..'v' are the 32 colours.
 * Phaser-free so tests and tooling can import it.
 */

export const TRANSPARENT = ".";

export interface PaletteEntry {
  /** Hex colour as 0xRRGGBB. */
  readonly hex: number;
  /** Short human name, used by the gallery. */
  readonly name: string;
}

export const PALETTE: Readonly<Record<string, PaletteEntry>> = {
  "0": { hex: 0x000000, name: "black" },
  "1": { hex: 0x12101a, name: "ink" },
  "2": { hex: 0x2a2536, name: "dusk" },
  "3": { hex: 0x4a4560, name: "slate" },
  "4": { hex: 0x7d7890, name: "grey" },
  "5": { hex: 0xb8b4c8, name: "silver" },
  "6": { hex: 0xf4f0f8, name: "white" },
  "7": { hex: 0x8a1a20, name: "blood" },
  "8": { hex: 0xd8382c, name: "red" },
  "9": { hex: 0xee7a24, name: "orange" },
  a: { hex: 0xf4c42c, name: "gold" },
  b: { hex: 0xfff08c, name: "cream" },
  c: { hex: 0x4a2a18, name: "umber" },
  d: { hex: 0x7c4824, name: "brown" },
  e: { hex: 0xc08040, name: "tan" },
  f: { hex: 0x1c4a28, name: "pine" },
  g: { hex: 0x30903c, name: "green" },
  h: { hex: 0x90d44c, name: "lime" },
  i: { hex: 0x14285a, name: "navy" },
  j: { hex: 0x2a5cd0, name: "blue" },
  k: { hex: 0x4cacf4, name: "sky" },
  l: { hex: 0x94e8f4, name: "ice" },
  m: { hex: 0x3c1a60, name: "plum" },
  n: { hex: 0x8c3cc8, name: "violet" },
  o: { hex: 0xd47cec, name: "orchid" },
  p: { hex: 0x1c6c70, name: "teal" },
  q: { hex: 0xeaaa7c, name: "skin" },
  r: { hex: 0xb8704c, name: "clay" },
  s: { hex: 0xf08cb4, name: "rose" },
  t: { hex: 0x7a8a48, name: "rot" },
  u: { hex: 0xa8421c, name: "rust" },
  v: { hex: 0xe8dcb4, name: "bone" },
};

/** All colour characters in palette order (32 entries). */
export const PALETTE_CHARS: readonly string[] = Object.keys(PALETTE);

/** True when ch is a palette colour (not transparent). */
export function isPaletteChar(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(PALETTE, ch);
}

/** Hex colour for a palette char, or undefined for transparent/unknown. */
export function paletteHex(ch: string): number | undefined {
  return isPaletteChar(ch) ? PALETTE[ch].hex : undefined;
}

/** CSS colour string "#rrggbb" for a palette char. */
export function paletteCss(ch: string): string {
  const hex = paletteHex(ch);
  if (hex === undefined) return "rgba(0,0,0,0)";
  return "#" + hex.toString(16).padStart(6, "0");
}
