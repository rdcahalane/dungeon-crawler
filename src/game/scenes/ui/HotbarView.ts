/** Bottom-center hotbar: four spell (or class ability) slots, keys 1-4, and four belt slots, keys 5-8. */
import * as Phaser from "phaser";
import { getDef } from "../../items";
import type { ItemInstance } from "../../items";
import { BELT_HOTKEYS, HOTBAR_SLOTS, type HotbarSlot } from "./hotbar";
import { SCREEN_H, SCREEN_W, UI, drawBox, iconAt, label, setLabel } from "./theme";
import { uiState } from "./uiState";

const SLOT = 48;
const GAP = 4;
const SEP = 24;
const GROUP_W = HOTBAR_SLOTS * SLOT + (HOTBAR_SLOTS - 1) * GAP;
const X0 = Math.round((SCREEN_W - (GROUP_W * 2 + SEP)) / 2);
const Y0 = SCREEN_H - SLOT - 8;
const BELT_X0 = X0 + GROUP_W + SEP;

interface SpellView {
  g: Phaser.GameObjects.Graphics;
  hot: Phaser.GameObjects.BitmapText;
  text: Phaser.GameObjects.BitmapText;
  sig: string;
}
interface BeltView {
  g: Phaser.GameObjects.Graphics;
  hot: Phaser.GameObjects.BitmapText;
  qty: Phaser.GameObjects.BitmapText;
  icon?: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  hit: Phaser.GameObjects.Rectangle;
  sig: string;
}

export class HotbarView {
  private spells: SpellView[] = [];
  private belt: BeltView[] = [];

  constructor(private scene: Phaser.Scene, onBelt: (index: number) => void) {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const x = X0 + i * (SLOT + GAP);
      this.spells.push({
        g: scene.add.graphics().setDepth(5),
        hot: label(scene, x + 4, Y0 + 4, String(i + 1), { color: UI.grey, depth: 7 }),
        text: label(scene, x + SLOT / 2, Y0 + 20, "", { color: UI.white, ox: 0.5, depth: 7 }),
        sig: "",
      });
      const bx = BELT_X0 + i * (SLOT + GAP);
      const hit = scene.add.rectangle(bx, Y0, SLOT, SLOT, 0x000000, 0).setOrigin(0, 0).setDepth(9).setInteractive();
      hit.on("pointerdown", () => { if (!uiState.panelOpen) onBelt(i); });
      this.belt.push({
        g: scene.add.graphics().setDepth(5),
        hot: label(scene, bx + 4, Y0 + 4, BELT_HOTKEYS[i], { color: UI.grey, depth: 7 }),
        qty: label(scene, bx + SLOT - 4, Y0 + SLOT - 11, "", { color: UI.white, ox: 1, depth: 8 }),
        hit,
        sig: "",
      });
    }
    uiState.setRect("hotbar", { x: X0 - 4, y: Y0 - 4, w: GROUP_W * 2 + SEP + 8, h: SLOT + 12 });
  }

  update(slots: readonly HotbarSlot[], belt: ReadonlyArray<ItemInstance | null> | undefined): void {
    slots.forEach((s, i) => this.updateSpell(i, s));
    for (let i = 0; i < HOTBAR_SLOTS; i++) this.updateBelt(i, belt?.[i] ?? null);
  }

  private updateSpell(i: number, s: HotbarSlot): void {
    const v = this.spells[i];
    const sig = `${s.kind}|${s.label}|${s.remaining}|${s.max}|${s.disabled}`;
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
    setLabel(v.text, s.label, s.disabled ? UI.grey : UI.white);
    v.hot.setTint(s.disabled ? UI.slate : UI.silver);
  }

  private updateBelt(i: number, it: ItemInstance | null): void {
    const v = this.belt[i];
    const sig = it ? `${it.id}|${it.quantity}` : "";
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
    setLabel(v.qty, it && it.quantity > 1 ? String(it.quantity) : "");
  }

  destroy(): void {
    uiState.setRect("hotbar", null);
  }
}
