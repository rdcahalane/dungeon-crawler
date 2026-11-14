import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { E, pos } from './builder';
import {
  applyEvent, blockedTiles, createMechState, deserialize, mechView, mechViews, mk, normalizeAnswer, serialize, tileOverrides,
} from './mechanisms';
import { isHarmful, replay, seeded } from './testkit';
import { TOMB } from './tomb';
import type { MechEffect, MechanismSpec } from './types';
import { VAULTS } from './vaults';

const types = (effs: MechEffect[]) => effs.map((e) => e.type);
const msgs = (effs: MechEffect[]) => effs.flatMap((e) => (e.type === 'message' ? [e.text] : []));

describe('engine basics', () => {
  it('rejects duplicate ids', () => {
    const a = mk('lever', 'x', pos(1, 1));
    expect(() => createMechState([a, a])).toThrow();
  });

  it('never touches Math.random', () => {
    const dir = new URL('.', import.meta.url).pathname;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain('Math.random');
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/from ['"]phaser['"]/);
    }
  });

  it('normalizes riddle answers', () => {
    expect(normalizeAnswer('  The ASHES!! ')).toBe('ashes');
    expect(normalizeAnswer('an Anvil.')).toBe('anvil');
    expect(normalizeAnswer('a')).toBe('a');
  });
});

describe('probe and search', () => {
  const pit = mk('covered_pit', 'pit', pos(3, 3), { hidden: true, diff: 10, clue: 'a pit' });

  it('probe reveals a covered pit safely, and it then blocks', () => {
    const { state, effects } = replay([pit], [E.probe(pos(3, 3))]);
    expect(effects.some(isHarmful)).toBe(false);
    expect(types(effects)).toContain('reveal');
    expect(mechView(state, 'pit')).toMatchObject({ textureKey: 'mech_pit_open', blocks: true, visible: true });
    expect(blockedTiles(state).has('3,3')).toBe(true);
  });

  it('a hidden pit is invisible and does not block until found, and swallows a careless player', () => {
    const s = createMechState([pit]);
    expect(mechView(s, 'pit')).toMatchObject({ visible: false, blocks: false });
    const effs = applyEvent(s, E.step(pos(3, 3)), seeded(1));
    expect(types(effs)).toContain('fall');
  });

  it('search succeeds when roll <= chance - difficulty, and only within one tile', () => {
    expect(replay([pit], [E.search(pos(3, 4), 60, 50)]).state.rt.pit.revealed).toBe(true); // 50 <= 50
    expect(replay([pit], [E.search(pos(3, 4), 60, 51)]).state.rt.pit.revealed).toBe(false);
    expect(replay([pit], [E.search(pos(3, 5), 60, 1)]).state.rt.pit.revealed).toBe(false); // two tiles away
  });

  it('an item dropped on a covered pit reveals it without harm', () => {
    const { state, effects } = replay([pit], [E.step(pos(3, 3), 'item')]);
    expect(effects.some(isHarmful)).toBe(false);
    expect(state.rt.pit.revealed).toBe(true);
  });

  it('listen carries a chance and speaks only on success', () => {
    const door = mk('secret_door', 'sd', pos(4, 4), { hidden: true, params: { listenText: 'a whistle' } });
    expect(msgs(replay([door], [E.listen(pos(4, 5), 30, 30)]).effects)).toEqual(['a whistle']);
    expect(msgs(replay([door], [E.listen(pos(4, 5), 30, 31)]).effects)).toEqual([]);
  });
});

describe('plates, levers, doors', () => {
  const specs: MechanismSpec[] = [
    mk('pressure_plate', 'plate', pos(2, 2), { params: { momentary: true }, links: ['gate'] }),
    mk('portcullis', 'gate', pos(5, 2)),
    mk('lever', 'lev', pos(0, 0), { links: ['gate2'] }),
    mk('portcullis', 'gate2', pos(6, 2)),
  ];

  it('a sack on a momentary plate holds the gate; removing it lets the gate fall', () => {
    const s = createMechState(specs);
    const r = seeded(1);
    expect(mechView(s, 'gate').blocks).toBe(true);
    applyEvent(s, E.step(pos(2, 2)), r);
    applyEvent(s, E.step(pos(2, 2), 'item'), r);
    applyEvent(s, E.leave(pos(2, 2)), r); // the player steps off, the sack stays
    expect(mechView(s, 'gate').blocks).toBe(false);
    expect(blockedTiles(s).has('5,2')).toBe(false);
    applyEvent(s, E.leave(pos(2, 2)), r); // the sack is picked up
    expect(mechView(s, 'gate').blocks).toBe(true);
  });

  it('a lever toggles its portcullis', () => {
    const s = createMechState(specs);
    const r = seeded(1);
    applyEvent(s, E.pull('lev'), r);
    expect(mechView(s, 'gate2').blocks).toBe(false);
    expect(mechView(s, 'lev').textureKey).toBe('mech_lever_on');
    applyEvent(s, E.pull('lev'), r);
    expect(mechView(s, 'gate2').blocks).toBe(true);
  });

  it('a plate fires a dart wall at the player standing in its zone only', () => {
    const darts = mk('dart_wall', 'd', pos(2, 0), { params: { zone: { tx: 1, ty: 1, w: 3, h: 3 }, dice: [2, 4] } });
    const plate = mk('pressure_plate', 'p', pos(2, 2), { links: ['d'] });
    expect(replay([darts, plate], [E.step(pos(0, 2)), E.step(pos(2, 2), 'item')]).effects.some(isHarmful)).toBe(false);
    expect(replay([darts, plate], [E.step(pos(2, 2))]).effects.some((e) => e.type === 'damage')).toBe(true);
  });

  it('a lever disarms a dart wall that a plate would fire', () => {
    const darts = mk('dart_wall', 'd', pos(2, 0), { params: { zone: { tx: 1, ty: 1, w: 3, h: 3 } } });
    const plate = mk('pressure_plate', 'p', pos(2, 2), { links: ['d'] });
    const lev = mk('lever', 'l', pos(0, 0), { links: ['d'] });
    const { effects } = replay([darts, plate, lev], [E.pull('l'), E.step(pos(2, 2))]);
    expect(effects.some((e) => e.type === 'damage')).toBe(false);
  });
});

describe('puzzles', () => {
  it('rune floor needs the right order and punishes the wrong one', () => {
    const runes = mk('rune_floor', 'r', pos(1, 1), {
      tiles: [pos(3, 1), pos(5, 1)],
      params: { order: [2, 0, 1], dice: [2, 6] },
      links: ['g'],
    });
    const g = mk('portcullis', 'g', pos(9, 9));
    const bad = replay([runes, g], [E.step(pos(3, 1))]);
    expect(bad.effects.some((e) => e.type === 'damage')).toBe(true);
    const good = replay([runes, g], [E.step(pos(5, 1)), E.step(pos(1, 1)), E.step(pos(3, 1))]);
    expect(good.effects.some(isHarmful)).toBe(false);
    expect(good.state.rt.g.on).toBe(true);
    // a wrong step resets progress
    const reset = replay([runes, g], [E.step(pos(5, 1)), E.step(pos(3, 1)), E.step(pos(1, 1)), E.step(pos(3, 1))]);
    expect(reset.state.rt.g.on).toBe(false);
  });

  it('riddle door accepts several answers and punishes three wrong ones', () => {
    const door = mk('riddle_door', 'rd', pos(1, 1), { params: { answers: ['ash', 'ashes'], dice: [2, 6] } });
    expect(replay([door], [E.answer('rd', 'Ashes')]).state.rt.rd.on).toBe(true);
    expect(replay([door], [E.answer('rd', 'the ash!')]).state.rt.rd.on).toBe(true);
    const wrong = replay([door], [E.answer('rd', 'a'), E.answer('rd', 'b'), E.answer('rd', 'c')]);
    expect(wrong.state.rt.rd.on).toBe(false);
    expect(wrong.effects.filter((e) => e.type === 'damage')).toHaveLength(1);
  });

  it('statue accepts the wanted item and curses anything else', () => {
    const st = mk('statue_offering', 's', pos(1, 1), { params: { wants: 'torch' } });
    expect(types(replay([st], [E.offer('s', 'gem')]).effects)).toContain('status');
    const ok = replay([st], [E.offer('s', 'torch')]);
    expect(ok.state.rt.s.on).toBe(true);
    expect(ok.effects.some(isHarmful)).toBe(false);
    expect(ok.effects).toContainEqual({ type: 'consume', itemKey: 'torch' });
  });

  it('talking face tells the truth only while its flag is set', () => {
    const face = mk('talking_face', 'f', pos(1, 1), { params: { truthFlag: 'warm', trueText: 'T', falseText: 'F' } });
    const lev = mk('lever', 'l', pos(0, 0), { params: { setsFlag: 'warm' } });
    expect(msgs(replay([face, lev], [E.touch('f')]).effects)).toEqual(['F']);
    expect(msgs(replay([face, lev], [E.pull('l'), E.touch('f')]).effects).slice(-1)).toEqual(['T']);
    expect(msgs(replay([face, lev], [E.pull('l'), E.pull('l'), E.touch('f')]).effects).slice(-1)).toEqual(['F']);
  });

  it('lure is save or die', () => {
    const lure = mk('lure', 'l', pos(1, 1));
    expect(types(replay([lure], [E.touch('l')]).effects)).toContain('save_or_die');
  });

  it('locked door: key, seats, thief pick, and the needle', () => {
    const keyed = mk('locked_door', 'k', pos(1, 1), { params: { keyItem: 'key' } });
    expect(replay([keyed], [E.open('k', 'key')]).state.rt.k.on).toBe(true);
    expect(replay([keyed], [E.open('k', 'spoon')]).state.rt.k.on).toBe(false);
    expect(replay([keyed], [E.pick('k', 40, 40)]).state.rt.k.on).toBe(true);
    expect(replay([keyed], [E.pick('k', 41, 40)]).state.rt.k.on).toBe(false);
    const seats = mk('locked_door', 's', pos(1, 1), { params: { seats: ['a', 'b'], unpickable: true } });
    const part = replay([seats], [E.open('s', 'a')]);
    expect(part.state.rt.s.on).toBe(false);
    expect(replay([seats], [E.open('s', 'a'), E.open('s', 'b')]).state.rt.s.on).toBe(true);
    expect(replay([seats], [E.pick('s', 1, 99)]).state.rt.s.on).toBe(false);
    const needle = mk('locked_door', 'n', pos(1, 1), { params: { keyItem: 'key', needle: true }, clue: 'pin' });
    expect(types(replay([needle], [E.open('n')]).effects)).toContain('damage');
    expect(replay([needle], [E.search(pos(1, 2)), E.open('n')]).effects.filter((e) => e.type === 'damage')).toHaveLength(0);
  });

  it('false door springs once, and is harmless once its trick is found', () => {
    const fd = mk('false_door', 'f', pos(1, 1), { params: { springs: 'darts' }, clue: 'paint' });
    expect(types(replay([fd], [E.open('f')]).effects)).toContain('damage');
    expect(replay([fd], [E.search(pos(1, 2)), E.open('f')]).effects.some((e) => e.type === 'damage')).toBe(false);
    const two = replay([fd], [E.open('f'), E.open('f')]);
    expect(two.effects.filter((e) => e.type === 'damage')).toHaveLength(1);
  });

  it('illusory wall is non-blocking and dissolves when touched, probed or walked through', () => {
    const w = mk('illusory_wall', 'w', pos(2, 2));
    const s = createMechState([w]);
    expect(mechView(s, 'w')).toMatchObject({ textureKey: 'wall', visible: true, blocks: false });
    applyEvent(s, E.step(pos(2, 2)), seeded(1));
    expect(mechView(s, 'w').visible).toBe(false);
  });

  it('one-way door seals behind the player', () => {
    const d = mk('one_way_door', 'o', pos(5, 5), { params: { door: pos(4, 5) } });
    const s = createMechState([d]);
    expect(mechView(s, 'o')).toMatchObject({ tx: 4, ty: 5, blocks: false });
    applyEvent(s, E.step(pos(5, 5)), seeded(1));
    expect(mechView(s, 'o')).toMatchObject({ tx: 4, ty: 5, blocks: true });
    expect(blockedTiles(s).has('4,5')).toBe(true);
  });

  it('teleporter moves the player, updates where the engine thinks they are, and respects unless', () => {
    const t = mk('teleporter', 't', pos(1, 1), { hidden: true, params: { dest: pos(9, 9), unless: 'l' } });
    const l = mk('lever', 'l', pos(0, 0));
    const r = replay([t, l], [E.step(pos(1, 1))]);
    expect(r.effects).toContainEqual({ type: 'teleport', tx: 9, ty: 9 });
    expect(r.state.playerAt).toEqual(pos(9, 9));
    expect(replay([t, l], [E.pull('l'), E.step(pos(1, 1))]).effects.some((e) => e.type === 'teleport')).toBe(false);
  });
});

describe('timed rooms', () => {
  const zone = { tx: 2, ty: 2, w: 7, h: 7 };
  const cw = (extra = {}) =>
    mk('closing_walls', 'cw', pos(5, 5), { hidden: true, params: { zone, totalMs: 10000, stages: 3, ...extra }, links: ['door'] });
  const door = mk('portcullis', 'door', pos(1, 5), { params: { startOpen: true } });

  it('walls close in stages, retract on spikes, and crush on the clock', () => {
    const spikes = replay([cw(), door], [E.step(pos(5, 5)), ...E.wait(4), E.offer('cw', 'iron_spikes')]);
    expect(spikes.state.rt.cw.spent).toBe(true);
    expect(spikes.effects.some((e) => e.type === 'save_or_die')).toBe(false);
    expect(spikes.effects).toContainEqual({ type: 'consume', itemKey: 'iron_spikes' });
    expect(mechView(spikes.state, 'door').blocks).toBe(false);
    const sets = spikes.effects.filter((e) => e.type === 'set_tile');
    expect(sets.some((e) => e.type === 'set_tile' && e.tile === 0)).toBe(true);
    expect(sets.some((e) => e.type === 'set_tile' && e.tile === 1)).toBe(true);
    const crush = replay([cw(), door], [E.step(pos(5, 5)), ...E.wait(11)]);
    expect(types(crush.effects)).toContain('save_or_die');
    expect(mechView(crush.state, 'door').blocks).toBe(false); // the doors reopen once it has finished
  });

  it('does not crush a player who is out of the zone, and spikes need the right item', () => {
    const r = replay([cw(), door], [E.step(pos(5, 5)), E.step(pos(0, 5)), ...E.wait(11)]);
    expect(types(r.effects)).not.toContain('save_or_die');
    const wrongItem = replay([cw(), door], [E.step(pos(5, 5)), E.offer('cw', 'torch')]);
    expect(wrongItem.state.rt.cw.on).toBe(true);
  });

  it('gas room fills, hurts and kills on the clock, and a vent lever stops it', () => {
    const gas = mk('gas_room', 'gas', pos(0, 0), { tiles: [pos(5, 5)], params: { zone, totalMs: 6000 }, links: ['door'] });
    const lev = mk('lever', 'lev', pos(0, 1), { links: ['gas'] });
    const dead = replay([gas, door, lev], [E.step(pos(5, 5)), ...E.wait(7)]);
    expect(types(dead.effects)).toContain('damage');
    expect(types(dead.effects)).toContain('save_or_die');
    const saved = replay([gas, door, lev], [E.step(pos(5, 5)), E.tick(1000), E.pull('lev'), ...E.wait(7)]);
    expect(types(saved.effects)).not.toContain('save_or_die');
    expect(mechView(saved.state, 'door').blocks).toBe(false);
  });

  it('a tripwire dart wall spends its volley harmlessly on a probe', () => {
    const w = mk('dart_wall', 'w', pos(5, 0), {
      tiles: [pos(5, 3)], params: { tripwire: true, zone: { tx: 3, ty: 1, w: 5, h: 5 }, dice: [1, 6], ammo: 1 },
    });
    expect(replay([w], [E.probe(pos(5, 3)), E.step(pos(5, 3))]).effects.some(isHarmful)).toBe(false);
    expect(replay([w], [E.step(pos(5, 3))]).effects.some((e) => e.type === 'damage')).toBe(true);
  });
});

describe('views and persistence', () => {
  it('every kind yields a view and the tomb draws only known texture keys', () => {
    const known = /^(wall|mech_(plate|plate_down|lever_off|lever_on|pit_open|pit_spikes|portcullis|dart_hole|gas_vent|rune_[a-f]|statue|face|inscription|false_door|door|door_open|teleporter|lure|scorch|stain|bones))$/;
    const s = createMechState(TOMB.mechanisms);
    for (const v of mechViews(s)) expect(v.textureKey).toMatch(known);
    for (const v of VAULTS) for (const x of mechViews(createMechState(v.mechanisms))) expect(x.textureKey).toMatch(known);
  });

  it('survives a serialize/deserialize round trip mid-solution in every vault and the tomb', () => {
    const runs = [
      ...VAULTS.map((v) => ({ specs: v.mechanisms, solution: v.solution })),
      { specs: TOMB.mechanisms, solution: TOMB.solution },
    ];
    for (const { specs, solution } of runs) {
      const whole = replay(specs, solution);
      const half = Math.floor(solution.length / 2);
      const rng = seeded(7);
      const state = createMechState(specs);
      for (const ev of solution.slice(0, half)) applyEvent(state, ev, rng);
      const revived = deserialize(serialize(state), specs);
      for (const ev of solution.slice(half)) applyEvent(revived, ev, rng);
      expect(JSON.parse(serialize(revived))).toEqual(JSON.parse(serialize(whole.state)));
      expect(tileOverrides(revived)).toEqual(tileOverrides(whole.state));
      expect([...blockedTiles(revived)].sort()).toEqual([...blockedTiles(whole.state)].sort());
    }
  });
});
