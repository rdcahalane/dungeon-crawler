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
  private _state: "idle" | "chase" | "attack" = "idle";
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarBg!: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, typeKey: EnemyTypeKey) {
    super(scene, x, y, "enemy");
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.typeKey = typeKey;
    const def = ENEMY_TYPES[typeKey];

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
    this.setTint(def.color);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(size - 12, size - 12); // smaller hitbox for easier corridor navigation

    this.setDepth(9);

    // HP bar (above enemy)
    this.hpBarBg = scene.add.rectangle(x, y - size / 2 - 6, size, 4, 0x333333);
    this.hpBarBg.setDepth(11);
    this.hpBar = scene.add.rectangle(x - size / 2, y - size / 2 - 6, size, 4, 0x4caf50);
    this.hpBar.setOrigin(0, 0.5);
    this.hpBar.setDepth(12);
  }

  update(delta: number, playerX: number, playerY: number) {
    if (this.hp <= 0) return;

    this._attackTimer = Math.max(0, this._attackTimer - delta);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);

    const body = this.body as Phaser.Physics.Arcade.Body;

    if (distToPlayer <= this.aggroRange) {
      this._state = "chase";
    }

    if (this._state === "chase") {
      if (distToPlayer > this.attackRange + 8) {
        const len = distToPlayer;
        body.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      } else {
        body.setVelocity(0, 0);
      }
    } else {
      body.setVelocity(0, 0);
    }

    this.updateHpBar();
  }

  canAttackPlayer(playerX: number, playerY: number): boolean {
    if (this._attackTimer > 0 || this.hp <= 0) return false;
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= this.attackRange + TILE_SIZE / 2;
  }

  doAttack(): number {
    this._attackTimer = this.attackCooldown;
    // Flash
    const origTint = ENEMY_TYPES[this.typeKey].color;
    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.setTint(origTint);
    });
    return this.attack;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(1, amount - this.defense);
    this.hp = Math.max(0, this.hp - dmg);
    this.updateHpBar();

    // Flash white
    const origTint = ENEMY_TYPES[this.typeKey].color;
    this.setTint(0xffffff);
    this.scene.time.delayedCall(100, () => {
      if (this.active && this.hp > 0) this.setTint(origTint);
    });

    return dmg;
  }

  private updateHpBar() {
    const def = ENEMY_TYPES[this.typeKey];
    const size = def.size;
    const pct = this.hp / this.maxHp;

    this.hpBarBg.setPosition(this.x, this.y - size / 2 - 6);
    this.hpBar.setPosition(this.x - size / 2, this.y - size / 2 - 6);
    this.hpBar.setDisplaySize(size * pct, 4);
    this.hpBar.setFillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xffa726 : 0xf44336);
  }

  destroy(fromScene?: boolean) {
    this.hpBar?.destroy();
    this.hpBarBg?.destroy();
    super.destroy(fromScene);
  }
}
