<#
  「Windowsにログインしていなくてもサーバーを動かせるか」を、本番のタスクに触らずに確かめる。

  いまの起動タスクは LogonType=Interactive で登録されていて、所有者がログインしている
  セッションの中でしか動かない。2026-09-20の夜にPCが再起動し、翌朝ログインするまでの
  約6時間半、本番が止まったのはこれが理由。

  「ログオンしていなくても実行する」へ変えられるかどうかは、WSLがデスクトップの無い
  セッション0で動くかに懸かっている。ここではそれを確かめるためだけの**読み取り専用の
  別タスク**を一時的に作り、docker ps を実行させて結果を見てから消す。
  本番のタスク・コンテナ・データには一切触らない。

  管理者のPowerShellで実行する:
    powershell -NoProfile -File ops/laptop/check-logon-free-start.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'server-profile.ps1')
$serverProfile = Get-TuatServerProfile
$taskName = 'TUAT Backend Logon Test'
$productionTask = 'TUAT PC Backend Temporary'

$elevated = (New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
  throw 'このスクリプトは管理者のPowerShellから実行してください（タスクの登録に管理者権限が要ります）。'
}
if ($taskName -eq $productionTask) { throw 'Refusing to touch the production task' }

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$logPath = Join-Path $repoRoot '.contingency/logon-free-test.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
if (Test-Path $logPath) { Remove-Item $logPath }

# セッション0から見えるかどうかだけを見る。書き込み・再起動は一切しない。
$probe = '$out = & wsl.exe -d ' + $serverProfile.wslDistro + ' -- docker ps --format "{{.Names}}" 2>&1; ' +
         '@{at=(Get-Date).ToString("o"); session=[Diagnostics.Process]::GetCurrentProcess().SessionId; ' +
         'exit=$LASTEXITCODE; containers=@($out | Where-Object { $_ -match "supabase|realtime" }).Count; ' +
         'output=($out | Select-Object -First 3) -join "; "} | ConvertTo-Json -Compress | ' +
         'Set-Content -LiteralPath "' + $logPath + '" -Encoding UTF8'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' + $probe.Replace('"', '\"') + '"')
# S4U = パスワードを預けずに「ログオンしていなくても実行する」。ネットワーク資格情報は付かないが、
# WSLもcloudflaredもローカル起動と外向き通信だけなので足りる。
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(5)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description 'Read-only check: can this account reach WSL and Docker without an interactive desktop? Safe to delete.' -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output 'セッション0で docker ps を実行しています…'
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $logPath) { break }
  }
  if (-not (Test-Path $logPath)) {
    Write-Output '結果: 取得できませんでした（タスクが結果を書けていません）。自動ログインの方が確実です。'
    return
  }
  $result = Get-Content -LiteralPath $logPath -Raw | ConvertFrom-Json
  Write-Output ("実行セッション: {0}（0ならデスクトップ無しで動いています）" -f $result.session)
  Write-Output ("docker ps の終了コード: {0} / 見えたコンテナ: {1}個" -f $result.exit, $result.containers)
  if ($result.exit -eq 0 -and $result.containers -ge 10) {
    Write-Output '判定: ログインなしでもWSLとDockerに届いています。本番タスクを切り替えられます。'
    Write-Output '  powershell -NoProfile -File ops/laptop/install-backend-task.ps1 -WithoutLogon'
  } else {
    Write-Output '判定: セッション0からはWSLに届きませんでした。自動ログインの方式を選んでください。'
    Write-Output ("  参考出力: {0}" -f $result.output)
  }
} finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'テスト用のタスクは削除しました。本番のタスクは触っていません。'
}
