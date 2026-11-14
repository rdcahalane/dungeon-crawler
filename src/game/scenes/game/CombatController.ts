import * as Phaser from "phaser";
import type { PlayerStats, CharCreationData } from "../../entities/Player";
import { TILE_SIZE, COLORS, ENEMY_TYPES, EnemyTypeKey, abilityMod } from "../../constants";
import { onEnemyKilled } from "../../systems/QuestSystem";
import { Player } from "../../entities/Player";
import { Enemy } from "../../entities/Enemy";
import type { GameContext } from "../../GameContext";

/**
 * Player and enemy spawning, the player's attack and cleave, kill momentum, enemy attacks and projectiles,
 * death effects, and Turn Undead.
 */
export class CombatController {
  private enemyProjectiles: {
    obj: Phaser.GameObjects.Rectangle;
    vx: number; vy: number; dmg: number; life: number;
  }[] = [];

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
        ctx.emitHUD();
        ctx.bus.emit('level_up', { level });
      },
      onTurnUndead: () => this.doTurnUndead(),
    });

    scene.physics.add.collider(ctx.player, ctx.wallGroup);
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  spawnEnemies() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    ctx.enemyGroup = scene.physics.add.group();
    ctx.enemies.length = 0;

    for (let i = 0; i < ctx.dungeon.enemies.length; i++) {
      if (ctx.persist.deadEnemyIndices.has(i)) continue; // skip dead enemies from prior session

      const spawn = ctx.dungeon.enemies[i];
      const ex = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const ey = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const enemy = new Enemy(scene, ex, ey, spawn.type, !!spawn.elite);
      (enemy as Enemy & { _spawnIdx: number })._spawnIdx = i;
      (enemy as Enemy & { _roomIdx?: number })._roomIdx = spawn.roomIdx;
      ctx.enemies.push(enemy);
      ctx.enemyGroup.add(enemy);
      scene.physics.add.collider(enemy, ctx.wallGroup);
    }

    scene.physics.add.collider(ctx.player, ctx.enemyGroup);
    scene.physics.add.collider(ctx.enemyGroup, ctx.enemyGroup);
  }

  // ── Per-frame pieces (called by GameScene.update in the old order) ─────────

  /** Kill-streak decay. */
  tickKillStreak(delta: number) {
    const run = this.ctx.run;
    run.killStreakTimer = Math.max(0, run.killStreakTimer - delta);
    if (run.killStreakTimer <= 0) run.killStreak = 0;
  }

  /** Player swing: the attack input check, then the hit resolution. */
  updatePlayerAttack() {
    if (this.ctx.player.tryAttack()) {
      this.handlePlayerAttack();
    }
  }

  /** Enemy AI update, melee and ranged attacks. */
  updateEnemies(delta: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      const enemy = ctx.enemies[i];
      if (!enemy.active) { ctx.enemies.splice(i, 1); continue; }

      enemy.update(delta, player.x, player.y);

      if (enemy.canAttackPlayer(player.x, player.y)) {
        const dmg = enemy.doAttack();
        if (ENEMY_TYPES[enemy.typeKey].isRanged) {
          this.spawnEnemyBolt(enemy.x, enemy.y, player.x, player.y, dmg, enemy.typeKey);
        } else {
          player.takeDamage(dmg, enemy.ignoresArmor);
          if (enemy.typeKey === 'GIANT_SPIDER') {
            player.addEffect('SLOWED', 1600);
            ctx.floatText(player.x, player.y - 36, 'WEBBED', 0x80cbc4, 11);
          } else if (enemy.typeKey === 'TROLL' || enemy.typeKey === 'TANK') {
            ctx.scene.cameras.main.shake(90, 0.006);
            ctx.floatText(player.x, player.y - 36, 'SLAM', 0xffd166, 11);
          } else if (enemy.typeKey === 'GHOST') {
            ctx.floatText(player.x, player.y - 36, 'CHILL', 0x80cbc4, 11);
          }
          if (enemy.poisonDmg > 0) {
            player.addEffect('POISONED', enemy.poisonDuration || 5000, enemy.poisonDmg);
          }
        }
      }
    }
  }

  // ── Turn Undead ────────────────────────────────────────────────────────────

  doTurnUndead() {
    const ctx = this.ctx;
    let count = 0;
    for (const enemy of ctx.enemies) {
      if (!enemy.active || !enemy.isUndead) continue;
      const dx = enemy.x - ctx.player.x;
      const dy = enemy.y - ctx.player.y;
      if (Math.sqrt(dx * dx + dy * dy) <= 200) {
        const roll = Math.floor(Math.random() * 20) + 1 + abilityMod(ctx.player.stats.cha);
        if (roll >= 10) { enemy.forceFleeFrom(ctx.player.x, ctx.player.y, 10000); count++; }
      }
    }
    ctx.floatText(ctx.player.x, ctx.player.y - 40, `Turn Undead! (${count} fled)`, 0xfff9c4, 14);
    ctx.status(`Turn Undead — ${count} undead flee!`);
    ctx.bus.emit('spell_cast', { key: 'TURN_UNDEAD' });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private handlePlayerAttack() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const player = ctx.player;
    const attackBox = player.getAttackBox();
    this.spawnAttackArc();
    ctx.bus.emit('player_swing');
    let hitCount = 0;

    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      const enemy = ctx.enemies[i];
      if (!enemy.active) continue;

      const enemyBounds = enemy.getBounds();
      if (!Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemyBounds)) continue;

      const isSneakAttack = player.stats.classKey === 'thief' &&
        !enemy.canAttackPlayer(player.x, player.y);
      const dmg = player.getAttackDamage(isSneakAttack);
      const dealt = enemy.takeDamage(dmg);
      hitCount++;
      ctx.bus.emit('player_hit', { enemyKey: enemy.typeKey, damage: dealt, crit: isSneakAttack });
      scene.cameras.main.shake(40, 0.0025);
      scene.tweens.add({
        targets: enemy,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 60,
        yoyo: true,
      });
      ctx.floatText(enemy.x, enemy.y - 20, `-${dealt}`, 0xffffff);
      if (isSneakAttack) ctx.floatText(enemy.x, enemy.y - 36, 'SNEAK!', 0xffa726, 11);

      if (enemy.hp <= 0) {
        if (this.tryEnemyReform(enemy)) continue;
        player.gainXP(enemy.xp);
        ctx.run.kills++;
        ctx.rooms.recordRoomChallengeKill(enemy);
        this.applyKillMomentum(enemy);
        this.applyEquipmentKillEffects(enemy, i);

        // Quest progress: enemy kill
        if (player.stats.activeQuests) {
          onEnemyKilled(player.stats.activeQuests, enemy.typeKey);
        }

        ctx.emitHUD();

        // Record death for persistence
        const spawnIdx = (enemy as Enemy & { _spawnIdx?: number })._spawnIdx;
        if (typeof spawnIdx === 'number') ctx.persist.deadEnemyIndices.add(spawnIdx);

        if (player.stats.classKey === 'fighter') this.doCleave(enemy.x, enemy.y, i);

        this.spawnDeathEffect(enemy.x, enemy.y, enemy.typeKey);
        enemy.destroy();
        ctx.enemies.splice(i, 1);
      }
    }

    if (hitCount === 0) {
      const fx = player.stats.facing.x || 0;
      const fy = player.stats.facing.y || 1;
      ctx.floatText(player.x + fx * 28, player.y + fy * 28, 'MISS', 0x888899, 10);
      ctx.bus.emit('player_miss');
    }
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

    if (run.killStreak >= 3) {
      const bonusGold = Math.min(25, run.killStreak * 2);
      const bonusXP = Math.min(30, run.killStreak * 3);
      ctx.addGold(bonusGold);
      player.gainXP(bonusXP);
      player.addEffect('RUSHED', Math.min(7000, 2200 + run.killStreak * 450));
      ctx.floatText(player.x, player.y - 54, `STREAK x${run.killStreak} +${bonusGold}g`, 0xffd166, 12);
    }

    if (run.killStreak >= 5) {
      const hpGain = Math.max(1, Math.floor(player.stats.maxHp * 0.04));
      player.heal(hpGain);
      if (player.stats.maxMana > 0) player.restoreMana(3);
      ctx.floatText(player.x, player.y - 70, 'ADRENALINE!', 0xffd166, 12);
    }

    if (enemy.isElite) {
      const trophyBonus = ctx.hasRelic('boss_trophy') ? 1.5 : 1;
      const bonusGold = Math.floor((35 + ctx.currentFloor * 8) * trophyBonus);
      const bonusXP = Math.floor((30 + ctx.currentFloor * 10) * trophyBonus);
      ctx.addGold(bonusGold);
      player.gainXP(bonusXP);
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

  private applyEquipmentKillEffects(enemy: Enemy, killedIdx: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const trait = player.stats.weaponTrait;
    if (trait === 'vampiric') {
      const heal = Math.max(2, Math.floor(player.stats.maxHp * 0.04));
      player.heal(heal);
      ctx.floatText(player.x, player.y - 62, `DRAIN +${heal}`, COLORS.HEAL_TEXT, 11);
    } else if (trait === 'arcane' && player.stats.maxMana > 0) {
      player.restoreMana(5);
      ctx.floatText(player.x, player.y - 62, '+5 MANA', COLORS.MANA_BAR, 11);
    } else if (trait === 'cleaving' && player.stats.classKey !== 'fighter') {
      this.doTraitCleave(enemy.x, enemy.y, killedIdx);
    }
  }

  private doCleave(killedX: number, killedY: number, killedIdx: number) {
    const ctx = this.ctx;
    const range = TILE_SIZE * 2;
    for (let j = ctx.enemies.length - 1; j >= 0; j--) {
      if (j === killedIdx) continue;
      const target = ctx.enemies[j];
      if (!target.active) continue;
      const dx = target.x - killedX;
      const dy = target.y - killedY;
      if (Math.sqrt(dx * dx + dy * dy) <= range) {
        const dealt = target.takeDamage(ctx.player.getAttackDamage(false));
        ctx.bus.emit('player_hit', { enemyKey: target.typeKey, damage: dealt, crit: false });
        ctx.floatText(target.x, target.y - 20, `CLEAVE -${dealt}`, COLORS.ENEMY_BASIC, 12);
        if (target.hp <= 0) {
          if (this.tryEnemyReform(target)) break;
          ctx.player.gainXP(target.xp);
          ctx.run.kills++;
          ctx.rooms.recordRoomChallengeKill(target);
          this.applyKillMomentum(target);
          if (ctx.player.stats.activeQuests) {
            onEnemyKilled(ctx.player.stats.activeQuests, target.typeKey);
          }
          const idx = (target as Enemy & { _spawnIdx?: number })._spawnIdx;
          if (typeof idx === 'number') ctx.persist.deadEnemyIndices.add(idx);
          this.spawnDeathEffect(target.x, target.y, target.typeKey);
          target.destroy();
          ctx.enemies.splice(j, 1);
        }
        break;
      }
    }
  }

  private doTraitCleave(killedX: number, killedY: number, killedIdx: number) {
    const ctx = this.ctx;
    const range = TILE_SIZE * 1.75;
    const cleaveDamage = Math.max(4, Math.floor(ctx.player.getAttackDamage(false) * 0.55));
    for (let j = ctx.enemies.length - 1; j >= 0; j--) {
      if (j === killedIdx) continue;
      const target = ctx.enemies[j];
      if (!target.active) continue;
      const dx = target.x - killedX;
      const dy = target.y - killedY;
      if (Math.sqrt(dx * dx + dy * dy) > range) continue;

      const dealt = target.takeDamage(cleaveDamage);
      ctx.bus.emit('player_hit', { enemyKey: target.typeKey, damage: dealt, crit: false });
      ctx.floatText(target.x, target.y - 20, `RIPOSTE -${dealt}`, 0xffa726, 11);
      if (target.hp <= 0) {
        if (this.tryEnemyReform(target)) break;
        ctx.player.gainXP(target.xp);
        ctx.run.kills++;
        ctx.rooms.recordRoomChallengeKill(target);
        this.applyKillMomentum(target);
        if (ctx.player.stats.activeQuests) {
          onEnemyKilled(ctx.player.stats.activeQuests, target.typeKey);
        }
        const idx = (target as Enemy & { _spawnIdx?: number })._spawnIdx;
        if (typeof idx === 'number') ctx.persist.deadEnemyIndices.add(idx);
        this.spawnDeathEffect(target.x, target.y, target.typeKey);
        target.destroy();
        ctx.enemies.splice(j, 1);
      }
      break;
    }
  }

  private spawnEnemyBolt(fromX: number, fromY: number, toX: number, toY: number, dmg: number, typeKey: EnemyTypeKey) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const bolt = this.ctx.scene.add.rectangle(fromX, fromY, 5, 5, ENEMY_TYPES[typeKey].color).setDepth(16);
    this.enemyProjectiles.push({ obj: bolt, vx: (dx / len) * 300, vy: (dy / len) * 300, dmg, life: 1500 });
  }

  updateEnemyProjectiles(delta: number) {
    const player = this.ctx.player;
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
        player.takeDamage(proj.dmg, false);
        proj.obj.destroy();
        this.enemyProjectiles.splice(i, 1);
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
