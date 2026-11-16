import { describe, it, expect } from "vitest";
import {
  abbreviate, buildHotbar, hotkeyTarget, spellForHotkey, legacySpellSlots, type SpellSlotInfo,
} from "./hotbar";

const slots: SpellSlotInfo[] = [
  { key: "magic_missile", name: "Magic Missile", level: 1, remaining: 2, max: 2 },
  { key: "sleep", name: "Sleep", level: 1, remaining: 0, max: 1 },
  { key: "web", name: "Web", level: 2, remaining: 1, max: 1 },
];

describe("hotkeyTarget", () => {
  it("maps 1-4 to spell slots and 5-8 to belt slots", () => {
    expect(hotkeyTarget("1")).toEqual({ bar: "spell", index: 0 });
    expect(hotkeyTarget("4")).toEqual({ bar: "spell", index: 3 });
    expect(hotkeyTarget("5")).toEqual({ bar: "belt", index: 0 });
    expect(hotkeyTarget("8")).toEqual({ bar: "belt", index: 3 });
    expect(hotkeyTarget("9")).toBeNull();
    expect(hotkeyTarget("q")).toBeNull();
  });
});

describe("spellForHotkey", () => {
  it("returns the spell in that slot", () => {
    expect(spellForHotkey("1", slots)?.key).toBe("magic_missile");
    expect(spellForHotkey("3", slots)?.key).toBe("web");
  });
  it("returns null for an empty slot, a belt key or no list", () => {
    expect(spellForHotkey("4", slots)).toBeNull();
    expect(spellForHotkey("6", slots)).toBeNull();
    expect(spellForHotkey("1", undefined)).toBeNull();
  });
});

describe("buildHotbar", () => {
  it("fills caster slots in order and greys spent spells", () => {
    const bar = buildHotbar(slots, "wizard");
    expect(bar).toHaveLength(4);
    expect(bar.map((s) => s.kind)).toEqual(["spell", "spell", "spell", "empty"]);
    expect(bar[0]).toMatchObject({ label: "MM", remaining: 2, max: 2, disabled: false, hotkey: "1" });
    expect(bar[1].disabled).toBe(true);
    expect(bar[3].disabled).toBe(true);
  });

  it("ignores spell slots beyond four", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, name: `Spell ${i}`, level: 1, remaining: 1, max: 1 }));
    expect(buildHotbar(many, "cleric").filter((s) => s.kind === "spell")).toHaveLength(4);
  });

  it("gives a fighter a passive ability in slot 1 and nothing else", () => {
    const bar = buildHotbar(undefined, "fighter");
    expect(bar[0]).toMatchObject({ kind: "ability", label: "CLEAVE", passive: true, disabled: false });
    expect(bar.slice(1).every((s) => s.kind === "empty")).toBe(true);
  });

  it("does not show spells to a thief even if a list arrives", () => {
    const bar = buildHotbar(slots, "thief");
    expect(bar[0].kind).toBe("ability");
    expect(bar.some((s) => s.kind === "spell")).toBe(false);
  });

  it("shows four empty slots for a caster with nothing memorized", () => {
    expect(buildHotbar([], "wizard").every((s) => s.kind === "empty")).toBe(true);
  });
});

describe("abbreviate", () => {
  it("uses initials for multi-word names and caps single words", () => {
    expect(abbreviate("Magic Missile")).toBe("MM");
    expect(abbreviate("Cure Light Wounds")).toBe("CLW");
    expect(abbreviate("Sleep")).toBe("SLEEP");
    expect(abbreviate("Hold Person Extended Long Name Here")).toHaveLength(6);
  });
});

describe("legacySpellSlots", () => {
  it("greys a spell on cooldown", () => {
    const out = legacySpellSlots(["A", "B"], (k) => `Spell ${k}`, [0, 500]);
    expect(out.map((s) => s.remaining)).toEqual([1, 0]);
  });
});

describe("hotbar short labels and names", () => {
  it("every label drawn in a slot is at most four characters, and the full name is kept for the tooltip", () => {
    const slots = [
      { key: "magic_missile", name: "Magic Missile", level: 1, remaining: 1, max: 1 },
      { key: "sleep", name: "Sleep", level: 1, remaining: 1, max: 1 },
      { key: "clw", name: "Cure Light Wounds", level: 1, remaining: 1, max: 1 },
      { key: "hp", name: "Hold Person Extended Long Name", level: 2, remaining: 0, max: 1 },
    ];
    const bar = buildHotbar(slots, "wizard");
    expect(bar.map((b) => b.short)).toEqual(["MM", "SLEE", "CLW", "HPEL"]);
    expect(bar.map((b) => b.name)).toEqual(slots.map((s) => s.name));
    for (const cls of ["fighter", "thief"]) {
      const a = buildHotbar(undefined, cls)[0];
      expect(a.short.length).toBeLessThanOrEqual(4);
      expect(a.name.length).toBeGreaterThan(0);
    }
  });
});
