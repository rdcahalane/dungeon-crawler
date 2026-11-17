/**
 * The player's sound switches, saved in localStorage: all sound (`dc-mute`, the N key), music (`dc-music`, J)
 * and sound effects (`dc-sfx`, K). The narrator's voice has its own switch (V) in Narrator.ts.
 * Phaser-free so the title screen, the touch menu and the key handler share one place.
 */
import { Sfx } from "./Sfx";
import { narrator } from "./Narrator";

export const MUTE_STORAGE_KEY = "dc-mute";
export const MUSIC_STORAGE_KEY = "dc-music";
export const SFX_STORAGE_KEY = "dc-sfx";

type Store = Pick<Storage, "getItem" | "setItem">;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string, fallback: boolean, s: Store | null = store()): boolean {
  try {
    const v = s?.getItem(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, on: boolean, s: Store | null = store()): void {
  try {
    s?.setItem(key, on ? "1" : "0");
  } catch {
    /* not persisted */
  }
}

/** Apply the saved switches to the synth (call once at startup). */
export function loadSoundSettings(s: Store | null = store()): void {
  Sfx.mute(read(MUTE_STORAGE_KEY, false, s));
  Sfx.setMusicOn(read(MUSIC_STORAGE_KEY, true, s));
  Sfx.setSfxOn(read(SFX_STORAGE_KEY, true, s));
}

/** All sound on or off. Returns true when sound is now on. */
export function toggleAllSound(s: Store | null = store()): boolean {
  const muted = !Sfx.isMuted();
  Sfx.mute(muted);
  write(MUTE_STORAGE_KEY, muted, s);
  if (muted) narrator.stop(); // a line already being read would otherwise run on to its end
  // Turning all sound on with both parts switched off would still be silent, so bring both back.
  if (!muted && !Sfx.isMusicOn() && !Sfx.isSfxOn()) {
    Sfx.setMusicOn(true);
    Sfx.setSfxOn(true);
    write(MUSIC_STORAGE_KEY, true, s);
    write(SFX_STORAGE_KEY, true, s);
  }
  if (!muted) Sfx.play("ui_select");
  return !muted;
}

/** Music on or off. Turning it on also lifts the all-sound mute. Returns true when music is now on. */
export function toggleMusic(s: Store | null = store()): boolean {
  const on = !Sfx.isMusicOn() || Sfx.isMuted();
  Sfx.setMusicOn(on);
  write(MUSIC_STORAGE_KEY, on, s);
  if (on && Sfx.isMuted()) {
    Sfx.mute(false);
    write(MUTE_STORAGE_KEY, false, s);
  }
  return on;
}

/** Sound effects on or off. Turning them on also lifts the all-sound mute. Returns true when effects are now on. */
export function toggleSfx(s: Store | null = store()): boolean {
  const on = !Sfx.isSfxOn() || Sfx.isMuted();
  Sfx.setSfxOn(on);
  write(SFX_STORAGE_KEY, on, s);
  if (on && Sfx.isMuted()) {
    Sfx.mute(false);
    write(MUTE_STORAGE_KEY, false, s);
  }
  if (on) Sfx.play("ui_select");
  return on;
}

/** What the switches read as on screen. */
export function soundLabels(): { all: string; music: string; sfx: string } {
  const muted = Sfx.isMuted();
  return {
    all: muted ? "ALL SOUND: OFF" : "ALL SOUND: ON",
    music: !muted && Sfx.isMusicOn() ? "MUSIC: ON" : "MUSIC: OFF",
    sfx: !muted && Sfx.isSfxOn() ? "EFFECTS: ON" : "EFFECTS: OFF",
  };
}

const listeners = new Set<(labels: ReturnType<typeof soundLabels>) => void>();

/** Hear about switch changes (title screen labels, the in-game notice). Returns an unsubscribe function. */
export function onSoundChanged(cb: (labels: ReturnType<typeof soundLabels>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Tell listeners a switch changed. */
export function notifySoundChanged(): void {
  const l = soundLabels();
  for (const cb of listeners) cb(l);
}
