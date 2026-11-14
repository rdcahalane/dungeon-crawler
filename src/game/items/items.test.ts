import { describe, expect, it } from 'vitest';
import {
  CATALOG, CURSES, ITEM_DEFS, UNIQUES, Inventory, PACK_SIZE, buy, buyValue, describe as describeItem,
  displayName, equipmentBonuses, fromLegacyInventory, instantiate, makeItem, makeUnique, rarityColor,
  rarityWeights, rollDrop, rollItem, sell, sellValue, shopStock, starterKit,
  STAPLE_KEYS, buyWithPurse, sellList, sellWithPurse,
  type ItemInstance, type Rng,
} from './index';

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

const CONTRACT_ICONS = [
  'item_sword', 'item_axe', 'item_mace', 'item_dagger', 'item_staff', 'item_bow', 'item_shield', 'item_armor',
  'item_helm', 'item_cloak', 'item_boots', 'item_ring', 'item_amulet', 'item_potion_red', 'item_potion_blue',
  'item_scroll', 'item_torch', 'item_pole', 'item_rope', 'item_spikes', 'item_holy_water', 'item_tools',
  'item_ration', 'item_gem', 'item_key',
];

let seq = 0;
const mk = (defKey: string, over: Partial<ItemInstance> = {}): ItemInstance => instantiate(defKey, `t${seq++}`, over);

function cursedRing(): ItemInstance {
  const c = CURSES.find((x) => x.key === 'false_warding')!;
  return mk(c.baseKey, { rarity: 'magic', cursed: true, identified: false, affixes: c.affixes.map((a) => ({ ...a })) });
}

describe('catalog', () => {
  it('uses only icons from the contract', () => {
    for (const d of ITEM_DEFS) expect(CONTRACT_ICONS, d.key).toContain(d.icon);
  });
  it('has unique keys and valid references', () => {
    expect(new Set(ITEM_DEFS.map((d) => d.key)).size).toBe(ITEM_DEFS.length);
    for (const u of UNIQUES) expect(CATALOG[u.baseKey], u.key).toBeDefined();
    for (const c of CURSES) expect(CATALOG[c.baseKey], c.key).toBeDefined();
    expect(UNIQUES.length).toBeGreaterThanOrEqual(12);
  });
  it('uses first-edition descending AC', () => {
    expect(CATALOG.leather_armor.ac).toBe(8);
    expect(CATALOG.chain_mail.ac).toBe(5);
    expect(CATALOG.plate_mail.ac).toBe(3);
    expect(CATALOG.shield.ac).toBe(-1);
  });
});

describe('inventory slots and stacking', () => {
  it('stacks stackables up to the limit and spills into a new slot', () => {
    const inv = new Inventory('fighter');
    expect(inv.add(mk('torch', { quantity: 8 })).ok).toBe(true);
    expect(inv.add(mk('torch', { quantity: 3 })).ok).toBe(true);
    expect(inv.pack.filter(Boolean)).toHaveLength(2);
    expect(inv.count('torch')).toBe(11);
  });
  it('does not stack unlike items (different charges, magic)', () => {
    const inv = new Inventory('fighter');
    inv.add(mk('torch'));
    inv.add(mk('torch', { charges: 10 }));
    expect(inv.pack.filter(Boolean)).toHaveLength(2);
  });
  it('limits the pack to 24 and fails atomically with a reason', () => {
    const inv = new Inventory('fighter');
    for (let i = 0; i < PACK_SIZE; i++) expect(inv.add(mk('long_sword')).ok).toBe(true);
    const r = inv.add(mk('long_sword'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('pack_full');
    const t = inv.add(mk('torch', { quantity: 5 }));
    expect(t.ok).toBe(false);
    expect(inv.count('torch')).toBe(0);
  });
  it('belt holds consumables only and four of them', () => {
    const inv = new Inventory('fighter');
    inv.add(mk('long_sword'));
    inv.add(mk('healing_potion'));
    const bad = inv.move({ kind: 'pack', index: 0 }, { kind: 'belt', index: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('belt_consumables_only');
    expect(inv.move({ kind: 'pack', index: 1 }, { kind: 'belt', index: 3 }).ok).toBe(true);
    expect(inv.belt).toHaveLength(4);
    expect(inv.belt[3]?.defKey).toBe('healing_potion');
  });
  it('move swaps and merges stacks', () => {
    const inv = new Inventory('fighter');
    inv.add(mk('torch', { quantity: 8 }));
    inv.pack[1] = mk('torch', { quantity: 2 });
    expect(inv.move({ kind: 'pack', index: 1 }, { kind: 'pack', index: 0 }).ok).toBe(true);
    // Full stack: no room to merge, so they swap.
    expect(inv.pack[0]!.quantity).toBe(2);
    expect(inv.pack[1]!.quantity).toBe(8);
    inv.pack[2] = mk('torch', { quantity: 3 });
    expect(inv.move({ kind: 'pack', index: 2 }, { kind: 'pack', index: 0 }).ok).toBe(true);
    expect(inv.pack[0]!.quantity).toBe(5);
    expect(inv.pack[2]).toBeNull();
    inv.pack[3] = mk('dagger');
    inv.move({ kind: 'pack', index: 3 }, { kind: 'pack', index: 0 });
    expect(inv.pack[0]!.defKey).toBe('dagger');
    expect(inv.pack[3]!.defKey).toBe('torch');
  });
  it('consume, remove and has', () => {
    const inv = new Inventory('fighter');
    inv.add(mk('healing_potion', { quantity: 5 }));
    inv.add(mk('healing_potion', { quantity: 2 }));
    expect(inv.has('healing_potion', 7)).toBe(true);
    expect(inv.consume('healing_potion', 6).ok).toBe(true);
    expect(inv.count('healing_potion')).toBe(1);
    const r = inv.consume('healing_potion', 2);
    expect(r.ok).toBe(false);
    expect(inv.count('healing_potion')).toBe(1);
    expect(inv.has('antidote')).toBe(false);
  });
  it('useFromBelt consumes one and returns the effect', () => {
    const inv = new Inventory('fighter');
    inv.belt[0] = mk('healing_potion', { quantity: 2 });
    const r = inv.useFromBelt(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effect.type).toBe('heal');
    inv.useFromBelt(0);
    expect(inv.belt[0]).toBeNull();
    const e = inv.useFromBelt(0);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.reason).toBe('empty_slot');
  });
});

describe('equipping', () => {
  it('enforces class restrictions', () => {
    const wiz = new Inventory('wizard');
    const chain = mk('chain_mail');
    const shield = mk('shield');
    const dagger = mk('dagger');
    [chain, shield, dagger].forEach((i) => wiz.add(i));
    const a = wiz.equip(chain.id);
    expect(!a.ok && a.reason).toBe('class_restricted');
    const b = wiz.equip(shield.id);
    expect(!b.ok && b.reason).toBe('class_restricted');
    expect(wiz.equip(dagger.id).ok).toBe(true);

    const cleric = new Inventory('cleric');
    const sword = mk('long_sword');
    const mace = mk('mace');
    cleric.add(sword); cleric.add(mace);
    expect(cleric.equip(sword.id).ok).toBe(false);
    expect(cleric.equip(mace.id).ok).toBe(true);

    const thief = new Inventory('thief');
    const leather = mk('leather_armor');
    const chain2 = mk('chain_mail');
    thief.add(leather); thief.add(chain2);
    expect(thief.equip(leather.id).ok).toBe(true);
    expect(thief.equip(chain2.id).ok).toBe(false);
  });
  it('two-handed weapons block the offhand both ways', () => {
    const inv = new Inventory('fighter');
    const big = mk('two_handed_sword');
    const sh = mk('shield');
    const sw = mk('long_sword');
    [big, sh, sw].forEach((i) => inv.add(i));
    expect(inv.equip(sh.id).ok).toBe(true);
    const r = inv.equip(big.id);
    expect(!r.ok && r.reason).toBe('two_handed_conflict');
    inv.unequip('offhand');
    expect(inv.equip(big.id).ok).toBe(true);
    const r2 = inv.equip(sh.id);
    expect(!r2.ok && r2.reason).toBe('two_handed_conflict');
  });
  it('swaps a displaced item into the vacated slot', () => {
    const inv = new Inventory('fighter');
    const a = mk('long_sword');
    const b = mk('battle_axe');
    inv.add(a); inv.add(b);
    inv.equip(a.id);
    const r = inv.equip(b.id);
    expect(r.ok && r.displaced?.id).toBe(a.id);
    expect(inv.equipment.weapon!.id).toBe(b.id);
    expect(inv.find(a.id)?.loc.kind).toBe('pack');
  });
  it('splits one torch off a stack, and fills ring slots in order', () => {
    const inv = new Inventory('fighter');
    inv.add(mk('torch', { quantity: 3 }));
    inv.equip(inv.pack[0]!.id);
    expect(inv.equipment.offhand!.quantity).toBe(1);
    expect(inv.pack[0]!.quantity).toBe(2);
    const r1 = mk('ring'); const r2 = mk('ring');
    inv.add(r1); inv.add(r2);
    expect(inv.equip(r1.id)).toMatchObject({ ok: true, slot: 'ring1' });
    expect(inv.equip(r2.id)).toMatchObject({ ok: true, slot: 'ring2' });
  });
  it('cursed items cannot be unequipped until removeCurse', () => {
    const inv = new Inventory('fighter');
    const ring = cursedRing();
    inv.add(ring);
    const e = inv.equip(ring.id);
    expect(e).toMatchObject({ ok: true, curseRevealed: true });
    const u = inv.unequip('ring1');
    expect(!u.ok && u.reason).toBe('cursed');
    const mv = inv.move({ kind: 'equip', slot: 'ring1' }, { kind: 'pack', index: 0 });
    expect(mv.ok).toBe(false);
    const other = mk('ring');
    inv.add(other);
    inv.equip(other.id, 'ring1');
    expect(inv.equipment.ring1!.id).toBe(ring.id);
    expect(inv.removeCurse(ring.id).ok).toBe(true);
    expect(inv.unequip('ring1').ok).toBe(true);
    expect(inv.removeCurse(ring.id).ok).toBe(false);
  });
  it('identify reveals an item once', () => {
    const inv = new Inventory('fighter');
    const it = makeUnique('gravewind', mulberry32(1));
    inv.add(it);
    expect(inv.identify(it.id).ok).toBe(true);
    expect(inv.find(it.id)!.item.identified).toBe(true);
    expect(inv.identify(it.id).ok).toBe(false);
  });
});

describe('names and tooltips', () => {
  it('hides affixes and magic until identified', () => {
    const it = makeUnique('gravewind', mulberry32(2));
    expect(displayName(it)).toBe('Long Sword?');
    const lines = describeItem(it).join('\n');
    expect(lines).not.toMatch(/undead|Gravewind|\+2/);
    it.identified = true;
    expect(displayName(it)).toBe('Gravewind');
    expect(describeItem(it).join('\n')).toMatch(/undead/);
  });
  it('a cursed item looks like any other magic item until identified', () => {
    const ring = cursedRing();
    expect(displayName(ring)).toBe('Ring?');
    expect(rarityColor(ring)).toBe(rarityColor('magic'));
    ring.identified = true;
    expect(displayName(ring)).toMatch(/False Warding.*cursed/);
    expect(rarityColor(ring)).not.toBe(rarityColor('magic'));
  });
  it('rarity colors are white, blue, yellow, orange', () => {
    expect(rarityColor('common')).toBe(0xffffff);
    expect(new Set(['common', 'magic', 'rare', 'unique'].map((r) => rarityColor(r as 'common'))).size).toBe(4);
  });
  it('names magic items with prefix, plus and suffix', () => {
    const it = mk('long_sword', {
      rarity: 'magic', plus: 2,
      affixes: [{ key: 'keen', label: 'Keen', position: 'prefix', effect: { type: 'toHit', amount: 1 } }],
    });
    expect(displayName(it)).toBe('Keen Long Sword +2');
  });
});

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const inv = starterKit('thief');
    const rng = mulberry32(7);
    for (let i = 0; i < 6; i++) inv.add(rollItem({ floor: 6 }, rng));
    inv.gold = 321;
    const text = JSON.stringify(inv);
    const back = Inventory.fromJSON(JSON.parse(text));
    expect(JSON.stringify(back)).toBe(text);
    expect(back.classKey).toBe('thief');
    expect(equipmentBonuses(back)).toEqual(equipmentBonuses(inv));
  });
  it('tolerates junk', () => {
    expect(Inventory.fromJSON(null).pack).toHaveLength(24);
    const j = Inventory.fromJSON({ pack: [{ id: 'x', defKey: 'nope' }], gold: 'many' });
    expect(j.pack[0]).toBeNull();
    expect(j.gold).toBe(0);
  });
});

describe('generation', () => {
  it('is deterministic for a seeded Rng', () => {
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      return [
        ...Array.from({ length: 20 }, () => rollItem({ floor: 5 }, rng)),
        rollDrop({ type: 'chest', tier: 'golden' }, 5, rng),
        rollDrop({ type: 'monster', hd: 4 }, 5, rng),
        rollDrop({ type: 'vault', lootTier: 3 }, 5, rng),
      ];
    };
    expect(JSON.stringify(run(42))).toBe(JSON.stringify(run(42)));
    expect(JSON.stringify(run(42))).not.toBe(JSON.stringify(run(43)));
  });
  it('rarity improves with floor over 5,000 rolls', () => {
    const share = (floor: number) => {
      const rng = mulberry32(99);
      let good = 0, rareUp = 0;
      for (let i = 0; i < 5000; i++) {
        const it = rollItem({ floor, kind: 'weapon' }, rng);
        if (it.rarity !== 'common') good++;
        if (it.rarity === 'rare' || it.rarity === 'unique') rareUp++;
      }
      return { good: good / 5000, rareUp: rareUp / 5000 };
    };
    const lo = share(1), mid = share(5), hi = share(12);
    expect(mid.good).toBeGreaterThan(lo.good);
    expect(hi.good).toBeGreaterThan(mid.good);
    expect(hi.rareUp).toBeGreaterThan(lo.rareUp + 0.05);
    expect(rarityWeights(1).unique).toBe(0);
    expect(rarityWeights(12).unique).toBeGreaterThan(0);
  });
  it('every unique is obtainable', () => {
    const rng = mulberry32(2024);
    const seen = new Set<string>();
    for (let i = 0; i < 40000 && seen.size < UNIQUES.length; i++) {
      const it = rollItem({ floor: 12, rarityBias: 40 }, rng);
      if (it.uniqueKey) seen.add(it.uniqueKey);
    }
    expect([...seen].sort()).toEqual(UNIQUES.map((u) => u.key).sort());
    // And a unique never drops above its floor gate.
    const r2 = mulberry32(5);
    for (let i = 0; i < 4000; i++) {
      const it = rollItem({ floor: 3, rarityBias: 40 }, r2);
      if (it.uniqueKey) expect(UNIQUES.find((u) => u.key === it.uniqueKey)!.minFloor).toBeLessThanOrEqual(3);
    }
  });
  it('produces cursed items that start unidentified, and honors noCurse', () => {
    const rng = mulberry32(11);
    let cursed = 0;
    for (let i = 0; i < 4000; i++) {
      const it = rollItem({ floor: 6, rarityBias: 4, kind: 'gear', minRarity: 'magic' }, rng);
      if (it.cursed) { cursed++; expect(it.identified).toBe(false); }
    }
    expect(cursed).toBeGreaterThan(0);
    const r2 = mulberry32(11);
    for (let i = 0; i < 2000; i++) expect(rollItem({ floor: 6, noCurse: true, minRarity: 'magic' }, r2).cursed).toBe(false);
  });
  it('jewelry always has an affix and every rolled item references a real def', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 3000; i++) {
      const it = rollItem({ floor: 1 + (i % 12) }, rng);
      expect(CATALOG[it.defKey]).toBeDefined();
      if (it.defKey === 'ring' || it.defKey === 'amulet') expect(it.affixes.length).toBeGreaterThan(0);
      expect(it.quantity).toBeGreaterThanOrEqual(1);
    }
  });
  it('drops scale by source', () => {
    const rng = mulberry32(8);
    const avg = (fn: () => { gold: number; items: ItemInstance[] }) => {
      let g = 0, n = 0;
      for (let i = 0; i < 300; i++) { const d = fn(); g += d.gold; n += d.items.length; }
      return { g: g / 300, n: n / 300 };
    };
    const wood = avg(() => rollDrop({ type: 'chest', tier: 'wooden' }, 4, rng));
    const gold = avg(() => rollDrop({ type: 'chest', tier: 'golden' }, 4, rng));
    expect(gold.g).toBeGreaterThan(wood.g);
    expect(gold.n).toBeGreaterThan(wood.n);
    const boss = rollDrop({ type: 'monster', hd: 10, boss: true }, 6, rng);
    expect(boss.items.length).toBeGreaterThanOrEqual(2);
    expect(boss.items[0].rarity).not.toBe('common');
    const vault = rollDrop({ type: 'vault', lootTier: 3 }, 6, rng);
    expect(['rare', 'unique']).toContain(vault.items[0].rarity);
  });
});

describe('equipmentBonuses', () => {
  it('sums plus, affixes, AC and lights', () => {
    const inv = new Inventory('fighter');
    const put = (it: ItemInstance) => { inv.add(it); expect(inv.equip(it.id).ok).toBe(true); };
    put(mk('long_sword', { rarity: 'magic', plus: 2, affixes: [
      { key: 'a', label: 'Keen', position: 'prefix', effect: { type: 'toHit', amount: 1 } },
      { key: 'b', label: 'of Wight-Bane', position: 'suffix', effect: { type: 'slay', foe: 'undead', bonus: 3 } },
    ] }));
    put(mk('chain_mail', { rarity: 'magic', plus: 1 }));
    put(mk('shield', { rarity: 'magic', plus: 2 }));
    put(mk('ring', { rarity: 'magic', affixes: [{ key: 'p', label: 'of Protection', position: 'suffix', effect: { type: 'ac', amount: 2 } }] }));
    put(mk('ring', { rarity: 'magic', affixes: [{ key: 'w', label: 'of Warding', position: 'suffix', effect: { type: 'save', category: 'all', amount: 1 } }] }));
    put(mk('amulet', { rarity: 'magic', affixes: [
      { key: 'v', label: 'of Vigor', position: 'suffix', effect: { type: 'maxHp', amount: 6 } },
      { key: 't', label: 'of Brambles', position: 'suffix', effect: { type: 'thorns', amount: 2 } },
    ] }));
    put(mk('boots', { affixes: [
      { key: 's', label: 'of the Quiet Step', position: 'suffix', effect: { type: 'speed', pct: 10 } },
      { key: 'f', label: 'of Hawk-Eyes', position: 'suffix', effect: { type: 'findTraps', pct: 15 } },
    ], rarity: 'magic' }));
    put(mk('helm', { rarity: 'magic', affixes: [
      { key: 'x', label: 'of Arcana', position: 'suffix', effect: { type: 'extraSlot', level: 1, count: 1 } },
      { key: 'g', label: 'of the Glow', position: 'suffix', effect: { type: 'light', radius: 1 } },
      { key: 'q', label: 'of the Quiet Mind', position: 'suffix', effect: { type: 'save', category: 'spells', amount: 2 } },
    ] }));
    // Offhand is the shield, so no torch; light comes only from the affix.
    const b = equipmentBonuses(inv);
    expect(b.weaponDice).toBe('1d8');
    expect(b.toHit).toBe(3);
    expect(b.damage).toBe(2);
    expect(b.slay.undead).toBe(3);
    expect(b.armorAc).toBe(5);
    expect(b.shield).toBe(-1);
    expect(b.acMagic).toBe(-1 - 2 - 2);
    expect(b.ac).toBe(5 - 1 - 5);
    expect(b.saveBonus).toEqual({ death: 1, petrify: 1, wands: 1, breath: 1, spells: 3 });
    expect(b.maxHp).toBe(6);
    expect(b.thorns).toBe(2);
    expect(b.speedPct).toBe(10);
    expect(b.findTrapsPct).toBe(15);
    expect(b.extraSlots).toEqual({ 1: 1 });
    expect(b.lightRadius).toBe(1);
    expect(b.special).toContain('thorns:2');
  });
  it('unarmored, unarmed baseline and cursed penalties', () => {
    const inv = new Inventory('wizard');
    const b = equipmentBonuses(inv);
    expect(b).toMatchObject({ armorAc: 10, ac: 10, weaponDice: '1d2', toHit: 0, lightRadius: 0 });
    const ring = cursedRing();
    inv.add(ring); inv.equip(ring.id);
    expect(equipmentBonuses(inv).acMagic).toBe(1);
    expect(equipmentBonuses(inv).ac).toBe(11);
  });
  it('torches give light until they burn out', () => {
    const inv = new Inventory('thief');
    inv.add(mk('torch', { charges: 5 }));
    inv.equip(inv.pack[0]!.id);
    expect(equipmentBonuses(inv).lightRadius).toBe(4);
    expect(inv.burn(3).burntOut).toBeNull();
    expect(inv.burn(3).burntOut?.defKey).toBe('torch');
    expect(equipmentBonuses(inv).lightRadius).toBe(0);
    expect(inv.equipment.offhand).toBeUndefined();
  });
  it('lanterns survive empty and refuel from oil', () => {
    const inv = new Inventory('fighter');
    const l = mk('lantern', { charges: 1 });
    inv.add(l); inv.equip(l.id);
    inv.burn(10);
    expect(inv.equipment.offhand).toBeDefined();
    expect(inv.refuel(l.id).ok).toBe(false);
    inv.add(mk('oil_flask'));
    expect(inv.refuel(l.id).ok).toBe(true);
    expect(equipmentBonuses(inv).lightRadius).toBe(6);
  });
});

describe('starter kits and weight', () => {
  it('every class gets a legal kit with a light and a potion', () => {
    for (const c of ['fighter', 'thief', 'wizard', 'cleric'] as const) {
      const inv = starterKit(c);
      expect(inv.has('torch'), c).toBe(true);
      expect(inv.has('healing_potion'), c).toBe(true);
      expect(inv.equipment.weapon, c).toBeDefined();
      for (const it of inv.equipped()) expect(CATALOG[it.defKey].classes, `${c} ${it.defKey}`).toContain(c);
    }
    expect(starterKit('thief').has('thieves_tools')).toBe(true);
    for (const c of ['fighter', 'thief', 'wizard', 'cleric'] as const) {
      expect(starterKit(c).count('ten_foot_pole'), `${c} pole`).toBe(1);
    }
    expect(starterKit('fighter').equipment.armor?.defKey).toBe('chain_mail');
    expect(starterKit('wizard').equipment.armor).toBeUndefined();
    expect(JSON.stringify(starterKit('cleric'))).toBe(JSON.stringify(starterKit('cleric')));
  });
  it('encumbrance slows heavy loads', () => {
    const inv = new Inventory('fighter');
    expect(inv.encumbrance(12).tier).toBe('light');
    for (let i = 0; i < 3; i++) inv.add(mk('plate_mail'));
    const e = inv.encumbrance(10);
    expect(e.weight).toBe(135);
    expect(e.tier).toBe('overloaded');
    expect(e.speedMult).toBeLessThan(0.5);
    expect(inv.encumbrance(18).tier).toBe('moderate');
    expect(inv.encumbrance(18).speedMult).toBeLessThan(1);
  });
});

describe('shop and value', () => {
  it('offers a +1 version of the class weapon from level 3', () => {
    const want: Record<string, string> = { fighter: 'long_sword', thief: 'short_sword', cleric: 'mace', wizard: 'dagger' };
    for (const [cls, key] of Object.entries(want)) {
      const plusOne = (lv: number) => shopStock(lv, mulberry32(3), cls)
        .some((e) => e.item.defKey === key && e.item.plus === 1 && e.item.identified && !e.item.cursed);
      expect(plusOne(2)).toBe(false);
      expect(plusOne(3)).toBe(true);
    }
  });

  it('stocks more as level rises and buy/sell move gold', () => {
    const lo = shopStock(1, mulberry32(1));
    const hi = shopStock(8, mulberry32(1));
    expect(hi.length).toBeGreaterThan(lo.length);
    expect(lo.some((e) => e.item.defKey === 'ten_foot_pole')).toBe(true);
    expect(lo.some((e) => e.item.defKey === 'plate_mail')).toBe(false);
    expect(hi.some((e) => e.item.defKey === 'plate_mail')).toBe(true);
    expect(hi.some((e) => e.item.rarity !== 'common')).toBe(true);
    expect(hi.every((e) => !e.item.cursed && e.item.identified)).toBe(true);

    const inv = new Inventory('fighter', 100);
    const pole = lo.find((e) => e.item.defKey === 'ten_foot_pole')!;
    const before = pole.item.quantity;
    expect(buy(inv, pole, 1)).toMatchObject({ ok: true, spent: pole.unitPrice });
    expect(inv.gold).toBe(100 - pole.unitPrice);
    expect(pole.item.quantity).toBe(before - 1);
    expect(buy(new Inventory('fighter', 0), pole, 1).ok).toBe(false);
    const sold = sell(inv, inv.pack[0]!.id);
    expect(sold.ok).toBe(true);
    expect(inv.pack[0]).toBeNull();
  });
  it('values: unidentified lowballed, sell below buy, treasure at face', () => {
    const rng = mulberry32(4);
    const un = makeUnique('marrowsong', rng);
    const known = { ...un, identified: true };
    expect(sellValue(known)).toBeGreaterThan(sellValue(un));
    expect(buyValue(known)).toBeGreaterThan(sellValue(known));
    expect(sellValue(makeItem('gem_ruby', rng))).toBe(500);
  });
});

describe('legacy conversion', () => {
  it('handles an empty save', () => {
    const r = fromLegacyInventory([], {});
    expect(r.skipped).toEqual([]);
    expect(r.inventory.classKey).toBe('fighter');
    expect(r.inventory.equipment.weapon?.defKey).toBe('long_sword');
  });
  it('handles a full old save', () => {
    const items = [
      { id: '1', type: 'WEAPON', label: 'Long Sword +2 [Drain]', bonus: 2, equipped: true, floorFound: 3, timestamp: 1 },
      { id: '2', type: 'ARMOR', label: 'Plate Armor +1 [Guard]', bonus: 1, equipped: true, floorFound: 4, timestamp: 2 },
      { id: '3', type: 'SCROLL', label: 'Scroll of FIREBALL', floorFound: 2, timestamp: 3 },
      { id: '4', type: 'CONSUMABLE', label: 'Health Potion', floorFound: 1, timestamp: 4 },
      { id: '5', type: 'STAT_TOME', label: 'Tome of STR', floorFound: 8, timestamp: 5 },
      { id: '6', type: 'WEAPON', label: 'Weapon Shard +1 [Quick]', bonus: 1, floorFound: 1, timestamp: 6 },
      { id: '7', type: 'WEAPON', label: 'Mystery Club', floorFound: 1, timestamp: 7 },
    ];
    const r = fromLegacyInventory(items, { classKey: 'fighter', gold: 275, healthPotions: 7 });
    const inv = r.inventory;
    expect(inv.gold).toBe(275);
    expect(inv.equipment.weapon?.plus).toBe(2);
    expect(inv.equipment.weapon?.affixes[0].effect).toMatchObject({ type: 'lifeOnHit' });
    expect(inv.equipment.armor?.defKey).toBe('plate_mail');
    expect(inv.equipment.armor?.plus).toBe(1);
    expect(inv.has('scroll_fireball')).toBe(true);
    expect(inv.count('healing_potion')).toBe(2 + 1 + 7);
    expect(inv.has('long_sword')).toBe(true); // the starter sword displaced into the pack
    expect(r.skipped.some((s) => s.includes('Tome of STR'))).toBe(true);
    expect(r.skipped.some((s) => s.includes('Mystery Club'))).toBe(true);
    expect(JSON.stringify(Inventory.fromJSON(JSON.parse(JSON.stringify(inv))))).toBe(JSON.stringify(inv));
  });
  it('keeps unusable legacy gear in the pack and folds bare bonuses into starter gear', () => {
    const r = fromLegacyInventory(
      [{ id: '1', type: 'ARMOR', label: 'Chain Mail +1', bonus: 1, equipped: true }],
      { classKey: 'wizard', weaponBonus: 2 },
    );
    expect(r.inventory.equipment.armor).toBeUndefined();
    expect(r.inventory.has('chain_mail')).toBe(true);
    expect(r.inventory.equipment.weapon?.plus).toBe(2);
  });
});

describe('tavern shop guarantees and purse accounting', () => {
  it('always stocks the ten staples, at every level, for every seed', () => {
    expect(STAPLE_KEYS).toEqual([
      'torch', 'ten_foot_pole', 'rope', 'iron_spikes', 'sack', 'holy_water', 'ration',
      'thieves_tools', 'healing_potion', 'scroll_recall',
    ]);
    for (const lv of [1, 2, 5, 12]) {
      for (const seed of [1, 2, 3, 99]) {
        const stock = shopStock(lv, mulberry32(seed));
        for (const key of STAPLE_KEYS) {
          const e = stock.find((x) => x.item.defKey === key);
          expect(e, `${key} at level ${lv}`).toBeDefined();
          expect(e!.item.quantity).toBeGreaterThanOrEqual(1);
          expect(e!.unitPrice).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('buying and selling keep one purse: the purse is truth and the inventory mirrors it', () => {
    const inv = new Inventory('fighter', 999); // a stale mirror
    const purse = { gold: 40 };
    const stock = shopStock(1, mulberry32(7));
    const potion = stock.find((e) => e.item.defKey === 'healing_potion')!;
    const r = buyWithPurse(inv, purse, potion, 1);
    expect(r).toMatchObject({ ok: true, spent: potion.unitPrice });
    expect(purse.gold).toBe(40 - potion.unitPrice);
    expect(inv.gold).toBe(purse.gold);
    expect(inv.count('healing_potion')).toBe(1);

    const line = sellList(inv)[0];
    expect(line.item.defKey).toBe('healing_potion');
    const s = sellWithPurse(inv, purse, line.item.id, 1);
    expect(s).toMatchObject({ ok: true, earned: line.unitPrice });
    expect(purse.gold).toBe(40 - potion.unitPrice + line.unitPrice);
    expect(inv.gold).toBe(purse.gold);
    expect(inv.count('healing_potion')).toBe(0);
  });

  it('a purchase you cannot afford changes neither gold nor stock; a full pack refuses cleanly', () => {
    const inv = new Inventory('fighter');
    const purse = { gold: 0 };
    const entry = shopStock(1, mulberry32(7)).find((e) => e.item.defKey === 'scroll_recall')!;
    const q = entry.item.quantity;
    expect(buyWithPurse(inv, purse, entry, 1).ok).toBe(false);
    expect(purse.gold).toBe(0);
    expect(entry.item.quantity).toBe(q);

    purse.gold = 1000;
    for (let i = 0; i < PACK_SIZE; i++) inv.add(makeItem('plate_mail', mulberry32(i)));
    expect(buyWithPurse(inv, purse, entry, 1).ok).toBe(false);
    expect(purse.gold).toBe(1000);
    expect(entry.item.quantity).toBe(q);
  });

  it('the sell list is the pack only and skips worthless things', () => {
    const inv = new Inventory('fighter');
    inv.add(makeItem('torch', mulberry32(1), 2));
    inv.add(makeItem('key_iron', mulberry32(2)));
    inv.equipment.weapon = instantiate('long_sword', 'w1');
    const list = sellList(inv);
    expect(list.map((l) => l.item.defKey)).toEqual(['torch']);
  });
});
