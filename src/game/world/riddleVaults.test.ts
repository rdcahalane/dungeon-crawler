import { describe, expect, it } from 'vitest';
import { E, pos } from './builder';
import { RIDDLE_VAULT_TEXT } from './roomTextRiddles';
import { textForArea } from './roomText';
import { goalMet, replay } from './testkit';
import { VAULT_BY_ID } from './vaults';
import type { MechEffect } from './types';

const IDS = [
  'bell_door', 'lampkeeper', 'held_breath', 'reckoners_row', 'dial_of_hours', 'twin_mouths', 'starved_judge', 'sleepers_bier',
];

const kinds = (effs: MechEffect[]) => new Set(effs.map((e) => e.type));
const grants = (effs: MechEffect[]) => effs.flatMap((e) => (e.type === 'grant' ? [e.itemKey] : []));
const texts = (effs: MechEffect[]) => effs.flatMap((e) => (e.type === 'message' ? [e.text] : []));

describe('riddle vaults: catalogue', () => {
  it('exist, with floors spread so every third of the dungeon has two or more', () => {
    for (const id of IDS) expect(VAULT_BY_ID[id], id).toBeDefined();
    const within = (lo: number, hi: number) => IDS.filter((id) => VAULT_BY_ID[id].minFloor >= lo && VAULT_BY_ID[id].maxFloor <= hi).length;
    expect(within(1, 4)).toBeGreaterThanOrEqual(2);
    expect(within(5, 8)).toBeGreaterThanOrEqual(2);
    expect(within(9, 12)).toBeGreaterThanOrEqual(2);
  });

  it('has read-aloud text for every one: titled, 25 to 60 words, no numerals or symbols', () => {
    for (const id of IDS) {
      const t = RIDDLE_VAULT_TEXT[id];
      expect(t, `${id} has no text`).toBeDefined();
      expect(t.title).toBe(VAULT_BY_ID[id].name);
      const words = t.read.split(/\s+/).filter(Boolean).length;
      expect(words, id).toBeGreaterThanOrEqual(25);
      expect(words, id).toBeLessThanOrEqual(60);
      expect(/^[A-Za-z ,.']+$/.test(t.read), `${id} text has digits or symbols`).toBe(true);
      expect(textForArea(id)).toBe(t);
    }
  });

  it('gives every riddle vault a riddle inscription and a second hint', () => {
    for (const id of IDS) {
      const v = VAULT_BY_ID[id];
      const ins = v.mechanisms.filter((m) => m.kind === 'inscription' || m.kind === 'riddle_door');
      expect(ins.length, id).toBeGreaterThanOrEqual(2);
      expect(ins.some((m) => m.params.look && m.params.look !== 'inscription'), `${id} lacks a physical hint`).toBe(true);
    }
  });

  it('never makes a wrong answer an unavoidable death', () => {
    for (const id of IDS) {
      for (const m of VAULT_BY_ID[id].mechanisms) {
        expect(m.params.lethal, `${m.id} lethal`).toBeFalsy();
        if (m.params.dice) expect(m.params.save, `${m.id} offers no save`).toBeDefined();
      }
    }
  });
});

describe('bell_door (typed answer)', () => {
  const v = VAULT_BY_ID.bell_door;
  it('opens on the answer, with or without an article, and grants a reward', () => {
    for (const a of ['bell', 'A bell.', 'the BELL', 'Church bell']) {
      const { state, effects } = replay(v.mechanisms, [E.answer('bd_door', a)]);
      expect(goalMet(state, v.goal), a).toBe(true);
      expect(grants(effects)).toEqual(['healing_potion']);
    }
  });
  it('two wrong words cost nothing, the third hurts, and the right word still works afterwards', () => {
    const wrong = [E.answer('bd_door', 'ashes'), E.answer('bd_door', 'a drum')];
    expect(kinds(replay(v.mechanisms, wrong).effects).has('damage')).toBe(false);
    const third = replay(v.mechanisms, [...wrong, E.answer('bd_door', 'open')]);
    expect(kinds(third.effects).has('damage')).toBe(true);
    const then = replay(v.mechanisms, [...wrong, E.answer('bd_door', 'open'), E.answer('bd_door', 'bell')]);
    expect(goalMet(then.state, v.goal)).toBe(true);
  });
});

describe('lampkeeper (offer a torch)', () => {
  const v = VAULT_BY_ID.lampkeeper;
  it('takes a torch, opens the gate and gives oil', () => {
    const { state, effects } = replay(v.mechanisms, [E.offer('lk_keeper', 'torch')]);
    expect(goalMet(state, v.goal)).toBe(true);
    expect(grants(effects)).toEqual(['oil_flask']);
    expect(effects.some((e) => e.type === 'consume' && e.itemKey === 'torch')).toBe(true);
  });
  it('a wrong gift is lost, curses the giver and wakes a skeleton on a floor tile', () => {
    const { state, effects } = replay(v.mechanisms, [E.offer('lk_keeper', 'ration')]);
    expect(goalMet(state, v.goal)).toBe(false);
    expect(kinds(effects)).toContain('status');
    const spawn = effects.find((e) => e.type === 'spawn');
    expect(spawn).toMatchObject({ monster: 'skeleton' });
  });
});

describe('held_breath (the answer is silence)', () => {
  const v = VAULT_BY_ID.held_breath;
  const plate = pos(5, 3);
  it('opens for someone who stands still on the worn flag, and not a moment sooner', () => {
    const short = replay(v.mechanisms, [E.step(plate), ...E.wait(14)]);
    expect(goalMet(short.state, v.goal)).toBe(false);
    const full = replay(v.mechanisms, [E.step(plate), ...E.wait(15)]);
    expect(goalMet(full.state, v.goal)).toBe(true);
    expect(grants(full.effects)).toEqual(['healing_potion']);
    expect(kinds(full.effects).has('damage')).toBe(false);
  });
  it('starts the wait over if the player steps off, and ignores a dropped item', () => {
    const steppedOff = replay(v.mechanisms, [E.step(plate), ...E.wait(10), E.leave(plate), E.step(pos(6, 3)), ...E.wait(30)]);
    expect(goalMet(steppedOff.state, v.goal)).toBe(false);
    const back = replay(v.mechanisms, [E.step(plate), ...E.wait(10), E.leave(plate), E.step(plate), ...E.wait(14)]);
    expect(goalMet(back.state, v.goal)).toBe(false);
    const item = replay(v.mechanisms, [E.step(plate, 'item'), ...E.wait(30)]);
    expect(goalMet(item.state, v.goal)).toBe(false);
  });
  it('the player who strikes the gong is shot at, twice at most', () => {
    const hit = replay(v.mechanisms, [E.step(pos(4, 3)), E.pull('hb_gong'), E.pull('hb_gong'), E.pull('hb_gong'), E.pull('hb_gong')]);
    expect(hit.effects.filter((e) => e.type === 'damage')).toHaveLength(2);
    expect(goalMet(hit.state, v.goal)).toBe(false);
  });
});

describe('reckoners_row (pull the handle the riddle names)', () => {
  const v = VAULT_BY_ID.reckoners_row;
  it('the thief handle opens the gate; the plaque beneath it says thief', () => {
    const { state, effects } = replay(v.mechanisms, [E.pull('rl_l4')]);
    expect(goalMet(state, v.goal)).toBe(true);
    expect(grants(effects)).toEqual(['gem_garnet']);
    const plaque = replay(v.mechanisms, [E.read('rl_p4')]);
    expect(texts(plaque.effects).join(' ')).toContain('THE THIEF');
  });
  it('every other handle fires the darts and leaves the gate shut', () => {
    for (const n of [1, 2, 3, 5]) {
      const { state, effects } = replay(v.mechanisms, [E.step(pos(2, 1)), E.pull(`rl_l${n}`)]);
      expect(goalMet(state, v.goal), `lever ${n}`).toBe(false);
      expect(kinds(effects).has('damage'), `lever ${n}`).toBe(true);
    }
  });
});

describe('dial_of_hours (ordered flags from a riddle)', () => {
  const v = VAULT_BY_ID.dial_of_hours;
  const a = v.mechanisms[0];
  it('opens in the order east, middle, west, south and grants a pearl', () => {
    const flags = [{ tx: a.tx, ty: a.ty }, ...(a.tiles ?? [])];
    const { state, effects } = replay(v.mechanisms, E.walk(flags));
    expect(goalMet(state, v.goal)).toBe(true);
    expect(grants(effects)).toEqual(['gem_pearl']);
  });
  it('any flag out of turn loosens a bolt that allows a save, and restarts the order', () => {
    const flags = [{ tx: a.tx, ty: a.ty }, ...(a.tiles ?? [])];
    const { state, effects } = replay(v.mechanisms, [E.step(flags[0]), E.step(flags[2]), ...E.walk(flags.slice(1))]);
    expect(effects.find((e) => e.type === 'damage')).toMatchObject({ save: 'wands', saveHalves: true });
    expect(goalMet(state, v.goal)).toBe(false);
  });
});

describe('twin_mouths (one face lies)', () => {
  const v = VAULT_BY_ID.twin_mouths;
  it('the west mouth lies every time and the east mouth never does', () => {
    const west = replay(v.mechanisms, [E.touch('tm_west'), E.touch('tm_west')]);
    const east = replay(v.mechanisms, [E.touch('tm_east'), E.touch('tm_east')]);
    const w = texts(west.effects).filter((t) => t.includes('mouth says'));
    const e = texts(east.effects).filter((t) => t.includes('mouth says'));
    expect(w[0]).toBe(w[1]);
    expect(e[0]).toBe(e[1]);
    expect(w[0]).toMatch(/west handle/i);
    expect(w[0]).toMatch(/We two speak nothing but the truth/);
    expect(e[0]).toMatch(/east handle opens/i);
  });
  it('the east handle opens the gate with a pearl; the west handle shoots', () => {
    const good = replay(v.mechanisms, [E.pull('tm_lever_e')]);
    expect(goalMet(good.state, v.goal)).toBe(true);
    expect(grants(good.effects)).toEqual(['gem_pearl']);
    const bad = replay(v.mechanisms, [E.step(pos(3, 4)), E.pull('tm_lever_w')]);
    expect(goalMet(bad.state, v.goal)).toBe(false);
    expect(bad.effects.find((e) => e.type === 'damage')).toMatchObject({ save: 'breath' });
  });
});

describe('starved_judge (offer a ration)', () => {
  const v = VAULT_BY_ID.starved_judge;
  it('takes a ration, opens the wall and gives a draught', () => {
    const { state, effects } = replay(v.mechanisms, [E.offer('sj_judge', 'ration')]);
    expect(goalMet(state, v.goal)).toBe(true);
    expect(grants(effects)).toEqual(['extra_healing_potion']);
  });
  it('gold or gems curse the giver and wake a ghoul', () => {
    const { state, effects } = replay(v.mechanisms, [E.offer('sj_judge', 'gem_garnet')]);
    expect(goalMet(state, v.goal)).toBe(false);
    expect(kinds(effects)).toContain('status');
    expect(effects.find((e) => e.type === 'spawn')).toMatchObject({ monster: 'ghoul' });
  });
});

describe('sleepers_bier (one right flag)', () => {
  const v = VAULT_BY_ID.sleepers_bier;
  const first = v.mechanisms[0];
  const flags = [{ tx: first.tx, ty: first.ty }, ...(first.tiles ?? [])];
  it('only the fourth flag from the door opens the wall', () => {
    const { state, effects } = replay(v.mechanisms, [E.step(flags[3])]);
    expect(goalMet(state, v.goal)).toBe(true);
    expect(grants(effects)).toEqual(['gem_ruby']);
  });
  it('each of the other four flags hurts, with a save for half', () => {
    for (const i of [0, 1, 2, 4]) {
      const { state, effects } = replay(v.mechanisms, [E.step(flags[i])]);
      expect(goalMet(state, v.goal), `flag ${i}`).toBe(false);
      expect(effects.find((e) => e.type === 'damage'), `flag ${i}`).toMatchObject({ save: 'wands', saveHalves: true });
    }
  });
  it('the flags run toe to crown from the door: the fourth is the heart', () => {
    const xs = flags.map((p) => p.tx);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(flags[3].tx).toBe(8);
    const bones = v.mechanisms.find((m) => m.id === 'sb_bones');
    expect(bones?.tx).toBe(flags[3].tx);
  });
});
