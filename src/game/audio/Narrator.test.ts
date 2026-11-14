import { describe, expect, it } from "vitest";
import { Narrator, VOICE_STORAGE_KEY, pickVoice, settingsFor, type SynthLike, type UtteranceLike, type VoiceLike } from "./Narrator";

const v = (name: string, lang = "en-GB"): VoiceLike => ({ name, lang });

class FakeSynth implements SynthLike {
  voices: VoiceLike[];
  spoken: UtteranceLike[] = [];
  cancels = 0;
  listeners: Array<() => void> = [];
  constructor(voices: VoiceLike[] = []) { this.voices = voices; }
  speak(u: never): void { this.spoken.push(u as UtteranceLike); }
  cancel(): void { this.cancels++; }
  getVoices(): VoiceLike[] { return this.voices; }
  addEventListener(_t: "voiceschanged", cb: () => void): void { this.listeners.push(cb); }
}

function mem(init?: string) {
  const m = new Map<string, string>();
  if (init !== undefined) m.set(VOICE_STORAGE_KEY, init);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, val: string) => void m.set(k, val), m };
}

const make = (text: string): UtteranceLike => ({ text, voice: null, lang: "", rate: 1, pitch: 1, volume: 1, onend: null, onerror: null });

function mk(synth: FakeSynth | null, extra: Partial<ConstructorParameters<typeof Narrator>[0]> = {}) {
  return new Narrator({ synth, makeUtterance: make, storage: mem(), sound: () => ({ volume: 0.5, muted: false }), unlocked: true, eventTarget: null, ...extra });
}

describe("pickVoice", () => {
  it("prefers a Grandpa en-GB voice over Daniel", () => {
    expect(pickVoice([v("Daniel"), v("Grandpa (English (UK))"), v("Samantha", "en-US")])?.name).toBe("Grandpa (English (UK))");
  });
  it("then Daniel", () => {
    expect(pickVoice([v("Kate"), v("Arthur"), v("Daniel")])?.name).toBe("Daniel");
  });
  it("then other male-sounding en-GB voices, never the avoided names", () => {
    expect(pickVoice([v("Flo"), v("Grandma (English (UK))"), v("Kate"), v("Oliver")])?.name).toBe("Oliver");
    expect(pickVoice([v("Flo"), v("Shelley"), v("Reed")])?.name).toBe("Reed");
  });
  it("then any English voice, skipping the avoided ones when possible", () => {
    expect(pickVoice([v("Amelie", "fr-CA"), v("Serena", "en-US"), v("Fred", "en-US"), v("Bruce", "en-US")])?.name).toBe("Bruce");
    expect(pickVoice([v("Amelie", "fr-CA"), v("Martha", "en-GB")])?.name).toBe("Martha");
  });
  it("is undefined with no English voice", () => {
    expect(pickVoice([v("Amelie", "fr-CA")])).toBeUndefined();
    expect(pickVoice([])).toBeUndefined();
  });
  it("gives the Grandpa voice a gentler pitch drop, all within the API ranges", () => {
    const g = settingsFor(v("Grandpa"));
    const d = settingsFor(v("Daniel"));
    expect(g.pitch).toBeGreaterThan(d.pitch);
    for (const s of [g, d, settingsFor(undefined)]) {
      expect(s.rate).toBeGreaterThanOrEqual(0.1); expect(s.rate).toBeLessThanOrEqual(10);
      expect(s.pitch).toBeGreaterThanOrEqual(0); expect(s.pitch).toBeLessThanOrEqual(2);
    }
    expect(d.rate).toBeCloseTo(0.82); expect(d.pitch).toBeCloseTo(0.7);
  });
});

describe("Narrator", () => {
  it("defaults on and persists the enabled flag", () => {
    const st = mem();
    const n = mk(new FakeSynth(), { storage: st });
    expect(n.enabled).toBe(true);
    n.setEnabled(false);
    expect(st.m.get(VOICE_STORAGE_KEY)).toBe("0");
    expect(mk(new FakeSynth(), { storage: st }).enabled).toBe(false);
    n.setEnabled(true);
    expect(mk(new FakeSynth(), { storage: st }).enabled).toBe(true);
  });

  it("picks the voice when voiceschanged fires after construction", () => {
    const s = new FakeSynth([]);
    const n = mk(s);
    expect(n.currentVoice()).toBeUndefined();
    s.voices = [v("Daniel")];
    s.listeners.forEach((cb) => cb());
    expect(n.currentVoice()?.name).toBe("Daniel");
  });

  it("speak cancels what was speaking first, and sets rate, pitch and volume", () => {
    const s = new FakeSynth([v("Daniel")]);
    const n = mk(s);
    expect(n.speak("one")).toBe(true);
    expect(s.cancels).toBe(1);
    expect(n.speak("two")).toBe(true);
    expect(s.cancels).toBe(2);
    expect(s.spoken.map((u) => u.text)).toEqual(["one", "two"]);
    expect(s.spoken[1].volume).toBe(0.5);
    expect(s.spoken[1].rate).toBeCloseTo(0.82);
    expect(n.isSpeaking()).toBe(true);
    s.spoken[1].onend?.();
    expect(n.isSpeaking()).toBe(false);
  });

  it("a cancelled utterance's late end event does not clear the newer one", () => {
    const s = new FakeSynth([v("Daniel")]);
    const n = mk(s);
    n.speak("one");
    n.speak("two");
    s.spoken[0].onend?.();
    expect(n.isSpeaking()).toBe(true);
  });

  it("stop cancels and clears the speaking flag", () => {
    const s = new FakeSynth([v("Daniel")]);
    const n = mk(s);
    n.speak("one");
    n.stop();
    expect(n.isSpeaking()).toBe(false);
    expect(s.cancels).toBe(2);
  });

  it("stays silent when disabled, muted, not yet unlocked, or when the API is missing", () => {
    const s = new FakeSynth([v("Daniel")]);
    const off = mk(s); off.setEnabled(false);
    expect(off.speak("x")).toBe(false);
    expect(mk(s, { sound: () => ({ volume: 1, muted: true }) }).speak("x")).toBe(false);
    expect(mk(s, { unlocked: false }).speak("x")).toBe(false);
    const none = mk(null);
    expect(none.isAvailable()).toBe(false);
    expect(none.speak("x")).toBe(false);
    expect(s.spoken).toHaveLength(0);
  });

  it("the first input unlocks speech", () => {
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (t: string, cb: () => void) => void listeners.set(t, cb),
      removeEventListener: (t: string) => void listeners.delete(t),
    } as never;
    const s = new FakeSynth([v("Daniel")]);
    const n = mk(s, { unlocked: false, eventTarget: target });
    expect(n.speak("x")).toBe(false);
    listeners.get("keydown")?.();
    expect(n.speak("x")).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
