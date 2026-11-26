#!/usr/bin/env bash
# Configura il centralino VoIP Asterisk sul VPS (interni 101 e 102 + ponte Twilio).
# Eseguire come root sul VPS dopo il deploy dell'applicazione:
#   cd /opt/centralino && chmod +x deploy/setup-voip-vps.sh && ./deploy/setup-voip-vps.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/centralino}"
ENV_FILE="$APP_DIR/.env"
PUBLIC_IP="${VPS_PUBLIC_IP:-91.99.150.162}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRORE: $ENV_FILE non trovato"
  exit 1
fi

gen_secret() {
  openssl rand -hex 12
}

set_env_if_missing() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    local cur
    cur="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'\'' ')"
    if [ -z "$cur" ]; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    fi
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

echo "==> Aggiorno variabili VoIP in $ENV_FILE"
set_env_if_missing "VOIP_TRANSFER_ENABLED" "true"
set_env_if_missing "VOIP_EXTERNAL_FORWARD_ENABLED" "true"
set_env_if_missing "VOIP_SIP_URI" "sip:100@${PUBLIC_IP}:5060"
set_env_if_missing "VOIP_DIAL_TIMEOUT" "25"
set_env_if_missing "VOIP_SIP_USER" "twilio-bridge"
set_env_if_missing "VOIP_SIP_PASSWORD" "$(gen_secret)"
set_env_if_missing "VOIP_BRIDGE_TOKEN" "$(gen_secret)"
set_env_if_missing "ASTERISK_EXT_101_PASSWORD" "$(gen_secret)"
set_env_if_missing "ASTERISK_EXT_102_PASSWORD" "$(gen_secret)"
set_env_if_missing "MESSAGENET_OUTBOUND_CLI" "+390686358716"
chmod 600 "$ENV_FILE"

echo "==> Logger Asterisk + logrotate anti-riempimento disco"
cat > /etc/asterisk/logger.conf <<'EOF'
[general]
[logfiles]
messages => warning,error
security => security
EOF
chown asterisk:asterisk /etc/asterisk/logger.conf || true

cat > /etc/logrotate.d/asterisk <<'EOF'
/var/log/asterisk/messages /var/log/asterisk/security /var/log/asterisk/cdr-csv/*.csv {
  daily
  maxsize 20M
  missingok
  rotate 5
  compress
  delaycompress
  notifempty
  sharedscripts
  postrotate
    /usr/sbin/asterisk -rx 'logger reload' >/dev/null 2>&1 || true
  endscript
}
EOF

echo "==> Genero configurazione PJSIP e Dialplan Asterisk"
cd "$APP_DIR"
node scripts/genera-config-asterisk.mjs

echo "==> Firewall UFW (SIP 5060/udp e RTP 10000:10100/udp)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 5060/udp comment 'Asterisk SIP VoIP' >/dev/null
  ufw allow 10000:10100/udp comment 'Asterisk RTP Audio' >/dev/null
fi

echo "==> Fail2ban protezione SIP Asterisk"
if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update -y >/dev/null
  apt-get install -y fail2ban >/dev/null
fi

cat > /etc/fail2ban/jail.d/asterisk.conf <<'EOF'
[asterisk]
enabled = true
backend = auto
port = 5060,5061
protocol = udp
filter = asterisk
logpath = /var/log/asterisk/security
maxretry = 5
findtime = 600
bantime = 3600
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Riavvio Asterisk e Centralino"
systemctl restart asterisk
systemctl restart centralino
sleep 2

echo "==> Stato servizi"
systemctl is-active asterisk
systemctl is-active centralino
asterisk -rx "pjsip show registrations"
asterisk -rx "pjsip show endpoints" | grep -E "Endpoint:|101|102|endpoint-" || true

EXT101_PASS="$(grep -E '^ASTERISK_EXT_101_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
EXT102_PASS="$(grep -E '^ASTERISK_EXT_102_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"

echo
echo "=================================================================="
echo "DATI DA INSERIRE NELLA BASE YEALINK W70B (Server SIP: ${PUBLIC_IP}:5060)"
echo "  Interno 101 -> Username/Auth: 101 | Password: ${EXT101_PASS}"
echo "  Interno 102 -> Username/Auth: 102 | Password: ${EXT102_PASS}"
echo "=================================================================="
