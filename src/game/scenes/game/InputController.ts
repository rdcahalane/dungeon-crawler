import * as Phaser from "phaser";
import { MAP_WIDTH, TILE_SIZE } from "../../constants";
import type { GameContext } from "../../GameContext";
import type { Enemy } from "../../entities/Enemy";
import { findPath, lineClear, nearestWalkable, type Pt } from "../ui/pathfind";
import { activateBeltSlot } from "../ui/panelHost";
import { uiState } from "../ui/uiState";

/** Distance from the destination at which click-to-move stops. */
const ARRIVE_PX = 6;
/** Half the player's body, used to keep straight lines off wall corners. */
const BODY_RADIUS = 9;
const WAYPOINT_PX = 5;
const REPATH_MS = 400;
/** A click this close to a monster's sprite targets it. */
const ENEMY_PICK_PX = 20;
/** Frames of not moving, while steering, before we give up on the click. */
const STUCK_FRAMES = 20;

/** Present once the spell lane adds a by-index cast; until then right click does nothing. */
interface CastableSpells {
  castSlot?(index: number, worldX: number, worldY: number): void;
}

/**
 * Mouse and belt-key input. GameScene calls `create()` once per floor after the camera is set up and
 * `update(delta)` every frame BEFORE `player.update`, so the movement intent set here is read the same frame.
 *
 *  - Left click or hold on the ground: walk to the pointer (hold to keep following it).
 *  - Left click or hold on a monster: walk into melee range, face it, swing (hold to keep swinging).
 *  - Right click: cast spell slot 1 at the pointer, if the spell controller offers `castSlot`.
 *  - Keys 5 to 8: use the belt slot.
 * A movement key cancels click-to-move. Clicks on the HUD, or while a panel or puzzle dialog is open, are ignored.
 */
export class InputController {
  private dest: { x: number; y: number } | null = null;
  private target: Enemy | null = null;
  private holding = false;
  private pressed = false;
  private pressBlocked = false;
  private suppressHold = false;
  private path: Pt[] = [];
  private pathGoal = "";
  private pathAt = -1e9;
  private stuck = 0;
  private lastX = 0;
  private lastY = 0;
  private steering = false;
  private moveKeys: Phaser.Input.Keyboard.Key[] = [];
  private lockKeys: Phaser.Input.Keyboard.Key[] = [];
  private beltKeys: Phaser.Input.Keyboard.Key[] = [];
  private keysLocked = false;
  private world = new Phaser.Math.Vector2();

  private onPointerDown = (p: Phaser.Input.Pointer): void => {
    const blocked = this.isBlocked() || uiState.isOverUi(p.x, p.y);
    if (p.rightButtonDown()) {
      if (!blocked) this.castAt(p);
      return;
    }
    this.pressBlocked = blocked;
    if (!blocked && p.leftButtonDown()) this.pressed = true;
  };

  constructor(protected ctx: GameContext) {}

  create(): void {
    const scene = this.ctx.scene;
    this.ctx.player.legacyMouseAttack = false;
    scene.input.mouse?.disableContextMenu();
    const kb = scene.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      // addKey returns the Key the player already made for the same code, so locking it locks theirs.
      this.moveKeys = [K.W, K.A, K.S, K.D, K.UP, K.DOWN, K.LEFT, K.RIGHT].map((c) => kb.addKey(c, true));
      this.lockKeys = [...this.moveKeys, kb.addKey(K.SPACE, true)];
      this.beltKeys = [K.FIVE, K.SIX, K.SEVEN, K.EIGHT].map((c) => kb.addKey(c, true));
    }
    scene.input.on("pointerdown", this.onPointerDown);
  }

  update(delta: number): void {
    void delta;
    const ctx = this.ctx;
    const player = ctx.player;
    const scene = ctx.scene;
    if (!player) return;
    this.setKeyLock(uiState.captureKeys && ctx.modalOpen !== true);

    const ptr = scene.input.activePointer;
    const blocked = this.isBlocked();
    this.updateHover(ptr, blocked);
    if (blocked || player.stats.hp <= 0) {
      this.pressed = false;
      this.stop();
      return;
    }

    this.beltKeys.forEach((k, i) => {
      if (Phaser.Input.Keyboard.JustDown(k)) {
        activateBeltSlot({ player, ctx, hud: () => undefined, say: (m) => ctx.status(m) }, i);
      }
    });

    if (this.moveKeys.some((k) => k.isDown)) {
      this.suppressHold = ptr.isDown;
      this.pressed = false;
      this.stop();
      return;
    }
    if (!ptr.isDown) {
      this.suppressHold = false;
      if (!this.pressed) this.pressBlocked = false;
    }

    const held = ptr.isDown && ptr.leftButtonDown() && !this.pressBlocked && !this.suppressHold;
    const fresh = this.pressed;
    this.pressed = false;
    this.holding = held;
    if (fresh || held) {
      scene.cameras.main.getWorldPoint(ptr.x, ptr.y, this.world);
      const foe = this.enemyAt(this.world.x, this.world.y);
      if (foe) { this.target = foe; this.dest = null; }
      else { this.target = null; this.dest = { x: this.world.x, y: this.world.y }; }
    }

    if (this.target) {
      const t = this.target;
      if (!t.active || t.hp <= 0) { this.stop(); return; }
      if (this.inMelee(t)) {
        player.moveIntent = null;
        this.steering = false;
        player.attackRequested = true;
        if (!this.holding) this.target = null; // a single click swings once on arrival
        return;
      }
      this.walkTo(t.x, t.y);
    } else if (this.dest) {
      if (Math.hypot(this.dest.x - player.x, this.dest.y - player.y) <= ARRIVE_PX) { this.stop(); return; }
      this.walkTo(this.dest.x, this.dest.y);
    } else {
      this.steering = false;
    }
    this.checkStuck();
  }

  destroy(): void {
    this.ctx.scene.input.off("pointerdown", this.onPointerDown);
    this.setKeyLock(false);
    uiState.hover = null;
    if (this.ctx.player) this.ctx.player.moveIntent = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private isBlocked(): boolean {
    return uiState.isBlocking() || this.ctx.modalOpen === true;
  }

  /** Cancel any click-to-move or chase and stop walking. */
  private stop(): void {
    this.dest = null;
    this.target = null;
    this.holding = false;
    this.path = [];
    this.pathGoal = "";
    this.steering = false;
    this.stuck = 0;
    if (this.ctx.player) this.ctx.player.moveIntent = null;
  }

  /** Movement keys and Space are disabled while the inventory or spellbook has the keyboard. */
  private setKeyLock(lock: boolean): void {
    if (lock === this.keysLocked) return;
    this.keysLocked = lock;
    for (const k of this.lockKeys) {
      k.enabled = !lock;
      if (lock) k.reset();
    }
  }

  private enemyAt(wx: number, wy: number): Enemy | null {
    const fog = this.ctx.map?.fogSeen;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.ctx.enemies) {
      if (!e.active || !e.visible || e.hp <= 0) continue;
      if (fog && fog.length > 0) {
        const tx = Math.floor(e.x / TILE_SIZE);
        const ty = Math.floor(e.y / TILE_SIZE);
        if (!fog[ty * MAP_WIDTH + tx]) continue;
      }
      const d = Math.hypot(e.x - wx, e.y - wy);
      // A large body is picked anywhere on its square, not just inside a circle around its centre.
      const onBody = e.displayWidth >= 48
        ? Math.abs(e.x - wx) <= e.displayWidth / 2 && Math.abs(e.y - wy) <= e.displayHeight / 2
        : d <= Math.max(ENEMY_PICK_PX, e.displayWidth / 2);
      if (onBody && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  private updateHover(ptr: Phaser.Input.Pointer, blocked: boolean): void {
    if (blocked || uiState.isOverUi(ptr.x, ptr.y)) { uiState.hover = null; return; }
    this.ctx.scene.cameras.main.getWorldPoint(ptr.x, ptr.y, this.world);
    const e = this.enemyAt(this.world.x, this.world.y);
    if (!e) { uiState.hover = null; return; }
    const name = e.typeKey.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
    uiState.hover = { name: e.isElite ? `Elite ${name}` : name, hp: e.hp, maxHp: e.maxHp };
  }

  /** Face the monster the way the swing box will be aimed, and test whether that box reaches it. */
  private inMelee(t: Enemy): boolean {
    const p = this.ctx.player;
    const step = Math.PI / 4;
    const oct = Math.round(Math.atan2(t.y - p.y, t.x - p.x) / step);
    const prev = p.stats.facing;
    p.stats.facing = { x: Math.round(Math.cos(oct * step)), y: Math.round(Math.sin(oct * step)) };
    const hit = Phaser.Geom.Intersects.RectangleToRectangle(p.getAttackBox(), t.getBounds());
    if (!hit) p.stats.facing = prev;
    return hit;
  }

  private steer(x: number, y: number): void {
    const p = this.ctx.player;
    const dx = x - p.x;
    const dy = y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) { p.moveIntent = null; this.steering = false; return; }
    p.moveIntent = { x: dx / len, y: dy / len };
    this.steering = true;
  }

  /** Walk toward a world point: straight when clear, otherwise along a tile path. */
  private walkTo(px: number, py: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const walk = (tx: number, ty: number): boolean => ctx.isWalkable(tx, ty);
    if (lineClear(p.x, p.y, px, py, TILE_SIZE, walk, BODY_RADIUS)) {
      this.path = [];
      this.pathGoal = "";
      this.steer(px, py);
      return;
    }
    const goal = nearestWalkable({ tx: Math.floor(px / TILE_SIZE), ty: Math.floor(py / TILE_SIZE) }, walk, 3);
    if (!goal) { this.stop(); return; }
    const key = `${goal.tx},${goal.ty}`;
    const now = ctx.scene.time.now;
    if (key !== this.pathGoal || (this.target && now - this.pathAt > REPATH_MS)) {
      const start = { tx: Math.floor(p.x / TILE_SIZE), ty: Math.floor(p.y / TILE_SIZE) };
      const found = findPath(start, goal, walk);
      if (!found) { this.stop(); return; }
      this.path = found;
      this.pathGoal = key;
      this.pathAt = now;
    }
    while (this.path.length > 0) {
      const wp = this.path[0];
      if (Math.hypot(wp.tx * TILE_SIZE + TILE_SIZE / 2 - p.x, wp.ty * TILE_SIZE + TILE_SIZE / 2 - p.y) > WAYPOINT_PX) break;
      this.path.shift();
    }
    const next = this.path[0];
    if (next) this.steer(next.tx * TILE_SIZE + TILE_SIZE / 2, next.ty * TILE_SIZE + TILE_SIZE / 2);
    else this.steer(px, py);
  }

  /** Give up when we are steering but the body is not going anywhere (a wall, a crowd). */
  private checkStuck(): void {
    const p = this.ctx.player;
    if (!this.steering) { this.stuck = 0; }
    else if (Math.hypot(p.x - this.lastX, p.y - this.lastY) < 0.15) {
      if (++this.stuck > STUCK_FRAMES) this.stop();
    } else this.stuck = 0;
    this.lastX = p.x;
    this.lastY = p.y;
  }

  private castAt(p: Phaser.Input.Pointer): void {
    const spells = this.ctx.spells as unknown as CastableSpells;
    if (!spells.castSlot) return;
    this.ctx.scene.cameras.main.getWorldPoint(p.x, p.y, this.world);
    spells.castSlot(0, this.world.x, this.world.y);
  }
}
