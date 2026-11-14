import * as Phaser from "phaser";
import type { Player } from "../entities/Player";
import type { Enemy } from "../entities/Enemy";

interface Projectile {
  obj: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  lifetime: number;
  /** Return true when the projectile is spent on this enemy. */
  onHit: (enemy: Enemy) => boolean;
}

/**
 * The visual and projectile layer for spells and missile attacks. Since the first-edition rewrite it rolls
 * nothing and spends nothing: `SpellInputController` decides what a spell does (slots, dice, saves) and asks
 * this class to draw orbs, blasts and bolts and to move bolts that need to hit something.
 */
export class SpellSystem {
  private scene: Phaser.Scene;
  private cooldowns: Map<string, number> = new Map(); // ms remaining
  private projectiles: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  getRemainingCooldown(key: string): number {
    return this.cooldowns.get(key) ?? 0;
  }

  startCooldown(key: string, ms: number) {
    this.cooldowns.set(key, ms);
  }

  isCooling(key: string): boolean {
    return (this.cooldowns.get(key) ?? 0) > 0;
  }

  /** A glowing orb that flies between two points, then calls `onArrive` (magic missile, spell darts). */
  flyOrb(
    from: { x: number; y: number }, to: { x: number; y: number },
    color: number, durationMs: number, onArrive: () => void, radius = 5,
  ) {
    const orb = this.scene.add.arc(from.x, from.y, radius, 0, 360, false, color, 1).setDepth(20);
    this.scene.tweens.add({
      targets: orb,
      x: to.x, y: to.y,
      duration: durationMs,
      onComplete: () => {
        orb.destroy();
        onArrive();
      },
    });
  }

  /** Expanding circle (fireball, ice storm, sleep cloud). */
  blast(x: number, y: number, radius: number, color: number, durationMs = 400, alpha = 0.7) {
    const circle = this.scene.add.arc(x, y, 2, 0, 360, false, color, alpha).setDepth(20);
    this.scene.tweens.add({
      targets: circle,
      scaleX: radius / 2, scaleY: radius / 2,
      alpha: 0,
      duration: durationMs,
      onComplete: () => circle.destroy(),
    });
  }

  /** A thin bar that fades (lightning bolt). */
  lineFlash(from: { x: number; y: number }, to: { x: number; y: number }, color: number, width = 4) {
    const g = this.scene.add.graphics().setDepth(20);
    g.lineStyle(width, color, 1);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.strokePath();
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** A projectile that flies straight and hits the first enemy `onHit` accepts. */
  fireBolt(
    from: { x: number; y: number }, dir: { x: number; y: number },
    speed: number, lifetimeMs: number, color: number, onHit: (enemy: Enemy) => boolean,
  ) {
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
    const bolt = this.scene.add.rectangle(from.x, from.y, 6, 6, color).setDepth(20);
    this.projectiles.push({ obj: bolt, vx: (dir.x / len) * speed, vy: (dir.y / len) * speed, lifetime: lifetimeMs, onHit });
  }

  /** Floating label with a ring: "Bless", "+6" and so on. */
  spawnSpellEffect(x: number, y: number, color: number, label: string) {
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

    const ring = this.scene.add.arc(x, y, 5, 0, 360, false, color, 0.6).setDepth(20);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 4, scaleY: 4,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
  }

  update(delta: number, enemies: Enemy[], player: Player) {
    void player;
    for (const [key, remaining] of this.cooldowns) {
      this.cooldowns.set(key, Math.max(0, remaining - delta));
    }

    const dt = delta / 1000;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.lifetime -= delta;
      if (proj.lifetime <= 0) {
        proj.obj.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }
      proj.obj.x += proj.vx * dt;
      proj.obj.y += proj.vy * dt;

      for (const enemy of enemies) {
        if (!enemy.active || enemy.hp <= 0) continue;
        const dx = proj.obj.x - enemy.x;
        const dy = proj.obj.y - enemy.y;
        if (Math.sqrt(dx * dx + dy * dy) < 20 && proj.onHit(enemy)) {
          proj.obj.destroy();
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  destroy() {
    for (const proj of this.projectiles) proj.obj.destroy();
    this.projectiles = [];
  }
}
