/** Wrap `text` (already plain ASCII) to `cols` characters a line, breaking words longer than a row. */
function wrapWords(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < word.length; i += cols) {
      const w = word.slice(i, i + cols);
      if (line && line.length + 1 + w.length > cols) { out.push(line); line = w; }
      else line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Wrap to `cols`, keep at most `maxLines`, and end a cut-off last line with "..". Every line fits `cols`. */
export function fitLines(text: string, cols: number, maxLines: number): string[] {
  const lines = wrapWords(text, cols);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  const last = out[maxLines - 1];
  out[maxLines - 1] = `${(last.length > cols - 2 ? last.slice(0, cols - 2) : last).trimEnd()}..`;
  return out;
}
