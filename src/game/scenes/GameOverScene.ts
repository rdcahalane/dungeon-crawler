import * as Phaser from "phaser";

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameOverScene" });
  }

  init(data: { floor?: number; kills?: number; level?: number }) {
    const floor = data?.floor ?? 1;
    const kills = data?.kills ?? 0;
    const level = data?.level ?? 1;
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f, 0.95);

    this.add
      .text(width / 2, height * 0.25, "YOU DIED", {
        fontSize: "52px",
        color: "#f44336",
        fontFamily: "monospace",
        stroke: "#000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const stats = [
      `Floor reached:  ${floor}`,
      `Enemies killed: ${kills}`,
      `Level:          ${level}`,
    ];

    stats.forEach((line, i) => {
      this.add
        .text(width / 2, height * 0.45 + i * 28, line, {
          fontSize: "16px",
          color: "#aaaaaa",
          fontFamily: "monospace",
        })
        .setOrigin(0.5);
    });

    // Play Again button
    const bg = this.add
      .rectangle(width / 2, height * 0.72, 200, 44, 0x1a1a2e)
      .setInteractive();
    this.add.rectangle(width / 2, height * 0.72, 200, 44).setStrokeStyle(2, 0xf44336);
    const txt = this.add
      .text(width / 2, height * 0.72, "PLAY AGAIN", {
        fontSize: "18px",
        color: "#f44336",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    bg.on("pointerover", () => { bg.setFillStyle(0x2a0a0a); txt.setColor("#ffffff"); });
    bg.on("pointerout", () => { bg.setFillStyle(0x1a1a2e); txt.setColor("#f44336"); });
    bg.on("pointerdown", () => {
      this.scene.start("CharacterSelectScene");
    });

    // Menu button
    const menuBg = this.add
      .rectangle(width / 2, height * 0.84, 200, 40, 0x111111)
      .setInteractive();
    this.add.rectangle(width / 2, height * 0.84, 200, 40).setStrokeStyle(1, 0x555555);
    const menuTxt = this.add
      .text(width / 2, height * 0.84, "MAIN MENU", {
        fontSize: "15px",
        color: "#666666",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    menuBg.on("pointerover", () => { menuBg.setFillStyle(0x1a1a1a); menuTxt.setColor("#aaaaaa"); });
    menuBg.on("pointerout", () => { menuBg.setFillStyle(0x111111); menuTxt.setColor("#666666"); });
    menuBg.on("pointerdown", () => this.scene.start("MainMenuScene"));
  }

  create() {}
}
