import * as Phaser from "phaser";
import { TILE_SIZE, COLORS, TILE, FOG_RADIUS } from "../constants";

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
    this.createStairsTexture();
    this.createPlayerTexture();
    this.createEnemyTexture();
    this.createItemTextures();
    this.createFogBrush();
    this.createTorchGlow();
  }

  // ── Cobblestone floor ──────────────────────────────────────────────────────

  private createFloorTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Grout base
    g.fillStyle(0x18181f);
    g.fillRect(0, 0, S, S);

    // Four cobblestones in a 2×2 grid
    const stones = [
      { x: 2, y: 2, w: 13, h: 12, c: 0x2e2e3a },
      { x: 17, y: 2, w: 13, h: 12, c: 0x28282e },
      { x: 2, y: 17, w: 13, h: 12, c: 0x2a2a36 },
      { x: 17, y: 17, w: 12, h: 12, c: 0x2c2c38 },
    ];

    for (const s of stones) {
      // Drop shadow
      g.fillStyle(0x0f0f14);
      g.fillRoundedRect(s.x + 1, s.y + 1, s.w, s.h, 2);
      // Stone body
      g.fillStyle(s.c);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 2);
      // Top-left highlight
      g.fillStyle(0x3c3c4a, 0.5);
      g.fillRoundedRect(s.x, s.y, Math.floor(s.w * 0.55), Math.floor(s.h * 0.45), 2);
      // Micro noise
      g.fillStyle(0x222230, 0.7);
      g.fillRect(s.x + 4, s.y + 6, 1, 1);
      g.fillRect(s.x + 9, s.y + 3, 1, 1);
    }

    g.generateTexture("floor", S, S);
    g.destroy();
  }

  // ── Stone brick wall ──────────────────────────────────────────────────────

  private createWallTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Mortar base
    g.fillStyle(0x1a1a26);
    g.fillRect(0, 0, S, S);

    // Row A (y: 1–12): two bricks side by side
    const rowA = [
      { x: 1, y: 1, w: 13, h: 11 },
      { x: 16, y: 1, w: 15, h: 11 },
    ];
    // Row B (y: 14–25): three bricks (offset for bonding pattern)
    const rowB = [
      { x: 1, y: 14, w: 8, h: 11 },
      { x: 11, y: 14, w: 10, h: 11 },
      { x: 23, y: 14, w: 8, h: 11 },
    ];
    // Row C partial (y: 27–31): bottom edge
    const rowC = [
      { x: 1, y: 27, w: 13, h: 4 },
      { x: 16, y: 27, w: 15, h: 4 },
    ];

    for (const row of [rowA, rowB, rowC]) {
      for (const b of row) {
        // Brick face
        g.fillStyle(0x36364a);
        g.fillRect(b.x, b.y, b.w, b.h);
        // Top highlight
        g.fillStyle(0x4a4a5e, 0.7);
        g.fillRect(b.x, b.y, b.w, 1);
        // Left highlight
        g.fillStyle(0x44445a, 0.5);
        g.fillRect(b.x, b.y, 1, b.h);
        // Bottom shadow
        g.fillStyle(0x26263a, 0.8);
        g.fillRect(b.x, b.y + b.h - 1, b.w, 1);
        // Right shadow
        g.fillStyle(0x26263a, 0.6);
        g.fillRect(b.x + b.w - 1, b.y, 1, b.h);
        // Surface variation dots
        g.fillStyle(0x2e2e40, 0.5);
        g.fillRect(b.x + 3, b.y + 3, 1, 1);
        g.fillRect(b.x + b.w - 4, b.y + b.h - 3, 1, 1);
      }
    }

    g.generateTexture("wall", S, S);
    g.destroy();
  }

  // ── Stairs ─────────────────────────────────────────────────────────────────

  private createStairsTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Floor base
    g.fillStyle(0x1e1e28);
    g.fillRect(0, 0, S, S);

    // Staircase steps (descending)
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
      // Step face
      g.fillStyle(stepColor);
      g.fillRect(s.x, s.y, s.w, s.h);
      // Top edge highlight
      g.fillStyle(0xffee88, 0.6);
      g.fillRect(s.x, s.y, s.w, 1);
      // Bottom shadow
      g.fillStyle(0x664400, 0.5);
      g.fillRect(s.x, s.y + s.h - 1, s.w, 1);
    }

    // Glow hint at bottom step
    g.fillStyle(0xffd700, 0.15);
    g.fillRect(2, 26, 28, 6);

    g.generateTexture("stairs", S, S);
    g.destroy();
  }

  // ── Player (armoured hero) ────────────────────────────────────────────────

  private createPlayerTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Body armour
    g.fillStyle(0x1a4a6b);
    g.fillRoundedRect(7, 10, 18, 18, 4);
    // Armour chest highlight
    g.fillStyle(0x4fc3f7, 0.4);
    g.fillRoundedRect(7, 10, 10, 8, 4);
    // Shoulder pads
    g.fillStyle(0x246090);
    g.fillRect(5, 11, 4, 6);
    g.fillRect(23, 11, 4, 6);
    // Helmet
    g.fillStyle(0x2060a0);
    g.fillCircle(16, 8, 7);
    // Visor
    g.fillStyle(0x00e5ff, 0.85);
    g.fillRoundedRect(10, 5, 12, 4, 1);
    // Eyes
    g.fillStyle(0xffffff);
    g.fillCircle(13, 7, 1.5);
    g.fillCircle(19, 7, 1.5);

    g.generateTexture("player", S, S);
    g.destroy();
  }

  // ── Enemy (menacing silhouette) ───────────────────────────────────────────

  private createEnemyTexture() {
    const S = TILE_SIZE;
    const g = this.add.graphics();

    // Body
    g.fillStyle(0xffffff);
    g.fillRoundedRect(4, 6, 24, 22, 4);
    // Head bumps (horns)
    g.fillTriangle(8, 7, 13, 7, 10, 1);
    g.fillTriangle(19, 7, 24, 7, 22, 1);
    // Eye sockets
    g.fillStyle(0x000000);
    g.fillCircle(11, 14, 5);
    g.fillCircle(21, 14, 5);
    // Pupils (white — tint will colour these)
    g.fillStyle(0xffffff);
    g.fillCircle(11, 14, 3);
    g.fillCircle(21, 14, 3);
    // Mouth
    g.fillStyle(0x000000);
    g.fillRect(9, 22, 14, 3);
    // Teeth
    g.fillStyle(0xffffff);
    g.fillRect(10, 22, 2, 2);
    g.fillRect(14, 22, 2, 2);
    g.fillRect(18, 22, 2, 2);

    g.generateTexture("enemy", S, S);
    g.destroy();
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private createItemTextures() {
    const S = TILE_SIZE;

    // Health potion — red bottle
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
    wp.fillRect(15, 4, 2, 20);         // blade
    wp.fillStyle(0xffd700);
    wp.fillRect(10, 18, 12, 3);        // crossguard
    wp.fillStyle(0x8b4513);
    wp.fillRect(14, 21, 4, 8);         // grip
    wp.fillStyle(0xffffff, 0.5);
    wp.fillRect(15, 4, 1, 14);         // blade edge glint
    wp.generateTexture("item_weapon", S, S);
    wp.destroy();

    // Armor — shield
    const ar = this.add.graphics();
    ar.fillStyle(0x4a4a6a);
    ar.fillRoundedRect(8, 5, 16, 22, 4);
    ar.fillStyle(0x6666aa);
    ar.fillRoundedRect(9, 6, 14, 16, 3);
    ar.fillStyle(0xaaaaff, 0.4);
    ar.fillRoundedRect(10, 7, 6, 8, 2); // highlight
    ar.fillStyle(0xffd700);
    ar.fillRect(15, 10, 2, 10);          // cross
    ar.fillRect(11, 14, 10, 2);
    ar.generateTexture("item_armor", S, S);
    ar.destroy();

    // XP orb — glowing sphere
    const xp = this.add.graphics();
    for (let i = 8; i >= 1; i--) {
      const t = i / 8;
      const c = lerpColor(0xffffff, 0xab47bc, t);
      xp.fillStyle(c, 0.9 - t * 0.3);
      xp.fillCircle(16, 16, i + 2);
    }
    xp.fillStyle(0xffffff, 0.8);
    xp.fillCircle(13, 13, 2);          // specular
    xp.generateTexture("item_xp_orb", S, S);
    xp.destroy();
  }

  // ── Fog of war brush (soft radial erase) ─────────────────────────────────

  private createFogBrush() {
    const r = FOG_RADIUS * TILE_SIZE; // 160px
    const size = r * 2;               // 320px
    const g = this.add.graphics();

    // Draw concentric rings from outside-in — builds a soft radial gradient
    for (let i = r; i >= 0; i--) {
      const alpha = 1.0 - i / r; // 0 at edge → 1 at center
      g.fillStyle(0xffffff, alpha * alpha); // quadratic falloff = softer edge
      g.fillCircle(r, r, i);
    }

    g.generateTexture("fog_brush", size, size);
    g.destroy();

    // Solid tile square for "re-darkening" explored areas
    const sq = this.add.graphics();
    sq.fillStyle(0x000000, 1);
    sq.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    sq.generateTexture("fog_tile", TILE_SIZE, TILE_SIZE);
    sq.destroy();
  }

  // ── Torch glow (warm additive overlay) ───────────────────────────────────

  private createTorchGlow() {
    const r = 128; // px
    const size = r * 2;
    const g = this.add.graphics();

    for (let i = r; i >= 0; i--) {
      const t = 1.0 - i / r;              // 0=edge, 1=center
      const alpha = t * t * 0.18;         // quadratic, max 18% per ring
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
}
