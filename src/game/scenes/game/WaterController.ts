import type { GameContext } from "../../GameContext";
import type { Enemy } from "../../entities/Enemy";
import { MAP_WIDTH, TILE, TILE_SIZE } from "../../constants";
import { Sfx } from "../../audio/Sfx";

/** Monster splashes are heard within this many tiles of the player. */
const HEAR_TILES = 8;
/** At most one monster splash sound this often. */
const SPLASH_GAP_MS = 400;
/** Every this many wading steps the splashing counts as noise (raises the wandering-monster odds once). */
const NOISY_EVERY = 3;

/**
 * Shallows on flooded crypt and sunken temple floors (DungeonData.water). Whoever stands in
 * them wades: the player and monsters move at WADE_SPEED_MULT, every step in the water
 * ripples and splashes, and the player's splashing carries (classic rule: wading is loud).
 * A monster entering the water near you splashes too, so you hear things coming.
 */
export class WaterController {
  private shallows: Set<number> | null = null;
  private lastTile = -1;
  private wadeSteps = 0;
  private told = false;
  private lastSplashMs = -Infinity;
  private nowMs = 0;

  constructor(private ctx: GameContext) {}

  private get water(): Set<number> {
    if (!this.shallows) this.shallows = new Set(this.ctx.dungeon.water?.shallows ?? []);
    return this.shallows;
  }

  /** True when tile (tx, ty) is shallow water you can stand in. */
  isShallow(tx: number, ty: number): boolean {
    if (this.water.size === 0) return false;
    const t = this.ctx.dungeon.tiles[ty]?.[tx];
    return t !== undefined && t !== TILE.WALL && this.water.has(ty * MAP_WIDTH + tx);
  }

  update(delta: number, curTx: number, curTy: number) {
    if (this.water.size === 0) return;
    this.nowMs += delta;
    const ctx = this.ctx;
    const player = ctx.player;
    if (!player) return;

    const wading = this.isShallow(curTx, curTy);
    player.wading = wading;
    const k = curTy * MAP_WIDTH + curTx;
    if (k !== this.lastTile) {
      this.lastTile = k;
      if (wading) {
        this.ripple(player.x, player.y + 8);
        Sfx.play("splash");
        if (++this.wadeSteps % NOISY_EVERY === 0) ctx.wander.makeNoise();
        if (!this.told) {
          this.told = true;
          ctx.status("You wade into black water. It slows you, and the splashing carries.");
        }
      }
    }

    for (const e of ctx.enemies) {
      if (!e.active) continue;
      const etx = Math.floor(e.x / TILE_SIZE);
      const ety = Math.floor(e.y / TILE_SIZE);
      const inWater = this.isShallow(etx, ety);
      if (inWater && !e.wading) this.monsterSplash(e, curTx, curTy, etx, ety);
      e.wading = inWater;
    }
  }

  private monsterSplash(e: Enemy, ptx: number, pty: number, etx: number, ety: number) {
    this.ripple(e.x, e.y + 8);
    const near = Math.max(Math.abs(etx - ptx), Math.abs(ety - pty)) <= HEAR_TILES;
    if (near && this.nowMs - this.lastSplashMs >= SPLASH_GAP_MS) {
      this.lastSplashMs = this.nowMs;
      Sfx.play("splash");
    }
  }

  /** A ring spreading out on the water at (x, y). */
  private ripple(x: number, y: number) {
    const scene = this.ctx.scene;
    const ring = scene.add.ellipse(x, y, 10, 5).setStrokeStyle(1, 0x94e8f4, 0.8).setDepth(3);
    scene.tweens.add({
      targets: ring,
      scaleX: 2.6,
      scaleY: 2.6,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  destroy() {
    this.shallows = null;
  }
}
