import { setTextEntry } from "../../textEntry";
import { DomTextField } from "../../domTextInput";
import { isTouchDevice } from "../../touch";
import * as Phaser from "phaser";
import type { GameContext } from "../../GameContext";
import type { OfferOption } from "./MechVerbs";

export type DialogRequest =
  | { kind: "text"; title: string; body: string; onClose?: () => void }
  | { kind: "riddle"; title: string; prompt: string; onSubmit: (text: string) => void; onCancel?: () => void }
  | { kind: "offer"; title: string; options: OfferOption[]; onPick: (key: string) => void; onCancel?: () => void };

const DEPTH = 210;
const BOX_W = 580;
const PAD = 22;
const MONO = "monospace";
const INK = "#2b1d0e";
const MAX_ROWS = 9;
const MAX_ANSWER = 60;
/** Rows are taller on a touch screen so a finger can pick one. */
const ROW_PITCH = 22;
const ROW_PITCH_TOUCH = 34;
const BTN_W = 150;
const BTN_H = 34;

/** A tappable rectangle in the box's own coordinates (the box is centred on the screen, so screen = centre + local). */
interface Hit { x: number; y: number; w: number; h: number; run: () => void }

/**
 * An in-scene parchment modal: clue text, a riddle prompt with a typed answer, an offering list.
 *
 * While it is open the Phaser keyboard plugin is switched off (so WASD, space and the spell keys do nothing) and the
 * dialog reads the raw DOM `keydown` itself. `ctx.modalOpen` is true for the duration, `ui_open` / `ui_close` go out
 * on the bus with panel `mech_dialog`. The art lane restyles fonts later; this is plain Phaser text.
 */
export class MechDialog {
  private box?: Phaser.GameObjects.Container;
  private onKey?: (e: KeyboardEvent) => void;
  private req?: DialogRequest;
  private typed = "";
  private cursor = 0;
  private typedText?: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.Text[] = [];
  private hits: Hit[] = [];
  /** Screen centre of the box. The riddle sits higher on a touch screen so the phone's keyboard does not cover it. */
  private cx = 0;
  private cy = 0;
  private touch = false;
  private field?: DomTextField;
  private onPointer?: (p: Phaser.Input.Pointer) => void;
  /** The last DOM event this dialog consumed; other key listeners skip it so a closing key cannot reopen anything. */
  lastHandled: KeyboardEvent | null = null;

  constructor(private ctx: GameContext) {}

  get isOpen(): boolean {
    return !!this.req;
  }

  open(req: DialogRequest): void {
    if (this.req) return;
    const ctx = this.ctx;
    const scene = ctx.scene;
    this.req = req;
    this.typed = "";
    this.cursor = 0;
    ctx.modalOpen = true;
    setTextEntry(req.kind === "riddle");
    if (scene.input.keyboard) scene.input.keyboard.enabled = false;
    ctx.bus.emit("ui_open", { panel: "mech_dialog" });
    this.touch = isTouchDevice();
    this.build();
    this.onKey = (e) => this.handleKey(e);
    window.addEventListener("keydown", this.onKey, true);
    this.onPointer = (p) => this.handlePointer(p);
    scene.input.on("pointerdown", this.onPointer);
    if (req.kind === "riddle" && this.touch) this.openField();
  }

  close(): void {
    if (!this.req) return;
    const ctx = this.ctx;
    const scene = ctx.scene;
    if (this.onKey) window.removeEventListener("keydown", this.onKey, true);
    this.onKey = undefined;
    if (this.onPointer) scene.input.off("pointerdown", this.onPointer);
    this.onPointer = undefined;
    this.field?.destroy();
    this.field = undefined;
    this.box?.destroy();
    this.box = undefined;
    this.rows = [];
    this.hits = [];
    this.typedText = undefined;
    this.req = undefined;
    ctx.modalOpen = false;
    setTextEntry(false);
    if (scene.input.keyboard) {
      scene.input.keyboard.enabled = true;
      scene.input.keyboard.resetKeys();
    }
    ctx.bus.emit("ui_close", { panel: "mech_dialog" });
  }

  destroy(): void {
    if (this.req) this.close();
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  private build(): void {
    const scene = this.ctx.scene;
    const req = this.req!;
    const cam = scene.cameras.main;
    const W = scene.scale.width;
    const H = scene.scale.height;
    // Everything is laid out around (0, 0) in a screen-fixed container that cancels the camera zoom.
    this.cx = W / 2;
    this.cy = this.touch && req.kind === "riddle" ? Math.round(H * 0.36) : H / 2;
    this.hits = [];
    const box = scene.add.container(this.cx, this.cy).setScrollFactor(0).setDepth(DEPTH).setScale(1 / cam.zoom);
    this.box = box;
    box.add(scene.add.rectangle(0, 0, W * 4, H * 4, 0x000000, 0.55));

    const inner = BOX_W - PAD * 2;
    const title = scene.add.text(0, 0, req.title, {
      fontFamily: MONO, fontSize: "18px", color: "#5a2d0c", fontStyle: "bold", wordWrap: { width: inner },
    }).setOrigin(0.5, 0);

    let body: Phaser.GameObjects.Text | undefined;
    let footer = "";
    if (req.kind === "text") {
      body = scene.add.text(0, 0, req.body, { fontFamily: MONO, fontSize: "15px", color: INK, wordWrap: { width: inner }, lineSpacing: 5 }).setOrigin(0.5, 0);
      footer = this.touch ? "Tap anywhere to close" : "E or Esc: close";
    } else if (req.kind === "riddle") {
      body = scene.add.text(0, 0, req.prompt, { fontFamily: MONO, fontSize: "15px", color: INK, wordWrap: { width: inner }, lineSpacing: 5 }).setOrigin(0.5, 0);
      this.typedText = scene.add.text(0, 0, "_", { fontFamily: MONO, fontSize: "17px", color: "#1b3a1b", wordWrap: { width: inner } }).setOrigin(0.5, 0);
      footer = this.touch ? "Tap the line to type your answer" : "Type your answer.  Enter: speak   Esc: stay silent";
    } else {
      footer = this.touch ? "Tap an item, then LAY IT DOWN" : "Up/Down: choose   Enter: lay it down   Esc: keep it";
    }
    const foot = scene.add.text(0, 0, footer, { fontFamily: MONO, fontSize: "12px", color: "#6b4f1d" }).setOrigin(0.5, 0);

    // Stack top to bottom, measure, then draw the paper behind.
    let y = 0;
    title.setY(y); y += title.height + 12;
    const items: Phaser.GameObjects.GameObject[] = [title];
    if (body) { body.setY(y); y += body.height + 14; items.push(body); }
    if (this.typedText) { this.typedText.setY(y); y += this.typedText.height + 14; items.push(this.typedText); }
    if (req.kind === "offer") {
      const n = Math.min(MAX_ROWS, req.options.length);
      for (let i = 0; i < n; i++) {
        const row = scene.add.text(0, y, "", { fontFamily: MONO, fontSize: "15px", color: INK }).setOrigin(0.5, 0);
        this.rows.push(row);
        items.push(row);
        y += this.touch ? ROW_PITCH_TOUCH : ROW_PITCH;
      }
      y += 12;
    }
    foot.setY(y); y += foot.height;
    items.push(foot);
    // Buttons for a touch screen, in a row under the footer line.
    const btnDefs: Array<{ text: string; run: () => void }> = [];
    if (this.touch) {
      if (req.kind === "text") btnDefs.push({ text: "CLOSE", run: () => this.finish() });
      else if (req.kind === "riddle") {
        btnDefs.push({ text: "SPEAK", run: () => this.submit() });
        btnDefs.push({ text: "CANCEL", run: () => this.cancel() });
      } else {
        btnDefs.push({ text: "LAY IT DOWN", run: () => this.pickCurrent() });
        btnDefs.push({ text: "KEEP IT", run: () => this.cancel() });
      }
      y += 12;
    }
    const btnTop = y;
    if (btnDefs.length > 0) y += BTN_H;

    const totalH = y + PAD * 2;
    const top = -totalH / 2 + PAD;
    for (const it of items) (it as Phaser.GameObjects.Text).y += top;
    const paper = scene.add.rectangle(0, 0, BOX_W, totalH, 0xe6d3a3, 1).setStrokeStyle(4, 0x6b4f1d);
    box.add(paper);
    box.add(items);

    // Tappable parts, in box coordinates (after the shift above).
    const rowPitch = this.touch ? ROW_PITCH_TOUCH : ROW_PITCH;
    this.rows.forEach((row, i) => {
      this.hits.push({ x: -BOX_W / 2, y: row.y - (rowPitch - 22) / 2, w: BOX_W, h: rowPitch, run: () => this.tapRow(i) });
    });
    const bw = btnDefs.length > 1 ? BTN_W : BTN_W + 40;
    btnDefs.forEach((b, i) => {
      const bx = btnDefs.length === 1 ? 0 : (i === 0 ? -1 : 1) * (bw / 2 + 8);
      const by = btnTop + top + BTN_H / 2;
      const rect = scene.add.rectangle(bx, by, bw, BTN_H, 0xd8c08a, 1).setStrokeStyle(3, 0x6b4f1d);
      const txt = scene.add.text(bx, by, b.text, { fontFamily: MONO, fontSize: "15px", color: "#5a2d0c", fontStyle: "bold" }).setOrigin(0.5);
      box.add([rect, txt]);
      this.hits.push({ x: bx - bw / 2, y: by - BTN_H / 2, w: bw, h: BTN_H, run: b.run });
    });
    if (req.kind === "riddle" && this.typedText) {
      const t = this.typedText;
      this.hits.push({ x: -inner / 2, y: t.y - 6, w: inner, h: t.height + 12, run: () => this.field?.focus() });
    }
    this.refresh();
  }

  // ── Touch ────────────────────────────────────────────────────────────────

  private handlePointer(p: Phaser.Input.Pointer): void {
    const req = this.req;
    if (!req) return;
    const lx = p.x - this.cx;
    const ly = p.y - this.cy;
    // Buttons and rows first.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (lx >= h.x && lx < h.x + h.w && ly >= h.y && ly < h.y + h.h) { h.run(); return; }
    }
    // A text dialog closes on any tap. The others only on their buttons: a stray tap must not spend an offering or an answer.
    if (req.kind === "text") this.finish();
  }

  private tapRow(i: number): void {
    const req = this.req;
    if (!req || req.kind !== "offer") return;
    const n = this.rows.length;
    const start = Math.max(0, Math.min(this.cursor - Math.floor(n / 2), req.options.length - n));
    this.cursor = start + i;
    this.refresh();
  }

  private finish(): void {
    const req = this.req;
    if (!req || req.kind !== "text") return;
    this.close();
    req.onClose?.();
  }

  private submit(): void {
    const req = this.req;
    if (!req || req.kind !== "riddle") return;
    const text = this.typed.trim();
    if (!text) { this.field?.focus(); return; }
    this.close();
    req.onSubmit(text);
  }

  private cancel(): void {
    const req = this.req;
    if (!req || req.kind === "text") return;
    this.close();
    req.onCancel?.();
  }

  private pickCurrent(): void {
    const req = this.req;
    if (!req || req.kind !== "offer") return;
    const pick = req.options[this.cursor];
    this.close();
    if (pick) req.onPick(pick.key);
  }

  /** The phone's keyboard: a real input laid over the answer line, mirrored into the dialog as it is typed. */
  private openField(): void {
    const t = this.typedText;
    const scene = this.ctx.scene;
    if (!t) return;
    const inner = BOX_W - PAD * 2;
    this.field = new DomTextField({
      canvas: scene.game.canvas,
      rect: { x: this.cx - inner / 2, y: this.cy + t.y - 6, w: inner, h: t.height + 12 },
      gameW: scene.scale.width,
      gameH: scene.scale.height,
      maxLength: MAX_ANSWER,
      onChange: (v) => { this.typed = v; this.refresh(); },
      onSubmit: () => this.submit(),
      onCancel: () => this.cancel(),
      enterHint: "send",
    });
    this.field.focus();
  }

  private refresh(): void {
    const req = this.req;
    if (!req) return;
    if (req.kind === "riddle" && this.typedText) {
      this.typedText.setText(`> ${this.typed}_`);
    } else if (req.kind === "offer") {
      const n = this.rows.length;
      const start = Math.max(0, Math.min(this.cursor - Math.floor(n / 2), req.options.length - n));
      this.rows.forEach((row, i) => {
        const idx = start + i;
        const opt = req.options[idx];
        row.setText(opt ? `${idx === this.cursor ? "> " : "  "}${opt.label}` : "");
        row.setColor(idx === this.cursor ? "#7a1f0c" : INK);
      });
    }
  }

  // ── Keys ─────────────────────────────────────────────────────────────────

  private handleKey(e: KeyboardEvent): void {
    const req = this.req;
    if (!req) return;
    // Keys typed into the phone's input field are the field's business (it sends Enter and Esc itself).
    if (this.field && e.target === this.field.el) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    const stop = (): void => { e.preventDefault(); this.lastHandled = e; };

    if (req.kind === "text") {
      if (code === "KeyE" || code === "Escape" || code === "Enter" || code === "Space") {
        stop();
        if (e.repeat) return;
        this.close();
        req.onClose?.();
      }
      return;
    }

    if (req.kind === "riddle") {
      if (code === "Escape") { stop(); this.close(); req.onCancel?.(); return; }
      if (code === "Enter") {
        stop();
        if (e.repeat) return;
        const text = this.typed.trim();
        if (!text) return;
        this.close();
        req.onSubmit(text);
        return;
      }
      if (code === "Backspace") { stop(); this.typed = this.typed.slice(0, -1); this.refresh(); return; }
      if (e.key.length === 1) {
        stop();
        if (this.typed.length < MAX_ANSWER) this.typed += e.key;
        this.refresh();
      }
      return;
    }

    // offer
    const n = req.options.length;
    if (code === "Escape") { stop(); this.close(); req.onCancel?.(); return; }
    if (code === "ArrowUp" || code === "KeyW") { stop(); this.cursor = (this.cursor - 1 + n) % n; this.refresh(); return; }
    if (code === "ArrowDown" || code === "KeyS") { stop(); this.cursor = (this.cursor + 1) % n; this.refresh(); return; }
    if (code === "Enter" || code === "Space") {
      stop();
      if (e.repeat) return;
      const pick = req.options[this.cursor];
      this.close();
      if (pick) req.onPick(pick.key);
    }
  }
}
