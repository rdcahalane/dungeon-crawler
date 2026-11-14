import { describe, expect, it } from "vitest";
import { mulberry32, getMonster, Spellbook, getSpell, hitChance, type ClassKey, type Rng } from "../../rules";
import { Inventory, makeItem, rollDrop, starterKit, PACK_SIZE, type ItemInstance } from "../../items";
import {
  REALTIME_TO_HIT_BONUS, applyDrain, applyRest, collectDrop, convertedHp, foeTagsFor, ignoresArmor,
  playerArmorClass, playerThac0, playerToHitBonus, resolveMonsterRound, resolvePlayerAttack, restoreDrain,
  selectHotkeySpells, selectSleepVictims, spellSlotViews, startingHp, wanderingMonsterArrives,
  type PlayerSheet,
} from "./AdndCombat";

const CLASSES: ClassKey[] = ["fighter", "thief", "wizard", "cleric"];

function sheetFor(classKey: ClassKey, over: Partial<PlayerSheet["scores"]> = {}, level = 1): PlayerSheet {
  return {
    classKey,
    level,
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...over },
    inventory: starterKit(classKey),
  };
}

/** A fixed die: `next()` returns the values in order, then the last forever. */
function fixed(...values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)] };
}

describe("player armor class from the kit", () => {
  it("is descending and comes from armor, shield and Dexterity", () => {
    // Chain mail 5 and a shield 1 off AC 10.
    expect(playerArmorClass(sheetFor("fighter"))).toBe(4);
    // Cloak only, no armor.
    expect(playerArmorClass(sheetFor("wizard"))).toBe(10);
    // Leather (8) for the thief, and DEX 16 is two points better.
    const plain = playerArmorClass(sheetFor("thief"));
    expect(plain).toBe(8);
    expect(playerArmorClass(sheetFor("thief", { dex: 16 }))).toBe(plain - 2);
  });

  it("magic armor and boons lower it further, and ghosts ignore armor", () => {
    const s = sheetFor("fighter");
    s.inventory.equipment.armor!.plus = 2;
    expect(playerArmorClass(s)).toBe(2);
    expect(playerArmorClass({ ...s, boonAc: 1 })).toBe(1);
    expect(playerArmorClass(s, { ignoreArmor: true })).toBe(10);
    expect(ignoresArmor(getMonster("GHOST"))).toBe(true);
    expect(ignoresArmor(getMonster("WRAITH"))).toBe(false);
  });
});

describe("to-hit odds", () => {
  it("a level-1 fighter hits a goblin between 40% and 75% of the time", () => {
    const sheet = sheetFor("fighter");
    const goblin = getMonster("BASIC");
    const analytic = hitChance({
      thac0: playerThac0(sheet), targetAc: goblin.ac, toHitBonus: playerToHitBonus(sheet, "melee"),
    });
    expect(analytic).toBeGreaterThanOrEqual(0.4);
    expect(analytic).toBeLessThanOrEqual(0.75);
    expect(REALTIME_TO_HIT_BONUS).toBe(2);

    const rng = mulberry32(7);
    let hits = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const r = resolvePlayerAttack(sheet, { ac: goblin.ac, def: goblin, key: "BASIC" }, rng);
      if (r.kind === "hit") hits++;
    }
    const rate = hits / n;
    expect(rate).toBeGreaterThan(0.38);
    expect(rate).toBeLessThan(0.77);
  });

  it("natural 20 is a critical and rolls the dice twice", () => {
    const sheet = sheetFor("fighter");
    // d20 = 20 (0.99), then two d8 for the doubled long sword die.
    const r = resolvePlayerAttack(sheet, { ac: 0 }, fixed(0.99, 0.99, 0.99), "melee");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") {
      expect(r.crit).toBe(true);
      expect(r.damage).toBe(16);
    }
  });
});

describe("weapons, immunities and backstab", () => {
  it("a plain weapon passes through a gargoyle; a +1 weapon does not", () => {
    const sheet = sheetFor("fighter");
    const garg = getMonster("GARGOYLE");
    const rng = mulberry32(3);
    expect(resolvePlayerAttack(sheet, { ac: garg.ac, def: garg, key: "GARGOYLE" }, rng).kind).toBe("immune");
    sheet.inventory.equipment.weapon!.plus = 1;
    let landed = false;
    for (let i = 0; i < 40; i++) {
      if (resolvePlayerAttack(sheet, { ac: garg.ac, def: garg, key: "GARGOYLE" }, rng).kind === "hit") landed = true;
    }
    expect(landed).toBe(true);
  });

  it("a thief backstabs an unaware foe for double damage at level 1", () => {
    const sheet = sheetFor("thief");
    const goblin = getMonster("BASIC");
    // Auto-hit on a helpless target; d6 short sword rolls a 4 (0.5).
    const plain = resolvePlayerAttack(sheet, { ac: goblin.ac, def: goblin, helpless: true }, fixed(0.5), "melee");
    const stab = resolvePlayerAttack(sheet, { ac: goblin.ac, def: goblin, helpless: true, unaware: true }, fixed(0.5), "melee");
    expect(plain.kind).toBe("hit");
    expect(stab.kind).toBe("hit");
    if (plain.kind === "hit" && stab.kind === "hit") {
      expect(stab.backstab).toBe(true);
      expect(stab.damage).toBe(plain.damage * 2);
    }
    const fighter = resolvePlayerAttack(sheetFor("fighter"), { ac: goblin.ac, unaware: true, helpless: true }, fixed(0.5), "melee");
    if (fighter.kind === "hit") expect(fighter.backstab).toBe(false);
  });

  it("maps monsters to the foe tags slay affixes use", () => {
    expect(foeTagsFor("SKELETON", getMonster("SKELETON"))).toContain("undead");
    expect(foeTagsFor("GIANT_SPIDER")).toContain("spiders");
    expect(foeTagsFor("BASIC")).toEqual([]);
  });
});

describe("a level-1 character against goblins", () => {
  it("survives at least three goblin attack attempts on average, every class", () => {
    const goblin = getMonster("BASIC");
    for (const classKey of CLASSES) {
      const sheet = sheetFor(classKey);
      const ac = playerArmorClass(sheet);
      const rng = mulberry32(100 + classKey.length);
      let total = 0;
      const trials = 3000;
      for (let t = 0; t < trials; t++) {
        let hp = startingHp(classKey, 10);
        let attempts = 0;
        while (hp > 0 && attempts < 200) {
          attempts++;
          hp -= resolveMonsterRound(goblin, ac, rng).total;
        }
        total += attempts;
      }
      expect(total / trials, classKey).toBeGreaterThanOrEqual(3);
    }
  });

  it("level-1 hit points are the maximum die plus Constitution plus 4", () => {
    expect(startingHp("fighter", 10)).toBe(14);
    expect(startingHp("wizard", 10)).toBe(8);
    expect(startingHp("fighter", 17)).toBe(10 + 3 + 4);
    expect(startingHp("cleric", 3)).toBe(8 - 2 + 4);
  });

  it("converts an old-scale character to first-edition hit points deterministically", () => {
    const a = convertedHp("fighter", 5, 12, mulberry32(5));
    const b = convertedHp("fighter", 5, 12, mulberry32(5));
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(startingHp("fighter", 12));
    expect(a).toBeLessThan(80); // nothing like the old 80-point fighter
  });
});

describe("monster rounds", () => {
  it("rolls every attack in the round and sums the hits", () => {
    const troll = getMonster("TROLL");
    // All d20 = 20 hit; damage dice at the top.
    const round = resolveMonsterRound(troll, 4, fixed(0.99), {});
    expect(round.attacks).toHaveLength(3);
    expect(round.hits).toBe(3);
    expect(round.total).toBe(5 + 5 + 8);
  });

  it("misses cost nothing, and a helpless victim is always hit", () => {
    const goblin = getMonster("BASIC");
    const miss = resolveMonsterRound(goblin, -10, fixed(0.0), {});
    expect(miss.hits).toBe(0);
    expect(miss.total).toBe(0);
    const held = resolveMonsterRound(goblin, -10, fixed(0.0, 0.5), { helpless: true });
    expect(held.hits).toBe(1);
  });
});

describe("spell slots and hotkeys", () => {
  function wizardBook(level: number): Spellbook {
    const book = Spellbook.create("wizard", level);
    book.fillDefault();
    return book;
  }

  it("hotkeys 1 to 4 are the first four prepared spells with a copy left", () => {
    const book = Spellbook.create("wizard", 4, { known: ["magic_missile", "sleep", "web", "knock", "light"] });
    book.memorize("magic_missile");
    book.memorize("sleep");
    book.memorize("web");
    book.memorize("knock");
    book.memorize("light");
    expect(selectHotkeySpells(book).map((s) => s.key)).toEqual(["magic_missile", "sleep", "web", "knock"]);
    // Spend the first: the fifth slides in.
    book.cast("magic_missile");
    expect(selectHotkeySpells(book).map((s) => s.key)).toEqual(["sleep", "web", "knock", "light"]);
  });

  it("with no slot left there is nothing to cast, and rest brings the spells back", () => {
    const book = wizardBook(1);
    const first = selectHotkeySpells(book)[0];
    expect(first).toBeDefined();
    book.cast(first.key);
    expect(selectHotkeySpells(book)).toHaveLength(0);
    const views = spellSlotViews(book);
    expect(views[0].remaining).toBe(0);
    expect(views[0].max).toBe(1);
    book.rest();
    expect(selectHotkeySpells(book)).toHaveLength(1);
    expect(getSpell(first.key)).toBeDefined();
  });

  it("non-casters have no spells", () => {
    expect(selectHotkeySpells(null)).toEqual([]);
    expect(spellSlotViews(null)).toEqual([]);
  });

  it("sleep takes the weakest first, skips undead and anything above four hit dice", () => {
    const ids = selectSleepVictims(
      [
        { id: 0, hd: 3, undead: false },
        { id: 1, hd: 1, undead: true },
        { id: 2, hd: 0.5, undead: false },
        { id: 3, hd: 6, undead: false },
        { id: 4, hd: 1, undead: false },
      ],
      4, 2,
    );
    expect(ids).toEqual([2, 4]);
  });
});

describe("drops into the inventory", () => {
  it("a monster drop lands in the pack and the purse", () => {
    const inv = new Inventory("fighter", 0);
    const rng = mulberry32(42);
    let items = 0;
    for (let i = 0; i < 60; i++) {
      const drop = rollDrop({ type: "monster", hd: 3 }, 3, rng);
      const goldBefore = inv.gold;
      const r = collectDrop(inv, drop);
      expect(inv.gold).toBe(goldBefore + drop.gold);
      expect(r.picked.length + r.left.length).toBe(drop.items.length);
      items += r.picked.length;
    }
    expect(items).toBeGreaterThan(0);
    expect(inv.items().length).toBeGreaterThan(0);
  });

  it("items that do not fit stay behind when the pack is full", () => {
    const inv = new Inventory("fighter", 0);
    const rng = mulberry32(9);
    for (let i = 0; i < PACK_SIZE; i++) inv.add(makeItem("long_sword", rng));
    const extra: ItemInstance = makeItem("plate_mail", rng);
    const r = collectDrop(inv, { gold: 12, items: [extra] });
    expect(inv.gold).toBe(12);
    expect(r.picked).toHaveLength(0);
    expect(r.left).toEqual([extra]);
  });
});

describe("drain and rest", () => {
  it("drain lowers maximum hit points, never to zero, and rest gives them back", () => {
    const s = { hp: 20, maxHp: 20, drained: 0 };
    expect(applyDrain(s, 3)).toBe(3);
    expect(s).toEqual({ hp: 17, maxHp: 17, drained: 3 });
    expect(applyDrain(s, 500)).toBe(16);
    expect(s.maxHp).toBe(1);
    expect(s.hp).toBe(1);
    expect(restoreDrain(s)).toBe(19);
    expect(s.maxHp).toBe(20);
    expect(s.drained).toBe(0);
  });

  it("a long rest with a ration restores everything and memorizes spells again", () => {
    const book = Spellbook.create("wizard", 2);
    book.fillDefault();
    const spell = selectHotkeySpells(book)[0];
    book.cast(spell.key);
    const s = { hp: 4, maxHp: 10, drained: 3 };
    const r = applyRest(s, book, "long", true);
    expect(s.maxHp).toBe(13);
    expect(s.hp).toBe(13);
    expect(r.drainRestored).toBe(3);
    expect(r.ateRation).toBe(true);
    expect(r.spellsRestored).toBe(true);
    expect(book.canCast(spell.key)).toBe(true);
  });

  it("without a ration you wake hungry and mend only half; a short rest binds wounds and nothing more", () => {
    const book = Spellbook.create("cleric", 1);
    book.fillDefault();
    const spell = selectHotkeySpells(book)[0];
    book.cast(spell.key);

    const hungry = { hp: 2, maxHp: 12, drained: 0 };
    const r = applyRest(hungry, book, "long", false);
    expect(r.hungry).toBe(true);
    expect(hungry.hp).toBe(7);

    book.cast(spell.key);
    const short = { hp: 2, maxHp: 12, drained: 2 };
    const s = applyRest(short, book, "short", true);
    expect(short.hp).toBe(7);
    expect(short.drained).toBe(2);
    expect(s.spellsRestored).toBe(false);
    expect(book.canCast(spell.key)).toBe(false);
  });

  it("wandering monsters arrive on the percent roll", () => {
    expect(wanderingMonsterArrives("long", fixed(0.0))).toBe(true);
    expect(wanderingMonsterArrives("long", fixed(0.99))).toBe(false);
    expect(wanderingMonsterArrives("short", fixed(0.12))).toBe(false);
  });
});
