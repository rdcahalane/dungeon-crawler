import * as Phaser from "phaser";
import {
  TILE_SIZE,
  PLAYER_STATS,
  ClassKey,
  CHARACTER_CLASSES,
  SpellKey,
  StatusEffect,
  ArmorTrait,
  WeaponTrait,
  abilityMod,
} from "../constants";
import { Inventory, starterKit, fromLegacyInventory, equipmentBonuses, getDef } from "../items";
import {
  Spellbook, isCaster, mathRng, mulberry32, titleFor, thac0For, xpForLevel, MAX_LEVEL, xpBonusPercent,
  abilityModifiers, intelligenceEffect, spellsFor,
} from "../rules";
import type { SpellbookData, SaveCategory, SaveResult } from "../rules";
import {
  playerArmorClass, playerSave, saveTargets, legacySaveBonus, startingHp, levelUpHp, convertedHp,
  playerToHitBonus, BASE_SWING_MS, PLAYER_HIT_GRACE_MS, applyDrain, restoreDrain,
  type PlayerSheet,
} from "../scenes/game/AdndCombat";

export interface CharCreationData {
  classKey: ClassKey;
  name?: string;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface PlayerStats {
  classKey: ClassKey;
  name?: string;
  level: number;
  xp: number;
  xpToNext: number;
  // Ability scores
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  // Derived combat stats
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  bab: number;
  attack: number;       // total melee attack bonus
  defense: number;      // AC (10 + DEX mod + armor bonus)
  fortSave: number;
  reflexSave: number;
  willSave: number;
  searchBonus: number;  // INT mod (Thief adds +level/2)
  disableBonus: number; // DEX mod (Thief adds +level)
  // Equipment bonuses
  weaponBonus: number;
  armorBonus: number;
  weaponTrait?: WeaponTrait;
  armorTrait?: ArmorTrait;
  // Misc
  speed: number;
  gold: number;
  floor: number;
  facing: { x: number; y: number };
  effects: StatusEffect[];
  // Class ability flags
  cleaveReady: boolean;       // Fighter
  arcaneRecoveryTimer: number; // Wizard: ms since last hit
  smiteBonus: number;          // Cleric: bonus damage on next attack
  sneakBonusDice: number;      // Thief: number of d6 for sneak attack
  // Consumables
  potions: number;     // health potions (F key in dungeon)
  manaPotions: number; // mana potions (M key in dungeon)
  // Save metadata
  saveSlot?: number;
  savedDungeons?: Record<number, import("../systems/DungeonGenerator").SerializedFloor>;
  // Quest & inventory (all optional for backwards compat)
  activeQuests?: import("../systems/QuestSystem").Quest[];
  completedQuests?: import("../systems/QuestSystem").Quest[];      // capped at 50
  questBoardSeed?: number;
  questBoardGeneratedAt?: number;
  inventory?: import("../systems/QuestSystem").InventoryItem[];    // capped at 100
	  equippedWeaponLabel?: string;
	  equippedArmorLabel?: string;
  relics?: string[];
  runGoldEarned?: number;
  runBestStreak?: number;
  runDeepestFloor?: number;
  // ── B1 plumbing: serializable, all optional so old saves load. Nothing consumes these yet. ──
  /** Full inventory (pack, belt, equipment, gold) from `src/game/items`. */
  inv?: ReturnType<Inventory['toJSON']>;
  /** Memorized spell state for casters (`src/game/rules/spells.ts`). */
  spellbook?: SpellbookData;
  /** Seconds of light left in the held torch. */
  torchSecondsLeft?: number;
  // ── B2: first-edition numbers. Optional so old saves load; `recomputeDerived` fills them. ──
  /** Hit points before equipment (`maxHp` affixes) and drain. Absent on a pre first-edition save: converted at load. */
  baseMaxHp?: number;
  /** Maximum hit points lost to drain until the next long rest. */
  drained?: number;
  /** Player THAC0. */
  thac0?: number;
  /** Armor class, descending (10 is unarmored, lower is better). `defense` is the ascending twin (20 minus this). */
  ac?: number;
  /** d20 targets for the five saves, equipment and Wisdom already applied (lower is easier). */
  saves?: Record<SaveCategory, number>;
  /** Level title, "Recruit", "Cutpurse"... */
  title?: string;
  /** One-time hints already shown to this character (message log). */
  seenHints?: string[];
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  public stats!: PlayerStats;
  /** New-model inventory (items module). Built from `stats.inv`, else from the legacy list, else a starter kit. */
  public inventory!: Inventory;
  /** Spellbook for casters; null for fighters and thieves. Slots replace mana. */
  public spellbook: Spellbook | null = null;
  /** Light from a Light spell or scroll: radius in tiles and time left (ms). */
  public lightBoost: { radius: number; ms: number } = { radius: 0, ms: 0 };
  private _speedMult = 1;
  private _lightRadius = 1;
  private _lightTimer = 0;
  private _gutteredOut = false;
  private attackCooldown = 0;
  private invincible = 0;
  private attackIndicator!: Phaser.GameObjects.Rectangle;
  private playerShadow!: Phaser.GameObjects.Ellipse;  // floor shadow anchors character
  private playerAura!: Phaser.GameObjects.Arc;         // class-coloured halo above torch
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private attackKey!: Phaser.Input.Keyboard.Key;
  private turnUndeadKey!: Phaser.Input.Keyboard.Key;
  private spellKeys: Record<SpellKey, Phaser.Input.Keyboard.Key | null> = {} as Record<SpellKey, Phaser.Input.Keyboard.Key | null>;

  private onDamage?: (dmg: number) => void;
  private onHeal?: (amount: number) => void;
  private onDead?: () => void;
  private onXP?: (gained: number, total: number) => void;
  private onLevelUp?: (level: number) => void;
  private onSpellCast?: (key: SpellKey) => void;
  private onTurnUndead?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, charData?: CharCreationData, persistedStats?: PlayerStats) {
    // Use class-specific texture key if available, fallback to 'player'
    const textureKey = charData
      ? `player_${charData.classKey}`
      : persistedStats
        ? `player_${persistedStats.classKey}`
        : 'player';
    super(scene, x, y, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDisplaySize(TILE_SIZE + 4, TILE_SIZE + 4);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(TILE_SIZE - 20, TILE_SIZE - 20);
    body.setCollideWorldBounds(true);

    if (persistedStats) {
      this.stats = persistedStats;
      // Restore HP to at least 1
      if (this.stats.hp <= 0) this.stats.hp = 1;
    } else if (charData) {
      this.stats = this._buildStats(charData);
    } else {
      // Fallback: default fighter
      this.stats = this._buildStats({ classKey: 'fighter', str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 8 });
    }

    this._initInventoryAndSpellbook(!!persistedStats);
    this.recomputeDerived();
    if (!persistedStats) this.stats.hp = this.stats.maxHp;

    // Floor shadow — dark oval just below the player, depth below torch glow
    // makes character look grounded and separates them from floor texture
    this.playerShadow = scene.add.ellipse(x, y + 9, TILE_SIZE - 8, 7, 0x000000, 0.5);
    this.playerShadow.setDepth(9);

    // Class-coloured aura — rendered at depth 48.5 (above torch at 47/48, below player sprite at 49)
    // ADD blend adds the class colour as a halo to the floor under the sprite's feet.
    // Since it renders BEFORE the player sprite (lower depth), it doesn't tint the sprite.
    const classColor = CHARACTER_CLASSES[this.stats.classKey].color;
    this.playerAura = scene.add.arc(x, y, TILE_SIZE * 0.65, 0, 360, false, classColor, 0.28);
    this.playerAura.setBlendMode(Phaser.BlendModes.ADD).setDepth(48.5);

    // Attack direction indicator — just above player sprite, below fog
    this.attackIndicator = scene.add.rectangle(x, y, 8, 8, 0xffffff, 0.35);
    this.attackIndicator.setDepth(49.5);

    // Input
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.attackKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.turnUndeadKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T);

    // Spell hotkeys Q/W/E/R
    const classDef = CHARACTER_CLASSES[this.stats.classKey];
    const hotkeyMap: Record<string, number> = {
      'Q': Phaser.Input.Keyboard.KeyCodes.Q,
      'W': Phaser.Input.Keyboard.KeyCodes.W,
      'E': Phaser.Input.Keyboard.KeyCodes.E,
      'R': Phaser.Input.Keyboard.KeyCodes.R,
    };
    for (const spellKey of classDef.spellKeys) {
      // We'll map Q/W/E/R by index
      this.spellKeys[spellKey] = null; // will be set up in scene
    }
    void hotkeyMap; // suppress unused warning — spell hotkeys handled in GameScene

    // Depth 49 = player sprite.
    // Torch glow: 47/48 (ADD blend washes out everything below it)
    // Player sprite: 49 — renders AFTER torch, so torch ADD blend doesn't affect it.
    //   The player sprite appears clean with true colours.
    // Fog RenderTexture: 50 (erased around player, so player is visible in explored areas
    //   and hidden by opaque fog in unexplored areas — correct roguelike fog behaviour).
    this.setDepth(49);
    // No tint — avatars are drawn with real class colours
  }

  private _initInventoryAndSpellbook(existingCharacter: boolean) {
    const stats = this.stats;
    const brandNew = !stats.inv && !existingCharacter;
    if (stats.inv) {
      this.inventory = Inventory.fromJSON(stats.inv);
    } else if (existingCharacter) {
      this.inventory = fromLegacyInventory(stats.inventory ?? [], stats).inventory;
    } else {
      this.inventory = starterKit(stats.classKey);
    }
    // `stats.gold` is the gold the tavern, the HUD and the game-over screen already read; the inventory mirrors it.
    if (brandNew) stats.gold = this.inventory.gold;
    else this.inventory.gold = stats.gold;

    // `stats.potions` and `manaPotions` are read-only mirrors now (recomputeDerived refreshes them from the pack). A save
    // from before the item system has its bare counters converted into real potions by `fromLegacyInventory` above.

    // A save from before the first-edition scale keeps its character but gets first-edition hit points.
    if (stats.baseMaxHp === undefined) {
      const ratio = stats.maxHp > 0 ? Math.max(0, Math.min(1, stats.hp / stats.maxHp)) : 1;
      const rng = mulberry32(hashString(`${stats.name ?? ''}${stats.classKey}${stats.con}`));
      stats.baseMaxHp = convertedHp(stats.classKey, stats.level, stats.con, rng);
      stats.drained = 0;
      stats.maxHp = stats.baseMaxHp;
      stats.hp = brandNew ? stats.maxHp : Math.max(1, Math.round(stats.maxHp * ratio));
    }
    stats.drained = stats.drained ?? 0;

    this.spellbook = null;
    if (isCaster(stats.classKey)) {
      if (stats.spellbook) {
        try {
          this.spellbook = Spellbook.deserialize(stats.spellbook);
        } catch {
          this.spellbook = null; // fall through to a fresh book
        }
      }
      if (!this.spellbook) {
        this.spellbook = Spellbook.create(stats.classKey, stats.level);
        this.scribeWizardSpells();
        this.spellbook.fillDefault();
      }
    }
  }

  /** Wizards have no spell-learning screen yet: they write every spell they have slots for into the book. */
  private scribeWizardSpells() {
    const book = this.spellbook;
    if (!book || this.stats.classKey !== 'wizard') return;
    const maxLevel = Math.min(4, intelligenceEffect(this.stats.int).maxSpellLevel);
    for (let lv = 1; lv <= maxLevel; lv++) {
      if (book.maxSlots(lv) <= 0) continue;
      for (const sp of spellsFor('wizard', lv)) book.learn(sp.key);
    }
  }

  private _buildStats(data: CharCreationData): PlayerStats {
    const maxHp = startingHp(data.classKey, data.con);
    return {
      classKey: data.classKey,
      name: data.name,
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(data.classKey, 2),
      str: data.str, dex: data.dex, con: data.con,
      int: data.int, wis: data.wis, cha: data.cha,
      hp: maxHp,
      maxHp,
      baseMaxHp: maxHp,
      drained: 0,
      // Mana is gone (spell slots replace it); the fields stay at zero so untouched HUD code does not crash.
      mana: 0,
      maxMana: 0,
      bab: 0,
      attack: 0,
      defense: 10,
      fortSave: 0,
      reflexSave: 0,
      willSave: 0,
      searchBonus: abilityMod(data.int),
      disableBonus: abilityMod(data.dex),
      weaponBonus: 0,
      armorBonus: 0,
      speed: PLAYER_STATS.BASE_SPEED,
      gold: 0,
      floor: 1,
      facing: { x: 0, y: 1 },
      effects: [],
      cleaveReady: false,
      arcaneRecoveryTimer: 0,
      smiteBonus: 0,
      sneakBonusDice: 0,
      potions: 0,
      manaPotions: 0,
    };
  }

  /** The player as plain data for the combat math. */
  sheet(): PlayerSheet {
    const s = this.stats;
    const bless = s.effects.find(e => e.key === 'BLESSED');
    const shield = s.effects.find(e => e.key === 'SHIELDED');
    return {
      classKey: s.classKey,
      level: s.level,
      scores: { str: s.str, dex: s.dex, con: s.con, int: s.int, wis: s.wis, cha: s.cha },
      inventory: this.inventory,
      // Legacy `weaponBonus` / `armorBonus` are now the permanent boon points, capped so an old save cannot break the d20.
      boonToHit: Math.max(0, Math.min(3, s.weaponBonus)),
      boonDamage: Math.max(0, Math.min(3, s.weaponBonus)),
      boonAc: Math.max(0, Math.min(3, s.armorBonus)),
      blessToHit: bless ? (bless.value ?? 1) : 0,
      buffAc: shield ? (shield.value ?? 2) : 0,
    };
  }

  /** Saving throw by the five first-edition categories. Other lanes call this instead of rolling d20 themselves. */
  rollSave(category: SaveCategory, modifier = 0): SaveResult {
    return playerSave(this.sheet(), category, modifier, mathRng);
  }

  /** Refresh every derived number after anything changed: level, gear, buffs, ability scores. */
  recomputeDerived() {
    const s = this.stats;
    const inv = this.inventory;
    if (!inv) return;
    const sheet = this.sheet();
    const eq = equipmentBonuses(inv);
    const scores = sheet.scores;
    const mods = abilityModifiers(scores, s.classKey);

    s.thac0 = thac0For(s.classKey, s.level);
    s.bab = 20 - s.thac0;
    s.attack = s.bab + playerToHitBonus(sheet, 'melee');
    s.ac = playerArmorClass(sheet);
    s.defense = 20 - s.ac;
    s.saves = saveTargets(sheet);
    // Old trap code still rolls d20 + save vs a DC, so keep the three legacy numbers populated and sensible.
    s.fortSave = legacySaveBonus(s.saves.death);
    s.reflexSave = legacySaveBonus(s.saves.breath);
    s.willSave = legacySaveBonus(s.saves.spells);
    s.searchBonus = abilityMod(s.int) + (s.classKey === 'thief' ? Math.floor(s.level / 2) : 0);
    s.disableBonus = abilityMod(s.dex) + (s.classKey === 'thief' ? s.level : 0);
    s.sneakBonusDice = 0;
    s.title = titleFor(s.classKey, s.level);
    // The old trait system is gone: equipment effects come only from `equipmentBonuses`.
    s.weaponTrait = undefined;
    s.armorTrait = undefined;

    // Hit points: the base grows with levels, gear adds, drain subtracts.
    s.drained = s.drained ?? 0;
    const base = s.baseMaxHp ?? s.maxHp;
    s.maxHp = Math.max(1, base + eq.maxHp - s.drained);
    if (s.hp > s.maxHp) s.hp = s.maxHp;

    // Experience: `xp` is progress inside the level, `xpToNext` the width of the level.
    s.xpToNext = s.level >= MAX_LEVEL
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, xpForLevel(s.classKey, s.level + 1) - xpForLevel(s.classKey, s.level));

    // No mana any more. Legacy potion counter mirrors the healing potions actually carried.
    s.mana = 0;
    s.maxMana = 0;
    s.manaPotions = 0;
    s.potions = inv.count('healing_potion');
    inv.gold = s.gold;

    // Spell slots: level, Wisdom (clerics) and gear.
    if (this.spellbook) {
      const bonus = [0, 0, 0, 0].map((_, i) => (mods.bonusSlots[i] ?? 0) + (eq.extraSlots[i + 1] ?? 0));
      const cur = this.spellbook.serialize();
      if (cur.level !== s.level || cur.bonusSlots.join() !== bonus.join()) {
        this.spellbook.setLevel(s.level, bonus);
        this.scribeWizardSpells();
        this.spellbook.fillDefault();
      }
    }

    // Speed and light.
    const enc = inv.encumbrance(s.str);
    this._speedMult = enc.speedMult * (1 + eq.speedPct / 100);
    this._lightRadius = Math.max(eq.lightRadius, this.lightBoost.ms > 0 ? this.lightBoost.radius : 0);
  }

  /** Sight radius in tiles: the held light (plus affixes), a light spell, else one tile of darkness. */
  lightRadiusTiles(): number {
    return Math.max(1, this._lightRadius);
  }

  /** Is anything actually lit? */
  hasLight(): boolean {
    return this._lightRadius > 0;
  }

  /**
   * Make sure a light is burning: if the offhand holds no lit light and the pack has a torch (or lantern with oil),
   * hold it. Returns what happened so the caller can speak.
   */
  ensureLight(): 'lit' | 'equipped' | 'none' {
    const inv = this.inventory;
    const lit = (it: { defKey: string; charges?: number } | undefined) =>
      !!it && !!getDef(it.defKey).light && (it.charges ?? 1) > 0;
    if (lit(inv.equipment.offhand)) return 'lit';
    const spare = inv.pack.find(it => !!it && lit(it) && getDef(it.defKey).slot === 'offhand');
    if (!spare) return 'none';
    const r = inv.equip(spare.id, 'offhand');
    if (!r.ok) return 'none';
    this.recomputeDerived();
    return 'equipped';
  }

  /** Burn the held light, return true the moment it dies. Called once a frame by the combat controller. */
  burnLight(deltaMs: number): { burntOut: boolean } {
    const r = this.inventory.burn(deltaMs / 1000);
    this._lightTimer += deltaMs;
    if (this.lightBoost.ms > 0) {
      this.lightBoost.ms = Math.max(0, this.lightBoost.ms - deltaMs);
      if (this.lightBoost.ms === 0) { this.lightBoost.radius = 0; this._lightTimer = 1000; }
    }
    if (r.burntOut || this._lightTimer >= 1000) {
      this._lightTimer = 0;
      const had = this._lightRadius;
      this.recomputeDerived();
      if (r.burntOut || (had > 0 && this._lightRadius === 0)) return { burntOut: true };
    }
    return { burntOut: false };
  }

  /** Drain: lose maximum hit points until a long rest. Returns the points actually lost. */
  drainMaxHp(amount: number): number {
    const state = { hp: this.stats.hp, maxHp: this.stats.maxHp, drained: this.stats.drained ?? 0 };
    const lost = applyDrain(state, amount);
    this.stats.hp = state.hp;
    this.stats.drained = state.drained;
    this.recomputeDerived();
    return lost;
  }

  /** Give back everything drain took. */
  restoreDrained(): number {
    const state = { hp: this.stats.hp, maxHp: this.stats.maxHp, drained: this.stats.drained ?? 0 };
    const back = restoreDrain(state);
    this.stats.drained = 0;
    this.recomputeDerived();
    return back;
  }

  removeEffect(key: StatusEffect['key']) {
    const had = this.stats.effects.some(e => e.key === key);
    this.stats.effects = this.stats.effects.filter(e => e.key !== key);
    if (had) this.recomputeDerived();
  }

  hasEffect(key: StatusEffect['key']): boolean {
    return this.stats.effects.some(e => e.key === key);
  }

  setCallbacks(callbacks: {
    onDamage?: (dmg: number) => void;
    onHeal?: (amount: number) => void;
    onDead?: () => void;
    onXP?: (gained: number, total: number) => void;
    onLevelUp?: (level: number) => void;
    onSpellCast?: (key: SpellKey) => void;
    onTurnUndead?: () => void;
  }) {
    this.onDamage = callbacks.onDamage;
    this.onHeal = callbacks.onHeal;
    this.onDead = callbacks.onDead;
    this.onXP = callbacks.onXP;
    this.onLevelUp = callbacks.onLevelUp;
    this.onSpellCast = callbacks.onSpellCast;
    this.onTurnUndead = callbacks.onTurnUndead;
  }

  update(delta: number) {
    if (this.stats.hp <= 0) return;

    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.invincible = Math.max(0, this.invincible - delta);

    this.tickEffects(delta);
    this.handleMovement();
    this.updateAttackIndicator();
  }

  private tickEffects(delta: number) {
    const s = this.stats;
    let needsRecompute = false;

    for (let i = s.effects.length - 1; i >= 0; i--) {
      const eff = s.effects[i];
      eff.duration -= delta;

      if (eff.key === 'POISONED' && eff.value) {
        // Deal poison damage every second
        const poisonDmg = (eff.value * delta) / 1000;
        s.hp = Math.max(0, s.hp - poisonDmg);
        if (s.hp <= 0) {
          this.onDead?.();
          return;
        }
      }

      if (eff.duration <= 0) {
        // Effect expired — may need to recompute (BLESSED/SHIELDED change stats)
        if (eff.key === 'BLESSED' || eff.key === 'SHIELDED') {
          needsRecompute = true;
        }
        s.effects.splice(i, 1);
      }
    }

    if (needsRecompute) this.recomputeDerived();
  }

  addEffect(key: StatusEffect['key'], duration: number, value?: number) {
    // Remove existing same effect
    this.stats.effects = this.stats.effects.filter(e => e.key !== key);
    this.stats.effects.push({ key, duration, value });

    // Immediate stat changes for buffs
    if (key === 'BLESSED' || key === 'SHIELDED') {
      this.recomputeDerived();
    }
  }

  /** Set by InputController each frame: direction to walk when no movement key is held (any length; null = none). */
  public moveIntent: { x: number; y: number } | null = null;
  /** Set true by InputController to swing once as soon as the cooldown allows; cleared when the swing starts. */
  public attackRequested = false;
  /** Old behavior: any mouse press swings. InputController turns this off when it takes over the mouse. */
  public legacyMouseAttack = true;

  private handleMovement() {
    const body = this.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1;

    // No keys held: follow the input controller's intent (click-to-move).
    if (vx === 0 && vy === 0 && this.moveIntent) {
      vx = this.moveIntent.x;
      vy = this.moveIntent.y;
    }

    // Held (ghoul touch, Hold Person): rooted to the spot.
    if (this.stats.effects.some(e => e.key === 'HELD')) {
      body.setVelocity(0, 0);
      return;
    }

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      const spd = this.getEffectiveSpeed();
      vx = (vx / len) * spd;
      vy = (vy / len) * spd;
      this.stats.facing = { x: vx > 0 ? 1 : vx < 0 ? -1 : 0, y: vy > 0 ? 1 : vy < 0 ? -1 : 0 };
    }

    body.setVelocity(vx, vy);
  }

  private getEffectiveSpeed(): number {
    let spd = this.stats.speed * this._speedMult;
    if (this.stats.effects.some(e => e.key === 'SLOWED')) spd *= 0.5;
    const rushed = this.stats.effects.find(e => e.key === 'RUSHED');
    if (rushed) spd *= rushed.value && rushed.value > 1 ? rushed.value : 1.25;
    return spd;
  }

  private updateAttackIndicator() {
    const dist = TILE_SIZE;
    this.attackIndicator.setPosition(
      this.x + this.stats.facing.x * dist,
      this.y + this.stats.facing.y * dist
    );
    this.attackIndicator.setAlpha(this.attackCooldown > 0 ? 0.1 : 0.4);

    // Keep shadow and aura centred on player
    this.playerShadow.setPosition(this.x, this.y + 9);
    this.playerAura.setPosition(this.x, this.y);
  }

  canAttack(): boolean {
    return this.attackCooldown <= 0 && this.stats.hp > 0 && !this.stats.effects.some(e => e.key === 'HELD');
  }

  tryAttack(): boolean {
    if (!this.canAttack()) return false;
    const wanted =
      Phaser.Input.Keyboard.JustDown(this.attackKey) ||
      this.attackRequested ||
      (this.legacyMouseAttack && this.scene.input.mousePointer.isDown);
    if (!wanted) return false;
    this.attackRequested = false;

    this.attackCooldown = BASE_SWING_MS;
    this.setTint(0xffffff); // brief white flash
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.clearTint();
    });
    return true;
  }

  /** Lengthen the current swing cooldown (the wizard's dart is slower than a dagger). */
  setAttackCooldown(ms: number) {
    this.attackCooldown = Math.max(this.attackCooldown, ms);
  }

  tryTurnUndead(): boolean {
    if (this.stats.classKey !== 'cleric') return false;
    if (!Phaser.Input.Keyboard.JustDown(this.turnUndeadKey)) return false;
    this.onTurnUndead?.();
    return true;
  }

  getAttackBox(): Phaser.Geom.Rectangle {
    const range = PLAYER_STATS.ATTACK_RANGE;
    const fx = this.stats.facing.x;
    const fy = this.stats.facing.y;
    return new Phaser.Geom.Rectangle(
      this.x + fx * (range / 2) - range / 2,
      this.y + fy * (range / 2) - range / 2,
      range,
      range
    );
  }

  /**
   * Apply damage that already passed its to-hit roll. Armor works through AC before this point, so it no longer
   * subtracts here; `bypassArmor` is kept for old callers (traps) and means nothing now.
   */
  takeDamage(amount: number, bypassArmor = false) {
    void bypassArmor;
    if (this.invincible > 0 || this.stats.hp <= 0) return;

    const dmg = Math.max(1, Math.round(amount));
    this.stats.hp = Math.max(0, this.stats.hp - dmg);
    this.invincible = PLAYER_HIT_GRACE_MS;

    this.setTint(0xff4444);
    this.scene.time.delayedCall(150, () => {
      if (this.active) this.clearTint();
    });

    this.onDamage?.(dmg);

    if (this.stats.hp <= 0) {
      this.onDead?.();
    }
  }

  /** Kept so old callers compile; the armor ward trait no longer exists. */
  refreshArmorWard() {}

  heal(amount: number) {
    const healed = Math.max(0, Math.min(amount, this.stats.maxHp - this.stats.hp));
    this.stats.hp += healed;
    this.onHeal?.(healed);
  }

  /** Mana is gone; these stay as no-ops so untouched code keeps compiling. */
  spendMana(amount: number): boolean {
    void amount;
    return false;
  }

  restoreMana(amount: number) {
    void amount;
  }

  gainXP(amount: number) {
    const bonus = xpBonusPercent(this.stats.classKey, {
      str: this.stats.str, dex: this.stats.dex, con: this.stats.con,
      int: this.stats.int, wis: this.stats.wis, cha: this.stats.cha,
    });
    const gained = Math.max(0, Math.round(amount * (1 + bonus / 100)));
    this.stats.xp += gained;
    this.onXP?.(gained, this.stats.xp);

    while (this.stats.level < MAX_LEVEL && this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level++;
      const gain = levelUpHp(this.stats.classKey, this.stats.level, this.stats.con, mathRng);
      this.stats.baseMaxHp = (this.stats.baseMaxHp ?? this.stats.maxHp) + gain;
      this.stats.hp += gain;
      this.recomputeDerived();
      this.stats.hp = Math.min(this.stats.hp, this.stats.maxHp);
      this.onLevelUp?.(this.stats.level);
    }
  }

  getSerializable(): PlayerStats {
    this.inventory.gold = this.stats.gold;
    const out: PlayerStats = { ...this.stats, inv: this.inventory.toJSON() };
    if (this.spellbook) out.spellbook = this.spellbook.serialize();
    return out;
  }

  destroy(fromScene?: boolean) {
    this.attackIndicator?.destroy();
    this.playerShadow?.destroy();
    this.playerAura?.destroy();
    super.destroy(fromScene);
  }
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
