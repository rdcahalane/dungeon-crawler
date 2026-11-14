import { describe, it, expect } from "vitest";
import { ExploredTracker } from "./explored";

describe("ExploredTracker", () => {
  it("reveals a disc and clips at the map edge", () => {
    const t = new ExploredTracker(10, 10, 2);
    expect(t.reveal(0, 0)).toBe(true);
    expect(t.seen[0]).toBe(1);
    expect(t.seen[2]).toBe(1);        // (2,0)
    expect(t.seen[3]).toBe(0);        // (3,0) is outside the radius
    expect(t.seen.reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
  });
  it("reports no change when standing still", () => {
    const t = new ExploredTracker(10, 10, 2);
    t.reveal(5, 5);
    expect(t.reveal(5, 5)).toBe(false);
  });
});
