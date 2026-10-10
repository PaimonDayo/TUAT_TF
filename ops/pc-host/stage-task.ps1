param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$Account,
  [Parameter(Mandatory=$true)][string]$DevelopmentAccount,
  [Parameter(Mandatory=$true)][string]$PowerShellPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
foreach($taskPath in @($NodePath,$ConfigPath,$PowerShellPath,$OutputPath)){if(![IO.Path]::IsPathFullyQualified($taskPath)){throw 'Absolute paths required'}}
$accountProof=& (Join-Path $PSScriptRoot 'account-preflight.ps1') -NodePath $NodePath -ConfigPath $ConfigPath -RuntimeAccount $Account -DevelopmentAccount $DevelopmentAccount -PowerShellPath $PowerShellPath -PassThru
if(!$accountProof.accepted){throw 'Dedicated account preflight failed'}
$taskConfig=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($taskConfig.enabled){throw 'Stage with candidate disabled'}
if(Test-Path -LiteralPath $OutputPath){throw 'Preserve existing task draft'}
& $NodePath (Join-Path $PSScriptRoot 'run.mjs') $ConfigPath
if($LASTEXITCODE -ne 0){throw 'Prepared release validation failed'}
$taskRun=Join-Path $PSScriptRoot 'task.ps1'
if(@($NodePath,$ConfigPath,$taskRun,$PowerShellPath,$Account,$DevelopmentAccount) | Where-Object {$_ -match '["\r\n]'}){throw 'Invalid task argument'}
if([IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath((Split-Path -Path $OutputPath -Parent))) -ne [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($taskConfig.stateDirectory))){throw 'Task draft must stay in protected host state'}
$taskAction=New-ScheduledTaskAction -Execute $PowerShellPath -Argument ('-NoProfile -NonInteractive -File "'+$taskRun+'" -NodePath "'+$NodePath+'" -ConfigPath "'+$ConfigPath+'" -RuntimeAccount "'+$Account+'" -DevelopmentAccount "'+$DevelopmentAccount+'" -PowerShellPath "'+$PowerShellPath+'"') -WorkingDirectory $taskConfig.releaseDirectory
$taskPrincipal=New-ScheduledTaskPrincipal -UserId $Account -LogonType S4U -RunLevel Limited
$taskSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskDraft=New-ScheduledTask -Action $taskAction -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $taskPrincipal -Settings $taskSettings
$taskDraft.Settings.Enabled=$false
# This writes a reviewable disabled XML only. No task registration or other service changes.
$taskXml=[xml](Export-ScheduledTask -InputObject $taskDraft)
$taskXml.Save($OutputPath)
Write-Output 'Disabled task XML prepared; no task installed or started.'
