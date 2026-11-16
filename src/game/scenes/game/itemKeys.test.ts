import { describe, it, expect } from "vitest";
import { ITEM_KEY_ALIASES, WORLD_KEYS_WITHOUT_ITEM_DEF, itemDefKey, worldItemKey } from "./itemKeys";
import { CATALOG, ITEM_DEFS } from "../../items/catalog";
import { KEY_PARTS } from "../../world/tomb";

describe("item key aliases", () => {
  it("maps world keys to catalog defs and back", () => {
    expect(itemDefKey("iron_key")).toBe("key_iron");
    expect(worldItemKey("key_iron")).toBe("iron_key");
    expect(itemDefKey("key_crown")).toBe("key_crown");
    expect(worldItemKey("key_tooth")).toBe("key_tooth");
  });
  it("passes unknown keys through unchanged", () => {
    expect(itemDefKey("torch")).toBe("torch");
    expect(worldItemKey("torch")).toBe("torch");
  });
  it("every alias target is a real key-kind item def, and round-trips", () => {
    for (const [world, def] of Object.entries(ITEM_KEY_ALIASES)) {
      expect(CATALOG[def], def).toBeDefined();
      expect(CATALOG[def].kind).toBe("key");
      expect(CATALOG[def].icon).toBe("item_key");
      expect(itemDefKey(world)).toBe(def);
      expect(worldItemKey(def)).toBe(world);
    }
  });
  it("every tomb key part has an item def", () => {
    for (const part of KEY_PARTS) {
      expect(CATALOG[itemDefKey(part)], part).toBeDefined();
      expect(WORLD_KEYS_WITHOUT_ITEM_DEF).toContain(part);
    }
  });
  it("the vault key resolves to a def", () => {
    expect(CATALOG[itemDefKey("iron_key")]).toBeDefined();
  });
  it("catalog keys stay unique after the additions", () => {
    expect(new Set(ITEM_DEFS.map((d) => d.key)).size).toBe(ITEM_DEFS.length);
  });
});
