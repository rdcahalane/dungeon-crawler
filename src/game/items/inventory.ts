import { getDef, hasDef, instantiate } from './catalog';
import type {
  ClassKey, EquipSlot, ItemDef, ItemInstance, SaveCategory, UseEffect, FoeTag,
} from './types';
import { EQUIP_SLOTS, SAVE_CATEGORIES } from './types';

export const PACK_SIZE = 24;
export const BELT_SIZE = 4;

export type Loc =
  | { kind: 'pack'; index: number }
  | { kind: 'belt'; index: number }
  | { kind: 'equip'; slot: EquipSlot };

export type FailReason =
  | 'pack_full' | 'no_such_item' | 'bad_index' | 'class_restricted' | 'not_equippable' | 'wrong_slot'
  | 'two_handed_conflict' | 'cursed' | 'belt_consumables_only' | 'slot_occupied' | 'empty_slot'
  | 'not_usable' | 'not_enough' | 'not_in_pack' | 'bad_move' | 'not_refuelable' | 'no_oil' | 'not_cursed'
  | 'already_identified' | 'invalid_quantity';

export interface Fail {
  ok: false;
  reason: FailReason;
  message: string;
}
export type Ok<T extends object = object> = { ok: true } & T;
export type Result<T extends object = object> = Ok<T> | Fail;

const fail = (reason: FailReason, message: string): Fail => ({ ok: false, reason, message });

/** Two stacks merge when they are indistinguishable. */
export function canStack(a: ItemInstance, b: ItemInstance): boolean {
  const d = getDef(a.defKey);
  return (
    d.stackLimit > 1 && a.defKey === b.defKey && a.rarity === 'common' && b.rarity === 'common' &&
    a.plus === b.plus && a.affixes.length === 0 && b.affixes.length === 0 && a.cursed === b.cursed &&
    a.charges === b.charges && a.identified === b.identified
  );
}

export interface InventoryJSON {
  v: 1;
  classKey: ClassKey;
  gold: number;
  pack: Array<ItemInstance | null>;
  belt: Array<ItemInstance | null>;
  equipment: Partial<Record<EquipSlot, ItemInstance>>;
}

export type EncumbranceTier = 'light' | 'moderate' | 'heavy' | 'overloaded';
export interface Encumbrance {
  tier: EncumbranceTier;
  /** Multiply movement speed by this. */
  speedMult: number;
  weight: number;
  /** Weight you can carry before slowing down. */
  lightLimit: number;
  /** Weight at which you are overloaded. */
  maxLimit: number;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class Inventory {
  classKey: ClassKey;
  gold = 0;
  pack: Array<ItemInstance | null> = Array.from({ length: PACK_SIZE }, () => null);
  belt: Array<ItemInstance | null> = Array.from({ length: BELT_SIZE }, () => null);
  equipment: Partial<Record<EquipSlot, ItemInstance>> = {};

  constructor(classKey: ClassKey, gold = 0) {
    this.classKey = classKey;
    this.gold = gold;
  }

  // ── Lookup ────────────────────────────────────────────────────────────────────────────────────────────

  get(loc: Loc): ItemInstance | null {
    if (loc.kind === 'pack') return this.pack[loc.index] ?? null;
    if (loc.kind === 'belt') return this.belt[loc.index] ?? null;
    return this.equipment[loc.slot] ?? null;
  }

  private set(loc: Loc, item: ItemInstance | null): void {
    if (loc.kind === 'pack') this.pack[loc.index] = item;
    else if (loc.kind === 'belt') this.belt[loc.index] = item;
    else if (item) this.equipment[loc.slot] = item;
    else delete this.equipment[loc.slot];
  }

  find(itemId: string): { loc: Loc; item: ItemInstance } | undefined {
    for (let i = 0; i < this.pack.length; i++) {
      const it = this.pack[i];
      if (it && it.id === itemId) return { loc: { kind: 'pack', index: i }, item: it };
    }
    for (let i = 0; i < this.belt.length; i++) {
      const it = this.belt[i];
      if (it && it.id === itemId) return { loc: { kind: 'belt', index: i }, item: it };
    }
    for (const slot of EQUIP_SLOTS) {
      const it = this.equipment[slot];
      if (it && it.id === itemId) return { loc: { kind: 'equip', slot }, item: it };
    }
    return undefined;
  }

  /** Every item held, wherever it is. */
  items(): ItemInstance[] {
    const out: ItemInstance[] = [];
    for (const it of this.pack) if (it) out.push(it);
    for (const it of this.belt) if (it) out.push(it);
    for (const slot of EQUIP_SLOTS) {
      const it = this.equipment[slot];
      if (it) out.push(it);
    }
    return out;
  }

  equipped(): ItemInstance[] {
    return EQUIP_SLOTS.map((s) => this.equipment[s]).filter((x): x is ItemInstance => !!x);
  }

  /** Count of a base item in pack and belt (what you can spend or consume). */
  count(defKey: string): number {
    let n = 0;
    for (const it of this.pack) if (it && it.defKey === defKey) n += it.quantity;
    for (const it of this.belt) if (it && it.defKey === defKey) n += it.quantity;
    return n;
  }

  /** Whether you hold at least n of a base item, counting equipped ones too. */
  has(defKey: string, n = 1): boolean {
    let have = this.count(defKey);
    for (const it of this.equipped()) if (it.defKey === defKey) have += it.quantity;
    return have >= n;
  }

  canUse(d: ItemDef): boolean {
    return d.classes.includes(this.classKey);
  }

  // ── Adding and removing ───────────────────────────────────────────────────────────────────────────────

  /** Add to the pack, stacking where allowed. Atomic: either all fits or nothing changes. */
  add(item: ItemInstance): Result<{ placed: Loc[] }> {
    if (item.quantity < 1) return fail('invalid_quantity', 'Nothing to add.');
    const d = getDef(item.defKey);
    let left = item.quantity;
    const plan: Array<{ index: number; take: number; fresh: boolean }> = [];
    if (d.stackLimit > 1) {
      for (let i = 0; i < this.pack.length && left > 0; i++) {
        const s = this.pack[i];
        if (s && canStack(s, item) && s.quantity < d.stackLimit) {
          const take = Math.min(left, d.stackLimit - s.quantity);
          plan.push({ index: i, take, fresh: false });
          left -= take;
        }
      }
    }
    for (let i = 0; i < this.pack.length && left > 0; i++) {
      if (!this.pack[i]) {
        const take = Math.min(left, d.stackLimit);
        plan.push({ index: i, take, fresh: true });
        left -= take;
      }
    }
    if (left > 0) return fail('pack_full', 'Your pack is full.');

    const placed: Loc[] = [];
    let first = true;
    for (const p of plan) {
      if (p.fresh) {
        // The first fresh slot keeps the original id; extra stacks get a derived id.
        const piece = clone(item);
        piece.quantity = p.take;
        if (!first) piece.id = `${item.id}.${p.index}`;
        this.pack[p.index] = piece;
        first = false;
      } else {
        this.pack[p.index]!.quantity += p.take;
      }
      placed.push({ kind: 'pack', index: p.index });
    }
    return { ok: true, placed };
  }

  /** Remove `qty` (default: all) of an item from wherever it is. Returns what was taken. */
  remove(itemId: string, qty?: number): Result<{ item: ItemInstance }> {
    const f = this.find(itemId);
    if (!f) return fail('no_such_item', 'No such item.');
    const n = qty ?? f.item.quantity;
    if (n < 1 || n > f.item.quantity) return fail('invalid_quantity', 'Not that many.');
    if (f.loc.kind === 'equip' && f.item.cursed) return fail('cursed', 'It will not come off.');
    if (n === f.item.quantity) {
      this.set(f.loc, null);
      return { ok: true, item: f.item };
    }
    f.item.quantity -= n;
    const taken = clone(f.item);
    taken.quantity = n;
    taken.id = `${f.item.id}.t`;
    return { ok: true, item: taken };
  }

  /** Spend n of a base item from pack and belt. Atomic. */
  consume(defKey: string, n = 1): Result<{ consumed: number }> {
    if (n < 1) return fail('invalid_quantity', 'Nothing to consume.');
    if (this.count(defKey) < n) return fail('not_enough', `Not enough ${getDef(defKey).name}.`);
    let left = n;
    const drain = (arr: Array<ItemInstance | null>): void => {
      for (let i = arr.length - 1; i >= 0 && left > 0; i--) {
        const it = arr[i];
        if (it && it.defKey === defKey) {
          const take = Math.min(left, it.quantity);
          it.quantity -= take;
          left -= take;
          if (it.quantity === 0) arr[i] = null;
        }
      }
    };
    drain(this.pack);
    drain(this.belt);
    return { ok: true, consumed: n };
  }

  // ── Moving ────────────────────────────────────────────────────────────────────────────────────────────

  private firstFreePack(): number {
    return this.pack.findIndex((s) => s === null);
  }

  private validIndex(loc: Loc): boolean {
    if (loc.kind === 'pack') return Number.isInteger(loc.index) && loc.index >= 0 && loc.index < PACK_SIZE;
    if (loc.kind === 'belt') return Number.isInteger(loc.index) && loc.index >= 0 && loc.index < BELT_SIZE;
    return EQUIP_SLOTS.includes(loc.slot);
  }

  /** Drag-and-drop style move. Swaps or merges stacks between pack and belt; equips or unequips across the doll. */
  move(from: Loc, to: Loc): Result {
    if (!this.validIndex(from) || !this.validIndex(to)) return fail('bad_index', 'No such slot.');
    const src = this.get(from);
    if (!src) return fail('empty_slot', 'Nothing there.');
    if (from.kind === to.kind && (from.kind === 'equip' ? from.slot === (to as { slot: EquipSlot }).slot : from.index === (to as { index: number }).index)) {
      return { ok: true };
    }
    if (from.kind === 'equip' && to.kind === 'equip') return fail('bad_move', 'Use equip to change slots.');

    if (to.kind === 'equip') {
      if (from.kind !== 'pack') return fail('not_in_pack', 'Only items in the pack can be equipped.');
      const r = this.equip(src.id, to.slot);
      return r.ok ? { ok: true } : r;
    }

    const dst = this.get(to);
    const beltOnly = (it: ItemInstance): boolean => getDef(it.defKey).kind === 'consumable';

    if (from.kind === 'equip') {
      if (src.cursed) return fail('cursed', 'It will not come off.');
      if (dst) return fail('slot_occupied', 'That slot is taken.');
      if (to.kind === 'belt' && !beltOnly(src)) return fail('belt_consumables_only', 'The belt holds consumables only.');
      this.set(from, null);
      this.set(to, src);
      return { ok: true };
    }

    // pack/belt to pack/belt
    if (to.kind === 'belt' && !beltOnly(src)) return fail('belt_consumables_only', 'The belt holds consumables only.');
    if (!dst) {
      this.set(from, null);
      this.set(to, src);
      return { ok: true };
    }
    if (canStack(src, dst)) {
      const room = getDef(dst.defKey).stackLimit - dst.quantity;
      const take = Math.min(room, src.quantity);
      if (take > 0) {
        dst.quantity += take;
        src.quantity -= take;
        if (src.quantity === 0) this.set(from, null);
        return { ok: true };
      }
    }
    if (from.kind === 'belt' && !beltOnly(dst)) return fail('belt_consumables_only', 'The belt holds consumables only.');
    this.set(from, dst);
    this.set(to, src);
    return { ok: true };
  }

  // ── Equipment ─────────────────────────────────────────────────────────────────────────────────────────

  private targetSlot(d: ItemDef, wanted?: EquipSlot): EquipSlot | undefined {
    if (!d.slot) return undefined;
    if (d.slot === 'ring') {
      if (wanted === 'ring1' || wanted === 'ring2') return wanted;
      if (wanted) return undefined;
      return !this.equipment.ring1 ? 'ring1' : !this.equipment.ring2 ? 'ring2' : 'ring1';
    }
    if (wanted && wanted !== d.slot) return undefined;
    return d.slot;
  }

  /** Equip an item from the pack. A displaced item goes to the vacated pack slot. */
  equip(itemId: string, slot?: EquipSlot): Result<{ slot: EquipSlot; displaced?: ItemInstance; curseRevealed: boolean }> {
    const f = this.find(itemId);
    if (!f) return fail('no_such_item', 'No such item.');
    if (f.loc.kind !== 'pack') return fail('not_in_pack', 'Only items in the pack can be equipped.');
    const d = getDef(f.item.defKey);
    if (!d.slot) return fail('not_equippable', `${d.name} cannot be worn or wielded.`);
    if (!this.canUse(d)) return fail('class_restricted', `A ${this.classKey} cannot use a ${d.name}.`);
    const target = this.targetSlot(d, slot);
    if (!target) return fail('wrong_slot', `${d.name} does not fit there.`);

    if (d.twoHanded && this.equipment.offhand) return fail('two_handed_conflict', 'Free your off hand first.');
    if (target === 'offhand') {
      const w = this.equipment.weapon;
      if (w && getDef(w.defKey).twoHanded) return fail('two_handed_conflict', 'You need both hands for that weapon.');
    }

    const existing = this.equipment[target];
    if (existing?.cursed) return fail('cursed', `${getDef(existing.defKey).name} is cursed and will not come off.`);

    const idx = (f.loc as { index: number }).index;
    const stack = f.item;
    let worn: ItemInstance;
    if (stack.quantity > 1) {
      if (existing && this.firstFreePack() < 0) return fail('pack_full', 'No room to stow the old one.');
      worn = clone(stack);
      worn.quantity = 1;
      worn.id = `${stack.id}.e`;
      stack.quantity -= 1;
      if (existing) this.pack[this.firstFreePack()] = existing;
    } else {
      worn = stack;
      this.pack[idx] = existing ?? null;
    }
    this.equipment[target] = worn;
    const curseRevealed = worn.cursed;
    if (worn.cursed) worn.identified = true;
    return { ok: true, slot: target, displaced: existing, curseRevealed };
  }

  /** Take an item off into the pack. Cursed items refuse until `removeCurse`. */
  unequip(slot: EquipSlot): Result<{ item: ItemInstance }> {
    const it = this.equipment[slot];
    if (!it) return fail('empty_slot', 'Nothing there.');
    if (it.cursed) return fail('cursed', `${getDef(it.defKey).name} is cursed and will not come off.`);
    delete this.equipment[slot];
    const r = this.add(it);
    if (!r.ok) {
      this.equipment[slot] = it;
      return r;
    }
    return { ok: true, item: it };
  }

  // ── Using things ──────────────────────────────────────────────────────────────────────────────────────

  /** Use one consumable from a belt slot. Returns the effect for the scene to apply. */
  useFromBelt(index: number): Result<{ effect: UseEffect; defKey: string; name: string }> {
    if (!Number.isInteger(index) || index < 0 || index >= BELT_SIZE) return fail('bad_index', 'No such belt slot.');
    const it = this.belt[index];
    if (!it) return fail('empty_slot', 'Nothing on that belt slot.');
    const d = getDef(it.defKey);
    if (!d.use) return fail('not_usable', `${d.name} cannot be used.`);
    it.quantity -= 1;
    if (it.quantity <= 0) this.belt[index] = null;
    return { ok: true, effect: d.use, defKey: d.key, name: d.name };
  }

  identify(itemId: string): Result<{ item: ItemInstance }> {
    const f = this.find(itemId);
    if (!f) return fail('no_such_item', 'No such item.');
    if (f.item.identified) return fail('already_identified', 'Already known.');
    f.item.identified = true;
    return { ok: true, item: f.item };
  }

  /** Lifts the sticky curse. The item keeps its penalties; you may now take it off. */
  removeCurse(itemId: string): Result<{ item: ItemInstance }> {
    const f = this.find(itemId);
    if (!f) return fail('no_such_item', 'No such item.');
    if (!f.item.cursed) return fail('not_cursed', 'It is not cursed.');
    f.item.cursed = false;
    f.item.identified = true;
    return { ok: true, item: f.item };
  }

  /** Fill a lantern from a flask of oil. */
  refuel(lanternId: string): Result<{ item: ItemInstance }> {
    const f = this.find(lanternId);
    if (!f) return fail('no_such_item', 'No such item.');
    const d = getDef(f.item.defKey);
    if (!d.light?.refuelable) return fail('not_refuelable', `${d.name} does not take oil.`);
    const c = this.consume('oil_flask', 1);
    if (!c.ok) return fail('no_oil', 'You have no oil.');
    f.item.charges = d.light.burnSec;
    return { ok: true, item: f.item };
  }

  /** Burn the held light for dtSec. A torch that runs out is destroyed and returned. */
  burn(dtSec: number): { burntOut: ItemInstance | null } {
    const it = this.equipment.offhand;
    if (!it) return { burntOut: null };
    const d = getDef(it.defKey);
    if (!d.light || it.charges === undefined) return { burntOut: null };
    it.charges = Math.max(0, it.charges - dtSec);
    if (it.charges === 0 && !d.light.refuelable) {
      delete this.equipment.offhand;
      return { burntOut: it };
    }
    return { burntOut: null };
  }

  // ── Weight ────────────────────────────────────────────────────────────────────────────────────────────

  /** Pounds carried, with coins at fifty to the pound. */
  totalWeight(): number {
    let w = this.gold / 50;
    for (const it of this.items()) w += getDef(it.defKey).weight * it.quantity;
    return Math.round(w * 10) / 10;
  }

  encumbrance(str: number): Encumbrance {
    const s = Math.max(3, str);
    const lightLimit = s * 6;
    const maxLimit = s * 12;
    const weight = this.totalWeight();
    let tier: EncumbranceTier = 'light';
    let speedMult = 1;
    if (weight > maxLimit) { tier = 'overloaded'; speedMult = 0.35; }
    else if (weight > s * 9) { tier = 'heavy'; speedMult = 0.6; }
    else if (weight > lightLimit) { tier = 'moderate'; speedMult = 0.85; }
    return { tier, speedMult, weight, lightLimit, maxLimit };
  }

  // ── Serialization ─────────────────────────────────────────────────────────────────────────────────────

  toJSON(): InventoryJSON {
    return {
      v: 1,
      classKey: this.classKey,
      gold: this.gold,
      pack: clone(this.pack),
      belt: clone(this.belt),
      equipment: clone(Object.fromEntries(EQUIP_SLOTS.filter((sl) => this.equipment[sl]).map((sl) => [sl, this.equipment[sl]]))),
    };
  }

  /** Rebuilds an inventory from saved JSON. Unknown base items are dropped; shape errors are tolerated. */
  static fromJSON(raw: unknown): Inventory {
    const j = (raw ?? {}) as Partial<InventoryJSON>;
    const classKey: ClassKey = (['fighter', 'thief', 'wizard', 'cleric'] as const).includes(j.classKey as ClassKey)
      ? (j.classKey as ClassKey) : 'fighter';
    const inv = new Inventory(classKey, Number.isFinite(j.gold) ? Math.max(0, Math.floor(j.gold as number)) : 0);
    const sane = (it: unknown): ItemInstance | null => {
      if (!it || typeof it !== 'object') return null;
      const x = it as ItemInstance;
      if (typeof x.defKey !== 'string' || !hasDef(x.defKey) || typeof x.id !== 'string') return null;
      return {
        ...instantiate(x.defKey, x.id),
        ...clone(x),
        quantity: Math.max(1, Math.floor(x.quantity || 1)),
        affixes: Array.isArray(x.affixes) ? clone(x.affixes) : [],
      };
    };
    for (let i = 0; i < PACK_SIZE; i++) inv.pack[i] = sane(j.pack?.[i]);
    for (let i = 0; i < BELT_SIZE; i++) {
      const it = sane(j.belt?.[i]);
      inv.belt[i] = it && getDef(it.defKey).kind === 'consumable' ? it : null;
    }
    for (const slot of EQUIP_SLOTS) {
      const it = sane(j.equipment?.[slot]);
      if (it) inv.equipment[slot] = it;
    }
    return inv;
  }
}

// ── Bonuses from equipment ─────────────────────────────────────────────────────────────────────────────

export interface EquipmentBonuses {
  weaponKey: string | null;
  weaponDice: string;
  twoHanded: boolean;
  toHit: number;
  damage: number;
  /** Body armor AC (descending; 10 when unarmored). */
  armorAc: number;
  /** Shield contribution to AC (-1 with a shield, else 0). */
  shield: number;
  /** Magic contribution to AC: negative is better. */
  acMagic: number;
  /** armorAc + shield + acMagic. */
  ac: number;
  saveBonus: Record<SaveCategory, number>;
  maxHp: number;
  speedPct: number;
  lightRadius: number;
  findTrapsPct: number;
  /** Extra spell slots by spell level. */
  extraSlots: Record<number, number>;
  lifeOnHit: number;
  thorns: number;
  resistPoison: boolean;
  /** Extra damage by foe tag. */
  slay: Partial<Record<FoeTag, number>>;
  special: string[];
}

export function equipmentBonuses(inv: Inventory): EquipmentBonuses {
  const b: EquipmentBonuses = {
    weaponKey: null, weaponDice: '1d2', twoHanded: false,
    toHit: 0, damage: 0, armorAc: 10, shield: 0, acMagic: 0, ac: 10,
    saveBonus: { death: 0, petrify: 0, wands: 0, breath: 0, spells: 0 },
    maxHp: 0, speedPct: 0, lightRadius: 0, findTrapsPct: 0, extraSlots: {},
    lifeOnHit: 0, thorns: 0, resistPoison: false, slay: {}, special: [],
  };
  let lightBase = 0;

  for (const slot of EQUIP_SLOTS) {
    const it = inv.equipment[slot];
    if (!it) continue;
    const d = getDef(it.defKey);

    if (d.kind === 'weapon') {
      b.weaponKey = d.key;
      b.weaponDice = d.damage ?? '1d2';
      b.twoHanded = !!d.twoHanded;
      b.toHit += it.plus;
      b.damage += it.plus;
    } else if (d.kind === 'armor' || d.kind === 'shield') {
      if (slot === 'armor' && d.ac !== undefined) b.armorAc = d.ac;
      if (d.kind === 'shield') b.shield += d.ac ?? 0;
      b.acMagic -= it.plus;
    }
    if (d.light && (it.charges ?? 0) > 0) lightBase = Math.max(lightBase, d.light.radius);

    for (const a of it.affixes) {
      const e = a.effect;
      switch (e.type) {
        case 'toHit': b.toHit += e.amount; break;
        case 'damage': b.damage += e.amount; break;
        case 'ac': b.acMagic -= e.amount; break;
        case 'save':
          for (const c of SAVE_CATEGORIES) if (e.category === 'all' || e.category === c) b.saveBonus[c] += e.amount;
          break;
        case 'maxHp': b.maxHp += e.amount; break;
        case 'speed': b.speedPct += e.pct; break;
        case 'light': b.lightRadius += e.radius; break;
        case 'lifeOnHit': b.lifeOnHit += e.amount; break;
        case 'thorns': b.thorns += e.amount; break;
        case 'resistPoison': b.resistPoison = true; break;
        case 'findTraps': b.findTrapsPct += e.pct; break;
        case 'extraSlot': b.extraSlots[e.level] = (b.extraSlots[e.level] ?? 0) + e.count; break;
        case 'slay': b.slay[e.foe] = (b.slay[e.foe] ?? 0) + e.bonus; break;
      }
    }
  }
  b.lightRadius += lightBase;
  b.ac = b.armorAc + b.shield + b.acMagic;
  if (b.lifeOnHit) b.special.push(`lifeOnHit:${b.lifeOnHit}`);
  if (b.thorns) b.special.push(`thorns:${b.thorns}`);
  if (b.resistPoison) b.special.push('resistPoison');
  for (const [foe, n] of Object.entries(b.slay)) b.special.push(`slay:${foe}:${n}`);
  return b;
}

// ── Starting kits ──────────────────────────────────────────────────────────────────────────────────────

/** Deterministic ids ("s-<defKey>-<n>") so a new character's kit is the same every time. */
export function starterKit(classKey: ClassKey): Inventory {
  let n = 0;
  const mk = (defKey: string, quantity = 1): ItemInstance => {
    const it = instantiate(defKey, `s-${defKey}-${n++}`);
    it.quantity = quantity;
    return it;
  };
  const gold = { fighter: 50, thief: 30, cleric: 40, wizard: 25 }[classKey];
  const inv = new Inventory(classKey, gold);
  const stow = (defKey: string, q = 1): void => { inv.add(mk(defKey, q)); };
  /** Add one (or use one already stowed) and wear it. */
  const wear = (defKey: string): void => {
    if (!inv.pack.some((p) => p && p.defKey === defKey)) stow(defKey);
    const held = inv.pack.find((p) => p && p.defKey === defKey);
    if (held) inv.equip(held.id);
  };

  switch (classKey) {
    case 'fighter':
      wear('long_sword'); wear('chain_mail'); wear('shield');
      stow('torch', 3); stow('ration', 2);
      break;
    case 'thief':
      wear('short_sword'); wear('leather_armor');
      stow('dagger'); stow('thieves_tools'); stow('rope'); stow('ration', 2); stow('torch', 4);
      wear('torch');
      break;
    case 'cleric':
      wear('mace'); wear('chain_mail'); wear('shield');
      stow('torch', 3); stow('holy_water', 2); stow('ration', 2);
      break;
    case 'wizard':
      wear('dagger'); wear('cloak');
      stow('quarterstaff'); stow('ration', 2); stow('torch', 4);
      wear('torch');
      break;
  }
  // First-edition adventurers carried a ten-foot pole; the probe verb (P) is central to the tomb.
  stow('ten_foot_pole');
  const potion = mk('healing_potion');
  potion.quantity = 2;
  inv.belt[0] = potion;
  if (classKey === 'wizard') inv.belt[1] = mk('scroll_magic_missile');
  if (classKey === 'cleric') inv.belt[1] = mk('scroll_cure_light');
  if (classKey === 'wizard') stow('scroll_light');
  return inv;
}
