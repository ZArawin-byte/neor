#!/usr/bin/env bash
# Put the API running on this laptop behind a free Cloudflare tunnel and point the live site
# (neor-closet.web.app) at it. No accounts needed. The site only works while this keeps running.
#
#   1. start the API:  .venv/Scripts/python -m uvicorn app.main:app --port 8000
#   2. run:            bash scripts/go-live.sh      (Ctrl+C stops the tunnel)
#
# The tunnel address changes every run, so this rebuilds and redeploys the site each time.
# For an always-on API, use render.yaml instead (see README -> Deploy).
set -euo pipefail
cd "$(dirname "$0")/.."

CLOUDFLARED=$(command -v cloudflared || ls "$LOCALAPPDATA"/Microsoft/WinGet/Packages/Cloudflare.cloudflared*/cloudflared.exe 2>/dev/null | head -1 || true)
[ -n "$CLOUDFLARED" ] || { echo "Install it first: winget install Cloudflare.cloudflared"; exit 1; }
curl -sf -o /dev/null http://localhost:8000/ || { echo "Start the API on :8000 first (step 1 above)."; exit 1; }
grep -q "neor-closet.web.app" .env 2>/dev/null || echo "Warning: add https://neor-closet.web.app to FRONTEND_ORIGINS in .env, then restart the API."
grep -q "^LAZY_ALLOWED_EMAILS=." .env 2>/dev/null || echo "Warning: LAZY_ALLOWED_EMAILS is empty, so anyone could send lazy-mode email from your account."

LOG=$(mktemp)
"$CLOUDFLARED" tunnel --no-autoupdate --url http://localhost:8000 >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null; rm -f "$LOG"' EXIT

URL=""
for _ in $(seq 1 40); do
  URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "The tunnel didn't start:"; cat "$LOG"; exit 1; }
echo "API is public at $URL"

(cd frontend && VITE_API_URL="$URL" npx vite build && firebase deploy --only hosting --project neor-closet)
echo
echo "Live: https://neor-closet.web.app (talking to $URL). Leave this running; Ctrl+C to stop."
wait $TUNNEL
