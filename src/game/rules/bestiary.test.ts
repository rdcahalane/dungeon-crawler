import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES, type EnemyTypeKey } from '../constants';
import {
  MONSTERS,
  MONSTER_KEYS,
  NEW_MONSTER_KEYS,
  NEW_MONSTER_TEXTURE_KEYS,
  canHarm,
  getMonster,
  hasSpecial,
  isTurnable,
  monstersForFloor,
  rollMonsterHp,
  thac0ForHd,
} from './bestiary';
import { mulberry32, parseDice } from './dice';

const ORIGINAL = Object.keys(ENEMY_TYPES) as EnemyTypeKey[];

describe('coverage of the existing game', () => {
  it('every EnemyTypeKey has a bestiary entry with matching texture and speed scale', () => {
    for (const key of ORIGINAL) {
      const def = MONSTERS[key];
      expect(def, key).toBeDefined();
      expect(def.key).toBe(key);
      expect(def.textureKey).toBe(ENEMY_TYPES[key].textureKey);
      expect(def.speed).toBe(ENEMY_TYPES[key].speed);
      expect(def.aggroRange).toBe(ENEMY_TYPES[key].aggroRange);
      expect(def.attackRange).toBe(ENEMY_TYPES[key].attackRange);
      expect(def.attackCooldownMs).toBe(ENEMY_TYPES[key].attackCooldown);
      expect(Boolean(def.undead)).toBe(Boolean(ENEMY_TYPES[key].isUndead));
    }
  });

  it('keeps the requested display names', () => {
    expect(MONSTERS.BASIC.name).toBe('Goblin');
    expect(MONSTERS.FAST.name).toBe('Kobold');
    expect(MONSTERS.TANK.name).toBe('Orc Brute');
  });

  it('original special flags carry over', () => {
    expect(hasSpecial(MONSTERS.GIANT_SPIDER, 'poison')).toBeDefined();
    expect(hasSpecial(MONSTERS.TROLL, 'regen')).toBeDefined();
    expect(hasSpecial(MONSTERS.DARK_ELF, 'ranged')).toBeDefined();
    expect(hasSpecial(MONSTERS.GHOST, 'incorporeal')?.ignoresArmor).toBe(true);
    expect(hasSpecial(MONSTERS.MIMIC, 'mimic')).toBeDefined();
  });
});

describe('new monsters', () => {
  it('has all nine new keys, with enemy_ textures', () => {
    expect(NEW_MONSTER_KEYS).toHaveLength(9);
    for (const k of ['GHOUL', 'WIGHT', 'WRAITH', 'GARGOYLE', 'OOZE', 'CULTIST', 'BONE_KNIGHT', 'GIANT_BAT', 'HOLLOW_KING'] as const) {
      expect(MONSTERS[k]).toBeDefined();
    }
    expect(NEW_MONSTER_TEXTURE_KEYS).toContain('enemy_ghoul');
    expect(NEW_MONSTER_TEXTURE_KEYS).toContain('enemy_hollow_king');
    expect(NEW_MONSTER_TEXTURE_KEYS.every((t) => t.startsWith('enemy_'))).toBe(true);
    expect(new Set(NEW_MONSTER_TEXTURE_KEYS).size).toBe(NEW_MONSTER_TEXTURE_KEYS.length);
  });

  it('specials match the brief', () => {
    expect(hasSpecial(MONSTERS.GHOUL, 'paralysis')?.save).toBe('death');
    expect(hasSpecial(MONSTERS.WIGHT, 'drain')?.maxHpPerHit).toBeGreaterThan(0);
    expect(hasSpecial(MONSTERS.WRAITH, 'incorporeal')).toBeDefined();
    expect(hasSpecial(MONSTERS.GARGOYLE, 'immune_normal_weapons')?.minPlus).toBe(1);
    expect(hasSpecial(MONSTERS.OOZE, 'corrode')?.target).toBe('weapon');
    expect(hasSpecial(MONSTERS.CULTIST, 'ranged')).toBeDefined();
    expect(hasSpecial(MONSTERS.CULTIST, 'caster')).toBeDefined();
    expect(MONSTERS.BONE_KNIGHT.undead).toBe(true);
  });

  it('the Hollow King is a phased, unturnable final boss', () => {
    const k = MONSTERS.HOLLOW_KING;
    expect(k.boss).toBe(true);
    expect(isTurnable(k)).toBe(false);
    const phases = hasSpecial(k, 'phases')!.phases;
    expect(phases.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < phases.length; i++) expect(phases[i].hpBelowPct).toBeLessThan(phases[i - 1].hpBelowPct);
    expect(isTurnable(MONSTERS.SKELETON)).toBe(true);
    expect(isTurnable(MONSTERS.BASIC)).toBe(false); // not undead at all
  });

  it('originality: no proprietary creature names', () => {
    const banned = /beholder|mind flayer|illithid|owlbear|displacer|drow|githyanki|carrion crawler|rust monster|umber hulk|acererak|diablo/i;
    for (const k of MONSTER_KEYS) {
      expect(banned.test(MONSTERS[k].name), k).toBe(false);
      expect(banned.test(k), k).toBe(false);
    }
  });
});

describe('stat block sanity', () => {
  it('every block is well formed', () => {
    for (const k of MONSTER_KEYS) {
      const m = getMonster(k);
      expect(m.key).toBe(k);
      expect(m.thac0).toBe(thac0ForHd(m.hd));
      expect(m.hd).toBeGreaterThan(0);
      expect(m.ac).toBeGreaterThanOrEqual(-10);
      expect(m.ac).toBeLessThanOrEqual(10);
      expect(m.attacks.length).toBeGreaterThan(0);
      for (const a of m.attacks) expect(() => parseDice(a.dice)).not.toThrow();
      expect(() => parseDice(m.hpDice)).not.toThrow();
      expect(m.speed).toBeGreaterThanOrEqual(20);
      expect(m.speed).toBeLessThanOrEqual(200);
      expect(m.attackCooldownMs).toBeGreaterThan(0);
      expect(m.xp).toBeGreaterThan(0);
      expect(m.morale).toBeGreaterThanOrEqual(2);
      expect(m.morale).toBeLessThanOrEqual(12);
      expect(m.minFloor).toBeGreaterThanOrEqual(1);
      expect(m.textureKey.length).toBeGreaterThan(0);
      if (m.undead) expect(m.morale).toBe(12);
    }
  });

  it('THAC0 never rises with hit dice', () => {
    let prev = 21;
    for (const hd of [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 30]) {
      const t = thac0ForHd(hd);
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(1);
      prev = t;
    }
    expect(thac0ForHd(1)).toBe(19);
  });

  it('xp rises with hit dice within regular monsters on the whole', () => {
    expect(MONSTERS.TROLL.xp).toBeGreaterThan(MONSTERS.BASIC.xp);
    expect(MONSTERS.HOLLOW_KING.xp).toBeGreaterThan(MONSTERS.TROLL.xp * 10);
  });

  it('hp rolls fall in the dice range and are seeded', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const hp = rollMonsterHp(MONSTERS.TROLL, a);
      expect(hp >= 12 && hp <= 54).toBe(true);
      expect(rollMonsterHp(MONSTERS.TROLL, b)).toBe(hp);
    }
  });
});

describe('floors', () => {
  it('floor 1 offers the easy ones only and never the boss', () => {
    const f1 = monstersForFloor(1);
    expect(f1).toContain('BASIC');
    expect(f1).toContain('GIANT_RAT');
    expect(f1).not.toContain('TROLL');
    for (let f = 1; f <= 20; f++) expect(monstersForFloor(f)).not.toContain('HOLLOW_KING');
  });

  it('every floor 1..12 has at least three choices and deeper floors unlock the undead', () => {
    for (let f = 1; f <= 12; f++) expect(monstersForFloor(f).length).toBeGreaterThanOrEqual(3);
    expect(monstersForFloor(5)).toContain('GHOUL');
    expect(monstersForFloor(8)).toContain('WIGHT');
    expect(monstersForFloor(9)).toContain('WRAITH');
    expect(monstersForFloor(6)).toContain('GARGOYLE');
  });

  it('every monster except the boss spawns somewhere in 1..12', () => {
    for (const k of MONSTER_KEYS) {
      if (MONSTERS[k].boss) continue;
      const any = Array.from({ length: 12 }, (_, i) => i + 1).some((f) => monstersForFloor(f).includes(k));
      expect(any, k).toBe(true);
    }
  });
});

describe('weapon immunity', () => {
  it('gargoyle needs magic, wight also takes silver, goblin takes anything', () => {
    expect(canHarm(MONSTERS.GARGOYLE, { plus: 0 })).toBe(false);
    expect(canHarm(MONSTERS.GARGOYLE, { plus: 1 })).toBe(true);
    expect(canHarm(MONSTERS.GARGOYLE, { plus: 0, silver: true })).toBe(false);
    expect(canHarm(MONSTERS.WIGHT, { plus: 0, silver: true })).toBe(true);
    expect(canHarm(MONSTERS.WIGHT, { plus: 0 })).toBe(false);
    expect(canHarm(MONSTERS.BASIC, { plus: 0 })).toBe(true);
  });
});
