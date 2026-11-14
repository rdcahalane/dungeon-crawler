/** Small HUD pieces: HP orb, identity panel, floor panel, torch gauge, target bar, effect icons, log view. */
import * as Phaser from "phaser";
import { STATUS_EFFECT_DEFS } from "../../constants";
import type { StatusEffect } from "../../constants";
import { fitLines } from "./fitLines";
import { hudLog, layoutLog } from "./messageLog";
import { GLYPH_W, LINE, SCREEN_H, SCREEN_W, UI, ascii, drawBox, hex, iconAt, label, setLabel } from "./theme";
import { uiState, type HoverInfo } from "./uiState";

// ── HP orb ─────────────────────────────────────────────────────────────────────────────────────────────

const ORB = { cx: 52, cy: SCREEN_H - 48, r: 38, row: 4 };

export class HpOrb {
  private g: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.BitmapText;
  private maxText: Phaser.GameObjects.BitmapText;
  private sig = "";

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
    // Two lines at 16px: current over maximum, so three-digit values still sit inside the orb.
    this.text = label(scene, ORB.cx, ORB.cy - 17, "", { color: UI.white, ox: 0.5, depth: 8 });
    this.maxText = label(scene, ORB.cx, ORB.cy + 1, "", { color: UI.silver, ox: 0.5, depth: 8 });
    uiState.setRect("orb", { x: ORB.cx - ORB.r - 2, y: ORB.cy - ORB.r - 2, w: ORB.r * 2 + 4, h: ORB.r * 2 + 4 });
  }

  update(hp: number, maxHp: number, now: number): void {
    const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const flash = frac > 0 && frac < 0.25 && Math.floor(now / 300) % 2 === 0;
    const sig = `${Math.ceil(hp)}|${maxHp}|${flash}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const { cx, cy, r, row } = ORB;
    const g = this.g;
    g.clear();
    const fillColor = flash ? UI.blood : frac > 0.5 ? UI.red : frac > 0.25 ? UI.orange : UI.red;
    const level = cy + r - frac * r * 2; // fill below this y
    for (let y = cy - r; y < cy + r; y += row) {
      const dy = y + row / 2 - cy;
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) / 2) * 2;
      if (half <= 0) continue;
      const rim = half + 2;
      g.fillStyle(UI.slate, 1).fillRect(cx - rim, y, rim * 2, row);
      g.fillStyle(y + row > level ? fillColor : UI.ink, 1).fillRect(cx - half, y, half * 2, row);
    }
    g.fillStyle(UI.cream, 1).fillRect(cx - 28, cy - 28, 8, 4).fillRect(cx - 32, cy - 24, 4, 4); // glint
    // Dark plate behind the numbers so they read over the red fill.
    g.fillStyle(UI.black, 0.6).fillRect(cx - 24, cy - 19, 48, 38);
    setLabel(this.text, String(Math.ceil(hp)));
    setLabel(this.maxText, `/${maxHp}`);
  }
}

// ── Identity (top-left) ────────────────────────────────────────────────────────────────────────────────

export interface IdentityData {
  name?: string; classKey: string; level: number; title?: string;
  xp: number; xpToNext: number; thac0?: number; ac?: number;
}

const ID_BOX = { x: 8, y: 8, w: 320, h: 98 };

export class IdentityPanel {
  private name: Phaser.GameObjects.BitmapText;
  private sub: Phaser.GameObjects.BitmapText;
  private stats: Phaser.GameObjects.BitmapText;
  private xp: Phaser.GameObjects.Graphics;
  private xpSig = "";

  constructor(scene: Phaser.Scene) {
    const g = scene.add.graphics().setDepth(1);
    drawBox(g, ID_BOX.x, ID_BOX.y, ID_BOX.w, ID_BOX.h, UI.ink, UI.slate, UI.dusk);
    this.name = label(scene, 18, 14, "", { color: UI.white, depth: 3 });
    this.sub = label(scene, 18, 32, "", { color: UI.gold, depth: 3 });
    this.xp = scene.add.graphics().setDepth(3);
    label(scene, 18, 52, "XP", { color: UI.grey, depth: 3 });
    this.stats = label(scene, 18, 72, "", { color: UI.silver, depth: 3 });
    uiState.setRect("identity", ID_BOX);
  }

  update(d: IdentityData): void {
    setLabel(this.name, (d.name ?? d.classKey).toUpperCase().slice(0, 24));
    setLabel(this.sub, `LEVEL ${d.level} ${(d.title ?? d.classKey).toUpperCase()}`.slice(0, 24));
    const pct = d.xpToNext > 0 ? Math.max(0, Math.min(1, d.xp / d.xpToNext)) : 0;
    const sig = `${Math.round(pct * 100)}`;
    if (sig !== this.xpSig) {
      this.xpSig = sig;
      this.xp.clear().fillStyle(UI.black, 1).fillRect(52, 56, 264, 8).fillStyle(UI.violet, 1).fillRect(53, 57, Math.round(262 * pct), 6);
    }
    const t = d.thac0 !== undefined ? `THAC0 ${d.thac0}` : "";
    const a = d.ac !== undefined ? `AC ${d.ac}` : "";
    setLabel(this.stats, `${t}${t && a ? "   " : ""}${a}`);
  }
}

// ── Floor and objective (top-right) ────────────────────────────────────────────────────────────────────

export interface FloorData {
  floor: number;
  objective?: { title: string; detail: string; progress: number; target: number; complete: boolean };
  kills: number;
  activeQuests: number;
}

const FLOOR_W = 340;
/** Characters that fit a row of the floor panel. */
const FLOOR_COLS = Math.floor((FLOOR_W - 24) / GLYPH_W);
/** Head line, three lines of description, the kills row and the quests row. */
const FLOOR_ROWS = 6;
/** Lines of objective description the floor panel shows. */
const DETAIL_LINES = 3;
/** Bottom edge of the tallest the floor panel can get (the minimap sits just under it). */
export const FLOOR_PANEL_MAX_BOTTOM = 8 + 40 + FLOOR_ROWS * LINE + 8;

export class FloorPanel {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private lines: Phaser.GameObjects.BitmapText[] = [];
  private sig = "";

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(1);
    this.title = label(scene, SCREEN_W - 18, 14, "", { color: UI.gold, ox: 1, depth: 3 });
    for (let i = 0; i < FLOOR_ROWS; i++) this.lines.push(label(scene, SCREEN_W - 18, 38 + i * LINE, "", { color: UI.silver, ox: 1, depth: 3 }));
  }

  update(d: FloorData): void {
    const obj = d.floor !== 0 ? d.objective : undefined;
    const sig = JSON.stringify([d.floor, obj, d.kills, d.activeQuests]);
    if (sig === this.sig) return;
    this.sig = sig;
    setLabel(this.title, d.floor === 0 ? "THE TAVERN" : `FLOOR ${d.floor}`);
    const rows: Array<[string, number]> = [];
    if (d.floor === 0) {
      // The tavern: the place name above, then the keys that work here.
      rows.push(["I PACK  B BOOK  Q QUESTS", UI.grey]);
      rows.push(["E TALK  ESC CLOSE", UI.grey]);
      if (d.activeQuests > 0) rows.push([`QUESTS ${d.activeQuests}`, UI.green]);
    } else {
      if (obj) {
        const head = `${obj.title.toUpperCase()} ${obj.complete ? "DONE" : `${obj.progress}/${obj.target}`}`;
        const col = obj.complete ? UI.lime : UI.cream;
        rows.push([head.length > FLOOR_COLS ? `${head.slice(0, FLOOR_COLS - 2)}..` : head, col]);
        for (const l of fitLines(ascii(obj.detail), FLOOR_COLS, DETAIL_LINES)) rows.push([l, UI.silver]);
      }
      rows.push([`KILLS ${d.kills}  I B M`, UI.grey]);
      if (d.activeQuests > 0) rows.push([`QUESTS ${d.activeQuests}`, UI.green]);
    }
    const shown = rows.slice(0, FLOOR_ROWS);
    this.lines.forEach((t, i) => (shown[i] ? setLabel(t, shown[i][0], shown[i][1]) : setLabel(t, "")));
    const h = 38 + shown.length * LINE + 4;
    this.g.clear();
    drawBox(this.g, SCREEN_W - 8 - FLOOR_W, 8, FLOOR_W, h, UI.ink, UI.slate, UI.dusk);
    uiState.setRect("floor", { x: SCREEN_W - 8 - FLOOR_W, y: 8, w: FLOOR_W, h });
  }
}

// ── Torch and gold (bottom-right) ──────────────────────────────────────────────────────────────────────

export class TorchGold {
  private g: Phaser.GameObjects.Graphics;
  private time: Phaser.GameObjects.BitmapText;
  private gold: Phaser.GameObjects.BitmapText;
  private icon: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private maxSec = 600;
  private sig = "";

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
    this.gold = label(scene, SCREEN_W - 12, SCREEN_H - 52, "", { color: UI.gold, ox: 1, depth: 8 });
    this.time = label(scene, SCREEN_W - 12, SCREEN_H - 26, "", { color: UI.silver, ox: 1, depth: 8 });
    this.icon = iconAt(scene, "item_torch", SCREEN_W - 212, SCREEN_H - 18, 24).setDepth(8);
    uiState.setRect("torch", { x: SCREEN_W - 224, y: SCREEN_H - 56, w: 224, h: 56 });
  }

  update(torchSeconds: number | undefined, gold: number | undefined, now: number): void {
    if (torchSeconds !== undefined && torchSeconds !== Infinity && torchSeconds > this.maxSec) this.maxSec = torchSeconds;
    const low = torchSeconds !== undefined && torchSeconds < 30;
    const blink = low && Math.floor(now / 350) % 2 === 0;
    const sig = `${torchSeconds === undefined ? "-" : Math.ceil(torchSeconds)}|${gold ?? "-"}|${blink}`;
    if (sig === this.sig) return;
    this.sig = sig;
    setLabel(this.gold, gold !== undefined ? `GOLD ${gold}` : "");
    const g = this.g;
    g.clear();
    const x = SCREEN_W - 196;
    const y = SCREEN_H - 24;
    drawBox(g, x, y, 112, 12, UI.black, UI.slate, null);
    if (torchSeconds === undefined) { setLabel(this.time, ""); return; }
    const frac = torchSeconds === Infinity ? 1 : Math.max(0, Math.min(1, torchSeconds / this.maxSec));
    g.fillStyle(blink ? UI.blood : low ? UI.red : UI.orange, 1).fillRect(x + 2, y + 2, Math.round(108 * frac), 8);
    const s = torchSeconds === Infinity ? 0 : Math.max(0, Math.ceil(torchSeconds));
    setLabel(this.time, torchSeconds === Infinity ? "LINK" : torchSeconds <= 0 ? "DARK" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, low ? UI.red : UI.silver);
    this.icon.setVisible(!blink);
  }
}

// ── Target bar (top center) ────────────────────────────────────────────────────────────────────────────

export class TargetBar {
  private g: Phaser.GameObjects.Graphics;
  private name: Phaser.GameObjects.BitmapText;
  private sig = "";

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
    this.name = label(scene, SCREEN_W / 2, 12, "", { color: UI.white, ox: 0.5, depth: 8 });
  }

  update(h: HoverInfo | null): void {
    const sig = h ? `${h.name}|${Math.ceil(h.hp)}|${h.maxHp}` : "";
    if (sig === this.sig) return;
    this.sig = sig;
    this.g.clear();
    if (!h) { setLabel(this.name, ""); return; }
    const w = 240;
    const x = (SCREEN_W - w) / 2;
    setLabel(this.name, h.name.toUpperCase().slice(0, 18));
    drawBox(this.g, x, 6, w, 46, UI.ink, UI.slate, null);
    this.g.fillStyle(UI.black, 1).fillRect(x + 8, 34, w - 16, 10);
    const frac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
    this.g.fillStyle(UI.red, 1).fillRect(x + 9, 35, Math.round((w - 18) * frac), 8);
  }
}

// ── Status effect icons ────────────────────────────────────────────────────────────────────────────────

const EFFECT_W = 44;
const EFFECT_H = 40;

export class EffectIcons {
  private items: Phaser.GameObjects.GameObject[] = [];
  private sig = "";
  constructor(private scene: Phaser.Scene, private x: number, private y: number) {}

  update(effects: StatusEffect[] | undefined): void {
    const list = effects ?? [];
    const sig = list.map((e) => `${e.key}:${Math.ceil(e.duration / 1000)}`).join(",");
    if (sig === this.sig) return;
    this.sig = sig;
    this.items.forEach((o) => o.destroy());
    this.items = [];
    list.forEach((e, i) => {
      const def = STATUS_EFFECT_DEFS[e.key];
      if (!def) return;
      const x = this.x + i * (EFFECT_W + 4);
      const g = this.scene.add.graphics().setDepth(5);
      drawBox(g, x, this.y, EFFECT_W, EFFECT_H, UI.ink, def.color, null);
      const t = label(this.scene, x + EFFECT_W / 2, this.y + 3, def.icon.toUpperCase().slice(0, 3), { color: def.color, ox: 0.5, depth: 8 });
      const s = label(this.scene, x + EFFECT_W / 2, this.y + 21, `${Math.ceil(e.duration / 1000)}S`, { color: UI.silver, ox: 0.5, depth: 8 });
      this.items.push(g, t, s);
    });
  }
}

// ── Message log (3 lines at 16px) ──────────────────────────────────────────────────────────────────────

const LOG_TTL_MS = 10_000;
export const LOG_W = 560;
export const LOG_ROWS = 3;
const LOG_COLS = Math.floor((LOG_W - 16) / GLYPH_W);

export class MessageLogView {
  private lines: Phaser.GameObjects.BitmapText[] = [];
  private g: Phaser.GameObjects.Graphics;
  private sig = "";
  private static readonly TONES = [UI.white, UI.silver, UI.grey] as const;

  constructor(scene: Phaser.Scene, private x: number, private y: number) {
    this.g = scene.add.graphics().setDepth(4);
    for (let i = 0; i < LOG_ROWS; i++) this.lines.push(label(scene, x + 8, y + 5 + i * LINE, "", { depth: 8 }));
  }

  update(now: number): void {
    const recent = hudLog.recent(LOG_ROWS, now, LOG_TTL_MS);
    const sig = recent.map((l) => `${l.at}:${l.text}`).join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    this.g.clear();
    if (recent.length === 0) { this.lines.forEach((t) => setLabel(t, "")); return; }
    // Dark backing box so the text reads over the dungeon.
    drawBox(this.g, this.x, this.y, LOG_W, LOG_ROWS * LINE + 8, UI.black, UI.dusk, null);
    const rows = layoutLog(recent.map((l) => l.text), LOG_COLS, LOG_ROWS);
    // newest at the bottom; older lines are dimmer
    const pad = LOG_ROWS - rows.length;
    this.lines.forEach((t, i) => {
      const r = rows[i - pad];
      if (!r) { setLabel(t, ""); return; }
      setLabel(t, r.text, MessageLogView.TONES[Math.min(2, r.age)]);
    });
  }
}

export { hex };
