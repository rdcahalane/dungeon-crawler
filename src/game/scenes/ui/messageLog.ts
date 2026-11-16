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

export interface LogRow { text: string; age: number }

/**
 * Lay recent messages out as at most `maxRows` rows of `cols` characters, newest at the bottom. A long message wraps
 * onto more rows rather than being cut; when there are too many rows the oldest are dropped.
 * `age` is 0 for the newest message, 1 for the one before it, and so on (the view dims older ones).
 */
export function layoutLog(messages: readonly string[], cols: number, maxRows: number): LogRow[] {
  const rows: LogRow[] = [];
  messages.forEach((m, i) => {
    const age = messages.length - 1 - i;
    let line = "";
    const flush = (): void => { if (line) rows.push({ text: line, age }); line = ""; };
    for (const raw of m.split(/\s+/).filter(Boolean)) {
      let w = raw;
      while (w.length > cols) { flush(); rows.push({ text: w.slice(0, cols), age }); w = w.slice(cols); }
      if (line && line.length + 1 + w.length > cols) flush();
      line = line ? `${line} ${w}` : w;
    }
    flush();
  });
  return rows.slice(-Math.max(0, maxRows));
}
