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
  public isElite: boolean;

  private _attackTimer = 0;
  private _aiState: "idle" | "chase" | "attack" | "flee" = "idle";
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private nameTag!: Phaser.GameObjects.Text;
  private threatRing!: Phaser.GameObjects.Arc;

  // Troll regen
  private _regenTimer = 0;

  // Flee state (Turn Undead)
  private _fleeTimer = 0;
  private _fleeDir = { x: 0, y: 0 };

  // Mimic: hidden until revealed
  private _mimicRevealed = false;

  // Special behavior timers
  private _specialTimer = 0;
  private _reformed = false;

  // Callbacks
  onRangedAttack?: (enemyX: number, enemyY: number, targetX: number, targetY: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, typeKey: EnemyTypeKey, elite = false) {
    const def = ENEMY_TYPES[typeKey];
    super(scene, x, y, def.textureKey || "enemy");
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.typeKey = typeKey;
    this.isElite = elite;

    const eliteHpMul = elite ? 1.9 : 1;
    const eliteAtkMul = elite ? 1.35 : 1;
    this.hp = Math.ceil(def.hp * eliteHpMul);
    this.maxHp = this.hp;
    this.attack = Math.ceil(def.attack * eliteAtkMul);
    this.defense = def.defense + (elite ? 1 : 0);
    this.speed = def.speed * (elite ? 1.08 : 1);
    this.xp = Math.ceil(def.xp * (elite ? 2.4 : 1));
    this.attackRange = def.attackRange;
    this.aggroRange = def.aggroRange;
    this.attackCooldown = def.attackCooldown;

    const size = elite ? Math.ceil(def.size * 1.25) : def.size;
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

    this.threatRing = scene.add.arc(x, y, size * (elite ? 0.9 : 0.72), 0, 360, false, elite ? 0xffd166 : def.color, elite ? 0.42 : 0.2)
      .setDepth(8);

    // HP bar
    this.hpBarBg = scene.add.rectangle(x, y - size / 2 - 6, size, 4, 0x333333).setDepth(11);
    this.hpBar = scene.add.rectangle(x - size / 2, y - size / 2 - 6, size, 4, 0x4caf50)
      .setOrigin(0, 0.5).setDepth(12);
    this.nameTag = scene.add.text(x, y + size / 2 + 5, elite ? `*${this._shortName(typeKey)}*` : this._shortName(typeKey), {
      fontSize: '8px',
      color: `#${(elite ? 0xffd166 : def.color).toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(12);

    if (elite) {
      this.setTint(0xffd166);
      scene.tweens.add({
        targets: this.threatRing,
        alpha: 0.12,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
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
    this._specialTimer = Math.max(0, this._specialTimer - delta);

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
    const moveLen = distToPlayer || 1;
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
      if (this.typeKey === 'FAST' && this._specialTimer <= 0 && distToPlayer > 55 && distToPlayer < 170) {
        this._specialTimer = this.isElite ? 900 : 1300;
        body.setVelocity((dx / moveLen) * this.speed * 2.35, (dy / moveLen) * this.speed * 2.35);
        this.scene.tweens.add({ targets: this, alpha: 0.45, duration: 70, yoyo: true });
        this.updateHpBar();
        return;
      }

      if (this.typeKey === 'DARK_ELF' && distToPlayer < 85 && this._specialTimer <= 0) {
        this._specialTimer = 2400;
        const bounds = this.scene.physics.world.bounds;
        const blinkX = Phaser.Math.Clamp(this.x - (dx / moveLen) * 96, bounds.x + 24, bounds.right - 24);
        const blinkY = Phaser.Math.Clamp(this.y - (dy / moveLen) * 96, bounds.y + 24, bounds.bottom - 24);
        this.setPosition(blinkX, blinkY);
        this.setTint(0xce93d8);
        this.scene.time.delayedCall(120, () => {
          if (this.active) this.setTint(this.isElite ? 0xffd166 : def.color);
        });
      }

      if (def.isRanged) {
        // Ranged: keep distance 100-200px, strafe side if too close
        if (distToPlayer < 100) {
          // Back away
          body.setVelocity(-(dx / moveLen) * this.speed, -(dy / moveLen) * this.speed);
        } else if (distToPlayer > this.attackRange) {
          // Move closer
          body.setVelocity((dx / moveLen) * this.speed * 0.6, (dy / moveLen) * this.speed * 0.6);
        } else {
          body.setVelocity(0, 0);
        }
      } else {
        if (distToPlayer > this.attackRange + 8) {
          body.setVelocity((dx / moveLen) * this.speed, (dy / moveLen) * this.speed);
        } else {
          body.setVelocity(0, 0);
        }
      }
    } else {
      body.setVelocity(0, 0);
    }

    this.updateHpBar();
  }

  tryReform(): boolean {
    if (this.typeKey !== 'SKELETON' || this._reformed || this.isElite) return false;
    if (Math.random() > 0.45) return false;
    this._reformed = true;
    this.hp = Math.max(6, Math.ceil(this.maxHp * 0.38));
    this.updateHpBar();
    this.setTint(0xe0e0e0);
    this.scene.tweens.add({ targets: this, scaleX: 1.25, scaleY: 1.25, duration: 90, yoyo: true });
    return true;
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
      if (this.active) this.setTint(this.isElite ? 0xffd166 : def.color);
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

    // Flash
    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.setTint(def.color);
    });
    return this.attack;
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
      if (this.active && this.hp > 0) this.setTint(this.isElite ? 0xffd166 : def.color);
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
    this.nameTag.setVisible(visible);
    this.threatRing.setVisible(visible);

    this.threatRing.setPosition(this.x, this.y);
    this.hpBarBg.setPosition(this.x, this.y - size / 2 - 6);
    this.hpBar.setPosition(this.x - size / 2, this.y - size / 2 - 6);
    this.nameTag.setPosition(this.x, this.y + size / 2 + 5);
    this.hpBar.setDisplaySize(size * pct, 4);
    this.hpBar.setFillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xffa726 : 0xf44336);
  }

  private _shortName(typeKey: EnemyTypeKey): string {
    const labels: Record<EnemyTypeKey, string> = {
      BASIC: 'GOB',
      FAST: 'IMP',
      TANK: 'OGR',
      SKELETON: 'SKL',
      ZOMBIE: 'ZOM',
      GIANT_RAT: 'RAT',
      GIANT_SPIDER: 'SPD',
      TROLL: 'TRL',
      DARK_ELF: 'ELF',
      GHOST: 'GST',
      MIMIC: 'MIM',
    };
    return labels[typeKey];
  }

  destroy(fromScene?: boolean) {
    this.hpBar?.destroy();
	    this.hpBarBg?.destroy();
	    this.nameTag?.destroy();
	    this.threatRing?.destroy();
	    super.destroy(fromScene);
	  }
}
