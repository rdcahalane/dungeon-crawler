import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allSpokenLines, clipId, spokenText } from "./narrationLines";
import manifest from "./narrationManifest.json";
import { bossText, floorIntro, textForArea } from "../world/roomText";

describe("narration clips", () => {
  const lines = allSpokenLines();

  it("covers the narrator's lines, spoken the way the narrator speaks them", () => {
    expect(lines.length).toBeGreaterThan(150);
    expect(lines).toContain(spokenText(floorIntro(1)!));
    expect(lines).toContain(spokenText(bossText()!));
    expect(lines).toContain(spokenText(textForArea("bell_door")!));
    expect(spokenText({ title: "T", read: "R." })).toBe("T. R.");
    expect(spokenText({ read: "R." })).toBe("R.");
  });

  it("gives every line its own clip id", () => {
    expect(new Set(lines.map(clipId)).size).toBe(lines.length);
    expect(clipId("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(clipId("abc")).toBe(clipId("abc"));
  });

  it("has a recorded clip for every line (edit room text, then run: npm run narration)", () => {
    const known = new Set(manifest as string[]);
    const missing = lines.filter((l) => !known.has(clipId(l)) || !existsSync(`public/narration/${clipId(l)}.mp3`));
    expect(missing).toEqual([]);
  });

  it("lists no clip that no line uses", () => {
    const ids = new Set(lines.map(clipId));
    expect((manifest as string[]).filter((id) => !ids.has(id))).toEqual([]);
  });
});
