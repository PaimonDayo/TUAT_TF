# Bounded outage of this app's public relay only; never stops WSL or the database.
param([int]$Seconds = 260)
$ErrorActionPreference = 'Stop'
if ($Seconds -lt 210 -or $Seconds -gt 300) { throw 'Use 210-300 seconds' }
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskName = 'TUAT PC Backend Temporary'
$watchName = 'TUAT Failover Test Restore'
$expected = Join-Path $PSScriptRoot 'backend-task.ps1'
$task = Get-ScheduledTask -TaskName $taskName
if ($task.Actions.Arguments -notlike ('*"' + $expected + '"*') -or $task.State -ne 'Running') { throw 'Expected running backend task' }
if (Get-ScheduledTask -TaskName $watchName -ErrorAction SilentlyContinue) { throw 'Existing restore watchdog requires review' }
$restore = "Enable-ScheduledTask -TaskName '$taskName' | Out-Null; Start-ScheduledTask -TaskName '$taskName'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($restore))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds($Seconds + 60)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $watchName -Action $action -Trigger $trigger -Principal $task.Principal -Settings $settings | Out-Null
# Do not interrupt a cloud writeback that is already in progress.
$mirror = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\').Contains((Join-Path $PSScriptRoot 'cloud-mirror.mjs')) }
if ($mirror) { Unregister-ScheduledTask -TaskName $watchName -Confirm:$false; throw 'Cloud mirror is running; retry after completion' }
try {
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  Stop-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\').Contains((Join-Path $PSScriptRoot 'run-backend.mjs')) })
  $tunnels = @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { $_.ParentProcessId -in $nodes.ProcessId -and $_.ExecutablePath -eq (Join-Path $backendRoot '.contingency/bin/cloudflared.exe') })
  foreach ($item in @($tunnels) + @($nodes)) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($item.ProcessId)"
    if ($current -and $current.CreationDate -eq $item.CreationDate) { Stop-Process -Id $current.ProcessId -ErrorAction SilentlyContinue }
  }
  Write-Output ('Relay stopped for bounded failover test at ' + [DateTime]::UtcNow.ToString('o'))
  for ($elapsed=0; $elapsed -lt $Seconds; $elapsed+=20) { Start-Sleep -Seconds 20; Write-Output "Outage elapsed: $($elapsed+20)s" }
} finally {
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output ('Backend restoration requested at ' + [DateTime]::UtcNow.ToString('o'))
  # The watchdog stays until healthy recovery has been independently verified.
}
