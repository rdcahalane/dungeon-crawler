import * as Phaser from "phaser";
import { TILE_SIZE } from "../../constants";
import { mathRng } from "../../rules";
import type { Enemy } from "../../entities/Enemy";
import {
  createMechState, deserialize, footprint, serialize as serializeMech, tileOverrides, tileKey,
} from "../../world/mechanisms";
import type { MechEvent, MechState, MechanismSpec } from "../../world/types";
import type { GameEventScope } from "../../GameEvents";
import type { GameContext } from "../../GameContext";
import { resolveInteract } from "./interactArbiter";
import { MechDialog } from "./MechDialog";
import { MechDriver } from "./MechDriver";
import { MechHost } from "./MechHost";
import { MechRender } from "./MechRender";
import {
  areaAt, listenEvent, pickInteractTarget, planInteract, probePlan, promptFor, searchEvent, spikeEvent, vaultAreas,
  type AreaDef,
} from "./MechVerbs";

const MONSTER_CHECK_MS = 150;

interface TimedAction {
  label: string;
  ms: number;
  t: number;
  onDone: () => void;
  bg: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

const INSCRIPTION_TITLE: Record<string, string> = {
  inscription: "Carved words",
  stain: "A stain on the stone",
  scorch: "A scorch mark",
  bones: "Bones, arranged",
};

/**
 * Drives the tomb engine in play: draws and blocks what the state says, feeds it what the player, monsters and
 * dropped items do, and runs the verbs (G search, P probe, L listen, E interact). The engine itself lives in
 * `world/mechanisms.ts`; effect resolution in `MechEffects`, event planning in `MechVerbs`.
 */
export class MechanismController {
  private state?: MechState;
  private driver?: MechDriver;
  private render?: MechRender;
  private host?: MechHost;
  private dialog?: MechDialog;
  private scope?: GameEventScope;

  private lastTile: { tx: number; ty: number } | null = null;
  private monsterTiles = new Map<Enemy, string>();
  private monsterTimer = 0;
  private dirty = false;
  private pressed = new Set<string>();
  private onKeyDown?: (e: KeyboardEvent) => void;
  private timed?: TimedAction;
  private areas: AreaDef[] = [];
  private shownAreas = new Set<string>();
  private lastAreaId: string | null = null;
  private readIds = new Set<string>();
  private prompt?: Phaser.GameObjects.Text;
  private promptFor?: string;
  private banner?: Phaser.GameObjects.Container;

  constructor(protected ctx: GameContext) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create(): void {
    const ctx = this.ctx;
    const specs = ctx.dungeon.mechanisms;
    if (!specs || specs.length === 0) return;

    let state: MechState;
    const saved = ctx.persist.mechStateJson;
    try {
      state = saved ? deserialize(saved, specs) : createMechState(specs);
    } catch {
      state = createMechState(specs); // a save from an older layout: start the floor's mechanisms fresh
    }
    this.state = state;

    const render = new MechRender(ctx);
    this.render = render;
    this.host = new MechHost(ctx, render, (tx, ty) => { this.lastTile = { tx, ty }; });
    this.driver = new MechDriver(state, this.host, mathRng);
    this.dialog = new MechDialog(ctx);

    for (const o of tileOverrides(state)) render.paintTile(o.tx, o.ty, o.tile);
    render.sync(state);

    this.areas = vaultAreas(ctx.dungeon);

    this.scope = ctx.bus.scope()
      .on("item_dropped", (e) => this.emit({ type: "step", tx: e.tx, ty: e.ty, weight: "item" }))
      .on("item_picked", (e) => this.emit({ type: "leave", tx: e.tx, ty: e.ty }))
      // Find Traps: a sure search of every tile in the radius.
      .on("detect_traps", (e) => {
        const p = ctx.player;
        if (!p) return;
        const ptx = Math.floor(p.x / TILE_SIZE);
        const pty = Math.floor(p.y / TILE_SIZE);
        for (let dy = -e.radiusTiles; dy <= e.radiusTiles; dy += 2) {
          for (let dx = -e.radiusTiles; dx <= e.radiusTiles; dx += 2) {
            this.emit({ type: "search", tx: ptx + dx, ty: pty + dy, roll: 1, chance: 200 });
          }
        }
      })
      // Knock: the lock on that tile gives way.
      .on("knock", (e) => {
        for (const m of ctx.dungeon.mechanisms ?? []) {
          if (m.kind === "locked_door" && Math.abs(m.tx - e.tx) <= 1 && Math.abs(m.ty - e.ty) <= 1) {
            this.emit({ type: "interact", id: m.id, verb: "open", roll: 1, chance: 200 });
          }
        }
      });

    this.onKeyDown = (e: KeyboardEvent) => {
      // Raw key presses (not Phaser Key state): no stuck keys after a dialog, no fight with other lanes over JustDown.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (ctx.modalOpen || this.timed || e === this.dialog?.lastHandled) return;
      if (e.code === "KeyE" || e.code === "KeyP" || e.code === "KeyL") this.pressed.add(e.code);
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  destroy(): void {
    if (this.onKeyDown) window.removeEventListener("keydown", this.onKeyDown);
    this.onKeyDown = undefined;
    this.scope?.dispose();
    this.dialog?.destroy();
    this.cancelTimed();
    this.render?.destroy();
    this.host?.destroy();
    this.prompt?.destroy();
    this.banner?.destroy();
    this.prompt = undefined;
    this.banner = undefined;
    this.monsterTiles.clear();
    this.pressed.clear();
    this.ctx.modalOpen = false;
  }

  // ── Public surface ───────────────────────────────────────────────────────

  isBlocked(tx: number, ty: number): boolean {
    return this.render?.isBlocked(tx, ty) ?? false;
  }

  /** Pixels to the nearest mechanism E would work from here, or `Infinity` when there is none (chest arbitration). */
  nearestInteractDistance(): number {
    const state = this.state;
    const p = this.ctx.player;
    if (!state || !p || this.busy) return Infinity;
    const target = pickInteractTarget(state, p.x / TILE_SIZE, p.y / TILE_SIZE, p.stats.facing);
    if (!target) return Infinity;
    let best = Infinity;
    for (const q of footprint(target)) {
      best = Math.min(best, Math.hypot((q.tx + 0.5) * TILE_SIZE - p.x, (q.ty + 0.5) * TILE_SIZE - p.y));
    }
    return best;
  }

  serialize(): string | undefined {
    return this.state ? serializeMech(this.state) : undefined;
  }

  /** True while a modal is open or a timed action (search) is running: the player cannot act. */
  get busy(): boolean {
    return !!this.timed || !!this.dialog?.isOpen;
  }

  /**
   * Start a timed action: the player stands still with a progress bar over their head, then `onDone` runs.
   * Returns false if the player is busy already or dead. Works on floors without mechanisms (legacy search uses it).
   */
  beginTimed(label: string, ms: number, onDone: () => void): boolean {
    const ctx = this.ctx;
    const p = ctx.player;
    if (this.busy || !p || p.stats.hp <= 0) return false;
    const scene = ctx.scene;
    const bg = scene.add.rectangle(p.x, p.y - 34, 36, 6, 0x000000, 0.75).setDepth(52);
    const fill = scene.add.rectangle(p.x - 17, p.y - 34, 0, 4, 0xffd166).setOrigin(0, 0.5).setDepth(53);
    const text = scene.add.text(p.x, p.y - 46, label, {
      fontFamily: "monospace", fontSize: "10px", color: "#ffd166", stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(53);
    this.timed = { label, ms, t: 0, onDone, bg, fill, text };
    this.pressed.clear();
    return true;
  }

  /** The `search` event for the tile the player stands on (called when a timed search finishes). */
  searchHere(): void {
    if (!this.state) return;
    const p = this.ctx.player;
    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    const effects = this.emit(searchEvent(p, tx, ty, mathRng));
    if (effects.length === 0) this.ctx.floatText(p.x, p.y - 30, "...", 0x9aa5b1, 11);
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  update(delta: number, playerTx: number, playerTy: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!player || player.stats.hp <= 0) {
      this.cancelTimed();
      return;
    }

    if (this.timed || this.dialog?.isOpen) this.freezePlayer();
    if (this.timed) this.tickTimed(delta);

    const driver = this.driver;
    const state = this.state;
    if (!driver || !state || driver.done) return;

    this.host?.tickGround();
    this.trackPlayer(playerTx, playerTy);
    this.trackMonsters(delta);
    this.emit({ type: "tick", dtMs: delta });

    if (this.busy) {
      this.pressed.clear();
    } else {
      if (this.pressed.delete("KeyP")) this.doProbe(playerTx, playerTy);
      if (this.pressed.delete("KeyL")) this.doListen(playerTx, playerTy);
      if (this.pressed.delete("KeyE")) this.doInteract(playerTx, playerTy);
      this.pressed.clear();
    }

    this.updatePrompt();
    if (this.dirty) {
      this.render?.sync(state);
      this.dirty = false;
    }
  }

  // ── Events in ────────────────────────────────────────────────────────────

  /** Send one event; remember to redraw if anything happened. */
  private emit(ev: MechEvent, quiet = false): ReturnType<MechDriver["send"]> {
    const effects = this.driver ? this.driver.send(ev, { quiet }) : [];
    if (effects.length > 0) this.dirty = true;
    return effects;
  }

  private trackPlayer(tx: number, ty: number): void {
    const last = this.lastTile;
    if (!last) {
      this.lastTile = { tx, ty };
      this.emit({ type: "step", tx, ty, weight: "player" });
      this.enterArea(this.lastTile.tx, this.lastTile.ty);
      return;
    }
    if (last.tx === tx && last.ty === ty) return;
    this.lastTile = { tx, ty };
    this.emit({ type: "leave", tx: last.tx, ty: last.ty });
    this.emit({ type: "step", tx, ty, weight: "player" });
    // A teleport effect moves `lastTile` to its landing tile; the banner follows where the player really is.
    this.enterArea(this.lastTile.tx, this.lastTile.ty);
  }

  private trackMonsters(delta: number): void {
    this.monsterTimer += delta;
    if (this.monsterTimer < MONSTER_CHECK_MS) return;
    this.monsterTimer = 0;
    const live = new Set<Enemy>();
    for (const e of this.ctx.enemies) {
      if (!e.active) continue;
      live.add(e);
      const tx = Math.floor(e.x / TILE_SIZE);
      const ty = Math.floor(e.y / TILE_SIZE);
      const k = tileKey(tx, ty);
      const prev = this.monsterTiles.get(e);
      if (prev === k) continue;
      if (prev) { const [px, py] = prev.split(",").map(Number); this.emit({ type: "leave", tx: px, ty: py }); }
      this.monsterTiles.set(e, k);
      this.emit({ type: "step", tx, ty, weight: "monster" });
    }
    for (const [e, k] of this.monsterTiles) {
      if (live.has(e)) continue;
      const [px, py] = k.split(",").map(Number);
      this.emit({ type: "leave", tx: px, ty: py });
      this.monsterTiles.delete(e);
    }
  }

  // ── Verbs ────────────────────────────────────────────────────────────────

  private doProbe(tx: number, ty: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const plan = probePlan(p, tx, ty);
    if (!plan.ok) {
      ctx.status(plan.message);
      ctx.floatText(p.x, p.y - 30, "No pole", 0x9aa5b1, 11);
      return;
    }
    this.flickPole(plan.dir);
    let any = 0;
    for (const ev of plan.events) any += this.emit(ev).length;
    if (any === 0) ctx.status(`You probe ${plan.dirName}: the pole taps stone. Nothing gives.`);
  }

  private doListen(tx: number, ty: number): void {
    const ctx = this.ctx;
    const effects = this.emit(listenEvent(ctx.player, tx, ty, mathRng));
    if (effects.length === 0) ctx.status("You hold your breath and listen. Nothing but your own heart.");
  }

  private doInteract(tx: number, ty: number): void {
    const ctx = this.ctx;
    const state = this.state;
    const p = ctx.player;
    if (!state) return;
    // A chest nearer than the mechanism takes this press (LootController asks the same question).
    if (resolveInteract(ctx.loot.nearestChestDistance(), this.nearestInteractDistance()) === "chest") return;
    const target = pickInteractTarget(state, p.x / TILE_SIZE, p.y / TILE_SIZE, p.stats.facing);
    if (!target) {
      const spikes = spikeEvent(state, tx, ty, p.inventory);
      if (spikes) this.emit(spikes);
      return;
    }
    const plan = planInteract(target, state.rt[target.id], p, mathRng);
    switch (plan.kind) {
      case "events":
        for (const ev of plan.events) this.emit(ev);
        break;
      case "message":
        ctx.status(plan.text);
        break;
      case "read":
        for (const ev of plan.events) this.emit(ev, true);
        this.readIds.add(plan.id);
        this.dialog?.open({ kind: "text", title: this.titleOf(target), body: plan.text });
        break;
      case "riddle":
        this.dialog?.open({
          kind: "riddle", title: "The door waits", prompt: plan.prompt,
          onSubmit: (text) => { this.emit({ type: "answer", id: plan.id, text }); },
        });
        break;
      case "offer":
        this.dialog?.open({
          kind: "offer", title: "What will you lay in its hands?", options: plan.options,
          onPick: (key) => { this.emit({ type: "interact", id: plan.id, verb: "offer", itemKey: key }); },
        });
        break;
    }
  }

  private titleOf(s: MechanismSpec): string {
    return INSCRIPTION_TITLE[s.params.look ?? "inscription"] ?? "Carved words";
  }

  private flickPole(dir: { x: number; y: number }): void {
    const scene = this.ctx.scene;
    const p = this.ctx.player;
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    const pole = scene.add.rectangle(p.x + ux * 22, p.y + uy * 22, 44, 4, 0x9c7a3c)
      .setRotation(Math.atan2(uy, ux)).setDepth(49.8);
    scene.tweens.add({
      targets: pole, x: p.x + ux * 42, y: p.y + uy * 42, duration: 140, yoyo: true, hold: 60,
      onComplete: () => pole.destroy(),
    });
  }

  // ── Timed actions and the frozen player ──────────────────────────────────

  private freezePlayer(): void {
    const p = this.ctx.player;
    (p.body as Phaser.Physics.Arcade.Body | null)?.setVelocity(0, 0);
    p.moveIntent = null;
    p.attackRequested = false;
  }

  private tickTimed(delta: number): void {
    const t = this.timed;
    if (!t) return;
    const p = this.ctx.player;
    t.t += delta;
    t.bg.setPosition(p.x, p.y - 34);
    t.fill.setPosition(p.x - 17, p.y - 34);
    t.fill.width = 34 * Math.min(1, t.t / t.ms);
    t.text.setPosition(p.x, p.y - 46);
    if (t.t >= t.ms) {
      this.cancelTimed();
      t.onDone();
    }
  }

  private cancelTimed(): void {
    const t = this.timed;
    if (!t) return;
    this.timed = undefined;
    t.bg.destroy();
    t.fill.destroy();
    t.text.destroy();
  }

  // ── Clues: banner and prompt ─────────────────────────────────────────────

  private enterArea(tx: number, ty: number): void {
    const area = areaAt(this.areas, tx, ty);
    const id = area?.id ?? null;
    if (id === this.lastAreaId) return;
    this.lastAreaId = id;
    if (area && !this.shownAreas.has(area.id)) {
      this.shownAreas.add(area.id);
      this.showBanner(area.name);
    }
  }

  /** Screen-fixed (zoom-proof) subtle title that fades in and out. */
  private showBanner(name: string): void {
    const scene = this.ctx.scene;
    this.banner?.destroy();
    const cam = scene.cameras.main;
    const c = scene.add.container(scene.scale.width / 2, scene.scale.height / 2)
      .setScrollFactor(0).setDepth(120).setScale(1 / cam.zoom).setAlpha(0);
    c.add(scene.add.text(0, -scene.scale.height / 2 + 64, name, {
      fontFamily: "monospace", fontSize: "20px", color: "#d9c58f", stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5));
    this.banner = c;
    scene.tweens.add({
      targets: c, alpha: 0.9, duration: 700, hold: 1800, yoyo: true,
      onComplete: () => { c.destroy(); if (this.banner === c) this.banner = undefined; },
    });
  }

  private updatePrompt(): void {
    const ctx = this.ctx;
    const state = this.state;
    const p = ctx.player;
    let label: string | null = null;
    let at: MechanismSpec | null = null;
    if (state && !this.busy) {
      at = pickInteractTarget(state, p.x / TILE_SIZE, p.y / TILE_SIZE, p.stats.facing);
      if (at) label = promptFor(at, state.rt[at.id], this.readIds.has(at.id));
    }
    if (!label || !at) {
      this.prompt?.setVisible(false);
      this.promptFor = undefined;
      return;
    }
    if (!this.prompt) {
      this.prompt = ctx.scene.add.text(0, 0, "", {
        fontFamily: "monospace", fontSize: "11px", color: "#ffe9a8", stroke: "#000", strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(48);
    }
    if (this.promptFor !== label) { this.prompt.setText(label); this.promptFor = label; }
    this.prompt.setPosition(at.tx * TILE_SIZE + TILE_SIZE / 2, at.ty * TILE_SIZE - 2).setVisible(true);
  }
}
