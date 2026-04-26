import * as Phaser from "phaser";

interface SaveMeta {
  slot: number;
  name: string;
  level: number;
  floor: number;
  updatedAt: string;
}

const CLASS_ICONS: Record<string, string> = { fighter: '⚔', thief: '🗡', wizard: '✨', cleric: '✝' };
const CLASS_COLORS: Record<string, string> = {
  fighter: '#ef5350', thief: '#90a4ae', wizard: '#42a5f5', cleric: '#ffca28',
};

export class GameOverScene extends Phaser.Scene {
  private floor = 1;
  private kills = 0;
  private level = 1;
  private gold = 0;
  private bestStreak = 0;
  private relics: string[] = [];
  private optionsContainer!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "GameOverScene" });
  }

  init(data: { floor?: number; kills?: number; level?: number; gold?: number; bestStreak?: number; relics?: string[] }) {
    this.floor = data?.floor ?? 1;
    this.kills = data?.kills ?? 0;
    this.level = data?.level ?? 1;
    this.gold = data?.gold ?? 0;
    this.bestStreak = data?.bestStreak ?? 0;
    this.relics = data?.relics ?? [];
  }

  create() {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f, 0.95);

    this.add
      .text(width / 2, height * 0.18, "YOU DIED", {
        fontSize: "52px",
        color: "#f44336",
        fontFamily: "monospace",
        stroke: "#000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

	    const stats = [
	      `Floor reached:  ${this.floor}`,
	      `Enemies killed: ${this.kills}`,
	      `Level:          ${this.level}`,
      `Gold hauled:    ${this.gold}`,
      `Best streak:    ${this.bestStreak}`,
      `Relics found:   ${this.relics.length}`,
	    ];

    stats.forEach((line, i) => {
      this.add
        .text(width / 2, height * 0.32 + i * 28, line, {
          fontSize: "16px",
          color: "#aaaaaa",
          fontFamily: "monospace",
        })
        .setOrigin(0.5);
    });

    this.optionsContainer = this.add.container(0, 0);

    // Render buttons immediately (no saves yet), then fetch saves
    this.renderOptions([]);
    this.loadSaves();
  }

  private async loadSaves() {
    try {
      const res = await fetch("/api/saves");
      if (res.status === 401) {
        // Not logged in — just show default buttons
        return;
      }
      const data = (await res.json()) as { saves: (SaveMeta | null)[] };
      const saves = (data.saves ?? []).filter((s): s is SaveMeta => s !== null);
      this.renderOptions(saves);
    } catch {
      // Offline or error — keep default buttons
    }
  }

  private renderOptions(saves: SaveMeta[]) {
    this.optionsContainer.removeAll(true);

    const { width, height } = this.scale;
    let cursorY = height * 0.56;

    // -- Saved characters section --
    if (saves.length > 0) {
      this.optionsContainer.add(
        this.add
          .text(width / 2, cursorY, "── SAVED CHARACTERS ──", {
            fontSize: "13px",
            color: "#aaaacc",
            fontFamily: "monospace",
          })
          .setOrigin(0.5)
      );
      cursorY += 28;

      const rowW = 360;
      const rowH = 36;

      for (const save of saves.slice(0, 5)) {
        const cy = cursorY;
        const classKey = this.detectClass(save.name);
        const icon = CLASS_ICONS[classKey] ?? '?';
        const color = CLASS_COLORS[classKey] ?? '#ffffff';
        const floorStr = save.floor === 0 ? 'Tavern' : `Floor ${save.floor}`;

        // Row background
        const rowBg = this.add
          .rectangle(width / 2, cy, rowW, rowH, 0x101830)
          .setInteractive({ useHandCursor: true })
          .setStrokeStyle(1, 0x4466aa);
        this.optionsContainer.add(rowBg);

        // Icon
        const leftX = width / 2 - rowW / 2 + 12;
        this.optionsContainer.add(
          this.add.text(leftX, cy, icon, {
            fontSize: '16px', fontFamily: 'monospace',
          }).setOrigin(0, 0.5)
        );

        // Name
        this.optionsContainer.add(
          this.add.text(leftX + 26, cy, save.name, {
            fontSize: '12px', color, fontFamily: 'monospace',
          }).setOrigin(0, 0.5)
        );

        // Level / Floor
        this.optionsContainer.add(
          this.add.text(width / 2 + 40, cy, `Lv ${save.level} / ${floorStr}`, {
            fontSize: '10px', color: '#888899', fontFamily: 'monospace',
          }).setOrigin(0, 0.5)
        );

        // LOAD button label
        this.optionsContainer.add(
          this.add.text(width / 2 + rowW / 2 - 10, cy, 'LOAD ▶', {
            fontSize: '10px', color: '#4488cc', fontFamily: 'monospace',
          }).setOrigin(1, 0.5)
        );

        rowBg.on("pointerover", () => rowBg.setFillStyle(0x18243a));
        rowBg.on("pointerout", () => rowBg.setFillStyle(0x101830));
        rowBg.on("pointerdown", () => this.loadSave(save.slot));

        cursorY += rowH + 6;
      }

      cursorY += 10;
    }

    // -- NEW CHARACTER button (green, prominent) --
    const newBtnW = 260;
    const newBtnH = 44;
    const newBg = this.add
      .rectangle(width / 2, cursorY, newBtnW, newBtnH, 0x0a1a0a)
      .setInteractive({ useHandCursor: true });
    this.add.rectangle(width / 2, cursorY, newBtnW, newBtnH).setStrokeStyle(2, 0x44cc44);
    const newTxt = this.add
      .text(width / 2, cursorY, "NEW CHARACTER", {
        fontSize: "18px",
        color: "#44cc44",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);
    this.optionsContainer.add(newBg);
    this.optionsContainer.add(newTxt);

    newBg.on("pointerover", () => { newBg.setFillStyle(0x102010); newTxt.setColor("#88ff88"); });
    newBg.on("pointerout", () => { newBg.setFillStyle(0x0a1a0a); newTxt.setColor("#44cc44"); });
    newBg.on("pointerdown", () => this.scene.start("CharacterSelectScene"));

    cursorY += newBtnH + 12;

    // -- MAIN MENU button (dim, small) --
    const menuBg = this.add
      .rectangle(width / 2, cursorY, 200, 40, 0x111111)
      .setInteractive({ useHandCursor: true });
    this.add.rectangle(width / 2, cursorY, 200, 40).setStrokeStyle(1, 0x555555);
    const menuTxt = this.add
      .text(width / 2, cursorY, "MAIN MENU", {
        fontSize: "15px",
        color: "#666666",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);
    this.optionsContainer.add(menuBg);
    this.optionsContainer.add(menuTxt);

    menuBg.on("pointerover", () => { menuBg.setFillStyle(0x1a1a1a); menuTxt.setColor("#aaaaaa"); });
    menuBg.on("pointerout", () => { menuBg.setFillStyle(0x111111); menuTxt.setColor("#666666"); });
    menuBg.on("pointerdown", () => this.scene.start("MainMenuScene"));
  }

  private detectClass(saveName: string): string {
    const lower = saveName.toLowerCase();
    if (lower.includes('fighter')) return 'fighter';
    if (lower.includes('thief')) return 'thief';
    if (lower.includes('wizard')) return 'wizard';
    if (lower.includes('cleric')) return 'cleric';
    return 'fighter';
  }

  private loadSave(slot: number) {
    fetch(`/api/load?slot=${slot}`)
      .then(r => r.json())
      .then((data: { save: { data: unknown; slot: number } | null }) => {
        if (!data.save) {
          this.scene.start("CharacterSelectScene");
          return;
        }
        const stats = data.save.data as import("../entities/Player").PlayerStats;
        stats.saveSlot = slot;
        this.scene.start("TavernScene", { persistedStats: stats });
      })
      .catch(() => this.scene.start("CharacterSelectScene"));
  }
}
