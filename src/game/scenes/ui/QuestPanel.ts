/** Quest log (Q, tavern). Same content as the old panel, in the retro skin. */
import * as Phaser from "phaser";
import { RARITY_COLORS } from "../../systems/QuestSystem";
import type { Quest } from "../../systems/QuestSystem";
import { PanelBase } from "./PanelBase";
import { SCREEN_H, SCREEN_W, UI, label } from "./theme";

const PANEL_W = 680;
const ROW = 18;
/** Characters that fit a line inside the panel. */
const COLS = Math.floor((PANEL_W - 32) / 12);

function panelHeight(active: Quest[], done: Quest[]): number {
  const rows = active.reduce((n, q) => n + 3 + q.objectives.length, 0) + (done.length > 0 ? 2 + done.length : 0);
  return Math.min(SCREEN_H - 40, 84 + Math.max(3, rows) * ROW);
}

export class QuestPanel extends PanelBase {
  private active: Quest[];
  private done: Quest[];

  constructor(scene: Phaser.Scene, active: Quest[], completed: Quest[], onClose: () => void) {
    const done = completed.slice(-5);
    const h = panelHeight(active, done);
    super(scene, (SCREEN_W - PANEL_W) / 2, (SCREEN_H - h) / 2, PANEL_W, h, "QUEST LOG", UI.green, onClose);
    this.active = active;
    this.done = done;
  }

  protected build(): void {
    const { scene } = this;
    const x = this.x + 16;
    let y = this.y + 38;
    const put = (t: string, color: number, dx = 0): void => {
      this.dyn.add(label(scene, x + dx, y, t.slice(0, COLS - Math.floor(dx / 12)), { color }));
      y += ROW;
    };
    if (this.active.length === 0 && this.done.length === 0) {
      put("NO QUESTS YET.", UI.grey);
      put("VISIT THE NOTICE BOARD IN THE TAVERN.", UI.grey);
    }
    for (const q of this.active) {
      put(q.title.toUpperCase(), RARITY_COLORS[q.rarity] ?? UI.white);
      for (const o of q.objectives) {
        const pct = Math.min(1, o.currentCount / Math.max(1, o.targetCount));
        const filled = Math.round(pct * 10);
        put(`[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${o.currentCount}/${o.targetCount} ${o.label}`, pct >= 1 ? UI.lime : UI.silver, 12);
      }
      put(`REWARD ${q.rewardGold}G +${q.rewardXP}XP`, UI.gold, 12);
      y += 4;
    }
    if (this.done.length > 0) {
      put("COMPLETED", UI.grey);
      for (const q of this.done) {
        put(q.title.toUpperCase(), UI.grey, 12);
      }
    }
    this.dyn.add(label(scene, this.x + this.w / 2, this.y + this.h - 24, "Q OR ESC TO CLOSE", { color: UI.grey, ox: 0.5 }));
  }

  protected onKey(): void { /* HUDScene handles Q and Esc */ }
}
