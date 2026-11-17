/**
 * The narrator's voice. Every line has a recorded clip (narrationClips.ts, recorded with scripts/narration/), played
 * through the game's audio. When a line has no clip, or the clip cannot play, it falls back to the browser's Web
 * Speech API (`speechSynthesis`, or the phone's text-to-speech in the Android app).
 * Phaser-free, so it can be tested with fakes. Safe to import where `window` is missing.
 *
 * - Picks a deep British voice if the machine has one (see `pickVoice`), reads slowly in a low pitch.
 * - Speech only starts after the first user input (the same unlock rule as the game's sound).
 * - Volume follows the game's sound volume and the game is silent while muted (N key).
 * - `enabled` is saved in localStorage under `dc-voice` (default ON). When the API is missing everything
 *   still works silently and the text box carries the narration.
 */
import { Sfx } from "./Sfx";
import { webClipPlayer, type ClipPlayerLike } from "./narrationClips";

export const VOICE_STORAGE_KEY = "dc-voice";

/** The slice of a `SpeechSynthesisVoice` we read. */
export interface VoiceLike { name: string; lang: string }

/** The slice of an utterance we write. */
export interface UtteranceLike {
  text: string;
  voice: unknown;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** The slice of `speechSynthesis` we use. */
export interface SynthLike {
  speak(u: never): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  addEventListener?(type: "voiceschanged", cb: () => void): void;
  removeEventListener?(type: "voiceschanged", cb: () => void): void;
  onvoiceschanged?: unknown;
}

export interface NarratorDeps {
  synth?: SynthLike | null;
  makeUtterance?: (text: string) => UtteranceLike;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Game sound state (volume 0..1, muted). Defaults to the game's `Sfx`. */
  sound?: () => { volume: number; muted: boolean };
  /** Treat speech as unlocked from the start (tests). Otherwise the first keydown or pointerdown unlocks it. */
  unlocked?: boolean;
  /** Where to listen for the first input; defaults to `window`. */
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  /** Lower the music while speaking (true) and bring it back (false). Defaults to `Sfx.duckMusic`. */
  duck?: (on: boolean) => void;
  /** Recorded clips. Defaults to the web player over `public/narration`; null for none. */
  clips?: ClipPlayerLike | null;
}

export const RATE = 0.82;
export const PITCH = 0.7;
/** The Speech API's ranges: rate 0.1 to 10, pitch 0 to 2, volume 0 to 1. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const BAD_NAMES = /\b(flo|grandma|kate|serena|martha|sandy|shelley|samantha|karen|moira|tessa|fiona|amelie|alice|victoria|zira|susan|hazel|catherine|fred)\b/i;
const GB_MALE_NAMES = /\b(arthur|oliver|reed|rishi|gordon|george|ryan|thomas|james|harry|alfie|malcolm|ralph|lee)\b/i;

const isGB = (v: VoiceLike): boolean => /^en[-_]gb$/i.test(v.lang);
const isEnglish = (v: VoiceLike): boolean => /^en([-_]|$)/i.test(v.lang);

/**
 * Voice preference, in order: a "Grandpa" voice (en-GB), "Daniel" (en-GB), another male-sounding en-GB voice
 * (Arthur, Oliver, Reed, Rishi...), then any English voice that is not a known high or female one, then any English.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): T | undefined {
  const find = (pred: (v: T) => boolean): T | undefined => voices.find(pred);
  return (
    find((v) => isGB(v) && /grandpa/i.test(v.name)) ??
    find((v) => isGB(v) && /daniel/i.test(v.name)) ??
    find((v) => isGB(v) && GB_MALE_NAMES.test(v.name) && !BAD_NAMES.test(v.name)) ??
    find((v) => isGB(v) && !BAD_NAMES.test(v.name) && !/compact|siri/i.test(v.name)) ??
    find((v) => isEnglish(v) && !BAD_NAMES.test(v.name)) ??
    find(isEnglish)
  );
}

/** Rate and pitch for a voice: the Grandpa voice already sounds old and low, so it gets less pitch drop. */
export function settingsFor(voice: VoiceLike | undefined): { rate: number; pitch: number } {
  const grandpa = !!voice && /grandpa/i.test(voice.name);
  return {
    rate: clamp(grandpa ? 0.8 : RATE, 0.1, 10),
    pitch: clamp(grandpa ? 0.85 : PITCH, 0, 2),
  };
}

function defaultSynth(): SynthLike | null {
  const w = globalThis as unknown as { speechSynthesis?: SynthLike };
  return typeof window !== "undefined" && w.speechSynthesis ? w.speechSynthesis : null;
}

function defaultMakeUtterance(): ((text: string) => UtteranceLike) | null {
  const C = (globalThis as unknown as { SpeechSynthesisUtterance?: new (t: string) => UtteranceLike }).SpeechSynthesisUtterance;
  return C ? (text) => new C(text) : null;
}

export class Narrator {
  private synth: SynthLike | null;
  private make: ((text: string) => UtteranceLike) | null;
  private storage: Pick<Storage, "getItem" | "setItem"> | null;
  private sound: () => { volume: number; muted: boolean };
  private duck: (on: boolean) => void;
  private clips: ClipPlayerLike | null;
  private stopClip: (() => void) | null = null;
  private voice: VoiceLike | undefined;
  private on: boolean;
  private unlockedFlag: boolean;
  private busy = false;
  /** Bumped on every speak and stop, so a cancelled utterance's late `onend` cannot clear a newer one's state. */
  private token = 0;
  private unlockTarget: NarratorDeps["eventTarget"];
  private readonly unlockHandler = () => this.unlock();
  private readonly voicesHandler = () => this.refreshVoice();

  constructor(deps: NarratorDeps = {}) {
    this.synth = deps.synth !== undefined ? deps.synth : defaultSynth();
    const mk = defaultMakeUtterance();
    this.make = deps.makeUtterance ?? mk;
    if (!this.make) this.synth = null; // no utterance class: nothing to speak with
    this.storage = deps.storage !== undefined ? deps.storage : safeStorage();
    this.sound = deps.sound ?? (() => ({ volume: Sfx.getVolume(), muted: Sfx.isMuted() }));
    this.duck = deps.duck ?? ((on) => Sfx.duckMusic(on));
    this.clips = deps.clips !== undefined ? deps.clips : webClipPlayer();
    this.on = this.readEnabled();
    this.unlockedFlag = !!deps.unlocked;
    this.unlockTarget = deps.eventTarget !== undefined ? deps.eventTarget : typeof window !== "undefined" ? window : null;

    if (this.synth) {
      this.refreshVoice();
      // Chrome fills the voice list asynchronously.
      if (this.synth.addEventListener) this.synth.addEventListener("voiceschanged", this.voicesHandler);
      else this.synth.onvoiceschanged = this.voicesHandler;
    }
    if (!this.unlockedFlag && this.unlockTarget) {
      this.unlockedFlag = userHasBeenActive();
      if (!this.unlockedFlag) {
        this.unlockTarget.addEventListener("keydown", this.unlockHandler, true);
        this.unlockTarget.addEventListener("pointerdown", this.unlockHandler, true);
      }
    }
  }

  /** True when there is any voice at all: recorded clips or the browser's speech synthesis. */
  isAvailable(): boolean {
    return this.synth !== null || this.clips !== null;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    try {
      this.storage?.setItem(VOICE_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* not persisted */
    }
    if (!on) this.stop();
  }

  /**
   * Swap in another speech engine (the Android app, whose WebView has no `speechSynthesis`, passes the native
   * text-to-speech plugin through `nativeSpeech`). Only takes effect when no engine was found at start.
   */
  useSynth(synth: SynthLike, makeUtterance: (text: string) => UtteranceLike): void {
    if (this.synth) return;
    this.synth = synth;
    this.make = makeUtterance;
    this.refreshVoice();
    synth.addEventListener?.("voiceschanged", this.voicesHandler);
  }

  /** The voice currently chosen (undefined until the browser lists voices, or when it has no English one). */
  currentVoice(): VoiceLike | undefined {
    return this.voice;
  }

  /** True when a call to `speak` would make sound: API present, switched on, input seen, game not muted. */
  canSpeak(): boolean {
    return this.isAvailable() && this.on && this.unlockedFlag && !this.sound().muted;
  }

  /** True from the start of an utterance until it ends, errors or is cancelled. */
  isSpeaking(): boolean {
    return this.busy;
  }

  /**
   * Read `text` aloud, cancelling anything still speaking first. Returns true if speech was started.
   * `onDone` runs when the utterance ends or fails (not when a newer `speak` or `stop` cancels it).
   */
  speak(text: string, onDone?: () => void): boolean {
    if (!this.isAvailable()) return false;
    this.cancelCurrent();
    if (!this.canSpeak() || !text.trim()) return false;
    const mine = ++this.token;
    const finish = () => {
      if (this.token !== mine) return;
      this.busy = false;
      this.stopClip = null;
      this.duck(false);
      onDone?.();
    };
    if (this.clips?.has(text)) {
      this.busy = true;
      this.duck(true); // the music drops to a murmur while the voice reads
      // A clip that cannot play hands over to the speech engine, or ends quietly if there is none.
      const fallback = () => {
        if (this.token !== mine) return;
        this.stopClip = null;
        if (!this.speakSynth(text, finish)) finish();
      };
      this.stopClip = this.clips.play(text, finish, fallback);
      return true;
    }
    if (!this.speakSynth(text, finish)) {
      this.busy = false;
      return false;
    }
    return true;
  }

  /** Read `text` with the speech engine. `finish` runs on end or error. False if it could not start. */
  private speakSynth(text: string, finish: () => void): boolean {
    if (!this.synth || !this.make) return false;
    const u = this.make(text);
    const { rate, pitch } = settingsFor(this.voice);
    u.voice = this.voice ?? null;
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = rate;
    u.pitch = pitch;
    u.volume = clamp(this.sound().volume, 0, 1);
    this.busy = true;
    u.onend = finish;
    u.onerror = finish;
    try {
      this.duck(true); // the music drops to a murmur while the voice reads
      this.synth.speak(u as never);
    } catch {
      this.busy = false;
      this.duck(false);
      return false;
    }
    return true;
  }

  /** Stop talking now. Does not call the `onDone` of the utterance it cuts off. */
  stop(): void {
    this.cancelCurrent();
  }

  /** Remove listeners (scene teardown is not the place for this: the instance lives for the page). */
  dispose(): void {
    this.stop();
    this.synth?.removeEventListener?.("voiceschanged", this.voicesHandler);
    this.unlockTarget?.removeEventListener("keydown", this.unlockHandler, true);
    this.unlockTarget?.removeEventListener("pointerdown", this.unlockHandler, true);
  }

  /** Mark input as seen (called by the first keydown or pointerdown). */
  unlock(): void {
    this.unlockedFlag = true;
    this.unlockTarget?.removeEventListener("keydown", this.unlockHandler, true);
    this.unlockTarget?.removeEventListener("pointerdown", this.unlockHandler, true);
  }

  private cancelCurrent(): void {
    this.token++;
    const stopClip = this.stopClip;
    this.stopClip = null;
    stopClip?.();
    if (this.busy) this.duck(false);
    this.busy = false;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }

  private refreshVoice(): void {
    try {
      this.voice = pickVoice(this.synth?.getVoices() ?? []);
    } catch {
      this.voice = undefined;
    }
  }

  private readEnabled(): boolean {
    try {
      return this.storage?.getItem(VOICE_STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  }
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function userHasBeenActive(): boolean {
  try {
    return !!(globalThis.navigator as unknown as { userActivation?: { hasBeenActive?: boolean } } | undefined)?.userActivation?.hasBeenActive;
  } catch {
    return false;
  }
}

/** The game's one narrator. */
export const narrator = new Narrator();
