/**
 * A real `<input>` laid over the canvas so a phone shows its own keyboard for the two places the game takes typed text
 * (the riddle door's answer, the character's name). Phaser cannot raise a phone keyboard by itself.
 *
 * The field is nearly invisible (no text, no caret, no border) but it is a real element under the player's finger:
 * tapping the answer line focuses it directly, which is the one gesture iOS accepts for raising a keyboard.
 * `focus()` is also tried when the dialog opens, which Android usually allows.
 */
import { setTextEntry } from "./textEntry";

export interface FieldRect { x: number; y: number; w: number; h: number }

export interface TextFieldOptions {
  canvas: HTMLCanvasElement;
  /** Game-pixel rectangle the field covers (the canvas is 960x640 whatever its CSS size). */
  rect: FieldRect;
  gameW: number;
  gameH: number;
  value?: string;
  maxLength: number;
  /** Characters the field may hold. Others are dropped as they are typed or pasted. */
  allowed?: RegExp;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Shown on the phone's enter key where the browser supports it. */
  enterHint?: string;
}

/** Keep only allowed characters and cut to length. Pure, so it is tested. */
export function sanitizeText(raw: string, maxLength: number, allowed?: RegExp): string {
  let out = "";
  for (const ch of raw) {
    if (allowed && !allowed.test(ch)) continue;
    out += ch;
    if (out.length >= maxLength) break;
  }
  return out;
}

/** Map a game-pixel rectangle to CSS pixels over the canvas. Pure. */
export function cssRectFor(
  rect: FieldRect, canvasBox: { left: number; top: number; width: number; height: number }, gameW: number, gameH: number,
): { left: number; top: number; width: number; height: number } {
  const sx = canvasBox.width / gameW;
  const sy = canvasBox.height / gameH;
  return {
    left: canvasBox.left + rect.x * sx, top: canvasBox.top + rect.y * sy,
    width: rect.w * sx, height: rect.h * sy,
  };
}

export class DomTextField {
  readonly el: HTMLInputElement;
  private opts: TextFieldOptions;
  private onResize = (): void => this.place();

  constructor(opts: TextFieldOptions) {
    this.opts = opts;
    const el = document.createElement("input");
    this.el = el;
    el.type = "text";
    el.value = sanitizeText(opts.value ?? "", opts.maxLength, opts.allowed);
    el.maxLength = opts.maxLength;
    el.autocomplete = "off";
    el.autocapitalize = "words";
    el.spellcheck = false;
    el.setAttribute("autocorrect", "off");
    el.setAttribute("enterkeyhint", opts.enterHint ?? "done");
    el.setAttribute("aria-label", "Type here");
    // 16px or more keeps iOS from zooming the page when the field takes focus.
    Object.assign(el.style, {
      position: "fixed", zIndex: "2147483000", margin: "0", padding: "0", boxSizing: "border-box",
      border: "0", outline: "none", background: "transparent", color: "transparent", caretColor: "transparent",
      fontSize: "16px", opacity: "0.02",
    } satisfies Partial<CSSStyleDeclaration>);
    el.addEventListener("input", this.onInput);
    el.addEventListener("keydown", this.onKeydown);
    document.body.appendChild(el);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onResize, true);
    this.place();
    setTextEntry(true);
  }

  get value(): string { return this.el.value; }

  setValue(v: string): void {
    this.el.value = sanitizeText(v, this.opts.maxLength, this.opts.allowed);
  }

  /** Re-place the field after the dialog moved or the page was resized. */
  place(rect?: FieldRect): void {
    if (rect) this.opts.rect = rect;
    const box = this.opts.canvas.getBoundingClientRect();
    const c = cssRectFor(this.opts.rect, box, this.opts.gameW, this.opts.gameH);
    Object.assign(this.el.style, {
      left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, height: `${c.height}px`,
    });
  }

  focus(): void {
    try { this.el.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }

  destroy(): void {
    this.el.removeEventListener("input", this.onInput);
    this.el.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onResize, true);
    this.el.blur();
    this.el.remove();
    setTextEntry(false);
  }

  private onInput = (): void => {
    const clean = sanitizeText(this.el.value, this.opts.maxLength, this.opts.allowed);
    if (clean !== this.el.value) this.el.value = clean;
    this.opts.onChange(clean);
  };

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") { e.preventDefault(); this.opts.onSubmit(this.el.value); }
    else if (e.key === "Escape") { e.preventDefault(); this.opts.onCancel(); }
    // Typed keys must not reach the game's single-key shortcuts (N mutes, V toggles the voice).
    e.stopPropagation();
  };
}
