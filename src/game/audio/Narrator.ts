/**
 * The narrator's voice: a thin wrapper over the browser's Web Speech API (`speechSynthesis`), no audio files.
 * Phaser-free, so it can be tested with a fake `speechSynthesis`. Safe to import where `window` is missing.
 *
 * - Picks a deep British voice if the machine has one (see `pickVoice`), reads slowly in a low pitch.
 * - Speech only starts after the first user input (the same unlock rule as the game's sound).
 * - Volume follows the game's sound volume and the game is silent while muted (N key).
 * - `enabled` is saved in localStorage under `dc-voice` (default ON). When the API is missing everything
 *   still works silently and the text box carries the narration.
 */
import { Sfx } from "./Sfx";

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

  /** True when the browser has speech synthesis at all. */
  isAvailable(): boolean {
    return this.synth !== null;
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

  /** The voice currently chosen (undefined until the browser lists voices, or when it has no English one). */
  currentVoice(): VoiceLike | undefined {
    return this.voice;
  }

  /** True when a call to `speak` would make sound: API present, switched on, input seen, game not muted. */
  canSpeak(): boolean {
    return this.synth !== null && this.on && this.unlockedFlag && !this.sound().muted;
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
    if (!this.synth || !this.make) return false;
    this.cancelCurrent();
    if (!this.canSpeak() || !text.trim()) return false;
    const u = this.make(text);
    const { rate, pitch } = settingsFor(this.voice);
    u.voice = this.voice ?? null;
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = rate;
    u.pitch = pitch;
    u.volume = clamp(this.sound().volume, 0, 1);
    const mine = ++this.token;
    this.busy = true;
    const finish = () => {
      if (this.token !== mine) return;
      this.busy = false;
      this.duck(false);
      onDone?.();
    };
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
