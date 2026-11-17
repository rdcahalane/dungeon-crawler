#!/usr/bin/env bash
# Records the narrator's lines on the DGX (Kokoro, voice bm_george) and pulls the clips into public/narration.
# Only new or changed lines are recorded; clips no line uses any more are removed. Then rewrites the manifest.
set -euo pipefail
cd "$(dirname "$0")/../.."
DGX=rdcahalane@100.69.127.48
tmp=$(mktemp -d)
npx jiti scripts/narration/export-lines.ts > "$tmp/lines.json"
ssh "$DGX" 'mkdir -p ~/narration/out'
scp -q scripts/narration/render.py "$tmp/lines.json" "$DGX:narration/"
rsync -a public/narration/ "$DGX:narration/out/"
ssh "$DGX" 'cd ~/narration && . ~/venvs/kokoro/bin/activate && python3 render.py lines.json out'
mkdir -p public/narration
rsync -a "$DGX:narration/out/" public/narration/
python3 - "$tmp/lines.json" <<'PY'
import json, os, sys
ids = sorted(l["id"] for l in json.load(open(sys.argv[1])))
for f in os.listdir("public/narration"):
    if f.endswith(".mp3") and f[:-4] not in ids:
        os.remove(os.path.join("public/narration", f))
json.dump(ids, open("src/game/audio/narrationManifest.json", "w"))
print(len(ids), "clips")
PY
