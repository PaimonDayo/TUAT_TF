$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$backendDirectory = Join-Path $backendRoot '.contingency/backend'
$taskMutex = [Threading.Mutex]::new($false, 'Local\TUAT-PC-Backend')
try { if (!$taskMutex.WaitOne(0)) { exit 0 } } catch [Threading.AbandonedMutexException] { }
$taskHolder = $null
try {
  Set-Location -LiteralPath $backendRoot
  Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class PcBackendPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
  # Keep this temporary server awake; the request is automatically released on exit.
  [void][PcBackendPower]::SetThreadExecutionState(2147483649)
  # The holder is a sibling of the startup script so -Wait does not wait for it.
  $taskHolder = Start-Process -FilePath wsl.exe -ArgumentList '-d Ubuntu -u root -- sh "/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/hold-wsl.sh"' -WindowStyle Hidden -PassThru
  $runtimeProcess = Start-Process -FilePath powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'runtime.ps1') + '" start -NoHold') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $backendDirectory 'runtime-start.log') -RedirectStandardError (Join-Path $backendDirectory 'runtime-start-error.log')
  if ($runtimeProcess.ExitCode -ne 0) { throw 'PC runtime did not start' }
  $nodePath = (Get-Content -LiteralPath (Join-Path $backendDirectory 'task-runtime.json') -Raw | ConvertFrom-Json).node
  # Recover children left behind when Windows terminates the previous task host.
  $orphans = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\').Contains((Join-Path $PSScriptRoot 'run-backend.mjs')) })
  foreach ($orphan in $orphans) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($orphan.ProcessId)" | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.ExecutablePath -eq (Join-Path $backendRoot '.contingency/bin/cloudflared.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $orphan.ProcessId -ErrorAction SilentlyContinue
  }
  while ($true) {
    $backendStarted = [DateTime]::UtcNow
    $backendProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $PSScriptRoot 'run-backend.mjs') + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendDirectory 'task.log') -RedirectStandardError (Join-Path $backendDirectory 'task-error.log')
    while (!$backendProcess.WaitForExit(10000)) {
      $lastHeartbeat = $backendStarted
      try {
        $heartbeat = Get-Content -LiteralPath (Join-Path $backendDirectory 'runtime-status.json') -Raw | ConvertFrom-Json
        $observed = [DateTime]::Parse($heartbeat.checkedAt).ToUniversalTime()
        if ($observed -gt $lastHeartbeat) { $lastHeartbeat = $observed }
      } catch { }
      if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -gt 150) {
        @{at=[DateTime]::UtcNow.ToString('o');reason='stale_endpoint';lastHeartbeat=$lastHeartbeat.ToString('o')} | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $backendDirectory 'task-restarts.jsonl') -Encoding UTF8
        # Only terminate the tunnel belonging to this exact app process.
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $($backendProcess.Id)" | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.ExecutablePath -eq (Join-Path $backendRoot '.contingency/bin/cloudflared.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        $backendProcess.Kill()
        break
      }
    }
    Start-Sleep -Seconds 5
  }
} catch {
  @{at=(Get-Date).ToUniversalTime().ToString('o');error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backendDirectory 'task-failure.json')
  exit 1
} finally {
  if ($backendProcess -and !$backendProcess.HasExited) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($backendProcess.Id)" | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.ExecutablePath -eq (Join-Path $backendRoot '.contingency/bin/cloudflared.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    $backendProcess.Kill()
  }
  [void][PcBackendPower]::SetThreadExecutionState(2147483648)
  if ($taskHolder -and !$taskHolder.HasExited) { $taskHolder.Kill() }
  $taskMutex.ReleaseMutex(); $taskMutex.Dispose()
}
