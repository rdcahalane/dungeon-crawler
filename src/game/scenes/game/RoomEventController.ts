import { isTouchDevice } from "../../touch";
import { TOMB_FLOOR } from "../../constants";
import * as Phaser from "phaser";
import { TILE_SIZE, EnemyTypeKey, enemyPoolForFloor } from "../../constants";
import type { DungeonData } from "../../systems/DungeonGenerator";
import { onSpecialRoomEntered } from "../../systems/QuestSystem";
import type { Enemy } from "../../entities/Enemy";
import { MONSTERS } from "../../rules";
import type { GameContext, RelicKey } from "../../GameContext";
import { COL, flatPanel, uiText } from "../../gfx/retroUi";
import { GLYPH_W, LINE, wrap } from "../ui/theme";

type BoonKey = 'blade' | 'bulwark' | 'vigor' | 'arcana' | 'fortune';

interface BoonOption {
  key: BoonKey;
  title: string;
  lines: string[];
  color: number;
  apply: () => void;
}

/** One card in a choice dialog (boon or shrine). Every string is wrapped to the card's inner width. */
interface ChoiceCard {
  title: string;
  color: number;
  lines: string[];
  /** Index into `lines` of a price the player pays, drawn in red instead of cream. */
  costIdx?: number;
  onPick: () => void;
}

interface ChoiceDialog {
  title: string;
  sub: string;
  border: number;
  fill: number;
  button: string;
  cards: ChoiceCard[];
  /** Esc walks away (shrine). Without it Esc does nothing (a boon must be chosen). */
  onCancel?: () => void;
}

const CARD_W = 240;
const CARD_H = 262;
const CARD_GAP = 16;
const CARD_PAD = 12;
/** Characters of 16px text that fit between the card's inner padding. */
const CARD_COLS = Math.floor((CARD_W - CARD_PAD * 2) / GLYPH_W);

interface RoomChallenge {
  roomIdx: number;
  target: number;
  kills: number;
  timeLeft: number;
}

/**
 * The arcade rush: the timed "Room gambit", the kill-streak bonuses and the "Blood Rune" room reward sprinting. They
 * stay in the code behind this switch, but with it off they neither fire nor print. Careful tomb play is the point.
 * (The kill-streak half lives in `CombatController.applyKillMomentum`, which should check this too.)
 */
export const ARCADE_ROOM_EVENTS: boolean = false;

/** Room, gambit and objective XP was written when a goblin gave 15 and levels came every 100; a quarter of it fits first-edition XP. */
const bonusXp = (n: number): number => Math.max(1, Math.round(n * 0.25));

const RELIC_LABELS: Record<RelicKey, string> = {
  ember_idol: 'Ember Idol',
  swift_vial: 'Swift Vial',
  chest_contract: 'Chest Contract',
  black_candle: 'Black Candle',
  boss_trophy: 'Guardian Trophy',
};

/** What each relic does, in the words the shrine shows. Black Candle depends on whether the arcade rewards are on. */
function candleBoon(): string {
  return ARCADE_ROOM_EVENTS ? 'Room gambits pay double' : 'Entering a room shows the traps hidden in it';
}

/**
 * Room challenges (gambits), room modifiers, special rooms, the floor objective, boons, relics and the
 * cursed shrine.
 */
export class RoomEventController {
  private _enteredQuestRooms = new Set<string>();
  private _triggeredRoomEvents = new Set<number>();
  private _triggeredRoomModifiers = new Set<number>();
  private _clearedRoomBonuses = new Set<number>();
  private _lastPlayerRoomIdx = -1;
  private _roomChallenge?: RoomChallenge;
  private _roomChallengesSeen = new Set<number>();
  private _relicRoomTriggers = new Set<number>();
  private _candleRooms = new Set<number>();

  private _shrineDialogOpen = false;
  private _shrineDialogElements: Phaser.GameObjects.GameObject[] = [];
  private _boonDialogOpen = false;
  private _boonDialogElements: Phaser.GameObjects.GameObject[] = [];

  constructor(private ctx: GameContext) {}

  /** True while a choice dialog (boon or shrine) has the game paused. */
  get isModalOpen(): boolean {
    return this._boonDialogOpen || this._shrineDialogOpen;
  }
  get boonDialogOpen(): boolean { return this._boonDialogOpen; }
  get shrineDialogOpen(): boolean { return this._shrineDialogOpen; }

  /** Room-entry events then quest special-room entry, in the old order. */
  update(ptx: number, pty: number) {
    this.checkRoomEvents(ptx, pty);
    this.checkSpecialRoomEntry();
  }

  // ── Relics ─────────────────────────────────────────────────────────────────

  private grantRelic(key: RelicKey) {
    const ctx = this.ctx;
    const s = ctx.player.stats;
    if (!s.relics) s.relics = [];
    if (s.relics.includes(key)) {
      ctx.addGold(35 + ctx.currentFloor * 8);
      ctx.status(`${RELIC_LABELS[key]} deepens into gold.`);
      return;
    }
    s.relics.push(key);
    ctx.floatText(ctx.player.x, ctx.player.y - 72, RELIC_LABELS[key].toUpperCase(), 0xffd166, 13);
    ctx.status(`Relic gained: ${RELIC_LABELS[key]}.`);
  }

  private grantRandomRelic() {
    const pool: RelicKey[] = ['ember_idol', 'swift_vial', 'chest_contract', 'black_candle', 'boss_trophy'];
    const missing = pool.filter(key => !this.ctx.hasRelic(key));
    this.grantRelic((missing.length > 0 ? missing : pool)[Phaser.Math.Between(0, (missing.length > 0 ? missing : pool).length - 1)]);
  }

  // ── Room challenge (gambit) ────────────────────────────────────────────────

  updateRoomChallenge(delta: number) {
    if (!ARCADE_ROOM_EVENTS) return;
    const challenge = this._roomChallenge;
    if (!challenge) return;
    challenge.timeLeft -= delta;
    if (challenge.timeLeft > 0) return;
    this.ctx.floatText(this.ctx.player.x, this.ctx.player.y - 54, 'CHANCE LOST', 0x888899, 11);
    this.ctx.status("Room challenge faded. The dungeon will not wait.");
    this._roomChallenge = undefined;
  }

  private startRoomChallenge(roomIdx: number) {
    if (!ARCADE_ROOM_EVENTS) return;
    const ctx = this.ctx;
    if (this._roomChallenge || this._roomChallengesSeen.has(roomIdx) || roomIdx <= 0) return;
    const hostileCount = ctx.enemies.filter(enemy =>
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
    ctx.floatText(ctx.player.x, ctx.player.y - 58, `GAMBIT: ${target} KILLS`, 0xffd166, 13);
    ctx.status(`Room gambit: kill ${target} enemies fast for bonus gold, XP, and rush.`);
  }

  recordRoomChallengeKill(enemy: Enemy) {
    const ctx = this.ctx;
    const player = ctx.player;
    const roomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (ctx.hasRelic('ember_idol') && roomIdx !== undefined && !this._relicRoomTriggers.has(roomIdx)) {
      this._relicRoomTriggers.add(roomIdx);
      player.addEffect('RUSHED', 3200);
      ctx.floatText(player.x, player.y - 74, 'EMBER IGNITES', 0xff5a5f, 11);
    }

    const challenge = this._roomChallenge;
    if (!challenge) return;
    if (roomIdx !== challenge.roomIdx) return;

    challenge.kills++;
    if (challenge.kills < challenge.target) {
      ctx.floatText(player.x, player.y - 58, `${challenge.kills}/${challenge.target}`, 0xffd166, 11);
      return;
    }

    const multiplier = ctx.hasRelic('black_candle') ? 2 : 1;
    const gold = (18 + ctx.currentFloor * 6) * multiplier;
    const xp = bonusXp(16 + ctx.currentFloor * 8) * multiplier;
    ctx.addGold(gold);
    player.gainXP(xp);
    player.addEffect('RUSHED', 5500);
    ctx.floatText(player.x, player.y - 66, `GAMBIT WON +${gold}g`, 0xffd166, 13);
    ctx.status(`Room gambit won: +${gold}g +${xp} XP and Rush.`);
    this._roomChallenge = undefined;
    ctx.emitHUD();
  }

  applyRoomClearBonus(enemy: Enemy) {
    const ctx = this.ctx;
    const player = ctx.player;
    const roomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (roomIdx === undefined || this._clearedRoomBonuses.has(roomIdx)) return;

    const stillHostile = ctx.enemies.some((other) => {
      if (other === enemy || !other.active || other.hp <= 0) return false;
      return (other as Enemy & { _roomIdx?: number })._roomIdx === roomIdx;
    });
    if (stillHostile) return;

    const room = ctx.dungeon.rooms[roomIdx];
    if (!room) return;

    this._clearedRoomBonuses.add(roomIdx);
    const type = room.type ?? 'normal';
    const rewardByType: Record<string, { gold: number; xp: number; label: string; color: number }> = {
      normal: { gold: 4 + ctx.currentFloor, xp: 5 + ctx.currentFloor * 2, label: 'Room Clear', color: 0x99aabb },
      monster_closet: { gold: 18 + ctx.currentFloor * 4, xp: 22 + ctx.currentFloor * 6, label: 'Den Cleared', color: 0xff5a5f },
      trap_corridor: { gold: 14 + ctx.currentFloor * 3, xp: 16 + ctx.currentFloor * 4, label: 'Runes Secured', color: 0xffd166 },
      vault: { gold: 24 + ctx.currentFloor * 5, xp: 12 + ctx.currentFloor * 3, label: 'Vault Secured', color: 0xffd166 },
      quest_special: { gold: 20 + ctx.currentFloor * 4, xp: 24 + ctx.currentFloor * 5, label: 'Chamber Secured', color: 0x00bbf9 },
    };
    const reward = rewardByType[type] ?? rewardByType.normal;
    const modifierGold = room.modifier === 'gilded_cache' ? 18 + ctx.currentFloor * 5 : 0;
    const modifierXP = room.modifier === 'cursed_crypt' ? bonusXp(16 + ctx.currentFloor * 5) : 0;

    ctx.addGold(reward.gold + modifierGold);
    const rewardXp = bonusXp(reward.xp);
    player.gainXP(rewardXp + modifierXP);
    player.heal(Math.max(1, Math.floor(player.stats.maxHp * 0.03)));
    ctx.floatText(player.x, player.y - 48, `${reward.label} +${reward.gold + modifierGold}g`, reward.color, 13);
    ctx.status(`${reward.label}: +${reward.gold + modifierGold}g +${rewardXp + modifierXP} XP`);
    ctx.emitHUD();
  }

  // ── Floor objective and boons ──────────────────────────────────────────────

  completeFloorObjective() {
    const ctx = this.ctx;
    const objective = ctx.dungeon.floorObjective;
    if (!objective || ctx.run.floorObjectiveComplete) return;
    ctx.run.floorObjectiveComplete = true;
    ctx.addGold(objective.rewardGold);
    const objXp = bonusXp(objective.rewardXP);
    ctx.player.gainXP(objXp);
    if (objective.type === 'CLAIM_KEY') this.grantRandomRelic();
    ctx.scene.cameras.main.flash(220, 80, 180, 90);
    ctx.floatText(ctx.player.x, ctx.player.y - 60, `${objective.title}!`, 0x69f0ae, 16);
    ctx.status(`${objective.title} complete: +${objective.rewardGold}g +${objXp} XP`);
    ctx.emitHUD();
    this.showBoonChoice();
  }

  private buildBoonOptions(): BoonOption[] {
    const ctx = this.ctx;
    const player = ctx.player;
    const s = player.stats;
    const floor = ctx.currentFloor;
    const book = player.spellbook;
    const all: BoonOption[] = [
      {
        key: 'blade',
        title: 'Honed Blade',
        lines: ['+1 to hit and damage', 'For the rest of the run'],
        color: COL.red,
        apply: () => {
          s.weaponBonus += 1;
          player.recomputeDerived();
        },
      },
      {
        key: 'bulwark',
        title: 'Old Shield',
        lines: ['Armor class 1 better', 'Heal 25% max HP'],
        color: COL.sky,
        apply: () => {
          s.armorBonus += 1;
          player.recomputeDerived();
          player.heal(Math.ceil(s.maxHp * 0.25));
        },
      },
      {
        key: 'vigor',
        title: 'Warrior Vigor',
        lines: ['+3 max HP, fully healed', 'A healing potion'],
        color: COL.lime,
        apply: () => {
          s.baseMaxHp = (s.baseMaxHp ?? s.maxHp) + 3;
          player.recomputeDerived();
          player.heal(999);
          ctx.loot.giveItem('healing_potion');
        },
      },
      {
        key: 'arcana',
        title: 'Arcane Spark',
        lines: book ? ['Every spell memorized again', 'Drained HP mended'] : ['A Scroll of Identify', 'A little experience'],
        color: COL.orchid,
        apply: () => {
          if (book) {
            book.rest();
            player.restoreDrained();
          } else {
            ctx.loot.giveItem('scroll_identify');
            player.gainXP(bonusXp(40));
          }
        },
      },
      {
        key: 'fortune',
        title: 'Lucky Find',
        lines: [`+${20 + floor * 6} gold`, 'A healing potion'],
        color: COL.gold,
        apply: () => {
          ctx.addGold(20 + floor * 6);
          ctx.loot.giveItem('healing_potion');
        },
      },
    ];

    const start = (ctx.currentFloor + ctx.run.kills) % all.length;
    return [all[start], all[(start + 2) % all.length], all[(start + 4) % all.length]];
  }

  private showBoonChoice() {
    if (this._boonDialogOpen) return;
    this._boonDialogOpen = true;
    this.ctx.bus.emit('ui_open', { panel: 'boon' });
    this.drawChoiceDialog(this._boonDialogElements, {
      title: 'CLAIM A BOON',
      sub: 'CHOOSE ONE REWARD FOR THIS RUN.',
      border: COL.gold,
      fill: COL.ink,
      button: 'CHOOSE',
      cards: this.buildBoonOptions().map(option => ({
        title: option.title, color: option.color, lines: option.lines, onPick: () => this.chooseBoon(option),
      })),
    });
  }

  /**
   * A modal with three cards, all text in the retro bitmap font at 16px and wrapped to the card's inner width. Layout, top
   * to bottom inside a card: title (up to two lines), body lines (18px pitch), then the button pinned to the card foot.
   */
  private drawChoiceDialog(els: Phaser.GameObjects.GameObject[], d: ChoiceDialog) {
    const scene = this.ctx.scene;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const D = 220;
    const n = d.cards.length;
    const panelW = n * CARD_W + (n - 1) * CARD_GAP + 48;
    const panelH = CARD_H + 128;
    const top = Math.round(cy - panelH / 2);
    const fixed = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(o: T, depth = D): T => {
      o.setScrollFactor(0).setDepth(depth);
      els.push(o);
      return o;
    };

    fixed(scene.add.rectangle(cx, cy, W, H, COL.black, 0.7));
    fixed(flatPanel(scene, cx, cy, panelW, panelH, { fill: d.fill, border: d.border }));
    fixed(uiText(scene, cx, top + 14, d.title, { size: 24, color: d.border, originX: 0.5 }), D + 1);
    fixed(uiText(scene, cx, top + 50, d.sub, { size: 16, color: COL.grey, originX: 0.5 }), D + 1);

    const cardTop = top + 98;
    const left = cx - panelW / 2 + 24 + CARD_W / 2;
    const hovers: Array<(on: boolean) => void> = [];
    let selected = -1;
    const select = (i: number) => {
      if (selected >= 0) hovers[selected]?.(false);
      selected = (i + n) % n;
      hovers[selected]?.(true);
    };
    // Keys as well as the mouse: 1 to 3 pick, Left/Right and Enter choose, Esc walks away where that is allowed.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && Number(digit[1]) <= n) { e.preventDefault(); d.cards[Number(digit[1]) - 1].onPick(); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); select(selected < 0 ? 0 : selected - 1); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); select(selected < 0 ? 0 : selected + 1); return; }
      if ((e.code === 'Enter' || e.code === 'Space') && selected >= 0) { e.preventDefault(); d.cards[selected].onPick(); return; }
      if (e.code === 'Escape' && d.onCancel) { e.preventDefault(); d.onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    const keyHolder = fixed(scene.add.zone(0, 0, 1, 1));
    keyHolder.once('destroy', () => window.removeEventListener('keydown', onKey));
    const hint = isTouchDevice()
      ? `TAP A CARD${d.onCancel ? ', OR WALK AWAY' : ''}`
      : `1-${n} OR ARROWS AND ENTER${d.onCancel ? '   ESC: WALK AWAY' : ''}`;
    // Under the subtitle: the HUD's message log covers the panel's bottom-left corner.
    fixed(uiText(scene, cx, top + 72, hint, { size: 16, color: COL.silver, originX: 0.5 }), D + 1);
    // Walking away is a tap too (Esc does the same), where the dialog allows it.
    if (d.onCancel) {
      const away = fixed(flatPanel(scene, cx + panelW / 2 - 100, top + 28, 168, 32, { fill: COL.ink, border: COL.slate }), D + 1);
      away.setInteractive({ useHandCursor: true });
      fixed(uiText(scene, cx + panelW / 2 - 100, top + 28, 'WALK AWAY', { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }), D + 2);
      away.on('pointerdown', () => d.onCancel?.());
    }
    d.cards.forEach((card, i) => {
      const x = left + i * (CARD_W + CARD_GAP);
      const y = cardTop + CARD_H / 2;
      const inner = x - CARD_W / 2 + CARD_PAD;
      const bg = fixed(flatPanel(scene, x, y, CARD_W, CARD_H, { fill: COL.dusk, border: card.color }));
      bg.setInteractive({ useHandCursor: true });

      const titleLines = wrap(card.title.toUpperCase(), CARD_COLS).slice(0, 2);
      titleLines.forEach((row, k) => {
        fixed(uiText(scene, x, cardTop + 12 + k * LINE, row, { size: 16, color: card.color, originX: 0.5 }), D + 1);
      });

      let ly = cardTop + 12 + titleLines.length * LINE + 14;
      card.lines.forEach((line, k) => {
        const rows = wrap(line.toUpperCase(), CARD_COLS);
        rows.forEach((row, m) => {
          fixed(uiText(scene, inner, ly + m * LINE, row, {
            size: 16, color: k === card.costIdx ? COL.red : COL.cream,
          }), D + 1);
        });
        ly += rows.length * LINE + 8;
      });

      const bw = d.button.length * GLYPH_W + 24;
      const by = cardTop + CARD_H - 28;
      const btn = fixed(flatPanel(scene, x, by, bw, 32, { fill: COL.ink, border: card.color }), D + 1);
      btn.setInteractive({ useHandCursor: true });
      const btnLabel = fixed(uiText(scene, x, by, d.button, { size: 16, color: COL.white, originX: 0.5, originY: 0.5 }), D + 2);

      const hover = (on: boolean) => {
        bg.setFillStyle(on ? COL.slate : COL.dusk);
        btnLabel.setTint(on ? COL.gold : COL.white);
      };
      hovers.push(hover);
      for (const t of [bg, btn]) {
        t.on('pointerover', () => hover(true));
        t.on('pointerout', () => hover(false));
        t.on('pointerdown', card.onPick);
      }
    });
  }

  private chooseBoon(option: BoonOption) {
    const ctx = this.ctx;
    if (!this._boonDialogOpen) return;
    option.apply();
    this._boonDialogElements.forEach(e => e.destroy());
    this._boonDialogElements = [];
    this._boonDialogOpen = false;
    ctx.bus.emit('ui_close', { panel: 'boon' });
    ctx.floatText(ctx.player.x, ctx.player.y - 64, option.title, option.color, 15);
    ctx.status(`Boon claimed: ${option.title}`);
    ctx.emitHUD();
  }

  // ── Cursed shrine ──────────────────────────────────────────────────────────

  showCursedShrine() {
    if (this._shrineDialogOpen) return;
    this._shrineDialogOpen = true;
    this.ctx.bus.emit('ui_open', { panel: 'shrine' });
    const player = this.ctx.player;
    const s = player.stats;

    const options: ChoiceCard[] = [
      {
        title: 'Blood for Fire',
        color: COL.red,
        lines: ['Lose 3 max HP for good', 'First kill in each room quickens your feet'],
        costIdx: 0,
        onPick: () => this.takeBargain('ember_idol', () => {
          s.baseMaxHp = Math.max(4, (s.baseMaxHp ?? s.maxHp) - 3); player.recomputeDerived();
        }),
      },
      {
        title: 'Vow of Greed',
        color: COL.gold,
        lines: ['Chests pay double gold', 'Each chest bites for a little HP'],
        costIdx: 1,
        onPick: () => this.takeBargain('chest_contract', () => {
          player.takeDamage(Math.max(2, Math.floor(s.maxHp * 0.08)), true);
        }),
      },
      {
        title: 'Black Candle',
        color: COL.orchid,
        lines: [candleBoon(), 'Lose a spell, or a healing potion'],
        costIdx: 1,
        onPick: () => this.takeBargain('black_candle', () => {
          const ready = player.spellbook?.available() ?? [];
          if (ready.length > 0) player.spellbook!.cast(ready[0].key);
          else { player.inventory.consume('healing_potion', 1); player.recomputeDerived(); }
        }),
      },
    ];

    this.drawChoiceDialog(this._shrineDialogElements, {
      title: 'CURSED SHRINE',
      sub: 'PICK A RELIC. THE DUNGEON TAKES ITS PRICE NOW.',
      border: COL.orchid,
      fill: COL.ink,
      button: 'TAKE BARGAIN',
      cards: options,
      onCancel: () => {
        this.closeCursedShrine();
        this.ctx.status('You leave the shrine and its bargains alone.');
      },
    });
  }

  private takeBargain(relic: RelicKey, pay: () => void) {
    if (!this._shrineDialogOpen) return;
    pay();
    this.grantRelic(relic);
    this.closeCursedShrine();
    this.ctx.emitHUD();
  }

  private closeCursedShrine() {
    this._shrineDialogElements.forEach(e => e.destroy());
    this._shrineDialogElements = [];
    this._shrineDialogOpen = false;
    this.ctx.bus.emit('ui_close', { panel: 'shrine' });
  }

  // ── Room entry events ──────────────────────────────────────────────────────

  private checkRoomEvents(ptx: number, pty: number) {
    const ctx = this.ctx;
    // The tomb's chambers are authored: the random room events (rune rooms, dens, vault banners) do not belong there.
    if (ctx.currentFloor >= TOMB_FLOOR) return;
    const player = ctx.player;
    const roomIdx = ctx.dungeon.rooms.findIndex(room =>
      ptx >= room.x && ptx < room.x + room.w && pty >= room.y && pty < room.y + room.h
    );
    if (roomIdx < 0) return;

    const room = ctx.dungeon.rooms[roomIdx];
    if (roomIdx !== this._lastPlayerRoomIdx) {
      this._lastPlayerRoomIdx = roomIdx;
      player.refreshArmorWard();
      this.candleReveal(roomIdx);
      if (player.stats.armorTrait === 'warded') {
        ctx.floatText(player.x, player.y - 42, 'WARD READY', 0x80d8ff, 10);
      }
    }
    if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'monster_closet') {
      this._triggeredRoomEvents.add(roomIdx);
      ctx.status(ARCADE_ROOM_EVENTS ? "Den ambush! Hold the room for streak rewards." : "Den ambush!");
      ctx.floatText(player.x, player.y - 48, 'AMBUSH!', 0xff5a5f, 16);
      const pool: EnemyTypeKey[] = enemyPoolForFloor(ctx.currentFloor);
      for (let i = 0; i < 2; i++) {
        const type = pool[Phaser.Math.Between(0, pool.length - 1)];
        this.spawnRoomEnemy(roomIdx, type, i === 0 && !ctx.enemies.some(e => e.isElite));
      }
      this.startRoomChallenge(roomIdx);
    } else if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'trap_corridor') {
      this._triggeredRoomEvents.add(roomIdx);
      let found = 0;
      for (const trap of ctx.dungeon.traps) {
        const key = `${trap.tx},${trap.ty}`;
        if (ctx.persist.triggeredTrapKeys.has(key) || ctx.traps.detectedTraps.has(key)) continue;
        if (trap.tx >= room.x && trap.tx < room.x + room.w && trap.ty >= room.y && trap.ty < room.y + room.h) {
          ctx.traps.detectTrap(key, trap.tx, trap.ty, trap.type, 'search');
          found++;
        }
      }
      ctx.status(found > 0 ? `Rune room: ${found} hazards revealed.` : 'Rune room: the floor hums, but seems safe.');
    } else if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'vault') {
      this._triggeredRoomEvents.add(roomIdx);
      ctx.status("Vault found. Loot the hoard before you leave.");
      ctx.floatText(player.x, player.y - 44, 'VAULT', 0xffd166, 14);
    } else if (!this._triggeredRoomEvents.has(roomIdx)) {
      this._triggeredRoomEvents.add(roomIdx);
      this.startRoomChallenge(roomIdx);
    }

    if (room.modifier && !this._triggeredRoomModifiers.has(roomIdx)) {
      this._triggeredRoomModifiers.add(roomIdx);
      this.triggerRoomModifier(roomIdx, room.modifier);
    }
  }

  /**
   * Black Candle (careful-crawl effect): its black flame leans toward danger, so the first time you step into a room every
   * undiscovered trap on its floor is revealed, the same reveal a rune room gives. Does nothing while the arcade rewards
   * are on (there it doubles gambit pay instead).
   */
  private candleReveal(roomIdx: number) {
    const ctx = this.ctx;
    if (ARCADE_ROOM_EVENTS || !ctx.hasRelic('black_candle') || this._candleRooms.has(roomIdx)) return;
    this._candleRooms.add(roomIdx);
    const room = ctx.dungeon.rooms[roomIdx];
    if (!room) return;
    let found = 0;
    for (const trap of ctx.dungeon.traps) {
      const key = `${trap.tx},${trap.ty}`;
      if (ctx.persist.triggeredTrapKeys.has(key) || ctx.traps.detectedTraps.has(key)) continue;
      if (trap.tx >= room.x && trap.tx < room.x + room.w && trap.ty >= room.y && trap.ty < room.y + room.h) {
        ctx.traps.detectTrap(key, trap.tx, trap.ty, trap.type, 'search');
        found++;
      }
    }
    if (found > 0) {
      ctx.floatText(ctx.player.x, ctx.player.y - 42, 'CANDLE LEANS', COL.orchid, 10);
      ctx.status(`The Black Candle leans: ${found} hidden ${found > 1 ? 'traps' : 'trap'} shown.`);
    }
  }

  private triggerRoomModifier(roomIdx: number, modifier: NonNullable<DungeonData['rooms'][number]['modifier']>) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (modifier === 'blood_rune') {
      if (!ARCADE_ROOM_EVENTS) return;
      player.addEffect('RUSHED', 9000);
      ctx.floatText(player.x, player.y - 56, 'BLOOD RUNE', 0xff5a5f, 14);
      ctx.status("Blood Rune: move fast and chain kills for extra momentum.");
      const pool: EnemyTypeKey[] = enemyPoolForFloor(ctx.currentFloor);
      this.spawnRoomEnemy(roomIdx, pool[Phaser.Math.Between(0, pool.length - 1)]);
    } else if (modifier === 'healing_font') {
      const heal = Math.ceil(player.stats.maxHp * 0.35);
      player.heal(heal);
      ctx.floatText(player.x, player.y - 56, 'FONT', 0x69f0ae, 14);
      ctx.status("Healing Font: recovered HP.");
    } else if (modifier === 'cursed_crypt') {
      player.addEffect('SHIELDED', 7000, 2);
      const pool = enemyPoolForFloor(ctx.currentFloor);
      const undead = pool.filter(k => MONSTERS[k].undead);
      this.spawnRoomEnemy(roomIdx, (undead.length > 0 ? undead : pool)[Phaser.Math.Between(0, (undead.length > 0 ? undead : pool).length - 1)], true);
      ctx.floatText(player.x, player.y - 56, 'CURSED CRYPT', 0xce93d8, 14);
      ctx.status("Cursed Crypt: a champion rises, but clearing it pays bonus XP.");
    } else if (modifier === 'gilded_cache') {
      ctx.floatText(player.x, player.y - 56, 'GILDED CACHE', 0xffd166, 14);
      ctx.status("Gilded Cache: clear the room for a rich bonus.");
    }
  }

  private spawnRoomEnemy(roomIdx: number, type: EnemyTypeKey, elite = false) {
    const ctx = this.ctx;
    const room = ctx.dungeon.rooms[roomIdx];
    if (!room || !ctx.enemyGroup) return;
    const tx = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
    const ty = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
    const enemy = ctx.combat.addEnemy(type, tx, ty, elite);
    (enemy as Enemy & { _roomIdx?: number })._roomIdx = roomIdx;
    ctx.floatText(enemy.x, enemy.y - 24, elite ? 'CHAMPION!' : 'JOINED!', elite ? 0xffd166 : 0xff5a5f, elite ? 13 : 10);
  }

  private checkSpecialRoomEntry() {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!ctx.dungeon.questRooms || ctx.dungeon.questRooms.length === 0) return;
    if (!player.stats.activeQuests) return;

    const ptx = Math.floor(player.x / TILE_SIZE);
    const pty = Math.floor(player.y / TILE_SIZE);

    for (const qr of ctx.dungeon.questRooms) {
      if (this._enteredQuestRooms.has(qr.tag)) continue;
      const room = ctx.dungeon.rooms[qr.roomIdx];
      if (!room) continue;
      if (ptx >= room.x && ptx < room.x + room.w && pty >= room.y && pty < room.y + room.h) {
        this._enteredQuestRooms.add(qr.tag);
        if (onSpecialRoomEntered(player.stats.activeQuests, qr.tag)) {
          ctx.floatText(player.x, player.y - 40, `Found: ${room.tag ?? qr.tag}!`, 0xffd700, 16);
          ctx.status(`Quest room discovered: ${room.tag ?? qr.tag}`);
        }
      }
    }
  }

  /** Destroys any open dialog and drops transient state. Called on scene shutdown / floor change. */
  destroy() {
    this._shrineDialogElements.forEach(e => e.destroy());
    this._shrineDialogElements = [];
    this._boonDialogElements.forEach(e => e.destroy());
    this._boonDialogElements = [];
    this._shrineDialogOpen = false;
    this._boonDialogOpen = false;
    this._roomChallenge = undefined;
  }
}
