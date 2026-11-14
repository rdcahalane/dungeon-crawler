import * as Phaser from "phaser";
import { TILE, TILE_SIZE, type TileValue } from "../../constants";
import { blockedTiles, mechViews, tileKey } from "../../world/mechanisms";
import type { MechState } from "../../world/types";
import type { GameContext } from "../../GameContext";

/** Mechanisms draw above decals and floor items (3) and below creatures (8 and up) and the fog (50). */
const MECH_DEPTH = 5;
/** Redrawn floor or wall for a tile a mechanism changed: above the map tiles (1), below everything else. */
const TILE_PATCH_DEPTH = 1.5;

/** A flat colored square with a letter, for `mech_*` keys the art lane has not produced yet. */
export function ensurePlaceholderTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const tex = scene.textures.createCanvas(key, TILE_SIZE, TILE_SIZE);
  if (!tex) return;
  const g = tex.getContext();
  g.fillStyle = `hsl(${hue} 45% 32%)`;
  g.fillRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
  g.strokeStyle = `hsl(${hue} 60% 62%)`;
  g.lineWidth = 2;
  g.strokeRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
  g.fillStyle = "#fff";
  g.font = "bold 18px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(key.replace(/^mech_/, "").charAt(0).toUpperCase() || "?", TILE_SIZE / 2, TILE_SIZE / 2 + 1);
  tex.refresh();
}

/**
 * Sprites for the engine's drawables, invisible static bodies in `ctx.wallGroup` for what blocks, and repainting
 * of tiles the engine edits (sliding walls, secret doors, closing rooms).
 */
export class MechRender {
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private mechBodies = new Map<string, Phaser.GameObjects.Rectangle>();
  private patches = new Map<string, Phaser.GameObjects.Image>();
  private blocked = new Set<string>();

  constructor(private ctx: GameContext) {}

  isBlocked(tx: number, ty: number): boolean {
    return this.blocked.has(tileKey(tx, ty));
  }

  private textureFor(viewKey: string): string {
    const key = viewKey === "wall" ? `wall_${this.ctx.map.themeIdx}` : viewKey;
    if (key.startsWith("mech_")) ensurePlaceholderTexture(this.ctx.scene, key);
    return key;
  }

  /** Bring sprites and bodies in line with the state (diffed by mechanism id and drawable index). */
  sync(state: MechState): void {
    const scene = this.ctx.scene;
    const counts = new Map<string, number>();
    for (const v of mechViews(state)) {
      const n = counts.get(v.id) ?? 0;
      counts.set(v.id, n + 1);
      const k = `${v.id}:${n}`;
      let spr = this.sprites.get(k);
      if (!v.visible) {
        spr?.setVisible(false);
        continue;
      }
      const tex = this.textureFor(v.textureKey);
      const x = v.tx * TILE_SIZE + TILE_SIZE / 2;
      const y = v.ty * TILE_SIZE + TILE_SIZE / 2;
      if (!spr) {
        spr = scene.add.image(x, y, tex).setDepth(MECH_DEPTH);
        this.sprites.set(k, spr);
      } else {
        if (spr.texture.key !== tex) spr.setTexture(tex);
        spr.setPosition(x, y).setVisible(true);
      }
    }
    this.syncBodies(state);
  }

  private syncBodies(state: MechState): void {
    const scene = this.ctx.scene;
    const want = new Set<string>();
    for (const k of blockedTiles(state)) {
      const [tx, ty] = k.split(",").map(Number);
      const t = this.ctx.dungeon.tiles[ty]?.[tx];
      // Walls already stop movement; only floor tiles need a body of their own.
      if (t === undefined || t === TILE.WALL || t === TILE.SECRET_DOOR) continue;
      want.add(k);
    }
    this.blocked = new Set(blockedTiles(state));
    for (const [k, body] of this.mechBodies) {
      if (!want.has(k)) { body.destroy(); this.mechBodies.delete(k); }
    }
    for (const k of want) {
      if (this.mechBodies.has(k)) continue;
      const [tx, ty] = k.split(",").map(Number);
      const rect = scene.add.rectangle(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
      rect.setVisible(false).setData("mech", true);
      scene.physics.add.existing(rect, true);
      this.ctx.wallGroup.add(rect);
      this.mechBodies.set(k, rect);
    }
  }

  /** The engine changed a tile (`set_tile`): data, visible tile and physics wall. */
  paintTile(tx: number, ty: number, tile: number): void {
    const scene = this.ctx.scene;
    const rows = this.ctx.dungeon.tiles as number[][];
    if (!rows[ty] || rows[ty][tx] === undefined) return;
    rows[ty][tx] = tile as TileValue;

    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;
    const k = tileKey(tx, ty);
    const isWall = tile === TILE.WALL;
    const baseTile = this.ctx.baseDungeon.tiles[ty]?.[tx];
    const baseWall = baseTile === TILE.WALL || baseTile === TILE.SECRET_DOOR;

    // Drop whatever wall body stands there (the map's own, or one this method added before).
    for (const m of this.ctx.wallGroup.getChildren()) {
      const r = m as Phaser.GameObjects.Rectangle;
      if (r.getData("mech")) continue;
      if (Math.abs(r.x - wx) < 2 && Math.abs(r.y - wy) < 2) { r.destroy(); break; }
    }
    this.patches.get(k)?.destroy();
    this.patches.delete(k);

    if (isWall) {
      const rect = scene.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE).setVisible(false);
      scene.physics.add.existing(rect, true);
      this.ctx.wallGroup.add(rect);
      if (!baseWall) {
        this.patches.set(k, scene.add.image(wx, wy, `wall_${this.ctx.map.themeIdx}`).setDepth(TILE_PATCH_DEPTH));
      }
    } else if (baseWall) {
      this.patches.set(k, scene.add.image(wx, wy, `floor_${this.ctx.map.themeIdx}`).setDepth(TILE_PATCH_DEPTH));
    }
  }

  destroy(): void {
    for (const s of this.sprites.values()) s.destroy();
    for (const b of this.mechBodies.values()) b.destroy();
    for (const p of this.patches.values()) p.destroy();
    this.sprites.clear();
    this.mechBodies.clear();
    this.patches.clear();
  }
}
