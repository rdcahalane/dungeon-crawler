import * as Phaser from "phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { CharacterSelectScene } from "./scenes/CharacterSelectScene";
import { TavernScene } from "./scenes/TavernScene";
import { GameScene } from "./scenes/GameScene";
import { GameOverScene } from "./scenes/GameOverScene";
import { HUDScene } from "./scenes/HUDScene";
import { GalleryScene } from "./gfx/GalleryScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: "#0a0a0f",
  // Crisp pixels: nearest-neighbour textures, whole-pixel positions, no smoothing.
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  // The CRT post effect (src/game/gfx/CrtPipeline.ts) is added to the renderer on demand by enableCrt();
  // attachCrt() in PreloadScene applies it to every scene camera and binds F2.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [PreloadScene, MainMenuScene, CharacterSelectScene, TavernScene, GameScene, HUDScene, GameOverScene, GalleryScene],
};
