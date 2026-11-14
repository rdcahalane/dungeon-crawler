// The tomb engine: a pure, serializable mechanism state machine.
// Events go in (what the player or the world did), effects come out (what the scene must show or apply).
// No Phaser, no ambient randomness: every roll that is not carried by an event comes from the Rng handed in.
//
// Conventions the scene must follow
//  * Emit `step` for the player on every tile entered (the engine only knows where the player is from steps and teleports).
//    Emit `step` with weight 'item' when an item lands on a tile, 'monster' for monsters. Emit `leave` when the player or a
//    dropped item leaves a tile (a plate counts the things on it). Do not emit a step for the tile a `teleport` effect lands on.
//  * search/listen carry the tile the player stands on; the engine looks one tile around it.
//  * `probe` carries the tile the ten-foot pole taps.
//  * Drawing and blocking: see mechViews / mechView / blockedTiles / tileOverrides at the bottom of this file.

import { TILE } from '../constants';
import type {
  MechEffect, MechEvent, MechKind, MechParams, MechRuntime, MechState, MechView, MechanismSpec, Pos, Rect, Rng,
} from './types';

// ── Builders and small helpers ───────────────────────────────────────────────

export interface MkOpts {
  tiles?: Pos[];
  params?: MechParams;
  links?: string[];
  hidden?: boolean;
  clue?: string;
  diff?: number;
}

export function mk(kind: MechKind, id: string, at: Pos, o: MkOpts = {}): MechanismSpec {
  return {
    id, kind, tx: at.tx, ty: at.ty,
    tiles: o.tiles,
    params: o.params ?? {},
    links: o.links ?? [],
    hidden: o.hidden ?? false,
    clue: o.clue,
    searchDifficulty: o.diff ?? 0,
  };
}

export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

const msg = (text: string, tone: 'clue' | 'danger' | 'info'): MechEffect => ({ type: 'message', text, tone });
const sfx = (key: string): MechEffect => ({ type: 'sfx', key });

function inRect(p: Pos | null, r: Rect | undefined): boolean {
  if (!p || !r) return false;
  return p.tx >= r.tx && p.tx < r.tx + r.w && p.ty >= r.ty && p.ty < r.ty + r.h;
}

const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));

export function normalizeAnswer(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  while (words.length > 1 && (words[0] === 'the' || words[0] === 'a' || words[0] === 'an')) words.shift();
  return words.join(' ');
}

/** Tiles that make a mechanism "stand" somewhere: primary plus extras. */
export function footprint(s: MechanismSpec): Pos[] {
  return [{ tx: s.tx, ty: s.ty }, ...(s.tiles ?? [])];
}

/** Tiles that fire the mechanism when stepped on or probed. */
function trigTiles(s: MechanismSpec): Pos[] {
  if (s.kind === 'dart_wall' || s.kind === 'gas_room') return s.tiles ?? [];
  return footprint(s);
}

/** Every tile a search or listen next to the mechanism can notice. */
function senseTiles(s: MechanismSpec): Pos[] {
  const out = footprint(s);
  if (s.params.door) out.push(s.params.door);
  return out;
}

const hasTile = (list: Pos[], tx: number, ty: number): boolean => list.some((p) => p.tx === tx && p.ty === ty);

const indexCache = new WeakMap<MechanismSpec[], Map<string, MechanismSpec>>();
function specOf(state: MechState, id: string): MechanismSpec | undefined {
  let m = indexCache.get(state.specs);
  if (!m) {
    m = new Map(state.specs.map((s) => [s.id, s]));
    indexCache.set(state.specs, m);
  }
  return m.get(id);
}

function rtOf(state: MechState, id: string): MechRuntime {
  return state.rt[id];
}

const visibleNow = (s: MechanismSpec, r: MechRuntime): boolean => !s.hidden || r.revealed;

function searchable(s: MechanismSpec): boolean {
  return s.hidden || s.kind === 'false_door' || (s.kind === 'locked_door' && !!s.params.needle);
}

/** A mechanism whose failure kills or nearly kills: it must carry a readable clue. */
export function isLethal(s: MechanismSpec): boolean {
  if (s.kind === 'lure' || s.kind === 'closing_walls' || s.kind === 'gas_room') return true;
  if (s.params.lethal) return true;
  return !!s.params.dice && s.params.dice[0] >= 3 && s.kind !== 'inscription';
}

// ── State ────────────────────────────────────────────────────────────────────

export function createMechState(specs: MechanismSpec[]): MechState {
  const seen = new Set<string>();
  const rt: Record<string, MechRuntime> = {};
  for (const s of specs) {
    if (seen.has(s.id)) throw new Error(`duplicate mechanism id ${s.id}`);
    seen.add(s.id);
    rt[s.id] = freshRuntime(s);
  }
  return { specs, rt, flags: {}, clockMs: 0, playerAt: null, tileLog: {} };
}

function freshRuntime(s: MechanismSpec): MechRuntime {
  return {
    id: s.id,
    revealed: false,
    on: s.kind === 'portcullis' && !!s.params.startOpen,
    spent: false,
    timerMs: 0,
    progress: 0,
    held: 0,
    count: 0,
    seated: [],
    stage: 0,
  };
}

interface SavedState {
  v: 1;
  rt: Record<string, MechRuntime>;
  flags: Record<string, boolean>;
  clockMs: number;
  playerAt: Pos | null;
  tileLog: Record<string, number>;
}

/** Dynamic state only: the static specs live in the saved floor already. */
export function serialize(state: MechState): string {
  const saved: SavedState = {
    v: 1, rt: state.rt, flags: state.flags, clockMs: state.clockMs, playerAt: state.playerAt, tileLog: state.tileLog,
  };
  return JSON.stringify(saved);
}

export function deserialize(json: string, specs: MechanismSpec[]): MechState {
  const saved = JSON.parse(json) as SavedState;
  const base = createMechState(specs);
  for (const s of specs) {
    const r = saved.rt[s.id];
    if (r) base.rt[s.id] = { ...freshRuntime(s), ...r, seated: [...(r.seated ?? [])] };
  }
  base.flags = { ...saved.flags };
  base.clockMs = saved.clockMs ?? 0;
  base.playerAt = saved.playerAt ? { ...saved.playerAt } : null;
  base.tileLog = { ...saved.tileLog };
  return base;
}

// ── Spec and event translation (vault-local to dungeon coordinates) ──────────

const POS_PARAMS = ['dest', 'trigger', 'door', 'spawnAt'] as const;

export function translateSpec(s: MechanismSpec, dx: number, dy: number): MechanismSpec {
  const params: MechParams = { ...s.params };
  for (const k of POS_PARAMS) {
    const p = params[k];
    if (p) params[k] = { tx: p.tx + dx, ty: p.ty + dy };
  }
  if (params.zone) params.zone = { ...params.zone, tx: params.zone.tx + dx, ty: params.zone.ty + dy };
  return {
    ...s,
    tx: s.tx + dx,
    ty: s.ty + dy,
    tiles: s.tiles?.map((p) => ({ tx: p.tx + dx, ty: p.ty + dy })),
    params,
    links: [...s.links],
  };
}

export function translateEvent(ev: MechEvent, dx: number, dy: number): MechEvent {
  switch (ev.type) {
    case 'step': case 'leave': case 'probe': case 'search': case 'listen':
      return { ...ev, tx: ev.tx + dx, ty: ev.ty + dy };
    default:
      return ev;
  }
}

// ── Effects plumbing ─────────────────────────────────────────────────────────

function setTile(state: MechState, effs: MechEffect[], tx: number, ty: number, tile: number): void {
  state.tileLog[tileKey(tx, ty)] = tile;
  effs.push({ type: 'set_tile', tx, ty, tile });
}

function reveal(state: MechState, s: MechanismSpec, effs: MechEffect[], text?: string): void {
  const r = rtOf(state, s.id);
  if (r.revealed) return;
  r.revealed = true;
  effs.push({ type: 'reveal', id: s.id });
  effs.push(sfx('discover'));
  const t = text ?? s.clue;
  if (t) effs.push(msg(t, 'clue'));
}

function grantReward(s: MechanismSpec, effs: MechEffect[]): void {
  if (!s.params.grant) return;
  const at = s.params.spawnAt ?? { tx: s.tx, ty: s.ty };
  effs.push({ type: 'grant', itemKey: s.params.grant, tx: at.tx, ty: at.ty });
}

/** A puzzle finished: act on links and hand out the reward. */
function solved(state: MechState, s: MechanismSpec, effs: MechEffect[], rng: Rng): void {
  setLinks(state, s, true, effs, rng);
  grantReward(s, effs);
}

function setLinks(state: MechState, src: MechanismSpec, active: boolean, effs: MechEffect[], rng: Rng): void {
  const starter = src.kind === 'pressure_plate';
  for (const id of src.links) {
    const t = specOf(state, id);
    if (t) setActive(state, t, active, starter, effs, rng);
  }
  if (active) {
    for (const id of src.params.fires ?? []) {
      const t = specOf(state, id);
      if (t) setActive(state, t, true, true, effs, rng);
    }
  }
}

function setDoor(state: MechState, t: MechanismSpec, open: boolean, effs: MechEffect[]): void {
  const r = rtOf(state, t.id);
  if (r.on === open) return;
  r.on = open;
  r.revealed = true;
  effs.push(sfx(open ? 'portcullis_up' : 'portcullis_down'));
  effs.push(msg(open ? 'Iron grinds upward: the way is open.' : 'A grate crashes down across the way.', open ? 'info' : 'danger'));
}

function setWall(state: MechState, t: MechanismSpec, open: boolean, effs: MechEffect[]): void {
  const r = rtOf(state, t.id);
  if (r.on === open) return;
  r.on = open;
  r.revealed = true;
  for (const p of footprint(t)) setTile(state, effs, p.tx, p.ty, open ? TILE.FLOOR : TILE.WALL);
  effs.push(sfx('stone_slide'));
  effs.push(msg(open ? 'A slab of wall slides aside.' : 'The wall slides shut.', 'info'));
}

function setActive(
  state: MechState, t: MechanismSpec, active: boolean, starter: boolean, effs: MechEffect[], rng: Rng,
): void {
  const r = rtOf(state, t.id);
  switch (t.kind) {
    case 'portcullis':
      setDoor(state, t, active, effs);
      break;
    case 'sliding_wall':
      setWall(state, t, active, effs);
      break;
    case 'secret_door':
      if (active && !r.on) openSecret(state, t, effs);
      break;
    case 'illusory_wall':
      if (active) reveal(state, t, effs, t.clue ?? 'The wall shivers and is gone: it was only a picture of stone.');
      break;
    case 'dart_wall':
      if (starter) {
        if (active) fireDart(state, t, effs);
      } else {
        r.on = active;
        if (active) effs.push(msg('Something goes slack inside the wall.', 'info'));
      }
      break;
    case 'gas_room':
      if (starter) {
        if (active) startGas(state, t, effs);
      } else if (active) {
        ventGas(state, t, effs, 'lever');
      }
      break;
    case 'closing_walls':
      if (starter) {
        if (active) startClosing(state, t, effs);
      } else if (active) {
        stopClosing(state, t, effs, rng, 'lever');
      }
      break;
    default:
      break;
  }
}

function openSecret(state: MechState, s: MechanismSpec, effs: MechEffect[]): void {
  const r = rtOf(state, s.id);
  r.on = true;
  r.revealed = true;
  for (const p of footprint(s)) setTile(state, effs, p.tx, p.ty, TILE.FLOOR);
  effs.push(sfx('stone_slide'));
  effs.push(msg('The slab pivots on a hidden pin and a passage opens.', 'info'));
}

// ── Darts ────────────────────────────────────────────────────────────────────

function fireDart(state: MechState, s: MechanismSpec, effs: MechEffect[]): void {
  const r = rtOf(state, s.id);
  const p = s.params;
  if (r.on) {
    effs.push(msg('A hollow click inside the wall. No darts fly.', 'info'));
    return;
  }
  const ammo = p.ammo ?? (p.tripwire ? 1 : 3);
  if (r.count >= ammo) {
    effs.push(msg('The wall clicks on an empty magazine.', 'info'));
    return;
  }
  r.count++;
  r.revealed = true;
  effs.push(sfx('darts'));
  if (!p.zone || inRect(state.playerAt, p.zone)) {
    effs.push(msg('Darts hiss out of the wall!', 'danger'));
    effs.push({
      type: 'damage', dice: p.dice ?? [1, 4], bonus: p.bonus, save: p.save ?? 'breath',
      saveHalves: p.saveHalves ?? false, cause: p.cause ?? 'a volley of darts',
    });
    if (p.poison) effs.push({ type: 'status', key: 'poisoned', durationMs: 60000, save: 'death' });
  } else {
    effs.push(msg('Darts rattle against the far wall and fall still.', 'info'));
  }
}

// ── Timed rooms ──────────────────────────────────────────────────────────────

function ringTiles(zone: Rect, k: number): Pos[] {
  const out: Pos[] = [];
  for (let y = zone.ty; y < zone.ty + zone.h; y++) {
    for (let x = zone.tx; x < zone.tx + zone.w; x++) {
      const d = Math.min(x - zone.tx, zone.tx + zone.w - 1 - x, y - zone.ty, zone.ty + zone.h - 1 - y);
      if (d === k) out.push({ tx: x, ty: y });
    }
  }
  return out;
}

function linkedDoors(state: MechState, s: MechanismSpec, open: boolean, effs: MechEffect[]): void {
  for (const id of s.links) {
    const t = specOf(state, id);
    if (t && t.kind === 'portcullis') setDoor(state, t, open, effs);
  }
}

function startClosing(state: MechState, s: MechanismSpec, effs: MechEffect[]): void {
  const r = rtOf(state, s.id);
  if (r.on || r.spent) return;
  r.on = true;
  r.revealed = true;
  r.timerMs = s.params.totalMs ?? 40000;
  r.stage = 0;
  effs.push(sfx('grind'));
  effs.push({ type: 'shake', ms: 500 });
  effs.push(msg('The stone under you clicks. Every wall of the room begins to move.', 'danger'));
  linkedDoors(state, s, false, effs);
}

function retractRings(state: MechState, s: MechanismSpec, effs: MechEffect[]): void {
  const r = rtOf(state, s.id);
  if (!s.params.zone) return;
  for (let k = 0; k < r.stage; k++) {
    for (const p of ringTiles(s.params.zone, k)) setTile(state, effs, p.tx, p.ty, TILE.FLOOR);
  }
  r.stage = 0;
}

function stopClosing(
  state: MechState, s: MechanismSpec, effs: MechEffect[], rng: Rng, reason: 'lever' | 'spikes' | 'spent',
): void {
  const r = rtOf(state, s.id);
  const wasRunning = r.on;
  r.on = false;
  r.spent = true;
  r.revealed = true;
  if (!wasRunning && reason !== 'lever') return;
  retractRings(state, s, effs);
  linkedDoors(state, s, true, effs);
  if (reason === 'lever') effs.push(msg(wasRunning ? 'A lever clunks and the walls shudder to a halt, then withdraw.' : 'Somewhere a chain goes slack. The walls will not move.', 'info'));
  if (reason === 'spikes') effs.push(msg('The spike bites into the groove. The walls scream, stall, and grind back.', 'info'));
  if (reason !== 'spent') {
    effs.push(sfx('grind_stop'));
    grantReward(s, effs);
  }
  void rng;
}

function startGas(state: MechState, s: MechanismSpec, effs: MechEffect[]): void {
  const r = rtOf(state, s.id);
  if (r.on || r.spent) return;
  r.on = true;
  r.revealed = true;
  r.timerMs = s.params.totalMs ?? 25000;
  r.count = 0;
  effs.push(sfx('gas_hiss'));
  effs.push(msg('Stone doors slam. Somewhere above you a vent breathes out, and the air turns sweet and thick.', 'danger'));
  linkedDoors(state, s, false, effs);
}

function ventGas(state: MechState, s: MechanismSpec, effs: MechEffect[], reason: 'lever' | 'spent'): void {
  const r = rtOf(state, s.id);
  const wasRunning = r.on;
  r.on = false;
  r.spent = true;
  r.revealed = true;
  linkedDoors(state, s, true, effs);
  if (reason === 'lever') {
    effs.push(msg(wasRunning ? 'A shutter drops open. The vapour thins and the doors unlatch.' : 'Behind the wall a shutter falls open. The vents are dead.', 'info'));
    effs.push(sfx('vent_open'));
  }
}

function tickTimers(state: MechState, dtMs: number, effs: MechEffect[], rng: Rng): void {
  state.clockMs += dtMs;
  for (const s of state.specs) {
    const r = rtOf(state, s.id);
    if (!r.on || r.spent) continue;
    const p = s.params;
    if (s.kind === 'closing_walls') {
      const total = p.totalMs ?? 40000;
      const stages = p.stages ?? 3;
      r.timerMs -= dtMs;
      const elapsed = total - Math.max(0, r.timerMs);
      const target = Math.min(stages, Math.floor((elapsed / total) * stages));
      while (r.stage < target && p.zone) {
        for (const t of ringTiles(p.zone, r.stage)) setTile(state, effs, t.tx, t.ty, TILE.WALL);
        r.stage++;
        effs.push(sfx('grind'));
        effs.push({ type: 'shake', ms: 250 });
        effs.push(msg(r.stage >= stages ? 'The walls are almost touching.' : 'The walls shudder inward.', 'danger'));
      }
      if (r.timerMs <= 0) {
        if (!p.zone || inRect(state.playerAt, p.zone)) {
          effs.push(msg('The walls meet.', 'danger'));
          effs.push({ type: 'save_or_die', save: 'death', modifier: p.saveMod ?? -2, cause: 'crushed between the walls' });
        }
        stopClosing(state, s, effs, rng, 'spent');
      }
    } else if (s.kind === 'gas_room') {
      r.timerMs -= dtMs;
      r.count += dtMs;
      while (r.count >= 2000) {
        r.count -= 2000;
        if (!p.zone || inRect(state.playerAt, p.zone)) {
          effs.push(msg('The vapour claws at your throat.', 'danger'));
          effs.push({ type: 'damage', dice: [1, 6], save: 'breath', saveHalves: true, cause: 'choking vapour' });
        }
      }
      if (r.timerMs <= 0) {
        if (!p.zone || inRect(state.playerAt, p.zone)) {
          effs.push({ type: 'save_or_die', save: 'death', modifier: p.saveMod ?? -2, cause: 'the sweet vapour' });
        }
        ventGas(state, s, effs, 'spent');
      }
    }
  }
}

// ── step / leave ─────────────────────────────────────────────────────────────

function onStep(state: MechState, ev: Extract<MechEvent, { type: 'step' }>, effs: MechEffect[], rng: Rng): void {
  if (ev.weight === 'player') state.playerAt = { tx: ev.tx, ty: ev.ty };
  for (const s of state.specs) {
    if (!hasTile(trigTiles(s), ev.tx, ev.ty)) continue;
    const r = rtOf(state, s.id);
    switch (s.kind) {
      case 'covered_pit':
      case 'spiked_pit':
        stepPit(s, r, ev.weight, effs);
        break;
      case 'pressure_plate':
        stepPlate(state, s, r, ev.weight, effs, rng);
        break;
      case 'dart_wall':
        if (s.params.tripwire) fireDart(state, s, effs);
        break;
      case 'closing_walls':
        startClosing(state, s, effs);
        break;
      case 'gas_room':
        startGas(state, s, effs);
        break;
      case 'one_way_door':
        if (ev.weight === 'player' && !r.on) {
          r.on = true;
          effs.push(sfx('door_slam'));
          effs.push(msg('Behind you the door swings shut and a latch drops. There is no handle on this side.', 'danger'));
        }
        break;
      case 'teleporter':
        stepTeleporter(state, s, r, ev.weight, effs);
        break;
      case 'rune_floor':
        if (ev.weight === 'player') stepRune(state, s, r, ev.tx, ev.ty, effs, rng);
        break;
      case 'illusory_wall':
        if (ev.weight === 'player' && !r.revealed) reveal(state, s, effs, s.clue ?? 'You walk straight through the wall. It was only paint on air.');
        break;
      default:
        break;
    }
  }
}

function stepPit(
  s: MechanismSpec, r: MechRuntime, weight: 'player' | 'item' | 'monster', effs: MechEffect[],
): void {
  const p = s.params;
  if (weight === 'item') {
    if (!r.revealed) {
      r.revealed = true;
      effs.push({ type: 'reveal', id: s.id });
      effs.push(msg('Whatever you set down lands with a hollow knock, then a long fall of silence.', 'clue'));
    }
    return;
  }
  if (weight === 'monster') {
    r.on = true;
    r.revealed = true;
    return;
  }
  r.on = true;
  r.count++;
  if (!r.revealed) {
    r.revealed = true;
    effs.push({ type: 'reveal', id: s.id });
  }
  effs.push(sfx('pit_fall'));
  effs.push({ type: 'shake', ms: 250 });
  if (s.kind === 'covered_pit') {
    effs.push(msg('The flagstone tips under your boot and the floor is gone.', 'danger'));
    effs.push({ type: 'fall', floors: p.floors ?? 0, dice: p.dice ?? [1, 6] });
  } else {
    effs.push(msg('You drop onto a bed of iron spikes.', 'danger'));
    effs.push({ type: 'fall', floors: 0, dice: [1, 6] });
    effs.push({
      type: 'damage', dice: p.dice ?? [2, 6], bonus: p.bonus, save: p.save, saveHalves: p.saveHalves,
      cause: p.cause ?? 'spikes at the bottom of a pit',
    });
  }
}

function stepPlate(
  state: MechState, s: MechanismSpec, r: MechRuntime, weight: 'player' | 'item' | 'monster', effs: MechEffect[], rng: Rng,
): void {
  const p = s.params;
  if (p.minWeight === 'player' && weight === 'item') return;
  r.held++;
  if (r.held !== 1) return;
  if (!p.momentary && r.spent) return;
  r.on = true;
  r.spent = !p.momentary;
  if (s.hidden && !r.revealed) effs.push({ type: 'reveal', id: s.id });
  r.revealed = true;
  effs.push(sfx('plate_click'));
  effs.push(msg(weight === 'item' ? 'The weight settles and the stone sinks with a click.' : 'The stone sinks under your foot with a click.', 'info'));
  if (p.dice && weight === 'player') {
    effs.push({ type: 'damage', dice: p.dice, bonus: p.bonus, save: p.save, saveHalves: p.saveHalves, cause: p.cause ?? 'a trap plate' });
  }
  setLinks(state, s, true, effs, rng);
}

function onLeave(state: MechState, ev: Extract<MechEvent, { type: 'leave' }>, effs: MechEffect[], rng: Rng): void {
  for (const s of state.specs) {
    if (s.kind !== 'pressure_plate' || !hasTile(footprint(s), ev.tx, ev.ty)) continue;
    const r = rtOf(state, s.id);
    if (r.held > 0) r.held--;
    if (r.held === 0 && s.params.momentary && r.on) {
      r.on = false;
      effs.push(sfx('plate_rise'));
      effs.push(msg('The plate rises with a clack.', 'info'));
      setLinks(state, s, false, effs, rng);
    }
  }
}

function stepTeleporter(
  state: MechState, s: MechanismSpec, r: MechRuntime, weight: 'player' | 'item' | 'monster', effs: MechEffect[],
): void {
  if (weight !== 'player') return;
  const p = s.params;
  if (p.unless) {
    const o = state.rt[p.unless];
    if (o && o.on) return;
  }
  if (!p.dest) return;
  if (s.hidden && !r.revealed) effs.push({ type: 'reveal', id: s.id });
  r.revealed = true;
  effs.push(sfx('teleport'));
  effs.push(msg(s.clue ?? 'The floor flashes and the room you were standing in is not the room you are in.', 'danger'));
  effs.push({ type: 'teleport', tx: p.dest.tx, ty: p.dest.ty });
  state.playerAt = { tx: p.dest.tx, ty: p.dest.ty };
  if (p.spawn) {
    const at = p.spawnAt ?? p.dest;
    effs.push({ type: 'spawn', monster: p.spawn, tx: at.tx, ty: at.ty });
  }
}

function stepRune(
  state: MechState, s: MechanismSpec, r: MechRuntime, tx: number, ty: number, effs: MechEffect[], rng: Rng,
): void {
  if (r.on) return;
  const p = s.params;
  const order = p.order ?? [];
  const idx = footprint(s).findIndex((q) => q.tx === tx && q.ty === ty);
  if (idx < 0) return;
  if (order[r.progress] === idx) {
    r.progress++;
    effs.push(sfx('rune_chime'));
    if (r.progress >= order.length) {
      r.on = true;
      r.revealed = true;
      effs.push(msg('The last rune flares. Under the floor a bolt draws back.', 'info'));
      solved(state, s, effs, rng);
    } else {
      effs.push(msg('The rune warms and holds its glow.', 'info'));
    }
    return;
  }
  if (r.progress > 0 && order[r.progress - 1] === idx) return; // still standing on the rune just lit
  r.progress = 0;
  effs.push(sfx('rune_buzz'));
  effs.push({ type: 'shake', ms: 200 });
  const punish = p.punish ?? 'bolt';
  if (punish === 'bolt') {
    effs.push(msg('Every lit rune goes dark. Something discharges from the ceiling.', 'danger'));
    effs.push({
      type: 'damage', dice: p.dice ?? [2, 6], bonus: p.bonus, save: p.save ?? 'wands', saveHalves: true,
      cause: p.cause ?? 'a bolt from the wrong rune',
    });
    if (p.lethal) effs.push({ type: 'save_or_die', save: p.save ?? 'wands', modifier: p.saveMod, cause: p.cause ?? 'the wrong rune' });
  } else if (punish === 'spawn') {
    const at = p.spawnAt ?? { tx: s.tx, ty: s.ty };
    effs.push(msg('The dark runes cough up something that was waiting.', 'danger'));
    effs.push({ type: 'spawn', monster: p.spawn ?? 'skeleton', tx: at.tx, ty: at.ty });
  } else {
    effs.push(msg('The floor unlatches.', 'danger'));
    effs.push({ type: 'fall', floors: p.floors ?? 1, dice: p.dice ?? [2, 6] });
  }
}

// ── probe / search / listen ──────────────────────────────────────────────────

function onProbe(state: MechState, ev: Extract<MechEvent, { type: 'probe' }>, effs: MechEffect[]): void {
  for (const s of state.specs) {
    if (!hasTile(trigTiles(s), ev.tx, ev.ty)) continue;
    const r = rtOf(state, s.id);
    switch (s.kind) {
      case 'covered_pit':
      case 'spiked_pit':
        if (!r.revealed) reveal(state, s, effs, s.clue ?? 'The pole goes through the floor like a hand through a curtain: a pit.');
        else effs.push(msg('The pole sinks into empty dark.', 'info'));
        break;
      case 'pressure_plate':
      case 'teleporter':
      case 'closing_walls':
      case 'gas_room':
        if (!r.revealed) reveal(state, s, effs, s.clue ?? 'The pole taps a stone that gives a little: a trigger.');
        else effs.push(msg('The stone gives under the pole. You lean on it no further.', 'info'));
        break;
      case 'illusory_wall':
        if (!r.revealed) reveal(state, s, effs, s.clue ?? 'The pole slides straight through the wall as if it were smoke.');
        break;
      case 'dart_wall':
        if (s.params.tripwire) {
          const ammo = s.params.ammo ?? 1;
          if (!r.on && r.count < ammo) {
            r.count++;
            r.revealed = true;
            effs.push({ type: 'reveal', id: s.id });
            effs.push(sfx('darts'));
            effs.push(msg(s.clue ?? 'The pole snags a wire. Darts hiss across the corridor and splinter on the far wall. You stood well back.', 'clue'));
          } else {
            effs.push(msg('The pole finds the wire again. Nothing happens.', 'info'));
          }
        }
        break;
      default:
        break;
    }
  }
}

function onSearch(state: MechState, ev: Extract<MechEvent, { type: 'search' }>, effs: MechEffect[]): void {
  for (const s of state.specs) {
    if (!searchable(s)) continue;
    const r = rtOf(state, s.id);
    if (r.revealed) continue;
    if (!senseTiles(s).some((p) => cheb(p, ev) <= 1)) continue;
    if (ev.roll <= ev.chance - s.searchDifficulty) reveal(state, s, effs);
  }
}

function onListen(state: MechState, ev: Extract<MechEvent, { type: 'listen' }>, effs: MechEffect[]): void {
  for (const s of state.specs) {
    if (!s.params.listenText) continue;
    if (!senseTiles(s).some((p) => cheb(p, ev) <= 1)) continue;
    if (ev.roll <= ev.chance - (s.params.listenDiff ?? 0)) {
      effs.push(sfx('listen'));
      effs.push(msg(s.params.listenText, 'clue'));
    }
  }
}

// ── interact ─────────────────────────────────────────────────────────────────

const POKE_VERBS = ['pull', 'push', 'touch', 'open'];

function onInteract(state: MechState, ev: Extract<MechEvent, { type: 'interact' }>, effs: MechEffect[], rng: Rng): void {
  const s = specOf(state, ev.id);
  if (!s) return;
  const r = rtOf(state, s.id);
  if (!visibleNow(s, r)) return;
  const p = s.params;
  switch (s.kind) {
    case 'lever': {
      if (ev.verb === 'read') break;
      if (p.once && r.spent) {
        effs.push(msg('The lever is jammed in place.', 'info'));
        return;
      }
      r.on = !r.on;
      if (p.once) r.spent = true;
      effs.push(sfx('lever'));
      effs.push(msg(r.on ? 'The lever clunks over.' : 'The lever clunks back.', 'info'));
      if (p.setsFlag) state.flags[p.setsFlag] = r.on;
      setLinks(state, s, r.on, effs, rng);
      if (r.on && p.grant && r.count === 0) {
        r.count = 1;
        grantReward(s, effs);
      }
      return;
    }
    case 'talking_face': {
      const truthful = p.truthFlag ? !!state.flags[p.truthFlag] : true;
      r.count++;
      effs.push(sfx('whisper'));
      effs.push(msg((truthful ? p.trueText : p.falseText) ?? s.clue ?? 'The face says nothing.', 'clue'));
      return;
    }
    case 'lure': {
      if (ev.verb === 'read') break;
      if (r.on) {
        effs.push(msg('There is nothing left to touch.', 'info'));
        return;
      }
      r.on = true;
      effs.push(sfx('trap'));
      effs.push({ type: 'shake', ms: 300 });
      effs.push(msg('Your fingers close on it, and it closes on you.', 'danger'));
      effs.push({ type: 'save_or_die', save: p.save ?? 'petrify', modifier: p.saveMod, cause: p.cause ?? 'the bait' });
      return;
    }
    case 'statue_offering': {
      if (ev.verb !== 'offer') break;
      if (r.on) {
        effs.push(msg('The statue is content.', 'info'));
        return;
      }
      if (!ev.itemKey) {
        effs.push(msg('The stone hands wait for something to be laid in them.', 'info'));
        return;
      }
      effs.push({ type: 'consume', itemKey: ev.itemKey });
      if (ev.itemKey === p.wants) {
        r.on = true;
        effs.push(sfx('statue_accept'));
        effs.push(msg('The hands close and open again, empty. Stone grinds somewhere nearby.', 'info'));
        solved(state, s, effs, rng);
      } else {
        r.count++;
        effs.push(sfx('curse'));
        effs.push(msg('The stone face turns a degree toward you. It did not want that.', 'danger'));
        effs.push({ type: 'status', key: 'cursed', durationMs: 300000, save: 'spells' });
      }
      return;
    }
    case 'riddle_door': {
      if (r.on) return;
      effs.push(msg(s.clue ?? 'The door is sealed. Letters crawl across the lintel.', 'clue'));
      return;
    }
    case 'locked_door': {
      if (r.on) return;
      if (ev.verb === 'read') break;
      onLockedDoor(state, s, r, ev, effs, rng);
      return;
    }
    case 'secret_door': {
      if (!POKE_VERBS.includes(ev.verb) || r.on) break;
      openSecret(state, s, effs);
      return;
    }
    case 'false_door': {
      if (!POKE_VERBS.includes(ev.verb)) break;
      if (r.revealed) {
        effs.push(msg('You wedge the painted latch with your knife. The spring behind it is quiet. It is only a door-shaped slab.', 'info'));
        return;
      }
      if (r.spent) {
        effs.push(msg('The door is paint over stone. Whatever it held has already been spent.', 'info'));
        return;
      }
      r.spent = true;
      onFalseDoor(s, effs);
      return;
    }
    case 'illusory_wall': {
      if (!POKE_VERBS.includes(ev.verb)) break;
      reveal(state, s, effs, s.clue ?? 'Your hand sinks into the stone to the wrist. It was only a picture of a wall.');
      return;
    }
    case 'closing_walls': {
      if (onSpikes(state, ev, effs, rng)) return;
      break;
    }
    case 'portcullis':
    case 'sliding_wall': {
      if (ev.verb === 'read') break;
      if (!r.on) effs.push(msg('It does not move. Something else holds it.', 'info'));
      return;
    }
    default:
      break;
  }
  if (ev.verb === 'read' && s.clue) effs.push(msg(s.clue, 'clue'));
}

function onLockedDoor(
  state: MechState, s: MechanismSpec, r: MechRuntime, ev: Extract<MechEvent, { type: 'interact' }>, effs: MechEffect[], rng: Rng,
): void {
  const p = s.params;
  const item = ev.itemKey;
  const openIt = (text: string): void => {
    r.on = true;
    r.revealed = true;
    effs.push(sfx('lock_open'));
    effs.push(msg(text, 'info'));
    solved(state, s, effs, rng);
  };
  if (p.seats) {
    if (item && p.seats.includes(item)) {
      if (!r.seated.includes(item)) {
        r.seated.push(item);
        effs.push({ type: 'consume', itemKey: item });
        effs.push(sfx('plate_click'));
      }
      if (r.seated.length >= p.seats.length) openIt('The last part seats with a click. The bolts withdraw one after another.');
      else effs.push(msg(`A part seats in the door (${r.seated.length} of ${p.seats.length}).`, 'info'));
    } else if (item) {
      effs.push(msg('That does not fit any of the keyholes.', 'info'));
    } else if (ev.roll !== undefined) {
      effs.push(msg('The keyholes have no pins to pick. They drink only the right metal.', 'info'));
    } else {
      effs.push(msg(s.clue ?? 'The door has no handle, only keyholes.', 'clue'));
    }
    return;
  }
  if (item) {
    if (p.keyItem && item === p.keyItem) {
      effs.push({ type: 'consume', itemKey: item });
      openIt('The key turns. The lock gives with a dry crunch.');
    } else {
      effs.push(msg('That does not fit.', 'info'));
    }
    return;
  }
  if (ev.roll !== undefined && ev.chance !== undefined && !p.unpickable) {
    if (ev.roll <= ev.chance - (p.lockDiff ?? 0)) {
      openIt('The picks find the last pin and the lock gives.');
    } else {
      r.count++;
      effs.push(msg('The picks slip. The lock does not care.', 'info'));
    }
    return;
  }
  if (p.needle && !r.revealed && !r.spent) {
    r.spent = true;
    effs.push(sfx('trap'));
    effs.push(msg('A needle snaps out of the keyhole and into your palm.', 'danger'));
    effs.push({ type: 'damage', dice: [1, 3], cause: 'a needle in the lock' });
    effs.push({ type: 'status', key: 'poisoned', durationMs: 60000, save: 'death' });
    return;
  }
  effs.push(msg('Locked.', 'info'));
}

function onFalseDoor(s: MechanismSpec, effs: MechEffect[]): void {
  const p = s.params;
  effs.push(sfx('trap'));
  effs.push({ type: 'shake', ms: 300 });
  const springs = p.springs ?? 'fall';
  if (springs === 'darts') {
    effs.push(msg('The handle sinks. The door was never a door, and the wall behind it is full of darts.', 'danger'));
    effs.push({ type: 'damage', dice: p.dice ?? [2, 6], bonus: p.bonus, save: p.save ?? 'breath', saveHalves: p.saveHalves ?? false, cause: p.cause ?? 'the false door' });
  } else if (springs === 'spawn') {
    const at = p.spawnAt ?? { tx: s.tx, ty: s.ty };
    effs.push(msg('The door swings out. Behind it, packed standing in the dark, something that has waited a long time.', 'danger'));
    effs.push({ type: 'spawn', monster: p.spawn ?? 'skeleton', tx: at.tx, ty: at.ty });
  } else {
    effs.push(msg('The handle sinks. The floor in front of the door drops away.', 'danger'));
    effs.push({ type: 'fall', floors: p.floors ?? 1, dice: p.dice ?? [2, 6] });
  }
  if (p.lethal) effs.push({ type: 'save_or_die', save: p.save ?? 'death', modifier: p.saveMod, cause: p.cause ?? 'the false door' });
}

// ── answer ───────────────────────────────────────────────────────────────────

const TAUNTS = [
  'The door does not answer.',
  'The lintel letters crawl, rearrange, and go still.',
  'A cold breath comes out of the keyhole.',
  'Nothing. The silence sounds disappointed.',
];

function onAnswer(state: MechState, ev: Extract<MechEvent, { type: 'answer' }>, effs: MechEffect[], rng: Rng): void {
  const s = specOf(state, ev.id);
  if (!s || s.kind !== 'riddle_door') return;
  const r = rtOf(state, s.id);
  if (r.on) {
    effs.push(msg('The door is already open.', 'info'));
    return;
  }
  const given = normalizeAnswer(ev.text);
  const ok = (s.params.answers ?? []).some((a) => normalizeAnswer(a) === given);
  if (ok) {
    r.on = true;
    r.revealed = true;
    r.count = 0;
    effs.push(sfx('door_open'));
    effs.push(msg('The letters on the lintel settle and go dark. The door sighs open.', 'info'));
    solved(state, s, effs, rng);
    return;
  }
  r.count++;
  effs.push(msg(TAUNTS[Math.min(TAUNTS.length - 1, Math.floor(rng.next() * TAUNTS.length))], 'info'));
  if (r.count >= (s.params.strikes ?? 3)) {
    r.count = 0;
    effs.push(sfx('trap'));
    effs.push({ type: 'shake', ms: 250 });
    effs.push(msg('On the third wrong word the door answers in its own way.', 'danger'));
    effs.push({
      type: 'damage', dice: s.params.dice ?? [2, 6], bonus: s.params.bonus, save: s.params.save ?? 'spells',
      saveHalves: true, cause: s.params.cause ?? 'the riddle door',
    });
  }
}

// ── The one entry point ──────────────────────────────────────────────────────

/** Mutates `state` and returns the effects the scene must apply, in order. */
export function applyEvent(state: MechState, ev: MechEvent, rng: Rng): MechEffect[] {
  const effs: MechEffect[] = [];
  switch (ev.type) {
    case 'step': onStep(state, ev, effs, rng); break;
    case 'leave': onLeave(state, ev, effs, rng); break;
    case 'probe': onProbe(state, ev, effs); break;
    case 'search': onSearch(state, ev, effs); break;
    case 'listen': onListen(state, ev, effs); break;
    case 'interact': onInteract(state, ev, effs, rng); break;
    case 'answer': onAnswer(state, ev, effs, rng); break;
    case 'tick': tickTimers(state, ev.dtMs, effs, rng); break;
  }
  return effs;
}

/** Iron spikes offered to a closing-walls room (the scene shows this while the player is inside the zone). */
function onSpikes(state: MechState, ev: Extract<MechEvent, { type: 'interact' }>, effs: MechEffect[], rng: Rng): boolean {
  const s = specOf(state, ev.id);
  if (!s || s.kind !== 'closing_walls' || ev.verb !== 'offer') return false;
  const r = rtOf(state, s.id);
  if (ev.itemKey !== 'iron_spikes') {
    effs.push(msg('That would not jam a mill-wheel, let alone a wall.', 'info'));
    return true;
  }
  if (!r.on) {
    effs.push(msg('The walls are not moving. Save your spikes.', 'info'));
    return true;
  }
  effs.push({ type: 'consume', itemKey: 'iron_spikes' });
  r.progress++;
  if (r.progress >= (s.params.spikesNeeded ?? 1)) {
    stopClosing(state, s, effs, rng, 'spikes');
  } else {
    effs.push(msg('One spike bites. The walls slow but do not stop. Another.', 'info'));
  }
  return true;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export function isDisarmed(state: MechState, id: string): boolean {
  const s = specOf(state, id);
  const r = state.rt[id];
  if (!s || !r) return false;
  return s.kind === 'dart_wall' ? r.on : r.spent;
}

// ── Drawing and blocking ─────────────────────────────────────────────────────
//
// kind              texture key(s)                                  blocks movement
// covered_pit       mech_plate (loose slab) -> mech_pit_open        only once revealed or sprung
// spiked_pit        invisible until known -> mech_pit_spikes        only once known
// dart_wall         mech_dart_hole (on the wall tile)               no (wall tile already blocks)
// pressure_plate    mech_plate / mech_plate_down                    no
// lever             mech_lever_off / mech_lever_on (wall tile)      no
// portcullis        mech_portcullis                                 closed only (invisible when open)
// sliding_wall      nothing (it is the wall)                        closed only; open = set_tile FLOOR
// closing_walls     mech_plate on the trigger stone once revealed   no (rings of WALL arrive as set_tile)
// gas_room          mech_gas_vent once running or revealed          no
// false_door        mech_false_door                                 yes
// illusory_wall     'wall' (standard wall texture) -> gone          never
// one_way_door      mech_door_open -> mech_door (at params.door)    once sealed
// teleporter        invisible until revealed -> mech_teleporter     no
// rune_floor        mech_rune_a..f per rune tile                    no
// riddle_door       mech_door -> mech_door_open                     closed only
// statue_offering   mech_statue                                     yes
// lure              mech_lure                                       yes
// talking_face      mech_face (wall tile)                           no
// inscription       mech_inscription | mech_stain | mech_scorch | mech_bones   no
// locked_door       mech_door -> mech_door_open                     closed only
// secret_door       invisible until revealed -> mech_door(_open)    closed only
// `visible: false` means draw nothing for the mechanism (the underlying tile shows).

function view(s: MechanismSpec, textureKey: string, blocks: boolean, visible: boolean, at?: Pos): MechView {
  return { id: s.id, textureKey, blocks, visible, tx: at?.tx ?? s.tx, ty: at?.ty ?? s.ty };
}

function viewsOf(state: MechState, s: MechanismSpec): MechView[] {
  const r = rtOf(state, s.id);
  const vis = visibleNow(s, r);
  const p = s.params;
  switch (s.kind) {
    case 'covered_pit': {
      const known = r.revealed || r.on;
      if (known) return [view(s, 'mech_pit_open', true, true)];
      return [view(s, 'mech_plate', false, !s.hidden)];
    }
    case 'spiked_pit': {
      const known = !s.hidden || r.revealed || r.on;
      return [view(s, 'mech_pit_spikes', known, known)];
    }
    case 'dart_wall':
      return [view(s, 'mech_dart_hole', false, vis)];
    case 'pressure_plate':
      return [view(s, r.on ? 'mech_plate_down' : 'mech_plate', false, vis)];
    case 'lever':
      return [view(s, r.on ? 'mech_lever_on' : 'mech_lever_off', false, vis)];
    case 'portcullis':
      return [view(s, 'mech_portcullis', !r.on, !r.on)];
    case 'sliding_wall':
      return footprint(s).map((q) => view(s, 'wall', !r.on, false, q));
    case 'closing_walls':
      return footprint(s).map((q) => view(s, 'mech_plate', false, r.revealed, q));
    case 'gas_room':
      return [view(s, 'mech_gas_vent', false, r.revealed || r.on)];
    case 'false_door':
      return [view(s, 'mech_false_door', true, true)];
    case 'illusory_wall':
      return footprint(s).map((q) => view(s, 'wall', false, !r.revealed, q));
    case 'one_way_door':
      return [view(s, r.on ? 'mech_door' : 'mech_door_open', r.on, true, p.door ?? s)];
    case 'teleporter':
      return [view(s, 'mech_teleporter', false, vis)];
    case 'rune_floor':
      return footprint(s).map((q, i) => view(s, `mech_rune_${p.glyphs?.[i] ?? 'abcdef'[i % 6]}`, false, true, q));
    case 'riddle_door':
    case 'locked_door':
      return [view(s, r.on ? 'mech_door_open' : 'mech_door', !r.on, true)];
    case 'statue_offering':
      return [view(s, 'mech_statue', true, true)];
    case 'lure':
      return [view(s, 'mech_lure', true, true)];
    case 'talking_face':
      return [view(s, 'mech_face', false, true)];
    case 'inscription':
      return [view(s, `mech_${p.look ?? 'inscription'}`, false, vis)];
    case 'secret_door':
      return [view(s, r.on ? 'mech_door_open' : 'mech_door', !r.on, vis)];
  }
}

/** Every drawable of every mechanism (a rune floor yields one per rune). */
export function mechViews(state: MechState): MechView[] {
  return state.specs.flatMap((s) => viewsOf(state, s));
}

/** The primary drawable of one mechanism. */
export function mechView(state: MechState, id: string): MechView {
  const s = specOf(state, id);
  if (!s) throw new Error(`unknown mechanism ${id}`);
  return viewsOf(state, s)[0];
}

/** "tx,ty" keys of every tile a mechanism currently blocks, on top of the tile map. */
export function blockedTiles(state: MechState): Set<string> {
  const out = new Set<string>();
  for (const v of mechViews(state)) if (v.blocks) out.add(tileKey(v.tx, v.ty));
  return out;
}

/** Tile edits made so far, to repaint a loaded map. */
export function tileOverrides(state: MechState): { tx: number; ty: number; tile: number }[] {
  return Object.entries(state.tileLog).map(([k, tile]) => {
    const [tx, ty] = k.split(',').map(Number);
    return { tx, ty, tile };
  });
}
