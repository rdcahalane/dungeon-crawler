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

export class MainMenuScene extends Phaser.Scene {
  private saves: (SaveMeta | null)[] = Array(5).fill(null);
  private loggedIn = false;
  private slotsContainer!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a0f);

    // Title
    this.add.text(width / 2, height * 0.10, "DUNGEON CRAWLER", {
      fontSize: "40px", color: "#ffd700", fontFamily: "monospace",
      stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, height * 0.20, '"The dungeon awaits. Few return."', {
      fontSize: "13px", color: "#555577", fontFamily: "monospace", fontStyle: "italic",
    }).setOrigin(0.5);

    // Class icons
    const classes = [
      { icon: '⚔', name: 'Fighter', color: '#ef5350' },
      { icon: '🗡', name: 'Thief',   color: '#90a4ae' },
      { icon: '✨', name: 'Wizard',  color: '#42a5f5' },
      { icon: '✝', name: 'Cleric',  color: '#ffca28' },
    ];
    const iconStartX = width / 2 - 135;
    classes.forEach((cls, i) => {
      const cx = iconStartX + i * 90;
      const cy = height * 0.285;
      this.add.rectangle(cx, cy, 76, 52, 0x101020).setStrokeStyle(1, 0x222244);
      this.add.text(cx, cy - 8, cls.icon, { fontSize: '18px', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(cx, cy + 12, cls.name, {
        fontSize: '9px', color: cls.color, fontFamily: 'monospace',
      }).setOrigin(0.5);
    });

    // Save slots section
    this.add.text(width / 2, height * 0.38, "SAVE SLOTS", {
      fontSize: "14px", color: "#aaaacc", fontFamily: "monospace",
    }).setOrigin(0.5);

    this.slotsContainer = this.add.container(0, 0);
    this.renderSaveSlots();

    // Status / loading text
    this.statusText = this.add.text(width / 2, height * 0.90, "Fetching saves…", {
      fontSize: "11px", color: "#444466", fontFamily: "monospace",
    }).setOrigin(0.5);

    // Controls
    this.add.text(width / 2, height * 0.96, [
      "WASD — Move  |  Space/Click — Attack  |  E — Open chest  |  G — Search (traps & doors)",
      "Q/W/E/R — Spells  |  T — Turn Undead  |  D — Disarm trap (Thief)  |  F/M — Potions",
    ].join("\n"), {
      fontSize: "10px", color: "#333355", fontFamily: "monospace", align: "center",
    }).setOrigin(0.5);

    // Fetch saves from server (non-blocking)
    this.loadSaves();
  }

  private async loadSaves() {
    const { width } = this.scale;
    try {
      const res = await fetch("/api/saves");
      if (res.status === 401) {
        this.loggedIn = false;
        this.statusText.setText("Sign in at dungeon-crawler-bay.vercel.app to save progress");
        this.renderSaveSlots();
        return;
      }
      const data = await res.json() as { saves: (SaveMeta | null)[] };
      this.loggedIn = true;
      this.saves = data.saves ?? Array(5).fill(null);
      this.statusText.setText("");
      this.renderSaveSlots();
    } catch {
      this.statusText.setText("Could not load saves — playing offline");
      this.renderSaveSlots();
    }
    void width;
  }

  private renderSaveSlots() {
    this.slotsContainer.removeAll(true);

    const { width, height } = this.scale;
    const slotW = 172;
    const slotH = 72;
    const cols = 3;
    // Layout: 3 in top row, 2 in bottom row
    const layouts = [
      { slot: 1, col: 0, row: 0 }, { slot: 2, col: 1, row: 0 }, { slot: 3, col: 2, row: 0 },
      { slot: 4, col: 0, row: 1 }, { slot: 5, col: 1, row: 1 },
    ];

    const gridW = cols * (slotW + 8) - 8;
    const startX = (width - gridW) / 2 + slotW / 2;
    const startY = height * 0.50;

    for (const { slot, col, row } of layouts) {
      const cx = startX + col * (slotW + 8);
      const cy = startY + row * (slotH + 8);
      const save = this.saves[slot - 1] ?? null;

      const isOccupied = save !== null;
      const borderColor = isOccupied ? 0x4466aa : 0x222244;
      const bgColor = isOccupied ? 0x101830 : 0x0a0a14;

      const bg = this.add.rectangle(cx, cy, slotW, slotH, bgColor)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, borderColor);
      this.slotsContainer.add(bg);

      if (isOccupied && save) {
        // Parse class from save name
        const classKey = this.detectClass(save.name);
        const icon = CLASS_ICONS[classKey] ?? '?';
        const color = CLASS_COLORS[classKey] ?? '#ffffff';

        this.slotsContainer.add(this.add.text(cx - slotW / 2 + 10, cy - 12, icon, {
          fontSize: '22px', fontFamily: 'monospace',
        }).setOrigin(0, 0.5));

        this.slotsContainer.add(this.add.text(cx - slotW / 2 + 36, cy - 14, save.name, {
          fontSize: '12px', color, fontFamily: 'monospace',
        }).setOrigin(0, 0.5));

        const floorStr = save.floor === 0 ? 'Tavern' : `Floor ${save.floor}`;
        this.slotsContainer.add(this.add.text(cx - slotW / 2 + 36, cy + 2, floorStr, {
          fontSize: '10px', color: '#888899', fontFamily: 'monospace',
        }).setOrigin(0, 0.5));

        const date = new Date(save.updatedAt).toLocaleDateString();
        this.slotsContainer.add(this.add.text(cx - slotW / 2 + 36, cy + 16, date, {
          fontSize: '9px', color: '#444466', fontFamily: 'monospace',
        }).setOrigin(0, 0.5));

        this.slotsContainer.add(this.add.text(cx + slotW / 2 - 6, cy, 'CONTINUE ▶', {
          fontSize: '9px', color: '#4488cc', fontFamily: 'monospace',
        }).setOrigin(1, 0.5));

        bg.on("pointerover", () => bg.setFillStyle(0x18243a));
        bg.on("pointerout", () => bg.setFillStyle(bgColor));
        bg.on("pointerdown", () => this.loadSave(slot));
      } else {
        // Empty slot
        this.slotsContainer.add(this.add.text(cx, cy - 8, `Slot ${slot}`, {
          fontSize: '11px', color: '#333355', fontFamily: 'monospace',
        }).setOrigin(0.5));
        this.slotsContainer.add(this.add.text(cx, cy + 8, '+ NEW CHARACTER', {
          fontSize: '10px', color: '#334455', fontFamily: 'monospace',
        }).setOrigin(0.5));

        bg.on("pointerover", () => bg.setFillStyle(0x101820));
        bg.on("pointerout", () => bg.setFillStyle(bgColor));
        bg.on("pointerdown", () => this.newGame(slot));
      }

      // Slot number badge
      this.slotsContainer.add(this.add.text(cx + slotW / 2 - 6, cy - slotH / 2 + 5, `#${slot}`, {
        fontSize: '8px', color: '#333355', fontFamily: 'monospace',
      }).setOrigin(1, 0));
    }

    // "New Game" shortcut button (always visible — uses first empty slot)
    const btnY = startY + 1 * (slotH + 8) + slotH / 2 + 24;
    const newBtn = this.add.rectangle(width - 100, btnY, 160, 36, 0x0a1a0a)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, 0x336633);
    this.slotsContainer.add(newBtn);
    const newTxt = this.add.text(width - 100, btnY, "NEW GAME", {
      fontSize: '14px', color: '#44cc44', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.slotsContainer.add(newTxt);

    newBtn.on("pointerover", () => { newBtn.setFillStyle(0x102010); newTxt.setColor('#88ff88'); });
    newBtn.on("pointerout", () => { newBtn.setFillStyle(0x0a1a0a); newTxt.setColor('#44cc44'); });
    newBtn.on("pointerdown", () => {
      // Use first empty slot
      const emptySlot = this.saves.findIndex(s => s === null);
      this.newGame(emptySlot >= 0 ? emptySlot + 1 : 1);
    });
  }

  private detectClass(saveName: string): string {
    const lower = saveName.toLowerCase();
    if (lower.includes('fighter')) return 'fighter';
    if (lower.includes('thief')) return 'thief';
    if (lower.includes('wizard')) return 'wizard';
    if (lower.includes('cleric')) return 'cleric';
    return 'fighter';
  }

  private newGame(saveSlot: number) {
    this.scene.start("CharacterSelectScene", { saveSlot });
  }

  private loadSave(slot: number) {
    // Load the full save data from API, then go to Tavern
    fetch(`/api/load?slot=${slot}`)
      .then(r => r.json())
      .then((data: { save: { data: unknown; slot: number } | null }) => {
        if (!data.save) { this.newGame(slot); return; }
        const stats = data.save.data as import("../entities/Player").PlayerStats;
        stats.saveSlot = slot;
        this.scene.start("TavernScene", { persistedStats: stats });
      })
      .catch(() => this.newGame(slot));
  }
}
