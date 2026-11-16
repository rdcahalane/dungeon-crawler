/**
 * Adapts a Capacitor text-to-speech plugin (`@capacitor-community/text-to-speech`) to the slice of `speechSynthesis`
 * the Narrator uses. Needed in the Android app: its WebView has no Web Speech API, so without this the narrator is
 * silent there. The plugin object is passed in (native/main.tsx imports it), so the website never bundles it.
 */
import type { SynthLike, UtteranceLike, VoiceLike } from "./Narrator";

/** The part of the plugin's API used here. */
export interface TtsPluginLike {
  speak(o: { text: string; lang?: string; rate?: number; pitch?: number; volume?: number; voice?: number }): Promise<void>;
  stop(): Promise<void>;
  getSupportedVoices(): Promise<{ voices: Array<{ name: string; lang: string }> }>;
}

interface IndexedVoice extends VoiceLike {
  index: number;
}

export function makeUtterance(text: string): UtteranceLike {
  return { text, voice: null, lang: "en-GB", rate: 1, pitch: 1, volume: 1, onend: null, onerror: null };
}

export function pluginSynth(tts: TtsPluginLike): SynthLike {
  let voices: IndexedVoice[] = [];
  const listeners = new Set<() => void>();
  void tts.getSupportedVoices().then(
    (r) => {
      voices = (r.voices ?? []).map((v, index) => ({ name: v.name, lang: v.lang.replace("_", "-"), index }));
      for (const cb of listeners) cb();
    },
    () => undefined,
  );

  return {
    speak(raw: never) {
      const u = raw as unknown as UtteranceLike;
      const voice = u.voice as IndexedVoice | null;
      tts
        .speak({ text: u.text, lang: u.lang, rate: u.rate, pitch: u.pitch, volume: u.volume, voice: voice?.index })
        .then(() => u.onend?.(), () => u.onerror?.());
    },
    cancel() {
      void tts.stop().catch(() => undefined);
    },
    getVoices: () => voices,
    addEventListener: (_type, cb) => void listeners.add(cb),
    removeEventListener: (_type, cb) => void listeners.delete(cb),
  };
}
