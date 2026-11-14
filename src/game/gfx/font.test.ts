import { describe, expect, it } from "vitest";
import {
  CELL_H,
  CELL_W,
  CHARS_PER_ROW,
  FONT_CHARS,
  FONT_FIRST,
  FONT_LAST,
  fontAtlasPixels,
  fontAtlasSize,
  glyphRows,
  hasGlyph,
} from "./fontGlyphs";

describe("5x7 font", () => {
  it("covers ASCII 32 to 126", () => {
    expect(FONT_CHARS.length).toBe(FONT_LAST - FONT_FIRST + 1);
    for (const ch of FONT_CHARS) expect(hasGlyph(ch), `glyph for "${ch}"`).toBe(true);
  });

  it("has 7 rows of 5 bits per glyph", () => {
    for (const ch of FONT_CHARS) {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(7);
      for (const r of rows) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(32);
      }
    }
  });

  it("draws visible glyphs, blank space, and distinct letters", () => {
    expect(glyphRows(" ").every((r) => r === 0)).toBe(true);
    for (const ch of FONT_CHARS.slice(1)) expect(glyphRows(ch).some((r) => r !== 0), ch).toBe(true);
    const seen = new Map<string, string>();
    for (const ch of FONT_CHARS) {
      const sig = glyphRows(ch).join(",");
      expect(seen.get(sig), `"${ch}" duplicates "${seen.get(sig)}"`).toBeUndefined();
      seen.set(sig, ch);
    }
  });

  it("lays out an atlas that fits every glyph cell", () => {
    const { w, h } = fontAtlasSize();
    expect(w).toBe(CHARS_PER_ROW * CELL_W);
    expect(h).toBeGreaterThanOrEqual(Math.ceil(FONT_CHARS.length / CHARS_PER_ROW) * CELL_H);
    for (const [x, y] of fontAtlasPixels()) {
      expect(x).toBeLessThan(w);
      expect(y).toBeLessThan(h);
    }
  });
});
