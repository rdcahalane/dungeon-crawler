/**
 * Minimap overlay (key M): explored tiles only, 3px tiles, player blip, stairs once seen.
 * Uses the map controller's public `fogSeen` when it exists, else tracks explored tiles itself.
 */
import * as Phaser from "phaser";
import { FOG_RADIUS, MAP_HEIGHT, MAP_WIDTH, TILE, TILE_SIZE } from "../../constants";
import type { GameContext } from "../../GameContext";
import { ExploredTracker } from "./explored";
import { UI, SCREEN_W, drawBox, label } from "./theme";
import { uiState } from "./uiState";

const PX = 3;
const W = MAP_WIDTH * PX;
const H = MAP_HEIGHT * PX;
const BOX = { x: SCREEN_W - 8 - (W + 8), y: 100, w: W + 8, h: H + 8 + 12 };

export class Minimap {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private own = new ExploredTracker(MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS);
  private on = false;
  private lastKey = "";
  private lastDraw = -1;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(40).setVisible(false);
    this.title = label(scene, BOX.x + 6, BOX.y + BOX.h - 12, "MAP", { color: UI.gold, depth: 41 }).setVisible(false);
  }

  get visible(): boolean { return this.on; }

  toggle(): boolean {
    this.on = !this.on;
    this.g.setVisible(this.on);
    this.title.setVisible(this.on);
    uiState.setRect("minimap", this.on ? BOX : null);
    this.lastKey = "";
    return this.on;
  }

  /** Call every frame with the live context (undefined outside the dungeon). */
  update(ctx: GameContext | undefined, now: number): void {
    const player = ctx?.player;
    if (!ctx || !player) return;
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor(player.y / TILE_SIZE);
    this.own.reveal(tx, ty); // cheap, and keeps the fallback current
    if (!this.on) return;
    const external = ctx.map?.fogSeen;
    const seen = external && external.length === MAP_WIDTH * MAP_HEIGHT ? external : this.own.seen;
    const blink = Math.floor(now / 350) % 2;
    // Redraw when the player tile or the blink phase changes, or at most every 250 ms for new fog.
    const key = `${tx},${ty},${blink},${ctx.currentFloor}`;
    if (key === this.lastKey && now - this.lastDraw < 250) return;
    this.lastKey = key;
    this.lastDraw = now;
    this.draw(ctx, seen, tx, ty, blink === 0);
  }

  private draw(ctx: GameContext, seen: Uint8Array, ptx: number, pty: number, bright: boolean): void {
    const g = this.g;
    g.clear();
    drawBox(g, BOX.x, BOX.y, BOX.w, BOX.h, UI.black, UI.slate, null);
    const ox = BOX.x + 4;
    const oy = BOX.y + 4;
    const tiles = ctx.dungeon.tiles;
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const row = tiles[y];
      if (!row) continue;
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (!seen[y * MAP_WIDTH + x]) continue;
        const t = row[x];
        let c: number = UI.slate;
        if (t === TILE.WALL || t === TILE.SECRET_DOOR) c = UI.dusk;
        else if (t === TILE.STAIRS) c = UI.gold;
        else if (t === TILE.STAIRS_UP) c = UI.sky;
        g.fillStyle(c, 1).fillRect(ox + x * PX, oy + y * PX, PX, PX);
      }
    }
    // player blip, one tile larger so it reads
    g.fillStyle(bright ? UI.white : UI.red, 1).fillRect(ox + ptx * PX - 1, oy + pty * PX - 1, PX + 2, PX + 2);
  }

  destroy(): void {
    uiState.setRect("minimap", null);
    this.g.destroy();
    this.title.destroy();
  }
}
