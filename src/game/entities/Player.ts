import * as Phaser from "phaser";
import {
  TILE_SIZE,
  PLAYER_STATS,
  ClassKey,
  CHARACTER_CLASSES,
  SpellKey,
  StatusEffect,
  abilityMod,
  goodSave,
  poorSave,
  calcBAB,
} from "../constants";

export interface CharCreationData {
  classKey: ClassKey;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface PlayerStats {
  classKey: ClassKey;
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
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  public stats!: PlayerStats;
  private attackCooldown = 0;
  private invincible = 0;
  private attackIndicator!: Phaser.GameObjects.Rectangle;
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

    // Attack direction indicator
    this.attackIndicator = scene.add.rectangle(x, y, 8, 8, 0xffffff, 0.3);
    this.attackIndicator.setDepth(5);

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

    this.setDepth(10);
    // No tint — avatars are drawn with real class colours
  }

  private _buildStats(data: CharCreationData): PlayerStats {
    const classDef = CHARACTER_CLASSES[data.classKey];
    const conMod = abilityMod(data.con);
    const dexMod = abilityMod(data.dex);
    const strMod = abilityMod(data.str);
    const intMod = abilityMod(data.int);
    const wisMod = abilityMod(data.wis);

    const bab = calcBAB(1, classDef.babFormula);
    const weaponBonus = classDef.baseAttackBonus;
    const armorBonus = classDef.baseArmorBonus;
    const maxHp = classDef.baseHp + conMod * 6;
    const maxMana = classDef.startingMana + Math.max(0,
      data.classKey === 'wizard' ? intMod * 5 : data.classKey === 'cleric' ? wisMod * 4 : 0
    );

    return {
      classKey: data.classKey,
      level: 1,
      xp: 0,
      xpToNext: PLAYER_STATS.XP_PER_LEVEL,
      str: data.str, dex: data.dex, con: data.con,
      int: data.int, wis: data.wis, cha: data.cha,
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      bab,
      attack: bab + strMod + weaponBonus,
      defense: 10 + dexMod + armorBonus,
      fortSave: classDef.fortGood ? goodSave(1, conMod) : poorSave(1, conMod),
      reflexSave: classDef.refGood ? goodSave(1, dexMod) : poorSave(1, dexMod),
      willSave: classDef.willGood ? goodSave(1, wisMod) : poorSave(1, wisMod),
      searchBonus: intMod + (data.classKey === 'thief' ? 0 : 0),
      disableBonus: dexMod + (data.classKey === 'thief' ? 1 : 0),
      weaponBonus,
      armorBonus,
      speed: PLAYER_STATS.BASE_SPEED,
      gold: 0,
      floor: 1,
      facing: { x: 0, y: 1 },
      effects: [],
      cleaveReady: false,
      arcaneRecoveryTimer: 0,
      smiteBonus: 0,
      sneakBonusDice: Math.floor(1 / 2),
      potions: 1,      // start with 1 health potion
      manaPotions: 0,
    };
  }

  recomputeDerived() {
    const s = this.stats;
    const classDef = CHARACTER_CLASSES[s.classKey];
    const conMod = abilityMod(s.con);
    const dexMod = abilityMod(s.dex);
    const strMod = abilityMod(s.str);
    const intMod = abilityMod(s.int);
    const wisMod = abilityMod(s.wis);

    s.bab = calcBAB(s.level, classDef.babFormula);
    s.attack = s.bab + strMod + s.weaponBonus;
    s.defense = 10 + dexMod + s.armorBonus;

    // Apply BLESSED bonus
    if (s.effects.some(e => e.key === 'BLESSED')) {
      s.attack += 2;
    }
    // Apply SHIELDED bonus
    if (s.effects.some(e => e.key === 'SHIELDED')) {
      s.defense += 10;
    }

    s.fortSave = classDef.fortGood ? goodSave(s.level, conMod) : poorSave(s.level, conMod);
    s.reflexSave = classDef.refGood ? goodSave(s.level, dexMod) : poorSave(s.level, dexMod);
    s.willSave = classDef.willGood ? goodSave(s.level, wisMod) : poorSave(s.level, wisMod);
    s.searchBonus = intMod + (s.classKey === 'thief' ? Math.floor(s.level / 2) : 0);
    s.disableBonus = dexMod + (s.classKey === 'thief' ? s.level : 0);
    s.sneakBonusDice = Math.floor(s.level / 2);

    // Mana max scales with level
    if (s.classKey === 'wizard' || s.classKey === 'cleric') {
      const bonusMod = s.classKey === 'wizard' ? intMod : wisMod;
      const baseMana = classDef.startingMana + (s.level - 1) * classDef.manaPerLevel;
      s.maxMana = baseMana + Math.max(0, bonusMod * 5);
    }
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

    // Arcane Recovery mana regen (Wizard)
    if (this.stats.classKey === 'wizard') {
      this.stats.arcaneRecoveryTimer += delta;
      if (this.stats.arcaneRecoveryTimer >= 5000 && this.stats.mana < this.stats.maxMana) {
        this.stats.mana = Math.min(this.stats.maxMana, this.stats.mana + (2 * delta / 1000));
      }
    }

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

  private handleMovement() {
    const body = this.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1;

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
    let spd = this.stats.speed;
    if (this.stats.effects.some(e => e.key === 'SLOWED')) spd *= 0.5;
    return spd;
  }

  private updateAttackIndicator() {
    const dist = TILE_SIZE;
    this.attackIndicator.setPosition(
      this.x + this.stats.facing.x * dist,
      this.y + this.stats.facing.y * dist
    );
    this.attackIndicator.setAlpha(this.attackCooldown > 0 ? 0.1 : 0.4);
  }

  canAttack(): boolean {
    return this.attackCooldown <= 0 && this.stats.hp > 0;
  }

  tryAttack(): boolean {
    if (!this.canAttack()) return false;
    if (
      !Phaser.Input.Keyboard.JustDown(this.attackKey) &&
      !this.scene.input.mousePointer.isDown
    ) return false;

    this.attackCooldown = PLAYER_STATS.ATTACK_COOLDOWN;
    this.setTint(0xffffff); // brief white flash
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.clearTint();
    });
    return true;
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

  getAttackDamage(isSneakAttack = false): number {
    let dmg = this.stats.attack;
    // Sneak attack for Thief
    if (isSneakAttack && this.stats.classKey === 'thief') {
      for (let i = 0; i < this.stats.sneakBonusDice; i++) {
        dmg += Math.floor(Math.random() * 6) + 1;
      }
    }
    // Smite bonus (Cleric)
    if (this.stats.smiteBonus > 0) {
      dmg += this.stats.smiteBonus;
      this.stats.smiteBonus = 0;
    }
    return dmg;
  }

  takeDamage(amount: number, bypassArmor = false) {
    if (this.invincible > 0 || this.stats.hp <= 0) return;

    let dmg: number;
    if (bypassArmor) {
      dmg = Math.max(1, amount);
    } else {
      dmg = Math.max(1, amount - (this.stats.defense - 10));
    }

    this.stats.hp = Math.max(0, this.stats.hp - dmg);
    this.invincible = 600;

    // Arcane recovery timer reset
    this.stats.arcaneRecoveryTimer = 0;

    this.setTint(0xff4444);
    this.scene.time.delayedCall(150, () => {
      if (this.active) this.clearTint();
    });

    this.onDamage?.(dmg);

    if (this.stats.hp <= 0) {
      this.onDead?.();
    }
  }

  heal(amount: number) {
    const healed = Math.min(amount, this.stats.maxHp - this.stats.hp);
    this.stats.hp += healed;
    this.onHeal?.(healed);
  }

  spendMana(amount: number): boolean {
    if (this.stats.mana < amount) return false;
    this.stats.mana -= amount;
    return true;
  }

  restoreMana(amount: number) {
    this.stats.mana = Math.min(this.stats.maxMana, this.stats.mana + amount);
  }

  gainXP(amount: number) {
    this.stats.xp += amount;
    this.onXP?.(amount, this.stats.xp);

    while (this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level++;
      this.stats.xpToNext = Math.floor(PLAYER_STATS.XP_PER_LEVEL * Math.pow(1.3, this.stats.level - 1));

      const classDef = CHARACTER_CLASSES[this.stats.classKey];
      const conMod = abilityMod(this.stats.con);

      // HP gain on level up: average hit die + CON mod, scaled
      const hpGain = Math.floor(classDef.hitDie * 0.5 + 1) * 3 + conMod * 2;
      this.stats.maxHp += Math.max(1, hpGain);
      this.stats.hp = Math.min(this.stats.hp + Math.floor(hpGain / 2), this.stats.maxHp);

      this.recomputeDerived();
      // Restore partial mana on level up
      if (this.stats.maxMana > 0) {
        this.stats.mana = Math.min(this.stats.maxMana, this.stats.mana + classDef.manaPerLevel);
      }

      this.onLevelUp?.(this.stats.level);
    }
  }

  getSerializable(): PlayerStats {
    return { ...this.stats };
  }

  destroy(fromScene?: boolean) {
    this.attackIndicator?.destroy();
    super.destroy(fromScene);
  }
}
