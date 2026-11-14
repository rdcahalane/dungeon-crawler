import { describe, expect, it } from "vitest";
import { mulberry32 } from "../rules/dice";
import { VAULTS, vaultsForFloor } from "./vaults";
import {
  FALSE_RUMORS, TOMB_RUMORS, TRUE_SHARE, VAULT_RUMORS, tellRumor, trueRumorsFor,
} from "./rumors";

const all = [...Object.values(VAULT_RUMORS), ...TOMB_RUMORS, ...FALSE_RUMORS];
const ids = (floor: number) => vaultsForFloor(floor).map((v) => v.id);

describe("rumour tables", () => {
  it("has a true rumour for every vault and none for a vault that does not exist", () => {
    for (const v of VAULTS) expect(VAULT_RUMORS[v.id], v.id).toBeTruthy();
    for (const id of Object.keys(VAULT_RUMORS)) expect(VAULTS.some((v) => v.id === id), id).toBe(true);
  });

  it("has ten or more false rumours and three about the tomb", () => {
    expect(FALSE_RUMORS.length).toBeGreaterThanOrEqual(10);
    expect(TOMB_RUMORS).toHaveLength(3);
  });

  it("every rumour is one or two sentences of printable ASCII, and none repeat", () => {
    for (const t of all) {
      expect(/^[\x20-\x7e]+$/.test(t), t).toBe(true);
      const sentences = t.split(/[.!?]+\s+/).filter(Boolean);
      expect(sentences.length, t).toBeLessThanOrEqual(2);
      expect(t.length, t).toBeLessThan(200);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses no names from published games", () => {
    for (const t of all) expect(/acererak|beholder|mind flayer|displacer|owlbear|horrors/i.test(t), t).toBe(false);
  });
});

describe("tellRumor", () => {
  it("tells roughly two in three truths on a floor with vaults", () => {
    const rng = mulberry32(12345);
    let truths = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) if (tellRumor(3, ids(3), rng).kind !== "false") truths++;
    const share = truths / n;
    expect(share).toBeGreaterThan(TRUE_SHARE - 0.05);
    expect(share).toBeLessThan(TRUE_SHARE + 0.05);
  });

  it("a true vault rumour only ever names a vault the floor may hold", () => {
    const rng = mulberry32(7);
    const pool = ids(2);
    for (let i = 0; i < 500; i++) {
      const r = tellRumor(2, pool, rng);
      if (r.kind === "vault") expect(pool).toContain(r.vaultId);
      if (r.kind === "vault") expect(r.text).toBe(VAULT_RUMORS[r.vaultId!]);
    }
  });

  it("gives false rumours when the pool is empty (floor 1 with no vaults offered)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) expect(tellRumor(1, [], rng).kind).toBe("false");
  });

  it("talks about the tomb from the deep floors, and only the tomb on the last one", () => {
    expect(trueRumorsFor(3, ids(3)).some((r) => r.kind === "tomb")).toBe(false);
    expect(trueRumorsFor(10, ids(10)).filter((r) => r.kind === "tomb")).toHaveLength(3);
    const last = trueRumorsFor(13, VAULTS.map((v) => v.id));
    expect(last.length).toBe(3);
    expect(last.every((r) => r.kind === "tomb")).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const a = tellRumor(5, ids(5), mulberry32(99));
    const b = tellRumor(5, ids(5), mulberry32(99));
    expect(a).toEqual(b);
  });

  it("works with an rng that returns the extremes", () => {
    expect(() => tellRumor(5, ids(5), { next: () => 0 })).not.toThrow();
    expect(() => tellRumor(5, ids(5), { next: () => 0.999999999 })).not.toThrow();
    expect(tellRumor(5, ids(5), { next: () => 0.999999999 }).kind).toBe("false");
  });
});
