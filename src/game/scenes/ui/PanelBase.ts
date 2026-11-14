/**
 * Shared frame for modal HUD panels: backdrop, title, close button, a rebuildable layer, and manual
 * pointer and key dispatch (no per-object interactivity, so hit-testing is plain rectangles).
 */
import * as Phaser from "phaser";
import { drawBox, label, pointIn, SCREEN_H, SCREEN_W, UI } from "./theme";

export interface Btn {
  x: number; y: number; w: number; h: number;
  text: string;
  onClick: () => void;
  enabled?: boolean;
}

export abstract class PanelBase {
  protected root: Phaser.GameObjects.Container;
  /** Rebuilt by `render()`. */
  protected dyn: Phaser.GameObjects.Container;
  protected g: Phaser.GameObjects.Graphics;
  protected buttons: Btn[] = [];
  private isOpen = false;
  private keyHandler = (e: KeyboardEvent): void => { if (this.isOpen) this.onKey(e); };
  private downHandler = (p: Phaser.Input.Pointer): void => { if (this.isOpen) this.pointer("down", p.x, p.y); };
  private upHandler = (p: Phaser.Input.Pointer): void => { if (this.isOpen) this.pointer("up", p.x, p.y); };
  private moveHandler = (p: Phaser.Input.Pointer): void => { if (this.isOpen) this.pointer("move", p.x, p.y); };

  constructor(
    protected scene: Phaser.Scene,
    readonly x: number, readonly y: number, readonly w: number, readonly h: number,
    protected title: string, protected accent: number, protected onClose: () => void,
  ) {
    this.root = scene.add.container(0, 0).setDepth(200).setVisible(false);
    const dim = scene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, UI.black, 0.55).setOrigin(0, 0);
    this.g = scene.add.graphics();
    drawBox(this.g, x, y, w, h, UI.ink, accent, UI.dusk);
    this.g.fillStyle(accent, 1).fillRect(x + 2, y + 2, w - 4, 20);
    this.root.add([dim, this.g]);
    this.root.add(label(scene, x + 10, y + 7, title, { size: 8, color: UI.ink }));
    this.dyn = scene.add.container(0, 0);
    this.root.add(this.dyn);
  }

  get opened(): boolean { return this.isOpen; }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.setVisible(true);
    this.onOpen();
    this.render();
    const inp = this.scene.input;
    inp.keyboard?.on("keydown", this.keyHandler);
    inp.on("pointerdown", this.downHandler);
    inp.on("pointerup", this.upHandler);
    inp.on("pointermove", this.moveHandler);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.setVisible(false);
    const inp = this.scene.input;
    inp.keyboard?.off("keydown", this.keyHandler);
    inp.off("pointerdown", this.downHandler);
    inp.off("pointerup", this.upHandler);
    inp.off("pointermove", this.moveHandler);
    this.onCloseInternal();
  }

  destroy(): void {
    this.close();
    this.root.destroy();
  }

  /** Clear the dynamic layer and rebuild it. */
  render(): void {
    this.dyn.removeAll(true);
    this.buttons = [];
    this.build();
    // close button, always last so it is on top
    this.addButton(this.x + this.w - 26, this.y + 3, 18, 16, "X", () => this.onClose());
  }

  protected onOpen(): void { /* hook */ }
  protected onCloseInternal(): void { /* hook */ }
  protected abstract build(): void;
  protected abstract onKey(e: KeyboardEvent): void;
  /** Subclass pointer handling; return true when it consumed the event. */
  protected onPointer(kind: "down" | "up" | "move", x: number, y: number): boolean {
    void kind; void x; void y;
    return false;
  }

  private pointer(kind: "down" | "up" | "move", px: number, py: number): void {
    if (kind === "down") {
      for (const b of this.buttons) {
        if (b.enabled !== false && pointIn(b, px, py)) { b.onClick(); return; }
      }
    }
    this.onPointer(kind, px, py);
  }

  protected addButton(x: number, y: number, w: number, h: number, text: string, onClick: () => void, enabled = true): Btn {
    const b: Btn = { x, y, w, h, text, onClick, enabled };
    this.buttons.push(b);
    const gg = this.scene.add.graphics();
    drawBox(gg, x, y, w, h, enabled ? UI.dusk : UI.ink, enabled ? UI.silver : UI.slate, enabled ? UI.slate : null);
    this.dyn.add(gg);
    this.dyn.add(label(this.scene, x + w / 2, y + h / 2, text, {
      size: 8, color: enabled ? UI.white : UI.grey, ox: 0.5, oy: 0.5,
    }));
    return b;
  }
}
