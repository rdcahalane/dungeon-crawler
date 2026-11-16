/** Character sheet numbers for the inventory strip. Phaser-free. */
import type { Inventory, Encumbrance, SaveCategory } from "../../items";
import { equipmentBonuses, getDef } from "../../items";
import { saveTarget, thac0For, titleFor } from "../../rules/classes";
import type { ClassKey } from "../../rules/classes";

export const SAVE_ORDER: readonly SaveCategory[] = ['death', 'petrify', 'wands', 'breath', 'spells'];
export const SAVE_LABELS: Record<SaveCategory, string> = {
  death: 'DEATH', petrify: 'PETR', wands: 'WAND', breath: 'BRTH', spells: 'SPEL',
};

export interface SheetInput {
  classKey: string;
  level: number;
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
}

/** Optional values the HUD payload may already carry; they win over computed ones. */
export interface SheetHud {
  thac0?: number;
  ac?: number;
  saves?: Partial<Record<SaveCategory, number>>;
  title?: string;
}

export interface Sheet {
  title: string;
  abilities: Array<[label: string, value: number]>;
  thac0: number;
  /** Descending: lower is better. */
  ac: number;
  saves: Record<SaveCategory, number>;
  enc: Encumbrance;
}

export function buildSheet(stats: SheetInput, inv: Inventory, hud: SheetHud = {}): Sheet {
  const ck = stats.classKey as ClassKey;
  const b = equipmentBonuses(inv);
  const saves = {} as Record<SaveCategory, number>;
  for (const c of SAVE_ORDER) saves[c] = hud.saves?.[c] ?? saveTarget(ck, stats.level, c) - b.saveBonus[c];
  return {
    title: hud.title ?? titleFor(ck, stats.level),
    abilities: [
      ['STR', stats.str], ['DEX', stats.dex], ['CON', stats.con],
      ['INT', stats.int], ['WIS', stats.wis], ['CHA', stats.cha],
    ],
    thac0: hud.thac0 ?? thac0For(ck, stats.level) - b.toHit,
    ac: hud.ac ?? b.ac,
    saves,
    enc: inv.encumbrance(stats.str),
  };
}

/** Burn seconds left in an equipped light source, or undefined when nothing lit is held. */
export function heldLightSeconds(inv: Inventory): number | undefined {
  for (const it of inv.equipped()) {
    const d = getDef(it.defKey);
    if (d.light) return it.charges ?? d.light.burnSec;
  }
  return undefined;
}
