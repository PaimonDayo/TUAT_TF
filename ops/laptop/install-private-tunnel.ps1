$ErrorActionPreference = 'Stop'
$trialRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$trialBin = Join-Path $trialRoot '.contingency/bin'
New-Item -ItemType Directory -Force -Path $trialBin | Out-Null
$trialExe = Join-Path $trialBin 'cloudflared.exe'
$trialHash = '83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae'
if (!(Test-Path -LiteralPath $trialExe)) {
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-windows-amd64.exe' -OutFile $trialExe
}
if ((Get-FileHash -LiteralPath $trialExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $trialHash) { throw 'Official cloudflared SHA256 mismatch' }
& $trialExe --version
