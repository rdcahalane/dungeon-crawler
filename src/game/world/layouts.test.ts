import { describe, expect, it, vi } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH, TILE } from "../constants";
import { generateDungeon, type DungeonData } from "../systems/DungeonGenerator";
import { pickLayout, type FloorLayout } from "./layouts";

const WALK = new Set<number>([TILE.FLOOR, TILE.STAIRS, TILE.STAIRS_UP, TILE.TRAP, TILE.SECRET_DOOR]);

/** Reachable tiles from the start, counting secret doors and mechanism tiles (vault doors, gates) as passable. */
function reach(d: DungeonData): Set<number> {
  const mech = new Set((d.mechanisms ?? []).map((m) => m.ty * MAP_WIDTH + m.tx));
  const seen = new Set<number>();
  const stack = [d.playerStart.ty * MAP_WIDTH + d.playerStart.tx];
  while (stack.length) {
    const k = stack.pop() as number;
    const x = k % MAP_WIDTH;
    const y = (k - x) / MAP_WIDTH;
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT || seen.has(k) || !(WALK.has(d.tiles[y][x]) || mech.has(k))) continue;
    seen.add(k);
    stack.push(k + 1, k - 1, k + MAP_WIDTH, k - MAP_WIDTH);
  }
  return seen;
}

const ALL = ["halls", "caverns", "ruins", "mine", "crypt", "temple"] as const;

/** Generate until each style has turned up a few times. */
function floorsByLayout(): Record<FloorLayout, DungeonData[]> {
  const out: Record<FloorLayout, DungeonData[]> = { halls: [], caverns: [], ruins: [], mine: [], crypt: [], temple: [] };
  for (let i = 0; i < 220; i++) {
    const floor = 2 + (i % 10);
    const d = generateDungeon(floor, i % 4 === 0 ? ["library", "arena"] : undefined);
    out[d.layout ?? "halls"].push(d);
  }
  return out;
}

describe("map styles", () => {
  const byLayout = floorsByLayout();

  it("every style turns up across the floors", () => {
    for (const l of ALL) expect(byLayout[l].length, l).toBeGreaterThan(3);
  });

  it("floor 1 is always the halls", () => {
    for (let i = 0; i < 10; i++) expect(generateDungeon(1).layout).toBe("halls");
  });

  for (const layout of ALL) {
    it(`${layout}: the stairs, every monster, chest, item and trap are on reachable floor`, () => {
      for (const d of byLayout[layout]) {
        const r = reach(d);
        const at = (tx: number, ty: number) => r.has(ty * MAP_WIDTH + tx);
        expect(at(d.stairsPos.tx, d.stairsPos.ty), "stairs down").toBe(true);
        expect(at(d.stairsUpPos.tx, d.stairsUpPos.ty), "stairs up").toBe(true);
        expect(d.stairsUpPos).not.toEqual(d.playerStart);
        for (const e of d.enemies) expect(at(e.tx, e.ty), `enemy ${e.type} at ${e.tx},${e.ty}`).toBe(true);
        for (const c of d.chests) expect(at(c.tx, c.ty), `chest at ${c.tx},${c.ty}`).toBe(true);
        for (const it of d.items) expect(at(it.tx, it.ty), `item ${it.type} at ${it.tx},${it.ty}`).toBe(true);
        for (const t of d.traps) expect(at(t.tx, t.ty), `trap at ${t.tx},${t.ty}`).toBe(true);
        for (const room of d.rooms) expect(at(room.cx, room.cy), `room centre ${room.cx},${room.cy}`).toBe(true);
      }
    });
  }

  it("caverns are not boxes: rooms leave rock inside their bounding box", () => {
    let rockInside = 0;
    for (const d of byLayout.caverns) {
      for (const r of d.rooms) {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (d.tiles[y][x] === TILE.WALL) rockInside++;
      }
    }
    expect(rockInside).toBeGreaterThan(byLayout.caverns.length * 10);
  });

  it("ruins have broken walls: floor reaches past room edges where no corridor runs", () => {
    // A halls room's ring is wall except where corridors leave; ruins open more of it.
    const openRing = (ds: DungeonData[]) => {
      let open = 0;
      let all = 0;
      for (const d of ds) {
        for (const r of d.rooms) {
          for (let x = r.x; x < r.x + r.w; x++) {
            for (const y of [r.y - 1, r.y + r.h]) {
              if (y < 1 || y >= MAP_HEIGHT - 1) continue;
              all++;
              if (d.tiles[y][x] !== TILE.WALL) open++;
            }
          }
        }
      }
      return open / all;
    };
    expect(openRing(byLayout.ruins)).toBeGreaterThan(openRing(byLayout.halls));
  });

  it("water: shallows lie on open floor, pools are solid, and only crypts and temples have any", () => {
    let shallows = 0;
    let pools = 0;
    for (const l of ALL) {
      for (const d of byLayout[l]) {
        if (l !== "crypt" && l !== "temple") { expect(d.water, l).toBeUndefined(); continue; }
        for (const k of d.water?.pools ?? []) { expect(d.tiles[Math.floor(k / MAP_WIDTH)][k % MAP_WIDTH]).toBe(TILE.WALL); pools++; }
        for (const k of d.water?.shallows ?? []) { expect(d.tiles[Math.floor(k / MAP_WIDTH)][k % MAP_WIDTH]).not.toBe(TILE.WALL); shallows++; }
      }
    }
    expect(shallows).toBeGreaterThan(50);
    expect(pools).toBeGreaterThan(3);
  });

  it("temples are not boxes either: cross and octagon halls leave rock in their corners", () => {
    let corners = 0;
    for (const d of byLayout.temple) for (const r of d.rooms) if (d.tiles[r.y][r.x] === TILE.WALL) corners++;
    expect(corners).toBeGreaterThan(byLayout.temple.length);
  });

  it("pickLayout follows the weights and never picks a style outside the three", () => {
    const rand = vi.fn(() => 0.999);
    expect(pickLayout(1, rand)).toBe("halls");
    expect(ALL).toContain(pickLayout(5, rand));
    expect(pickLayout(2, () => 0)).toBe("caverns");
  });
});
