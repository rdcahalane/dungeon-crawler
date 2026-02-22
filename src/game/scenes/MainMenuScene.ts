import * as Phaser from "phaser";
import { COLORS } from "../constants";

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const { width, height } = this.scale;

    // Background
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f);

    // Title
    this.add
      .text(width / 2, height * 0.25, "DUNGEON CRAWLER", {
        fontSize: "42px",
        color: "#ffd700",
        fontFamily: "monospace",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.38, "An endless dungeon awaits", {
        fontSize: "16px",
        color: "#aaaaaa",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    // Buttons
    this.createButton(width / 2, height * 0.55, "NEW GAME", () => {
      this.scene.start("GameScene", { floor: 1, loadedState: null });
    });

    // Controls hint
    const controls = [
      "WASD / Arrow Keys — Move",
      "Space / Click — Attack",
      "Step on ▲ — Next Floor",
    ].join("     ");

    this.add
      .text(width / 2, height * 0.82, controls, {
        fontSize: "12px",
        color: "#666666",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void
  ) {
    const bg = this.add.rectangle(x, y, 220, 44, 0x1a1a2e).setInteractive();
    const border = this.add.rectangle(x, y, 220, 44).setStrokeStyle(2, 0x4fc3f7);
    const text = this.add
      .text(x, y, label, {
        fontSize: "18px",
        color: "#4fc3f7",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    bg.on("pointerover", () => {
      bg.setFillStyle(0x162040);
      text.setColor("#ffffff");
    });
    bg.on("pointerout", () => {
      bg.setFillStyle(0x1a1a2e);
      text.setColor("#4fc3f7");
    });
    bg.on("pointerdown", onClick);

    return { bg, border, text };
  }
}
