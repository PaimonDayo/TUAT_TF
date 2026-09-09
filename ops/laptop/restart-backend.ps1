$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskName = 'TUAT PC Backend Temporary'
$expectedTask = Join-Path $PSScriptRoot 'backend-task.ps1'
$task = Get-ScheduledTask -TaskName $taskName
if ($task.Actions.Arguments -notlike ('*"' + $expectedTask + '"*')) { throw 'Unexpected task action' }
Disable-ScheduledTask -TaskName $taskName | Out-Null
try {
  Stop-ScheduledTask -TaskName $taskName
  for ($attempt=0; $attempt -lt 20 -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running'; $attempt++) { Start-Sleep -Milliseconds 250 }
  $appNodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine.Replace('/','\').Contains((Join-Path $PSScriptRoot 'run-backend.mjs')) })
  $tunnels = @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { $_.ParentProcessId -in $appNodes.ProcessId -and $_.ExecutablePath -eq (Join-Path $backendRoot '.contingency/bin/cloudflared.exe') })
  foreach ($process in @($tunnels) + @($appNodes)) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)"
    if ($current -and $current.CreationDate -eq $process.CreationDate) { Stop-Process -Id $current.ProcessId -ErrorAction SilentlyContinue }
  }
} finally {
  Enable-ScheduledTask -TaskName $taskName | Out-Null
}
Start-ScheduledTask -TaskName $taskName
Write-Output 'Dedicated backend restarted. The database and other Node applications were preserved.'
