param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$Account,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
foreach($taskPath in @($NodePath,$ConfigPath,$OutputPath)){if(![IO.Path]::IsPathRooted($taskPath)){throw 'Absolute paths required'}}
$taskConfig=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($taskConfig.enabled){throw 'Stage with candidate disabled'}
if(Test-Path -LiteralPath $OutputPath){throw 'Preserve existing task draft'}
& $NodePath (Join-Path $PSScriptRoot 'run.mjs') $ConfigPath
if($LASTEXITCODE -ne 0){throw 'Prepared release validation failed'}
$taskRun=Join-Path $PSScriptRoot 'task.ps1'
if(@($NodePath,$ConfigPath,$taskRun) | Where-Object {$_ -match '["\r\n]'}){throw 'Invalid task argument'}
$taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -File "'+$taskRun+'" -NodePath "'+$NodePath+'" -ConfigPath "'+$ConfigPath+'"') -WorkingDirectory $taskConfig.releaseDirectory
$taskPrincipal=New-ScheduledTaskPrincipal -UserId $Account -LogonType S4U -RunLevel Limited
$taskSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskDraft=New-ScheduledTask -Action $taskAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $taskPrincipal -Settings $taskSettings
$taskDraft.Settings.Enabled=$false
# This writes a reviewable disabled XML only. No task registration or other service changes.
$taskXml=[xml](Export-ScheduledTask -InputObject $taskDraft)
$taskXml.Save($OutputPath)
Write-Output 'Disabled task XML prepared; no task installed or started.'
