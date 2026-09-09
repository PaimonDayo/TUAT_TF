$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$backendDir = Join-Path $backendRoot '.contingency/backend'
$backendPidPath = Join-Path $backendDir 'process.json'
if (Test-Path -LiteralPath $backendPidPath) {
  $old = Get-Content -LiteralPath $backendPidPath -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($old.pid)"
  if ($process -and $process.CreationDate.ToUniversalTime().Ticks -eq ([datetime]$old.created).ToUniversalTime().Ticks) { throw 'Backend supervisor already running' }
}
$backendScript = Join-Path $backendRoot 'ops/laptop/run-backend.mjs'
$backendProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + $backendScript + '"') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendDir 'stdout.log') -RedirectStandardError (Join-Path $backendDir 'stderr.log')
$info = Get-CimInstance Win32_Process -Filter "ProcessId = $($backendProcess.Id)"
if (!$info) { throw 'Backend supervisor exited; inspect its local log' }
@{pid=$info.ProcessId;created=$info.CreationDate.ToUniversalTime().ToString('o');command=$info.CommandLine} | ConvertTo-Json | Set-Content -LiteralPath $backendPidPath
Write-Output 'Backend supervisor started hidden; production is not switched.'
