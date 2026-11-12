# Disattiva l'avvio locale (ormai ridondante: il servizio gira sul VPS Hetzner).
# Eseguire come Amministratore (UAC).
$ErrorActionPreference = 'Stop'
$task = 'Centralino Virtuale'

Disable-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue | Out-Null
Get-Process node, ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$state = (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State
$out = "Task locale: $state`nProcessi locali node/ngrok arrestati.`nServizio attivo su: https://91-99-150-162.sslip.io"
Set-Content -Path 'C:\ProgramData\CentralinoVirtuale\task-locale.txt' -Value $out -Encoding UTF8
Write-Host $out
