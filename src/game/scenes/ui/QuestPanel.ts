/** Quest log (Q, tavern). Same content as the old panel, in the retro skin. */
import * as Phaser from "phaser";
import { RARITY_COLORS } from "../../systems/QuestSystem";
import type { Quest } from "../../systems/QuestSystem";
import { PanelBase } from "./PanelBase";
import { SCREEN_H, SCREEN_W, UI, label } from "./theme";

const PANEL_W = 440;

function panelHeight(active: Quest[], done: Quest[]): number {
  const rows = active.reduce((n, q) => n + 3 + q.objectives.length, 0) + (done.length > 0 ? 2 + done.length : 0);
  return Math.min(SCREEN_H - 40, 90 + Math.max(2, rows) * 12);
}

export class QuestPanel extends PanelBase {
  private active: Quest[];
  private done: Quest[];

  constructor(scene: Phaser.Scene, active: Quest[], completed: Quest[], onClose: () => void) {
    const done = completed.slice(-10);
    const h = panelHeight(active, done);
    super(scene, (SCREEN_W - PANEL_W) / 2, (SCREEN_H - h) / 2, PANEL_W, h, "QUEST LOG", UI.green, onClose);
    this.active = active;
    this.done = done;
  }

  protected build(): void {
    const { scene } = this;
    const x = this.x + 16;
    let y = this.y + 36;
    const put = (t: string, color: number, dx = 0): void => {
      this.dyn.add(label(scene, x + dx, y, t, { color }));
    };
    if (this.active.length === 0 && this.done.length === 0) {
      put("NO QUESTS YET.", UI.grey);
      y += 12;
      put("VISIT THE NOTICE BOARD IN THE TAVERN.", UI.grey);
    }
    for (const q of this.active) {
      put(q.title, RARITY_COLORS[q.rarity] ?? UI.white);
      y += 12;
      for (const o of q.objectives) {
        const pct = Math.min(1, o.currentCount / Math.max(1, o.targetCount));
        const filled = Math.round(pct * 10);
        put(`${o.label}: [${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${o.currentCount}/${o.targetCount}`, pct >= 1 ? UI.lime : UI.silver, 8);
        y += 10;
      }
      put(`REWARD ${q.rewardGold}G +${q.rewardXP}XP`, UI.gold, 8);
      y += 16;
    }
    if (this.done.length > 0) {
      put("--- COMPLETED ---", UI.grey);
      y += 12;
      for (const q of this.done) {
        const ts = q.completedAt ? new Date(q.completedAt).toLocaleDateString() : "";
        put(`${q.title}  ${ts}`, UI.slate, 8);
        y += 10;
      }
    }
    this.dyn.add(label(scene, this.x + this.w / 2, this.y + this.h - 14, "Q OR ESC TO CLOSE", { color: UI.grey, ox: 0.5 }));
  }

  protected onKey(): void { /* HUDScene handles Q and Esc */ }
}
