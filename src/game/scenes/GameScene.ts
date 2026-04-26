import * as Phaser from "phaser";
import type { PlayerStats } from "../entities/Player";
import {
  TILE_SIZE, TILE, COLORS, MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS,
  CHARACTER_CLASSES, SpellKey, SPELLS,
  TRAP_TYPES, TrapTypeKey,
  ENEMY_TYPES, EnemyTypeKey,
  ArmorTrait, EquipmentTrait, WeaponTrait,
  abilityMod, getFloorThemeIdx,
} from "../constants";
import { generateDungeon, DungeonData, SerializedFloor } from "../systems/DungeonGenerator";
import { onEnemyKilled, onChestOpened, onFloorReached, onSpecialRoomEntered, InventoryItem } from "../systems/QuestSystem";
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
type BoonKey = 'blade' | 'bulwark' | 'vigor' | 'arcana' | 'fortune';
type LootLike = { type: string; label: string; bonus?: number; trait?: EquipmentTrait; statKey?: string; value?: number };

interface BoonOption {
  key: BoonKey;
  title: string;
  lines: string[];
  color: number;
  apply: () => void;
}

interface RoomChallenge {
  roomIdx: number;
  target: number;
  kills: number;
  timeLeft: number;
}

type RelicKey = 'ember_idol' | 'swift_vial' | 'chest_contract' | 'black_candle' | 'boss_trophy';

const RELIC_LABELS: Record<RelicKey, string> = {
  ember_idol: 'Ember Idol',
  swift_vial: 'Swift Vial',
  chest_contract: 'Chest Contract',
  black_candle: 'Black Candle',
  boss_trophy: 'Guardian Trophy',
};

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
  private warnedTrapKeys = new Set<string>();
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
  private killStreak = 0;
  private killStreakTimer = 0;
  private floorObjectiveProgress = 0;
  private floorObjectiveComplete = false;
  private _enteredQuestRooms = new Set<string>();
  private _triggeredRoomEvents = new Set<number>();
  private _triggeredRoomModifiers = new Set<number>();
  private _clearedRoomBonuses = new Set<number>();
  private _lastPlayerRoomIdx = -1;
  private _roomChallenge?: RoomChallenge;
  private _roomChallengesSeen = new Set<number>();
  private _relicRoomTriggers = new Set<number>();
  private _shrineDialogOpen = false;
  private _shrineDialogElements: Phaser.GameObjects.GameObject[] = [];
  private initData: {
    floor?: number;
    charData?: CharCreationData;
    persistedStats?: PlayerStats;
    saveSlot?: number;
    specialRoomTags?: string[];
  } = {};

  private enemyProjectiles: {
    obj: Phaser.GameObjects.Rectangle;
    vx: number; vy: number; dmg: number; life: number;
  }[] = [];

  // ── Rest dialog ────────────────────────────────────────────────────────────
  private _restDialogOpen = false;
  private _restDialogElements: Phaser.GameObjects.GameObject[] = [];
  private _boonDialogOpen = false;
  private _boonDialogElements: Phaser.GameObjects.GameObject[] = [];

  // ── Extra keys ─────────────────────────────────────────────────────────────
  private _eKey?: Phaser.Input.Keyboard.Key;
  private _fKey?: Phaser.Input.Keyboard.Key;
  private _mKey?: Phaser.Input.Keyboard.Key;
  private _gKey?: Phaser.Input.Keyboard.Key;
  private _dKey?: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { floor?: number; charData?: CharCreationData; persistedStats?: PlayerStats; saveSlot?: number; specialRoomTags?: string[] }) {
    this.currentFloor = data?.floor ?? 1;
    this.saveSlot = data?.saveSlot ?? data?.persistedStats?.saveSlot ?? 1;
    this.kills = 0;
    this.killStreak = 0;
    this.killStreakTimer = 0;
    this.floorObjectiveProgress = 0;
    this.floorObjectiveComplete = false;
    this._enteredQuestRooms.clear();
    this._triggeredRoomEvents.clear();
    this._triggeredRoomModifiers.clear();
    this._clearedRoomBonuses.clear();
    this._lastPlayerRoomIdx = -1;
    this._roomChallenge = undefined;
    this._roomChallengesSeen.clear();
    this._relicRoomTriggers.clear();
    this._shrineDialogOpen = false;
    this._shrineDialogElements.forEach(e => e.destroy());
    this._shrineDialogElements = [];
    this.initData = data ?? {};

    // Clear session state
    this.secretDoorSet.clear();
    this.secretDoorSprites.clear();
    this.trapMap.clear();
    this.detectedTraps.clear();
    this.warnedTrapKeys.clear();
    this._trapOverlays.forEach(o => o.destroy());
    this._trapOverlays.clear();
    this.enemyProjectiles = [];
    this._restDialogOpen = false;
    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._boonDialogOpen = false;
    this._boonDialogElements.forEach(e => e.destroy());
    this._boonDialogElements = [];

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
    if (this.initData.persistedStats) {
      this.initData.persistedStats.runDeepestFloor = Math.max(this.initData.persistedStats.runDeepestFloor ?? 0, this.currentFloor);
    }

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
      this.dungeon = generateDungeon(this.currentFloor, this.initData.specialRoomTags);
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

    this.decorateRooms();

    // Build trap map — exclude already-triggered traps
    for (const trap of this.dungeon.traps) {
      const key = `${trap.tx},${trap.ty}`;
      if (!this.triggeredTrapKeys.has(key)) {
        this.trapMap.set(key, trap.type);
      }
    }
  }

  private decorateRooms() {
    this.dungeon.rooms.forEach((room, idx) => {
      const x = room.x * TILE_SIZE;
      const y = room.y * TILE_SIZE;
      const w = room.w * TILE_SIZE;
      const h = room.h * TILE_SIZE;
      const cx = room.cx * TILE_SIZE + TILE_SIZE / 2;
      const cy = room.cy * TILE_SIZE + TILE_SIZE / 2;
      const type = room.type ?? 'normal';

      const colorByType: Record<string, number> = {
        normal: idx === 0 ? 0x66bb6a : 0x3f4f6a,
        vault: 0xffd166,
        trap_corridor: 0xff5a5f,
        monster_closet: 0x9b5de5,
        quest_special: 0x00bbf9,
      };
      const color = colorByType[type] ?? 0x3f4f6a;
      const modifierColor: Record<string, number> = {
        blood_rune: 0xff5a5f,
        healing_font: 0x69f0ae,
        cursed_crypt: 0xce93d8,
        gilded_cache: 0xffd166,
      };

      this.add.rectangle(x + w / 2, y + h / 2, w - 10, h - 10)
        .setStrokeStyle(type === 'normal' ? 1 : 2, color, type === 'normal' ? 0.18 : 0.5)
        .setDepth(2);

      if (idx === 0) {
        this.add.text(cx, y + 12, 'CAMP', {
          fontSize: '9px', color: '#99e6a8', fontFamily: 'monospace',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      } else if (type !== 'normal') {
        const label = type === 'vault'
          ? 'VAULT'
          : type === 'trap_corridor'
            ? 'RUNES'
            : type === 'monster_closet'
              ? 'DEN'
              : (room.tag ?? 'QUEST').toUpperCase();
        this.add.text(cx, y + 12, label, {
          fontSize: '9px', color: `#${color.toString(16).padStart(6, '0')}`,
          fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      }

      if (type === 'vault') {
        this.add.image(cx, cy, 'decal_hoard').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'trap_corridor') {
        this.add.image(cx, cy, 'decal_runes').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'monster_closet') {
        this.add.image(cx, cy, 'decal_bones').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'quest_special') {
        this.add.image(cx, cy, 'decal_shrine').setAlpha(0.8).setDepth(2.5);
      } else if (idx % 3 === 0) {
        this.add.image(cx, cy, 'decal_pillar').setAlpha(0.35).setDepth(2.5);
      }

      if (room.modifier) {
        const modColor = modifierColor[room.modifier] ?? 0xffffff;
        const modLabel = room.modifier === 'blood_rune'
          ? 'BLOOD'
          : room.modifier === 'healing_font'
            ? 'FONT'
            : room.modifier === 'cursed_crypt'
              ? 'CURSE'
              : 'GILD';
        this.add.rectangle(cx, cy, Math.max(56, w * 0.38), Math.max(36, h * 0.32))
          .setStrokeStyle(2, modColor, 0.42)
          .setDepth(2.8);
        this.add.text(cx, cy, modLabel, {
          fontSize: '9px', color: `#${modColor.toString(16).padStart(6, '0')}`,
          fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      }
    });
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
      const enemy = new Enemy(this, ex, ey, spawn.type, !!spawn.elite);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = i;
      (enemy as Enemy & { _roomIdx?: number })._roomIdx = spawn.roomIdx;
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
      const textureKey = spawn.type === 'CURSED_SHRINE' ? 'decal_shrine' : `item_${spawn.type.toLowerCase()}`;
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
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
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
      name: s.name,
      effects: s.effects,
      spellKeys: this.spellHotkeyMap,
      spellCooldowns: this.spellHotkeyMap.map(k => this.spellSystem?.getRemainingCooldown(k) ?? 0),
      spellManaCosts: this.spellHotkeyMap.map(k => SPELLS[k]?.manaCost ?? 0),
      potions: s.potions,
      manaPotions: s.manaPotions,
      gold: s.gold,
      floorObjective: this.dungeon.floorObjective
        ? {
            title: this.dungeon.floorObjective.title,
            detail: this.dungeon.floorObjective.detail,
            progress: this.floorObjectiveProgress,
            target: this.dungeon.floorObjective.targetCount,
            complete: this.floorObjectiveComplete,
          }
        : undefined,
      activeQuests: s.activeQuests,
      completedQuests: s.completedQuests,
      inventory: s.inventory,
      equippedWeaponLabel: s.equippedWeaponLabel,
      equippedArmorLabel: s.equippedArmorLabel,
    });
  }

  private addGold(amount: number) {
    if (amount <= 0) return;
    this.player.stats.gold += amount;
    this.player.stats.runGoldEarned = (this.player.stats.runGoldEarned ?? 0) + amount;
  }

  private hasRelic(key: RelicKey) {
    return this.player.stats.relics?.includes(key) ?? false;
  }

  private grantRelic(key: RelicKey) {
    const s = this.player.stats;
    if (!s.relics) s.relics = [];
    if (s.relics.includes(key)) {
      this.addGold(35 + this.currentFloor * 8);
      this.events.emit("hud:status", `${RELIC_LABELS[key]} deepens into gold.`);
      return;
    }
    s.relics.push(key);
    this.spawnFloatingText(this.player.x, this.player.y - 72, RELIC_LABELS[key].toUpperCase(), 0xffd166, 13);
    this.events.emit("hud:status", `Relic gained: ${RELIC_LABELS[key]}.`);
  }

  private grantRandomRelic() {
    const pool: RelicKey[] = ['ember_idol', 'swift_vial', 'chest_contract', 'black_candle', 'boss_trophy'];
    const missing = pool.filter(key => !this.hasRelic(key));
    this.grantRelic((missing.length > 0 ? missing : pool)[Phaser.Math.Between(0, (missing.length > 0 ? missing : pool).length - 1)]);
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
	    if (!this.player || this.player.stats.hp <= 0) return;
	    if (this._restDialogOpen) return; // pause all gameplay during rest dialog
	    if (this._boonDialogOpen) return; // choose a build-defining reward before continuing
    if (this._shrineDialogOpen) return;

	    this.player.update(delta);
	    this.killStreakTimer = Math.max(0, this.killStreakTimer - delta);
	    if (this.killStreakTimer <= 0) this.killStreak = 0;
    this.updateRoomChallenge(delta);

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
          if (enemy.typeKey === 'GIANT_SPIDER') {
            this.player.addEffect('SLOWED', 1600);
            this.spawnFloatingText(this.player.x, this.player.y - 36, 'WEBBED', 0x80cbc4, 11);
          } else if (enemy.typeKey === 'TROLL' || enemy.typeKey === 'TANK') {
            this.cameras.main.shake(90, 0.006);
            this.spawnFloatingText(this.player.x, this.player.y - 36, 'SLAM', 0xffd166, 11);
          } else if (enemy.typeKey === 'GHOST') {
            this.spawnFloatingText(this.player.x, this.player.y - 36, 'CHILL', 0x80cbc4, 11);
          }
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
    this.checkRoomEvents(curTx, curTy);
    this.checkSpecialRoomEntry();
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
        this.warnedTrapKeys.delete(key);
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
    if (isDetected) {
      if (!this.warnedTrapKeys.has(trapKey)) {
        const msg = this.player.stats.classKey === 'thief'
          ? 'Known trap ahead. Press D beside it to disarm, or route around it.'
          : 'Known trap ahead. Route around it or risk another path.';
        this.events.emit("hud:status", msg);
        this.spawnFloatingText(this.player.x, this.player.y - 34, 'TRAP AHEAD', 0xffd166, 11);
        this.warnedTrapKeys.add(trapKey);
      }
      return;
    }

    this.triggerTrap(trapType, ptx, pty, trapKey, isDetected ? 4 : 0);

    // Clean up detection overlay
    this.detectedTraps.delete(trapKey);
    this.warnedTrapKeys.delete(trapKey);
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
    this.warnedTrapKeys.delete(mapKey);
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
    this.spawnAttackArc();
    let hitCount = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      const enemyBounds = enemy.getBounds();
      if (!Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemyBounds)) continue;

      const isSneakAttack = this.player.stats.classKey === 'thief' &&
        !enemy.canAttackPlayer(this.player.x, this.player.y);
      const dmg = this.player.getAttackDamage(isSneakAttack);
      const dealt = enemy.takeDamage(dmg);
      hitCount++;
      this.cameras.main.shake(40, 0.0025);
      this.tweens.add({
        targets: enemy,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 60,
        yoyo: true,
      });
      this.spawnFloatingText(enemy.x, enemy.y - 20, `-${dealt}`, 0xffffff);
      if (isSneakAttack) this.spawnFloatingText(enemy.x, enemy.y - 36, 'SNEAK!', 0xffa726, 11);

	      if (enemy.hp <= 0) {
        if (this.tryEnemyReform(enemy)) continue;
	        this.player.gainXP(enemy.xp);
	        this.kills++;
        this.recordRoomChallengeKill(enemy);
	        this.applyKillMomentum(enemy);
	        this.applyEquipmentKillEffects(enemy, i);

        // Quest progress: enemy kill
        if (this.player.stats.activeQuests) {
          onEnemyKilled(this.player.stats.activeQuests, enemy.typeKey);
        }

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

    if (hitCount === 0) {
      const fx = this.player.stats.facing.x || 0;
      const fy = this.player.stats.facing.y || 1;
      this.spawnFloatingText(this.player.x + fx * 28, this.player.y + fy * 28, 'MISS', 0x888899, 10);
    }
  }

  private spawnAttackArc() {
    const fx = this.player.stats.facing.x || 0;
    const fy = this.player.stats.facing.y || 1;
    const horizontal = Math.abs(fx) > Math.abs(fy);
    const x = this.player.x + fx * 28;
    const y = this.player.y + fy * 28;
    const arc = this.add.rectangle(x, y, horizontal ? 34 : 10, horizontal ? 10 : 34, 0xf8f4d8, 0.55)
      .setDepth(18);
    this.tweens.add({
      targets: arc,
      alpha: 0,
      scaleX: horizontal ? 1.4 : 0.6,
      scaleY: horizontal ? 0.6 : 1.4,
      duration: 120,
      onComplete: () => arc.destroy(),
    });
  }

	  private applyKillMomentum(enemy: Enemy) {
    this.killStreak = this.killStreakTimer > 0 ? this.killStreak + 1 : 1;
    this.killStreakTimer = 4500;
    this.player.stats.runBestStreak = Math.max(this.player.stats.runBestStreak ?? 0, this.killStreak);
    this.player.stats.runDeepestFloor = Math.max(this.player.stats.runDeepestFloor ?? 0, this.currentFloor);

    if (this.killStreak >= 3) {
      const bonusGold = Math.min(25, this.killStreak * 2);
      const bonusXP = Math.min(30, this.killStreak * 3);
      this.addGold(bonusGold);
      this.player.gainXP(bonusXP);
      this.player.addEffect('RUSHED', Math.min(7000, 2200 + this.killStreak * 450));
      this.spawnFloatingText(this.player.x, this.player.y - 54, `STREAK x${this.killStreak} +${bonusGold}g`, 0xffd166, 12);
    }

    if (this.killStreak >= 5) {
      const hpGain = Math.max(1, Math.floor(this.player.stats.maxHp * 0.04));
      this.player.heal(hpGain);
      if (this.player.stats.maxMana > 0) this.player.restoreMana(3);
      this.spawnFloatingText(this.player.x, this.player.y - 70, 'ADRENALINE!', 0xffd166, 12);
    }

	    if (enemy.isElite) {
      const trophyBonus = this.hasRelic('boss_trophy') ? 1.5 : 1;
      const bonusGold = Math.floor((35 + this.currentFloor * 8) * trophyBonus);
      const bonusXP = Math.floor((30 + this.currentFloor * 10) * trophyBonus);
      this.addGold(bonusGold);
      this.player.gainXP(bonusXP);
      this.cameras.main.flash(180, 255, 209, 102);
      this.spawnFloatingText(enemy.x, enemy.y - 44, `CHAMPION +${bonusGold}g`, 0xffd166, 14);
    }

    this.applyRoomClearBonus(enemy);

    const objective = this.dungeon.floorObjective;
    if (!objective || this.floorObjectiveComplete) return;

    const enemyRoomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (
      (objective.type === 'CLEAR_DEN' && enemyRoomIdx === objective.roomIdx) ||
      (objective.type === 'SLAY_CHAMPION' && enemy.isElite) ||
      (objective.type === 'CLAIM_KEY' && enemy.isElite && enemyRoomIdx === objective.roomIdx)
    ) {
      this.floorObjectiveProgress = Math.min(objective.targetCount, this.floorObjectiveProgress + 1);
      if (this.floorObjectiveProgress >= objective.targetCount) this.completeFloorObjective();
    }
	  }

  private tryEnemyReform(enemy: Enemy) {
    if (!enemy.tryReform()) return false;
    this.spawnFloatingText(enemy.x, enemy.y - 28, 'REFORMS!', 0xe0e0e0, 12);
    this.events.emit("hud:status", "Skeleton bones knit back together. Finish it again.");
    return true;
  }

  private updateRoomChallenge(delta: number) {
    const challenge = this._roomChallenge;
    if (!challenge) return;
    challenge.timeLeft -= delta;
    if (challenge.timeLeft > 0) return;
    this.spawnFloatingText(this.player.x, this.player.y - 54, 'CHANCE LOST', 0x888899, 11);
    this.events.emit("hud:status", "Room challenge faded. The dungeon will not wait.");
    this._roomChallenge = undefined;
  }

  private startRoomChallenge(roomIdx: number) {
    if (this._roomChallenge || this._roomChallengesSeen.has(roomIdx) || roomIdx <= 0) return;
    const hostileCount = this.enemies.filter(enemy =>
      enemy.active && enemy.hp > 0 && (enemy as Enemy & { _roomIdx?: number })._roomIdx === roomIdx
    ).length;
    if (hostileCount < 2) return;

    const target = Math.min(3, hostileCount);
    this._roomChallengesSeen.add(roomIdx);
    this._roomChallenge = {
      roomIdx,
      target,
      kills: 0,
      timeLeft: 7000 + target * 2500,
    };
    this.spawnFloatingText(this.player.x, this.player.y - 58, `GAMBIT: ${target} KILLS`, 0xffd166, 13);
    this.events.emit("hud:status", `Room gambit: kill ${target} enemies fast for bonus gold, XP, and rush.`);
  }

  private recordRoomChallengeKill(enemy: Enemy) {
    const roomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (this.hasRelic('ember_idol') && roomIdx !== undefined && !this._relicRoomTriggers.has(roomIdx)) {
      this._relicRoomTriggers.add(roomIdx);
      this.player.addEffect('RUSHED', 3200);
      this.spawnFloatingText(this.player.x, this.player.y - 74, 'EMBER IGNITES', 0xff5a5f, 11);
    }

    const challenge = this._roomChallenge;
    if (!challenge) return;
    if (roomIdx !== challenge.roomIdx) return;

    challenge.kills++;
    if (challenge.kills < challenge.target) {
      this.spawnFloatingText(this.player.x, this.player.y - 58, `${challenge.kills}/${challenge.target}`, 0xffd166, 11);
      return;
    }

    const multiplier = this.hasRelic('black_candle') ? 2 : 1;
    const gold = (18 + this.currentFloor * 6) * multiplier;
    const xp = (16 + this.currentFloor * 8) * multiplier;
    this.addGold(gold);
    this.player.gainXP(xp);
    this.player.addEffect('RUSHED', 5500);
    this.spawnFloatingText(this.player.x, this.player.y - 66, `GAMBIT WON +${gold}g`, 0xffd166, 13);
    this.events.emit("hud:status", `Room gambit won: +${gold}g +${xp} XP and Rush.`);
    this._roomChallenge = undefined;
    this.emitHUD();
  }

  private applyEquipmentKillEffects(enemy: Enemy, killedIdx: number) {
    const trait = this.player.stats.weaponTrait;
    if (trait === 'vampiric') {
      const heal = Math.max(2, Math.floor(this.player.stats.maxHp * 0.04));
      this.player.heal(heal);
      this.spawnFloatingText(this.player.x, this.player.y - 62, `DRAIN +${heal}`, COLORS.HEAL_TEXT, 11);
    } else if (trait === 'arcane' && this.player.stats.maxMana > 0) {
      this.player.restoreMana(5);
      this.spawnFloatingText(this.player.x, this.player.y - 62, '+5 MANA', COLORS.MANA_BAR, 11);
    } else if (trait === 'cleaving' && this.player.stats.classKey !== 'fighter') {
      this.doTraitCleave(enemy.x, enemy.y, killedIdx);
    }
  }

  private applyRoomClearBonus(enemy: Enemy) {
    const roomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (roomIdx === undefined || this._clearedRoomBonuses.has(roomIdx)) return;

    const stillHostile = this.enemies.some((other) => {
      if (other === enemy || !other.active || other.hp <= 0) return false;
      return (other as Enemy & { _roomIdx?: number })._roomIdx === roomIdx;
    });
    if (stillHostile) return;

    const room = this.dungeon.rooms[roomIdx];
    if (!room) return;

    this._clearedRoomBonuses.add(roomIdx);
    const type = room.type ?? 'normal';
    const rewardByType: Record<string, { gold: number; xp: number; label: string; color: number }> = {
      normal: { gold: 4 + this.currentFloor, xp: 5 + this.currentFloor * 2, label: 'Room Clear', color: 0x99aabb },
      monster_closet: { gold: 18 + this.currentFloor * 4, xp: 22 + this.currentFloor * 6, label: 'Den Cleared', color: 0xff5a5f },
      trap_corridor: { gold: 14 + this.currentFloor * 3, xp: 16 + this.currentFloor * 4, label: 'Runes Secured', color: 0xffd166 },
      vault: { gold: 24 + this.currentFloor * 5, xp: 12 + this.currentFloor * 3, label: 'Vault Secured', color: 0xffd166 },
      quest_special: { gold: 20 + this.currentFloor * 4, xp: 24 + this.currentFloor * 5, label: 'Chamber Secured', color: 0x00bbf9 },
    };
    const reward = rewardByType[type] ?? rewardByType.normal;
    const modifierGold = room.modifier === 'gilded_cache' ? 18 + this.currentFloor * 5 : 0;
    const modifierXP = room.modifier === 'cursed_crypt' ? 16 + this.currentFloor * 5 : 0;

    this.addGold(reward.gold + modifierGold);
    this.player.gainXP(reward.xp + modifierXP);
    this.player.heal(Math.max(1, Math.floor(this.player.stats.maxHp * 0.03)));
    this.spawnFloatingText(this.player.x, this.player.y - 48, `${reward.label} +${reward.gold + modifierGold}g`, reward.color, 13);
    this.events.emit("hud:status", `${reward.label}: +${reward.gold + modifierGold}g +${reward.xp + modifierXP} XP`);
    this.emitHUD();
  }

  private completeFloorObjective() {
    const objective = this.dungeon.floorObjective;
    if (!objective || this.floorObjectiveComplete) return;
    this.floorObjectiveComplete = true;
	    this.addGold(objective.rewardGold);
	    this.player.gainXP(objective.rewardXP);
    if (objective.type === 'CLAIM_KEY') this.grantRandomRelic();
	    this.cameras.main.flash(220, 80, 180, 90);
    this.spawnFloatingText(this.player.x, this.player.y - 60, `${objective.title}!`, 0x69f0ae, 16);
    this.events.emit("hud:status", `${objective.title} complete: +${objective.rewardGold}g +${objective.rewardXP} XP`);
    this.emitHUD();
    this.showBoonChoice();
  }

  private buildBoonOptions(): BoonOption[] {
    const s = this.player.stats;
    const floor = this.currentFloor;
    const all: BoonOption[] = [
      {
        key: 'blade',
        title: 'Honed Blade',
        lines: ['+2 attack', 'Next streaks hit harder'],
        color: 0xff5a5f,
        apply: () => {
          s.weaponBonus += 2;
          s.attack += 2;
          s.equippedWeaponLabel = `Honed Weapon +${s.weaponBonus}`;
          this.trackInventory({ type: 'WEAPON', label: s.equippedWeaponLabel, bonus: 2 }, true);
        },
      },
      {
        key: 'bulwark',
        title: 'Old Shield',
        lines: ['+2 AC', 'Heal 25% max HP'],
        color: 0x80d8ff,
        apply: () => {
          s.armorBonus += 2;
          s.defense += 2;
          s.equippedArmorLabel = `Old Shield +${s.armorBonus}`;
          this.player.heal(Math.ceil(s.maxHp * 0.25));
          this.trackInventory({ type: 'ARMOR', label: s.equippedArmorLabel, bonus: 2 }, true);
        },
      },
      {
        key: 'vigor',
        title: 'Warrior Vigor',
        lines: ['+10 max HP', 'Full potion refill +1'],
        color: 0x69f0ae,
        apply: () => {
          s.maxHp += 10;
          this.player.heal(999);
          s.potions += 1;
        },
      },
      {
        key: 'arcana',
        title: 'Arcane Spark',
        lines: s.maxMana > 0 ? ['+8 max mana', 'Restore all mana'] : ['Gain 2 mana potions', '+20 XP'],
        color: 0xce93d8,
        apply: () => {
          if (s.maxMana > 0) {
            s.maxMana += 8;
            this.player.restoreMana(999);
          } else {
            s.manaPotions += 2;
            this.player.gainXP(20);
          }
        },
      },
      {
        key: 'fortune',
        title: 'Lucky Find',
        lines: [`+${40 + floor * 12} gold`, '+1 health potion'],
        color: 0xffd166,
        apply: () => {
          this.addGold(40 + floor * 12);
          s.potions += 1;
        },
      },
    ];

    const start = (this.currentFloor + this.kills) % all.length;
    return [all[start], all[(start + 2) % all.length], all[(start + 4) % all.length]];
  }

  private showBoonChoice() {
    if (this._boonDialogOpen) return;
    this._boonDialogOpen = true;
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const D = 220;
    const els = this._boonDialogElements;

    els.push(this.add.rectangle(cx, cy, W, H, 0x000000, 0.62).setScrollFactor(0).setDepth(D));
    els.push(this.add.rectangle(cx, cy, 720, 300, 0x080814, 0.97)
      .setStrokeStyle(2, 0xffd166).setScrollFactor(0).setDepth(D));
    els.push(this.add.text(cx, cy - 126, 'CLAIM A BOON', {
      fontSize: '24px', color: '#ffd166', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    els.push(this.add.text(cx, cy - 96, 'Choose one reward for this run.', {
      fontSize: '12px', color: '#888899', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    this.buildBoonOptions().forEach((option, i) => {
      const x = cx - 230 + i * 230;
      this.addBoonCard(x, cy + 32, option);
    });
  }

  private addBoonCard(x: number, y: number, option: BoonOption) {
    const D = 220;
    const W = 200;
    const H = 190;
    const els = this._boonDialogElements;
    const hex = `#${option.color.toString(16).padStart(6, '0')}`;

    const bg = this.add.rectangle(x, y, W, H, 0x111122, 0.98)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, option.color)
      .setScrollFactor(0)
      .setDepth(D);
    els.push(bg);

    els.push(this.add.text(x, y - H / 2 + 24, option.title, {
      fontSize: '15px', color: hex, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1));

    option.lines.forEach((line, i) => {
      els.push(this.add.text(x - W / 2 + 18, y - H / 2 + 58 + i * 24, line, {
        fontSize: '12px', color: '#c8c8d8', fontFamily: 'monospace',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1));
    });

    const choose = this.add.text(x, y + H / 2 - 28, 'CHOOSE', {
      fontSize: '13px', color: hex, fontFamily: 'monospace',
      backgroundColor: '#00000066',
      padding: { x: 12, y: 5 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1);
    els.push(choose);

    const apply = () => this.chooseBoon(option);
    bg.on('pointerover', () => bg.setFillStyle(option.color, 0.12));
    bg.on('pointerout', () => bg.setFillStyle(0x111122, 0.98));
    bg.on('pointerdown', apply);
    choose.setInteractive({ useHandCursor: true }).on('pointerdown', apply);
  }

  private chooseBoon(option: BoonOption) {
    if (!this._boonDialogOpen) return;
    option.apply();
    this._boonDialogElements.forEach(e => e.destroy());
    this._boonDialogElements = [];
    this._boonDialogOpen = false;
    this.spawnFloatingText(this.player.x, this.player.y - 64, option.title, option.color, 15);
    this.events.emit("hud:status", `Boon claimed: ${option.title}`);
    this.emitHUD();
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
          if (this.tryEnemyReform(target)) break;
	          this.player.gainXP(target.xp);
	          this.kills++;
          this.recordRoomChallengeKill(target);
	          this.applyKillMomentum(target);
          if (this.player.stats.activeQuests) {
            onEnemyKilled(this.player.stats.activeQuests, target.typeKey);
          }
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

  private doTraitCleave(killedX: number, killedY: number, killedIdx: number) {
    const range = TILE_SIZE * 1.75;
    const cleaveDamage = Math.max(4, Math.floor(this.player.getAttackDamage(false) * 0.55));
    for (let j = this.enemies.length - 1; j >= 0; j--) {
      if (j === killedIdx) continue;
      const target = this.enemies[j];
      if (!target.active) continue;
      const dx = target.x - killedX;
      const dy = target.y - killedY;
      if (Math.sqrt(dx * dx + dy * dy) > range) continue;

      const dealt = target.takeDamage(cleaveDamage);
      this.spawnFloatingText(target.x, target.y - 20, `RIPOSTE -${dealt}`, 0xffa726, 11);
	      if (target.hp <= 0) {
        if (this.tryEnemyReform(target)) break;
	        this.player.gainXP(target.xp);
	        this.kills++;
        this.recordRoomChallengeKill(target);
	        this.applyKillMomentum(target);
        if (this.player.stats.activeQuests) {
          onEnemyKilled(this.player.stats.activeQuests, target.typeKey);
        }
        const idx = (target as Enemy & { _spawnIdx?: number })._spawnIdx;
        if (typeof idx === 'number') this.deadEnemyIndices.add(idx);
        this.spawnDeathEffect(target.x, target.y, target.typeKey);
        target.destroy();
        this.enemies.splice(j, 1);
      }
      break;
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
          this.applyChestObjectiveProgress(ctx, cty);

          // Quest progress: chest opened
          if (this.player.stats.activeQuests) {
            onChestOpened(this.player.stats.activeQuests);
          }

	          const { gold, items } = result.loot;
	          if (gold > 0) {
            const paidGold = this.hasRelic('chest_contract') ? gold * 2 : gold;
            this.addGold(paidGold);
            if (this.hasRelic('chest_contract')) {
              this.player.takeDamage(Math.max(1, Math.floor(this.player.stats.maxHp * 0.04)), true);
              this.spawnFloatingText(chest.x, chest.y - 38, 'PACT PAID', 0xce93d8, 11);
            }
	            this.spawnFloatingText(chest.x, chest.y - 20, `+${paidGold} gold`, COLORS.GOLD_TEXT);
	          }
          for (const lootItem of items) this.applyLootItem(lootItem);
          this.emitHUD();
        }
      }
    }
  }

  private applyLootItem(item: LootLike) {
    const s = this.player.stats;
    switch (item.type) {
      case 'HEALTH_POTION': this.player.heal(item.value ?? 30); this.events.emit("hud:status", `Found: ${item.label}`); break;
      case 'XP_ORB': this.player.gainXP(item.value ?? 40); this.events.emit("hud:status", `Found: ${item.label}`); break;
      case 'WEAPON':
        s.weaponBonus += item.bonus ?? 1; s.attack += item.bonus ?? 1;
        s.equippedWeaponLabel = item.label;
        s.weaponTrait = item.trait as WeaponTrait | undefined;
        this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} ATK${this.describeTrait(item.trait)})`);
        this.trackInventory(item, true);
        break;
      case 'ARMOR':
        s.armorBonus += item.bonus ?? 1; s.defense += item.bonus ?? 1;
        s.equippedArmorLabel = item.label;
        s.armorTrait = item.trait as ArmorTrait | undefined;
        this.player.refreshArmorWard();
        this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} DEF${this.describeTrait(item.trait)})`);
        this.trackInventory(item, true);
        break;
      case 'STAT_TOME':
        if (item.statKey) {
          const k = item.statKey as keyof typeof s;
          if (typeof s[k] === 'number') {
            (s as unknown as Record<string, number>)[item.statKey] += 1;
            this.player.recomputeDerived();
            this.events.emit("hud:status", `Read: ${item.label} (+1 ${item.statKey.toUpperCase()})`);
          }
        }
        this.trackInventory(item, false);
        break;
      case 'SCROLL':
        this.events.emit("hud:status", `Found scroll: ${item.label}`);
        this.trackInventory(item, false);
        break;
    }
    this.spawnFloatingText(this.player.x, this.player.y - 20, item.label, COLORS.GOLD_TEXT, 11);
  }

  private applyChestObjectiveProgress(tx: number, ty: number) {
    const objective = this.dungeon.floorObjective;
    if (!objective || this.floorObjectiveComplete || objective.type !== 'RAID_VAULT') return;
    const room = objective.roomIdx !== undefined ? this.dungeon.rooms[objective.roomIdx] : undefined;
    if (!room) return;
    if (tx < room.x || tx >= room.x + room.w || ty < room.y || ty >= room.y + room.h) return;

    this.floorObjectiveProgress = Math.min(objective.targetCount, this.floorObjectiveProgress + 1);
    if (this.floorObjectiveProgress >= objective.targetCount) this.completeFloorObjective();
  }

  private describeTrait(trait?: EquipmentTrait) {
    if (!trait) return '';
    const labels: Record<EquipmentTrait, string> = {
      cleaving: ', cleave on kill',
      quick: ', faster swings',
      vampiric: ', heal on kill',
      arcane: ', mana on kill',
      light: ', faster movement',
      reinforced: ', -1 damage taken',
      warded: ', first hit per room reduced',
    };
    return labels[trait];
  }

  private trackInventory(item: { type: string; label: string; bonus?: number; trait?: EquipmentTrait }, equipped: boolean) {
    const s = this.player.stats;
    if (!s.inventory) s.inventory = [];
    // Un-equip previous item of same type
    if (equipped) {
      const itemType = item.type as InventoryItem['type'];
      for (const inv of s.inventory) {
        if (inv.type === itemType && inv.equipped) inv.equipped = false;
      }
    }
    const typeMap: Record<string, InventoryItem['type']> = {
      'WEAPON': 'WEAPON', 'ARMOR': 'ARMOR', 'SCROLL': 'SCROLL', 'STAT_TOME': 'STAT_TOME',
    };
    s.inventory.push({
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: typeMap[item.type] ?? 'CONSUMABLE',
      label: item.label,
      bonus: item.bonus,
      equipped,
      floorFound: this.currentFloor,
      timestamp: Date.now(),
    });
    // Cap at 100
    if (s.inventory.length > 100) s.inventory = s.inventory.slice(-100);
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
	    switch (type) {
      case "CURSED_SHRINE": this.showCursedShrine(); break;
	      case "HEALTH_POTION": this.player.heal(30); this.events.emit("hud:status", "Health Potion +30 HP"); break;
      case "WEAPON":
        this.applyLootItem(this.rollFloorEquipment('WEAPON'));
        this.spawnFloatingText(this.player.x, this.player.y - 30, "WEAPON", COLORS.WEAPON);
        this.emitHUD(); break;
      case "ARMOR":
        this.applyLootItem(this.rollFloorEquipment('ARMOR'));
        this.spawnFloatingText(this.player.x, this.player.y - 30, "ARMOR", COLORS.ARMOR);
        this.emitHUD(); break;
      case "XP_ORB": this.player.gainXP(40); this.events.emit("hud:status", "XP Orb +40 XP"); break;
    }
  }

  private rollFloorEquipment(type: 'WEAPON' | 'ARMOR'): LootLike {
    if (type === 'WEAPON') {
      const weapons: LootLike[] = [
        { type, label: 'Scout Dagger +2 [Quick]', bonus: 2, trait: 'quick' },
        { type, label: 'Hungry Mace +2 [Drain]', bonus: 2, trait: 'vampiric' },
        { type, label: 'Notched Axe +2 [Cleave]', bonus: 2, trait: 'cleaving' },
        { type, label: 'Runed Staff +2 [Arcane]', bonus: 2, trait: 'arcane' },
      ];
      return weapons[Phaser.Math.Between(0, weapons.length - 1)];
    }
    const armors: LootLike[] = [
      { type, label: 'Traveler Leather +1 [Light]', bonus: 1, trait: 'light' },
      { type, label: 'Guard Mail +1 [Guard]', bonus: 1, trait: 'reinforced' },
      { type, label: 'Warded Scale +1 [Ward]', bonus: 1, trait: 'warded' },
    ];
    return armors[Phaser.Math.Between(0, armors.length - 1)];
  }

  private showCursedShrine() {
    if (this._shrineDialogOpen) return;
    this._shrineDialogOpen = true;
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const D = 220;
    const s = this.player.stats;

    const options = [
      {
        title: 'Blood for Fire',
        relic: 'ember_idol' as RelicKey,
        lines: ['Lose 8 max HP', 'First kill in each room grants Rush'],
        color: 0xff5a5f,
        pay: () => { s.maxHp = Math.max(20, s.maxHp - 8); s.hp = Math.min(s.hp, s.maxHp); },
      },
      {
        title: 'Vow of Greed',
        relic: 'chest_contract' as RelicKey,
        lines: ['Chests pay double gold', 'Each chest bites for a little HP'],
        color: 0xffd166,
        pay: () => this.player.takeDamage(Math.max(2, Math.floor(s.maxHp * 0.08)), true),
      },
      {
        title: 'Black Candle',
        relic: 'black_candle' as RelicKey,
        lines: ['Room gambits pay double', 'Lose half current mana or 1 potion'],
        color: 0xce93d8,
        pay: () => {
          if (s.maxMana > 0) s.mana = Math.floor(s.mana / 2);
          else s.potions = Math.max(0, s.potions - 1);
        },
      },
    ];

    const els = this._shrineDialogElements;
    els.push(this.add.rectangle(cx, cy, W, H, 0x000000, 0.62).setScrollFactor(0).setDepth(D));
    els.push(this.add.rectangle(cx, cy, 690, 300, 0x120812, 0.98).setStrokeStyle(2, 0xce93d8).setScrollFactor(0).setDepth(D));
    els.push(this.add.text(cx, cy - 118, 'Cursed Shrine', {
      fontSize: '22px', color: '#ce93d8', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    els.push(this.add.text(cx, cy - 88, 'Pick a relic. The dungeon takes its price now.', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    options.forEach((option, i) => {
      const x = cx - 220 + i * 220;
      const card = this.add.rectangle(x, cy + 20, 200, 190, 0x160f1f, 0.98)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, option.color)
        .setScrollFactor(0)
        .setDepth(D);
      els.push(card);
      els.push(this.add.text(x, cy - 50, option.title, {
        fontSize: '14px', color: `#${option.color.toString(16).padStart(6, '0')}`, fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
      option.lines.forEach((line, lineIdx) => {
        els.push(this.add.text(x - 82, cy - 16 + lineIdx * 24, line, {
          fontSize: '11px', color: '#c9bed6', fontFamily: 'monospace',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D));
      });
      const take = () => {
        option.pay();
        this.grantRelic(option.relic);
        this.closeCursedShrine();
        this.emitHUD();
      };
      card.on('pointerover', () => card.setFillStyle(0x241432));
      card.on('pointerout', () => card.setFillStyle(0x160f1f));
      card.on('pointerdown', take);
      els.push(this.add.text(x, cy + 88, 'TAKE BARGAIN', {
        fontSize: '11px', color: '#ffffff', fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    });
  }

  private closeCursedShrine() {
    this._shrineDialogElements.forEach(e => e.destroy());
    this._shrineDialogElements = [];
    this._shrineDialogOpen = false;
  }

	  // ── Potions ────────────────────────────────────────────────────────────────

  private checkPotionInput() {
    if (!this._fKey) this._fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (!this._mKey) this._mKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);

	    if (Phaser.Input.Keyboard.JustDown(this._fKey)) {
	      if (this.player.stats.potions > 0) {
	        this.player.stats.potions--;
	        this.player.heal(50);
        if (this.hasRelic('swift_vial')) this.player.addEffect('RUSHED', 4500);
	        this.spawnFloatingText(this.player.x, this.player.y - 30, 'Potion! +50 HP', COLORS.HEAL_TEXT, 12);
        this.events.emit("hud:status", `Used Health Potion (${this.player.stats.potions} left)`);
        this.emitHUD();
      } else { this.events.emit("hud:status", "No potions left!"); }
    }

	    if (Phaser.Input.Keyboard.JustDown(this._mKey)) {
	      if (this.player.stats.manaPotions > 0 && this.player.stats.maxMana > 0) {
	        this.player.stats.manaPotions--;
	        this.player.restoreMana(40);
        if (this.hasRelic('swift_vial')) this.player.addEffect('RUSHED', 4500);
        this.spawnFloatingText(this.player.x, this.player.y - 30, '+40 Mana', COLORS.MANA_BAR, 12);
        this.events.emit("hud:status", `Used Mana Potion (${this.player.stats.manaPotions} left)`);
        this.emitHUD();
      } else if (this.player.stats.maxMana === 0) {
        this.events.emit("hud:status", "Your class doesn't use mana!");
      } else { this.events.emit("hud:status", "No mana potions left!"); }
    }
  }

  // ── Quest special room entry ──────────────────────────────────────────────

  private checkRoomEvents(ptx: number, pty: number) {
    const roomIdx = this.dungeon.rooms.findIndex(room =>
      ptx >= room.x && ptx < room.x + room.w && pty >= room.y && pty < room.y + room.h
    );
    if (roomIdx < 0) return;

    const room = this.dungeon.rooms[roomIdx];
    if (roomIdx !== this._lastPlayerRoomIdx) {
      this._lastPlayerRoomIdx = roomIdx;
      this.player.refreshArmorWard();
      if (this.player.stats.armorTrait === 'warded') {
        this.spawnFloatingText(this.player.x, this.player.y - 42, 'WARD READY', 0x80d8ff, 10);
      }
    }
	    if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'monster_closet') {
	      this._triggeredRoomEvents.add(roomIdx);
	      this.events.emit("hud:status", "Den ambush! Hold the room for streak rewards.");
      this.spawnFloatingText(this.player.x, this.player.y - 48, 'AMBUSH!', 0xff5a5f, 16);
      const pool: EnemyTypeKey[] = this.currentFloor >= 4
        ? ['SKELETON', 'FAST', 'DARK_ELF']
        : ['GIANT_RAT', 'GIANT_SPIDER', 'BASIC'];
      for (let i = 0; i < 2; i++) {
        const type = pool[Phaser.Math.Between(0, pool.length - 1)];
	        this.spawnRoomEnemy(roomIdx, type, i === 0 && !this.enemies.some(e => e.isElite));
	      }
      this.startRoomChallenge(roomIdx);
	    } else if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'trap_corridor') {
      this._triggeredRoomEvents.add(roomIdx);
      let found = 0;
      for (const trap of this.dungeon.traps) {
        const key = `${trap.tx},${trap.ty}`;
        if (this.triggeredTrapKeys.has(key) || this.detectedTraps.has(key)) continue;
        if (trap.tx >= room.x && trap.tx < room.x + room.w && trap.ty >= room.y && trap.ty < room.y + room.h) {
          this.detectTrap(key, trap.tx, trap.ty, trap.type, 'search');
          found++;
        }
      }
      this.events.emit("hud:status", found > 0 ? `Rune room: ${found} hazards revealed.` : 'Rune room: the floor hums, but seems safe.');
	    } else if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'vault') {
	      this._triggeredRoomEvents.add(roomIdx);
	      this.events.emit("hud:status", "Vault found. Loot the hoard before you leave.");
	      this.spawnFloatingText(this.player.x, this.player.y - 44, 'VAULT', 0xffd166, 14);
    } else if (!this._triggeredRoomEvents.has(roomIdx)) {
      this._triggeredRoomEvents.add(roomIdx);
      this.startRoomChallenge(roomIdx);
	    }

    if (room.modifier && !this._triggeredRoomModifiers.has(roomIdx)) {
      this._triggeredRoomModifiers.add(roomIdx);
      this.triggerRoomModifier(roomIdx, room.modifier);
    }
  }

  private triggerRoomModifier(roomIdx: number, modifier: NonNullable<DungeonData['rooms'][number]['modifier']>) {
    if (modifier === 'blood_rune') {
      this.player.addEffect('RUSHED', 9000);
      this.spawnFloatingText(this.player.x, this.player.y - 56, 'BLOOD RUNE', 0xff5a5f, 14);
      this.events.emit("hud:status", "Blood Rune: move fast and chain kills for extra momentum.");
      const pool: EnemyTypeKey[] = this.currentFloor >= 5 ? ['FAST', 'DARK_ELF', 'SKELETON'] : ['GIANT_RAT', 'GIANT_SPIDER', 'BASIC'];
      this.spawnRoomEnemy(roomIdx, pool[Phaser.Math.Between(0, pool.length - 1)]);
    } else if (modifier === 'healing_font') {
      const heal = Math.ceil(this.player.stats.maxHp * 0.35);
      this.player.heal(heal);
      if (this.player.stats.maxMana > 0) this.player.restoreMana(Math.ceil(this.player.stats.maxMana * 0.45));
      this.spawnFloatingText(this.player.x, this.player.y - 56, 'FONT', 0x69f0ae, 14);
      this.events.emit("hud:status", "Healing Font: recovered HP and mana.");
    } else if (modifier === 'cursed_crypt') {
      this.player.addEffect('SHIELDED', 7000, 2);
      this.spawnRoomEnemy(roomIdx, this.currentFloor >= 5 ? 'GHOST' : 'ZOMBIE', true);
      this.spawnFloatingText(this.player.x, this.player.y - 56, 'CURSED CRYPT', 0xce93d8, 14);
      this.events.emit("hud:status", "Cursed Crypt: a champion rises, but clearing it pays bonus XP.");
    } else if (modifier === 'gilded_cache') {
      this.spawnFloatingText(this.player.x, this.player.y - 56, 'GILDED CACHE', 0xffd166, 14);
      this.events.emit("hud:status", "Gilded Cache: clear the room for a rich bonus.");
    }
  }

  private spawnRoomEnemy(roomIdx: number, type: EnemyTypeKey, elite = false) {
    const room = this.dungeon.rooms[roomIdx];
    if (!room || !this.enemyGroup) return;
    const tx = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
    const ty = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
    const enemy = new Enemy(this, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, type, elite);
    (enemy as Enemy & { _roomIdx?: number })._roomIdx = roomIdx;
    this.enemies.push(enemy);
    this.enemyGroup.add(enemy);
    this.physics.add.collider(enemy, this.wallGroup);
    this.spawnFloatingText(enemy.x, enemy.y - 24, elite ? 'CHAMPION!' : 'JOINED!', elite ? 0xffd166 : 0xff5a5f, elite ? 13 : 10);
  }

  private checkSpecialRoomEntry() {
    if (!this.dungeon.questRooms || this.dungeon.questRooms.length === 0) return;
    if (!this.player.stats.activeQuests) return;

    const ptx = Math.floor(this.player.x / TILE_SIZE);
    const pty = Math.floor(this.player.y / TILE_SIZE);

    for (const qr of this.dungeon.questRooms) {
      if (this._enteredQuestRooms.has(qr.tag)) continue;
      const room = this.dungeon.rooms[qr.roomIdx];
      if (!room) continue;
      if (ptx >= room.x && ptx < room.x + room.w && pty >= room.y && pty < room.y + room.h) {
        this._enteredQuestRooms.add(qr.tag);
        if (onSpecialRoomEntered(this.player.stats.activeQuests, qr.tag)) {
          this.spawnFloatingText(this.player.x, this.player.y - 40, `Found: ${room.tag ?? qr.tag}!`, 0xffd700, 16);
          this.events.emit("hud:status", `Quest room discovered: ${room.tag ?? qr.tag}`);
        }
      }
    }
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs() {
    const { tx, ty } = this.dungeon.stairsPos;
	    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
	    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
	    const dx = this.player.x - sx;
	    const dy = this.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.7) {
      if (this.dungeon.floorObjective?.type === 'CLAIM_KEY' && !this.floorObjectiveComplete) {
        this.spawnFloatingText(sx, sy - 28, 'SEALED', 0xce93d8, 12);
        this.events.emit("hud:status", "The stairs are sealed. Defeat the guardian and claim the key.");
        return;
      }
      this.nextFloor();
    }
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
    // Quest progress: floor reached
    if (this.player.stats.activeQuests) {
      onFloorReached(this.player.stats.activeQuests, this.currentFloor + 1);
    }
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
          name: stats.name || `${cls.name} Lv ${stats.level}`,
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
        gold: this.player.stats.runGoldEarned ?? 0,
        bestStreak: this.player.stats.runBestStreak ?? 0,
        relics: this.player.stats.relics ?? [],
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
