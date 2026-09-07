param([ValidateSet('start','stop','status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$pidFile = Join-Path $repoRoot '.contingency/wsl-hold.pid'
$wslRoot = (& wsl -d Ubuntu -- wslpath -a $repoRoot | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $wslRoot.StartsWith('/mnt/')) { throw 'Could not resolve WSL checkout' }
$holdScript = "$wslRoot/ops/laptop/hold-wsl.sh"
$holder = $null
if (Test-Path -LiteralPath $pidFile) {
  $holderId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $holderId"
  if ($candidate.Name -eq 'wsl.exe' -and $candidate.CommandLine.Contains($holdScript)) { $holder = $candidate }
}
if ($Action -eq 'start' -and -not $holder) {
  $process = Start-Process -FilePath wsl.exe -ArgumentList "-d Ubuntu -u root -- sh `"$holdScript`"" -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id
}
& wsl -d Ubuntu -u root -- sh "$wslRoot/ops/laptop/runtime-wsl.sh" $Action
if ($LASTEXITCODE -ne 0) { throw "Supabase $Action failed" }
if ($Action -eq 'stop' -and $holder) {
  Stop-Process -Id $holder.ProcessId
  Remove-Item -LiteralPath $pidFile
}
