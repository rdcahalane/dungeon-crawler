import { describe, it, expect } from "vitest";
import { MessageLog } from "./messageLog";

describe("MessageLog", () => {
  it("keeps only the newest lines up to capacity", () => {
    const log = new MessageLog(3);
    ["a", "b", "c", "d", "e"].forEach((t, i) => log.push(t, i * 1000));
    expect(log.size).toBe(3);
    expect(log.last(10).map((l) => l.text)).toEqual(["c", "d", "e"]);
  });

  it("returns the newest n, oldest first", () => {
    const log = new MessageLog(10);
    ["a", "b", "c"].forEach((t, i) => log.push(t, i * 1000));
    expect(log.last(2).map((l) => l.text)).toEqual(["b", "c"]);
    expect(log.last(0)).toEqual([]);
  });

  it("drops a duplicate that arrives through the second status path", () => {
    const log = new MessageLog(10, 120);
    expect(log.push("The door is locked.", 1000)).toBe(true);
    expect(log.push("The door is locked.", 1005)).toBe(false);
    expect(log.push("The door is locked.", 2000)).toBe(true);
    expect(log.size).toBe(2);
  });

  it("ignores blank text and trims", () => {
    const log = new MessageLog(10);
    expect(log.push("   ", 0)).toBe(false);
    log.push("  hi  ", 0);
    expect(log.last(1)[0].text).toBe("hi");
  });

  it("recent() drops lines older than the ttl", () => {
    const log = new MessageLog(10);
    log.push("old", 0);
    log.push("new", 9000);
    expect(log.recent(3, 10000, 5000).map((l) => l.text)).toEqual(["new"]);
  });
});
