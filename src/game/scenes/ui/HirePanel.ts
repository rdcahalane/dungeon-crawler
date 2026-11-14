/**
 * "Hire help" at the inn: a torchbearer (5 gp) and a man-at-arms (20 gp). One of each at most.
 * Same frame and keys as the other tavern panels: Up/Down pick, Enter hire, number keys, D dismiss, Esc back.
 * Works on `host.player.stats.party` (the saved hirelings) and the gold on the character.
 */
import * as Phaser from "phaser";
import { Sfx } from "../../audio/Sfx";
import { mathRng } from "../../rules";
import {
  HIRELINGS, HIRELING_KINDS, canHire, firstName, makeHireling, type HirelingKind, type HirelingState,
} from "../../rules/hirelings";
import { PanelBase } from "./PanelBase";
import type { TavernHost } from "./tavernHost";
import { UI, drawBox, label, pointIn, wrap } from "./theme";

const ROW_H = 128;
const ROW_Y = 128;
const ROW_GAP = 8;

const STATS: Record<HirelingKind, string> = {
  torchbearer: "3 HP  AC 10  DOES NOT FIGHT  CARRIES THE LIGHT",
  man_at_arms: "D8 HP  AC 6  THAC0 20  SPEAR D6  KEEPS 1/3 OF GOLD",
};

export class HirePanel extends PanelBase {
  private cursor = 0;
  private msg = "";
  private msgColor: number = UI.gold;
  private boxes: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];

  constructor(scene: Phaser.Scene, private host: TavernHost, onBack: () => void) {
    super(scene, 160, 90, 640, 460, "HIRE HELP", UI.gold, onBack);
  }

  private get party(): HirelingState[] {
    const stats = this.host.player.stats;
    if (!stats.party) stats.party = [];
    return stats.party;
  }

  protected onOpen(): void {
    this.cursor = 0;
    this.msg = "";
  }

  protected build(): void {
    const { scene } = this;
    const g = scene.add.graphics();
    this.dyn.add(g);
    this.boxes = [];
    const x0 = this.x + 20;
    const w = this.w - 40;
    wrap("Two kinds of help drink here. Neither works for free, and neither comes back from the dead.", 48)
      .forEach((l, i) => this.dyn.add(label(scene, x0, this.y + 36 + i * 18, l, { color: UI.silver })));
    this.dyn.add(label(scene, x0, this.y + 36 + 2 * 18 + 6, `GOLD ${this.host.player.stats.gold}`, { color: UI.gold }));

    HIRELING_KINDS.forEach((kind, i) => {
      const def = HIRELINGS[kind];
      const y = this.y + ROW_Y + i * (ROW_H + ROW_GAP);
      const picked = i === this.cursor;
      const held = this.party.find((h) => h.kind === kind && h.hp > 0);
      const check = canHire(this.party, kind, this.host.player.stats.gold);
      drawBox(g, x0, y, w, ROW_H, picked ? UI.dusk : UI.ink, picked ? UI.gold : UI.slate, null);
      this.dyn.add(label(scene, x0 + 12, y + 8, `${i + 1} ${def.title.toUpperCase()}  ${def.upfrontGp} GP UP FRONT`, {
        color: held ? UI.grey : check.ok ? UI.white : UI.grey,
      }));
      wrap(def.blurb, 46).slice(0, 3).forEach((l, j) =>
        this.dyn.add(label(scene, x0 + 36, y + 30 + j * 18, l, { color: UI.silver })));
      this.dyn.add(label(scene, x0 + 36, y + 30 + 3 * 18 + 2, STATS[kind], { color: UI.sky }));
      if (held) {
        this.dyn.add(label(scene, x0 + 12, y + ROW_H - 22, `WITH YOU: ${firstName(held.name).toUpperCase()}  HP ${held.hp}/${held.maxHp}`, {
          color: UI.lime,
        }));
        this.addButton(x0 + w - 124, y + ROW_H - 28, 112, 22, "DISMISS", () => this.dismiss(kind));
      }
      this.boxes.push({ x: x0, y, w, h: ROW_H, index: i });
    });

    if (this.msg) this.dyn.add(label(scene, x0, this.y + this.h - 54, this.msg.slice(0, 50), { color: this.msgColor }));
    this.dyn.add(label(scene, x0, this.y + this.h - 26, "UP/DOWN PICK  ENTER HIRE  D DISMISS  ESC BACK", { color: UI.grey }));
  }

  private hire(i: number): void {
    const kind = HIRELING_KINDS[i];
    if (!kind) return;
    const player = this.host.player;
    const stats = player.stats;
    const check = canHire(this.party, kind, stats.gold);
    if (!check.ok) {
      this.msg = check.message;
      this.msgColor = UI.red;
      Sfx.play("ui_back");
      this.render();
      return;
    }
    const def = HIRELINGS[kind];
    const taken = this.party.map((h) => h.name);
    const h = makeHireling(kind, mathRng, taken);
    this.party.push(h);
    stats.gold -= def.upfrontGp;
    player.recomputeDerived(); // a torchbearer changes the light, gold is mirrored into the pack
    this.msg = `${h.name} signs on (-${def.upfrontGp} gp).`;
    this.msgColor = UI.lime;
    this.host.say(`${h.name} signs on for ${def.upfrontGp} gp${def.keepsShare ? " and a third of what you find" : ""}.`);
    Sfx.play("ui_select");
    this.host.refresh();
    this.render();
  }

  private dismiss(kind: HirelingKind): void {
    const party = this.party;
    const i = party.findIndex((h) => h.kind === kind);
    if (i < 0) return;
    const [gone] = party.splice(i, 1);
    this.host.player.recomputeDerived();
    this.msg = `${gone.name} goes back to the bar. No refund.`;
    this.msgColor = UI.silver;
    this.host.say(`${gone.name} goes back to the bar.`);
    Sfx.play("ui_back");
    this.host.refresh();
    this.render();
  }

  protected onKey(e: KeyboardEvent): void {
    const n = HIRELING_KINDS.length;
    switch (e.code) {
      case "ArrowUp": this.cursor = (this.cursor + n - 1) % n; this.msg = ""; this.render(); break;
      case "ArrowDown": this.cursor = (this.cursor + 1) % n; this.msg = ""; this.render(); break;
      case "Enter": case "NumpadEnter": this.hire(this.cursor); break;
      case "Digit1": case "Digit2": this.cursor = Number(e.code.slice(5)) - 1; this.hire(this.cursor); break;
      case "KeyD": this.dismiss(HIRELING_KINDS[this.cursor]); break;
      case "Escape": this.onClose(); break;
      default: break;
    }
  }

  protected onPointer(kind: "down" | "up" | "move", px: number, py: number): boolean {
    if (kind === "move") {
      for (const b of this.boxes) {
        if (pointIn(b, px, py) && this.cursor !== b.index) { this.cursor = b.index; this.render(); return false; }
      }
      return false;
    }
    if (kind !== "down") return false;
    for (const b of this.boxes) {
      if (pointIn(b, px, py)) { this.cursor = b.index; this.hire(b.index); return true; }
    }
    return false;
  }
}
