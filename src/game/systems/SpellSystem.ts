import * as Phaser from "phaser";
import { SPELLS, SpellKey, TILE_SIZE, TILE } from "../constants";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";

interface SpellCooldown {
  key: SpellKey;
  remaining: number; // ms
}

interface Projectile {
  obj: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  damage: number;
  lifetime: number;
  spellKey: SpellKey;
  slow?: boolean;
}

export class SpellSystem {
  private scene: Phaser.Scene;
  private cooldowns: Map<SpellKey, number> = new Map(); // ms remaining
  private projectiles: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  canCast(key: SpellKey, player: Player): boolean {
    const spell = SPELLS[key];
    if (!spell) return false;
    if (player.stats.mana < spell.manaCost) return false;
    const cd = this.cooldowns.get(key) ?? 0;
    return cd <= 0;
  }

  getRemainingCooldown(key: SpellKey): number {
    return this.cooldowns.get(key) ?? 0;
  }

  cast(
    key: SpellKey,
    player: Player,
    enemies: Enemy[],
    tiles: number[][],
    targetX?: number,
    targetY?: number,
  ): boolean {
    if (!this.canCast(key, player)) return false;

    const spell = SPELLS[key];
    player.spendMana(spell.manaCost);
    this.cooldowns.set(key, spell.cooldown);

    switch (key) {
      case 'MAGIC_MISSILE':
        this._castMagicMissile(player, enemies);
        break;
      case 'FIREBALL':
        if (targetX !== undefined && targetY !== undefined)
          this._castFireball(player, enemies, targetX, targetY);
        break;
      case 'FROST_BOLT':
        if (targetX !== undefined && targetY !== undefined)
          this._castFrostBolt(player, targetX, targetY);
        break;
      case 'BLINK':
        if (targetX !== undefined && targetY !== undefined)
          this._castBlink(player, tiles, targetX, targetY);
        break;
      case 'CURE_WOUNDS':
        this._castCureWounds(player);
        break;
      case 'BLESS':
        player.addEffect('BLESSED', 30000);
        this._spawnSpellEffect(player.x, player.y, 0xffd700, 'BLESS');
        break;
      case 'TURN_UNDEAD':
        return false; // Handled externally (Turn Undead is a class ability)
      case 'DIVINE_SHIELD':
        player.addEffect('SHIELDED', 30000);
        this._spawnSpellEffect(player.x, player.y, 0x7e57c2, 'SHIELD');
        break;
    }

    return true;
  }

  private _castMagicMissile(player: Player, enemies: Enemy[]) {
    // Find nearest enemy
    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const e of enemies) {
      if (!e.active || e.hp <= 0) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }

    if (!nearest) return;

    // Visual: white orb flying to target
    const orb = this.scene.add.arc(player.x, player.y, 5, 0, 360, false, 0xffffff, 1).setDepth(20);
    const tx = nearest.x;
    const ty = nearest.y;
    this.scene.tweens.add({
      targets: orb,
      x: tx, y: ty,
      duration: 200,
      onComplete: () => {
        orb.destroy();
        // Auto-hits (no saving throw)
        const dmg = this._diceRoll(6, 3);
        const dealt = nearest!.takeDamage(dmg);
        this._spawnDmgText(tx, ty, dealt);
      },
    });
  }

  private _castFireball(player: Player, enemies: Enemy[], tx: number, ty: number) {
    const radius = 100;

    // Visual: expanding orange circle
    const ball = this.scene.add.arc(player.x, player.y, 6, 0, 360, false, 0xff6f00, 1).setDepth(20);
    this.scene.tweens.add({
      targets: ball,
      x: tx, y: ty,
      duration: 300,
      onComplete: () => {
        ball.destroy();
        // Explosion
        const explosion = this.scene.add.arc(tx, ty, 2, 0, 360, false, 0xff6f00, 0.7).setDepth(20);
        this.scene.tweens.add({
          targets: explosion,
          scaleX: radius / 2, scaleY: radius / 2,
          alpha: 0,
          duration: 400,
          onComplete: () => explosion.destroy(),
        });
        // Damage all enemies in radius
        const dmg = this._diceRoll(6, 3) + 5;
        for (const e of enemies) {
          if (!e.active || e.hp <= 0) continue;
          const dx = e.x - tx;
          const dy = e.y - ty;
          if (Math.sqrt(dx * dx + dy * dy) <= radius) {
            const dealt = e.takeDamage(dmg);
            this._spawnDmgText(e.x, e.y, dealt);
          }
        }
      },
    });
  }

  private _castFrostBolt(player: Player, targetX: number, targetY: number) {
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 400;

    const bolt = this.scene.add.rectangle(player.x, player.y, 6, 6, 0x80d8ff).setDepth(20);
    this.projectiles.push({
      obj: bolt,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      damage: this._diceRoll(6, 2) + 3,
      lifetime: 1500,
      spellKey: 'FROST_BOLT',
      slow: true,
    });
  }

  private _castBlink(player: Player, tiles: number[][], targetX: number, targetY: number) {
    const tx = Math.floor(targetX / TILE_SIZE);
    const ty = Math.floor(targetY / TILE_SIZE);

    // Check tile is floor
    if (ty >= 0 && ty < tiles.length && tx >= 0 && tx < tiles[0].length) {
      const t = tiles[ty][tx];
      if (t === TILE.FLOOR || t === TILE.STAIRS) {
        this._spawnSpellEffect(player.x, player.y, 0xce93d8, 'BLINK');
        player.setPosition(targetX, targetY);
        this._spawnSpellEffect(targetX, targetY, 0xce93d8, 'BLINK');
        return;
      }
    }
    // Failed blink: refund
    this.scene.time.delayedCall(0, () => {
      player.restoreMana(SPELLS['BLINK'].manaCost);
    });
  }

  private _castCureWounds(player: Player) {
    const heal = this._diceRoll(6, 3) + player.stats.level;
    player.heal(heal);
    this._spawnSpellEffect(player.x, player.y, 0x69f0ae, `+${heal}`);
  }

  private _spawnSpellEffect(x: number, y: number, color: number, label: string) {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const text = this.scene.add.text(x, y - 20, label, {
      fontSize: '12px',
      color: hex,
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 2,
    }).setDepth(25).setOrigin(0.5);

    this.scene.tweens.add({
      targets: text,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      onComplete: () => text.destroy(),
    });

    // Ring effect
    const ring = this.scene.add.arc(x, y, 5, 0, 360, false, color, 0.6).setDepth(20);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 4, scaleY: 4,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
  }

  private _spawnDmgText(x: number, y: number, dmg: number) {
    const text = this.scene.add.text(x, y - 20, `-${dmg}`, {
      fontSize: '14px',
      color: '#ff9800',
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 2,
    }).setDepth(25).setOrigin(0.5);

    this.scene.tweens.add({
      targets: text,
      y: y - 50,
      alpha: 0,
      duration: 900,
      onComplete: () => text.destroy(),
    });
  }

  private _diceRoll(sides: number, count: number): number {
    let total = 0;
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return total;
  }

  update(delta: number, enemies: Enemy[], player: Player) {
    // Tick cooldowns
    for (const [key, remaining] of this.cooldowns) {
      this.cooldowns.set(key, Math.max(0, remaining - delta));
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.lifetime -= delta;

      if (proj.lifetime <= 0) {
        proj.obj.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      const dt = delta / 1000;
      proj.obj.x += proj.vx * dt;
      proj.obj.y += proj.vy * dt;

      // Check hit
      let hit = false;
      for (const enemy of enemies) {
        if (!enemy.active || enemy.hp <= 0) continue;
        const dx = proj.obj.x - enemy.x;
        const dy = proj.obj.y - enemy.y;
        if (Math.sqrt(dx * dx + dy * dy) < 20) {
          const dealt = enemy.takeDamage(proj.damage);
          this._spawnDmgText(enemy.x, enemy.y, dealt);
          if (proj.slow) {
            // Apply slow to enemy
            const origSpeed = enemy.speed;
            enemy.speed = Math.max(20, enemy.speed * 0.5);
            this.scene.time.delayedCall(4000, () => {
              if (enemy.active) {
                enemy.speed = origSpeed;
              }
            });
          }
          proj.obj.destroy();
          this.projectiles.splice(i, 1);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      // Check player hit (for future ranged enemy bolts)
      void player;
    }
  }

  destroy() {
    for (const proj of this.projectiles) proj.obj.destroy();
    this.projectiles = [];
  }
}
