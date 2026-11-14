import { describe, expect, it } from 'vitest';
import { tileKindOf } from './builder';
import { applyEvent, blockedTiles, createMechState, footprint, isLethal } from './mechanisms';
import { isHarmful, replay, seeded } from './testkit';
import { TOMB } from './tomb';
import type { MechEvent, MechState } from './types';

const W = 64;
const H = 48;

/** Flood fill over the tomb map, applying the tile edits and blocks a state has accumulated. */
function reach(state: MechState, edits: { tx: number; ty: number; tile: number }[]): Set<string> {
  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const edit = edits.find((e) => e.tx === x && e.ty === y);
    if (edit) return edit.tile !== 0;
    return tileKindOf(TOMB.rows[y][x]) === 'floor';
  };
  const blocked = blockedTiles(state);
  const seen = new Set<string>();
  const stack = [TOMB.playerStart];
  while (stack.length) {
    const p = stack.pop()!;
    const k = `${p.tx},${p.ty}`;
    if (seen.has(k) || !open(p.tx, p.ty) || blocked.has(k)) continue;
    seen.add(k);
    stack.push({ tx: p.tx + 1, ty: p.ty }, { tx: p.tx - 1, ty: p.ty }, { tx: p.tx, ty: p.ty + 1 }, { tx: p.tx, ty: p.ty - 1 });
  }
  return seen;
}

function runWith(events: MechEvent[]): { state: MechState; edits: { tx: number; ty: number; tile: number }[] } {
  const state = createMechState(TOMB.mechanisms);
  const rng = seeded(11);
  const edits: { tx: number; ty: number; tile: number }[] = [];
  for (const ev of events) {
    for (const e of applyEvent(state, ev, rng)) {
      if (e.type === 'set_tile') {
        const i = edits.findIndex((x) => x.tx === e.tx && x.ty === e.ty);
        if (i >= 0) edits.splice(i, 1);
        edits.push({ tx: e.tx, ty: e.ty, tile: e.tile });
      }
    }
  }
  return { state, edits };
}

describe('the Tomb of the Hollow King', () => {
  it('is exactly 64x48 with a legal character everywhere', () => {
    expect(TOMB.rows).toHaveLength(H);
    for (const r of TOMB.rows) {
      expect(r).toHaveLength(W);
      for (const ch of r) expect(() => tileKindOf(ch)).not.toThrow();
    }
    expect(TOMB.width).toBe(W);
    expect(TOMB.height).toBe(H);
    // solid outer boundary except nothing: no floor on the map edge
    for (let x = 0; x < W; x++) {
      expect(tileKindOf(TOMB.rows[0][x])).toBe('wall');
      expect(tileKindOf(TOMB.rows[H - 1][x])).toBe('wall');
    }
    for (let y = 0; y < H; y++) {
      expect(tileKindOf(TOMB.rows[y][0])).toBe('wall');
      expect(tileKindOf(TOMB.rows[y][W - 1])).toBe('wall');
    }
  });

  it('chains at least ten distinct set pieces, covering at least ten mechanism kinds', () => {
    expect(TOMB.setPieces.length).toBeGreaterThanOrEqual(10);
    expect(new Set(TOMB.setPieces.map((p) => p.name)).size).toBe(TOMB.setPieces.length);
    const kinds = new Set(TOMB.mechanisms.map((m) => m.kind).filter((k) => k !== 'inscription'));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    expect(TOMB.walkthrough.length).toBeGreaterThanOrEqual(10);
  });

  it('places mechanisms on sensible tiles and gives every lethal one a clue', () => {
    const at = (x: number, y: number) => tileKindOf(TOMB.rows[y][x]);
    for (const s of TOMB.mechanisms) {
      for (const p of footprint(s)) expect(p.tx >= 0 && p.ty >= 0 && p.tx < W && p.ty < H).toBe(true);
      if (['covered_pit', 'spiked_pit', 'pressure_plate', 'portcullis', 'rune_floor', 'riddle_door', 'locked_door', 'statue_offering', 'lure', 'one_way_door']
        .includes(s.kind)) {
        for (const p of footprint(s)) expect(at(p.tx, p.ty), s.id).toBe('floor');
      }
      if (['talking_face', 'secret_door', 'sliding_wall', 'false_door'].includes(s.kind)) expect(at(s.tx, s.ty), s.id).toBe('wall');
      if (s.kind === 'teleporter') {
        expect(at(s.tx, s.ty)).toBe('floor');
        expect(at(s.params.dest!.tx, s.params.dest!.ty), `${s.id} dest`).toBe('floor');
      }
      if (isLethal(s)) {
        const own = !!s.clue && s.clue.length > 10;
        const about = TOMB.mechanisms.some((m) => m.params.about === s.id && !!m.clue);
        expect(own || about, `${s.id} lacks a clue`).toBe(true);
      }
      for (const l of [...s.links, ...(s.params.fires ?? [])]) expect(TOMB.mechanisms.some((m) => m.id === l), `${s.id} -> ${l}`).toBe(true);
    }
  });

  it('is solved by its solution: no damage, no save-or-die, all three key parts granted, key door open', () => {
    const { state, effects } = replay(TOMB.mechanisms, TOMB.solution);
    expect(effects.filter((e) => e.type === 'damage' || e.type === 'save_or_die')).toEqual([]);
    expect(effects.filter(isHarmful)).toEqual([]);
    const grants = effects.flatMap((e) => (e.type === 'grant' ? [e.itemKey] : []));
    for (const part of TOMB.keyParts) expect(grants).toContain(part);
    expect(state.rt[TOMB.keyDoorId].on).toBe(true);
  });

  it('hurts a careless player in every trapped chamber', () => {
    const trapped = TOMB.setPieces.filter((p) => p.carelessPath);
    expect(trapped.length).toBeGreaterThanOrEqual(10);
    for (const p of trapped) {
      const { effects } = replay(TOMB.mechanisms, p.carelessPath!);
      expect(effects.some(isHarmful), p.name).toBe(true);
    }
  });

  it('has exactly one boss marker and a way out behind it', () => {
    expect(TOMB.bossSpawn).toBeDefined();
    expect(tileKindOf(TOMB.rows[TOMB.bossSpawn.ty][TOMB.bossSpawn.tx])).toBe('floor');
    expect(tileKindOf(TOMB.rows[TOMB.stairsPos.ty][TOMB.stairsPos.tx])).toBe('floor');
    expect(TOMB.chests.filter((c) => c.isMimic).length).toBeGreaterThanOrEqual(2);
    expect(TOMB.chests.filter((c) => !c.isMimic).length).toBeGreaterThanOrEqual(1);
    // the false tomb (chamber 11) comes before the real treasure (chamber 12)
    const falseX = Math.max(...TOMB.chests.filter((c) => c.isMimic).map((c) => c.tx));
    const realX = Math.min(...TOMB.chests.filter((c) => !c.isMimic).map((c) => c.tx));
    expect(falseX).toBeLessThan(realX);
  });

  it('keeps the boss chamber unreachable until the key puzzle is solved', () => {
    const start = createMechState(TOMB.mechanisms);
    const before = reach(start, []);
    expect(before.has(`${TOMB.playerStart.tx},${TOMB.playerStart.ty}`)).toBe(true);
    expect(before.has(`${TOMB.bossSpawn.tx},${TOMB.bossSpawn.ty}`)).toBe(false);

    const solved = runWith(TOMB.solution);
    const after = reach(solved.state, solved.edits);
    expect(after.has(`${TOMB.bossSpawn.tx},${TOMB.bossSpawn.ty}`)).toBe(true);
    expect(after.has(`${TOMB.stairsPos.tx},${TOMB.stairsPos.ty}`)).toBe(true);
  });

  it('needs every one of the three key parts', () => {
    for (const part of TOMB.keyParts) {
      const events = TOMB.solution.filter((e) => !(e.type === 'interact' && e.id === TOMB.keyDoorId && e.itemKey === part));
      expect(events.length).toBe(TOMB.solution.length - 1);
      const { state, edits } = runWith(events);
      expect(state.rt[TOMB.keyDoorId].on, `without ${part}`).toBe(false);
      expect(reach(state, edits).has(`${TOMB.bossSpawn.tx},${TOMB.bossSpawn.ty}`)).toBe(false);
    }
  });

  it('cannot be skipped: dropping the solution of any gated chamber strands the player before the boss', () => {
    const gated = TOMB.setPieces.filter((p) => p.gated);
    expect(gated.length).toBeGreaterThanOrEqual(8);
    for (const p of gated) {
      const drop = new Set(p.solution);
      const events = TOMB.solution.filter((e) => !drop.has(e));
      const { state, edits } = runWith(events);
      expect(reach(state, edits).has(`${TOMB.bossSpawn.tx},${TOMB.bossSpawn.ty}`), p.name).toBe(false);
    }
  });
});
