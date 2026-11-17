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
  return new Narrator({ synth, makeUtterance: make, storage: mem(), sound: () => ({ volume: 0.5, muted: false }), unlocked: true, eventTarget: null, duck: () => {}, clips: null, ...extra });
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

describe("music ducking", () => {
  it("lowers the music while speaking and brings it back when the voice ends or is cut off", () => {
    const calls: boolean[] = [];
    const synth = new FakeSynth([v("Daniel")]);
    const n = mk(synth, { duck: (on) => calls.push(on) });
    expect(n.speak("The stair goes down.")).toBe(true);
    expect(calls).toEqual([true]);
    synth.spoken[0].onend?.();
    expect(calls).toEqual([true, false]);
    n.speak("Again.");
    n.stop();
    expect(calls).toEqual([true, false, true, false]);
  });
});

describe("recorded clips", () => {
  class FakeClips {
    plays: Array<{ text: string; end: () => void; fail: () => void; stopped: boolean }> = [];
    constructor(private known: string[]) {}
    has(text: string): boolean { return this.known.includes(text); }
    play(text: string, end: () => void, fail: () => void): () => void {
      const p = { text, end, fail, stopped: false };
      this.plays.push(p);
      return () => { p.stopped = true; };
    }
  }

  it("plays the clip instead of the speech engine, busy until it ends", () => {
    const synth = new FakeSynth([v("Daniel")]);
    const clips = new FakeClips(["The stair goes down."]);
    const ducks: boolean[] = [];
    let done = 0;
    const n = mk(synth, { clips, duck: (on) => ducks.push(on) });
    expect(n.speak("The stair goes down.", () => done++)).toBe(true);
    expect(synth.spoken).toHaveLength(0);
    expect(n.isSpeaking()).toBe(true);
    expect(ducks).toEqual([true]);
    clips.plays[0].end();
    expect(n.isSpeaking()).toBe(false);
    expect(ducks).toEqual([true, false]);
    expect(done).toBe(1);
  });

  it("uses the speech engine for a line with no clip", () => {
    const synth = new FakeSynth([v("Daniel")]);
    const clips = new FakeClips([]);
    const n = mk(synth, { clips });
    expect(n.speak("Unrecorded.")).toBe(true);
    expect(clips.plays).toHaveLength(0);
    expect(synth.spoken[0].text).toBe("Unrecorded.");
  });

  it("falls back to the speech engine when a clip cannot play, and ends quietly with no engine", () => {
    const synth = new FakeSynth([v("Daniel")]);
    const clips = new FakeClips(["Line."]);
    const n = mk(synth, { clips });
    n.speak("Line.");
    clips.plays[0].fail();
    expect(synth.spoken[0].text).toBe("Line.");
    expect(n.isSpeaking()).toBe(true);
    synth.spoken[0].onend?.();
    expect(n.isSpeaking()).toBe(false);

    let done = 0;
    const solo = mk(null, { clips: new FakeClips(["Line."]) });
    expect(solo.isAvailable()).toBe(true);
    expect(solo.speak("Line.", () => done++)).toBe(true);
    (solo as unknown as { clips: FakeClips }).clips.plays[0].fail();
    expect(solo.isSpeaking()).toBe(false);
    expect(done).toBe(1);
  });

  it("stop and a newer line cut the clip off, and its late end changes nothing", () => {
    const clips = new FakeClips(["One.", "Two."]);
    let done = 0;
    const n = mk(null, { clips });
    n.speak("One.", () => done++);
    n.speak("Two.");
    expect(clips.plays[0].stopped).toBe(true);
    clips.plays[0].end();
    expect(done).toBe(0);
    expect(n.isSpeaking()).toBe(true);
    n.stop();
    expect(clips.plays[1].stopped).toBe(true);
    expect(n.isSpeaking()).toBe(false);
  });

  it("stays silent while muted or switched off, clips or not", () => {
    const clips = new FakeClips(["Line."]);
    expect(mk(null, { clips, sound: () => ({ volume: 1, muted: true }) }).speak("Line.")).toBe(false);
    const off = mk(null, { clips }); off.setEnabled(false);
    expect(off.speak("Line.")).toBe(false);
    expect(clips.plays).toHaveLength(0);
  });
});
