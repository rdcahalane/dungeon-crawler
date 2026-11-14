/**
 * Shared context handed to every controller under `scenes/game/`.
 *
 * `GameScene` builds a fresh context in each `create()` (a floor change restarts the scene, so everything
 * here is per floor), constructs the controllers with it, and fills the fields as the floor comes up.
 * Controllers read `ctx.player`, `ctx.dungeon` and friends at call time, never cache them in constructors.
 *
 * Add helpers here, not controller-to-controller imports of private state. Reach another concern through
 * `ctx.<controller>.method()` (declared below; type-only imports, so there is no runtime cycle).
 */
import type * as Phaser from "phaser";
import type { Player, PlayerStats } from "./entities/Player";
import type { Enemy } from "./entities/Enemy";
import type { DungeonData } from "./systems/DungeonGenerator";
import type { GameEventBus } from "./GameEvents";
import type { MapController } from "./scenes/game/MapController";
import type { CombatController } from "./scenes/game/CombatController";
import type { TrapController } from "./scenes/game/TrapController";
import type { LootController } from "./scenes/game/LootController";
import type { RoomEventController } from "./scenes/game/RoomEventController";
import type { FloorController } from "./scenes/game/FloorController";
import type { SpellInputController } from "./scenes/game/SpellInputController";
import type { FloatingTextController } from "./scenes/game/FloatingText";
import type { MechanismController } from "./scenes/game/MechanismController";
import type { InputController } from "./scenes/game/InputController";

/** Per-floor state that survives leaving and re-entering a floor (written into `SerializedFloor`). */
export interface FloorPersist {
  deadEnemyIndices: Set<number>;
  /** "tx,ty" keys of traps already triggered or disarmed. */
  triggeredTrapKeys: Set<string>;
  openedChestKeys: Set<string>;
  pickedItemKeys: Set<string>;
  revealedDoorKeys: Set<string>;
  /** Saved `MechanismController.serialize()` output for this floor, if any (read by the mechanism lane). */
  mechStateJson?: string;
}

/** Counters for the current visit to a floor. Reset on every `create()` like the old scene fields were. */
export interface RunState {
  kills: number;
  killStreak: number;
  killStreakTimer: number;
  floorObjectiveProgress: number;
  floorObjectiveComplete: boolean;
}

export type RelicKey = 'ember_idol' | 'swift_vial' | 'chest_contract' | 'black_candle' | 'boss_trophy';

export interface GameContext {
  scene: Phaser.Scene;
  readonly bus: GameEventBus;

  // ── World state ──────────────────────────────────────────────────────────
  player: Player;
  /** Working copy of the dungeon (tiles mutate as traps fire and doors open). */
  dungeon: DungeonData;
  /** Original unmodified dungeon, the one that gets serialized. */
  baseDungeon: DungeonData;
  /** Live enemies. Same array instance for the whole floor; controllers splice it in place. */
  readonly enemies: Enemy[];
  enemyGroup: Phaser.Physics.Arcade.Group;
  wallGroup: Phaser.Physics.Arcade.StaticGroup;
  currentFloor: number;
  saveSlot: number;
  persist: FloorPersist;
  run: RunState;

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Floating combat/status text above a world position. */
  floatText(x: number, y: number, text: string, color: number, size?: number): void;
  /** HUD status line (also emitted on the bus as `status`). */
  status(msg: string): void;
  /** Push current stats to the HUD (`hud:update` on the scene events). */
  emitHUD(): void;
  /** Walkable by the player's rules: in bounds, not a wall or hidden door, and not blocked by a mechanism. */
  isWalkable(tx: number, ty: number): boolean;
  addGold(amount: number): void;
  hasRelic(key: RelicKey): boolean;
  /** True while an in-scene modal (inscription, riddle, offering) has taken the keyboard. Other input code should stand down. */
  modalOpen?: boolean;

  // ── UI hooks (optional: the HUD falls back to `player.inventory` when a method is absent) ──
  /** Use the item on belt slot `index` (keys 5 to 8). */
  useBelt?(index: number): void;
  /** Drop a pack or belt item onto the floor. */
  dropItem?(itemId: string): void;
  equipItem?(itemId: string): void;
  unequipSlot?(slot: string): void;
  /** True while a puzzle dialog is open: the HUD ignores mouse and hotkeys then. */
  modalOpen?: boolean;

  // ── Controllers ──────────────────────────────────────────────────────────
  map: MapController;
  combat: CombatController;
  traps: TrapController;
  loot: LootController;
  rooms: RoomEventController;
  floor: FloorController;
  spells: SpellInputController;
  text: FloatingTextController;
  mech: MechanismController;
  input: InputController;
}

export type { PlayerStats };
