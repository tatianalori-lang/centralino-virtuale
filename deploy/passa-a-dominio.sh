#!/usr/bin/env bash
# Passa dal nome temporaneo sslip.io al dominio aziendale, NON appena il
# record A su Aruba è propagato. Eseguire come root sul VPS:
#   /opt/centralino/deploy/passa-a-dominio.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/centralino}"
DOMAIN="centralino.mtitaliaretail.com"
EXPECTED="91.99.150.162"

IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ "$IP" != "$EXPECTED" ]; then
  echo "Il record A $DOMAIN -> $EXPECTED non è ancora propagato (risolto: '${IP:-niente}')."
  echo "Aggiungilo nel pannello DNS Aruba e riprova tra qualche minuto."
  exit 1
fi

echo "DNS OK: $DOMAIN -> $IP"
cd "$APP_DIR"
sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://$DOMAIN|" .env
grep '^PUBLIC_BASE_URL' .env

npm run webhook
systemctl restart centralino
systemctl restart caddy
sleep 5

echo "--- verifica finale ---"
curl -fsS "https://$DOMAIN/api/health"
echo
echo "Dominio attivo: https://$DOMAIN"
