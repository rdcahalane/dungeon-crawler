import * as Phaser from "phaser";
import { TILE_SIZE, TOMB_FLOOR } from "../../constants";
import { mathRng, type Rng } from "../../rules";
import { getDef, hasDef, displayName, type ItemInstance } from "../../items";
import { onFloorReached } from "../../systems/QuestSystem";
import type { GameContext } from "../../GameContext";
import { enemyKeyFor, TONE_COLOR, type EffectPlayer, type MechTone } from "./MechEffects";
import type { DriverHost } from "./MechDriver";
import { ensurePlaceholderTexture, type MechRender } from "./MechRender";

interface GroundItem {
  item: ItemInstance;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

const FLOAT_MAX = 56;

/** The scene-bound half of effect handling: status line, floats, tiles, monsters, teleports, floor changes. */
export class MechHost implements DriverHost {
  readonly rng: Rng = mathRng;
  private ground: GroundItem[] = [];

  constructor(
    private ctx: GameContext,
    private render: MechRender,
    private onTeleported: (tx: number, ty: number) => void,
  ) {}

  get player(): EffectPlayer {
    return this.ctx.player;
  }

  say(text: string, tone: MechTone): void {
    const ctx = this.ctx;
    ctx.status(text);
    const shown = text.length > FLOAT_MAX ? `${text.slice(0, FLOAT_MAX - 1)}…` : text;
    ctx.floatText(ctx.player.x, ctx.player.y - 36, shown, TONE_COLOR[tone], 11);
  }

  float(text: string, color: number): void {
    const p = this.ctx.player;
    this.ctx.floatText(p.x, p.y - 52, text, color, 12);
  }

  killPlayer(cause: string, flavor: string): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (p.stats.hp <= 0) return;
    p.stats.hp = 0;
    const line = `Killed by ${cause}. ${flavor}`;
    ctx.status(line);
    ctx.floatText(p.x, p.y - 40, flavor, 0xff5a5f, 14);
    ctx.scene.cameras.main.shake(300, 0.01);
    ctx.emitHUD();
    ctx.floor.handlePlayerDeath();
  }

  trap(type: string): void {
    this.ctx.bus.emit("trap_triggered", { type });
  }

  secretFound(): void {
    this.ctx.bus.emit("door_secret_found");
  }

  setTile(tx: number, ty: number, tile: number): void {
    this.render.paintTile(tx, ty, tile);
  }

  reveal(_id: string): void {
    // The sprite appears on the next `sync`; the engine sends its own sound and message.
    void _id;
  }

  spawn(monster: string, tx: number, ty: number): void {
    const ctx = this.ctx;
    if (!ctx.enemyGroup) return;
    const x = tx * TILE_SIZE + TILE_SIZE / 2;
    const y = ty * TILE_SIZE + TILE_SIZE / 2;
    // Through the combat controller so the monster gets its first-edition stat block.
    ctx.combat.addEnemy(enemyKeyFor(monster), tx, ty);
    ctx.floatText(x, y - 28, "!", 0xff5a5f, 16);
  }

  teleport(tx: number, ty: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const x = tx * TILE_SIZE + TILE_SIZE / 2;
    const y = ty * TILE_SIZE + TILE_SIZE / 2;
    p.setPosition(x, y);
    (p.body as Phaser.Physics.Arcade.Body | null)?.reset(x, y);
    ctx.scene.cameras.main.flash(220, 190, 190, 255);
    this.onTeleported(tx, ty);
  }

  fall(floors: number): void {
    const ctx = this.ctx;
    const target = Math.min(ctx.currentFloor + floors, TOMB_FLOOR);
    if (target <= ctx.currentFloor) return;
    ctx.floatText(ctx.player.x, ctx.player.y - 44, "FALLING", 0xff5a5f, 16);
    if (target === ctx.currentFloor + 1) {
      // One floor down is exactly the stairs path (save, quest progress, fade, autosave). It is private in
      // FloorController, which this lane may not edit, so reach it through a cast.
      const nf = (ctx.floor as unknown as { nextFloor?: () => void }).nextFloor;
      if (typeof nf === "function") { nf.call(ctx.floor); return; }
    }
    ctx.floor.saveCurrentFloor();
    ctx.bus.emit("floor_exit");
    const quests = ctx.player.stats.activeQuests;
    if (quests) onFloorReached(quests, target);
    ctx.scene.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t !== 1) return;
      const ps = ctx.player.getSerializable();
      ps.floor = target;
      ps.saveSlot = ctx.saveSlot;
      ctx.scene.scene.restart({ floor: target, persistedStats: ps, saveSlot: ctx.saveSlot });
    });
  }

  dropItem(item: ItemInstance, tx: number, ty: number): void {
    const scene = this.ctx.scene;
    const x = tx * TILE_SIZE + TILE_SIZE / 2;
    const y = ty * TILE_SIZE + TILE_SIZE / 2;
    let key = hasDef(item.defKey) ? getDef(item.defKey).icon : "";
    if (!key || !scene.textures.exists(key)) {
      key = "mech_item";
      ensurePlaceholderTexture(scene, key);
    }
    const sprite = scene.add.image(x, y, key).setDepth(3);
    scene.tweens.add({ targets: sprite, y: y - 4, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.ground.push({ item, sprite, x, y });
  }

  sfx(key: string): void {
    this.ctx.bus.emit("mech_sfx", { key });
  }

  shake(ms: number): void {
    this.ctx.scene.cameras.main.shake(ms, 0.008);
  }

  /** Items that did not fit in the pack wait on the floor until there is room and the player walks over them. */
  tickGround(): void {
    if (this.ground.length === 0) return;
    const p = this.ctx.player;
    for (let i = this.ground.length - 1; i >= 0; i--) {
      const g = this.ground[i];
      if (Math.hypot(p.x - g.x, p.y - g.y) > TILE_SIZE * 0.7) continue;
      if (!p.inventory.add(g.item).ok) continue;
      this.ctx.floatText(g.x, g.y - 20, `+ ${displayName(g.item, { quantity: false })}`, 0xffd166, 12);
      this.ctx.bus.emit("item_pickup", { type: g.item.defKey });
      g.sprite.destroy();
      this.ground.splice(i, 1);
    }
  }

  destroy(): void {
    for (const g of this.ground) g.sprite.destroy();
    this.ground = [];
  }
}
