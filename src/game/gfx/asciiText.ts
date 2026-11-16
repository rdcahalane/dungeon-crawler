/**
 * Text sanitising for the 5x7 bitmap font. Phaser-free so tests can import it.
 */

const ASCII_FOLD: Readonly<Record<string, string>> = {
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
  "\u00d7": "x",
  "\u00b7": ".",
};

/** Keep only characters the 5x7 font has (ASCII 32 to 126); common punctuation is folded, the rest becomes "?". */
export function asciiOnly(text: string): string {
  let out = "";
  for (const ch of text) {
    const folded = ASCII_FOLD[ch];
    if (folded !== undefined) {
      out += folded;
      continue;
    }
    const c = ch.charCodeAt(0);
    // Newlines pass through: multi-line text is joined with them before it gets here.
    out += ch === "\n" ? ch : c >= 32 && c <= 126 && ch.length === 1 ? ch : "?";
  }
  return out;
}
