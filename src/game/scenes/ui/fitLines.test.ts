import { describe, expect, it } from "vitest";
import { fitLines } from "./fitLines";

describe("fitLines", () => {
  it("wraps within the width", () => {
    const l = fitLines("Find the iron key and carry it to the stairs down", 20, 3);
    expect(l.length).toBeLessThanOrEqual(3);
    for (const x of l) expect(x.length).toBeLessThanOrEqual(20);
  });
  it("cuts at the line limit with an ellipsis that still fits", () => {
    const l = fitLines("one two three four five six seven eight nine ten eleven twelve", 12, 3);
    expect(l).toHaveLength(3);
    expect(l[2].endsWith("..")).toBe(true);
    for (const x of l) expect(x.length).toBeLessThanOrEqual(12);
  });
  it("breaks a word longer than a row", () => {
    const l = fitLines("Supercalifragilisticexpialidocious", 10, 5);
    for (const x of l) expect(x.length).toBeLessThanOrEqual(10);
    expect(l.join("")).toBe("Supercalifragilisticexpialidocious");
  });
  it("leaves short text alone", () => {
    expect(fitLines("Kill three rats", 26, 3)).toEqual(["Kill three rats"]);
    expect(fitLines("", 26, 3)).toEqual([]);
  });
});
