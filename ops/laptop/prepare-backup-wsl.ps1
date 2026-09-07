param([switch]$RefreshConnection)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $repoRoot
try {
  $parts = if ($RefreshConnection) { @('data') } else { @('schema','roles','data') }
  foreach ($part in $parts) {
    $arguments = @('supabase','db','dump','--linked','--dry-run')
    if ($part -eq 'roles') { $arguments += '--role-only' }
    if ($part -eq 'data') { $arguments += @('--data-only','--use-copy') }
    & npx @arguments | Set-Content -LiteralPath ".contingency/$part-dump-command.sh" -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare $part dump" }
  }
  # CLI login credentials can rotate between invocations; use the final connection for all parts.
  $connectionLines = Get-Content '.contingency/data-dump-command.sh' | Where-Object { $_ -match '^export PG' }
  if ($connectionLines.Count -lt 4) { throw 'Unexpected dump command format' }
  # WSL/Docker has no IPv6 route here. Use the linked session pooler over IPv4.
  $pooler = [Uri](Get-Content 'supabase/.temp/pooler-url' -Raw).Trim()
  $projectRef = (Get-Content 'supabase/.temp/project-ref' -Raw).Trim()
  if ($pooler.Host -notmatch '^[a-z0-9.-]+\.pooler\.supabase\.com$' -or $projectRef -notmatch '^[a-z]+$') { throw 'Unexpected linked pooler' }
  $connectionLines = @($connectionLines | ForEach-Object {
    if ($_ -match '^export PGHOST=') { 'export PGHOST="' + $pooler.Host + '"' }
    elseif ($_ -match '^export PGPORT=') { 'export PGPORT="5432"' }
    elseif ($_ -match '^export PGUSER="([a-z_]+)"$') { 'export PGUSER="' + $Matches[1] + '.' + $projectRef + '"' }
    else { $_ }
  })
  foreach ($part in @('schema','roles','data')) {
    $file = Join-Path $repoRoot ".contingency/$part-dump-command.sh"
    $lines = Get-Content -LiteralPath $file
    if ($lines[0] -ne '#!/usr/bin/env bash') { throw 'Unexpected dump command format' }
    $result = @($lines[0], 'set -euo pipefail') + $connectionLines + @($lines | Select-Object -Skip 2 | Where-Object { $_ -notmatch '^export PG' })
    [IO.File]::WriteAllText($file, ($result -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  }
  Write-Output 'Prepared read-only dump commands. Run backup-wsl.sh promptly; connection credentials expire.'
} finally { Pop-Location }
