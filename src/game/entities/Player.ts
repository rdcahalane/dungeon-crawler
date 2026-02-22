import * as Phaser from "phaser";
import {
  TILE_SIZE,
  COLORS,
  PLAYER_STATS,
} from "../constants";

export interface PlayerState {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  xp: number;
  xpToNext: number;
  floor: number;
  gold: number;
  facing: { x: number; y: number };
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  public stats!: PlayerState;
  private attackCooldown = 0;
  private invincible = 0;
  private attackIndicator!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private attackKey!: Phaser.Input.Keyboard.Key;
  private onDamage?: (dmg: number) => void;
  private onHeal?: (amount: number) => void;
  private onDead?: () => void;
  private onXP?: (gained: number, total: number) => void;
  private onLevelUp?: (level: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, "player");
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDisplaySize(TILE_SIZE - 8, TILE_SIZE - 8);
    this.setTint(COLORS.PLAYER);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(TILE_SIZE - 12, TILE_SIZE - 12);
    body.setCollideWorldBounds(true);

    this.stats = {
      hp: PLAYER_STATS.BASE_HP,
      maxHp: PLAYER_STATS.BASE_HP,
      attack: PLAYER_STATS.BASE_ATTACK,
      defense: PLAYER_STATS.BASE_DEFENSE,
      speed: PLAYER_STATS.BASE_SPEED,
      level: 1,
      xp: 0,
      xpToNext: PLAYER_STATS.XP_PER_LEVEL,
      floor: 1,
      gold: 0,
      facing: { x: 0, y: 1 },
    };

    // Attack direction indicator
    this.attackIndicator = scene.add.rectangle(x, y, 8, 8, 0xffffff, 0.3);
    this.attackIndicator.setDepth(5);

    // Input
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.attackKey = scene.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    this.setDepth(10);
  }

  setCallbacks(callbacks: {
    onDamage?: (dmg: number) => void;
    onHeal?: (amount: number) => void;
    onDead?: () => void;
    onXP?: (gained: number, total: number) => void;
    onLevelUp?: (level: number) => void;
  }) {
    this.onDamage = callbacks.onDamage;
    this.onHeal = callbacks.onHeal;
    this.onDead = callbacks.onDead;
    this.onXP = callbacks.onXP;
    this.onLevelUp = callbacks.onLevelUp;
  }

  update(delta: number) {
    if (this.stats.hp <= 0) return;

    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.invincible = Math.max(0, this.invincible - delta);

    this.handleMovement();
    this.updateAttackIndicator();
  }

  private handleMovement() {
    const body = this.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * this.stats.speed;
      vy = (vy / len) * this.stats.speed;
      this.stats.facing = { x: vx > 0 ? 1 : vx < 0 ? -1 : 0, y: vy > 0 ? 1 : vy < 0 ? -1 : 0 };
    }

    body.setVelocity(vx, vy);
  }

  private updateAttackIndicator() {
    const dist = TILE_SIZE;
    this.attackIndicator.setPosition(
      this.x + this.stats.facing.x * dist,
      this.y + this.stats.facing.y * dist
    );
    // Flash indicator on attack availability
    this.attackIndicator.setAlpha(this.attackCooldown > 0 ? 0.1 : 0.4);
  }

  canAttack(): boolean {
    return this.attackCooldown <= 0 && this.stats.hp > 0;
  }

  tryAttack(): boolean {
    if (!this.canAttack()) return false;
    if (
      !Phaser.Input.Keyboard.JustDown(this.attackKey) &&
      !this.scene.input.mousePointer.isDown
    )
      return false;

    this.attackCooldown = PLAYER_STATS.ATTACK_COOLDOWN;

    // Flash white on attack
    this.setTint(COLORS.PLAYER_ATTACK);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.setTint(COLORS.PLAYER);
    });

    return true;
  }

  getAttackBox(): Phaser.Geom.Rectangle {
    const range = PLAYER_STATS.ATTACK_RANGE;
    const fx = this.stats.facing.x;
    const fy = this.stats.facing.y;

    return new Phaser.Geom.Rectangle(
      this.x + fx * (range / 2) - range / 2,
      this.y + fy * (range / 2) - range / 2,
      range,
      range
    );
  }

  takeDamage(amount: number) {
    if (this.invincible > 0 || this.stats.hp <= 0) return;

    const dmg = Math.max(1, amount - this.stats.defense);
    this.stats.hp = Math.max(0, this.stats.hp - dmg);
    this.invincible = 600;

    // Flash red
    this.setTint(0xff4444);
    this.scene.time.delayedCall(150, () => {
      if (this.active) this.setTint(COLORS.PLAYER);
    });

    this.onDamage?.(dmg);

    if (this.stats.hp <= 0) {
      this.onDead?.();
    }
  }

  heal(amount: number) {
    const healed = Math.min(amount, this.stats.maxHp - this.stats.hp);
    this.stats.hp += healed;
    this.onHeal?.(healed);
  }

  gainXP(amount: number) {
    this.stats.xp += amount;
    this.onXP?.(amount, this.stats.xp);

    while (this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level++;
      this.stats.xpToNext = Math.floor(PLAYER_STATS.XP_PER_LEVEL * Math.pow(1.3, this.stats.level - 1));
      this.stats.maxHp += 20;
      this.stats.hp = Math.min(this.stats.hp + 30, this.stats.maxHp);
      this.stats.attack += 3;
      this.onLevelUp?.(this.stats.level);
    }
  }

  getSerializable() {
    return { ...this.stats };
  }

  destroy(fromScene?: boolean) {
    this.attackIndicator?.destroy();
    super.destroy(fromScene);
  }
}
