/**
 * Characters for the simulator: ability scores, hit points, gear and spell book at three gear tiers.
 *
 *  - `starter`: `starterKit(classKey)` and nothing else.
 *  - `found`: what a character of that level plausibly carries from playing the floors below. It rolls the game's own
 *    `rollDrop` / `rollItem` for the kills, chests and floor pickups of floors 1 to F-1 (counts from the generator's
 *    own room and monster formulas), then wears the best usable pieces. Deterministic per seed.
 *  - `good`: the best common base gear the catalog offers at that floor, with the best plus the drop table can roll
 *    (+1, +2 from floor 3, +3 from floor 6) on weapon, body armor and shield.
 *
 * Wearing is a greedy search over the real `Inventory.equip` rules (class limits, two-handed vs shield) for the
 * highest damage-per-hit-taken score, see `gearScore`. Cursed items are skipped (assumed identified before use).
 */
import type { ClassKey } from '../constants';
import { FLOOR_10_PLUS_POOL, FLOOR_ENEMY_POOLS } from '../constants';
import {
  MONSTERS, Spellbook, abilityModifiers, diceAverage, hasSpecial, hitChance, intelligenceEffect, mulberry32, spellsFor,
  thac0For, wisdomBonusSlots, type AbilityScores, type MonsterKey, type Rng,
} from '../rules';
import {
  EQUIP_SLOTS, Inventory, ITEM_DEFS, equipmentBonuses, getDef, instantiate, makeItem, rollDrop, rollItem, starterKit,
  type EquipSlot, type ItemDef, type ItemInstance,
} from '../items';
import {
  convertedHp, playerArmorClass, playerDamageBonus, playerToHitBonus, weaponProfile, type PlayerSheet,
} from '../scenes/game/AdndCombat';
import type { Hero } from './fight';
import type { DropTuning, SimOverrides } from './overrides';

/** Potions a `found` character holds when it arrives (the rest were drunk on earlier floors). */
export const POTION_CAP = 6;

export type GearTier = 'starter' | 'found' | 'good';
export const GEAR_TIERS: readonly GearTier[] = ['starter', 'found', 'good'];
export const CLASSES: readonly ClassKey[] = ['fighter', 'thief', 'cleric', 'wizard'];

/**
 * A typical rolled character (4d6 drop lowest averages about 12; the best score about 16): the prime requisite
 * and Constitution get the good ones. Pass `scores` to override.
 */
export const DEFAULT_SCORES: Record<ClassKey, AbilityScores> = {
  fighter: { str: 16, dex: 13, con: 14, int: 10, wis: 10, cha: 9 },
  thief: { str: 11, dex: 16, con: 13, int: 12, wis: 10, cha: 11 },
  cleric: { str: 12, dex: 11, con: 13, int: 10, wis: 15, cha: 11 },
  wizard: { str: 9, dex: 13, con: 11, int: 16, wis: 11, cha: 11 },
};

export interface BuildOptions {
  classKey: ClassKey;
  level: number;
  /** The floor being tested; drops come from the floors below it. */
  floor: number;
  tier: GearTier;
  seed: number;
  scores?: AbilityScores;
  overrides?: SimOverrides;
}

export interface LoadoutSummary {
  ac: number;
  /** Total melee to-hit bonus added to the d20 (strength, gear, the real-time +2). */
  toHit: number;
  /** Average damage of one melee hit. */
  avgDamage: number;
  /** Chance to hit armor class 5 in melee. */
  hit5: number;
  maxHp: number;
  potions: number;
  weapon: string;
  armor: string;
}

// ── Spell book: the game's own recipe (Player._initInventoryAndSpellbook) ───

export function makeBook(classKey: ClassKey, level: number, scores: AbilityScores, inv: Inventory): Spellbook | null {
  if (classKey !== 'wizard' && classKey !== 'cleric') return null;
  const mods = abilityModifiers(scores, classKey);
  const eq = equipmentBonuses(inv);
  const bonus = [0, 0, 0, 0].map((_, i) => (mods.bonusSlots[i] ?? 0) + (eq.extraSlots[i + 1] ?? 0));
  const book = Spellbook.create(classKey, level, { bonusSlots: bonus });
  if (classKey === 'wizard') {
    // Player.scribeWizardSpells: every spell the character has slots for goes in the book.
    const maxLevel = Math.min(4, intelligenceEffect(scores.int).maxSpellLevel);
    for (let lv = 1; lv <= maxLevel; lv++) {
      if (book.maxSlots(lv) <= 0) continue;
      for (const sp of spellsFor('wizard', lv)) book.learn(sp.key);
    }
  }
  book.fillDefault();
  void wisdomBonusSlots;
  return book;
}

// ── Gear scoring and wearing ────────────────────────────────────────────────

type Assign = Partial<Record<EquipSlot, ItemInstance>>;
const WEAR_ORDER: readonly EquipSlot[] = ['weapon', 'armor', 'offhand', 'helm', 'cloak', 'boots', 'ring1', 'ring2', 'amulet'];

function poolFor(floor: number): readonly MonsterKey[] {
  return floor >= 10 ? FLOOR_10_PLUS_POOL : FLOOR_ENEMY_POOLS[Math.min(floor, FLOOR_ENEMY_POOLS.length - 1)] ?? [];
}

/** Build an inventory that wears exactly `assign`, or null if the game's own equip rules refuse it. */
function assemble(classKey: ClassKey, assign: Assign): Inventory | null {
  const inv = new Inventory(classKey, 0);
  for (const slot of WEAR_ORDER) {
    const it = assign[slot];
    if (!it) continue;
    const copy: ItemInstance = JSON.parse(JSON.stringify(it)) as ItemInstance;
    copy.quantity = 1;
    if (!inv.add(copy).ok) return null;
    if (!inv.equip(copy.id, slot).ok) return null;
  }
  return inv;
}

function sheetOf(classKey: ClassKey, level: number, scores: AbilityScores, inv: Inventory): PlayerSheet {
  return { classKey, level, scores, inventory: inv };
}

/**
 * Damage per swing against armor class 5, divided by how often a THAC0-17 monster hits this armor class. A weapon that
 * cannot hurt gargoyles, wights and wraiths loses that share of its value on the floors where they appear.
 */
function gearScore(classKey: ClassKey, level: number, floor: number, scores: AbilityScores, inv: Inventory): number {
  const sheet = sheetOf(classKey, level, scores, inv);
  const w = weaponProfile(inv);
  const avg = diceAverage(w.dice) + playerDamageBonus(sheet, 'melee');
  const p = hitChance({ thac0: thac0For(classKey, level), targetAc: 5, toHitBonus: playerToHitBonus(sheet, 'melee') });
  const pool = poolFor(floor);
  const immune = pool.filter((k) => !!hasSpecial(MONSTERS[k], 'immune_normal_weapons')).length / Math.max(1, pool.length);
  const harm = w.plus >= 1 || w.silver ? 1 : 1 - immune;
  const incoming = hitChance({ thac0: 17, targetAc: playerArmorClass(sheet) });
  return (p * Math.max(0.5, avg) * harm) / incoming;
}

function fits(def: ItemDef, slot: EquipSlot): boolean {
  if (slot === 'offhand') return def.kind === 'shield';
  if (slot === 'ring1' || slot === 'ring2') return def.slot === 'ring';
  return def.slot === slot;
}

function usable(classKey: ClassKey, it: ItemInstance): boolean {
  const d = getDef(it.defKey);
  if (!d.slot || it.cursed || d.ranged) return false;
  if (d.slot === 'offhand' && d.kind !== 'shield') return false;
  return d.classes.includes(classKey);
}

/** Greedy coordinate ascent over the nine slots, two passes. */
function wearBest(
  classKey: ClassKey, level: number, floor: number, scores: AbilityScores, start: Assign, candidates: ItemInstance[],
): Assign {
  const pool = candidates.filter((c) => usable(classKey, c));
  let best: Assign = { ...start };
  let baseInv = assemble(classKey, best);
  let bestScore = baseInv ? gearScore(classKey, level, floor, scores, baseInv) : -Infinity;
  for (let pass = 0; pass < 2; pass++) {
    for (const slot of WEAR_ORDER) {
      const opts: Array<ItemInstance | undefined> = pool.filter((c) => fits(getDef(c.defKey), slot));
      if (slot !== 'weapon' && slot !== 'armor') opts.push(undefined);
      for (const opt of opts) {
        if (opt && (slot === 'ring1' || slot === 'ring2') && (best.ring1?.id === opt.id || best.ring2?.id === opt.id)) continue;
        const trial: Assign = { ...best, [slot]: opt };
        if (opt && slot === 'weapon' && getDef(opt.defKey).twoHanded) delete trial.offhand;
        const inv = assemble(classKey, trial);
        if (!inv) continue;
        const sc = gearScore(classKey, level, floor, scores, inv);
        if (sc > bestScore + 1e-9) { best = trial; bestScore = sc; baseInv = inv; }
      }
    }
  }
  return best;
}

// ── Loot from the floors below ──────────────────────────────────────────────

/** Source: DungeonGenerator.ts pickChestTier. */
function chestTier(floor: number, rng: Rng): 'wooden' | 'iron' | 'golden' {
  if (floor >= 7 && rng.next() < 0.25) return 'golden';
  if (floor >= 4 && rng.next() < 0.4) return 'iron';
  return 'wooden';
}

const rint = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng.next() * (hi - lo + 1));

/**
 * Everything a careful character picks up on floors 1 to `upTo`. Room counts, monster counts, chest odds and floor
 * pickups follow DungeonGenerator.ts (lines noted at each step); the player kills `killFraction` of the monsters and
 * opens `chestFraction` of the chests and pickups.
 */
export function collectLoot(upTo: number, rng: Rng, tuning: DropTuning = {}, overrides?: SimOverrides): { items: ItemInstance[]; potions: { healing: number; extra: number } } {
  const killFraction = tuning.killFraction ?? 0.6;
  const chestFraction = tuning.chestFraction ?? 0.7;
  const div = overrides?.groupDivisor ?? 3;
  const items: ItemInstance[] = [];
  const potions = { healing: 0, extra: 0 };
  const take = (list: ItemInstance[]): void => {
    for (const it of list) {
      if (it.defKey === 'healing_potion') potions.healing += it.quantity;
      else if (it.defKey === 'extra_healing_potion') potions.extra += it.quantity;
      else items.push(it);
    }
  };
  for (let f = 1; f <= upTo; f++) {
    const pool = overrides?.pool ? overrides.pool(f) : poolFor(f);
    const rooms = Math.min(8 + f, 18); // generator: numRooms
    const inner = Math.max(1, rooms - 2); // enemies fill rooms 1..n-2
    const den = rint(rng, 0, inner - 1);
    for (let r = 0; r < inner; r++) {
      const count = r === den ? rint(rng, 3, 4 + Math.floor(f / div)) : rint(rng, 1, 2 + Math.floor(f / div));
      for (let e = 0; e < count; e++) {
        if (rng.next() >= killFraction) continue;
        const key = pool[Math.floor(rng.next() * pool.length)];
        const def = MONSTERS[key];
        take(rollDrop({ type: 'monster', hd: def.hd }, f, rng).items);
        if (r === den && e === 0) take([rollItem({ floor: f, rarityBias: 3 }, rng)]); // the champion's extra item
      }
    }
    // Regular chests: 35% of rooms 1..n-1; vault chests from floor 3 (2 to 3, one tier better).
    for (let r = 1; r < rooms; r++) {
      if (rng.next() < 0.35 && rng.next() < chestFraction) take(rollDrop({ type: 'chest', tier: chestTier(f, rng) }, f, rng).items);
      // Floor pickups: half the rooms, a quarter each potion, weapon, armor, treasure.
      if (rng.next() < 0.5 && rng.next() < chestFraction) {
        const kind = rint(rng, 0, 3);
        if (kind === 0) take([makeItem('healing_potion', rng)]);
        else if (kind === 1) take([rollItem({ floor: f, kind: 'weapon' }, rng)]);
        else if (kind === 2) take([rollItem({ floor: f, kind: 'armor' }, rng)]);
      }
    }
    if (f >= 3) {
      for (let c = 0, n = rint(rng, 2, 3); c < n; c++) {
        if (rng.next() < chestFraction) take(rollDrop({ type: 'chest', tier: chestTier(f + 1, rng) }, f, rng).items);
      }
    }
    if (f > 1 && f % 3 === 0) {
      take(rollDrop({ type: 'chest', tier: f >= 6 ? 'golden' : 'iron' }, f, rng).items);
      take(rollDrop({ type: 'monster', hd: f >= 6 ? MONSTERS.TROLL.hd : MONSTERS.TANK.hd }, f, rng).items);
      take([rollItem({ floor: f, rarityBias: 3 }, rng)]);
    }
    for (let i = 0; i < (tuning.extraItemsPerFloor ?? 0); i++) {
      take([rollItem({ floor: f, rarityBias: tuning.extraItemBias ?? 0 }, rng)]);
    }
    potions.healing += tuning.potionsPerFloor ?? 0;
  }
  return { items, potions };
}

// ── The three tiers ─────────────────────────────────────────────────────────

function startAssign(inv: Inventory): Assign {
  const a: Assign = {};
  for (const slot of EQUIP_SLOTS) if (inv.equipment[slot]) a[slot] = inv.equipment[slot];
  return a;
}

/** Best plus the drop table can produce at this floor (items/generate.ts rollPlus). */
export function bestPlus(floor: number): number {
  return floor >= 6 ? 3 : floor >= 3 ? 2 : 1;
}

function goodCandidates(classKey: ClassKey, floor: number): ItemInstance[] {
  const plus = bestPlus(floor);
  const out: ItemInstance[] = [];
  for (const d of ITEM_DEFS) {
    if (!d.slot || d.kind === 'treasure' || d.ranged || !d.classes.includes(classKey)) continue;
    if ((d.minFloor ?? 1) > floor) continue;
    if (d.slot === 'ring' || d.slot === 'amulet' || d.light) continue;
    const it = instantiate(d.key, `good-${d.key}`);
    if (d.kind === 'weapon' || d.slot === 'armor' || d.kind === 'shield') it.plus = plus;
    out.push(it);
  }
  return out;
}

const GOOD_CACHE = new Map<string, Assign>();

export function buildHero(opts: BuildOptions): Hero {
  const { classKey, level, floor, tier, seed } = opts;
  const scores = opts.scores ?? DEFAULT_SCORES[classKey];
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const starter = starterKit(classKey);
  let inv = starter;
  let potions = { healing: 2, extra: 0 };

  if (tier === 'found') {
    const loot = collectLoot(Math.max(0, floor - 1), rng, opts.overrides?.drops, opts.overrides);
    const cands = [...Object.values(starter.equipment), ...loot.items];
    const best = wearBest(classKey, level, floor, scores, startAssign(starter), cands);
    inv = assemble(classKey, best) ?? starter;
    // A real character drank most of the potions it found on the way down: it holds a handful, not a hoard.
    const cap = opts.overrides?.drops?.potionCap ?? POTION_CAP;
    const healing = Math.min(2 + loot.potions.healing, cap);
    potions = { healing, extra: Math.min(loot.potions.extra, Math.max(0, cap - healing)) };
  } else if (tier === 'good') {
    const ck = `${classKey}|${level}|${floor}|${JSON.stringify(scores)}`;
    let best = GOOD_CACHE.get(ck);
    if (!best) {
      best = wearBest(classKey, level, floor, scores, startAssign(starter), goodCandidates(classKey, floor));
      GOOD_CACHE.set(ck, best);
    }
    inv = assemble(classKey, best) ?? starter;
    potions = { healing: 5, extra: floor >= 4 ? 2 : 0 };
  }

  const bonus = equipmentBonuses(inv);
  const baseHp = convertedHp(classKey, level, scores.con, rng);
  const maxHp = Math.max(1, baseHp + bonus.maxHp);
  return {
    classKey, level, scores, inventory: inv, hp: maxHp, maxHp, drained: 0, potions,
    book: makeBook(classKey, level, scores, inv), blessToHit: 0, buffAc: 0, potionsUsed: 0,
  };
}

export function summarizeHero(h: Hero): LoadoutSummary {
  const sheet = sheetOf(h.classKey, h.level, h.scores, h.inventory);
  const w = weaponProfile(h.inventory);
  const toHit = playerToHitBonus(sheet, 'melee');
  const eq = h.inventory.equipment;
  const name = (it?: ItemInstance): string => (it ? `${getDef(it.defKey).name}${it.plus ? ` ${it.plus > 0 ? '+' : ''}${it.plus}` : ''}` : 'none');
  return {
    ac: playerArmorClass(sheet),
    toHit,
    avgDamage: diceAverage(w.dice) + playerDamageBonus(sheet, 'melee'),
    hit5: hitChance({ thac0: thac0For(h.classKey, h.level), targetAc: 5, toHitBonus: toHit }),
    maxHp: h.maxHp,
    potions: h.potions.healing + h.potions.extra,
    weapon: name(eq.weapon),
    armor: name(eq.armor),
  };
}
