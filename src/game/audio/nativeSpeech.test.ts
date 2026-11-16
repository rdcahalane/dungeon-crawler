import { describe, expect, it, vi } from "vitest";
import { Narrator } from "./Narrator";
import { makeUtterance, pluginSynth, type TtsPluginLike } from "./nativeSpeech";

function fakeTts() {
  let finish: (() => void) | null = null;
  const tts: TtsPluginLike & { calls: unknown[] } = {
    calls: [],
    speak: vi.fn((o) => {
      tts.calls.push(o);
      return new Promise<void>((r) => { finish = r; });
    }),
    stop: vi.fn(() => Promise.resolve()),
    getSupportedVoices: vi.fn(() =>
      Promise.resolve({ voices: [{ name: "en-us-x-sfg-local", lang: "en-US" }, { name: "en-gb-x-gbd-local", lang: "en_GB" }] }),
    ),
  };
  return { tts, end: () => finish?.() };
}

describe("pluginSynth", () => {
  it("lists the plugin's voices with normalised language tags and tells listeners", async () => {
    const { tts } = fakeTts();
    const synth = pluginSynth(tts);
    const heard = vi.fn();
    synth.addEventListener?.("voiceschanged", heard);
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.getVoices().map((v) => v.lang)).toEqual(["en-US", "en-GB"]);
    expect(heard).toHaveBeenCalled();
  });

  it("lets a narrator with no Web Speech API speak through the plugin, British voice by index", async () => {
    const { tts, end } = fakeTts();
    const n = new Narrator({ synth: null, storage: null, unlocked: true, sound: () => ({ volume: 0.5, muted: false }), duck: () => undefined });
    expect(n.isAvailable()).toBe(false);
    n.useSynth(pluginSynth(tts), makeUtterance);
    await Promise.resolve();
    await Promise.resolve();
    expect(n.isAvailable()).toBe(true);
    const done = vi.fn();
    expect(n.speak("The stair goes down.", done)).toBe(true);
    expect(tts.calls[0]).toMatchObject({ text: "The stair goes down.", lang: "en-GB", voice: 1, volume: 0.5 });
    expect(n.isSpeaking()).toBe(true);
    end();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalled();
    expect(n.isSpeaking()).toBe(false);
  });

  it("stop() stops the plugin", () => {
    const { tts } = fakeTts();
    pluginSynth(tts).cancel();
    expect(tts.stop).toHaveBeenCalled();
  });
});
