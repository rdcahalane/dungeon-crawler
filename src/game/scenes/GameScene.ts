import * as Phaser from "phaser";
import type { PlayerStats, CharCreationData, Player } from "../entities/Player";
import {
  TILE, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, SPELLS, getFloorThemeIdx,
} from "../constants";
import { generateDungeon, DungeonData } from "../systems/DungeonGenerator";
import { buildTombFloor } from "../world/stamp";
import { TOMB_FLOOR } from "../constants";
import type { Enemy } from "../entities/Enemy";
import { GameEventBus } from "../GameEvents";
import type { GameContext, RelicKey } from "../GameContext";
import { MapController } from "./game/MapController";
import { CombatController } from "./game/CombatController";
import { TrapController } from "./game/TrapController";
import { LootController } from "./game/LootController";
import { RoomEventController } from "./game/RoomEventController";
import { FloorController } from "./game/FloorController";
import { SpellInputController } from "./game/SpellInputController";
import { FloatingTextController } from "./game/FloatingText";
import { MechanismController } from "./game/MechanismController";
import { InputController } from "./game/InputController";
import { buildHudExtras } from "./game/AdndHud";

interface GameSceneInit {
  floor?: number;
  charData?: CharCreationData;
  persistedStats?: PlayerStats;
  saveSlot?: number;
  specialRoomTags?: string[];
}

interface Disposable { destroy(): void }

/**
 * Thin orchestrator. The behavior lives in controllers under `./game/`; this class builds the
 * `GameContext`, constructs the controllers in `create()`, and calls them from `update()` in the
 * same order the old monolith ran things. See `src/game/GameContext.ts` and `src/game/GameEvents.ts`.
 */
export class GameScene extends Phaser.Scene {
  private ctx!: GameContext;
  private controllers: Disposable[] = [];
  private currentFloor = 1;
  private saveSlot = 1;
  private persist: GameContext["persist"] = GameScene.emptyPersist();
  private initData: GameSceneInit = {};
  private readonly bus = new GameEventBus();

  constructor() {
    super({ key: "GameScene" });
  }

  /**
   * The typed gameplay event bus (`player_hit`, `gold`, `floor_enter`, ...). One bus for the life of
   * this scene object; it is NOT cleared when a floor change restarts the scene, so unsubscribe (or use
   * `bus.scope()` and `dispose()` it in a controller's `destroy()`). See `GameEvents.ts` for the events.
   */
  get gameEvents(): GameEventBus {
    return this.bus;
  }

  /** Alias of `gameEvents` for code that already has `scene.events` (Phaser's own emitter) in mind. */
  get events2(): GameEventBus {
    return this.bus;
  }

  /** The current floor's context (undefined before the first `create()`). */
  get gameContext(): GameContext | undefined {
    return this.ctx;
  }

  private static emptyPersist(): GameContext["persist"] {
    return {
      deadEnemyIndices: new Set<number>(),
      triggeredTrapKeys: new Set<string>(),
      openedChestKeys: new Set<string>(),
      pickedItemKeys: new Set<string>(),
      revealedDoorKeys: new Set<string>(),
    };
  }

  init(data: GameSceneInit) {
    // The scene object is reused across floors: drop the previous floor's dialogs and transient state.
    this.disposeControllers();
    this.currentFloor = data?.floor ?? 1;
    this.saveSlot = data?.saveSlot ?? data?.persistedStats?.saveSlot ?? 1;
    this.initData = data ?? {};

    // Load per-floor persistent state if available
    const sf = data?.persistedStats?.savedDungeons?.[this.currentFloor];
    if (sf) {
      this.persist = {
        deadEnemyIndices: new Set(sf.deadEnemyIndices),
        triggeredTrapKeys: new Set(sf.triggeredTrapKeys),
        openedChestKeys: new Set(sf.openedChestKeys),
        pickedItemKeys: new Set(sf.pickedItemKeys),
        revealedDoorKeys: new Set(sf.revealedDoorKeys),
        mechStateJson: sf.mechStateJson,
      };
    } else {
      this.persist = GameScene.emptyPersist();
    }
  }

  create() {
    const sf = this.initData.persistedStats?.savedDungeons?.[this.currentFloor];
    if (this.initData.persistedStats) {
      this.initData.persistedStats.runDeepestFloor = Math.max(this.initData.persistedStats.runDeepestFloor ?? 0, this.currentFloor);
    }

    let dungeon: DungeonData;
    let baseDungeon: DungeonData;
    if (sf) {
      // Restore saved dungeon layout
      baseDungeon = sf.dungeonData;
      // Deep copy the base dungeon as our working copy, then apply saved changes
      dungeon = JSON.parse(JSON.stringify(sf.dungeonData)) as DungeonData;
      // Apply triggered traps → they become passable floor
      for (const key of this.persist.triggeredTrapKeys) {
        const [tx, ty] = key.split(',').map(Number);
        if (dungeon.tiles[ty]?.[tx] !== undefined) {
          (dungeon.tiles[ty] as number[])[tx] = TILE.FLOOR;
        }
      }
      // Apply revealed secret doors → become passable floor
      for (const key of this.persist.revealedDoorKeys) {
        const [tx, ty] = key.split(',').map(Number);
        if (dungeon.tiles[ty]?.[tx] !== undefined) {
          (dungeon.tiles[ty] as number[])[tx] = TILE.FLOOR;
        }
      }
    } else {
      // Generate a fresh dungeon for this floor
      dungeon = this.currentFloor >= TOMB_FLOOR ? buildTombFloor() : generateDungeon(this.currentFloor, this.initData.specialRoomTags);
      // Store the original as base BEFORE any runtime modifications
      baseDungeon = JSON.parse(JSON.stringify(dungeon)) as DungeonData;
    }

    this.physics.world.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    const ctx = this.buildContext(dungeon, baseDungeon);
    this.ctx = ctx;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disposeControllers());

    ctx.map.buildTilemap();
    ctx.mech.create();
    ctx.combat.spawnPlayer(this.initData.charData, this.initData.persistedStats);
    ctx.map.spawnTorchGlow();
    ctx.combat.spawnEnemies();
    ctx.loot.spawnItems();
    ctx.loot.spawnChests();
    ctx.map.initFog();
    ctx.map.setupCamera();
    ctx.input.create();
    ctx.spells.create();

    if (!this.scene.isActive("HUDScene")) {
      this.scene.launch("HUDScene");
    }
    this.emitHUD();
    this.bus.emit('floor_enter', { floor: this.currentFloor, theme: getFloorThemeIdx(this.currentFloor) });
  }

  /** Builds this floor's context and all controllers. Fields not known yet (player, groups) are filled by the controllers. */
  private buildContext(dungeon: DungeonData, baseDungeon: DungeonData): GameContext {
    const ctx = {
      scene: this,
      bus: this.bus,
      dungeon,
      baseDungeon,
      enemies: [] as Enemy[],
      currentFloor: this.currentFloor,
      saveSlot: this.saveSlot,
      persist: this.persist,
      run: {
        kills: 0,
        killStreak: 0,
        killStreakTimer: 0,
        floorObjectiveProgress: 0,
        floorObjectiveComplete: false,
      },
      floatText: (x: number, y: number, text: string, color: number, size?: number) =>
        ctx.text.spawn(x, y, text, color, size),
      status: (msg: string) => {
        this.events.emit("hud:status", msg);
        this.bus.emit('status', { text: msg });
      },
      emitHUD: () => this.emitHUD(),
      isWalkable: (tx: number, ty: number) => {
        if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return false;
        const t = ctx.dungeon.tiles[ty]?.[tx];
        if (t === undefined || t === TILE.WALL || t === TILE.SECRET_DOOR) return false;
        return !ctx.mech.isBlocked(tx, ty);
      },
      addGold: (amount: number) => {
        if (amount <= 0) return;
        ctx.player.stats.gold += amount;
        ctx.player.stats.runGoldEarned = (ctx.player.stats.runGoldEarned ?? 0) + amount;
        this.bus.emit('gold', { amount });
      },
      hasRelic: (key: RelicKey) => ctx.player.stats.relics?.includes(key) ?? false,
    } as unknown as GameContext;

    ctx.text = new FloatingTextController(ctx);
    ctx.map = new MapController(ctx);
    ctx.mech = new MechanismController(ctx);
    ctx.traps = new TrapController(ctx);
    ctx.combat = new CombatController(ctx);
    ctx.loot = new LootController(ctx);
    ctx.rooms = new RoomEventController(ctx);
    ctx.floor = new FloorController(ctx);
    ctx.spells = new SpellInputController(ctx);
    ctx.input = new InputController(ctx);
    this.controllers = [
      ctx.text, ctx.map, ctx.mech, ctx.traps, ctx.combat, ctx.loot, ctx.rooms, ctx.floor, ctx.spells, ctx.input,
    ];
    return ctx;
  }

  private disposeControllers() {
    for (const c of this.controllers) c.destroy();
    this.controllers = [];
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  emitHUD() {
    const ctx = this.ctx;
    if (!ctx?.player) return;
    const s = ctx.player.stats;
    const spellHotkeyMap = ctx.spells.spellHotkeyMap;
    this.events.emit("hud:update", {
      // B2: first-edition numbers (spellSlots, thac0, ac, saves, torchSeconds, title, gold), see AdndHud.ts.
      ...buildHudExtras(s, ctx.player.inventory, ctx.player.spellbook),
      hp: s.hp, maxHp: s.maxHp,
      attack: s.attack, defense: s.defense,
      level: s.level, xp: s.xp, xpToNext: s.xpToNext,
      floor: ctx.currentFloor, kills: ctx.run.kills,
      mana: s.mana, maxMana: s.maxMana,
      classKey: s.classKey,
      name: s.name,
      effects: s.effects,
      spellKeys: spellHotkeyMap,
      spellCooldowns: spellHotkeyMap.map(k => ctx.spells.spellSystem?.getRemainingCooldown(k) ?? 0),
      spellManaCosts: spellHotkeyMap.map(k => SPELLS[k]?.manaCost ?? 0),
      potions: s.potions,
      manaPotions: s.manaPotions,
      gold: s.gold,
      floorObjective: ctx.dungeon.floorObjective
        ? {
            title: ctx.dungeon.floorObjective.title,
            detail: ctx.dungeon.floorObjective.detail,
            progress: ctx.run.floorObjectiveProgress,
            target: ctx.dungeon.floorObjective.targetCount,
            complete: ctx.run.floorObjectiveComplete,
          }
        : undefined,
      activeQuests: s.activeQuests,
      completedQuests: s.completedQuests,
      inventory: s.inventory,
      equippedWeaponLabel: s.equippedWeaponLabel,
      equippedArmorLabel: s.equippedArmorLabel,
    });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    const ctx = this.ctx;
    const player: Player | undefined = ctx?.player;
    if (!player || player.stats.hp <= 0) return;
    if (ctx.floor.restDialogOpen) return; // pause all gameplay during rest dialog
    if (ctx.rooms.boonDialogOpen) return; // choose a build-defining reward before continuing
    if (ctx.rooms.shrineDialogOpen) return;

    ctx.input.update(delta); // placeholder: runs before the player so it can set movement intent
    player.update(delta);
    ctx.combat.tickKillStreak(delta);
    ctx.rooms.updateRoomChallenge(delta);

    const curTx = Math.floor(player.x / TILE_SIZE);
    const curTy = Math.floor(player.y / TILE_SIZE);

    // Torch glow flicker + fog of war
    ctx.map.update(curTx, curTy);

    // Mechanisms (placeholder until the mechanism lane fills it in)
    ctx.mech.update(delta, curTx, curTy);

    // Trap detection (passive + G key), disarm, triggering, secret door hover
    ctx.traps.update(curTx, curTy);

    // Turn undead
    player.tryTurnUndead();

    // Spells
    ctx.spells.update();

    // Attack
    ctx.combat.updatePlayerAttack();

    // Enemy update, enemy bolts
    ctx.combat.updateEnemies(delta);
    ctx.combat.updateEnemyProjectiles(delta);

    // Chests, floor items, potions
    ctx.loot.update();

    // Room events, special rooms, stairs
    ctx.rooms.update(curTx, curTy);
    ctx.floor.update();

    ctx.text.update(delta);
    ctx.spells.tick(delta);

    this.emitHUD();
  }
}
