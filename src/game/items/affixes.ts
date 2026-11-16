import type { Affix, AffixEffect, ItemGroup, Rng, SaveCategory } from './types';

/** A template in the prefix/suffix pools. `roll` produces the concrete effect for a floor. */
export interface AffixDef {
  key: string;
  label: string;
  position: 'prefix' | 'suffix';
  applies: ItemGroup[];
  minFloor: number;
  weight: number;
  roll: (rng: Rng, floor: number) => AffixEffect;
}

const between = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng.next() * (hi - lo + 1));
const scaled = (rng: Rng, floor: number, lo: number, hi: number, perFloor = 0.25): number =>
  Math.min(hi, between(rng, lo, lo + Math.floor(floor * perFloor)));

const ARMOR_GROUPS: ItemGroup[] = ['body', 'shield', 'helm', 'cloak', 'boots'];
const WORN: ItemGroup[] = [...ARMOR_GROUPS, 'ring', 'amulet'];

const saveAffix = (key: string, label: string, cat: SaveCategory, applies: ItemGroup[], minFloor: number): AffixDef => ({
  key, label, position: 'suffix', applies, minFloor, weight: 8,
  roll: (rng, floor) => ({ type: 'save', category: cat, amount: scaled(rng, floor, 1, 3, 0.2) }),
});

export const AFFIX_POOL: readonly AffixDef[] = [
  // ── Weapon prefixes ──
  { key: 'keen', label: 'Keen', position: 'prefix', applies: ['weapon'], minFloor: 1, weight: 12, roll: (r, f) => ({ type: 'toHit', amount: scaled(r, f, 1, 2) }) },
  { key: 'honed', label: 'Honed', position: 'prefix', applies: ['weapon'], minFloor: 1, weight: 12, roll: (r, f) => ({ type: 'damage', amount: scaled(r, f, 1, 2) }) },
  { key: 'fleet', label: 'Fleet', position: 'prefix', applies: ['weapon'], minFloor: 2, weight: 8, roll: (r) => ({ type: 'speed', pct: between(r, 5, 12) }) },
  { key: 'hungering', label: 'Hungering', position: 'prefix', applies: ['weapon'], minFloor: 3, weight: 6, roll: (r, f) => ({ type: 'lifeOnHit', amount: scaled(r, f, 1, 3, 0.2) }) },
  { key: 'ember_forged', label: 'Ember-Forged', position: 'prefix', applies: ['weapon'], minFloor: 5, weight: 5, roll: (r, f) => ({ type: 'damage', amount: scaled(r, f, 2, 4, 0.2) }) },
  // ── Weapon suffixes ──
  { key: 'of_sureness', label: 'of Sureness', position: 'suffix', applies: ['weapon'], minFloor: 3, weight: 8, roll: (r, f) => ({ type: 'toHit', amount: scaled(r, f, 2, 3, 0.15) }) },
  { key: 'of_wight_bane', label: 'of Wight-Bane', position: 'suffix', applies: ['weapon'], minFloor: 3, weight: 7, roll: (r, f) => ({ type: 'slay', foe: 'undead', bonus: scaled(r, f, 2, 4, 0.2) }) },
  { key: 'of_web_cutting', label: 'of Web-Cutting', position: 'suffix', applies: ['weapon'], minFloor: 2, weight: 5, roll: (r) => ({ type: 'slay', foe: 'spiders', bonus: between(r, 2, 4) }) },
  { key: 'of_giant_felling', label: 'of Giant-Felling', position: 'suffix', applies: ['weapon'], minFloor: 5, weight: 5, roll: (r) => ({ type: 'slay', foe: 'giants', bonus: between(r, 3, 5) }) },
  { key: 'of_ruin', label: 'of Ruin', position: 'suffix', applies: ['weapon'], minFloor: 5, weight: 5, roll: (r, f) => ({ type: 'damage', amount: scaled(r, f, 2, 3, 0.15) }) },
  // ── Armor prefixes ──
  { key: 'sturdy', label: 'Sturdy', position: 'prefix', applies: ['body', 'shield', 'helm', 'cloak', 'boots'], minFloor: 1, weight: 12, roll: () => ({ type: 'ac', amount: 1 }) },
  { key: 'tempered', label: 'Tempered', position: 'prefix', applies: ['body', 'shield', 'helm'], minFloor: 3, weight: 8, roll: (r, f) => ({ type: 'ac', amount: scaled(r, f, 1, 2, 0.15) }) },
  { key: 'hale', label: 'Hale', position: 'prefix', applies: ARMOR_GROUPS, minFloor: 2, weight: 8, roll: (r, f) => ({ type: 'maxHp', amount: scaled(r, f, 3, 8, 0.6) }) },
  { key: 'thorned', label: 'Thorned', position: 'prefix', applies: ['body', 'shield'], minFloor: 3, weight: 6, roll: (r, f) => ({ type: 'thorns', amount: scaled(r, f, 1, 3, 0.2) }) },
  // ── Armor suffixes ──
  { key: 'of_warding', label: 'of Warding', position: 'suffix', applies: WORN, minFloor: 2, weight: 8, roll: (r, f) => ({ type: 'save', category: 'all', amount: scaled(r, f, 1, 2, 0.15) }) },
  saveAffix('of_deep_breath', 'of the Deep Breath', 'breath', ARMOR_GROUPS, 2),
  saveAffix('of_stone_sense', 'of Stone-Sense', 'petrify', ARMOR_GROUPS, 2),
  saveAffix('of_quiet_mind', 'of the Quiet Mind', 'spells', ['helm', 'cloak', 'amulet'], 2),
  { key: 'of_nettles', label: 'of Nettles', position: 'suffix', applies: ['body', 'cloak', 'amulet', 'ring'], minFloor: 2, weight: 6, roll: () => ({ type: 'resistPoison' }) },
  { key: 'of_the_quiet_step', label: 'of the Quiet Step', position: 'suffix', applies: ['boots'], minFloor: 1, weight: 12, roll: (r) => ({ type: 'speed', pct: between(r, 5, 12) }) },
  { key: 'of_hawk_eyes', label: 'of Hawk-Eyes', position: 'suffix', applies: ['helm', 'ring', 'amulet', 'boots'], minFloor: 2, weight: 8, roll: (r, f) => ({ type: 'findTraps', pct: scaled(r, f, 10, 25, 2) }) },
  { key: 'of_the_glow', label: 'of the Glow', position: 'suffix', applies: ['helm', 'ring', 'amulet', 'cloak'], minFloor: 2, weight: 6, roll: (r) => ({ type: 'light', radius: between(r, 1, 2) }) },
  { key: 'of_vigor', label: 'of Vigor', position: 'suffix', applies: WORN, minFloor: 1, weight: 10, roll: (r, f) => ({ type: 'maxHp', amount: scaled(r, f, 3, 10, 0.7) }) },
  { key: 'of_arcana', label: 'of Arcana', position: 'suffix', applies: ['ring', 'amulet', 'helm'], minFloor: 4, weight: 4, roll: (r, f) => ({ type: 'extraSlot', level: f >= 7 && r.next() < 0.4 ? 2 : 1, count: 1 }) },
  // ── Jewelry (ring/amulet lead with these) ──
  { key: 'ring_protection', label: 'of Protection', position: 'suffix', applies: ['ring'], minFloor: 1, weight: 14, roll: (r, f) => ({ type: 'ac', amount: scaled(r, f, 1, 2, 0.15) }) },
  { key: 'of_quickness', label: 'of Quickness', position: 'suffix', applies: ['ring', 'amulet'], minFloor: 2, weight: 6, roll: (r) => ({ type: 'speed', pct: between(r, 5, 10) }) },
  { key: 'of_the_leech', label: 'of the Leech', position: 'suffix', applies: ['ring', 'amulet'], minFloor: 3, weight: 5, roll: (r) => ({ type: 'lifeOnHit', amount: between(r, 1, 2) }) },
  { key: 'of_brambles', label: 'of Brambles', position: 'suffix', applies: ['ring', 'amulet'], minFloor: 3, weight: 5, roll: (r) => ({ type: 'thorns', amount: between(r, 1, 2) }) },
  { key: 'of_the_tide', label: 'of the Tide', position: 'suffix', applies: ['amulet'], minFloor: 2, weight: 6, roll: () => ({ type: 'save', category: 'death', amount: 2 }) },
  { key: 'of_deadly_reach', label: 'of Deadly Reach', position: 'suffix', applies: ['ring'], minFloor: 3, weight: 6, roll: (r, f) => ({ type: 'toHit', amount: scaled(r, f, 1, 2, 0.15) }) },
];

export function poolFor(group: ItemGroup, floor: number, position?: 'prefix' | 'suffix'): AffixDef[] {
  return AFFIX_POOL.filter((a) => a.applies.includes(group) && a.minFloor <= floor && (!position || a.position === position));
}

export function makeAffix(d: AffixDef, rng: Rng, floor: number): Affix {
  return { key: d.key, label: d.label, position: d.position, effect: d.roll(rng, floor) };
}

/** Plain-language line for one effect. */
export function effectText(e: AffixEffect): string {
  const s = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
  switch (e.type) {
    case 'toHit': return `${s(e.amount)} to hit`;
    case 'damage': return `${s(e.amount)} damage`;
    case 'ac': return e.amount >= 0 ? `Armor class improved by ${e.amount}` : `Armor class worsened by ${-e.amount}`;
    case 'save': return `${s(e.amount)} to saves vs ${e.category === 'all' ? 'everything' : e.category}`;
    case 'maxHp': return `${s(e.amount)} max hit points`;
    case 'speed': return e.pct >= 0 ? `${e.pct}% faster movement` : `${-e.pct}% slower movement`;
    case 'light': return `${s(e.radius)} light radius`;
    case 'lifeOnHit': return `Heals ${e.amount} on each hit`;
    case 'thorns': return `Reflects ${e.amount} damage to melee attackers`;
    case 'resistPoison': return 'Resists poison';
    case 'findTraps': return `${s(e.pct)}% find traps`;
    case 'extraSlot': return `+${e.count} level ${e.level} spell slot`;
    case 'slay': return `${s(e.bonus)} damage vs ${e.foe}`;
  }
}

// ── Rare names: original word lists, combined at roll time ──────────────────────────────────────────────
const RARE_A = ['Ashen', 'Hollow', 'Gloam', 'Widow', 'Rook', 'Tallow', 'Grim', 'Cinder', 'Saltmarsh', 'Pale', 'Dusk', 'Barrow', 'Rust', 'Thorn', 'Lantern'];
const RARE_B: Record<ItemGroup, string[]> = {
  weapon: ['Fang', 'Splitter', 'Whisper', 'Edge', 'Reaper', 'Tithe', 'Sting'],
  body: ['Shell', 'Mantle', 'Hide', 'Carapace'],
  shield: ['Wall', 'Bulwark', 'Moon', 'Door'],
  helm: ['Crown', 'Cowl', 'Visage', 'Crest'],
  cloak: ['Shroud', 'Veil', 'Wrap', 'Pall'],
  boots: ['Tread', 'Stride', 'Heel', 'Footfall'],
  ring: ['Band', 'Loop', 'Knot', 'Circle'],
  amulet: ['Charm', 'Token', 'Locket', 'Eye'],
};

export function rareName(group: ItemGroup, rng: Rng): string {
  const a = RARE_A[Math.floor(rng.next() * RARE_A.length)];
  const list = RARE_B[group];
  const b = list[Math.floor(rng.next() * list.length)];
  return `${a} ${b}`;
}

// ── Uniques: hand-made, original names, one of each ─────────────────────────────────────────────────────
export interface UniqueDef {
  key: string;
  name: string;
  lore: string;
  baseKey: string;
  plus: number;
  minFloor: number;
  affixes: Affix[];
}

const u = (key: string, label: string, effect: AffixEffect): Affix => ({ key, label, position: 'unique', effect });

export const UNIQUES: readonly UniqueDef[] = [
  { key: 'gravewind', name: 'Gravewind', baseKey: 'long_sword', plus: 2, minFloor: 4,
    lore: 'The blade hums when the dead are near, like wind over a field of stones.',
    affixes: [u('gw_slay', 'Grave-hunter', { type: 'slay', foe: 'undead', bonus: 4 })] },
  { key: 'widows_kiss', name: "Widow's Kiss", baseKey: 'dagger', plus: 1, minFloor: 3,
    lore: 'Sold three times to three husbands. It was never the dagger that was unfaithful.',
    affixes: [u('wk_leech', 'Sweet poison', { type: 'lifeOnHit', amount: 2 }), u('wk_hit', 'Quick-fingered', { type: 'toHit', amount: 2 })] },
  { key: 'pale_bulwark', name: 'The Pale Bulwark', baseKey: 'shield', plus: 3, minFloor: 6,
    lore: 'Bleached bone-white by a thousand blows that never reached the arm behind it.',
    affixes: [u('pb_breath', 'Breath-turner', { type: 'save', category: 'breath', amount: 3 })] },
  { key: 'cinderfast', name: 'Cinderfast', baseKey: 'battle_axe', plus: 1, minFloor: 5,
    lore: 'The smith quenched it in a funeral pyre and the edge never cooled.',
    affixes: [u('cf_dmg', 'Ember-bitten', { type: 'damage', amount: 3 }), u('cf_giant', 'Giant-notcher', { type: 'slay', foe: 'giants', bonus: 3 })] },
  { key: 'hollowstep_boots', name: 'Hollowstep Boots', baseKey: 'boots', plus: 1, minFloor: 4,
    lore: 'Soled with felt from a bell that was cut down before it could ring.',
    affixes: [u('hs_speed', 'Soundless', { type: 'speed', pct: 15 }), u('hs_traps', 'Careful tread', { type: 'findTraps', pct: 15 })] },
  { key: 'mourners_cowl', name: "Mourner's Cowl", baseKey: 'helm', plus: 1, minFloor: 7,
    lore: 'Whoever wore it buried everyone they loved and kept walking.',
    affixes: [u('mc_death', 'Grief-hardened', { type: 'save', category: 'death', amount: 3 })] },
  { key: 'lantern_eyed_circlet', name: 'Lantern-Eyed Circlet', baseKey: 'helm', plus: 0, minFloor: 5,
    lore: 'Two cut crystals sit where eyes would be, and they drink what little light there is and give it back.',
    affixes: [u('le_light', 'Second sight', { type: 'light', radius: 2 }), u('le_traps', 'Seeing stones', { type: 'findTraps', pct: 10 })] },
  { key: 'tithe_bone_ring', name: 'Tithe-Bone Ring', baseKey: 'ring', plus: 0, minFloor: 7,
    lore: 'Carved from a finger bone that was paid, in full, to something below.',
    affixes: [u('tb_slot', 'Paid in advance', { type: 'extraSlot', level: 1, count: 1 }), u('tb_leech', 'Hungry', { type: 'lifeOnHit', amount: 1 })] },
  { key: 'salt_wifes_amulet', name: "Salt-Wife's Amulet", baseKey: 'amulet', plus: 0, minFloor: 5,
    lore: 'A woman looked back once. This is what she left on the road.',
    affixes: [u('sw_save', 'Pillar of salt', { type: 'save', category: 'all', amount: 2 }), u('sw_poison', 'Cured by brine', { type: 'resistPoison' })] },
  { key: 'marrowsong', name: 'Marrowsong', baseKey: 'two_handed_sword', plus: 3, minFloor: 9,
    lore: 'It sings a single low note on the downswing, and the note is a name.',
    affixes: [u('ms_dmg', 'Breaker', { type: 'damage', amount: 2 })] },
  { key: 'ash_wardens_cloak', name: "Ash-Warden's Cloak", baseKey: 'cloak', plus: 2, minFloor: 6,
    lore: 'Grey as a hearth at dawn. The last warden swore nothing burned that it covered.',
    affixes: [u('aw_spell', 'Fireproofed', { type: 'save', category: 'spells', amount: 3 }), u('aw_breath', 'Ash-veiled', { type: 'save', category: 'breath', amount: 2 })] },
  { key: 'bellkeeper', name: 'Bellkeeper', baseKey: 'mace', plus: 2, minFloor: 4,
    lore: 'Struck once for each soul it laid to rest. The head is worn to a perfect sphere.',
    affixes: [u('bk_slay', 'Knell', { type: 'slay', foe: 'undead', bonus: 3 }), u('bk_hp', 'Steady hand', { type: 'maxHp', amount: 5 })] },
  { key: 'thornwife_mail', name: 'Thornwife Mail', baseKey: 'chain_mail', plus: 2, minFloor: 6,
    lore: 'Every ring is a tiny briar. Embraces end badly for whoever starts them.',
    affixes: [u('tw_thorn', 'Briar-knit', { type: 'thorns', amount: 3 })] },
  { key: 'hoarwick', name: 'Hoarwick', baseKey: 'spear', plus: 2, minFloor: 5,
    lore: 'Found frozen upright in a doorway with nothing left to hold it but a skeleton hand.',
    affixes: [u('hw_giant', 'Doorway-guard', { type: 'slay', foe: 'giants', bonus: 4 }), u('hw_hit', 'True flight', { type: 'toHit', amount: 1 })] },
  { key: 'quiet_mercy', name: 'Quiet Mercy', baseKey: 'short_bow', plus: 2, minFloor: 6,
    lore: 'Strung with the hair of someone who asked to be forgotten.',
    affixes: [u('qm_hit', 'Unerring', { type: 'toHit', amount: 2 })] },
  { key: 'bargemans_ring', name: "Bargeman's Ring", baseKey: 'ring', plus: 0, minFloor: 3,
    lore: 'Passed from hand to hand across a black river. The toll was always a little extra life.',
    affixes: [u('br_vigor', 'River-lucky', { type: 'maxHp', amount: 10 }), u('br_death', 'Paid fare', { type: 'save', category: 'death', amount: 1 })] },
];

export const UNIQUE_BY_KEY: Readonly<Record<string, UniqueDef>> = Object.fromEntries(UNIQUES.map((x) => [x.key, x]));

// ── Cursed variants: they look like any other magic item until identified ───────────────────────────────
export interface CurseDef {
  key: string;
  baseKey: string;
  plus: number;
  minFloor: number;
  affixes: Affix[];
  /** What the item looks like it is. Only shown by the shop/lore, never by an unidentified name. */
  note: string;
}

const c = (key: string, label: string, effect: AffixEffect): Affix => ({ key, label, position: 'curse', effect });

export const CURSES: readonly CurseDef[] = [
  { key: 'false_warding', baseKey: 'ring', plus: 0, minFloor: 1,
    note: 'Sold as a ring of protection. Worn, it makes you easier to hit and will not come off.',
    affixes: [c('false_warding', 'of False Warding', { type: 'ac', amount: -1 })] },
  { key: 'leaden_limbs', baseKey: 'ring', plus: 0, minFloor: 2,
    note: 'Your legs feel as if you were wading through wet sand, and the ring holds fast.',
    affixes: [c('leaden_limbs', 'of Leaden Limbs', { type: 'speed', pct: -15 })] },
  { key: 'hungry_dark', baseKey: 'amulet', plus: 0, minFloor: 3,
    note: 'Something at the end of the cord drinks a little of you every hour.',
    affixes: [c('hungry_dark', 'of the Hungry Dark', { type: 'maxHp', amount: -8 })] },
  { key: 'hollow_blade', baseKey: 'long_sword', plus: -1, minFloor: 2,
    note: 'A fine-looking blade that wants to turn in your hand. Your fingers will not open.',
    affixes: [c('hollow_blade', 'of Treachery', { type: 'toHit', amount: -1 })] },
  { key: 'whispering_helm', baseKey: 'helm', plus: 0, minFloor: 3,
    note: 'Voices at the edge of hearing. Spells slide off a mind busy listening to them.',
    affixes: [c('whispering_helm', 'of Whispers', { type: 'save', category: 'spells', amount: -2 })] },
  { key: 'clinging_boots', baseKey: 'boots', plus: 0, minFloor: 2,
    note: 'The leather has grown to the foot.',
    affixes: [c('clinging_boots', 'of Clinging', { type: 'speed', pct: -10 })] },
  { key: 'weeping_cloak', baseKey: 'cloak', plus: 0, minFloor: 4,
    note: 'Damp, and always cold. It leaves a shroud-shaped gap in your guard.',
    affixes: [c('weeping_cloak', 'of Weeping', { type: 'ac', amount: -2 })] },
  { key: 'dull_mace', baseKey: 'mace', plus: -2, minFloor: 3,
    note: 'Heavier than it should be, and it bites the hand that holds it.',
    affixes: [c('dull_mace', 'of Sorrow', { type: 'damage', amount: -1 })] },
];

export const CURSE_BY_KEY: Readonly<Record<string, CurseDef>> = Object.fromEntries(CURSES.map((x) => [x.key, x]));
