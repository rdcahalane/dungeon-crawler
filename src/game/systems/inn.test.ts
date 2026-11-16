import { describe, expect, it } from "vitest";
import { ROOM_PRICE_GP, innRest } from "./inn";

const book = () => { const b = { rested: 0, rest() { b.rested++; } }; return b; };

describe("innRest", () => {
  it("a room costs 5 gp and restores hit points, drain and spell slots", () => {
    const hp = { hp: 3, maxHp: 20, drained: 4 };
    const b = book();
    const r = innRest("room", hp, b, 12);
    expect(r).toMatchObject({ ok: true, cost: ROOM_PRICE_GP, drainRestored: 4, spellsRestored: true });
    expect(hp).toEqual({ hp: 24, maxHp: 24, drained: 0 });
    expect(r.healed).toBe(21);
    expect(b.rested).toBe(1);
  });

  it("a room is refused without the gold and changes nothing", () => {
    const hp = { hp: 3, maxHp: 20, drained: 4 };
    const b = book();
    const r = innRest("room", hp, b, 4);
    expect(r.ok).toBe(false);
    expect(r.cost).toBe(0);
    expect(hp).toEqual({ hp: 3, maxHp: 20, drained: 4 });
    expect(b.rested).toBe(0);
  });

  it("the common room is free: half the missing hit points, slots back, drain stays", () => {
    const hp = { hp: 4, maxHp: 20, drained: 3 };
    const b = book();
    const r = innRest("common", hp, b, 0);
    expect(r).toMatchObject({ ok: true, cost: 0, healed: 8, drainRestored: 0 });
    expect(hp).toEqual({ hp: 12, maxHp: 20, drained: 3 });
    expect(b.rested).toBe(1);
  });

  it("works for non-casters (no spellbook)", () => {
    const hp = { hp: 1, maxHp: 9, drained: 0 };
    const r = innRest("room", hp, null, 5);
    expect(r.spellsRestored).toBe(false);
    expect(hp.hp).toBe(9);
  });
});
