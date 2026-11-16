/**
 * Small helpers for authoring ASCII pixel maps. Phaser-free.
 * A "map" is an array of equal-length strings. '.' is transparent; every
 * other char is a palette colour (see palette.ts).
 */

export interface SpriteDef {
  readonly key: string;
  /** Logical grid size. */
  readonly w: number;
  readonly h: number;
  /** Output pixels per logical pixel (nearest neighbour). */
  readonly scale: number;
  readonly rows: readonly string[];
  /** Per-char alpha override (0..1) for stepped glows. Default 1. */
  readonly alpha?: Readonly<Record<string, number>>;
  /** Max distinct colours allowed (4 normally, 6 for player/boss). */
  readonly maxColors: number;
}

export type Rows = string[];

/** Build a full-width map from its left half (mirror). */
export function mirror(half: readonly string[]): Rows {
  return half.map((r) => r + r.split("").reverse().join(""));
}

/** Substitute chars simultaneously (single pass, so swaps work). */
export function recolor(rows: readonly string[], map: Record<string, string>): Rows {
  return rows.map((r) =>
    r
      .split("")
      .map((c) => (Object.prototype.hasOwnProperty.call(map, c) ? map[c] : c))
      .join(""),
  );
}

/** Overlay patch on rows at (x, y); '.' in the patch leaves the base alone. */
export function stamp(rows: readonly string[], x: number, y: number, patch: readonly string[]): Rows {
  const out = rows.map((r) => r.split(""));
  patch.forEach((pr, dy) => {
    for (let dx = 0; dx < pr.length; dx++) {
      const c = pr[dx];
      const ty = y + dy;
      const tx = x + dx;
      if (c === "." || ty < 0 || ty >= out.length || tx < 0 || tx >= out[ty].length) continue;
      out[ty][tx] = c;
    }
  });
  return out.map((r) => r.join(""));
}

/** Solid w x h block of one char. */
export function solid(w: number, h: number, ch: string): Rows {
  return Array.from({ length: h }, () => ch.repeat(w));
}

/** Flip a map horizontally. */
export function flipH(rows: readonly string[]): Rows {
  return rows.map((r) => r.split("").reverse().join(""));
}

/**
 * Second walk frame. "legs": the left foot lifts one pixel (bottom `legRows` rows, 4 for a 16x16 sprite,
 * left half). "bob": the whole sprite rises one pixel (first row must be empty).
 */
export function walkFrame(rows: readonly string[], mode: "legs" | "bob", legRows = 4): Rows {
  const w = rows[0].length;
  const h = rows.length;
  if (mode === "bob") {
    const empty = ".".repeat(w);
    if (rows[0] !== empty) throw new Error("bob frame needs an empty first row");
    return [...rows.slice(1), empty];
  }
  const out = rows.map((r) => r.split(""));
  const half = Math.floor(w / 2);
  for (let r = h - legRows; r < h; r++) {
    for (let x = 0; x < half; x++) {
      out[r][x] = r + 1 < h ? rows[r + 1][x] : ".";
    }
  }
  return out.map((r) => r.join(""));
}

/** Count distinct colour chars (not '.') used in rows. */
export function colorsUsed(rows: readonly string[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of r) if (c !== ".") set.add(c);
  return Array.from(set);
}

/** Build a full map from its top-left quadrant (mirror both ways). */
export function quad(q: readonly string[]): Rows {
  const top = mirror(q);
  return [...top, ...top.slice().reverse()];
}

/** Stepped, dithered radial falloff for glows. `bands` run centre to edge. */
export function glowRows(n: number, bands: readonly string[], radiusFrac = 1): Rows {
  const rows: Rows = [];
  const c = (n - 1) / 2;
  const maxR = (n / 2) * radiusFrac;
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / maxR;
      if (d >= 1) {
        row += ".";
        continue;
      }
      const v = d * bands.length;
      let band = Math.floor(v);
      const frac = v - band;
      // checkerboard dither across the outer 35% of each band
      if (frac > 0.65 && (x + y) % 2 === 0) band += 1;
      row += band >= bands.length ? "." : bands[band];
    }
    rows.push(row);
  }
  return rows;
}
