/** Bottom-center hotbar: four spell (or class ability) slots, keys 1-4, and four belt slots, keys 5-8. */
import * as Phaser from "phaser";
import { displayName, getDef } from "../../items";
import type { ItemInstance } from "../../items";
import { BELT_HOTKEYS, HOTBAR_SLOTS, type HotbarSlot } from "./hotbar";
import { SCREEN_H, SCREEN_W, UI, drawBox, iconAt, label, setLabel } from "./theme";
import { uiState } from "./uiState";

/** Longest tooltip, in characters. */
const TIP_MAX = 40;
const SLOT = 52;
const GAP = 4;
const SEP = 24;
const GROUP_W = HOTBAR_SLOTS * SLOT + (HOTBAR_SLOTS - 1) * GAP;
const X0 = Math.round((SCREEN_W - (GROUP_W * 2 + SEP)) / 2);
const Y0 = SCREEN_H - SLOT - 8;
const BELT_X0 = X0 + GROUP_W + SEP;

interface SpellView {
  g: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Rectangle;
  tip: string;
  hot: Phaser.GameObjects.BitmapText;
  text: Phaser.GameObjects.BitmapText;
  sig: string;
}
interface BeltView {
  g: Phaser.GameObjects.Graphics;
  tip: string;
  hot: Phaser.GameObjects.BitmapText;
  qty: Phaser.GameObjects.BitmapText;
  icon?: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  hit: Phaser.GameObjects.Rectangle;
  sig: string;
}

export class HotbarView {
  private spells: SpellView[] = [];
  private belt: BeltView[] = [];
  private tipBox: Phaser.GameObjects.Graphics;
  private tipText: Phaser.GameObjects.BitmapText;

  constructor(private scene: Phaser.Scene, onBelt: (index: number) => void, onSpell?: (index: number) => void) {
    this.tipBox = scene.add.graphics().setDepth(9);
    this.tipText = label(scene, SCREEN_W / 2, Y0 - 26, "", { color: UI.white, ox: 0.5, depth: 10 });
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const x = X0 + i * (SLOT + GAP);
      const shit = scene.add.rectangle(x, Y0, SLOT, SLOT, 0x000000, 0).setOrigin(0, 0).setDepth(9).setInteractive();
      const sv: SpellView = {
        g: scene.add.graphics().setDepth(5),
        hit: shit,
        tip: "",
        hot: label(scene, x + 4, Y0 + 3, String(i + 1), { color: UI.grey, depth: 7 }),
        text: label(scene, x + SLOT / 2, Y0 + 19, "", { color: UI.white, ox: 0.5, depth: 7 }),
        sig: "",
      };
      shit.on("pointerdown", () => { if (!uiState.panelOpen) onSpell?.(i); });
      shit.on("pointerover", () => this.showTip(sv.tip));
      shit.on("pointerout", () => this.showTip(""));
      this.spells.push(sv);
      const bx = BELT_X0 + i * (SLOT + GAP);
      const hit = scene.add.rectangle(bx, Y0, SLOT, SLOT, 0x000000, 0).setOrigin(0, 0).setDepth(9).setInteractive();
      hit.on("pointerdown", () => { if (!uiState.panelOpen) onBelt(i); });
      const bv: BeltView = {
        g: scene.add.graphics().setDepth(5),
        tip: "",
        hot: label(scene, bx + 4, Y0 + 3, BELT_HOTKEYS[i], { color: UI.grey, depth: 7 }),
        qty: label(scene, bx + SLOT - 4, Y0 + SLOT - 19, "", { color: UI.white, ox: 1, depth: 8 }),
        hit,
        sig: "",
      };
      hit.on("pointerover", () => this.showTip(bv.tip));
      hit.on("pointerout", () => this.showTip(""));
      this.belt.push(bv);
    }
    uiState.setRect("hotbar", { x: X0 - 4, y: Y0 - 4, w: GROUP_W * 2 + SEP + 8, h: SLOT + 12 });
  }

  /** The full name of a slot, on a dark line above the bar while the pointer is over it. */
  private showTip(text: string): void {
    this.tipBox.clear();
    setLabel(this.tipText, text);
    if (!text) return;
    const w = this.tipText.width + 16;
    drawBox(this.tipBox, Math.round(SCREEN_W / 2 - w / 2), Y0 - 30, w, 24, UI.black, UI.slate, null);
  }

  update(slots: readonly HotbarSlot[], belt: ReadonlyArray<ItemInstance | null> | undefined): void {
    slots.forEach((s, i) => this.updateSpell(i, s));
    for (let i = 0; i < HOTBAR_SLOTS; i++) this.updateBelt(i, belt?.[i] ?? null);
  }

  private updateSpell(i: number, s: HotbarSlot): void {
    const v = this.spells[i];
    const sig = `${s.kind}|${s.short}|${s.remaining}|${s.max}|${s.disabled}`;
    if (sig === v.sig) return;
    v.sig = sig;
    const x = X0 + i * (SLOT + GAP);
    const live = s.kind !== "empty";
    const color = s.disabled ? UI.slate : s.kind === "ability" ? UI.orange : UI.sky;
    v.g.clear();
    drawBox(v.g, x, Y0, SLOT, SLOT, live ? UI.dusk : UI.ink, color, null);
    // pips along the bottom: filled = ready
    for (let k = 0; k < Math.min(s.max, 8); k++) {
      v.g.fillStyle(k < s.remaining ? UI.lime : UI.slate, 1).fillRect(x + 6 + k * 5, Y0 + SLOT - 9, 4, 4);
    }
    // Four characters at 16px fill the slot; the full name is the tooltip.
    setLabel(v.text, s.short, s.disabled ? UI.grey : UI.white);
    v.tip = live ? `${s.hotkey} ${s.name}${s.max > 0 ? `  ${s.remaining}/${s.max}` : ""}`.toUpperCase().slice(0, TIP_MAX) : "";
    v.hot.setTint(s.disabled ? UI.slate : UI.silver);
  }

  private updateBelt(i: number, it: ItemInstance | null): void {
    const v = this.belt[i];
    const sig = it ? `${it.id}|${it.quantity}` : "";
    v.tip = it ? `${BELT_HOTKEYS[i]} ${displayName(it, { quantity: true })}`.toUpperCase().slice(0, TIP_MAX) : "";
    if (sig === v.sig && v.g.visible) return;
    v.sig = sig;
    const x = BELT_X0 + i * (SLOT + GAP);
    v.g.clear();
    drawBox(v.g, x, Y0, SLOT, SLOT, it ? UI.dusk : UI.ink, it ? UI.gold : UI.slate, null);
    v.icon?.destroy();
    v.icon = undefined;
    if (it) {
      v.icon = iconAt(this.scene, getDef(it.defKey).icon, x + SLOT / 2, Y0 + SLOT / 2 - 2, 32).setDepth(6);
    }
    setLabel(v.qty, it && it.quantity > 1 ? String(it.quantity) : "", UI.white);
  }

  destroy(): void {
    this.tipBox.destroy();
    this.tipText.destroy();
    uiState.setRect("hotbar", null);
  }
}
