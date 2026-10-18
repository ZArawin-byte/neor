#!/usr/bin/env bash
# Ship the latest main to the Vultr server and point the live site at it. Run from the repo root:
#   bash deploy/vultr/update.sh <server-ip> [path-to-ssh-key]
# First run sets the server up (setup.sh). Every run: ships origin/main and your local .env over
# SSH (nothing secret goes through GitHub), restarts the API, then rebuilds the frontend against
# https://<ip-with-dashes>.sslip.io and deploys it to Firebase.
set -euo pipefail
IP="${1:?usage: bash deploy/vultr/update.sh <server-ip> [ssh-key]}"
KEY="${2:-$HOME/.ssh/neor_vultr}"
HOST="${IP//./-}.sslip.io"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new root@$IP"

[ -f .env ] || { echo "No .env in the repo root."; exit 1; }
grep -q "neor-closet.web.app" .env || echo "Warning: FRONTEND_ORIGINS in .env should include https://neor-closet.web.app"

git fetch -q origin
if ! $SSH 'test -f /opt/neor/.setup-done'; then
  echo "First run: setting the server up (a few minutes)..."
  $SSH 'bash -s' < deploy/vultr/setup.sh
fi
# the code: exactly what's on origin/main, minus the prototype folder
git archive --format=tar.gz origin/main -- . ':!souq-source' ':!frontend' | $SSH 'tar -xzf - -C /opt/neor'
scp -q -i "$KEY" .env "root@$IP:/opt/neor/.env"
$SSH 'cd /opt/neor && .venv/bin/pip install -q -r requirements.txt && chown -R neor:neor /opt/neor && chmod 600 .env && systemctl restart neor'

for _ in $(seq 1 20); do curl -sf -o /dev/null "https://$HOST/api/config" && break; sleep 2; done
curl -sf -o /dev/null "https://$HOST/api/config" || { echo "API isn't answering at https://$HOST"; $SSH 'journalctl -u neor -n 30 --no-pager'; exit 1; }
echo "API up at https://$HOST"

(cd frontend && VITE_API_URL="https://$HOST" npx vite build && firebase deploy --only hosting --project neor-closet)
echo "Live: https://neor-closet.web.app -> https://$HOST"
