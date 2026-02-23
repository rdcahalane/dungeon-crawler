import * as Phaser from "phaser";
import { TILE_SIZE, COLORS, FOG_RADIUS, FLOOR_THEMES, FloorTheme } from "../constants";

function lerpColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
  return (
    (Math.round(r1 + (r2 - r1) * t) << 16) |
    (Math.round(g1 + (g2 - g1) * t) << 8) |
    Math.round(b1 + (b2 - b1) * t)
  );
}

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  create() {
    this.createTextures();
    this.scene.start("MainMenuScene");
  }

  private createTextures() {
    this.createFloorTexture();
    this.createWallTexture();
    this.createThemedTiles();
    this.createTavernTextures();
    this.createSecretDoorTexture();
    this.createTrapTexture();
    this.createStairsTexture();
    this.createStairsUpTexture();
    this.createPlayerTexture();
    this.createClassAvatars();
    this.createEnemyTexture();
    this.createNewEnemyTextures();
    this.createItemTextures();
    this.createChestTextures();
    this.createFogBrush();
    this.createTorchGlow();
    this.createSpellGlows();
  }

  // ── Cobblestone floor ──────────────────────────────────────────────────────

  private createFloorTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0x18181f);
    g.fillRect(0, 0, S, S);

    const stones = [
      { x: 2, y: 2, w: 13, h: 12, c: 0x2e2e3a },
      { x: 17, y: 2, w: 13, h: 12, c: 0x28282e },
      { x: 2, y: 17, w: 13, h: 12, c: 0x2a2a36 },
      { x: 17, y: 17, w: 12, h: 12, c: 0x2c2c38 },
    ];

    for (const s of stones) {
      g.fillStyle(0x0f0f14);
      g.fillRoundedRect(s.x + 1, s.y + 1, s.w, s.h, 2);
      g.fillStyle(s.c);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 2);
      g.fillStyle(0x3c3c4a, 0.5);
      g.fillRoundedRect(s.x, s.y, Math.floor(s.w * 0.55), Math.floor(s.h * 0.45), 2);
      g.fillStyle(0x222230, 0.7);
      g.fillRect(s.x + 4, s.y + 6, 1, 1);
      g.fillRect(s.x + 9, s.y + 3, 1, 1);
    }

    g.generateTexture("floor", S, S);
    g.destroy();
  }

  // ── Rocky cave wall ────────────────────────────────────────────────────────

  private createWallTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0x110d08);
    g.fillRect(0, 0, S, S);

    const chunks = [
      { x: 0,  y: 0,  w: 17, h: 14, face: 0x4e3f30, hi: 0x6a5642, lo: 0x2e2216 },
      { x: 19, y: 0,  w: 13, h: 15, face: 0x463828, hi: 0x5e4c38, lo: 0x2a1e12 },
      { x: 0,  y: 16, w: 15, h: 16, face: 0x52412e, hi: 0x6e5840, lo: 0x301f10 },
      { x: 17, y: 17, w: 15, h: 15, face: 0x483a28, hi: 0x604e38, lo: 0x2c1e0e },
    ];

    for (const c of chunks) {
      g.fillStyle(0x080604);
      g.fillRect(c.x + 2, c.y + 2, c.w, c.h);
      g.fillStyle(c.face);
      g.fillRect(c.x, c.y, c.w, c.h);
      g.fillStyle(c.hi, 0.75);
      g.fillRect(c.x, c.y, c.w, 2);
      g.fillRect(c.x, c.y, 2, c.h);
      g.fillStyle(c.lo, 0.85);
      g.fillRect(c.x, c.y + c.h - 2, c.w, 2);
      g.fillRect(c.x + c.w - 2, c.y, 2, c.h);
      g.fillStyle(c.hi, 0.25);
      g.fillRect(c.x + 2, c.y + 2, Math.floor(c.w * 0.45), Math.floor(c.h * 0.35));
      g.fillStyle(0x0a0806, 0.9);
      g.fillRect(c.x + 5, c.y + 4, 1, 1);
      g.fillRect(c.x + c.w - 5, c.y + c.h - 4, 1, 1);
      g.fillRect(c.x + 3, c.y + c.h - 5, 1, 1);
    }

    g.fillStyle(0x080604);
    g.fillRect(17, 0, 2, 17);
    g.fillRect(0, 15, 17, 2);
    g.fillRect(17, 16, S - 17, 2);

    g.generateTexture("wall", S, S);
    g.destroy();
  }

  // ── Secret door: wall with faint crack ────────────────────────────────────

  private createSecretDoorTexture() {
    const S = TILE_SIZE;

    // Reuse wall as base — draw a subtle vertical crack in blue
    const g = this.add.graphics();
    g.fillStyle(0x110d08);
    g.fillRect(0, 0, S, S);

    const chunks = [
      { x: 0, y: 0, w: 17, h: 14, face: 0x4e3f30 },
      { x: 19, y: 0, w: 13, h: 15, face: 0x463828 },
      { x: 0, y: 16, w: 15, h: 16, face: 0x52412e },
      { x: 17, y: 17, w: 15, h: 15, face: 0x483a28 },
    ];
    for (const c of chunks) {
      g.fillStyle(c.face);
      g.fillRect(c.x, c.y, c.w, c.h);
    }

    // Faint crack hint
    g.fillStyle(0x334455, 0.6);
    g.fillRect(15, 2, 2, S - 4);
    g.fillRect(12, 8, 1, 4);
    g.fillRect(17, 14, 1, 4);

    g.generateTexture("secret_door", S, S);
    g.destroy();

    // Open secret door — dark opening
    const g2 = this.add.graphics();
    g2.fillStyle(0x060608);
    g2.fillRect(0, 0, S, S);
    g2.fillStyle(0x1a1a28, 0.6);
    g2.fillRect(4, 4, S - 8, S - 8);
    g2.generateTexture("secret_door_open", S, S);
    g2.destroy();
  }

  // ── Trap tile ─────────────────────────────────────────────────────────────

  private createTrapTexture() {
    const S = TILE_SIZE;

    // Hidden trap = floor (same as floor tile, no indicator)
    // We just reuse "floor" for hidden traps.
    // Detected trap = floor + red X
    const g = this.add.graphics();
    // Base floor
    g.fillStyle(0x18181f);
    g.fillRect(0, 0, S, S);
    g.fillStyle(0x2e2e3a);
    g.fillRoundedRect(2, 2, 13, 12, 2);
    g.fillRoundedRect(17, 2, 13, 12, 2);
    g.fillRoundedRect(2, 17, 13, 12, 2);
    g.fillRoundedRect(17, 17, 12, 12, 2);

    // Red X indicator
    g.lineStyle(2, 0xff1744, 0.9);
    g.strokeRect(6, 6, S - 12, S - 12);
    g.lineBetween(6, 6, S - 6, S - 6);
    g.lineBetween(S - 6, 6, 6, S - 6);

    g.generateTexture("trap_detected", S, S);
    g.destroy();
  }

  // ── Stairs ─────────────────────────────────────────────────────────────────

  private createStairsTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0x1e1e28);
    g.fillRect(0, 0, S, S);

    const steps = [
      { x: 4, y: 24, w: 24, h: 4 },
      { x: 7, y: 19, w: 18, h: 4 },
      { x: 10, y: 14, w: 12, h: 4 },
      { x: 13, y: 9, w: 6, h: 4 },
    ];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const t = i / (steps.length - 1);
      const stepColor = lerpColor(0xaa8800, 0xffd700, t);
      g.fillStyle(stepColor);
      g.fillRect(s.x, s.y, s.w, s.h);
      g.fillStyle(0xffee88, 0.6);
      g.fillRect(s.x, s.y, s.w, 1);
      g.fillStyle(0x664400, 0.5);
      g.fillRect(s.x, s.y + s.h - 1, s.w, 1);
    }

    g.fillStyle(0xffd700, 0.15);
    g.fillRect(2, 26, 28, 6);

    g.generateTexture("stairs", S, S);
    g.destroy();
  }

  // ── Stairs Up ─────────────────────────────────────────────────────────────

  private createStairsUpTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0x1e1e28);
    g.fillRect(0, 0, S, S);

    // Ascending steps (reverse order, top-lit in blue)
    const steps = [
      { x: 4, y: 4, w: 24, h: 4 },
      { x: 7, y: 9, w: 18, h: 4 },
      { x: 10, y: 14, w: 12, h: 4 },
      { x: 13, y: 19, w: 6, h: 4 },
    ];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const t = i / (steps.length - 1);
      const stepColor = lerpColor(0x80b8ff, 0xaaddff, t);
      g.fillStyle(stepColor);
      g.fillRect(s.x, s.y, s.w, s.h);
      g.fillStyle(0xcceeff, 0.6);
      g.fillRect(s.x, s.y, s.w, 1);
      g.fillStyle(0x2244aa, 0.5);
      g.fillRect(s.x, s.y + s.h - 1, s.w, 1);
    }
    g.fillStyle(0xaaddff, 0.2);
    g.fillRect(2, 2, 28, 4);

    g.generateTexture("stairs_up", S, S);
    g.destroy();
  }

  // ── Themed Floor & Wall Tiles (4 themes) ─────────────────────────────────

  private createThemedTiles() {
    FLOOR_THEMES.forEach((theme, idx) => {
      this.createThemedFloor(idx, theme);
      this.createThemedWall(idx, theme);
    });
  }

  private createThemedFloor(idx: number, t: FloorTheme) {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    g.fillStyle(t.floorBase);
    g.fillRect(0, 0, S, S);
    const stones = [
      { x: 2, y: 2, w: 13, h: 12, c: t.floorStones[0] },
      { x: 17, y: 2, w: 13, h: 12, c: t.floorStones[1] },
      { x: 2, y: 17, w: 13, h: 12, c: t.floorStones[2] },
      { x: 17, y: 17, w: 12, h: 12, c: t.floorStones[3] },
    ];
    for (const s of stones) {
      g.fillStyle(t.floorGrout);
      g.fillRoundedRect(s.x + 1, s.y + 1, s.w, s.h, 2);
      g.fillStyle(s.c);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 2);
      g.fillStyle(lerpColor(s.c, 0xffffff, 0.12), 0.5);
      g.fillRoundedRect(s.x, s.y, Math.floor(s.w * 0.55), Math.floor(s.h * 0.45), 2);
    }
    g.generateTexture(`floor_${idx}`, S, S);
    g.destroy();
  }

  private createThemedWall(idx: number, t: FloorTheme) {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    g.fillStyle(t.wallBase);
    g.fillRect(0, 0, S, S);
    const chunks = [
      { x: 0, y: 0, w: 17, h: 14 },
      { x: 19, y: 0, w: 13, h: 15 },
      { x: 0, y: 16, w: 15, h: 16 },
      { x: 17, y: 17, w: 15, h: 15 },
    ];
    for (const c of chunks) {
      g.fillStyle(t.wallBase);
      g.fillRect(c.x + 2, c.y + 2, c.w, c.h);
      g.fillStyle(t.wallFace);
      g.fillRect(c.x, c.y, c.w, c.h);
      g.fillStyle(t.wallHi, 0.75);
      g.fillRect(c.x, c.y, c.w, 2);
      g.fillRect(c.x, c.y, 2, c.h);
      g.fillStyle(t.wallLo, 0.85);
      g.fillRect(c.x, c.y + c.h - 2, c.w, 2);
      g.fillRect(c.x + c.w - 2, c.y, 2, c.h);
      g.fillStyle(t.wallHi, 0.2);
      g.fillRect(c.x + 2, c.y + 2, Math.floor(c.w * 0.45), Math.floor(c.h * 0.35));
    }
    g.fillStyle(t.wallBase);
    g.fillRect(17, 0, 2, 17);
    g.fillRect(0, 15, 17, 2);
    g.fillRect(17, 16, S - 17, 2);
    g.generateTexture(`wall_${idx}`, S, S);
    g.destroy();
  }

  // ── Tavern Textures ────────────────────────────────────────────────────────

  private createTavernTextures() {
    const S = TILE_SIZE;

    // Warm wooden plank floor
    const tf = this.add.graphics();
    tf.fillStyle(0x2c1e0c);
    tf.fillRect(0, 0, S, S);
    const plankColors = [0x5c3a18, 0x4e3210, 0x6b4520, 0x543c16];
    for (let i = 0; i < 4; i++) {
      const y = i * 8;
      tf.fillStyle(plankColors[i]);
      tf.fillRect(0, y, S, 7);
      tf.fillStyle(lerpColor(plankColors[i], 0x000000, 0.3), 0.4);
      tf.fillRect(2, y + 2, 10, 1);
      tf.fillRect(18, y + 4, 8, 1);
    }
    tf.generateTexture("tavern_floor", S, S);
    tf.destroy();

    // Stone-and-timber wall
    const tw = this.add.graphics();
    tw.fillStyle(0x1e1208);
    tw.fillRect(0, 0, S, S);
    tw.fillStyle(0x5a4030);
    tw.fillRect(0, 0, 15, 14);
    tw.fillStyle(0x4e3828);
    tw.fillRect(17, 0, S - 17, 15);
    tw.fillStyle(0x563c28);
    tw.fillRect(0, 16, 14, S - 16);
    tw.fillStyle(0x503822);
    tw.fillRect(16, 17, S - 16, S - 17);
    tw.fillStyle(0x8b5e2a, 0.5);
    tw.fillRect(0, 14, S, 2);
    tw.fillRect(14, 0, 2, S);
    tw.fillStyle(0x7a6050, 0.4);
    tw.fillRect(0, 0, 8, 3);
    tw.generateTexture("tavern_wall", S, S);
    tw.destroy();

    // NPC base sprite (white, will be tinted per-NPC)
    const npc = this.add.graphics();
    npc.fillStyle(0xffffff);
    npc.fillCircle(16, 8, 6);
    npc.fillRoundedRect(10, 15, 12, 14, 3);
    npc.fillStyle(0xdddddd);
    npc.fillRect(6, 16, 5, 10);
    npc.fillRect(21, 16, 5, 10);
    npc.fillStyle(0x000000);
    npc.fillCircle(14, 7, 1.5);
    npc.fillCircle(18, 7, 1.5);
    npc.generateTexture("npc", S, S);
    npc.destroy();

    // Notice board
    const board = this.add.graphics();
    board.fillStyle(0x8b5e2a);
    board.fillRoundedRect(2, 2, S - 4, S - 4, 3);
    board.fillStyle(0xffe082);
    board.fillRoundedRect(4, 4, S - 8, S - 8, 2);
    board.fillStyle(0x4e3210, 0.8);
    board.fillRect(6, 8, S - 14, 2);
    board.fillRect(6, 13, S - 14, 2);
    board.fillRect(6, 18, S - 14, 2);
    board.fillRect(6, 23, 10, 2);
    board.fillStyle(0xf44336);
    board.fillCircle(16, 6, 2);
    board.generateTexture("notice_board", S, S);
    board.destroy();

    // Dungeon entrance portal
    const portal = this.add.graphics();
    portal.fillStyle(0x080812);
    portal.fillRoundedRect(2, 0, S - 4, S - 2, 3);
    for (let i = 0; i < 4; i++) {
      portal.fillStyle(0x6600cc, (4 - i) * 0.12);
      portal.fillRoundedRect(2 + i, i, S - 4 - i * 2, S - 2 - i, 3);
    }
    portal.fillStyle(0x1a0040);
    portal.fillRoundedRect(5, 3, S - 10, S - 6, 2);
    portal.fillStyle(0x9955ff, 0.35);
    portal.fillCircle(16, 15, 9);
    portal.fillStyle(0xffffff, 0.15);
    portal.fillCircle(14, 12, 3);
    portal.generateTexture("dungeon_portal", S, S);
    portal.destroy();
  }

  // ── Class Avatars ─────────────────────────────────────────────────────────

  private createClassAvatars() {
    this.createFighterAvatar();
    this.createThiefAvatar();
    this.createWizardAvatar();
    this.createClericAvatar();
  }

  private createFighterAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    // Broad helmet
    g.fillStyle(0xffffff);
    g.fillCircle(16, 7, 8);
    g.fillStyle(0x000000);
    g.fillRect(10, 5, 12, 3);  // visor slit
    // Wide shoulder pauldrons
    g.fillStyle(0xffffff);
    g.fillRect(3, 12, 6, 8);
    g.fillRect(23, 12, 6, 8);
    // Armoured chest
    g.fillRoundedRect(7, 14, 18, 14, 2);
    g.fillStyle(0xdddddd, 0.5);
    g.fillRect(8, 17, 16, 2);
    g.fillRect(8, 21, 16, 2);
    // Sword on right
    g.fillStyle(0xffffff);
    g.fillRect(26, 8, 3, 16);
    g.fillStyle(0xbbbbbb, 0.7);
    g.fillRect(23, 14, 8, 2);
    g.generateTexture("player_fighter", S, S);
    g.destroy();
  }

  private createThiefAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    // Pointed hood
    g.fillStyle(0xffffff);
    g.fillTriangle(16, 0, 9, 11, 23, 11);
    g.fillCircle(16, 11, 6);
    // Shadow (hood brim shadow on face)
    g.fillStyle(0x000000, 0.45);
    g.fillRect(10, 9, 12, 4);
    // Slim cloaked body
    g.fillStyle(0xffffff);
    g.fillRoundedRect(11, 17, 10, 14, 2);
    // Cloak sides
    g.fillTriangle(7, 17, 11, 17, 7, 30);
    g.fillTriangle(25, 17, 21, 17, 25, 30);
    // Dagger
    g.fillStyle(0xffffff);
    g.fillRect(4, 20, 2, 9);
    g.fillStyle(0xbbbbbb, 0.6);
    g.fillRect(2, 22, 6, 2);
    // Eye gleam
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(16, 11, 1.5);
    g.generateTexture("player_thief", S, S);
    g.destroy();
  }

  private createWizardAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    // Tall pointed hat
    g.fillStyle(0xffffff);
    g.fillTriangle(16, 0, 9, 12, 23, 12);
    g.fillRect(7, 11, 18, 3);
    // Head (narrow)
    g.fillCircle(16, 16, 5);
    // Long robes
    g.fillTriangle(9, 19, 23, 19, 5, 32);
    g.fillTriangle(23, 19, 9, 19, 27, 32);
    g.fillRoundedRect(11, 18, 10, 13, 1);
    // Star on robe
    g.fillStyle(0xffffff, 0.45);
    g.fillRect(15, 20, 2, 6);
    g.fillRect(12, 23, 8, 1);
    // Staff
    g.fillStyle(0xffffff);
    g.fillRect(26, 6, 2, 24);
    g.fillCircle(27, 5, 3);
    // Eyes
    g.fillStyle(0x000000);
    g.fillCircle(14, 15, 1.5);
    g.fillCircle(18, 15, 1.5);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(14, 15, 1);
    g.fillCircle(18, 15, 1);
    g.generateTexture("player_wizard", S, S);
    g.destroy();
  }

  private createClericAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();
    // Rounded cowl
    g.fillStyle(0xffffff);
    g.fillCircle(16, 8, 8);
    g.fillRect(8, 8, 16, 5);
    // Holy cross on forehead
    g.fillStyle(0x000000);
    g.fillRect(15, 2, 2, 7);
    g.fillRect(11, 5, 10, 2);
    g.fillStyle(0xffffff, 0.8);
    g.fillRect(15, 3, 2, 5);
    g.fillRect(12, 6, 8, 1);
    // Tabard / robes
    g.fillStyle(0xffffff);
    g.fillRoundedRect(9, 15, 14, 16, 2);
    // Wide shoulders
    g.fillRect(5, 15, 5, 8);
    g.fillRect(22, 15, 5, 8);
    // Cross symbol on chest
    g.fillStyle(0xffffff, 0.35);
    g.fillRect(15, 16, 2, 8);
    g.fillRect(12, 19, 8, 2);
    // Mace right side
    g.fillStyle(0xffffff);
    g.fillRect(25, 12, 3, 14);
    g.fillRoundedRect(22, 9, 9, 6, 2);
    // Eyes
    g.fillStyle(0x000000);
    g.fillCircle(13, 8, 1.5);
    g.fillCircle(19, 8, 1.5);
    g.generateTexture("player_cleric", S, S);
    g.destroy();
  }

  // ── Player (armoured hero) ────────────────────────────────────────────────

  private createPlayerTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0xffffff); // Will be tinted by class color
    g.fillRoundedRect(7, 10, 18, 18, 4);
    g.fillStyle(0xdddddd, 0.4);
    g.fillRoundedRect(7, 10, 10, 8, 4);
    g.fillStyle(0xcccccc);
    g.fillRect(5, 11, 4, 6);
    g.fillRect(23, 11, 4, 6);
    g.fillStyle(0xeeeeee);
    g.fillCircle(16, 8, 7);
    g.fillStyle(0xffffff, 0.85);
    g.fillRoundedRect(10, 5, 12, 4, 1);
    g.fillStyle(0x000000);
    g.fillCircle(13, 7, 1.5);
    g.fillCircle(19, 7, 1.5);

    g.generateTexture("player", S, S);
    g.destroy();
  }

  // ── Generic enemy silhouette ──────────────────────────────────────────────

  private createEnemyTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    g.fillStyle(0xffffff);
    g.fillRoundedRect(4, 6, 24, 22, 4);
    g.fillTriangle(8, 7, 13, 7, 10, 1);
    g.fillTriangle(19, 7, 24, 7, 22, 1);
    g.fillStyle(0x000000);
    g.fillCircle(11, 14, 5);
    g.fillCircle(21, 14, 5);
    g.fillStyle(0xffffff);
    g.fillCircle(11, 14, 3);
    g.fillCircle(21, 14, 3);
    g.fillStyle(0x000000);
    g.fillRect(9, 22, 14, 3);
    g.fillStyle(0xffffff);
    g.fillRect(10, 22, 2, 2);
    g.fillRect(14, 22, 2, 2);
    g.fillRect(18, 22, 2, 2);

    g.generateTexture("enemy", S, S);
    g.destroy();
  }

  // ── New enemy silhouettes ─────────────────────────────────────────────────

  private createNewEnemyTextures() {
    const S = TILE_SIZE;

    // Skeleton — bone white, ribcage, hollow eyes
    const sk = this.add.graphics();
    sk.fillStyle(0xffffff);
    sk.fillRoundedRect(8, 4, 16, 12, 3);   // skull
    sk.fillStyle(0x000000);
    sk.fillCircle(12, 9, 3);              // eye sockets
    sk.fillCircle(20, 9, 3);
    sk.fillStyle(0xffffff);
    sk.fillRect(10, 18, 12, 2);           // ribcage bars
    sk.fillRect(10, 22, 12, 2);
    sk.fillRect(10, 26, 12, 2);
    sk.fillRect(14, 16, 4, 14);           // spine
    sk.generateTexture("enemy_skeleton", S, S);
    sk.destroy();

    // Zombie — blocky, hunched
    const zm = this.add.graphics();
    zm.fillStyle(0xffffff);
    zm.fillRoundedRect(6, 8, 20, 20, 3);  // body
    zm.fillCircle(16, 6, 7);             // head
    zm.fillStyle(0x000000);
    zm.fillCircle(13, 6, 2);
    zm.fillCircle(19, 6, 2);
    zm.fillRect(12, 10, 8, 2);           // mouth (groaning)
    zm.fillStyle(0x558b2f, 0.4);
    zm.fillRoundedRect(7, 9, 8, 6, 2);   // rot patch
    zm.generateTexture("enemy_zombie", S, S);
    zm.destroy();

    // Giant Rat — round body, thin tail
    const rat = this.add.graphics();
    rat.fillStyle(0xffffff);
    rat.fillCircle(16, 16, 9);            // body
    rat.fillCircle(22, 11, 5);            // head
    rat.fillStyle(0x000000);
    rat.fillCircle(24, 9, 2);             // eye
    rat.fillStyle(0xffffff);
    rat.lineBetween(26, 10, 32, 8);       // whisker1
    rat.lineBetween(26, 11, 32, 13);      // whisker2
    rat.fillTriangle(6, 16, 2, 22, 5, 22); // tail
    rat.generateTexture("enemy_giant_rat", S, S);
    rat.destroy();

    // Giant Spider — round body, 8 legs
    const sp = this.add.graphics();
    sp.fillStyle(0xffffff);
    sp.fillCircle(16, 18, 8);             // abdomen
    sp.fillCircle(16, 10, 5);             // cephalothorax
    sp.fillStyle(0x000000);
    sp.fillCircle(14, 9, 1.5);
    sp.fillCircle(18, 9, 1.5);
    sp.fillCircle(12, 8, 1);
    sp.fillCircle(20, 8, 1);
    sp.lineStyle(2, 0xffffff, 1);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI / 3) - Math.PI / 6;
      sp.lineBetween(16 - 6, 18, 16 - 6 - Math.cos(angle) * 10, 18 + Math.sin(angle) * 8);
      sp.lineBetween(16 + 6, 18, 16 + 6 + Math.cos(angle) * 10, 18 + Math.sin(angle) * 8);
    }
    sp.generateTexture("enemy_giant_spider", S, S);
    sp.destroy();

    // Troll — big, blocky, mossy
    const tr = this.add.graphics();
    tr.fillStyle(0xffffff);
    tr.fillRoundedRect(4, 6, 24, 24, 4); // body (wide)
    tr.fillCircle(16, 5, 8);              // big head
    tr.fillStyle(0x000000);
    tr.fillCircle(12, 5, 3);
    tr.fillCircle(20, 5, 3);
    tr.fillStyle(0xffffff, 0.3);
    tr.fillRoundedRect(5, 7, 8, 6, 2);   // moss patches
    tr.fillRoundedRect(19, 16, 7, 5, 2);
    tr.generateTexture("enemy_troll", S, S);
    tr.destroy();

    // Dark Elf — slim, hooded
    const de = this.add.graphics();
    de.fillStyle(0xffffff);
    de.fillRoundedRect(9, 10, 14, 20, 3); // slim body
    de.fillCircle(16, 7, 6);              // head
    de.fillStyle(0x333333);
    de.fillCircle(16, 4, 9); // dark hood
    de.fillStyle(0x000000);
    de.fillRect(12, 7, 8, 2);            // narrow glowing eyes slit
    de.fillStyle(0xffffff, 0.8);
    de.fillCircle(13, 8, 1);
    de.fillCircle(19, 8, 1);
    de.generateTexture("enemy_dark_elf", S, S);
    de.destroy();

    // Ghost — translucent, wispy bottom
    const gh = this.add.graphics();
    gh.fillStyle(0xffffff, 0.8);
    gh.fillCircle(16, 12, 10);            // upper form
    gh.fillStyle(0xffffff, 0.5);
    gh.fillTriangle(6, 18, 26, 18, 11, 30); // wispy bottom-left
    gh.fillTriangle(16, 18, 30, 18, 25, 30); // wispy bottom-right
    gh.fillStyle(0x000000);
    gh.fillCircle(12, 11, 3);
    gh.fillCircle(20, 11, 3);
    gh.generateTexture("enemy_ghost", S, S);
    gh.destroy();

    // Mimic — looks like a chest
    const mi = this.add.graphics();
    mi.fillStyle(0xffd700);
    mi.fillRoundedRect(4, 10, 24, 18, 3); // chest body
    mi.fillStyle(0xccaa00);
    mi.fillRoundedRect(4, 10, 24, 6, 3);  // lid
    mi.fillStyle(0x8b6914);
    mi.fillRect(14, 14, 4, 6);            // lock
    // Add eyes peeking out
    mi.fillStyle(0xff3300);
    mi.fillCircle(10, 18, 2);
    mi.fillCircle(22, 18, 2);
    mi.generateTexture("enemy_mimic", S, S);
    mi.destroy();
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private createItemTextures() {
    const S = TILE_SIZE;

    // Health potion
    const hp = this.add.graphics();
    hp.fillStyle(0x4a1010);
    hp.fillRoundedRect(10, 8, 12, 18, 4);
    hp.fillStyle(0xee3333);
    hp.fillRoundedRect(10, 8, 12, 14, 4);
    hp.fillStyle(0xff8888, 0.6);
    hp.fillRoundedRect(12, 9, 4, 6, 2);
    hp.fillStyle(0x888888);
    hp.fillRect(12, 6, 8, 3);
    hp.fillRect(13, 4, 6, 3);
    hp.generateTexture("item_health_potion", S, S);
    hp.destroy();

    // Weapon — sword
    const wp = this.add.graphics();
    wp.fillStyle(0xaaaaaa);
    wp.fillRect(15, 4, 2, 20);
    wp.fillStyle(0xffd700);
    wp.fillRect(10, 18, 12, 3);
    wp.fillStyle(0x8b4513);
    wp.fillRect(14, 21, 4, 8);
    wp.fillStyle(0xffffff, 0.5);
    wp.fillRect(15, 4, 1, 14);
    wp.generateTexture("item_weapon", S, S);
    wp.destroy();

    // Armor — shield
    const ar = this.add.graphics();
    ar.fillStyle(0x4a4a6a);
    ar.fillRoundedRect(8, 5, 16, 22, 4);
    ar.fillStyle(0x6666aa);
    ar.fillRoundedRect(9, 6, 14, 16, 3);
    ar.fillStyle(0xaaaaff, 0.4);
    ar.fillRoundedRect(10, 7, 6, 8, 2);
    ar.fillStyle(0xffd700);
    ar.fillRect(15, 10, 2, 10);
    ar.fillRect(11, 14, 10, 2);
    ar.generateTexture("item_armor", S, S);
    ar.destroy();

    // XP orb
    const xp = this.add.graphics();
    for (let i = 8; i >= 1; i--) {
      const t = i / 8;
      const c = lerpColor(0xffffff, 0xab47bc, t);
      xp.fillStyle(c, 0.9 - t * 0.3);
      xp.fillCircle(16, 16, i + 2);
    }
    xp.fillStyle(0xffffff, 0.8);
    xp.fillCircle(13, 13, 2);
    xp.generateTexture("item_xp_orb", S, S);
    xp.destroy();

    // Gold coin
    const gold = this.add.graphics();
    gold.fillStyle(0xffd700);
    gold.fillCircle(16, 16, 10);
    gold.fillStyle(0xffee44);
    gold.fillCircle(14, 14, 4);
    gold.fillStyle(0xaa8800);
    gold.strokeCircle(16, 16, 10);
    gold.generateTexture("item_gold", S, S);
    gold.destroy();

    // Scroll
    const scroll = this.add.graphics();
    scroll.fillStyle(0xffe082);
    scroll.fillRoundedRect(8, 4, 16, 24, 4);
    scroll.fillStyle(0x8b6914);
    scroll.fillRect(8, 4, 16, 4);
    scroll.fillRect(8, 24, 16, 4);
    scroll.fillStyle(0x8b6914, 0.5);
    scroll.fillRect(11, 10, 10, 1);
    scroll.fillRect(11, 14, 10, 1);
    scroll.fillRect(11, 18, 6, 1);
    scroll.generateTexture("item_scroll", S, S);
    scroll.destroy();

    // Stat tome
    const tome = this.add.graphics();
    tome.fillStyle(0xf48fb1);
    tome.fillRoundedRect(6, 4, 20, 26, 3);
    tome.fillStyle(0xffffff, 0.5);
    tome.fillRoundedRect(8, 6, 14, 10, 2);
    tome.fillStyle(0x880044);
    tome.fillRect(10, 8, 8, 2);
    tome.fillRect(10, 12, 6, 2);
    tome.generateTexture("item_stat_tome", S, S);
    tome.destroy();
  }

  // ── Chest textures ────────────────────────────────────────────────────────

  private createChestTextures() {
    const S = TILE_SIZE;

    const makeChest = (color: number, lockColor: number, key: string) => {
      const g = this.add.graphics();
      // Body
      g.fillStyle(color);
      g.fillRoundedRect(2, 8, 28, 20, 3);
      // Lid
      g.fillStyle(lerpColor(color, 0xffffff, 0.2));
      g.fillRoundedRect(2, 8, 28, 8, 3);
      // Bands
      g.fillStyle(lerpColor(color, 0x000000, 0.3));
      g.fillRect(2, 15, 28, 2);
      g.fillRect(14, 8, 2, 20);
      // Lock
      g.fillStyle(lockColor);
      g.fillCircle(16, 20, 3);
      g.generateTexture(key, S, S);
      g.destroy();
    };

    makeChest(0x5d4037, 0xffa726, "chest_wooden");
    makeChest(0x546e7a, 0xeceff1, "chest_iron");
    makeChest(0xf9a825, 0xffffff, "chest_golden");

    // Open chest
    const open = this.add.graphics();
    open.fillStyle(0x3e2723);
    open.fillRoundedRect(2, 14, 28, 14, 3);
    open.fillStyle(0x3e2723);
    open.fillRoundedRect(2, 4, 28, 12, 3);
    // Open lid (tilted up)
    open.fillStyle(0x5d4037);
    open.fillRoundedRect(3, 4, 26, 10, 3);
    // Dark interior
    open.fillStyle(0x111111);
    open.fillRect(4, 16, 24, 10);
    open.generateTexture("chest_open", S, S);
    open.destroy();
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

  private createFogBrush() {
    const r = FOG_RADIUS * TILE_SIZE;
    const size = r * 2;
    const g = this.add.graphics();

    for (let i = r; i >= 0; i--) {
      const alpha = 1.0 - i / r;
      g.fillStyle(0xffffff, alpha * alpha);
      g.fillCircle(r, r, i);
    }

    g.generateTexture("fog_brush", size, size);
    g.destroy();

    const sq = this.add.graphics();
    sq.fillStyle(0x000000, 1);
    sq.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    sq.generateTexture("fog_tile", TILE_SIZE, TILE_SIZE);
    sq.destroy();
  }

  // ── Torch glow ────────────────────────────────────────────────────────────

  private createTorchGlow() {
    const r = 128;
    const size = r * 2;
    const g = this.add.graphics();

    for (let i = r; i >= 0; i--) {
      const t = 1.0 - i / r;
      const alpha = t * t * 0.18;
      const color =
        t < 0.4
          ? lerpColor(0x1a0800, 0xcc4400, t / 0.4)
          : lerpColor(0xcc4400, 0xffcc44, (t - 0.4) / 0.6);
      g.fillStyle(color, alpha);
      g.fillCircle(r, r, i);
    }

    g.generateTexture("torch_glow", size, size);
    g.destroy();
  }

  // ── Spell glow textures ────────────────────────────────────────────────────

  private createSpellGlows() {
    const size = 16;
    const r = 7;

    // White orb (magic missile)
    const mm = this.add.graphics();
    for (let i = r; i >= 0; i--) {
      const t = 1 - i / r;
      mm.fillStyle(lerpColor(0xffffff, 0xaaddff, t), 0.9 - t * 0.4);
      mm.fillCircle(r, r, i);
    }
    mm.generateTexture("spell_missile", size, size);
    mm.destroy();

    // Orange circle (fireball)
    const fb = this.add.graphics();
    for (let i = r; i >= 0; i--) {
      const t = 1 - i / r;
      fb.fillStyle(lerpColor(0xffcc00, 0xff2200, t), 0.9 - t * 0.4);
      fb.fillCircle(r, r, i);
    }
    fb.generateTexture("spell_fireball", size, size);
    fb.destroy();

    // Blue bolt (frost)
    const fros = this.add.graphics();
    for (let i = r; i >= 0; i--) {
      const t = 1 - i / r;
      fros.fillStyle(lerpColor(0xffffff, 0x0044ff, t), 0.9 - t * 0.4);
      fros.fillCircle(r, r, i);
    }
    fros.generateTexture("spell_frost", size, size);
    fros.destroy();

    // Purple (blink / divine)
    const blink = this.add.graphics();
    for (let i = r; i >= 0; i--) {
      const t = 1 - i / r;
      blink.fillStyle(lerpColor(0xffffff, 0x9900ff, t), 0.9 - t * 0.4);
      blink.fillCircle(r, r, i);
    }
    blink.generateTexture("spell_blink", size, size);
    blink.destroy();

    // Yellow/gold (bless/heal)
    const heal = this.add.graphics();
    for (let i = r; i >= 0; i--) {
      const t = 1 - i / r;
      heal.fillStyle(lerpColor(0xffffff, 0xffd700, t), 0.9 - t * 0.4);
      heal.fillCircle(r, r, i);
    }
    heal.generateTexture("spell_heal", size, size);
    heal.destroy();
  }
}
