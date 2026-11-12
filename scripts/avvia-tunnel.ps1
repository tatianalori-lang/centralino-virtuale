# Avvia il Cloudflare Tunnel per il centralino virtuale.
# Eseguire da una sessione PowerShell che deve restare aperta:
#   .\scripts\avvia-tunnel.ps1

$exe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$config = Join-Path $PSScriptRoot '..\cloudflared\config.yml'

if (-not (Test-Path $exe)) {
  Write-Error "cloudflared non trovato in $exe. Installa con: winget install --id Cloudflare.cloudflared -e"
  exit 1
}

if (-not (Test-Path $config)) {
  Write-Error "Config non trovata: $config"
  exit 1
}

if ((Get-Content $config -Raw) -match '<TUNNEL-UUID>') {
  Write-Error 'Sostituisci <TUNNEL-UUID> in cloudflared\config.yml con l\'ID del tunnel.'
  exit 1
}

Write-Host 'Avvio Cloudflare Tunnel verso http://localhost:3000 ...'
& $exe tunnel --config $config run centralino
