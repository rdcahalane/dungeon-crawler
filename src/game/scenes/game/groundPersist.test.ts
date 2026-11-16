import { describe, expect, it } from "vitest";
import { makeItem } from "../../items";
import { packGroundItems, unpackGroundItems } from "./groundPersist";
import type { SerializedFloor } from "../../systems/DungeonGenerator";

const rng = { next: (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })() };
const T = 32;

describe("ground item persistence", () => {
  it("round-trips through the floor save JSON, keeping the item whole", () => {
    const sword = makeItem("long_sword", rng);
    const potion = makeItem("healing_potion", rng, 3);
    const packed = packGroundItems(
      [
        { item: sword, x: 5 * T + 16, y: 9 * T + 12, dropped: true },
        { item: potion, x: 7 * T + 16, y: 2 * T + 16 },
      ],
      T,
    );
    const floor = { groundItems: packed } as Pick<SerializedFloor, "groundItems">;
    const restored = unpackGroundItems((JSON.parse(JSON.stringify(floor)) as typeof floor).groundItems);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual({ item: sword, tx: 5, ty: 9, dropped: true });
    expect(restored[1]).toEqual({ item: potion, tx: 7, ty: 2 });
    expect(restored[1].item.quantity).toBe(3);
  });

  it("leaves out generator spawns, gold and empty entries", () => {
    const packed = packGroundItems(
      [
        { item: makeItem("torch", rng), x: 16, y: 16, spawnKey: "0,0" },
        { x: 48, y: 48 },
        { item: makeItem("rope", rng), x: 80, y: 80 },
      ],
      T,
    );
    expect(packed.map((p) => p.item.defKey)).toEqual(["rope"]);
  });

  it("packing copies the item: later changes to the live item do not rewrite the save", () => {
    const it = makeItem("healing_potion", rng, 2);
    const [p] = packGroundItems([{ item: it, x: 16, y: 16 }], T);
    it.quantity = 1;
    expect(p.item.quantity).toBe(2);
  });

  it("an old save has no groundItems, and a renamed def is skipped instead of crashing", () => {
    expect(unpackGroundItems(undefined)).toEqual([]);
    const good = makeItem("rope", rng);
    const bad = { ...good, defKey: "no_such_thing" };
    const out = unpackGroundItems([
      { item: bad, tx: 1, ty: 1 },
      { item: good, tx: 2, ty: 2 },
      { item: good, tx: 1.5, ty: 2 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tx).toBe(2);
  });
});
