# Installer da eseguire COME AMMINISTRATORE (richiede consenso UAC).
# Crea un'Attività pianificata che avvia server + ngrok all'avvio di Windows,
# prima del login, con l'account SYSTEM.

#requires -Version 5.1
$ErrorActionPreference = 'Stop'
trap {
  Set-Content -Path (Join-Path $env:TEMP 'centralino-installa-errore.log') `
    -Value ($_ | Out-String) -Encoding UTF8
  Write-Host "ERRORE: $($_.Exception.Message)"
  break
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Error 'Eseguire come Amministratore (tasto destro -> Esegui come amministratore).'
  exit 1
}

# Radice del progetto = cartella superiore a scripts\
$root   = Split-Path -Parent $PSScriptRoot
$dest   = 'C:\ProgramData\CentralinoVirtuale'
$node   = 'C:\Program Files\nodejs\node.exe'
$logDir = Join-Path $dest 'logs'

New-Item -ItemType Directory -Path $dest -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# --- ngrok.exe stabile (l'alias MSIX non è utilizzabile da SYSTEM) ---
$appx = Get-AppxPackage -Name 'ngrok.ngrok' | Select-Object -First 1
$sourceExe = if ($appx) { Join-Path $appx.InstallLocation 'ngrok.exe' } else { $null }
if ($sourceExe -and (Test-Path -LiteralPath $sourceExe)) {
  Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $dest 'ngrok.exe') -Force
} else {
  throw 'ngrok.exe del pacchetto MSIX non trovato.'
}

# --- config con authtoken, copiato dal percorso virtualizzato MSIX ---
$userCfg = Join-Path $env:USERPROFILE 'AppData\Local\Packages\ngrok.ngrok_1g87z0zv29zzc\LocalCache\Local\ngrok\ngrok.yml'
if (-not (Test-Path -LiteralPath $userCfg)) {
  $found = Get-ChildItem (Join-Path $env:USERPROFILE 'AppData\Local\Packages') -Recurse -Filter 'ngrok.yml' -Force -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $found) { throw 'Config ngrok con authtoken non trovata.' }
  $userCfg = $found
}
Copy-Item -LiteralPath $userCfg -Destination (Join-Path $dest 'ngrok.yml') -Force

# Rendi il file con l'authtoken leggibile solo da SYSTEM/Administrators.
& icacls (Join-Path $dest 'ngrok.yml') /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' | Out-Null

# --- Launcher eseguito da SYSTEM ---
$launcher = @'
$ErrorActionPreference = 'Stop'
$root   = '__PROJECT_ROOT__'
$dest   = 'C:\ProgramData\CentralinoVirtuale'
$node   = 'C:\Program Files\nodejs\node.exe'
$ngrok  = Join-Path $dest 'ngrok.exe'
$cfg    = Join-Path $dest 'ngrok.yml'
$logDir = Join-Path $dest 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Log($m) {
  Add-Content -Path (Join-Path $logDir 'avvio.log') `
    -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [SYSTEM] $m" -Encoding UTF8
}

# Server
$up = $false
try { $null = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 3; $up = $true } catch { }
if (-not $up) {
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'server.log') `
    -RedirectStandardError (Join-Path $logDir 'server.err')
  Start-Sleep -Seconds 3
  Log 'Server avviato.'
} else { Log 'Server già attivo.' }

# Tunnel ngrok (dev domain statico)
if (-not (Get-Process ngrok -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $ngrok -ArgumentList @('http','3000','--config',$cfg) `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'ngrok.log') `
    -RedirectStandardError (Join-Path $logDir 'ngrok.err')
  Log 'Tunnel avviato, attesa connessione...'
} else { Log 'Tunnel già attivo.' }

$tunnelUrl = $null
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3
    $t = ($r.Content | ConvertFrom-Json).tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1
    if ($t) { $tunnelUrl = $t.public_url; break }
  } catch { }
}
if ($tunnelUrl) { Log "Tunnel pronto: $tunnelUrl" } else { Log 'ATTENZIONE: tunnel non pronto.' }

try {
  $h = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 5
  Log "Server OK: $($h.Content)"
} catch { Log "ATTENZIONE server: $($_.Exception.Message)" }

if ($tunnelUrl) {
  try {
    $p = Invoke-WebRequest -UseBasicParsing "$tunnelUrl/api/health" -TimeoutSec 10 `
      -Headers @{ 'ngrok-skip-browser-warning' = 'true' }
    Log "URL pubblico OK: $($p.Content)"
  } catch { Log "ATTENZIONE pubblico: $($_.Exception.Message)" }
}
'@
$launcher = $launcher.Replace('__PROJECT_ROOT__', $root)
Set-Content -Path (Join-Path $dest 'avvia.ps1') -Value $launcher -Encoding UTF8

# --- Attività pianificata: all'avvio + watchdog ogni 5 min (idempotente) ---
$taskName = 'Centralino Virtuale'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dest 'avvia.ps1') + '"')
$t1 = New-ScheduledTaskTrigger -AtStartup
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($t1, $t2) `
  -Principal $principal -Settings $settings -Force | Out-Null

# Rimuove il vecchio collegamento in shell:startup (ora ridondante).
$old = Join-Path ([Environment]::GetFolderPath('Startup')) 'Centralino Virtuale.lnk'
if (Test-Path $old) { Remove-Item $old -Force }

Write-Host "Attività '$taskName' creata (SYSTEM, all'avvio + ogni 5 min)."
Write-Host "File in $dest"
Write-Host 'Avvio immediato per verifica...'
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 10
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object TaskName, LastRunTime, LastTaskResult, NumberOfMissedRuns
