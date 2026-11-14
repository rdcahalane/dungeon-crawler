import * as Phaser from "phaser";
import type { PlayerStats } from "../../entities/Player";
import type { SerializedFloor } from "../../systems/DungeonGenerator";
import { TILE_SIZE } from "../../constants";
import { onFloorReached } from "../../systems/QuestSystem";
import { saveGame } from "../../systems/SaveStore";
import type { GameContext } from "../../GameContext";

type RestType = 'short' | 'long';

/** Stairs, the rest dialog, floor serialization, autosave, floor transitions and player death. */
export class FloorController {
  private _restDialogOpen = false;
  private _restDialogElements: Phaser.GameObjects.GameObject[] = [];
  private _exitEmitted = false;
  private _deathEmitted = false;

  constructor(private ctx: GameContext) {}

  /** True while the rest dialog has the game paused. */
  get restDialogOpen(): boolean {
    return this._restDialogOpen;
  }

  /** Stairs down, then stairs up, in the old order. */
  update() {
    this.checkStairs();
    this.checkStairsUp();
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs() {
    const ctx = this.ctx;
    const { tx, ty } = ctx.dungeon.stairsPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = ctx.player.x - sx;
    const dy = ctx.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.7) {
      if (ctx.dungeon.floorObjective?.type === 'CLAIM_KEY' && !ctx.run.floorObjectiveComplete) {
        ctx.floatText(sx, sy - 28, 'SEALED', 0xce93d8, 12);
        ctx.status("The stairs are sealed. Defeat the guardian and claim the key.");
        return;
      }
      this.nextFloor();
    }
  }

  private checkStairsUp() {
    const ctx = this.ctx;
    const { tx, ty } = ctx.dungeon.stairsUpPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = ctx.player.x - sx;
    const dy = ctx.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.9) {
      if (ctx.currentFloor === 1) {
        // Show rest dialog before leaving the dungeon
        this.showRestDialog();
      } else {
        // Mid-dungeon ascent: save this floor then go up
        this.saveCurrentFloor();
        this.emitFloorExit();
        ctx.scene.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
          if (t === 1) {
            const persistedStats = this._buildPersistedStats(ctx.currentFloor - 1);
            ctx.scene.scene.restart({ floor: ctx.currentFloor - 1, persistedStats, saveSlot: ctx.saveSlot });
          }
        });
      }
    }
  }

  /** `floor_exit` once per floor, even though the stair check runs every frame during the fade. */
  private emitFloorExit() {
    if (this._exitEmitted) return;
    this._exitEmitted = true;
    this.ctx.bus.emit('floor_exit');
  }

  // ── Rest Dialog ────────────────────────────────────────────────────────────

  private showRestDialog() {
    if (this._restDialogOpen) return;
    this._restDialogOpen = true;
    this.ctx.bus.emit('ui_open', { panel: 'rest' });

    const scene = this.ctx.scene;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const s = this.ctx.player.stats;
    const D = 200; // depth for all dialog elements

    // Half-lost HP/mana for short rest preview
    const shortHpGain = Math.floor((s.maxHp - s.hp) / 2);
    const shortMpGain = Math.floor((s.maxMana - s.mana) / 2);

    const els = this._restDialogElements;

    const overlay = scene.add.rectangle(cx, cy, W, H, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(D);
    els.push(overlay);

    const bg = scene.add.rectangle(cx, cy, 560, 280, 0x0c0c18, 0.97)
      .setStrokeStyle(2, 0x4466aa).setScrollFactor(0).setDepth(D);
    els.push(bg);

    els.push(scene.add.text(cx, cy - 110, 'Return to the Tavern', {
      fontSize: '20px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    els.push(scene.add.text(cx, cy - 76, 'Choose how you rest before leaving:', {
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
    const scene = this.ctx.scene;
    const CW = 240;
    const CH = 200;
    const D = 200;
    const els = this._restDialogElements;

    const hex = `#${accentColor.toString(16).padStart(6, '0')}`;
    const cardBg = scene.add.rectangle(x, y, CW, CH, bgColor)
      .setInteractive().setStrokeStyle(1, accentColor).setScrollFactor(0).setDepth(D);
    els.push(cardBg);

    els.push(scene.add.text(x, y - CH / 2 + 18, title, {
      fontSize: '14px', color: hex, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    lines.forEach((line, i) => {
      els.push(scene.add.text(x - CW / 2 + 14, y - CH / 2 + 44 + i * 22, line, {
        fontSize: '11px', color: '#aaaacc', fontFamily: 'monospace',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(D));
    });

    // Button
    const btn = scene.add.rectangle(x, y + CH / 2 - 22, CW - 20, 30, accentColor, 0.15)
      .setInteractive().setStrokeStyle(1, accentColor).setScrollFactor(0).setDepth(D);
    const btnTxt = scene.add.text(x, y + CH / 2 - 22, 'SELECT', {
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
    const ctx = this.ctx;
    const player = ctx.player;
    const s = player.stats;

    if (type === 'short') {
      // Restore half of lost HP and mana
      const hpGain = Math.floor((s.maxHp - s.hp) / 2);
      const mpGain = Math.floor((s.maxMana - s.mana) / 2);
      if (hpGain > 0) player.heal(hpGain);
      if (mpGain > 0) player.restoreMana(mpGain);
      // Save dungeon state as-is (preserved)
      this.saveCurrentFloor();
    } else {
      // Full restore
      player.heal(s.maxHp - s.hp);
      if (s.maxMana > 0) player.restoreMana(s.maxMana - s.mana);
      // Reset dungeon state: clear kills/traps/chests but keep layout and revealed doors
      ctx.persist.deadEnemyIndices.clear();
      ctx.persist.triggeredTrapKeys.clear();
      ctx.persist.openedChestKeys.clear();
      ctx.persist.pickedItemKeys.clear();
      this.saveCurrentFloor(); // saves the reset state
    }

    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._restDialogOpen = false;
    ctx.bus.emit('ui_close', { panel: 'rest' });
    ctx.bus.emit('rest');
    this.emitFloorExit();

    ctx.scene.cameras.main.fade(400, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const persistedStats = this._buildPersistedStats(0); // floor 0 = Tavern
        ctx.scene.scene.start("TavernScene", { persistedStats, saveSlot: ctx.saveSlot });
      }
    });
  }

  // ── Dungeon Serialization ──────────────────────────────────────────────────

  saveCurrentFloor() {
    const sf = this.serializeCurrentFloor();
    const ps = this.ctx.player.getSerializable();
    ps.savedDungeons = { ...(ps.savedDungeons ?? {}), [this.ctx.currentFloor]: sf };
    // Update player's in-memory stats so they carry the saved dungeon forward
    this.ctx.player.stats.savedDungeons = ps.savedDungeons;
  }

  private serializeCurrentFloor(): SerializedFloor {
    const p = this.ctx.persist;
    const sf: SerializedFloor = {
      dungeonData: this.ctx.baseDungeon,
      deadEnemyIndices: [...p.deadEnemyIndices],
      triggeredTrapKeys: [...p.triggeredTrapKeys],
      openedChestKeys: [...p.openedChestKeys],
      pickedItemKeys: [...p.pickedItemKeys],
      revealedDoorKeys: [...p.revealedDoorKeys],
    };
    const mech = this.ctx.mech.serialize();
    if (mech !== undefined) sf.mechStateJson = mech;
    return sf;
  }

  private _buildPersistedStats(targetFloor: number): PlayerStats {
    const ps = this.ctx.player.getSerializable();
    ps.floor = targetFloor;
    ps.saveSlot = this.ctx.saveSlot;
    return ps;
  }

  // ── Floor Transitions ─────────────────────────────────────────────────────

  private nextFloor() {
    const ctx = this.ctx;
    this.saveCurrentFloor(); // persist current floor before descending
    this.emitFloorExit();
    // Quest progress: floor reached
    if (ctx.player.stats.activeQuests) {
      onFloorReached(ctx.player.stats.activeQuests, ctx.currentFloor + 1);
    }
    ctx.scene.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const ps = this._buildPersistedStats(ctx.currentFloor + 1);
        this.autoSave(ps).catch(() => {});
        ctx.scene.scene.restart({ floor: ctx.currentFloor + 1, persistedStats: ps, saveSlot: ctx.saveSlot });
      }
    });
  }

  private async autoSave(stats: PlayerStats) {
    // Server when signed in, this device otherwise (SaveStore decides).
    await saveGame(this.ctx.saveSlot, stats);
  }

  // ── Death ─────────────────────────────────────────────────────────────────

  handlePlayerDeath() {
    const ctx = this.ctx;
    if (!this._deathEmitted) {
      this._deathEmitted = true;
      ctx.bus.emit('player_death');
    }
    ctx.player.setTint(0x888888);
    ctx.scene.time.delayedCall(800, () => {
      ctx.scene.scene.start("GameOverScene", {
        floor: ctx.currentFloor,
        kills: ctx.run.kills,
        level: ctx.player.stats.level,
        gold: ctx.player.stats.runGoldEarned ?? 0,
        bestStreak: ctx.player.stats.runBestStreak ?? 0,
        relics: ctx.player.stats.relics ?? [],
      });
    });
  }

  /** Destroys the rest dialog if open. Called on scene shutdown / floor change. */
  destroy() {
    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._restDialogOpen = false;
  }
}
