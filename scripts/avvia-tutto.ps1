# Avvia in una volta server + tunnel ngrok.
# Usato anche dal collegamento in shell:startup per l'avvio automatico.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'data\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$node = Get-Command node -ErrorAction SilentlyContinue
$ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'node non trovato nel PATH'; exit 1 }
if (-not $ngrok) { Write-Error 'ngrok non trovato nel PATH'; exit 1 }

function Write-Log($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
  Add-Content -Path (Join-Path $logDir 'avvio.log') -Value $line -Encoding UTF8
  Write-Host $line
}

# Server: evita duplicati verificando che risponda /api/health.
$serverUp = $false
try {
  $null = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 3
  $serverUp = $true
} catch { }

if (-not $serverUp) {
  Start-Process -FilePath $node.Source -ArgumentList 'server.js' `
    -WorkingDirectory $root -WindowStyle Minimized `
    -RedirectStandardOutput (Join-Path $logDir 'server.log') `
    -RedirectStandardError (Join-Path $logDir 'server.err')
  Start-Sleep -Seconds 3
  Write-Log 'Server avviato.'
} else {
  Write-Log 'Server già attivo (health OK).'
}

# Tunnel ngrok: il dev domain è statico, non cambia al riavvio.
$tunnel = Get-Process ngrok -ErrorAction SilentlyContinue
if (-not $tunnel) {
  Start-Process -FilePath $ngrok.Source -ArgumentList 'http','3000' `
    -WorkingDirectory $root -WindowStyle Minimized `
    -RedirectStandardOutput (Join-Path $logDir 'ngrok.log') `
    -RedirectStandardError (Join-Path $logDir 'ngrok.err')
  Write-Log 'Tunnel ngrok avviato, attesa connessione...'
} else {
  Write-Log 'Tunnel ngrok già attivo.'
}

# Attende che il tunnel sia effettivamente stabilito (max ~20s).
$tunnelUrl = $null
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 2
  try {
    $res = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3
    $t = ($res.Content | ConvertFrom-Json).tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1
    if ($t) { $tunnelUrl = $t.public_url; break }
  } catch { }
}
if ($tunnelUrl) {
  Write-Log "Tunnel pronto: $tunnelUrl"
} else {
  Write-Log 'ATTENZIONE: tunnel non ancora pronto, riprovare tra qualche secondo.'
}

# Verifica finale locale.
try {
  $health = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 5
  Write-Log "Server OK: $($health.Content)"
} catch {
  Write-Log "ATTENZIONE: server non raggiungibile: $($_.Exception.Message)"
}

# Verifica end-to-end dall'URL pubblico.
if ($tunnelUrl) {
  try {
    $pub = Invoke-WebRequest -UseBasicParsing "$tunnelUrl/api/health" -TimeoutSec 10 `
      -Headers @{ 'ngrok-skip-browser-warning' = 'true' }
    Write-Log "URL pubblico OK: $($pub.Content)"
  } catch {
    Write-Log "ATTENZIONE: URL pubblico non raggiungibile: $($_.Exception.Message)"
  }
}
