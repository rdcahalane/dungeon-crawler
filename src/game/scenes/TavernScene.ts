import * as Phaser from "phaser";
import { TILE_SIZE, TILE, TAVERN_W, TAVERN_H, CHARACTER_CLASSES, abilityMod } from "../constants";
import { Player, CharCreationData, PlayerStats } from "../entities/Player";
import { saveGame } from "../systems/SaveStore";
import {
  Quest, generateQuestBoard, applyQuestReward, getActiveSpecialRoomTags,
  RARITY_COLORS, RARITY_LABELS,
} from "../systems/QuestSystem";
import { Sfx } from "../audio/Sfx";
import { COL, asciiOnly, flatPanel, retroButton, tagText, uiText } from "../gfx/retroUi";

// -- Tavern tilemap ------------------------------------------------------------
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

  // Bar counter (rows 2-4, cols 2-8) - impassable
  for (let x = 2; x <= 8; x++) for (let y = 2; y <= 3; y++) tiles[y][x] = W;

  // Notice board area (rows 2-3, cols 20-26) - impassable
  for (let x = 20; x <= 26; x++) for (let y = 2; y <= 3; y++) tiles[y][x] = W;

  // Tables (rows 6-7)
  const tableCols = [2, 6, 12, 17, 22];
  for (const cx of tableCols) {
    tiles[6][cx] = W; tiles[6][cx + 1] = W;
    tiles[7][cx] = W; tiles[7][cx + 1] = W;
  }

  // Dungeon entrance - center bottom (rows 12-13, cols 12-15)
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
      // Store as a small bonus - GameScene reads this via level text
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
  private interactPrompt!: Phaser.GameObjects.BitmapText;
  private promptBg!: Phaser.GameObjects.Rectangle;
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
    this.showRunSummary();
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

    popup.add(flatPanel(this, 0, 0, 360, 80, { fill: COL.pine, border: COL.lime }));
    popup.add(uiText(this, 0, -16, `${completed.length} QUEST${completed.length > 1 ? 'S' : ''} COMPLETE!`, {
      size: 16, color: COL.lime, originX: 0.5, originY: 0.5,
    }));
    popup.add(uiText(this, 0, 14, `+${totalGold} GOLD  +${totalXP} XP`, {
      size: 16, color: COL.gold, originX: 0.5, originY: 0.5,
    }));
    Sfx.play('level_up');

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

  private showRunSummary() {
    const s = this.playerStats;
    const gold = s.runGoldEarned ?? 0;
    const streak = s.runBestStreak ?? 0;
    const floor = s.runDeepestFloor ?? 0;
    if (gold <= 0 && streak <= 0 && floor <= 0) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const popup = this.add.container(W / 2, H / 2 + 24).setDepth(290).setScrollFactor(0);
    popup.add(flatPanel(this, 0, 0, 440, 110, { fill: COL.ink, border: COL.gold, alpha: 0.96 }));
    popup.add(uiText(this, 0, -36, 'DELVE SUMMARY', { size: 16, color: COL.gold, originX: 0.5, originY: 0.5 }));
    popup.add(uiText(this, 0, -14, [
      `DEEPEST FLOOR ${floor}   GOLD ${gold}G`,
      `BEST STREAK X${streak}   RELICS ${s.relics?.length ?? 0}`,
    ].join('\n'), { size: 16, color: COL.silver, originX: 0.5, originY: 0, center: true }));

    s.runGoldEarned = 0;
    s.runBestStreak = 0;
    s.runDeepestFloor = 0;

    this.tweens.add({
      targets: popup,
      alpha: 0,
      y: H / 2 - 50,
      delay: 3600,
      duration: 900,
      onComplete: () => popup.destroy(),
    });
  }

	  // -- Build Tavern ----------------------------------------------------------

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

  // -- Spawn Player ----------------------------------------------------------

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

  // -- NPCs ------------------------------------------------------------------

  private spawnNPCs() {
    // Innkeeper - stands behind the bar counter
    const ix = INNKEEPER_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const iy = INNKEEPER_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    this.innkeeperSprite = this.add.sprite(ix, iy, "npc").setDepth(5).setScale(1.3);
    this.innkeeperSprite.setTint(0xffcc88);

    tagText(this, ix, iy - TILE_SIZE * 1.2, "INNKEEPER", { size: 8, color: COL.tan, depth: 7 });

    // Notice board sprite
    const bx = NOTICE_BOARD_POS.tx * TILE_SIZE + TILE_SIZE / 2;
    const by = NOTICE_BOARD_POS.ty * TILE_SIZE + TILE_SIZE / 2;
    this.boardSprite = this.add.sprite(bx, by, "notice_board").setDepth(5).setScale(1.4);

    tagText(this, bx, by - TILE_SIZE * 1.2, "NOTICE BOARD", { size: 8, color: COL.cream, depth: 6 });

    // Quest board glow - draws attention
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
    const questHint = tagText(this, bx, by + TILE_SIZE * 0.8, "[E] QUESTS", { size: 8, color: COL.cream, depth: 6, padX: 4, padY: 3 });
    this.tweens.add({
      targets: questHint, alpha: 0.4,
      duration: 1000, yoyo: true, repeat: -1,
    });

    // Innkeeper idle - gentle lateral sway behind bar
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

      tagText(this, px, py - TILE_SIZE, p.name.toUpperCase(), { size: 8, color: COL.grey, depth: 6 });

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
    // Portal centre (rows 12-13, cols 12-15 -> centre ~ col 13.5, row 12.5)
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
    const label = tagText(this, portalCx, portalCy - TILE_SIZE * 2.2, "ENTER DUNGEON", {
      size: 16, color: COL.orchid, fill: COL.plum, padX: 8, padY: 4, depth: 10,
    });

    this.tweens.add({
      targets: label,
      alpha: 0.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Walk-on hint
    uiText(this, portalCx, portalCy - TILE_SIZE * 1.2, "WALK ONTO PORTAL", {
      size: 8, color: COL.violet, originX: 0.5, originY: 0.5, depth: 10,
    });
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

  // -- Camera ----------------------------------------------------------------

  private setupCamera(totalW: number, totalH: number) {
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    // Zoom stays 1: a fractional zoom smears pixel art and shifts the screen-fixed panels.
    // No fog - tavern is fully lit
  }

  // -- Stats Panel -----------------------------------------------------------

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
      `${cls.name.toUpperCase()}  LV ${s.level}`,
      `HP ${Math.ceil(s.hp)}/${s.maxHp}`,
      `GOLD ${s.gold}G`,
      `POTIONS ${s.potions}  MANA ${s.manaPotions}`,
    ];
    const panelW = 280;
    const panelH = lines.length * 20 + 16;

    this.statsPanel.add(flatPanel(this, x - panelW / 2, y + panelH / 2, panelW, panelH, {
      fill: COL.ink, border: COL.slate, alpha: 0.9,
    }));

    lines.forEach((line, i) => {
      this.statsPanel.add(uiText(this, x - 12, y + 10 + i * 20, line, {
        size: 16, color: i === 0 ? COL.gold : COL.silver, originX: 1,
      }));
    });
  }

  // -- Interact Prompt -------------------------------------------------------

  private buildPromptText() {
    const x = this.scale.width / 2;
    const y = this.scale.height - 40;
    this.promptBg = flatPanel(this, x, y, 120, 40, { fill: COL.black, border: COL.slate, alpha: 0.9 })
      .setDepth(99).setScrollFactor(0).setVisible(false);
    this.interactPrompt = uiText(this, x, y, "", { size: 16, color: COL.white, originX: 0.5, originY: 0.5, depth: 100 })
      .setScrollFactor(0).setVisible(false);
  }

  private showPrompt(text: string) {
    const clean = asciiOnly(text);
    if (this.interactPrompt.text !== clean) {
      this.interactPrompt.setText(clean);
      this.promptBg.setSize(this.interactPrompt.width + 32, 40);
    }
    this.interactPrompt.setVisible(true);
    this.promptBg.setVisible(true);
  }

  private hidePrompt() {
    this.interactPrompt.setVisible(false);
    this.promptBg.setVisible(false);
  }

  // -- Update ----------------------------------------------------------------

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
    // Check _dungeonChoiceOpen BEFORE JustDown - JustDown consumes the keypress
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
      this.showPrompt("ESC - CLOSE");
    } else if (this.nearInnkeeper) {
      this.showPrompt("E - TALK TO THE INNKEEPER (SHOP)");
    } else if (this.nearBoard) {
      this.showPrompt("E - READ THE NOTICE BOARD");
    } else if (this.nearEntrance) {
      this.showPrompt("WALK ONTO THE GLOWING PORTAL TO ENTER THE DUNGEON");
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

  // -- Shop ------------------------------------------------------------------

  private openShop() {
    this.closeAllPanels();
    const W = this.scale.width;
    const H = this.scale.height;
    const classKey = this.playerStats.classKey;
    const available = SHOP_ITEMS.filter(i => !i.classFilter || i.classFilter.includes(classKey));
    const panelW = 480;
    const panelH = 160 + available.length * 48;
    const cx = W / 2;
    const cy = H / 2;

    this.shopPanel = this.add.container(cx, cy).setDepth(200).setScrollFactor(0);
    const panel = this.shopPanel;

    panel.add(flatPanel(this, 0, 0, panelW, panelH, { fill: COL.ink, border: COL.brown, alpha: 0.97 }));
    panel.add(uiText(this, 0, -panelH / 2 + 28, "INNKEEPER'S SHOP", { size: 24, color: COL.tan, originX: 0.5, originY: 0.5 }));
    panel.add(uiText(this, 0, -panelH / 2 + 60, `GOLD: ${this.playerStats.gold}G`, { size: 16, color: COL.gold, originX: 0.5, originY: 0.5 }));

    available.forEach((item, i) => {
      const itemY = -panelH / 2 + 104 + i * 48;
      const canAfford = this.playerStats.gold >= item.cost;

      const itemBg = flatPanel(this, 0, itemY, panelW - 32, 40, {
        fill: COL.dusk, border: canAfford ? COL.grey : COL.slate,
      }).setInteractive();
      panel.add(itemBg);

      panel.add(uiText(this, -panelW / 2 + 28, itemY, item.label.toUpperCase(), {
        size: 16, color: canAfford ? COL.white : COL.grey, originY: 0.5,
      }));
      panel.add(uiText(this, panelW / 2 - 28, itemY, `${item.cost}G`, {
        size: 16, color: canAfford ? COL.gold : COL.umber, originX: 1, originY: 0.5,
      }));

      if (canAfford) {
        itemBg.on("pointerover", () => itemBg.setFillStyle(COL.slate));
        itemBg.on("pointerout", () => itemBg.setFillStyle(COL.dusk));
        itemBg.on("pointerdown", () => {
          this.playerStats.gold -= item.cost;
          item.action(this.playerStats);
          Sfx.play("gold");
          // Refresh panel
          this.openShop();
        });
      }
    });

    // Full-width close bar (x=0 keeps hit-testing simple for a screen-fixed panel)
    const close = retroButton(this, 0, panelH / 2 - 32, panelW - 32, 40, "CLOSE (ESC)", () => this.closeAllPanels(), {
      fill: COL.blood, hoverFill: COL.red, border: COL.red, color: COL.rose, hoverColor: COL.white,
    });
    panel.add(close.box);
    panel.add(close.label);
  }

  // -- Quest Board ------------------------------------------------------------

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

    const panelW = 680;
    const cardH = 92;
    const gap = 6;
    const panelH = 96 + _boardQuests.length * (cardH + gap);

    this.questPanel = this.add.container(W / 2, H / 2).setDepth(200).setScrollFactor(0);
    const panel = this.questPanel;

    panel.add(flatPanel(this, 0, 0, panelW, panelH, { fill: COL.ink, border: COL.brown, alpha: 0.97 }));
    panel.add(uiText(this, 0, -panelH / 2 + 28, "QUEST BOARD", { size: 24, color: COL.cream, originX: 0.5, originY: 0.5 }));

    const close = retroButton(this, panelW / 2 - 96, -panelH / 2 + 28, 160, 32, "CLOSE (ESC)", () => this.closeAllPanels(), {
      fill: COL.blood, hoverFill: COL.red, border: COL.red, color: COL.rose, hoverColor: COL.white,
    });
    panel.add(close.box);
    panel.add(close.label);

    _boardQuests.forEach((q, i) => {
      const qy = -panelH / 2 + 56 + cardH / 2 + i * (cardH + gap);
      const rarityColor = RARITY_COLORS[q.rarity];
      const left = -panelW / 2 + 24;

      // Check if already active
      const isActive = s.activeQuests!.some(aq => aq.id === q.id);

      // Card background: full-width interactive for accepting
      const cardFill = isActive ? COL.pine : COL.dusk;
      const cardBg = flatPanel(this, 0, qy, panelW - 24, cardH, {
        fill: cardFill, border: isActive ? COL.lime : rarityColor,
      }).setInteractive();
      panel.add(cardBg);

      if (!isActive) {
        cardBg.on("pointerover", () => cardBg.setFillStyle(COL.slate));
        cardBg.on("pointerout", () => cardBg.setFillStyle(COL.dusk));
        cardBg.on("pointerdown", () => {
          this.acceptQuest(q);
          Sfx.play("ui_select");
          this.openQuestBoard(); // refresh panel
        });
      }

      // Rarity badge
      panel.add(uiText(this, left, qy - cardH / 2 + 8, RARITY_LABELS[q.rarity], { size: 8, color: rarityColor }));

      // Title
      panel.add(uiText(this, left, qy - cardH / 2 + 20, q.title.toUpperCase(), {
        size: 16, color: isActive ? COL.lime : rarityColor, maxWidth: panelW - 240,
      }));

      // Description
      panel.add(uiText(this, left, qy - cardH / 2 + 42, q.description, {
        size: 8, color: COL.silver, maxWidth: panelW - 240,
      }));

      // Rewards
      panel.add(uiText(this, left, qy + cardH / 2 - 22, `${q.rewardGold}G  +${q.rewardXP}XP`, {
        size: 16, color: COL.gold,
      }));

      // Status label on right side
      if (isActive) {
        panel.add(uiText(this, panelW / 2 - 36, qy, "ACCEPTED", {
          size: 16, color: COL.lime, originX: 1, originY: 0.5,
        }));
      } else {
        panel.add(uiText(this, panelW / 2 - 36, qy, "CLICK TO\nACCEPT", {
          size: 16, color: COL.cream, originX: 1, originY: 0.5, center: true,
        }));
      }
    });
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
    if (this.shopPanel || this.questPanel) Sfx.play("ui_back");
    if (this.shopPanel) { this.shopPanel.destroy(); this.shopPanel = undefined; }
    if (this.questPanel) { this.questPanel.destroy(); this.questPanel = undefined; }
  }

  // -- Portal Step - Continue or New -----------------------------------------

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

    const dlg = this.add.container(W / 2, H / 2).setDepth(200).setScrollFactor(0);
    this._dungeonChoiceDialog = dlg;

    dlg.add(this.add.rectangle(0, 0, W, H, 0x000000, 0.55));
    dlg.add(flatPanel(this, 0, 0, 640, 340, { fill: COL.ink, border: COL.violet, alpha: 0.97 }));
    dlg.add(uiText(this, 0, -132, 'DUNGEON ENTRANCE', { size: 24, color: COL.orchid, originX: 0.5, originY: 0.5 }));
    dlg.add(uiText(this, 0, -96, `ACTIVE EXPEDITION - FLOOR ${deepestFloor}`, { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }));

    // Continue button
    const contBg = flatPanel(this, -160, 20, 280, 150, { fill: COL.navy, border: COL.sky }).setInteractive();
    dlg.add(contBg);
    dlg.add(uiText(this, -160, -30, 'CONTINUE', { size: 24, color: COL.sky, originX: 0.5, originY: 0.5 }));
    dlg.add(uiText(this, -160, 20, [
      `RESUME FLOOR ${deepestFloor}`,
      'STATE KEPT AS',
      'YOU LEFT IT',
    ].join('\n'), { size: 16, color: COL.ice, originX: 0.5, originY: 0, center: true }));
    contBg.on('pointerover', () => contBg.setFillStyle(COL.blue));
    contBg.on('pointerout', () => contBg.setFillStyle(COL.navy));
    contBg.on('pointerdown', () => { this.closeDungeonChoice(); this.enterDungeon(true); });

    // New dungeon button
    const newBg = flatPanel(this, 160, 20, 280, 150, { fill: COL.plum, border: COL.orchid }).setInteractive();
    dlg.add(newBg);
    dlg.add(uiText(this, 160, -30, 'NEW DUNGEON', { size: 24, color: COL.orchid, originX: 0.5, originY: 0.5 }));
    dlg.add(uiText(this, 160, 20, [
      'FRESH FROM FLOOR 1',
      'ALL FLOORS RESET',
      'KEEP GEAR + LEVELS',
    ].join('\n'), { size: 16, color: COL.rose, originX: 0.5, originY: 0, center: true }));
    newBg.on('pointerover', () => newBg.setFillStyle(COL.violet));
    newBg.on('pointerout', () => newBg.setFillStyle(COL.plum));
    newBg.on('pointerdown', () => { this.closeDungeonChoice(); this.enterDungeon(false); });

    // ESC hint
    dlg.add(uiText(this, 0, 138, 'ESC - CLOSE', { size: 8, color: COL.grey, originX: 0.5, originY: 0.5 }));
  }

  private closeDungeonChoice() {
    this._dungeonChoiceDialog?.destroy();
    this._dungeonChoiceDialog = undefined;
    this._dungeonChoiceOpen = false;
  }

  // -- Enter Dungeon ---------------------------------------------------------

  /** @param continueSaved - true = resume saved dungeon, false = fresh generation */
  private enterDungeon(continueSaved: boolean) {
    if (this._enteringDungeon) return;
    this._enteringDungeon = true;

    const persistedStats = this.player.getSerializable();
    persistedStats.saveSlot = this.saveSlot;

    if (!continueSaved) {
      // Clear all saved dungeon floors - fresh generation
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
    // Server when signed in, this device otherwise (SaveStore decides).
    await saveGame(this.saveSlot, stats);
  }

  // -- HUD Events ------------------------------------------------------------

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
