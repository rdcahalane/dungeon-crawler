/**
 * Spellbook screen for casters: known spells by level, memorized and ready counts against the slots.
 * + / - fill or empty a slot. A cast spell keeps its slot until the character rests.
 */
import { isTouchDevice } from "../../touch";
import * as Phaser from "phaser";
import { SPELL_DEFS, spellsFor, type SpellDef } from "../../rules/spells";
import { PanelBase } from "./PanelBase";
import type { PanelHost } from "./panelHost";
import { LINE, UI, drawBox, label, wrap } from "./theme";

type Entry =
  | { type: "header"; level: number; used: number; max: number }
  | { type: "spell"; def: SpellDef };

const ROW_H = 22;
const VISIBLE = 12;

export class SpellbookPanel extends PanelBase {
  private sel = 0;
  private scroll = 0;
  private msg = "";

  constructor(scene: Phaser.Scene, private host: PanelHost, onClose: () => void) {
    super(scene, 120, 32, 720, 584, "SPELLBOOK", UI.violet, onClose);
  }

  private entries(): Entry[] {
    const book = this.host.player.spellbook;
    if (!book) return [];
    const out: Entry[] = [];
    for (let lv = 1; lv <= 4; lv++) {
      const max = book.maxSlots(lv);
      if (max <= 0) continue;
      out.push({ type: "header", level: lv, used: max - book.freeSlots(lv), max });
      for (const def of spellsFor(book.classKey, lv)) if (book.knows(def.key)) out.push({ type: "spell", def });
    }
    return out;
  }

  private spellEntries(es: Entry[]): SpellDef[] {
    return es.filter((e): e is Extract<Entry, { type: "spell" }> => e.type === "spell").map((e) => e.def);
  }

  protected onOpen(): void { this.msg = ""; }

  protected build(): void {
    const { scene } = this;
    const book = this.host.player.spellbook;
    const g = scene.add.graphics();
    this.dyn.add(g);
    const x0 = this.x + 20;
    if (!book) {
      this.dyn.add(label(scene, x0, this.y + 50, "YOU KEEP NO SPELLBOOK.", { color: UI.grey }));
      return;
    }
    const es = this.entries();
    const spells = this.spellEntries(es);
    this.sel = Phaser.Math.Clamp(this.sel, 0, Math.max(0, spells.length - 1));
    const selDef = spells[this.sel];
    const selIdx = es.findIndex((e) => e.type === "spell" && e.def.key === selDef?.key);
    if (selIdx >= 0) {
      if (selIdx < this.scroll) this.scroll = Math.max(0, selIdx - 1);
      if (selIdx >= this.scroll + VISIBLE) this.scroll = selIdx - VISIBLE + 1;
    }

    this.dyn.add(label(scene, x0, this.y + 34, `${book.classKey.toUpperCase()} LEVEL ${book.level}`, { color: UI.gold }));
    this.dyn.add(label(scene, this.x + 380, this.y + 34, "SET", { color: UI.grey }));
    this.dyn.add(label(scene, this.x + 450, this.y + 34, "READY", { color: UI.grey }));

    if (es.length === 0) {
      this.dyn.add(label(scene, x0, this.y + 62, "NO SPELL SLOTS YET.", { color: UI.grey }));
    }
    es.slice(this.scroll, this.scroll + VISIBLE).forEach((e, i) => {
      const y = this.y + 58 + i * ROW_H;
      if (e.type === "header") {
        g.fillStyle(UI.dusk, 1).fillRect(x0 - 4, y - 2, this.w - 32, ROW_H - 2);
        this.dyn.add(label(scene, x0, y + 1, `LEVEL ${e.level} SPELLS`, { color: UI.sky }));
        this.dyn.add(label(scene, this.x + 380, y + 1, `${e.used}/${e.max} SLOTS`, { color: e.used >= e.max ? UI.gold : UI.silver }));
        return;
      }
      const key = e.def.key;
      const total = book.prepared().find((p) => p.key === key)?.total ?? 0;
      const ready = book.remaining(key);
      const picked = e.def.key === selDef?.key;
      if (picked) g.lineStyle(2, UI.gold, 1).strokeRect(x0 - 4, y - 2, this.w - 32, ROW_H - 2);
      this.dyn.add(label(scene, x0 + 8, y + 1, e.def.name.slice(0, 24), { color: total > 0 ? UI.white : UI.silver }));
      this.dyn.add(label(scene, this.x + 380, y + 1, String(total), { color: UI.silver }));
      this.dyn.add(label(scene, this.x + 450, y + 1, String(ready), { color: ready > 0 ? UI.lime : total > 0 ? UI.red : UI.grey }));
      this.addButton(this.x + 516, y - 1, 28, 20, "-", () => this.change(key, -1), ready > 0);
      this.addButton(this.x + 548, y - 1, 28, 20, "+", () => this.change(key, 1), book.freeSlots(e.def.level) > 0);
      // pips: filled = ready, hollow = spent
      for (let k = 0; k < Math.min(total, 10); k++) {
        const px = this.x + 592 + k * 11;
        g.fillStyle(k < ready ? UI.lime : UI.slate, 1).fillRect(px, y + 4, 8, 8);
      }
      this.addRowHit(this.x + 20, y - 2, this.w - 200, ROW_H - 2, spells.findIndex((s) => s.key === key));
    });

    // detail
    drawBox(g, this.x + 16, this.y + 336, this.w - 32, 204, UI.ink, UI.slate, UI.dusk);
    if (selDef) {
      this.dyn.add(label(scene, this.x + 26, this.y + 344, selDef.name, { color: UI.white }));
      this.dyn.add(label(scene, this.x + 26, this.y + 364, `LEVEL ${selDef.level}  RANGE ${selDef.range.toUpperCase()}`, { color: UI.sky }));
      wrap(SPELL_DEFS[selDef.key]?.description ?? "", 54).slice(0, 5).forEach((l, i) => {
        this.dyn.add(label(scene, this.x + 26, this.y + 386 + i * LINE, l, { color: UI.silver }));
      });
    }
    if (this.msg) this.dyn.add(label(scene, this.x + 26, this.y + 496, this.msg.slice(0, 54), { color: UI.gold }));
    this.dyn.add(label(scene, this.x + 26, this.y + 516, "SLOTS RETURN WHEN YOU REST.", { color: UI.grey }));
    this.dyn.add(label(scene, this.x + 20, this.y + 550, isTouchDevice() ? "TAP A SPELL, + AND - SET IT. X CLOSES." : "UP/DOWN PICK  +/- SET  B OR ESC CLOSE", { color: UI.grey }));
    // Past twelve rows the list scrolls with the pick: two buttons for a screen with no arrow keys.
    if (es.length > VISIBLE) {
      this.addButton(this.x + this.w - 108, this.y + 30, 40, 22, "^", () => this.stepSel(-1), this.sel > 0);
      this.addButton(this.x + this.w - 64, this.y + 30, 40, 22, "v", () => this.stepSel(1), this.sel < spells.length - 1);
    }
  }

  private rowHits: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];

  private addRowHit(x: number, y: number, w: number, h: number, idx: number): void {
    this.rowHits.push({ x, y, w, h, idx });
  }

  render(): void {
    this.rowHits = [];
    super.render();
  }

  protected onPointer(kind: "down" | "up" | "move", px: number, py: number): boolean {
    if (kind !== "down") return false;
    for (const r of this.rowHits) {
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) { this.sel = r.idx; this.render(); return true; }
    }
    return false;
  }

  private stepSel(d: 1 | -1): void {
    const n = this.spellEntries(this.entries()).length;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + d));
    this.render();
  }

  private change(key: string, delta: 1 | -1): void {
    const book = this.host.player.spellbook;
    if (!book) return;
    const def = SPELL_DEFS[key];
    if (delta > 0) {
      this.msg = book.memorize(key) ? `${def.name} memorized.` : `No free level ${def.level} slot.`;
    } else {
      this.msg = book.unmemorize(key) ? `${def.name} put aside.` : "A cast spell stays spent until you rest.";
    }
    this.host.ctx?.emitHUD();
    this.render();
  }

  protected onKey(e: KeyboardEvent): void {
    const spells = this.spellEntries(this.entries());
    const cur = spells[this.sel];
    switch (e.code) {
      case "ArrowUp": this.sel = Math.max(0, this.sel - 1); this.render(); break;
      case "ArrowDown": this.sel = Math.min(spells.length - 1, this.sel + 1); this.render(); break;
      case "ArrowRight": case "Equal": case "NumpadAdd": case "Enter": if (cur) this.change(cur.key, 1); break;
      case "ArrowLeft": case "Minus": case "NumpadSubtract": if (cur) this.change(cur.key, -1); break;
      default: break;
    }
  }
}
