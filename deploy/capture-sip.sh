#!/bin/bash
# Cattura lo scambio REGISTER verso MessageNet per diagnosticare l'autenticazione.
if ! command -v tcpdump >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tcpdump >/dev/null 2>&1
fi
tcpdump -i any -n -s 0 -A -c 14 udp port 5060 and host 109.233.129.13 > /tmp/sip-capture.txt 2>&1 &
CAP=$!
systemctl restart asterisk >/dev/null 2>&1
sleep 9
kill "$CAP" 2>/dev/null
wait "$CAP" 2>/dev/null
echo "=== CATTURA SIP ==="
cat /tmp/sip-capture.txt
echo "=== STATO REGISTRAZIONE ==="
asterisk -rx "pjsip show registrations"
