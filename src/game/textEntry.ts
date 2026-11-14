/**
 * True while the player is typing into an in-game text prompt (the riddle door's answer, the character's name).
 * Single-key shortcuts that listen on the window (N for sound, and any others) must stand down while it is set,
 * or typing "anvil" mutes the game.
 */
let active = false;

export function setTextEntry(on: boolean): void {
  active = on;
}

export function isTextEntryActive(): boolean {
  return active;
}
