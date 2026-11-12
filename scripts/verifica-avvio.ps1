# Verifica pulita (Amministratore): ferma TUTTO e lascia partire solo il task SYSTEM.
$ErrorActionPreference = 'Continue'
$dest = 'C:\ProgramData\CentralinoVirtuale'
$out  = Join-Path $dest 'verifica.txt'
$lines = @()
function Say($m) { $script:lines += "$(Get-Date -Format 'HH:mm:ss') $m" }

Say 'Stop di tutti i processi node/ngrok...'
Get-Process node, ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Say "Processi rimasti: $((Get-Process node, ngrok -ErrorAction SilentlyContinue | Measure-Object).Count)"

Say 'Start-ScheduledTask (SYSTEM, pre-login)...'
Start-ScheduledTask -TaskName 'Centralino Virtuale'
Start-Sleep -Seconds 40

$localOk = $false
$pubOk = $false
try { $null = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 5; $localOk = $true } catch { }
try {
  $null = Invoke-WebRequest -UseBasicParsing 'https://acorn-detection-repair.ngrok-free.dev/api/health' `
    -TimeoutSec 15 -Headers @{ 'ngrok-skip-browser-warning' = 'true' }
  $pubOk = $true
} catch { }

if (-not $pubOk) {
  Say 'URL pubblico non pronto, attesa altri 20s...'
  Start-Sleep -Seconds 20
  try {
    $null = Invoke-WebRequest -UseBasicParsing 'https://acorn-detection-repair.ngrok-free.dev/api/health' `
      -TimeoutSec 15 -Headers @{ 'ngrok-skip-browser-warning' = 'true' }
    $pubOk = $true
  } catch { }
}

Say "Server locale: $localOk"
Say "URL pubblico: $pubOk"
foreach ($n in @('node','ngrok')) {
  Get-CimInstance Win32_Process -Filter "Name = '$n.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
    Say "  $n pid=$($_.ProcessId) utente='$($o.Domain)\$($o.User)'"
  }
}
try {
  $r = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4040/api/tunnels').Content | ConvertFrom-Json
  Say "  tunnel URL: $(($r.tunnels | Select-Object -First 1).public_url)"
} catch { Say "  tunnel API non disponibile" }

Set-Content -Path $out -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host ($lines -join "`n")

