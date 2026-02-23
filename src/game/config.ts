import * as Phaser from "phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { CharacterSelectScene } from "./scenes/CharacterSelectScene";
import { TavernScene } from "./scenes/TavernScene";
import { GameScene } from "./scenes/GameScene";
import { GameOverScene } from "./scenes/GameOverScene";
import { HUDScene } from "./scenes/HUDScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  backgroundColor: "#0a0a0f",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [PreloadScene, MainMenuScene, CharacterSelectScene, TavernScene, GameScene, HUDScene, GameOverScene],
};
