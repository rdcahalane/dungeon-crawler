import * as Phaser from "phaser";
import { TILE_SIZE, COLORS, TILE } from "../constants";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  create() {
    this.createTextures();
    this.scene.start("MainMenuScene");
  }

  private createTextures() {
    // --- Floor tile ---
    const floor = this.add.graphics();
    floor.fillStyle(COLORS.FLOOR);
    floor.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    floor.fillStyle(COLORS.FLOOR_ALT, 0.5);
    floor.fillRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
    floor.generateTexture("floor", TILE_SIZE, TILE_SIZE);
    floor.destroy();

    // --- Wall tile ---
    const wall = this.add.graphics();
    wall.fillStyle(COLORS.WALL);
    wall.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    wall.fillStyle(COLORS.WALL_EDGE, 0.8);
    wall.fillRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
    wall.generateTexture("wall", TILE_SIZE, TILE_SIZE);
    wall.destroy();

    // --- Stairs tile ---
    const stairs = this.add.graphics();
    stairs.fillStyle(COLORS.FLOOR);
    stairs.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    stairs.fillStyle(COLORS.STAIRS, 0.9);
    stairs.fillTriangle(
      TILE_SIZE / 2, 4,
      TILE_SIZE - 4, TILE_SIZE - 4,
      4, TILE_SIZE - 4
    );
    stairs.generateTexture("stairs", TILE_SIZE, TILE_SIZE);
    stairs.destroy();

    // --- Player sprite ---
    const player = this.add.graphics();
    player.fillStyle(COLORS.PLAYER);
    player.fillRoundedRect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);
    // Eyes
    player.fillStyle(0xffffff);
    player.fillCircle(TILE_SIZE / 2 - 5, TILE_SIZE / 2 - 2, 3);
    player.fillCircle(TILE_SIZE / 2 + 5, TILE_SIZE / 2 - 2, 3);
    player.generateTexture("player", TILE_SIZE, TILE_SIZE);
    player.destroy();

    // --- Enemy sprite (generic — tinted per type) ---
    const enemy = this.add.graphics();
    enemy.fillStyle(0xffffff);
    enemy.fillRoundedRect(3, 3, TILE_SIZE - 6, TILE_SIZE - 6, 3);
    // Eyes
    enemy.fillStyle(0x000000);
    enemy.fillCircle(TILE_SIZE / 2 - 5, TILE_SIZE / 2 - 2, 3);
    enemy.fillCircle(TILE_SIZE / 2 + 5, TILE_SIZE / 2 - 2, 3);
    enemy.generateTexture("enemy", TILE_SIZE, TILE_SIZE);
    enemy.destroy();

    // --- Items ---
    const tileTypes = [
      { key: "item_health_potion", color: COLORS.HEALTH_POTION },
      { key: "item_weapon", color: COLORS.WEAPON },
      { key: "item_armor", color: COLORS.ARMOR },
      { key: "item_xp_orb", color: COLORS.XP_ORB },
    ];

    for (const t of tileTypes) {
      const g = this.add.graphics();
      g.fillStyle(t.color);
      g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, 8);
      g.generateTexture(t.key, TILE_SIZE, TILE_SIZE);
      g.destroy();
    }
  }
}
