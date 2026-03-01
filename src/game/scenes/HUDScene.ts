import * as Phaser from "phaser";
import { COLORS, SPELLS, SpellKey, STATUS_EFFECT_DEFS } from "../constants";
import type { GameScene } from "./GameScene";
import type { StatusEffect } from "../constants";
import type { Quest, InventoryItem } from "../systems/QuestSystem";
import { RARITY_COLORS } from "../systems/QuestSystem";

export interface HUDData {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  xpToNext: number;
  floor: number;
  kills: number;
  mana: number;
  maxMana: number;
  classKey: string;
  name?: string;
  effects: StatusEffect[];
  spellKeys: SpellKey[];
  spellCooldowns: number[];
  spellManaCosts: number[];
  potions?: number;
  manaPotions?: number;
  gold?: number;
  activeQuests?: Quest[];
  completedQuests?: Quest[];
  inventory?: InventoryItem[];
  equippedWeaponLabel?: string;
  equippedArmorLabel?: string;
}

const CLASS_ICONS: Record<string, string> = {
  fighter: 'F',
  thief: 'T',
  wizard: 'W',
  cleric: 'C',
};

const CLASS_COLORS: Record<string, string> = {
  fighter: '#ef5350',
  thief: '#78909c',
  wizard: '#42a5f5',
  cleric: '#ffca28',
};

export class HUDScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private manaBar!: Phaser.GameObjects.Rectangle;
  private manaBarFill!: Phaser.GameObjects.Rectangle;
  private xpBar!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private manaText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private classIcon!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private zoomLabel!: Phaser.GameObjects.Text;
  private questCountText!: Phaser.GameObjects.Text;

  // Status effect icons
  private effectIcons: Phaser.GameObjects.Text[] = [];
  private effectTimers: Phaser.GameObjects.Text[] = [];

  // Spell bar
  private spellSlots: {
    bg: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
    hotkey: Phaser.GameObjects.Text;
    cooldownOverlay: Phaser.GameObjects.Rectangle;
  }[] = [];

  private readonly BAR_W = 200;
  private readonly BAR_H = 12;
  private readonly PAD = 12;
  private readonly BTN = 26;

  private lastClassKey = '';
  private lastSpellKeys: SpellKey[] = [];

  // Panel state
  private _questPanel?: Phaser.GameObjects.Container;
  private _inventoryPanel?: Phaser.GameObjects.Container;
  private _lastHUDData?: HUDData;

  // Hotkeys
  private _jKey?: Phaser.Input.Keyboard.Key;
  private _iKey?: Phaser.Input.Keyboard.Key;
  private _escKey?: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "HUDScene" });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const { BAR_W, BAR_H, PAD, BTN } = this;

    // Class icon (bottom left corner)
    this.classIcon = this.add.text(PAD, H - PAD - BAR_H * 8, '?', {
      fontSize: '20px', color: '#ffffff', fontFamily: 'monospace',
      backgroundColor: '#1a1a2e',
      padding: { x: 6, y: 4 },
    }).setDepth(3);

    // Character name (above class icon)
    this.nameText = this.add.text(PAD + 40, H - PAD - BAR_H * 8 + 4, '', {
      fontSize: '12px', color: '#ccccdd', fontFamily: 'monospace',
    }).setDepth(3);

    // HP bar
    this.hpBar = this.add.rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 5, BAR_W, BAR_H, COLORS.HP_BAR_BG).setDepth(0);
    this.hpBarFill = this.add.rectangle(PAD, H - PAD - BAR_H * 5, BAR_W, BAR_H, COLORS.HP_BAR).setOrigin(0, 0.5).setDepth(1);

    // Mana bar
    this.manaBar = this.add.rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 3.2, BAR_W, BAR_H, COLORS.HP_BAR_BG).setDepth(0);
    this.manaBarFill = this.add.rectangle(PAD, H - PAD - BAR_H * 3.2, BAR_W, BAR_H, COLORS.MANA_BAR).setOrigin(0, 0.5).setDepth(1);

    // XP bar
    this.xpBar = this.add.rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 1.2, BAR_W, BAR_H * 0.7, COLORS.HP_BAR_BG).setDepth(0);
    this.xpBarFill = this.add.rectangle(PAD, H - PAD - BAR_H * 1.2, BAR_W, BAR_H * 0.7, COLORS.XP_BAR).setOrigin(0, 0.5).setDepth(1);

    // Text
    this.hpText = this.add.text(PAD + BAR_W + 8, H - PAD - BAR_H * 5, "", {
      fontSize: '11px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setDepth(2);

    this.manaText = this.add.text(PAD + BAR_W + 8, H - PAD - BAR_H * 3.2, "", {
      fontSize: '11px', color: '#4fc3f7', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setDepth(2).setVisible(false);

    this.levelText = this.add.text(PAD, H - PAD - BAR_H * 6.8, "", {
      fontSize: '11px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setDepth(2);

    this.floorText = this.add.text(W - PAD, PAD, "", {
      fontSize: '14px', color: '#ffd700', fontFamily: 'monospace',
    }).setOrigin(1, 0).setDepth(2);

    this.killsText = this.add.text(W - PAD, PAD + 22, "", {
      fontSize: '12px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(1, 0).setDepth(2);

    // Quest count indicator (next to kills)
    this.questCountText = this.add.text(W - PAD, PAD + 40, "", {
      fontSize: '10px', color: '#66bb6a', fontFamily: 'monospace',
    }).setOrigin(1, 0).setDepth(2);

    // Hotkey bar (top center) — always visible
    this.add.rectangle(W / 2, PAD + 6, 260, 22, 0x0a0a14, 0.75)
      .setStrokeStyle(1, 0x333355).setDepth(2);
    this.add.text(W / 2, PAD + 6, "[J] Quest Log    [I] Inventory", {
      fontSize: '11px', color: '#888899', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(3);

    this.statusText = this.add.text(W / 2, H * 0.15, "", {
      fontSize: '14px', color: '#cccccc', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(2);

    // Zoom controls
    this.zoomLabel = this.add.text(W - PAD - BTN * 1.75, H - PAD - BTN * 1.6, "100%", {
      fontSize: '11px', color: '#666688', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(2);
    this.createZoomButton(W - PAD - BTN * 2.4, H - PAD - BTN / 2, "\u2212", -0.15);
    this.createZoomButton(W - PAD - BTN * 1.1, H - PAD - BTN / 2, "+", 0.15);

    // Hotkeys for panels
    this._jKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this._iKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this._escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.attachToGameScene();
  }

  update() {
    // Panel toggle hotkeys
    if (this._jKey && Phaser.Input.Keyboard.JustDown(this._jKey)) {
      if (this._questPanel) { this.closeQuestPanel(); } else { this.closeInventoryPanel(); this.openQuestPanel(); }
    }
    if (this._iKey && Phaser.Input.Keyboard.JustDown(this._iKey)) {
      if (this._inventoryPanel) { this.closeInventoryPanel(); } else { this.closeQuestPanel(); this.openInventoryPanel(); }
    }
    if (this._escKey && Phaser.Input.Keyboard.JustDown(this._escKey)) {
      this.closeQuestPanel();
      this.closeInventoryPanel();
    }
  }

  private createZoomButton(x: number, y: number, label: string, delta: number) {
    const bg = this.add.rectangle(x, y, this.BTN, this.BTN, 0x1a1a2e).setDepth(2).setInteractive();
    this.add.rectangle(x, y, this.BTN, this.BTN).setStrokeStyle(1, 0x444466).setDepth(3);
    this.add.text(x, y, label, { fontSize: '18px', color: '#aaaacc', fontFamily: 'monospace' }).setOrigin(0.5).setDepth(4);

    bg.on("pointerover", () => bg.setFillStyle(0x2a2a4e));
    bg.on("pointerout", () => bg.setFillStyle(0x1a1a2e));
    bg.on("pointerdown", () => {
      const game = this.scene.get("GameScene") as GameScene;
      if (!game?.cameras?.main) return;
      const next = Phaser.Math.Clamp(game.cameras.main.zoom + delta, 0.4, 2.5);
      game.cameras.main.setZoom(next);
      this.zoomLabel.setText(`${Math.round(next * 100)}%`);
    });
  }

  private attachToGameScene() {
    // Attach to GameScene or TavernScene (whichever is/becomes active)
    const attachTo = (scene: Phaser.Scene | null) => {
      if (!scene) return;
      scene.events.on("hud:update", this.onUpdate, this);
      scene.events.on("hud:status", this.onStatus, this);
      scene.events.on("hud:zoom", (zoom: number) => {
        this.zoomLabel.setText(`${Math.round(zoom * 100)}%`);
      });
      scene.events.once("shutdown", () => this.scene.restart());
    };

    attachTo(this.scene.get("GameScene"));
    attachTo(this.scene.get("TavernScene"));
  }

  private onUpdate(data: HUDData) {
    this._lastHUDData = data;
    const W = this.scale.width;
    const H = this.scale.height;
    const { BAR_W, BAR_H, PAD } = this;

    // HP bar
    const hpPct = data.maxHp > 0 ? data.hp / data.maxHp : 0;
    this.hpBarFill.setDisplaySize(BAR_W * hpPct, BAR_H);
    this.hpBarFill.setFillStyle(hpPct > 0.5 ? COLORS.HP_BAR : hpPct > 0.25 ? 0xffa726 : COLORS.HP_BAR_LOW);
    this.hpText.setText(`${Math.ceil(data.hp)}/${data.maxHp}`);

    // Mana bar
    const hasMana = data.maxMana > 0;
    this.manaBar.setVisible(hasMana);
    this.manaBarFill.setVisible(hasMana);
    this.manaText.setVisible(hasMana);
    if (hasMana) {
      const manaPct = data.mana / data.maxMana;
      this.manaBarFill.setDisplaySize(BAR_W * manaPct, BAR_H);
      this.manaText.setText(`${Math.ceil(data.mana)}/${data.maxMana}`);
    }

    // XP bar
    const xpPct = data.xp / data.xpToNext;
    this.xpBarFill.setDisplaySize(BAR_W * xpPct, BAR_H * 0.7);

    // Class icon
    if (data.classKey !== this.lastClassKey) {
      this.lastClassKey = data.classKey;
      const icon = CLASS_ICONS[data.classKey] ?? '?';
      const color = CLASS_COLORS[data.classKey] ?? '#ffffff';
      this.classIcon.setText(icon).setColor(color);
    }

    // Character name
    if (data.name) {
      this.nameText.setText(data.name);
    }

    if (data.gold !== undefined) this._goldValue = data.gold;

    // Text
    const potStr = data.potions !== undefined ? `  🧪${data.potions}` : '';
    const mpStr = data.manaPotions !== undefined && data.manaPotions > 0 ? `  💧${data.manaPotions}` : '';
    this.levelText.setText(`LV ${data.level}  ATK ${data.attack}  AC ${data.defense}${potStr}${mpStr}`);
    this.floorText.setText(data.floor === 0 ? `The Tavern` : `Floor ${data.floor}`);
    this.killsText.setText(`Kills: ${data.kills}`);

    // Quest count indicator
    const activeCount = data.activeQuests?.length ?? 0;
    this.questCountText.setText(activeCount > 0 ? `Quests: ${activeCount}  [J]log [I]inv` : '[J]log [I]inv');

    // Status effects
    this.updateEffectIcons(data.effects, PAD, H - PAD - BAR_H * 10);

    // Spell bar
    if (data.spellKeys && data.spellKeys.length > 0) {
      if (JSON.stringify(data.spellKeys) !== JSON.stringify(this.lastSpellKeys)) {
        this.lastSpellKeys = [...data.spellKeys];
        this.buildSpellBar(data.spellKeys, W, H);
      }
      this.updateSpellBar(data.spellCooldowns, data.spellManaCosts, data.mana);
    }

    void W; void H;
  }

  private _goldValue = 0;
  private getGold(): number { return this._goldValue; }

  // ── Quest Log Panel (J key) ────────────────────────────────────────────────

  private openQuestPanel() {
    if (this._questPanel) return;
    const data = this._lastHUDData;
    const W = this.scale.width;
    const H = this.scale.height;
    const panelW = 400;

    const activeQuests = data?.activeQuests ?? [];
    const completedQuests = (data?.completedQuests ?? []).slice(-10); // last 10
    const totalEntries = activeQuests.length + completedQuests.length;
    const panelH = Math.min(H - 40, 80 + totalEntries * 62 + (completedQuests.length > 0 ? 30 : 0));

    this._questPanel = this.add.container(W / 2, H / 2).setDepth(200);

    const bg = this.add.rectangle(0, 0, panelW, panelH, 0x0a0a18, 0.96)
      .setStrokeStyle(2, 0x66bb6a);
    this._questPanel.add(bg);

    this._questPanel.add(this.add.text(0, -panelH / 2 + 18, "QUEST LOG  [J]", {
      fontSize: "14px", color: "#66bb6a", fontFamily: "monospace",
    }).setOrigin(0.5));

    let yOff = -panelH / 2 + 44;

    if (activeQuests.length === 0 && completedQuests.length === 0) {
      this._questPanel.add(this.add.text(0, yOff + 20, "No quests yet.\nVisit the Notice Board in the Tavern.", {
        fontSize: "10px", color: "#555566", fontFamily: "monospace", align: "center",
      }).setOrigin(0.5, 0));
    }

    // Active quests
    for (const q of activeQuests) {
      const rarityColor = RARITY_COLORS[q.rarity];
      const rarityHex = `#${rarityColor.toString(16).padStart(6, '0')}`;

      this._questPanel.add(this.add.text(-panelW / 2 + 16, yOff, q.title, {
        fontSize: "11px", color: rarityHex, fontFamily: "monospace",
      }));

      yOff += 16;

      for (const obj of q.objectives) {
        const pct = Math.min(1, obj.currentCount / obj.targetCount);
        const filled = Math.round(pct * 10);
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
        const progressColor = pct >= 1 ? "#66bb6a" : "#aaaacc";
        this._questPanel.add(this.add.text(-panelW / 2 + 20, yOff, `${obj.label}: ${bar} ${obj.currentCount}/${obj.targetCount}`, {
          fontSize: "9px", color: progressColor, fontFamily: "monospace",
        }));
        yOff += 14;
      }

      // Rewards line
      this._questPanel.add(this.add.text(-panelW / 2 + 20, yOff, `Reward: ${q.rewardGold}g +${q.rewardXP}xp`, {
        fontSize: "9px", color: "#ffd700", fontFamily: "monospace",
      }));
      yOff += 20;
    }

    // Completed quests
    if (completedQuests.length > 0) {
      this._questPanel.add(this.add.text(-panelW / 2 + 16, yOff, "--- Completed ---", {
        fontSize: "10px", color: "#444455", fontFamily: "monospace",
      }));
      yOff += 18;

      for (const q of completedQuests) {
        const ts = q.completedAt ? new Date(q.completedAt).toLocaleDateString() : '';
        this._questPanel.add(this.add.text(-panelW / 2 + 20, yOff, `${q.title}  ${ts}`, {
          fontSize: "9px", color: "#444455", fontFamily: "monospace",
        }));
        yOff += 14;
      }
    }

    // Close button
    const closeBtn = this.add.rectangle(panelW / 2 - 20, -panelH / 2 + 18, 30, 22, 0x2a0a0a)
      .setInteractive().setStrokeStyle(1, 0x884444);
    this._questPanel.add(closeBtn);
    this._questPanel.add(this.add.text(panelW / 2 - 20, -panelH / 2 + 18, "\u2715", {
      fontSize: "13px", color: "#ff6666", fontFamily: "monospace",
    }).setOrigin(0.5));
    closeBtn.on("pointerdown", () => this.closeQuestPanel());
  }

  private closeQuestPanel() {
    if (this._questPanel) { this._questPanel.destroy(); this._questPanel = undefined; }
  }

  // ── Inventory Panel (I key) ────────────────────────────────────────────────

  private openInventoryPanel() {
    if (this._inventoryPanel) return;
    const data = this._lastHUDData;
    const W = this.scale.width;
    const H = this.scale.height;
    const panelW = 380;

    const inventory = data?.inventory ?? [];
    const weaponLabel = data?.equippedWeaponLabel ?? 'None';
    const armorLabel = data?.equippedArmorLabel ?? 'None';

    const itemCount = inventory.length;
    const panelH = Math.min(H - 40, 120 + itemCount * 16);

    this._inventoryPanel = this.add.container(W / 2, H / 2).setDepth(200);

    const bg = this.add.rectangle(0, 0, panelW, panelH, 0x0a0a18, 0.96)
      .setStrokeStyle(2, 0x42a5f5);
    this._inventoryPanel.add(bg);

    this._inventoryPanel.add(this.add.text(0, -panelH / 2 + 18, "INVENTORY  [I]", {
      fontSize: "14px", color: "#42a5f5", fontFamily: "monospace",
    }).setOrigin(0.5));

    let yOff = -panelH / 2 + 44;

    // Equipment section
    this._inventoryPanel.add(this.add.text(-panelW / 2 + 16, yOff, "--- Equipment ---", {
      fontSize: "10px", color: "#888899", fontFamily: "monospace",
    }));
    yOff += 18;

    this._inventoryPanel.add(this.add.text(-panelW / 2 + 20, yOff, `Weapon: ${weaponLabel}`, {
      fontSize: "10px", color: "#ffa726", fontFamily: "monospace",
    }));
    yOff += 16;

    this._inventoryPanel.add(this.add.text(-panelW / 2 + 20, yOff, `Armor:  ${armorLabel}`, {
      fontSize: "10px", color: "#78909c", fontFamily: "monospace",
    }));
    yOff += 22;

    // Items section
    this._inventoryPanel.add(this.add.text(-panelW / 2 + 16, yOff, `--- Items (${itemCount}) ---`, {
      fontSize: "10px", color: "#888899", fontFamily: "monospace",
    }));
    yOff += 18;

    if (itemCount === 0) {
      this._inventoryPanel.add(this.add.text(-panelW / 2 + 20, yOff, "No items collected yet.", {
        fontSize: "9px", color: "#555566", fontFamily: "monospace",
      }));
    } else {
      // Show items, newest first
      const sorted = [...inventory].sort((a, b) => b.timestamp - a.timestamp);
      for (const item of sorted) {
        if (yOff > panelH / 2 - 30) break; // clip if too many
        const eqMark = item.equipped ? ' [E]' : '';
        const bonusStr = item.bonus ? ` (+${item.bonus})` : '';
        const color = item.equipped ? '#ffd700' : '#aaaacc';
        this._inventoryPanel.add(this.add.text(-panelW / 2 + 20, yOff,
          `${item.label}${bonusStr}${eqMark}  F${item.floorFound}`, {
          fontSize: "9px", color, fontFamily: "monospace",
        }));
        yOff += 14;
      }
    }

    // Close button
    const closeBtn = this.add.rectangle(panelW / 2 - 20, -panelH / 2 + 18, 30, 22, 0x2a0a0a)
      .setInteractive().setStrokeStyle(1, 0x884444);
    this._inventoryPanel.add(closeBtn);
    this._inventoryPanel.add(this.add.text(panelW / 2 - 20, -panelH / 2 + 18, "\u2715", {
      fontSize: "13px", color: "#ff6666", fontFamily: "monospace",
    }).setOrigin(0.5));
    closeBtn.on("pointerdown", () => this.closeInventoryPanel());
  }

  private closeInventoryPanel() {
    if (this._inventoryPanel) { this._inventoryPanel.destroy(); this._inventoryPanel = undefined; }
  }

  // ── Status Effects ─────────────────────────────────────────────────────────

  private updateEffectIcons(effects: StatusEffect[], startX: number, startY: number) {
    // Destroy old icons
    this.effectIcons.forEach(e => e.destroy());
    this.effectTimers.forEach(e => e.destroy());
    this.effectIcons = [];
    this.effectTimers = [];

    effects.forEach((eff, i) => {
      const def = STATUS_EFFECT_DEFS[eff.key];
      if (!def) return;

      const x = startX + i * 38;
      const colorHex = `#${def.color.toString(16).padStart(6, '0')}`;

      const icon = this.add.text(x, startY, def.icon, {
        fontSize: '13px', color: colorHex, fontFamily: 'monospace',
        backgroundColor: '#00000088',
        padding: { x: 3, y: 2 },
      }).setDepth(3);
      this.effectIcons.push(icon);

      const secs = Math.ceil(eff.duration / 1000);
      const timer = this.add.text(x + 4, startY + 18, `${secs}s`, {
        fontSize: '9px', color: '#888888', fontFamily: 'monospace',
      }).setDepth(3);
      this.effectTimers.push(timer);
    });
  }

  // ── Spell Bar ──────────────────────────────────────────────────────────────

  private buildSpellBar(keys: SpellKey[], W: number, H: number) {
    // Clear old
    this.spellSlots.forEach(s => {
      s.bg.destroy(); s.label.destroy(); s.cost.destroy();
      s.hotkey.destroy(); s.cooldownOverlay.destroy();
    });
    this.spellSlots = [];

    const slotW = 64;
    const slotH = 50;
    const startX = W / 2 - (keys.length * (slotW + 4)) / 2;
    const y = H - 36;
    const hotkeyLabels = ['Q', 'W', 'E', 'R'];

    keys.forEach((spellKey, i) => {
      const spell = SPELLS[spellKey];
      if (!spell) return;

      const x = startX + i * (slotW + 4);
      const color = spell.color;
      const colorHex = `#${color.toString(16).padStart(6, '0')}`;

      const bg = this.add.rectangle(x + slotW / 2, y, slotW, slotH, 0x0e0e1e)
        .setStrokeStyle(1, color).setDepth(3);

      const hotkey = this.add.text(x + 5, y - slotH / 2 + 6, hotkeyLabels[i] ?? '', {
        fontSize: '10px', color: '#888888', fontFamily: 'monospace',
      }).setDepth(4);

      const label = this.add.text(x + slotW / 2, y - 6, spell.name.split(' ').map(w => w[0]).join(''), {
        fontSize: '14px', color: colorHex, fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(4);

      const cost = this.add.text(x + slotW / 2, y + 12, `${spell.manaCost}mp`, {
        fontSize: '9px', color: '#4fc3f7', fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(4);

      const cooldownOverlay = this.add.rectangle(x + slotW / 2, y, slotW - 2, slotH - 2, 0x000000, 0)
        .setDepth(5);

      this.spellSlots.push({ bg, label, cost, hotkey, cooldownOverlay });
    });
  }

  private updateSpellBar(cooldowns: number[], costs: number[], currentMana: number) {
    this.spellSlots.forEach((slot, i) => {
      const cd = cooldowns[i] ?? 0;
      const cost = costs[i] ?? 0;
      const canCast = cd <= 0 && currentMana >= cost;

      if (cd > 0) {
        // Show cooldown overlay
        slot.cooldownOverlay.setAlpha(0.5);
        slot.label.setText(`${Math.ceil(cd / 1000)}s`);
      } else {
        slot.cooldownOverlay.setAlpha(0);
        // Restore spell initials
      }

      if (!canCast && cd <= 0) {
        slot.bg.setAlpha(0.4);
      } else {
        slot.bg.setAlpha(1);
      }
    });
  }

  private onStatus(msg: string) {
    this.statusText.setText(msg);
    this.time.delayedCall(2500, () => {
      if (this.statusText) this.statusText.setText("");
    });
  }
}
