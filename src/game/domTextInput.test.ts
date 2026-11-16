import { describe, expect, it } from "vitest";
import { cssRectFor, sanitizeText } from "./domTextInput";

describe("sanitizeText", () => {
  it("keeps allowed characters and cuts to length", () => {
    expect(sanitizeText("Grim the Bold!", 16, /[a-zA-Z0-9 '-]/)).toBe("Grim the Bold");
    expect(sanitizeText("abcdefghij", 4)).toBe("abcd");
    expect(sanitizeText("a1b2c3", 16, /[a-z]/)).toBe("abc");
    expect(sanitizeText("", 16)).toBe("");
  });
});

describe("cssRectFor", () => {
  it("maps game pixels to CSS pixels over a scaled canvas", () => {
    const r = cssRectFor({ x: 100, y: 200, w: 480, h: 64 }, { left: 10, top: 20, width: 528, height: 352 }, 960, 640);
    expect(r.left).toBeCloseTo(10 + 100 * 0.55);
    expect(r.top).toBeCloseTo(20 + 200 * 0.55);
    expect(r.width).toBeCloseTo(264);
    expect(r.height).toBeCloseTo(35.2);
  });
});
