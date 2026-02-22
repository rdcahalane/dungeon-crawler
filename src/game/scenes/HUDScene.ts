import * as Phaser from "phaser";
import { COLORS } from "../constants";
import type { GameScene } from "./GameScene";

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
}

export class HUDScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private xpBar!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private zoomLabel!: Phaser.GameObjects.Text;

  private readonly BAR_W = 200;
  private readonly BAR_H = 12;
  private readonly PAD = 12;
  private readonly BTN = 26;

  constructor() {
    super({ key: "HUDScene" });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const { BAR_W, BAR_H, PAD, BTN } = this;

    // HP bar
    this.hpBar = this.add.rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 2.5, BAR_W, BAR_H, COLORS.HP_BAR_BG).setDepth(0);
    this.hpBarFill = this.add.rectangle(PAD, H - PAD - BAR_H * 2.5, BAR_W, BAR_H, COLORS.HP_BAR).setOrigin(0, 0.5).setDepth(1);

    // XP bar
    this.xpBar = this.add.rectangle(PAD + BAR_W / 2, H - PAD - BAR_H * 0.5, BAR_W, BAR_H * 0.7, COLORS.HP_BAR_BG).setDepth(0);
    this.xpBarFill = this.add.rectangle(PAD, H - PAD - BAR_H * 0.5, BAR_W, BAR_H * 0.7, COLORS.XP_BAR).setOrigin(0, 0.5).setDepth(1);

    // Text
    this.hpText = this.add.text(PAD + BAR_W + 8, H - PAD - BAR_H * 2.5, "", { fontSize: "12px", color: "#ffffff", fontFamily: "monospace" }).setOrigin(0, 0.5).setDepth(2);
    this.levelText = this.add.text(PAD, H - PAD - BAR_H * 4, "", { fontSize: "12px", color: "#aaaaaa", fontFamily: "monospace" }).setDepth(2);
    this.floorText = this.add.text(W - PAD, PAD, "", { fontSize: "14px", color: "#ffd700", fontFamily: "monospace" }).setOrigin(1, 0).setDepth(2);
    this.killsText = this.add.text(W - PAD, PAD + 22, "", { fontSize: "12px", color: "#aaaaaa", fontFamily: "monospace" }).setOrigin(1, 0).setDepth(2);
    this.statusText = this.add.text(W / 2, H * 0.15, "", { fontSize: "14px", color: "#cccccc", fontFamily: "monospace" }).setOrigin(0.5).setDepth(2);

    // Zoom controls
    this.zoomLabel = this.add.text(W - PAD - BTN * 1.75, H - PAD - BTN * 1.6, "100%", { fontSize: "11px", color: "#666688", fontFamily: "monospace" }).setOrigin(0.5).setDepth(2);
    this.createZoomButton(W - PAD - BTN * 2.4, H - PAD - BTN / 2, "−", -0.15);
    this.createZoomButton(W - PAD - BTN * 1.1, H - PAD - BTN / 2, "+", 0.15);

    // Listen to GameScene events
    this.attachToGameScene();
  }

  private createZoomButton(x: number, y: number, label: string, delta: number) {
    const bg = this.add.rectangle(x, y, this.BTN, this.BTN, 0x1a1a2e).setDepth(2).setInteractive();
    this.add.rectangle(x, y, this.BTN, this.BTN).setStrokeStyle(1, 0x444466).setDepth(3);
    this.add.text(x, y, label, { fontSize: "18px", color: "#aaaacc", fontFamily: "monospace" }).setOrigin(0.5).setDepth(4);

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
    const game = this.scene.get("GameScene") as GameScene;
    if (!game) return;

    game.events.on("hud:update", this.onUpdate, this);
    game.events.on("hud:status", this.onStatus, this);
    game.events.on("hud:zoom", (zoom: number) => {
      this.zoomLabel.setText(`${Math.round(zoom * 100)}%`);
    });
    // Re-attach after scene restart
    game.events.once("shutdown", () => {
      this.scene.restart();
    });
  }

  private onUpdate(data: HUDData) {
    const hpPct = data.hp / data.maxHp;
    this.hpBarFill.setDisplaySize(this.BAR_W * hpPct, this.BAR_H);
    this.hpBarFill.setFillStyle(hpPct > 0.5 ? COLORS.HP_BAR : hpPct > 0.25 ? 0xffa726 : COLORS.HP_BAR_LOW);

    const xpPct = data.xp / data.xpToNext;
    this.xpBarFill.setDisplaySize(this.BAR_W * xpPct, this.BAR_H * 0.7);

    this.hpText.setText(`${data.hp}/${data.maxHp}`);
    this.levelText.setText(`LV ${data.level}  ATK ${data.attack}  DEF ${data.defense}`);
    this.floorText.setText(`Floor ${data.floor}`);
    this.killsText.setText(`Kills: ${data.kills}`);
  }

  private onStatus(msg: string) {
    this.statusText.setText(msg);
    this.time.delayedCall(2000, () => {
      if (this.statusText) this.statusText.setText("");
    });
  }
}
