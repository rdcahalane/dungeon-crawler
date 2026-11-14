import { describe, expect, it } from "vitest";
import { hearNoiseChance, mulberry32, roll, searchChance, type Rng } from "../../rules";
import { Inventory, instantiate, makeItem, type ClassKey, type ItemInstance, type SaveCategory } from "../../items";
import { applyEvent, blockedTiles, createMechState, mechViews, mk, translateSpec } from "../../world/mechanisms";
import { goalMet } from "../../world/testkit";
import { TOMB } from "../../world/tomb";
import { VAULTS, VAULT_BY_ID } from "../../world/vaults";
import type { MechEffect, MechEvent, MechState, MechanismSpec } from "../../world/types";
import { MechDriver, type DriverHost } from "./MechDriver";
import { applyMechEffects, enemyKeyFor, type EffectPlayer, type MechTone } from "./MechEffects";
import {
  areaAt, findChance, listenChance, offerOptions, pickInteractTarget, planInteract, probePlan, promptFor, spikeEvent,
  vaultAreas, type VerbPlayer,
} from "./MechVerbs";

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakePlayer implements EffectPlayer, VerbPlayer {
  stats: { classKey: ClassKey; level: number; hp: number; facing: { x: number; y: number } };
  inventory: Inventory;
  damageTaken = 0;
  effects: string[] = [];
  /** Forced save outcome; undefined falls back to the rules table. */
  saveResult?: boolean;
  rollSave?: (category: SaveCategory, modifier?: number) => unknown;

  constructor(classKey: ClassKey = "fighter", level = 1, hp = 40) {
    this.stats = { classKey, level, hp, facing: { x: 1, y: 0 } };
    this.inventory = new Inventory(classKey);
  }
  takeDamage(amount: number): void {
    this.damageTaken += amount;
    this.stats.hp = Math.max(0, this.stats.hp - amount);
  }
  addEffect(key: "POISONED" | "SLOWED"): void {
    this.effects.push(key);
  }
  forceSave(result: boolean): this {
    this.rollSave = () => result;
    return this;
  }
}

class RecordingHost implements DriverHost {
  said: { text: string; tone: MechTone }[] = [];
  traps: string[] = [];
  killed: { cause: string; flavor: string }[] = [];
  tiles: { tx: number; ty: number; tile: number }[] = [];
  spawned: string[] = [];
  teleports: { tx: number; ty: number }[] = [];
  falls: number[] = [];
  dropped: ItemInstance[] = [];
  secrets = 0;
  constructor(readonly player: FakePlayer, readonly rng: Rng = mulberry32(3)) {}
  say(text: string, tone: MechTone): void { this.said.push({ text, tone }); }
  float(): void { /* no-op */ }
  killPlayer(cause: string, flavor: string): void { this.killed.push({ cause, flavor }); this.player.stats.hp = 0; }
  trap(type: string): void { this.traps.push(type); }
  setTile(tx: number, ty: number, tile: number): void { this.tiles.push({ tx, ty, tile }); }
  reveal(): void { /* no-op */ }
  spawn(monster: string): void { this.spawned.push(monster); }
  teleport(tx: number, ty: number): void { this.teleports.push({ tx, ty }); }
  fall(floors: number): void { this.falls.push(floors); }
  dropItem(item: ItemInstance): void { this.dropped.push(item); }
  sfx(): void { /* no-op */ }
  shake(): void { /* no-op */ }
  secretFound(): void { this.secrets++; }
}

const give = (inv: Inventory, defKey: string, qty = 1): ItemInstance => {
  const it = makeItem(defKey, mulberry32(9), qty);
  expect(inv.add(it).ok).toBe(true);
  return it;
};

const dmg = (dice: [number, number], extra: Partial<Extract<MechEffect, { type: "damage" }>> = {}): MechEffect =>
  ({ type: "damage", dice, cause: "a test trap", ...extra });

// ── Verbs ────────────────────────────────────────────────────────────────────

describe("probe, search and listen", () => {
  it("probing needs a ten-foot pole, then taps two tiles ahead and the one before it", () => {
    const p = new FakePlayer();
    const none = probePlan(p, 5, 5);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toMatch(/pole/i);

    give(p.inventory, "ten_foot_pole");
    const plan = probePlan(p, 5, 5);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.events).toEqual([
        { type: "probe", tx: 7, ty: 5 },
        { type: "probe", tx: 6, ty: 5 },
      ]);
    }
    p.stats.facing = { x: 0, y: -1 };
    const up = probePlan(p, 5, 5);
    if (up.ok) expect(up.events).toEqual([{ type: "probe", tx: 5, ty: 3 }, { type: "probe", tx: 5, ty: 4 }]);
  });

  it("a probe reveals a covered pit through the adapter", () => {
    const p = new FakePlayer();
    give(p.inventory, "ten_foot_pole");
    const pit = mk("covered_pit", "pit", { tx: 7, ty: 5 }, { hidden: true, params: { dice: [1, 6] } });
    const host = new RecordingHost(p);
    const driver = new MechDriver(createMechState([pit]), host, mulberry32(1));
    const plan = probePlan(p, 5, 5);
    if (!plan.ok) throw new Error("no plan");
    for (const ev of plan.events) driver.send(ev);
    expect(driver.state.rt.pit.revealed).toBe(true);
    expect(p.damageTaken).toBe(0);
  });

  it("search chance composes the class skill and the item bonus", () => {
    const fighter = new FakePlayer("fighter", 1);
    expect(findChance(fighter)).toBe(searchChance("fighter", 1));
    const thief = new FakePlayer("thief", 3);
    expect(findChance(thief)).toBe(searchChance("thief", 3));
    expect(findChance(thief)).toBeGreaterThan(findChance(fighter));

    const ring = instantiate("ring", "r1", {
      affixes: [{ key: "keen", label: "of Seeking", position: "suffix", effect: { type: "findTraps", pct: 10 } }],
    });
    expect(thief.inventory.add(ring).ok).toBe(true);
    expect(thief.inventory.equip("r1").ok).toBe(true);
    expect(findChance(thief)).toBe(searchChance("thief", 3) + 10);
  });

  it("listen uses the hear-noise chance", () => {
    expect(listenChance(new FakePlayer("thief", 5))).toBeGreaterThan(listenChance(new FakePlayer("wizard", 5)));
    expect(listenChance(new FakePlayer("fighter", 1))).toBe(hearNoiseChance("fighter", 1));
  });
});

// ── Effects ──────────────────────────────────────────────────────────────────

describe("effect resolution", () => {
  const dice = (seed: number, c: number, s: number, b = 0): number => roll(mulberry32(seed), c, s, b);

  it("damage rolls the dice and hurts", () => {
    const p = new FakePlayer();
    const host = new RecordingHost(p, mulberry32(21));
    applyMechEffects([dmg([2, 6], { bonus: 1 })], host);
    expect(p.damageTaken).toBe(dice(21, 2, 6, 1));
    expect(host.traps).toContain("mech_damage");
  });

  it("damage with a save halves on success and is full on failure", () => {
    const full = dice(5, 3, 6);
    const ok = new FakePlayer().forceSave(true);
    applyMechEffects([dmg([3, 6], { save: "breath", saveHalves: true })], new RecordingHost(ok, mulberry32(5)));
    expect(ok.damageTaken).toBe(Math.floor(full / 2));

    const bad = new FakePlayer().forceSave(false);
    applyMechEffects([dmg([3, 6], { save: "breath", saveHalves: true })], new RecordingHost(bad, mulberry32(5)));
    expect(bad.damageTaken).toBe(full);

    const dodge = new FakePlayer().forceSave(true);
    applyMechEffects([dmg([3, 6], { save: "breath", saveHalves: false })], new RecordingHost(dodge, mulberry32(5)));
    expect(dodge.damageTaken).toBe(0);
  });

  it("falls back to the rules save table when the player has no rollSave", () => {
    // A level 1 fighter saves vs breath on 17+: with a seeded run the outcome must match the table, never throw.
    const p = new FakePlayer("fighter", 1, 200);
    const host = new RecordingHost(p, mulberry32(77));
    applyMechEffects([dmg([2, 4], { save: "breath", saveHalves: true })], host);
    expect(p.damageTaken).toBeGreaterThanOrEqual(0);
    expect(host.killed).toEqual([]);
  });

  it("save_or_die kills only on a failed save", () => {
    const dead = new FakePlayer().forceSave(false);
    const h1 = new RecordingHost(dead);
    const r1 = applyMechEffects([{ type: "save_or_die", save: "petrify", cause: "the idol" }], h1);
    expect(r1.died).toBe(true);
    expect(h1.killed).toHaveLength(1);
    expect(h1.killed[0].cause).toBe("the idol");
    expect(h1.killed[0].flavor).toMatch(/stone/i);
    expect(dead.stats.hp).toBe(0);

    const lives = new FakePlayer().forceSave(true);
    const h2 = new RecordingHost(lives);
    const r2 = applyMechEffects([{ type: "save_or_die", save: "petrify", cause: "the idol" }], h2);
    expect(r2.died).toBe(false);
    expect(h2.killed).toEqual([]);
    expect(lives.stats.hp).toBe(40);
    expect(h2.said.some((s) => /resist/i.test(s.text))).toBe(true);
  });

  it("stops applying effects once the player has died", () => {
    const p = new FakePlayer("fighter", 1, 1);
    const host = new RecordingHost(p, mulberry32(2));
    applyMechEffects([dmg([4, 6], { bonus: 10 }), { type: "message", text: "after", tone: "info" }], host);
    expect(p.stats.hp).toBe(0);
    expect(host.said.some((s) => s.text === "after")).toBe(false);
    expect(host.said.some((s) => /Slain by a test trap/.test(s.text))).toBe(true);
  });

  it("grant and consume use the world key aliases", () => {
    const p = new FakePlayer();
    const host = new RecordingHost(p);
    applyMechEffects([{ type: "grant", itemKey: "iron_key", tx: 1, ty: 1 }], host);
    expect(p.inventory.count("key_iron")).toBe(1);
    applyMechEffects([{ type: "grant", itemKey: "key_crown", tx: 1, ty: 1 }], host);
    expect(p.inventory.count("key_crown")).toBe(1);

    applyMechEffects([{ type: "consume", itemKey: "iron_key" }], host);
    expect(p.inventory.count("key_iron")).toBe(0);
    applyMechEffects([{ type: "consume", itemKey: "key_crown" }], host);
    expect(p.inventory.count("key_crown")).toBe(0);
    // consuming what you do not have is harmless
    expect(() => applyMechEffects([{ type: "consume", itemKey: "iron_key" }], host)).not.toThrow();
  });

  it("a full pack drops the granted item at the tile", () => {
    const p = new FakePlayer();
    for (let i = 0; i < 24; i++) expect(p.inventory.add(instantiate("dagger", `d${i}`)).ok).toBe(true);
    const host = new RecordingHost(p);
    applyMechEffects([{ type: "grant", itemKey: "iron_key", tx: 4, ty: 9 }], host);
    expect(host.dropped).toHaveLength(1);
    expect(host.dropped[0].defKey).toBe("key_iron");
  });

  it("an unknown grant key does not crash and says so", () => {
    const p = new FakePlayer();
    const host = new RecordingHost(p);
    applyMechEffects([{ type: "grant", itemKey: "mystery_gizmo", tx: 0, ty: 0 }], host);
    expect(host.said).toHaveLength(1);
  });

  it("status maps poison and slow, resists on a good save, and falls get hurt", () => {
    const p = new FakePlayer().forceSave(false);
    const host = new RecordingHost(p, mulberry32(8));
    applyMechEffects([
      { type: "status", key: "poisoned", durationMs: 60000, save: "death" },
      { type: "status", key: "slowed", durationMs: 4000 },
      { type: "status", key: "cursed", durationMs: 1000 },
    ], host);
    expect(p.effects).toEqual(["POISONED", "SLOWED"]);

    const saver = new FakePlayer().forceSave(true);
    applyMechEffects([{ type: "status", key: "poisoned", durationMs: 1000, save: "death" }], new RecordingHost(saver));
    expect(saver.effects).toEqual([]);

    const faller = new FakePlayer();
    const fh = new RecordingHost(faller, mulberry32(4));
    const r = applyMechEffects([{ type: "fall", floors: 2, dice: [1, 6] }], fh);
    expect(r.leftFloor).toBe(true);
    expect(fh.falls).toEqual([2]);
    expect(faller.damageTaken).toBeGreaterThan(0);

    const pit = new FakePlayer();
    const ph = new RecordingHost(pit, mulberry32(4));
    const r2 = applyMechEffects([{ type: "fall", floors: 0, dice: [1, 6] }], ph);
    expect(r2.leftFloor).toBe(false);
    expect(ph.falls).toEqual([]);
  });

  it("spawn names map to legacy enemies, unknown ones to skeletons", () => {
    expect(enemyKeyFor("skeleton")).toBe("SKELETON");
    expect(enemyKeyFor("giant spider")).toBe("GIANT_SPIDER");
    expect(enemyKeyFor("wight")).toBe("SKELETON");
  });

  it("every item the vaults and the tomb grant resolves to a real item", () => {
    const grants = new Set<string>();
    for (const s of [...VAULTS.flatMap((v) => v.mechanisms), ...TOMB.mechanisms]) if (s.params.grant) grants.add(s.params.grant);
    const p = new FakePlayer();
    const host = new RecordingHost(p);
    for (const g of grants) {
      applyMechEffects([{ type: "grant", itemKey: g, tx: 0, ty: 0 }], host);
    }
    expect(host.said.filter((s) => /comes apart/.test(s.text)), "grants without an item def").toEqual([]);
  });
});

// ── Replays ──────────────────────────────────────────────────────────────────

function replayThrough(specs: MechanismSpec[], events: MechEvent[], p: FakePlayer): { driver: MechDriver; host: RecordingHost } {
  const host = new RecordingHost(p, mulberry32(11));
  const driver = new MechDriver(createMechState(specs), host, mulberry32(7));
  for (const ev of events) driver.send(ev);
  return { driver, host };
}

const blocksAnywhere = (state: MechState, id: string): boolean => mechViews(state).some((v) => v.id === id && v.blocks);

describe("replaying the intended solutions through the adapter", () => {
  it("every vault solution opens its way and costs nothing", () => {
    for (const v of VAULTS) {
      const p = new FakePlayer("fighter", 1, 60);
      const { driver, host } = replayThrough(v.mechanisms, v.solution, p);
      expect(goalMet(driver.state, v.goal), `${v.id} goal`).toBe(true);
      expect(p.damageTaken, `${v.id} damage`).toBe(0);
      expect(p.stats.hp, `${v.id} alive`).toBe(60);
      expect(host.killed, `${v.id} killed`).toEqual([]);
      expect(host.spawned, `${v.id} spawned`).toEqual([]);
      if (v.goal.kind === "open") expect(blocksAnywhere(driver.state, v.goal.id), `${v.id} still blocks`).toBe(false);
    }
  });

  it("two named vaults unblock their gate tile", () => {
    for (const id of ["two_levers", "weighing_hall"]) {
      const v = VAULT_BY_ID[id];
      const p = new FakePlayer("fighter", 1, 60);
      const gate = v.goal.id;
      const before = createMechState(v.mechanisms);
      const wasBlocked = [...blockedTiles(before)].length;
      const { driver } = replayThrough(v.mechanisms, v.solution, p);
      expect(blocksAnywhere(driver.state, gate)).toBe(false);
      expect(blockedTiles(driver.state).size).toBeLessThan(wasBlocked);
      expect(p.damageTaken).toBe(0);
    }
  });

  it("every careless path hurts, kills, curses or spawns something", () => {
    for (const v of VAULTS) {
      const p = new FakePlayer("fighter", 1, 200).forceSave(false);
      const { host } = replayThrough(v.mechanisms, v.carelessPath, p);
      const hurt = p.damageTaken > 0 || host.killed.length > 0 || host.spawned.length > 0 || host.falls.length > 0
        || p.effects.length > 0 || host.traps.length > 0;
      expect(hurt, v.id).toBe(true);
    }
  });

  it("the tomb solution ends with the key door open, the key parts seated, and no damage", () => {
    const p = new FakePlayer("fighter", 1, 60);
    const { driver, host } = replayThrough(TOMB.mechanisms, TOMB.solution, p);
    expect(driver.state.rt[TOMB.keyDoorId].on).toBe(true);
    expect(blocksAnywhere(driver.state, TOMB.keyDoorId)).toBe(false);
    expect(p.damageTaken).toBe(0);
    expect(host.killed).toEqual([]);
    expect(host.spawned).toEqual([]);
    for (const part of TOMB.keyParts) expect(p.inventory.count(part), `${part} left in pack`).toBe(0);
    // gate tile no longer blocked
    const door = TOMB.mechanisms.find((s) => s.id === TOMB.keyDoorId)!;
    expect(blockedTiles(driver.state).has(`${door.tx},${door.ty}`)).toBe(false);
  });

  it("a secret door found through the adapter raises the legacy event once", () => {
    const v = VAULT_BY_ID.false_and_true;
    const p = new FakePlayer("fighter", 1, 60);
    const { host } = replayThrough(v.mechanisms, v.solution, p);
    expect(host.secrets).toBe(1);
  });

  it("a monster or an item stepping on a closing-walls stone does not start the room", () => {
    const v = VAULT_BY_ID.narrowing_cell;
    const room = v.mechanisms.find((s) => s.kind === "closing_walls")!;
    const state = createMechState(v.mechanisms);
    const rng = mulberry32(2);
    for (const weight of ["monster", "item"] as const) {
      const fx = applyEvent(state, { type: "step", tx: room.tx, ty: room.ty, weight }, rng);
      expect(fx).toEqual([]);
      expect(state.rt[room.id].on).toBe(false);
    }
    const fx = applyEvent(state, { type: "step", tx: room.tx, ty: room.ty, weight: "player" }, rng);
    expect(fx.length).toBeGreaterThan(0);
    expect(state.rt[room.id].on).toBe(true);
  });
});

// ── Interaction planning ─────────────────────────────────────────────────────

describe("E: who and what", () => {
  const lock = (params: MechanismSpec["params"]): MechanismSpec => mk("locked_door", "door", { tx: 6, ty: 5 }, { params });
  const stateOf = (s: MechanismSpec): MechState => createMechState([s]);

  it("a locked door takes the key from the pack under its world name", () => {
    const spec = lock({ keyItem: "iron_key" });
    const st = stateOf(spec);
    const p = new FakePlayer();
    const none = planInteract(spec, st.rt.door, p, mulberry32(1));
    expect(none).toEqual({ kind: "events", events: [{ type: "interact", id: "door", verb: "open" }] });

    give(p.inventory, "key_iron");
    const withKey = planInteract(spec, st.rt.door, p, mulberry32(1));
    expect(withKey).toEqual({ kind: "events", events: [{ type: "interact", id: "door", verb: "open", itemKey: "iron_key" }] });

    // and it really opens
    const host = new RecordingHost(p);
    const driver = new MechDriver(st, host, mulberry32(1));
    if (withKey.kind === "events") for (const ev of withKey.events) driver.send(ev);
    expect(st.rt.door.on).toBe(true);
    expect(p.inventory.count("key_iron")).toBe(0);
  });

  it("a thief with picks rolls instead; without picks or on an unpickable lock it does not", () => {
    const spec = lock({ keyItem: "iron_key", lockDiff: 5 });
    const st = stateOf(spec);
    const thief = new FakePlayer("thief", 1);
    const bare = planInteract(spec, st.rt.door, thief, mulberry32(1));
    expect(bare).toEqual({ kind: "events", events: [{ type: "interact", id: "door", verb: "open" }] });

    give(thief.inventory, "thieves_tools");
    const picks = planInteract(spec, st.rt.door, thief, mulberry32(1));
    expect(picks.kind).toBe("events");
    if (picks.kind === "events") {
      const ev = picks.events[0];
      expect(ev.type === "interact" && ev.chance).toBe(26);
      expect(ev.type === "interact" && typeof ev.roll === "number").toBe(true);
    }

    const stuck = lock({ keyItem: "iron_key", unpickable: true });
    const plan = planInteract(stuck, stateOf(stuck).rt.door, thief, mulberry32(1));
    expect(plan).toEqual({ kind: "events", events: [{ type: "interact", id: "door", verb: "open" }] });
  });

  it("a part-by-part door seats every part you carry", () => {
    const spec = lock({ seats: ["key_crown", "key_seal", "key_tooth"] });
    const st = stateOf(spec);
    const p = new FakePlayer();
    give(p.inventory, "key_crown");
    give(p.inventory, "key_tooth");
    const plan = planInteract(spec, st.rt.door, p, mulberry32(1));
    expect(plan.kind === "events" && plan.events.map((e) => (e.type === "interact" ? e.itemKey : ""))).toEqual(["key_crown", "key_tooth"]);
  });

  it("a statue offers the pack as a list under world keys, and a riddle door asks for words", () => {
    const statue = mk("statue_offering", "st", { tx: 3, ty: 3 }, { params: { wants: "iron_key" } });
    const st = stateOf(statue);
    const p = new FakePlayer();
    expect(planInteract(statue, st.rt.st, p, mulberry32(1)).kind).toBe("message");
    give(p.inventory, "key_iron");
    give(p.inventory, "torch");
    const plan = planInteract(statue, st.rt.st, p, mulberry32(1));
    expect(plan.kind).toBe("offer");
    if (plan.kind === "offer") expect(plan.options.map((o) => o.key)).toContain("iron_key");
    expect(offerOptions(p.inventory).map((o) => o.key)).toEqual(expect.arrayContaining(["iron_key", "torch"]));

    // offering the right thing through the adapter satisfies the statue and takes the key from the pack
    const host = new RecordingHost(p);
    const driver = new MechDriver(st, host, mulberry32(1));
    driver.send({ type: "interact", id: "st", verb: "offer", itemKey: "iron_key" });
    expect(st.rt.st.on).toBe(true);
    expect(p.inventory.count("key_iron")).toBe(0);

    const riddle = mk("riddle_door", "rd", { tx: 8, ty: 3 }, { params: { answers: ["time"] }, clue: "What eats all things?" });
    const rs = stateOf(riddle);
    expect(planInteract(riddle, rs.rt.rd, p, mulberry32(1))).toEqual({ kind: "riddle", id: "rd", prompt: "What eats all things?" });
  });

  it("an inscription is read on parchment and prompts only until it is read", () => {
    const ins = mk("inscription", "ins", { tx: 4, ty: 4 }, { clue: "Left, then right." });
    const st = stateOf(ins);
    const plan = planInteract(ins, st.rt.ins, new FakePlayer(), mulberry32(1));
    expect(plan.kind).toBe("read");
    if (plan.kind === "read") expect(plan.text).toBe("Left, then right.");
    expect(promptFor(ins, st.rt.ins, false)).toBe("E: read");
    expect(promptFor(ins, st.rt.ins, true)).toBeNull();
    // a lure stays a surprise
    const lure = mk("lure", "lu", { tx: 4, ty: 6 });
    expect(promptFor(lure, createMechState([lure]).rt.lu, false)).toBeNull();
  });

  it("picks the nearest usable mechanism in front, not behind or out of reach", () => {
    const lever = mk("lever", "lv", { tx: 6, ty: 5 });
    const far = mk("lever", "far", { tx: 9, ty: 5 });
    const hidden = mk("lever", "hid", { tx: 5, ty: 4 }, { hidden: true });
    const st = createMechState([lever, far, hidden]);
    // player at the centre of (5,5), facing east
    expect(pickInteractTarget(st, 5.5, 5.5, { x: 1, y: 0 })?.id).toBe("lv");
    // facing west, the lever is behind
    expect(pickInteractTarget(st, 5.5, 5.5, { x: -1, y: 0 })).toBeNull();
    // the hidden one is ignored until revealed
    st.rt.hid.revealed = true;
    expect(pickInteractTarget(st, 5.5, 5.5, { x: 0, y: -1 })?.id).toBe("hid");
  });

  it("iron spikes go into a running closing-walls room the player is standing in", () => {
    const v = VAULT_BY_ID.narrowing_cell;
    const room = v.mechanisms.find((s) => s.kind === "closing_walls")!;
    const st = createMechState(v.mechanisms);
    const p = new FakePlayer();
    const z = room.params.zone!;
    expect(spikeEvent(st, z.tx, z.ty, p.inventory)).toBeNull();
    give(p.inventory, "iron_spikes", 3);
    expect(spikeEvent(st, z.tx, z.ty, p.inventory)).toBeNull(); // room is not running yet
    st.rt[room.id].on = true;
    expect(spikeEvent(st, z.tx, z.ty, p.inventory)).toEqual({ type: "interact", id: room.id, verb: "offer", itemKey: "iron_spikes" });
    expect(spikeEvent(st, z.tx - 5, z.ty - 5, p.inventory)).toBeNull();
  });
});

describe("vault banners", () => {
  it("finds where a stamped vault landed from where its mechanisms ended up", () => {
    const v = VAULT_BY_ID.two_levers;
    const specs = v.mechanisms.map((s) => translateSpec(s, 10, 12));
    const areas = vaultAreas({ mechanisms: specs, vaultIds: [v.id] });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ name: v.name, tx: 10, ty: 12, w: v.width, h: v.height });
    expect(areaAt(areas, 10 + 1, 12 + 1)?.name).toBe(v.name);
    expect(areaAt(areas, 9, 12)).toBeUndefined();
  });

  it("gives every tomb chamber a named area", () => {
    const areas = vaultAreas({ mechanisms: TOMB.mechanisms, vaultIds: [TOMB.id] });
    expect(areas.length).toBe(TOMB.setPieces.length);
    expect(areaAt(areas, TOMB.playerStart.tx, TOMB.playerStart.ty)).toBeDefined();
  });
});
