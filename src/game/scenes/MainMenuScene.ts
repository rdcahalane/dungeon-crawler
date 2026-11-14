import * as Phaser from "phaser";
import { listSaves, loadGame } from "../systems/SaveStore";
import { CLASS_COL, COL, asciiOnly, flatPanel, retroButton, uiText } from "../gfx/retroUi";
import { narrator } from "../audio/Narrator";
import { graveyard, causePhrase, type FallenRecord } from "../systems/Graveyard";

interface SaveMeta {
  slot: number;
  name: string;
  level: number;
  floor: number;
  updatedAt: string;
}

type Mode = "title" | "slots" | "howto" | "fallen";

/** Entries on one page of the Hall of the Fallen (three 16px lines each). */
const FALLEN_PER_PAGE = 5;

const CLASSES = ["fighter", "thief", "wizard", "cleric"] as const;

/** Two columns of (keys, what they do). Kept to ASCII for the bitmap font. */
export const HOW_TO_PLAY: ReadonlyArray<readonly [string, string]> = [
  ["WASD / ARROWS", "MOVE (OR CLICK THE FLOOR TO WALK THERE)"],
  ["SPACE / CLICK", "ATTACK (HOLD TO KEEP SWINGING)"],
  ["1 2 3 4", "CAST A MEMORIZED SPELL"],
  ["F / 5-8", "DRINK A HEALING POTION / USE A BELT SLOT"],
  ["G", "SEARCH THE NEARBY WALLS AND FLOOR"],
  ["P", "PROBE TWO TILES AHEAD WITH THE TEN-FOOT POLE"],
  ["L", "LISTEN AT A DOOR"],
  ["E", "INTERACT. STAIRS: E TO CLIMB, E TWICE TO DESCEND"],
  ["R", "MAKE CAMP IN THE CAMP ROOM (COSTS A RATION)"],
  ["I", "INVENTORY AND EQUIPMENT"],
  ["F2", "CRT SCANLINES ON OR OFF"],
  ["N", "SOUND ON OR OFF"],
  ["V / Z", "NARRATOR VOICE ON OR OFF / HEAR IT AGAIN"],
];

export class MainMenuScene extends Phaser.Scene {
  private saves: (SaveMeta | null)[] = Array(5).fill(null);
  private statusLine = "";
  private mode: Mode = "title";
  private layer!: Phaser.GameObjects.Container;
  private statusText?: Phaser.GameObjects.BitmapText;
  private walkEvents: Phaser.Time.TimerEvent[] = [];
  private startKeys: Phaser.Input.Keyboard.Key[] = [];
  private fallenPage = 0;

  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const { width, height } = this.scale;
    this.mode = "title";
    this.statusLine = "";
    this.walkEvents = [];

    this.add.rectangle(width / 2, height / 2, width, height, COL.ink);
    // Tile bands top and bottom, like the edge of a cartridge screen.
    for (let x = 16; x < width; x += 32) {
      this.add.image(x, 16, "wall_0");
      this.add.image(x, height - 16, "wall_0");
    }

    this.layer = this.add.container(0, 0);

    const kb = this.input.keyboard;
    if (kb) {
      this.startKeys = [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ];
      kb.on("keydown-H", () => this.mode === "title" && this.show("howto"));
      kb.on("keydown-F", () => this.mode === "title" && this.openFallen(0));
      kb.on("keydown-V", () => this.mode === "title" && this.toggleVoice());
      kb.on("keydown-LEFT", () => this.mode === "fallen" && this.openFallen(this.fallenPage - 1));
      kb.on("keydown-RIGHT", () => this.mode === "fallen" && this.openFallen(this.fallenPage + 1));
      kb.on("keydown-ESC", () => this.mode !== "title" && this.show("title"));
      for (const k of this.startKeys) k.on("down", () => this.mode === "title" && this.show("slots"));
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown-H");
      this.input.keyboard?.off("keydown-F");
      this.input.keyboard?.off("keydown-V");
      this.input.keyboard?.off("keydown-LEFT");
      this.input.keyboard?.off("keydown-RIGHT");
      this.input.keyboard?.off("keydown-ESC");
      for (const k of this.startKeys) k.removeAllListeners();
      for (const e of this.walkEvents) e.remove(false);
    });

    this.show("title");
    void this.loadSaves();
  }

  // -- pages -----------------------------------------------------------------

  private show(mode: Mode) {
    this.mode = mode;
    for (const e of this.walkEvents) e.remove(false);
    this.walkEvents = [];
    this.layer.removeAll(true);
    this.statusText = undefined;
    if (mode === "title") this.drawTitle();
    else if (mode === "slots") this.drawSlots();
    else if (mode === "fallen") this.drawFallen();
    else this.drawHowTo();
  }

  private openFallen(page: number) {
    const pages = Math.max(1, Math.ceil(graveyard.list().length / FALLEN_PER_PAGE));
    this.fallenPage = Math.min(pages - 1, Math.max(0, page));
    this.show("fallen");
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private drawTitle() {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.add2(uiText(this, cx + 4, 108, "DUNGEON CRAWLER", { size: 64, color: COL.blood, originX: 0.5, originY: 0.5 }));
    this.add2(uiText(this, cx, 104, "DUNGEON CRAWLER", { size: 64, color: COL.gold, originX: 0.5, originY: 0.5 }));
    this.add2(uiText(this, cx, 176, "THE TOMB OF THE HOLLOW KING", { size: 24, color: COL.cream, originX: 0.5, originY: 0.5 }));

    // Row of class sprites, two-frame walk cycle.
    const spacing = 160;
    const startX = cx - (spacing * (CLASSES.length - 1)) / 2;
    CLASSES.forEach((cls, i) => {
      const x = startX + i * spacing;
      const y = 300;
      const card = this.add2(flatPanel(this, x, y + 6, 112, 128, { fill: COL.dusk, border: COL.slate }));
      // A class portrait is a way in too: a click anywhere on it starts a game.
      card.setInteractive({ useHandCursor: true });
      card.on("pointerover", () => card.setStrokeStyle(2, CLASS_COL[cls]));
      card.on("pointerout", () => card.setStrokeStyle(2, COL.slate));
      card.on("pointerdown", () => this.show("slots"));
      const img = this.add2(this.add.image(x, y - 8, `player_${cls}`).setScale(3));
      this.add2(uiText(this, x, y + 54, cls.toUpperCase(), { size: 16, color: CLASS_COL[cls], originX: 0.5, originY: 0.5 }));
      let frame = 0;
      this.walkEvents.push(
        this.time.addEvent({
          delay: 360,
          startAt: i * 90,
          loop: true,
          callback: () => {
            frame ^= 1;
            const key = frame ? `player_${cls}_f2` : `player_${cls}`;
            if (this.textures.exists(key)) img.setTexture(key);
            img.y = (y - 8) + (frame ? -3 : 0);
          },
        }),
      );
    });

    // The way in. It blinks between bright and dim, never off, so it is always on screen.
    const startY = 432;
    const hit = this.add2(flatPanel(this, cx, startY, 580, 48, { fill: COL.ink, border: COL.slate }));
    hit.setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => this.show("slots"));
    const start = this.add2(uiText(this, cx, startY, "PRESS ENTER OR CLICK TO BEGIN", {
      size: 24, color: COL.gold, originX: 0.5, originY: 0.5,
    }));
    let bright = true;
    this.walkEvents.push(
      this.time.addEvent({
        delay: 520,
        loop: true,
        callback: () => {
          bright = !bright;
          start.setAlpha(bright ? 1 : 0.35);
          start.setTint(bright ? COL.gold : COL.silver);
        },
      }),
    );

    const how = retroButton(this, cx - 130, 504, 240, 40, "HOW TO PLAY (H)", () => this.show("howto"), { size: 16 });
    this.add2(how.box);
    this.add2(how.label);
    const fallen = retroButton(this, cx + 130, 504, 240, 40, "THE FALLEN (F)", () => this.openFallen(0), { size: 16 });
    this.add2(fallen.box);
    this.add2(fallen.label);

    const voice = retroButton(this, cx, 548, 280, 32, this.voiceLabel(), () => this.toggleVoice(), { size: 16 });
    this.add2(voice.box);
    this.add2(voice.label);

    this.statusText = this.add2(uiText(this, cx, 578, this.statusLine, { size: 8, color: COL.grey, originX: 0.5, originY: 0.5 }));
    this.add2(
      uiText(this, cx, height - 48, "(C) 2026 DUNGEON CRAWLER   F2 CRT   N SOUND   V VOICE", {
        size: 8,
        color: COL.grey,
        originX: 0.5,
        originY: 0.5,
      }),
    );
  }

  private voiceLabel(): string {
    if (!narrator.isAvailable()) return "VOICE: UNAVAILABLE";
    return narrator.enabled ? "VOICE: ON (V)" : "VOICE: OFF (V)";
  }

  /** The narrator's voice, saved for next time. Room text boxes still appear when it is off. */
  private toggleVoice() {
    narrator.setEnabled(!narrator.enabled);
    this.show("title");
  }

  private drawHowTo() {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.add2(uiText(this, cx, 72, "HOW TO PLAY", { size: 32, color: COL.gold, originX: 0.5, originY: 0.5 }));
    this.add2(flatPanel(this, cx, 316, 880, 380, { fill: COL.dusk, border: COL.slate }));
    HOW_TO_PLAY.forEach(([keys, what], i) => {
      const y = 138 + i * 28;
      this.add2(uiText(this, 60, y, keys, { size: 16, color: COL.gold }));
      this.add2(uiText(this, 290, y, what, { size: 16, color: COL.silver }));
    });
    this.add2(
      uiText(this, cx, 534, "LIGHT IS A RESOURCE. LOOK FOR CLUES BEFORE YOU STEP.", {
        size: 16,
        color: COL.cream,
        originX: 0.5,
        originY: 0.5,
      }),
    );
    const back = retroButton(this, cx, height - 70, 200, 40, "BACK (ESC)", () => this.show("title"));
    this.add2(back.box);
    this.add2(back.label);
  }

  /** The Hall of the Fallen: the last twenty dead on this device, newest first, five to a page. */
  private drawFallen() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const all = graveyard.list();
    const pages = Math.max(1, Math.ceil(all.length / FALLEN_PER_PAGE));
    this.add2(uiText(this, cx, 56, "THE FALLEN", { size: 32, color: COL.gold, originX: 0.5, originY: 0.5 }));
    this.add2(flatPanel(this, cx, 296, 880, 396, { fill: COL.dusk, border: COL.slate }));

    if (all.length === 0) {
      this.add2(uiText(this, cx, 280, "NO ONE HAS FALLEN YET.", { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }));
      this.add2(uiText(this, cx, 310, "GIVE IT TIME.", { size: 16, color: COL.grey, originX: 0.5, originY: 0.5 }));
    }

    const first = this.fallenPage * FALLEN_PER_PAGE;
    all.slice(first, first + FALLEN_PER_PAGE).forEach((r, i) => {
      const y = 114 + i * 76;
      const n = first + i + 1;
      this.add2(uiText(this, 56, y, this.fallenHeading(n, r), { size: 16, color: CLASS_COL[r.classKey] ?? COL.silver }));
      const how = causePhrase(r.cause) ? `SLAIN BY ${causePhrase(r.cause).toUpperCase()}` : "CAUSE UNKNOWN";
      this.add2(uiText(this, 56, y + 22, `${how} ON LEVEL ${r.floor} WITH ${r.gold} GP`.slice(0, 68), { size: 16, color: COL.cream }));
      const day = String(r.date).slice(0, 10);
      this.add2(uiText(this, 56, y + 44, `CHARACTER LEVEL ${r.level}  ${r.kills} SLAIN  ${day}`.slice(0, 68), { size: 16, color: COL.grey }));
    });

    const back = retroButton(this, cx - 250, height - 52, 200, 40, "BACK (ESC)", () => this.show("title"));
    this.add2(back.box);
    this.add2(back.label);
    if (pages > 1) {
      const prev = retroButton(this, cx + 20, height - 52, 80, 40, "<", () => this.openFallen(this.fallenPage - 1), { size: 24 });
      this.add2(prev.box);
      this.add2(prev.label);
      this.add2(uiText(this, cx + 100, height - 52, `PAGE ${this.fallenPage + 1} OF ${pages}`, { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }));
      const next = retroButton(this, cx + 180, height - 52, 80, 40, ">", () => this.openFallen(this.fallenPage + 1), { size: 24 });
      this.add2(next.box);
      this.add2(next.label);
    }
  }

  private fallenHeading(n: number, r: FallenRecord): string {
    const who = asciiOnly(r.name).toUpperCase().slice(0, 18);
    const title = r.title ? ` THE ${asciiOnly(r.title).toUpperCase()}` : "";
    return `${n}. ${who}${title}`.slice(0, 68);
  }

  private drawSlots() {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.add2(uiText(this, cx, 64, "CHOOSE A SLOT", { size: 32, color: COL.gold, originX: 0.5, originY: 0.5 }));

    const slotW = 280;
    const slotH = 112;
    const gap = 16;
    const positions = [
      { slot: 1, col: 0, row: 0 }, { slot: 2, col: 1, row: 0 }, { slot: 3, col: 2, row: 0 },
      { slot: 4, col: 0, row: 1 }, { slot: 5, col: 1, row: 1 },
    ];
    const gridW = 3 * slotW + 2 * gap;
    const startX = (width - gridW) / 2 + slotW / 2;
    const startY = 176;

    for (const { slot, col, row } of positions) {
      const x = startX + col * (slotW + gap);
      const y = startY + row * (slotH + gap);
      const save = this.saves[slot - 1] ?? null;
      const fill = save ? COL.navy : COL.dusk;
      const hover = save ? COL.blue : COL.slate;
      const box = this.add2(flatPanel(this, x, y, slotW, slotH, { fill, border: save ? COL.sky : COL.slate }));
      box.setInteractive({ useHandCursor: true });
      box.on("pointerover", () => box.setFillStyle(hover));
      box.on("pointerout", () => box.setFillStyle(fill));
      this.add2(uiText(this, x + slotW / 2 - 8, y - slotH / 2 + 8, `#${slot}`, { size: 8, color: COL.grey, originX: 1 }));

      if (save) {
        const cls = this.detectClass(save.name);
        this.add2(this.add.image(x - slotW / 2 + 36, y - 8, `player_${cls}`).setScale(1.5));
        this.add2(uiText(this, x - slotW / 2 + 72, y - 40, asciiOnly(save.name).toUpperCase().slice(0, 12), { size: 16, color: CLASS_COL[cls] }));
        const where = save.floor === 0 ? "TAVERN" : `FLOOR ${save.floor}`;
        this.add2(uiText(this, x - slotW / 2 + 72, y - 16, `LV ${save.level}  ${where}`, { size: 16, color: COL.silver }));
        this.add2(uiText(this, x - slotW / 2 + 72, y + 8, String(save.updatedAt).slice(0, 10), { size: 8, color: COL.grey }));
        this.add2(uiText(this, x, y + slotH / 2 - 12, "CONTINUE", { size: 16, color: COL.sky, originX: 0.5, originY: 1 }));
        box.on("pointerdown", () => this.loadSave(slot));
      } else {
        this.add2(uiText(this, x, y - 14, `SLOT ${slot} EMPTY`, { size: 16, color: COL.grey, originX: 0.5, originY: 0.5 }));
        this.add2(uiText(this, x, y + 18, "+ NEW CHARACTER", { size: 16, color: COL.lime, originX: 0.5, originY: 0.5 }));
        box.on("pointerdown", () => this.newGame(slot));
      }
    }

    const newBtn = retroButton(
      this, startX + 2 * (slotW + gap), startY + slotH + gap, slotW, slotH, "NEW GAME",
      () => {
        const empty = this.saves.findIndex((s) => s === null);
        this.newGame(empty >= 0 ? empty + 1 : 1);
      },
      { size: 24, fill: COL.pine, hoverFill: COL.green, border: COL.lime, color: COL.lime, hoverColor: COL.white },
    );
    this.add2(newBtn.box);
    this.add2(newBtn.label);

    const back = retroButton(this, cx - 130, height - 70, 220, 40, "BACK (ESC)", () => this.show("title"));
    this.add2(back.box);
    this.add2(back.label);
    const how = retroButton(this, cx + 130, height - 70, 220, 40, "HOW TO PLAY", () => this.show("howto"));
    this.add2(how.box);
    this.add2(how.label);

    this.statusText = this.add2(uiText(this, cx, height - 112, this.statusLine, { size: 8, color: COL.grey, originX: 0.5, originY: 0.5 }));
  }

  // -- saves -----------------------------------------------------------------

  private async loadSaves() {
    // Server first; saves kept on this device when signed out or offline (SaveStore falls back).
    const listing = await listSaves();
    if (!this.sys.isActive()) return;
    this.saves = listing.saves;
    if (listing.source === "api") {
      this.statusLine = "";
    } else if (listing.unauthorized) {
      this.statusLine = "NOT SIGNED IN: PROGRESS IS SAVED ON THIS DEVICE";
    } else {
      this.statusLine = "COULD NOT REACH THE SERVER: PROGRESS IS SAVED ON THIS DEVICE";
    }
    this.statusText?.setText(this.statusLine);
    if (this.mode === "slots") this.show("slots");
  }

  private detectClass(saveName: string): string {
    const lower = saveName.toLowerCase();
    if (lower.includes("fighter")) return "fighter";
    if (lower.includes("thief")) return "thief";
    if (lower.includes("wizard")) return "wizard";
    if (lower.includes("cleric")) return "cleric";
    return "fighter";
  }

  private newGame(saveSlot: number) {
    this.scene.start("CharacterSelectScene", { saveSlot });
  }

  private loadSave(slot: number) {
    // Load the full save data (server, else this device), then go to Tavern
    loadGame(slot)
      .then((save) => {
        if (!save) { this.newGame(slot); return; }
        const stats = save.data;
        stats.saveSlot = slot;
        this.scene.start("TavernScene", { persistedStats: stats });
      })
      .catch(() => this.newGame(slot));
  }
}
