/**
 * The narrator: brief "boxed text" read aloud as the character arrives on a floor, enters a vault or tomb chamber,
 * walks into a room worth remarking on, or draws the Hollow King's notice. The text lives in `world/roomText.ts`;
 * the voice is `audio/Narrator.ts`; the rules and the queue are in `narrationRules.ts`.
 *
 * The box is a parchment panel at top centre below the HUD. It never pauses the game and never takes the keyboard.
 * Keys (raw window listener, like the HUD's): V voice on/off, Z read the last narration again. Both stand down while
 * a text prompt or an in-scene modal or a HUD panel is open.
 */
import type * as Phaser from "phaser";
import type { GameContext } from "../../GameContext";
import type { GameEventScope } from "../../GameEvents";
import { TILE_SIZE, TOMB_FLOOR, getFloorThemeIdx } from "../../constants";
import { isTextEntryActive } from "../../textEntry";
import { narrator as sharedNarrator, type Narrator } from "../../audio/Narrator";
import { bossText, floorIntro, textForArea, textForRoom, type RoomText, type ThemeIdx } from "../../world/roomText";
import { areaAt, vaultAreas, type AreaDef } from "./MechVerbs";
import { uiState } from "../ui/uiState";
import {
  NarrationQueue, roomKind, shouldNarrateRoom, silentHoldMs, voiceCapMs,
  type NarrationItem, type NarrationKind,
} from "./narrationRules";

const DEPTH = 150;
// The card sits in the dark right margin (the view is centred on the player, whose light reaches about five tiles),
// below the objective panel and above the map buttons, so it never covers the play area. Owner's call, 2026-11-14.
const BOX_W = 288;
const PAD = 12;
const RIGHT = 12;
const TOP = 142;
const MONO = "monospace";
const INK = "#2b1d0e";
const FADE_IN_MS = 350;
const FADE_OUT_MS = 700;
const LINGER_MS = 1000;
const INTRO_DELAY_MS = 700;
const NEAR_TILES = 6;
const BOSS_TILES = 8;
const SCAN_MS = 250;

const HEADING: Record<NarrationKind, string> = {
  room: "",
  floor: "-- THE DESCENT --",
  area: "-- A PLACE OF NOTE --",
  tomb: "-- THE TOMB --",
  boss: "-- THE HOLLOW KING --",
};
const HEADING_COLOR: Record<NarrationKind, string> = {
  room: "#6b4f1d", floor: "#7a5a10", area: "#7a5a10", tomb: "#7a5a10", boss: "#8a1c10",
};

interface Shown {
  item: NarrationItem;
  box: Phaser.GameObjects.Container;
  age: number;
  spoke: boolean;
  /** Time the voice finished (or -1 while it is still going). */
  doneAt: number;
  holdMs: number;
}

export class NarratorController {
  private queue = new NarrationQueue();
  private shown?: Shown;
  private last?: NarrationItem;
  private areas: AreaDef[] = [];
  private lastAreaId: string | null = null;
  private lastRoomIdx = -2;
  private considered = new Set<number>();
  private narratedAnyRoom = false;
  private introLeft = -1;
  private scanLeft = 0;
  private scope?: GameEventScope;
  private onKey?: (e: KeyboardEvent) => void;
  private clock = 0;

  constructor(private ctx: GameContext, private readonly voice: Narrator = sharedNarrator) {}

  /** Called at the end of `GameScene.create()`, once the player and enemies exist. */
  create(): void {
    const ctx = this.ctx;
    this.areas = vaultAreas(ctx.dungeon);
    const p = this.playerTile();
    // The room the character arrives in is covered by the floor intro.
    const startIdx = this.roomIndexAt(p.tx, p.ty);
    if (startIdx >= 0) this.considered.add(startIdx);
    this.lastRoomIdx = startIdx;
    const startArea = areaAt(this.areas, p.tx, p.ty);
    this.lastAreaId = startArea?.id ?? null;
    // Returning to a floor already visited this run: no second welcome.
    const visited = !!ctx.player.stats.savedDungeons?.[ctx.currentFloor];
    this.introLeft = visited ? -1 : INTRO_DELAY_MS;

    this.scope = ctx.bus.scope()
      .on("monster_reaction", (e) => { if (e?.enemyKey === "HOLLOW_KING") this.pushBoss(); })
      .on("player_death", () => { this.voice.stop(); this.clearBox(); });

    this.onKey = (e) => this.handleKey(e);
    window.addEventListener("keydown", this.onKey);
  }

  destroy(): void {
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
    this.onKey = undefined;
    this.scope?.dispose();
    this.scope = undefined;
    this.voice.stop();
    this.clearBox();
    this.queue.clear();
  }

  // ── Per frame ──────────────────────────────────────────────────────────────

  update(delta: number): void {
    const ctx = this.ctx;
    if (!ctx.player) return;
    this.clock += delta;

    if (this.introLeft >= 0) {
      this.introLeft -= delta;
      if (this.introLeft < 0) this.pushRoomText("floor", "floor", floorIntro(ctx.currentFloor));
    }

    const p = this.playerTile();
    this.checkArea(p.tx, p.ty);
    this.checkRoom(p.tx, p.ty);
    this.scanLeft -= delta;
    if (this.scanLeft <= 0) {
      this.scanLeft = SCAN_MS;
      if (this.kingNear()) this.pushBoss();
    }

    this.tickBox(delta);
    if (!this.shown && !ctx.modalOpen) {
      const item = this.queue.take({
        roomIdx: this.roomIndexAt(p.tx, p.ty) >= 0 ? this.roomIndexAt(p.tx, p.ty) : null,
        monsterNear: this.monsterNear(),
        now: this.clock,
      });
      if (item) this.show(item);
    }
  }

  /** Read the last narration again, box and voice (Z). */
  replay(): void {
    if (!this.last) return;
    this.clearBox();
    this.show(this.last);
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  private checkArea(tx: number, ty: number): void {
    const area = areaAt(this.areas, tx, ty);
    const id = area?.id ?? null;
    if (id === this.lastAreaId) return;
    this.lastAreaId = id;
    if (!area) return;
    const text: RoomText = textForArea(area.id) ?? { read: area.name };
    const kind: NarrationKind = /^chamber_/.test(area.id) || this.ctx.currentFloor >= TOMB_FLOOR ? "tomb" : "area";
    this.pushRoomText(`area:${area.id}`, kind, text);
  }

  private checkRoom(tx: number, ty: number): void {
    const ctx = this.ctx;
    if (ctx.currentFloor >= TOMB_FLOOR) return; // the tomb is authored chamber by chamber
    const idx = this.roomIndexAt(tx, ty);
    if (idx === this.lastRoomIdx) return;
    this.lastRoomIdx = idx;
    if (idx < 0 || this.considered.has(idx)) return;
    this.considered.add(idx);
    if (areaAt(this.areas, tx, ty)) return; // a vault speaks for itself
    const room = ctx.dungeon.rooms[idx];
    const kind = roomKind(room, ctx.dungeon.stairsPos, ctx.dungeon.stairsUpPos);
    const seed = ctx.currentFloor * 1000 + idx;
    if (!shouldNarrateRoom(kind, seed, !this.narratedAnyRoom)) return;
    const text = textForRoom(getFloorThemeIdx(ctx.currentFloor) as ThemeIdx, kind, seed);
    if (this.pushRoomText(`room:${idx}`, "room", text, idx)) this.narratedAnyRoom = true;
  }

  private pushBoss(): void {
    this.pushRoomText("boss", "boss", bossText());
  }

  private pushRoomText(key: string, kind: NarrationKind, text: RoomText | undefined, roomIdx?: number): boolean {
    if (!text || !text.read) return false;
    return this.queue.push({ key, kind, title: text.title, text: text.read, roomIdx, queuedAt: this.clock });
  }

  // ── World queries ──────────────────────────────────────────────────────────

  private playerTile(): { tx: number; ty: number } {
    const p = this.ctx.player;
    return { tx: Math.floor(p.x / TILE_SIZE), ty: Math.floor(p.y / TILE_SIZE) };
  }

  private roomIndexAt(tx: number, ty: number): number {
    return this.ctx.dungeon.rooms.findIndex((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
  }

  private monsterNear(): boolean {
    const p = this.ctx.player;
    const lim = NEAR_TILES * TILE_SIZE;
    return this.ctx.enemies.some((e) => e.active !== false && Math.hypot(e.x - p.x, e.y - p.y) <= lim);
  }

  private kingNear(): boolean {
    const p = this.ctx.player;
    const lim = BOSS_TILES * TILE_SIZE;
    return this.ctx.enemies.some((e) => e.typeKey === "HOLLOW_KING" && e.active !== false && Math.hypot(e.x - p.x, e.y - p.y) <= lim);
  }

  // ── The box ────────────────────────────────────────────────────────────────

  private show(item: NarrationItem): void {
    this.last = item;
    const spoken = item.title ? `${item.title}. ${item.text}` : item.text;
    const spoke = this.voice.speak(spoken);
    this.shown = {
      item, box: this.build(item), age: 0, spoke, doneAt: -1,
      holdMs: spoke ? voiceCapMs(spoken) : silentHoldMs(item.text),
    };
  }

  private tickBox(delta: number): void {
    const s = this.shown;
    if (!s) return;
    s.age += delta;
    if (s.spoke && s.doneAt < 0 && !this.voice.isSpeaking()) s.doneAt = s.age;
    // The voice was switched on or off under us: hold by the other rule from here.
    const hold = s.doneAt >= 0 ? s.doneAt + LINGER_MS : s.holdMs;
    const outAt = FADE_IN_MS + hold;
    if (s.age >= outAt + FADE_OUT_MS) {
      this.clearBox();
      return;
    }
    const a = s.age < FADE_IN_MS ? s.age / FADE_IN_MS : s.age < outAt ? 1 : 1 - (s.age - outAt) / FADE_OUT_MS;
    s.box.setAlpha(Math.max(0, Math.min(1, a)) * 0.95);
  }

  private clearBox(): void {
    this.shown?.box.destroy();
    this.shown = undefined;
  }

  private build(item: NarrationItem): Phaser.GameObjects.Container {
    const scene = this.ctx.scene;
    const cam = scene.cameras.main;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const box = scene.add.container(W - RIGHT - BOX_W / 2, H / 2).setScrollFactor(0).setDepth(DEPTH).setScale(1 / cam.zoom).setAlpha(0);
    const inner = BOX_W - PAD * 2;
    const special = item.kind !== "room";
    const parts: Phaser.GameObjects.Text[] = [];
    let y = 0;
    const add = (t: Phaser.GameObjects.Text, gap: number): void => {
      t.setY(y);
      y += t.height + gap;
      parts.push(t);
    };
    if (special) {
      add(scene.add.text(0, 0, HEADING[item.kind], { fontFamily: MONO, fontSize: "11px", color: HEADING_COLOR[item.kind], fontStyle: "bold" }).setOrigin(0.5, 0), 6);
    }
    if (item.title) {
      add(scene.add.text(0, 0, item.title, { fontFamily: MONO, fontSize: "15px", color: "#5a2d0c", fontStyle: "bold", wordWrap: { width: inner }, align: "center" }).setOrigin(0.5, 0), 8);
    }
    add(scene.add.text(-inner / 2, 0, item.text, { fontFamily: MONO, fontSize: "13px", color: INK, wordWrap: { width: inner }, lineSpacing: 3 }).setOrigin(0, 0), 8);
    add(scene.add.text(0, 0, "V voice   Z again", { fontFamily: MONO, fontSize: "10px", color: "#8a6f3d" }).setOrigin(0.5, 0), 0);

    const totalH = y + PAD * 2;
    const top = -H / 2 + TOP;
    for (const t of parts) t.y += top + PAD;
    const paper = scene.add.rectangle(0, top + totalH / 2, BOX_W, totalH, 0xe6d3a3, 1)
      .setStrokeStyle(special ? 4 : 3, special ? 0xd4a017 : 0x6b4f1d);
    box.add(paper);
    box.add(parts);
    return box;
  }

  // ── Keys ───────────────────────────────────────────────────────────────────

  private handleKey(e: KeyboardEvent): void {
    if (e.code !== "KeyV" && e.code !== "KeyZ") return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextEntryActive() || this.ctx.modalOpen || uiState.isBlocking()) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "KeyV") {
      const on = !this.voice.enabled;
      this.voice.setEnabled(on);
      this.ctx.status(on ? (this.voice.isAvailable() ? "Voice on" : "Voice on (this browser has no speech voice)") : "Voice off");
    } else {
      this.replay();
    }
  }
}
