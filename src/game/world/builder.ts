// Authoring helpers for vaults and the tomb: marker-based ASCII maps and event shorthands.
//
// Map convention (so a mechanism position always agrees with the map by construction):
//   '#'               solid wall
//   '.'               floor
//   'C'               chest (floor)
//   'M'               monster spawn (floor)
//   a-z, 0-9          floor marker: the mechanism or point of interest stands here (name it with m.p('x'))
//   A-Z except C, M   wall marker: a lever, face, dart hole or door set into the wall tile

import type {
  Entrance, LegendEntry, MechEvent, MechanismSpec, Pos, VaultDef, VaultGoal,
} from './types';

export const pos = (tx: number, ty: number): Pos => ({ tx, ty });

export type TileKind = 'wall' | 'floor';

export function tileKindOf(ch: string): TileKind {
  if (ch === '#') return 'wall';
  if (ch === '.' || ch === 'C' || ch === 'M') return 'floor';
  if (/[a-z0-9]/.test(ch)) return 'floor';
  if (/[A-Z]/.test(ch)) return 'wall';
  throw new Error(`unknown map character '${ch}'`);
}

export interface Marks {
  rows: string[];
  w: number;
  h: number;
  /** The one position of a unique marker; throws when it is missing or repeated. */
  p(ch: string): Pos;
  /** Every position of a marker, row-major. */
  all(ch: string): Pos[];
}

export function marks(rows: string[]): Marks {
  const w = rows[0].length;
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`row ${y} has length ${r.length}, expected ${w}`);
  });
  const all = (ch: string): Pos[] => {
    const out: Pos[] = [];
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) if (r[x] === ch) out.push(pos(x, y));
    });
    return out;
  };
  return {
    rows, w, h: rows.length, all,
    p(ch: string): Pos {
      const found = all(ch);
      if (found.length !== 1) throw new Error(`marker '${ch}' appears ${found.length} times`);
      return found[0];
    },
  };
}

// ── Events ───────────────────────────────────────────────────────────────────

export const E = {
  step: (p: Pos, weight: 'player' | 'item' | 'monster' = 'player'): MechEvent => ({ type: 'step', tx: p.tx, ty: p.ty, weight }),
  walk: (ps: Pos[]): MechEvent[] => ps.map((p) => ({ type: 'step', tx: p.tx, ty: p.ty, weight: 'player' as const })),
  leave: (p: Pos): MechEvent => ({ type: 'leave', tx: p.tx, ty: p.ty }),
  probe: (p: Pos): MechEvent => ({ type: 'probe', tx: p.tx, ty: p.ty }),
  /** A search that succeeds against anything with difficulty under `chance`. */
  search: (p: Pos, chance = 60, roll = 1): MechEvent => ({ type: 'search', tx: p.tx, ty: p.ty, roll, chance }),
  listen: (p: Pos, chance = 60, roll = 1): MechEvent => ({ type: 'listen', tx: p.tx, ty: p.ty, roll, chance }),
  pull: (id: string): MechEvent => ({ type: 'interact', id, verb: 'pull' }),
  push: (id: string): MechEvent => ({ type: 'interact', id, verb: 'push' }),
  touch: (id: string): MechEvent => ({ type: 'interact', id, verb: 'touch' }),
  read: (id: string): MechEvent => ({ type: 'interact', id, verb: 'read' }),
  open: (id: string, itemKey?: string): MechEvent => ({ type: 'interact', id, verb: 'open', itemKey }),
  pick: (id: string, roll = 1, chance = 50): MechEvent => ({ type: 'interact', id, verb: 'open', roll, chance }),
  offer: (id: string, itemKey: string): MechEvent => ({ type: 'interact', id, verb: 'offer', itemKey }),
  answer: (id: string, text: string): MechEvent => ({ type: 'answer', id, text }),
  tick: (dtMs: number): MechEvent => ({ type: 'tick', dtMs }),
  /** n one-second ticks (a careless player waiting out a timer). */
  wait: (seconds: number): MechEvent[] => Array.from({ length: seconds }, () => ({ type: 'tick', dtMs: 1000 }) as MechEvent),
};

// ── Vault definition ─────────────────────────────────────────────────────────

const DEFAULT_NOTES: Record<string, string> = {
  '#': 'solid wall',
  '.': 'floor',
  C: 'treasure chest',
  M: 'monster spawn',
};

export interface VaultSpec {
  id: string;
  name: string;
  floors: [number, number];
  lootTier: 'wooden' | 'iron' | 'golden';
  trick: string;
  rows: string[];
  notes?: Record<string, string>;
  /** Monster for each 'M' on the map. */
  spawn?: string;
  build: (m: Marks) => {
    mechanisms: MechanismSpec[];
    goal: VaultGoal;
    solution: MechEvent[];
    altSolutions?: MechEvent[][];
    carelessPath: MechEvent[];
  };
}

export function defineVault(v: VaultSpec): VaultDef {
  const m = marks(v.rows);
  const built = v.build(m);
  const legend: Record<string, LegendEntry> = {};
  for (const row of v.rows) {
    for (const ch of row) {
      if (legend[ch]) continue;
      legend[ch] = {
        tile: tileKindOf(ch),
        note: v.notes?.[ch] ?? DEFAULT_NOTES[ch] ?? 'marker',
        chest: ch === 'C' ? true : undefined,
        spawn: ch === 'M' ? v.spawn : undefined,
      };
    }
  }
  const entrances: Entrance[] = [];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (tileKindOf(v.rows[y][x]) !== 'floor') continue;
      const onBorder = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1;
      if (!onBorder) continue;
      const dir = x === 0 ? 'W' : x === m.w - 1 ? 'E' : y === 0 ? 'N' : 'S';
      entrances.push({ x, y, dir });
    }
  }
  const clues: string[] = [];
  for (const s of built.mechanisms) {
    if (s.clue) clues.push(s.clue);
    if (s.params.listenText) clues.push(s.params.listenText);
  }
  return {
    id: v.id,
    name: v.name,
    minFloor: v.floors[0],
    maxFloor: v.floors[1],
    width: m.w,
    height: m.h,
    rows: v.rows,
    legend,
    mechanisms: built.mechanisms,
    entrances,
    clues,
    lootTier: v.lootTier,
    chests: m.all('C'),
    spawns: m.all('M').map((q) => ({ tx: q.tx, ty: q.ty, monster: v.spawn ?? 'skeleton' })),
    goal: built.goal,
    solution: built.solution,
    altSolutions: built.altSolutions,
    carelessPath: built.carelessPath,
    trick: v.trick,
  };
}
