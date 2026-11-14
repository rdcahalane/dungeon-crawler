/**
 * First-edition combat arithmetic for the live game, kept free of Phaser so it can be unit tested.
 *
 * Everything takes plain numbers, an `Inventory` and an `Rng` and returns an outcome. The controllers
 * (`CombatController`, `LootController`, `SpellInputController`, `FloorController`) turn outcomes into
 * floating text, sprites and bus events. Armor class is descending throughout (lower is better).
 */
import type { ClassKey } from '../../constants';
import {
  MONSTERS, armorClass, attackRoll, backstabMultiplier, conHpBonus, damageRoll, dexterityMods,
  getSpell, hasSpecial, hitDie, hpGainForLevel, canHarm, monsterSave, savingThrow, saveTarget, spellsFor, strengthMods,
  thac0For, wisdomSaveAdj,
  type AbilityScores, type MonsterDef, type MonsterKey, type Rng, type SaveCategory, type SaveResult, type Spellbook,
} from '../../rules';
import { SURPRISE_TO_HIT_BONUS } from '../../rules/encounter';
import {
  equipmentBonuses, getDef, type Drop, type FoeTag, type Inventory, type ItemInstance,
} from '../../items';

/** Real-time swings come twice a second, so the d20 gets a thumb on the scale (documented balance number). */
export const REALTIME_TO_HIT_BONUS = 2;
/** Base swing cooldown. */
export const BASE_SWING_MS = 400;
/**
 * Window after a hit in which nothing else can land. Long enough that a pack cannot stack three bites into one
 * instant (tuned 2026-11-14 after level-1 characters died in about six seconds on floor 1).
 */
export const PLAYER_HIT_GRACE_MS = 500;
/** Healing potions heal 2d4+2. */
export const HEALING_POTION_DICE = '2d4';
export const HEALING_POTION_BONUS = 2;
/** Chance (percent per rest) that something wanders in while you sleep. */
export const WANDER_CHANCE_LONG_PCT = 17;
export const WANDER_CHANCE_SHORT_PCT = 8;

// ── The sheet ───────────────────────────────────────────────────────────────

/** Everything the combat math needs about the player, as plain data. */
export interface PlayerSheet {
  classKey: ClassKey;
  level: number;
  scores: AbilityScores;
  inventory: Inventory;
  /** Permanent boon points (legacy `weaponBonus` / `armorBonus`), already capped by the caller. */
  boonToHit?: number;
  boonDamage?: number;
  boonAc?: number;
  /** Temporary buffs from spells: Bless, Protection from Evil. */
  blessToHit?: number;
  buffAc?: number;
  buffSave?: number;
}

export function playerArmorClass(sheet: PlayerSheet, opts: { ignoreArmor?: boolean } = {}): number {
  const dexAdj = dexterityMods(sheet.scores.dex).acAdj;
  const magicExtra = (sheet.boonAc ?? 0) + (sheet.buffAc ?? 0);
  if (opts.ignoreArmor) {
    return armorClass({ base: 10, dexAdj, magic: magicExtra });
  }
  const b = equipmentBonuses(sheet.inventory);
  return armorClass({
    base: 10,
    armor: 10 - b.armorAc,
    shield: -b.shield,
    dexAdj,
    magic: -b.acMagic + magicExtra,
  });
}

export function playerThac0(sheet: PlayerSheet): number {
  return thac0For(sheet.classKey, sheet.level);
}

export interface WeaponProfile {
  weaponKey: string | null;
  dice: string;
  ranged: boolean;
  plus: number;
  silver: boolean;
  twoHanded: boolean;
}

export function weaponProfile(inv: Inventory): WeaponProfile {
  const b = equipmentBonuses(inv);
  const item = inv.equipment.weapon;
  const def = item ? getDef(item.defKey) : undefined;
  return {
    weaponKey: b.weaponKey,
    dice: b.weaponDice,
    ranged: !!def?.ranged,
    plus: item?.plus ?? 0,
    silver: !!def?.tags?.includes('silver'),
    twoHanded: b.twoHanded,
  };
}

/** Total to-hit bonus added to the d20 against a target's AC (higher is better). */
export function playerToHitBonus(sheet: PlayerSheet, kind: 'melee' | 'missile'): number {
  const b = equipmentBonuses(sheet.inventory);
  const ability = kind === 'melee' ? strengthMods(sheet.scores.str).toHit : dexterityMods(sheet.scores.dex).missile;
  return ability + b.toHit + (sheet.boonToHit ?? 0) + (sheet.blessToHit ?? 0) + REALTIME_TO_HIT_BONUS;
}

/** Flat damage added to the weapon dice. */
export function playerDamageBonus(sheet: PlayerSheet, kind: 'melee' | 'missile'): number {
  const b = equipmentBonuses(sheet.inventory);
  const str = kind === 'melee' ? strengthMods(sheet.scores.str).damage : 0;
  return str + b.damage + (sheet.boonDamage ?? 0);
}

/** First-edition foe categories used by weapon "slay" affixes. */
export function foeTagsFor(key: MonsterKey, def?: MonsterDef): FoeTag[] {
  const tags: FoeTag[] = [];
  if (def?.undead) tags.push('undead');
  if (key === 'GIANT_SPIDER') tags.push('spiders');
  if (key === 'GIANT_RAT' || key === 'GIANT_BAT') tags.push('beasts');
  if (key === 'TROLL' || key === 'TANK') tags.push('giants');
  return tags;
}

// ── Player attacks ──────────────────────────────────────────────────────────

export interface TargetInfo {
  /** Descending AC of the target. */
  ac: number;
  def?: MonsterDef;
  key?: MonsterKey;
  /** The target has not noticed the player (idle, asleep, held): a thief backstabs. */
  unaware?: boolean;
  /** Asleep or held: struck automatically. */
  helpless?: boolean;
  /** Caught flat on first contact: the player gets `SURPRISE_TO_HIT_BONUS` to hit it. */
  surprised?: boolean;
}

export type PlayerAttackOutcome =
  | { kind: 'immune' }
  | { kind: 'miss'; natural: number; needed: number }
  | {
      kind: 'hit';
      natural: number;
      damage: number;
      crit: boolean;
      backstab: boolean;
      slayBonus: number;
    };

/** One melee swing (or thrown/fired weapon when `style` is 'missile'): THAC0 vs AC, then dice. */
export function resolvePlayerAttack(
  sheet: PlayerSheet,
  target: TargetInfo,
  rng: Rng,
  style: 'melee' | 'missile' = 'melee',
  /** Dice override, for the wizard's dart. */
  overrideDice?: string,
): PlayerAttackOutcome {
  const weapon = weaponProfile(sheet.inventory);
  // Plain arrows and sling stones obey the magic-weapon rule like a plain sword; the wizard's dart (overrideDice)
  // is a spell and always bites.
  const isSpellDart = style === 'missile' && overrideDice !== undefined;
  if (target.def && !isSpellDart && !canHarm(target.def, { plus: weapon.plus, silver: weapon.silver })) {
    return { kind: 'immune' };
  }
  const toHit = playerToHitBonus(sheet, style) + (target.surprised ? SURPRISE_TO_HIT_BONUS : 0);
  let natural = 0;
  let hit: boolean;
  let crit = false;
  let needed = playerThac0(sheet) - target.ac - toHit;
  if (target.helpless) {
    hit = true;
    natural = 10;
  } else {
    const r = attackRoll({ thac0: playerThac0(sheet), targetAc: target.ac, toHitBonus: toHit }, rng);
    hit = r.hit;
    natural = r.natural;
    needed = r.needed;
    crit = r.critical;
  }
  if (!hit) return { kind: 'miss', natural, needed };

  const tags = target.key ? foeTagsFor(target.key, target.def) : target.def?.undead ? (['undead'] as FoeTag[]) : [];
  const b = equipmentBonuses(sheet.inventory);
  let slayBonus = 0;
  for (const t of tags) slayBonus += b.slay[t] ?? 0;
  const dice = overrideDice ?? (style === 'melee' || weapon.ranged ? weapon.dice : '1d2');
  let damage = damageRoll(dice, playerDamageBonus(sheet, style) + slayBonus, rng, { critical: crit });
  const backstab = sheet.classKey === 'thief' && !!target.unaware && style === 'melee';
  if (backstab) damage *= backstabMultiplier(sheet.level);
  return { kind: 'hit', natural, damage, crit: crit || backstab, backstab, slayBonus };
}

// ── Monster attacks ─────────────────────────────────────────────────────────

export interface MonsterAttackResult {
  name: string;
  hit: boolean;
  natural: number;
  damage: number;
}

export interface MonsterRound {
  attacks: MonsterAttackResult[];
  hits: number;
  /** Damage of every hit in the round, summed, so the player takes one blow per cooldown. */
  total: number;
}

/** One cooldown's worth of monster attacks, each rolled against the player's AC. */
export function resolveMonsterRound(
  def: MonsterDef,
  playerAc: number,
  rng: Rng,
  mods: { toHit?: number; damage?: number; helpless?: boolean } = {},
): MonsterRound {
  const attacks: MonsterAttackResult[] = [];
  let total = 0;
  let hits = 0;
  for (const a of def.attacks) {
    let hit: boolean;
    let natural = 10;
    if (mods.helpless) {
      hit = true;
    } else {
      const r = attackRoll({ thac0: def.thac0, targetAc: playerAc, toHitBonus: (a.bonus ?? 0) + (mods.toHit ?? 0) }, rng);
      hit = r.hit;
      natural = r.natural;
    }
    const damage = hit ? damageRoll(a.dice, mods.damage ?? 0, rng) : 0;
    if (hit) { hits++; total += damage; }
    attacks.push({ name: a.name, hit, natural, damage });
  }
  return { attacks, hits, total };
}

/** Does this monster ignore the player's armor? (Ghosts and other incorporeal things.) */
export function ignoresArmor(def: MonsterDef): boolean {
  return !!hasSpecial(def, 'incorporeal')?.ignoresArmor;
}

// ── Saving throws ───────────────────────────────────────────────────────────

export function playerSave(sheet: PlayerSheet, category: SaveCategory, modifier: number, rng: Rng): SaveResult {
  const b = equipmentBonuses(sheet.inventory);
  const wis = category === 'spells' ? wisdomSaveAdj(sheet.scores.wis) : 0;
  return savingThrow(
    {
      classKey: sheet.classKey,
      level: sheet.level,
      category,
      modifier: modifier + b.saveBonus[category] + wis + (sheet.buffSave ?? 0),
    },
    rng,
  );
}

/** Where the five 1e saves stand for the sheet, as the d20 target numbers (lower is easier). */
export function saveTargets(sheet: PlayerSheet): Record<SaveCategory, number> {
  const b = equipmentBonuses(sheet.inventory);
  const wis = wisdomSaveAdj(sheet.scores.wis);
  const t = (c: SaveCategory): number => {
    const base = saveTarget(sheet.classKey, sheet.level, c);
    return base - b.saveBonus[c] - (c === 'spells' ? wis : 0) - (sheet.buffSave ?? 0);
  };
  return { death: t('death'), petrify: t('petrify'), wands: t('wands'), breath: t('breath'), spells: t('spells') };
}

/** Legacy 3e-style bonus (higher is better) derived from a 1e target, for code that still adds d20 + save vs a DC. */
export function legacySaveBonus(target: number): number {
  return 15 - target;
}

export function monsterSaves(def: MonsterDef, category: SaveCategory, rng: Rng, modifier = 0): SaveResult {
  return monsterSave(def.hd, category, rng, modifier);
}

// ── Hit points, levels ──────────────────────────────────────────────────────

/** Level 1: the maximum of the hit die, plus the Constitution bonus, plus 4 (the game's scale tweak). */
export function startingHp(classKey: ClassKey, con: number): number {
  return Math.max(1, hitDie(classKey) + conHpBonus(con, classKey) + 4);
}

/** Hit points gained on reaching `level` (>= 2), through the rules lane's `hpGainForLevel`. */
export function levelUpHp(classKey: ClassKey, level: number, con: number, rng: Rng): number {
  return hpGainForLevel(classKey, level, rng, conHpBonus(con, classKey));
}

/** Deterministic hit points for an old (pre first-edition) character of a given level, so saves keep playing. */
export function convertedHp(classKey: ClassKey, level: number, con: number, rng: Rng): number {
  let hp = startingHp(classKey, con);
  for (let l = 2; l <= Math.max(1, level); l++) hp += levelUpHp(classKey, l, con, rng);
  return hp;
}

export interface HpState {
  hp: number;
  maxHp: number;
  drained: number;
}

/** Level drain, modelled as lost maximum hit points that rest gives back. Never below 1 maximum. */
export function applyDrain(s: HpState, amount: number): number {
  const lost = Math.max(0, Math.min(amount, s.maxHp - 1));
  s.maxHp -= lost;
  s.drained += lost;
  if (s.hp > s.maxHp) s.hp = s.maxHp;
  return lost;
}

export function restoreDrain(s: HpState): number {
  const back = s.drained;
  s.maxHp += back;
  s.drained = 0;
  return back;
}

// ── Resting ─────────────────────────────────────────────────────────────────

export interface RestSummary {
  healed: number;
  drainRestored: number;
  spellsRestored: boolean;
  ateRation: boolean;
  hungry: boolean;
}

/**
 * A rest. `long` is a night's sleep: drained hit points return, spells are re-memorized (`spellbook.rest()`), a
 * ration is eaten if there is one (without it you wake hungry and recover only half the missing hit points).
 * `short` only binds wounds: half the missing hit points, nothing else.
 */
export function applyRest(
  s: HpState,
  book: Spellbook | null,
  kind: 'short' | 'long',
  hasRation: boolean,
): RestSummary {
  const out: RestSummary = { healed: 0, drainRestored: 0, spellsRestored: false, ateRation: false, hungry: false };
  const before = s.hp;
  if (kind === 'short') {
    s.hp = Math.min(s.maxHp, s.hp + Math.floor((s.maxHp - s.hp) / 2));
    out.healed = s.hp - before;
    return out;
  }
  out.drainRestored = restoreDrain(s);
  if (hasRation) out.ateRation = true;
  else out.hungry = true;
  const missing = s.maxHp - s.hp;
  s.hp = Math.min(s.maxHp, s.hp + (hasRation ? missing : Math.floor(missing / 2)));
  out.healed = s.hp - before;
  if (book) { book.rest(); out.spellsRestored = true; }
  return out;
}

/** Percent roll for a wandering monster. */
export function wanderingMonsterArrives(kind: 'short' | 'long', rng: Rng): boolean {
  const pct = kind === 'long' ? WANDER_CHANCE_LONG_PCT : WANDER_CHANCE_SHORT_PCT;
  return rng.next() * 100 < pct;
}

// ── Spells ──────────────────────────────────────────────────────────────────

export interface SpellSlotView {
  key: string;
  name: string;
  level: number;
  remaining: number;
  max: number;
}

/** Every memorized spell with copies left and copies total. */
export function spellSlotViews(book: Spellbook | null): SpellSlotView[] {
  if (!book) return [];
  return book.prepared().map((p) => {
    const def = getSpell(p.key);
    return { key: p.key, name: def?.name ?? p.key, level: def?.level ?? 1, remaining: p.remaining, max: p.total };
  });
}

/** Hotkeys 1 to 4 cast the first four prepared spells that still have a slot left. */
export function selectHotkeySpells(book: Spellbook | null, limit = 4): SpellSlotView[] {
  return spellSlotViews(book).filter((v) => v.remaining > 0).slice(0, limit);
}

/** Wizards write every spell they have slots for into the book as they level (no spell-learning screen yet). */
export function learnableWizardSpells(maxSpellLevel: number): string[] {
  const out: string[] = [];
  for (let lv = 1; lv <= maxSpellLevel; lv++) {
    for (const s of spellsFor('wizard', lv)) out.push(s.key);
  }
  return out;
}

export interface SleepCandidate {
  id: number;
  hd: number;
  undead: boolean;
}

/** Sleep: weakest first, up to `maxTargets`, nothing above `maxHd`, undead unaffected, no saving throw. */
export function selectSleepVictims(
  candidates: readonly SleepCandidate[],
  maxHd: number,
  maxTargets: number,
): number[] {
  return candidates
    .filter((c) => !c.undead && c.hd <= maxHd)
    .sort((a, b) => a.hd - b.hd)
    .slice(0, maxTargets)
    .map((c) => c.id);
}

// ── Loot ────────────────────────────────────────────────────────────────────

export interface CollectResult {
  gold: number;
  picked: ItemInstance[];
  /** Items that did not fit (pack full). */
  left: ItemInstance[];
}

/** Move a drop into the inventory: gold always, items while the pack has room. */
export function collectDrop(inv: Inventory, drop: Drop): CollectResult {
  inv.gold += drop.gold;
  const picked: ItemInstance[] = [];
  const left: ItemInstance[] = [];
  for (const it of drop.items) {
    const r = inv.add(it);
    if (r.ok) picked.push(it);
    else left.push(it);
  }
  return { gold: drop.gold, picked, left };
}

/** Is this string a bestiary key? (Spawn markers carry plain strings.) */
export function enemyKeyIsMonster(key: string): key is MonsterKey {
  return Object.prototype.hasOwnProperty.call(MONSTERS, key);
}
