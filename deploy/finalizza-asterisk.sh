#!/bin/bash
# Rimuove il logging SIP di debug e rende Asterisk riavviabile automaticamente.
asterisk -rx "pjsip set logger off" >/dev/null 2>&1

cat > /etc/asterisk/logger.conf <<'EOF'
[general]
[logfiles]
messages => notice,warning,error
EOF
chown asterisk:asterisk /etc/asterisk/logger.conf
asterisk -rx "logger reload" >/dev/null 2>&1

mkdir -p /etc/systemd/system/asterisk.service.d
cat > /etc/systemd/system/asterisk.service.d/override.conf <<'EOF'
[Service]
Restart=always
RestartSec=5
EOF
systemctl daemon-reload >/dev/null 2>&1

rm -f /var/log/asterisk/full
echo "=== ENABLED ==="
systemctl is-enabled asterisk
echo "=== ACTIVE ==="
systemctl is-active asterisk
echo "=== REGISTRAZIONE ==="
asterisk -rx "pjsip show registrations" | tail -3
echo "=== DISCO ==="
du -sh /var/log/asterisk/ 2>/dev/null
