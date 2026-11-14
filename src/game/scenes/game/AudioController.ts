/**
 * Hooks the synth to the game: first-input unlock, the N mute key (saved as
 * `dc-mute`), music beds per scene, and one sound per gameplay event from the
 * GameScene bus. Event-to-sound tables live in audio/eventSounds.ts.
 */
import * as Phaser from "phaser";
import { Sfx, type MusicBed } from "../../audio/Sfx";
import {
  EVENT_SFX,
  PLAYER_DEATH_FOLLOWUP_MS,
  bedForFloor,
  hitSfx,
  mechSfx,
  trapSfx,
} from "../../audio/eventSounds";
import { onGameBus } from "../../gfx/busAttach";
import type { GameEventBus } from "../../GameEvents";

export const MUTE_STORAGE_KEY = "dc-mute";

/** Beds for scenes that are not the GameScene (null means silence). */
const SCENE_BEDS: Readonly<Record<string, MusicBed | null>> = {
  MainMenuScene: "title",
  CharacterSelectScene: "title",
  TavernScene: "tavern",
  GameOverScene: null,
};

function readMute(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMute(m: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTE_STORAGE_KEY, m ? "1" : "0");
  } catch {
    /* not persisted */
  }
}

function subscribe(bus: GameEventBus): void {
  // One bus per scene object for the life of the game, so these are never removed.
  for (const name of Object.keys(EVENT_SFX)) {
    const key = EVENT_SFX[name];
    bus.on(name as "player_swing", () => Sfx.play(key));
  }
  bus.on("player_hit", (p) => Sfx.play(hitSfx(!!p?.crit)));
  bus.on("player_death", () => {
    Sfx.music(null);
    Sfx.play("death");
    setTimeout(() => Sfx.play("game_over"), PLAYER_DEATH_FOLLOWUP_MS);
  });
  bus.on("trap_triggered", (p) => Sfx.play(trapSfx(p?.type ?? "")));
  bus.on("mech_sfx", (p) => {
    const key = p?.key ? mechSfx(p.key) : null;
    if (key) Sfx.play(key);
  });
  bus.on("floor_enter", (p) => { Sfx.boss(false); Sfx.music(bedForFloor(p?.floor ?? 1)); });
  // Combat layer: each blow or hostile sighting keeps it up for a few seconds. The king's fight swaps in the boss bed.
  bus.on("player_hit", (p) => { Sfx.combatPulse(); if (p?.enemyKey === "HOLLOW_KING") Sfx.boss(true); });
  bus.on("player_hurt", () => Sfx.combatPulse());
  bus.on("monster_reaction", (p) => { if (p?.reaction === "hostile") Sfx.combatPulse(); if (p?.enemyKey === "HOLLOW_KING") Sfx.boss(true); });
  bus.on("enemy_death", (p) => { if (p?.enemyKey === "HOLLOW_KING") Sfx.boss(false); });
}

const attached = new WeakSet<Phaser.Game>();

/** Wire sound into the game. Safe to call more than once. */
export function attachAudio(game: Phaser.Game): void {
  if (attached.has(game)) return;
  attached.add(game);

  Sfx.mute(readMute());

  if (typeof window !== "undefined") {
    const unlock = () => {
      Sfx.unlock();
      if (Sfx.isUnlocked() || !Sfx.isSupported()) {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const muted = !Sfx.isMuted();
      Sfx.mute(muted);
      writeMute(muted);
      if (!muted) Sfx.play("ui_select");
    };
    window.addEventListener("keydown", onKey);

    game.events.once(Phaser.Core.Events.DESTROY, () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("keydown", onKey);
    });
  }

  // Scene music: the tavern and menus pick their bed when the scene is created.
  for (const scene of game.scene.getScenes(false)) {
    const key = scene.sys.settings.key;
    if (!(key in SCENE_BEDS)) continue;
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => Sfx.music(SCENE_BEDS[key]));
  }

  onGameBus(game, (_scene, bus) => subscribe(bus));
}
