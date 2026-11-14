import * as Phaser from "phaser";
import type { PlayerStats } from "../../entities/Player";
import type { SerializedFloor } from "../../systems/DungeonGenerator";
import { TILE_SIZE, TOMB_FLOOR, CHARACTER_CLASSES } from "../../constants";
import { mathRng, titleFor } from "../../rules";
import { applyRest, campInterruptPct, wanderingMonsterArrives } from "./AdndCombat";
import { onFloorReached } from "../../systems/QuestSystem";
import { saveGame } from "../../systems/SaveStore";
import { graveyard, causePhrase, trapCause, type FallenRecord } from "../../systems/Graveyard";
import { resolveInteract } from "./interactArbiter";
import type { GameEventScope } from "../../GameEvents";
import type { GameContext } from "../../GameContext";

/** After the first E on the stairs, how long the second E is accepted. */
const STAIRS_CONFIRM_MS = 4000;

type RestType = 'short' | 'long';

/** Stairs, the rest dialog, floor serialization, autosave, floor transitions and player death. */
export class FloorController {
  private _restDialogOpen = false;
  private _restDialogElements: Phaser.GameObjects.GameObject[] = [];
  private _exitEmitted = false;
  private _deathEmitted = false;
  private _recalling = false;
  private _restBlockedUntil = 0;
  private _sealedMsgUntil = 0;
  // Stairs ask first: the first E arms the prompt, a second E inside the window takes you down.
  private _eHeard = false;
  private _rHeard = false;
  private _stairsArmedUntil = 0;
  private _stairsHinted = false;
  private _descending = false;
  private _onE?: (ev: KeyboardEvent) => void;
  private _onR?: (ev: KeyboardEvent) => void;
  // What last hurt the character, for the epitaph.
  private _scope: GameEventScope;
  private _killLine?: { cause: string; at: number };
  private _lastTrap?: { type: string; at: number };

  constructor(private ctx: GameContext) {
    // Raw key events rather than `JustDown`: the chest, the mechanisms and the pack all read E too, and whoever
    // reads a Key object first would swallow the press. Each frame this controller sees every fresh press.
    const kb = ctx.scene.input.keyboard;
    if (kb) {
      this._onE = (ev: KeyboardEvent) => { if (!ev.repeat) this._eHeard = true; };
      this._onR = (ev: KeyboardEvent) => { if (!ev.repeat) this._rHeard = true; };
      kb.on('keydown-E', this._onE);
      kb.on('keydown-R', this._onR);
    }
    // Deaths announce themselves in the status line ("Slain by a fall.", "Killed by a dart volley.") and traps on the bus.
    this._scope = ctx.bus.scope()
      .on('status', ({ text }) => {
        const m = /^(?:Killed|Slain) by (.+?)\.(?:\s|$)/.exec(text);
        if (m) this._killLine = { cause: m[1], at: ctx.scene.time.now };
      })
      .on('trap_triggered', ({ type }) => { this._lastTrap = { type, at: ctx.scene.time.now }; });
  }

  /** True while the rest dialog has the game paused. */
  get restDialogOpen(): boolean {
    return this._restDialogOpen;
  }

  /** Stairs down, then stairs up, in the old order. */
  update() {
    const ePress = this._eHeard;
    const rPress = this._rHeard;
    this._eHeard = false;
    this._rHeard = false;
    if (rPress) this.explainRest();
    this.checkStairs(ePress);
    this.checkStairsUp(ePress);
  }

  // ── R: why you cannot rest here ────────────────────────────────────────────

  /**
   * R: make camp in this floor's camp room (the room you arrived in), or say where you can rest. Camping costs a
   * ration, gives back half the missing hit points and the spells, and a wandering monster may break it, more often
   * the deeper you are. The first R asks; a second R within a few seconds makes camp.
   */
  private explainRest() {
    const ctx = this.ctx;
    if (ctx.modalOpen || this._restDialogOpen || ctx.rooms.isModalOpen || ctx.player.stats.hp <= 0) return;
    if (this.inCampRoom() && ctx.currentFloor < TOMB_FLOOR) {
      this.tryCamp();
      return;
    }
    const up = ctx.dungeon.stairsUpPos;
    const nearUp = Math.hypot(ctx.player.x - (up.tx + 0.5) * TILE_SIZE, ctx.player.y - (up.ty + 0.5) * TILE_SIZE) < TILE_SIZE * 6;
    if (ctx.currentFloor === 1 && nearUp) {
      ctx.status("The stairs up are close. Step onto them to rest, short or long.");
    } else if (ctx.currentFloor === 1) {
      ctx.status("You cannot rest down here, the dark has teeth. Rest at the stairs up on this level, or sleep at the inn.");
    } else if (ctx.currentFloor >= TOMB_FLOOR) {
      ctx.status("Nobody sleeps in the Hollow King's tomb. Read a recall scroll, or climb back up.");
    } else {
      ctx.status(`Not here: the dark has teeth. Make camp in the room you came down into (marked CAMP on the map), or sleep at the inn.`);
    }
  }

  private _campAskedAt = -1e9;
  private _awaitStepOff = false;
  private _upHinted = false;
  private _ascending = false;

  private inCampRoom(): boolean {
    const ctx = this.ctx;
    const camp = ctx.dungeon.rooms[0];
    if (!camp) return false;
    const tx = Math.floor(ctx.player.x / TILE_SIZE);
    const ty = Math.floor(ctx.player.y / TILE_SIZE);
    return tx >= camp.x && tx < camp.x + camp.w && ty >= camp.y && ty < camp.y + camp.h;
  }

  private tryCamp() {
    const ctx = this.ctx;
    const player = ctx.player;
    const s = player.stats;
    const now = ctx.scene.time.now;
    const near = ctx.enemies.some((e) => e.active && e.hp > 0 && Math.hypot(e.x - player.x, e.y - player.y) < TILE_SIZE * 8);
    if (near) { ctx.status("Not with something that close. Deal with it first."); return; }
    if (player.inventory.count('ration') < 1) { ctx.status("You have nothing to eat. Nobody sleeps well down here hungry; go back up or buy rations."); return; }
    if (now < this._restBlockedUntil) { ctx.status("Too soon: your heart is still pounding."); return; }
    if (now - this._campAskedAt > 4000) {
      this._campAskedAt = now;
      const pct = campInterruptPct(ctx.currentFloor);
      ctx.status(`Make camp? It costs a ration, and about ${pct} times in a hundred something finds you. R again to sleep.`);
      return;
    }
    this._campAskedAt = -1e9;
    player.inventory.consume('ration', 1);
    if (mathRng.next() * 100 < campInterruptPct(ctx.currentFloor)) {
      this._restBlockedUntil = now + 4000;
      const foe = ctx.combat.spawnWanderingMonster();
      ctx.status(foe ? "You wake to the scrape of claws on stone. Your camp is broken, the ration wasted." : "You start awake, sure you heard something. Nothing comes, but the night is lost.");
      return;
    }
    const state = { hp: s.hp, maxHp: s.maxHp, drained: s.drained ?? 0 };
    const summary = applyRest(state, player.spellbook, 'long', false);
    s.hp = state.hp;
    s.drained = state.drained;
    player.removeEffect('POISONED');
    player.recomputeDerived();
    s.hp = Math.min(state.hp, s.maxHp);
    ctx.status(`You sleep in the dark with one eye open: +${summary.healed} HP${summary.spellsRestored ? ', spells memorized again' : ''}.`);
    ctx.bus.emit('rest');
    ctx.emitHUD();
    this.saveCurrentFloor();
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs(ePress: boolean) {
    const ctx = this.ctx;
    const { tx, ty } = ctx.dungeon.stairsPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = ctx.player.x - sx;
    const dy = ctx.player.y - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > TILE_SIZE * 1.5) {
      // Walked away: the prompt lapses and the hint may show again next time.
      this._stairsArmedUntil = 0;
      if (dist > TILE_SIZE * 2.5) this._stairsHinted = false;
    }
    if (dist < TILE_SIZE * 0.7) {
      if (ctx.currentFloor >= TOMB_FLOOR) {
        // The tomb is the last floor: its stairs are the way out, and only once the Hollow King is dead.
        if (!ctx.combat.bossSlain) {
          const now = ctx.scene.time.now;
          if (now > this._sealedMsgUntil) {
            this._sealedMsgUntil = now + 2500;
            ctx.floatText(sx, sy - 28, 'SEALED', 0xce93d8, 12);
            ctx.status("The way out is barred. The Hollow King still wears his crown.");
          }
          return;
        }
        this.winGame();
        return;
      }
      if (ctx.dungeon.floorObjective?.type === 'CLAIM_KEY' && !ctx.run.floorObjectiveComplete) {
        const now = ctx.scene.time.now;
        if (now > this._sealedMsgUntil) {
          this._sealedMsgUntil = now + 2500;
          ctx.floatText(sx, sy - 28, 'SEALED', 0xce93d8, 12);
          ctx.status("The stairs are sealed. Defeat the guardian and claim the key.");
        }
        return;
      }
      this.stairsDown(ePress, sx, sy);
    }
  }

  /** Stairs down are a decision: E asks, a second E within a few seconds goes. Walking over them does nothing. */
  private stairsDown(ePress: boolean, sx: number, sy: number) {
    const ctx = this.ctx;
    if (this._descending) return;
    if (!ePress) {
      if (!this._stairsHinted) {
        this._stairsHinted = true;
        ctx.status("Stairs down. Press E when you are ready to descend.");
      }
      return;
    }
    if (ctx.modalOpen || this._restDialogOpen || ctx.rooms.isModalOpen) return;
    // One press of E does one thing: a chest, a mechanism or something on the floor within reach takes it first.
    if (resolveInteract(ctx.loot.nearestChestDistance(), ctx.mech.nearestInteractDistance()) !== 'none') return;
    if (ctx.loot.pickupInReach()) return;
    const now = ctx.scene.time.now;
    if (now <= this._stairsArmedUntil) {
      this._stairsArmedUntil = 0;
      this.nextFloor();
      return;
    }
    this._stairsArmedUntil = now + STAIRS_CONFIRM_MS;
    ctx.floatText(sx, sy - 28, `DESCEND? E`, 0xffd166, 12);
    ctx.status(`Descend to level ${ctx.currentFloor + 1}? E to confirm`);
  }

  private checkStairsUp(ePress = false) {
    const ctx = this.ctx;
    const { tx, ty } = ctx.dungeon.stairsUpPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = ctx.player.x - sx;
    const dy = ctx.player.y - sy;
    const onStairs = Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.9;
    if (!onStairs) { this._awaitStepOff = false; this._upHinted = false; }
    if (onStairs) {
      if (ctx.currentFloor === 1) {
        // Show rest dialog before leaving the dungeon (not again until the player steps off, after Esc)
        if (ctx.scene.time.now >= this._restBlockedUntil && !this._awaitStepOff) this.showRestDialog();
      } else {
        // Mid-dungeon ascent is a decision too: E climbs. Walking over the stairs (a click-to-move route can cross
        // them) used to take you up at once; the autopilot bounced between two floors that way.
        if (!ePress) {
          if (!this._upHinted) {
            this._upHinted = true;
            ctx.status(`Stairs up to level ${ctx.currentFloor - 1}. Press E to climb.`);
          }
          return;
        }
        if (ctx.modalOpen || this._restDialogOpen || ctx.rooms.isModalOpen) return;
        if (resolveInteract(ctx.loot.nearestChestDistance(), ctx.mech.nearestInteractDistance()) !== 'none') return;
        if (this._ascending) return;
        this._ascending = true;
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

    // Half the missing hit points for the short rest preview
    const shortHpGain = Math.floor((s.maxHp - s.hp) / 2);
    const hasRation = this.ctx.player.inventory.count('ration') > 0;

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

    els.push(scene.add.text(cx, cy - 76, '1: short rest   2: long rest   Esc: stay in the dungeon', {
      fontSize: '13px', color: '#aab0cc', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    // Keys as well as the mouse, and a way back out: walking over the stairs up should not force you to leave.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Digit1') { e.preventDefault(); this.doRest('short'); }
      else if (e.code === 'Digit2') { e.preventDefault(); this.doRest('long'); }
      else if (e.code === 'Escape') { e.preventDefault(); this.stayInDungeon(); }
    };
    window.addEventListener('keydown', onKey);
    const keyHolder = scene.add.zone(0, 0, 1, 1);
    keyHolder.once('destroy', () => window.removeEventListener('keydown', onKey));
    els.push(keyHolder);

    // Short Rest card
    this.addRestCard(cx - 135, cy + 20, '⚕ SHORT REST', [
      `+${shortHpGain} HP, spells stay spent`,
      'Dead enemies stay dead',
      'Traps stay cleared',
      'Chests stay open',
      'Same dungeon on return',
    ], 0x1a2a3a, 0x3399ff, () => this.doRest('short'));

    // Long Rest card
    this.addRestCard(cx + 135, cy + 20, '🛌 LONG REST', [
      hasRation ? 'Full HP, drain mended, spells back' : 'No ration: half HP, spells back',
      hasRation ? 'Eats a ration' : 'You wake hungry',
      'Enemies respawn, traps reset',
      'Chests refill',
      'Wanderers may find you first',
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

    // Something may wander in while you sleep: the rest is broken off and you must deal with it.
    if (wanderingMonsterArrives(type, mathRng)) {
      this.closeRestDialog();
      this._restBlockedUntil = ctx.scene.time.now + 4000;
      const foe = ctx.combat.spawnWanderingMonster();
      ctx.status(foe ? "Something stirs in the dark. Your rest is broken." : "You start awake, but nothing comes.");
      return;
    }

    const state = { hp: s.hp, maxHp: s.maxHp, drained: s.drained ?? 0 };
    const hasRation = player.inventory.count('ration') > 0 && type === 'long';
    const summary = applyRest(state, player.spellbook, type, hasRation);
    s.hp = state.hp;
    s.drained = state.drained;
    if (summary.ateRation) player.inventory.consume('ration', 1);
    if (type === 'long') {
      player.removeEffect('POISONED');
      player.removeEffect('HELD');
    }
    player.recomputeDerived();
    s.hp = Math.min(state.hp, s.maxHp);
    ctx.status(
      type === 'short'
        ? `You bind your wounds (+${summary.healed} HP).`
        : `You sleep${summary.ateRation ? ' and eat a ration' : ', hungry'}: +${summary.healed} HP` +
          `${summary.drainRestored > 0 ? `, ${summary.drainRestored} drained HP mended` : ''}, spells memorized again.`,
    );

    if (type === 'short') {
      // Save dungeon state as-is (preserved)
      this.saveCurrentFloor();
    } else {
      // Reset dungeon state: clear kills/traps/chests but keep layout and revealed doors
      ctx.persist.deadEnemyIndices.clear();
      ctx.persist.triggeredTrapKeys.clear();
      ctx.persist.openedChestKeys.clear();
      ctx.persist.pickedItemKeys.clear();
      this.saveCurrentFloor(); // saves the reset state
    }

    this.closeRestDialog();
    ctx.bus.emit('rest');
    this.emitFloorExit();

    ctx.scene.cameras.main.fade(400, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const persistedStats = this._buildPersistedStats(0); // floor 0 = Tavern
        ctx.scene.scene.start("TavernScene", { persistedStats, saveSlot: ctx.saveSlot });
      }
    });
  }

  /** Esc on the rest dialog: close it and do not offer it again until the player has stepped off the stairs. */
  private stayInDungeon() {
    if (!this._restDialogOpen) return;
    this.closeRestDialog();
    this._awaitStepOff = true;
    this.ctx.status('You turn back into the dark.');
  }

  private closeRestDialog() {
    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._restDialogOpen = false;
    this.ctx.bus.emit('ui_close', { panel: 'rest' });
  }

  /** Scroll of Recall: save the floor and go straight back to the tavern with the character as they are. */
  recallToTavern() {
    if (this._recalling) return;
    this._recalling = true;
    const ctx = this.ctx;
    this.saveCurrentFloor();
    this.emitFloorExit();
    ctx.scene.cameras.main.fade(400, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const persistedStats = this._buildPersistedStats(0); // floor 0 = Tavern
        ctx.scene.scene.start("TavernScene", { persistedStats, saveSlot: ctx.saveSlot });
      }
    });
  }

  /** Climbing out of the Tomb of the Hollow King with the king dead: the run is won. */
  private winGame() {
    if (this._recalling) return;
    this._recalling = true;
    const ctx = this.ctx;
    this.saveCurrentFloor();
    this.emitFloorExit();
    const stats = this._buildPersistedStats(ctx.currentFloor);
    this.autoSave(stats).catch(() => {});
    ctx.scene.cameras.main.fade(600, 255, 244, 200, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        ctx.scene.scene.start("GameOverScene", {
          floor: ctx.currentFloor,
          kills: ctx.run.kills,
          level: ctx.player.stats.level,
          gold: ctx.player.stats.runGoldEarned ?? 0,
          bestStreak: ctx.player.stats.runBestStreak ?? 0,
          relics: ctx.player.stats.relics ?? [],
          victory: true,
          stats,
        });
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
    const ground = this.ctx.loot.serializeGround();
    if (ground.length > 0) sf.groundItems = ground;
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
    if (this._descending) return;
    this._descending = true;
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
    if (this._deathEmitted) return; // already handled; a second call would only queue a second game-over screen
    this._deathEmitted = true;
    ctx.bus.emit('player_death');
    ctx.player.setTint(0x888888);
    // The record stays (it is in the save); the purse does not. Gold carried is lost with the body, and lies where it fell.
    const s = ctx.player.stats;
    const lost = s.gold;
    s.gold = 0;
    ctx.player.inventory.gold = 0;
    if (lost > 0) ctx.status(`You die. ${lost} gold stays with the body.`);

    const fallen: FallenRecord = {
      name: s.name?.trim() || CHARACTER_CLASSES[s.classKey].name,
      classKey: s.classKey,
      title: titleFor(s.classKey, s.level),
      level: s.level,
      floor: ctx.currentFloor,
      cause: this.deathCause(),
      gold: lost,
      kills: ctx.run.kills,
      date: new Date().toISOString(),
    };
    graveyard.add(fallen);
    graveyard.leaveBones({
      floor: ctx.currentFloor,
      tx: Math.floor(ctx.player.x / TILE_SIZE),
      ty: Math.floor(ctx.player.y / TILE_SIZE),
      gold: lost,
      name: fallen.name,
      date: fallen.date,
    });

    ctx.scene.time.delayedCall(800, () => {
      ctx.scene.scene.start("GameOverScene", {
        floor: ctx.currentFloor,
        kills: ctx.run.kills,
        level: ctx.player.stats.level,
        gold: ctx.player.stats.runGoldEarned ?? 0,
        bestStreak: ctx.player.stats.runBestStreak ?? 0,
        relics: ctx.player.stats.relics ?? [],
        fallen,
      });
    });
  }

  /**
   * What killed the character, as a noun phrase ("a giant spider"), or "" when nobody can say.
   * Order: a death announced in the status line (mechanisms), a cause passed to `Player.takeDamage`, a trap that just
   * fired, the nearest live monster, then poison in the blood.
   */
  private deathCause(): string {
    const ctx = this.ctx;
    const p = ctx.player;
    const now = ctx.scene.time.now;
    if (this._killLine && now - this._killLine.at < 2500) return causePhrase(this._killLine.cause);
    const h = p.lastHurtBy;
    if (h?.cause && now - h.at < 8000) return causePhrase(h.cause);
    if (this._lastTrap && now - this._lastTrap.at < 1500 && (!h || this._lastTrap.at >= h.at - 50)) {
      return trapCause(this._lastTrap.type);
    }
    let best: string | undefined;
    let bestD = TILE_SIZE * 8;
    for (const e of ctx.enemies) {
      if (!e.active || e.hp <= 0) continue;
      if (e.isMimic && !e.mimicRevealed) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < bestD) { bestD = d; best = e.isElite && !e.def.boss ? `champion ${e.def.name.toLowerCase()}` : e.def.name.toLowerCase(); }
    }
    if (best) return causePhrase(best);
    if (p.hasEffect('POISONED')) return 'poison';
    return '';
  }

  /** Destroys the rest dialog if open. Called on scene shutdown / floor change. */
  destroy() {
    this._scope.dispose();
    const kb = this.ctx.scene.input?.keyboard;
    if (this._onE) kb?.off('keydown-E', this._onE);
    if (this._onR) kb?.off('keydown-R', this._onR);
    this._restDialogElements.forEach(e => e.destroy());
    this._restDialogElements = [];
    this._restDialogOpen = false;
  }
}
