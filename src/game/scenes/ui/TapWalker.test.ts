import { describe, expect, it } from "vitest";
import { TapWalker, type Walker } from "./TapWalker";

const T = 32;
// A 6x5 room with a wall column at x=3 except a gap at y=4.
const walk = (tx: number, ty: number): boolean => {
  if (tx < 0 || ty < 0 || tx > 5 || ty > 4) return false;
  if (tx === 3 && ty < 4) return false;
  return true;
};

function run(w: TapWalker, body: Walker, frames: number): void {
  for (let i = 0; i < frames; i++) {
    w.update();
    const m = body.moveIntent;
    if (m) { body.x += m.x * 2; body.y += m.y * 2; }
  }
}

describe("TapWalker", () => {
  it("walks around a wall to a tapped point and stops there", () => {
    const body: Walker = { x: 1.5 * T, y: 1.5 * T, moveIntent: null };
    const w = new TapWalker(body, walk, T);
    expect(w.goTo(4.5 * T, 1.5 * T)).toBe(true);
    run(w, body, 400);
    expect(w.active).toBe(false);
    expect(Math.hypot(body.x - 4.5 * T, body.y - 1.5 * T)).toBeLessThan(8);
    expect(body.moveIntent).toBeNull();
  });

  it("a tap on a wall walks to the nearest floor", () => {
    const body: Walker = { x: 1.5 * T, y: 1.5 * T, moveIntent: null };
    const w = new TapWalker(body, walk, T);
    expect(w.goTo(3.5 * T, 1.5 * T)).toBe(true);
    run(w, body, 300);
    expect(walk(Math.floor(body.x / T), Math.floor(body.y / T))).toBe(true);
    expect(Math.abs(body.x - 3.5 * T)).toBeLessThanOrEqual(T + 8);
  });

  it("refuses a tap with no floor near it, and stop clears the intent", () => {
    const body: Walker = { x: 1.5 * T, y: 1.5 * T, moveIntent: null };
    const w = new TapWalker(body, walk, T);
    expect(w.goTo(40 * T, 40 * T)).toBe(false);
    w.goTo(2.5 * T, 3.5 * T);
    w.update();
    expect(body.moveIntent).not.toBeNull();
    w.stop();
    expect(body.moveIntent).toBeNull();
  });
});
