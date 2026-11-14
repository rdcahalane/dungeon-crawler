import * as Phaser from "phaser";
import { SPELLS } from "../constants";
import type { SpellKey, StatusEffect } from "../constants";
import type { Quest, InventoryItem } from "../systems/QuestSystem";
import type { Player } from "../entities/Player";
import type { GameContext } from "../GameContext";
import type { GameEventBus } from "../GameEvents";
import { registerRetroFont } from "../gfx/font";
import { EffectIcons, FloorPanel, HpOrb, IdentityPanel, MessageLogView, TargetBar, TorchGold } from "./ui/HudWidgets";
import { HotbarView } from "./ui/HotbarView";
import { InventoryPanel } from "./ui/InventoryPanel";
import { SpellbookPanel } from "./ui/SpellbookPanel";
import { QuestPanel } from "./ui/QuestPanel";
import { ShopPanel } from "./ui/ShopPanel";
import { InnkeeperPanel } from "./ui/InnkeeperPanel";
import type { TavernHost } from "./ui/tavernHost";
import { Minimap } from "./ui/Minimap";
import { buildHotbar, isCasterClass, legacySpellSlots, type SpellSlotInfo } from "./ui/hotbar";
import { hudLog } from "./ui/messageLog";
import { buildSheet, heldLightSeconds } from "./ui/charSheet";
import { activateBeltSlot, type PanelHost } from "./ui/panelHost";
import { UI, drawBox, label, setLabel } from "./ui/theme";
import { uiState } from "./ui/uiState";

export interface HUDData {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  xpToNext: number;
  floor: number;
  kills: number;
  /** Mana is gone from the game; old payloads still carry it and the HUD ignores it. */
  mana?: number;
  maxMana?: number;
  classKey: string;
  name?: string;
  effects: StatusEffect[];
  spellKeys?: SpellKey[];
  spellCooldowns?: number[];
  spellManaCosts?: number[];
  potions?: number;
  manaPotions?: number;
  gold?: number;
  activeQuests?: Quest[];
  completedQuests?: Quest[];
  inventory?: InventoryItem[];
  equippedWeaponLabel?: string;
  equippedArmorLabel?: string;
  floorObjective?: {
    title: string;
    detail: string;
    progress: number;
    target: number;
    complete: boolean;
  };
  /** Memorized spells in hotbar order (keys 1 to 4). */
  spellSlots?: { key: string; name: string; level: number; remaining: number; max: number }[];
  /** First-edition numbers: THAC0, and AC where lower is better. */
  thac0?: number;
  ac?: number;
  saves?: Record<'death' | 'petrify' | 'wands' | 'breath' | 'spells', number>;
  /** Seconds of light left in the held torch. */
  torchSeconds?: number;
  /** Level title, for example "Veteran". */
  title?: string;
}

/** The two scenes that feed the HUD, read through the members we need and nothing else. */
interface GameSceneLike extends Phaser.Scene { gameContext?: GameContext; gameEvents?: GameEventBus }
interface TavernSceneLike extends Phaser.Scene { player?: Player }

type Panel = "inventory" | "spellbook" | "quest" | "shop" | "inn";

export class HUDScene extends Phaser.Scene {
  /** True while a HUD panel is open (or just closed): the game ignores clicks then. */
  static get uiBlocking(): boolean { return uiState.isBlocking(); }

  private orb!: HpOrb;
  private identity!: IdentityPanel;
  private floorPanel!: FloorPanel;
  private torch!: TorchGold;
  private target!: TargetBar;
  private effects!: EffectIcons;
  private logView!: MessageLogView;
  private hotbar!: HotbarView;
  private minimap!: Minimap;
  private zoomLabel!: Phaser.GameObjects.BitmapText;
  private inv?: InventoryPanel;
  private book?: SpellbookPanel;
  private quest?: QuestPanel;
  private shop?: ShopPanel;
  private innkeeper?: InnkeeperPanel;
  private last?: HUDData;
  private cleanups: Array<() => void> = [];

  constructor() {
    super({ key: "HUDScene" });
  }

  create() {
    uiState.reset();
    registerRetroFont(this);
    this.last = undefined;
    this.inv = this.book = this.quest = this.shop = this.innkeeper = undefined;

    this.orb = new HpOrb(this);
    this.identity = new IdentityPanel(this);
    this.floorPanel = new FloorPanel(this);
    this.torch = new TorchGold(this);
    this.target = new TargetBar(this);
    this.effects = new EffectIcons(this, 12, 430);
    this.logView = new MessageLogView(this, 8, 478);
    this.hotbar = new HotbarView(this, (i) => this.useBelt(i));
    this.minimap = new Minimap(this);
    this.buildButtons();

    // I, B, M, Q and Esc ride a raw window listener, not the Phaser key plugin: that is how the mechanism lane reads keys,
    // it needs no focus on the canvas and it cannot be switched off by another scene's dialog.
    window.addEventListener("keydown", this.onKeyDown);
    this.cleanups.push(() => window.removeEventListener("keydown", this.onKeyDown));

    this.attachToGameScene();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  private gameScene(): GameSceneLike | undefined {
    return this.scene.get("GameScene") as GameSceneLike | undefined;
  }

  private ctx(): GameContext | undefined {
    return this.scene.isActive("GameScene") ? this.gameScene()?.gameContext : undefined;
  }

  private player(): Player | undefined {
    const ctx = this.ctx();
    if (ctx?.player) return ctx.player;
    if (this.scene.isActive("TavernScene")) return (this.scene.get("TavernScene") as TavernSceneLike).player;
    return undefined;
  }

  private attachToGameScene() {
    const onUpdate = (d: HUDData) => this.onUpdate(d);
    const onStatus = (m: string) => hudLog.push(m);
    const onZoom = (z: number) => setLabel(this.zoomLabel, `${Math.round(z * 100)}%`);
    for (const key of ["GameScene", "TavernScene"]) {
      const scene = this.scene.get(key);
      if (!scene) continue;
      const restart = () => this.scene.restart();
      scene.events.on("hud:update", onUpdate);
      scene.events.on("hud:status", onStatus);
      scene.events.on("hud:zoom", onZoom);
      scene.events.once("shutdown", restart);
      this.cleanups.push(() => {
        scene.events.off("hud:update", onUpdate);
        scene.events.off("hud:status", onStatus);
        scene.events.off("hud:zoom", onZoom);
        scene.events.off("shutdown", restart);
      });
    }
    const bus = this.gameScene()?.gameEvents;
    if (bus) this.cleanups.push(bus.on("status", ({ text }) => hudLog.push(text)));
  }

  private teardown() {
    this.closeAll();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.inv?.destroy();
    this.book?.destroy();
    this.shop?.destroy();
    this.innkeeper?.destroy();
    this.minimap.destroy();
    this.hotbar.destroy();
    uiState.reset();
  }

  // ── Buttons (zoom, panels) ─────────────────────────────────────────────────

  private button(x: number, y: number, w: number, h: number, text: string, onClick: () => void, rectId: string) {
    const g = this.add.graphics().setDepth(5);
    drawBox(g, x, y, w, h, UI.dusk, UI.slate, UI.slate);
    label(this, x + w / 2, y + h / 2, text, { color: UI.white, ox: 0.5, oy: 0.5, depth: 8 });
    const hit = this.add.rectangle(x, y, w, h, 0x000000, 0).setOrigin(0, 0).setDepth(9).setInteractive();
    hit.on("pointerover", () => { g.clear(); drawBox(g, x, y, w, h, UI.slate, UI.silver, UI.grey); });
    hit.on("pointerout", () => { g.clear(); drawBox(g, x, y, w, h, UI.dusk, UI.slate, UI.slate); });
    hit.on("pointerdown", () => { if (!uiState.panelOpen) onClick(); });
    uiState.setRect(rectId, { x, y, w, h });
  }

  private buildButtons() {
    const zoom = (delta: number) => {
      const game = this.gameScene();
      if (!game?.cameras?.main) return;
      const next = Phaser.Math.Clamp(game.cameras.main.zoom + delta, 0.4, 2.5);
      game.cameras.main.setZoom(next);
      setLabel(this.zoomLabel, `${Math.round(next * 100)}%`);
    };
    // Bottom-right cluster, 16px text: zoom row at y 530, panel buttons at y 560, gold and torch below at 584.
    this.button(776, 530, 32, 26, "-", () => zoom(-0.15), "zoom-");
    this.button(920, 530, 32, 26, "+", () => zoom(0.15), "zoom+");
    this.zoomLabel = label(this, 864, 543, "100%", { color: UI.grey, ox: 0.5, oy: 0.5, depth: 8 });
    this.button(776, 560, 56, 24, "INV", () => this.toggle("inventory"), "btn-inv");
    this.button(836, 560, 56, 24, "BOOK", () => this.toggle("spellbook"), "btn-book");
    this.button(896, 560, 56, 24, "MAP", () => this.toggleMap(), "btn-map");
  }

  // ── Panels ─────────────────────────────────────────────────────────────────

  private host(): PanelHost | undefined {
    const player = this.player();
    if (!player) return undefined;
    return { player, ctx: this.ctx(), hud: () => this.last, say: (m) => hudLog.push(m) };
  }

  private toggle(panel: Panel) {
    if (this.ctx()?.modalOpen) return;
    if (this.isOpen(panel)) { this.close(panel); return; }
    this.closeAll();
    const host = this.host();
    if (!host && panel !== "quest") { hudLog.push("Nothing to open here."); return; }
    if (panel === "quest") {
      this.quest = new QuestPanel(this, this.last?.activeQuests ?? [], this.last?.completedQuests ?? [], () => this.close("quest"));
      this.quest.open();
    } else if (!host) {
      return;
    } else if (panel === "inventory") {
      this.inv?.destroy();
      this.inv = new InventoryPanel(this, host, () => this.close("inventory"));
      this.inv.open();
    } else if (panel === "spellbook") {
      if (!host.player.spellbook) { hudLog.push("Only casters keep a spellbook."); return; }
      this.book?.destroy();
      this.book = new SpellbookPanel(this, host, () => this.close("spellbook"));
      this.book.open();
    }
    uiState.setPanel(true, panel !== "quest");
    this.gameScene()?.gameEvents?.emit("ui_open", { panel });
  }

  private isOpen(panel: Panel): boolean {
    switch (panel) {
      case "inventory": return !!this.inv?.opened;
      case "spellbook": return !!this.book?.opened;
      case "shop": return !!this.shop?.opened;
      case "inn": return !!this.innkeeper?.opened;
      default: return !!this.quest;
    }
  }

  private close(panel: Panel) {
    if (!this.isOpen(panel)) return;
    if (panel === "inventory") this.inv?.close();
    else if (panel === "spellbook") this.book?.close();
    else if (panel === "shop") this.shop?.close();
    else if (panel === "inn") this.innkeeper?.close();
    else { this.quest?.destroy(); this.quest = undefined; }
    uiState.setPanel(false);
    this.gameScene()?.gameEvents?.emit("ui_close", { panel });
  }

  private closeAll() {
    for (const p of ["inventory", "spellbook", "quest", "shop", "inn"] as Panel[]) this.close(p);
  }

  /** The tavern asks for its innkeeper dialog or the shop (`TavernScene` calls this). */
  openTavernPanel(kind: "inn" | "shop", host: TavernHost): void {
    this.closeAll();
    if (kind === "shop") {
      this.shop?.destroy();
      this.shop = new ShopPanel(this, host, () => this.close("shop"));
      this.shop.open();
    } else {
      this.innkeeper?.destroy();
      this.innkeeper = new InnkeeperPanel(
        this, host,
        () => this.openTavernPanel("shop", host),
        () => this.toggle("spellbook"),
        () => this.close("inn"),
      );
      this.innkeeper.open();
    }
    uiState.setPanel(true, true);
  }

  private toggleMap() {
    if (!this.ctx()) { hudLog.push("There is no map of the tavern."); return; }
    this.minimap.toggle();
  }

  private useBelt(index: number) {
    const host = this.host();
    if (host) activateBeltSlot(host, index);
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  private onUpdate(d: HUDData) {
    this.last = d;
    const now = this.time.now;
    // Until the payload carries THAC0, AC and the torch, work them out from the player.
    const p = this.player();
    const sheet = p?.inventory ? buildSheet(p.stats, p.inventory, d) : undefined;
    this.identity.update({
      name: d.name, classKey: d.classKey, level: d.level, title: d.title ?? sheet?.title,
      xp: d.xp, xpToNext: d.xpToNext, thac0: d.thac0 ?? sheet?.thac0, ac: d.ac ?? sheet?.ac,
    });
    this.floorPanel.update({
      floor: d.floor, objective: d.floorObjective, kills: d.kills, activeQuests: d.activeQuests?.length ?? 0,
    });
    this.torch.update(d.torchSeconds ?? (p?.inventory ? heldLightSeconds(p.inventory) : undefined), d.gold, now);
    this.effects.update(d.effects);
    this.orb.update(d.hp, d.maxHp, now);

    let slots: SpellSlotInfo[] | undefined = d.spellSlots;
    if (!slots && isCasterClass(d.classKey)) {
      slots = legacySpellSlots(d.spellKeys, (k) => SPELLS[k as SpellKey]?.name ?? k, d.spellCooldowns);
    }
    this.hotbar.update(buildHotbar(slots, d.classKey), p?.inventory?.belt);
  }

  update() {
    const now = this.time.now;
    this.logView.update(Date.now());
    this.target.update(uiState.hover);
    this.minimap.update(this.ctx(), now);
    if (this.last) this.orb.update(this.last.hp, this.last.maxHp, now);

  }

  /**
   * I inventory, B spellbook, M map, Q quest log (tavern only), Esc closes panels. Stands down while a puzzle dialog or a
   * tavern dialog owns the keyboard, and while a text field has focus.
   */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.code === "Escape") { this.closeAll(); return; }
    if (this.ctx()?.modalOpen === true || uiState.externalModal) return;
    switch (e.code) {
      case "KeyI": this.toggle("inventory"); break;
      case "KeyB": if (!this.inv?.opened) this.toggle("spellbook"); break;
      case "KeyM": if (!uiState.panelOpen) this.toggleMap(); break;
      // Q: quest log, tavern only (it is free in the dungeon, but kept as it was)
      case "KeyQ": if (!this.scene.isActive("GameScene")) this.toggle("quest"); break;
      default: break;
    }
  };
}
