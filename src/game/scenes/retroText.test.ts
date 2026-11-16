/**
 * The 5x7 bitmap font covers ASCII 32 to 126 only. Best effort: the scene and
 * UI files that draw with the retro font must contain no other characters.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FONT_CHARS, hasGlyph } from "../gfx/fontGlyphs";
import { asciiOnly } from "../gfx/asciiText";

const FILES = [
  "scenes/MainMenuScene.ts",
  "scenes/TavernScene.ts",
  "scenes/GameOverScene.ts",
  "scenes/PreloadScene.ts",
  "gfx/retroUi.ts",
  "scenes/game/AudioController.ts",
  "scenes/game/Juice.ts",
];

describe("retro font text", () => {
  for (const f of FILES) {
    it(`${f} is plain ASCII`, () => {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      const bad: string[] = [];
      src.split("\n").forEach((line, i) => {
        for (const ch of line) {
          const c = ch.codePointAt(0)!;
          if ((c < 32 && c !== 9) || c > 126) bad.push(`line ${i + 1}: U+${c.toString(16).toUpperCase()}`);
        }
      });
      expect(bad).toEqual([]);
    });
  }

  it("the font has a glyph for every printable ASCII character", () => {
    for (const ch of FONT_CHARS) expect(hasGlyph(ch), JSON.stringify(ch)).toBe(true);
  });

  it("asciiOnly folds common punctuation and replaces the rest", () => {
    expect(asciiOnly("a—b")).toBe("a-b");
    expect(asciiOnly("⚔ sword")).toBe("? sword");
    expect(asciiOnly("plain text 123")).toBe("plain text 123");
  });
});
