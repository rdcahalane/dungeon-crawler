import { describe, it, expect } from "vitest";
import { createSaveStore, LOCAL_SAVE_PREFIX } from "./SaveStore";
import type { PlayerStats } from "../entities/Player";

function fakeStorage(opts: { failSet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (opts.failSet) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
  };
}

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> };
const resp = (status: number, body: unknown): Resp => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeFetch(handler: (url: string, init?: { method?: string; body?: string }) => Resp | Promise<Resp>) {
  const calls: { url: string; method?: string; body?: string }[] = [];
  const fn = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method, body: init?.body });
    return handler(url, init);
  };
  return { fn: fn as never, calls };
}

const stats = (over: Partial<PlayerStats> = {}): PlayerStats =>
  ({ classKey: "fighter", level: 3, floor: 2, name: "Brom", hp: 10, maxHp: 10, ...over }) as unknown as PlayerStats;

const NOW = () => Date.parse("2026-11-14T12:00:00Z");

describe("SaveStore", () => {
  it("saves to the API when it answers ok and does not touch localStorage", async () => {
    const storage = fakeStorage();
    const f = fakeFetch(() => resp(200, { ok: true, id: "x" }));
    const store = createSaveStore({ fetch: f.fn, storage, now: NOW });
    const r = await store.saveGame(1, stats());
    expect(r).toEqual({ ok: true, where: "api" });
    expect(f.calls[0].url).toBe("/api/save");
    expect(JSON.parse(f.calls[0].body!)).toMatchObject({ slot: 1, name: "Brom", level: 3, floor: 2 });
    expect(storage.map.size).toBe(0);
  });

  it("falls back to localStorage on 401", async () => {
    const storage = fakeStorage();
    const store = createSaveStore({ fetch: fakeFetch(() => resp(401, { error: "Unauthorized" })).fn, storage, now: NOW });
    const r = await store.saveGame(2, stats());
    expect(r).toEqual({ ok: true, where: "local" });
    const raw = storage.map.get(`${LOCAL_SAVE_PREFIX}2`)!;
    expect(JSON.parse(raw)).toMatchObject({ slot: 2, name: "Brom", level: 3, floor: 2, updatedAt: "2026-11-14T12:00:00.000Z" });
  });

  it("falls back when the server reports offline (202 ok:false) or a 500", async () => {
    for (const handler of [() => resp(202, { ok: false, offline: true }), () => resp(500, {})]) {
      const storage = fakeStorage();
      const store = createSaveStore({ fetch: fakeFetch(handler).fn, storage, now: NOW });
      expect((await store.saveGame(1, stats())).where).toBe("local");
    }
  });

  it("falls back when fetch throws, and when there is no fetch at all", async () => {
    const storage = fakeStorage();
    const throwing = createSaveStore({ fetch: (async () => { throw new Error("network"); }) as never, storage, now: NOW });
    expect((await throwing.saveGame(1, stats())).where).toBe("local");
    const none = createSaveStore({ fetch: null, storage, now: NOW });
    expect((await none.saveGame(3, stats())).where).toBe("local");
    expect(storage.map.has(`${LOCAL_SAVE_PREFIX}3`)).toBe(true);
  });

  it("is safe with no localStorage or a throwing one", async () => {
    const noStore = createSaveStore({ fetch: null, storage: null });
    expect(await noStore.saveGame(1, stats())).toEqual({ ok: false, where: "none" });
    expect(await noStore.loadGame(1)).toBeNull();
    expect((await noStore.listSaves()).saves).toEqual([null, null, null, null, null]);
    const full = createSaveStore({ fetch: null, storage: fakeStorage({ failSet: true }) });
    expect(await full.saveGame(1, stats())).toEqual({ ok: false, where: "none" });
  });

  it("round-trips a local save through load and list", async () => {
    const storage = fakeStorage();
    const store = createSaveStore({ fetch: fakeFetch(() => resp(401, {})).fn, storage, now: NOW });
    await store.saveGame(4, stats({ name: undefined, level: 7, floor: 5, classKey: "wizard" }));
    const loaded = await store.loadGame(4);
    expect(loaded?.source).toBe("local");
    expect(loaded?.data.level).toBe(7);
    const listing = await store.listSaves();
    expect(listing).toMatchObject({ source: "local", loggedIn: false, unauthorized: true });
    expect(listing.saves[3]).toMatchObject({ slot: 4, level: 7, floor: 5 });
    expect(listing.saves[3]!.name).toContain("Wizard");
    expect(listing.saves[0]).toBeNull();
  });

  it("loads from the API when signed in, and an empty API slot does not read local", async () => {
    const storage = fakeStorage();
    storage.map.set(`${LOCAL_SAVE_PREFIX}1`, JSON.stringify({ slot: 1, name: "old", level: 1, floor: 1, updatedAt: "x", data: { level: 1 } }));
    const hit = createSaveStore({ fetch: fakeFetch(() => resp(200, { save: { data: { level: 9 } } })).fn, storage });
    expect((await hit.loadGame(1))?.data.level).toBe(9);
    const empty = createSaveStore({ fetch: fakeFetch(() => resp(200, { save: null })).fn, storage });
    expect(await empty.loadGame(1)).toBeNull();
    const offline = createSaveStore({ fetch: fakeFetch(() => resp(200, { save: null, offline: true })).fn, storage });
    expect((await offline.loadGame(1))?.source).toBe("local");
  });

  it("lists from the API when signed in", async () => {
    const meta = { slot: 1, name: "A", level: 2, floor: 1, updatedAt: "t" };
    const store = createSaveStore({ fetch: fakeFetch(() => resp(200, { saves: [meta, null, null, null, null] })).fn, storage: fakeStorage() });
    const listing = await store.listSaves();
    expect(listing).toMatchObject({ source: "api", loggedIn: true, unauthorized: false });
    expect(listing.saves[0]).toEqual(meta);
  });

  it("ignores corrupt local records", async () => {
    const storage = fakeStorage();
    storage.map.set(`${LOCAL_SAVE_PREFIX}1`, "{not json");
    storage.map.set(`${LOCAL_SAVE_PREFIX}2`, JSON.stringify({ slot: 2 }));
    const store = createSaveStore({ fetch: null, storage });
    expect(await store.loadGame(1)).toBeNull();
    expect(await store.loadGame(2)).toBeNull();
    expect((await store.listSaves()).saves.every((s) => s === null)).toBe(true);
  });
});
