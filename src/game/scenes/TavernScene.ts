import * as Phaser from "phaser";
import { TILE_SIZE, TILE, TAVERN_W, TAVERN_H, CHARACTER_CLASSES, abilityMod } from "../constants";
import { Player, CharCreationData, PlayerStats } from "../entities/Player";
import {
  Quest, generateQuestBoard, applyQuestReward, getActiveSpecialRoomTags,
  RARITY_COLORS, RARITY_LABELS,
} from "../systems/QuestSystem";

// ── Tavern tilemap ────────────────────────────────────────────────────────────
// W=wall  F=floor  S=stairs-down (dungeon portal)
const W = TILE.WALL;
const F = TILE.FLOOR;
const S = TILE.STAIRS;

function buildTavernTiles(): number[][] {
  const tiles: number[][] = Array.from({ length: TAVERN_H }, () => Array(TAVERN_W).fill(F));

  // Border walls
  for (let x = 0; x < TAVERN_W; x++) {
    tiles[0][x] = W;
    tiles[TAVERN_H - 1][x] = W;
  }
  for (let y = 0; y < TAVERN_H; y++) {
    tiles[y][0] = W;
    tiles[y][TAVERN_W - 1] = W;
  }

  // Bar counter (rows 2-4, cols 2-8) — impassable
  for (let x = 2; x <= 8; x++) for (let y = 2; y <= 3; y++) tiles[y][x] = W;

  // Notice board area (rows 2-3, cols 20-26) — impassable
  for (let x = 20; x <= 26; x++) for (let y = 2; y <= 3; y++) tiles[y][x] = W;

  // Tables (rows 6-7)
  const tableCols = [2, 6, 12, 17, 22];
  for (const cx of tableCols) {
    tiles[6][cx] = W; tiles[6][cx + 1] = W;
    tiles[7][cx] = W; tiles[7][cx + 1] = W;
  }

  // Dungeon entrance — center bottom (rows 12-13, cols 12-15)
  for (let x = 12; x <= 15; x++) {
    tiles[12][x] = S;
    tiles[13][x] = S;
  }

  return tiles;
}

const TAVERN_TILES = buildTavernTiles();

// Track special wall tiles for distinct rendering
const BAR_TILES = new Set<string>();
for (let x = 2; x <= 8; x++) for (let y = 2; y <= 3; y++) BAR_TILES.add(`${x},${y}`);

const TABLE_TILES = new Set<string>();
for (const cx of [2, 6, 12, 17, 22]) {
  TABLE_TILES.add(`${cx},6`); TABLE_TILES.add(`${cx + 1},6`);
  TABLE_TILES.add(`${cx},7`); TABLE_TILES.add(`${cx + 1},7`);
}

// NPC positions
const INNKEEPER_POS = { tx: 5, ty: 1 };     // behind the bar counter
const NOTICE_BOARD_POS = { tx: 23, ty: 5 };  // in front of notice board
const ENTRANCE_LABEL_POS = { tx: 13, ty: 10 }; // above portal

// Shop items available
interface ShopItem {
  key: string;
  label: string;
  cost: number;
  classFilter?: string[]; // if set, only these classes can buy
  action: (stats: PlayerStats) => void;
}

const SHOP_ITEMS: ShopItem[] = [
  {
    key: 'health_potion',
    label: 'Health Potion',
    cost: 20,
    action: (s) => { s.potions++; },
  },
  {
    key: 'mana_potion',
    label: 'Mana Potion',
    cost: 25,
    classFilter: ['wizard', 'cleric'],
    action: (s) => { s.manaPotions++; },
  },
  {
    key: 'weapon_upgrade',
    label: 'Weapon Upgrade (+2 ATK)',
    cost: 50,
    action: (s) => { s.weaponBonus += 2; s.attack += 2; },
  },
  {
    key: 'armor_upgrade',
    label: 'Armor Upgrade (+2 DEF)',
    cost: 50,
    action: (s) => { s.armorBonus += 2; s.defense += 2; },
  },
  {
    key: 'torch',
    label: 'Large Torch (wider sight)',
    cost: 30,
    action: (s) => {
      // Store as a small bonus — GameScene reads this via level text
      s.gold -= 0; // placeholder, handled separately via stat
    },
  },
];

// Quest board state (rendered dynamically from QuestSystem)
let _boardQuests: Quest[] = [];

export class TavernScene extends Phaser.Scene {
  private player!: Player;
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private playerStats!: PlayerStats;
  private charData?: CharCreationData;
  private saveSlot = 1;
  private _enteringDungeon = false;
  private _dungeonChoiceOpen = false;
  private _dungeonChoiceDialog?: Phaser.GameObjects.Container;

  // UI elements
  private shopPanel?: Phaser.GameObjects.Container;
  private questPanel?: Phaser.GameObjects.Container;
  private interactPrompt!: Phaser.GameObjects.Text;
  private statsPanel!: Phaser.GameObjects.Container;

  // NPC sprites
  private innkeeperSprite!: Phaser.GameObjects.Sprite;
  private boardSprite!: Phaser.GameObjects.Sprite;

  // Input
  private _eKey?: Phaser.Input.Keyboard.Key;
  private _esc?: Phaser.Input.Keyboard.Key;

  private nearInnkeeper = false;
  private nearBoard = false;
  private nearEntrance = false;

  constructor() {
    super({ key: "TavernScene" });
  }

  init(data: { charData?: CharCreationData; persistedStats?: PlayerStats; saveSlot?: number }) {
    this.charData = data?.charData;
    this.saveSlot = data?.saveSlot ?? data?.persistedStats?.saveSlot ?? 1;
    this._enteringDungeon = false;
    if (data?.persistedStats) {
      this.playerStats = data.persistedStats;
    } else {
      this.playerStats = null!; // will be built in create() from charData
    }
  }

  create() {
    const totalW = TAVERN_W * TILE_SIZE;
    const totalH = TAVERN_H * TILE_SIZE;

    this.physics.world.setBounds(0, 0, totalW, totalH);

    this.buildTavern();
    this.spawnPlayer();
    this.spawnNPCs();
    this.spawnPatrons();
    this.spawnDecor();
    this.spawnEntranceLabel();
    this.spawnTorches();
    this.setupCamera(totalW, totalH);
    this.buildStatsPanel();
    this.buildPromptText();

    this._eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this._esc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Launch HUD if not active
    if (!this.scene.isActive("HUDScene")) {
      this.scene.launch("HUDScene");
    }
    this.emitHUD();

    // Claim rewards for completed quests
    this.claimCompletedQuests();
  }

  private claimCompletedQuests() {
    const s = this.playerStats;
    if (!s.activeQuests) return;
    const completed = s.activeQuests.filter(q => q.status === 'completed');
    if (completed.length === 0) return;

    if (!s.completedQuests) s.completedQuests = [];

    for (const q of completed) {
      applyQuestReward(q, s, (xp) => this.player.gainXP(xp));
      s.completedQuests.push(q);
    }

    // Cap completed quests at 50
    if (s.completedQuests.length > 50) {
      s.completedQuests = s.completedQuests.slice(-50);
    }

    // Remove completed from active
    s.activeQuests = s.activeQuests.filter(q => q.status !== 'completed');

    // Show reward popup
    const W = this.scale.width;
    const H = this.scale.height;
    const popup = this.add.container(W / 2, H / 2 - 80).setDepth(300).setScrollFactor(0);
    const totalGold = completed.reduce((sum, q) => sum + q.rewardGold, 0);
    const totalXP = completed.reduce((sum, q) => sum + q.rewardXP, 0);

    const popBg = this.add.rectangle(0, 0, 300, 80, 0x0a2a0a, 0.95)
      .setStrokeStyle(2, 0x66bb6a);
    popup.add(popBg);
    popup.add(this.add.text(0, -20, `${completed.length} Quest${completed.length > 1 ? 's' : ''} Complete!`, {
      fontSize: "14px", color: "#66bb6a", fontFamily: "monospace",
    }).setOrigin(0.5));
    popup.add(this.add.text(0, 6, `+${totalGold} gold  +${totalXP} XP`, {
      fontSize: "12px", color: "#ffd700", fontFamily: "monospace",
    }).setOrigin(0.5));

    this.tweens.add({
      targets: popup,
      alpha: 0,
      y: H / 2 - 140,
      delay: 2500,
      duration: 800,
      onComplete: () => popup.destroy(),
    });

    this.updateStatsPanel();
    this.emitHUD();
  }

  // ── Build Tavern ──────────────────────────────────────────────────────────

  private buildTavern() {
    this.wallGroup = this.physics.add.staticGroup();

    for (let ty = 0; ty < TAVERN_H; ty++) {
      for (let tx = 0; tx < TAVERN_W; tx++) {
        const t = TAVERN_TILES[ty][tx];
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        if (t === TILE.WALL) {
          const tileKey = `${tx},${ty}`;
          const texture = BAR_TILES.has(tileKey) ? "tavern_bar"
            : TABLE_TILES.has(tileKey) ? "tavern_table"
            : "tavern_wall";
          // Bar south row (ty=3) renders above innkeeper for "behind counter" effect
          const tileDepth = BAR_TILES.has(tileKey) ? 6 : 1;
          this.add.image(wx, wy, texture).setDepth(tileDepth);
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true);
          this.wallGroup.add(rect);
        } else if (t === TILE.STAIRS) {
          this.add.image(wx, wy, "tavern_floor").setDepth(1);
          this.add.image(wx, wy, "dungeon_portal").setDepth(2);
        } else {
          this.add.image(wx, wy, "tavern_floor").setDepth(1);
        }
      }
    }

    // Atmospheric: add a few candle glow sprites
    const candlePositions = [
      { tx: 5, ty: 1 }, { tx: 10, ty: 1 }, { tx: 18, ty: 1 }, { tx: 24, ty: 1 },
    ];
    for (const pos of candlePositions) {
      const cx = pos.tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = pos.ty * TILE_SIZE + TILE_SIZE / 2;
      this.add.image(cx, cy, "torch_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.8).setAlpha(0.4).setDepth(49);
    }
  }

  // ── Spawn Player ──────────────────────────────────────────────────────────

  private spawnPlayer() {
    // Spawn near the dungeon entrance (row 9, center)
    const spawnTx = 13;
    const spawnTy = 9;
    const px = spawnTx * TILE_SIZE + TILE_SIZE / 2;
    const py = spawnTy * TILE_SIZE + TILE_SIZE / 2;

    this.player = new Player(this, px, py, this.charData, this.playerStats ?? undefined);

    // Store playerStats reference
    this.playerStats = this.player.stats;

    this.player.setCallbacks({
      onHeal: () => { this.updateStatsPanel(); this.emitHUD(); },
      onDamage: () => { this.updateStatsPanel(); this.emitHUD(); },
      onXP: () => { this.updateStatsPanel(); this.emitHUD(); },
      onLevelUp: () => { this.updateStatsPanel(); this.emitHUD(); },
    });

    this.physics.add.collider(this.player, this.wallGroup);
  }

  // ── NPCs ──────────────────────────────────────────────────────────────────

  private spawnNPCs() {
    // Innkeeper — stands behind the bar counter
    const ix = INNKEEPER_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const iy = INNKEEPER_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    this.innkeeperSprite = this.add.sprite(ix, iy, "npc").setDepth(5).setScale(1.3);
    this.innkeeperSprite.setTint(0xffcc88);

    this.add.text(ix, iy - TILE_SIZE * 1.2, "Innkeeper", {
      fontSize: "9px", color: "#ffcc88", fontFamily: "monospace",
      backgroundColor: "#00000088", padding: { x: 2, y: 1 },
    }).setOrigin(0.5).setDepth(7);

    // Notice board sprite
    const bx = NOTICE_BOARD_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const by = NOTICE_BOARD_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    this.boardSprite = this.add.sprite(bx, by, "notice_board").setDepth(5).setScale(1.4);

    this.add.text(bx, by - TILE_SIZE * 1.2, "Notice Board", {
      fontSize: "9px", color: "#ffe082", fontFamily: "monospace",
      backgroundColor: "#00000088", padding: { x: 2, y: 1 },
    }).setOrigin(0.5).setDepth(6);

    // Quest board glow — draws attention
    const boardGlow = this.add.image(bx, by, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.5).setAlpha(0.25).setDepth(4).setTint(0xffcc00);
    this.tweens.add({
      targets: boardGlow,
      alpha: 0.45, scaleX: 1.8, scaleY: 1.8,
      duration: 1200, yoyo: true, repeat: -1,
      ease: "Sine.easeInOut",
    });

    // "[E] Quests" label below board
    const questHint = this.add.text(bx, by + TILE_SIZE * 0.8, "[E] Quests", {
      fontSize: "10px", color: "#ffe082", fontFamily: "monospace",
      backgroundColor: "#00000088", padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);
    this.tweens.add({
      targets: questHint, alpha: 0.4,
      duration: 1000, yoyo: true, repeat: -1,
    });

    // Innkeeper idle — gentle lateral sway behind bar
    this.tweens.add({
      targets: this.innkeeperSprite,
      x: ix + 3,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private spawnPatrons() {
    const patrons: { tx: number; ty: number; texture: string; name: string; tint?: number }[] = [
      { tx: 3, ty: 5, texture: "player_fighter", name: "Grizzled Knight" },
      { tx: 7, ty: 8, texture: "player_thief", name: "Shadowy Rogue" },
      { tx: 13, ty: 8, texture: "player_wizard", name: "Old Sage" },
      { tx: 17, ty: 5, texture: "player_cleric", name: "Wandering Priest" },
      { tx: 23, ty: 8, texture: "npc", name: "Weary Traveler", tint: 0xaa88bb },
    ];

    for (const p of patrons) {
      const px = p.tx * TILE_SIZE + TILE_SIZE / 2;
      const py = p.ty * TILE_SIZE + TILE_SIZE / 2;
      const sprite = this.add.sprite(px, py, p.texture).setDepth(5);
      if (p.tint) sprite.setTint(p.tint);

      this.add.text(px, py - TILE_SIZE, p.name, {
        fontSize: "8px", color: "#888899", fontFamily: "monospace",
        backgroundColor: "#00000066", padding: { x: 2, y: 1 },
      }).setOrigin(0.5).setDepth(6);

      // Subtle idle breathing
      this.tweens.add({
        targets: sprite,
        y: py - 2,
        duration: 2000 + Math.random() * 1000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  private spawnDecor() {
    // Barrels behind bar (row 1, flanking the innkeeper)
    for (const btx of [2, 3, 7, 8]) {
      const bx = btx * TILE_SIZE + TILE_SIZE / 2;
      const by = 1 * TILE_SIZE + TILE_SIZE / 2;
      this.add.image(bx, by, "tavern_barrel").setDepth(3);
    }

    // Warm glow behind the bar area
    const barGlowX = 5 * TILE_SIZE + TILE_SIZE / 2;
    const barGlowY = 1 * TILE_SIZE + TILE_SIZE / 2;
    const barGlow = this.add.image(barGlowX, barGlowY, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.8).setAlpha(0.25).setDepth(47).setTint(0xff8844);
    this.tweens.add({
      targets: barGlow,
      alpha: 0.35,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Fireplace glow on east wall
    const fpX = (TAVERN_W - 2) * TILE_SIZE + TILE_SIZE / 2;
    const fpY = 9 * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < 2; i++) {
      const glow = this.add.image(fpX, fpY, "torch_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(2 + i).setAlpha(0.2).setDepth(47).setTint(0xff6622);
      this.tweens.add({
        targets: glow,
        alpha: 0.32,
        scaleX: glow.scaleX + 0.3,
        scaleY: glow.scaleY + 0.3,
        duration: 900 + i * 400,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private spawnEntranceLabel() {
    // Portal centre (rows 12-13, cols 12-15 → centre ≈ col 13.5, row 12.5)
    const portalCx = 13.5 * TILE_SIZE;
    const portalCy = 12.5 * TILE_SIZE;

    // Large pulsing glow under portal
    for (let i = 0; i < 3; i++) {
      const glow = this.add.image(portalCx, portalCy, "torch_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(1.8 + i * 0.5).setAlpha(0.18).setDepth(47).setTint(0x9900cc);
      this.tweens.add({
        targets: glow,
        alpha: 0.32, scaleX: glow.scaleX + 0.4, scaleY: glow.scaleY + 0.4,
        duration: 1200 + i * 300, yoyo: true, repeat: -1,
      });
    }

    // Big visible label above the portal
    const label = this.add.text(portalCx, portalCy - TILE_SIZE * 2.2, "▼ ENTER DUNGEON ▼", {
      fontSize: "14px", color: "#cc88ff", fontFamily: "monospace",
      stroke: "#000000", strokeThickness: 3,
      backgroundColor: "#0a0014",
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(10);

    this.tweens.add({
      targets: label,
      alpha: 0.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Walk-on hint
    this.add.text(portalCx, portalCy - TILE_SIZE * 1.2, "walk onto portal", {
      fontSize: "9px", color: "#664488", fontFamily: "monospace",
    }).setOrigin(0.5).setDepth(10);
  }

  private spawnTorches() {
    const torchPositions = [
      { tx: 14, ty: 8 },
    ];
    for (const pos of torchPositions) {
      const cx = pos.tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = pos.ty * TILE_SIZE + TILE_SIZE / 2;
      const outer = this.add.image(cx, cy, "torch_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(3).setAlpha(0.3).setDepth(47);
      const inner = this.add.image(cx, cy, "torch_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(1.5).setAlpha(0.5).setDepth(48);
      this.tweens.add({
        targets: [outer, inner],
        alpha: { from: 0.28, to: 0.4 },
        scaleX: { from: 2.8, to: 3.2 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private setupCamera(totalW: number, totalH: number) {
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(1.2);
    // No fog — tavern is fully lit
  }

  // ── Stats Panel ───────────────────────────────────────────────────────────

  private buildStatsPanel() {
    const W = this.scale.width;
    this.statsPanel = this.add.container(0, 0).setDepth(100).setScrollFactor(0);
    this.updateStatsPanel();
    void W;
  }

  private updateStatsPanel() {
    const s = this.playerStats;
    if (!s) return;
    const cls = CHARACTER_CLASSES[s.classKey];

    this.statsPanel.removeAll(true);

    const x = this.scale.width - 8;
    const y = 8;

    const lines = [
      `${cls.name}  LV ${s.level}`,
      `HP  ${Math.ceil(s.hp)}/${s.maxHp}`,
      `Gold ${s.gold}g`,
      `🧪 ${s.potions}  💧 ${s.manaPotions}`,
    ];

    const bg = this.add.rectangle(x - 80, y + 36, 166, lines.length * 18 + 12, 0x0a0a14, 0.85)
      .setStrokeStyle(1, 0x333355);
    this.statsPanel.add(bg);

    lines.forEach((line, i) => {
      const txt = this.add.text(x, y + 8 + i * 18, line, {
        fontSize: "11px", color: "#ccccdd", fontFamily: "monospace",
      }).setOrigin(1, 0);
      this.statsPanel.add(txt);
    });
  }

  // ── Interact Prompt ───────────────────────────────────────────────────────

  private buildPromptText() {
    this.interactPrompt = this.add.text(
      this.scale.width / 2, this.scale.height - 36,
      "",
      { fontSize: "15px", color: "#ffffff", fontFamily: "monospace", backgroundColor: "#000000cc", padding: { x: 12, y: 6 }, stroke: "#000000", strokeThickness: 2 }
    ).setOrigin(0.5).setDepth(100).setScrollFactor(0).setVisible(false);
  }

  private showPrompt(text: string) {
    this.interactPrompt.setText(text).setVisible(true);
  }

  private hidePrompt() {
    this.interactPrompt.setVisible(false);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (!this.player || this.playerStats.hp <= 0) return;

    this.player.update(delta);

    // Check proximity to interactables
    const px = this.player.x;
    const py = this.player.y;
    const range = TILE_SIZE * 2.5;

    const innkeeperDist = Phaser.Math.Distance.Between(px, py, this.innkeeperSprite.x, this.innkeeperSprite.y);
    const boardDist = Phaser.Math.Distance.Between(px, py, this.boardSprite.x, this.boardSprite.y);

    // Dungeon entrance proximity
    const entranceCx = 13.5 * TILE_SIZE;
    const entranceCy = 12.5 * TILE_SIZE;
    const entranceDist = Phaser.Math.Distance.Between(px, py, entranceCx, entranceCy);

    this.nearInnkeeper = innkeeperDist < TILE_SIZE * 4; // reach across bar counter
    this.nearBoard = boardDist < range;
    this.nearEntrance = entranceDist < TILE_SIZE * 3;

    // ESC closes dungeon choice dialog
    // Check _dungeonChoiceOpen BEFORE JustDown — JustDown consumes the keypress
    if (this._esc && this._dungeonChoiceOpen && Phaser.Input.Keyboard.JustDown(this._esc)) {
      this.closeDungeonChoice();
      return;
    }

    // Walk-on portal trigger (primary entry method)
    if (!this._enteringDungeon && !this.shopPanel && !this.questPanel && !this._dungeonChoiceOpen) {
      const playerTx = Math.floor(px / TILE_SIZE);
      const playerTy = Math.floor(py / TILE_SIZE);
      if (playerTy >= 0 && playerTy < TAVERN_H && playerTx >= 0 && playerTx < TAVERN_W) {
        if (TAVERN_TILES[playerTy][playerTx] === TILE.STAIRS) {
          this.onPortalStep();
        }
      }
    }

    // Prompt
    if (this.shopPanel || this.questPanel) {
      this.showPrompt("ESC — Close");
    } else if (this.nearInnkeeper) {
      this.showPrompt("E — Talk to Innkeeper (Shop)");
    } else if (this.nearBoard) {
      this.showPrompt("E — Read Notice Board");
    } else if (this.nearEntrance) {
      this.showPrompt("Walk onto the glowing portal to enter the dungeon ▼");
    } else {
      this.hidePrompt();
    }

    // Interactions
    if (this._esc && Phaser.Input.Keyboard.JustDown(this._esc)) {
      this.closeAllPanels();
    }

    if (this._eKey && Phaser.Input.Keyboard.JustDown(this._eKey)) {
      if (this.shopPanel || this.questPanel) {
        this.closeAllPanels();
      } else if (this.nearInnkeeper) {
        this.openShop();
      } else if (this.nearBoard) {
        this.openQuestBoard();
      }
      // Portal entry is walk-on only (no E key needed)
    }

    this.emitHUD();
  }

  // ── Shop ──────────────────────────────────────────────────────────────────

  private openShop() {
    this.closeAllPanels();
    const W = this.scale.width;
    const H = this.scale.height;
    const panelW = 380;
    const panelH = 320;
    const cx = W / 2;
    const cy = H / 2;

    this.shopPanel = this.add.container(cx, cy).setDepth(200).setScrollFactor(0);

    const bg = this.add.rectangle(0, 0, panelW, panelH, 0x0a0a18, 0.96)
      .setStrokeStyle(2, 0x8b5e2a);
    this.shopPanel.add(bg);

    this.shopPanel.add(this.add.text(0, -panelH / 2 + 20, "⚒  INNKEEPER'S SHOP", {
      fontSize: "16px", color: "#ffcc88", fontFamily: "monospace",
    }).setOrigin(0.5));

    this.shopPanel.add(this.add.text(0, -panelH / 2 + 42, `Gold: ${this.playerStats.gold}g`, {
      fontSize: "12px", color: "#ffd700", fontFamily: "monospace",
    }).setOrigin(0.5));

    const classKey = this.playerStats.classKey;
    const available = SHOP_ITEMS.filter(i => !i.classFilter || i.classFilter.includes(classKey));

    available.forEach((item, i) => {
      const itemY = -panelH / 2 + 80 + i * 42;
      const canAfford = this.playerStats.gold >= item.cost;

      const itemBg = this.add.rectangle(0, itemY, panelW - 24, 36, 0x141420)
        .setInteractive()
        .setStrokeStyle(1, canAfford ? 0x444466 : 0x222228);
      this.shopPanel!.add(itemBg);

      const nameColor = canAfford ? "#ccccff" : "#555566";
      const costColor = canAfford ? "#ffd700" : "#554400";

      this.shopPanel!.add(this.add.text(-panelW / 2 + 20, itemY, item.label, {
        fontSize: "12px", color: nameColor, fontFamily: "monospace",
      }).setOrigin(0, 0.5));

      this.shopPanel!.add(this.add.text(panelW / 2 - 20, itemY, `${item.cost}g`, {
        fontSize: "12px", color: costColor, fontFamily: "monospace",
      }).setOrigin(1, 0.5));

      if (canAfford) {
        itemBg.on("pointerover", () => itemBg.setFillStyle(0x1e1e30));
        itemBg.on("pointerout", () => itemBg.setFillStyle(0x141420));
        itemBg.on("pointerdown", () => {
          this.playerStats.gold -= item.cost;
          item.action(this.playerStats);
          // Refresh panel
          this.openShop();
        });
      }
    });

    // Full-width close bar (x=0 for reliable hit-testing under zoom)
    const closeBg = this.add.rectangle(0, panelH / 2 - 18, panelW - 24, 26, 0x2a0a0a)
      .setInteractive().setStrokeStyle(1, 0x884444);
    this.shopPanel.add(closeBg);
    this.shopPanel.add(this.add.text(0, panelH / 2 - 18, "CLOSE  ✕", {
      fontSize: "11px", color: "#ff6666", fontFamily: "monospace",
    }).setOrigin(0.5));
    closeBg.on("pointerover", () => closeBg.setFillStyle(0x3a1a1a));
    closeBg.on("pointerout", () => closeBg.setFillStyle(0x2a0a0a));
    closeBg.on("pointerdown", () => this.closeAllPanels());
  }

  // ── Quest Board ────────────────────────────────────────────────────────────

  private openQuestBoard() {
    this.closeAllPanels();
    const W = this.scale.width;
    const H = this.scale.height;
    const s = this.playerStats;

    // Initialize quest arrays if needed
    if (!s.activeQuests) s.activeQuests = [];
    if (!s.completedQuests) s.completedQuests = [];

    // Generate board quests
    const board = generateQuestBoard(
      s.level, s.floor,
      s.activeQuests,
      s.questBoardSeed,
      s.questBoardGeneratedAt,
    );
    s.questBoardSeed = board.seed;
    s.questBoardGeneratedAt = board.generatedAt;
    _boardQuests = board.quests;

    const panelW = 460;
    const cardH = 82;
    const panelH = 60 + _boardQuests.length * (cardH + 6) + 20;

    this.questPanel = this.add.container(W / 2, H / 2).setDepth(200).setScrollFactor(0);

    const bg = this.add.rectangle(0, 0, panelW, panelH, 0x0e0c04, 0.96)
      .setStrokeStyle(2, 0x8b5e2a);
    this.questPanel.add(bg);

    this.questPanel.add(this.add.text(0, -panelH / 2 + 18, "📋  QUEST BOARD", {
      fontSize: "15px", color: "#ffe082", fontFamily: "monospace",
    }).setOrigin(0.5));

    // Full-width close bar at top (x=0 for reliable hit-testing under zoom)
    const closeBg = this.add.rectangle(0, -panelH / 2 + 18, panelW - 20, 26, 0x2a0a0a)
      .setInteractive().setStrokeStyle(1, 0x884444);
    this.questPanel.add(closeBg);
    this.questPanel.add(this.add.text(0, -panelH / 2 + 18, "CLOSE  ✕", {
      fontSize: "11px", color: "#ff6666", fontFamily: "monospace",
    }).setOrigin(0.5));
    closeBg.on("pointerover", () => closeBg.setFillStyle(0x3a1a1a));
    closeBg.on("pointerout", () => closeBg.setFillStyle(0x2a0a0a));
    closeBg.on("pointerdown", () => this.closeAllPanels());

    _boardQuests.forEach((q, i) => {
      const qy = -panelH / 2 + 55 + i * (cardH + 6);
      const rarityColor = RARITY_COLORS[q.rarity];
      const rarityHex = `#${rarityColor.toString(16).padStart(6, '0')}`;

      // Check if already active
      const isActive = s.activeQuests!.some(aq => aq.id === q.id);

      // Card background — full-width interactive for accepting
      const cardFill = isActive ? 0x0e1a0e : 0x18160a;
      const cardBg = this.add.rectangle(0, qy, panelW - 20, cardH, cardFill)
        .setStrokeStyle(isActive ? 2 : 1, isActive ? 0x66bb6a : rarityColor)
        .setInteractive();
      this.questPanel!.add(cardBg);

      if (!isActive) {
        cardBg.on("pointerover", () => cardBg.setFillStyle(0x24220e));
        cardBg.on("pointerout", () => cardBg.setFillStyle(0x18160a));
        cardBg.on("pointerdown", () => {
          this.acceptQuest(q);
          this.openQuestBoard(); // refresh panel
        });
      }

      // Rarity badge
      this.questPanel!.add(this.add.text(-panelW / 2 + 18, qy - cardH / 2 + 8, RARITY_LABELS[q.rarity], {
        fontSize: "8px", color: rarityHex, fontFamily: "monospace",
        backgroundColor: "#000000aa", padding: { x: 3, y: 1 },
      }).setOrigin(0, 0));

      // Title
      this.questPanel!.add(this.add.text(-panelW / 2 + 18, qy - cardH / 2 + 22, q.title, {
        fontSize: "11px", color: isActive ? "#66bb6a" : rarityHex, fontFamily: "monospace",
      }).setOrigin(0, 0));

      // Description
      this.questPanel!.add(this.add.text(-panelW / 2 + 18, qy - cardH / 2 + 38, q.description, {
        fontSize: "9px", color: "#887766", fontFamily: "monospace",
        wordWrap: { width: panelW - 140 },
      }).setOrigin(0, 0));

      // Rewards
      this.questPanel!.add(this.add.text(-panelW / 2 + 18, qy + cardH / 2 - 14,
        `${q.rewardGold}g  +${q.rewardXP}xp`, {
        fontSize: "9px", color: "#ffd700", fontFamily: "monospace",
      }).setOrigin(0, 0));

      // Status label on right side
      if (isActive) {
        this.questPanel!.add(this.add.text(panelW / 2 - 18, qy, "ACCEPTED ✓", {
          fontSize: "11px", color: "#66bb6a", fontFamily: "monospace",
          backgroundColor: "#0a2a0a", padding: { x: 6, y: 3 },
        }).setOrigin(1, 0.5));
      } else {
        this.questPanel!.add(this.add.text(panelW / 2 - 18, qy, "▶ CLICK TO ACCEPT", {
          fontSize: "9px", color: "#aaaa66", fontFamily: "monospace",
        }).setOrigin(1, 0.5));
      }
    });

    // Close hint at bottom
    this.questPanel.add(this.add.text(0, panelH / 2 - 16, "Click a quest to accept  |  ESC to close", {
      fontSize: "9px", color: "#555544", fontFamily: "monospace",
    }).setOrigin(0.5));
  }

  private acceptQuest(quest: Quest) {
    const s = this.playerStats;
    if (!s.activeQuests) s.activeQuests = [];
    if (s.activeQuests.some(q => q.id === quest.id)) return;
    quest.status = 'active';
    quest.acceptedAt = Date.now();
    s.activeQuests.push(quest);
  }

  private closeAllPanels() {
    if (this.shopPanel) { this.shopPanel.destroy(); this.shopPanel = undefined; }
    if (this.questPanel) { this.questPanel.destroy(); this.questPanel = undefined; }
  }

  // ── Portal Step — Continue or New ─────────────────────────────────────────

  private onPortalStep() {
    const hasSavedDungeon = Object.keys(this.playerStats?.savedDungeons ?? {}).length > 0;

    if (hasSavedDungeon) {
      this.showDungeonChoiceDialog();
    } else {
      this.enterDungeon(false);
    }
  }

  private showDungeonChoiceDialog() {
    if (this._dungeonChoiceOpen) return;
    this._dungeonChoiceOpen = true;

    const W = this.scale.width;
    const H = this.scale.height;
    const s = this.playerStats;
    const deepestFloor = Math.max(...Object.keys(s.savedDungeons ?? {}).map(Number));

    this._dungeonChoiceDialog = this.add.container(W / 2, H / 2).setDepth(200).setScrollFactor(0);

    const overlay = this.add.rectangle(0, 0, W, H, 0x000000, 0.55);
    this._dungeonChoiceDialog.add(overlay);

    const bg = this.add.rectangle(0, 0, 480, 280, 0x0c0c1a, 0.97).setStrokeStyle(2, 0x6622aa);
    this._dungeonChoiceDialog.add(bg);

    this._dungeonChoiceDialog.add(this.add.text(0, -108, '⚔  DUNGEON ENTRANCE  ⚔', {
      fontSize: '18px', color: '#cc88ff', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5));

    this._dungeonChoiceDialog.add(this.add.text(0, -76, `Active expedition — Floor ${deepestFloor}`, {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
    }).setOrigin(0.5));

    // Continue button
    const contBg = this.add.rectangle(-110, 10, 200, 120, 0x0a1a2a).setInteractive().setStrokeStyle(1, 0x3399ff);
    this._dungeonChoiceDialog.add(contBg);
    this._dungeonChoiceDialog.add(this.add.text(-110, -30, 'CONTINUE', {
      fontSize: '16px', color: '#3399ff', fontFamily: 'monospace',
    }).setOrigin(0.5));
    this._dungeonChoiceDialog.add(this.add.text(-110, 4, [
      `Resume Floor ${deepestFloor}`,
      'All state preserved',
      'Monsters/traps/chests',
      'as you left them',
    ].join('\n'), { fontSize: '10px', color: '#668899', fontFamily: 'monospace', align: 'center', lineSpacing: 3 }).setOrigin(0.5));
    contBg.on('pointerover', () => contBg.setFillStyle(0x0a2a44));
    contBg.on('pointerout', () => contBg.setFillStyle(0x0a1a2a));
    contBg.on('pointerdown', () => { this.closeDungeonChoice(); this.enterDungeon(true); });

    // New dungeon button
    const newBg = this.add.rectangle(110, 10, 200, 120, 0x1a0a2a).setInteractive().setStrokeStyle(1, 0xcc44ff);
    this._dungeonChoiceDialog.add(newBg);
    this._dungeonChoiceDialog.add(this.add.text(110, -30, 'NEW DUNGEON', {
      fontSize: '16px', color: '#cc44ff', fontFamily: 'monospace',
    }).setOrigin(0.5));
    this._dungeonChoiceDialog.add(this.add.text(110, 4, [
      'Fresh from Floor 1',
      'New random layout',
      'All floors reset',
      'Keep gear & levels',
    ].join('\n'), { fontSize: '10px', color: '#886699', fontFamily: 'monospace', align: 'center', lineSpacing: 3 }).setOrigin(0.5));
    newBg.on('pointerover', () => newBg.setFillStyle(0x2a0a44));
    newBg.on('pointerout', () => newBg.setFillStyle(0x1a0a2a));
    newBg.on('pointerdown', () => { this.closeDungeonChoice(); this.enterDungeon(false); });

    // ESC hint
    this._dungeonChoiceDialog.add(this.add.text(0, 110, 'ESC — close', {
      fontSize: '10px', color: '#333355', fontFamily: 'monospace',
    }).setOrigin(0.5));
  }

  private closeDungeonChoice() {
    this._dungeonChoiceDialog?.destroy();
    this._dungeonChoiceDialog = undefined;
    this._dungeonChoiceOpen = false;
  }

  // ── Enter Dungeon ─────────────────────────────────────────────────────────

  /** @param continueSaved — true = resume saved dungeon, false = fresh generation */
  private enterDungeon(continueSaved: boolean) {
    if (this._enteringDungeon) return;
    this._enteringDungeon = true;

    const persistedStats = this.player.getSerializable();
    persistedStats.saveSlot = this.saveSlot;

    if (!continueSaved) {
      // Clear all saved dungeon floors — fresh generation
      persistedStats.savedDungeons = {};
      persistedStats.floor = 1;
    } else {
      // Resume deepest explored floor
      const floors = Object.keys(persistedStats.savedDungeons ?? {}).map(Number);
      persistedStats.floor = floors.length > 0 ? Math.max(...floors) : 1;
    }

    this.autoSave(persistedStats).catch(() => {});

    // Gather special room tags from active quests
    const specialRoomTags = getActiveSpecialRoomTags(persistedStats.activeQuests ?? []);

    this.cameras.main.fade(400, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        this.scene.start("GameScene", {
          floor: persistedStats.floor,
          persistedStats,
          saveSlot: this.saveSlot,
          specialRoomTags,
        });
      }
    });
  }

  private async autoSave(stats: PlayerStats) {
    const cls = CHARACTER_CLASSES[stats.classKey];
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: this.saveSlot,
          name: stats.name || `${cls.name} Lv ${stats.level}`,
          data: stats,
          level: stats.level,
          floor: stats.floor,
          playtime: 0,
        }),
      });
    } catch {
      // Offline — silently skip save
    }
  }

  // ── HUD Events ────────────────────────────────────────────────────────────

  private emitHUD() {
    const s = this.playerStats;
    if (!s) return;
    this.events.emit("hud:update", {
      hp: s.hp, maxHp: s.maxHp,
      attack: s.attack, defense: s.defense,
      level: s.level, xp: s.xp, xpToNext: s.xpToNext,
      floor: 0, kills: 0,
      mana: s.mana, maxMana: s.maxMana,
      classKey: s.classKey,
      name: s.name,
      effects: s.effects,
      spellKeys: [],
      spellCooldowns: [],
      spellManaCosts: [],
      potions: s.potions,
      manaPotions: s.manaPotions,
      gold: s.gold,
      activeQuests: s.activeQuests,
      completedQuests: s.completedQuests,
      inventory: s.inventory,
      equippedWeaponLabel: s.equippedWeaponLabel,
      equippedArmorLabel: s.equippedArmorLabel,
    });
    this.updateStatsPanel();

    // Suppress unused warning
    void abilityMod;
  }
}
