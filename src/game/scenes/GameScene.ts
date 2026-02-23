import * as Phaser from "phaser";
import type { PlayerStats } from "../entities/Player";
import {
  TILE_SIZE, TILE, COLORS, MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS,
  CHARACTER_CLASSES, SpellKey, SPELLS,
  TRAP_TYPES, TrapTypeKey,
  ENEMY_TYPES, EnemyTypeKey,
  abilityMod, getFloorThemeIdx,
} from "../constants";
import { generateDungeon, DungeonData, SerializedFloor } from "../systems/DungeonGenerator";
import { Player, CharCreationData } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { TreasureChest } from "../entities/TreasureChest";
import { SpellSystem } from "../systems/SpellSystem";

interface FloatingText {
  obj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
}

type RestType = 'short' | 'long';

export class GameScene extends Phaser.Scene {
  private dungeon!: DungeonData;
  private _baseDungeon?: DungeonData; // original unmodified dungeon (for serialization)
  private player!: Player;
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private items: Phaser.GameObjects.Sprite[] = [];
  private chests: TreasureChest[] = [];
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private currentFloor = 1;
  private saveSlot = 1;
  private floatingTexts: FloatingText[] = [];
  private spellSystem!: SpellSystem;

  // ── Persistent state tracking ──────────────────────────────────────────────
  private deadEnemyIndices = new Set<number>();
  private triggeredTrapKeys = new Set<string>();
  private openedChestKeys = new Set<string>();
  private pickedItemKeys = new Set<string>();
  private revealedDoorKeys = new Set<string>();

  // ── Trap detection ─────────────────────────────────────────────────────────
  private detectedTraps = new Set<string>();
  private _trapOverlays = new Map<string, Phaser.GameObjects.Image>();

  // ── Secret door tracking ───────────────────────────────────────────────────
  private secretDoorSet = new Set<string>();
  private secretDoorSprites = new Map<string, Phaser.GameObjects.Image>();

  // ── Trap tile tracking ─────────────────────────────────────────────────────
  private trapMap = new Map<string, TrapTypeKey>();

  // ── Fog of war ─────────────────────────────────────────────────────────────
  private fogRT!: Phaser.GameObjects.RenderTexture;
  private fogBrushImg!: Phaser.GameObjects.Image;
  private fogState!: Uint8Array;
  private lastFogTile = { tx: -1, ty: -1 };

  // ── Torch glow ─────────────────────────────────────────────────────────────
  private torchInner!: Phaser.GameObjects.Image;
  private torchOuter!: Phaser.GameObjects.Image;

  // ── Spells ─────────────────────────────────────────────────────────────────
  private spellHotkeys: Phaser.Input.Keyboard.Key[] = [];
  private spellHotkeyMap: SpellKey[] = [];

  // ── Misc ───────────────────────────────────────────────────────────────────
  private kills = 0;
  private initData: {
    floor?: number;
    charData?: CharCreationData;
    persistedStats?: PlayerStats;
    saveSlot?: number;
  } = {};

  private enemyProjectiles: {
    obj: Phaser.GameObjects.Rectangle;
    vx: number; vy: number; dmg: number; life: number;
  }[] = [];

  // ── Rest dialog ────────────────────────────────────────────────────────────
  private _restDialogOpen = false;
  private _restDialogElements: Phaser.GameObjects.GameObject[] = [];

  // ── Extra keys ─────────────────────────────────────────────────────────────
  private _eKey?: Phaser.Input.Keyboard.Key;
  private _fKey?: Phaser.Input.Keyboard.Key;
  private _mKey?: Phaser.Input.Keyboard.Key;
  private _gKey?: Phaser.Input.Keyboard.Key;
  private _dKey?: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { floor?: number; charData?: CharCreationData; persistedStats?: PlayerStats; saveSlot?: number }) {
    this.currentFloor = data?.floor ?? 1;
    this.saveSlot = data?.saveSlot ?? data?.persistedStats?.saveSlot ?? 1;
    this.kills = 0;
    this.initData = data ?? {};

    // Clear session state
    this.secretDoorSet.clear();
    this.secretDoorSprites.clear();
    this.trapMap.clear();
    this.detectedTraps.clear();
    this._trapOverlays.forEach(o => o.destroy());
    this._trapOverlays.clear();
    this.enemyProjectiles = [];
    this._restDialogOpen = false;
    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];

    // Load per-floor persistent state if available
    const sf = data?.persistedStats?.savedDungeons?.[this.currentFloor];
    if (sf) {
      this.deadEnemyIndices = new Set(sf.deadEnemyIndices);
      this.triggeredTrapKeys = new Set(sf.triggeredTrapKeys);
      this.openedChestKeys = new Set(sf.openedChestKeys);
      this.pickedItemKeys = new Set(sf.pickedItemKeys);
      this.revealedDoorKeys = new Set(sf.revealedDoorKeys);
    } else {
      this.deadEnemyIndices = new Set();
      this.triggeredTrapKeys = new Set();
      this.openedChestKeys = new Set();
      this.pickedItemKeys = new Set();
      this.revealedDoorKeys = new Set();
    }
  }

  create() {
    const sf = this.initData.persistedStats?.savedDungeons?.[this.currentFloor];

    if (sf) {
      // Restore saved dungeon layout
      this._baseDungeon = sf.dungeonData;
      // Deep copy the base dungeon as our working copy, then apply saved changes
      this.dungeon = JSON.parse(JSON.stringify(sf.dungeonData)) as DungeonData;
      // Apply triggered traps → they become passable floor
      for (const key of this.triggeredTrapKeys) {
        const [tx, ty] = key.split(',').map(Number);
        if (this.dungeon.tiles[ty]?.[tx] !== undefined) {
          (this.dungeon.tiles[ty] as number[])[tx] = TILE.FLOOR;
        }
      }
      // Apply revealed secret doors → become passable floor
      for (const key of this.revealedDoorKeys) {
        const [tx, ty] = key.split(',').map(Number);
        if (this.dungeon.tiles[ty]?.[tx] !== undefined) {
          (this.dungeon.tiles[ty] as number[])[tx] = TILE.FLOOR;
        }
      }
    } else {
      // Generate a fresh dungeon for this floor
      this.dungeon = generateDungeon(this.currentFloor);
      // Store the original as base BEFORE any runtime modifications
      this._baseDungeon = JSON.parse(JSON.stringify(this.dungeon)) as DungeonData;
    }

    this.physics.world.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    this.buildTilemap();
    this.spawnPlayer();
    this.spawnTorchGlow();
    this.spawnEnemies();
    this.spawnItems();
    this.spawnChests();
    this.initFog();
    this.setupCamera();
    this.setupSpells();

    if (!this.scene.isActive("HUDScene")) {
      this.scene.launch("HUDScene");
    }
    this.emitHUD();
  }

  private get themeIdx(): number {
    return getFloorThemeIdx(this.currentFloor);
  }

  // ── Tilemap ───────────────────────────────────────────────────────────────

  private buildTilemap() {
    const { tiles } = this.dungeon;
    const ti = this.themeIdx;
    const floorKey = `floor_${ti}`;
    const wallKey = `wall_${ti}`;

    this.wallGroup = this.physics.add.staticGroup();

    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const t = tiles[ty][tx];
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        if (t === TILE.WALL) {
          this.add.image(wx, wy, wallKey).setDepth(1);
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true);
          this.wallGroup.add(rect);
        } else if (t === TILE.SECRET_DOOR) {
          // Still-secret door (revealed ones are FLOOR by now in working copy)
          const key = `${tx},${ty}`;
          const img = this.add.image(wx, wy, "secret_door").setDepth(1);
          this.secretDoorSprites.set(key, img);
          this.secretDoorSet.add(key);
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true);
          this.wallGroup.add(rect);
        } else if (t === TILE.STAIRS) {
          this.add.image(wx, wy, floorKey).setDepth(1);
          this.add.image(wx, wy, "stairs").setDepth(2);
        } else if (t === TILE.STAIRS_UP) {
          this.add.image(wx, wy, floorKey).setDepth(1);
          this.add.image(wx, wy, "stairs_up").setDepth(2);
        } else {
          // FLOOR and TRAP both render as floor (TRAP has no floor indicator until detected)
          this.add.image(wx, wy, floorKey).setDepth(1);
        }
      }
    }

    // Build trap map — exclude already-triggered traps
    for (const trap of this.dungeon.traps) {
      const key = `${trap.tx},${trap.ty}`;
      if (!this.triggeredTrapKeys.has(key)) {
        this.trapMap.set(key, trap.type);
      }
    }
  }

  // ── Player ────────────────────────────────────────────────────────────────

  private spawnPlayer() {
    const { tx, ty } = this.dungeon.playerStart;
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;

    let persistedStats: PlayerStats | undefined;
    if (this.initData.persistedStats) {
      persistedStats = { ...this.initData.persistedStats, floor: this.currentFloor };
    }

    this.player = new Player(this, px, py, this.initData.charData, persistedStats);

    this.player.setCallbacks({
      onDamage: (dmg) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `-${dmg}`, COLORS.DAMAGE_TEXT);
        this.emitHUD();
        this.cameras.main.shake(80, 0.005);
      },
      onHeal: (amount) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `+${amount}`, COLORS.HEAL_TEXT);
        this.emitHUD();
      },
      onDead: () => this.handlePlayerDeath(),
      onXP: (gained) => {
        this.spawnFloatingText(this.player.x, this.player.y - 30, `+${gained} XP`, COLORS.XP_TEXT, 12);
        this.emitHUD();
      },
      onLevelUp: (level) => {
        this.spawnFloatingText(this.player.x, this.player.y - 50, `LEVEL UP! ${level}`, 0xffd700, 18);
        this.cameras.main.flash(200, 80, 80, 20);
        this.emitHUD();
      },
      onTurnUndead: () => this.doTurnUndead(),
    });

    this.physics.add.collider(this.player, this.wallGroup);
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  private spawnEnemies() {
    this.enemyGroup = this.physics.add.group();
    this.enemies = [];

    for (let i = 0; i < this.dungeon.enemies.length; i++) {
      if (this.deadEnemyIndices.has(i)) continue; // skip dead enemies from prior session

      const spawn = this.dungeon.enemies[i];
      const ex = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const ey = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const enemy = new Enemy(this, ex, ey, spawn.type);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = i;
      this.enemies.push(enemy);
      this.enemyGroup.add(enemy);
      this.physics.add.collider(enemy, this.wallGroup);
    }

    this.physics.add.collider(this.player, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private spawnItems() {
    for (const spawn of this.dungeon.items) {
      const key = `${spawn.tx},${spawn.ty}`;
      if (this.pickedItemKeys.has(key)) continue; // already picked in prior session

      const ix = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const iy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const textureKey = `item_${spawn.type.toLowerCase()}`;
      const sprite = this.add.sprite(ix, iy, textureKey).setDepth(3);
      (sprite as Phaser.GameObjects.Sprite & { itemType: string; spawnKey: string }).itemType = spawn.type;
      (sprite as Phaser.GameObjects.Sprite & { itemType: string; spawnKey: string }).spawnKey = key;
      this.items.push(sprite);

      this.tweens.add({
        targets: sprite,
        y: iy - 5,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  // ── Chests ────────────────────────────────────────────────────────────────

  private spawnChests() {
    for (const spawn of this.dungeon.chests) {
      const key = `${spawn.tx},${spawn.ty}`;
      if (this.openedChestKeys.has(key)) continue; // already opened in prior session

      const cx = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

      const chest = new TreasureChest(this, cx, cy, spawn.tier, spawn.trapped, spawn.isMimic);

      if (spawn.isMimic) {
        chest.onMimicReveal = (mx, my) => {
          const enemy = new Enemy(this, mx, my, 'MIMIC');
          this.enemies.push(enemy);
          this.enemyGroup.add(enemy);
          this.physics.add.collider(enemy, this.wallGroup);
          const body = enemy.body as Phaser.Physics.Arcade.Body;
          body.setVelocity(50, 50);
          this.spawnFloatingText(mx, my - 30, 'MIMIC!', 0xffd700, 16);
          this.cameras.main.shake(120, 0.008);
        };
      }

      this.chests.push(chest);
    }
  }

  // ── Torch glow ────────────────────────────────────────────────────────────

  private spawnTorchGlow() {
    const px = this.player.x;
    const py = this.player.y;

    this.torchOuter = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(2.8).setAlpha(0.35).setDepth(47);

    this.torchInner = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.6).setAlpha(0.55).setDepth(48);
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

  private initFog() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;

    this.fogState = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.fogRT = this.add.renderTexture(0, 0, totalW, totalH);
    this.fogRT.setOrigin(0, 0);
    this.fogRT.fill(0x000000, 1);
    this.fogRT.setDepth(50);

    const brushSize = FOG_RADIUS * TILE_SIZE * 2;
    this.fogBrushImg = this.add.image(0, 0, "fog_brush")
      .setOrigin(0, 0)
      .setDisplaySize(brushSize, brushSize)
      .setVisible(false);

    const { tx, ty } = this.dungeon.playerStart;
    this.revealFog(tx, ty);
    this.lastFogTile = { tx, ty };
  }

  private revealFog(ptx: number, pty: number) {
    const r = FOG_RADIUS;
    const brushRadius = r * TILE_SIZE;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) continue;
        this.fogState[ty * MAP_WIDTH + tx] = 1;
      }
    }

    const bx = ptx * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    const by = pty * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    this.fogRT.erase(this.fogBrushImg, bx, by);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private setupCamera() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.input.on("wheel", (_ptr: unknown, _objs: unknown, _dx: number, deltaY: number) => {
      this.adjustZoom(-deltaY * 0.001);
    });

    this.input.keyboard!.on("keydown-PLUS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-EQUALS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-MINUS", () => this.adjustZoom(-0.1));
  }

  private adjustZoom(delta: number) {
    const next = Phaser.Math.Clamp(this.cameras.main.zoom + delta, 0.4, 2.5);
    this.cameras.main.setZoom(next);
    this.events.emit("hud:zoom", next);
  }

  // ── Spells ────────────────────────────────────────────────────────────────

  private setupSpells() {
    this.spellSystem = new SpellSystem(this);
    const classDef = CHARACTER_CLASSES[this.player.stats.classKey];
    const hotkeyKeyCodes = [
      Phaser.Input.Keyboard.KeyCodes.Q,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.E,
      Phaser.Input.Keyboard.KeyCodes.R,
    ];

    this.spellHotkeys = [];
    this.spellHotkeyMap = [];

    classDef.spellKeys.forEach((spellKey, i) => {
      if (i < hotkeyKeyCodes.length) {
        this.spellHotkeys.push(this.input.keyboard!.addKey(hotkeyKeyCodes[i]));
        this.spellHotkeyMap.push(spellKey);
      }
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  emitHUD() {
    if (!this.player) return;
    const s = this.player.stats;
    this.events.emit("hud:update", {
      hp: s.hp, maxHp: s.maxHp,
      attack: s.attack, defense: s.defense,
      level: s.level, xp: s.xp, xpToNext: s.xpToNext,
      floor: this.currentFloor, kills: this.kills,
      mana: s.mana, maxMana: s.maxMana,
      classKey: s.classKey,
      effects: s.effects,
      spellKeys: this.spellHotkeyMap,
      spellCooldowns: this.spellHotkeyMap.map(k => this.spellSystem?.getRemainingCooldown(k) ?? 0),
      spellManaCosts: this.spellHotkeyMap.map(k => SPELLS[k]?.manaCost ?? 0),
      potions: s.potions,
      manaPotions: s.manaPotions,
      gold: s.gold,
    });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (!this.player || this.player.stats.hp <= 0) return;
    if (this._restDialogOpen) return; // pause all gameplay during rest dialog

    this.player.update(delta);

    // Torch glow flicker
    const flicker = 0.5 + Math.sin(this.time.now * 0.008) * 0.04 + (Math.random() - 0.5) * 0.025;
    this.torchInner.setPosition(this.player.x, this.player.y).setAlpha(flicker);
    this.torchOuter.setPosition(this.player.x, this.player.y).setAlpha(flicker * 0.55);

    // Fog of war
    const curTx = Math.floor(this.player.x / TILE_SIZE);
    const curTy = Math.floor(this.player.y / TILE_SIZE);
    if (curTx !== this.lastFogTile.tx || curTy !== this.lastFogTile.ty) {
      this.lastFogTile = { tx: curTx, ty: curTy };
      this.revealFog(curTx, curTy);
    }

    // Trap detection (passive + G-key search)
    this.checkTrapDetection(curTx, curTy);
    this.checkSearchKey(curTx, curTy);
    this.checkDisarmKey(curTx, curTy);

    // Trap triggering (stepping on undetected OR detected-but-not-disarmed traps)
    this.checkTrapTriggering(curTx, curTy);

    // Secret door hover
    this.checkSecretDoors(curTx, curTy);

    // Turn undead
    this.player.tryTurnUndead();

    // Spells
    this.checkSpellInput();

    // Attack
    if (this.player.tryAttack()) {
      this.handlePlayerAttack();
    }

    // Enemy update
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) { this.enemies.splice(i, 1); continue; }

      enemy.update(delta, this.player.x, this.player.y);

      if (enemy.canAttackPlayer(this.player.x, this.player.y)) {
        const dmg = enemy.doAttack();
        if (ENEMY_TYPES[enemy.typeKey].isRanged) {
          this.spawnEnemyBolt(enemy.x, enemy.y, this.player.x, this.player.y, dmg, enemy.typeKey);
        } else {
          this.player.takeDamage(dmg, enemy.ignoresArmor);
          if (enemy.poisonDmg > 0) {
            this.player.addEffect('POISONED', enemy.poisonDuration || 5000, enemy.poisonDmg);
          }
        }
      }
    }

    this.updateEnemyProjectiles(delta);
    this.checkChestInteraction();
    this.checkItemPickup();
    this.checkPotionInput();
    this.checkStairs();
    this.checkStairsUp();
    this.updateFloatingTexts(delta);

    if (this.spellSystem) {
      this.spellSystem.update(delta, this.enemies, this.player);
    }

    this.emitHUD();
  }

  // ── Trap Detection ────────────────────────────────────────────────────────

  /** Passive auto-detection for Thief; updates visual overlays. */
  private checkTrapDetection(ptx: number, pty: number) {
    const { classKey } = this.player.stats;
    const autoRange = classKey === 'thief' ? 4 : 0;

    for (const [key, trapType] of this.trapMap) {
      const [tx, ty] = key.split(',').map(Number);
      const dist = Math.abs(tx - ptx) + Math.abs(ty - pty);

      if (!this.detectedTraps.has(key) && dist <= autoRange) {
        this.detectTrap(key, tx, ty, trapType, classKey === 'thief' ? 'auto' : 'search');
      }
    }
  }

  private detectTrap(key: string, tx: number, ty: number, trapType: TrapTypeKey, source: 'auto' | 'search') {
    if (this.detectedTraps.has(key)) return;
    this.detectedTraps.add(key);

    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;

    // Red X overlay on floor tile
    if (!this._trapOverlays.has(key)) {
      const overlay = this.add.image(wx, wy, "trap_detected").setDepth(3).setAlpha(0.85);
      this._trapOverlays.set(key, overlay);
    }

    const msg = source === 'auto'
      ? `⚠ Trap detected: ${TRAP_TYPES[trapType].key} — press D to disarm`
      : `⚠ Found a trap: ${TRAP_TYPES[trapType].key}`;
    this.spawnFloatingText(wx, wy - 20, '⚠ TRAP', 0xff1744, 11);
    this.events.emit("hud:status", msg);
  }

  /** G key: manual area search for traps AND secret doors. */
  private checkSearchKey(ptx: number, pty: number) {
    if (!this._gKey) this._gKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);
    if (!Phaser.Input.Keyboard.JustDown(this._gKey)) return;

    const searchBonus = this.player.stats.searchBonus;
    const roll = Math.floor(Math.random() * 20) + 1 + searchBonus;
    const trapDC = 12;
    const doorDC = 15;
    const range = 3;
    let found = 0;

    // Search for traps
    for (const [key, trapType] of this.trapMap) {
      if (this.detectedTraps.has(key)) continue;
      const [tx, ty] = key.split(',').map(Number);
      if (Math.abs(tx - ptx) <= range && Math.abs(ty - pty) <= range) {
        if (roll >= trapDC) {
          this.detectTrap(key, tx, ty, trapType, 'search');
          found++;
        }
      }
    }

    // Search for secret doors
    for (const key of this.secretDoorSet) {
      const [stx, sty] = key.split(',').map(Number);
      if (Math.abs(stx - ptx) <= range && Math.abs(sty - pty) <= range) {
        if (roll >= doorDC) {
          this.revealSecretDoor(stx, sty, key);
          found++;
        }
      }
    }

    if (found === 0) {
      this.events.emit("hud:status", `Search: nothing found (rolled ${roll})`);
    }
  }

  /** D key: Thief disarms a detected trap within 1 tile. */
  private checkDisarmKey(ptx: number, pty: number) {
    if (this.player.stats.classKey !== 'thief') return;
    if (!this._dKey) this._dKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    if (!Phaser.Input.Keyboard.JustDown(this._dKey)) return;

    for (const key of this.detectedTraps) {
      const [tx, ty] = key.split(',').map(Number);
      if (Math.abs(tx - ptx) > 1 || Math.abs(ty - pty) > 1) continue;

      const trapType = this.trapMap.get(key);
      if (!trapType) continue;

      const disableBonus = this.player.stats.disableBonus;
      const roll = Math.floor(Math.random() * 20) + 1 + disableBonus;
      const dc = TRAP_TYPES[trapType]?.dc ?? 12;

      if (roll >= dc) {
        // Disarm success
        this.trapMap.delete(key);
        this.detectedTraps.delete(key);
        this.triggeredTrapKeys.add(key); // mark as dealt with
        this._trapOverlays.get(key)?.destroy();
        this._trapOverlays.delete(key);
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;
        this.spawnFloatingText(wx, wy - 20, 'Disarmed!', 0x69f0ae, 12);
        this.events.emit("hud:status", `Trap disarmed! (rolled ${roll} vs DC ${dc})`);
      } else {
        // Disarm failure — trigger the trap
        this.events.emit("hud:status", `Disarm failed! (rolled ${roll} vs DC ${dc})`);
        this.triggerTrap(trapType, tx, ty, key);
      }
      break; // only attempt one disarm per keypress
    }
  }

  /** Called on the player's current tile — triggers if trap present. */
  private checkTrapTriggering(ptx: number, pty: number) {
    const trapKey = `${ptx},${pty}`;
    const trapType = this.trapMap.get(trapKey);
    if (!trapType) return;

    // Detected traps: give +4 save bonus (player saw it coming)
    const isDetected = this.detectedTraps.has(trapKey);
    this.triggerTrap(trapType, ptx, pty, trapKey, isDetected ? 4 : 0);

    // Clean up detection overlay
    this.detectedTraps.delete(trapKey);
    this._trapOverlays.get(trapKey)?.destroy();
    this._trapOverlays.delete(trapKey);
  }

  // ── Secret Doors ──────────────────────────────────────────────────────────

  private checkSecretDoors(ptx: number, pty: number) {
    const { classKey } = this.player.stats;
    const autoRange = classKey === 'thief' ? 3 : 2;

    for (const key of this.secretDoorSet) {
      const [stx, sty] = key.split(',').map(Number);
      const dx = ptx - stx;
      const dy = pty - sty;
      const inRange = Math.abs(dx) <= autoRange && Math.abs(dy) <= autoRange;

      const sprite = this.secretDoorSprites.get(key);
      if (inRange) {
        if (sprite) sprite.setTint(0x448aff);
        // Click to search
        if (this.input.activePointer.isDown) {
          const clickTx = Math.floor(this.input.activePointer.worldX / TILE_SIZE);
          const clickTy = Math.floor(this.input.activePointer.worldY / TILE_SIZE);
          if (clickTx === stx && clickTy === sty) {
            this.revealSecretDoor(stx, sty, key);
          }
        }
      } else {
        if (sprite) sprite.clearTint();
      }
    }
  }

  private revealSecretDoor(tx: number, ty: number, key: string) {
    if (!this.secretDoorSet.has(key)) return;
    const searchBonus = this.player.stats.searchBonus;
    const roll = Math.floor(Math.random() * 20) + 1 + searchBonus;

    if (roll >= 15) {
      this.dungeon.tiles[ty][tx] = TILE.FLOOR;
      this.revealedDoorKeys.add(key);

      const wx = tx * TILE_SIZE + TILE_SIZE / 2;
      const wy = ty * TILE_SIZE + TILE_SIZE / 2;

      // Remove physics wall
      const members = this.wallGroup.getChildren();
      for (const m of members) {
        const r = m as Phaser.GameObjects.Rectangle;
        if (Math.abs(r.x - wx) < 2 && Math.abs(r.y - wy) < 2) {
          r.destroy(); break;
        }
      }

      const sprite = this.secretDoorSprites.get(key);
      if (sprite) { sprite.setTexture("secret_door_open"); sprite.clearTint(); }

      this.secretDoorSet.delete(key);
      this.secretDoorSprites.delete(key);
      this.spawnFloatingText(wx, wy - 20, 'Secret door!', 0x448aff, 13);
      this.events.emit("hud:status", `Secret door revealed! (rolled ${roll})`);
    } else {
      this.events.emit("hud:status", `Search failed (rolled ${roll}, need 15)`);
    }
  }

  // ── Traps ─────────────────────────────────────────────────────────────────

  private triggerTrap(type: TrapTypeKey, tx: number, ty: number, mapKey: string, saveBonus = 0) {
    const def = TRAP_TYPES[type];
    const s = this.player.stats;

    this.trapMap.delete(mapKey);
    this.dungeon.tiles[ty][tx] = TILE.FLOOR;
    this.triggeredTrapKeys.add(mapKey);

    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;
    this.spawnFloatingText(wx, wy - 20, def.description, def.color, 12);
    this.cameras.main.shake(100, 0.006);

    if (def.saveStat === 'none') { this.doAlarmEffect(); return; }

    const baseSave = def.saveStat === 'reflex' ? s.reflexSave : s.fortSave;
    const roll = Math.floor(Math.random() * 20) + 1 + baseSave + saveBonus;
    const saved = roll >= def.dc;

    if (saved) {
      const label = saveBonus > 0 ? `SAVED! Saw it coming! (${roll})` : `SAVED! (${roll})`;
      this.spawnFloatingText(this.player.x, this.player.y - 40, label, 0x69f0ae, 12);
      return;
    }

    if (def.damage[0] > 0) {
      let dmg = 0;
      for (let i = 0; i < def.damage[1]; i++) dmg += Math.floor(Math.random() * def.damage[0]) + 1;
      this.player.takeDamage(dmg, false);
    }
    if (def.effect === 'POISONED') this.player.addEffect('POISONED', def.effectDuration ?? 5000, 3);
    else if (def.effect === 'SLOWED') this.player.addEffect('SLOWED', def.effectDuration ?? 4000);

    this.events.emit("hud:status", `${def.description} Failed save (${roll} vs DC ${def.dc})`);
  }

  private doAlarmEffect() {
    const px = this.player.x;
    const py = this.player.y;
    let count = 0;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < 300) { enemy.update(0, px, py); count++; }
    }
    this.cameras.main.shake(150, 0.01);
    this.events.emit("hud:status", `ALARM! ${count} enemies alerted!`);
  }

  // ── Turn Undead ────────────────────────────────────────────────────────────

  private doTurnUndead() {
    let count = 0;
    for (const enemy of this.enemies) {
      if (!enemy.active || !enemy.isUndead) continue;
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) <= 200) {
        const roll = Math.floor(Math.random() * 20) + 1 + abilityMod(this.player.stats.cha);
        if (roll >= 10) { enemy.forceFleeFrom(this.player.x, this.player.y, 10000); count++; }
      }
    }
    this.spawnFloatingText(this.player.x, this.player.y - 40, `Turn Undead! (${count} fled)`, 0xfff9c4, 14);
    this.events.emit("hud:status", `Turn Undead — ${count} undead flee!`);
  }

  // ── Spell Input ────────────────────────────────────────────────────────────

  private checkSpellInput() {
    if (!this.spellSystem) return;
    const ptr = this.input.activePointer;

    this.spellHotkeys.forEach((key, i) => {
      if (!Phaser.Input.Keyboard.JustDown(key)) return;
      const spellKey = this.spellHotkeyMap[i];
      if (!spellKey) return;

      if (spellKey === 'TURN_UNDEAD') { this.doTurnUndead(); return; }

      const cast = this.spellSystem.cast(
        spellKey, this.player, this.enemies, this.dungeon.tiles,
        ptr.worldX, ptr.worldY,
      );
      if (cast) {
        this.spawnFloatingText(this.player.x, this.player.y - 30, `${SPELLS[spellKey].name}!`, SPELLS[spellKey].color, 12);
      } else {
        this.events.emit("hud:status", "Not enough mana!");
      }
      this.emitHUD();
    });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private handlePlayerAttack() {
    const attackBox = this.player.getAttackBox();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      const enemyBounds = enemy.getBounds();
      if (!Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemyBounds)) continue;

      const isSneakAttack = this.player.stats.classKey === 'thief' &&
        !enemy.canAttackPlayer(this.player.x, this.player.y);
      const dmg = this.player.getAttackDamage(isSneakAttack);
      const dealt = enemy.takeDamage(dmg);
      this.spawnFloatingText(enemy.x, enemy.y - 20, `-${dealt}`, 0xffffff);
      if (isSneakAttack) this.spawnFloatingText(enemy.x, enemy.y - 36, 'SNEAK!', 0xffa726, 11);

      if (enemy.hp <= 0) {
        this.player.gainXP(enemy.xp);
        this.kills++;
        this.emitHUD();

        // Record death for persistence
        const spawnIdx = (enemy as Enemy & { _spawnIdx?: number })._spawnIdx;
        if (typeof spawnIdx === 'number') this.deadEnemyIndices.add(spawnIdx);

        if (this.player.stats.classKey === 'fighter') this.doCleave(enemy.x, enemy.y, i);

        this.spawnDeathEffect(enemy.x, enemy.y, enemy.typeKey);
        enemy.destroy();
        this.enemies.splice(i, 1);
      }
    }
  }

  private doCleave(killedX: number, killedY: number, killedIdx: number) {
    const range = TILE_SIZE * 2;
    for (let j = this.enemies.length - 1; j >= 0; j--) {
      if (j === killedIdx) continue;
      const target = this.enemies[j];
      if (!target.active) continue;
      const dx = target.x - killedX;
      const dy = target.y - killedY;
      if (Math.sqrt(dx * dx + dy * dy) <= range) {
        const dealt = target.takeDamage(this.player.getAttackDamage(false));
        this.spawnFloatingText(target.x, target.y - 20, `CLEAVE -${dealt}`, COLORS.ENEMY_BASIC, 12);
        if (target.hp <= 0) {
          this.player.gainXP(target.xp);
          this.kills++;
          const idx = (target as Enemy & { _spawnIdx?: number })._spawnIdx;
          if (typeof idx === 'number') this.deadEnemyIndices.add(idx);
          this.spawnDeathEffect(target.x, target.y, target.typeKey);
          target.destroy();
          this.enemies.splice(j, 1);
        }
        break;
      }
    }
  }

  private spawnEnemyBolt(fromX: number, fromY: number, toX: number, toY: number, dmg: number, typeKey: EnemyTypeKey) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const bolt = this.add.rectangle(fromX, fromY, 5, 5, ENEMY_TYPES[typeKey].color).setDepth(16);
    this.enemyProjectiles.push({ obj: bolt, vx: (dx / len) * 300, vy: (dy / len) * 300, dmg, life: 1500 });
  }

  private updateEnemyProjectiles(delta: number) {
    const dt = delta / 1000;
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.enemyProjectiles[i];
      proj.life -= delta;
      if (proj.life <= 0) { proj.obj.destroy(); this.enemyProjectiles.splice(i, 1); continue; }
      proj.obj.x += proj.vx * dt;
      proj.obj.y += proj.vy * dt;
      const dx = proj.obj.x - this.player.x;
      const dy = proj.obj.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        this.player.takeDamage(proj.dmg, false);
        proj.obj.destroy();
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  private spawnDeathEffect(x: number, y: number, typeKey: EnemyTypeKey) {
    const color = ENEMY_TYPES[typeKey]?.color ?? 0xff0000;
    for (let i = 0; i < 6; i++) {
      const p = this.add.rectangle(x, y, 6, 6, color).setDepth(15);
      const angle = (i / 6) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 120);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.4,
        y: y + Math.sin(angle) * speed * 0.4,
        alpha: 0, scaleX: 0, scaleY: 0,
        duration: 400,
        onComplete: () => p.destroy(),
      });
    }
  }

  // ── Chest Interaction ─────────────────────────────────────────────────────

  private checkChestInteraction() {
    if (!this._eKey) this._eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    const s = this.player.stats;

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const chest = this.chests[i];
      if (!chest.active) { this.chests.splice(i, 1); continue; }

      const dx = this.player.x - chest.x;
      const dy = this.player.y - chest.y;
      const inRange = Math.sqrt(dx * dx + dy * dy) <= TILE_SIZE * 1.2;
      chest.setPromptVisible(inRange);

      if (inRange && Phaser.Input.Keyboard.JustDown(this._eKey)) {
        const result = chest.tryOpen(s.classKey, abilityMod(s.str), abilityMod(s.dex), s.level, this.currentFloor);
        if (result.message) this.events.emit("hud:status", result.message);

        if (result.trapTriggered) {
          const tx = Math.floor(chest.x / TILE_SIZE);
          const ty = Math.floor(chest.y / TILE_SIZE);
          this.triggerTrap(result.trapTriggered, tx, ty, `${tx},${ty}`);
        }

        if (result.opened && result.loot) {
          // Record chest as opened for persistence
          const ctx = Math.round((chest.x - TILE_SIZE / 2) / TILE_SIZE);
          const cty = Math.round((chest.y - TILE_SIZE / 2) / TILE_SIZE);
          this.openedChestKeys.add(`${ctx},${cty}`);

          const { gold, items } = result.loot;
          if (gold > 0) {
            s.gold += gold;
            this.spawnFloatingText(chest.x, chest.y - 20, `+${gold} gold`, COLORS.GOLD_TEXT);
          }
          for (const lootItem of items) this.applyLootItem(lootItem);
          this.emitHUD();
        }
      }
    }
  }

  private applyLootItem(item: { type: string; label: string; bonus?: number; statKey?: string; value?: number }) {
    const s = this.player.stats;
    switch (item.type) {
      case 'HEALTH_POTION': this.player.heal(item.value ?? 30); this.events.emit("hud:status", `Found: ${item.label}`); break;
      case 'XP_ORB': this.player.gainXP(item.value ?? 40); this.events.emit("hud:status", `Found: ${item.label}`); break;
      case 'WEAPON': s.weaponBonus += item.bonus ?? 1; s.attack += item.bonus ?? 1; this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} ATK)`); break;
      case 'ARMOR': s.armorBonus += item.bonus ?? 1; s.defense += item.bonus ?? 1; this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} DEF)`); break;
      case 'STAT_TOME':
        if (item.statKey) {
          const k = item.statKey as keyof typeof s;
          if (typeof s[k] === 'number') {
            (s as unknown as Record<string, number>)[item.statKey] += 1;
            this.player.recomputeDerived();
            this.events.emit("hud:status", `Read: ${item.label} (+1 ${item.statKey.toUpperCase()})`);
          }
        }
        break;
      case 'SCROLL': this.events.emit("hud:status", `Found scroll: ${item.label}`); break;
    }
    this.spawnFloatingText(this.player.x, this.player.y - 20, item.label, COLORS.GOLD_TEXT, 11);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private checkItemPickup() {
    const range = TILE_SIZE * 0.8;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const dx = this.player.x - item.x;
      const dy = this.player.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < range) {
        const typed = item as Phaser.GameObjects.Sprite & { itemType: string; spawnKey?: string };
        if (typed.spawnKey) this.pickedItemKeys.add(typed.spawnKey);
        this.applyItem(typed.itemType);
        item.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  private applyItem(type: string) {
    const p = this.player.stats;
    switch (type) {
      case "HEALTH_POTION": this.player.heal(30); this.events.emit("hud:status", "Health Potion +30 HP"); break;
      case "WEAPON": p.attack += 5; p.weaponBonus += 5; this.spawnFloatingText(this.player.x, this.player.y - 30, "ATK +5", COLORS.WEAPON); this.events.emit("hud:status", "Weapon Upgrade +5 ATK"); this.emitHUD(); break;
      case "ARMOR": p.defense += 2; p.armorBonus += 2; this.spawnFloatingText(this.player.x, this.player.y - 30, "DEF +2", COLORS.ARMOR); this.events.emit("hud:status", "Armor Shard +2 DEF"); this.emitHUD(); break;
      case "XP_ORB": this.player.gainXP(40); this.events.emit("hud:status", "XP Orb +40 XP"); break;
    }
  }

  // ── Potions ────────────────────────────────────────────────────────────────

  private checkPotionInput() {
    if (!this._fKey) this._fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (!this._mKey) this._mKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);

    if (Phaser.Input.Keyboard.JustDown(this._fKey)) {
      if (this.player.stats.potions > 0) {
        this.player.stats.potions--;
        this.player.heal(50);
        this.spawnFloatingText(this.player.x, this.player.y - 30, 'Potion! +50 HP', COLORS.HEAL_TEXT, 12);
        this.events.emit("hud:status", `Used Health Potion (${this.player.stats.potions} left)`);
        this.emitHUD();
      } else { this.events.emit("hud:status", "No potions left!"); }
    }

    if (Phaser.Input.Keyboard.JustDown(this._mKey)) {
      if (this.player.stats.manaPotions > 0 && this.player.stats.maxMana > 0) {
        this.player.stats.manaPotions--;
        this.player.restoreMana(40);
        this.spawnFloatingText(this.player.x, this.player.y - 30, '+40 Mana', COLORS.MANA_BAR, 12);
        this.events.emit("hud:status", `Used Mana Potion (${this.player.stats.manaPotions} left)`);
        this.emitHUD();
      } else if (this.player.stats.maxMana === 0) {
        this.events.emit("hud:status", "Your class doesn't use mana!");
      } else { this.events.emit("hud:status", "No mana potions left!"); }
    }
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs() {
    const { tx, ty } = this.dungeon.stairsPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = this.player.x - sx;
    const dy = this.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.7) this.nextFloor();
  }

  private checkStairsUp() {
    const { tx, ty } = this.dungeon.stairsUpPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = this.player.x - sx;
    const dy = this.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.9) {
      if (this.currentFloor === 1) {
        // Show rest dialog before leaving the dungeon
        this.showRestDialog();
      } else {
        // Mid-dungeon ascent: save this floor then go up
        this.saveCurrentFloor();
        this.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
          if (t === 1) {
            const persistedStats = this._buildPersistedStats(this.currentFloor - 1);
            this.scene.restart({ floor: this.currentFloor - 1, persistedStats, saveSlot: this.saveSlot });
          }
        });
      }
    }
  }

  // ── Rest Dialog ────────────────────────────────────────────────────────────

  private showRestDialog() {
    if (this._restDialogOpen) return;
    this._restDialogOpen = true;

    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const s = this.player.stats;
    const D = 200; // depth for all dialog elements

    // Half-lost HP/mana for short rest preview
    const shortHpGain = Math.floor((s.maxHp - s.hp) / 2);
    const shortMpGain = Math.floor((s.maxMana - s.mana) / 2);

    const els = this._restDialogElements;

    const overlay = this.add.rectangle(cx, cy, W, H, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(D);
    els.push(overlay);

    const bg = this.add.rectangle(cx, cy, 560, 280, 0x0c0c18, 0.97)
      .setStrokeStyle(2, 0x4466aa).setScrollFactor(0).setDepth(D);
    els.push(bg);

    els.push(this.add.text(cx, cy - 110, 'Return to the Tavern', {
      fontSize: '20px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    els.push(this.add.text(cx, cy - 76, 'Choose how you rest before leaving:', {
      fontSize: '12px', color: '#888899', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    // Short Rest card
    this.addRestCard(cx - 135, cy + 20, '⚕ SHORT REST', [
      `+${shortHpGain} HP  +${shortMpGain} MP`,
      'Dead enemies stay dead',
      'Traps stay cleared',
      'Chests stay open',
      'Same dungeon on return',
    ], 0x1a2a3a, 0x3399ff, () => this.doRest('short'));

    // Long Rest card
    this.addRestCard(cx + 135, cy + 20, '🛌 LONG REST', [
      `Full HP  Full MP`,
      'Enemies respawn',
      'Traps reset',
      'Chests refill',
      'Same layout on return',
    ], 0x2a1a2a, 0xcc44ff, () => this.doRest('long'));
  }

  private addRestCard(
    x: number, y: number, title: string, lines: string[],
    bgColor: number, accentColor: number, onClick: () => void,
  ) {
    const CW = 240;
    const CH = 200;
    const D = 200;
    const els = this._restDialogElements;

    const hex = `#${accentColor.toString(16).padStart(6, '0')}`;
    const cardBg = this.add.rectangle(x, y, CW, CH, bgColor)
      .setInteractive().setStrokeStyle(1, accentColor).setScrollFactor(0).setDepth(D);
    els.push(cardBg);

    els.push(this.add.text(x, y - CH / 2 + 18, title, {
      fontSize: '14px', color: hex, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    lines.forEach((line, i) => {
      els.push(this.add.text(x - CW / 2 + 14, y - CH / 2 + 44 + i * 22, line, {
        fontSize: '11px', color: '#aaaacc', fontFamily: 'monospace',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(D));
    });

    // Button
    const btn = this.add.rectangle(x, y + CH / 2 - 22, CW - 20, 30, accentColor, 0.15)
      .setInteractive().setStrokeStyle(1, accentColor).setScrollFactor(0).setDepth(D);
    const btnTxt = this.add.text(x, y + CH / 2 - 22, 'SELECT', {
      fontSize: '13px', color: hex, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D);
    els.push(btn);
    els.push(btnTxt);

    cardBg.on('pointerover', () => cardBg.setFillStyle(accentColor, 0.08));
    cardBg.on('pointerout', () => cardBg.setFillStyle(bgColor));
    btn.on('pointerover', () => { btn.setFillStyle(accentColor, 0.3); btnTxt.setColor('#ffffff'); });
    btn.on('pointerout', () => { btn.setFillStyle(accentColor, 0.15); btnTxt.setColor(hex); });
    cardBg.on('pointerdown', onClick);
    btn.on('pointerdown', onClick);
  }

  private doRest(type: RestType) {
    if (!this._restDialogOpen) return;
    const s = this.player.stats;

    if (type === 'short') {
      // Restore half of lost HP and mana
      const hpGain = Math.floor((s.maxHp - s.hp) / 2);
      const mpGain = Math.floor((s.maxMana - s.mana) / 2);
      if (hpGain > 0) this.player.heal(hpGain);
      if (mpGain > 0) this.player.restoreMana(mpGain);
      // Save dungeon state as-is (preserved)
      this.saveCurrentFloor();
    } else {
      // Full restore
      this.player.heal(s.maxHp - s.hp);
      if (s.maxMana > 0) this.player.restoreMana(s.maxMana - s.mana);
      // Reset dungeon state: clear kills/traps/chests but keep layout and revealed doors
      this.deadEnemyIndices.clear();
      this.triggeredTrapKeys.clear();
      this.openedChestKeys.clear();
      this.pickedItemKeys.clear();
      this.saveCurrentFloor(); // saves the reset state
    }

    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._restDialogOpen = false;

    this.cameras.main.fade(400, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const persistedStats = this._buildPersistedStats(0); // floor 0 = Tavern
        this.scene.start("TavernScene", { persistedStats, saveSlot: this.saveSlot });
      }
    });
  }

  // ── Dungeon Serialization ──────────────────────────────────────────────────

  private saveCurrentFloor() {
    const sf = this.serializeCurrentFloor();
    const ps = this.player.getSerializable();
    ps.savedDungeons = { ...(ps.savedDungeons ?? {}), [this.currentFloor]: sf };
    // Update player's in-memory stats so they carry the saved dungeon forward
    this.player.stats.savedDungeons = ps.savedDungeons;
  }

  private serializeCurrentFloor(): SerializedFloor {
    return {
      dungeonData: this._baseDungeon!,
      deadEnemyIndices: [...this.deadEnemyIndices],
      triggeredTrapKeys: [...this.triggeredTrapKeys],
      openedChestKeys: [...this.openedChestKeys],
      pickedItemKeys: [...this.pickedItemKeys],
      revealedDoorKeys: [...this.revealedDoorKeys],
    };
  }

  private _buildPersistedStats(targetFloor: number): PlayerStats {
    const ps = this.player.getSerializable();
    ps.floor = targetFloor;
    ps.saveSlot = this.saveSlot;
    return ps;
  }

  // ── Floor Transitions ─────────────────────────────────────────────────────

  private nextFloor() {
    this.saveCurrentFloor(); // persist current floor before descending
    this.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const ps = this._buildPersistedStats(this.currentFloor + 1);
        this.autoSave(ps).catch(() => {});
        this.scene.restart({ floor: this.currentFloor + 1, persistedStats: ps, saveSlot: this.saveSlot });
      }
    });
  }

  private async autoSave(stats: PlayerStats) {
    try {
      const cls = CHARACTER_CLASSES[stats.classKey];
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: this.saveSlot,
          name: `${cls.name} Lv ${stats.level}`,
          data: stats,
          level: stats.level,
          floor: stats.floor,
          playtime: 0,
        }),
      });
    } catch { /* offline */ }
  }

  // ── Death ─────────────────────────────────────────────────────────────────

  private handlePlayerDeath() {
    this.player.setTint(0x888888);
    this.time.delayedCall(800, () => {
      this.scene.start("GameOverScene", {
        floor: this.currentFloor,
        kills: this.kills,
        level: this.player.stats.level,
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private spawnFloatingText(x: number, y: number, text: string, color: number, size = 14) {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const obj = this.add.text(x, y, text, {
      fontSize: `${size}px`,
      color: hex,
      fontFamily: "monospace",
      stroke: "#000",
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);
    this.floatingTexts.push({ obj, vy: -60, life: 900 });
  }

  private updateFloatingTexts(delta: number) {
    const dt = delta / 1000;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= delta;
      ft.obj.y += ft.vy * dt;
      ft.vy *= 0.95;
      ft.obj.setAlpha(Math.max(0, ft.life / 900));
      if (ft.life <= 0) { ft.obj.destroy(); this.floatingTexts.splice(i, 1); }
    }
  }
}
