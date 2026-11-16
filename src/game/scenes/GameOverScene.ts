import * as Phaser from "phaser";
import { listSaves, loadGame } from "../systems/SaveStore";
import { Sfx } from "../audio/Sfx";
import { graveyard, epitaphFor, type FallenRecord } from "../systems/Graveyard";
import { CLASS_COL, COL, asciiOnly, flatPanel, retroButton, uiText } from "../gfx/retroUi";

interface SaveMeta {
  slot: number;
  name: string;
  level: number;
  floor: number;
  updatedAt: string;
}

export interface GameOverData {
  floor?: number;
  kills?: number;
  level?: number;
  gold?: number;
  bestStreak?: number;
  relics?: string[];
  /** True when the Hollow King fell: shows the victory screen instead of the death screen. */
  victory?: boolean;
  /** The dead character, for the epitaph. Absent on a victory. */
  fallen?: FallenRecord;
}

export class GameOverScene extends Phaser.Scene {
  private floor = 1;
  private kills = 0;
  private level = 1;
  private gold = 0;
  private bestStreak = 0;
  private relics: string[] = [];
  private victory = false;
  private fallen?: FallenRecord;
  private optionsContainer!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: "GameOverScene" });
  }

  init(data: GameOverData) {
    this.floor = data?.floor ?? 1;
    this.kills = data?.kills ?? 0;
    this.level = data?.level ?? 1;
    this.gold = data?.gold ?? 0;
    this.bestStreak = data?.bestStreak ?? 0;
    this.relics = data?.relics ?? [];
    this.victory = data?.victory === true;
    this.fallen = this.victory ? undefined : data?.fallen;
  }

  create() {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, COL.ink);
    for (let x = 16; x < width; x += 32) {
      this.add.image(x, 16, this.victory ? "wall_3" : "wall_0");
      this.add.image(x, height - 16, this.victory ? "wall_3" : "wall_0");
    }

    if (this.victory) {
      uiText(this, width / 2 + 4, 100, "THE HOLLOW KING RESTS", { size: 40, color: COL.umber, originX: 0.5, originY: 0.5 });
      uiText(this, width / 2, 96, "THE HOLLOW KING RESTS", { size: 40, color: COL.gold, originX: 0.5, originY: 0.5 });
      uiText(this, width / 2, 144, "THE TOMB IS QUIET AT LAST", { size: 16, color: COL.cream, originX: 0.5, originY: 0.5 });
      Sfx.play("victory");
    } else {
      uiText(this, width / 2 + 4, 100, "YOU DIED", { size: 64, color: COL.blood, originX: 0.5, originY: 0.5 });
      uiText(this, width / 2, 96, "YOU DIED", { size: 64, color: COL.red, originX: 0.5, originY: 0.5 });
      if (this.fallen) {
        uiText(this, width / 2, 158, epitaphFor(this.fallen), {
          size: 16, color: COL.cream, originX: 0.5, originY: 0.5, maxWidth: 860, center: true,
        });
      }
    }

    const stats: Array<[string, string]> = [
      ["FLOOR REACHED", String(this.floor)],
      ["ENEMIES SLAIN", String(this.kills)],
      ["LEVEL", String(this.level)],
      ["GOLD HAULED", String(this.gold)],
      ["RELICS FOUND", String(this.relics.length)],
    ];
    const px = 260;
    const py = 360;
    flatPanel(this, px, py, 440, 300, { fill: COL.dusk, border: this.victory ? COL.gold : COL.slate });
    uiText(this, px, py - 130, this.victory ? "YOUR RUN" : "THE LAST DELVE", { size: 16, color: COL.gold, originX: 0.5, originY: 0.5 });
    stats.forEach(([label, value], i) => {
      const y = py - 98 + i * 26;
      uiText(this, px - 200, y, label, { size: 16, color: COL.silver });
      uiText(this, px + 200, y, value, { size: 16, color: COL.white, originX: 1 });
    });

    // The newest three names in the Hall of the Fallen (the one who just died is usually the first).
    const hallY = py + 40;
    uiText(this, px - 200, hallY, "THE FALLEN", { size: 16, color: COL.gold });
    const recent = graveyard.list().slice(0, 3);
    if (recent.length === 0) {
      uiText(this, px - 200, hallY + 28, "NOBODY YET", { size: 16, color: COL.grey });
    }
    recent.forEach((r, i) => {
      const line = `${r.name.toUpperCase().slice(0, 9)} L${r.level} F${r.floor} ${(r.cause || "UNKNOWN").toUpperCase()}`;
      uiText(this, px - 200, hallY + 28 + i * 24, line.slice(0, 33), { size: 16, color: i === 0 ? COL.silver : COL.grey });
    });

    this.optionsContainer = this.add.container(0, 0);

    // Render buttons immediately (no saves yet), then fetch saves
    this.renderOptions([]);
    void this.loadSaves();
  }

  private async loadSaves() {
    // Server first, this device's saves when signed out or offline (SaveStore falls back).
    const listing = await listSaves();
    if (!this.sys.isActive()) return;
    const saves = listing.saves.filter((s): s is SaveMeta => s !== null);
    this.renderOptions(saves);
  }

  private renderOptions(saves: SaveMeta[]) {
    this.optionsContainer.removeAll(true);
    const cx = 700;
    let cursorY = 214;
    const put = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.optionsContainer.add(o);
      return o;
    };

    // -- Saved characters --
    if (saves.length > 0) {
      put(uiText(this, cx, cursorY, "SAVED CHARACTERS", { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }));
      cursorY += 32;
      const rowW = 440;
      const rowH = 40;
      for (const save of saves.slice(0, 4)) {
        const cls = this.detectClass(save.name);
        const where = save.floor === 0 ? "TAVERN" : `FLOOR ${save.floor}`;
        const box = put(flatPanel(this, cx, cursorY, rowW, rowH, { fill: COL.navy, border: COL.sky }));
        box.setInteractive({ useHandCursor: true });
        box.on("pointerover", () => box.setFillStyle(COL.blue));
        box.on("pointerout", () => box.setFillStyle(COL.navy));
        box.on("pointerdown", () => this.loadSave(save.slot));
        put(this.add.image(cx - rowW / 2 + 24, cursorY, `player_${cls}`).setScale(1));
        put(uiText(this, cx - rowW / 2 + 48, cursorY, asciiOnly(save.name).toUpperCase().slice(0, 10), { size: 16, color: CLASS_COL[cls], originY: 0.5 }));
        put(uiText(this, cx + rowW / 2 - 10, cursorY, `LV ${save.level} ${where}`, { size: 8, color: COL.silver, originX: 1, originY: 0.5 }));
        cursorY += rowH + 8;
      }
      cursorY += 8;
    }

    const newBtn = retroButton(this, cx, cursorY + 24, 440, 48, "NEW CHARACTER", () => this.scene.start("CharacterSelectScene"), {
      size: 24, fill: COL.pine, hoverFill: COL.green, border: COL.lime, color: COL.lime, hoverColor: COL.white,
    });
    put(newBtn.box);
    put(newBtn.label);
    cursorY += 24 + 24 + 16;

    const menu = retroButton(this, cx, cursorY + 20, 440, 40, "MAIN MENU", () => this.scene.start("MainMenuScene"));
    put(menu.box);
    put(menu.label);
  }

  private detectClass(saveName: string): string {
    const lower = saveName.toLowerCase();
    if (lower.includes("fighter")) return "fighter";
    if (lower.includes("thief")) return "thief";
    if (lower.includes("wizard")) return "wizard";
    if (lower.includes("cleric")) return "cleric";
    return "fighter";
  }

  private loadSave(slot: number) {
    loadGame(slot)
      .then((save) => {
        if (!save) {
          this.scene.start("CharacterSelectScene");
          return;
        }
        const stats = save.data;
        stats.saveSlot = slot;
        this.scene.start("TavernScene", { persistedStats: stats });
      })
      .catch(() => this.scene.start("CharacterSelectScene"));
  }
}
