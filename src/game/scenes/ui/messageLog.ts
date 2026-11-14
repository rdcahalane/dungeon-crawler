/** Fixed-size message log. Phaser-free. Newest last. */
export interface LogLine { text: string; at: number }

export class MessageLog {
  private lines: LogLine[] = [];
  private readonly dedupeMs: number;

  constructor(public readonly capacity = 40, dedupeMs = 120) {
    this.dedupeMs = dedupeMs;
  }

  /**
   * Add a line. The same text arriving within `dedupeMs` of the previous line is dropped: the game reports
   * a status through two paths (scene event and bus), and both reach the HUD.
   */
  push(text: string, now = Date.now()): boolean {
    const t = text.trim();
    if (!t) return false;
    const last = this.lines[this.lines.length - 1];
    if (last && last.text === t && now - last.at < this.dedupeMs) return false;
    this.lines.push({ text: t, at: now });
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    return true;
  }

  get size(): number { return this.lines.length; }

  /** The newest `n` lines, oldest first. */
  last(n: number): LogLine[] {
    return n <= 0 ? [] : this.lines.slice(-n);
  }

  /** The newest `n` lines no older than `ttlMs`. */
  recent(n: number, now: number, ttlMs: number): LogLine[] {
    return this.last(n).filter((l) => now - l.at <= ttlMs);
  }

  clear(): void { this.lines = []; }
}

/** Process-wide log so messages survive the HUD restarting on a floor change. */
export const hudLog = new MessageLog();
