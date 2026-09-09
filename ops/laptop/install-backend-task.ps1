$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$backendDirectory = Join-Path $backendRoot '.contingency/backend'
$taskName = 'TUAT PC Backend Temporary'
@{node=(Get-Command node).Source} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backendDirectory 'task-runtime.json')
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'backend-task.ps1') + '"') -WorkingDirectory $backendRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -ne $action.Arguments) { throw 'An unrelated task uses this name' }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'One-week TUAT PC backend; restart on failure while owner is logged in. Remove after verified Supabase return.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Temporary backend supervisor registered and started in the owner session.'
