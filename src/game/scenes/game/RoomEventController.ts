import * as Phaser from "phaser";
import { TILE_SIZE, EnemyTypeKey, enemyPoolForFloor } from "../../constants";
import type { DungeonData } from "../../systems/DungeonGenerator";
import { onSpecialRoomEntered } from "../../systems/QuestSystem";
import type { Enemy } from "../../entities/Enemy";
import { MONSTERS } from "../../rules";
import type { GameContext, RelicKey } from "../../GameContext";

type BoonKey = 'blade' | 'bulwark' | 'vigor' | 'arcana' | 'fortune';

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

/** Room, gambit and objective XP was written when a goblin gave 15 and levels came every 100; a quarter of it fits first-edition XP. */
const bonusXp = (n: number): number => Math.max(1, Math.round(n * 0.25));

const RELIC_LABELS: Record<RelicKey, string> = {
  ember_idol: 'Ember Idol',
  swift_vial: 'Swift Vial',
  chest_contract: 'Chest Contract',
  black_candle: 'Black Candle',
  boss_trophy: 'Guardian Trophy',
};

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
    const challenge = this._roomChallenge;
    if (!challenge) return;
    challenge.timeLeft -= delta;
    if (challenge.timeLeft > 0) return;
    this.ctx.floatText(this.ctx.player.x, this.ctx.player.y - 54, 'CHANCE LOST', 0x888899, 11);
    this.ctx.status("Room challenge faded. The dungeon will not wait.");
    this._roomChallenge = undefined;
  }

  private startRoomChallenge(roomIdx: number) {
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
        color: 0xff5a5f,
        apply: () => {
          s.weaponBonus += 1;
          player.recomputeDerived();
        },
      },
      {
        key: 'bulwark',
        title: 'Old Shield',
        lines: ['Armor class 1 better', 'Heal 25% max HP'],
        color: 0x80d8ff,
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
        color: 0x69f0ae,
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
        color: 0xce93d8,
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
        color: 0xffd166,
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
    const scene = this.ctx.scene;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const D = 220;
    const els = this._boonDialogElements;

    els.push(scene.add.rectangle(cx, cy, W, H, 0x000000, 0.62).setScrollFactor(0).setDepth(D));
    els.push(scene.add.rectangle(cx, cy, 720, 300, 0x080814, 0.97)
      .setStrokeStyle(2, 0xffd166).setScrollFactor(0).setDepth(D));
    els.push(scene.add.text(cx, cy - 126, 'CLAIM A BOON', {
      fontSize: '24px', color: '#ffd166', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    els.push(scene.add.text(cx, cy - 96, 'Choose one reward for this run.', {
      fontSize: '12px', color: '#888899', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    this.buildBoonOptions().forEach((option, i) => {
      const x = cx - 230 + i * 230;
      this.addBoonCard(x, cy + 32, option);
    });
  }

  private addBoonCard(x: number, y: number, option: BoonOption) {
    const scene = this.ctx.scene;
    const D = 220;
    const W = 200;
    const H = 190;
    const els = this._boonDialogElements;
    const hex = `#${option.color.toString(16).padStart(6, '0')}`;

    const bg = scene.add.rectangle(x, y, W, H, 0x111122, 0.98)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, option.color)
      .setScrollFactor(0)
      .setDepth(D);
    els.push(bg);

    els.push(scene.add.text(x, y - H / 2 + 24, option.title, {
      fontSize: '15px', color: hex, fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D + 1));

    option.lines.forEach((line, i) => {
      els.push(scene.add.text(x - W / 2 + 18, y - H / 2 + 58 + i * 24, line, {
        fontSize: '12px', color: '#c8c8d8', fontFamily: 'monospace',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1));
    });

    const choose = scene.add.text(x, y + H / 2 - 28, 'CHOOSE', {
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
    const ctx = this.ctx;
    const scene = ctx.scene;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const D = 220;
    const player = ctx.player;
    const s = player.stats;

    const options = [
      {
        title: 'Blood for Fire',
        relic: 'ember_idol' as RelicKey,
        lines: ['Lose 3 max HP for good', 'First kill in each room grants Rush'],
        color: 0xff5a5f,
        pay: () => { s.baseMaxHp = Math.max(4, (s.baseMaxHp ?? s.maxHp) - 3); player.recomputeDerived(); },
      },
      {
        title: 'Vow of Greed',
        relic: 'chest_contract' as RelicKey,
        lines: ['Chests pay double gold', 'Each chest bites for a little HP'],
        color: 0xffd166,
        pay: () => player.takeDamage(Math.max(2, Math.floor(s.maxHp * 0.08)), true),
      },
      {
        title: 'Black Candle',
        relic: 'black_candle' as RelicKey,
        lines: ['Room gambits pay double', 'Lose a spell, or a healing potion'],
        color: 0xce93d8,
        pay: () => {
          const ready = player.spellbook?.available() ?? [];
          if (ready.length > 0) player.spellbook!.cast(ready[0].key);
          else { player.inventory.consume('healing_potion', 1); player.recomputeDerived(); }
        },
      },
    ];

    const els = this._shrineDialogElements;
    els.push(scene.add.rectangle(cx, cy, W, H, 0x000000, 0.62).setScrollFactor(0).setDepth(D));
    els.push(scene.add.rectangle(cx, cy, 690, 300, 0x120812, 0.98).setStrokeStyle(2, 0xce93d8).setScrollFactor(0).setDepth(D));
    els.push(scene.add.text(cx, cy - 118, 'Cursed Shrine', {
      fontSize: '22px', color: '#ce93d8', fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    els.push(scene.add.text(cx, cy - 88, 'Pick a relic. The dungeon takes its price now.', {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D));

    options.forEach((option, i) => {
      const x = cx - 220 + i * 220;
      const card = scene.add.rectangle(x, cy + 20, 200, 190, 0x160f1f, 0.98)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, option.color)
        .setScrollFactor(0)
        .setDepth(D);
      els.push(card);
      els.push(scene.add.text(x, cy - 50, option.title, {
        fontSize: '14px', color: `#${option.color.toString(16).padStart(6, '0')}`, fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
      option.lines.forEach((line, lineIdx) => {
        els.push(scene.add.text(x - 82, cy - 16 + lineIdx * 24, line, {
          fontSize: '11px', color: '#c9bed6', fontFamily: 'monospace',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(D));
      });
      const take = () => {
        option.pay();
        this.grantRelic(option.relic);
        this.closeCursedShrine();
        ctx.emitHUD();
      };
      card.on('pointerover', () => card.setFillStyle(0x241432));
      card.on('pointerout', () => card.setFillStyle(0x160f1f));
      card.on('pointerdown', take);
      els.push(scene.add.text(x, cy + 88, 'TAKE BARGAIN', {
        fontSize: '11px', color: '#ffffff', fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D));
    });
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
    const player = ctx.player;
    const roomIdx = ctx.dungeon.rooms.findIndex(room =>
      ptx >= room.x && ptx < room.x + room.w && pty >= room.y && pty < room.y + room.h
    );
    if (roomIdx < 0) return;

    const room = ctx.dungeon.rooms[roomIdx];
    if (roomIdx !== this._lastPlayerRoomIdx) {
      this._lastPlayerRoomIdx = roomIdx;
      player.refreshArmorWard();
      if (player.stats.armorTrait === 'warded') {
        ctx.floatText(player.x, player.y - 42, 'WARD READY', 0x80d8ff, 10);
      }
    }
    if (!this._triggeredRoomEvents.has(roomIdx) && room.type === 'monster_closet') {
      this._triggeredRoomEvents.add(roomIdx);
      ctx.status("Den ambush! Hold the room for streak rewards.");
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

  private triggerRoomModifier(roomIdx: number, modifier: NonNullable<DungeonData['rooms'][number]['modifier']>) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (modifier === 'blood_rune') {
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
