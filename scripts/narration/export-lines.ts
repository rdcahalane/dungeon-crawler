/** Prints every narrator line as JSON [{id, text}] for the recording script. */
import { allSpokenLines, clipId } from "../../src/game/audio/narrationLines";

process.stdout.write(JSON.stringify(allSpokenLines().map((text) => ({ id: clipId(text), text })), null, 1) + "\n");
