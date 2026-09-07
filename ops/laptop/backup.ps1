# Read-only source export. Run from an already linked Supabase project.
# Each dump is a separate snapshot; pause ALL app/GAS/cron writes for final cutover.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required by supabase db dump.' }
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is unavailable.' }
$backupDir = Join-Path $repoRoot ('.contingency/backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Push-Location $repoRoot
try {
    npx supabase db dump --linked --role-only -f (Join-Path $backupDir 'roles.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Role dump failed.' }
    npx supabase db dump --linked -f (Join-Path $backupDir 'schema.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Schema dump failed.' }
    npx supabase db dump --linked --data-only --use-copy -f (Join-Path $backupDir 'data.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Data dump failed.' }
    if (-not (Select-String -LiteralPath (Join-Path $backupDir 'data.sql') -Pattern 'COPY "?auth"?\."?users"? ' -Quiet)) {
        throw 'Auth users were not found in the dump. This is NOT a complete restore backup.'
    }
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupDir 'roles.sql'), (Join-Path $backupDir 'schema.sql'), (Join-Path $backupDir 'data.sql') |
        Select-Object @{Name='File';Expression={Split-Path $_.Path -Leaf}}, Hash |
        ConvertTo-Json | Set-Content (Join-Path $backupDir 'manifest.json') -Encoding utf8
    Write-Output "Export saved to $backupDir; restore rehearsal and row-count verification are still required."
} finally { Pop-Location }
