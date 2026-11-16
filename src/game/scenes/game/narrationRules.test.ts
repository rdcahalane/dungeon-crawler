import { describe, expect, it } from "vitest";
import {
  AREA_WAIT_MS, NarrationQueue, mix, roomKind, shouldNarrateRoom, silentHoldMs, type NarrationItem,
} from "./narrationRules";

const item = (key: string, kind: NarrationItem["kind"], roomIdx?: number, queuedAt = 0): NarrationItem =>
  ({ key, kind, text: key, roomIdx, queuedAt });
const calm = (roomIdx: number | null = null, now = 0) => ({ roomIdx, monsterNear: false, now });

describe("shouldNarrateRoom", () => {
  it("always the first one of a floor", () => {
    expect(shouldNarrateRoom("normal", 1001, true)).toBe(true);
  });
  it("always a non-normal kind", () => {
    for (const k of ["trap_corridor", "monster_closet", "healing_font", "cursed_crypt", "gilded_cache", "stairs_down", "vault"] as const) {
      expect(shouldNarrateRoom(k, 5, false)).toBe(true);
    }
  });
  it("about one ordinary room in three, deterministic", () => {
    let yes = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (shouldNarrateRoom("normal", 3000 + (i % 40) + Math.floor(i / 40) * 1000, false)) yes++;
    expect(yes / N).toBeGreaterThan(0.25);
    expect(yes / N).toBeLessThan(0.42);
    expect(shouldNarrateRoom("normal", 7007, false)).toBe(shouldNarrateRoom("normal", 7007, false));
    expect(mix(1)).toBe(mix(1));
  });
});

describe("roomKind", () => {
  const room = { x: 10, y: 10, w: 6, h: 6 };
  it("modifier first, then stairs, then type, else normal", () => {
    expect(roomKind({ ...room, modifier: "healing_font", type: "vault" })).toBe("healing_font");
    expect(roomKind({ ...room, modifier: "blood_rune", type: "monster_closet" })).toBe("monster_closet");
    expect(roomKind(room, { tx: 12, ty: 12 })).toBe("stairs_down");
    expect(roomKind(room, { tx: 0, ty: 0 }, { tx: 11, ty: 11 })).toBe("stairs_up");
    expect(roomKind({ ...room, type: "trap_corridor" })).toBe("trap_corridor");
    expect(roomKind({ ...room, type: "quest_special" })).toBe("quest_special");
    expect(roomKind(room, { tx: 0, ty: 0 })).toBe("normal");
  });
});

describe("NarrationQueue", () => {
  it("never repeats a key in one visit, even after it was shown", () => {
    const q = new NarrationQueue();
    expect(q.push(item("room:1", "room", 1))).toBe(true);
    expect(q.push(item("room:1", "room", 1))).toBe(false);
    expect(q.take(calm(1))?.key).toBe("room:1");
    expect(q.push(item("room:1", "room", 1))).toBe(false);
    expect(q.take(calm(1))).toBeNull();
  });

  it("plays one at a time in priority order: boss, floor and tomb, vault, room", () => {
    const q = new NarrationQueue();
    q.push(item("room:2", "room", 2, 0));
    q.push(item("area:v", "area", undefined, 1));
    q.push(item("floor", "floor", undefined, 2));
    q.push(item("boss", "boss", undefined, 3));
    const order: string[] = [];
    for (let i = 0; i < 4; i++) { const n = q.take(calm(2)); if (n) order.push(n.key); }
    expect(order).toEqual(["boss", "floor", "area:v", "room:2"]);
  });

  it("drops an ordinary room's text once the player has left that room", () => {
    const q = new NarrationQueue();
    q.push(item("room:3", "room", 3));
    q.push(item("area:v", "area"));
    expect(q.take(calm(4))?.key).toBe("area:v");
    expect(q.take(calm(4))).toBeNull();
    expect(q.pending()).toBe(0);
  });

  it("shows ordinary rooms even near a monster, holds a vault for a while, never holds floor, tomb or boss", () => {
    const q = new NarrationQueue();
    q.push(item("room:1", "room", 1));
    q.push(item("area:v", "area", undefined, 0));
    q.push(item("boss", "boss", undefined, 0));
    const near = (now: number) => ({ roomIdx: 1, monsterNear: true, now });
    expect(q.take(near(100))?.key).toBe("boss");
    expect(q.take(near(100))?.key).toBe("room:1"); // the room is read even with a monster close
    expect(q.take(near(100))).toBeNull(); // the vault waits
    expect(q.pending()).toBe(1);
    expect(q.take(near(AREA_WAIT_MS + 1))?.key).toBe("area:v");
    q.push(item("tomb", "tomb", undefined, 0));
    expect(q.take(near(0))?.key).toBe("tomb");
  });

  it("keeps the backlog short by dropping old ordinary rooms first", () => {
    const q = new NarrationQueue();
    q.push(item("floor", "floor"));
    for (let i = 0; i < 8; i++) q.push(item(`room:${i}`, "room", i));
    expect(q.pending()).toBe(5);
    expect(q.take(calm(7))?.key).toBe("floor");
  });
});

describe("silentHoldMs", () => {
  it("is 4 seconds plus 60 ms per character", () => {
    expect(silentHoldMs("a".repeat(100))).toBe(10000);
  });
});
