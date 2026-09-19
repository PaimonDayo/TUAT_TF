<#
  サーバーPCを、止めずに電力だけ下げる設定。

  このPCは本番のDB/Authを動かしているので、スリープ・休止は入れない（入れたら部員が
  アプリを開けなくなる）。代わりに、つけっぱなしでも減らせるところだけを触る。

    1. ディスプレイを数分で消す（4Kモニタは20〜40W。誰も見ていない時間が一番長い）
    2. CPUのターボを使わない（最大99%。基本クロックは据え置きで、跳ね上がる分だけ止める）
    3. PCI Expressの省電力を最大にする
    4. スリープ・休止は「しない」に固定する（今は常駐プロセスが抑止しているだけなので、
       それが落ちた隙に寝てしまうと本番が止まる。省電力ではなく取りこぼし防止）

  変更前の値は .contingency/power-saving-before.json に控え、restore で元に戻せる。
  バッテリー側(DC)の設定は触らない。

  使い方:
    powershell -NoProfile -File ops/laptop/power-saving.ps1 status
    powershell -NoProfile -File ops/laptop/power-saving.ps1 apply
    powershell -NoProfile -File ops/laptop/power-saving.ps1 apply -DisplayOffMinutes 3 -MaxCpuPercent 70
    powershell -NoProfile -File ops/laptop/power-saving.ps1 restore
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('status', 'apply', 'restore')][string]$Action = 'status',
  [ValidateRange(1, 60)][int]$DisplayOffMinutes = 5,
  # 99 = ターボだけ止める（基本クロックは出る）。もっと静かにしたいときは 50〜70。
  [ValidateRange(20, 100)][int]$MaxCpuPercent = 99
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backupPath = Join-Path $repo '.contingency\power-saving-before.json'

# 設定名は powercfg のエイリアス。GUIDはWindowsの標準値。
$settings = [ordered]@{
  'ディスプレイの電源を切るまで' = @{ Sub = 'SUB_VIDEO';       Setting = 'VIDEOIDLE';       Unit = '秒' }
  'スリープするまで'             = @{ Sub = 'SUB_SLEEP';       Setting = 'STANDBYIDLE';     Unit = '秒' }
  '休止状態にするまで'           = @{ Sub = 'SUB_SLEEP';       Setting = 'HIBERNATEIDLE';   Unit = '秒' }
  '最大のプロセッサの状態'       = @{ Sub = 'SUB_PROCESSOR';   Setting = 'PROCTHROTTLEMAX'; Unit = '%' }
  'PCI Expressの省電力'          = @{ Sub = 'SUB_PCIEXPRESS';  Setting = 'ASPM';            Unit = '段階' }
}

function Get-AcValue($sub, $setting) {
  $lines = powercfg /query SCHEME_CURRENT $sub $setting 2>$null
  if (-not $lines) { return $null }
  # 日本語「現在の AC 電源設定のインデックス」/ 英語 "Current AC Power Setting Index" の両方に当てる。
  foreach ($line in $lines) {
    if ($line -match '\sAC\s.*:\s*(0x[0-9a-fA-F]+)') { return [Convert]::ToInt32($Matches[1], 16) }
  }
  return $null
}

function Set-AcValue($sub, $setting, $value) {
  powercfg /setacvalueindex SCHEME_CURRENT $sub $setting $value | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "powercfg failed for $sub/$setting" }
}

function Show-Current($title) {
  Write-Output $title
  foreach ($name in $settings.Keys) {
    $s = $settings[$name]
    $value = Get-AcValue $s.Sub $s.Setting
    $shown = if ($null -eq $value) { '(この機種では設定できません)' }
             elseif ($value -eq 0 -and $s.Unit -eq '秒') { 'しない' }
             else { "$value$($s.Unit)" }
    Write-Output ("  {0}: {1}" -f $name, $shown)
  }
}

switch ($Action) {
  'status' {
    Show-Current '今のAC電源設定:'
    if (Test-Path $backupPath) { Write-Output "変更前の控え: $backupPath" }
    else { Write-Output '変更前の控えはまだありません（apply すると作られます）。' }
  }

  'apply' {
    if (-not (Test-Path $backupPath)) {
      $before = [ordered]@{ savedAt = (Get-Date).ToString('o'); values = [ordered]@{} }
      foreach ($name in $settings.Keys) {
        $s = $settings[$name]
        $before.values[$s.Setting] = Get-AcValue $s.Sub $s.Setting
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupPath) | Out-Null
      $before | ConvertTo-Json -Depth 4 | Set-Content -Path $backupPath -Encoding UTF8
      Write-Output "変更前の値を控えました: $backupPath"
    } else {
      Write-Output "変更前の控えは既にあります（上書きしません）: $backupPath"
    }

    $wanted = @{
      VIDEOIDLE      = $DisplayOffMinutes * 60
      STANDBYIDLE    = 0
      HIBERNATEIDLE  = 0
      PROCTHROTTLEMAX = $MaxCpuPercent
      ASPM           = 2
    }
    foreach ($name in $settings.Keys) {
      $s = $settings[$name]
      if ($null -eq (Get-AcValue $s.Sub $s.Setting)) { continue }
      Set-AcValue $s.Sub $s.Setting $wanted[$s.Setting]
    }
    powercfg /setactive SCHEME_CURRENT | Out-Null
    Show-Current '省電力の設定にしました。今のAC電源設定:'
    Write-Output 'スリープと休止は「しない」のままにしてください（本番が止まります）。'
  }

  'restore' {
    if (-not (Test-Path $backupPath)) { throw "変更前の控えがありません: $backupPath" }
    $before = Get-Content -Path $backupPath -Raw | ConvertFrom-Json
    foreach ($name in $settings.Keys) {
      $s = $settings[$name]
      $value = $before.values.$($s.Setting)
      if ($null -eq $value) { continue }
      Set-AcValue $s.Sub $s.Setting $value
    }
    powercfg /setactive SCHEME_CURRENT | Out-Null
    Show-Current '控えの値に戻しました。今のAC電源設定:'
  }
}
