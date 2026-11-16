/**
 * Touch support: is this a touch device, and how a touch button fires a game action "exactly as its key would".
 *
 * The game's key handlers are of three kinds: Phaser Key objects read with `JustDown` or `isDown` (matched on the
 * event's `keyCode`), Phaser `keydown-X` events (also by `keyCode`), and raw `window` listeners that read `e.code`
 * or `e.key`. A real `KeyboardEvent` on `window` with all of `key`, `code`, `keyCode` and `which` set satisfies all
 * three, so every touch button dispatches one (`keydown`, then `keyup` a moment later for a tap; the keyup waits
 * for the release of a held button).
 */

/** What a key event must carry for every handler style to recognise it. */
export interface KeySpec {
  key: string;
  code: string;
  keyCode: number;
}

export type TouchAction =
  | "attack" | "use" | "search" | "pole" | "listen" | "camp" | "turn" | "disarm" | "potion" | "menu"
  | "voice" | "hearAgain" | "sound" | "crt"
  | "inventory" | "spellbook" | "map"
  | "spell1" | "spell2" | "spell3" | "spell4";

/** Action to key. One row per action; the touch pad, the menu and the hotbar read this and nothing else. */
export const KEY_TABLE: Readonly<Record<TouchAction, KeySpec>> = {
  attack: { key: " ", code: "Space", keyCode: 32 },
  use: { key: "e", code: "KeyE", keyCode: 69 },
  search: { key: "g", code: "KeyG", keyCode: 71 },
  pole: { key: "p", code: "KeyP", keyCode: 80 },
  listen: { key: "l", code: "KeyL", keyCode: 76 },
  camp: { key: "r", code: "KeyR", keyCode: 82 },
  turn: { key: "t", code: "KeyT", keyCode: 84 },
  disarm: { key: "x", code: "KeyX", keyCode: 88 },
  potion: { key: "f", code: "KeyF", keyCode: 70 },
  menu: { key: "Escape", code: "Escape", keyCode: 27 },
  voice: { key: "v", code: "KeyV", keyCode: 86 },
  hearAgain: { key: "z", code: "KeyZ", keyCode: 90 },
  sound: { key: "n", code: "KeyN", keyCode: 78 },
  crt: { key: "F2", code: "F2", keyCode: 113 },
  inventory: { key: "i", code: "KeyI", keyCode: 73 },
  spellbook: { key: "b", code: "KeyB", keyCode: 66 },
  map: { key: "m", code: "KeyM", keyCode: 77 },
  spell1: { key: "1", code: "Digit1", keyCode: 49 },
  spell2: { key: "2", code: "Digit2", keyCode: 50 },
  spell3: { key: "3", code: "Digit3", keyCode: 51 },
  spell4: { key: "4", code: "Digit4", keyCode: 52 },
};

export function keySpecFor(action: TouchAction): KeySpec {
  return KEY_TABLE[action];
}

/** The init dictionary for `new KeyboardEvent`. Bubbling so window listeners hear it; cancelable like a real key. */
export function buildKeyInit(spec: KeySpec): KeyboardEventInit & { keyCode: number; which: number } {
  return {
    key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode,
    bubbles: true, cancelable: true, repeat: false,
  };
}

/** Milliseconds a tapped key stays down. Long enough that a slow frame still sees it, short enough to feel like a tap. */
export const TAP_HOLD_MS = 80;

interface EventTargetLike { dispatchEvent(e: Event): boolean }

/** Build the event. Chrome and Safari honour `keyCode` in the init dictionary, Firefox does not always: pin all three. */
export function makeKeyEvent(type: "keydown" | "keyup", spec: KeySpec): KeyboardEvent {
  const ev = new KeyboardEvent(type, buildKeyInit(spec));
  for (const prop of ["keyCode", "which"] as const) {
    if ((ev as unknown as Record<string, number>)[prop] !== spec.keyCode) {
      Object.defineProperty(ev, prop, { get: () => spec.keyCode });
    }
  }
  return ev;
}

function defaultTarget(): EventTargetLike | null {
  return typeof window !== "undefined" ? window : null;
}

/**
 * Press an action's key and return the function that lets it go. Calling the release twice is harmless.
 * `target` is a seam for tests; the game always uses `window`.
 */
export function pressAction(action: TouchAction, target: EventTargetLike | null = defaultTarget()): () => void {
  const spec = keySpecFor(action);
  if (!target || typeof KeyboardEvent === "undefined") return () => undefined;
  target.dispatchEvent(makeKeyEvent("keydown", spec));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.dispatchEvent(makeKeyEvent("keyup", spec));
  };
}

/** A tap: key down now, key up `TAP_HOLD_MS` later. */
export function tapAction(action: TouchAction, target: EventTargetLike | null = defaultTarget()): void {
  const release = pressAction(action, target);
  setTimeout(release, TAP_HOLD_MS);
}

// ── Touch detection ──────────────────────────────────────────────────────────────────────────────────

export interface TouchEnv {
  /** `location.search`, for the `?touch=1` / `?touch=0` override. */
  search: string;
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)').matches`. */
  coarsePointer: boolean;
}

/** `?touch=1` forces touch on, `?touch=0` forces it off, anything else asks the device. */
export function detectTouch(env: TouchEnv): boolean {
  const m = /[?&]touch=([01])(?:&|$)/.exec(env.search);
  if (m) return m[1] === "1";
  return env.maxTouchPoints > 0 || env.coarsePointer;
}

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  let coarse = false;
  try { coarse = !!window.matchMedia?.("(pointer: coarse)").matches; } catch { /* no matchMedia */ }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return detectTouch({
    search: window.location?.search ?? "",
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer: coarse,
  });
}

/** Key names for the text that explains the controls: the touch wording on a touch device, the key wording otherwise. */
export function pick<T>(keys: T, touch: T): T {
  return isTouchDevice() ? touch : keys;
}
