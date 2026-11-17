/**
 * Spells (wizard and cleric, spell levels 1 to 4) and the memorize / cast /
 * rest `Spellbook`. No mana: a caster memorizes spells into slots, casting
 * spends the memorized copy, and a full rest restores them.
 */
import type { ClassKey } from '../constants';
import { spellSlots, CLASS_RULES, type SaveCategory } from './classes';
import { d100 } from './dice';
import type { Rng } from './dice';
import { intelligenceEffect } from './abilities';

export type SpellRange = 'self' | 'touch' | 'near' | 'far';

/** Pixel reach for each range band on the 32px grid. */
export const RANGE_PX: Record<SpellRange, number> = { self: 0, touch: 36, near: 160, far: 320 };

export type Dice = readonly [count: number, sides: number];

export type SpellEffect =
  | {
      kind: 'damage';
      dice: Dice;
      bonus?: number;
      /** Dice rolled = count x caster level, capped by `maxDice`. */
      perLevel?: boolean;
      maxDice?: number;
      element: 'fire' | 'lightning' | 'cold' | 'force' | 'holy';
      save?: SaveCategory;
      saveHalves?: boolean;
      radiusPx?: number;
    }
  | { kind: 'missiles'; dice: Dice; bonus: number; base: number; extraPerLevels: number }
  | { kind: 'heal'; dice: Dice; bonus?: number; perLevelBonus?: number; radiusPx?: number }
  | { kind: 'buff'; stat: 'toHit' | 'damage' | 'ac' | 'save'; amount: number; durationMs: number; radiusPx?: number }
  | {
      kind: 'status';
      status: 'asleep' | 'held' | 'webbed';
      durationMs: number;
      save?: SaveCategory;
      /** Only monsters up to this many hit dice are affected (sleep). */
      maxHd?: number;
      maxTargets?: number;
      radiusPx?: number;
      /** Undead are unaffected. */
      undeadImmune?: boolean;
    }
  | { kind: 'detect'; what: 'traps' | 'magic' | 'evil'; radiusPx: number; durationMs: number }
  | { kind: 'light'; radiusTiles: number; durationMs: number }
  | { kind: 'unlock' }
  | { kind: 'cure'; what: 'poison' | 'disease' | 'curse' };

export interface SpellDef {
  key: string;
  name: string;
  level: 1 | 2 | 3 | 4;
  classKey: 'wizard' | 'cleric';
  range: SpellRange;
  effect: SpellEffect;
  description: string;
}

const MIN = 60_000;

const defs: SpellDef[] = [
  // ── Wizard ────────────────────────────────────────────────────────────────
  {
    key: 'magic_missile', name: 'Magic Missile', level: 1, classKey: 'wizard', range: 'far',
    effect: { kind: 'missiles', dice: [1, 4], bonus: 1, base: 1, extraPerLevels: 2 },
    description: 'Glowing darts that never miss. One at level 1, one more every two levels, each 1d4+1.',
  },
  {
    key: 'sleep', name: 'Sleep', level: 1, classKey: 'wizard', range: 'near',
    effect: { kind: 'status', status: 'asleep', durationMs: 30_000, maxHd: 4, maxTargets: 6, radiusPx: 64, undeadImmune: true },
    description: 'Puts weak creatures of up to four hit dice to sleep. No saving throw. Undead are unaffected.',
  },
  {
    key: 'light', name: 'Light', level: 1, classKey: 'wizard', range: 'near',
    effect: { kind: 'light', radiusTiles: 4, durationMs: 10 * MIN },
    description: 'A steady glow with no torch to burn down.',
  },
  {
    key: 'detect_magic', name: 'Detect Magic', level: 1, classKey: 'wizard', range: 'self',
    effect: { kind: 'detect', what: 'magic', radiusPx: 320, durationMs: 2 * MIN },
    description: 'Magical items and enchanted things glow faintly nearby.',
  },
  {
    key: 'web', name: 'Web', level: 2, classKey: 'wizard', range: 'near',
    effect: { kind: 'status', status: 'webbed', durationMs: 20_000, save: 'breath', radiusPx: 80 },
    description: 'Sticky strands fill an area. Anything caught is held until it saves or burns free.',
  },
  {
    key: 'knock', name: 'Knock', level: 2, classKey: 'wizard', range: 'near',
    effect: { kind: 'unlock' },
    description: 'Opens one locked, stuck or barred door or chest. Does not touch magical seals or portcullises.',
  },
  {
    key: 'fireball', name: 'Fireball', level: 3, classKey: 'wizard', range: 'far',
    effect: { kind: 'damage', dice: [1, 6], perLevel: true, maxDice: 10, element: 'fire', save: 'spells', saveHalves: true, radiusPx: 100 },
    description: 'A burst of flame, 1d6 per caster level (to 10d6) in a wide circle. A save halves it.',
  },
  {
    key: 'lightning_bolt', name: 'Lightning Bolt', level: 3, classKey: 'wizard', range: 'far',
    effect: { kind: 'damage', dice: [1, 6], perLevel: true, maxDice: 10, element: 'lightning', save: 'spells', saveHalves: true },
    description: 'A bar of lightning down a line. 1d6 per caster level (to 10d6). A save halves it.',
  },
  {
    key: 'ice_storm', name: 'Ice Storm', level: 4, classKey: 'wizard', range: 'far',
    effect: { kind: 'damage', dice: [3, 10], element: 'cold', save: 'breath', saveHalves: true, radiusPx: 90 },
    description: 'Hail and sleet hammer an area for 3d10. A save halves it.',
  },

  // ── Cleric ────────────────────────────────────────────────────────────────
  {
    key: 'cure_light_wounds', name: 'Cure Light Wounds', level: 1, classKey: 'cleric', range: 'touch',
    effect: { kind: 'heal', dice: [1, 8] },
    description: 'A touch that heals 1d8 hit points.',
  },
  {
    key: 'bless', name: 'Bless', level: 1, classKey: 'cleric', range: 'near',
    effect: { kind: 'buff', stat: 'toHit', amount: 1, durationMs: 6 * MIN, radiusPx: 120 },
    description: 'Allies nearby gain +1 to hit and +1 to morale-style saves against fear for a few minutes.',
  },
  {
    key: 'protection_from_evil', name: 'Protection from Evil', level: 1, classKey: 'cleric', range: 'touch',
    effect: { kind: 'buff', stat: 'ac', amount: 2, durationMs: 12 * MIN },
    description: 'Evil creatures strike at AC two points better for the target, and saves against them gain +2.',
  },
  {
    key: 'find_traps', name: 'Find Traps', level: 2, classKey: 'cleric', range: 'self',
    effect: { kind: 'detect', what: 'traps', radiusPx: 192, durationMs: 3 * MIN },
    description: 'Hidden mechanical traps within sight reveal themselves. It does not tell you how to beat them.',
  },
  {
    key: 'hold_person', name: 'Hold Person', level: 2, classKey: 'cleric', range: 'far',
    effect: { kind: 'status', status: 'held', durationMs: 16_000, save: 'spells', maxTargets: 3, undeadImmune: true },
    description: 'Freezes up to three humanoids in place. A save negates. Undead are unaffected.',
  },
  {
    key: 'remove_curse', name: 'Remove Curse', level: 3, classKey: 'cleric', range: 'touch',
    effect: { kind: 'cure', what: 'curse' },
    description: 'Lifts a curse from a person or from an item they carry.',
  },
  {
    key: 'cure_serious_wounds', name: 'Cure Serious Wounds', level: 4, classKey: 'cleric', range: 'touch',
    effect: { kind: 'heal', dice: [2, 8], bonus: 1 },
    description: 'A touch that heals 2d8+1 hit points.',
  },
  {
    key: 'neutralize_poison', name: 'Neutralize Poison', level: 4, classKey: 'cleric', range: 'touch',
    effect: { kind: 'cure', what: 'poison' },
    description: 'Ends poison in the body. Even a victim who failed a save against death stops dying.',
  },
];

export const SPELL_DEFS: Record<string, SpellDef> = Object.fromEntries(defs.map((s) => [s.key, s]));
export const SPELL_KEYS: readonly string[] = defs.map((s) => s.key);

export function getSpell(key: string): SpellDef | undefined {
  return SPELL_DEFS[key];
}

export function spellsFor(classKey: ClassKey, level?: number): SpellDef[] {
  return defs.filter((s) => s.classKey === classKey && (level === undefined || s.level === level));
}

/** Wizards always have this weak, free attack so level one is playable. */
export const WIZARD_DART = {
  name: 'Magic Dart',
  // 1d6, up from 1d3 (2026-11-17): with the harder early floors (pressure.ts) wizards fell well below the balance band.
  dice: [1, 6] as Dice,
  range: 'near' as SpellRange,
  cooldownMs: 900,
  /** Uses the missile (Dexterity) bonus. */
  usesMissileBonus: true,
} as const;

// ── Effect helpers ──────────────────────────────────────────────────────────

/** Number of darts a Magic Missile casts at this caster level. */
export function missileCount(effect: Extract<SpellEffect, { kind: 'missiles' }>, casterLevel: number): number {
  return effect.base + Math.floor(Math.max(0, casterLevel - 1) / effect.extraPerLevels);
}

/** Dice to roll for a damage effect at this caster level. */
export function damageDice(effect: Extract<SpellEffect, { kind: 'damage' }>, casterLevel: number): Dice {
  if (!effect.perLevel) return effect.dice;
  const n = Math.max(1, Math.min(effect.maxDice ?? 99, casterLevel * effect.dice[0]));
  return [n, effect.dice[1]];
}

// ── Spellbook ───────────────────────────────────────────────────────────────

export interface SpellbookData {
  v: 1;
  classKey: ClassKey;
  level: number;
  /** Extra slots (Wisdom for clerics, items), indexed by spell level minus one. */
  bonusSlots: number[];
  /** Spells a wizard has in the book. Clerics ignore this and know their whole list. */
  known: string[];
  /** Memorized spell keys, repeats allowed. */
  memorized: string[];
  /** Memorized copies already cast since the last rest. */
  spent: string[];
}

export interface CreateSpellbookOptions {
  bonusSlots?: number[];
  known?: string[];
}

function count(list: readonly string[], key: string): number {
  let n = 0;
  for (const k of list) if (k === key) n++;
  return n;
}

export class Spellbook {
  private data: SpellbookData;

  private constructor(data: SpellbookData) {
    this.data = data;
  }

  static create(classKey: ClassKey, level: number, opts: CreateSpellbookOptions = {}): Spellbook {
    const known =
      opts.known ??
      (classKey === 'wizard' ? spellsFor('wizard', 1).map((s) => s.key) : []);
    return new Spellbook({
      v: 1,
      classKey,
      level: Math.max(1, Math.floor(level)),
      bonusSlots: [...(opts.bonusSlots ?? [0, 0, 0, 0])],
      known: [...known],
      memorized: [],
      spent: [],
    });
  }

  /** Rebuild from `serialize()` output (for example JSON from a save file). */
  static deserialize(data: SpellbookData): Spellbook {
    if (!data || data.v !== 1) throw new Error('Unsupported spellbook data');
    const book = new Spellbook({
      v: 1,
      classKey: data.classKey,
      level: data.level,
      bonusSlots: [...data.bonusSlots],
      known: [...data.known],
      memorized: [...data.memorized],
      spent: [...data.spent],
    });
    book.trim();
    return book;
  }

  /** Plain JSON-safe copy. */
  serialize(): SpellbookData {
    const d = this.data;
    return {
      v: 1,
      classKey: d.classKey,
      level: d.level,
      bonusSlots: [...d.bonusSlots],
      known: [...d.known],
      memorized: [...d.memorized],
      spent: [...d.spent],
    };
  }

  get classKey(): ClassKey {
    return this.data.classKey;
  }

  get level(): number {
    return this.data.level;
  }

  /** Total slots per spell level (1..4), including bonus slots. */
  slots(): number[] {
    const base = spellSlots(this.data.classKey, this.data.level);
    return base.map((n, i) => n + (this.data.bonusSlots[i] ?? 0));
  }

  maxSlots(spellLevel: number): number {
    return this.slots()[spellLevel - 1] ?? 0;
  }

  /** Slots at this spell level not yet filled with a memorized spell. */
  freeSlots(spellLevel: number): number {
    const used = this.data.memorized.filter((k) => SPELL_DEFS[k]?.level === spellLevel).length;
    return Math.max(0, this.maxSlots(spellLevel) - used);
  }

  /** Can the character put this spell in the book or prayer list at all? */
  knows(key: string): boolean {
    const def = SPELL_DEFS[key];
    if (!def || def.classKey !== this.data.classKey) return false;
    if (this.data.classKey === 'cleric') return this.maxSlots(def.level) > 0;
    return this.data.known.includes(key);
  }

  /** Wizards add a spell to the book (no chance roll; see `tryLearn`). */
  learn(key: string): boolean {
    const def = SPELL_DEFS[key];
    if (!def || def.classKey !== this.data.classKey || this.data.classKey !== 'wizard') return false;
    if (!this.data.known.includes(key)) this.data.known.push(key);
    return true;
  }

  /** Learn with the Intelligence chance from first-edition tables. */
  tryLearn(key: string, int: number, rng: Rng): boolean {
    const def = SPELL_DEFS[key];
    if (!def || this.data.classKey !== 'wizard' || def.classKey !== 'wizard') return false;
    const eff = intelligenceEffect(int);
    if (def.level > eff.maxSpellLevel) return false;
    if (d100(rng) > eff.learnChance) return false;
    return this.learn(key);
  }

  /** Fill a slot with a spell. False if unknown, or no free slot of that level. */
  memorize(key: string): boolean {
    const def = SPELL_DEFS[key];
    if (!def || !this.knows(key)) return false;
    if (this.freeSlots(def.level) <= 0) return false;
    this.data.memorized.push(key);
    return true;
  }

  /** Empty one slot of this spell (only a copy that has not been cast). */
  unmemorize(key: string): boolean {
    if (this.remaining(key) <= 0) return false;
    const idx = this.data.memorized.indexOf(key);
    this.data.memorized.splice(idx, 1);
    return true;
  }

  /** Copies of this spell memorized and not yet cast. */
  remaining(key: string): number {
    return count(this.data.memorized, key) - count(this.data.spent, key);
  }

  canCast(key: string): boolean {
    return this.remaining(key) > 0;
  }

  /** Cast: spends one memorized copy. False if none is left. */
  cast(key: string): boolean {
    if (!this.canCast(key)) return false;
    this.data.spent.push(key);
    return true;
  }

  /** A full night's rest: every cast spell comes back. */
  rest(): void {
    this.data.spent = [];
  }

  /** Memorized spells that can still be cast, with counts. */
  available(): Array<{ key: string; remaining: number }> {
    const keys = [...new Set(this.data.memorized)];
    return keys
      .map((key) => ({ key, remaining: this.remaining(key) }))
      .filter((e) => e.remaining > 0);
  }

  /** Everything memorized with how many are left, including empty ones, in memorization order. */
  prepared(): Array<{ key: string; total: number; remaining: number }> {
    const keys = [...new Set(this.data.memorized)];
    return keys.map((key) => ({
      key,
      total: count(this.data.memorized, key),
      remaining: this.remaining(key),
    }));
  }

  /** Level up (or down); drops memorized spells that no longer fit. */
  setLevel(level: number, bonusSlots?: number[]): void {
    this.data.level = Math.max(1, Math.floor(level));
    if (bonusSlots) this.data.bonusSlots = [...bonusSlots];
    this.trim();
  }

  /** Fill every free slot, cycling through known spells of that level. Returns slots filled. */
  fillDefault(): number {
    let filled = 0;
    for (let lv = 1; lv <= 4; lv++) {
      const options = spellsFor(this.data.classKey, lv).map((s) => s.key).filter((k) => this.knows(k));
      if (options.length === 0) continue;
      let i = 0;
      while (this.freeSlots(lv) > 0) {
        if (!this.memorize(options[i % options.length])) break;
        i++;
        filled++;
      }
    }
    return filled;
  }

  private trim(): void {
    for (let lv = 1; lv <= 4; lv++) {
      const max = this.maxSlots(lv);
      const atLevel = this.data.memorized.filter((k) => SPELL_DEFS[k]?.level === lv);
      let excess = atLevel.length - max;
      // Drop from the end of the list, spent copies first.
      for (let i = this.data.memorized.length - 1; i >= 0 && excess > 0; i--) {
        const k = this.data.memorized[i];
        if (SPELL_DEFS[k]?.level !== lv) continue;
        this.data.memorized.splice(i, 1);
        const s = this.data.spent.indexOf(k);
        if (s >= 0) this.data.spent.splice(s, 1);
        excess--;
      }
    }
    // Remove unknown or foreign keys, and spent entries that outnumber memorized copies.
    this.data.memorized = this.data.memorized.filter(
      (k) => SPELL_DEFS[k]?.classKey === this.data.classKey,
    );
    const keep: string[] = [];
    for (const k of this.data.spent) {
      if (count(keep, k) < count(this.data.memorized, k)) keep.push(k);
    }
    this.data.spent = keep;
  }
}

/** Convenience: does this class cast at all? */
export function isCaster(classKey: ClassKey): boolean {
  return CLASS_RULES[classKey].casting !== null;
}
