import * as Phaser from "phaser";

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const { width, height } = this.scale;

    // Background
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f);

    // Atmospheric elements
    for (let i = 0; i < 20; i++) {
      this.add.rectangle(
        Math.random() * width, Math.random() * height,
        1, 1, 0x333355, Math.random() * 0.5 + 0.2
      );
    }

    // Title
    this.add.text(width / 2, height * 0.22, "DUNGEON CRAWLER", {
      fontSize: "42px",
      color: "#ffd700",
      fontFamily: "monospace",
      stroke: "#000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    // Flavour text
    this.add.text(width / 2, height * 0.35, '"The dungeon awaits. Few return."', {
      fontSize: "14px",
      color: "#555577",
      fontFamily: "monospace",
      fontStyle: "italic",
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(width / 2, height * 0.44, "D&D 3e — Procedurally Generated", {
      fontSize: "13px",
      color: "#444466",
      fontFamily: "monospace",
    }).setOrigin(0.5);

    // NEW GAME → CharacterSelectScene
    this.createButton(width / 2, height * 0.56, "NEW GAME", () => {
      this.scene.start("CharacterSelectScene");
    });

    // Controls hint
    const controls = [
      "WASD / Arrows — Move",
      "Space / Click — Attack",
      "E — Open chest",
      "Q/W/E/R — Spells",
      "T — Turn Undead (Cleric)",
    ].join("     ");

    this.add.text(width / 2, height * 0.82, controls, {
      fontSize: "11px",
      color: "#444444",
      fontFamily: "monospace",
    }).setOrigin(0.5);

    // Class icons preview
    const classes = [
      { label: 'F', name: 'Fighter', color: '#ef5350' },
      { label: 'T', name: 'Thief', color: '#78909c' },
      { label: 'W', name: 'Wizard', color: '#42a5f5' },
      { label: 'C', name: 'Cleric', color: '#ffca28' },
    ];

    const classStartX = width / 2 - (classes.length * 80) / 2 + 40;
    classes.forEach((cls, i) => {
      const cx = classStartX + i * 80;
      const cy = height * 0.70;

      this.add.rectangle(cx, cy, 60, 48, 0x111122).setStrokeStyle(1, 0x333355);
      this.add.text(cx, cy - 8, cls.label, {
        fontSize: '20px', color: cls.color, fontFamily: 'monospace',
      }).setOrigin(0.5);
      this.add.text(cx, cy + 12, cls.name, {
        fontSize: '9px', color: '#666688', fontFamily: 'monospace',
      }).setOrigin(0.5);
    });
  }

  private createButton(x: number, y: number, label: string, onClick: () => void) {
    const bg = this.add.rectangle(x, y, 240, 48, 0x1a1a2e).setInteractive();
    const border = this.add.rectangle(x, y, 240, 48).setStrokeStyle(2, 0x4fc3f7);
    const text = this.add.text(x, y, label, {
      fontSize: "20px",
      color: "#4fc3f7",
      fontFamily: "monospace",
    }).setOrigin(0.5);

    bg.on("pointerover", () => { bg.setFillStyle(0x162040); text.setColor("#ffffff"); });
    bg.on("pointerout", () => { bg.setFillStyle(0x1a1a2e); text.setColor("#4fc3f7"); });
    bg.on("pointerdown", onClick);

    return { bg, border, text };
  }
}
