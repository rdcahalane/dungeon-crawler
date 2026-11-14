import { describe, it, expect, vi } from "vitest";
import { GameEventBus, GAME_EVENT_NAMES } from "./GameEvents";

describe("GameEventBus", () => {
  it("delivers typed payloads and payload-less events", () => {
    const bus = new GameEventBus();
    const hit = vi.fn();
    const swing = vi.fn();
    bus.on("player_hit", hit);
    bus.on("player_swing", swing);
    bus.emit("player_hit", { enemyKey: "BASIC", damage: 4, crit: false });
    bus.emit("player_swing");
    expect(hit).toHaveBeenCalledWith({ enemyKey: "BASIC", damage: 4, crit: false });
    expect(swing).toHaveBeenCalledTimes(1);
  });
  it("unsubscribe, once and off work, and a handler may unsubscribe while emitting", () => {
    const bus = new GameEventBus();
    const a = vi.fn();
    const off = bus.on("gold", a);
    bus.emit("gold", { amount: 1 });
    off();
    bus.emit("gold", { amount: 2 });
    expect(a).toHaveBeenCalledTimes(1);
    const o = vi.fn();
    bus.once("gold", o);
    bus.emit("gold", { amount: 3 });
    bus.emit("gold", { amount: 4 });
    expect(o).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(0);
  });
  it("a throwing subscriber does not stop the others", () => {
    const bus = new GameEventBus();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = vi.fn();
    bus.on("rest", () => { throw new Error("boom"); });
    bus.on("rest", ok);
    bus.emit("rest");
    expect(ok).toHaveBeenCalled();
    err.mockRestore();
  });
  it("scopes dispose together", () => {
    const bus = new GameEventBus();
    const f = vi.fn();
    const scope = bus.scope().on("floor_exit", f).on("rest", f);
    expect(bus.listenerCount()).toBe(2);
    scope.dispose();
    bus.emit("rest");
    expect(f).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });
  it("lists every event the contract names", () => {
    expect(GAME_EVENT_NAMES).toHaveLength(25);
    expect(new Set(GAME_EVENT_NAMES).size).toBe(25);
  });
});
