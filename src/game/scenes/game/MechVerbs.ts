/**
 * What the player's verbs mean for the tomb engine. Phaser-free so the logic can be tested:
 * search and listen chances, the ten-foot pole, who E talks to and what it does, vault areas for banners.
 */
import { d100, hearNoiseChance, searchChance, thiefSkill, type Rng } from "../../rules";
import { displayName, equipmentBonuses, type Inventory } from "../../items";
import type { ClassKey } from "../../items";
import { footprint } from "../../world/mechanisms";
import { VAULT_BY_ID } from "../../world/vaults";
import { TOMB, CELL } from "../../world/tomb";
import type { MechEvent, MechKind, MechRuntime, MechState, MechanismSpec } from "../../world/types";
import { itemDefKey, worldItemKey } from "./itemKeys";

/** The slice of the player the verbs read. `Player` satisfies it structurally. */
export interface VerbPlayer {
  stats: { classKey: ClassKey; level: number; facing: { x: number; y: number } };
  inventory: Inventory;
}

export const SEARCH_MS = 1200;

/** Percent chance (d100, lower is better) to notice something searching: class skill plus gear. */
export function findChance(p: VerbPlayer): number {
  return searchChance(p.stats.classKey, p.stats.level) + equipmentBonuses(p.inventory).findTrapsPct;
}

export function listenChance(p: VerbPlayer): number {
  return hearNoiseChance(p.stats.classKey, p.stats.level);
}

export function searchEvent(p: VerbPlayer, tx: number, ty: number, rng: Rng): MechEvent {
  return { type: "search", tx, ty, roll: d100(rng), chance: findChance(p) };
}

export function listenEvent(p: VerbPlayer, tx: number, ty: number, rng: Rng): MechEvent {
  return { type: "listen", tx, ty, roll: d100(rng), chance: listenChance(p) };
}

/** Facing as a unit step per axis (-1, 0 or 1), defaulting to "down". */
export function facingStep(f: { x: number; y: number }): { x: number; y: number } {
  const x = Math.sign(f.x);
  const y = Math.sign(f.y);
  return x === 0 && y === 0 ? { x: 0, y: 1 } : { x, y };
}

export type ProbePlan =
  | { ok: true; events: MechEvent[]; from: { tx: number; ty: number }; dir: { x: number; y: number } }
  | { ok: false; message: string };

/** P: the pole taps two tiles ahead, then the tile before it. Needs a ten-foot pole in the pack. */
export function probePlan(p: VerbPlayer, tx: number, ty: number): ProbePlan {
  if (!p.inventory.has("ten_foot_pole")) {
    return { ok: false, message: "You have no ten-foot pole to probe with." };
  }
  const d = facingStep(p.stats.facing);
  return {
    ok: true,
    from: { tx, ty },
    dir: d,
    events: [
      { type: "probe", tx: tx + d.x * 2, ty: ty + d.y * 2 },
      { type: "probe", tx: tx + d.x, ty: ty + d.y },
    ],
  };
}

// ── E: who, and what ─────────────────────────────────────────────────────────

const INTERACTABLE: ReadonlySet<MechKind> = new Set<MechKind>([
  "lever", "talking_face", "lure", "statue_offering", "riddle_door", "locked_door", "secret_door", "false_door",
  "illusory_wall", "inscription", "portcullis",
]);

const REACH = 1.5;

function usable(s: MechanismSpec, r: MechRuntime): boolean {
  if (!INTERACTABLE.has(s.kind)) return false;
  if (s.hidden && !r.revealed) return false;
  if ((s.kind === "riddle_door" || s.kind === "locked_door" || s.kind === "secret_door") && r.on) return false;
  return true;
}

/**
 * The nearest usable mechanism within 1.5 tiles, in front of the player (or underfoot).
 * `px`, `py` are the player's position in tile units (fractional).
 */
export function pickInteractTarget(
  state: MechState, px: number, py: number, facing: { x: number; y: number },
): MechanismSpec | null {
  const f = facingStep(facing);
  const fl = Math.hypot(f.x, f.y);
  let best: MechanismSpec | null = null;
  let bestD = Infinity;
  for (const s of state.specs) {
    const r = state.rt[s.id];
    if (!r || !usable(s, r)) continue;
    for (const q of footprint(s)) {
      const dx = q.tx + 0.5 - px;
      const dy = q.ty + 0.5 - py;
      const d = Math.hypot(dx, dy);
      if (d > REACH) continue;
      if (d >= 0.75 && (dx * f.x + dy * f.y) / (d * fl) < 0.35) continue;
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  return best;
}

export interface OfferOption {
  label: string;
  /** The world key sent with the `offer` verb (`iron_key`, not `key_iron`). */
  key: string;
}

export type InteractPlan =
  | { kind: "events"; events: MechEvent[] }
  /** Show the text on parchment. The `read` event is still sent, with its message suppressed. */
  | { kind: "read"; id: string; text: string; events: MechEvent[] }
  | { kind: "riddle"; id: string; prompt: string }
  | { kind: "offer"; id: string; options: OfferOption[] }
  | { kind: "message"; text: string };

/** Pack and belt items as offering options (equipped gear is not offered). */
export function offerOptions(inv: Inventory): OfferOption[] {
  const out: OfferOption[] = [];
  for (const it of [...inv.pack, ...inv.belt]) {
    if (it) out.push({ label: displayName(it), key: worldItemKey(it.defKey) });
  }
  return out;
}

export function planInteract(
  s: MechanismSpec, r: MechRuntime, p: VerbPlayer, rng: Rng,
): InteractPlan {
  const id = s.id;
  const inv = p.inventory;
  switch (s.kind) {
    case "inscription":
      return {
        kind: "read", id, text: s.clue ?? "The marks are too worn to read.",
        events: [{ type: "interact", id, verb: "read" }],
      };
    case "lever":
    case "portcullis":
      return { kind: "events", events: [{ type: "interact", id, verb: "pull" }] };
    case "talking_face":
    case "lure":
    case "illusory_wall":
      return { kind: "events", events: [{ type: "interact", id, verb: "touch" }] };
    case "false_door":
      return { kind: "events", events: [{ type: "interact", id, verb: "open" }] };
    case "secret_door":
      return { kind: "events", events: [{ type: "interact", id, verb: "push" }] };
    case "riddle_door":
      if (r.on) return { kind: "message", text: "The door stands open." };
      return { kind: "riddle", id, prompt: s.clue ?? "The door is sealed. Letters crawl across the lintel." };
    case "statue_offering": {
      if (r.on) return { kind: "events", events: [{ type: "interact", id, verb: "offer" }] };
      const options = offerOptions(inv);
      if (options.length === 0) return { kind: "message", text: "You have nothing to lay in its hands." };
      return { kind: "offer", id, options };
    }
    case "locked_door": {
      const open = (extra: Partial<Extract<MechEvent, { type: "interact" }>> = {}): MechEvent =>
        ({ type: "interact", id, verb: "open", ...extra });
      const par = s.params;
      if (par.seats) {
        const have = par.seats.filter((k) => !r.seated.includes(k) && inv.count(itemDefKey(k)) > 0);
        return { kind: "events", events: have.length > 0 ? have.map((k) => open({ itemKey: k })) : [open()] };
      }
      if (par.keyItem && inv.count(itemDefKey(par.keyItem)) > 0) {
        return { kind: "events", events: [open({ itemKey: par.keyItem })] };
      }
      if (p.stats.classKey === "thief" && !par.unpickable && inv.has("thieves_tools")) {
        const chance = thiefSkill(p.stats.classKey, p.stats.level, "openLocks");
        return { kind: "events", events: [open({ roll: d100(rng), chance })] };
      }
      return { kind: "events", events: [open()] };
    }
    default:
      return { kind: "message", text: "Nothing happens." };
  }
}

/** Short "E: ..." prompt for a nearby mechanism, or null when it should stay a surprise. */
export function promptFor(s: MechanismSpec, r: MechRuntime, alreadyRead: boolean): string | null {
  switch (s.kind) {
    case "inscription": return alreadyRead ? null : "E: read";
    case "talking_face": return "E: speak";
    case "statue_offering": return r.on ? null : "E: offer";
    case "lever": return "E: pull";
    case "riddle_door": return r.on ? null : "E: speak";
    case "locked_door": return r.on ? null : "E: open";
    default: return null;
  }
}

/** A closing-walls room that is running, with the player inside it holding iron spikes: the spikes event. */
export function spikeEvent(
  state: MechState, ptx: number, pty: number, inv: Inventory,
): MechEvent | null {
  if (inv.count("iron_spikes") < 1) return null;
  for (const s of state.specs) {
    if (s.kind !== "closing_walls" || !state.rt[s.id]?.on) continue;
    const z = s.params.zone;
    if (z && ptx >= z.tx && ptx < z.tx + z.w && pty >= z.ty && pty < z.ty + z.h) {
      return { type: "interact", id: s.id, verb: "offer", itemKey: "iron_spikes" };
    }
  }
  return null;
}

// ── Vault areas (for the name banner) ────────────────────────────────────────

export interface AreaDef {
  id: string;
  name: string;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

/** Bounding boxes of the vaults (or tomb chambers) on a floor, found from where their mechanisms ended up. */
export function vaultAreas(d: { mechanisms?: MechanismSpec[]; vaultIds?: string[] }): AreaDef[] {
  const out: AreaDef[] = [];
  const specs = d.mechanisms ?? [];
  for (const vid of d.vaultIds ?? []) {
    if (vid === TOMB.id) {
      for (const sp of TOMB.setPieces) {
        out.push({ id: sp.id, name: sp.name, tx: sp.cell[0] * CELL + 1, ty: sp.cell[1] * CELL + 1, w: CELL - 2, h: CELL - 2 });
      }
      continue;
    }
    const def = VAULT_BY_ID[vid];
    const anchor = def?.mechanisms[0];
    if (!def || !anchor) continue;
    const placed = specs.find((s) => s.id === anchor.id);
    if (!placed) continue;
    out.push({
      id: def.id, name: def.name, tx: placed.tx - anchor.tx, ty: placed.ty - anchor.ty, w: def.width, h: def.height,
    });
  }
  return out;
}

export function areaAt(areas: AreaDef[], tx: number, ty: number): AreaDef | undefined {
  return areas.find((a) => tx >= a.tx && tx < a.tx + a.w && ty >= a.ty && ty < a.ty + a.h);
}
