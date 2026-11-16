/**
 * The touch action pad: big buttons in the lower right that fire the same actions as the keyboard (see `touch.ts`).
 * Drawn by the HUD scene on touch devices only. Only the buttons take input: each registers its own rectangle with
 * `uiState`, so a tap anywhere else still walks or attacks on the map underneath.
 *
 * ATTACK is held: the key goes down while a finger is on it and a fresh press goes out every swing, which is what
 * "hold to keep swinging" means with the mouse. Every other button is a tap.
 */
import * as Phaser from "phaser";
import { TAP_HOLD_MS, pressAction, tapAction } from "../../touch";
import { UI, drawBox, iconAt, label } from "./theme";
import { uiState } from "./uiState";
import { padButtons, padRect, type PadButtonDef, type PadMode } from "./touchPadLayout";

const DEPTH = 30;
/** How often a held ATTACK presses again. The swing cooldown buffers the request, so this only has to be shorter. */
const REPEAT_MS = 140;

export interface PadState {
  /** Draw the pad and take taps. False while a panel or dialog is open. */
  visible: boolean;
  mode: PadMode;
  classKey?: string;
}

interface View {
  def: PadButtonDef;
  g: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Rectangle;
  parts: Phaser.GameObjects.GameObject[];
  down: boolean;
  release?: () => void;
  timer?: Phaser.Time.TimerEvent;
}

export class TouchPad {
  private views: View[] = [];
  private sig = "";
  private shown = false;

  constructor(private scene: Phaser.Scene, private state: () => PadState, private onMenu: () => void) {}

  /** Call every frame: rebuild when the class or mode changes, show or hide, let go of keys when hidden. */
  update(): void {
    const s = this.state();
    const sig = `${s.mode}|${s.classKey ?? ""}`;
    if (sig !== this.sig) { this.rebuild(s); this.sig = sig; }
    if (s.visible !== this.shown) this.setShown(s.visible);
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    for (const v of this.views) {
      this.releaseView(v);
      uiState.setRect(`pad-${v.def.id}`, null);
      v.g.destroy();
      v.hit.destroy();
      for (const p of v.parts) p.destroy();
    }
    this.views = [];
  }

  private rebuild(s: PadState): void {
    this.clear();
    for (const def of padButtons(s.mode, s.classKey)) this.views.push(this.build(def));
    this.shown = true;
    this.setShown(s.visible);
  }

  private build(def: PadButtonDef): View {
    const { scene } = this;
    const r = padRect(def.col, def.row);
    const g = scene.add.graphics().setDepth(DEPTH);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const hasIcon = !!def.icon && scene.textures.exists(def.icon);
    if (hasIcon) parts.push(iconAt(scene, def.icon, r.x + r.w / 2, r.y + 25, 32).setDepth(DEPTH + 1));
    parts.push(label(scene, r.x + r.w / 2, hasIcon ? r.y + r.h - 20 : r.y + r.h / 2, def.label, {
      color: UI.white, ox: 0.5, oy: 0.5, depth: DEPTH + 1,
    }));
    const hit = scene.add.rectangle(r.x, r.y, r.w, r.h, 0x000000, 0).setOrigin(0, 0).setDepth(DEPTH + 2).setInteractive();
    const v: View = { def, g, hit, parts, down: false };
    this.paint(v);
    hit.on("pointerdown", () => this.press(v));
    hit.on("pointerup", () => this.lift(v));
    hit.on("pointerupoutside", () => this.lift(v));
    hit.on("pointerout", () => this.lift(v));
    uiState.setRect(`pad-${def.id}`, r);
    return v;
  }

  private paint(v: View): void {
    const r = padRect(v.def.col, v.def.row);
    const edge = v.def.id === "attack" ? UI.red : v.def.id === "menu" ? UI.silver : UI.sky;
    v.g.clear();
    if (v.down) drawBox(v.g, r.x, r.y, r.w, r.h, UI.slate, UI.white, UI.grey);
    else drawBox(v.g, r.x, r.y, r.w, r.h, UI.dusk, edge, UI.slate);
  }

  private setShown(on: boolean): void {
    this.shown = on;
    for (const v of this.views) {
      v.g.setVisible(on);
      v.hit.setVisible(on);
      for (const p of v.parts) (p as Phaser.GameObjects.Image).setVisible(on);
      if (on) uiState.setRect(`pad-${v.def.id}`, padRect(v.def.col, v.def.row));
      else { this.releaseView(v); uiState.setRect(`pad-${v.def.id}`, null); }
    }
  }

  private press(v: View): void {
    if (!this.shown || uiState.panelOpen || v.down) return;
    v.down = true;
    this.paint(v);
    const { action } = v.def;
    if (!action) { this.onMenu(); return; }
    if (v.def.hold) {
      v.release = pressAction(action);
      v.timer = this.scene.time.addEvent({
        delay: REPEAT_MS, loop: true,
        callback: () => {
          // Lift and press again so every swing is a fresh key press, the way `Player.tryAttack` reads it.
          v.release?.();
          v.release = undefined;
          window.setTimeout(() => { if (v.down && !v.release) v.release = pressAction(action); }, TAP_HOLD_MS / 2);
        },
      });
    } else {
      tapAction(action);
    }
  }

  private lift(v: View): void {
    if (!v.down) return;
    this.releaseView(v);
  }

  private releaseView(v: View): void {
    const was = v.down;
    v.down = false;
    v.timer?.remove(false);
    v.timer = undefined;
    v.release?.();
    v.release = undefined;
    if (was) this.paint(v);
  }
}
