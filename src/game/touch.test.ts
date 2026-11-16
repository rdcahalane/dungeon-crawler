import { describe, expect, it } from "vitest";
import { KEY_TABLE, buildKeyInit, detectTouch, keySpecFor, pressAction, tapAction, TAP_HOLD_MS, type TouchAction } from "./touch";
import { PAD_BOTTOM, PAD_BTN_H, PAD_BTN_W, padButtons, padRect } from "./scenes/ui/touchPadLayout";

describe("detectTouch", () => {
  const phone = { search: "", maxTouchPoints: 5, coarsePointer: true };
  const desktop = { search: "", maxTouchPoints: 0, coarsePointer: false };

  it("follows the device by default", () => {
    expect(detectTouch(phone)).toBe(true);
    expect(detectTouch(desktop)).toBe(false);
    expect(detectTouch({ ...desktop, coarsePointer: true })).toBe(true);
    expect(detectTouch({ ...desktop, maxTouchPoints: 1 })).toBe(true);
  });

  it("?touch=1 forces it on and ?touch=0 forces it off", () => {
    expect(detectTouch({ ...desktop, search: "?touch=1" })).toBe(true);
    expect(detectTouch({ ...phone, search: "?touch=0" })).toBe(false);
    expect(detectTouch({ ...desktop, search: "?quick=fighter&touch=1&floor=3" })).toBe(true);
    expect(detectTouch({ ...phone, search: "?floor=3&touch=0" })).toBe(false);
  });

  it("ignores values that are not 0 or 1", () => {
    expect(detectTouch({ ...desktop, search: "?touch=yes" })).toBe(false);
    expect(detectTouch({ ...phone, search: "?touch=2" })).toBe(true);
    expect(detectTouch({ ...desktop, search: "?touchy=1" })).toBe(false);
  });
});

describe("key table", () => {
  const entries = Object.entries(KEY_TABLE) as Array<[TouchAction, { key: string; code: string; keyCode: number }]>;

  it("gives the keys the game reads", () => {
    const want: Record<string, [string, number]> = {
      attack: ["Space", 32], use: ["KeyE", 69], search: ["KeyG", 71], pole: ["KeyP", 80], listen: ["KeyL", 76],
      camp: ["KeyR", 82], turn: ["KeyT", 84], disarm: ["KeyX", 88], potion: ["KeyF", 70], menu: ["Escape", 27],
      voice: ["KeyV", 86], hearAgain: ["KeyZ", 90], inventory: ["KeyI", 73], spellbook: ["KeyB", 66], map: ["KeyM", 77],
      spell1: ["Digit1", 49], spell4: ["Digit4", 52], crt: ["F2", 113], sound: ["KeyN", 78],
    };
    for (const [action, [code, keyCode]] of Object.entries(want)) {
      expect(keySpecFor(action as TouchAction)).toMatchObject({ code, keyCode });
    }
  });

  it("is consistent: letter keys agree across key, code and keyCode, and no two actions share a key", () => {
    for (const [, s] of entries) {
      if (/^Key[A-Z]$/.test(s.code)) {
        expect(s.key).toBe(s.code.slice(3).toLowerCase());
        expect(s.keyCode).toBe(s.code.charCodeAt(3));
      }
      if (/^Digit\d$/.test(s.code)) {
        expect(s.key).toBe(s.code.slice(5));
        expect(s.keyCode).toBe(s.code.charCodeAt(5));
      }
    }
    expect(new Set(entries.map(([, s]) => s.code)).size).toBe(entries.length);
  });

  it("builds an init that bubbles and carries keyCode and which", () => {
    const init = buildKeyInit(KEY_TABLE.use);
    expect(init).toMatchObject({ key: "e", code: "KeyE", keyCode: 69, which: 69, bubbles: true, repeat: false });
  });
});

describe("dispatch", () => {
  class FakeKeyEvent {
    type: string;
    key: string; code: string; keyCode: number; which: number;
    constructor(type: string, init: { key: string; code: string; keyCode: number; which: number }) {
      this.type = type; this.key = init.key; this.code = init.code; this.keyCode = init.keyCode; this.which = init.which;
    }
  }

  it("presses down on the call and up on release, once", () => {
    const g = globalThis as unknown as { KeyboardEvent?: unknown };
    const saved = g.KeyboardEvent;
    g.KeyboardEvent = FakeKeyEvent;
    try {
      const seen: FakeKeyEvent[] = [];
      const target = { dispatchEvent: (e: Event) => { seen.push(e as unknown as FakeKeyEvent); return true; } };
      const release = pressAction("attack", target);
      expect(seen.map((e) => e.type)).toEqual(["keydown"]);
      expect(seen[0]).toMatchObject({ code: "Space", keyCode: 32, which: 32 });
      release();
      release();
      expect(seen.map((e) => e.type)).toEqual(["keydown", "keyup"]);
    } finally {
      g.KeyboardEvent = saved;
    }
  });

  it("a tap lifts the key after the hold time", async () => {
    const g = globalThis as unknown as { KeyboardEvent?: unknown };
    const saved = g.KeyboardEvent;
    g.KeyboardEvent = FakeKeyEvent;
    try {
      const seen: string[] = [];
      tapAction("search", { dispatchEvent: (e: Event) => { seen.push((e as unknown as FakeKeyEvent).type); return true; } });
      expect(seen).toEqual(["keydown"]);
      await new Promise((r) => setTimeout(r, TAP_HOLD_MS + 40));
      expect(seen).toEqual(["keydown", "keyup"]);
    } finally {
      g.KeyboardEvent = saved;
    }
  });
});

describe("pad layout", () => {
  it("shows the spec's buttons, and only the class buttons for the class", () => {
    const ids = (cls?: string): string[] => padButtons("dungeon", cls).map((b) => b.id).sort();
    const base = ["attack", "camp", "listen", "menu", "pole", "potion", "search", "use"];
    expect(ids("fighter")).toEqual(base);
    expect(ids("wizard")).toEqual(base);
    expect(ids("cleric")).toEqual([...base, "turn"].sort());
    expect(ids("thief")).toEqual([...base, "disarm"].sort());
  });

  it("every button is at least 72 game pixels across, in a grid with no overlap, inside the screen and above the zoom row", () => {
    expect(PAD_BTN_W).toBeGreaterThanOrEqual(72);
    expect(PAD_BTN_H).toBeGreaterThanOrEqual(72);
    for (const cls of ["fighter", "cleric", "thief"]) {
      const rects = padButtons("dungeon", cls).map((b) => padRect(b.col, b.row));
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(960);
        expect(r.y + r.h).toBeLessThanOrEqual(PAD_BOTTOM);
        expect(r.y).toBeGreaterThanOrEqual(170); // under the objective panel
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it("only attack is held, and the tavern shows talk and menu", () => {
    expect(padButtons("dungeon", "fighter").filter((b) => b.hold).map((b) => b.id)).toEqual(["attack"]);
    expect(padButtons("tavern", "fighter").map((b) => b.id).sort()).toEqual(["menu", "use"]);
  });
});
