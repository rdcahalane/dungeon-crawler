import * as Phaser from "phaser";
import { TILE_SIZE, ENEMY_TYPES, EnemyTypeKey } from "../constants";

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  public typeKey: EnemyTypeKey;
  public hp: number;
  public maxHp: number;
  public attack: number;
  public defense: number;
  public speed: number;
  public xp: number;
  public attackRange: number;
  public aggroRange: number;
  public attackCooldown: number;

  private _attackTimer = 0;
  private _aiState: "idle" | "chase" | "attack" | "flee" = "idle";
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarBg!: Phaser.GameObjects.Rectangle;

  // Troll regen
  private _regenTimer = 0;

  // Flee state (Turn Undead)
  private _fleeTimer = 0;
  private _fleeDir = { x: 0, y: 0 };

  // Mimic: hidden until revealed
  private _mimicRevealed = false;

  // Ranged zap effect (Dark Elf)
  private _zapLine?: Phaser.GameObjects.Graphics;

  // Callbacks
  onRangedAttack?: (enemyX: number, enemyY: number, targetX: number, targetY: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, typeKey: EnemyTypeKey) {
    const def = ENEMY_TYPES[typeKey];
    super(scene, x, y, def.textureKey || "enemy");
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.typeKey = typeKey;

    this.hp = def.hp;
    this.maxHp = def.hp;
    this.attack = def.attack;
    this.defense = def.defense;
    this.speed = def.speed;
    this.xp = def.xp;
    this.attackRange = def.attackRange;
    this.aggroRange = def.aggroRange;
    this.attackCooldown = def.attackCooldown;

    const size = def.size;
    this.setDisplaySize(size, size);
    this.setDepth(9);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(size - 12, size - 12);

    // Mimic starts invisible (disguised as chest in GameScene)
    if (def.isMimic) {
      this.setAlpha(0);
      this.setActive(false);
    } else {
      this.setTint(def.color);
    }

    // Ghost: translucent
    if (typeKey === 'GHOST') this.setAlpha(0.7);

    // HP bar
    this.hpBarBg = scene.add.rectangle(x, y - size / 2 - 6, size, 4, 0x333333).setDepth(11);
    this.hpBar = scene.add.rectangle(x - size / 2, y - size / 2 - 6, size, 4, 0x4caf50)
      .setOrigin(0, 0.5).setDepth(12);
  }

  update(delta: number, playerX: number, playerY: number) {
    if (this.hp <= 0) return;

    const def = ENEMY_TYPES[this.typeKey];

    // Mimic: stay hidden until aggro range
    if (def.isMimic && !this._mimicRevealed) {
      const dx = playerX - this.x;
      const dy = playerY - this.y;
      if (Math.sqrt(dx * dx + dy * dy) <= this.aggroRange) {
        this._revealMimic();
      } else {
        return; // don't do anything until revealed
      }
    }

    this._attackTimer = Math.max(0, this._attackTimer - delta);

    // Troll: regenerate HP
    if (def.regenRate && def.regenRate > 0) {
      this._regenTimer += delta;
      if (this._regenTimer >= 1000) {
        this._regenTimer -= 1000;
        this.hp = Math.min(this.maxHp, this.hp + def.regenRate);
        this.updateHpBar();
      }
    }

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    const body = this.body as Phaser.Physics.Arcade.Body;

    // Flee state (Turn Undead)
    if (this._aiState === 'flee') {
      this._fleeTimer = Math.max(0, this._fleeTimer - delta);
      if (this._fleeTimer <= 0) {
        this._aiState = 'idle';
      } else {
        body.setVelocity(this._fleeDir.x * this.speed, this._fleeDir.y * this.speed);
        this.updateHpBar();
        return;
      }
    }

    // Aggro check
    if (distToPlayer <= this.aggroRange) {
      this._aiState = 'chase';
    }

    if (this._aiState === 'chase') {
      if (def.isRanged) {
        // Ranged: keep distance 100-200px, strafe side if too close
        if (distToPlayer < 100) {
          // Back away
          body.setVelocity(-(dx / distToPlayer) * this.speed, -(dy / distToPlayer) * this.speed);
        } else if (distToPlayer > this.attackRange) {
          // Move closer
          body.setVelocity((dx / distToPlayer) * this.speed * 0.6, (dy / distToPlayer) * this.speed * 0.6);
        } else {
          body.setVelocity(0, 0);
        }
      } else {
        if (distToPlayer > this.attackRange + 8) {
          body.setVelocity((dx / distToPlayer) * this.speed, (dy / distToPlayer) * this.speed);
        } else {
          body.setVelocity(0, 0);
        }
      }
    } else {
      body.setVelocity(0, 0);
    }

    this.updateHpBar();
  }

  private _revealMimic() {
    this._mimicRevealed = true;
    this._aiState = 'chase';
    const def = ENEMY_TYPES[this.typeKey];
    this.setAlpha(1);
    this.setActive(true);
    this.setTint(def.color);
    // Flash reveal effect
    this.setTint(0xff4444);
    this.scene.time.delayedCall(200, () => {
      if (this.active) this.setTint(def.color);
    });
  }

  forceFleeFrom(fromX: number, fromY: number, duration = 10000) {
    const def = ENEMY_TYPES[this.typeKey];
    if (!def.fleeOnTurnUndead) return;
    this._aiState = 'flee';
    this._fleeTimer = duration;
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this._fleeDir = { x: dx / len, y: dy / len };
  }

  canAttackPlayer(playerX: number, playerY: number): boolean {
    if (this._attackTimer > 0 || this.hp <= 0 || this._aiState === 'flee') return false;
    if (ENEMY_TYPES[this.typeKey].isMimic && !this._mimicRevealed) return false;
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= this.attackRange + TILE_SIZE / 2;
  }

  doAttack(): number {
    this._attackTimer = this.attackCooldown;
    const def = ENEMY_TYPES[this.typeKey];

    // Ranged: fire visual bolt
    if (def.isRanged && this.scene) {
      this._fireRangedBolt();
    }

    // Flash
    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.setTint(def.color);
    });
    return this.attack;
  }

  private _fireRangedBolt() {
    if (!this.scene) return;
    const bolt = this.scene.add.rectangle(this.x, this.y, 4, 4, 0xce93d8).setDepth(15);
    // Bolt needs to travel toward player — since we don't have player ref here,
    // the GameScene handles this via onRangedAttack callback
    bolt.destroy();
  }

  // bypassArmor for Ghost attacks
  get ignoresArmor(): boolean {
    return !!ENEMY_TYPES[this.typeKey].ignoresArmor;
  }

  get isUndead(): boolean {
    return !!ENEMY_TYPES[this.typeKey].isUndead;
  }

  get poisonDmg(): number {
    return ENEMY_TYPES[this.typeKey].poisonDmg ?? 0;
  }

  get poisonDuration(): number {
    return ENEMY_TYPES[this.typeKey].poisonDuration ?? 0;
  }

  get isMimic(): boolean {
    return !!ENEMY_TYPES[this.typeKey].isMimic;
  }

  get mimicRevealed(): boolean {
    return this._mimicRevealed;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(1, amount - this.defense);
    this.hp = Math.max(0, this.hp - dmg);
    this.updateHpBar();

    const def = ENEMY_TYPES[this.typeKey];
    this.setTint(0xffffff);
    this.scene.time.delayedCall(100, () => {
      if (this.active && this.hp > 0) this.setTint(def.color);
    });

    return dmg;
  }

  private updateHpBar() {
    const def = ENEMY_TYPES[this.typeKey];
    const size = def.size;
    const pct = this.hp / this.maxHp;

    // Hide HP bar for unrevealed mimics
    const visible = !(def.isMimic && !this._mimicRevealed);
    this.hpBarBg.setVisible(visible);
    this.hpBar.setVisible(visible);

    this.hpBarBg.setPosition(this.x, this.y - size / 2 - 6);
    this.hpBar.setPosition(this.x - size / 2, this.y - size / 2 - 6);
    this.hpBar.setDisplaySize(size * pct, 4);
    this.hpBar.setFillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xffa726 : 0xf44336);
  }

  destroy(fromScene?: boolean) {
    this.hpBar?.destroy();
    this.hpBarBg?.destroy();
    this._zapLine?.destroy();
    super.destroy(fromScene);
  }
}
