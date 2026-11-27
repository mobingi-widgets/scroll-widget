# Swap in a verified update (updater.js hands over to this copy, outside the program).
# Says it is running first (-Started: the app waits for that file before it quits, and if it
# never comes the app stays and says the install failed - 1.6.0 / 1.4.2). Then waits for the app
# to exit, moves the program's files aside (keeping the -Keep names in place), moves the new files
# in, starts the app and waits for it to report a healthy start (-OkFile with the new -Version).
# If that does not come, the new files go and the old ones come back, and the old version is
# started again. -Cancel: the app gave up waiting for -Started (a late start must not swap later).
# Keep this file ASCII (PowerShell 5.1).
param(
  [int]$WaitPid, [string]$AppDir, [string]$NewDir, [string]$BackupDir, [string]$Keep = '',
  [string]$Launch, [string]$LaunchArgs = '', [string]$LaunchCwd, [string]$OkFile, [string]$Version,
  [string]$Log, [int]$OkTimeout = 60, [string]$Started = '', [string]$Cancel = ''
)
$ErrorActionPreference = 'Stop'
function Write-Log([string]$m) { try { Add-Content -LiteralPath $Log -Value ((Get-Date -Format s) + ' ' + $m) } catch { } }
$keepSet = @($Keep.Split('|') | Where-Object { $_ -ne '' })

function Move-Program([string]$from, [string]$to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Get-ChildItem -LiteralPath $from -Force | Where-Object { $keepSet -notcontains $_.Name } | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $to $_.Name) -Force
  }
}

function Start-App {
  if ($LaunchArgs) { Start-Process -FilePath $Launch -ArgumentList $LaunchArgs -WorkingDirectory $LaunchCwd }
  else { Start-Process -FilePath $Launch -WorkingDirectory $LaunchCwd }
}

function Stop-App {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $Launch } | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { }
  }
}

try {
  if ($Started) { Set-Content -LiteralPath $Started -Value $PID -Encoding ASCII }
  Write-Log "update to ${Version} - waiting for pid ${WaitPid}"
  try { Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction Stop } catch { }
  if ($Cancel -and (Test-Path -LiteralPath $Cancel)) { Write-Log 'cancelled by the app (it gave up waiting); nothing changed'; exit 3 }
  if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) {
    # never swap under a running program: it was told to quit, so end it
    Write-Log "pid ${WaitPid} still running after 30 s; ending it"
    try { Stop-Process -Id $WaitPid -Force -ErrorAction Stop } catch { }
    try { Wait-Process -Id $WaitPid -Timeout 10 -ErrorAction Stop } catch { }
    if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Write-Log 'it would not end; nothing changed'; exit 4 }
  }
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath $BackupDir) { Remove-Item -LiteralPath $BackupDir -Recurse -Force }
  Move-Program $AppDir $BackupDir
  Get-ChildItem -LiteralPath $NewDir -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $AppDir $_.Name) -Force
  }
  Write-Log 'files swapped; starting'
  if (Test-Path -LiteralPath $OkFile) { Remove-Item -LiteralPath $OkFile -Force }
  Start-App
  $deadline = (Get-Date).AddSeconds($OkTimeout)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $OkFile) {
      $ok = Get-Content -LiteralPath $OkFile -Raw | ConvertFrom-Json
      if ($ok.version -eq $Version) { Write-Log "ok: $Version started"; exit 0 }
    }
  }
  Write-Log "no healthy start in $OkTimeout s; rolling back"
  Stop-App
  Start-Sleep -Seconds 1
  $failed = $BackupDir + '-failed'
  if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
  Move-Program $AppDir $failed
  Get-ChildItem -LiteralPath $BackupDir -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $AppDir $_.Name) -Force
  }
  Start-App
  Write-Log 'rolled back'
  exit 1
} catch {
  Write-Log ('error: ' + $_.Exception.Message)
  # put back whatever made it to the backup, so the program is never left half-swapped
  try {
    if ((Test-Path -LiteralPath $BackupDir) -and -not (Test-Path -LiteralPath (Join-Path $AppDir 'package.json'))) {
      Get-ChildItem -LiteralPath $BackupDir -Force | ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination (Join-Path $AppDir $_.Name) -Force
      }
      Write-Log 'restored after error'
    }
    Start-App
  } catch { Write-Log ('restore failed: ' + $_.Exception.Message) }
  exit 2
}
