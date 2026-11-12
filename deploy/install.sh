#!/usr/bin/env bash
# Installer per VPS Ubuntu 22.04 / 24.04. Eseguire come root, da /opt/centralino.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/centralino}"
NODE_MAJOR="${NODE_MAJOR:-22}"

echo "==> Installazione dipendenze di sistema"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

echo "==> Utente di servizio"
if ! id -u centralino >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin centralino
fi

echo "==> Permessi (il tar da Windows può arrivare in sola lettura)"
find "$APP_DIR" -type d -exec chmod 755 {} +
find "$APP_DIR" -type f -exec chmod 644 {} +
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

echo "==> Dipendenze applicazione"
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
mkdir -p data/logs
chown -R centralino:centralino "$APP_DIR"

echo "==> Configurazione Caddy e systemd"
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
cp "$APP_DIR/deploy/centralino.service" /etc/systemd/system/centralino.service
systemctl daemon-reload
systemctl enable --now centralino
systemctl restart caddy

echo "==> Stato"
systemctl --no-pager status centralino || true
systemctl --no-pager status caddy || true

echo
echo "Fatto. Ricordati di:"
echo "  1. creare il record A centralino.mtitaliaretail.com -> IP di questo VPS su Aruba"
echo "  2. impostare PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com in $APP_DIR/.env"
echo "  3. eseguire: cd $APP_DIR && npm run webhook && systemctl restart centralino"
