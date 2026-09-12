$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'server-profile.ps1')
$serverProfile = Get-TuatServerProfile
$distro = $serverProfile.wslDistro
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checks = @{}
$checks['wslDistro'] = $distro
$checks['windowsDocker'] = [bool](Get-Command docker -ErrorAction SilentlyContinue)
$checks['wslAvailable'] = [bool](Get-Command wsl -ErrorAction SilentlyContinue)
if ($checks['wslAvailable']) {
  $checks['wslDockerVersion'] = (& wsl -d $distro -u root -- docker version --format '{{.Server.Version}}' 2>$null | Out-String).Trim()
  $checks['wslComposeVersion'] = (& wsl -d $distro -u root -- docker compose version --short 2>$null | Out-String).Trim()
  $checks['wslCloudflared'] = (& wsl -d $distro -u root -- cloudflared --version 2>$null | Out-String).Trim()
  & wsl -d $distro -u root -- test -f "$($serverProfile.stackDir)/.env"
  $checks['wslEnvironmentConfigured'] = $LASTEXITCODE -eq 0
}
$checks['localAppEnvironmentPrepared'] = Test-Path -LiteralPath (Join-Path $repoRoot '.contingency/local-app.env')
$checks | ConvertTo-Json
