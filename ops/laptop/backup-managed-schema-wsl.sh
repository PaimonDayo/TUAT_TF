#!/bin/bash
set -euo pipefail
base='/mnt/c/Paimon Dayo/TUAT_TF'
backup=${1:-$(cat /opt/tuat-tf-supabase/latest-backup-path)}
case "$backup" in /opt/tuat-tf-supabase/backups/*) ;; *) exit 1;; esac
{
  printf 'set -euo pipefail\n'
  grep '^export PG' "$base/.contingency/data-dump-command.sh"
  printf "psql -X -At -v ON_ERROR_STOP=1 <<'LOCAL_SCHEMA_QUERY'\n"
  cat "$base/ops/laptop/export-managed-schema.sql"
  printf '\nLOCAL_SCHEMA_QUERY\n'
} | docker run --rm -i --entrypoint bash supabase/postgres:17.6.1.136 > "$backup/managed-schema.sql"
test -s "$backup/managed-schema.sql"
(cd "$backup" && sha256sum roles.sql schema.sql data.sql managed-schema.sql > SHA256SUMS)
echo 'Application Auth triggers and Storage policies backed up.'
