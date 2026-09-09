$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$networkConfig = Join-Path $env:USERPROFILE '.wslconfig'
$networkBackup = Join-Path $backendRoot '.contingency/backend/wslconfig-before.json'
if (Test-Path -LiteralPath $networkBackup) { throw 'Network configuration already prepared; preserve its original backup' }
if (Test-Path -LiteralPath $networkConfig) { throw 'Existing WSL settings require a reviewed merge' }
@{path=$networkConfig;existed=$false} | ConvertTo-Json | Set-Content -LiteralPath $networkBackup
[IO.File]::WriteAllText($networkConfig, "[wsl2]`nnetworkingMode=mirrored`ndnsTunneling=true`nfirewall=true`n", [Text.UTF8Encoding]::new($false))
Write-Output 'Prepared mirrored WSL networking with DNS tunneling and firewall enabled; restart required.'
