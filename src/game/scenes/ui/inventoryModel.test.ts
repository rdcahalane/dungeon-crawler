import { describe, it, expect, vi } from "vitest";
import { Inventory, starterKit, instantiate, EQUIP_SLOTS } from "../../items";
import {
  primaryAction, primaryLabel, checkAction, moveCursor, beltAction, dropAction, moveBetween,
  cursorOfLoc, locOf, type Cursor,
} from "./inventoryModel";
import { runAction, type OpsHost } from "./inventoryOps";
import { buildSheet } from "./charSheet";

const eq = (slot: string): Cursor => ({ zone: "equip", index: EQUIP_SLOTS.indexOf(slot as never) });

function fighterWithSpareSword(): { inv: Inventory; packIdx: number } {
  const inv = starterKit("fighter");
  inv.add(instantiate("long_sword", "spare-sword"));
  const packIdx = inv.pack.findIndex((p) => p?.id === "spare-sword");
  return { inv, packIdx };
}

describe("primaryAction", () => {
  it("equips a weapon from the pack", () => {
    const { inv, packIdx } = fighterWithSpareSword();
    const c: Cursor = { zone: "pack", index: packIdx };
    expect(primaryAction(inv, c)).toEqual({ type: "equip", itemId: "spare-sword" });
    expect(primaryLabel(inv, c)).toBe("EQUIP");
    expect(checkAction(inv, primaryAction(inv, c)!).ok).toBe(true);
  });

  it("uses a belt potion", () => {
    const inv = starterKit("fighter");
    const a = primaryAction(inv, { zone: "belt", index: 0 });
    expect(a).toEqual({ type: "useBelt", index: 0 });
    expect(checkAction(inv, a!).ok).toBe(true);
    // the check was a dry run: the potion is still there
    expect(inv.belt[0]).not.toBeNull();
  });

  it("unequips an equipped item, and reports cursed when it will not come off", () => {
    const inv = starterKit("fighter");
    const a = primaryAction(inv, eq("weapon"))!;
    expect(a).toEqual({ type: "unequip", slot: "weapon" });
    expect(checkAction(inv, a).ok).toBe(true);

    inv.equipment.weapon = instantiate("long_sword", "cursed-sword", { cursed: true, identified: true, plus: -1 });
    const r = checkAction(inv, primaryAction(inv, eq("weapon"))!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cursed");
  });

  it("sends a pack consumable to the belt", () => {
    const inv = starterKit("fighter");
    inv.add(instantiate("healing_potion", "pot-2"));
    const idx = inv.pack.findIndex((p) => p?.id === "pot-2");
    const a = primaryAction(inv, { zone: "pack", index: idx })!;
    expect(a.type).toBe("move");
    expect(primaryLabel(inv, { zone: "pack", index: idx })).toBe("TO BELT");
  });

  it("does nothing for an empty slot or plain gear in the pack", () => {
    const inv = starterKit("fighter");
    expect(primaryAction(inv, { zone: "pack", index: 23 })).toBeNull();
    inv.add(instantiate("rope", "rope-1"));
    const rope = inv.pack.findIndex((p) => p?.id === "rope-1");
    expect(primaryAction(inv, { zone: "pack", index: rope })).toBeNull();
  });
});

describe("failure reasons", () => {
  it("class_restricted", () => {
    const wiz = starterKit("wizard");
    wiz.add(instantiate("chain_mail", "mail"));
    const wi = wiz.pack.findIndex((p) => p?.id === "mail");
    const r = checkAction(wiz, primaryAction(wiz, { zone: "pack", index: wi })!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("class_restricted");
  });

  it("two_handed_conflict with a shield on and a two-handed weapon", () => {
    const inv = starterKit("fighter");
    inv.add(instantiate("two_handed_sword", "big"));
    const i = inv.pack.findIndex((p) => p?.id === "big");
    const r = checkAction(inv, primaryAction(inv, { zone: "pack", index: i })!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("two_handed_conflict");
  });

  it("pack_full when unequipping into a full pack", () => {
    const inv = starterKit("fighter");
    for (let n = 0; inv.pack.some((p) => p === null); n++) inv.add(instantiate("dagger", `fill-${n}`));
    const r = checkAction(inv, { type: "unequip", slot: "weapon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pack_full");
  });

  it("belt_full when a different item would be swapped", () => {
    const inv = starterKit("fighter");
    for (let i = 0; i < 4; i++) inv.belt[i] = instantiate("ration", `r${i}`, { quantity: 1 });
    inv.add(instantiate("healing_potion", "p9"));
    const idx = inv.pack.findIndex((p) => p?.id === "p9");
    const a = beltAction(inv, { zone: "pack", index: idx })!;
    const r = checkAction(inv, a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("belt_full");
  });
});

describe("other actions", () => {
  it("B moves a belt item back to the pack", () => {
    const inv = starterKit("fighter");
    const a = beltAction(inv, { zone: "belt", index: 0 })!;
    expect(checkAction(inv, a).ok).toBe(true);
  });

  it("drop applies to pack items only", () => {
    const inv = starterKit("fighter");
    expect(dropAction(inv, { zone: "pack", index: 23 })).toBeNull();
    const w = dropAction(inv, eq("weapon"))!;
    const r = checkAction(inv, w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_in_pack");
  });

  it("moveBetween refuses doll to doll and same slot", () => {
    const inv = starterKit("fighter");
    expect(moveBetween(inv, eq("weapon"), eq("offhand"))).toBeNull();
    expect(moveBetween(inv, { zone: "belt", index: 0 }, { zone: "belt", index: 0 })).toBeNull();
    expect(moveBetween(inv, { zone: "belt", index: 0 }, { zone: "belt", index: 2 })).not.toBeNull();
  });

  it("locOf and cursorOfLoc round trip", () => {
    for (const c of [eq("ring2"), { zone: "pack", index: 7 } as Cursor, { zone: "belt", index: 3 } as Cursor]) {
      expect(cursorOfLoc(locOf(c))).toEqual(c);
    }
  });
});

describe("moveCursor", () => {
  it("walks the pack grid and falls onto the belt from the bottom row", () => {
    expect(moveCursor({ zone: "pack", index: 0 }, "right")).toEqual({ zone: "pack", index: 1 });
    expect(moveCursor({ zone: "pack", index: 5 }, "right")).toEqual({ zone: "pack", index: 5 });
    expect(moveCursor({ zone: "pack", index: 0 }, "up")).toEqual({ zone: "pack", index: 0 });
    expect(moveCursor({ zone: "pack", index: 18 }, "down")).toEqual({ zone: "belt", index: 0 });
    expect(moveCursor({ zone: "pack", index: 23 }, "down")).toEqual({ zone: "belt", index: 3 });
    expect(moveCursor({ zone: "belt", index: 2 }, "up")).toEqual({ zone: "pack", index: 20 });
  });

  it("crosses between the paper doll and the pack", () => {
    const weapon = eq("weapon");
    expect(moveCursor(weapon, "right")).toEqual(eq("offhand")); // skips the sprite cell
    expect(moveCursor(eq("offhand"), "right")).toEqual({ zone: "pack", index: 6 });
    expect(moveCursor({ zone: "pack", index: 6 }, "left")).toEqual(eq("offhand"));
    expect(moveCursor(eq("helm"), "down")).toEqual(eq("boots"));
    expect(moveCursor(eq("helm"), "up")).toEqual(eq("helm"));
  });
});

describe("runAction", () => {
  function host(inv: Inventory, hooks: OpsHost["hooks"] = {}) {
    const say = vi.fn();
    const recompute = vi.fn();
    const refreshHud = vi.fn();
    const heal = vi.fn();
    const h: OpsHost = { inventory: inv, hooks, say, recompute, refreshHud, heal, rng: { next: () => 0.5 } };
    return { h, say, recompute, refreshHud, heal };
  }

  it("falls back to the inventory and refreshes when no hook exists", () => {
    const { inv, packIdx } = fighterWithSpareSword();
    const { h, recompute, refreshHud } = host(inv);
    const before = inv.equipment.weapon?.id;
    const r = runAction(h, primaryAction(inv, { zone: "pack", index: packIdx })!);
    expect(r.ok).toBe(true);
    expect(inv.equipment.weapon?.id).toBe("spare-sword");
    expect(inv.pack.some((p) => p?.id === before)).toBe(true);
    expect(recompute).toHaveBeenCalled();
    expect(refreshHud).toHaveBeenCalled();
  });

  it("calls the context hook instead of touching the inventory", () => {
    const { inv, packIdx } = fighterWithSpareSword();
    const equipItem = vi.fn();
    const { h } = host(inv, { equipItem });
    runAction(h, primaryAction(inv, { zone: "pack", index: packIdx })!);
    expect(equipItem).toHaveBeenCalledWith("spare-sword");
    expect(inv.equipment.weapon?.id).not.toBe("spare-sword");
  });

  it("says why and does nothing when the check fails", () => {
    const inv = starterKit("fighter");
    inv.equipment.weapon = instantiate("long_sword", "cs", { cursed: true });
    const unequipSlot = vi.fn();
    const { h, say } = host(inv, { unequipSlot });
    const r = runAction(h, { type: "unequip", slot: "weapon" });
    expect(r.ok).toBe(false);
    expect(unequipSlot).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/cursed/i));
  });

  it("drinks a belt potion and heals in the fallback", () => {
    const inv = starterKit("fighter");
    const { h, heal } = host(inv);
    const r = runAction(h, { type: "useBelt", index: 0 });
    expect(r.ok).toBe(true);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(heal.mock.calls[0][0]).toBeGreaterThan(0);
    expect(inv.belt[0]).toBeNull();
  });
});

describe("buildSheet", () => {
  it("computes THAC0, AC, saves and encumbrance for a fighter", () => {
    const inv = starterKit("fighter");
    const s = buildSheet({ classKey: "fighter", level: 1, str: 16, dex: 12, con: 14, int: 9, wis: 10, cha: 8 }, inv);
    expect(s.thac0).toBeLessThanOrEqual(20);
    expect(s.ac).toBeLessThan(10);
    expect(Object.keys(s.saves)).toHaveLength(5);
    expect(s.enc.tier).toBeDefined();
    expect(s.abilities[0]).toEqual(["STR", 16]);
  });
  it("prefers the HUD payload values", () => {
    const inv = starterKit("fighter");
    const s = buildSheet({ classKey: "fighter", level: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inv, { thac0: 7, ac: 2, title: "Hero" });
    expect([s.thac0, s.ac, s.title]).toEqual([7, 2, "Hero"]);
  });
});
