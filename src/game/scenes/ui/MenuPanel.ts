/**
 * The touch menu: what the keyboard reaches with I, B, M, V, Z, N and F2, as big tappable rows. Opened by the pad's MENU
 * button. A row closes the menu first and then acts, so the key it sends is not swallowed by the open panel.
 */
import * as Phaser from "phaser";
import { Sfx } from "../../audio/Sfx";
import { narrator } from "../../audio/Narrator";
import { TAP_HOLD_MS, tapAction, type TouchAction } from "../../touch";
import { CLOSE_GRACE_MS } from "./uiState";
import { PanelBase } from "./PanelBase";
import { UI, label } from "./theme";

export interface MenuHooks {
  inDungeon: boolean;
  hasSpellbook: boolean;
  openInventory(): void;
  openSpellbook(): void;
  openMap(): void;
  close(): void;
}

const ROW_H = 40;

export class MenuPanel extends PanelBase {
  constructor(scene: Phaser.Scene, private hooks: MenuHooks) {
    super(scene, 280, 70, 400, 500, "MENU", UI.silver, () => hooks.close());
  }

  protected build(): void {
    const h = this.hooks;
    const x = this.x + 20;
    const w = this.w - 40;
    let y = this.y + 40;
    const row = (text: string, enabled: boolean, go: () => void): void => {
      this.addButton(x, y, w, ROW_H - 6, text, () => { this.hooks.close(); go(); }, enabled);
      y += ROW_H;
    };
    // Keys are sent after the grace period that follows a panel closing, or the HUD would still count itself as blocking.
    const later = (a: TouchAction): void => { window.setTimeout(() => tapAction(a), CLOSE_GRACE_MS + TAP_HOLD_MS); };

    row("RESUME", true, () => undefined);
    row("INVENTORY", true, () => h.openInventory());
    row("SPELLBOOK", h.hasSpellbook, () => h.openSpellbook());
    row("MAP", h.inDungeon, () => h.openMap());
    row(narrator.isAvailable() ? `VOICE ${narrator.enabled ? "ON" : "OFF"}` : "VOICE UNAVAILABLE", narrator.isAvailable(), () => later("voice"));
    row("HEAR THE LAST TEXT AGAIN", h.inDungeon, () => later("hearAgain"));
    row(`SOUND ${Sfx.isMuted() ? "OFF" : "ON"}`, true, () => later("sound"));
    row("SCANLINES ON OR OFF", true, () => later("crt"));
    this.dyn.add(label(this.scene, x, y + 4, "TAP A ROW. X CLOSES THIS.", { color: UI.grey }));
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.code === "Escape") this.hooks.close();
  }
}
