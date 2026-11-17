/**
 * Every line the narrator can speak, and the name of its recorded clip. Phaser-free.
 *
 * The clips are recorded ahead of time (scripts/narration/) and live in `public/narration/<id>.mp3`, where `id` is
 * `clipId(spoken)`. `narrationManifest.json` lists the ids that have been recorded; the Narrator plays the clip when
 * one exists and falls back to the device's speech voice when it does not. Edit any text in `world/roomText.ts` and
 * the test in narrationLines.test.ts fails until the clips are recorded again (`npm run narration`).
 */
import { BOSS_TEXT, FLOOR_INTROS, ROOM_POOLS, TOMB_TEXT, VAULT_TEXT, type RoomText } from "../world/roomText";
import { RIDDLE_VAULT_TEXT } from "../world/roomTextRiddles";

/** What the narrator says for a piece of room text: the title, a full stop, then the text. */
export function spokenText(t: { title?: string; read?: string; text?: string }): string {
  const body = t.read ?? t.text ?? "";
  return t.title ? `${t.title}. ${body}` : body;
}

/** FNV-1a 32-bit over the UTF-16 code units, as 8 hex digits. Stable across machines and runs. */
export function clipId(spoken: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < spoken.length; i++) {
    h ^= spoken.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Every spoken line, deduplicated, in a stable order. */
export function allSpokenLines(): string[] {
  const texts: RoomText[] = [
    ...Object.values(FLOOR_INTROS),
    ...Object.values(VAULT_TEXT),
    ...Object.values(RIDDLE_VAULT_TEXT),
    ...Object.values(TOMB_TEXT),
    ...(BOSS_TEXT ? [BOSS_TEXT] : []),
    ...Object.values(ROOM_POOLS).flatMap((byKind) => Object.values(byKind ?? {}).flat() as RoomText[]),
  ];
  return Array.from(new Set(texts.filter((t) => t.read).map(spokenText)));
}
