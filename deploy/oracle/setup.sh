#!/usr/bin/env bash
# One-time setup for GrantKosh on an Oracle Cloud Ubuntu VM (Ampere A1 or AMD micro).
# Usage, from this folder on the VM, with .env filled in:   sudo ./setup.sh
# Safe to run again: every step checks what is already done.
set -euo pipefail

APP_DIR=/opt/grantkosh
SRC_DIR=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo ./setup.sh" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "This script supports Ubuntu images only (found: ${ID:-unknown})." >&2; exit 1; }
[ -f "$SRC_DIR/.env" ] || { echo "Missing $SRC_DIR/.env. Copy .env.example to .env and fill it in." >&2; exit 1; }

echo "==> Opening ports 80/tcp, 443/tcp and 443/udp in the VM firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
# Apply the rules now, and add them to rules.v4 directly so they survive reboots
# (saving the live table would also persist Docker's own rules).
open_port() { # proto port
  local rule=(INPUT -p "$1" -m state --state NEW -m "$1" --dport "$2" -j ACCEPT)
  iptables -C "${rule[@]}" 2>/dev/null || iptables -I "${rule[@]}"
  local line="-A ${rule[*]}"
  if [ -f /etc/iptables/rules.v4 ] && ! grep -qF -- "$line" /etc/iptables/rules.v4; then
    if grep -q -- '^-A INPUT -j REJECT' /etc/iptables/rules.v4; then
      awk -v l="$line" '!done && /^-A INPUT -j REJECT/ { print l; done = 1 } { print }' \
        /etc/iptables/rules.v4 > /etc/iptables/rules.v4.new && mv /etc/iptables/rules.v4.new /etc/iptables/rules.v4
    else
      echo "warning: no INPUT REJECT rule in /etc/iptables/rules.v4; port $2/$1 is open now but may not persist" >&2
    fi
  fi
}
open_port tcp 80
open_port tcp 443
open_port udp 443 # HTTP/3

# The 1 GB AMD micro shape needs swap to pull and start images comfortably.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q /swapfile; then
  echo "==> Adding a 2 GB swap file"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Installing Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io docker-compose-v2
fi
systemctl enable --now docker
# Let the default user run docker without sudo.
id ubuntu >/dev/null 2>&1 && usermod -aG docker ubuntu

echo "==> Installing app files in $APP_DIR"
install -d -m 755 "$APP_DIR"
install -m 644 "$SRC_DIR/compose.yml" "$SRC_DIR/Caddyfile" "$APP_DIR/"
install -m 600 "$SRC_DIR/.env" "$APP_DIR/.env"

echo "==> Starting GrantKosh"
cd "$APP_DIR"
docker compose pull
docker compose up -d --remove-orphans

echo "==> Installing the auto-update timer (checks for a new image every 15 minutes)"
cat > /etc/systemd/system/grantkosh-update.service <<EOF
[Unit]
Description=Pull the latest GrantKosh image and restart if it changed
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/docker compose pull --quiet
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStart=/usr/bin/docker image prune -f
EOF
cat > /etc/systemd/system/grantkosh-update.timer <<'EOF'
[Unit]
Description=Check for a new GrantKosh image every 15 minutes

[Timer]
OnCalendar=*:0/15
RandomizedDelaySec=60
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now grantkosh-update.timer

domain=$(grep -E '^DOMAIN=' "$APP_DIR/.env" | cut -d= -f2-)
echo
echo "Done. Caddy is requesting the HTTPS certificate now (needs DNS for $domain to point here)."
echo "Check:   curl -fsS https://$domain/api/health"
echo "Logs:    cd $APP_DIR && sudo docker compose logs -f"
