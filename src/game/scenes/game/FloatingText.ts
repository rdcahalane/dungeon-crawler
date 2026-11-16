import * as Phaser from "phaser";
import type { GameContext } from "../../GameContext";

interface FloatingText {
  obj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
}

/** Rising damage numbers and status text. */
export class FloatingTextController {
  private floatingTexts: FloatingText[] = [];

  constructor(private ctx: GameContext) {}

  spawn(x: number, y: number, text: string, color: number, size = 14) {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const obj = this.ctx.scene.add.text(x, y, text, {
      fontSize: `${size}px`,
      color: hex,
      fontFamily: "monospace",
      stroke: "#000",
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);
    this.floatingTexts.push({ obj, vy: -60, life: 900 });
  }

  update(delta: number) {
    const dt = delta / 1000;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= delta;
      ft.obj.y += ft.vy * dt;
      ft.vy *= 0.95;
      ft.obj.setAlpha(Math.max(0, ft.life / 900));
      if (ft.life <= 0) { ft.obj.destroy(); this.floatingTexts.splice(i, 1); }
    }
  }

  destroy() {
    for (const ft of this.floatingTexts) ft.obj.destroy();
    this.floatingTexts = [];
  }
}
