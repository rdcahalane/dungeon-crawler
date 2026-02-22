import * as Phaser from "phaser";
import { TILE_SIZE, TILE, COLORS, MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS } from "../constants";
import { generateDungeon, DungeonData } from "../systems/DungeonGenerator";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";

interface FloatingText {
  obj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
}

export class GameScene extends Phaser.Scene {
  private dungeon!: DungeonData;
  private player!: Player;
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private items: Phaser.GameObjects.Sprite[] = [];
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private currentFloor = 1;
  private floatingTexts: FloatingText[] = [];

  // Fog of war
  private fogRT!: Phaser.GameObjects.RenderTexture;
  private fogBrushImg!: Phaser.GameObjects.Image;
  private fogState!: Uint8Array; // 0=unseen, 1=explored
  private lastFogTile = { tx: -1, ty: -1 };

  // Torch glow
  private torchInner!: Phaser.GameObjects.Image;
  private torchOuter!: Phaser.GameObjects.Image;

  // UI elements (scrollFactor 0 — fixed to screen)
  private hpText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private xpBar!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private floorText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private kills = 0;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { floor?: number }) {
    this.currentFloor = data?.floor ?? 1;
    this.kills = 0;
  }

  create() {
    this.dungeon = generateDungeon(this.currentFloor);

    // Set physics world to the full map size BEFORE spawning anything
    this.physics.world.setBounds(
      0, 0,
      MAP_WIDTH * TILE_SIZE,
      MAP_HEIGHT * TILE_SIZE
    );

    this.buildTilemap();
    this.spawnPlayer();
    this.spawnTorchGlow();
    this.spawnEnemies();
    this.spawnItems();
    this.initFog();
    this.setupCamera();
    this.createUI();
    this.repositionUI(1);
    this.updateUI();
  }

  // ── Tilemap ──────────────────────────────────────────────────────────────

  private buildTilemap() {
    const { tiles } = this.dungeon;

    this.wallGroup = this.physics.add.staticGroup();

    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const t = tiles[ty][tx];
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        if (t === TILE.WALL) {
          this.add.image(wx, wy, "wall").setDepth(1);
          // Use a rectangle as the physics body (much lighter than staticImage)
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true); // true = static
          this.wallGroup.add(rect);
        } else if (t === TILE.STAIRS) {
          this.add.image(wx, wy, "floor").setDepth(1);
          this.add.image(wx, wy, "stairs").setDepth(2);
        } else {
          this.add.image(wx, wy, "floor").setDepth(1);
        }
      }
    }
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private spawnPlayer() {
    const { tx, ty } = this.dungeon.playerStart;
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;

    this.player = new Player(this, px, py);
    this.player.setCallbacks({
      onDamage: (dmg) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `-${dmg}`, COLORS.DAMAGE_TEXT);
        this.updateUI();
        this.cameras.main.shake(80, 0.005);
      },
      onHeal: (amount) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `+${amount}`, COLORS.HEAL_TEXT);
        this.updateUI();
      },
      onDead: () => this.handlePlayerDeath(),
      onXP: (gained) => {
        this.spawnFloatingText(this.player.x, this.player.y - 30, `+${gained} XP`, COLORS.XP_TEXT, 12);
        this.updateUI();
      },
      onLevelUp: (level) => {
        this.spawnFloatingText(this.player.x, this.player.y - 50, `LEVEL UP! ${level}`, 0xffd700, 18);
        this.cameras.main.flash(200, 80, 80, 20);
        this.updateUI();
      },
    });

    this.physics.add.collider(this.player, this.wallGroup);
  }

  // ── Enemies ──────────────────────────────────────────────────────────────

  private spawnEnemies() {
    this.enemyGroup = this.physics.add.group();

    for (const spawn of this.dungeon.enemies) {
      const ex = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const ey = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const enemy = new Enemy(this, ex, ey, spawn.type);
      this.enemies.push(enemy);
      this.enemyGroup.add(enemy);
      this.physics.add.collider(enemy, this.wallGroup);
    }

    // Player ↔ enemies: solid collision (no walking through)
    this.physics.add.collider(this.player, this.enemyGroup);
    // Enemies ↔ enemies: stop them stacking on each other
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private spawnItems() {
    for (const spawn of this.dungeon.items) {
      const ix = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const iy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const textureKey = `item_${spawn.type.toLowerCase()}`;
      const sprite = this.add.sprite(ix, iy, textureKey).setDepth(3);
      (sprite as Phaser.GameObjects.Sprite & { itemType: string }).itemType = spawn.type;
      this.items.push(sprite);

      // Gentle float animation
      this.tweens.add({
        targets: sprite,
        y: iy - 5,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  // ── Torch glow ────────────────────────────────────────────────────────────

  private spawnTorchGlow() {
    const px = this.player.x;
    const py = this.player.y;

    this.torchOuter = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(2.8)
      .setAlpha(0.35)
      .setDepth(47);

    this.torchInner = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.6)
      .setAlpha(0.55)
      .setDepth(48);
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

  private initFog() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;

    this.fogState = new Uint8Array(MAP_WIDTH * MAP_HEIGHT); // all 0 = unseen

    // Black fog overlay covering the whole map
    // setOrigin(0,0) is critical — default (0.5,0.5) would only cover one quadrant
    this.fogRT = this.add.renderTexture(0, 0, totalW, totalH);
    this.fogRT.setOrigin(0, 0);
    this.fogRT.fill(0x000000, 1);
    this.fogRT.setDepth(50);

    // Reusable brush image (not added to scene display list)
    const brushSize = FOG_RADIUS * TILE_SIZE * 2;
    this.fogBrushImg = this.add.image(0, 0, "fog_brush")
      .setOrigin(0, 0)  // top-left anchored so erase coords align with world position
      .setDisplaySize(brushSize, brushSize)
      .setVisible(false);

    // Reveal starting area immediately
    const { tx, ty } = this.dungeon.playerStart;
    this.revealFog(tx, ty);
    this.lastFogTile = { tx, ty };
  }

  private revealFog(ptx: number, pty: number) {
    const r = FOG_RADIUS;
    const brushRadius = r * TILE_SIZE;

    // Mark tiles in radius as explored
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) continue;
        this.fogState[ty * MAP_WIDTH + tx] = 1;
      }
    }

    // Erase fog permanently at this position using the soft brush
    const bx = ptx * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    const by = pty * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    this.fogRT.erase(this.fogBrushImg, bx, by);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private setupCamera() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // Scroll wheel zoom
    this.input.on(
      "wheel",
      (_ptr: unknown, _objs: unknown, _dx: number, deltaY: number) => {
        this.adjustZoom(-deltaY * 0.001);
      }
    );

    // Keyboard zoom: = / + to zoom in, - to zoom out
    this.input.keyboard!.on("keydown-PLUS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-EQUALS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-MINUS", () => this.adjustZoom(-0.1));
  }

  private adjustZoom(delta: number) {
    const next = Phaser.Math.Clamp(this.cameras.main.zoom + delta, 0.4, 2.5);
    this.cameras.main.setZoom(next);
    if (this.zoomLabel) this.zoomLabel.setText(`${Math.round(next * 100)}%`);
    this.repositionUI(next);
  }

  private zoomLabel!: Phaser.GameObjects.Text;
  private zoomMinusBg!: Phaser.GameObjects.Rectangle;
  private zoomPlusBg!: Phaser.GameObjects.Rectangle;
  private zoomMinusBorder!: Phaser.GameObjects.Rectangle;
  private zoomPlusBorder!: Phaser.GameObjects.Rectangle;
  private zoomMinusText!: Phaser.GameObjects.Text;
  private zoomPlusText!: Phaser.GameObjects.Text;

  // ── UI ────────────────────────────────────────────────────────────────────

  private createUI() {
    const W = this.scale.width;
    const H = this.scale.height;
    const BAR_W = 200;
    const BAR_H = 12;
    const PAD = 12;
    const BTN = 26;

    // All UI elements use setScrollFactor(0).
    // adjustZoom() calls repositionUI() to counteract zoom on position and scale.

    this.hpBar = this.add
      .rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 2.5, BAR_W, BAR_H, COLORS.HP_BAR_BG)
      .setScrollFactor(0).setDepth(100);
    this.hpBarFill = this.add
      .rectangle(PAD, H - PAD - BAR_H * 2.5, BAR_W, BAR_H, COLORS.HP_BAR)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);

    this.xpBar = this.add
      .rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 0.5, BAR_W, BAR_H * 0.7, COLORS.HP_BAR_BG)
      .setScrollFactor(0).setDepth(100);
    this.xpBarFill = this.add
      .rectangle(PAD, H - PAD - BAR_H * 0.5, BAR_W, BAR_H * 0.7, COLORS.XP_BAR)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);

    this.hpText = this.add
      .text(PAD + BAR_W + 8, H - PAD - BAR_H * 2.5, "", { fontSize: "12px", color: "#ffffff", fontFamily: "monospace" })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(102);

    this.levelText = this.add
      .text(PAD, H - PAD - BAR_H * 4, "", { fontSize: "12px", color: "#aaaaaa", fontFamily: "monospace" })
      .setScrollFactor(0).setDepth(102);

    this.floorText = this.add
      .text(W - PAD, PAD, "", { fontSize: "14px", color: "#ffd700", fontFamily: "monospace" })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(102);

    this.killsText = this.add
      .text(W - PAD, PAD + 22, "", { fontSize: "12px", color: "#aaaaaa", fontFamily: "monospace" })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(102);

    this.statusText = this.add
      .text(W / 2, H * 0.15, "", { fontSize: "14px", color: "#cccccc", fontFamily: "monospace" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(102);

    // Zoom controls
    this.zoomMinusBg = this.add.rectangle(W - PAD - BTN * 2.4, H - PAD - BTN / 2, BTN, BTN, 0x1a1a2e)
      .setScrollFactor(0).setDepth(110).setInteractive();
    this.zoomMinusBorder = this.add.rectangle(W - PAD - BTN * 2.4, H - PAD - BTN / 2, BTN, BTN)
      .setStrokeStyle(1, 0x444466).setScrollFactor(0).setDepth(111);
    this.zoomMinusText = this.add.text(W - PAD - BTN * 2.4, H - PAD - BTN / 2, "−", { fontSize: "18px", color: "#aaaacc", fontFamily: "monospace" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(112);

    this.zoomPlusBg = this.add.rectangle(W - PAD - BTN * 1.1, H - PAD - BTN / 2, BTN, BTN, 0x1a1a2e)
      .setScrollFactor(0).setDepth(110).setInteractive();
    this.zoomPlusBorder = this.add.rectangle(W - PAD - BTN * 1.1, H - PAD - BTN / 2, BTN, BTN)
      .setStrokeStyle(1, 0x444466).setScrollFactor(0).setDepth(111);
    this.zoomPlusText = this.add.text(W - PAD - BTN * 1.1, H - PAD - BTN / 2, "+", { fontSize: "18px", color: "#aaaacc", fontFamily: "monospace" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(112);

    this.zoomLabel = this.add.text(W - PAD - BTN * 1.75, H - PAD - BTN * 1.6, "100%", { fontSize: "11px", color: "#666688", fontFamily: "monospace" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(112);

    this.zoomMinusBg.on("pointerover", () => this.zoomMinusBg.setFillStyle(0x2a2a4e));
    this.zoomMinusBg.on("pointerout", () => this.zoomMinusBg.setFillStyle(0x1a1a2e));
    this.zoomMinusBg.on("pointerdown", () => this.adjustZoom(-0.15));
    this.zoomPlusBg.on("pointerover", () => this.zoomPlusBg.setFillStyle(0x2a2a4e));
    this.zoomPlusBg.on("pointerout", () => this.zoomPlusBg.setFillStyle(0x1a1a2e));
    this.zoomPlusBg.on("pointerdown", () => this.adjustZoom(0.15));
  }

  // Reposition all HUD elements to stay at fixed screen position regardless of zoom.
  //
  // Phaser zooms scrollFactor(0) objects from the camera's center (W/2, H/2):
  //   screenPos = (worldPos - camCenter) * zoom + camCenter
  // Solving for worldPos given the desired screenPos:
  //   worldPos = (screenPos - camCenter) / zoom + camCenter
  //
  // Scale: the object visually scales by zoom, so set ownScale = 1/zoom to stay constant.
  private repositionUI(zoom: number) {
    if (!this.hpBar) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const BAR_W = 200;
    const BAR_H = 12;
    const PAD = 12;
    const BTN = 26;
    const iz = 1 / zoom;
    const cx = W / 2;
    const cy = H / 2;

    const wx = (sx: number) => (sx - cx) / zoom + cx;
    const wy = (sy: number) => (sy - cy) / zoom + cy;

    this.hpBar.setPosition(wx(PAD + BAR_W / 2), wy(H - PAD - BAR_H * 2.5)).setScale(iz);
    this.hpBarFill.setPosition(wx(PAD), wy(H - PAD - BAR_H * 2.5)).setScale(iz);
    this.xpBar.setPosition(wx(PAD + BAR_W / 2), wy(H - PAD - BAR_H * 0.5)).setScale(iz);
    this.xpBarFill.setPosition(wx(PAD), wy(H - PAD - BAR_H * 0.5)).setScale(iz);
    this.hpText.setPosition(wx(PAD + BAR_W + 8), wy(H - PAD - BAR_H * 2.5)).setScale(iz);
    this.levelText.setPosition(wx(PAD), wy(H - PAD - BAR_H * 4)).setScale(iz);
    this.floorText.setPosition(wx(W - PAD), wy(PAD)).setScale(iz);
    this.killsText.setPosition(wx(W - PAD), wy(PAD + 22)).setScale(iz);
    this.statusText.setPosition(wx(W / 2), wy(H * 0.15)).setScale(iz);
    this.zoomLabel.setPosition(wx(W - PAD - BTN * 1.75), wy(H - PAD - BTN * 1.6)).setScale(iz);
    this.zoomMinusBg.setPosition(wx(W - PAD - BTN * 2.4), wy(H - PAD - BTN / 2)).setScale(iz);
    this.zoomMinusBorder.setPosition(wx(W - PAD - BTN * 2.4), wy(H - PAD - BTN / 2)).setScale(iz);
    this.zoomMinusText.setPosition(wx(W - PAD - BTN * 2.4), wy(H - PAD - BTN / 2)).setScale(iz);
    this.zoomPlusBg.setPosition(wx(W - PAD - BTN * 1.1), wy(H - PAD - BTN / 2)).setScale(iz);
    this.zoomPlusBorder.setPosition(wx(W - PAD - BTN * 1.1), wy(H - PAD - BTN / 2)).setScale(iz);
    this.zoomPlusText.setPosition(wx(W - PAD - BTN * 1.1), wy(H - PAD - BTN / 2)).setScale(iz);
  }

  private updateUI() {
    if (!this.player) return;
    const { hp, maxHp, level, xp, xpToNext } = this.player.stats;
    const BAR_W = 200;
    const zoom = this.cameras.main.zoom;
    const iz = 1 / zoom;

    const hpPct = hp / maxHp;
    // Width scales inversely with zoom since the fill rect also has setScale(iz)
    this.hpBarFill.setDisplaySize(BAR_W * hpPct, 12);
    this.hpBarFill.setFillStyle(hpPct > 0.5 ? COLORS.HP_BAR : hpPct > 0.25 ? 0xffa726 : COLORS.HP_BAR_LOW);
    void iz; // repositionUI handles scale

    const xpPct = xp / xpToNext;
    this.xpBarFill.setDisplaySize(BAR_W * xpPct, 8);

    this.hpText.setText(`${hp}/${maxHp}`);
    this.levelText.setText(`LV ${level}  ATK ${this.player.stats.attack}  DEF ${this.player.stats.defense}`);
    this.floorText.setText(`Floor ${this.currentFloor}`);
    this.killsText.setText(`Kills: ${this.kills}`);
  }

  // ── Update loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (!this.player || this.player.stats.hp <= 0) return;

    this.player.update(delta);

    // Torch glow — follows player with flicker
    const flicker =
      0.5 +
      Math.sin(this.time.now * 0.008) * 0.04 +
      (Math.random() - 0.5) * 0.025;
    this.torchInner.setPosition(this.player.x, this.player.y).setAlpha(flicker);
    this.torchOuter.setPosition(this.player.x, this.player.y).setAlpha(flicker * 0.55);

    // Fog of war — only recalculate on tile change
    const curTx = Math.floor(this.player.x / TILE_SIZE);
    const curTy = Math.floor(this.player.y / TILE_SIZE);
    if (curTx !== this.lastFogTile.tx || curTy !== this.lastFogTile.ty) {
      this.lastFogTile = { tx: curTx, ty: curTy };
      this.revealFog(curTx, curTy);
    }

    // Attack
    if (this.player.tryAttack()) {
      this.handlePlayerAttack();
    }

    // Enemy update + contact damage
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) {
        this.enemies.splice(i, 1);
        continue;
      }
      enemy.update(delta, this.player.x, this.player.y);

      // Enemy attacks player on contact
      if (enemy.canAttackPlayer(this.player.x, this.player.y)) {
        const dmg = enemy.doAttack();
        this.player.takeDamage(dmg);
      }
    }

    // Item pickup
    this.checkItemPickup();

    // Stairs check
    this.checkStairs();

    // Floating texts
    this.updateFloatingTexts(delta);
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private handlePlayerAttack() {
    const attackBox = this.player.getAttackBox();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      const enemyBounds = enemy.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemyBounds)) {
        const dmg = enemy.takeDamage(this.player.stats.attack);
        this.spawnFloatingText(enemy.x, enemy.y - 20, `-${dmg}`, 0xffffff);

        if (enemy.hp <= 0) {
          this.player.gainXP(enemy.xp);
          this.kills++;
          this.updateUI();

          // Death particles
          this.spawnDeathEffect(enemy.x, enemy.y, enemy.typeKey);
          enemy.destroy();
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  private spawnDeathEffect(x: number, y: number, typeKey: string) {
    const color = (COLORS as Record<string, number>)[`ENEMY_${typeKey}`] ?? 0xff0000;
    for (let i = 0; i < 6; i++) {
      const p = this.add.rectangle(x, y, 6, 6, color).setDepth(15);
      const angle = (i / 6) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 120);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.4,
        y: y + Math.sin(angle) * speed * 0.4,
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: 400,
        onComplete: () => p.destroy(),
      });
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private checkItemPickup() {
    const pickupRange = TILE_SIZE * 0.8;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const dx = this.player.x - item.x;
      const dy = this.player.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < pickupRange) {
        const type = (item as Phaser.GameObjects.Sprite & { itemType: string }).itemType;
        this.applyItem(type);
        item.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  private applyItem(type: string) {
    const p = this.player.stats;
    switch (type) {
      case "HEALTH_POTION":
        this.player.heal(30);
        this.showStatus("Health Potion +30 HP");
        break;
      case "WEAPON":
        p.attack += 5;
        this.spawnFloatingText(this.player.x, this.player.y - 30, "ATK +5", COLORS.WEAPON);
        this.showStatus("Weapon Upgrade +5 ATK");
        this.updateUI();
        break;
      case "ARMOR":
        p.defense += 2;
        this.spawnFloatingText(this.player.x, this.player.y - 30, "DEF +2", COLORS.ARMOR);
        this.showStatus("Armor Shard +2 DEF");
        this.updateUI();
        break;
      case "XP_ORB":
        this.player.gainXP(40);
        this.showStatus("XP Orb +40 XP");
        break;
    }
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs() {
    const { tx, ty } = this.dungeon.stairsPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = this.player.x - sx;
    const dy = this.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.7) {
      this.nextFloor();
    }
  }

  private nextFloor() {
    this.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        this.scene.restart({ floor: this.currentFloor + 1 });
      }
    });
  }

  // ── Death ─────────────────────────────────────────────────────────────────

  private handlePlayerDeath() {
    this.player.setTint(0x888888);
    this.time.delayedCall(800, () => {
      this.scene.start("GameOverScene", {
        floor: this.currentFloor,
        kills: this.kills,
        level: this.player.stats.level,
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private spawnFloatingText(x: number, y: number, text: string, color: number, size = 14) {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const obj = this.add.text(x, y, text, {
      fontSize: `${size}px`,
      color: hex,
      fontFamily: "monospace",
      stroke: "#000",
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);

    this.floatingTexts.push({ obj, vy: -60, life: 900 });
  }

  private updateFloatingTexts(delta: number) {
    const dt = delta / 1000;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= delta;
      ft.obj.y += ft.vy * dt;
      ft.vy *= 0.95;
      ft.obj.setAlpha(Math.max(0, ft.life / 900));
      if (ft.life <= 0) {
        ft.obj.destroy();
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private showStatus(msg: string) {
    this.statusText.setText(msg);
    this.time.delayedCall(2000, () => {
      if (this.statusText) this.statusText.setText("");
    });
  }
}
