#!/usr/bin/env bash
# Deploy the game to Canoe (Ubuntu/systemd, service dungeon-crawler on :3340, behind the
# advisor-canoe Cloudflare tunnel as dungeon.civops.io). Usage: npm run deploy:canoe
# Code lives in /opt/dungeon-crawler; its .env.production (Canoe Postgres db dungeon_crawler,
# AUTH_SECRET) stays on the server and is never copied.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANOE="canoe"; PORT=3340; APP=/opt/dungeon-crawler

echo "[deploy] 1: malware sweep (blocking)"
hits=$(python3 -I ~/.config/git-guard/sweep.py "$PWD") || { echo "FAILED: sweep found:"; echo "$hits"; exit 1; }

echo "[deploy] 2: tests and local production build (blocking)"
npx vitest run >/dev/null || { echo "FAILED: tests — not deploying"; exit 1; }
npm run build >/dev/null || { echo "FAILED: build — not deploying"; exit 1; }

echo "[deploy] 3: sync to $CANOE:$APP (keeps server .env.production)"
rsync -az --delete \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude=.claude --exclude=.vercel \
  --exclude=src/generated --exclude='._*' --exclude=public/__bot.js \
  --filter='P .env*' --filter='P node_modules' --filter='P .next' \
  "$PWD"/ "$CANOE:$APP/"

echo "[deploy] 4: sweep, install, build and restart on Canoe"
ssh "$CANOE" "set -e; cd $APP && python3 -I ~/.config/git-guard/sweep.py $APP && \
  npm ci --no-audit --no-fund --ignore-scripts >/dev/null && \
  set -a && . ./.env.production && set +a && npm run build >/dev/null && sudo systemctl restart dungeon-crawler"

echo "[deploy] 5: smoke test"
for i in $(seq 1 15); do
  ssh "$CANOE" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/" | grep -q 200 && break; sleep 2
done
for p in / /login /manifest.webmanifest /api/auth/session; do
  code=$(ssh "$CANOE" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT$p")
  [ "$code" = 200 ] || { echo "FAILED: $p returned $code"; exit 1; }
done
code=$(curl -s -o /dev/null -w '%{http_code}' https://dungeon.civops.io/)
[ "$code" = 200 ] || { echo "FAILED: https://dungeon.civops.io/ returned $code"; exit 1; }
# Database path: registering an email that already exists must be refused by a DB lookup (creates nothing).
email=$(ssh "$CANOE" "set -a; . $APP/.env.production; psql \"\$DATABASE_URL\" -Atc 'select email from \"User\" limit 1'")
if [ -n "$email" ]; then
  body=$(curl -s -X POST https://dungeon.civops.io/api/register -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"smoke-test-only\"}")
  echo "$body" | grep -q "already exists" || { echo "FAILED: database check, register said: $body"; exit 1; }
fi
echo "[deploy] done: Canoe:$PORT and https://dungeon.civops.io answer 200"
