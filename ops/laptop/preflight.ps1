$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checks = @{}
$checks['windowsDocker'] = [bool](Get-Command docker -ErrorAction SilentlyContinue)
$checks['wslAvailable'] = [bool](Get-Command wsl -ErrorAction SilentlyContinue)
if ($checks['wslAvailable']) {
  $checks['wslDockerVersion'] = (& wsl -d Ubuntu -u root -- docker version --format '{{.Server.Version}}' 2>$null | Out-String).Trim()
  $checks['wslComposeVersion'] = (& wsl -d Ubuntu -u root -- docker compose version --short 2>$null | Out-String).Trim()
  $checks['wslCloudflared'] = (& wsl -d Ubuntu -u root -- cloudflared --version 2>$null | Out-String).Trim()
  & wsl -d Ubuntu -u root -- test -f /opt/tuat-tf-supabase/.env
  $checks['wslEnvironmentConfigured'] = $LASTEXITCODE -eq 0
}
$checks['localAppEnvironmentPrepared'] = Test-Path -LiteralPath (Join-Path $repoRoot '.contingency/local-app.env')
$checks | ConvertTo-Json
