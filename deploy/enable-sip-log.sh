#!/bin/bash
cat > /etc/asterisk/logger.conf <<'EOF'
[general]
[logfiles]
full => debug,notice,verbose(3),warning,error,dtmf
EOF
chown asterisk:asterisk /etc/asterisk/logger.conf
systemctl restart asterisk >/dev/null 2>&1
sleep 5
asterisk -rx "logger reload" >/dev/null
asterisk -rx "pjsip set logger on" >/dev/null
echo "=== REG ==="
asterisk -rx "pjsip show registrations"
echo "=== LOG READY ==="
ls -l /var/log/asterisk/full 2>/dev/null || echo "file full non ancora creato"
