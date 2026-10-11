param([switch]$Execute, [switch]$Api, [string]$NodePath = 'C:\Users\rainb\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
$ErrorActionPreference = 'Stop'
$candidateRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$image = 'supabase/postgres:17.6.1.136'
$imageId = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
$authImage = 'supabase/gotrue:v2.196.0'
$authImageId = 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'
$storageImage = 'supabase/storage-api:v1.73.1'
$storageImageId = 'sha256:c24fb33cc2fa38d0f9582a30312907fc56da333fb9ba0646833186197e4982f3'
$owner = 'codex-auth-db-review'
$generation = [guid]::NewGuid().ToString('N')
$name = "codex-auth-dbreview-$generation"
$volume = "$name-data"
$network = "$name-internal"
$authName = "$name-auth-migrate"
$storageName = "$name-storage-source"
$cachePath = Join-Path $PSScriptRoot ".cache/$generation"
$attempted = [ordered]@{ pg = $false; auth = $false; storage = $false; api = $false; volume = $false; network = $false }
$report = [ordered]@{ version = 1; mode = $(if ($Api) { 'api' } else { 'sql' }); owner = $owner; generation = $generation; image = $image; imageId = $imageId; authImage = $authImage; authImageId = $authImageId; storageImage = $storageImage; storageImageId = $storageImageId; network = 'internal'; publishedPorts = @(); productionAccess = $false; providerCalls = $false; securityMigrationsSkipped = @(); migrations = @(); tests = @(); cleanup = $false }

function Docker([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments) {
  $text = & wsl.exe -d Ubuntu -- docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($text | Out-String).Trim()) }
  return (($text | Out-String).Trim())
}
function Sql([string]$Database, [string]$Statement) {
  return Docker @('exec', $name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', $Database, '-At', '-c', $Statement)
}
function SqlFile([string]$Database, [string]$Path) {
  return Docker @('exec', $name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', $Database, '-f', $Path)
}

if (!$Execute) {
  [ordered]@{ execute = $false; mode = $report.mode; image = $image; resourcePrefix = 'codex-auth-dbreview-'; network = 'internal'; database = 'tuat_rls_review'; productionAccess = $false; plan = $(if ($Api) { 'Fresh full candidate schema; actual pinned PostgREST JWT/HTTP/RLS with ephemeral test keys; separate api-result.json; exact owned cleanup.' } else { 'Initialize cached Supabase baseline plus actual cached Auth/Storage migrations; apply every candidate migration; run synthetic RLS SQL; delete exact owned container, volume and internal network.' }) } | ConvertTo-Json -Depth 4
  exit 0
}

try {
  if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Explicit Node runtime required for exact owned cleanup' }
  if ((Docker @('image', 'inspect', $image, '--format', '{{.Id}}')) -ne $imageId) { throw 'Cached image pin mismatch' }
  if ((Docker @('image', 'inspect', $authImage, '--format', '{{.Id}}')) -ne $authImageId) { throw 'Cached Auth image pin mismatch' }
  if ((Docker @('image', 'inspect', $storageImage, '--format', '{{.Id}}')) -ne $storageImageId) { throw 'Cached Storage image pin mismatch' }
  if (Docker @('container', 'ls', '-a', '--filter', "name=^/$name`$", '--format', '{{.ID}}')) { throw 'Fresh container name already exists' }
  foreach ($transient in @($authName, $storageName, "$name-postgrest")) {
    if (Docker @('container', 'ls', '-a', '--filter', "name=^/$transient`$", '--format', '{{.ID}}')) { throw 'Fresh transient container name already exists' }
  }
  if (Docker @('volume', 'ls', '--filter', "name=^$volume`$", '--format', '{{.Name}}')) { throw 'Fresh volume name already exists' }
  if (Docker @('network', 'ls', '--filter', "name=^$network`$", '--format', '{{.Name}}')) { throw 'Fresh internal network name already exists' }
  if (!$candidateRoot.StartsWith('D:\TUAT_TF\.worktrees\')) { throw 'Dedicated candidate source required' }
  $supabasePath = '/mnt/d/' + (Join-Path $candidateRoot 'supabase').Substring(3).Replace('\','/')
  if (!$supabasePath.StartsWith('/mnt/d/TUAT_TF/.worktrees/')) { throw 'Dedicated candidate Supabase source required' }
  $reviewPath = '/mnt/d/' + $PSScriptRoot.Substring(3).Replace('\','/')
  if (!$reviewPath.StartsWith($supabasePath.Substring(0, $supabasePath.Length - 'supabase'.Length))) { throw 'Review source escaped candidate' }
  $attempted.network = $true
  Docker @('network', 'create', '--internal', '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", $network) | Out-Null
  $attempted.volume = $true
  Docker @('volume', 'create', '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", $volume) | Out-Null
  $attempted.pg = $true
  Docker @('run', '-d', '--name', $name, '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", '--network', $network, '--memory', '512m', '--cpus', '1',
    '--mount', "type=volume,src=$volume,dst=/var/lib/postgresql/data", '--mount', "type=bind,src=$supabasePath,dst=/review/supabase,readonly", '--mount', "type=bind,src=$reviewPath,dst=/review/db-review,readonly",
    '-e', 'POSTGRES_PASSWORD=synthetic-review-local-only', '-e', 'POSTGRES_DB=tuat_rls_review', $image,
    'postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=*', '-c', 'cron.database_name=tuat_rls_review', '-c', 'cron.launch_active_jobs=off') | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    # The entrypoint's temporary socket-only server must finish platform SQL
    # before companion migrations connect. Probe final TCP with synthetic creds.
    try {
      if ((Docker @('exec', '-e', 'PGPASSWORD=synthetic-review-local-only', $name, 'psql', '-X', '-q', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'tuat_rls_review', '-At', '-c', 'SELECT 1')) -eq '1') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Fresh cached PostgreSQL did not initialize within 45 seconds' }
  $identity = (Docker @('inspect', '--format', '{{json .Config.Labels}}', $name)) | ConvertFrom-Json
  if ($identity.'tuat.owner' -ne $owner -or $identity.'tuat.generation' -ne $generation) { throw 'Fresh container ownership mismatch' }
  if ((Docker @('inspect', '--format', '{{json .HostConfig.PortBindings}}', $name)) -notin @('{}','null')) { throw 'Published database port prohibited' }
  $networkState = (Docker @('network', 'inspect', $network)) | ConvertFrom-Json
  if (!$networkState[0].Internal -or $networkState[0].Labels.'tuat.owner' -ne $owner -or $networkState[0].Labels.'tuat.generation' -ne $generation) { throw 'External-network isolation failed' }
  $report.stage = 'bootstrap:auth-migrate'
  Sql 'tuat_rls_review' "ALTER ROLE supabase_auth_admin WITH PASSWORD 'synthetic-review-local-only'" | Out-Null
  $attempted.auth = $true
  Docker @('run', '--rm', '--name', $authName, '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", '--network', $network, '--read-only', '--tmpfs', '/tmp', '--entrypoint', 'auth',
    '-e', 'GOTRUE_DB_DRIVER=postgres', '-e', "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:synthetic-review-local-only@$($name):5432/tuat_rls_review", '-e', 'GOTRUE_SITE_URL=http://127.0.0.1',
    '-e', 'API_EXTERNAL_URL=http://127.0.0.1',
    '-e', 'GOTRUE_JWT_SECRET=synthetic-review-signing-secret-at-least-32-characters', '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=false', '-e', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED=false', $authImage, 'migrate') | Out-Null
  $report.authMigrations = Sql 'tuat_rls_review' 'SELECT count(*) FROM auth.schema_migrations'
  $report.stage = 'bootstrap:storage-source'
  New-Item -ItemType Directory -Path $cachePath | Out-Null
  $attempted.storage = $true
  $storageNames = (Docker @('run', '--rm', '--name', $storageName, '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", '--network', 'none', '--read-only', '--entrypoint', 'ls', $storageImage, '/app/migrations/tenant')) -split "`n" | ForEach-Object { $_.Trim() } | Sort-Object { [int]($_.Split('-')[0]) }
  if ($storageNames.Count -ne 67 -or @($storageNames | Where-Object { $_ -notmatch '^\d+-[A-Za-z0-9_-]+\.sql$' }).Count) { throw 'Cached tenant Storage source names mismatch' }
  $storagePaths = @($storageNames | Select-Object -Skip 1 | ForEach-Object { "/app/migrations/tenant/$_" })
  $storageFirst = Docker @('run', '--rm', '--name', $storageName, '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", '--network', 'none', '--read-only', '--entrypoint', 'cat', $storageImage, "/app/migrations/tenant/$($storageNames[0])")
  $storageSource = Docker (@('run', '--rm', '--name', $storageName, '--label', "tuat.owner=$owner", '--label', "tuat.generation=$generation", '--network', 'none', '--read-only', '--entrypoint', 'cat', $storageImage) + $storagePaths)
  $storageFile = Join-Path $cachePath 'storage.sql'
  # Official cached migrate.js exposes these platform-role settings. Existing
  # Supabase roles are preserved: install_roles=true would introduce a cycle.
  $storagePreamble = @"
SET ROLE supabase_storage_admin;
SET search_path = storage, public;
SELECT set_config('storage.install_roles','false',false),
 set_config('storage.multitenant','false',false),
 set_config('storage.anon_role','anon',false),
 set_config('storage.authenticated_role','authenticated',false),
 set_config('storage.service_role','service_role',false),
 set_config('storage.super_user','supabase_storage_admin',false),
 set_config('storage.iceberg_default_shard','',false),
 set_config('storage.iceberg_shards','{}',false),
 set_config('storage.vector_bucket_provider','s3',false);
"@
  [IO.File]::WriteAllText($storageFile, "$storagePreamble`n$storageFirst;`n$storageSource`n", [Text.UTF8Encoding]::new($false))
  $report.storageSourceSha256 = (Get-FileHash -LiteralPath $storageFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $report.storageMigrations = $storageNames.Count
  $report.storageMigrationNames = $storageNames
  $report.stage = 'bootstrap:storage-migrate'
  SqlFile 'tuat_rls_review' "/review/db-review/.cache/$generation/storage.sql" | Out-Null
  $report.baseline = (Sql 'tuat_rls_review' "SELECT json_build_object('auth_users',to_regclass('auth.users') IS NOT NULL,'auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,'auth_jwt',to_regprocedure('auth.jwt()') IS NOT NULL,'storage_objects',to_regclass('storage.objects') IS NOT NULL,'cron_enabled',current_setting('cron.launch_active_jobs'))") | ConvertFrom-Json
  if (!$report.baseline.auth_users -or !$report.baseline.auth_uid -or !$report.baseline.auth_jwt -or !$report.baseline.storage_objects -or $report.baseline.cron_enabled -ne 'off') { throw 'Real cached Auth/Storage/disabled-cron prerequisites are incomplete' }
  $report.stage = 'bootstrap:disabled-cron-fixtures'
  Sql 'tuat_rls_review' "CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT cron.schedule('sheet-sync-hourly','0 * * * *','SELECT 1'); SELECT cron.schedule('schedule-import-hourly','5 * * * *','SELECT 1');" | Out-Null
  $migrationFiles = @(Get-ChildItem (Join-Path $candidateRoot 'supabase/migrations') -File -Filter '*.sql' | Sort-Object Name)
  $expectedMigrations = @($migrationFiles | ForEach-Object { [ordered]@{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
  $applySql = @('\set ON_ERROR_STOP on', 'SET client_min_messages = warning;')
  foreach ($migration in $expectedMigrations) {
    if ($migration.name -notmatch '^\d+_[A-Za-z0-9_-]+\.sql$') { throw 'Unexpected candidate migration filename' }
    $applySql += @("\echo APPLY:$($migration.name)", 'BEGIN;', "\ir /review/supabase/migrations/$($migration.name)", 'COMMIT;', "\echo MIGRATED:$($migration.name)")
  }
  [IO.File]::WriteAllText((Join-Path $cachePath 'apply.sql'), ($applySql -join "`n"), [Text.UTF8Encoding]::new($false))
  $report.stage = 'migration:full-chain'
  $applyOutput = & wsl.exe -d Ubuntu -- docker exec $name psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d tuat_rls_review -f "/review/db-review/.cache/$generation/apply.sql" 2>&1
  $applyExit = $LASTEXITCODE
  $applyText = ($applyOutput | Out-String)
  foreach ($migration in $expectedMigrations) {
    if ($applyText -match "(?m)^MIGRATED:$([regex]::Escape($migration.name))\s*$") {
      $report.migrations += [ordered]@{ name = $migration.name; sha256 = $migration.sha256; passed = $true }
    }
  }
  if ($applyExit -ne 0) {
    $lastApply = [regex]::Matches($applyText, '(?m)^APPLY:(\S+)') | Select-Object -Last 1
    if ($lastApply) { $report.stage = "migration:$($lastApply.Groups[1].Value)" }
    throw (($applyOutput | Select-Object -Last 12 | Out-String).Trim())
  }
  if ($report.migrations.Count -ne $expectedMigrations.Count) { throw 'Candidate migration completion count mismatch' }
  foreach ($migration in $expectedMigrations) {
    if ((Get-FileHash -LiteralPath (Join-Path $candidateRoot "supabase/migrations/$($migration.name)") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $migration.sha256) { throw 'Candidate migration changed during isolated review' }
  }
  $imageMigration = Join-Path $candidateRoot 'supabase/migrations/20261011150000_confirmed_image_cleanup.sql'
  if (Test-Path -LiteralPath $imageMigration) {
    $report.stage = 'reapply:confirmed_image_cleanup'
    Docker @('exec', $name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-U', 'supabase_admin', '-d', 'tuat_rls_review', '-f', '/review/supabase/migrations/20261011150000_confirmed_image_cleanup.sql') | Out-Null
    $report.imageMigrationReapply = $true
  }
  if ($Api) {
    $report.stage = 'test:postgrest-api'
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Explicit Node runtime not found for actual PostgREST API review' }
    $attempted.api = $true
    $apiOutput = & $NodePath (Join-Path $PSScriptRoot 'api-http.mjs') --container $name 2>&1
    $apiExit = $LASTEXITCODE
    $report.apiProof = ($apiOutput | Out-String).Trim() | ConvertFrom-Json
    $report.apiDriverSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'api-http.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($apiExit -ne 0 -or !$report.apiProof.success -or !$report.apiProof.cleanup) { throw "Actual synthetic API proof failed: $($report.apiProof.failure)" }
  } else {
  foreach ($test in @('rls_role_profile_guards.sql', 'rls_rpc_note_access.sql', 'confirmed_image_cleanup.sql')) {
    $report.stage = "test:$test"
    $output = SqlFile 'tuat_rls_review' "/review/supabase/tests/$test"
    if ($output -notmatch 'PASS:') { throw 'SQL test did not produce its completion evidence' }
    $report.tests += [ordered]@{ name = $test; sha256 = (Get-FileHash (Join-Path $candidateRoot "supabase/tests/$test") -Algorithm SHA256).Hash.ToLowerInvariant(); passed = $true }
  }
  $report.stage = 'test:allowlist.sql'
  $output = SqlFile 'tuat_rls_review' '/review/db-review/allowlist.sql'
  if ($output -notmatch 'PASS:') { throw 'Allowlist SQL test did not complete' }
  $report.tests += [ordered]@{ name = 'allowlist.sql'; sha256 = (Get-FileHash (Join-Path $PSScriptRoot 'allowlist.sql') -Algorithm SHA256).Hash.ToLowerInvariant(); passed = $true }
  $report.stage = 'test:image-races'
  if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Explicit Node runtime not found for real SQL race driver' }
  $raceOutput = & $NodePath (Join-Path $PSScriptRoot 'image-races.mjs') --container $name 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($raceOutput | Out-String).Trim()) }
  $report.imageRaces = ($raceOutput | Out-String).Trim() | ConvertFrom-Json
  if ($report.imageRaces.passed -ne 4 -or !$report.imageRaces.realSql -or !$report.imageRaces.syntheticOnly -or $report.imageRaces.r2Requests -ne 0) { throw 'Real synthetic race evidence incomplete' }
  $report.imageRaceSources = [ordered]@{ driverSha256 = (Get-FileHash -LiteralPath (Join-Path $candidateRoot 'ops/pc-image-cleanup/review-races.mjs') -Algorithm SHA256).Hash.ToLowerInvariant(); adapterSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'image-races.mjs') -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $report.final = (Sql 'tuat_rls_review' "SELECT json_build_object('auth_users',(SELECT count(*) FROM auth.users),'profiles', (SELECT count(*) FROM public.profiles), 'allowlist',(SELECT count(*) FROM public.login_email_allowlist),'confirmed_images',(SELECT count(*) FROM public.confirmed_image_retirements),'legacy_image_queue',(SELECT count(*) FROM public.note_image_cleanup),'rls_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity),'cron_enabled',current_setting('cron.launch_active_jobs'))") | ConvertFrom-Json
  if ($report.final.auth_users -ne 0 -or $report.final.profiles -ne 0 -or $report.final.allowlist -ne 0 -or $report.final.confirmed_images -ne 0 -or $report.final.legacy_image_queue -ne 0 -or $report.final.cron_enabled -ne 'off') { throw 'Synthetic fixture rollback/cleanup or disabled cron failed' }
  foreach ($migration in $expectedMigrations) {
    if ((Get-FileHash -LiteralPath (Join-Path $candidateRoot "supabase/migrations/$($migration.name)") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $migration.sha256) { throw 'Candidate migration changed during SQL/race tests; fresh review required' }
  }
  $report.success = $true
} catch {
  $report.success = $false
  $report.failure = $_.Exception.Message
} finally {
  try {
    $cleanupOutput = ($attempted | ConvertTo-Json -Compress) | & $NodePath (Join-Path $PSScriptRoot 'cleanup-owned.mjs') --execute-generation $generation
    $cleanupExit = $LASTEXITCODE
    $report.resourceCleanup = ($cleanupOutput | Out-String).Trim() | ConvertFrom-Json
    if ($cleanupExit -ne 0 -or !$report.resourceCleanup.cleanup) { throw 'Exact owned resource cleanup unconfirmed; retained' }
    $report.cleanupDriverSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'cleanup-owned.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
    if (Test-Path -LiteralPath $cachePath) {
      $cacheResolved = (Resolve-Path -LiteralPath $cachePath).Path
      $expectedCache = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".cache/$generation"))
      if ($cacheResolved -ne $expectedCache -or !$cacheResolved.StartsWith("$PSScriptRoot\.cache\") -or (Get-Item -LiteralPath $cachePath).LinkType) { throw 'Cleanup temporary source path mismatch; retained' }
      Remove-Item -LiteralPath $cacheResolved -Recurse -Force
    }
    $report.cleanup = $true
  } catch { $report.cleanup = $false; $report.cleanupFailure = $_.Exception.Message }
  $report.completedAt = [datetime]::UtcNow.ToString('o')
  $resultName = if ($Api) { 'api-result.json' } else { 'result.json' }
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot $resultName) -Encoding utf8
}
[ordered]@{ success = $report.success; mode = $report.mode; stage = $report.stage; migrations = $report.migrations.Count; tests = $report.tests.Count; apiChecks = $report.apiProof.checks.Count; cleanup = $report.cleanup; failure = $report.failure } | ConvertTo-Json -Depth 4
if (!$report.success -or !$report.cleanup) { exit 1 }
