import { describe, expect, it } from "vitest";
import {
  GRAVEYARD_KEY, GRAVEYARD_MAX, causePhrase, createGraveyard, epitaphFor, trapCause,
} from "./Graveyard";

function memStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

const dead = (n: number) => ({
  name: `Hero${n}`, classKey: "fighter", title: "Veteran", level: 2, floor: 3, cause: "a goblin", gold: n, kills: n,
});

describe("Graveyard list", () => {
  it("is empty on a fresh device and newest first after adds", () => {
    const g = createGraveyard({ storage: memStore(), now: () => 1_700_000_000_000 });
    expect(g.list()).toEqual([]);
    g.add(dead(1));
    g.add(dead(2));
    const l = g.list();
    expect(l.map((r) => r.name)).toEqual(["Hero2", "Hero1"]);
    expect(l[0].date).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("keeps only the newest twenty", () => {
    const g = createGraveyard({ storage: memStore() });
    for (let i = 1; i <= GRAVEYARD_MAX + 5; i++) g.add(dead(i));
    const l = g.list();
    expect(l).toHaveLength(GRAVEYARD_MAX);
    expect(l[0].name).toBe(`Hero${GRAVEYARD_MAX + 5}`);
    expect(l[GRAVEYARD_MAX - 1].name).toBe("Hero6");
  });

  it("survives corrupt, wrong-version and partly bad data", () => {
    for (const raw of ["not json", "null", "[]", '{"v":99,"fallen":[]}', '{"v":1,"fallen":"x"}']) {
      const g = createGraveyard({ storage: memStore({ [GRAVEYARD_KEY]: raw }) });
      expect(g.list()).toEqual([]);
      expect(g.bonesOn(1)).toBeNull();
    }
    const mixed = JSON.stringify({ v: 1, fallen: [null, 5, { name: "" }, { name: "Ok", level: "x", gold: -4 }], bones: { floor: "no" } });
    const g = createGraveyard({ storage: memStore({ [GRAVEYARD_KEY]: mixed }) });
    expect(g.list()).toHaveLength(1);
    expect(g.list()[0]).toMatchObject({ name: "Ok", level: 1, gold: 0 });
  });

  it("works with no storage and with storage that throws", () => {
    const none = createGraveyard({ storage: null });
    expect(none.add(dead(1))).not.toBeNull();
    expect(none.list()).toEqual([]);
    const throwing = createGraveyard({
      storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } },
    });
    expect(throwing.list()).toEqual([]);
    expect(() => throwing.add(dead(1))).not.toThrow();
    expect(() => throwing.leaveBones({ floor: 1, tx: 1, ty: 1, gold: 3, name: "X" })).not.toThrow();
  });

  it("refuses a record with no name", () => {
    const g = createGraveyard({ storage: memStore() });
    expect(g.add({ ...dead(1), name: "  " })).toBeNull();
    expect(g.list()).toEqual([]);
  });
});

describe("Graveyard bones", () => {
  it("are found only on their own floor and taken once", () => {
    const g = createGraveyard({ storage: memStore() });
    g.leaveBones({ floor: 4, tx: 10, ty: 12, gold: 114, name: "Tester" });
    expect(g.bonesOn(3)).toBeNull();
    expect(g.bonesOn(4)).toMatchObject({ tx: 10, ty: 12, gold: 114, name: "Tester" });
    expect(g.takeBones(3)).toBeNull();
    expect(g.takeBones(4)?.gold).toBe(114);
    expect(g.bonesOn(4)).toBeNull();
    expect(g.takeBones(4)).toBeNull();
  });

  it("one set at a time: a new death replaces the old pile, and the list is untouched by taking bones", () => {
    const g = createGraveyard({ storage: memStore() });
    g.add(dead(1));
    g.leaveBones({ floor: 2, tx: 1, ty: 1, gold: 5, name: "First" });
    g.leaveBones({ floor: 5, tx: 2, ty: 2, gold: 9, name: "Second" });
    expect(g.bonesOn(2)).toBeNull();
    expect(g.bonesOn(5)?.name).toBe("Second");
    g.takeBones(5);
    expect(g.list()).toHaveLength(1);
  });

  it("rejects bones with a bad position", () => {
    const g = createGraveyard({ storage: memStore() });
    expect(g.leaveBones({ floor: 1, tx: Number.NaN, ty: 1, gold: 1, name: "X" })).toBeNull();
  });
});

describe("words", () => {
  it("gives causes an article, except mass nouns and phrases that have one", () => {
    expect(causePhrase("giant spider")).toBe("a giant spider");
    expect(causePhrase("Owl")).toBe("an owl");
    expect(causePhrase("poison")).toBe("poison");
    expect(causePhrase("a fall")).toBe("a fall");
    expect(causePhrase("the Hollow King")).toBe("the Hollow King");
    expect(causePhrase("a dart volley.")).toBe("a dart volley");
    expect(causePhrase("")).toBe("");
    expect(causePhrase(undefined)).toBe("");
  });

  it("names traps", () => {
    expect(trapCause("PIT")).toBe("a pit trap");
    expect(trapCause("POISON_NEEDLE")).toBe("a poisoned needle");
    expect(trapCause("mech_damage")).toBe("a tomb mechanism");
    expect(trapCause("WHAT")).toBe("a trap");
  });

  it("writes the epitaph", () => {
    expect(epitaphFor({ name: "Tester", title: "Footpad", floor: 2, cause: "giant spider", gold: 114 }))
      .toBe("TESTER THE FOOTPAD, SLAIN BY A GIANT SPIDER ON LEVEL 2 WITH 114 GOLD PIECES");
    expect(epitaphFor({ name: "Mo", title: "", floor: 1, cause: "", gold: 1 }))
      .toBe("MO, DEAD OF CAUSES UNKNOWN ON LEVEL 1 WITH 1 GOLD PIECE");
    expect(epitaphFor({ name: "Mo", title: "Acolyte", floor: 6, cause: "poison", gold: 0 }))
      .toBe("MO THE ACOLYTE, SLAIN BY POISON ON LEVEL 6 WITH NOTHING TO SHOW FOR IT");
  });
});
