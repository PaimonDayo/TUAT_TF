param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
# Hardcoded local destination: never allow this helper to restore into hosted Supabase.
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'PostgreSQL 17 psql is required.' }
if (-not $env:PGPASSWORD) { throw 'Set PGPASSWORD to the local PostgreSQL password without printing it.' }
$backupDir = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $backupDir 'manifest.json') | ConvertFrom-Json
foreach ($name in @('roles.sql','schema.sql','data.sql')) {
    $entry = @($manifest | Where-Object File -eq $name)
    if ($entry.Count -ne 1 -or (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupDir $name)).Hash -ne $entry[0].Hash) { throw "Backup checksum failed: $name" }
}
$argsLocal = @('-X','--host=127.0.0.1','--port=15432','--username=postgres','--dbname=postgres','--set=ON_ERROR_STOP=on')
$existing = & psql @argsLocal -Atc "select to_regclass('public.profiles') is not null"
if ($LASTEXITCODE -ne 0 -or $existing -ne 'f') { throw 'Destination is unavailable or already contains application data; stopped.' }
# Session-wide trigger disable prevents restored notifications from sending webhooks.
& psql @argsLocal --single-transaction -f (Join-Path $backupDir 'roles.sql') -f (Join-Path $backupDir 'schema.sql') -c 'SET session_replication_role = replica' -f (Join-Path $backupDir 'data.sql') -c 'SET session_replication_role = origin'
if ($LASTEXITCODE -ne 0) { throw 'Restore failed and transaction was rolled back. Inspect the error; never retry with ON_ERROR_STOP disabled.' }
Write-Output 'Local restore finished. Do not expose it until cron/webhook destinations, Auth, RLS and row counts pass the runbook.'
