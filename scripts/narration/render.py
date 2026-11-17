#!/usr/bin/env python3
"""Records the narrator's lines with Kokoro (runs on the DGX, CPU is enough for the 82M model).

    python3 render.py lines.json outdir [--voice bm_george] [--speed 0.9] [--only id,id]

lines.json is the output of export-lines.ts ([{id, text}]). Writes outdir/<id>.mp3: mono, 24 kHz, about 40 kbps,
loudness-normalised, with a faint stone-room echo. Skips ids whose mp3 already exists (delete one to re-record it).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
# A small stone room: two short reflections, quiet, then loudness to about -16 LUFS for a phone speaker.
FILTER = "aecho=0.8:0.6:45|90:0.18|0.10,highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=9"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("lines")
    ap.add_argument("outdir")
    ap.add_argument("--voice", default="bm_george")
    ap.add_argument("--speed", type=float, default=0.9)
    ap.add_argument("--only", default="")
    a = ap.parse_args()

    lines = json.load(open(a.lines))
    only = set(filter(None, a.only.split(",")))
    os.makedirs(a.outdir, exist_ok=True)
    pipe = KPipeline(lang_code="b")  # British English
    done = 0
    for line in lines:
        if only and line["id"] not in only:
            continue
        out = os.path.join(a.outdir, f"{line['id']}.mp3")
        if os.path.exists(out):
            continue
        chunks = [np.asarray(audio) for _, _, audio in pipe(line["text"], voice=a.voice, speed=a.speed) if audio is not None]
        if not chunks:
            print(f"no audio for {line['id']}", file=sys.stderr)
            continue
        pad = np.zeros(int(SR * 0.25), dtype=np.float32)
        wav = np.concatenate([pad] + [np.concatenate([c, np.zeros(int(SR * 0.12), dtype=np.float32)]) for c in chunks] + [pad])
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, wav, SR)
            subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-af", FILTER, "-ac", "1", "-ar", str(SR),
                 "-c:a", "libmp3lame", "-b:a", "40k", out],
                check=True,
            )
        done += 1
        print(f"{done} {line['id']} {len(wav) / SR:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
