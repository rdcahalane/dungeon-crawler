/**
 * The `?quick=<class>&floor=N&level=L` test shortcut. `GameScene` builds a level-1 character from `charData`, so a deeper
 * start is handed over as `persistedStats` instead: a finished character whose hit points are what that level would
 * have rolled. Everything else (THAC0, saves, spell slots, title, XP width) `Player.recomputeDerived` works out from
 * `level`, and a caster's spellbook is created for that level because no `spellbook` is supplied.
 */
import { PLAYER_STATS, type ClassKey } from "./constants";
import type { CharCreationData, PlayerStats } from "./entities/Player";
import { starterKit } from "./items";
import { MAX_LEVEL, mulberry32 } from "./rules";
import { convertedHp } from "./scenes/game/AdndCombat";

/** `?level=` as a whole number from 1 to the level cap; anything else is level 1. */
export function parseQuickLevel(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_LEVEL, n) : 1;
}

export function quickStats(char: CharCreationData, level: number, floor: number): PlayerStats {
  const classKey: ClassKey = char.classKey;
  const kit = starterKit(classKey);
  // A fixed seed, so the same URL always gives the same hit points.
  const baseMaxHp = convertedHp(classKey, level, char.con, mulberry32(0x5eed + level));
  return {
    classKey, name: char.name, level, xp: 0, xpToNext: 1,
    str: char.str, dex: char.dex, con: char.con, int: char.int, wis: char.wis, cha: char.cha,
    hp: baseMaxHp, maxHp: baseMaxHp, baseMaxHp, drained: 0,
    mana: 0, maxMana: 0, bab: 0, attack: 0, defense: 10, fortSave: 0, reflexSave: 0, willSave: 0,
    searchBonus: 0, disableBonus: 0, weaponBonus: 0, armorBonus: 0,
    speed: PLAYER_STATS.BASE_SPEED,
    gold: kit.gold, floor,
    facing: { x: 0, y: 1 }, effects: [],
    cleaveReady: false, arcaneRecoveryTimer: 0, smiteBonus: 0, sneakBonusDice: 0, potions: 0, manaPotions: 0,
    inv: kit.toJSON(),
  };
}
