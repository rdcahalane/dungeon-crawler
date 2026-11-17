/**
 * Plays the narrator's recorded clips (`public/narration/<id>.mp3`, see narrationLines.ts) through the game's
 * AudioContext. Phaser-free. The Narrator falls back to the device's speech voice when a line has no clip, when audio
 * is not unlocked yet, or when a clip fails to load.
 */
import { Sfx } from "./Sfx";
import { clipId } from "./narrationLines";
import manifest from "./narrationManifest.json";

/** What the Narrator needs from a clip player. */
export interface ClipPlayerLike {
  /** True when a recording exists for this exact spoken text. */
  has(text: string): boolean;
  /**
   * Play the recording. `onEnd` runs when it finishes; `onFail` runs instead if it cannot play (no audio output, or
   * the file failed to load or decode), before any sound was made. Returns a function that stops it silently.
   */
  play(text: string, onEnd: () => void, onFail: () => void): () => void;
}

/** Served from the site root on the web and from the app bundle's root in the phone apps. */
export const CLIP_BASE = "/narration/";

export function webClipPlayer(ids: readonly string[] = manifest as string[], base = CLIP_BASE): ClipPlayerLike | null {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  const known = new Set(ids);
  const cache = new Map<string, Promise<AudioBuffer>>();

  const load = (ctx: AudioContext, id: string): Promise<AudioBuffer> => {
    let p = cache.get(id);
    if (!p) {
      p = fetch(`${base}${id}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        })
        .then((b) => ctx.decodeAudioData(b));
      p.catch(() => cache.delete(id)); // let a later attempt retry
      cache.set(id, p);
    }
    return p;
  };

  return {
    has: (text) => known.has(clipId(text)),
    play(text, onEnd, onFail) {
      const out = Sfx.voiceOutput();
      if (!out) {
        onFail();
        return () => undefined;
      }
      let stopped = false;
      let src: AudioBufferSourceNode | null = null;
      load(out.ctx, clipId(text)).then(
        (buf) => {
          if (stopped) return;
          try {
            src = out.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(out.node);
            src.onended = () => {
              if (!stopped) onEnd();
            };
            src.start();
          } catch {
            if (!stopped) onFail();
          }
        },
        () => {
          if (!stopped) onFail();
        },
      );
      return () => {
        stopped = true;
        try {
          src?.stop();
        } catch {
          /* already stopped */
        }
      };
    },
  };
}
