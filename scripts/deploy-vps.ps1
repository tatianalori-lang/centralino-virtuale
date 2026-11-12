# Deploy del centralino sul VPS Hetzner.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1 -Server 91.99.150.162
#
# Il pacchetto inviato NON contiene: node_modules, .git, data (ticket e
# impostazioni restano quelli del server), .env (configurazione di produzione).

param(
  [string]$Server = '91.99.150.162',
  [string]$User = 'root',
  [string]$Key = "$env:USERPROFILE\.ssh\centralino_deploy_ed25519",
  [string]$AppDir = '/opt/centralino',
  [string]$PublicUrl = 'https://centralino.mtitaliaretail.com'
)

$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$localTar = Join-Path $env:TEMP "centralino-deploy-$stamp.tar.gz"
$remoteTar = "/tmp/centralino-deploy-$stamp.tar.gz"
$sshTarget = "$User@$Server"
$sshArgs = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')

if (-not (Test-Path $Key)) {
  throw "Chiave SSH non trovata: $Key"
}

Write-Host "==> Creo il pacchetto da $projectDir" -ForegroundColor Cyan
if (Test-Path $localTar) { Remove-Item $localTar -Force }
& tar -czf $localTar -C $projectDir `
  --exclude=node_modules --exclude=.git --exclude=data --exclude=.env `
  --exclude='*.log' --exclude='*.tmp' .
if ($LASTEXITCODE -ne 0) { throw 'Creazione archivio fallita' }

$sizeMb = [math]::Round((Get-Item $localTar).Length / 1MB, 2)
Write-Host "    pacchetto: $localTar ($sizeMb MB)"

try {
  Write-Host "==> Copio sul server $sshTarget" -ForegroundColor Cyan
  & scp @sshArgs $localTar "${sshTarget}:$remoteTar"
  if ($LASTEXITCODE -ne 0) { throw 'Copia sul server fallita' }

  Write-Host "==> Installo e riavvio il servizio" -ForegroundColor Cyan
  $remote = @"
set -euo pipefail
STAMP='$stamp'
REMOTE_TAR='$remoteTar'
APP_DIR='$AppDir'

mkdir -p /root/backups
echo '--- backup versione precedente'
tar -czf /root/backups/centralino-`$STAMP.tar.gz -C "`$(dirname `$APP_DIR)" "`$(basename `$APP_DIR)" || true

echo '--- estrazione nuovi file (data/ e .env restano intatti)'
tar -xzf "`$REMOTE_TAR" -C "`$APP_DIR"

find "`$APP_DIR" -type d -exec chmod 755 {} +
find "`$APP_DIR" -type f -exec chmod 644 {} +
chmod 600 "`$APP_DIR/.env" 2>/dev/null || true

cd "`$APP_DIR"
npm ci --omit=dev
chown -R centralino:centralino "`$APP_DIR"

systemctl restart centralino
systemctl is-active --quiet centralino && echo '--- servizio attivo' || { echo '--- SERVIZIO NON ATTIVO'; journalctl -u centralino -n 40 --no-pager; exit 1; }

sleep 2
echo '--- health locale'
curl -fsS http://127.0.0.1:3000/api/health && echo || echo 'health locale non raggiungibile'
rm -f "`$REMOTE_TAR"
"@

  $remote | & ssh @sshArgs $sshTarget 'bash -s'
  if ($LASTEXITCODE -ne 0) { throw 'Deploy remoto fallito' }

  Write-Host "==> Verifica pubblica $PublicUrl/api/health" -ForegroundColor Cyan
  $health = Invoke-RestMethod -Uri "$PublicUrl/api/health" -TimeoutSec 20
  $health | ConvertTo-Json -Depth 5

  Write-Host "`nDeploy completato." -ForegroundColor Green
}
finally {
  if (Test-Path $localTar) { Remove-Item $localTar -Force }
}
