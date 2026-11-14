/**
 * Talking to the innkeeper: the shop, a room for the night (5 gp) and the free common room.
 * Same frame and keys as the shop: Up/Down pick, Enter choose, number keys, Esc close.
 */
import * as Phaser from "phaser";
import { Sfx } from "../../audio/Sfx";
import { PanelBase } from "./PanelBase";
import type { TavernHost } from "./tavernHost";
import { ROOM_PRICE_GP, innRest, type InnKind } from "../../systems/inn";
import { LINE, UI, drawBox, label, pointIn, wrap } from "./theme";
import { mathRng } from "../../rules";
import { vaultsForFloor } from "../../world/vaults";
import { tellRumor } from "../../world/rumors";

type Choice = "shop" | "room" | "common" | "gossip" | "leave";

/** A drink and an ear. Spent gold only: no experience either way. */
export const DRINK_PRICE_GP = 2;

interface Option { id: Choice; title: string; sub: string; enabled: boolean }

const OPT_H = 46;
const OPT_Y = 150;

export class InnkeeperPanel extends PanelBase {
  private cursor = 0;
  private msg = "";
  private msgColor: number = UI.gold;
  /** The rumour just bought, wrapped. Shown in place of the greeting. */
  private rumor: string[] = [];
  private boxes: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];

  constructor(
    scene: Phaser.Scene,
    private host: TavernHost,
    private openShop: () => void,
    /** A room for the night was taken and the character casts spells: the hud may open the spellbook. */
    private afterRoom: () => void,
    onClose: () => void,
  ) {
    super(scene, 160, 70, 640, 520, "THE INNKEEPER", UI.orange, onClose);
  }

  private options(): Option[] {
    const gold = this.host.player.stats.gold;
    return [
      { id: "shop", title: "BUY AND SELL GEAR", sub: "TORCHES, POLES, POTIONS, STEEL", enabled: true },
      { id: "room", title: `ROOM FOR THE NIGHT (${ROOM_PRICE_GP} GP)`, sub: "FULL HP, DRAIN MENDED, SPELLS BACK", enabled: gold >= ROOM_PRICE_GP },
      { id: "common", title: "SLEEP IN THE COMMON ROOM (FREE)", sub: "HALF THE MISSING HP, SPELLS BACK", enabled: true },
      { id: "gossip", title: `BUY A DRINK AND LISTEN (${DRINK_PRICE_GP} GP)`, sub: "A RUMOUR ABOUT BELOW. TRUE, OR NOT", enabled: gold >= DRINK_PRICE_GP },
      { id: "leave", title: "NEVER MIND", sub: "", enabled: true },
    ];
  }

  protected onOpen(): void {
    this.cursor = 0;
    this.msg = "";
    this.rumor = [];
  }

  protected build(): void {
    const { scene } = this;
    const s = this.host.player.stats;
    const g = scene.add.graphics();
    this.dyn.add(g);
    this.boxes = [];
    const x0 = this.x + 20;
    const greeting = this.rumor.length > 0
      ? this.rumor
      : wrap("A bed is five gold. The common room is free, if you do not mind the dog.", 48);
    greeting.forEach((l, i) => {
      this.dyn.add(label(scene, x0, this.y + 38 + i * LINE, l, { color: this.rumor.length > 0 ? UI.cream : UI.silver }));
    });
    this.dyn.add(label(scene, x0, this.y + 38 + Math.max(2, greeting.length) * LINE + 6, `HP ${Math.ceil(s.hp)}/${s.maxHp}   GOLD ${s.gold}`, { color: UI.gold }));

    this.options().forEach((o, i) => {
      const y = this.y + OPT_Y + i * (OPT_H + 6);
      const picked = i === this.cursor;
      drawBox(g, x0, y, this.w - 40, OPT_H, picked ? UI.dusk : UI.ink, picked ? UI.gold : UI.slate, null);
      this.dyn.add(label(scene, x0 + 12, y + 8, `${i + 1} ${o.title}`, { color: o.enabled ? UI.white : UI.grey }));
      if (o.sub) this.dyn.add(label(scene, x0 + 36, y + 30, o.sub, { color: o.enabled ? UI.silver : UI.slate }));
      this.boxes.push({ x: x0, y, w: this.w - 40, h: OPT_H, index: i });
    });
    if (this.msg) this.dyn.add(label(scene, x0, this.y + this.h - 54, this.msg.slice(0, 50), { color: this.msgColor }));
    this.dyn.add(label(scene, x0, this.y + this.h - 26, "UP/DOWN PICK  ENTER CHOOSE  ESC CLOSE", { color: UI.grey }));
  }

  private choose(i: number): void {
    const o = this.options()[i];
    if (!o) return;
    if (!o.enabled) {
      this.msg = o.id === "gossip" ? "You cannot afford a drink." : "You cannot afford a room.";
      this.msgColor = UI.red;
      Sfx.play("ui_back");
      this.render();
      return;
    }
    switch (o.id) {
      case "shop": Sfx.play("ui_select"); this.openShop(); break;
      case "leave": this.onClose(); break;
      case "room": this.rest("room"); break;
      case "common": this.rest("common"); break;
      case "gossip": this.listen(); break;
    }
  }

  /** Buy a drink and hear one rumour about the floor the character will enter next (the deepest saved floor, else the first). */
  private listen(): void {
    const s = this.host.player.stats;
    if (s.gold < DRINK_PRICE_GP) return;
    s.gold -= DRINK_PRICE_GP;
    const saved = Object.keys(s.savedDungeons ?? {}).map(Number).filter((n) => n > 0);
    const next = saved.length > 0 ? Math.max(...saved) : 1;
    const r = tellRumor(next, vaultsForFloor(next).map((v) => v.id), mathRng);
    this.rumor = wrap(`"${r.text}"`, 50).slice(0, 4);
    this.host.say(`You buy a drink (-${DRINK_PRICE_GP} gp) and listen.`);
    this.msg = "";
    Sfx.play("ui_select");
    this.host.refresh();
    this.render();
  }

  private rest(kind: InnKind): void {
    const player = this.host.player;
    const s = player.stats;
    const hp = { hp: s.hp, maxHp: s.maxHp, drained: s.drained ?? 0 };
    const r = innRest(kind, hp, player.spellbook, s.gold);
    if (!r.ok) {
      this.msg = "You cannot afford a room.";
      this.msgColor = UI.red;
      this.render();
      return;
    }
    s.gold -= r.cost;
    s.hp = hp.hp;
    s.drained = hp.drained;
    if (kind === "room") {
      player.removeEffect("POISONED");
      player.removeEffect("HELD");
    }
    player.recomputeDerived();
    s.hp = Math.min(hp.hp, s.maxHp);
    const parts = [`+${r.healed} HP`];
    if (r.drainRestored > 0) parts.push(`${r.drainRestored} drain mended`);
    if (r.spellsRestored) parts.push("spells back");
    this.host.say(kind === "room" ? `You sleep in a bed (-${r.cost} gp): ${parts.join(", ")}.` : `You doze by the fire: ${parts.join(", ")}.`);
    Sfx.play("heal");
    this.host.refresh();
    if (kind === "room" && player.spellbook) {
      this.onClose();
      this.afterRoom();
      return;
    }
    this.msg = parts.join(", ").toUpperCase();
    this.msgColor = UI.lime;
    this.render();
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.options().length;
    switch (e.code) {
      case "ArrowUp": this.cursor = (this.cursor + n - 1) % n; this.msg = ""; this.render(); break;
      case "ArrowDown": this.cursor = (this.cursor + 1) % n; this.msg = ""; this.render(); break;
      case "Enter": case "NumpadEnter": this.choose(this.cursor); break;
      case "Digit1": case "Digit2": case "Digit3": case "Digit4": case "Digit5": this.choose(Number(e.code.slice(5)) - 1); break;
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
      if (pointIn(b, px, py)) { this.cursor = b.index; this.choose(b.index); return true; }
    }
    return false;
  }
}
