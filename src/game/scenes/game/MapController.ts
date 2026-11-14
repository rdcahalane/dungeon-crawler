import * as Phaser from "phaser";
import { TILE_SIZE, TILE, MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS, getFloorThemeIdx } from "../../constants";
import type { GameContext } from "../../GameContext";

/** Tilemap, room decoration, fog of war, torch glow, camera and zoom. */
export class MapController {
  // ── Fog of war ─────────────────────────────────────────────────────────────
  private fogRT!: Phaser.GameObjects.RenderTexture;
  private fogBrushImg!: Phaser.GameObjects.Image;
  private fogState!: Uint8Array;
  private lastFogTile = { tx: -1, ty: -1 };
  private lastRadius = -1;

  // ── Torch glow ─────────────────────────────────────────────────────────────
  private torchInner!: Phaser.GameObjects.Image;
  private torchOuter!: Phaser.GameObjects.Image;

  constructor(private ctx: GameContext) {}

  get themeIdx(): number {
    return getFloorThemeIdx(this.ctx.currentFloor);
  }

  /** Fog tiles the player has seen (1 = seen). Exposed for the map and light lanes. */
  get fogSeen(): Uint8Array {
    return this.fogState;
  }

  // ── Tilemap ───────────────────────────────────────────────────────────────

  buildTilemap() {
    const scene = this.ctx.scene;
    const { tiles } = this.ctx.dungeon;
    const ti = this.themeIdx;
    const floorKey = `floor_${ti}`;
    const wallKey = `wall_${ti}`;

    this.ctx.wallGroup = scene.physics.add.staticGroup();

    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const t = tiles[ty][tx];
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        if (t === TILE.WALL) {
          scene.add.image(wx, wy, wallKey).setDepth(1);
          const rect = scene.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          scene.physics.add.existing(rect, true);
          this.ctx.wallGroup.add(rect);
        } else if (t === TILE.SECRET_DOOR) {
          // Still-secret door (revealed ones are FLOOR by now in working copy)
          const key = `${tx},${ty}`;
          const img = scene.add.image(wx, wy, "secret_door").setDepth(1);
          this.ctx.traps.secretDoorSprites.set(key, img);
          this.ctx.traps.secretDoorSet.add(key);
          const rect = scene.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          scene.physics.add.existing(rect, true);
          this.ctx.wallGroup.add(rect);
        } else if (t === TILE.STAIRS) {
          scene.add.image(wx, wy, floorKey).setDepth(1);
          scene.add.image(wx, wy, "stairs").setDepth(2);
        } else if (t === TILE.STAIRS_UP) {
          scene.add.image(wx, wy, floorKey).setDepth(1);
          scene.add.image(wx, wy, "stairs_up").setDepth(2);
        } else {
          // FLOOR and TRAP both render as floor (TRAP has no floor indicator until detected)
          scene.add.image(wx, wy, floorKey).setDepth(1);
        }
      }
    }

    this.decorateRooms();

    // Build trap map — exclude already-triggered traps
    for (const trap of this.ctx.dungeon.traps) {
      const key = `${trap.tx},${trap.ty}`;
      if (!this.ctx.persist.triggeredTrapKeys.has(key)) {
        this.ctx.traps.trapMap.set(key, trap.type);
      }
    }
  }

  private decorateRooms() {
    const scene = this.ctx.scene;
    this.ctx.dungeon.rooms.forEach((room, idx) => {
      const x = room.x * TILE_SIZE;
      const y = room.y * TILE_SIZE;
      const w = room.w * TILE_SIZE;
      const h = room.h * TILE_SIZE;
      const cx = room.cx * TILE_SIZE + TILE_SIZE / 2;
      const cy = room.cy * TILE_SIZE + TILE_SIZE / 2;
      const type = room.type ?? 'normal';

      const colorByType: Record<string, number> = {
        normal: idx === 0 ? 0x66bb6a : 0x3f4f6a,
        vault: 0xffd166,
        trap_corridor: 0xff5a5f,
        monster_closet: 0x9b5de5,
        quest_special: 0x00bbf9,
      };
      const color = colorByType[type] ?? 0x3f4f6a;
      const modifierColor: Record<string, number> = {
        blood_rune: 0xff5a5f,
        healing_font: 0x69f0ae,
        cursed_crypt: 0xce93d8,
        gilded_cache: 0xffd166,
      };

      scene.add.rectangle(x + w / 2, y + h / 2, w - 10, h - 10)
        .setStrokeStyle(type === 'normal' ? 1 : 2, color, type === 'normal' ? 0.18 : 0.5)
        .setDepth(2);

      if (idx === 0) {
        scene.add.text(cx, y + 12, 'CAMP', {
          fontSize: '9px', color: '#99e6a8', fontFamily: 'monospace',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      } else if (type !== 'normal') {
        const label = type === 'vault'
          ? 'VAULT'
          : type === 'trap_corridor'
            ? 'RUNES'
            : type === 'monster_closet'
              ? 'DEN'
              : (room.tag ?? 'QUEST').toUpperCase();
        scene.add.text(cx, y + 12, label, {
          fontSize: '9px', color: `#${color.toString(16).padStart(6, '0')}`,
          fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      }

      if (type === 'vault') {
        scene.add.image(cx, cy, 'decal_hoard').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'trap_corridor') {
        scene.add.image(cx, cy, 'decal_runes').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'monster_closet') {
        scene.add.image(cx, cy, 'decal_bones').setAlpha(0.75).setDepth(2.5);
      } else if (type === 'quest_special') {
        scene.add.image(cx, cy, 'decal_shrine').setAlpha(0.8).setDepth(2.5);
      } else if (idx % 3 === 0) {
        scene.add.image(cx, cy, 'decal_pillar').setAlpha(0.35).setDepth(2.5);
      }

      if (room.modifier) {
        const modColor = modifierColor[room.modifier] ?? 0xffffff;
        const modLabel = room.modifier === 'blood_rune'
          ? 'BLOOD'
          : room.modifier === 'healing_font'
            ? 'FONT'
            : room.modifier === 'cursed_crypt'
              ? 'CURSE'
              : 'GILD';
        scene.add.rectangle(cx, cy, Math.max(56, w * 0.38), Math.max(36, h * 0.32))
          .setStrokeStyle(2, modColor, 0.42)
          .setDepth(2.8);
        scene.add.text(cx, cy, modLabel, {
          fontSize: '9px', color: `#${modColor.toString(16).padStart(6, '0')}`,
          fontFamily: 'monospace', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(4);
      }
    });
  }

  // ── Torch glow ────────────────────────────────────────────────────────────

  spawnTorchGlow() {
    const scene = this.ctx.scene;
    const px = this.ctx.player.x;
    const py = this.ctx.player.y;

    this.torchOuter = scene.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(2.8).setAlpha(0.35).setDepth(47);

    this.torchInner = scene.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.6).setAlpha(0.55).setDepth(48);
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

  initFog() {
    const scene = this.ctx.scene;
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;

    this.fogState = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.fogRT = scene.add.renderTexture(0, 0, totalW, totalH);
    this.fogRT.setOrigin(0, 0);
    this.fogRT.fill(0x000000, 1);
    this.fogRT.setDepth(50);

    const brushSize = FOG_RADIUS * TILE_SIZE * 2;
    this.fogBrushImg = scene.add.image(0, 0, "fog_brush")
      .setOrigin(0, 0)
      .setDisplaySize(brushSize, brushSize)
      .setVisible(false);

    const { tx, ty } = this.ctx.dungeon.playerStart;
    this.revealFog(tx, ty);
    this.lastFogTile = { tx, ty };
  }

  /** Sight radius in tiles: the held light, a light spell, or one tile of darkness. */
  private get sightRadius(): number {
    return this.ctx.player ? this.ctx.player.lightRadiusTiles() : FOG_RADIUS;
  }

  private revealFog(ptx: number, pty: number) {
    const r = this.sightRadius;
    this.lastRadius = r;
    const brushRadius = r * TILE_SIZE;
    this.fogBrushImg.setDisplaySize(brushRadius * 2, brushRadius * 2);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) continue;
        this.fogState[ty * MAP_WIDTH + tx] = 1;
      }
    }

    const bx = ptx * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    const by = pty * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    this.fogRT.erase(this.fogBrushImg, bx, by);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  setupCamera() {
    const scene = this.ctx.scene;
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;
    scene.cameras.main.setBounds(0, 0, totalW, totalH);
    scene.cameras.main.startFollow(this.ctx.player, true, 0.08, 0.08);

    scene.input.on("wheel", (_ptr: unknown, _objs: unknown, _dx: number, deltaY: number) => {
      this.adjustZoom(-deltaY * 0.001);
    });

    scene.input.keyboard!.on("keydown-PLUS", () => this.adjustZoom(0.1));
    scene.input.keyboard!.on("keydown-EQUALS", () => this.adjustZoom(0.1));
    scene.input.keyboard!.on("keydown-MINUS", () => this.adjustZoom(-0.1));
  }

  private adjustZoom(delta: number) {
    const scene = this.ctx.scene;
    const next = Phaser.Math.Clamp(scene.cameras.main.zoom + delta, 0.4, 2.5);
    scene.cameras.main.setZoom(next);
    scene.events.emit("hud:zoom", next);
  }

  // ── Per frame ─────────────────────────────────────────────────────────────

  /** Torch flicker, then fog reveal when the player crosses a tile. Same order as the old update loop. */
  update(curTx: number, curTy: number) {
    const player = this.ctx.player;
    // Torch glow flicker, sized to the light actually burning (a dead torch leaves a faint ember)
    const lit = player.hasLight();
    const k = Math.max(0.3, this.sightRadius / FOG_RADIUS);
    const flicker = (lit ? 0.5 : 0.12) + Math.sin(this.ctx.scene.time.now * 0.008) * 0.04 + (Math.random() - 0.5) * 0.025;
    this.torchInner.setPosition(player.x, player.y).setAlpha(flicker).setScale(1.6 * k);
    this.torchOuter.setPosition(player.x, player.y).setAlpha(flicker * 0.55).setScale(2.8 * k);

    // Fog of war: re-reveal on a new tile, or when the light grew or shrank
    if (curTx !== this.lastFogTile.tx || curTy !== this.lastFogTile.ty || this.sightRadius !== this.lastRadius) {
      this.lastFogTile = { tx: curTx, ty: curTy };
      this.revealFog(curTx, curTy);
    }
  }

  destroy() {
    // Scene shutdown destroys the display objects; nothing else to release.
  }
}
