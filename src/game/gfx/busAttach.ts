/**
 * Finds the GameScene event bus and hands it to a subscriber exactly once per
 * bus object. The bus lives as long as the scene object, so a single
 * subscription is enough; the CREATE listener only covers a replaced scene.
 */
import * as Phaser from "phaser";
import type { GameEventBus } from "../GameEvents";

export interface BusHost extends Phaser.Scene {
  gameEvents: GameEventBus;
}

function asHost(scene: Phaser.Scene | undefined): BusHost | null {
  const maybe = scene as (Phaser.Scene & { gameEvents?: GameEventBus }) | undefined;
  return maybe?.gameEvents ? (maybe as BusHost) : null;
}

/** Call `subscribe(scene, bus)` once for the GameScene bus, now or when it appears. */
export function onGameBus(game: Phaser.Game, subscribe: (scene: BusHost, bus: GameEventBus) => void): void {
  const seen = new WeakSet<GameEventBus>();
  const tryAttach = () => {
    let scene: Phaser.Scene | undefined;
    try {
      scene = game.scene.getScene("GameScene");
    } catch {
      scene = undefined;
    }
    const host = asHost(scene);
    if (!host || seen.has(host.gameEvents)) return;
    seen.add(host.gameEvents);
    subscribe(host, host.gameEvents);
  };
  tryAttach();
  game.events.on(Phaser.Core.Events.READY, tryAttach);
  const scene = game.scene.getScenes(false).find((s) => s.sys.settings.key === "GameScene");
  scene?.sys.events.on(Phaser.Scenes.Events.CREATE, tryAttach);
}
