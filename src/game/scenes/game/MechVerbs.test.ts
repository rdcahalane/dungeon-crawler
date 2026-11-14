import { describe, expect, it } from "vitest";
import { directionName, facingFromVelocity } from "./MechVerbs";
import { parseQuickLevel, quickStats } from "../../quickStart";
import { thac0For, xpForLevel } from "../../rules";

const SOUTH = { x: 0, y: 1 };

describe("facingFromVelocity", () => {
  it("a click-to-move step a hair off east still faces east", () => {
    expect(facingFromVelocity(180, 3, SOUTH)).toEqual({ x: 1, y: 0 });
    expect(facingFromVelocity(-179, -0.4, SOUTH)).toEqual({ x: -1, y: 0 });
    expect(facingFromVelocity(2, -170, SOUTH)).toEqual({ x: 0, y: -1 });
  });
  it("keys give the same answer as before", () => {
    expect(facingFromVelocity(180, 0, SOUTH)).toEqual({ x: 1, y: 0 });
    const d = 180 / Math.SQRT2;
    expect(facingFromVelocity(d, -d, SOUTH)).toEqual({ x: 1, y: -1 });
  });
  it("a real diagonal stays a diagonal, a 20 degree slant does not", () => {
    expect(facingFromVelocity(100, 60, SOUTH)).toEqual({ x: 1, y: 1 });
    expect(facingFromVelocity(100, 30, SOUTH)).toEqual({ x: 1, y: 0 });
  });
  it("standing still keeps the previous facing and is never (0, 0)", () => {
    expect(facingFromVelocity(0, 0, { x: -1, y: 0 })).toEqual({ x: -1, y: 0 });
    expect(facingFromVelocity(0.2, -0.1, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(facingFromVelocity(0, 0, { x: 0, y: 0 })).toEqual(SOUTH);
  });
  it("names the direction", () => {
    expect(directionName({ x: 1, y: 0 })).toBe("east");
    expect(directionName({ x: -1, y: -1 })).toBe("north-west");
  });
});

describe("quick start level", () => {
  it("parses the level parameter", () => {
    expect(parseQuickLevel(null)).toBe(1);
    expect(parseQuickLevel("4")).toBe(4);
    expect(parseQuickLevel("abc")).toBe(1);
    expect(parseQuickLevel("0")).toBe(1);
    expect(parseQuickLevel("99")).toBe(12);
  });
  it("a level 4 fighter has more hit points than a level 1 and a kit", () => {
    const c = { classKey: "fighter" as const, name: "T", str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    const one = quickStats(c, 1, 5);
    const four = quickStats(c, 4, 5);
    expect(four.level).toBe(4);
    expect(four.maxHp).toBeGreaterThan(one.maxHp);
    expect(four.hp).toBe(four.maxHp);
    expect(four.floor).toBe(5);
    expect(four.inv).toBeTruthy();
    expect(thac0For("fighter", 4)).toBeLessThan(thac0For("fighter", 1));
    expect(xpForLevel("fighter", 4)).toBeGreaterThan(0);
    expect(quickStats(c, 4, 5).maxHp).toBe(four.maxHp); // deterministic
  });
});
