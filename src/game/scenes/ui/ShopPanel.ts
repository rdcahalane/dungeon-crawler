/**
 * The innkeeper's shop: BUY and SELL tabs over `src/game/items/shop.ts`. Gold is `player.stats.gold` (the purse); the
 * inventory's own `gold` is only a mirror (see `buyWithPurse`). Keys: Up/Down pick, Enter buy or sell one, Tab switch tab,
 * Esc close. Mouse: click a row to pick it, the buttons below to buy or sell (a click never spends gold by itself), the wheel to scroll.
 */
import * as Phaser from "phaser";
import { Sfx } from "../../audio/Sfx";
import {
  buyWithPurse, describe, displayName, getDef, rarityColor, sellList, sellWithPurse,
  type ItemInstance, type ShopEntry,
} from "../../items";
import { PanelBase } from "./PanelBase";
import type { TavernHost } from "./tavernHost";
import { LINE, UI, drawBox, iconAt, label, pointIn, wrap } from "./theme";

type Tab = "buy" | "sell";

const ROW_H = 26;
const VISIBLE = 10;
const LIST_Y = 72;
const DETAIL_Y = 342;
/** Characters of an item name that fit its column. */
const NAME_COLS = 29;

const KIND_ORDER: Record<string, number> = { consumable: 0, gear: 1, weapon: 2, armor: 3, shield: 3, key: 4, treasure: 5 };

interface Line {
  item: ItemInstance;
  /** Price per unit. */
  price: number;
  /** For sale (buy) or held (sell). */
  qty: number;
  entry?: ShopEntry;
}

/** Stock ordered for reading: potions, scrolls and gear first, then weapons, then armor; cheap before dear. */
export function orderedStock(stock: readonly ShopEntry[]): ShopEntry[] {
  return stock
    .filter((e) => e.item.quantity > 0)
    .slice()
    .sort((a, b) => {
      const ka = KIND_ORDER[getDef(a.item.defKey).kind] ?? 9;
      const kb = KIND_ORDER[getDef(b.item.defKey).kind] ?? 9;
      return ka - kb || a.unitPrice - b.unitPrice || a.item.defKey.localeCompare(b.item.defKey);
    });
}

export class ShopPanel extends PanelBase {
  private tab: Tab = "buy";
  private cursor: Record<Tab, number> = { buy: 0, sell: 0 };
  private scroll: Record<Tab, number> = { buy: 0, sell: 0 };
  private msg = "";
  private msgColor: number = UI.gold;
  private rows: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
  private wheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (!this.opened) return;
    this.moveCursor(dy > 0 ? 1 : -1);
  };

  constructor(scene: Phaser.Scene, private host: TavernHost, onClose: () => void) {
    super(scene, 120, 32, 720, 584, "THE INNKEEPER'S SHOP", UI.orange, onClose);
  }

  protected onOpen(): void {
    this.msg = "";
    this.scene.input.on("wheel", this.wheel);
  }

  protected onCloseInternal(): void {
    this.scene.input.off("wheel", this.wheel);
  }

  // ── Data ──────────────────────────────────────────────────────────────────────────────────────────────

  private lines(): Line[] {
    if (this.tab === "buy") {
      return orderedStock(this.host.stock()).map((e) => ({ item: e.item, price: e.unitPrice, qty: e.item.quantity, entry: e }));
    }
    return sellList(this.host.player.inventory).map((l) => ({ item: l.item, price: l.unitPrice, qty: l.item.quantity }));
  }

  private current(lines: Line[]): Line | undefined {
    const i = Math.max(0, Math.min(this.cursor[this.tab], lines.length - 1));
    return lines[i];
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────────────────

  protected build(): void {
    const { scene } = this;
    const stats = this.host.player.stats;
    const inv = this.host.player.inventory;
    const g = scene.add.graphics();
    this.dyn.add(g);
    this.rows = [];
    const lines = this.lines();
    const t = this.tab;
    this.cursor[t] = Math.max(0, Math.min(this.cursor[t], Math.max(0, lines.length - 1)));
    if (this.cursor[t] < this.scroll[t]) this.scroll[t] = this.cursor[t];
    if (this.cursor[t] >= this.scroll[t] + VISIBLE) this.scroll[t] = this.cursor[t] - VISIBLE + 1;
    this.scroll[t] = Math.max(0, Math.min(this.scroll[t], Math.max(0, lines.length - VISIBLE)));

    // tabs and purse
    this.tabButton(this.x + 16, this.y + 32, "BUY", "buy");
    this.tabButton(this.x + 124, this.y + 32, "SELL", "sell");
    this.dyn.add(label(scene, this.x + this.w - 20, this.y + 38, `GOLD ${stats.gold}`, { color: UI.gold, ox: 1 }));

    // list
    const x0 = this.x + 16;
    const w = this.w - 32;
    drawBox(g, x0, this.y + LIST_Y - 6, w, VISIBLE * ROW_H + 8, UI.black, UI.slate, null);
    if (lines.length === 0) {
      this.dyn.add(label(scene, x0 + 12, this.y + LIST_Y + 4, t === "buy" ? "SOLD OUT. COME BACK TOMORROW." : "YOUR PACK HOLDS NOTHING HE WOULD BUY.", { color: UI.grey }));
    }
    lines.slice(this.scroll[t], this.scroll[t] + VISIBLE).forEach((ln, i) => {
      const index = this.scroll[t] + i;
      const y = this.y + LIST_Y + i * ROW_H;
      const picked = index === this.cursor[t];
      const def = getDef(ln.item.defKey);
      const usable = inv.canUse(def);
      const afford = t === "sell" || stats.gold >= ln.price;
      if (picked) g.fillStyle(UI.dusk, 1).fillRect(x0 + 2, y - 2, w - 4, ROW_H - 2).lineStyle(2, UI.gold, 1).strokeRect(x0 + 2, y - 2, w - 4, ROW_H - 2);
      this.dyn.add(iconAt(scene, def.icon, x0 + 24, y + 11, 24));
      const known = ln.item.identified || ln.item.rarity === "common";
      const nameColor = !usable ? UI.grey : known ? rarityColor(ln.item) : UI.violet;
      this.dyn.add(label(scene, x0 + 44, y + 4, displayName(ln.item).toUpperCase().slice(0, NAME_COLS), { color: nameColor }));
      this.dyn.add(label(scene, x0 + w - 150, y + 4, `X${ln.qty}`, { color: UI.silver, ox: 1 }));
      this.dyn.add(label(scene, x0 + w - 12, y + 4, `${ln.price} GP`, { color: afford ? UI.gold : UI.red, ox: 1 }));
      this.rows.push({ x: x0, y: y - 2, w: w - 18, h: ROW_H, index });
    });
    // scroll bar
    if (lines.length > VISIBLE) {
      const trackH = VISIBLE * ROW_H;
      const barH = Math.max(16, Math.round(trackH * (VISIBLE / lines.length)));
      const barY = Math.round((trackH - barH) * (this.scroll[t] / (lines.length - VISIBLE)));
      g.fillStyle(UI.dusk, 1).fillRect(x0 + w - 12, this.y + LIST_Y - 2, 8, trackH);
      g.fillStyle(UI.silver, 1).fillRect(x0 + w - 12, this.y + LIST_Y - 2 + barY, 8, barH);
    }

    // detail and actions
    drawBox(g, x0, this.y + DETAIL_Y, w, 198, UI.ink, UI.slate, UI.dusk);
    const cur = this.current(lines);
    if (cur) {
      const def = getDef(cur.item.defKey);
      this.dyn.add(iconAt(scene, def.icon, x0 + w - 28, this.y + DETAIL_Y + 30, 32));
      this.dyn.add(label(scene, x0 + 10, this.y + DETAIL_Y + 8, displayName(cur.item, { quantity: true }).slice(0, 50), { color: rarityColor(cur.item) }));
      const body = describe(cur.item).slice(1).flatMap((l) => wrap(l, 52));
      if (!inv.canUse(def)) body.unshift(`A ${inv.classKey} cannot use this.`);
      body.slice(0, 4).forEach((l, i) => {
        this.dyn.add(label(scene, x0 + 10, this.y + DETAIL_Y + 28 + i * LINE, l, { color: l.startsWith("A ") && l.endsWith("use this.") ? UI.red : UI.silver }));
      });
      const by = this.y + DETAIL_Y + 108;
      if (t === "buy") {
        const can1 = stats.gold >= cur.price && cur.qty >= 1;
        this.addButton(x0 + 10, by, 140, 28, "BUY 1", () => this.transact(1), can1);
        const five = Math.min(5, cur.qty);
        this.addButton(x0 + 158, by, 140, 28, `BUY ${five}`, () => this.transact(five), five > 1 && stats.gold >= cur.price * five);
      } else {
        this.addButton(x0 + 10, by, 140, 28, "SELL 1", () => this.transact(1), true);
        this.addButton(x0 + 158, by, 140, 28, `SELL ALL ${cur.qty}`.slice(0, 11), () => this.transact(cur.qty), cur.qty > 1);
      }
    }
    if (this.msg) this.dyn.add(label(scene, x0 + 10, this.y + DETAIL_Y + 150, this.msg.slice(0, 56), { color: this.msgColor }));
    this.dyn.add(label(scene, x0 + 10, this.y + DETAIL_Y + 174, `PACK ${inv.pack.filter(Boolean).length}/24`, { color: UI.grey }));
    this.dyn.add(label(scene, this.x + 20, this.y + 550, "UP/DOWN PICK  ENTER BUY/SELL  TAB SWITCH  ESC CLOSE", { color: UI.grey }));
  }

  private tabButton(x: number, y: number, text: string, tab: Tab): void {
    const active = this.tab === tab;
    const g = this.scene.add.graphics();
    drawBox(g, x, y, 100, 28, active ? UI.slate : UI.ink, active ? UI.gold : UI.slate, null);
    this.dyn.add(g);
    this.dyn.add(label(this.scene, x + 50, y + 14, text, { color: active ? UI.gold : UI.silver, ox: 0.5, oy: 0.5 }));
    this.buttons.push({ x, y, w: 100, h: 28, text, onClick: () => this.setTab(tab) });
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────────────

  private setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.msg = "";
    Sfx.play("ui_move");
    this.render();
  }

  private moveCursor(d: 1 | -1): void {
    const n = this.lines().length;
    if (n === 0) return;
    this.cursor[this.tab] = Math.max(0, Math.min(n - 1, this.cursor[this.tab] + d));
    this.render();
  }

  /** Buy or sell `qty` of the picked line. */
  private transact(qty: number): void {
    const lines = this.lines();
    const cur = this.current(lines);
    if (!cur || qty < 1) return;
    const player = this.host.player;
    const name = displayName(cur.item);
    if (this.tab === "buy" && cur.entry) {
      const r = buyWithPurse(player.inventory, player.stats, cur.entry, qty);
      if (r.ok) {
        this.msg = `Bought ${qty} ${name} for ${r.spent} gp.`;
        this.msgColor = UI.lime;
        Sfx.play("gold");
      } else {
        this.msg = r.message;
        this.msgColor = UI.red;
        Sfx.play("ui_back");
      }
    } else {
      const r = sellWithPurse(player.inventory, player.stats, cur.item.id, qty);
      if (r.ok) {
        this.msg = `Sold ${qty} ${name} for ${r.earned} gp.`;
        this.msgColor = UI.lime;
        Sfx.play("gold");
      } else {
        this.msg = r.message;
        this.msgColor = UI.red;
        Sfx.play("ui_back");
      }
    }
    player.recomputeDerived();
    this.host.refresh();
    this.render();
  }

  // ── Input ─────────────────────────────────────────────────────────────────────────────────────────────

  protected onKey(e: KeyboardEvent): void {
    switch (e.code) {
      case "ArrowUp": this.moveCursor(-1); break;
      case "ArrowDown": this.moveCursor(1); break;
      case "PageUp": for (let i = 0; i < VISIBLE; i++) this.stepQuiet(-1); this.render(); break;
      case "PageDown": for (let i = 0; i < VISIBLE; i++) this.stepQuiet(1); this.render(); break;
      case "Tab": case "ArrowLeft": case "ArrowRight": this.setTab(this.tab === "buy" ? "sell" : "buy"); break;
      case "Enter": case "NumpadEnter": this.transact(1); break;
      default: break;
    }
  }

  private stepQuiet(d: 1 | -1): void {
    const n = this.lines().length;
    this.cursor[this.tab] = Math.max(0, Math.min(Math.max(0, n - 1), this.cursor[this.tab] + d));
  }

  protected onPointer(kind: "down" | "up" | "move", px: number, py: number): boolean {
    if (kind !== "down") return false;
    for (const r of this.rows) {
      if (pointIn(r, px, py)) {
        this.cursor[this.tab] = r.index;
        this.render();
        return true;
      }
    }
    return false;
  }
}
