param([Parameter(Mandatory=$true)][ValidateSet('tunnel','app','gateway')][string]$Kind)
$ErrorActionPreference = 'Stop'
$trialRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$trialDir = Join-Path $trialRoot '.contingency'
$trialPidFile = Join-Path $trialDir "private-$Kind-process.json"
if (Test-Path -LiteralPath $trialPidFile) {
  $previous = Get-Content -LiteralPath $trialPidFile -Raw | ConvertFrom-Json
  $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.pid)"
  if ($running -and $running.CreationDate.ToUniversalTime().Ticks -eq ([datetime]$previous.created).ToUniversalTime().Ticks) { throw 'Trial process already running' }
}
if ($Kind -eq 'tunnel') {
  $trialExecutable = Join-Path $trialDir 'bin/cloudflared.exe'
  $trialArguments = 'tunnel --no-autoupdate --url http://127.0.0.1:3108'
} else {
  $trialExecutable = (Get-Command node).Source
  $trialScript = if ($Kind -eq 'app') { 'ops/laptop/run-private-app.mjs' } else { 'ops/laptop/run-private-gateway.mjs' }
  $trialArguments = '"' + (Join-Path $trialRoot $trialScript) + '"'
  if ($Kind -eq 'app') { $trialArguments += ' start' }
}
$trialProcess = Start-Process -FilePath $trialExecutable -ArgumentList $trialArguments -WorkingDirectory $trialRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $trialDir "private-$Kind.stdout.log") -RedirectStandardError (Join-Path $trialDir "private-$Kind.stderr.log")
$trialInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($trialProcess.Id)"
if (!$trialInfo) { throw 'Trial process exited; inspect its local log' }
@{pid=$trialProcess.Id;created=$trialInfo.CreationDate.ToUniversalTime().ToString('o');command=$trialInfo.CommandLine;kind=$Kind} | ConvertTo-Json | Set-Content -LiteralPath $trialPidFile
Write-Output "Private $Kind process started."
