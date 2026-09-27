param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($config.enabled){throw 'Install before activation'}
& $NodePath (Join-Path $PSScriptRoot 'run.mjs') --check $ConfigPath
if($LASTEXITCODE -ne 0){throw 'Candidate validation failed'}
$name='TUAT PC Jobs'
if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Existing task requires review'}
$backend=Get-ScheduledTask -TaskName 'TUAT PC Backend Temporary'
if($backend.State -ne 'Running'){throw 'Existing backend must be running'}
$principal=New-ScheduledTaskPrincipal -UserId $backend.Principal.UserId -LogonType S4U -RunLevel Highest
$script=Join-Path $PSScriptRoot 'task.ps1'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$script+'" -NodePath "'+$NodePath+'" -ConfigPath "'+$ConfigPath+'"') -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $settings | Out-Null
Disable-ScheduledTask -TaskName $name | Out-Null
if(Get-ScheduledTask -TaskName 'TUAT Failover Test Restore' -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName 'TUAT Failover Test Restore' -Confirm:$false}
Write-Output 'PC jobs task installed disabled. Test recovery task removed.'
