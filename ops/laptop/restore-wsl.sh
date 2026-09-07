#!/bin/bash
# Restore only to this dedicated Docker container, never to the cloud.
set -euo pipefail
cd /opt/tuat-tf-supabase
backup=$(cat latest-backup-path)
case "$backup" in /opt/tuat-tf-supabase/backups/*) ;; *) echo 'Unexpected backup path'; exit 1;; esac
(cd "$backup" && sha256sum -c SHA256SUMS)
existing=$(docker exec supabase-db psql -X -U postgres -d postgres -Atc "select to_regclass('public.profiles') is not null")
[ "$existing" = f ] || { echo 'Application data already exists; refusing to overwrite'; exit 1; }
# Restoring users can queue hooks; keep Docker egress blocked and cron disabled.
internal=$(docker network inspect tuat-contingency_default --format '{{.Internal}}')
[ "$internal" = true ] || { echo 'Rehearsal network is not isolated'; exit 1; }
for container in supabase-db supabase-auth supabase-edge-functions; do
  [ "$(docker inspect "$container" --format '{{len .NetworkSettings.Networks}}')" = 1 ] || { echo 'Unexpected extra network'; exit 1; }
  [ "$(docker inspect "$container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')" = tuat-contingency_default ] || exit 1
done
[ "$(docker exec supabase-db psql -X -U postgres -d postgres -Atc 'show cron.launch_active_jobs')" = off ] || exit 1
# A failed SQL statement rolls back the whole transaction. Never disable ON_ERROR_STOP.
test -s "$backup/managed-schema.sql"
{ printf 'BEGIN;\nSET session_replication_role=replica;\n'; cat "$backup/roles.sql" "$backup/schema.sql" "$backup/managed-schema.sql" "$backup/data.sql"; printf '\nCOMMIT;\n'; } |
  docker exec -i supabase-db psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 > restore.log 2>&1
printf '%s\n' 'Local database restored. Verify row counts, Auth and RLS before any cutover.'
