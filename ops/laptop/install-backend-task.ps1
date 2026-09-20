<#
  .SYNOPSIS
  Register the supervisor task that keeps the PC backend running.

  .PARAMETER WithoutLogon
  Run the task whether or not the owner is signed in (S4U: no password is stored).
  Check it first with ops/laptop/check-logon-free-start.ps1, because WSL has to be
  reachable from session 0. Without this switch the task only runs inside the
  owner's desktop session, so a reboot leaves the backend down until someone signs
  in - which is what took production down for about six and a half hours on
  2026-09-20. Re-run without the switch to go back.
#>
param([switch]$WithoutLogon)

$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$backendDirectory = Join-Path $backendRoot '.contingency/backend'
$taskName = 'TUAT PC Backend Temporary'
# Keep the interpreter the running backend already uses. `node` on PATH can be an
# older install (an elevated shell often misses the version manager's shims), and
# writing that here would hand the supervisor a Node the app cannot run on.
$runtimeFile = Join-Path $backendDirectory 'task-runtime.json'
$nodePath = if (Test-Path -LiteralPath $runtimeFile) { (Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json).node } else { $null }
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node).Source }
$nodeMajor = [int](((& $nodePath -v) -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 20) { throw "This backend needs Node 20 or newer; $nodePath is v$nodeMajor" }
@{node=$nodePath} | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'backend-task.ps1') + '"') -WorkingDirectory $backendRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$logonType = if ($WithoutLogon) { 'S4U' } else { 'Interactive' }
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType $logonType -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -ne $action.Arguments) { throw 'An unrelated task uses this name' }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $('TUAT PC backend supervisor; restarts on failure. ' + $(if ($WithoutLogon) { 'Runs without a sign-in (S4U).' } else { 'Runs only inside the owner session.' })) -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output ("Backend supervisor registered ({0}) and started." -f $(if ($WithoutLogon) { 'runs without a sign-in' } else { 'owner session only' }))
