import { ARCADE_ROOM_EVENTS } from "./RoomEventController";
import * as Phaser from "phaser";
import type { PlayerStats, CharCreationData } from "../../entities/Player";
import { TILE, TILE_SIZE, COLORS, PLAYER_STATS, ENEMY_TYPES, EnemyTypeKey } from "../../constants";
import { onEnemyKilled } from "../../systems/QuestSystem";
import { Player } from "../../entities/Player";
import { Enemy } from "../../entities/Enemy";
import type { GameContext } from "../../GameContext";
import {
  MONSTERS, WIZARD_DART, RANGE_PX, mathRng, rollDice, turnUndead, hasSpecial, isTurnable,
} from "../../rules";
import { equipmentBonuses, getDef } from "../../items";
import { charismaReaction } from "../../rules";
import {
  ALLY_DEATH_RADIUS_PX, KEEP_DISTANCE_MS, SURPRISE_MS, fleeDurationMs, isIntelligent, lineOfSight, monsterReaction,
  moraleCheck, neverChecksMorale, retreatOutcome, surpriseRoll,
} from "../../rules/encounter";
import { isLargeMonster } from "../../rules";
import type { SaveCategory } from "../../rules/classes";
import { planLargeSpawnsForLayout, playerReachesMonster, type Tile as PlanTile } from "../../rules/largeMonsters";
import type { EnemyEvent } from "../../entities/Enemy";
import {
  resolvePlayerAttack, resolveMonsterRound, playerArmorClass, ignoresArmor, weaponProfile, enemyKeyIsMonster,
  type MonsterRound, type PlayerAttackOutcome, type TargetInfo,
} from "./AdndCombat";

/** Cooldown between Turn Undead attempts (ms). */
const TURN_COOLDOWN_MS = 4000;
/** Reach of a fired weapon (bow, sling) in pixels. */
const MISSILE_RANGE_PX = 224;

interface EnemyBolt {
  obj: Phaser.GameObjects.Rectangle;
  vx: number; vy: number; life: number;
  /** A weapon-style bolt rolls the monster's attacks when it lands; a spell bolt does fixed damage. */
  kind: 'weapon' | 'spell';
  enemy: Enemy;
  spellDamage?: number;
  spellSave?: boolean;
  /** Which saving throw halves the damage; spells by default, `breath` for a wyrm's fire. */
  spellSaveCategory?: SaveCategory;
}

/**
 * Player and enemy spawning, the player's swing (a d20 against armor class), monster attack rounds, death and
 * loot on a kill, kill momentum, boss phases and Turn Undead. The arithmetic lives in `AdndCombat.ts`.
 */
export class CombatController {
  private enemyProjectiles: EnemyBolt[] = [];
  private turnCooldown = 0;
  private _kingSlain = false;
  private _hasKing = false;
  private _gutterWarned = false;
  private _relightTimer = 0;

  constructor(private ctx: GameContext) {}

  // ── Player ────────────────────────────────────────────────────────────────

  spawnPlayer(charData?: CharCreationData, persistedStatsIn?: PlayerStats) {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const { tx, ty } = ctx.dungeon.playerStart;
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;

    let persistedStats: PlayerStats | undefined;
    if (persistedStatsIn) {
      persistedStats = { ...persistedStatsIn, floor: ctx.currentFloor };
    }

    ctx.player = new Player(scene, px, py, charData, persistedStats);

    ctx.player.setCallbacks({
      onDamage: (dmg) => {
        ctx.floatText(ctx.player.x, ctx.player.y - 20, `-${dmg}`, COLORS.DAMAGE_TEXT);
        ctx.emitHUD();
        scene.cameras.main.shake(80, 0.005);
        ctx.bus.emit('player_hurt', { damage: dmg });
      },
      onHeal: (amount) => {
        if (amount <= 0) return;
        ctx.floatText(ctx.player.x, ctx.player.y - 20, `+${amount}`, COLORS.HEAL_TEXT);
        ctx.emitHUD();
        ctx.bus.emit('heal', { amount });
      },
      onDead: () => ctx.floor.handlePlayerDeath(),
      onXP: (gained) => {
        ctx.floatText(ctx.player.x, ctx.player.y - 30, `+${gained} XP`, COLORS.XP_TEXT, 12);
        ctx.emitHUD();
      },
      onLevelUp: (level) => {
        ctx.floatText(ctx.player.x, ctx.player.y - 50, `LEVEL UP! ${level}`, 0xffd700, 18);
        scene.cameras.main.flash(200, 80, 80, 20);
        ctx.status(`You are now level ${level}: ${ctx.player.stats.title ?? ''}.`);
        ctx.emitHUD();
        ctx.bus.emit('level_up', { level });
      },
      onTurnUndead: () => this.doTurnUndead(),
    });

    scene.physics.add.collider(ctx.player, ctx.wallGroup);

    // Light: hold a torch from the pack if nothing is burning.
    const light = ctx.player.ensureLight();
    if (light === 'equipped') ctx.status("You light a torch.");
    else if (light === 'none' && !ctx.player.hasLight()) ctx.status("You have no light. Darkness presses in.");
    ctx.player.recomputeDerived();
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  spawnEnemies() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    ctx.enemyGroup = scene.physics.add.group();
    ctx.enemies.length = 0;

    for (let i = 0; i < ctx.dungeon.enemies.length; i++) {
      if (ctx.persist.deadEnemyIndices.has(i)) continue; // already killed in a prior visit

      const spawn = ctx.dungeon.enemies[i];
      const enemy = this.addEnemy(spawn.type, spawn.tx, spawn.ty, !!spawn.elite);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = i;
      (enemy as Enemy & { _roomIdx?: number })._roomIdx = spawn.roomIdx;
    }

    // Monsters placed by name (the tomb's Hollow King). Their persistence indices follow the random spawns.
    const markers = ctx.dungeon.spawnMarkers ?? [];
    this._hasKing = false;
    this._kingSlain = false;
    markers.forEach((m, mi) => {
      if (!enemyKeyIsMonster(m.monster)) return;
      const idx = ctx.dungeon.enemies.length + mi;
      const isKing = m.monster === 'HOLLOW_KING';
      if (isKing) this._hasKing = true;
      if (ctx.persist.deadEnemyIndices.has(idx)) {
        if (isKing) this._kingSlain = true;
        return;
      }
      const enemy = this.addEnemy(m.monster, m.tx, m.ty, false);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = idx;
    });

    this.spawnLargeMonsters(ctx.dungeon.enemies.length + markers.length);

    scene.physics.add.collider(ctx.player, ctx.enemyGroup);
    scene.physics.add.collider(ctx.enemyGroup, ctx.enemyGroup);
  }

  /**
   * Zero, one or two large monsters (48 and 64 pixels) per floor, each on a clear 2x2 block of open floor in a room,
   * so none is born inside a wall or a corridor it cannot leave. The plan is seeded by the floor's layout, so a
   * revisit finds the same giants in the same places; their persistence indices follow the random spawns and markers.
   */
  private spawnLargeMonsters(firstIdx: number) {
    const ctx = this.ctx;
    const d = ctx.dungeon;
    const taken: PlanTile[] = [
      ...d.enemies, ...d.items, ...d.chests, ...d.traps, ...(d.inscriptions ?? []), ...(d.spawnMarkers ?? []),
      ...d.secretDoors, ...(d.mechanisms ?? []).flatMap((m) => [{ tx: m.tx, ty: m.ty }, ...(m.tiles ?? [])]),
    ];
    const plan = planLargeSpawnsForLayout({
      floor: ctx.currentFloor,
      rooms: d.rooms,
      isOpenFloor: (tx, ty) => d.tiles[ty]?.[tx] === TILE.FLOOR && ctx.isWalkable(tx, ty),
      occupied: taken,
      keepAwayFrom: [d.playerStart, d.stairsPos, d.stairsUpPos],
    });
    plan.forEach((p, k) => {
      const idx = firstIdx + k;
      if (ctx.persist.deadEnemyIndices.has(idx)) return;
      const enemy = this.addEnemyAt(p.key, p.x, p.y);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = idx;
      (enemy as Enemy & { _roomIdx?: number })._roomIdx = p.roomIdx;
    });
  }

  /** Make a monster at a tile and register it with the floor. */
  addEnemy(type: EnemyTypeKey, tx: number, ty: number, elite = false): Enemy {
    return this.addEnemyAt(type, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, elite);
  }

  /** Make a monster at a world position (a large one stands on the corner of four tiles, not the middle of one). */
  addEnemyAt(type: EnemyTypeKey, x: number, y: number, elite = false): Enemy {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const enemy = new Enemy(scene, x, y, type, elite);
    ctx.enemies.push(enemy);
    ctx.enemyGroup.add(enemy);
    scene.physics.add.collider(enemy, ctx.wallGroup);
    return enemy;
  }

  /** The tomb's final guardian is dead (or this floor never had one). Gates the way out of the tomb. */
  get bossSlain(): boolean {
    return !this._hasKing || this._kingSlain;
  }

  /** A monster wanders in from the dark, a few tiles from the player (rest interrupted). */
  spawnWanderingMonster(): Enemy | null {
    const ctx = this.ctx;
    if (!ctx.enemyGroup) return null;
    const pool = Object.values(MONSTERS).filter(
      (m) => !m.boss && !isLargeMonster(m) && m.minFloor <= ctx.currentFloor && (m.maxFloor === undefined || ctx.currentFloor <= m.maxFloor) &&
        m.key !== 'MIMIC' && (ctx.currentFloor > 1 || m.hd <= 1),
    );
    if (pool.length === 0) return null;
    const def = pool[Math.floor(Math.random() * pool.length)];
    const ptx = Math.floor(ctx.player.x / TILE_SIZE);
    const pty = Math.floor(ctx.player.y / TILE_SIZE);
    const spots: Array<[number, number]> = [];
    for (let r = 3; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ctx.isWalkable(ptx + dx, pty + dy)) spots.push([ptx + dx, pty + dy]);
        }
      }
    }
    if (spots.length === 0) return null;
    const [tx, ty] = spots[Math.floor(Math.random() * spots.length)];
    const enemy = this.addEnemy(def.key, tx, ty);
    ctx.floatText(enemy.x, enemy.y - 24, 'WANDERING!', 0xff5a5f, 11);
    return enemy;
  }

  // ── Per-frame pieces (called by GameScene.update in the old order) ─────────

  /** Kill-streak decay, and the slow things that happen to a living adventurer (torch burning down). */
  tickKillStreak(delta: number) {
    const run = this.ctx.run;
    run.killStreakTimer = Math.max(0, run.killStreakTimer - delta);
    if (run.killStreakTimer <= 0) run.killStreak = 0;
    this.turnCooldown = Math.max(0, this.turnCooldown - delta);
    this.tickSurvival(delta);
  }

  private tickSurvival(delta: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const { burntOut } = player.burnLight(delta);
    if (burntOut) {
      ctx.bus.emit('torch_out');
      const relit = player.ensureLight();
      if (relit === 'equipped') {
        ctx.status("Your torch gutters out. You light another.");
        this._gutterWarned = false;
      } else if (!this._gutterWarned) {
        this._gutterWarned = true;
        ctx.status("Your torch gutters out. You can see only the tile you stand on.");
        ctx.floatText(player.x, player.y - 40, 'DARK', 0x888899, 12);
      }
    } else if (player.hasLight()) {
      this._gutterWarned = false;
      this._relightTimer = 0;
    } else {
      // In the dark: light a torch as soon as one turns up in the pack.
      this._relightTimer += delta;
      if (this._relightTimer >= 1000) {
        this._relightTimer = 0;
        if (player.ensureLight() === 'equipped') {
          ctx.status("You light a torch.");
          this._gutterWarned = false;
        }
      }
    }
  }

  /** Player swing: the attack input check, then the hit resolution. */
  updatePlayerAttack() {
    if (this.ctx.player.tryAttack()) {
      this.handlePlayerAttack();
    }
  }

  /** Enemy AI update, melee rounds, ranged bolts, casting, summoning. */
  updateEnemies(delta: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      const enemy = ctx.enemies[i];
      if (!enemy.active) { ctx.enemies.splice(i, 1); continue; }

      if (!enemy.contactDone) this.checkFirstContact(enemy);
      // Only wary monsters need to know whether they can see you (their patience runs while you are in sight).
      const sees = enemy.attitude === 'wary' ? this.canSee(enemy.x, enemy.y, player.x, player.y) : true;
      enemy.update(delta, player.x, player.y, sees);
      this.handleEnemyEvents(enemy);
      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);

      const spell = enemy.takeSpellTurn(dist);
      if (spell) this.monsterCastSpell(enemy, spell);

      if (enemy.summonDue()) this.monsterSummon(enemy);

      if (enemy.canAttackPlayer(player.x, player.y)) {
        enemy.beginAttack();
        if (enemy.isRanged) {
          this.spawnEnemyBolt(enemy, player.x, player.y);
        } else {
          const round = this.rollMonsterRound(enemy);
          this.applyMonsterRound(enemy, round);
        }
      }
    }
  }

  // ── Encounter rules: surprise, reaction, morale (the dice live in rules/encounter.ts) ──

  private isOpaqueTile = (tx: number, ty: number): boolean => {
    const t = this.ctx.dungeon.tiles[ty]?.[tx];
    return t === undefined || t === TILE.WALL || t === TILE.SECRET_DOOR;
  };

  /** Straight-line sight between two world positions, over the dungeon tiles. */
  canSee(ax: number, ay: number, bx: number, by: number): boolean {
    return lineOfSight(
      this.isOpaqueTile,
      { tx: Math.floor(ax / TILE_SIZE), ty: Math.floor(ay / TILE_SIZE) },
      { tx: Math.floor(bx / TILE_SIZE), ty: Math.floor(by / TILE_SIZE) },
    );
  }

  /** The moment a monster first notices the player: 2 in 6 it is caught flat, and the intelligent ones size you up. */
  private checkFirstContact(enemy: Enemy) {
    if (enemy.status) return; // asleep or held: it has not noticed anything yet
    if (enemy.isMimic) {
      // A mimic springs on you; there is no talking to a chest.
      if (enemy.mimicRevealed) enemy.contactDone = true;
      return;
    }
    const player = this.ctx.player;
    const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
    if (dist > enemy.aggroRange) return;
    enemy.contactDone = true;

    const ctx = this.ctx;
    const summoned = !!enemy.summonedBy;
    if (!summoned && !enemy.def.boss && surpriseRoll(mathRng)) {
      enemy.beginSurprise(SURPRISE_MS);
      ctx.floatText(enemy.x, enemy.y - 28, '!', 0xffd166, 16);
      ctx.bus.emit('monster_surprised', { enemyKey: enemy.typeKey });
    }

    if (summoned || !isIntelligent(enemy.def)) return;
    const reaction = monsterReaction(enemy.def, mathRng, charismaReaction(player.stats.cha), { summoned });
    ctx.bus.emit('monster_reaction', { enemyKey: enemy.typeKey, reaction });
    if (reaction === 'wary') {
      enemy.attitude = 'wary';
      ctx.floatText(enemy.x, enemy.y - 40, 'wary', 0xffe082, 10);
    } else if (reaction === 'afraid') {
      enemy.attitude = 'afraid';
      ctx.floatText(enemy.x, enemy.y - 40, 'afraid', 0x90caf9, 10);
    }
  }

  /** Floating words and the next roll for things the monster's own AI reported this frame. */
  private handleEnemyEvents(enemy: Enemy) {
    const events: EnemyEvent[] = enemy.drainEvents();
    for (const ev of events) {
      if (ev === 'afraid_flee') {
        this.ctx.floatText(enemy.x, enemy.y - 28, 'flees!', 0x90caf9, 11);
      } else if (ev === 'cornered') {
        this.ctx.floatText(enemy.x, enemy.y - 28, 'cornered!', 0xff8a65, 10);
      } else if (ev === 'flee_ended' || ev === 'distance_ended') {
        const { outcome } = retreatOutcome(enemy.def.morale, mathRng, enemy.retreats - 1);
        if (outcome === 'return') {
          enemy.returnToFight();
          this.ctx.floatText(enemy.x, enemy.y - 28, 'rallies!', 0xffd166, 10);
        } else {
          enemy.startKeepDistance(KEEP_DISTANCE_MS);
          this.ctx.floatText(enemy.x, enemy.y - 28, 'hangs back', 0xb0bec5, 10);
        }
      }
    }
  }

  /** One morale check. A failure sends the monster running from the player for four to six seconds. */
  private checkMorale(enemy: Enemy, cause: 'wounded' | 'ally_died') {
    if (!enemy.active || enemy.hp <= 0 || enemy.status) return;
    if (neverChecksMorale(enemy.def, { summoned: !!enemy.summonedBy })) return;
    if (enemy.retreating || enemy.desperate || !enemy.contactDone) return;
    const result = moraleCheck(enemy.def.morale, mathRng);
    this.ctx.bus.emit('monster_morale', { enemyKey: enemy.typeKey, passed: result.passed, roll: result.roll, cause });
    if (result.passed) return;
    enemy.startMoraleFlee(fleeDurationMs(mathRng));
    this.ctx.floatText(enemy.x, enemy.y - 28, 'flees!', 0xff8a65, 11);
  }

  /** After a blow: the monster and its neighbours stop being wary, and a monster under half hit points checks nerve. */
  private afterBlow(enemy: Enemy) {
    for (const e of this.ctx.enemies) {
      if (e === enemy || !e.active || e.attitude === 'hostile') continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, enemy.x, enemy.y) <= ALLY_DEATH_RADIUS_PX) e.provoke();
    }
    if (enemy.hp > 0 && !enemy.halfMoraleChecked && enemy.hp * 2 < enemy.maxHp) {
      enemy.halfMoraleChecked = true;
      this.checkMorale(enemy, 'wounded');
    }
  }

  /** A monster died: each living one within about six tiles that can see the body checks its nerve. */
  private allyDied(x: number, y: number, dead: Enemy) {
    for (const e of [...this.ctx.enemies]) {
      if (e === dead || !e.active || e.hp <= 0) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, x, y) > ALLY_DEATH_RADIUS_PX) continue;
      if (!this.canSee(e.x, e.y, x, y)) continue;
      this.checkMorale(e, 'ally_died');
    }
  }

  // ── Monster attacks ───────────────────────────────────────────────────────

  private rollMonsterRound(enemy: Enemy): MonsterRound {
    const sheet = this.ctx.player.sheet();
    const ac = playerArmorClass(sheet, { ignoreArmor: ignoresArmor(enemy.def) });
    return resolveMonsterRound(enemy.def, ac, mathRng, {
      toHit: enemy.isElite ? 1 : 0,
      damage: enemy.isElite ? 1 : 0,
    });
  }

  /** Show the misses, hurt the player by the hits, then run the monster's specials. */
  private applyMonsterRound(enemy: Enemy, round: MonsterRound) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (round.hits === 0) {
      ctx.floatText(player.x, player.y - 28, 'miss', 0x888899, 10);
      return;
    }
    player.takeDamage(round.total, false, enemy.def.name);
    if (player.stats.hp <= 0) return;
    this.applyOnHitSpecials(enemy);
    const b = equipmentBonuses(player.inventory);
    if (b.thorns > 0 && !enemy.isRanged) this.damageEnemy(enemy, b.thorns, {});
  }

  private applyOnHitSpecials(enemy: Enemy) {
    const ctx = this.ctx;
    const player = ctx.player;
    const def = enemy.def;
    const b = equipmentBonuses(player.inventory);

    const poison = hasSpecial(def, 'poison');
    if (poison && !b.resistPoison) {
      const save = player.rollSave(poison.save);
      if (!save.success) {
        player.addEffect('POISONED', poison.durationMs, poison.dps);
        ctx.floatText(player.x, player.y - 36, 'POISONED', 0x4caf50, 11);
      } else {
        ctx.floatText(player.x, player.y - 36, 'saved', 0x69f0ae, 10);
      }
    }
    const para = hasSpecial(def, 'paralysis');
    if (para && player.canBeHeld()) {
      const save = player.rollSave(para.save);
      if (!save.success) {
        player.addEffect('HELD', para.durationMs);
        ctx.floatText(player.x, player.y - 36, 'PARALYZED', 0xb0bec5, 12);
        ctx.status(`The ${def.name} paralyzes you.`);
      } else {
        ctx.floatText(player.x, player.y - 36, 'resisted', 0x69f0ae, 10);
      }
    }
    const drain = hasSpecial(def, 'drain');
    if (drain) {
      const saved = drain.save ? player.rollSave(drain.save).success : false;
      if (!saved) {
        const lost = player.drainMaxHp(drain.maxHpPerHit);
        if (lost > 0) {
          ctx.floatText(player.x, player.y - 36, `DRAINED -${lost}`, 0xb39ddb, 11);
          ctx.status(`The ${def.name} drains your life. Rest to recover it.`);
        }
      }
    }
    for (const c of def.special ?? []) {
      if (c.kind === 'corrode' && c.target === 'armor' && Math.random() * 100 < c.chancePct) {
        this.corrodeItem(player.inventory.equipment.armor, 'armor');
      }
    }
    if (hasSpecial(def, 'incorporeal')) ctx.floatText(player.x, player.y - 36, 'CHILL', 0x80cbc4, 11);
    else if (enemy.typeKey === 'TROLL' || enemy.typeKey === 'TANK') {
      ctx.scene.cameras.main.shake(90, 0.006);
      ctx.floatText(player.x, player.y - 36, 'SLAM', 0xffd166, 11);
    }
  }

  /** Acid eats a plus off a piece of gear (never below -3). */
  private corrodeItem(item: { plus: number; defKey: string } | undefined, what: 'weapon' | 'armor') {
    if (!item || item.plus <= -3) return;
    item.plus -= 1;
    this.ctx.status(`Your ${getDef(item.defKey).name} corrodes (${item.plus >= 0 ? '+' : ''}${item.plus}).`);
    this.ctx.floatText(this.ctx.player.x, this.ctx.player.y - 44, `${what} corrodes`, 0x76ff03, 10);
    this.ctx.player.recomputeDerived();
    this.ctx.emitHUD();
  }

  private monsterCastSpell(enemy: Enemy, spell: string) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (spell === 'hold_person') {
      if (!player.canBeHeld()) return;
      ctx.floatText(enemy.x, enemy.y - 26, 'HOLD', 0xb0bec5, 10);
      ctx.scene.tweens.add({ targets: enemy, alpha: 0.5, duration: 80, yoyo: true });
      const save = player.rollSave('spells');
      if (!save.success) {
        player.addEffect('HELD', enemy.def.boss ? 3000 : 2500);
        ctx.floatText(player.x, player.y - 36, 'HELD', 0xb0bec5, 12);
      } else {
        ctx.floatText(player.x, player.y - 36, 'saved', 0x69f0ae, 10);
      }
      return;
    }
    // Dragon's breath: a big gout of fire, save versus breath for half.
    if (spell === 'fire_breath') {
      ctx.floatText(enemy.x, enemy.y - 40, 'BREATH!', 0xff6f00, 12);
      const bx = player.x - enemy.x;
      const by = player.y - enemy.y;
      const bl = Math.sqrt(bx * bx + by * by) || 1;
      const gout = ctx.scene.add.rectangle(enemy.x, enemy.y, 16, 16, 0xff6f00).setDepth(16);
      this.enemyProjectiles.push({
        obj: gout, vx: (bx / bl) * 240, vy: (by / bl) * 240, life: 1600, kind: 'spell', enemy,
        spellDamage: rollDice(mathRng, '5d6'), spellSave: true, spellSaveCategory: 'breath',
      });
      return;
    }
    // Missile or fireball: a bolt that does fixed damage on arrival.
    const isFire = spell === 'fireball';
    const dmg = isFire ? rollDice(mathRng, '3d6') : rollDice(mathRng, '1d4+1');
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const bolt = ctx.scene.add.rectangle(enemy.x, enemy.y, isFire ? 9 : 5, isFire ? 9 : 5, isFire ? 0xff6f00 : 0xffffff).setDepth(16);
    this.enemyProjectiles.push({
      obj: bolt, vx: (dx / len) * 260, vy: (dy / len) * 260, life: 1600, kind: 'spell', enemy,
      spellDamage: dmg, spellSave: isFire,
    });
  }

  private monsterSummon(boss: Enemy) {
    const ctx = this.ctx;
    const summon = hasSpecial(boss.def, 'summon');
    if (!summon) return;
    const alive = ctx.enemies.filter(e => e.active && e.summonedBy === boss).length;
    if (alive >= summon.maxAlive) return;
    this.summonAround(boss, summon.monster, 1);
  }

  private summonAround(boss: Enemy, monster: EnemyTypeKey, count: number) {
    const ctx = this.ctx;
    const btx = Math.floor(boss.x / TILE_SIZE);
    const bty = Math.floor(boss.y / TILE_SIZE);
    let placed = 0;
    for (let r = 2; r <= 4 && placed < count; r++) {
      for (let dy = -r; dy <= r && placed < count; dy++) {
        for (let dx = -r; dx <= r && placed < count; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!ctx.isWalkable(btx + dx, bty + dy) || Math.random() < 0.7) continue;
          const e = this.addEnemy(monster, btx + dx, bty + dy);
          e.summonedBy = boss;
          ctx.floatText(e.x, e.y - 22, 'RISES', 0xce93d8, 10);
          placed++;
        }
      }
    }
  }

  // ── Turn Undead ────────────────────────────────────────────────────────────

  /** T key: the cleric's turning table, by cleric level against each undead's hit dice. */
  doTurnUndead() {
    const ctx = this.ctx;
    if (this.turnCooldown > 0) {
      ctx.status("You have only just called on your faith. Wait a moment.");
      return;
    }
    this.turnCooldown = TURN_COOLDOWN_MS;
    const level = ctx.player.stats.level;
    let turned = 0;
    let destroyed = 0;
    for (const enemy of [...ctx.enemies]) {
      if (!enemy.active || !enemy.isUndead) continue;
      const dx = enemy.x - ctx.player.x;
      const dy = enemy.y - ctx.player.y;
      if (Math.sqrt(dx * dx + dy * dy) > 200) continue;
      if (!isTurnable(enemy.def)) { ctx.floatText(enemy.x, enemy.y - 22, 'unmoved', 0x888899, 10); continue; }
      const outcome = turnUndead(level, enemy.def.hd, mathRng);
      if (outcome === 'destroyed') {
        destroyed++;
        enemy.hp = 0;
        this.killEnemy(enemy);
      } else if (outcome === 'turned') {
        if (enemy.forceFleeFrom(ctx.player.x, ctx.player.y, 10000)) turned++;
      }
    }
    ctx.floatText(ctx.player.x, ctx.player.y - 40, `Turn Undead! ${turned} flee, ${destroyed} destroyed`, 0xfff9c4, 13);
    ctx.status(turned + destroyed > 0
      ? `You turn the dead: ${turned} flee, ${destroyed} crumble.`
      : "The dead are not impressed.");
    ctx.bus.emit('spell_cast', { key: 'TURN_UNDEAD' });
  }

  // ── The player's swing ────────────────────────────────────────────────────

  private targetInfo(enemy: Enemy): TargetInfo {
    return {
      ac: enemy.ac,
      def: enemy.def,
      key: enemy.typeKey,
      unaware: enemy.isUnaware,
      helpless: enemy.isHelpless,
      surprised: enemy.isSurprised,
    };
  }

  private handlePlayerAttack() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const player = ctx.player;
    const attackBox = player.getAttackBox();
    this.spawnAttackArc();
    ctx.bus.emit('player_swing');

    // Nearest enemy inside the swing box.
    let target: Enemy | null = null;
    let best = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.active || enemy.hp <= 0) continue;
      if (enemy.isMimic && !enemy.mimicRevealed) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemy.getBounds())) continue;
      const d = Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y);
      if (d < best) { best = d; target = enemy; }
    }

    // Nothing in front: turn on whatever is within reach (a rat at your heels, something behind you).
    if (!target) {
      const reach = PLAYER_STATS.ATTACK_RANGE;
      for (const enemy of ctx.enemies) {
        if (!enemy.active || enemy.hp <= 0) continue;
        if (enemy.isMimic && !enemy.mimicRevealed) continue;
        const d = Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y);
        // Edge to edge: a big body's centre is farther away than the part of it you can strike.
        if (playerReachesMonster(d, enemy.displayWidth, reach) && d < best) { best = d; target = enemy; }
      }
      if (target) {
        const oct = Math.round(Math.atan2(target.y - player.y, target.x - player.x) / (Math.PI / 4));
        player.stats.facing = { x: Math.round(Math.cos(oct * Math.PI / 4)), y: Math.round(Math.sin(oct * Math.PI / 4)) };
      }
    }

    const weapon = weaponProfile(player.inventory);
    const wantsMissile = !target && (weapon.ranged || player.stats.classKey === 'wizard');
    if (wantsMissile) {
      this.fireMissile(weapon.ranged);
      return;
    }

    if (!target) {
      const fx = player.stats.facing.x || 0;
      const fy = player.stats.facing.y || 1;
      ctx.floatText(player.x + fx * 28, player.y + fy * 28, 'miss', 0x888899, 10);
      ctx.bus.emit('player_miss');
      return;
    }

    const outcome = resolvePlayerAttack(player.sheet(), this.targetInfo(target), mathRng, 'melee');
    const killed = this.applyPlayerOutcome(target, outcome, 'melee');
    if (outcome.kind === 'hit') {
      scene.cameras.main.shake(40, 0.0025);
      scene.tweens.add({ targets: target, scaleX: 1.15, scaleY: 1.15, duration: 60, yoyo: true });
    }
    if (killed && player.stats.classKey === 'fighter') this.doCleave(target.x, target.y);
  }

  /** Shared by melee and missiles: show the result, emit events, hurt the monster. Returns true on a kill. */
  private applyPlayerOutcome(enemy: Enemy, outcome: PlayerAttackOutcome, style: 'melee' | 'missile'): boolean {
    const ctx = this.ctx;
    const player = ctx.player;
    // Any swing at it, hit or miss, ends a wary or afraid monster's patience (and its neighbours').
    enemy.provoke();
    this.afterBlow(enemy);
    if (outcome.kind === 'immune') {
      ctx.floatText(enemy.x, enemy.y - 20, 'no effect', 0xb0bec5, 11);
      ctx.status("Your weapon passes through it. You need a magic weapon, or silver.");
      ctx.bus.emit('player_miss');
      return false;
    }
    if (outcome.kind === 'miss') {
      ctx.floatText(enemy.x, enemy.y - 20, 'miss', 0x888899, 10);
      ctx.bus.emit('player_miss');
      return false;
    }
    const b = equipmentBonuses(player.inventory);
    const dealt = this.damageEnemy(enemy, outcome.damage, {}, false);
    ctx.bus.emit('player_hit', { enemyKey: enemy.typeKey, damage: dealt, crit: outcome.crit });
    ctx.floatText(enemy.x, enemy.y - 20, `-${dealt}`, 0xffffff);
    if (outcome.backstab) ctx.floatText(enemy.x, enemy.y - 36, 'BACKSTAB!', 0xffa726, 11);
    else if (outcome.crit) ctx.floatText(enemy.x, enemy.y - 36, 'CRITICAL!', 0xffd166, 11);

    if (b.lifeOnHit > 0) player.heal(b.lifeOnHit);
    if (style === 'melee') {
      for (const c of enemy.def.special ?? []) {
        if (c.kind === 'corrode' && c.target === 'weapon' && Math.random() * 100 < c.chancePct) {
          this.corrodeItem(player.inventory.equipment.weapon, 'weapon');
        }
      }
    }
    if (enemy.hp <= 0) {
      return this.killEnemy(enemy);
    }
    return false;
  }

  /**
   * Hurt a monster with damage that has already been decided (a hit, a spell, a thorn). Handles boss phases and,
   * with `killIfDead` (the default), the kill itself. Returns the damage dealt.
   */
  damageEnemy(enemy: Enemy, amount: number, opts: { fire?: boolean; acid?: boolean } = {}, killIfDead = true): number {
    const dealt = enemy.takeDamage(amount, opts);
    this.afterBlow(enemy);
    const phase = enemy.hp > 0 ? enemy.checkPhase() : null;
    if (phase) {
      this.ctx.floatText(enemy.x, enemy.y - 44, phase.label, 0xff8a65, 12);
      if (phase.message) this.ctx.status(phase.message);
      this.ctx.scene.cameras.main.shake(220, 0.01);
      if (phase.summon) this.summonAround(enemy, phase.summon as EnemyTypeKey, phase.summonCount ?? 1);
    }
    if (killIfDead && enemy.hp <= 0) this.killEnemy(enemy);
    return dealt;
  }

  /** XP, gold, drops, quests, persistence. Returns true if the monster is gone for good (skeletons may reform). */
  killEnemy(enemy: Enemy): boolean {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!enemy.active) return true;
    if (this.tryEnemyReform(enemy)) return false;

    player.gainXP(enemy.xp);
    ctx.run.kills++;
    ctx.rooms.recordRoomChallengeKill(enemy);
    this.applyKillMomentum(enemy);

    if (player.stats.activeQuests) onEnemyKilled(player.stats.activeQuests, enemy.typeKey);

    const spawnIdx = (enemy as Enemy & { _spawnIdx?: number })._spawnIdx;
    if (typeof spawnIdx === 'number') ctx.persist.deadEnemyIndices.add(spawnIdx);

    if (enemy.typeKey === 'HOLLOW_KING') {
      this._kingSlain = true;
      ctx.status("The Hollow King falls. The way out opens.");
      ctx.scene.cameras.main.flash(500, 255, 213, 79);
    }
    // Things a boss summoned crumble with it.
    if (enemy.def.boss) {
      for (const e of [...ctx.enemies]) {
        if (e.summonedBy === enemy && e.active && e !== enemy) { e.hp = 0; this.finishSummoned(e); }
      }
    }

    ctx.loot.dropFromMonster(enemy);
    this.spawnDeathEffect(enemy.x, enemy.y, enemy.typeKey);
    const deadX = enemy.x;
    const deadY = enemy.y;
    enemy.destroy();
    const idx = ctx.enemies.indexOf(enemy);
    if (idx >= 0) ctx.enemies.splice(idx, 1);
    this.allyDied(deadX, deadY, enemy);
    ctx.emitHUD();
    return true;
  }

  private finishSummoned(e: Enemy) {
    this.spawnDeathEffect(e.x, e.y, e.typeKey);
    e.destroy();
    const idx = this.ctx.enemies.indexOf(e);
    if (idx >= 0) this.ctx.enemies.splice(idx, 1);
  }

  /** Missile attack: the wizard's dart, or a bow, sling or crossbow. */
  private fireMissile(weaponIsRanged: boolean) {
    const ctx = this.ctx;
    const player = ctx.player;
    const range = weaponIsRanged ? MISSILE_RANGE_PX : RANGE_PX[WIZARD_DART.range];
    const fx = player.stats.facing.x || 0;
    const fy = player.stats.facing.y || 1;

    let target: Enemy | null = null;
    let bestScore = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.active || enemy.hp <= 0 || (enemy.isMimic && !enemy.mimicRevealed)) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > range) continue;
      const dot = (dx * fx + dy * fy) / ((d || 1) * (Math.sqrt(fx * fx + fy * fy) || 1));
      // Prefer what you are facing; otherwise anything in range.
      const score = d + (dot < 0.25 ? 1000 : 0);
      if (score < bestScore) { bestScore = score; target = enemy; }
    }
    if (!target) return; // nothing to shoot at: the swing is just a flourish

    const dice = weaponIsRanged ? undefined : `${WIZARD_DART.dice[0]}d${WIZARD_DART.dice[1]}`;
    if (!weaponIsRanged) player.setAttackCooldown(WIZARD_DART.cooldownMs);
    const t = target;
    ctx.scene.cameras.main.shake(20, 0.001);
    const from = { x: player.x, y: player.y };
    const dist = Phaser.Math.Distance.Between(from.x, from.y, t.x, t.y);
    ctx.spells.spellSystem.flyOrb(from, { x: t.x, y: t.y }, weaponIsRanged ? 0xe0c080 : 0x80d8ff, Math.max(80, dist * 1.2), () => {
      if (!t.active || t.hp <= 0) return;
      const outcome = resolvePlayerAttack(ctx.player.sheet(), this.targetInfo(t), mathRng, 'missile', dice);
      this.applyPlayerOutcome(t, outcome, 'missile');
    }, 4);
  }

  private spawnAttackArc() {
    const scene = this.ctx.scene;
    const player = this.ctx.player;
    const fx = player.stats.facing.x || 0;
    const fy = player.stats.facing.y || 1;
    const horizontal = Math.abs(fx) > Math.abs(fy);
    const x = player.x + fx * 28;
    const y = player.y + fy * 28;
    const arc = scene.add.rectangle(x, y, horizontal ? 34 : 10, horizontal ? 10 : 34, 0xf8f4d8, 0.55)
      .setDepth(18);
    scene.tweens.add({
      targets: arc,
      alpha: 0,
      scaleX: horizontal ? 1.4 : 0.6,
      scaleY: horizontal ? 0.6 : 1.4,
      duration: 120,
      onComplete: () => arc.destroy(),
    });
  }

  private applyKillMomentum(enemy: Enemy) {
    const ctx = this.ctx;
    const run = ctx.run;
    const player = ctx.player;
    run.killStreak = run.killStreakTimer > 0 ? run.killStreak + 1 : 1;
    run.killStreakTimer = 4500;
    player.stats.runBestStreak = Math.max(player.stats.runBestStreak ?? 0, run.killStreak);
    player.stats.runDeepestFloor = Math.max(player.stats.runDeepestFloor ?? 0, ctx.currentFloor);

    if (ARCADE_ROOM_EVENTS && run.killStreak >= 3) {
      const bonusGold = Math.min(10, run.killStreak);
      const bonusXP = Math.min(5, run.killStreak - 2);
      ctx.addGold(bonusGold);
      player.gainXP(bonusXP);
      player.addEffect('RUSHED', Math.min(7000, 2200 + run.killStreak * 450));
      ctx.floatText(player.x, player.y - 54, `STREAK x${run.killStreak} +${bonusGold}g`, 0xffd166, 12);
    }

    if (ARCADE_ROOM_EVENTS && run.killStreak >= 5) {
      const hpGain = Math.max(1, Math.floor(player.stats.maxHp * 0.04));
      player.heal(hpGain);
      ctx.floatText(player.x, player.y - 70, 'ADRENALINE!', 0xffd166, 12);
    }

    if (enemy.isElite) {
      const trophyBonus = ctx.hasRelic('boss_trophy') ? 1.5 : 1;
      const bonusGold = Math.floor((10 + ctx.currentFloor * 3) * trophyBonus);
      ctx.addGold(bonusGold);
      ctx.scene.cameras.main.flash(180, 255, 209, 102);
      ctx.floatText(enemy.x, enemy.y - 44, `CHAMPION +${bonusGold}g`, 0xffd166, 14);
    }

    ctx.rooms.applyRoomClearBonus(enemy);

    const objective = ctx.dungeon.floorObjective;
    if (!objective || run.floorObjectiveComplete) return;

    const enemyRoomIdx = (enemy as Enemy & { _roomIdx?: number })._roomIdx;
    if (
      (objective.type === 'CLEAR_DEN' && enemyRoomIdx === objective.roomIdx) ||
      (objective.type === 'SLAY_CHAMPION' && enemy.isElite) ||
      (objective.type === 'CLAIM_KEY' && enemy.isElite && enemyRoomIdx === objective.roomIdx)
    ) {
      run.floorObjectiveProgress = Math.min(objective.targetCount, run.floorObjectiveProgress + 1);
      if (run.floorObjectiveProgress >= objective.targetCount) ctx.rooms.completeFloorObjective();
    }
  }

  private tryEnemyReform(enemy: Enemy) {
    if (!enemy.tryReform()) return false;
    this.ctx.floatText(enemy.x, enemy.y - 28, 'REFORMS!', 0xe0e0e0, 12);
    this.ctx.status("Skeleton bones knit back together. Finish it again.");
    return true;
  }

  /** Fighter cleave: after a kill, one more swing (a real attack roll) at a neighbour. */
  private doCleave(killedX: number, killedY: number) {
    const ctx = this.ctx;
    const range = TILE_SIZE * 2;
    for (const target of [...ctx.enemies]) {
      if (!target.active || target.hp <= 0) continue;
      if (target.isMimic && !target.mimicRevealed) continue;
      const d = Phaser.Math.Distance.Between(target.x, target.y, killedX, killedY);
      if (d > range) continue;
      const outcome = resolvePlayerAttack(ctx.player.sheet(), this.targetInfo(target), mathRng, 'melee');
      if (outcome.kind === 'hit') ctx.floatText(target.x, target.y - 34, 'CLEAVE', 0xe53935, 11);
      this.applyPlayerOutcome(target, outcome, 'melee');
      break;
    }
  }

  // ── Enemy projectiles ─────────────────────────────────────────────────────

  private spawnEnemyBolt(enemy: Enemy, toX: number, toY: number) {
    const dx = toX - enemy.x;
    const dy = toY - enemy.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const bolt = this.ctx.scene.add.rectangle(enemy.x, enemy.y, 5, 5, ENEMY_TYPES[enemy.typeKey].color).setDepth(16);
    this.enemyProjectiles.push({ obj: bolt, vx: (dx / len) * 300, vy: (dy / len) * 300, life: 1500, kind: 'weapon', enemy });
  }

  updateEnemyProjectiles(delta: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const dt = delta / 1000;
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.enemyProjectiles[i];
      proj.life -= delta;
      if (proj.life <= 0) { proj.obj.destroy(); this.enemyProjectiles.splice(i, 1); continue; }
      proj.obj.x += proj.vx * dt;
      proj.obj.y += proj.vy * dt;
      const dx = proj.obj.x - player.x;
      const dy = proj.obj.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        proj.obj.destroy();
        this.enemyProjectiles.splice(i, 1);
        if (proj.kind === 'spell') {
          let dmg = proj.spellDamage ?? 1;
          if (proj.spellSave) {
            if (player.rollSave(proj.spellSaveCategory ?? 'spells').success) dmg = Math.max(1, Math.floor(dmg / 2));
          }
          player.takeDamage(dmg);
        } else if (proj.enemy.active) {
          const round = this.rollMonsterRound(proj.enemy);
          this.applyMonsterRound(proj.enemy, round);
        }
      }
    }
  }

  private spawnDeathEffect(x: number, y: number, typeKey: EnemyTypeKey) {
    const scene = this.ctx.scene;
    this.ctx.bus.emit('enemy_death', { enemyKey: typeKey, x, y });
    const color = ENEMY_TYPES[typeKey]?.color ?? 0xff0000;
    for (let i = 0; i < 6; i++) {
      const p = scene.add.rectangle(x, y, 6, 6, color).setDepth(15);
      const angle = (i / 6) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 120);
      scene.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.4,
        y: y + Math.sin(angle) * speed * 0.4,
        alpha: 0, scaleX: 0, scaleY: 0,
        duration: 400,
        onComplete: () => p.destroy(),
      });
    }
  }

  destroy() {
    for (const p of this.enemyProjectiles) p.obj.destroy();
    this.enemyProjectiles = [];
  }
}
