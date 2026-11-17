#!/usr/bin/env python3
"""Transcribes recorded clips with Whisper and compares them to the script, to catch garbled or clipped lines.

    python3 check.py lines.json outdir [--sample N]
Prints a word-match score per clip (1.0 = every scripted word heard) and the worst ones.
"""
import argparse, difflib, json, os, random, re, subprocess
import numpy as np
from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("lines"); ap.add_argument("outdir"); ap.add_argument("--sample", type=int, default=0)
a = ap.parse_args()
lines = json.load(open(a.lines))
if a.sample:
    random.seed(7); lines = random.sample(lines, a.sample)
model = WhisperModel("small.en", device="cpu", compute_type="int8")
words = lambda s: re.findall(r"[a-z']+", s.lower())
scores = []
for l in lines:
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", os.path.join(a.outdir, l["id"] + ".mp3"),
                          "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    segs, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32), beam_size=1)
    heard = " ".join(s.text for s in segs)
    r = difflib.SequenceMatcher(None, words(l["text"]), words(heard)).ratio()
    scores.append((r, l["id"], heard))
    print(f"{r:.3f} {l['id']}", flush=True)
scores.sort()
print("mean", sum(s[0] for s in scores) / len(scores))
for r, i, h in scores[:5]:
    print("WORST", f"{r:.3f}", i, h[:300])
