/** Explored-tile bookkeeping for the minimap. Phaser-free. */
export class ExploredTracker {
  readonly seen: Uint8Array;
  private lastTx = -999;
  private lastTy = -999;

  constructor(readonly width: number, readonly height: number, readonly radius: number) {
    this.seen = new Uint8Array(width * height);
  }

  /** Mark a disc around the tile as seen. Returns true when anything changed. */
  reveal(tx: number, ty: number): boolean {
    if (tx === this.lastTx && ty === this.lastTy) return false;
    this.lastTx = tx;
    this.lastTy = ty;
    let changed = false;
    const r = this.radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const i = y * this.width + x;
        if (!this.seen[i]) { this.seen[i] = 1; changed = true; }
      }
    }
    return changed;
  }
}
