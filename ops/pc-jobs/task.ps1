param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
# Optional dedicated task action, never installed/executed by code import.
# Config false/stale journal/lock fails closed. External heartbeat expires.
$jobsMutex = [Threading.Mutex]::new($false, 'Local\TUAT-PC-Jobs')
try { if (!$jobsMutex.WaitOne(0)) { exit 1 } } catch [Threading.AbandonedMutexException] { }
try {
  & $NodePath (Join-Path $PSScriptRoot 'run.mjs') --run $ConfigPath
  exit $LASTEXITCODE
} finally { $jobsMutex.ReleaseMutex(); $jobsMutex.Dispose() }
