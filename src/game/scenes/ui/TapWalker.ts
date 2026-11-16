/**
 * Tap-to-walk for scenes that have no `InputController` (the tavern). Phaser-free: it reads and writes a body that has
 * `x`, `y` and `moveIntent`, and asks a walkability function about tiles. The same path code the dungeon uses.
 */
import { findPath, lineClear, nearestWalkable, type Pt, type WalkFn } from "./pathfind";

export interface Walker { x: number; y: number; moveIntent: { x: number; y: number } | null }

const ARRIVE_PX = 6;
const WAYPOINT_PX = 5;
const BODY_RADIUS = 9;
const STUCK_FRAMES = 20;

export class TapWalker {
  private dest: { x: number; y: number } | null = null;
  private path: Pt[] = [];
  private stuck = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private body: Walker, private walk: WalkFn, private tile: number) {}

  get active(): boolean { return this.dest !== null; }

  /** Start walking toward a world point. False when there is nowhere near it to stand. */
  goTo(wx: number, wy: number): boolean {
    this.stop();
    const goal = nearestWalkable({ tx: Math.floor(wx / this.tile), ty: Math.floor(wy / this.tile) }, this.walk, 3);
    if (!goal) return false;
    const start = { tx: Math.floor(this.body.x / this.tile), ty: Math.floor(this.body.y / this.tile) };
    const found = findPath(start, goal, this.walk);
    if (!found) return false;
    this.path = found;
    const inGoal = Math.floor(wx / this.tile) === goal.tx && Math.floor(wy / this.tile) === goal.ty;
    this.dest = inGoal ? { x: wx, y: wy } : { x: (goal.tx + 0.5) * this.tile, y: (goal.ty + 0.5) * this.tile };
    return true;
  }

  stop(): void {
    this.dest = null;
    this.path = [];
    this.stuck = 0;
    this.body.moveIntent = null;
  }

  /** Call every frame before the body updates. */
  update(): void {
    const b = this.body;
    if (!this.dest) return;
    if (Math.hypot(this.dest.x - b.x, this.dest.y - b.y) <= ARRIVE_PX) { this.stop(); return; }
    while (this.path.length > 0) {
      const wp = this.path[0];
      if (Math.hypot((wp.tx + 0.5) * this.tile - b.x, (wp.ty + 0.5) * this.tile - b.y) > WAYPOINT_PX) break;
      this.path.shift();
    }
    const next = this.path[0];
    let tx = this.dest.x;
    let ty = this.dest.y;
    if (next && !lineClear(b.x, b.y, this.dest.x, this.dest.y, this.tile, this.walk, BODY_RADIUS)) {
      tx = (next.tx + 0.5) * this.tile;
      ty = (next.ty + 0.5) * this.tile;
    }
    const dx = tx - b.x;
    const dy = ty - b.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) { b.moveIntent = null; return; }
    b.moveIntent = { x: dx / len, y: dy / len };
    if (Math.hypot(b.x - this.lastX, b.y - this.lastY) < 0.15) {
      if (++this.stuck > STUCK_FRAMES) this.stop();
    } else this.stuck = 0;
    this.lastX = b.x;
    this.lastY = b.y;
  }
}
