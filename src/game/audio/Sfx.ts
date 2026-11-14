/**
 * Synthesized sound: square, triangle and noise voices through WebAudio. No
 * audio files. Safe to import and call where `window` or `AudioContext` is
 * missing (SSR, tests): every call becomes a no-op.
 *
 * Browsers start an AudioContext suspended until a user gesture, so call
 * `Sfx.unlock()` from the first input (it is also hooked automatically to the
 * first pointer or key event once anything asks for sound).
 */
import {
  EFFECTS,
  MUSIC,
  MUSIC_BEDS,
  SFX_KEYS,
  bedLength,
  midiToHz,
  parseTrack,
  type MusicBed,
  type MusicBedDef,
  type NoteEvent,
  type SfxKey,
  type Voice,
} from "./sfxData";

export { SFX_KEYS, MUSIC_BEDS };
export type { SfxKey, MusicBed };

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | undefined {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

const LOOKAHEAD_S = 0.3;
const TICK_MS = 90;
const MIN_REPEAT_S = 0.03;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private volume = 0.5;
  private muted = false;
  private wantedBed: MusicBed | null = null;
  private playingBed: MusicBed | null = null;
  private parsed: Array<{ wave: string; vol: number; events: Map<number, NoteEvent> }> = [];
  private bedDef: MusicBedDef | null = null;
  private bedSteps = 0;
  private stepIdx = 0;
  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPlayed = new Map<string, number>();
  private listening = false;

  /** True if this environment can make sound at all. */
  isSupported(): boolean {
    return audioCtor() !== undefined;
  }

  /** True once the AudioContext exists and is running. */
  isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Create or resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    const Ctor = audioCtor();
    if (!Ctor) return;
    try {
      if (!this.ctx) this.build(Ctor);
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
      if (this.wantedBed && this.playingBed !== this.wantedBed) this.startBed(this.wantedBed);
    } catch {
      /* audio unavailable; stay silent */
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyGain();
  }

  getVolume(): number {
    return this.volume;
  }

  mute(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** The bed currently requested (may be waiting on unlock). */
  currentBed(): MusicBed | null {
    return this.wantedBed;
  }

  /** Play a named effect. Unknown keys are ignored. */
  play(key: SfxKey | string): void {
    const recipe = (EFFECTS as Record<string, Voice[] | undefined>)[key];
    if (!recipe) return;
    this.watchForGesture();
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(key) ?? -1;
    if (now - last < MIN_REPEAT_S) return;
    this.lastPlayed.set(key, now);
    // a little random pitch drift keeps repeats (footsteps, hits) from sounding mechanical
    const drift = key === "step" || key === "hit" || key === "swing" ? 0.9 + Math.random() * 0.2 : 1;
    try {
      for (const v of recipe) this.voice(v, now + (v.delay ?? 0), drift, this.sfxBus);
    } catch {
      /* ignore */
    }
  }

  /** Start a looping bed, or stop music with null. */
  music(bed: MusicBed | null): void {
    this.wantedBed = bed;
    if (bed === null) {
      this.stopBed();
      return;
    }
    this.watchForGesture();
    if (this.playingBed === bed) return;
    if (this.ctx && this.ctx.state === "running") this.startBed(bed);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private build(Ctor: AudioCtor): void {
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.7;
    this.musicBus.connect(master);
    // one second of white noise, reused by every noise voice
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /** Hook the first pointer or key event so audio unlocks without game code. */
  private watchForGesture(): void {
    if (this.listening || this.isUnlocked() || typeof window === "undefined") return;
    this.listening = true;
    const handler = () => {
      this.unlock();
      if (this.isUnlocked() || !this.isSupported()) {
        window.removeEventListener("pointerdown", handler);
        window.removeEventListener("keydown", handler);
        window.removeEventListener("touchstart", handler);
        this.listening = false;
      }
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("touchstart", handler);
  }

  private voice(v: Voice, t0: number, drift: number, bus: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain();
    const end = t0 + v.dur;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v.vol, t0 + 0.004);
    if (v.sustain) g.gain.setValueAtTime(v.vol, Math.max(t0 + 0.005, end - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(bus);
    if (v.wave === "noise") {
      if (!this.noiseBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = v.filter ?? "lowpass";
      f.frequency.setValueAtTime(v.f0 * drift, t0);
      if (v.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1 * drift), end);
      f.Q.value = f.type === "bandpass" ? 2 : 0.7;
      src.connect(f);
      f.connect(g);
      src.start(t0, Math.random() * 0.5);
      src.stop(end + 0.02);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = v.wave === "saw" ? "sawtooth" : v.wave;
    osc.frequency.setValueAtTime(v.f0 * drift, t0);
    if (v.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1 * drift), end);
    osc.connect(g);
    osc.start(t0);
    osc.stop(end + 0.02);
  }

  private startBed(bed: MusicBed): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopTimer();
    const def = MUSIC[bed];
    this.bedDef = def;
    this.bedSteps = bedLength(def);
    this.parsed = def.tracks.map((t) => {
      const events = new Map<number, NoteEvent>();
      for (const e of parseTrack(t.notes)) events.set(e.start, e);
      return { wave: t.wave, vol: t.vol, events };
    });
    this.playingBed = bed;
    this.stepIdx = 0;
    this.nextStepTime = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }

  private stopBed(): void {
    this.stopTimer();
    this.playingBed = null;
    this.bedDef = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Schedule steps that fall inside the lookahead window. */
  private pump(): void {
    const ctx = this.ctx;
    const def = this.bedDef;
    if (!ctx || !def || !this.musicBus) return;
    const stepDur = 60 / def.bpm / def.stepsPerBeat;
    // if the tab slept, don't try to catch up on a backlog
    if (this.nextStepTime < ctx.currentTime - 0.5) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      for (const tr of this.parsed) {
        const ev = tr.events.get(this.stepIdx);
        if (!ev) continue;
        const dur = Math.max(0.04, ev.len * stepDur * 0.92);
        if (tr.wave === "noise") {
          this.voice(
            { wave: "noise", f0: 6000, f1: 2500, dur: 0.05, vol: tr.vol * 3, filter: "highpass" },
            this.nextStepTime,
            1,
            this.musicBus,
          );
        } else {
          this.voice(
            { wave: tr.wave as "square" | "triangle", f0: midiToHz(ev.midi), dur, vol: tr.vol, sustain: ev.len > 1 },
            this.nextStepTime,
            1,
            this.musicBus,
          );
        }
      }
      this.nextStepTime += stepDur;
      this.stepIdx = (this.stepIdx + 1) % this.bedSteps;
    }
  }
}

export const Sfx = new SfxEngine();
