import { describe, expect, it } from "vitest";
import { WADE_SPEED_MULT, wadingSpeed } from "./constants";
import { EFFECTS, SFX_KEYS } from "./audio/sfxData";

describe("wading", () => {
  it("slows to WADE_SPEED_MULT in shallows and leaves dry floor alone", () => {
    expect(WADE_SPEED_MULT).toBeGreaterThan(0);
    expect(WADE_SPEED_MULT).toBeLessThan(1);
    expect(wadingSpeed(100, false)).toBe(100);
    expect(wadingSpeed(100, true)).toBeCloseTo(100 * WADE_SPEED_MULT);
  });

  it("has a splash sound", () => {
    expect(SFX_KEYS as readonly string[]).toContain("splash");
    expect(EFFECTS.splash.length).toBeGreaterThan(0);
  });
});
