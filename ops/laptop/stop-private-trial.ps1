param([ValidateSet('all','tunnel','gateway','app')][string]$Kind = 'all')
$ErrorActionPreference = 'Stop'
$trialRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$trialKinds = if ($Kind -eq 'all') { @('tunnel','gateway','app') } else { @($Kind) }
foreach ($trialKind in $trialKinds) {
  $trialPidFile = Join-Path $trialRoot ".contingency/private-$trialKind-process.json"
  if (!(Test-Path -LiteralPath $trialPidFile)) { continue }
  $saved = Get-Content -LiteralPath $trialPidFile -Raw | ConvertFrom-Json
  $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.pid)"
  if (!$running) { continue }
  if ($running.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$saved.created).ToUniversalTime().Ticks -or $running.CommandLine -ne $saved.command) { throw 'Process identity changed; refusing to stop it' }
  # Stop only descendants of the verified dedicated launcher, then that launcher.
  $allProcesses = @(Get-CimInstance Win32_Process)
  function Stop-TrialChildren([uint32]$trialParentId) {
    foreach ($child in $allProcesses | Where-Object ParentProcessId -eq $trialParentId) {
      Stop-TrialChildren $child.ProcessId
      $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)"
      if ($current -and $current.CreationDate -eq $child.CreationDate) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    }
  }
  Stop-TrialChildren $running.ProcessId
  Stop-Process -Id $running.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output "Stopped private $trialKind."
}
Write-Output 'The restored database and trial data are preserved. Cloud services were not changed.'
