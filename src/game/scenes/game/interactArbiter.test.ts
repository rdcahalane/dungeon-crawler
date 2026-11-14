import { describe, expect, it } from "vitest";
import { resolveInteract } from "./interactArbiter";

describe("resolveInteract (E key arbitration)", () => {
  it("nothing in reach", () => {
    expect(resolveInteract(Infinity, Infinity)).toBe("none");
  });
  it("only one in reach wins by default", () => {
    expect(resolveInteract(20, Infinity)).toBe("chest");
    expect(resolveInteract(Infinity, 20)).toBe("mech");
  });
  it("the nearer of two wins", () => {
    expect(resolveInteract(10, 30)).toBe("chest");
    expect(resolveInteract(30, 10)).toBe("mech");
  });
  it("a tie goes to the chest, and exactly one side ever acts", () => {
    expect(resolveInteract(24, 24)).toBe("chest");
    for (const [c, m] of [[1, 2], [2, 1], [5, 5], [Infinity, 3], [3, Infinity], [Infinity, Infinity]] as const) {
      const w = resolveInteract(c, m);
      const acts = [w === "chest", w === "mech"].filter(Boolean).length;
      expect(acts).toBe(w === "none" ? 0 : 1);
    }
  });
});
