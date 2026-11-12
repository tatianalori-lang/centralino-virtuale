#!/usr/bin/env bash
# Watchdog: se il server non risponde, riavvia centralino (e Caddy se serve).
# Installato come timer systemd: centralino-watchdog.timer (ogni 2 minuti).
set -u
LOG=/var/log/centralino-watchdog.log

if curl -fsS --max-time 8 http://localhost:3000/api/health >/dev/null 2>&1; then
  exit 0
fi

echo "$(date -Is) health FAIL -> restart centralino" >> "$LOG"
systemctl restart centralino
sleep 6

if curl -fsS --max-time 8 http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "$(date -Is) ripristinato" >> "$LOG"
  exit 0
fi

echo "$(date -Is) ancora KO -> restart caddy" >> "$LOG"
systemctl restart caddy
exit 0
