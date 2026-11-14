/**
 * Gallery: every retro texture in a labelled, paged grid, a font sample, a CRT
 * toggle and a button per sound and music bed. Open the game at `?gallery=1`.
 *
 * Keys: LEFT/RIGHT page, C toggle CRT, M mute, 1-3 music beds, 0 stop music.
 * Click a sprite to enlarge it (creatures animate between their two walk
 * frames). Click a sound name to play it.
 */
import * as Phaser from "phaser";
import { registerRetroTextures } from "./registerRetroTextures";
import { RETRO_TEXTURE_KEYS } from "./keys";
import { SPRITES } from "./sprites";
import { retroText } from "./font";
import { isCrtEnabled, toggleCrt } from "./CrtPipeline";
import { MUSIC_BEDS, SFX_KEYS, Sfx } from "../audio/Sfx";

export const GALLERY_SCENE_KEY = "GalleryScene";

const COLS = 8;
const ROWS = 4;
const CELL_W = 120;
const CELL_H = 88;
const GRID_X = 0;
const GRID_Y = 40;
const PER_PAGE = COLS * ROWS;
const GOLD = 0xf4c42c;
const DIM = 0x7d7890;
const WHITE = 0xf4f0f8;

export class GalleryScene extends Phaser.Scene {
  private page = 0;
  private keys: string[] = [];
  private gridObjects: Phaser.GameObjects.GameObject[] = [];
  private title?: Phaser.GameObjects.BitmapText;
  private status?: Phaser.GameObjects.BitmapText;
  private crtLabel?: Phaser.GameObjects.BitmapText;
  private muteLabel?: Phaser.GameObjects.BitmapText;
  private bedLabel?: Phaser.GameObjects.BitmapText;
  private preview?: Phaser.GameObjects.Image;
  private previewBase = "";
  private previewFlip = false;
  private previewTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: GALLERY_SCENE_KEY });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0a0a0f);
    // Overwrite: PreloadScene already made the old textures under the same keys.
    registerRetroTextures(this, { overwrite: true });
    this.keys = RETRO_TEXTURE_KEYS.filter((k) => this.textures.exists(k));

    this.title = retroText(this, 8, 8, "", { size: 16, color: GOLD });
    this.drawPage();
    this.buildFooter();
    this.bindInput();
    this.refreshLabels();
  }

  // ── grid ──────────────────────────────────────────────────────────────────

  private pageCount(): number {
    return Math.max(1, Math.ceil(this.keys.length / PER_PAGE));
  }

  private drawPage(): void {
    for (const o of this.gridObjects) o.destroy();
    this.gridObjects = [];
    const start = this.page * PER_PAGE;
    const slice = this.keys.slice(start, start + PER_PAGE);
    this.title?.setText(`RETRO GALLERY  ${this.page + 1}/${this.pageCount()}  (${this.keys.length} textures)`);

    slice.forEach((key, i) => {
      const cx = GRID_X + (i % COLS) * CELL_W;
      const cy = GRID_Y + Math.floor(i / COLS) * CELL_H;
      const bg = this.add.rectangle(cx + 2, cy + 2, CELL_W - 4, CELL_H - 4, 0x1c1a26).setOrigin(0, 0);
      const img = this.add.image(cx + CELL_W / 2, cy + 38, key);
      const longest = Math.max(img.width, img.height);
      // 32px textures show at 2x (64px); big glow textures shrink to fit.
      img.setScale(longest <= 32 ? 2 : 64 / longest);
      const label = retroText(this, cx + CELL_W / 2, cy + CELL_H - 12, shorten(key, 19), {
        size: 8,
        color: WHITE,
        originX: 0.5,
      });
      const hit = this.add.rectangle(cx + 2, cy + 2, CELL_W - 4, CELL_H - 4, 0xffffff, 0).setOrigin(0, 0);
      hit.setInteractive({ useHandCursor: true });
      hit.on("pointerover", () => bg.setFillStyle(0x2c2a3c));
      hit.on("pointerout", () => bg.setFillStyle(0x1c1a26));
      hit.on("pointerdown", () => this.select(key));
      this.gridObjects.push(bg, img, label, hit);
    });
  }

  private select(key: string): void {
    const def = SPRITES[key];
    const size = def ? `${def.w * def.scale}x${def.h * def.scale}` : "";
    const colors = def ? ` grid ${def.w}x${def.h}` : "";
    this.status?.setText(`${key}  ${size}${colors}`);
    this.showPreview(key);
  }

  private showPreview(key: string): void {
    this.previewTimer?.remove();
    this.previewTimer = undefined;
    this.previewBase = key.replace(/_f2$/, "");
    this.previewFlip = false;
    if (!this.preview) {
      this.preview = this.add.image(850, 500, key);
    }
    this.preview.setTexture(key);
    const longest = Math.max(this.preview.width, this.preview.height);
    this.preview.setScale(longest <= 32 ? 4 : 120 / longest);
    const f2 = `${this.previewBase}_f2`;
    if (this.textures.exists(f2) && this.textures.exists(this.previewBase)) {
      this.previewTimer = this.time.addEvent({
        delay: 260,
        loop: true,
        callback: () => {
          this.previewFlip = !this.previewFlip;
          this.preview?.setTexture(this.previewFlip ? f2 : this.previewBase);
        },
      });
    }
  }

  // ── footer: font sample, sounds, music ───────────────────────────────────

  private buildFooter(): void {
    this.add.rectangle(0, 396, 960, 2, 0x3a3650).setOrigin(0, 0);
    retroText(this, 8, 404, "The Tomb of the Hollow King 0123456789", { size: 16, color: WHITE });
    retroText(this, 8, 426, "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz", { size: 8, color: DIM });
    retroText(this, 8, 436, "!?.,:;'\"()[]{}<>+-=/\\*#%&@$^_`|~  The sword swings, the door groans.", {
      size: 8,
      color: DIM,
    });

    retroText(this, 8, 452, "SOUNDS (click a name)", { size: 8, color: GOLD });
    const colW = 148;
    SFX_KEYS.forEach((key, i) => {
      const x = 8 + (i % 5) * colW;
      const y = 466 + Math.floor(i / 5) * 14;
      this.button(x, y, key, () => {
        Sfx.unlock();
        Sfx.play(key);
        this.status?.setText(`sfx: ${key}`);
      });
    });

    retroText(this, 8, 566, "MUSIC", { size: 8, color: GOLD });
    MUSIC_BEDS.forEach((bed, i) => {
      this.button(64 + i * 90, 566, bed, () => this.setBed(bed));
    });
    this.button(64 + MUSIC_BEDS.length * 90, 566, "stop", () => this.setBed(null));
    this.bedLabel = retroText(this, 400, 566, "", { size: 8, color: DIM });

    this.crtLabel = this.button(8, 588, "", () => this.doToggleCrt());
    this.muteLabel = this.button(200, 588, "", () => this.doToggleMute());
    this.status = retroText(this, 8, 612, "click a sprite to enlarge it", { size: 8, color: WHITE });
    retroText(this, 8, 624, "LEFT/RIGHT page   C crt   M mute   1-3 music   0 stop   F2 crt", { size: 8, color: DIM });

    retroText(this, 780, 408, "PREVIEW", { size: 8, color: GOLD });
  }

  private button(x: number, y: number, text: string, onClick: () => void): Phaser.GameObjects.BitmapText {
    const t = retroText(this, x, y, text, { size: 8, color: 0x8ee4f0 });
    t.setInteractive({ useHandCursor: true });
    t.on("pointerover", () => t.setTint(0xffffff));
    t.on("pointerout", () => t.setTint(0x94e8f4));
    t.on("pointerdown", onClick);
    return t;
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private bindInput(): void {
    const kb = this.input.keyboard;
    this.input.on("pointerdown", () => Sfx.unlock());
    if (!kb) return;
    kb.on("keydown", () => Sfx.unlock());
    kb.on("keydown-LEFT", () => this.turn(-1));
    kb.on("keydown-RIGHT", () => this.turn(1));
    kb.on("keydown-C", () => this.doToggleCrt());
    kb.on("keydown-F2", () => this.doToggleCrt());
    kb.on("keydown-M", () => this.doToggleMute());
    kb.on("keydown-ZERO", () => this.setBed(null));
    kb.on("keydown-ONE", () => this.setBed("tavern"));
    kb.on("keydown-TWO", () => this.setBed("dungeon"));
    kb.on("keydown-THREE", () => this.setBed("tomb"));
  }

  private turn(d: number): void {
    const n = this.pageCount();
    this.page = (this.page + d + n) % n;
    this.drawPage();
  }

  private doToggleCrt(): void {
    const on = toggleCrt(this);
    if (!on && this.game.renderer.type !== Phaser.WEBGL) this.status?.setText("CRT needs the WebGL renderer");
    this.refreshLabels();
  }

  private doToggleMute(): void {
    Sfx.mute(!Sfx.isMuted());
    this.refreshLabels();
  }

  private setBed(bed: (typeof MUSIC_BEDS)[number] | null): void {
    Sfx.unlock();
    Sfx.music(bed);
    this.refreshLabels();
  }

  private refreshLabels(): void {
    const webgl = this.game.renderer.type === Phaser.WEBGL;
    this.crtLabel?.setText(`CRT: ${isCrtEnabled(this) ? "ON" : webgl ? "off" : "n/a (canvas)"}  [C]`);
    this.muteLabel?.setText(`MUTE: ${Sfx.isMuted() ? "ON" : "off"}  [M]`);
    this.bedLabel?.setText(
      `now: ${Sfx.currentBed() ?? "none"}${Sfx.isSupported() ? "" : "  (no WebAudio here)"}`,
    );
  }
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 2) + "..";
}
