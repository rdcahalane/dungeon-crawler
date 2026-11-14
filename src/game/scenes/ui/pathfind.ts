/**
 * Tile-grid pathfinding for click-to-move. Phaser-free.
 * A* with 8-way movement and no corner cutting, capped on expanded nodes so a click on an unreachable
 * spot cannot stall a frame.
 */
export interface Pt { tx: number; ty: number }
export type WalkFn = (tx: number, ty: number) => boolean;

export interface PathOptions {
  /** Most nodes expanded before giving up. Default 600. */
  maxNodes?: number;
  /** Allow diagonal steps (never cutting a corner). Default true. */
  diagonal?: boolean;
}

export const DEFAULT_MAX_NODES = 600;

interface Node { tx: number; ty: number; g: number; f: number; parent: Node | null }

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

/** Tiny binary min-heap on `f`. */
class Heap {
  private a: Node[] = [];
  get size(): number { return this.a.length; }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Path from `start` to `goal` as tiles, excluding the start and including the goal.
 * `[]` when already there; `null` when the goal is blocked, enclosed, or beyond the node cap.
 */
export function findPath(start: Pt, goal: Pt, walkable: WalkFn, opts: PathOptions = {}): Pt[] | null {
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const diagonal = opts.diagonal ?? true;
  if (start.tx === goal.tx && start.ty === goal.ty) return [];
  if (!walkable(goal.tx, goal.ty)) return null;

  const key = (x: number, y: number): string => `${x},${y}`;
  const best = new Map<string, number>();
  const closed = new Set<string>();
  const open = new Heap();
  const s: Node = { tx: start.tx, ty: start.ty, g: 0, f: heuristic(start.tx, start.ty, goal.tx, goal.ty), parent: null };
  open.push(s);
  best.set(key(s.tx, s.ty), 0);

  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop()!;
    const ck = key(cur.tx, cur.ty);
    if (closed.has(ck)) continue;
    if (cur.tx === goal.tx && cur.ty === goal.ty) {
      const out: Pt[] = [];
      for (let n: Node | null = cur; n && n.parent; n = n.parent) out.push({ tx: n.tx, ty: n.ty });
      return out.reverse();
    }
    closed.add(ck);
    if (++expanded > maxNodes) return null;

    for (const [dx, dy] of DIRS) {
      const diag = dx !== 0 && dy !== 0;
      if (diag && !diagonal) continue;
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      if (!walkable(nx, ny)) continue;
      if (diag && (!walkable(cur.tx + dx, cur.ty) || !walkable(cur.tx, cur.ty + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = cur.g + (diag ? 1.414 : 1);
      const prev = best.get(nk);
      if (prev !== undefined && prev <= g) continue;
      best.set(nk, g);
      open.push({ tx: nx, ty: ny, g, f: g + heuristic(nx, ny, goal.tx, goal.ty), parent: cur });
    }
  }
  return null;
}

/**
 * Is the straight pixel segment clear for a body of `radius` px? Samples every quarter tile and checks the
 * centre plus the four corners of the body.
 */
export function lineClear(
  x0: number, y0: number, x1: number, y1: number,
  tileSize: number, walkable: WalkFn, radius = 0,
): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (tileSize / 4)));
  const offs: ReadonlyArray<readonly [number, number]> = radius > 0
    ? [[0, 0], [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius]]
    : [[0, 0]];
  for (let i = 0; i <= steps; i++) {
    const px = x0 + ((x1 - x0) * i) / steps;
    const py = y0 + ((y1 - y0) * i) / steps;
    for (const [ox, oy] of offs) {
      if (!walkable(Math.floor((px + ox) / tileSize), Math.floor((py + oy) / tileSize))) return false;
    }
  }
  return true;
}

/** Nearest walkable tile to `p` within `maxRing` rings (Chebyshev), or null. Returns `p` itself if walkable. */
export function nearestWalkable(p: Pt, walkable: WalkFn, maxRing = 3): Pt | null {
  if (walkable(p.tx, p.ty)) return p;
  for (let r = 1; r <= maxRing; r++) {
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = p.tx + dx;
        const ty = p.ty + dy;
        if (!walkable(tx, ty)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    }
    if (best) return best;
  }
  return null;
}
