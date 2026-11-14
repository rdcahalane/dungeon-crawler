import {
  CURSES, UNIQUES, UNIQUE_BY_KEY, effectText, makeAffix, poolFor, rareName,
  type AffixDef, type CurseDef,
} from './affixes';
import { ITEM_DEFS, canBeMagic, getDef, groupOf, instantiate, isJewelry } from './catalog';
import { chance, dice, int, newId, pick, pickWeighted } from './rngutil';
import type { Affix, ItemDef, ItemGroup, ItemInstance, ItemKind, Rarity, Rng } from './types';

const RARITY_ORDER: Rarity[] = ['common', 'magic', 'rare', 'unique'];
const rank = (r: Rarity): number => RARITY_ORDER.indexOf(r);

export interface RollOptions {
  floor: number;
  /** Extra "effective floors" of quality, e.g. a golden chest adds 5. */
  rarityBias?: number;
  kind?: ItemKind;
  /** Floor the rarity roll (vault loot, boss drops). */
  minRarity?: Rarity;
  /** Shops never sell cursed goods. */
  noCurse?: boolean;
  /** Force the identified flag (shops pass true). */
  identified?: boolean;
}

export type DropSource =
  | { type: 'monster'; hd: number; boss?: boolean }
  | { type: 'chest'; tier: 'wooden' | 'iron' | 'golden' }
  | { type: 'vault'; lootTier: number };

export interface Drop {
  gold: number;
  items: ItemInstance[];
}

// ── Rarity odds ─────────────────────────────────────────────────────────────────────────────────────────

/** Relative weights at quality score q (floor plus bias). Improves with depth and source. */
export function rarityWeights(q: number): Record<Rarity, number> {
  return {
    common: Math.max(10, 80 - 3 * q),
    magic: 14 + 1.5 * q,
    rare: q < 2 ? 0 : 1 + 0.9 * q,
    unique: q < 4 ? 0 : 0.15 + 0.12 * q,
  };
}

function rollRarity(rng: Rng, q: number, min: Rarity): Rarity {
  const w = rarityWeights(q);
  const allowed = RARITY_ORDER.filter((r) => rank(r) >= rank(min));
  return pickWeighted(rng, allowed, (r) => w[r]) ?? min;
}

// ── Picking a base item ─────────────────────────────────────────────────────────────────────────────────

const KIND_WEIGHTS: Array<[ItemKind, number]> = [
  ['weapon', 22], ['armor', 20], ['shield', 5], ['gear', 14], ['consumable', 28], ['treasure', 8],
];

function pickKind(rng: Rng): ItemKind {
  return pickWeighted(rng, KIND_WEIGHTS, (k) => k[1])![0];
}

function pickBase(rng: Rng, kind: ItemKind, floor: number): ItemDef {
  const pool = ITEM_DEFS.filter((d) => d.kind === kind && (d.minFloor ?? 1) <= floor);
  // Gear mixes adventuring kit (common) with jewelry blanks (less common).
  const weight = (d: ItemDef): number => (isJewelry(d) ? 7 : (d.dropWeight ?? 10));
  return pickWeighted(rng, pool, weight) ?? pickWeighted(rng, ITEM_DEFS.filter((d) => d.kind === kind), weight)!;
}

// ── Building instances ──────────────────────────────────────────────────────────────────────────────────

function rollPlus(rng: Rng, floor: number): number {
  let plus = 1;
  if (floor >= 3 && chance(rng, 0.35)) plus = 2;
  if (plus === 2 && floor >= 6 && chance(rng, 0.25)) plus = 3;
  return plus;
}

function pickAffix(rng: Rng, group: ItemGroup, floor: number, position: 'prefix' | 'suffix' | undefined, taken: Affix[]): Affix | undefined {
  const used = new Set(taken.map((a) => a.key));
  const pool = poolFor(group, floor, position).filter((a) => !used.has(a.key));
  const d: AffixDef | undefined = pickWeighted(rng, pool, (a) => a.weight);
  return d ? makeAffix(d, rng, floor) : undefined;
}

/** Look up an affix pool entry's concrete sibling so a rare never carries two of the same effect type from one family. */
function sameEffect(a: Affix, b: Affix): boolean {
  return a.effect.type === b.effect.type;
}

function buildMagic(rng: Rng, base: ItemDef, group: ItemGroup, floor: number, rarity: 'magic' | 'rare'): Pick<ItemInstance, 'plus' | 'affixes' | 'customName'> {
  const affixes: Affix[] = [];
  const jewelry = group === 'ring' || group === 'amulet';
  const usesPlus = !jewelry && base.kind !== 'gear';
  let plus = 0;

  if (rarity === 'magic') {
    if (jewelry) {
      const a = pickAffix(rng, group, floor, undefined, affixes);
      if (a) affixes.push(a);
    } else {
      const shape = rng.next(); // 45% plus only, 35% plus + affix, 20% affix only
      if (shape < 0.8 && usesPlus) plus = rollPlus(rng, floor);
      if (shape >= 0.45 || !usesPlus) {
        const a = pickAffix(rng, group, floor, undefined, affixes);
        if (a) affixes.push(a);
      }
      if (plus === 0 && affixes.length === 0) plus = 1;
    }
    return { plus, affixes };
  }

  // Rare: a prefix and a suffix, a coin-flip plus, and a name.
  if (usesPlus && chance(rng, 0.5)) plus = rollPlus(rng, floor);
  const pre = pickAffix(rng, group, floor, 'prefix', affixes);
  if (pre) affixes.push(pre);
  let suf = pickAffix(rng, group, floor, 'suffix', affixes);
  for (let tries = 0; suf && affixes.some((x) => sameEffect(x, suf!)) && tries < 4; tries++) {
    suf = pickAffix(rng, group, floor, 'suffix', affixes);
  }
  if (suf && !affixes.some((x) => sameEffect(x, suf!))) affixes.push(suf);
  // Jewelry has no prefixes; give it a second suffix of a different family.
  if (jewelry && affixes.length < 2) {
    const more = pickAffix(rng, group, floor, 'suffix', affixes);
    if (more && !affixes.some((x) => sameEffect(x, more))) affixes.push(more);
  }
  if (affixes.length === 0 && plus === 0) plus = 1;
  return { plus, affixes, customName: rareName(group, rng) };
}

function eligibleUniques(floor: number, kind?: ItemKind): typeof UNIQUES[number][] {
  return UNIQUES.filter((x) => x.minFloor <= floor && (!kind || getDef(x.baseKey).kind === kind));
}

function eligibleCurses(floor: number, kind?: ItemKind): CurseDef[] {
  return CURSES.filter((x) => x.minFloor <= floor && (!kind || getDef(x.baseKey).kind === kind));
}

export function rollItem(opts: RollOptions, rng: Rng): ItemInstance {
  const floor = Math.max(1, Math.floor(opts.floor));
  const q = floor + (opts.rarityBias ?? 0);
  const kind = opts.kind ?? pickKind(rng);
  const minRarity = opts.minRarity ?? 'common';
  let base = pickBase(rng, kind, floor);

  if (!canBeMagic(base)) {
    // Only weapons, worn armor and jewelry carry rarity. A min-rarity request redirects to one that can.
    if (rank(minRarity) > 0 && !opts.kind) {
      base = pickBase(rng, pick(rng, ['weapon', 'armor', 'shield'] as ItemKind[]), floor);
    } else {
      return finishPlain(rng, base);
    }
  }
  if (!canBeMagic(base)) return finishPlain(rng, base);

  let rarity: Rarity = rollRarity(rng, q, minRarity);
  // Jewelry blanks are never common: an empty ring is not a drop.
  if (isJewelry(base) && rarity === 'common') rarity = 'magic';
  if (rarity === 'common') return finishPlain(rng, base);

  const group = groupOf(base)!;

  // Cursed substitution: looks magic, is not.
  if (!opts.noCurse && rank(rarity) <= rank('rare')) {
    const p = isJewelry(base) ? 0.2 : 0.08;
    if (chance(rng, p)) {
      const all = eligibleCurses(floor, opts.kind);
      const same = all.filter((x) => groupOf(getDef(x.baseKey)) === group);
      const pool = same.length ? same : all;
      const curse = pool.length ? pick(rng, pool) : undefined;
      if (curse) {
        return {
          ...instantiate(curse.baseKey, newId(rng)),
          rarity: 'magic',
          plus: curse.plus,
          affixes: curse.affixes.map((a) => ({ ...a })),
          cursed: true,
          identified: opts.identified ?? false,
        };
      }
    }
  }

  if (rarity === 'unique') {
    const pool = eligibleUniques(floor, opts.kind);
    if (pool.length) {
      const un = pick(rng, pool);
      return {
        ...instantiate(un.baseKey, newId(rng)),
        rarity: 'unique',
        plus: un.plus,
        affixes: un.affixes.map((a) => ({ ...a, effect: { ...a.effect } })),
        customName: un.name,
        uniqueKey: un.key,
        identified: opts.identified ?? !chance(rng, 0.85),
      };
    }
    rarity = 'rare';
  }

  const built = buildMagic(rng, base, group, floor, rarity);
  const unidChance = rarity === 'rare' ? 0.7 : 0.5;
  return {
    ...instantiate(base.key, newId(rng)),
    rarity,
    ...built,
    identified: opts.identified ?? !chance(rng, unidChance),
  };
}

function finishPlain(rng: Rng, base: ItemDef): ItemInstance {
  const inst = instantiate(base.key, newId(rng));
  if (base.stackLimit > 1) inst.quantity = int(rng, 1, Math.min(3, base.stackLimit));
  return inst;
}

/** Make a specific unique by key (quest rewards, tests). */
export function makeUnique(uniqueKey: string, rng: Rng, identified = false): ItemInstance {
  const un = UNIQUE_BY_KEY[uniqueKey];
  if (!un) throw new Error(`Unknown unique: ${uniqueKey}`);
  return {
    ...instantiate(un.baseKey, newId(rng)),
    rarity: 'unique',
    plus: un.plus,
    affixes: un.affixes.map((a) => ({ ...a, effect: { ...a.effect } })),
    customName: un.name,
    uniqueKey: un.key,
    identified,
  };
}

/** Make a plain item by def key with a seeded id. */
export function makeItem(defKey: string, rng: Rng, quantity = 1): ItemInstance {
  const inst = instantiate(defKey, newId(rng));
  inst.quantity = Math.max(1, Math.min(quantity, getDef(defKey).stackLimit));
  return inst;
}

// ── Drops ───────────────────────────────────────────────────────────────────────────────────────────────

export function rollDrop(source: DropSource, floor: number, rng: Rng): Drop {
  const f = Math.max(1, Math.floor(floor));
  const items: ItemInstance[] = [];
  let gold = 0;

  if (source.type === 'monster') {
    const hd = Math.max(0.5, source.hd);
    if (source.boss) {
      gold = dice(rng, 4, 10) * (3 + f) + Math.floor(hd) * 10;
      items.push(rollItem({ floor: f, rarityBias: 5, minRarity: 'magic' }, rng));
      const extra = int(rng, 1, 2);
      for (let i = 0; i < extra; i++) items.push(rollItem({ floor: f, rarityBias: 4 }, rng));
    } else {
      if (chance(rng, Math.min(0.9, 0.45 + hd * 0.05))) {
        gold = Math.max(1, Math.round(dice(rng, 1, 6) * Math.max(1, hd) * (1 + f * 0.25)));
      }
      if (chance(rng, Math.min(0.5, 0.1 + hd * 0.03))) {
        items.push(rollItem({ floor: f, rarityBias: Math.min(4, Math.floor(hd / 2)) }, rng));
      }
    }
    return { gold, items };
  }

  if (source.type === 'chest') {
    const t = source.tier;
    gold = t === 'wooden' ? dice(rng, 2, 8) + dice(rng, f, 4)
      : t === 'iron' ? dice(rng, 3, 12) + dice(rng, f, 6)
        : dice(rng, 5, 20) + dice(rng, f, 10);
    const count = t === 'golden' ? int(rng, 1, 3) + 1 : t === 'iron' ? int(rng, 1, 2) + 1 : int(rng, 1, 2);
    const bias = t === 'golden' ? 5 : t === 'iron' ? 2 : 0;
    for (let i = 0; i < count; i++) items.push(rollItem({ floor: f, rarityBias: bias }, rng));
    return { gold, items };
  }

  const tier = Math.max(1, Math.floor(source.lootTier));
  gold = dice(rng, 4, 20) * tier * (2 + Math.floor(f / 2));
  const count = 2 + Math.min(3, tier);
  const bias = tier * 2 + 2;
  for (let i = 0; i < count; i++) {
    const minRarity: Rarity | undefined = i === 0 ? (tier >= 3 ? 'rare' : tier >= 2 ? 'magic' : undefined) : undefined;
    items.push(rollItem({ floor: f, rarityBias: bias, minRarity }, rng));
  }
  return { gold, items };
}

// ── Presentation ────────────────────────────────────────────────────────────────────────────────────────

export function baseName(item: ItemInstance): string {
  return getDef(item.defKey).name;
}

/**
 * Name as shown to the player. Unidentified magic or better shows only the base name and a `?`.
 * A cursed item looks exactly like a good one until identified.
 */
export function displayName(item: ItemInstance, opts: { quantity?: boolean } = {}): string {
  const d = getDef(item.defKey);
  let name: string;
  if (!item.identified && item.rarity !== 'common') {
    name = `${d.name}?`;
  } else if (item.customName) {
    name = item.customName;
  } else {
    const pre = item.affixes.find((a) => a.position === 'prefix');
    const suf = item.affixes.find((a) => a.position === 'suffix' || a.position === 'curse');
    const plus = item.plus !== 0 ? ` ${item.plus > 0 ? '+' : ''}${item.plus}` : '';
    name = `${pre ? `${pre.label} ` : ''}${d.name}${plus}${suf ? ` ${suf.label}` : ''}`;
  }
  if (item.identified && item.cursed) name += ' (cursed)';
  if (opts.quantity && item.quantity > 1) name += ` x${item.quantity}`;
  return name;
}

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0xffffff,
  magic: 0x6c8cff,
  rare: 0xffe14d,
  unique: 0xff9a2e,
};
export const CURSED_COLOR = 0xc0392b;

/** Numeric 0xRRGGBB for Phaser. Pass an instance to get the cursed red once the curse is known. */
export function rarityColor(r: Rarity | ItemInstance): number {
  if (typeof r === 'string') return RARITY_COLORS[r];
  if (r.cursed && r.identified) return CURSED_COLOR;
  return RARITY_COLORS[r.rarity];
}

export function rarityColorCss(r: Rarity | ItemInstance): string {
  return `#${rarityColor(r).toString(16).padStart(6, '0')}`;
}

/** Tooltip lines. Unidentified items reveal the base item and nothing of the magic. */
export function describe(item: ItemInstance): string[] {
  const d = getDef(item.defKey);
  const lines: string[] = [displayName(item)];
  const hidden = !item.identified && item.rarity !== 'common';

  const type: string[] = [];
  if (d.kind === 'weapon') type.push(d.twoHanded ? 'Two-handed weapon' : d.ranged ? 'Ranged weapon' : 'One-handed weapon');
  else if (d.kind === 'shield') type.push('Shield');
  else if (d.kind === 'armor') type.push(d.slot === 'armor' ? 'Body armor' : `Worn on the ${d.slot}`);
  else if (d.slot === 'ring' || d.slot === 'amulet') type.push(d.name);
  else type.push(d.kind === 'gear' ? 'Gear' : d.kind[0].toUpperCase() + d.kind.slice(1));
  if (item.rarity !== 'common' && !hidden) type.push(item.rarity);
  lines.push(type.join(', '));

  if (d.damage) lines.push(`Damage ${d.damage}${!hidden && item.plus ? (item.plus > 0 ? `+${item.plus}` : `${item.plus}`) : ''}`);
  if (d.ac !== undefined) {
    const shown = hidden ? d.ac : d.ac - item.plus;
    lines.push(d.kind === 'shield' ? `Improves AC by ${-shown}` : `Armor class ${shown}`);
  }
  if (d.light) lines.push(`Light radius ${d.light.radius}, burns ${Math.round((item.charges ?? d.light.burnSec) / 60)} min`);
  if (d.use) lines.push(`Use: ${effectUseText(d)}`);
  if (d.description) lines.push(d.description);

  if (hidden) {
    lines.push('Unidentified: it hums with some unseen power.');
  } else {
    for (const a of item.affixes) lines.push(effectText(a.effect));
    if (item.uniqueKey) lines.push(UNIQUE_BY_KEY[item.uniqueKey]?.lore ?? '');
    if (item.cursed) lines.push('Cursed: cannot be removed until the curse is lifted.');
  }
  if (d.classes.length < 4) lines.push(`Usable by: ${d.classes.join(', ')}`);
  lines.push(`Weight ${d.weight} lb`);
  lines.push(`Worth ${sellValue(item)} gp`);
  return lines.filter((l) => l !== '');
}

function effectUseText(d: ItemDef): string {
  const u = d.use!;
  switch (u.type) {
    case 'heal': return `heals ${u.dice}${u.bonus ? `+${u.bonus}` : ''}`;
    case 'cure_poison': return 'cures poison';
    case 'haste': return `${u.pct}% faster for ${u.durationSec}s`;
    case 'recall': return 'return to the tavern';
    case 'identify': return 'reveals one item';
    case 'remove_curse': return 'lifts one curse';
    case 'light': return `light radius ${u.radius} for ${u.durationSec}s`;
    case 'cast': return `cast ${u.spell.replace(/_/g, ' ')}`;
    case 'throw': return `thrown for ${u.dice}${u.vs ? ` vs ${u.vs}` : ''}`;
    case 'eat': return 'eat a ration';
  }
}

// ── Value ───────────────────────────────────────────────────────────────────────────────────────────────

/** True worth in gp, ignoring what the holder knows. */
export function trueValue(item: ItemInstance): number {
  const d = getDef(item.defKey);
  let v = d.value;
  if (d.light && item.charges !== undefined) v = Math.max(1, Math.round(v * (item.charges / d.light.burnSec)));
  if (item.cursed) return Math.max(1, Math.round(v * 0.2));
  const tier = { common: 0, magic: 1, rare: 2, unique: 4 }[item.rarity];
  v += item.plus > 0 ? 150 * item.plus * item.plus : 0;
  v += item.affixes.length * 100 * Math.max(1, tier);
  if (item.rarity === 'unique') v += 600;
  return v;
}

/** What a merchant pays for one. Unidentified goods are lowballed to the base price; treasure sells at face. */
export function sellValue(item: ItemInstance): number {
  const d = getDef(item.defKey);
  if (d.kind === 'treasure') return d.value;
  const known = item.identified || item.rarity === 'common';
  const v = known ? trueValue(item) : d.value;
  return Math.max(d.value > 0 ? 1 : 0, Math.floor(v * 0.5));
}

/** What a merchant asks for one, based on true worth. */
export function buyValue(item: ItemInstance): number {
  return Math.max(1, Math.ceil(trueValue(item) * 1.5));
}
