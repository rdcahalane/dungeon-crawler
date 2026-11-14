import { describe, it, expect } from "vitest";
import { findPath, lineClear, nearestWalkable, type WalkFn } from "./pathfind";

/** '#' wall, '.' floor. */
function grid(rows: string[]): WalkFn {
  return (tx, ty) => rows[ty]?.[tx] === ".";
}

describe("findPath", () => {
  it("returns an empty path when already there", () => {
    expect(findPath({ tx: 1, ty: 1 }, { tx: 1, ty: 1 }, grid(["..."]))).toEqual([]);
  });

  it("walks a straight corridor and ends on the goal", () => {
    const p = findPath({ tx: 0, ty: 0 }, { tx: 4, ty: 0 }, grid(["....."]))!;
    expect(p).toHaveLength(4);
    expect(p[p.length - 1]).toEqual({ tx: 4, ty: 0 });
  });

  it("finds a way around a wall", () => {
    const w = grid([
      ".....",
      ".###.",
      ".#...",
      ".#.#.",
      "...#.",
    ]);
    const p = findPath({ tx: 0, ty: 0 }, { tx: 4, ty: 4 }, w)!;
    expect(p).not.toBeNull();
    expect(p[p.length - 1]).toEqual({ tx: 4, ty: 4 });
    for (const s of p) expect(w(s.tx, s.ty)).toBe(true);
    // every step is one tile
    let prev = { tx: 0, ty: 0 };
    for (const s of p) {
      expect(Math.max(Math.abs(s.tx - prev.tx), Math.abs(s.ty - prev.ty))).toBe(1);
      prev = s;
    }
  });

  it("does not cut corners between two walls", () => {
    const w = grid([
      ".#",
      "#.",
    ]);
    expect(findPath({ tx: 0, ty: 0 }, { tx: 1, ty: 1 }, w)).toBeNull();
  });

  it("returns null when the goal is enclosed", () => {
    const w = grid([
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
      ".....",
    ]);
    expect(findPath({ tx: 0, ty: 0 }, { tx: 2, ty: 2 }, w)).toBeNull();
  });

  it("returns null when the goal is a wall", () => {
    expect(findPath({ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, grid([".#"]))).toBeNull();
  });

  it("respects the node cap", () => {
    const open: WalkFn = (tx, ty) => tx >= 0 && ty >= 0 && tx < 100 && ty < 100;
    expect(findPath({ tx: 0, ty: 0 }, { tx: 90, ty: 90 }, open, { maxNodes: 10 })).toBeNull();
    expect(findPath({ tx: 0, ty: 0 }, { tx: 90, ty: 90 }, open, { maxNodes: 600 })).not.toBeNull();
  });

  it("expands no more than the cap", () => {
    let calls = 0;
    const open: WalkFn = (tx, ty) => { calls++; return tx >= 0 && ty >= 0 && tx < 100 && ty < 100; };
    findPath({ tx: 0, ty: 0 }, { tx: 99, ty: 0 }, open, { maxNodes: 20 });
    // each expansion probes at most 8 neighbours plus up to 16 corner checks
    expect(calls).toBeLessThan(20 * 24 + 5);
  });
});

describe("lineClear", () => {
  const w = grid([
    ".....",
    ".###.",
    ".....",
  ]);
  it("is clear along an open row", () => {
    expect(lineClear(16, 16, 150, 16, 32, w)).toBe(true);
  });
  it("is blocked through a wall", () => {
    expect(lineClear(48, 16, 48, 80, 32, w)).toBe(false);
  });
  it("body radius makes a close scrape blocked", () => {
    // Row y=2 is open; a segment at y just inside row 2's top edge clips row 1 with a body radius.
    expect(lineClear(16, 66, 150, 66, 32, w, 0)).toBe(true);
    expect(lineClear(16, 66, 150, 66, 32, w, 6)).toBe(false);
  });
});

describe("nearestWalkable", () => {
  it("returns the tile itself when walkable", () => {
    expect(nearestWalkable({ tx: 0, ty: 0 }, grid(["."]))).toEqual({ tx: 0, ty: 0 });
  });
  it("finds the closest open tile next to a wall", () => {
    expect(nearestWalkable({ tx: 1, ty: 0 }, grid([".#"]))).toEqual({ tx: 0, ty: 0 });
  });
  it("gives up past the ring limit", () => {
    expect(nearestWalkable({ tx: 0, ty: 0 }, grid(["#####"]), 2)).toBeNull();
  });
});
