import { describe, expect, it } from "vitest";
import { ENEMY_TYPES, FLOOR_ENEMY_POOLS, FLOOR_10_PLUS_POOL, enemyPoolForFloor } from "./constants";
import { MONSTERS } from "./rules";

describe("floor enemy pools come from the bestiary", () => {
  it("floor 1 holds only monsters of one hit die or less", () => {
    const pool = enemyPoolForFloor(1);
    expect(pool.length).toBeGreaterThan(0);
    for (const k of pool) expect(MONSTERS[k].hd, k).toBeLessThanOrEqual(1);
    expect(FLOOR_ENEMY_POOLS[1]).toEqual(pool);
  });

  it("the new folklore monsters join the pools as the floors deepen, and mimics never spawn loose", () => {
    const seen = new Set<string>();
    for (let f = 1; f <= 12; f++) for (const k of enemyPoolForFloor(f)) seen.add(k);
    for (const k of ["GHOUL", "WIGHT", "WRAITH", "GARGOYLE", "OOZE", "CULTIST", "BONE_KNIGHT", "GIANT_BAT"]) {
      expect(seen.has(k), k).toBe(true);
    }
    expect(seen.has("MIMIC")).toBe(false);
    expect(seen.has("HOLLOW_KING")).toBe(false);
    expect(FLOOR_10_PLUS_POOL.length).toBeGreaterThan(5);
  });

  it("every monster has a derived presentation entry with its bestiary texture", () => {
    for (const k of Object.keys(MONSTERS) as Array<keyof typeof MONSTERS>) {
      expect(ENEMY_TYPES[k].textureKey).toBe(MONSTERS[k].textureKey);
    }
  });
});
