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

  // ── FIGHTER — Steel armour, red tunic, sword ──────────────────────────────
  private createFighterAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Sword blade (behind body)
    g.fillStyle(0xd0d8e0); // silver
    g.fillRect(24, 4, 4, 20);
    g.fillStyle(0xffd700); // gold crossguard
    g.fillRect(21, 16, 10, 3);
    g.fillStyle(0x6b3a1e); // leather grip
    g.fillRect(25, 19, 2, 6);

    // Pauldrons (shoulder armour)
    g.fillStyle(0x7080a0); // steel shadow
    g.fillRect(2, 11, 7, 9);
    g.fillRect(21, 11, 7, 9);
    g.fillStyle(0x90a8c0); // steel highlight
    g.fillRect(2, 11, 7, 4);
    g.fillRect(21, 11, 7, 4);

    // Chest plate
    g.fillStyle(0x7888a0); // steel base
    g.fillRoundedRect(7, 14, 18, 15, 2);
    g.fillStyle(0xcc2200); // red tunic showing at bottom
    g.fillRect(8, 24, 16, 5);
    // Chest highlight
    g.fillStyle(0xa0b4cc);
    g.fillRect(8, 15, 16, 4);
    // Chest rivets
    g.fillStyle(0xd0d8e0);
    g.fillRect(10, 20, 2, 2);
    g.fillRect(20, 20, 2, 2);
    // Belt
    g.fillStyle(0x4a3010);
    g.fillRect(7, 23, 18, 3);
    g.fillStyle(0xffd700);
    g.fillRect(14, 23, 4, 3); // buckle

    // Neck
    g.fillStyle(0xffddbb); // skin
    g.fillRect(13, 12, 6, 4);

    // Helmet — full steel with face guard
    g.fillStyle(0x7080a0);
    g.fillCircle(16, 7, 8);
    g.fillRect(8, 7, 16, 6);
    // Helmet highlight
    g.fillStyle(0xa0b4cc);
    g.fillRect(10, 3, 8, 4);
    // Cheek guards
    g.fillStyle(0x5868806);
    g.fillRect(8, 7, 5, 6);
    g.fillRect(19, 7, 5, 6);
    // Visor slit
    g.fillStyle(0x1a2030);
    g.fillRect(11, 7, 10, 3);
    // Eye gleam through visor
    g.fillStyle(0x80c8ff, 0.7);
    g.fillRect(12, 8, 4, 1);
    g.fillRect(17, 8, 4, 1);
    // Helmet ridge
    g.fillStyle(0xd0d8e0);
    g.fillRect(15, 1, 2, 7);

    g.generateTexture("player_fighter", S, S);
    g.destroy();
  }

  // ── THIEF — Dark leather, green cloak, gleaming eyes ──────────────────────
  private createThiefAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Cloak (dark forest green, behind body)
    g.fillStyle(0x1e3a12); // deep green
    g.fillTriangle(4, 16, 12, 16, 4, 31);   // left wing
    g.fillTriangle(28, 16, 20, 16, 28, 31); // right wing
    g.fillStyle(0x152a0c); // cloak shadow
    g.fillTriangle(5, 18, 12, 18, 5, 31);
    g.fillTriangle(27, 18, 20, 18, 27, 31);

    // Dagger on left hip
    g.fillStyle(0xc8d0d8); // blade
    g.fillRect(3, 20, 2, 9);
    g.fillStyle(0xffd700);
    g.fillRect(1, 22, 6, 2); // guard
    g.fillStyle(0x3a2010);
    g.fillRect(3, 24, 2, 4); // grip

    // Slim leather body
    g.fillStyle(0x3a2810); // dark brown leather
    g.fillRoundedRect(10, 15, 12, 15, 2);
    // Leather highlight
    g.fillStyle(0x5a4020);
    g.fillRect(11, 16, 5, 6);
    // Belt
    g.fillStyle(0x2a1a08);
    g.fillRect(10, 22, 12, 3);
    g.fillStyle(0xc8a060);
    g.fillRect(14, 22, 4, 3); // buckle

    // Hood — dark charcoal
    g.fillStyle(0x1a1a1a); // very dark
    g.fillTriangle(16, 0, 8, 11, 24, 11); // pointed hood
    g.fillCircle(16, 11, 7); // head in hood
    // Hood shadow/depth
    g.fillStyle(0x111111);
    g.fillTriangle(16, 1, 9, 10, 16, 10);

    // Face in shadow — only partial skin visible
    g.fillStyle(0xd4a070); // warm skin in shadow
    g.fillRect(12, 9, 8, 5);
    // Lower face shadow
    g.fillStyle(0x1a1a1a, 0.6);
    g.fillRect(11, 11, 10, 3);

    // Glowing eyes — the signature thief look
    g.fillStyle(0x00ffcc); // teal glow
    g.fillCircle(13, 10, 2);
    g.fillCircle(19, 10, 2);
    g.fillStyle(0xffffff);
    g.fillCircle(13, 10, 1);
    g.fillCircle(19, 10, 1);

    g.generateTexture("player_thief", S, S);
    g.destroy();
  }

  // ── WIZARD — Deep blue robes, purple hat, glowing staff ───────────────────
  private createWizardAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Staff (behind body)
    g.fillStyle(0x6b4c2a); // dark wood
    g.fillRect(24, 3, 3, 26);
    g.fillStyle(0x8b6c3a); // wood highlight
    g.fillRect(24, 3, 1, 26);
    // Staff orb — glowing cyan
    for (let i = 5; i >= 1; i--) {
      const alpha = (6 - i) * 0.15;
      g.fillStyle(0x00e8ff, alpha);
      g.fillCircle(25, 3, i + 1);
    }
    g.fillStyle(0x00e8ff);
    g.fillCircle(25, 3, 4);
    g.fillStyle(0xffffff);
    g.fillCircle(24, 2, 1.5); // specular

    // Wide robe base
    g.fillStyle(0x1a0880); // deep navy blue
    g.fillTriangle(8, 18, 24, 18, 4, 32);  // left robe
    g.fillTriangle(24, 18, 8, 18, 28, 32); // right robe
    g.fillRoundedRect(10, 16, 12, 14, 1);  // torso

    // Robe highlights
    g.fillStyle(0x2a14a0);
    g.fillRect(11, 17, 5, 10); // left panel lighter
    // Belt/sash
    g.fillStyle(0xffd700);
    g.fillRect(10, 23, 12, 2);
    // Robe trim
    g.fillStyle(0x8844cc);
    g.fillRect(10, 16, 12, 2);

    // Star rune on chest
    g.fillStyle(0xffd700, 0.8);
    g.fillRect(15, 19, 2, 6);
    g.fillRect(12, 22, 8, 2);
    g.fillCircle(16, 22, 1.5);

    // Neck
    g.fillStyle(0xeeddcc); // pale skin
    g.fillRect(13, 12, 6, 5);

    // Wizard hat — deep purple with gold band
    g.fillStyle(0x5500aa); // purple
    g.fillTriangle(16, 0, 8, 13, 24, 13); // cone
    g.fillStyle(0x6600cc); // lighter purple side
    g.fillTriangle(16, 0, 16, 13, 24, 13);
    g.fillStyle(0x3300664); // shadow side
    g.fillTriangle(16, 0, 8, 13, 16, 13);
    // Hat brim
    g.fillStyle(0x4400884);
    g.fillRect(6, 12, 20, 4);
    // Gold hat band
    g.fillStyle(0xffd700);
    g.fillRect(7, 14, 18, 2);
    // Star on hat
    g.fillStyle(0xffe066, 0.9);
    g.fillCircle(16, 7, 2);
    g.fillRect(15, 4, 2, 6);
    g.fillRect(12, 7, 8, 2);

    // Face — narrow, pale, wise
    g.fillStyle(0xeeddcc);
    g.fillCircle(16, 17, 5);
    // Eyes
    g.fillStyle(0x2244aa); // blue eyes
    g.fillCircle(14, 16, 1.5);
    g.fillCircle(18, 16, 1.5);
    g.fillStyle(0xffffff);
    g.fillCircle(14, 16, 0.8);
    g.fillCircle(18, 16, 0.8);
    // Eyebrows
    g.fillStyle(0x888888);
    g.fillRect(12, 14, 4, 1);
    g.fillRect(16, 14, 4, 1);
    // Short beard hint
    g.fillStyle(0xcccccc, 0.6);
    g.fillRect(13, 19, 6, 2);

    g.generateTexture("player_wizard", S, S);
    g.destroy();
  }

  // ── CLERIC — Ivory robes, golden cross, holy mace ─────────────────────────
  private createClericAvatar() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Mace (behind body)
    g.fillStyle(0x6b4c2a); // wood handle
    g.fillRect(23, 10, 3, 18);
    g.fillStyle(0x8b6c3a);
    g.fillRect(23, 10, 1, 18); // highlight
    // Mace head — gold flanged
    g.fillStyle(0xcc9900);
    g.fillRoundedRect(20, 6, 9, 8, 2);
    g.fillStyle(0xffd700); // bright top
    g.fillRect(21, 6, 7, 3);
    // Flanges
    g.fillStyle(0xddaa00);
    g.fillRect(19, 7, 3, 5);
    g.fillRect(28, 7, 3, 5);

    // Wide shoulder cowl
    g.fillStyle(0xd0c8a8); // warm ivory
    g.fillRect(4, 13, 8, 9);   // left shoulder
    g.fillRect(20, 13, 8, 9);  // right shoulder
    g.fillStyle(0xe0d8b8); // highlight
    g.fillRect(4, 13, 8, 3);
    g.fillRect(20, 13, 8, 3);

    // Robe body
    g.fillStyle(0xe8e0cc); // ivory
    g.fillRoundedRect(8, 14, 16, 17, 2);
    // Robe shadow/fold
    g.fillStyle(0xd0c8b0);
    g.fillRect(18, 15, 5, 14); // right fold shadow
    // Gold trim on robe bottom
    g.fillStyle(0xffd700);
    g.fillRect(8, 28, 16, 2);
    g.fillRect(8, 14, 16, 2); // collar gold
    // Robe highlight
    g.fillStyle(0xf8f0dc);
    g.fillRect(9, 16, 6, 10);

    // Big golden cross on chest
    g.fillStyle(0xffd700);
    g.fillRect(15, 15, 3, 12); // vertical
    g.fillRect(10, 19, 12, 3); // horizontal
    // Cross highlight
    g.fillStyle(0xffee88);
    g.fillRect(15, 15, 1, 12);
    g.fillRect(10, 19, 12, 1);

    // Neck
    g.fillStyle(0xffddbb);
    g.fillRect(13, 11, 6, 5);

    // Cleric hood/cowl — cream with gold trim
    g.fillStyle(0xd8d0b0); // warm hood
    g.fillCircle(16, 8, 8);
    g.fillRect(8, 8, 16, 6);
    // Hood gold trim
    g.fillStyle(0xffd700);
    g.fillRect(8, 13, 16, 2);
    // Hood shadow (depth)
    g.fillStyle(0xb8b098);
    g.fillRect(8, 9, 4, 5);
    g.fillRect(20, 9, 4, 5);

    // Face — warm skin, noble expression
    g.fillStyle(0xffddbb);
    g.fillCircle(16, 9, 5);
    // Eyes — warm brown
    g.fillStyle(0x663300);
    g.fillCircle(14, 8, 1.5);
    g.fillCircle(18, 8, 1.5);
    g.fillStyle(0xffffff);
    g.fillCircle(14, 8, 0.7);
    g.fillCircle(18, 8, 0.7);
    // Brow line
    g.fillStyle(0x8b6030);
    g.fillRect(12, 6, 4, 1);
    g.fillRect(16, 6, 4, 1);
    // Serene smile
    g.fillStyle(0xdd9966);
    g.fillRect(14, 11, 4, 1);

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
