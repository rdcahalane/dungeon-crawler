import * as Phaser from "phaser";
import { TILE_SIZE, COLORS, ChestTier, ChestState, TrapTypeKey } from "../constants";
import { d100 } from "../rules";
import { mathRng } from "../rules";
import { LootTable, LootResult } from "../systems/LootTable";

export interface ChestInteractResult {
  opened: boolean;
  loot?: LootResult;
  trapTriggered?: TrapTypeKey;
  message?: string;
}

export class TreasureChest extends Phaser.GameObjects.Container {
  public tier: ChestTier;
  public chestState: ChestState;
  public trapType?: TrapTypeKey;
  public isMimic: boolean;

  private sprite!: Phaser.GameObjects.Rectangle;
  private lockIcon!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private _promptVisible = false;

  // Mimic: reference to an enemy spawn callback
  onMimicReveal?: (x: number, y: number) => void;

  constructor(
    scene: Phaser.Scene, x: number, y: number,
    tier: ChestTier = 'wooden',
    trapped?: TrapTypeKey,
    isMimic = false,
  ) {
    super(scene, x, y);
    scene.add.existing(this);

    this.tier = tier;
    this.chestState = trapped ? 'trapped' : 'locked';
    this.trapType = trapped;
    this.isMimic = isMimic;

    this.setDepth(3);
    this._buildSprite();

    // "E to open" prompt
    this.promptText = scene.add.text(0, -TILE_SIZE - 4, 'E: Open', {
      fontSize: '10px',
      color: '#ffffff',
      fontFamily: 'monospace',
      backgroundColor: '#00000088',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5).setDepth(25).setVisible(false);
    this.add(this.promptText);
  }

  private _buildSprite() {
    const size = TILE_SIZE - 4;

    // Choose chest color by tier
    const colors: Record<ChestTier, number> = {
      wooden: COLORS.CHEST_WOODEN,
      iron: COLORS.CHEST_IRON,
      golden: COLORS.CHEST_GOLDEN,
    };

    const color = this.isMimic ? COLORS.ENEMY_MIMIC : colors[this.tier];

    // Chest body
    this.sprite = this.scene.add.rectangle(0, 0, size, size - 4, color);
    this.sprite.setDepth(3);
    this.add(this.sprite);

    // Lock icon
    const lockColor = this.chestState === 'trapped' ? '#ff1744' : '#ffffff';
    this.lockIcon = this.scene.add.text(0, 0, this.isMimic ? '?' : (this.chestState === 'trapped' ? '☠' : '🔒'), {
      fontSize: '12px',
      color: lockColor,
      fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(4);
    this.add(this.lockIcon);
  }

  setPromptVisible(visible: boolean) {
    if (visible === this._promptVisible) return;
    this._promptVisible = visible;
    this.promptText.setVisible(visible);

    if (visible) {
      // Pulse effect
      this.scene.tweens.add({
        targets: this.promptText,
        scaleX: 1.1, scaleY: 1.1,
        duration: 400,
        yoyo: true,
        repeat: -1,
      });
    } else {
      this.scene.tweens.killTweensOf(this.promptText);
      this.promptText.setScale(1);
    }
  }

  /**
   * Try to open the chest. Returns result describing what happened.
   * clasKey and relevant ability scores are needed for lock-picking/bashing.
   */
  tryOpen(classKey: string, strMod: number, dexMod: number, level: number, floor: number, openLocksPct = 0): ChestInteractResult {
    if (this.chestState === 'open') {
      return { opened: false, message: 'Already open.' };
    }

    // Mimic reveal
    if (this.isMimic) {
      this.onMimicReveal?.(this.x, this.y);
      this.destroy();
      return { opened: false, message: 'It\'s a MIMIC!' };
    }

    // Check if trap fires
    if (this.chestState === 'trapped' && this.trapType) {
      const trap = this.trapType;
      this.chestState = 'locked'; // trap sprung, chest is now just locked
      this.lockIcon.setText('🔒');
      this.lockIcon.setColor('#ffffff');
      return {
        opened: false,
        trapTriggered: trap,
        message: `Trapped chest! ${trap} triggered!`,
      };
    }

    // Lock picking / bashing
    let canOpen = false;

    if (classKey === 'thief') {
      // Thief: "open locks" in percent (d100 at or under the skill, eased on a wooden chest, harder on a golden one).
      const adj = this.tier === 'wooden' ? 20 : this.tier === 'iron' ? 0 : -15;
      const need = Math.max(5, Math.min(97, openLocksPct + adj));
      const roll = d100(mathRng);
      canOpen = roll <= need;
      if (!canOpen) return { opened: false, message: `Failed to pick lock! (rolled ${roll}, needed ${need} or less)` };
      void dexMod; void level;
    } else if (classKey === 'fighter') {
      // Fighter: bash (1d20 + str mod >= DC 12/15/18)
      const dc = this.tier === 'wooden' ? 12 : this.tier === 'iron' ? 15 : 18;
      const roll = Math.floor(Math.random() * 20) + 1 + strMod;
      canOpen = roll >= dc;
      if (!canOpen) return { opened: false, message: `Failed to bash open! (rolled ${roll}, needed ${dc})` };
    } else {
      // Others: need key (auto-open wooden, fail others for now)
      canOpen = this.tier === 'wooden';
      if (!canOpen) return { opened: false, message: 'Need a key to open this chest.' };
    }

    // Open it!
    this.chestState = 'open';
    this.lockIcon.setText('✓');
    this.lockIcon.setColor('#69f0ae');
    this.sprite.setFillStyle(0x555555); // darkened open chest
    this.promptText.setVisible(false);

    const loot = LootTable.rollLoot(floor, this.tier);
    return { opened: true, loot, message: `Opened ${this.tier} chest!` };
  }

  /** Knock and the like: open without a roll or a trap. Null if it is already open or is a mimic. */
  forceOpen(floor: number): ChestInteractResult | null {
    if (this.chestState === 'open' || this.isMimic) return null;
    this.chestState = 'open';
    this.lockIcon.setText('✓');
    this.lockIcon.setColor('#69f0ae');
    this.sprite.setFillStyle(0x555555);
    this.promptText.setVisible(false);
    return { opened: true, loot: LootTable.rollLoot(floor, this.tier), message: `The ${this.tier} chest springs open.` };
  }

  // Thief auto-detects traps when within 4 tiles
  isTrapped(): boolean {
    return this.chestState === 'trapped' && !!this.trapType;
  }

  destroy(fromScene?: boolean) {
    // Kill any running tweens
    if (this.scene) {
      this.scene.tweens.killTweensOf(this.promptText);
    }
    super.destroy(fromScene);
  }
}
