$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checks = @{}
foreach ($tool in @('docker', 'cloudflared', 'psql', 'npx')) {
    $checks[$tool] = [bool](Get-Command $tool -ErrorAction SilentlyContinue)
}
$checks['runtimePrepared'] = Test-Path -LiteralPath (Join-Path $repoRoot '.contingency/runtime/docker-compose.yml')
$checks['environmentConfigured'] = Test-Path -LiteralPath (Join-Path $repoRoot '.contingency/runtime/.env')
if ($checks['docker']) {
    docker info --format '{{.ServerVersion}}'
    $checks['dockerDaemon'] = ($LASTEXITCODE -eq 0)
    docker compose version --short
    $checks['composeAvailable'] = ($LASTEXITCODE -eq 0)
}
$checks | ConvertTo-Json
