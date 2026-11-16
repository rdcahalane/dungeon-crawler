/**
 * Game-level CRT: applies the CRT post effect to every scene's main camera as
 * the scene is created, and toggles it with F2. The choice is stored in
 * localStorage (`dc-crt`, "1" or "0"; default on). WebGL only.
 */
import * as Phaser from "phaser";
import { disableCrt, enableCrt, registerCrtPipeline } from "./CrtPipeline";

export const CRT_STORAGE_KEY = "dc-crt";

/** Read the stored choice. Defaults to on when nothing is stored or storage is blocked. */
export function readCrtPref(): boolean {
  try {
    return globalThis.localStorage?.getItem(CRT_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeCrtPref(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(CRT_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable; the choice just will not persist */
  }
}

const attached = new WeakSet<Phaser.Game>();

function apply(scene: Phaser.Scene, on: boolean): void {
  if (on) enableCrt(scene);
  else disableCrt(scene);
}

/** Hook the CRT onto every scene of the game. Safe to call more than once. */
export function attachCrt(game: Phaser.Game): void {
  if (attached.has(game)) return;
  attached.add(game);
  registerCrtPipeline(game);
  let on = readCrtPref();

  // A restarting scene gets a fresh camera, so re-apply on every CREATE.
  for (const scene of game.scene.getScenes(false)) {
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => apply(scene, on));
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "F2") return;
    e.preventDefault();
    on = !on;
    writeCrtPref(on);
    for (const scene of game.scene.getScenes(true)) apply(scene, on);
  };
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKey);
    game.events.once(Phaser.Core.Events.DESTROY, () => window.removeEventListener("keydown", onKey));
  }
}
