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
  midiToHz,
  type MusicBed,
  type NoteEvent,
  type SfxKey,
  type Voice,
} from "./sfxData";
import { BedPlanner, stepSeconds, type Segment } from "./musicPlan";
import type { BedDef, TrackDef } from "./musicData";

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
/** Seconds one bed takes to fade out as the next fades in. */
const CROSSFADE_S = 1.5;
/** Fade for the very first bed, and for music(null). */
const FADE_IN_S = 0.4;
const FADE_STOP_S = 0.6;
const COMBAT_IN_S = 0.8;
const COMBAT_OUT_S = 2.5;
/** How long the combat layer lingers after the last combat(false) or pulse. */
const COMBAT_GRACE_MS = 3500;
const COMBAT_PULSE_MS = 6000;
/** Never more than this many fading beds alive at once. */
const MAX_FADING = 2;

/** One bed being played: its own gain (for fades), planner and clock. */
interface Player {
  bed: MusicBed;
  def: BedDef;
  planner: BedPlanner;
  gain: GainNode;
  seg: Segment | null;
  stepInSeg: number;
  nextStepTime: number;
  stepDur: number;
  /** Audio-clock time after which a fading player is dropped. */
  endAt: number | null;
}

/** Music level while the narrator speaks: almost silent, so the voice is clear. */
export const DUCK_LEVEL = 0.06;
const DUCK_DOWN_S = 0.35;
const DUCK_UP_S = 1.2;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private ducked = false;
  private noiseBuf: AudioBuffer | null = null;

  private volume = 0.5;
  private muted = false;
  private requestedBed: MusicBed | null = null;
  private bossOn = false;
  private combatUntil = 0;
  private musicSeed: number | null = null;
  private main: Player | null = null;
  private combatPlayer: Player | null = null;
  private fading: Player[] = [];
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
      if (this.ctx && this.ctx.state === "suspended") {
        // the context is only "running" once resume settles, so start the bed then
        void this.ctx.resume().then(
          () => {
            this.applyBed();
            this.syncCombat();
          },
          () => undefined,
        );
      }
      this.applyBed();
      this.syncCombat();
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

  /** Drop the music to almost nothing (true) or bring it back (false). Used while the narrator speaks. */
  duckMusic(on: boolean): void {
    this.ducked = on;
    const g = this.duckGain;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.linearRampToValueAtTime(on ? DUCK_LEVEL : 1, now + (on ? DUCK_DOWN_S : DUCK_UP_S));
  }

  isDucked(): boolean {
    return this.ducked;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** The bed currently requested (may be waiting on unlock); the boss bed while a boss fight is on. */
  currentBed(): MusicBed | null {
    return this.effectiveBed();
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

  /** Start a looping bed (crossfading from the last one), or stop music with null. */
  music(bed: MusicBed | null): void {
    this.requestedBed = bed;
    if (bed === null) {
      this.bossOn = false;
      this.combatUntil = 0;
      this.applyBed();
      this.syncCombat();
      return;
    }
    this.watchForGesture();
    this.applyBed();
  }

  /** Fix the seed the next bed will vary with (tests, debugging); null goes back to a random one. */
  setMusicSeed(seed: number | null): void {
    this.musicSeed = seed === null ? null : seed >>> 0;
  }

  /**
   * Combat layer on top of the floor bed. `true` holds it until `false`; after `false` it lingers a few
   * seconds and fades out. Call with `true` while monsters are hunting the player.
   */
  combat(on: boolean): void {
    const now = Date.now();
    if (on) this.combatUntil = Number.POSITIVE_INFINITY;
    else if (this.combatUntil > now) this.combatUntil = Math.min(this.combatUntil, now + COMBAT_GRACE_MS);
    this.watchForGesture();
    this.syncCombat();
  }

  /** Combat for the next few seconds; call again on every hit or hostile sighting to keep it going. */
  combatPulse(holdMs = COMBAT_PULSE_MS): void {
    const until = Date.now() + holdMs;
    if (until > this.combatUntil) this.combatUntil = until;
    this.watchForGesture();
    this.syncCombat();
  }

  /** The boss bed replaces the floor bed while on; the floor bed returns when off. */
  boss(on: boolean): void {
    if (this.bossOn === on) return;
    this.bossOn = on;
    this.applyBed();
    this.syncCombat();
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
    // A separate stage after the music bus, so ducking for the narrator never fights the bed crossfades.
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = this.ducked ? DUCK_LEVEL : 1;
    this.musicBus.connect(this.duckGain);
    this.duckGain.connect(master);
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
      src.onended = () => {
        src.disconnect();
        f.disconnect();
        g.disconnect();
      };
      src.start(t0, Math.random() * 0.5);
      src.stop(end + 0.02);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = v.wave === "saw" ? "sawtooth" : v.wave;
    osc.frequency.setValueAtTime(v.f0 * drift, t0);
    if (v.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1 * drift), end);
    osc.connect(g);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(end + 0.02);
  }

  private effectiveBed(): MusicBed | null {
    return this.bossOn && this.requestedBed !== null ? "boss" : this.requestedBed;
  }

  private ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running" && this.musicBus !== null;
  }

  /** Make the playing bed match the wanted one, crossfading if it changed. */
  private applyBed(): void {
    if (!this.ready()) return;
    const want = this.effectiveBed();
    if (this.main?.bed === want) return;
    if (!this.main && want === null) return;
    const fadeIn = this.main ? CROSSFADE_S : FADE_IN_S;
    if (this.main) this.retire(this.main, want === null ? FADE_STOP_S : CROSSFADE_S);
    this.main = want ? this.spawn(want, fadeIn, 1) : null;
    this.ensureTimer();
  }

  /** Bring the combat layer in or out to match the wanted state. */
  private syncCombat(): void {
    if (!this.ready()) return;
    const bed = this.effectiveBed();
    const wanted = Date.now() < this.combatUntil && this.main !== null && bed !== "boss" && bed !== "combat";
    if (wanted && !this.combatPlayer) {
      this.combatPlayer = this.spawn("combat", COMBAT_IN_S, 0.9);
      this.ensureTimer();
    } else if (!wanted && this.combatPlayer) {
      this.retire(this.combatPlayer, COMBAT_OUT_S);
      this.combatPlayer = null;
    }
  }

  private spawn(bed: MusicBed, fadeInS: number, level: number): Player {
    const ctx = this.ctx as AudioContext;
    const def = MUSIC[bed];
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level * (def.level ?? 1), now + fadeInS);
    gain.connect(this.musicBus as GainNode);
    const seed = this.musicSeed ?? (Math.random() * 4294967296) >>> 0;
    const p: Player = {
      bed,
      def,
      planner: new BedPlanner(def, seed),
      gain,
      seg: null,
      stepInSeg: 0,
      nextStepTime: now + 0.08,
      stepDur: stepSeconds(def),
      endAt: null,
    };
    this.pump(p);
    return p;
  }

  /** Fade a player out; it keeps playing until the fade ends, then is disconnected. */
  private retire(p: Player, secs: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const from = Math.max(0.0001, p.gain.gain.value);
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(from, now);
    p.gain.gain.linearRampToValueAtTime(0.0001, now + secs);
    p.endAt = now + secs + 0.1;
    this.fading.push(p);
    while (this.fading.length > MAX_FADING) this.drop(this.fading.shift() as Player);
  }

  private drop(p: Player): void {
    try {
      p.gain.disconnect();
    } catch {
      /* already gone */
    }
  }

  private ensureTimer(): void {
    if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.main) this.pump(this.main);
    if (this.combatPlayer) this.pump(this.combatPlayer);
    for (const p of this.fading) this.pump(p);
    this.fading = this.fading.filter((p) => {
      if (p.endAt !== null && ctx.currentTime > p.endAt) {
        this.drop(p);
        return false;
      }
      return true;
    });
    this.syncCombat();
    if (!this.main && !this.combatPlayer && this.fading.length === 0) this.stopTimer();
  }

  /** Schedule the steps of one player that fall inside the lookahead window. */
  private pump(p: Player): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // if the tab slept, don't try to catch up on a backlog
    if (p.nextStepTime < ctx.currentTime - 0.5) p.nextStepTime = ctx.currentTime + 0.05;
    while (p.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      if (!p.seg || p.stepInSeg >= p.seg.steps) {
        p.seg = p.planner.next();
        p.stepInSeg = 0;
      }
      const seg = p.seg;
      p.def.tracks.forEach((tr, i) => {
        const ev = seg.events[i].get(p.stepInSeg);
        if (ev) this.note(tr, ev, p.nextStepTime, p.stepDur, p.gain);
      });
      p.stepInSeg += 1;
      p.nextStepTime += p.stepDur;
    }
  }

  /** One music note or percussion hit. */
  private note(tr: TrackDef, ev: NoteEvent, t: number, stepDur: number, bus: GainNode): void {
    if (tr.wave === "noise") {
      if (ev.midi === -2) {
        this.voice({ wave: "triangle", f0: 130, f1: 45, dur: 0.13, vol: tr.vol * 3.2 }, t, 1, bus);
        this.voice({ wave: "noise", f0: 420, f1: 110, dur: 0.07, vol: tr.vol * 1.6, filter: "lowpass" }, t, 1, bus);
      } else if (ev.midi === -3) {
        this.voice({ wave: "noise", f0: 2400, f1: 1000, dur: 0.1, vol: tr.vol * 3.4, filter: "bandpass" }, t, 1, bus);
        this.voice({ wave: "triangle", f0: 200, f1: 120, dur: 0.06, vol: tr.vol * 1.2 }, t, 1, bus);
      } else {
        this.voice({ wave: "noise", f0: 6000, f1: 2500, dur: 0.05, vol: tr.vol * 3, filter: "highpass" }, t, 1, bus);
      }
      return;
    }
    const hz = midiToHz(ev.midi);
    if (tr.wave === "bell") {
      // a strike of noise, then a decaying square, its inharmonic partner and a low body
      this.voice({ wave: "noise", f0: 1800, f1: 700, dur: 0.09, vol: tr.vol * 2.2, filter: "bandpass" }, t, 1, bus);
      this.voice({ wave: "square", f0: hz, dur: 2.4, vol: tr.vol }, t, 1, bus);
      this.voice({ wave: "square", f0: hz * 2.76, dur: 1.2, vol: tr.vol * 0.35 }, t, 1, bus);
      this.voice({ wave: "triangle", f0: hz / 2, dur: 2.6, vol: tr.vol * 1.4 }, t, 1, bus);
      return;
    }
    const dur = Math.max(0.04, ev.len * stepDur * 0.92);
    this.voice({ wave: tr.wave, f0: hz, dur, vol: tr.vol, sustain: ev.len > 1 }, t, 1, bus);
  }
}

export const Sfx = new SfxEngine();
