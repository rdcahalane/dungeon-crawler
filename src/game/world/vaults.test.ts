import { describe, expect, it } from 'vitest';
import { tileKindOf } from './builder';
import { footprint, isLethal } from './mechanisms';
import { goalMet, isHarmful, replay } from './testkit';
import { VAULTS } from './vaults';
import type { MechanismSpec, Pos, VaultDef } from './types';

const FLOOR_ONLY = new Set([
  'covered_pit', 'spiked_pit', 'pressure_plate', 'portcullis', 'teleporter', 'rune_floor', 'riddle_door',
  'locked_door', 'statue_offering', 'lure', 'illusory_wall', 'closing_walls', 'one_way_door',
]);
const WALL_ONLY = new Set(['dart_wall', 'talking_face', 'secret_door', 'sliding_wall', 'false_door']);

function charAt(v: VaultDef, p: Pos): string {
  return v.rows[p.ty]?.[p.tx] ?? '?';
}

function spotsOf(s: MechanismSpec): Pos[] {
  // gas rooms and tripwire dart walls keep their primary on a wall tile and their triggers on the floor
  if (s.kind === 'gas_room' || s.kind === 'dart_wall') return [];
  return footprint(s);
}

describe('vault catalogue', () => {
  it('has at least 14 vaults with unique ids, spread across floors', () => {
    expect(VAULTS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(VAULTS.map((v) => v.id)).size).toBe(VAULTS.length);
    expect(VAULTS.filter((v) => v.maxFloor <= 4).length).toBeGreaterThanOrEqual(3);
    expect(VAULTS.filter((v) => v.minFloor >= 5).length).toBeGreaterThanOrEqual(4);
    for (let f = 1; f <= 12; f++) expect(VAULTS.some((v) => f >= v.minFloor && f <= v.maxFloor)).toBe(true);
  });

  it('uses every mechanism kind somewhere across vaults or the tomb', async () => {
    const { TOMB } = await import('./tomb');
    const { ALL_KINDS } = await import('./types');
    const used = new Set<string>([
      ...VAULTS.flatMap((v) => v.mechanisms.map((m) => m.kind)),
      ...TOMB.mechanisms.map((m) => m.kind),
    ]);
    for (const k of ALL_KINDS) expect(used.has(k), `kind ${k} unused`).toBe(true);
  });

  it('has globally unique mechanism ids', async () => {
    const { TOMB } = await import('./tomb');
    const ids = [...VAULTS.flatMap((v) => v.mechanisms.map((m) => m.id)), ...TOMB.mechanisms.map((m) => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

for (const v of VAULTS) {
  describe(`vault ${v.id}`, () => {
    it('is a rectangle of legal size with entrances on its border', () => {
      expect(v.rows.length).toBe(v.height);
      for (const r of v.rows) expect(r.length).toBe(v.width);
      expect(v.width).toBeGreaterThanOrEqual(7);
      expect(v.height).toBeGreaterThanOrEqual(7);
      expect(v.width).toBeLessThanOrEqual(17);
      expect(v.height).toBeLessThanOrEqual(13);
      expect(v.entrances.length).toBeGreaterThan(0);
      for (const e of v.entrances) {
        expect(e.x === 0 || e.y === 0 || e.x === v.width - 1 || e.y === v.height - 1).toBe(true);
        expect(tileKindOf(v.rows[e.y][e.x])).toBe('floor');
      }
      // the only floor on the border is an entrance
      let borderFloor = 0;
      for (let y = 0; y < v.height; y++) {
        for (let x = 0; x < v.width; x++) {
          const onB = x === 0 || y === 0 || x === v.width - 1 || y === v.height - 1;
          if (onB && tileKindOf(v.rows[y][x]) === 'floor') borderFloor++;
        }
      }
      expect(borderFloor).toBe(v.entrances.length);
      for (const ch of new Set(v.rows.join(''))) expect(v.legend[ch]).toBeDefined();
    });

    it('keeps every mechanism inside the vault on a sensible tile', () => {
      for (const s of v.mechanisms) {
        for (const p of footprint(s)) {
          expect(p.tx).toBeGreaterThanOrEqual(0);
          expect(p.ty).toBeGreaterThanOrEqual(0);
          expect(p.tx).toBeLessThan(v.width);
          expect(p.ty).toBeLessThan(v.height);
        }
        for (const p of spotsOf(s)) {
          const kind = tileKindOf(charAt(v, p));
          if (FLOOR_ONLY.has(s.kind)) expect(kind, `${s.id} wants floor`).toBe('floor');
          if (WALL_ONLY.has(s.kind)) expect(kind, `${s.id} wants wall`).toBe('wall');
        }
        if (s.kind === 'gas_room') {
          expect(tileKindOf(charAt(v, { tx: s.tx, ty: s.ty }))).toBe('wall');
          for (const p of s.tiles ?? []) expect(tileKindOf(charAt(v, p))).toBe('floor');
        }
        if (s.kind === 'dart_wall') {
          expect(tileKindOf(charAt(v, { tx: s.tx, ty: s.ty }))).toBe('wall');
          for (const p of s.tiles ?? []) expect(tileKindOf(charAt(v, p))).toBe('floor');
        }
        if (s.kind === 'lever' || s.kind === 'inscription') expect(charAt(v, { tx: s.tx, ty: s.ty })).not.toBe('?');
        for (const k of ['dest', 'door', 'trigger', 'spawnAt'] as const) {
          const p = s.params[k];
          if (p) {
            expect(p.tx).toBeLessThan(v.width);
            expect(p.ty).toBeLessThan(v.height);
            expect(tileKindOf(charAt(v, p)), `${s.id}.${k}`).toBe('floor');
          }
        }
        const z = s.params.zone;
        if (z) {
          for (let y = z.ty; y < z.ty + z.h; y++) {
            for (let x = z.tx; x < z.tx + z.w; x++) expect(tileKindOf(charAt(v, { tx: x, ty: y })), `${s.id} zone`).toBe('floor');
          }
        }
        for (const l of [...s.links, ...(s.params.fires ?? [])]) expect(v.mechanisms.some((m) => m.id === l), `${s.id} -> ${l}`).toBe(true);
      }
    });

    it('gives every lethal mechanism a clue', () => {
      for (const s of v.mechanisms) {
        if (!isLethal(s)) continue;
        const own = !!s.clue && s.clue.length > 10;
        const about = v.mechanisms.some((m) => m.params.about === s.id && !!m.clue);
        expect(own || about, `${s.id} is lethal and has no clue`).toBe(true);
      }
      expect(v.clues.length).toBeGreaterThan(0);
    });

    it('is solved safely by its solution', () => {
      for (const sol of [v.solution, ...(v.altSolutions ?? [])]) {
        const { state, effects } = replay(v.mechanisms, sol);
        expect(effects.filter((e) => e.type === 'damage' || e.type === 'save_or_die')).toEqual([]);
        expect(effects.filter(isHarmful)).toEqual([]);
        expect(goalMet(state, v.goal)).toBe(true);
      }
    });

    it('hurts a careless player', () => {
      const { effects } = replay(v.mechanisms, v.carelessPath);
      expect(effects.some(isHarmful)).toBe(true);
    });
  });
}
