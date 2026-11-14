import { describe, expect, it } from "vitest";
import { TOMB } from "./tomb";
import { VAULTS } from "./vaults";
import {
  BOSS_TEXT, FLOOR_INTROS, ROOM_POOLS, TOMB_TEXT, VAULT_TEXT, bossText, floorIntro, textForArea, textForRoom,
  type RoomKind, type RoomText, type ThemeIdx,
} from "./roomText";

const THEMES: ThemeIdx[] = [0, 1, 2, 3];
const OTHER_KINDS: RoomKind[] = [
  "trap_corridor", "monster_closet", "vault", "quest_special", "healing_font", "cursed_crypt", "gilded_cache",
  "stairs_down", "stairs_up",
];

function words(t: RoomText): number {
  return t.read.trim().split(/\s+/).length;
}

const labelled: { label: string; text: RoomText; max: number }[] = [];
for (const [f, t] of Object.entries(FLOOR_INTROS)) labelled.push({ label: `floor ${f}`, text: t, max: 75 });
for (const [id, t] of Object.entries(VAULT_TEXT)) labelled.push({ label: `vault ${id}`, text: t, max: 60 });
for (const [id, t] of Object.entries(TOMB_TEXT)) labelled.push({ label: `tomb ${id}`, text: t, max: 60 });
if (BOSS_TEXT) labelled.push({ label: "boss", text: BOSS_TEXT, max: 75 });
for (const th of THEMES) {
  for (const [kind, pool] of Object.entries(ROOM_POOLS[th] ?? {})) {
    pool?.forEach((t, i) => labelled.push({ label: `theme ${th} ${kind} ${i}`, text: t, max: 60 }));
  }
}

describe("room text coverage", () => {
  it("has text for every vault", () => {
    for (const v of VAULTS) {
      expect(VAULT_TEXT[v.id], v.id).toBeDefined();
      expect(VAULT_TEXT[v.id].title).toBe(v.name);
      expect(textForArea(v.id)).toBeDefined();
    }
  });

  it("has text for every tomb chamber, titled with its name", () => {
    for (let n = 1; n <= 12; n++) {
      const t = TOMB_TEXT[`chamber_${n}`];
      expect(t, `chamber_${n}`).toBeDefined();
      const piece = TOMB.setPieces.find((p) => p.id === `chamber_${n}`);
      expect(t.title).toBe(piece?.name);
    }
  });

  it("has an intro for floors 1 to 13 and a boss line", () => {
    for (let f = 1; f <= 13; f++) expect(floorIntro(f), `floor ${f}`).toBeDefined();
    expect(bossText()).toBeDefined();
  });

  it("has enough variants in every theme", () => {
    for (const th of THEMES) {
      expect((ROOM_POOLS[th]?.normal ?? []).length, `theme ${th} normal`).toBeGreaterThanOrEqual(8);
      for (const k of OTHER_KINDS) {
        expect((ROOM_POOLS[th]?.[k] ?? []).length, `theme ${th} ${k}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps titles off ordinary rooms", () => {
    for (const th of THEMES) for (const t of ROOM_POOLS[th]?.normal ?? []) expect(t.title).toBeUndefined();
  });
});

describe("room text style", () => {
  it("stays within the word limits", () => {
    for (const { label, text, max } of labelled) {
      const n = words(text);
      expect(n, label).toBeGreaterThanOrEqual(25);
      expect(n, label).toBeLessThanOrEqual(max);
    }
  });

  it("is safe to read aloud: no digits and none of & / < > *", () => {
    for (const { label, text } of labelled) {
      expect(text.read, label).not.toMatch(/[0-9&/<>*]/);
      if (text.title) expect(text.title, label).not.toMatch(/[0-9&/<>*]/);
    }
  });

  it("has no repeated text", () => {
    const seen = new Set<string>();
    for (const { label, text } of labelled) {
      expect(seen.has(text.read), label).toBe(false);
      seen.add(text.read);
    }
  });
});

describe("textForRoom", () => {
  it("is deterministic for a seed and covers every theme and kind", () => {
    for (const th of THEMES) {
      for (const k of ["normal", ...OTHER_KINDS] as RoomKind[]) {
        for (let seed = 0; seed < 20; seed++) {
          const a = textForRoom(th, k, seed);
          expect(a).toBeDefined();
          expect(textForRoom(th, k, seed)).toBe(a);
        }
      }
    }
  });

  it("spreads different seeds across the pool", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) seen.add(textForRoom(0, "normal", seed)!.read);
    expect(seen.size).toBeGreaterThan(3);
  });
});
