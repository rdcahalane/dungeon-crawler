/**
 * Inventory screen: paper doll, 6x4 pack, belt, detail pane, character sheet.
 * Mouse: click selects, double-click does the primary action, drag or "click source then destination"
 * moves. Keys: arrows, Enter, D drop, B belt, V move, Esc / I close.
 */
import { isTouchDevice } from "../../touch";
import * as Phaser from "phaser";
import { EQUIP_SLOTS, BELT_SIZE, PACK_SIZE, describe, displayName, getDef, rarityColor } from "../../items";
import type { Inventory, ItemInstance } from "../../items";
import { PanelBase } from "./PanelBase";
import type { PanelHost } from "./panelHost";
import { opsHostFor } from "./panelHost";
import { runAction } from "./inventoryOps";
import {
  EQUIP_GRID, EQUIP_LABELS, PACK_COLS, beltAction, dropAction, itemAt, moveBetween, moveCursor,
  primaryAction, primaryLabel, sameCursor, type Cursor, type Dir, type InvAction,
} from "./inventoryModel";
import { SAVE_ORDER, buildSheet } from "./charSheet";
import { BELT_HOTKEYS } from "./hotbar";
import { LINE, UI, drawBox, iconAt, label, pointIn, wrap } from "./theme";

const SLOT = 48;
const EQ_STEP = 56;
const CELL = 56;
const CELL_STEP = 62;
// Everything is 16px text now. Panel: x 40..920, y 32..616.
const PANEL = { x: 40, y: 32, w: 880, h: 584 };
const DOLL = { x: 56, y: 84 };
const PACK = { x: 250, y: 84 };
const BELT = { x: 250, y: 352 };
const SHEET = { x: 640, y: 84 };
const BTN = { x: 640, y: 262 };
const DETAIL = { x: 56, y: 424, w: 848, h: 150 };
/** Three letters fit a 48px slot at 16px. */
/** Saves in three letters so a row of three fits the sheet column. */
const SAVE_SHORT: Record<string, string> = { death: "DTH", petrify: "PET", wands: "WND", breath: "BRT", spells: "SPL" };
const SLOT_TAG: Record<string, string> = {
  WEAPON: "WPN", OFFHAND: "OFF", ARMOR: "ARM", HELM: "HLM", CLOAK: "CLK", BOOTS: "BTS", RING: "RNG", AMULET: "AMU",
};
const DOUBLE_CLICK_MS = 380;

interface SlotRect { c: Cursor; x: number; y: number; w: number; h: number }

/** Colour of an item's name and frame. Unidentified magic stays neutral so its rarity is not leaked. */
export function itemTone(it: ItemInstance): number {
  const known = it.identified || it.rarity === "common";
  return known ? rarityColor(it) : UI.violet;
}

export class InventoryPanel extends PanelBase {
  private cursor: Cursor = { zone: "pack", index: 0 };
  private hover: Cursor | null = null;
  private moveFrom: Cursor | null = null;
  private dragFrom: Cursor | null = null;
  private lastClick: { c: Cursor; at: number } | null = null;
  private slots: SlotRect[] = [];
  private msg = "";
  private msgColor: number = UI.gold;

  constructor(scene: Phaser.Scene, private host: PanelHost, onClose: () => void) {
    super(scene, PANEL.x, PANEL.y, PANEL.w, PANEL.h, "INVENTORY", UI.sky, onClose);
  }

  protected onOpen(): void {
    this.msg = "";
    this.moveFrom = null;
    this.dragFrom = null;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────

  protected build(): void {
    const { scene } = this;
    const inv = this.host.player.inventory;
    const stats = this.host.player.stats;
    const g = scene.add.graphics();
    this.dyn.add(g);
    this.slots = [];
    const add = (o: Phaser.GameObjects.GameObject): void => { this.dyn.add(o); };

    add(label(scene, DOLL.x, DOLL.y - 18, "EQUIPMENT", { color: UI.gold }));
    add(label(scene, PACK.x, PACK.y - 18, `PACK ${inv.pack.filter(Boolean).length}/${PACK_SIZE}`, { color: UI.gold }));
    add(label(scene, BELT.x, BELT.y - 18, "BELT (KEYS 5-8)", { color: UI.gold }));

    // paper doll: sprite behind the middle cells
    const spriteKey = `player_${stats.classKey}`;
    add(iconAt(scene, spriteKey, DOLL.x + EQ_STEP + SLOT / 2, DOLL.y + EQ_STEP + SLOT / 2 + 28, 64));
    EQUIP_SLOTS.forEach((slot, i) => {
      const gp = EQUIP_GRID[slot];
      const x = DOLL.x + gp.col * EQ_STEP;
      const y = DOLL.y + gp.row * EQ_STEP;
      this.slotBox(g, { zone: "equip", index: i }, x, y, SLOT, SLOT, inv.equipment[slot] ?? null, SLOT_TAG[EQUIP_LABELS[slot]] ?? "");
    });

    for (let i = 0; i < PACK_SIZE; i++) {
      const x = PACK.x + (i % PACK_COLS) * CELL_STEP;
      const y = PACK.y + Math.floor(i / PACK_COLS) * CELL_STEP;
      this.slotBox(g, { zone: "pack", index: i }, x, y, CELL, CELL, inv.pack[i], "");
    }
    for (let i = 0; i < BELT_SIZE; i++) {
      this.slotBox(g, { zone: "belt", index: i }, BELT.x + i * CELL_STEP, BELT.y, CELL, CELL, inv.belt[i], BELT_HOTKEYS[i], true);
    }

    this.buildSheet(inv);
    this.buildButtons();
    this.buildDetail(g, inv);
    add(label(scene, 56, 584, isTouchDevice() ? "TAP A SLOT, THEN A BUTTON. DOUBLE TAP USES IT. X CLOSES." : "ARROWS MOVE  ENTER USE/EQUIP  D DROP  B BELT  V MOVE  I OR ESC CLOSE", { color: UI.grey }));
  }

  private slotBox(
    g: Phaser.GameObjects.Graphics, c: Cursor, x: number, y: number, w: number, h: number,
    it: ItemInstance | null, tag: string, tagAlways = false,
  ): void {
    const { scene } = this;
    this.slots.push({ c, x, y, w, h });
    const selected = sameCursor(c, this.cursor);
    const hovered = sameCursor(c, this.hover);
    const moving = sameCursor(c, this.moveFrom);
    let border: number = UI.slate;
    if (it) border = it.identified && it.cursed ? UI.red : itemTone(it);
    if (hovered) border = UI.white;
    if (moving) border = UI.orange;
    if (selected) border = UI.gold;
    drawBox(g, x, y, w, h, it ? UI.dusk : UI.ink, border, null);
    if (selected) g.lineStyle(2, UI.gold, 1).strokeRect(x - 2, y - 2, w + 4, h + 4);
    // The slot name shows on an empty slot (centred); the belt keeps its key number in the corner.
    if (!it && tag) this.dyn.add(label(scene, x + w / 2, y + h / 2, tag, { color: UI.slate, ox: 0.5, oy: 0.5 }));
    if (it && tag && tagAlways) this.dyn.add(label(scene, x + 3, y + 2, tag, { color: UI.grey }));
    if (!it) return;
    const d = getDef(it.defKey);
    this.dyn.add(iconAt(scene, d.icon, x + w / 2, y + h / 2, 32));
    const badge = (text: string, color: number, right: boolean, bottom: boolean): void => {
      const bw = text.length * 12 + 2;
      const bx = right ? x + w - 3 - bw : x + 3;
      const by = bottom ? y + h - 19 : y + 3;
      const back = scene.add.rectangle(bx, by, bw, 16, UI.black, 0.8).setOrigin(0, 0);
      this.dyn.add(back);
      this.dyn.add(label(scene, bx + 1, by, text, { color }));
    };
    if (it.quantity > 1) badge(String(it.quantity), UI.white, true, true);
    if (!it.identified && it.rarity !== "common") badge("?", UI.violet, true, false);
    if (it.identified && it.cursed) badge("!", UI.red, true, false);
  }

  /** Character sheet: only what a decision needs (ability scores, THAC0, AC, five saves, load, gold), at 16px. */
  private buildSheet(inv: Inventory): void {
    const { scene } = this;
    const stats = this.host.player.stats;
    const hud = this.host.hud();
    const s = buildSheet(stats, inv, { thac0: hud?.thac0, ac: hud?.ac, saves: hud?.saves, title: hud?.title });
    const x = SHEET.x;
    let y = SHEET.y;
    const line = (t: string, color: number = UI.silver): void => {
      this.dyn.add(label(scene, x, y, t, { color }));
      y += LINE;
    };
    line(`${stats.name ?? stats.classKey}`.toUpperCase().slice(0, 22), UI.white);
    line(`LV ${stats.level} ${s.title.toUpperCase()}`.slice(0, 22), UI.gold);
    const a = s.abilities.map(([k, v]) => `${k} ${String(v).padStart(2)}`);
    line(a.slice(0, 3).join(" "));
    line(a.slice(3).join(" "));
    line(`THAC0 ${s.thac0}   AC ${s.ac}`, UI.white);
    const sv = SAVE_ORDER.map((c) => `${SAVE_SHORT[c]} ${s.saves[c]}`);
    line(sv.slice(0, 3).join(" "), UI.sky);
    line(sv.slice(3).join(" "), UI.sky);
    const tierColor = s.enc.tier === "light" ? UI.lime : s.enc.tier === "moderate" ? UI.gold : UI.red;
    line(`LOAD ${s.enc.tier.toUpperCase()}`, tierColor);
    line(`GOLD ${inv.gold}`, UI.gold);
  }

  private buildButtons(): void {
    const inv = this.host.player.inventory;
    const c = this.cursor;
    const pl = primaryLabel(inv, c);
    const x = BTN.x;
    const y = BTN.y;
    this.addButton(x, y, 132, 26, pl ?? "USE", () => this.primary(), pl !== null);
    this.addButton(x + 140, y, 132, 26, "DROP", () => this.drop(), dropAction(inv, c) !== null);
    this.addButton(x, y + 32, 132, 26, c.zone === "belt" ? "TO PACK" : "TO BELT", () => this.toBelt(), beltAction(inv, c) !== null);
    this.addButton(x + 140, y + 32, 132, 26, this.moveFrom ? "CANCEL" : "MOVE", () => this.toggleMove(), itemAt(inv, c) !== null || this.moveFrom !== null);
    if (this.moveFrom) this.dyn.add(label(this.scene, x, y + 64, "PICK A DESTINATION", { color: UI.orange }));
  }

  private buildDetail(g: Phaser.GameObjects.Graphics, inv: Inventory): void {
    const { scene } = this;
    drawBox(g, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h, UI.ink, UI.slate, UI.dusk);
    const c = this.hover ?? this.cursor;
    const it = itemAt(inv, c);
    const x = DETAIL.x + 10;
    if (!it) {
      this.dyn.add(label(scene, x, DETAIL.y + 10, c.zone === "equip" ? `${EQUIP_LABELS[EQUIP_SLOTS[c.index]]} SLOT: EMPTY` : "EMPTY SLOT", { color: UI.grey }));
    } else {
      const tone = it.identified && it.cursed ? UI.red : itemTone(it);
      this.dyn.add(iconAt(scene, getDef(it.defKey).icon, DETAIL.x + DETAIL.w - 30, DETAIL.y + 30, 32));
      this.dyn.add(label(scene, x, DETAIL.y + 8, displayName(it, { quantity: true }).slice(0, 56), { color: tone }));
      // Five rows of 16px: the first lines of the description are the ones that matter, the rest is cut.
      const lines = describe(it).slice(1).flatMap((l) => wrap(l, 62)).slice(0, 5);
      lines.forEach((l, i) => {
        const col = l.startsWith("Cursed") ? UI.red : l.startsWith("Unidentified") ? UI.violet : UI.silver;
        this.dyn.add(label(scene, x, DETAIL.y + 28 + i * LINE, l, { color: col }));
      });
    }
    if (this.msg) this.dyn.add(label(scene, x, DETAIL.y + DETAIL.h - 20, this.msg.slice(0, 66), { color: this.msgColor }));
  }

  // ── Actions ──────────────────────────────────────────────────────────────────────────────────────────

  private act(a: InvAction | null, nothing = "Nothing to do there."): void {
    if (!a) { this.setMsg(nothing, UI.grey); this.render(); return; }
    const r = runAction({ ...opsHostFor(this.host), say: (m) => this.setMsg(m, UI.gold) }, a);
    if (!r.ok) this.msgColor = UI.red;
    this.render();
  }

  private setMsg(m: string, color: number): void {
    this.msg = m;
    this.msgColor = color;
  }

  private primary(): void { this.act(primaryAction(this.host.player.inventory, this.cursor), "Nothing to use or equip."); }
  private drop(): void { this.act(dropAction(this.host.player.inventory, this.cursor), "Nothing to drop."); }
  private toBelt(): void { this.act(beltAction(this.host.player.inventory, this.cursor), "That cannot go there."); }

  private toggleMove(): void {
    this.moveFrom = this.moveFrom ? null : (itemAt(this.host.player.inventory, this.cursor) ? { ...this.cursor } : null);
    this.render();
  }

  private moveTo(from: Cursor, to: Cursor): void {
    this.act(moveBetween(this.host.player.inventory, from, to), "That cannot go there.");
    this.cursor = to;
    this.render();
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────────────────

  private slotAt(x: number, y: number): Cursor | null {
    for (const s of this.slots) if (pointIn(s, x, y)) return s.c;
    return null;
  }

  protected onPointer(kind: "down" | "up" | "move", x: number, y: number): boolean {
    const c = this.slotAt(x, y);
    if (kind === "move") {
      if (!sameCursor(c, this.hover)) { this.hover = c; this.render(); }
      return false;
    }
    if (kind === "down") {
      if (!c) return false;
      if (this.moveFrom) {
        const from = this.moveFrom;
        this.moveFrom = null;
        this.moveTo(from, c);
        return true;
      }
      const now = Date.now();
      const dbl = this.lastClick && sameCursor(this.lastClick.c, c) && now - this.lastClick.at < DOUBLE_CLICK_MS;
      this.cursor = c;
      this.dragFrom = itemAt(this.host.player.inventory, c) ? { ...c } : null;
      this.lastClick = dbl ? null : { c, at: now };
      if (dbl) { this.dragFrom = null; this.primary(); } else this.render();
      return true;
    }
    // up
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from && c && !sameCursor(from, c)) { this.moveTo(from, c); return true; }
    return false;
  }

  protected onKey(e: KeyboardEvent): void {
    const dirs: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const d = dirs[e.code];
    if (d) { this.cursor = moveCursor(this.cursor, d); this.hover = null; this.render(); return; }
    switch (e.code) {
      case "Enter":
      case "NumpadEnter":
        if (this.moveFrom) { const f = this.moveFrom; this.moveFrom = null; this.moveTo(f, this.cursor); } else this.primary();
        break;
      case "KeyD": this.drop(); break;
      case "KeyB": this.toBelt(); break;
      case "KeyV": this.toggleMove(); break;
      default: break;
    }
  }

  /** Re-read the inventory (called when the HUD payload changes while the panel is open). */
  refresh(): void {
    if (this.opened) this.render();
  }
}
