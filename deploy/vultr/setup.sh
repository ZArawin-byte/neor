#!/usr/bin/env bash
# One-time setup of a fresh Vultr Ubuntu 22.04/24.04 server for the neor API. You don't run this
# by hand: deploy/vultr/update.sh copies it up and runs it the first time, then ships the code
# and .env over SSH (the repo is private, so the server never needs GitHub access).
#
# What it sets up:
#   - /opt/neor for the code, a Python venv, and a `neor` system user to run it
#   - a systemd service running uvicorn with ONE worker (lazy mode's scheduler lives in-process)
#   - Caddy in front for HTTPS on <ip-with-dashes>.sslip.io, so no domain purchase is needed
#   - a firewall allowing only SSH, HTTP and HTTPS
set -euo pipefail

APP=/opt/neor
IP=$(curl -4 -s https://ifconfig.me)
HOST="${HOST:-${IP//./-}.sslip.io}"

# 1GB plans: a 1GB swap file so pip installs and photo uploads can't run the box out of memory
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -yq python3 python3-venv python3-pip ufw debian-keyring debian-archive-keyring apt-transport-https curl gnupg

# Caddy (auto HTTPS)
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

id neor >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin neor
mkdir -p "$APP/data/uploads"
[ -d "$APP/.venv" ] || python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --upgrade pip
touch "$APP/.env" && chmod 600 "$APP/.env"
chown -R neor:neor "$APP"

cat >/etc/systemd/system/neor.service <<EOF
[Unit]
Description=neor API
After=network-online.target

[Service]
User=neor
WorkingDirectory=$APP
ExecStart=$APP/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
$HOST {
    encode gzip
    request_body {
        max_size 12MB
    }
    reverse_proxy 127.0.0.1:8000
}
EOF

ufw allow OpenSSH >/dev/null && ufw allow 80 >/dev/null && ufw allow 443 >/dev/null && ufw --force enable >/dev/null
systemctl daemon-reload
systemctl enable neor
systemctl restart caddy
touch "$APP/.setup-done"
echo "Server ready for https://$HOST"
