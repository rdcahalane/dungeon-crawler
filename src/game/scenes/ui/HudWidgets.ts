/** Small HUD pieces: HP orb, identity panel, floor panel, torch gauge, target bar, effect icons, log view. */
import * as Phaser from "phaser";
import { STATUS_EFFECT_DEFS } from "../../constants";
import type { StatusEffect } from "../../constants";
import { hudLog } from "./messageLog";
import { SCREEN_H, SCREEN_W, UI, drawBox, hex, iconAt, label, setLabel, wrap } from "./theme";
import { uiState, type HoverInfo } from "./uiState";

// ── HP orb ─────────────────────────────────────────────────────────────────────────────────────────────

const ORB = { cx: 52, cy: SCREEN_H - 48, r: 38, row: 4 };

export class HpOrb {
  private g: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.BitmapText;
  private sig = "";

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
    this.text = label(scene, ORB.cx, ORB.cy - 4, "", { color: UI.white, ox: 0.5, depth: 8 });
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
    g.fillStyle(UI.cream, 1).fillRect(cx - 20, cy - 26, 8, 4).fillRect(cx - 24, cy - 22, 4, 4); // glint
    setLabel(this.text, `${Math.ceil(hp)}/${maxHp}`);
  }
}

// ── Identity (top-left) ────────────────────────────────────────────────────────────────────────────────

export interface IdentityData {
  name?: string; classKey: string; level: number; title?: string;
  xp: number; xpToNext: number; thac0?: number; ac?: number;
}

export class IdentityPanel {
  private name: Phaser.GameObjects.BitmapText;
  private sub: Phaser.GameObjects.BitmapText;
  private stats: Phaser.GameObjects.BitmapText;
  private xp: Phaser.GameObjects.Graphics;
  private xpSig = "";

  constructor(scene: Phaser.Scene) {
    const g = scene.add.graphics().setDepth(1);
    drawBox(g, 8, 8, 236, 76, UI.ink, UI.slate, UI.dusk);
    this.name = label(scene, 16, 14, "", { size: 16, color: UI.white, depth: 3 });
    this.sub = label(scene, 16, 34, "", { color: UI.gold, depth: 3 });
    this.xp = scene.add.graphics().setDepth(3);
    this.stats = label(scene, 16, 62, "", { color: UI.silver, depth: 3 });
    label(scene, 16, 48, "XP", { color: UI.grey, depth: 3 });
    uiState.setRect("identity", { x: 8, y: 8, w: 236, h: 76 });
  }

  update(d: IdentityData): void {
    setLabel(this.name, (d.name ?? d.classKey).toUpperCase().slice(0, 16));
    setLabel(this.sub, `LEVEL ${d.level} ${(d.title ?? d.classKey).toUpperCase()}`.slice(0, 36));
    const pct = d.xpToNext > 0 ? Math.max(0, Math.min(1, d.xp / d.xpToNext)) : 0;
    const sig = `${Math.round(pct * 100)}`;
    if (sig !== this.xpSig) {
      this.xpSig = sig;
      this.xp.clear().fillStyle(UI.black, 1).fillRect(36, 48, 200, 8).fillStyle(UI.violet, 1).fillRect(37, 49, Math.round(198 * pct), 6);
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

export class FloorPanel {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.BitmapText;
  private lines: Phaser.GameObjects.BitmapText[] = [];
  private sig = "";

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(1);
    this.title = label(scene, SCREEN_W - 16, 14, "", { size: 16, color: UI.gold, ox: 1, depth: 3 });
    for (let i = 0; i < 5; i++) this.lines.push(label(scene, SCREEN_W - 16, 36 + i * 10, "", { color: UI.silver, ox: 1, depth: 3 }));
  }

  update(d: FloorData): void {
    const obj = d.floor !== 0 ? d.objective : undefined;
    const sig = JSON.stringify([d.floor, obj, d.kills, d.activeQuests]);
    if (sig === this.sig) return;
    this.sig = sig;
    setLabel(this.title, d.floor === 0 ? "THE TAVERN" : `FLOOR ${d.floor}`);
    const rows: Array<[string, number]> = [];
    if (obj) {
      rows.push([`${obj.title}  ${obj.complete ? "DONE" : `${obj.progress}/${obj.target}`}`, obj.complete ? UI.lime : UI.cream]);
      for (const l of wrap(obj.detail, 40).slice(0, 2)) rows.push([l, UI.silver]);
    }
    rows.push([d.floor === 0 ? "I INVENTORY  B BOOK" : `KILLS ${d.kills}   I B M`, UI.grey]);
    if (d.activeQuests > 0) rows.push([`QUESTS ${d.activeQuests}`, UI.green]);
    this.lines.forEach((t, i) => (rows[i] ? setLabel(t, rows[i][0], rows[i][1]) : setLabel(t, "")));
    const h = 36 + rows.length * 10 + 4 - 8;
    const w = 260;
    this.g.clear();
    drawBox(this.g, SCREEN_W - 8 - w, 8, w, h, UI.ink, UI.slate, UI.dusk);
    uiState.setRect("floor", { x: SCREEN_W - 8 - w, y: 8, w, h });
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
    this.gold = label(scene, SCREEN_W - 12, SCREEN_H - 46, "", { color: UI.gold, ox: 1, depth: 8 });
    this.time = label(scene, SCREEN_W - 12, SCREEN_H - 12, "", { color: UI.silver, ox: 1, depth: 8 });
    this.icon = iconAt(scene, "item_torch", SCREEN_W - 190, SCREEN_H - 20, 24).setDepth(8);
    uiState.setRect("torch", { x: SCREEN_W - 214, y: SCREEN_H - 52, w: 214, h: 52 });
  }

  update(torchSeconds: number | undefined, gold: number | undefined, now: number): void {
    if (torchSeconds !== undefined && torchSeconds > this.maxSec) this.maxSec = torchSeconds;
    const low = torchSeconds !== undefined && torchSeconds < 30;
    const blink = low && Math.floor(now / 350) % 2 === 0;
    const sig = `${torchSeconds === undefined ? "-" : Math.ceil(torchSeconds)}|${gold ?? "-"}|${blink}`;
    if (sig === this.sig) return;
    this.sig = sig;
    setLabel(this.gold, gold !== undefined ? `GOLD ${gold}` : "");
    const g = this.g;
    g.clear();
    const x = SCREEN_W - 172;
    const y = SCREEN_H - 24;
    drawBox(g, x, y, 160, 12, UI.black, UI.slate, null);
    if (torchSeconds === undefined) { setLabel(this.time, ""); return; }
    const frac = Math.max(0, Math.min(1, torchSeconds / this.maxSec));
    g.fillStyle(blink ? UI.blood : low ? UI.red : UI.orange, 1).fillRect(x + 2, y + 2, Math.round(156 * frac), 8);
    const s = Math.max(0, Math.ceil(torchSeconds));
    setLabel(this.time, torchSeconds <= 0 ? "DARK" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, low ? UI.red : UI.silver);
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
    const w = 220;
    const x = (SCREEN_W - w) / 2;
    setLabel(this.name, h.name.toUpperCase());
    this.g.fillStyle(UI.ink, 1).fillRect(x, 6, w, 34);
    drawBox(this.g, x, 6, w, 34, UI.ink, UI.slate, null);
    this.g.fillStyle(UI.black, 1).fillRect(x + 8, 24, w - 16, 8);
    const frac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
    this.g.fillStyle(UI.red, 1).fillRect(x + 9, 25, Math.round((w - 18) * frac), 6);
  }
}

// ── Status effect icons ────────────────────────────────────────────────────────────────────────────────

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
      const x = this.x + i * 30;
      const g = this.scene.add.graphics().setDepth(5);
      drawBox(g, x, this.y, 26, 26, UI.ink, def.color, null);
      const t = label(this.scene, x + 13, this.y + 5, def.icon.toUpperCase(), { color: def.color, ox: 0.5, depth: 8 });
      const s = label(this.scene, x + 13, this.y + 16, `${Math.ceil(e.duration / 1000)}S`, { color: UI.grey, ox: 0.5, depth: 8 });
      this.items.push(g, t, s);
    });
  }
}

// ── Message log (3 lines) ──────────────────────────────────────────────────────────────────────────────

const LOG_TTL_MS = 10_000;

export class MessageLogView {
  private lines: Phaser.GameObjects.BitmapText[] = [];
  private g: Phaser.GameObjects.Graphics;
  private sig = "";
  private static readonly TONES = [UI.silver, UI.white, UI.cream] as const;

  constructor(scene: Phaser.Scene, private x: number, private y: number) {
    this.g = scene.add.graphics().setDepth(4);
    for (let i = 0; i < 3; i++) this.lines.push(label(scene, x + 4, y + 4 + i * 10, "", { depth: 8 }));
  }

  update(now: number): void {
    const recent = hudLog.recent(3, now, LOG_TTL_MS);
    const sig = recent.map((l) => `${l.at}:${l.text}`).join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    this.g.clear();
    if (recent.length === 0) { this.lines.forEach((t) => setLabel(t, "")); return; }
    drawBox(this.g, this.x, this.y, 300, 36, UI.ink, UI.dusk, null);
    // newest at the bottom; older lines are dimmer
    const pad = 3 - recent.length;
    this.lines.forEach((t, i) => {
      const li = i - pad;
      const l = recent[li];
      if (!l) { setLabel(t, ""); return; }
      setLabel(t, l.text.slice(0, 48), MessageLogView.TONES[li === recent.length - 1 ? 2 : li === recent.length - 2 ? 1 : 0]);
    });
  }
}

export { hex };
