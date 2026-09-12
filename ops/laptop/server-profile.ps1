# PowerShell side of the server profile; mirrors server-profile.mjs.
# Dot-source it: . (Join-Path $PSScriptRoot 'server-profile.ps1')
#
# Defaults match the current production PC, so this behaves exactly as before
# when .contingency/server.json is absent. A different PC overrides the values
# there instead of editing scripts.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less files as ANSI.

$script:TuatRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))

function Get-TuatServerProfile {
  $values = @{ wslDistro = 'Ubuntu'; stackDir = '/opt/tuat-tf-supabase'; composeProject = 'tuat-contingency' }
  $path = Join-Path $script:TuatRepoRoot '.contingency/server.json'
  if (Test-Path -LiteralPath $path) {
    $file = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    foreach ($key in @($values.Keys)) {
      $value = $file.$key
      if (($value -is [string]) -and $value.Trim()) { $values[$key] = $value }
    }
  }
  if ($env:TUAT_WSL_DISTRO) { $values['wslDistro'] = $env:TUAT_WSL_DISTRO }
  # These are pasted into shell strings, so reject anything needing quoting.
  if ($values['stackDir'] -notmatch '^[A-Za-z0-9._/-]+$') { throw 'stackDir must not need shell quoting' }
  if ($values['composeProject'] -notmatch '^[A-Za-z0-9._-]+$') { throw 'composeProject must not need shell quoting' }
  [pscustomobject]$values
}

# WSL path of this checkout. Replaces the old hard-coded /mnt/c/... which only
# existed on the first production PC.
function Get-TuatWslRepoRoot {
  param([string]$Distro = (Get-TuatServerProfile).wslDistro)
  $path = (& wsl -d $Distro -- wslpath -a $script:TuatRepoRoot | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $path.StartsWith('/mnt/')) { throw 'Could not resolve this checkout inside WSL' }
  $path
}
