import * as Phaser from "phaser";
import type { ClassKey } from "../constants";
import { registerRetroTextures } from "../gfx/registerRetroTextures";
import { registerRetroFont } from "../gfx/font";
import { attachCrt } from "../gfx/crtGlobal";
import { attachAudio } from "./game/AudioController";
import { attachJuice } from "./game/Juice";
import { parseQuickLevel, quickStats } from "../quickStart";

/**
 * Boot scene. Draws the retro texture set and the bitmap font, hooks the
 * game-level extras (CRT, sound, juice), then hands off to the menu.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  create() {
    registerRetroTextures(this);
    registerRetroFont(this);
    attachCrt(this.game);
    attachAudio(this.game);
    attachJuice(this.game);

    const gallery = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("gallery") === "1";
    // Dev shortcut: ?quick=fighter&floor=3 drops straight into a dungeon floor; add &level=4 to start at that level.
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const quick = params?.get("quick");
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      (window as unknown as { __game?: Phaser.Game }).__game = this.game;
    }
    if (quick && ["fighter", "thief", "wizard", "cleric"].includes(quick)) {
      const floor = Math.max(1, Number(params?.get("floor") ?? 1) || 1);
      const charData = { classKey: quick as ClassKey, name: "Tester", str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
      const level = parseQuickLevel(params?.get("level"));
      // GameScene builds a level-1 character from charData; a higher level goes in as a finished character instead.
      this.scene.start("GameScene", level > 1 ? { floor, persistedStats: quickStats(charData, level, floor) } : { floor, charData });
      return;
    }
    this.scene.start(gallery ? "GalleryScene" : "MainMenuScene");
  }
}
